import asyncio
import httpx
import base64
import json
import os
from datetime import datetime
import db
from scanner import parse_vless, parse_config, scan_ip
from core_manager import APP_DIR
import uuid

class PlayFreedomState:
    status = "idle"
    phase = "Idle"
    logs = []
    found_configs = {
        "sub": [],
        "sub_cf": [],
        "spliced": [],
        "mined_clean_ips": 0
    }
    active_scanner_id = None
    _stop_signal = False
    waiting_for_config = False
    user_provided_config = None

state = PlayFreedomState()

def push_log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    state.logs.insert(0, f"[{ts}] {msg}")
    if len(state.logs) > 50:
        state.logs.pop()

async def fetch_and_decode_subs(url):
    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                text = resp.text.strip()
                try:
                    decoded = base64.b64decode(text).decode('utf-8', errors='ignore')
                except:
                    decoded = text
                configs = [l.strip() for l in decoded.split('\n') if l.strip().startswith(('vless://', 'vmess://', 'trojan://'))]
                return configs
    except Exception as e:
        push_log(f"Error fetching {url}: {e}")
    return []

async def test_config(config_str, target_ip=None):
    if state._stop_signal:
        return None
    try:
        parsed = parse_config(config_str)
        if parsed.get('uuid') == 'invalid':
            return None
            
        ip_to_test = target_ip if target_ip else parsed['address']
        
        # Test with very relaxed thresholds to just find working ones
        thresholds = {
            "max_ping": 3000,
            "max_jitter": 2000,
            "min_download": 0,
            "min_upload": 0
        }
        
        res = await scan_ip(
            ip_to_test, 
            parsed, 
            thresholds,
            verify_tls=False
        )
        if res.get('status') == 'ok':
            return res
    except Exception:
        pass
    return None

async def run_play_freedom_loop():
    state.status = "running"
    state.logs = []
    state._stop_signal = False
    
    # Standard Admin APIs (from env)
    admin_api = os.environ.get('ADMIN_API_URL', '')
    SUB_URL = f"{admin_api}/sub" if admin_api else ""
    SUB_CF_URL = f"{admin_api}/sub/cf" if admin_api else ""
    
    try:
        # ----------------------------------------------------
        # PHASE 1: Vanilla Sub
        # ----------------------------------------------------
        state.phase = "Phase 1: Testing Direct /sub Configs"
        push_log(f"Fetching /sub ...")
        vanilla_configs = await fetch_and_decode_subs(SUB_URL)
        # Offline fallback for vanilla configs
        if not vanilla_configs:
            try:
                cache_path = os.path.join(APP_DIR, 'offline_admin_vanilla_configs.json')
                if os.path.exists(cache_path):
                    with open(cache_path, 'r') as f:
                        vanilla_configs = json.load(f)
                    push_log(f"Using {len(vanilla_configs)} cached vanilla configs (offline)")
            except Exception:
                pass
        push_log(f"Found {len(vanilla_configs)} configs in /sub. Testing native connections...")
        
        for idx, cfg in enumerate(vanilla_configs):
            if state._stop_signal: return
            push_log(f"Testing /sub config {idx + 1}/{len(vanilla_configs)}... ")
            res = await test_config(cfg)
            if res:
                push_log(f"✅ WORKING /sub: Ping {res['ping']}ms, DL {res['download']} Mbps")
                state.found_configs["sub"].append(res['link'])

        # ----------------------------------------------------
        # PHASE 2: CF Sub
        # ----------------------------------------------------
        state.phase = "Phase 2: Testing /sub/cf Configs"
        push_log(f"Fetching /sub/cf ...")
        cf_configs = await fetch_and_decode_subs(SUB_CF_URL)
        # Offline fallback for CF configs
        if not cf_configs:
            try:
                cache_path = os.path.join(APP_DIR, 'offline_admin_configs.json')
                if os.path.exists(cache_path):
                    with open(cache_path, 'r') as f:
                        cf_configs = json.load(f)
                    push_log(f"Using {len(cf_configs)} cached CF configs (offline)")
            except Exception:
                pass
        push_log(f"Found {len(cf_configs)} configs in /sub/cf. Testing native connections...")
        
        for idx, cfg in enumerate(cf_configs):
            if state._stop_signal: return
            push_log(f"Testing /sub/cf config {idx + 1}/{len(cf_configs)}... ")
            res = await test_config(cfg)
            if res:
                push_log(f"✅ WORKING /sub/cf: Ping {res['ping']}ms, DL {res['download']} Mbps")
                state.found_configs["sub_cf"].append(res['link'])

        # ----------------------------------------------------
        # PHASE 3: Splice Clean IPs into CF Configs
        # ----------------------------------------------------
        state.phase = "Phase 3: Splicing DB IPs into /sub/cf Configs"
        # Fetch clean IPs from DB
        clean_ips = []
        try:
            pool = getattr(db, 'pool', None)
            if pool:
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SELECT DISTINCT scanned_ip FROM scan_results WHERE status='ok' ORDER BY download DESC LIMIT 20")
                        rows = await cur.fetchall()
                        clean_ips = [r[0] for r in rows]
            elif getattr(db, 'local_db', None):
                import aiosqlite
                async with aiosqlite.connect(db.local_db.path) as ldb:
                    cur = await ldb.execute("SELECT DISTINCT scanned_ip FROM scan_results WHERE status='ok' ORDER BY download DESC LIMIT 20")
                    rows = await cur.fetchall()
                    clean_ips = [r[0] for r in rows]
        except Exception as e:
            push_log(f"Error fetching DB IPs: {e}")
            
        push_log(f"Loaded {len(clean_ips)} clean IPs from DB.")
        
        if cf_configs and clean_ips:
            # We will try the first 3 CF configs with top 10 nice IPs (30 permutations) to save time
            base_cf_configs = cf_configs[:3]
            splice_ips = clean_ips[:10]
            
            for cfg in base_cf_configs:
                for target_ip in splice_ips:
                    if state._stop_signal: return
                    push_log(f"Testing spliced IP {target_ip} on config...")
                    res = await test_config(cfg, target_ip=target_ip)
                    if res:
                        push_log(f"🚀 UNBLOCKABLE COMBO FOUND ({target_ip}): Ping {res['ping']}ms, DL {res['download']}")
                        state.found_configs["spliced"].append(res['link'])
                        
        # ----------------------------------------------------
        # PHASE 4: Continuous Mining Loop
        # ----------------------------------------------------
        state.phase = "Phase 4: Continuous Clean IP Mining"
        
        # Determine the best config to use for scanning (only CF configs work for mining)
        master_config = None
        if state.found_configs["spliced"]:
            master_config = state.found_configs["spliced"][0]
        elif state.found_configs["sub_cf"]:
            master_config = state.found_configs["sub_cf"][0]
            
        if not master_config:
            push_log("⚠️ No working configs found automatically. Please provide a working VLESS config to continue mining.")
            state.waiting_for_config = True
            state.user_provided_config = None
            state.phase = "Waiting for User Config"
            # Wait until user provides a config or stop is requested
            while not state._stop_signal and not state.user_provided_config:
                await asyncio.sleep(1)
            if state._stop_signal:
                return
            master_config = state.user_provided_config
            state.waiting_for_config = False
            state.user_provided_config = None
            push_log(f"✅ User provided config received. Resuming mining...")
            
        push_log("Starting standard background IP Scanner loop using best config.")
        from main import active_scans, run_scan_job, get_my_ip
        
        while not state._stop_signal:
            scan_id = str(uuid.uuid4())
            state.active_scanner_id = scan_id
            
            req = type('Req', (object,), {
                'vless_config': master_config,
                'ip_count': 50,
                'manual_ips': "",
                'stop_after': 9999,
                'concurrency': 20,
                'max_ping': 800,
                'max_jitter': 400,
                'min_download': 0,
                'min_upload': 0,
                'ip_version': 4,
                'ip_source': 'cf_subnets',
                'custom_url': ''
            })()
            
            # Setup active scan tracker locally
            active_scans[scan_id] = {
                'id': scan_id,
                'status': 'running',
                'completed': 0,
                'total': 50,
                'found_good': 0,
                'start_time': time.time(),
                'stop_requested': False
            }
            
            push_log("Mining batch started...")
            
            import time
            from cf_ips import get_random_cf_ips
            ips_to_test = get_random_cf_ips(50, 4)
            
            # Parse the master config
            vless_parts = parse_config(master_config)
            user_info = await get_my_ip()
            
            await run_scan_job(scan_id, ips_to_test, vless_parts, req, user_info)
            
            # Record results
            if scan_id in active_scans:
                good_found = active_scans[scan_id]['found_good']
                state.found_configs["mined_clean_ips"] += good_found
                push_log(f"Batch complete. Mined {good_found} clean IPs. Total minted: {state.found_configs['mined_clean_ips']}")
            
            await asyncio.sleep(2)
            
    except Exception as e:
        push_log(f"Fatal Engine Error: {e}")
        state.status = "error"
        state.phase = "Crashed"
        
    finally:
        state.status = "stopped"
        if state.phase != "Crashed" and state.phase != "Failed":
             state.phase = "Idle"
