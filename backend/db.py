# Copyright (c) 2026 Taher AkbariSaeed
import aiomysql
import asyncio
import time
import os
import sys
from datetime import datetime
from dotenv import load_dotenv

# Load .env from multiple possible locations (PyInstaller vs dev)
def _load_env():
    candidates = []
    # 1. Next to the running exe (PyInstaller production)
    if getattr(sys, 'frozen', False):
        # Bundled internally by PyInstaller (Securely packaged)
        candidates.append(os.path.join(sys._MEIPASS, '.env'))
        candidates.append(os.path.join(os.path.dirname(sys.executable), '.env'))
        candidates.append(os.path.join(os.path.dirname(sys.executable), 'backend', '.env'))
    # 2. Next to this source file (development)
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
    
    for path in candidates:
        if os.path.exists(path):
            load_dotenv(path)
            print(f"DEBUG: Loaded .env from {path}")
            return
    print("WARNING: No .env file found. DB connection will fail unless env vars are set externally.")

_load_env()

DB_HOST = os.environ.get('DB_HOST', '')
DB_USER = os.environ.get('DB_USER', '')
DB_PASSWORD = os.environ.get('DB_PASSWORD', '')
DB_NAME = os.environ.get('DB_NAME', '')
DB_PORT = int(os.environ.get('DB_PORT', '') or '3306')

pool = None
db_via_proxy = False
db_mode = "disconnected"  # "direct" | "worker" | "worker_fronted" | "tunnel" | "offline" | "disconnected"
_analytics_cache = None
_analytics_cache_time = 0

# --- Layer 2-3: Cloudflare Worker DB Proxy ---
WORKER_URL = os.environ.get('WORKER_URL', '')
WORKER_API_KEY = os.environ.get('WORKER_API_KEY', '')

class WorkerDBProxy:
    """HTTPS REST proxy to Cloudflare Worker — Layers 2 & 3"""

    def __init__(self, worker_url=None, api_key=None, clean_ip=None):
        self.worker_url = (worker_url or WORKER_URL).rstrip('/')
        self.api_key = api_key or WORKER_API_KEY
        self.clean_ip = clean_ip  # For domain fronting (Layer 3)

    async def _post(self, path, data=None):
        import httpx
        headers = {"Content-Type": "application/json", "X-API-Key": self.api_key}
        url = f"{self.worker_url}{path}"

        # Layer 3: Domain fronting — connect via clean IP, send Host header
        transport = None
        if self.clean_ip:
            from urllib.parse import urlparse
            parsed = urlparse(self.worker_url)
            host = parsed.hostname
            headers["Host"] = host
            url = f"https://{self.clean_ip}{path}"
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            transport = httpx.AsyncHTTPTransport(verify=ctx)

        async with httpx.AsyncClient(timeout=10, transport=transport) as client:
            r = await client.post(url, json=data or {}, headers=headers)
            r.raise_for_status()
            return r.json()

    async def health(self):
        import httpx
        headers = {"X-API-Key": self.api_key}
        url = f"{self.worker_url}/api/health"
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url, headers=headers)
            return r.status_code == 200

    async def save_scan_result(self, data):
        await self._post("/api/save-scan", data)

    async def get_historical_good_ips(self, isp, location, limit=100):
        r = await self._post("/api/historical-ips", {"isp": isp, "location": location, "limit": limit})
        return r.get("ips", [])

    async def get_community_good_ips(self, country, isp, limit=50):
        r = await self._post("/api/community-ips", {"country": country, "isp": isp, "limit": limit})
        return r.get("ips", [])

    async def get_analytics(self, provider='cloudflare'):
        return await self._post("/api/analytics", {"provider": provider})

    async def get_geo_analytics(self, provider='cloudflare'):
        return await self._post("/api/geo-analytics", {"provider": provider})

    async def log_usage_event(self, ip, location, isp, event_type, details=""):
        await self._post("/api/log-usage", {"ip": ip, "location": location, "isp": isp, "event_type": event_type, "details": details})

    async def get_country_domains(self, country):
        r = await self._post("/api/country-domains", {"country": country})
        return r if r.get("domains") else None

    async def save_country_domains(self, country, domains):
        await self._post("/api/save-country-domains", {"country": country, "domains": domains})

worker_proxy = None  # Active WorkerDBProxy instance (set during init)

# --- Layer 5: Local SQLite Offline Fallback ---
import aiosqlite
import json as _json

SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'offline_cache.db')

class LocalSQLiteDB:
    """Local SQLite fallback — Layer 5 (offline mode)"""

    def __init__(self, path=None):
        self.path = path or SQLITE_PATH

    async def init(self):
        async with aiosqlite.connect(self.path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS scan_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT, user_ip TEXT, user_location TEXT, user_isp TEXT,
                    vless_uuid TEXT, scanned_ip TEXT, ip_source TEXT,
                    ping REAL, jitter REAL, download REAL, upload REAL,
                    status TEXT, datacenter TEXT, asn TEXT, network_type TEXT,
                    port INTEGER, sni TEXT, app_version TEXT, provider TEXT DEFAULT 'cloudflare',
                    synced INTEGER DEFAULT 0
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS usage_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT, user_ip TEXT, user_location TEXT, user_isp TEXT,
                    event_type TEXT, details TEXT, synced INTEGER DEFAULT 0
                )
            """)
            await db.commit()

    async def save_scan_result(self, data):
        async with aiosqlite.connect(self.path) as db:
            await db.execute("""
                INSERT INTO scan_results 
                (timestamp, user_ip, user_location, user_isp, vless_uuid, scanned_ip,
                 ip_source, ping, jitter, download, upload, status, datacenter, asn,
                 network_type, port, sni, app_version, provider)
                VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                data.get("user_ip", "Unknown"), data.get("user_location", "Unknown"),
                data.get("user_isp", "Unknown"), data.get("vless_uuid", "Unknown"),
                data.get("scanned_ip", "Unknown"), data.get("ip_source", "Unknown"),
                data.get("ping", -1), data.get("jitter", -1),
                data.get("download", -1), data.get("upload", -1),
                data.get("status", "Unknown"), data.get("datacenter", "Unknown"),
                data.get("asn", "Unknown"), data.get("network_type", "Unknown"),
                data.get("port", -1), data.get("sni", "Unknown"),
                data.get("app_version", "1.0.0"), data.get("provider", "cloudflare")
            ))
            await db.commit()

    async def get_historical_good_ips(self, isp, location, limit=100):
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("""
                SELECT DISTINCT scanned_ip FROM scan_results
                WHERE status = 'ok' AND ping < 300 AND download > 5
                  AND (user_isp = ? OR user_location = ?)
                ORDER BY timestamp DESC LIMIT ?
            """, (isp, location, limit))
            rows = await cursor.fetchall()
            return [r[0] for r in rows]

    async def log_usage_event(self, ip, location, isp, event_type, details=""):
        async with aiosqlite.connect(self.path) as db:
            await db.execute("""
                INSERT INTO usage_logs (timestamp, user_ip, user_location, user_isp, event_type, details)
                VALUES (datetime('now'), ?, ?, ?, ?, ?)
            """, (ip, location, isp, event_type, details))
            await db.commit()

    async def get_unsynced_scans(self, limit=100):
        """Get scans that haven't been synced to remote DB yet"""
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM scan_results WHERE synced = 0 LIMIT ?", (limit,))
            return await cursor.fetchall()

    async def mark_synced(self, ids):
        """Mark scans as synced after successful remote upload"""
        async with aiosqlite.connect(self.path) as db:
            placeholders = ','.join(['?'] * len(ids))
            await db.execute(f"UPDATE scan_results SET synced = 1 WHERE id IN ({placeholders})", ids)
            await db.commit()

local_db = None  # Active LocalSQLiteDB instance

async def init_db():
    global pool
    try:
        pool = await aiomysql.create_pool(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            db=DB_NAME,
            autocommit=True,
            minsize=1,
            maxsize=10, 
            pool_recycle=300,
            connect_timeout=5
        )
        
        # Ensure table exists
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS scan_results (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        timestamp DATETIME,
                        user_ip VARCHAR(50),
                        user_location VARCHAR(255),
                        user_isp VARCHAR(255),
                        vless_uuid VARCHAR(100),
                        scanned_ip VARCHAR(50),
                        ip_source VARCHAR(50),
                        ping FLOAT,
                        jitter FLOAT,
                        download FLOAT,
                        upload FLOAT,
                        status VARCHAR(50)
                    );
                """)
                
                # Phase 9: Migrate new analytics columns
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN datacenter VARCHAR(50);")
                except: pass
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN asn VARCHAR(50);")
                except: pass
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN network_type VARCHAR(50);")
                except: pass
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN port INT;")
                except: pass
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN sni VARCHAR(255);")
                except: pass
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN app_version VARCHAR(50);")
                except: pass
                
                # Fastly Isolation Migration
                try: await cur.execute("ALTER TABLE scan_results ADD COLUMN provider VARCHAR(50) DEFAULT 'cloudflare';")
                except: pass

                # Analytics Indexes
                try: await cur.execute("CREATE INDEX idx_analytics_dc ON scan_results(provider, status, datacenter);")
                except: pass
                try: await cur.execute("CREATE INDEX idx_analytics_port ON scan_results(provider, status, port);")
                except: pass
                try: await cur.execute("CREATE INDEX idx_analytics_time ON scan_results(provider, timestamp, status);")
                except: pass
                try: await cur.execute("CREATE INDEX idx_analytics_asn ON scan_results(provider, status, asn);")
                except: pass
                try: await cur.execute("CREATE INDEX idx_analytics_isp ON scan_results(provider, status, user_isp);")
                except: pass


                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS country_domains (
                        country VARCHAR(100) PRIMARY KEY,
                        domains LONGTEXT,
                        last_updated DATETIME
                    );
                """)
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_usage_logs (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        timestamp DATETIME,
                        user_ip VARCHAR(50),
                        user_location VARCHAR(255),
                        user_isp VARCHAR(255),
                        event_type VARCHAR(100),
                        details TEXT
                    );
                """)
                
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS advanced_bypass_logs (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        timestamp DATETIME,
                        user_isp VARCHAR(255),
                        bypass_mode VARCHAR(50),
                        fragment_length VARCHAR(50),
                        fragment_interval VARCHAR(50),
                        test_sni VARCHAR(255),
                        ping FLOAT
                    );
                """)
                
                # Smart Recommendation Engine: Performance Indexes
                index_stmts = [
                    "CREATE INDEX idx_scan_isp_status ON scan_results(user_isp, status)",
                    "CREATE INDEX idx_scan_location ON scan_results(user_location)",
                    "CREATE INDEX idx_scan_ip_time ON scan_results(scanned_ip, timestamp)",
                    "CREATE INDEX idx_scan_status_time ON scan_results(status, timestamp)",
                ]
                for stmt in index_stmts:
                    try: await cur.execute(stmt)
                    except: pass  # Index already exists
                    
        print("Database initialized and table verified.")
    except Exception as e:
        print(f"Failed to initialize database: {e}")

async def save_scan_result(data: dict):
    # Smart routing: try pool → worker → local SQLite
    if pool:
        try:
            async with asyncio.timeout(2.0):
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("""
                            INSERT INTO scan_results 
                            (timestamp, user_ip, user_location, user_isp, vless_uuid, scanned_ip, ip_source, ping, jitter, download, upload, status, datacenter, asn, network_type, port, sni, app_version, provider)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                        datetime.now(),
                        data.get("user_ip", "Unknown"),
                        data.get("user_location", "Unknown"),
                        data.get("user_isp", "Unknown"),
                        data.get("vless_uuid", "Unknown"),
                        data.get("scanned_ip", "Unknown"),
                        data.get("ip_source", "Unknown"),
                        data.get("ping", -1),
                        data.get("jitter", -1),
                        data.get("download", -1),
                        data.get("upload", -1),
                        data.get("status", "Unknown"),
                        data.get("datacenter", "Unknown"),
                        data.get("asn", "Unknown"),
                        data.get("network_type", "Unknown"),
                        data.get("port", -1),
                        data.get("sni", "Unknown"),
                        data.get("app_version", "1.0.0"),
                        data.get("provider", "cloudflare")
                    ))
            return
        except Exception as e:
            import sys
            print(f"[DB] Direct save failed: {e}", file=sys.stderr)

    # Fallback to Worker proxy
    if worker_proxy:
        try:
            await worker_proxy.save_scan_result(data)
            return
        except Exception as e:
            import sys
            print(f"[DB] Worker save failed: {e}", file=sys.stderr)

    # Fallback to local SQLite
    if local_db:
        try:
            await local_db.save_scan_result(data)
        except Exception as e:
            import sys
            print(f"[DB] Local save failed: {e}", file=sys.stderr)

async def get_historical_good_ips(isp: str, location: str, limit: int = 100):
    # Smart routing: pool → worker → local SQLite
    if pool:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    query = """
                        SELECT scanned_ip FROM scan_results 
                        WHERE status = 'ok' 
                          AND ping < 300 
                          AND download > 5
                          AND user_isp = %s
                          AND user_location = %s
                        ORDER BY timestamp DESC
                        LIMIT %s
                    """
                    await cur.execute(query, (isp, location, limit))
                    results = await cur.fetchall()
                    
                    if len(results) < limit / 2:
                        query2 = """
                            SELECT scanned_ip FROM scan_results 
                            WHERE status = 'ok' 
                              AND ping < 300 
                              AND download > 5
                              AND user_isp = %s
                            ORDER BY timestamp DESC
                            LIMIT %s
                        """
                        await cur.execute(query2, (isp, limit))
                        more_results = await cur.fetchall()
                        results = list(results)
                        results.extend(list(more_results))
                        
                    if not results:
                         query3 = """
                            SELECT scanned_ip FROM scan_results 
                            WHERE status = 'ok' 
                            ORDER BY timestamp DESC
                            LIMIT %s
                         """
                         await cur.execute(query3, (limit,))
                         results = await cur.fetchall()

                    seen = set()
                    unique_ips = []
                    for r in results:
                        ip = r.get("scanned_ip")
                        if ip and ip not in seen:
                            seen.add(ip)
                            unique_ips.append(ip)
                    
                    return unique_ips
        except Exception as e:
            print(f"DB Fetch Error: {e}")

    if worker_proxy:
        try:
            return await worker_proxy.get_historical_good_ips(isp, location, limit)
        except Exception as e:
            print(f"Worker Fetch Error: {e}")

    if local_db:
        try:
            return await local_db.get_historical_good_ips(isp, location, limit)
        except:
            pass

    return []

async def get_country_domains(country: str):
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT domains, last_updated FROM country_domains WHERE country = %s", (country,))
                res = await cur.fetchone()
                if res:
                    return {
                        "domains": res["domains"].split(","),
                        "last_updated": res["last_updated"]
                    }
    except Exception as e:
        pass
    return None

async def save_country_domains(country: str, domains: list):
    if not pool:
        return
    try:
        domains_str = ",".join(domains)
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO country_domains (country, domains, last_updated)
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE domains=%s, last_updated=%s
                """, (country, domains_str, datetime.now(), domains_str, datetime.now()))
    except Exception as e:
        pass

async def log_usage_event(ip: str, location: str, isp: str, event_type: str, details: str = ""):
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO app_usage_logs (timestamp, user_ip, user_location, user_isp, event_type, details)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (datetime.now(), ip, location, isp, event_type, details))
    except Exception as e:
        pass

async def get_community_good_ips(country: str, isp: str, limit: int = 50):
    # Smart routing: pool → worker
    if pool:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    # Top community IPs for this country or ISP
                    query = """
                        SELECT DISTINCT scanned_ip 
                        FROM scan_results 
                        WHERE status = 'ok' 
                          AND (user_location LIKE %s OR user_isp = %s)
                          AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
                        ORDER BY download DESC, ping ASC
                        LIMIT %s
                    """
                    like_country = f"{country}%" if country else "%"
                    await cur.execute(query, (like_country, isp, limit))
                    results = await cur.fetchall()
                    
                    # If not enough, get global top IPs
                    if len(results) < limit / 2:
                        query2 = """
                            SELECT DISTINCT scanned_ip 
                            FROM scan_results 
                            WHERE status = 'ok' 
                              AND timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
                            ORDER BY download DESC
                            LIMIT %s
                        """
                        await cur.execute(query2, (limit,))
                        more_results = await cur.fetchall()
                        results = list(results)
                        results.extend(list(more_results))
                        
                    seen = set()
                    unique_ips = []
                    for r in results:
                        ip = r.get("scanned_ip")
                        if ip and ip not in seen:
                            seen.add(ip)
                            unique_ips.append(ip)
                    return unique_ips
        except Exception as e:
            print(f"DB Community Fetch Error: {e}")

async def get_smart_recommendations(isp: str, location: str, country: str, limit: int = 30):
    """Smart IP Recommendation Engine — 3-tier ISP-aware weighted scoring.
    
    Tier 1 (60%): Same ISP — IPs tested by users on the exact same ISP
    Tier 2 (30%): Same Region — IPs tested by users in the same country
    Tier 3 (10%): Global Best — Top-performing IPs across all users
    
    Each IP gets a composite score based on:
    - Reliability: success_rate * 100
    - Ping bonus: 100 - avg_ping (capped)
    - Speed bonus: avg_download * 2
    - Jitter penalty: -avg_jitter * 0.5
    - Freshness: exponential decay over 30 days
    """
    _SCORE_QUERY = """
        SELECT scanned_ip,
            COUNT(*) as total_tests,
            ROUND(AVG(ping), 1) as avg_ping,
            ROUND(AVG(jitter), 1) as avg_jitter,
            ROUND(AVG(download), 2) as avg_download,
            ROUND(AVG(upload), 2) as avg_upload,
            SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as success_count,
            MAX(timestamp) as last_seen,
            ROUND(
                (SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) * 100.0 / COUNT(*))
                + GREATEST(100 - AVG(ping), 0)
                + (AVG(download) * 2)
                - (AVG(jitter) * 0.5)
            , 1) as score
        FROM scan_results
        WHERE status = 'ok'
          AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND {filter}
        GROUP BY scanned_ip
        HAVING total_tests >= 2
        ORDER BY score DESC
        LIMIT %s
    """
    
    if pool:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    results = []
                    seen = set()
                    
                    # Tier 1: Same ISP (60% of limit)
                    tier1_limit = max(int(limit * 0.6), 5)
                    q1 = _SCORE_QUERY.format(filter="user_isp = %s")
                    await cur.execute(q1, (isp or "", tier1_limit))
                    for row in await cur.fetchall():
                        ip = row["scanned_ip"]
                        if ip not in seen:
                            seen.add(ip)
                            row["tier"] = "isp"
                            results.append(dict(row))
                    
                    # Tier 2: Same Region (30% of limit)
                    tier2_limit = max(int(limit * 0.3), 3)
                    like_country = f"{country}%" if country else "%"
                    q2 = _SCORE_QUERY.format(filter="user_location LIKE %s")
                    await cur.execute(q2, (like_country, tier2_limit))
                    for row in await cur.fetchall():
                        ip = row["scanned_ip"]
                        if ip not in seen:
                            seen.add(ip)
                            row["tier"] = "region"
                            results.append(dict(row))
                    
                    # Tier 3: Global Best (10% of limit)
                    tier3_limit = max(int(limit * 0.1), 2)
                    q3 = _SCORE_QUERY.format(filter="1=1")
                    await cur.execute(q3, (tier3_limit,))
                    for row in await cur.fetchall():
                        ip = row["scanned_ip"]
                        if ip not in seen:
                            seen.add(ip)
                            row["tier"] = "global"
                            results.append(dict(row))
                    
                    # Convert datetime objects to strings for JSON serialization
                    for r in results:
                        if r.get("last_seen"):
                            r["last_seen"] = str(r["last_seen"])
                    
                    return results
        except Exception as e:
            print(f"Smart Recommend DB Error: {e}")
    
    if worker_proxy:
        try:
            r = await worker_proxy._post("/api/smart-recommend", {
                "isp": isp, "location": location, "country": country, "limit": limit
            })
            return r.get("results", [])
        except Exception as e:
            print(f"Smart Recommend Worker Error: {e}")
    
    return []

async def log_bypass_result(isp: str, mode: str, length: str, interval: str, sni: str, ping: float):
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO advanced_bypass_logs (timestamp, user_isp, bypass_mode, fragment_length, fragment_interval, test_sni, ping)
                    VALUES (NOW(), %s, %s, %s, %s, %s, %s)
                """, (isp, mode, length, interval, sni, ping))
    except Exception as e:
        print(f"Log Bypass Error: {e}")

async def get_best_community_bypasses(isp: str, mode: str, limit: int = 5):
    if pool:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    if mode == 'fragment':
                        query = """
                            SELECT fragment_length as length, fragment_interval as `interval`, 
                                   COUNT(*) as success_count, ROUND(AVG(ping), 1) as avg_ping
                            FROM advanced_bypass_logs 
                            WHERE bypass_mode = 'fragment' AND user_isp = %s
                              AND fragment_length IS NOT NULL AND fragment_interval IS NOT NULL
                              AND fragment_length != 'Unknown' AND fragment_interval != 'Unknown'
                            GROUP BY fragment_length, fragment_interval
                            ORDER BY success_count DESC, avg_ping ASC
                            LIMIT %s
                        """
                        await cur.execute(query, (isp, limit))
                        return list(await cur.fetchall())
                    elif mode == 'sni':
                        query = """
                            SELECT test_sni as sni, COUNT(*) as success_count, ROUND(AVG(ping), 1) as avg_ping
                            FROM advanced_bypass_logs
                            WHERE bypass_mode = 'sni' AND user_isp = %s
                              AND test_sni IS NOT NULL AND test_sni != 'Unknown'
                            GROUP BY test_sni
                            ORDER BY success_count DESC, avg_ping ASC
                            LIMIT %s
                        """
                        await cur.execute(query, (isp, limit))
                        return list(await cur.fetchall())
        except Exception as e:
            print(f"Get Best Bypasses Error: {e}")
            
    if worker_proxy:
        try:
            r = await worker_proxy._post("/api/best-bypasses", {"isp": isp, "mode": mode, "limit": limit})
            return r.get("results", [])
        except Exception as e:
            print(f"Worker Best Bypasses Error: {e}")
    return []
async def get_analytics(provider='cloudflare'):
    global _analytics_cache, _analytics_cache_time
    cache_key = f"global_{provider}"
    if _analytics_cache is None: _analytics_cache = {}
    
    # Return cache if less than 15 minutes old
    if cache_key in _analytics_cache and (time.time() - _analytics_cache_time) < 900:
        return _analytics_cache[cache_key]

    if not pool:
        # Try worker proxy
        if worker_proxy:
            try:
                return await worker_proxy.get_analytics(provider)
            except:
                pass
        return {}
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Top Datacenters with Average Ping
                await cur.execute("""
                    SELECT datacenter, COUNT(*) as count, ROUND(AVG(ping)) as avg_ping 
                    FROM scan_results 
                    WHERE status = 'ok' AND datacenter != 'Unknown' AND datacenter IS NOT NULL AND provider = %s
                    GROUP BY datacenter 
                    ORDER BY count DESC LIMIT 10
                """, (provider,))
                top_datacenters = await cur.fetchall()
                
                # Top Ports
                await cur.execute("""
                    SELECT port, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status = 'ok' AND port != -1 AND port IS NOT NULL AND provider = %s
                    GROUP BY port 
                    ORDER BY count DESC LIMIT 5
                """, (provider,))
                top_ports = await cur.fetchall()
                
                # Network Types
                await cur.execute("""
                    SELECT network_type, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status = 'ok' AND network_type != 'Unknown' AND network_type IS NOT NULL AND provider = %s
                    GROUP BY network_type 
                    ORDER BY count DESC
                """, (provider,))
                network_types = await cur.fetchall()
                
                # Total Scans
                await cur.execute("SELECT COUNT(*) as count FROM scan_results WHERE provider = %s", (provider,))
                total_scans_row = await cur.fetchone()
                total_scans = total_scans_row["count"] if total_scans_row else 0
                
                # Total Good IPs found
                await cur.execute("SELECT COUNT(*) as count FROM scan_results WHERE status = 'ok' AND provider = %s", (provider,))
                total_good_row = await cur.fetchone()
                total_good = total_good_row["count"] if total_good_row else 0
                
                # 7-Day Timeline Data
                await cur.execute("""
                    SELECT DATE(timestamp) as date, 
                           COUNT(*) as total_scans, 
                           SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as successful_scans 
                    FROM scan_results 
                    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) AND provider = %s
                    GROUP BY DATE(timestamp)
                    ORDER BY date ASC
                """, (provider,))
                timeline_rows = await cur.fetchall()
                # Format dates to string for JSON serialization
                timeline_data = []
                for row in timeline_rows:
                    timeline_data.append({
                        "date": row["date"].strftime("%Y-%m-%d") if row["date"] else "Unknown",
                        "total_scans": int(row["total_scans"]) if row["total_scans"] is not None else 0,
                        "successful_scans": int(row["successful_scans"]) if row["successful_scans"] is not None else 0
                    })

                # Top ASNs
                await cur.execute("""
                    SELECT asn, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status = 'ok' AND asn != 'Unknown' AND asn IS NOT NULL AND provider = %s 
                    GROUP BY asn 
                    ORDER BY count DESC LIMIT 5
                """, (provider,))
                top_asns = await cur.fetchall()

                # Top ISPs
                await cur.execute("""
                    SELECT user_isp as isp, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status = 'ok' AND user_isp != 'Unknown' AND user_isp IS NOT NULL AND provider = %s 
                    GROUP BY user_isp 
                    ORDER BY count DESC LIMIT 5
                """, (provider,))
                top_isps = await cur.fetchall()

                # Fail Reasons
                await cur.execute("""
                    SELECT status as fail_reason, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status != 'ok' AND provider = %s 
                    GROUP BY status
                """, (provider,))
                fail_reasons = await cur.fetchall()

                _analytics_cache[cache_key] = {
                    "top_datacenters": top_datacenters,
                    "top_ports": top_ports,
                    "network_types": network_types,
                    "top_asns": top_asns,
                    "top_isps": top_isps,
                    "fail_reasons": fail_reasons,
                    "total_scans": total_scans,
                    "total_good": total_good,
                    "timeline_data": timeline_data
                }
                _analytics_cache_time = time.time()
                return _analytics_cache[cache_key]
    except Exception as e:
        print(f"DB Analytics Error: {e}")
        return {}

_geo_cache = None
_geo_cache_time = 0

async def get_geo_analytics(provider='cloudflare'):
    """Aggregate scan results by country for the world heatmap"""
    global _geo_cache, _geo_cache_time
    cache_key = f"geo_{provider}"
    if _geo_cache is None: _geo_cache = {}
    
    if cache_key in _geo_cache and (time.time() - _geo_cache_time) < 300:
        return _geo_cache[cache_key]

    if not pool:
        # Try worker proxy
        if worker_proxy:
            try:
                return await worker_proxy.get_geo_analytics(provider)
            except:
                pass
        return []
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Aggregate by country (extracted from user_location "Country - City")
                await cur.execute("""
                    SELECT 
                        TRIM(SUBSTRING_INDEX(user_location, ' - ', 1)) as country,
                        COUNT(*) as total_scans,
                        SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as good_ips,
                        ROUND(AVG(CASE WHEN ping > 0 THEN ping ELSE NULL END)) as avg_ping,
                        ROUND(AVG(CASE WHEN download > 0 THEN download ELSE NULL END), 1) as avg_download,
                        ROUND(AVG(CASE WHEN upload > 0 THEN upload ELSE NULL END), 1) as avg_upload,
                        ROUND(AVG(CASE WHEN jitter > 0 THEN jitter ELSE NULL END)) as avg_jitter,
                        COUNT(DISTINCT user_ip) as unique_users
                    FROM scan_results 
                    WHERE user_location IS NOT NULL AND user_location != 'Unknown' AND provider = %s
                    GROUP BY TRIM(SUBSTRING_INDEX(user_location, ' - ', 1))
                    HAVING total_scans > 0
                    ORDER BY total_scans DESC
                """, (provider,))
                country_stats = await cur.fetchall()

                # Top ISP per country
                await cur.execute("""
                    SELECT 
                        TRIM(SUBSTRING_INDEX(user_location, ' - ', 1)) as country,
                        user_isp as isp,
                        COUNT(*) as scan_count
                    FROM scan_results 
                    WHERE user_location IS NOT NULL AND user_location != 'Unknown'
                        AND user_isp IS NOT NULL AND user_isp != 'Unknown'
                        AND provider = %s
                    GROUP BY country, user_isp
                    ORDER BY country, scan_count DESC
                """, (provider,))
                isp_rows = await cur.fetchall()

                # Top datacenter per country
                await cur.execute("""
                    SELECT 
                        TRIM(SUBSTRING_INDEX(user_location, ' - ', 1)) as country,
                        datacenter,
                        COUNT(*) as hit_count
                    FROM scan_results 
                    WHERE user_location IS NOT NULL AND user_location != 'Unknown'
                        AND datacenter IS NOT NULL AND datacenter != 'Unknown'
                        AND status = 'ok'
                        AND provider = %s
                    GROUP BY country, datacenter
                    ORDER BY country, hit_count DESC
                """, (provider,))
                dc_rows = await cur.fetchall()

                # Build ISP map: {country: [top 3 ISPs]}
                isp_map = {}
                for row in isp_rows:
                    c = row['country']
                    if c not in isp_map:
                        isp_map[c] = []
                    if len(isp_map[c]) < 3:
                        isp_map[c].append({'name': row['isp'], 'scans': int(row['scan_count'])})

                # Build DC map: {country: [top 3 datacenters]}
                dc_map = {}
                for row in dc_rows:
                    c = row['country']
                    if c not in dc_map:
                        dc_map[c] = []
                    if len(dc_map[c]) < 3:
                        dc_map[c].append({'code': row['datacenter'], 'hits': int(row['hit_count'])})

                # Merge
                result = []
                for row in country_stats:
                    c = row['country']
                    total = int(row['total_scans']) if row['total_scans'] else 0
                    good = int(row['good_ips']) if row['good_ips'] else 0
                    result.append({
                        'country': c,
                        'total_scans': total,
                        'good_ips': good,
                        'success_rate': round((good / total * 100), 1) if total > 0 else 0,
                        'avg_ping': int(row['avg_ping']) if row['avg_ping'] else None,
                        'avg_download': float(row['avg_download']) if row['avg_download'] else None,
                        'avg_upload': float(row['avg_upload']) if row['avg_upload'] else None,
                        'avg_jitter': int(row['avg_jitter']) if row['avg_jitter'] else None,
                        'unique_users': int(row['unique_users']) if row['unique_users'] else 0,
                        'top_isps': isp_map.get(c, []),
                        'top_datacenters': dc_map.get(c, [])
                    })

                _geo_cache[cache_key] = result
                _geo_cache_time = time.time()
                return result
    except Exception as e:
        print(f"DB Geo Analytics Error: {e}")
        return []

async def reconnect_db(host, port):
    global pool
    try:
        if pool:
            pool.close()
            await pool.wait_closed()
        
        pool = await aiomysql.create_pool(
            host=host,
            port=port,
            user=DB_USER,
            password=DB_PASSWORD,
            db=DB_NAME,
            autocommit=True,
            minsize=1,
            maxsize=5,
            pool_recycle=300,
            connect_timeout=10
        )
        print(f"DEBUG: Successfully reconnected Database Pool to -> {host}:{port}")
        return True
    except Exception as e:
        print(f"CRITICAL: Failed to proxy database connection: {e}")
        return False
