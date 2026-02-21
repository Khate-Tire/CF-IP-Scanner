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
    max_ping: int = 1500
    max_jitter: int = 500
    min_download: float = 0.1
    min_upload: float = 0.1
    test_ports: Optional[List[int]] = []
    verify_tls: bool = False

class FetchConfigRequest(BaseModel):
    url: str

active_scans = {}
results = {}

@app.on_event('startup')
async def startup_event():
    download_xray()
    import db
    await db.init_db()
    asyncio.create_task(update_cf_ranges_periodic())

async def update_cf_ranges_periodic():
    while True:
        try:
            update_cf_ranges()
        except:
            pass
        await asyncio.sleep(86400) # Once a day

@app.get('/settings')
def get_settings():
    return load_settings().dict()

@app.post('/settings')
def update_settings(settings: Settings):
    save_settings(settings)
    return {'status': 'ok'}

@app.get('/my-ip')
async def get_my_ip():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://ip-api.com/json/', timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {
                        'ip': data.get('query', 'Unknown'),
                        'location': f"{data.get('country', '')} - {data.get('city', '')}",
                        'isp': data.get('isp', 'Unknown')
                    }
    except:
        pass
    return {'ip': 'Unknown', 'location': 'Unknown', 'isp': 'Unknown'}

import base64

@app.post('/fetch-config')
async def fetch_config(req: FetchConfigRequest):
    try:
        async with aiohttp.ClientSession() as session:
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
    except Exception as e:
        return {'error': str(e)}

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

async def enrich_ip_data(ip):
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://ip-api.com/json/{ip}?fields=country,city,isp,as", timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    asn = data.get('as', 'Unknown').split(' ')[0] if data.get('as') else 'Unknown'
                    return {
                        "location": f"{data.get('country', '')} - {data.get('city', '')} ({data.get('isp', '')})",
                        "asn": asn
                    }
    except:
        pass
    return {"location": "Unknown", "asn": "Unknown"}

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
        if not ips_static and getattr(req, 'ip_source', 'official') in ['custom_url', 'auto_scrape']:
            add_log(scan_id, f'Fetching IPs for source: {req.ip_source}...')
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
            gold_domains = await get_gold_domains(country)
            
            add_log(scan_id, f'Found {len(db_ips)} History IPs and {len(gold_domains)} Gold domains for {country}.')
            
            expanded_gold_ips = []
            if gold_domains:
                for domain in gold_domains[:100]:
                    try:
                        _, _, ips = await asyncio.to_thread(socket.gethostbyname_ex, domain)
                        expanded_gold_ips.extend(ips)
                        add_log(scan_id, f'Resolved {domain} to {len(ips)} IPs.')
                    except Exception as e:
                        add_log(scan_id, f'Failed {domain}: {type(e).__name__}')
                        pass
                        
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
            if active_scans[scan_id]['status'] != 'running': return
            
            async with discovery_sem:
                port_str = f":{t_port}" if t_port else ""
                add_log(scan_id, f'Checking {ip}{port_str}...')
                res = await scan_ip(ip, vless_parts, thresholds, speed_sem, test_port=t_port, verify_tls=req.verify_tls)
                
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
                    add_log(scan_id, f"GOOD IP FOUND: {ip} (Ping: {res['ping']}ms, DL: {res['download']}Mbps)")
                    if custom_generator:
                        custom_generator.report_success(ip)
                    else:
                        report_good_ip(ip)
                    
                    enriched = await enrich_ip_data(ip)
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

        while active_scans[scan_id]['status'] == 'running':
            if good_ips_count >= req.stop_after: break
            if scanned_count >= target_count: break
            
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
