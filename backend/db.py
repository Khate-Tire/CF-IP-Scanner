import aiomysql
import asyncio
from datetime import datetime

DB_HOST = 'aapanel.amnvpn.org'
DB_USER = 'saflysurf'
DB_PASSWORD = 'xaAxctbXwp4XfmTa'
DB_NAME = 'saflysurf'
DB_PORT = 3306

pool = None

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
            pool_recycle=300
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
        print("Database initialized and table verified.")
    except Exception as e:
        print(f"Failed to initialize database: {e}")

async def save_scan_result(data: dict):
    if not pool:
        return
    try:
        # Try to get connection with brief timeout, fail gracefully if busy
        async with asyncio.timeout(2.0):
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("""
                        INSERT INTO scan_results 
                        (timestamp, user_ip, user_location, user_isp, vless_uuid, scanned_ip, ip_source, ping, jitter, download, upload, status, datacenter, asn, network_type, port, sni, app_version)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    data.get("app_version", "1.0.0")
                ))
    except Exception as e:
        # print("DB Save Error:", e)
        pass # Silently fail on DB errors to not interrupt scanning

async def get_historical_good_ips(isp: str, location: str, limit: int = 100):
    if not pool:
        return []
        
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Prioritize same ISP and location, then just same ISP, then recent good IPs generally
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
                
                # If too few, broaden search to same ISP only
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
                    results.extend(more_results)
                    
                # If still too few, broaden entirely (just recently successful globally)
                if not results:
                     query3 = """
                        SELECT scanned_ip FROM scan_results 
                        WHERE status = 'ok' 
                        ORDER BY timestamp DESC
                        LIMIT %s
                     """
                     await cur.execute(query3, (limit,))
                     results = await cur.fetchall()

                # Extract unique IPs ignoring duplicates
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
    if not pool:
        return []
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
                    results.extend(more_results)
                    
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
        return []

async def get_analytics():
    if not pool:
        return {}
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Top Datacenters with Average Ping
                await cur.execute("""
                    SELECT datacenter, COUNT(*) as count, ROUND(AVG(ping)) as avg_ping 
                    FROM scan_results 
                    WHERE status = 'ok' AND datacenter != 'Unknown' AND datacenter IS NOT NULL
                    GROUP BY datacenter 
                    ORDER BY count DESC LIMIT 10
                """)
                top_datacenters = await cur.fetchall()
                
                # Top Ports
                await cur.execute("""
                    SELECT port, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status = 'ok' AND port != -1 AND port IS NOT NULL
                    GROUP BY port 
                    ORDER BY count DESC LIMIT 5
                """)
                top_ports = await cur.fetchall()
                
                # Network Types
                await cur.execute("""
                    SELECT network_type, COUNT(*) as count 
                    FROM scan_results 
                    WHERE status = 'ok' AND network_type != 'Unknown' AND network_type IS NOT NULL
                    GROUP BY network_type 
                    ORDER BY count DESC
                """)
                network_types = await cur.fetchall()
                
                # Total Scans
                await cur.execute("SELECT COUNT(*) as count FROM scan_results")
                total_scans_row = await cur.fetchone()
                total_scans = total_scans_row["count"] if total_scans_row else 0
                
                # Total Good IPs found
                await cur.execute("SELECT COUNT(*) as count FROM scan_results WHERE status = 'ok'")
                total_good_row = await cur.fetchone()
                total_good = total_good_row["count"] if total_good_row else 0
                
                # 7-Day Timeline Data
                await cur.execute("""
                    SELECT DATE(timestamp) as date, 
                           COUNT(*) as total_scans, 
                           SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as successful_scans 
                    FROM scan_results 
                    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
                    GROUP BY DATE(timestamp)
                    ORDER BY date ASC
                """)
                timeline_rows = await cur.fetchall()
                # Format dates to string for JSON serialization
                timeline_data = []
                for row in timeline_rows:
                    timeline_data.append({
                        "date": row["date"].strftime("%Y-%m-%d") if row["date"] else "Unknown",
                        "total_scans": int(row["total_scans"]) if row["total_scans"] is not None else 0,
                        "successful_scans": int(row["successful_scans"]) if row["successful_scans"] is not None else 0
                    })

                return {
                    "top_datacenters": top_datacenters,
                    "top_ports": top_ports,
                    "network_types": network_types,
                    "total_scans": total_scans,
                    "total_good": total_good,
                    "timeline_data": timeline_data
                }
    except Exception as e:
        print(f"DB Analytics Error: {e}")
        return {}
