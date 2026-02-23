from fastapi import FastAPI, BackgroundTasks, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio
import uuid
from typing import List, Dict, Optional
import json
import os
import time
import random

from scanner import scan_ip, parse_vless
from cf_ips import update_cf_ranges
from core_manager import download_xray, APP_DIR
import aiohttp
import socket

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

class Settings(BaseModel):
    concurrency: int = 10
    stop_after: int = 10
    max_ping: int = 1000
    max_jitter: int = 500
    min_download: float = 0.1
    min_upload: float = 0.1
    ip_version: str = 'ipv4'

SETTINGS_FILE = os.path.join(APP_DIR, 'settings.json')

def load_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                return Settings(**json.load(f))
    except:
        pass
    return Settings()

def save_settings(settings: Settings):
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings.dict(), f, indent=2)
    except:
        pass

class ScanRequest(BaseModel):
    vless_config: str
    manual_ips: Optional[List[str]] = []
    ip_count: int = 10
    concurrency: int = 10
    ip_version: str = 'ipv4'
    stop_after: int = 10
    ip_source: str = 'official'
    custom_url: Optional[str] = None
    domains: Optional[List[str]] = None
    max_ping: int = 1500
    max_jitter: int = 500
    min_download: float = 0.1
    min_upload: float = 0.1
    test_ports: Optional[List[int]] = None
    verify_tls: bool = False
    target_country: Optional[str] = None
    use_system_proxy: bool = False

class FetchConfigRequest(BaseModel):
    url: str

class ProxyDbRequest(BaseModel):
    vless_config: str

class ExportRequest(BaseModel):
    format: Optional[str] = "base64"
    vless_config: str
    ips: List[str]

active_scans = {}
results = {}

# --- Debug Log System ---
import sys
from datetime import datetime as _dt
from collections import deque

# Fix Windows encoding for PyInstaller noconsole mode
try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

_debug_logs = deque(maxlen=200)

def dlog(msg):
    """Write to both console and in-memory debug log."""
    ts = _dt.now().strftime('%H:%M:%S')
    entry = f"[{ts}] {msg}"
    try:
        print(entry)
    except (UnicodeEncodeError, OSError):
        try:
            print(entry.encode('ascii', errors='replace').decode('ascii'))
        except Exception:
            pass
    _debug_logs.append(entry)

@app.get('/debug-logs')
def get_debug_logs():
    return {"logs": list(_debug_logs)}

# ─── Startup ───
@app.on_event('startup')
async def startup_event():
    dlog("═══ STARTUP BEGIN ═══")
    dlog(f"Python: {sys.executable}")
    dlog(f"Frozen: {getattr(sys, 'frozen', False)}")
    dlog(f"CWD: {os.getcwd()}")
    
    # Check SSL
    import ssl
    dlog(f"SSL default verify: {ssl.get_default_verify_paths()}")
    cert_file = os.environ.get('SSL_CERT_FILE', 'NOT SET')
    dlog(f"SSL_CERT_FILE: {cert_file}")
    if cert_file != 'NOT SET':
        dlog(f"  exists: {os.path.exists(cert_file)}")
    
    # Check .env loading
    dlog(f"DB_HOST: {'SET' if os.environ.get('DB_HOST') else 'EMPTY'}")
    dlog(f"VITE_FALLBACK_CONFIG: {'SET (' + os.environ.get('VITE_FALLBACK_CONFIG','')[:30] + '...)' if os.environ.get('VITE_FALLBACK_CONFIG') else 'EMPTY'}")
    
    # Test raw internet
    dlog("Testing internet connectivity...")
    try:
        import socket
        sock = socket.create_connection(("1.1.1.1", 80), timeout=3)
        sock.close()
        dlog("✅ Raw socket to 1.1.1.1:80 → OK")
    except Exception as e:
        dlog(f"❌ Raw socket to 1.1.1.1:80 → {e}")
    
    try:
        import socket
        sock = socket.create_connection(("1.1.1.1", 443), timeout=3)
        sock.close()
        dlog("✅ Raw socket to 1.1.1.1:443 → OK")
    except Exception as e:
        dlog(f"❌ Raw socket to 1.1.1.1:443 → {e}")
    
    # Test HTTPS
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5, verify=True) as client:
            resp = await client.get("https://1.1.1.1/cdn-cgi/trace")
            dlog(f"✅ HTTPS 1.1.1.1 → {resp.status_code}")
    except Exception as e:
        dlog(f"❌ HTTPS 1.1.1.1 → {type(e).__name__}: {e}")
    
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5, verify=False) as client:
            resp = await client.get("https://1.1.1.1/cdn-cgi/trace")
            dlog(f"✅ HTTPS (no-verify) 1.1.1.1 → {resp.status_code}")
    except Exception as e:
        dlog(f"❌ HTTPS (no-verify) 1.1.1.1 → {type(e).__name__}: {e}")

    download_xray()
    import db
    await db.init_db()
    
    # If direct DB failed, try auto-proxy fallback
    if db.pool is None:
        dlog("⚠️ Direct DB connection failed. Attempting auto-proxy fallback...")
        fallback_config = os.environ.get('VITE_FALLBACK_CONFIG', '')
        if fallback_config and fallback_config.startswith('vless://'):
            try:
                from db_proxy import start_db_tunnel
                from scanner import parse_vless
                vless_parts = parse_vless(fallback_config)
                start_db_tunnel(vless_parts)
                await asyncio.sleep(3)  # Give Xray tunnel time to establish
                success = await db.reconnect_db('127.0.0.1', 33060)
                if success:
                    db.db_via_proxy = True
                    dlog("✅ Database connected via VLESS proxy tunnel!")
                else:
                    dlog("❌ Proxy tunnel started but DB reconnection failed.")
            except Exception as e:
                dlog(f"❌ Auto-proxy fallback failed: {e}")
        else:
            dlog("⚠️ No VITE_FALLBACK_CONFIG in .env — cannot auto-proxy.")
    else:
        dlog("✅ Database connected directly!")
    
    dlog("═══ STARTUP COMPLETE ═══")
    asyncio.create_task(update_cf_ranges_periodic())
    asyncio.create_task(run_autopilot_scheduler())

async def run_autopilot_scheduler():
    while True:
        await asyncio.sleep(43200) # Wait 12 hours between headless runs
        try:
            from export import export_base64
            # Grab latest 20 good IPs from db
            import db
            top_ips = db.get_dashboard_stats().get("recent_good", [])
            if top_ips:
                ips = [row["ip"] for row in top_ips]
                settings = load_settings()
                # Dummy config structure for export, using a basic fallback if we don't store the user's vless
                fallback_parts = {
                    "protocol": "vless",
                    "uuid": "auto-pilot",
                    "port": 443,
                    "params": {"security": "tls", "type": "ws", "path": "/", "host": "update.me"}
                }
                content = export_base64(ips, fallback_parts)
                with open(os.path.join(APP_DIR, "latest_subscription.txt"), "w") as f:
                    f.write(content)
        except Exception as e:
            print(f"Autopilot Background Error: {e}")

async def update_cf_ranges_periodic():
    while True:
        try:
            update_cf_ranges()
        except:
            pass
        await asyncio.sleep(86400) # Once a day

print("DEBUG: Registering GET settings")
@app.get('/settings')
def get_settings():
    return load_settings().dict()

print("DEBUG: Registering POST settings")
@app.post('/settings')
def update_settings(settings: Settings):
    save_settings(settings)
    return {'status': 'ok'}
print("DEBUG: Successfully registered POST settings")

@app.get('/health')
async def check_health():
    import db
    db_status = "offline"
    internet_status = "offline"
    internet_err = ""
    db_err = ""
    
    # Check general internet (HTTP-based, more firewall-friendly)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get("https://1.1.1.1/cdn-cgi/trace")
            if resp.status_code == 200:
                internet_status = "online"
    except Exception:
        # Fallback to raw socket
        try:
            import socket
            sock = socket.create_connection(("1.1.1.1", 53), timeout=2)
            sock.close()
            internet_status = "online"
        except Exception as e:
            internet_err = str(e)
        
    # Check DB
    try:
        if db.pool:
            async with asyncio.timeout(3.0):
                async with db.pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SELECT 1")
                    db_status = "online"
        else:
            db_status = "offline"
            db_err = "Pool is not initialized. ISP may have blocked initial connection."
    except asyncio.TimeoutError:
        db_status = "offline"
        db_err = "Database connection timed out (ISP Blocked)."
    except Exception as e:
        db_status = "offline"
        db_err = str(e)
        
    return {
        "internet": internet_status,
        "internet_error": internet_err,
        "database": db_status,
        "database_error": db_err,
        "via_proxy": db.db_via_proxy
    }

class ProxyDbRequest(BaseModel):
    vless_config: str

@app.post('/proxy-db')
async def proxy_db(req: ProxyDbRequest):
    import db
    from db_proxy import start_db_tunnel
    from scanner import parse_vless
    try:
        vless_parts = parse_vless(req.vless_config)
        start_db_tunnel(vless_parts)
        await asyncio.sleep(2) # Give Xray time to boot up the tunnel
        
        # Reconnect DB through local dokodemo-door
        success = await db.reconnect_db('127.0.0.1', 33060)
        if success:
            db.db_via_proxy = True
            return {"status": "ok", "message": "Database tunneled successfully"}
        else:
            return {"status": "error", "message": "Tunnel started but DB reconnection failed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get('/my-ip')
async def get_my_ip(proxy: str = '0'):
    use_proxy = proxy == '1'
    try:
        import aiohttp
        import traceback
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Host': 'ip-api.com'}
        async with aiohttp.ClientSession(trust_env=use_proxy) as session:
            async with session.get('http://208.95.112.1/json/', headers=headers, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {
                        'ip': data.get('query', 'Unknown'),
                        'location': f"{data.get('country', '')} - {data.get('city', '')}",
                        'isp': data.get('isp', 'Unknown')
                    }
                else:
                    print(f"ip-api.com returned status {resp.status}")
    except Exception as e:
        print(f"Error fetching IP: {e}")
    return {'ip': 'Unknown', 'location': 'Unknown', 'isp': 'Unknown'}

import aiodns
import pycares
from discovery import batch_resolve_domains, scrape_builtwith_domains, get_advanced_ips

import base64

@app.post('/fetch-config')
async def fetch_config(req: FetchConfigRequest, proxy: str = '0'):
    """Fetch subscription configs. Tries proxy first, then direct, to handle ISP blocks."""
    
    async def _try_fetch(trust_env):
        async with aiohttp.ClientSession(trust_env=trust_env) as session:
            async with session.get(req.url, timeout=10) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    try:
                        decoded = base64.b64decode(text).decode('utf-8')
                        text = decoded
                    except:
                        pass
                    
                    vless_links = []
                    for line in text.splitlines():
                        line = line.strip()
                        if line.startswith('vless://'):
                            vless_links.append(line)
                            
                    if vless_links:
                        return {'configs': vless_links}
                    else:
                        return {'error': 'No VLESS configs found in the link.'}
                else:
                    return {'error': f'Failed to fetch config. Status code: {resp.status}'}

    # Always try with system proxy first (VPN), then direct if proxy fails
    for trust in [True, False]:
        try:
            result = await _try_fetch(trust)
            if result and 'configs' in result:
                return result
        except Exception as e:
            print(f"fetch-config attempt (trust_env={trust}) failed: {e}")
            continue
    
    return {'error': 'Could not reach subscription URL. Check your internet connection or enable the System Proxy toggle.'}

@app.post('/export')
async def handle_export(req: ExportRequest):
    from export import export_base64, export_clash, export_singbox
    try:
        vless_parts = parse_vless(req.vless_config)
    except Exception as e:
        return {'error': f'Invalid config: {str(e)}'}

    try:
        if req.format == 'base64':
            return {'content': export_base64(req.ips, vless_parts)}
        elif req.format == 'clash':
            return {'content': export_clash(req.ips, vless_parts)}
        elif req.format == 'singbox':
            return {'content': export_singbox(req.ips, vless_parts)}
        else:
            return {'error': 'Unsupported format'}
    except Exception as e:
        return {'error': str(e)}

export_links = {}

@app.post('/export-link')
async def create_export_link(req: ExportRequest):
    link_id = str(uuid.uuid4())
    from export import export_base64
    try:
        vless_parts = parse_vless(req.vless_config)
        content = export_base64(req.ips, vless_parts)
        export_links[link_id] = content
        return {"link_id": link_id}
    except Exception as e:
        return {"error": str(e)}

from fastapi.responses import PlainTextResponse

@app.get('/sub/{link_id}')
async def get_subscription(link_id: str):
    if link_id in export_links:
        return PlainTextResponse(export_links[link_id])
    return PlainTextResponse("Subscription not found or expired.", status_code=404)


@app.post('/scan')
async def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    current_settings = Settings(
        concurrency=req.concurrency,
        stop_after=req.stop_after,
        max_ping=req.max_ping,
        max_jitter=req.max_jitter,
        min_download=req.min_download,
        min_upload=req.min_upload,
        ip_version=req.ip_version
    )
    save_settings(current_settings)

    scan_id = str(uuid.uuid4())
    try:
        vless_parts = parse_vless(req.vless_config)
    except Exception as e:
        return {'error': f'Invalid config: {str(e)}'}
    
    active_scans[scan_id] = {
        'status': 'running', 
        'total': req.ip_count, 
        'completed': 0, 
        'found_good': 0, 
        'logs': [],
        'stats': {
            'scanned': 0,
            'high_ping': 0,
            'high_jitter': 0,
            'low_download': 0,
            'low_upload': 0,
            'timeout': 0,
            'unreachable': 0,
            'compromised': 0,
            'error': 0
        }
    }
    results[scan_id] = []
    
    if req.manual_ips and len(req.manual_ips) > 0:
        import ipaddress
        
        expanded_ips = []
        for item in req.manual_ips:
            item = item.strip()
            if not item: continue
            
            if '/' in item:
                try:
                    net = ipaddress.ip_network(item, strict=False)
                    for ip in net:
                        expanded_ips.append(str(ip))
                except:
                    pass
            elif sum([c.isalpha() for c in item]) > 0 and '.' in item:
                try:
                    _, _, ips = socket.gethostbyname_ex(item)
                    expanded_ips.extend(ips)
                    add_log(scan_id, f'Resolved domain {item} to {len(ips)} IPs.')
                except Exception as e:
                    add_log(scan_id, f'Failed to resolve domain {item}: {e}')
            else:
                expanded_ips.append(item)
        
        if len(expanded_ips) > 100:
            random.shuffle(expanded_ips)
            
        ips_source = expanded_ips 
        active_scans[scan_id]['total'] = len(ips_source)
    else:
        ips_source = None
        active_scans[scan_id]['total'] = req.ip_count
    
    background_tasks.add_task(start_scan_job_wrapper, scan_id, ips_source, vless_parts, req)
    
    return {'scan_id': scan_id}

async def start_scan_job_wrapper(scan_id, ips_source, vless_parts, req):
    user_info = await get_my_ip()
    await run_scan_job(scan_id, ips_source, vless_parts, req, user_info)

async def enrich_ip_data(ip, use_proxy=False):
    try:
        headers = {'Host': 'ip-api.com'}
        async with aiohttp.ClientSession(trust_env=use_proxy) as session:
            async with session.get(f"http://208.95.112.1/json/{ip}?fields=country,countryCode,city,isp,as", headers=headers, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    asn = data.get('as', 'Unknown').split(' ')[0] if data.get('as') else 'Unknown'
                    return {
                        "location": f"{data.get('country', '')} - {data.get('city', '')} ({data.get('isp', '')})",
                        "asn": asn,
                        "countryCode": data.get('countryCode', '')
                    }
    except:
        pass
    return {"location": "Unknown", "asn": "Unknown", "countryCode": ""}

def add_log(scan_id, message):
    if scan_id in active_scans:
        logs = active_scans[scan_id]['logs']
        timestamp = time.strftime('%H:%M:%S')
        logs.append(f'[{timestamp}] {message}')
        if len(logs) > 100:
            active_scans[scan_id]['logs'] = logs[-100:]

async def run_scan_job(scan_id, ips_static, vless_parts, req, user_info):
    try:
        thresholds = {
            'max_ping': req.max_ping, 
            'max_jitter': req.max_jitter,
            'min_download': req.min_download,
            'min_upload': req.min_upload
        }
        
        from cf_ips import get_smart_ip, report_good_ip, SmartIPGenerator, fetch_custom_ips
        from db import save_scan_result
        
        custom_generator = None
        if not ips_static and getattr(req, 'ip_source', 'official') in ['custom_url', 'auto_scrape', 'community_scrape']:
            add_log(scan_id, f'Fetching IPs for source: {req.ip_source}...')
            if req.ip_source in ['community_scrape', 'custom_url']:
                custom_ranges = await get_advanced_ips(req, getattr(req, 'use_system_proxy', False))
            else:
                custom_ranges = await fetch_custom_ips(req.ip_source, getattr(req, 'custom_url', None))
            
            if custom_ranges:
                add_log(scan_id, f'Loaded {len(custom_ranges)} subnets/IPs from custom source.')
                custom_generator = SmartIPGenerator(custom_ranges=custom_ranges)
            else:
                add_log(scan_id, 'Failed to load custom IPs. Falling back to Official Cloudflare IPs.')
        elif not ips_static and getattr(req, 'ip_source', 'official') == 'smart_history':
            from db import get_historical_good_ips
            add_log(scan_id, 'Fetching Smart History from DB based on your ISP/Location...')
            db_ips = await get_historical_good_ips(user_info.get('isp'), user_info.get('location'), limit=100)
            if db_ips:
                add_log(scan_id, f'Loaded {len(db_ips)} historically proven IPs for your network!')
                ips_static = db_ips
                target_count = len(ips_static)
                mode_name = 'Smart History'
            else:
                add_log(scan_id, 'No history found for your ISP. Falling back to Smart Discovery...')
        elif not ips_static and getattr(req, 'ip_source', 'official') == 'community_gold':
            from db import get_community_good_ips
            loc_str = user_info.get('location', 'Unknown')
            country = loc_str.split('-')[0].strip() if '-' in loc_str else ''
            
            add_log(scan_id, f'Fetching Community Gold IPs for {country} / {user_info.get("isp")}...')
            db_ips = await get_community_good_ips(country, user_info.get('isp'), limit=150)
            if db_ips:
                add_log(scan_id, f'Loaded {len(db_ips)} globally verified IPs for your region!')
                ips_static = db_ips
                target_count = len(ips_static)
                mode_name = 'Community Gold'
            else:
                add_log(scan_id, 'No Community Gold IPs found. Falling back to Smart Discovery...')
        elif not ips_static and getattr(req, 'ip_source', 'official') == 'gold_ips':
            from db import get_historical_good_ips
            from cf_ips import get_gold_domains
            add_log(scan_id, 'Fetching Gold IPs (Smart History + BuiltWith Top Domains for your country)...')
            
            db_ips = await get_historical_good_ips(user_info.get('isp'), user_info.get('location'), limit=50)
            
            loc_str = user_info.get('location', 'Unknown')
            country = loc_str.split('-')[0].strip() if '-' in loc_str else loc_str
            gold_domains = await scrape_builtwith_domains(country)
            
            db_ips = db_ips or []
            gold_domains = gold_domains or []
            add_log(scan_id, f'Found {len(db_ips)} History IPs and {len(gold_domains)} Gold domains for {country}.')
            
            expanded_gold_ips = gold_domains
                        
            ips_static = list(set(db_ips + expanded_gold_ips))
            if ips_static:
                random.shuffle(ips_static)
                target_count = len(ips_static)
                mode_name = 'Gold IPs'
            else:
                add_log(scan_id, 'No Gold IPs found, falling back to Smart Discovery...')
                
        discovery_sem = asyncio.Semaphore(req.concurrency * 5)
        speed_sem = asyncio.Semaphore(req.concurrency) 
        
        good_ips_count = 0
        scanned_count = 0
        
        if ips_static and req.test_ports:
            new_static = [(ip, pt) for ip in ips_static for pt in req.test_ports]
            ips_static = new_static

        if ips_static:
            target_count = len(ips_static)
            mode_name = 'Manual'
        else:
            target_count = 100000
            mode_name = 'Smart Discovery'
        
        add_log(scan_id, f'Started scan. Goal: Find {req.stop_after} Good IPs. Threads: {req.concurrency}. Mode: {mode_name}')
        
        running_tasks = set()
        
        async def bounded_scan(ip, t_port=None):
            nonlocal good_ips_count
            
            while active_scans[scan_id]['status'] == 'paused':
                await asyncio.sleep(0.5)
                
            if active_scans[scan_id]['status'] != 'running': return
            
            async with discovery_sem:
                port_str = f":{t_port}" if t_port else ""
                add_log(scan_id, f'Checking {ip}{port_str}...')
                res = await scan_ip(ip, vless_parts, thresholds, speed_sem, test_port=t_port, verify_tls=req.verify_tls, check_status_cb=lambda: active_scans[scan_id]['status'])
                
                if res['status'] == 'abort':
                    return
                
                while active_scans[scan_id]['status'] == 'paused':
                    await asyncio.sleep(0.5)
                
                if active_scans[scan_id]['status'] != 'running': return
                
                if 'stats' in active_scans[scan_id]:
                    stats = active_scans[scan_id]['stats']
                    stats['scanned'] += 1
                    
                    status_key = res['status']
                    if status_key == 'ok':
                        pass 
                    elif status_key == 'high_ping':
                        stats['high_ping'] += 1
                    elif status_key == 'high_jitter':
                        stats['high_jitter'] += 1
                    elif status_key == 'low_download':
                        stats['low_download'] += 1
                    elif status_key == 'low_upload':
                        stats['low_upload'] += 1
                    elif status_key == 'unreachable':
                        stats['unreachable'] += 1
                    elif status_key == 'timeout':
                        stats['timeout'] += 1
                    elif status_key == 'compromised':
                        stats['compromised'] += 1
                    else:
                        stats['error'] += 1

                is_good = res['status'] == 'ok'
                
                if is_good:
                    enriched = await enrich_ip_data(ip, getattr(req, 'use_system_proxy', False))
                    
                    if req.target_country and enriched['countryCode'].upper() != req.target_country.upper():
                        is_good = False
                        res['status'] = 'wrong_geo'
                        add_log(scan_id, f"Rejected {ip}: Wrong Geo ({enriched['countryCode']})")
                    else:
                        add_log(scan_id, f"GOOD IP FOUND: {ip} (Ping: {res['ping']}ms, DL: {res['download']}Mbps)")
                        if custom_generator:
                            custom_generator.report_success(ip)
                        else:
                            report_good_ip(ip)
                        
                        res['location'] = enriched['location']
                        res['asn'] = enriched['asn']
                        good_ips_count += 1
                        active_scans[scan_id]['found_good'] = good_ips_count
                else:
                    add_log(scan_id, f"Failed {ip}: {res['status']}")
                
                asyncio.create_task(save_scan_result({
                    'user_ip': user_info.get('ip'),
                    'user_location': user_info.get('location'),
                    'user_isp': user_info.get('isp'),
                    'vless_uuid': vless_parts.get('uuid'),
                    'scanned_ip': ip,
                    'ip_source': getattr(req, 'ip_source', 'official') if not ips_static else (getattr(req, 'ip_source', 'manual')),
                    'ping': res['ping'],
                    'jitter': res['jitter'],
                    'download': res['download'],
                    'upload': res['upload'],
                    'status': res['status'],
                    'datacenter': res.get('datacenter', 'Unknown'),
                    'asn': res.get('asn', 'Unknown'),
                    'network_type': vless_parts.get('params', {}).get('type', 'Unknown'),
                    'sni': vless_parts.get('params', {}).get('sni', 'Unknown'),
                    'port': t_port if t_port else vless_parts.get('port', -1),
                    'app_version': '1.0.0'
                }))

                results[scan_id].append(res)
                active_scans[scan_id]['completed'] += 1
                
                if good_ips_count >= req.stop_after:
                    add_log(scan_id, 'Limit reached. Stopping scan.')
                    active_scans[scan_id]['status'] = 'completed'

        while active_scans[scan_id]['status'] in ['running', 'paused']:
            if good_ips_count >= req.stop_after: break
            if scanned_count >= target_count: break
            
            if active_scans[scan_id]['status'] == 'paused':
                await asyncio.sleep(0.5)
                continue
            
            while len(running_tasks) < req.concurrency * 5 and scanned_count < target_count:
                if active_scans[scan_id]['status'] != 'running': break
                
                if ips_static:
                    item = ips_static[scanned_count]
                    if isinstance(item, tuple):
                        ip, t_port = item
                    else:
                        ip, t_port = item, None
                else:
                    if custom_generator:
                        ip = custom_generator.get_next_ip(req.ip_version)
                    else:
                        ip = get_smart_ip(req.ip_version)
                    t_port = req.test_ports[scanned_count % len(req.test_ports)] if req.test_ports else None
                    
                task = asyncio.create_task(bounded_scan(ip, t_port))
                running_tasks.add(task)
                task.add_done_callback(running_tasks.discard)
                scanned_count += 1
                
            if not running_tasks:
                break
                
            await asyncio.sleep(0.1)
            
        if running_tasks:
            await asyncio.gather(*running_tasks)
        
        active_scans[scan_id]['status'] = 'completed'
        add_log(scan_id, 'Scan finished.')
        
        try:
            os.makedirs('results', exist_ok=True)
            good_results = [r for r in results[scan_id] if r['status'] == 'ok']
            if good_results:
                with open(f"results/scan_{scan_id}.json", 'w') as f:
                    json.dump(good_results, f, indent=2)
        except:
            pass

    except Exception as e:
        import traceback
        err_msg = f"Fatal Scan Error: {str(e)}\n{traceback.format_exc()}"
        print(err_msg)
        add_log(scan_id, f"CRITICAL ERROR: {str(e)}")
        active_scans[scan_id]['status'] = 'failed'

@app.get('/scan/{scan_id}')
def get_scan_status(scan_id: str):
    if scan_id not in active_scans:
        return {'error': 'Scan not found'}
    
    all_results = results[scan_id]
    valid_results = [r for r in all_results if r.get('status') == 'ok']
    
    return {
        'status': active_scans[scan_id],
        'results': sorted(valid_results, key=lambda x: x.get('ping', 9999))
    }

@app.post('/scan/{scan_id}/pause')
def pause_scan(scan_id: str):
    if scan_id in active_scans and active_scans[scan_id]['status'] == 'running':
        active_scans[scan_id]['status'] = 'paused'
        return {'status': 'ok'}
    return {'error': 'Cannot pause'}

@app.post('/scan/{scan_id}/resume')
def resume_scan(scan_id: str):
    if scan_id in active_scans and active_scans[scan_id]['status'] == 'paused':
        active_scans[scan_id]['status'] = 'running'
        return {'status': 'ok'}
    return {'error': 'Cannot resume'}

@app.post('/scan/{scan_id}/stop')
def stop_scan(scan_id: str):
    if scan_id in active_scans:
        active_scans[scan_id]['status'] = 'stopped'
        return {'status': 'ok'}
    return {'error': 'Cannot stop'}

class UsageLogRequest(BaseModel):
    event_type: str
    details: str = ''

@app.post('/log-usage')
async def log_usage_endpoint(payload: UsageLogRequest):
    user_info = await get_my_ip()
    from db import log_usage_event
    await log_usage_event(
        user_info.get('ip'), 
        user_info.get('location'), 
        user_info.get('isp'), 
        payload.event_type, 
        payload.details
    )
    return {'status': 'ok'}

class ScanAdvancedRequest(BaseModel):
    vless_config: str
    target_ip: str
    mode: str # 'fragment' or 'sni'
    fragment_lengths: Optional[List[str]] = []
    fragment_intervals: Optional[List[str]] = []
    test_snis: Optional[List[str]] = []
    concurrency: int = 5
    max_ping: int = 2000

@app.post('/scan-advanced')
def start_advanced_scan(req: ScanAdvancedRequest, background_tasks: BackgroundTasks):
    scan_id = str(uuid.uuid4())
    try:
        vless_parts = parse_vless(req.vless_config)
    except Exception as e:
        return {'error': f'Invalid config: {str(e)}'}
    
    items_to_test = []
    if req.mode == 'fragment':
        for flen in req.fragment_lengths:
            for fint in req.fragment_intervals:
                items_to_test.append({"fragment": {"length": flen, "interval": fint}, "test_sni": None, "id": f"Frag: {flen} / {fint}"})
    elif req.mode == 'sni':
        for sni in req.test_snis:
            sni = sni.strip()
            if sni:
                items_to_test.append({"fragment": None, "test_sni": sni, "id": f"SNI: {sni}"})
            
    active_scans[scan_id] = {
        'status': 'running', 
        'total': len(items_to_test), 
        'completed': 0, 
        'found_good': 0, 
        'logs': [f"[{time.strftime('%H:%M:%S')}] Started Advanced {req.mode.upper()} Scanner against IP: {req.target_ip}"],
        'stats': {
            'scanned': 0, 'high_ping': 0, 'high_jitter': 0, 
            'low_download': 0, 'low_upload': 0, 'timeout': 0, 
            'unreachable': 0, 'error': 0
        }
    }
    results[scan_id] = []
    
    background_tasks.add_task(run_advanced_scan_job, scan_id, req.target_ip, vless_parts, req, items_to_test)
    return {'scan_id': scan_id}

async def run_advanced_scan_job(scan_id, target_ip, vless_parts, req, items_to_test):
    from scanner import scan_ip
    thresholds = {
        'max_ping': req.max_ping,
        'max_jitter': 10000,
        'min_download': 0,
        'min_upload': 0
    }
    
    speed_sem = asyncio.Semaphore(req.concurrency)
    running_tasks = set()
    scanned_count = 0
    total_items = len(items_to_test)
    
    async def bounded_advanced_scan(index):
        item = items_to_test[index]
        add_log(scan_id, f"Testing {item['id']}...")
        res = await scan_ip(target_ip, vless_parts, thresholds, speed_sem, test_port=None, fragment=item['fragment'], test_sni=item['test_sni'])
        
        stat_key = res.get('fail_reason')
        if stat_key and stat_key in active_scans[scan_id]['stats']:
            active_scans[scan_id]['stats'][stat_key] += 1
            
        active_scans[scan_id]['stats']['scanned'] += 1
        
        if res['status'] == 'ok':
            active_scans[scan_id]['found_good'] += 1
            add_log(scan_id, f"✅ SUCCESS => {item['id']} | Ping: {res['ping']}ms")
            
        res['tested_config'] = item['id']
        results[scan_id].append(res)
        active_scans[scan_id]['completed'] += 1

    try:
        while active_scans[scan_id]['status'] == 'running' and scanned_count < total_items:
            while len(running_tasks) < req.concurrency and scanned_count < total_items:
                task = asyncio.create_task(bounded_advanced_scan(scanned_count))
                running_tasks.add(task)
                task.add_done_callback(running_tasks.discard)
                scanned_count += 1
            await asyncio.sleep(0.1)
            
        if running_tasks:
            await asyncio.gather(*running_tasks)
            
        active_scans[scan_id]['status'] = 'completed'
        add_log(scan_id, 'Advanced Scan finished.')
    except Exception as e:
        add_log(scan_id, f"CRITICAL ERROR: {str(e)}")
        active_scans[scan_id]['status'] = 'failed'

@app.get('/analytics')
async def get_analytics_endpoint():
    from db import get_analytics
    data = await get_analytics()
    return data

@app.get('/analytics/geo')
async def get_geo_analytics_endpoint():
    from db import get_geo_analytics
    data = await get_geo_analytics()
    return data

# --- WARP SCANNER ROUTES ---
class WarpScanRequest(BaseModel):
    concurrency: int = 50
    stop_after: int = 20
    max_ping: int = 800
    test_ports: List[int] = [2408, 1701, 500, 4500]

active_warp_scans = {}
warp_results = {}

@app.post('/scan-warp')
async def start_warp_scan(req: WarpScanRequest, background_tasks: BackgroundTasks):
    scan_id = str(uuid.uuid4())
    active_warp_scans[scan_id] = {'status': 'running', 'completed': 0, 'found_good': 0, 'logs': []}
    warp_results[scan_id] = []
    
    background_tasks.add_task(run_warp_job, scan_id, req)
    return {'scan_id': scan_id}

@app.get('/scan-warp/{scan_id}')
def get_warp_scan_status(scan_id: str):
    if scan_id not in active_warp_scans: return {'error': 'not found'}
    return {
        'status': active_warp_scans[scan_id],
        'results': warp_results[scan_id]
    }

@app.post('/scan-warp/{scan_id}/stop')
def stop_warp_scan(scan_id: str):
    if scan_id in active_warp_scans: active_warp_scans[scan_id]['status'] = 'stopped'
    return {'status': 'stopped'}

async def run_warp_job(scan_id, req):
    from warp_scanner import scan_warp_ip
    from cf_ips import get_smart_ip
    
    sem = asyncio.Semaphore(req.concurrency)
    def wlog(msg): active_warp_scans[scan_id]['logs'].append(msg)
    
    wlog("Starting WARP Endpoint Scanner...")
    
    async def process_ip(ip, port):
        if active_warp_scans[scan_id]['status'] != 'running': return
        async with sem:
            active_warp_scans[scan_id]['completed'] += 1
            res = await scan_warp_ip(ip, port)
            if res['status'] == 'ok' and res['ping'] <= req.max_ping:
                active_warp_scans[scan_id]['found_good'] += 1
                warp_results[scan_id].append(res)
                wlog(f"Found clean WARP endpoint: {res['endpoint']} ({res['ping']}ms, {res['datacenter']})")
                
                if active_warp_scans[scan_id]['found_good'] >= req.stop_after:
                    active_warp_scans[scan_id]['status'] = 'completed'
                    
    tasks = []
    # Test up to 5000 random IPs
    for _ in range(5000):
        if active_warp_scans[scan_id]['status'] != 'running': break
        ip = get_smart_ip()
        port = random.choice(req.test_ports)
        tasks.append(asyncio.create_task(process_ip(ip, port)))
        
        # Batch concurrency execution
        if len(tasks) > 50:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            tasks = list(pending)
            
    if tasks: await asyncio.gather(*tasks)
    if active_warp_scans[scan_id]['status'] == 'running':
        active_warp_scans[scan_id]['status'] = 'completed'
    wlog("WARP Scan job finished.")

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8000)
