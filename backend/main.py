# Copyright (c) 2026 Taher AkbariSaeed
from fastapi import FastAPI, BackgroundTasks, WebSocket, Request, Response, UploadFile, File, Body
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
from datetime import datetime

from scanner import scan_ip, parse_vless, parse_config, test_config, quick_test_ip, speed_test_ip, reconstruct_config
from cf_ips import update_cf_ranges
from core_manager import download_xray, APP_DIR
import aiohttp
import socket

from freedom_engine import run_play_freedom_loop, state as freedom_state

app = FastAPI()

# CORS lockdown: only allow localhost origins (dev Vite + Electron renderer).
# Electron with loadFile() sends Origin: null, so we also allow that exact value
# via allow_origin_regex. We do NOT use allow_origins=['*'] because the API
# binds to 127.0.0.1 and any browser tab the user opens could otherwise
# call our endpoints from a malicious page.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
    ],
    allow_origin_regex=r'^(null|file://.*|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?)$',
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


def _bg_task(coro, name=None):
    """Wrap asyncio.create_task so unhandled exceptions are logged instead of
    swallowed silently. Without this, a crashed background task leaves the
    server running in a degraded state with no diagnostic."""
    task = asyncio.create_task(coro, name=name)
    def _on_done(t):
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            try:
                dlog(f"[bg-task {name or t.get_name()}] crashed: {type(exc).__name__}: {exc}")
            except Exception:
                # dlog might not be defined yet at module-import time; fall back to print.
                print(f"[bg-task {name or t.get_name()}] crashed: {type(exc).__name__}: {exc}")
    task.add_done_callback(_on_done)
    return task

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

from local_queue import load_unfinished_scans, update_scan_status_db, create_scan_task

async def _load_unfinished_scans_on_startup():
    try:
        unfinished = await load_unfinished_scans()
        for row in unfinished:
            scan_id = row['scan_id']
            # Rehydrate the in-memory state so frontend sees it immediately on reload
            active_scans[scan_id] = {
                'status': row['status'],
                'total': row['total'],
                'completed': row['completed'],
                'found_good': row['found_good'],
                'logs': json.loads(row['logs']) if row['logs'] else [],
                'stats': json.loads(row['stats']) if row['stats'] else {}
            }
            results[scan_id] = json.loads(row['results']) if row['results'] else []
            # Note: the actual background scan logic is complex to re-initiate because we need the raw `req` objects. 
            # We restore the state so users can view results and see it as 'paused'. They can restart manually.
    except Exception as e:
        print(f"Failed to load unfinished scans: {e}")

async def sync_queue_db(scan_id):
    """Periodically takes the ultra-fast memory dictionary and persists it to SQLite queue"""
    while True:
        s = active_scans.get(scan_id)
        if not s or s.get('status') not in ('running', 'paused'):
            break
        try:
            await update_scan_status_db(
                scan_id, s['status'], s.get('total', 0), s.get('completed', 0),
                s.get('found_good', 0), s.get('logs', []), s.get('stats', {}), results.get(scan_id, [])
            )
        except Exception as e:
            print(f"[sync_queue_db] {scan_id} error: {e}")
        await asyncio.sleep(2)

    # Final sync when finished or failed
    s = active_scans.get(scan_id)
    if s:
        try:
            await update_scan_status_db(
                scan_id, s['status'], s.get('total', 0), s.get('completed', 0),
                s.get('found_good', 0), s.get('logs', []), s.get('stats', {}), results.get(scan_id, [])
            )
        except Exception as e:
            print(f"[sync_queue_db] {scan_id} final-sync error: {e}")

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

# Global: store the VLESS config that successfully connected to DB
_working_vless_config = None

@app.get('/working-config')
def get_working_config():
    return {"config": _working_vless_config or ""}

@app.get('/api/gamification/status')
async def get_gamification_status(request: Request):
    """Returns the user's progress towards unlocking VIP and Free Configs"""
    try:
        import httpx
        ip = "unknown"
        isp = "Unknown ISP"
        client_id = request.headers.get('x-client-id', 'unknown')
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get('http://ip-api.com/json?fields=query,isp')
                if res.status_code == 200:
                    data = res.json()
                    ip = data.get('query', 'unknown')
                    isp = data.get('isp', 'Unknown ISP')
        except Exception as e:
            pass
        
        # Call db.py functions mapped to the worker
        import db
        total_scans = await db.get_user_contributions(ip, isp, client_id)
        recent_scans = await db.get_recent_contributions(ip, isp, client_id)
        
        return {
            "success": True,
            "total_scans": total_scans,
            "recent_scans": recent_scans,
            "has_scanned_recently": recent_scans >= 10,  # 10 scans required in last 3 days
            "vip_unlocked": total_scans >= 10000
        }
    except Exception as e:
        dlog(f"Error fetching gamification status: {e}")
        return {"success": False, "error": str(e)}

@app.get('/api/free-configs')
async def get_free_configs():
    """Fetches free configs from Admin Panel and injects user's best IPs"""
    import httpx
    try:
        ip = "unknown"
        isp = "Unknown ISP"
        location = "Unknown"
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get('http://ip-api.com/json?fields=query,isp,country')
                if res.status_code == 200:
                    data = res.json()
                    ip = data.get('query', 'unknown')
                    isp = data.get('isp', 'Unknown ISP')
                    location = data.get('country', 'Unknown')
        except:
            pass

        # Import the correct function from db module
        import db as db_module
        get_best_ips = db_module.get_historical_good_ips
            
        # 1. Fetch raw community configs
        admin_api = os.environ.get('ADMIN_API_URL', '')
        lines = []
        try:
            if not admin_api:
                raise ValueError("ADMIN_API_URL not configured")
            async with httpx.AsyncClient(timeout=10, verify=False) as client:
                resp = await client.get(f"{admin_api}/sub/cf")
                if resp.status_code == 200:
                    import base64
                    text = resp.text.strip()
                    try:
                        decoded = base64.b64decode(text).decode('utf-8', errors='ignore')
                    except:
                        decoded = text
                    lines = [l.strip() for l in decoded.split('\n') if l.strip().startswith(('vless://', 'vmess://', 'trojan://', 'ss://'))]
        except Exception as e:
            pass
            
        # Fallback to imported offline cache
        if not lines:
            admin_cache_file = os.path.join(APP_DIR, 'offline_admin_configs.json')
            if os.path.exists(admin_cache_file):
                import json
                with open(admin_cache_file, 'r') as f:
                    lines = json.load(f)
                    
        if not lines:
            return {"success": False, "error": "Admin server unreachable and no offline cache available."}
            
        raw_configs = [{"id": i, "config_string": l, "source": "Community"} for i, l in enumerate(lines)]
        
        # 2. Fetch User's personal best historical Cloudflare IPs
        try:
            best_ips = await get_best_ips(isp, location, limit=len(raw_configs))
        except Exception as e:
            dlog(f"Error fetching best historical IPs: {e}")
            best_ips = []
        
        if not best_ips:
            # Fallback to standard Cloudflare IPs if user has no scan history
            best_ips = ["engage.cloudflareclient.com", "icook.tw", "zula.ir", "varzesh3.com", "104.17.3.81"]
            
        # 3. Dynamic Injection Engine
        injected_configs = []
        
        for i, row in enumerate(raw_configs):
            config_str = row['config_string']
            if config_str.startswith('vless://') or config_str.startswith('vmess://') or config_str.startswith('trojan://'):
                # Pick an IP from the user's best pool (round robin)
                clean_ip = best_ips[i % len(best_ips)]
                
                # Simple string replacement for the primary address field (before the port)
                # Proper parsing is better, but this works for standard share links
                try:
                    parts = config_str.split('@')
                    if len(parts) == 2:
                        domain_port_rest = parts[1]
                        domain_end = domain_port_rest.find(':')
                        if domain_end != -1:
                            original_domain = domain_port_rest[:domain_end]
                            new_config = config_str.replace(f"@{original_domain}:", f"@{clean_ip}:")
                            
                            # Append 'Cleaned by Antigravity' to the remark name
                            import urllib.parse
                            if '#' in new_config:
                                name_parts = new_config.split('#')
                                new_name = urllib.parse.unquote(name_parts[1]) + f" ⚡ [{clean_ip}]"
                                new_config = name_parts[0] + '#' + urllib.parse.quote(new_name)
                            else:
                                new_config += f"#Community ⚡ [{clean_ip}]"
                                
                            injected_configs.append({
                                "id": row['id'],
                                "original": config_str,
                                "injected": new_config,
                                "source": row['source'],
                                "clean_ip": clean_ip
                            })
                            continue
                except:
                    pass
            # Fallback if injection parsing fails
            injected_configs.append({"id": row['id'], "original": config_str, "injected": config_str, "source": row['source'], "clean_ip": "Original"})

        return {"success": True, "configs": injected_configs}
        
    except Exception as e:
        dlog(f"Error fetching/injecting free configs: {e}")
        return {"success": False, "error": str(e)}

# ─── Mix & Test: Community Configs × User IPs ───────────────────────────────
mix_test_jobs = {}

@app.post('/api/community/mix-and-test')
async def start_mix_test(background_tasks: BackgroundTasks):
    """Start a mix-and-test job: fetch CF configs, combine with user's found IPs, test all, rank top 10."""
    job_id = str(uuid.uuid4())
    mix_test_jobs[job_id] = {
        "status": "starting",
        "phase": "fetching",
        "progress": 0,
        "total": 0,
        "tested": 0,
        "results": [],
        "top10": [],
        "done": False,
        "error": None,
        "config_count": 0,
        "ip_count": 0
    }
    background_tasks.add_task(_run_mix_test_job, job_id)
    return {"success": True, "job_id": job_id}

@app.get('/api/community/mix-status/{job_id}')
async def get_mix_status(job_id: str):
    """Poll mix-and-test job progress."""
    if job_id not in mix_test_jobs:
        return {"success": False, "error": "Job not found"}
    return {"success": True, **mix_test_jobs[job_id]}


async def _run_mix_test_job(job_id: str):
    """Background task: fetch configs, fetch user IPs, mix, test in 2 phases, rank top 10."""
    import httpx
    job = mix_test_jobs[job_id]
    try:
        job["phase"] = "fetching"
        job["status"] = "running"

        # ── Step 1: Fetch top 5 CF configs by speed from admin panel ──
        admin_api = os.environ.get('ADMIN_API_URL', '')
        config_lines = []
        total_cf_configs = 0
        try:
            if not admin_api:
                raise ValueError("ADMIN_API_URL not configured")
            async with httpx.AsyncClient(timeout=10, verify=False) as client:
                # Fetch full config details with speed info
                resp = await client.get(f"{admin_api}/api/configs/free", params={"status": "working", "is_cf": "1", "limit": 200})
                if resp.status_code == 200:
                    data = resp.json()
                    configs_with_speed = data.get("configs", [])
                    total_cf_configs = data.get("total", len(configs_with_speed))
                    # Sort by download_speed descending, take top 5
                    configs_with_speed.sort(key=lambda c: c.get("download_speed", 0), reverse=True)
                    top5 = configs_with_speed[:5]
                    config_lines = [c["config_string"] for c in top5 if c.get("config_string")]
                    dlog(f"[MixTest] {total_cf_configs} total CF configs, picked top {len(config_lines)} by speed")
        except Exception as e:
            dlog(f"[MixTest] Admin API fetch failed: {e}")

        # Fallback: try /sub/cf base64 endpoint
        if not config_lines:
            try:
                async with httpx.AsyncClient(timeout=10, verify=False) as client:
                    resp = await client.get(f"{admin_api}/sub/cf")
                    if resp.status_code == 200:
                        import base64
                        text = resp.text.strip()
                        try:
                            decoded = base64.b64decode(text).decode('utf-8', errors='ignore')
                        except:
                            decoded = text
                        all_lines = [l.strip() for l in decoded.split('\n')
                                        if l.strip().startswith(('vless://', 'vmess://', 'trojan://'))]
                        total_cf_configs = len(all_lines)
                        config_lines = all_lines[:5]
            except Exception as e:
                dlog(f"[MixTest] Sub/cf fallback failed: {e}")

        # Fallback to offline cache
        if not config_lines:
            admin_cache_file = os.path.join(APP_DIR, 'offline_admin_configs.json')
            if os.path.exists(admin_cache_file):
                with open(admin_cache_file, 'r') as f:
                    cached = json.load(f)
                    total_cf_configs = len(cached)
                    config_lines = cached[:5]

        if not config_lines:
            job["error"] = "No community configs available from admin panel."
            job["done"] = True
            job["status"] = "error"
            return

        job["config_count"] = total_cf_configs

        # ── Step 2: Get user's best found IPs ──
        import db as db_module
        user_ips = []
        try:
            ip_info = {"isp": "Unknown", "location": "Unknown"}
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    res = await client.get('http://ip-api.com/json?fields=isp,country')
                    if res.status_code == 200:
                        data = res.json()
                        ip_info["isp"] = data.get('isp', 'Unknown')
                        ip_info["location"] = data.get('country', 'Unknown')
            except:
                pass
            user_ips = await db_module.get_historical_good_ips(ip_info["isp"], ip_info["location"], limit=15)
        except Exception as e:
            dlog(f"[MixTest] DB fetch failed: {e}")

        # Also extract original IPs from the config templates
        original_ips = []
        parsed_configs = []
        for cfg_str in config_lines:
            try:
                parts = parse_config(cfg_str)
                parsed_configs.append((cfg_str, parts))
                orig_ip = parts.get("address", "")
                if orig_ip and orig_ip not in ("127.0.0.1", "invalid", ""):
                    original_ips.append(orig_ip)
            except:
                pass

        if not parsed_configs:
            job["error"] = "Failed to parse any community configs."
            job["done"] = True
            job["status"] = "error"
            return

        # Combine: user IPs + original IPs (deduplicated), take top 3
        all_ips = list(dict.fromkeys(user_ips + original_ips))  # preserve order, dedup
        if not all_ips:
            # Fallback defaults
            all_ips = ["engage.cloudflareclient.com", "icook.tw", "104.17.3.81"]

        # Top 3 IPs only
        all_ips = all_ips[:3]
        job["ip_count"] = len(all_ips)

        # ── Step 3: Create all combos ──
        combos = []
        for cfg_str, parts in parsed_configs:
            for ip in all_ips:
                combos.append((cfg_str, parts, ip))

        total_combos = len(combos)
        job["total"] = total_combos
        job["phase"] = "quick_test"
        dlog(f"[MixTest] {len(parsed_configs)} configs × {len(all_ips)} IPs = {total_combos} combos")

        # ── Phase 1: Quick ping test (8 concurrent, ~10s each) ──
        quick_results = []
        sem = asyncio.Semaphore(8)

        async def run_quick(combo_idx, cfg_str, parts, ip):
            async with sem:
                try:
                    r = await asyncio.wait_for(
                        quick_test_ip(parts, ip),
                        timeout=15
                    )
                    r["config_str"] = cfg_str
                    r["combo_idx"] = combo_idx
                    return r
                except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                    return {"ip": ip, "ping": -1, "jitter": -1, "connected": False,
                            "config_str": cfg_str, "combo_idx": combo_idx}

        tasks = [run_quick(i, cfg, parts, ip) for i, (cfg, parts, ip) in enumerate(combos)]

        for coro in asyncio.as_completed(tasks):
            r = await coro
            quick_results.append(r)
            job["tested"] = len(quick_results)
            job["progress"] = round(len(quick_results) / total_combos * 50)  # 0-50%

        # Filter to connected, sort by ping
        connected = [r for r in quick_results if r.get("connected") and r.get("ping", -1) > 0]
        connected.sort(key=lambda x: x["ping"])

        if not connected:
            job["error"] = "No configs could connect. Check your internet or try again."
            job["done"] = True
            job["status"] = "error"
            return

        dlog(f"[MixTest] Phase 1 done: {len(connected)}/{total_combos} connected")

        # ── Phase 2: Speed test top 15 candidates (4 concurrent) ──
        job["phase"] = "speed_test"
        top_candidates = connected[:15]
        speed_results = []
        speed_sem = asyncio.Semaphore(4)

        async def run_speed(candidate):
            async with speed_sem:
                cfg_str = candidate["config_str"]
                ip = candidate["ip"]
                try:
                    parts = parse_config(cfg_str)
                    r = await asyncio.wait_for(
                        speed_test_ip(parts, ip),
                        timeout=45
                    )
                    r["config_str"] = cfg_str
                    r["config_link"] = reconstruct_config(parts, ip)
                    return r
                except (asyncio.TimeoutError, asyncio.CancelledError, Exception) as e:
                    dlog(f"[MixTest] Speed test error for {ip}: {type(e).__name__}")
                    return {"ip": ip, "ping": candidate.get("ping", -1),
                            "jitter": candidate.get("jitter", -1),
                            "download": 0, "upload": 0, "connected": False,
                            "config_str": cfg_str, "config_link": reconstruct_config(parse_config(cfg_str), ip) if cfg_str else ""}

        speed_tasks = [run_speed(c) for c in top_candidates]
        for coro in asyncio.as_completed(speed_tasks):
            r = await coro
            speed_results.append(r)
            done_count = len(quick_results) + len(speed_results)
            total_work = total_combos + len(top_candidates)
            job["progress"] = 50 + round(len(speed_results) / len(top_candidates) * 50)  # 50-100%

        # ── Step 4: Rank and pick top 10 ──
        scored = []
        for r in speed_results:
            if not r.get("connected") or r.get("download", 0) <= 0:
                continue
            # Quality score: higher is better
            dl = r.get("download", 0)
            ul = r.get("upload", 0)
            ping = r.get("ping", 999)
            jitter = r.get("jitter", 999)
            score = (dl * 3) + (ul * 1) - (ping * 0.3) - (jitter * 0.5)
            scored.append({
                "ip": r["ip"],
                "ping": r.get("ping", -1),
                "jitter": r.get("jitter", -1),
                "download": r.get("download", 0),
                "upload": r.get("upload", 0),
                "datacenter": r.get("datacenter", "Unknown"),
                "config_link": r.get("config_link", ""),
                "config_str": r.get("config_str", ""),
                "score": round(score, 2)
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        top10 = scored[:10]

        job["top10"] = top10
        job["results"] = scored
        job["phase"] = "done"
        job["progress"] = 100
        job["done"] = True
        job["status"] = "completed"
        dlog(f"[MixTest] Complete: {len(scored)} scored, top10 ready")

    except Exception as e:
        dlog(f"[MixTest] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        job["error"] = str(e)
        job["done"] = True
        job["status"] = "error"


async def _try_tunnel_with_config(vless_config, db_module):
    """Try to tunnel DB through a single VLESS config. Returns True if DB connected."""
    from db_proxy import start_db_tunnel, stop_db_tunnel
    from scanner import parse_config
    try:
        stop_db_tunnel()  # Kill any existing tunnel
        vless_parts = parse_config(vless_config)
        start_db_tunnel(vless_parts)
        await asyncio.sleep(3)
        success = await db_module.reconnect_db('127.0.0.1', 33060)
        if success:
            return True
        stop_db_tunnel()
        return False
    except Exception as e:
        dlog(f"  Tunnel attempt failed: {e}")
        try: stop_db_tunnel()
        except: pass
        return False

async def _fetch_subscription_configs(sub_url):
    """Fetch VLESS configs from a subscription URL."""
    import httpx, base64
    configs = []
    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.get(sub_url)
            if resp.status_code == 200:
                text = resp.text.strip()
                # Try base64 decode
                try:
                    decoded = base64.b64decode(text).decode('utf-8', errors='ignore')
                    lines = decoded.strip().split('\n')
                except Exception:
                    lines = text.strip().split('\n')
                configs = [l.strip() for l in lines if l.strip().startswith('vless://')]
                dlog(f"  Fetched {len(configs)} VLESS configs from subscription")
    except Exception as e:
        dlog(f"  Failed to fetch subscription: {type(e).__name__}: {e}")
    return configs

# --- Startup ---
@app.on_event('startup')
async def startup_event():
    dlog("=== STARTUP BEGIN (fast) ===")
    dlog(f"Python: {sys.executable}")
    dlog(f"Frozen: {getattr(sys, 'frozen', False)}")
    dlog(f"CWD: {os.getcwd()}")

    # IMPORTANT: never block startup on network. download_xray() reaches out to
    # GitHub, which is frequently blocked by Iranian ISPs. Doing it inline here
    # used to leave the splash stuck on "Starting engine..." for minutes because
    # FastAPI hadn't started serving /health yet. Run it in a thread so the
    # event loop comes up immediately; the scanner re-checks get_xray_path()
    # before each scan and surfaces a clear error if it's still missing.
    asyncio.get_event_loop().run_in_executor(None, download_xray)

    # Load unfinished scans from queue — DO NOT await. On a fresh DB or slow
    # disk this can take a few hundred ms and used to delay /health
    # accepting connections, leaving the splash stuck on "Starting engine...".
    _bg_task(_load_unfinished_scans_on_startup(), name='load_unfinished_scans')

    # Launch heavy DB/network work as background task so server starts immediately
    _bg_task(_background_init(), name='background_init')
    _bg_task(update_cf_ranges_periodic(), name='update_cf_ranges_periodic')
    _bg_task(run_autopilot_scheduler(), name='autopilot_scheduler')
    dlog("=== SERVER READY (DB connecting in background) ===")

async def _background_init():
    """Heavy init work that runs AFTER the server is already listening."""
    global _working_vless_config
    await asyncio.sleep(0.5)  # Let the server fully start
    
    # Check SSL
    import ssl
    cert_file = os.environ.get('SSL_CERT_FILE', 'NOT SET')
    dlog(f"SSL_CERT_FILE: {cert_file} (exists: {os.path.exists(cert_file) if cert_file != 'NOT SET' else 'N/A'})")
    
    # Check .env loading
    dlog(f"DB_HOST: {'SET' if os.environ.get('DB_HOST') else 'EMPTY'}")
    dlog(f"VITE_FALLBACK_CONFIG: {'SET' if os.environ.get('VITE_FALLBACK_CONFIG') else 'EMPTY'}")
    dlog(f"VITE_AUTO_SUB_URL: {'SET' if os.environ.get('VITE_AUTO_SUB_URL') else 'EMPTY'}")
    
    # Test internet
    dlog("Testing internet connectivity...")
    try:
        import socket
        sock = socket.create_connection(("1.1.1.1", 80), timeout=3)
        sock.close()
        dlog("[OK] Raw socket to 1.1.1.1:80")
    except Exception as e:
        dlog(f"[FAIL] Raw socket to 1.1.1.1:80: {e}")
    
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5, verify=False) as client:
            resp = await client.get("https://1.1.1.1/cdn-cgi/trace")
            dlog(f"[OK] HTTPS 1.1.1.1 -> {resp.status_code}")
    except Exception as e:
        dlog(f"[FAIL] HTTPS 1.1.1.1: {type(e).__name__}: {e}")

    # Init DB
    import db
    await db.init_db()
    
    # === Smart DB Fallback Chain (5 Layers) ===
    # Layer 5 (offline) always initializes as safety net
    db.local_db = db.LocalSQLiteDB()
    await db.local_db.init()
    dlog("[OK] Local SQLite offline cache initialized.")

    if db.pool is not None:
        db.db_mode = "direct"
        dlog("[OK] Layer 1: Database connected directly!")
    else:
        dlog("[!] Layer 1: Direct DB connection failed. Starting fallback chain...")
        
        # Layer 2: Cloudflare Worker proxy (HTTPS API)
        if db.WORKER_URL:
            dlog("Layer 2: Trying Cloudflare Worker proxy...")
            try:
                proxy = db.WorkerDBProxy()
                if await proxy.health():
                    db.worker_proxy = proxy
                    db.db_mode = "worker"
                    dlog("[OK] Layer 2: DB connected via Cloudflare Worker!")
            except Exception as e:
                dlog(f"[FAIL] Layer 2: Worker proxy failed: {e}")

        # Layer 3: Worker via clean IP (domain fronting)
        if db.db_mode == "disconnected" and db.WORKER_URL:
            dlog("Layer 3: Trying Worker via domain fronting with clean IPs...")
            # Read known-good IPs from local scan history
            try:
                good_ips = await db.local_db.get_historical_good_ips("", "", limit=10)
                if not good_ips:
                    # Try some well-known Cloudflare IPs as last resort
                    good_ips = ["104.16.132.229", "104.17.209.9", "172.67.182.1", "104.21.48.1"]
                for ip in good_ips[:5]:
                    try:
                        proxy = db.WorkerDBProxy(clean_ip=ip)
                        test = await proxy._post("/api/health", {})
                        if test:
                            db.worker_proxy = proxy
                            db.db_mode = "worker_fronted"
                            dlog(f"[OK] Layer 3: DB connected via Worker + clean IP {ip}!")
                            break
                    except:
                        continue
            except Exception as e:
                dlog(f"[FAIL] Layer 3: Domain fronting failed: {e}")
        
        # Layer 4: VLESS Tunnel (existing logic)
        if db.db_mode == "disconnected":
            # Step 4a: Try locally saved recent working configs
            history_file = os.path.join(APP_DIR, 'latest_working_configs.json')
            if os.path.exists(history_file):
                dlog("Layer 4a: Trying previously successful configs from recent scans...")
                try:
                    with open(history_file, 'r') as f:
                        history = json.load(f)
                    for i, cfg in enumerate(history):
                        short = cfg[:50] + '...' if len(cfg) > 50 else cfg
                        dlog(f"  Testing past config {i+1}/{len(history)}: {short}")
                        if await _try_tunnel_with_config(cfg, db):
                            db.db_via_proxy = True
                            db.db_mode = "tunnel"
                            _working_vless_config = cfg
                            dlog("[OK] Layer 4a: DB connected via previously successful scan config!")
                            break
                except Exception as e:
                    dlog(f"Layer 4a Error: {e}")
            else:
                dlog("Layer 4a: No recent working configs found, skipping.")
            
            # Step 4b: Try configs from VITE_AUTO_SUB_URL (subscription)
            if db.db_mode == "disconnected":
                sub_url = os.environ.get('VITE_AUTO_SUB_URL', '')
                if sub_url:
                    dlog("Layer 4b: Fetching configs from VITE_AUTO_SUB_URL...")
                    configs = await _fetch_subscription_configs(sub_url)
                    for i, cfg in enumerate(configs[:5]):
                        short = cfg[:50] + '...' if len(cfg) > 50 else cfg
                        dlog(f"  Testing config {i+1}/{min(len(configs), 5)}: {short}")
                        if await _try_tunnel_with_config(cfg, db):
                            db.db_via_proxy = True
                            db.db_mode = "tunnel"
                            _working_vless_config = cfg
                            dlog(f"[OK] Layer 4b: DB connected via subscription config #{i+1}!")
                            break
                else:
                    dlog("Layer 4b: No VITE_AUTO_SUB_URL set, skipping.")
                
            # Step 4c: Try VITE_FALLBACK_CONFIG (hardcoded in build)
            if db.db_mode == "disconnected":
                fallback_config = os.environ.get('VITE_FALLBACK_CONFIG', '')
                if fallback_config and fallback_config.startswith('vless://'):
                    dlog("Layer 4c: Trying VITE_FALLBACK_CONFIG...")
                    if await _try_tunnel_with_config(fallback_config, db):
                        db.db_via_proxy = True
                        db.db_mode = "tunnel"
                        _working_vless_config = fallback_config
                        dlog("[OK] Layer 4c: DB connected via fallback config!")
                    else:
                        dlog("[FAIL] Layer 4c: Fallback config did not work.")
                else:
                    dlog("Layer 4c: No VITE_FALLBACK_CONFIG set, skipping.")
        
        # Layer 5: Local SQLite offline mode (already initialized)
        if db.db_mode == "disconnected":
            db.db_mode = "offline"
            dlog("[!] All remote DB attempts failed. Running in OFFLINE mode (Layer 5: SQLite).")
            dlog("    Scan results will be cached locally and synced when connection is restored.")
    
    dlog(f"=== BACKGROUND INIT COMPLETE === (db_mode: {db.db_mode})")

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

@app.get('/ping')
async def ping():
    """Liveness probe used by the splash screen. Must NEVER do I/O — it
    only confirms that the FastAPI event loop is up and accepting requests.
    The splash hangs were caused by the frontend probing /health, which
    does network calls that stall for seconds when the ISP blocks the
    internet."""
    return {"ok": True}

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
        
    # Check DB — considers all layers
    try:
        if db.pool:
            async with asyncio.timeout(3.0):
                async with db.pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SELECT 1")
                    db_status = "online"
        elif db.worker_proxy:
            db_status = "online"
        elif db.db_mode == "offline":
            db_status = "offline_local"
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
        "via_proxy": db.db_via_proxy,
        "db_mode": db.db_mode
    }

@app.get('/db-status')
async def get_db_status():
    import db
    mode_labels = {
        "direct": "🟢 Direct MySQL",
        "worker": "🔵 Cloudflare Worker",
        "worker_fronted": "🟣 Worker + Clean IP",
        "tunnel": "🟡 VLESS Tunnel",
        "offline": "🟠 Offline (Local SQLite)",
        "disconnected": "🔴 Disconnected"
    }
    return {
        "mode": db.db_mode,
        "label": mode_labels.get(db.db_mode, "Unknown"),
        "has_pool": db.pool is not None,
        "has_worker": db.worker_proxy is not None,
        "has_local": db.local_db is not None,
        "via_proxy": db.db_via_proxy
    }

@app.get('/db-test-all')
async def test_all_db_layers():
    import db
    import time
    import asyncio
    import aiomysql
    
    results = {
        "layer1_direct": {"status": "testing", "time": 0},
        "layer2_worker": {"status": "testing", "time": 0},
        "layer3_fronted": {"status": "testing", "time": 0},
        "layer4_tunnel": {"status": "standby", "time": 0},
        "layer5_local": {"status": "testing", "time": 0},
        "active_mode": db.db_mode
    }
    
    # Layer 1: Direct MySQL
    start = time.time()
    try:
        async with asyncio.timeout(3.0):
            conn = await aiomysql.connect(host=db.DB_HOST, port=db.DB_PORT, user=db.DB_USER, password=db.DB_PASSWORD, db=db.DB_NAME)
            await conn.ping()
            conn.close()
            results["layer1_direct"] = {"status": "online", "time": round((time.time() - start) * 1000)}
    except Exception:
        results["layer1_direct"] = {"status": "offline", "time": round((time.time() - start) * 1000)}

    # Layer 2: Cloudflare Worker
    start = time.time()
    if db.WORKER_URL:
        try:
            proxy = db.WorkerDBProxy()
            if await proxy.health():
                results["layer2_worker"] = {"status": "online", "time": round((time.time() - start) * 1000)}
            else:
                results["layer2_worker"] = {"status": "offline", "time": round((time.time() - start) * 1000)}
        except Exception:
            results["layer2_worker"] = {"status": "offline", "time": round((time.time() - start) * 1000)}
    else:
        results["layer2_worker"] = {"status": "skipped", "time": 0}

    # Layer 3: Worker Domain Fronting (using a common clean IP)
    start = time.time()
    if db.WORKER_URL:
        if "workers.dev" in db.WORKER_URL:
            results["layer3_fronted"] = {"status": "skipped", "time": 0, "reason": "Requires custom domain"}
        else:
            try:
                proxy = db.WorkerDBProxy(clean_ip="104.16.132.229")
                # For testing domain fronting, directly use health endpoint but via _post style or custom if health fails
                import httpx
                from urllib.parse import urlparse
                import ssl
                url = f"https://104.16.132.229/api/health"
                parsed = urlparse(db.WORKER_URL.rstrip('/'))
                headers = {"Host": parsed.hostname, "X-API-Key": db.WORKER_API_KEY}
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                transport = httpx.AsyncHTTPTransport(verify=ctx)
                async with httpx.AsyncClient(timeout=4.0, transport=transport) as client:
                    r = await client.get(url, headers=headers)
                    if r.status_code == 200:
                        results["layer3_fronted"] = {"status": "online", "time": round((time.time() - start) * 1000)}
                    else:
                        results["layer3_fronted"] = {"status": "offline", "time": round((time.time() - start) * 1000)}
            except Exception:
                results["layer3_fronted"] = {"status": "offline", "time": round((time.time() - start) * 1000)}
    else:
        results["layer3_fronted"] = {"status": "skipped", "time": 0}

    # Layer 4: VLESS Tunnel (If current active mode is tunnel, we know it's online)
    start = time.time()
    if db.db_mode == "tunnel" and db.pool:
        results["layer4_tunnel"] = {"status": "online", "time": 0, "active": True}
    elif db.db_via_proxy:
         results["layer4_tunnel"] = {"status": "online", "time": 0, "active": True}
    else:
        # Instead of standby, let's actively test if a proxy tunnel can be established
        from core_manager import APP_DIR
        import os
        import json
        config_to_test = None
        
        # 1. Try to find recent auto-pilot scan config
        history_file = os.path.join(APP_DIR, 'latest_working_configs.json')
        if os.path.exists(history_file):
            try:
                with open(history_file, 'r') as f:
                    history = json.load(f)
                    if history: config_to_test = history[0]
            except: pass
            
        # 2. Try the built-in fallback
        if not config_to_test:
            fallback = os.environ.get('VITE_FALLBACK_CONFIG', '')
            if fallback and fallback.startswith('vless://'):
                config_to_test = fallback
                
        if config_to_test:
            from db_proxy import generate_proxy_config
            from core_manager import get_xray_path
            from scanner import parse_config
            import tempfile
            import subprocess
            
            proc = None
            try:
                vless_parts = parse_config(config_to_test)
                # Listen on a unique test port to avoid disrupting port 33060 if it's reserved
                test_port = 33061 
                xray_config = generate_proxy_config(vless_parts, test_port, db.DB_HOST, db.DB_PORT)
                
                tmp_path = os.path.join(APP_DIR, "test_proxy_config.json")
                with open(tmp_path, "w") as f:
                    json.dump(xray_config, f)
                
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.Popen([get_xray_path(), "-c", tmp_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags)
                
                # Give Xray 1.5 seconds to open the port
                await asyncio.sleep(1.5)
                
                # Test MySQL through the tunnel
                async with asyncio.timeout(3.0):
                    conn = await aiomysql.connect(host='127.0.0.1', port=test_port, user=db.DB_USER, password=db.DB_PASSWORD, db=db.DB_NAME)
                    await conn.ping()
                    conn.close()
                    
                results["layer4_tunnel"] = {"status": "online", "time": round((time.time() - start) * 1000)}
            except Exception as e:
                # Tunnel failed to connect to DB
                results["layer4_tunnel"] = {"status": "offline", "time": round((time.time() - start) * 1000), "reason": "Tunnel connection timed out"}
            finally:
                if proc:
                    try:
                        proc.kill()
                        proc.wait(timeout=1)
                    except: pass
        else:
            results["layer4_tunnel"] = {"status": "skipped", "time": 0, "reason": "No VLESS configs available"}

    # Layer 5: Local SQLite
    start = time.time()
    if db.local_db:
        # Check if file exists and is accessible
        import os
        if os.path.exists(db.local_db.path):
            results["layer5_local"] = {"status": "online", "time": round((time.time() - start) * 1000)}
        else:
            results["layer5_local"] = {"status": "offline", "time": 0}
    else:
        results["layer5_local"] = {"status": "offline", "time": 0}

    return results

class ProxyDbRequest(BaseModel):
    vless_config: str

@app.post('/proxy-db')
async def proxy_db(req: ProxyDbRequest):
    global _working_vless_config
    import db
    from db_proxy import start_db_tunnel
    from scanner import parse_config
    try:
        vless_parts = parse_config(req.vless_config)
        start_db_tunnel(vless_parts)
        await asyncio.sleep(2)
        
        success = await db.reconnect_db('127.0.0.1', 33060)
        if success:
            db.db_via_proxy = True
            _working_vless_config = req.vless_config
            dlog(f"[OK] DB tunneled via user-provided config")
            return {"status": "ok", "message": "Database tunneled successfully"}
        else:
            return {"status": "error", "message": "Tunnel started but DB reconnection failed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class SmartRecommendRequest(BaseModel):
    isp: Optional[str] = ""
    location: Optional[str] = ""
    country: Optional[str] = ""
    limit: int = 30

@app.post('/api/smart-recommend')
async def smart_recommend(req: SmartRecommendRequest):
    """Smart IP Recommendation Engine — returns scored, tiered IP recommendations."""
    try:
        import db
        results = await db.get_smart_recommendations(
            isp=req.isp or "",
            location=req.location or "",
            country=req.country or "",
            limit=req.limit
        )
        if not results:
            # Fallback to offline cache
            recs_cache_file = os.path.join(APP_DIR, 'offline_smart_recs.json')
            if os.path.exists(recs_cache_file):
                import json
                with open(recs_cache_file, 'r') as f:
                    results = json.load(f)
                    results = results[:req.limit]
                    
        return {"results": results, "total": len(results)}
    except Exception as e:
        dlog(f"Smart Recommend Error: {e}")
        return {"results": [], "total": 0, "error": str(e)}

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
        vless_parts = parse_config(req.vless_config)
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
        vless_parts = parse_config(req.vless_config)
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


@app.post('/rescan-ip')
async def rescan_ip_endpoint(req: dict = Body(...)):
    """Re-test a single IP with no thresholds — returns full metrics."""
    try:
        vless_config = req.get('vless_config', '').strip()
        ip = req.get('ip', '').strip()
        if not vless_config or not ip:
            return {'error': 'Missing vless_config or ip'}
        vless_parts = parse_config(vless_config)
        from scanner import scan_ip
        # Use extremely lenient thresholds so the scan always completes all tests
        thresholds = {'max_ping': 99999, 'max_jitter': 99999, 'min_download': 0, 'min_upload': 0}
        result = await scan_ip(ip, vless_parts, thresholds)
        return {'result': result}
    except Exception as e:
        return {'error': str(e)}

@app.post('/test-config')
async def test_config_endpoint(req: dict = Body(...)):
    """Full config validation: test if a VPN config is alive and return metrics."""
    print("[test-config] Endpoint entered!")
    try:
        config_url = req.get('config', '').strip()
        print(f"[test-config] Config URL: {config_url[:60]}...")
        if not config_url:
            return {'ok': False, 'message': 'No config provided'}
        vless_parts = parse_config(config_url)
        print(f"[test-config] Parsed config, protocol={vless_parts.get('protocol')}, address={vless_parts.get('address')}")
        ok, message, result = await test_config(vless_parts)
        print(f"[test-config] Result: ok={ok}, message={message}")
        return {'ok': ok, 'message': message, 'result': result}
    except Exception as e:
        print(f"[test-config] Error: {e}")
        return {'ok': False, 'message': f'Error: {str(e)}'}

@app.post('/scan')
async def start_scan(req: ScanRequest, request: Request, background_tasks: BackgroundTasks):
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
        vless_parts = parse_config(req.vless_config)
    except Exception as e:
        return {'error': f'Invalid config: {str(e)}'}
        
    client_id = request.headers.get('x-client-id', 'Unknown')
    
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
    # Register the scan in the persistent SQLite DB
    await create_scan_task(scan_id, req.dict(), active_scans[scan_id]['logs'], active_scans[scan_id]['stats'])
    # Fire off the 2-second synchronizer
    asyncio.create_task(sync_queue_db(scan_id))
    
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
        if not ips_static and getattr(req, 'ip_source', 'official') in ['custom_url', 'auto_scrape', 'community_scrape', 'fastly_cdn']:
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
            
            # Pre-seed the scanner with historically successful subnets from DB
            try:
                from db import get_smart_recommendations
                from cf_ips import smart_generator
                loc_str = user_info.get('location', 'Unknown')
                country = loc_str.split('-')[0].strip() if '-' in loc_str else ''
                recs = await get_smart_recommendations(
                    isp=user_info.get('isp', ''),
                    location=loc_str,
                    country=country,
                    limit=30
                )
                if recs:
                    smart_generator.preseed_from_db(recs)
                    add_log(scan_id, f'🧠 Pre-seeded {len(recs)} proven subnets from community DB for your ISP')
            except Exception as e:
                dlog(f"Pre-seed failed (non-fatal): {e}")
        
        add_log(scan_id, f'Started scan. Goal: Find {req.stop_after} Good IPs. Threads: {req.concurrency}. Mode: {mode_name}')
        
        running_tasks = set()
        
        async def bounded_scan(ip, t_port=None):
            nonlocal good_ips_count
            
            while active_scans[scan_id]['status'] == 'paused':
                await asyncio.sleep(0.5)
                
            if active_scans[scan_id]['status'] != 'running': return
            
            async with discovery_sem:
                port_str = f":{t_port}" if t_port else ""
                
                # Fast TCP Pre-Filter
                from scanner import tcp_ping
                target_port = t_port if t_port else vless_parts.get('port', 443)
                is_reachable = await tcp_ping(ip, target_port, timeout=1.0)
                
                if not is_reachable:
                    res = {
                        'ping': -1, 'jitter': 0, 'download': 0, 'upload': 0,
                        'status': 'unreachable', 'datacenter': 'Unknown', 'asn': 'Unknown'
                    }
                else:
                    add_log(scan_id, f'Checking {ip}{port_str}...')
                    provider_val = "fastly" if getattr(req, 'ip_source', '') == 'fastly_cdn' else "cloudflare"
                    res = await scan_ip(ip, vless_parts, thresholds, speed_sem, test_port=t_port, verify_tls=req.verify_tls, check_status_cb=lambda: active_scans[scan_id]['status'], provider=provider_val)
                
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
                            
                        # Save to working configs history
                        try:
                            protocol = vless_parts.get("protocol", "vless")
                            params = vless_parts.get('params', {}).copy()
                            param_str = "&".join([f"{k}={v}" for k, v in params.items()])
                            port = t_port if t_port else vless_parts.get('port', 443)
                            
                            # Determine the Sni to put in the VLESS string
                            sni_val = test_sni if 'test_sni' in locals() and test_sni else params.get('sni', '')
                            if sni_val:
                                params['sni'] = sni_val
                            param_str = "&".join([f"{k}={v}" for k, v in params.items()])
                            
                            working_link = f"{protocol}://{vless_parts.get('uuid', 'none')}@{ip}:{port}?{param_str}#{ip}"
                            
                            history_file = os.path.join(APP_DIR, 'latest_working_configs.json')
                            history = []
                            if os.path.exists(history_file):
                                with open(history_file, 'r') as f:
                                    history = json.load(f)
                            if working_link not in history:
                                history.insert(0, working_link)
                                history = history[:20]  # Keep latest 20
                                with open(history_file, 'w') as f:
                                    json.dump(history, f)
                        except Exception as e:
                            add_log(scan_id, f"Error saving working config: {e}")
                        
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
                    'app_version': '1.0.0',
                    'provider': "fastly" if getattr(req, 'ip_source', '') == 'fastly_cdn' else "cloudflare"
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
    # Include both OK and dropped (high_ping, high_jitter, low_download, low_upload) results
    SHOW_STATUSES = {'ok', 'high_ping', 'high_jitter', 'low_download', 'low_upload'}
    visible_results = [r for r in all_results if r.get('status') in SHOW_STATUSES]
    show_results = sorted(visible_results, key=lambda x: (0 if x.get('status') == 'ok' else 1, x.get('ping', 9999)))
    
    return {
        'status': active_scans[scan_id],
        'results': show_results
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

_freedom_task = None

@app.post('/api/freedom/start')
async def api_freedom_start():
    global _freedom_task
    if _freedom_task and not _freedom_task.done():
        return {"status": "already_running"}
    freedom_state._stop_signal = False
    _freedom_task = asyncio.create_task(run_play_freedom_loop())
    return {"status": "started"}

@app.post('/api/freedom/stop')
async def api_freedom_stop():
    freedom_state._stop_signal = True
    return {"status": "stopped"}

@app.get('/api/freedom/status')
async def api_freedom_status():
    return {
        "status": freedom_state.status,
        "phase": freedom_state.phase,
        "logs": freedom_state.logs,
        "found_configs": freedom_state.found_configs,
        "active_scanner_id": freedom_state.active_scanner_id,
        "waiting_for_config": freedom_state.waiting_for_config
    }

@app.post('/api/freedom/provide-config')
async def api_freedom_provide_config(req: dict = Body(...)):
    config = req.get('config', '').strip()
    if not config:
        return {"error": "No config provided"}
    if not freedom_state.waiting_for_config:
        return {"error": "Engine is not waiting for a config"}
    freedom_state.user_provided_config = config
    return {"status": "config_received"}

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
    mode: str # 'fragment', 'sni', 'dns_tunnel'
    rare_mode: bool = False
    fragment_lengths: Optional[List[str]] = []
    fragment_intervals: Optional[List[str]] = []
    test_snis: Optional[List[str]] = []
    
    # DNS Tunnel specific
    test_mode: Optional[str] = None
    nameserver: Optional[str] = None
    nameservers: Optional[List[str]] = None  # multiple nameservers for grid scan
    dns_domain: Optional[str] = None
    fragment_size: Optional[str] = None
    fragment_interval: Optional[str] = None
    fragment_packets: Optional[str] = None  # 'tlshello' or '1-3'
    utls_fingerprint: Optional[str] = None  # chrome, firefox, safari, ios, android, edge, random
    
    concurrency: int = 5
    max_ping: int = 2000

@app.post('/scan-advanced')
def start_advanced_scan(req: ScanAdvancedRequest, request: Request, background_tasks: BackgroundTasks):
    scan_id = str(uuid.uuid4())
    try:
        vless_parts = parse_config(req.vless_config)
    except Exception as e:
        return {'error': f'Invalid config: {str(e)}'}
        
    client_id = request.headers.get('x-client-id', 'Unknown')
    
    items_to_test = []
    if req.mode == 'fragment':
        if getattr(req, 'rare_mode', False):
            # Generate 15 highly randomized, asymmetric boundaries to evade heuristic blocks
            for _ in range(15):
                len_start = random.randint(3, 40)
                len_end = len_start + random.randint(10, 80)
                int_start = random.randint(5, 70)
                int_end = int_start + random.randint(20, 150)
                
                flen = f"{len_start}-{len_end}"
                fint = f"{int_start}-{int_end}"
                items_to_test.append({
                    "fragment": {"length": flen, "interval": fint}, 
                    "test_sni": None, 
                    "id": f"Gen: {flen} / {fint}"
                })
        else:
            for flen in req.fragment_lengths:
                for fint in req.fragment_intervals:
                    items_to_test.append({"fragment": {"length": flen, "interval": fint}, "test_sni": None, "id": f"Frag: {flen} / {fint}"})
    elif req.mode == 'sni':
        for sni in req.test_snis:
            sni = sni.strip()
            if sni:
                items_to_test.append({"fragment": None, "test_sni": sni, "id": f"SNI: {sni}"})
    elif req.mode == 'dns_tunnel':
        if req.test_mode == 'dnstt':
            ns_list = req.nameservers or ([req.nameserver] if req.nameserver else ['8.8.8.8'])
            for ns in ns_list:
                items_to_test.append({
                    "fragment": None,
                    "test_sni": None,
                    "dns_over_udp": {"server": ns, "domain": req.dns_domain, "utls_fingerprint": req.utls_fingerprint},
                    "id": f"DNS Override | NS: {ns} | Domain: {req.dns_domain}"
                })
        elif req.test_mode == 'split':
            items_to_test.append({
                "fragment": {"length": req.fragment_size, "interval": req.fragment_interval, "packets": req.fragment_packets or "tlshello"},
                "test_sni": None,
                "dns_over_udp": {"utls_fingerprint": req.utls_fingerprint} if req.utls_fingerprint else None,
                "id": f"TLS Split [{req.fragment_packets or 'tlshello'}] | Len: {req.fragment_size} | Int: {req.fragment_interval}"
            })
            
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
    
    # Persistent SQLite Registration
    background_tasks.add_task(create_advanced_scan_wrapper, scan_id, req.target_ip, vless_parts, req, items_to_test)
    return {'scan_id': scan_id}

async def create_advanced_scan_wrapper(scan_id, target_ip, vless_parts, req, items_to_test):
    from main import get_my_ip
    user_info = await get_my_ip()
    user_isp = user_info.get('isp', '')
    
    await create_scan_task(scan_id, req.dict(), active_scans[scan_id]['logs'], active_scans[scan_id]['stats'])
    asyncio.create_task(sync_queue_db(scan_id))
    await run_advanced_scan_job(scan_id, target_ip, vless_parts, req, items_to_test, user_isp)

async def run_advanced_scan_job(scan_id, target_ip, vless_parts, req, items_to_test, user_isp):
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
        
        # Extract potential custom DNS payload 
        dns_payload = item.get("dns_over_udp", None)
        
        from scanner import tcp_ping
        target_port = vless_parts.get('port', 443)
        is_reachable = await tcp_ping(target_ip, target_port, timeout=1.0)
        
        if not is_reachable:
            res = {
                'ping': -1, 'jitter': 0, 'download': 0, 'upload': 0,
                'status': 'unreachable', 'datacenter': 'Unknown', 'asn': 'Unknown'
            }
        else:
            res = await scan_ip(
                target_ip, 
                vless_parts, 
                thresholds, 
                speed_sem, 
                test_port=None, 
                fragment=item.get('fragment'), 
                test_sni=item.get('test_sni'),
                advanced_dns_config=dns_payload
            )
        
        stat_key = res.get('fail_reason')
        if stat_key and stat_key in active_scans[scan_id]['stats']:
            active_scans[scan_id]['stats'][stat_key] += 1
            
        active_scans[scan_id]['stats']['scanned'] += 1
        
        if res['status'] == 'ok':
            active_scans[scan_id]['found_good'] += 1
            add_log(scan_id, f"✅ SUCCESS => {item['id']} | Ping: {res['ping']}ms")
            
            # Log successful bypass profile to crowdsourced DB
            if user_isp:
                try:
                    from db import log_bypass_result
                    frag = item.get('fragment') or {}
                    sni = item.get('test_sni') or ''
                    asyncio.create_task(log_bypass_result(
                        isp=user_isp,
                        mode=req.mode,
                        length=frag.get('length', ''),
                        interval=frag.get('interval', ''),
                        sni=sni,
                        ping=res['ping']
                    ))
                except Exception as e:
                    print(f"Failed to log bypass: {e}")
            
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

from pydantic import BaseModel
class LogBypassRequest(BaseModel):
    isp: str
    mode: str
    length: str = ''
    interval: str = ''
    sni: str = ''
    ping: float

@app.post('/api/log-bypass')
async def handle_log_bypass(payload: LogBypassRequest):
    try:
        from db import log_bypass_result
        await log_bypass_result(
            payload.isp, payload.mode, payload.length, 
            payload.interval, payload.sni, payload.ping
        )
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get('/api/best-bypasses')
async def handle_best_bypasses(isp: str, mode: str, limit: int = 5):
    try:
        from db import get_best_community_bypasses
        results = await get_best_community_bypasses(isp, mode, limit)
        if results:
            return {"results": results}
    except Exception as e:
        print(f"Best bypasses DB error: {e}")
    # Offline fallback
    try:
        cache_file = os.path.join(APP_DIR, 'offline_bypass_profiles.json')
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f:
                all_profiles = json.load(f)
            filtered = [p for p in all_profiles if p.get('_isp', '').lower() == isp.lower() and p.get('_mode', '').lower() == mode.lower()]
            return {"results": filtered[:limit]}
    except Exception:
        pass
    return {"results": []}

@app.get('/analytics')
async def get_analytics_endpoint(provider: str = 'cloudflare'):
    from db import get_analytics
    try:
        data = await get_analytics(provider)
        if data:
            return data
    except Exception:
        pass
    # Offline fallback
    cache_file = os.path.join(APP_DIR, 'offline_analytics.json')
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            return json.load(f)
    return {}

@app.get('/analytics/geo')
async def get_geo_analytics_endpoint(provider: str = 'cloudflare'):
    from db import get_geo_analytics
    try:
        data = await get_geo_analytics(provider)
        if data:
            return data
    except Exception:
        pass
    # Offline fallback
    cache_file = os.path.join(APP_DIR, 'offline_geo_analytics.json')
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            return json.load(f)
    return {}

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

@app.get('/api/db-export')
async def db_export(
    sections: Optional[str] = None,
    passphrase: Optional[str] = None,
    scan_limit: int = 50000,
):
    """Export an enriched, encrypted backup bundle.

    Query params:
      sections   - comma-separated whitelist (e.g. "settings,scan_results"). Default: all.
      passphrase - optional user passphrase -> AGDB03 (PBKDF2 + AES-GCM). Else AGDB02.
      scan_limit - cap on scan rows (default 50k).
    """
    import db
    from offline_db import encrypt_payload
    wanted = None
    if sections:
        wanted = {s.strip() for s in sections.split(',') if s.strip()}

    def included(name: str) -> bool:
        return wanted is None or name in wanted

    try:
        # Collect ALL data needed for complete offline functionality
        data = {
            "version": "3.0",
            "exported_at": datetime.now().isoformat(),
            "app_version": "1.0.0",
            "settings": {},
            "working_configs": [],
            "vpn_admin_configs": [],
            "vpn_admin_vanilla_configs": [],
            "scan_results": [],
            "smart_recommendations": [],
            "analytics": {},
            "geo_analytics": {},
            "country_domains": {},
            "bypass_profiles": [],
            "tunnel_deployments": [],
            "dns_optimizer_history": [],
            "freedom_state": {},
            "warp_endpoints": [],
            "user_subscription": "",
            "scan_history_index": [],
            "extra_files": {},
        }
        
        # 1. App Settings
        if included("settings"):
            try:
                settings_file = os.path.join(APP_DIR, 'settings.json')
                if os.path.exists(settings_file):
                    with open(settings_file, 'r') as f:
                        data["settings"] = json.load(f)
            except Exception as e:
                print(f"Skipped settings export: {e}")
        
        # 2. Working configs (needed for Play Freedom & DB tunnel fallback)
        if included("working_configs"):
            try:
                history_file = os.path.join(APP_DIR, 'latest_working_configs.json')
                if os.path.exists(history_file):
                    with open(history_file, 'r') as f:
                        data["working_configs"] = json.load(f)
            except Exception as e:
                print(f"Skipped working configs export: {e}")
                
        # 3. VPN Admin CF configs (needed for Play Freedom mining & free-configs tab)
        if included("vpn_admin_configs"):
          try:
            import httpx
            admin_api = os.environ.get('ADMIN_API_URL', '')
            if not admin_api:
                raise ValueError("ADMIN_API_URL not configured")
            async with httpx.AsyncClient(timeout=10, verify=False) as client:
                resp = await client.get(f"{admin_api}/sub/cf")
                if resp.status_code == 200:
                    import base64
                    text = resp.text.strip()
                    try:
                        decoded = base64.b64decode(text).decode('utf-8', errors='ignore')
                    except:
                        decoded = text
                    lines = [l.strip() for l in decoded.split('\n') if l.strip().startswith(('vless://', 'vmess://', 'trojan://', 'ss://'))]
                    data["vpn_admin_configs"] = lines
          except Exception as e:
            print(f"Skipped Admin CF Configs: {e}")
            # Fallback to offline cache
            try:
                cache_file = os.path.join(APP_DIR, 'offline_admin_configs.json')
                if os.path.exists(cache_file):
                    with open(cache_file, 'r') as f:
                        data["vpn_admin_configs"] = json.load(f)
            except:
                pass

        # 4. VPN Admin vanilla configs (needed for Play Freedom Phase 1)
        if included("vpn_admin_vanilla_configs"):
          try:
            import httpx
            admin_api = os.environ.get('ADMIN_API_URL', '')
            if not admin_api:
                raise ValueError("ADMIN_API_URL not configured")
            async with httpx.AsyncClient(timeout=10, verify=False) as client:
                resp = await client.get(f"{admin_api}/sub")
                if resp.status_code == 200:
                    import base64
                    text = resp.text.strip()
                    try:
                        decoded = base64.b64decode(text).decode('utf-8', errors='ignore')
                    except:
                        decoded = text
                    lines = [l.strip() for l in decoded.split('\n') if l.strip().startswith(('vless://', 'vmess://', 'trojan://', 'ss://'))]
                    data["vpn_admin_vanilla_configs"] = lines
          except Exception as e:
            print(f"Skipped Admin Vanilla Configs: {e}")

        # 5. Scan Results (from MySQL or SQLite)
        import aiosqlite
        if included("scan_results"):
         try:
            async def _fetch_mysql():
                if hasattr(db, 'pool') and db.pool:
                    async with db.pool.acquire() as conn:
                        async with conn.cursor() as cur:
                            await cur.execute(f"SELECT * FROM scan_results WHERE status='ok' ORDER BY timestamp DESC LIMIT {int(max(1, min(scan_limit, 200000)))}")
                            columns = [desc[0] for desc in cur.description] if cur.description else []
                            rows = await cur.fetchall()
                            for r in rows:
                                row_dict = dict(zip(columns, r))
                                if "timestamp" in row_dict and row_dict["timestamp"]:
                                    row_dict["timestamp"] = str(row_dict["timestamp"])
                                row_dict["user_ip"] = "redacted"
                                row_dict["user_location"] = "redacted"
                                row_dict["user_isp"] = "redacted"
                                row_dict["vless_uuid"] = "redacted"
                                data["scan_results"].append(row_dict)
                else:
                    raise Exception("No pool")

            async def _fetch_sqlite():
                sqlite_path = getattr(db, 'local_db', None)
                sqlite_path = sqlite_path.path if sqlite_path else os.path.join(APP_DIR, 'offline_cache.db')
                if os.path.exists(sqlite_path):
                    async with aiosqlite.connect(sqlite_path) as ldb:
                        ldb.row_factory = aiosqlite.Row
                        try:
                            cur = await ldb.execute(f"SELECT * FROM scan_results WHERE status='ok' ORDER BY timestamp DESC LIMIT {int(max(1, min(scan_limit, 200000)))}")
                            rows = await cur.fetchall()
                            for r in rows:
                                rd = dict(r)
                                rd["user_ip"] = "redacted"
                                rd["user_location"] = "redacted"
                                rd["user_isp"] = "redacted"
                                rd["vless_uuid"] = "redacted"
                                data["scan_results"].append(rd)
                        except Exception as sqle:
                            print(f"No scan_results in SQLite yet: {sqle}")

            mysql_success = False
            try:
                if hasattr(db, 'pool') and db.pool:
                    await asyncio.wait_for(_fetch_mysql(), timeout=6.0)
                    mysql_success = len(data["scan_results"]) > 0
            except Exception as e:
                print(f"MySQL fetch failed, falling back to SQLite: {e}")
                
            if not mysql_success:
                try:
                    await asyncio.wait_for(_fetch_sqlite(), timeout=6.0)
                except Exception as e:
                    print(f"SQLite fetch failed: {e}")
                    
         except Exception as e:
            print(f"Skipped Scan Results: {e}")
            
        # 6. Smart Recommendations
        if included("smart_recommendations"):
         try:
            recs = await asyncio.wait_for(db.get_smart_recommendations(isp="", location="", country="", limit=500), timeout=8.0)
            data["smart_recommendations"] = recs if recs else []
         except Exception as e:
            print(f"Skipped Smart Recommendations: {e}")
            # Fallback to offline cache
            try:
                recs_file = os.path.join(APP_DIR, 'offline_smart_recs.json')
                if os.path.exists(recs_file):
                    with open(recs_file, 'r') as f:
                        data["smart_recommendations"] = json.load(f)
            except:
                pass

        # 7. Global Analytics (needed for Analytics tab offline)
        if included("analytics"):
         try:
            analytics = await asyncio.wait_for(db.get_analytics(provider='cloudflare'), timeout=8.0)
            if analytics:
                data["analytics"] = analytics
         except Exception as e:
            print(f"Skipped Analytics: {e}")

        # 8. Geo Analytics (needed for Analytics geo map offline)
        if included("geo_analytics"):
         try:
            geo = await asyncio.wait_for(db.get_geo_analytics(provider='cloudflare'), timeout=8.0)
            if geo:
                data["geo_analytics"] = geo
         except Exception as e:
            print(f"Skipped Geo Analytics: {e}")

        # 9. Country Domains (needed for IP generation from gold domains)
        if included("country_domains"):
         try:
            # Expanded coverage: 40+ countries (was 20)
            known_countries = ['IR', 'CN', 'RU', 'TR', 'AE', 'PK', 'EG', 'VN', 'TH', 'ID', 'SA', 'IQ',
                               'AF', 'BY', 'CU', 'VE', 'MM', 'TM', 'UZ', 'TJ', 'IN', 'BD', 'LK', 'NP',
                               'KZ', 'KG', 'AZ', 'AM', 'GE', 'SY', 'YE', 'OM', 'QA', 'KW', 'BH', 'JO',
                               'LB', 'PS', 'LY', 'TN', 'DZ', 'MA', 'SD', 'ET', 'KE', 'NG', 'ZA']
            for cc in known_countries:
                try:
                    result = await asyncio.wait_for(db.get_country_domains(cc), timeout=3.0)
                    if result and result.get('domains'):
                        data["country_domains"][cc] = result['domains']
                except:
                    pass
         except Exception as e:
            print(f"Skipped Country Domains: {e}")

        # 10. Best Bypass Profiles (needed for ISP-specific bypass settings)
        if included("bypass_profiles"):
         try:
            # Expanded ISP coverage (was 7, now 20+)
            common_isps = ['MCI', 'Irancell', 'Rightel', 'Shatel', 'Mokhaberat', 'Asiatech', 'HiWEB',
                           'PishGaman', 'ParsOnline', 'AsrTelecom', 'TIC', 'Datak', 'RespinaNet',
                           'FanavaGroup', 'Sabanet', 'NeginNet', 'AryaSat', 'TCT', 'Saba', 'Aria']
            for isp_name in common_isps:
                for mode in ['fragment', 'sni', 'dns']:
                    try:
                        bypasses = await asyncio.wait_for(db.get_best_community_bypasses(isp=isp_name, mode=mode, limit=10), timeout=3.0)
                        if bypasses and bypasses.get('results'):
                            for bp in bypasses['results']:
                                bp['_isp'] = isp_name
                                bp['_mode'] = mode
                                data["bypass_profiles"].append(bp)
                    except:
                        pass
         except Exception as e:
            print(f"Skipped Bypass Profiles: {e}")

        # 11. Tunnel deployments cache
        if included("tunnel_deployments"):
            try:
                td_file = os.path.join(APP_DIR, 'tunnel_deployments.json')
                if os.path.exists(td_file):
                    with open(td_file, 'r') as f:
                        data["tunnel_deployments"] = json.load(f)
            except Exception as e:
                print(f"Skipped Tunnel Deployments: {e}")

        # 12. DNS optimizer history
        if included("dns_optimizer_history"):
            try:
                dns_file = os.path.join(APP_DIR, 'dns_optimizer_history.json')
                if os.path.exists(dns_file):
                    with open(dns_file, 'r') as f:
                        data["dns_optimizer_history"] = json.load(f)
            except Exception as e:
                print(f"Skipped DNS Optimizer History: {e}")

        # 13. Play Freedom engine state snapshot
        if included("freedom_state"):
            try:
                fs = freedom_state
                data["freedom_state"] = {
                    "status": getattr(fs, 'status', None),
                    "phase": getattr(fs, 'phase', None),
                    "found_configs": getattr(fs, 'found_configs', []),
                }
            except Exception as e:
                print(f"Skipped Freedom State: {e}")

        # 14. WARP endpoints cache
        if included("warp_endpoints"):
            try:
                warp_file = os.path.join(APP_DIR, 'warp_endpoints.json')
                if os.path.exists(warp_file):
                    with open(warp_file, 'r') as f:
                        data["warp_endpoints"] = json.load(f)
            except Exception as e:
                print(f"Skipped WARP Endpoints: {e}")

        # 15. Latest user-pulled subscription text
        if included("user_subscription"):
            try:
                sub_file = os.path.join(APP_DIR, 'latest_subscription.txt')
                if os.path.exists(sub_file):
                    with open(sub_file, 'r', encoding='utf-8', errors='ignore') as f:
                        data["user_subscription"] = f.read()
            except Exception as e:
                print(f"Skipped User Subscription: {e}")

        # 16. Per-scan-result JSON files index (lightweight pointers)
        if included("scan_history_index"):
            try:
                results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')
                if os.path.isdir(results_dir):
                    files = sorted(os.listdir(results_dir))[-100:]  # last 100
                    data["scan_history_index"] = [
                        {"name": fn, "size": os.path.getsize(os.path.join(results_dir, fn))}
                        for fn in files if fn.endswith('.json')
                    ]
            except Exception as e:
                print(f"Skipped Scan History Index: {e}")

        # 17. Extra small JSON files (best-effort sweep of APP_DIR caches)
        if included("extra_files"):
            try:
                extras = ['offline_analytics.json', 'offline_geo_analytics.json',
                          'offline_country_domains.json', 'offline_bypass_profiles.json',
                          'speed_matrix.json', 'claim_vip_state.json', 'ui_preferences.json']
                for fn in extras:
                    p = os.path.join(APP_DIR, fn)
                    if os.path.exists(p) and os.path.getsize(p) < 5_000_000:
                        try:
                            with open(p, 'r', encoding='utf-8') as fh:
                                data["extra_files"][fn] = json.load(fh)
                        except Exception:
                            pass
            except Exception as e:
                print(f"Skipped Extra Files: {e}")

        encrypted_bytes = encrypt_payload(data, passphrase=passphrase, version=2)
        return Response(
            content=encrypted_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=antigravity-bundle-{int(time.time())}.agdb"}
        )
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post('/api/db-import')
async def db_import(
    file: UploadFile = File(...),
    passphrase: Optional[str] = None,
    sections: Optional[str] = None,
    dry_run: bool = False,
):
    import db
    from offline_db import decrypt_payload, peek_manifest
    wanted = None
    if sections:
        wanted = {s.strip() for s in sections.split(',') if s.strip()}

    def included(name: str) -> bool:
        return wanted is None or name in wanted

    try:
        content = await file.read()
        if dry_run:
            return {"success": True, "preview": peek_manifest(content, passphrase=passphrase)}
        data = decrypt_payload(content, passphrase=passphrase)
        stats = {"_manifest": data.get("_manifest")}
        
        # 1. Restore App Settings
        if included("settings") and data.get("settings"):
            try:
                settings_file = os.path.join(APP_DIR, 'settings.json')
                with open(settings_file, 'w') as f:
                    json.dump(data["settings"], f, indent=2)
                stats["settings"] = "restored"
            except Exception as e:
                print(f"Failed to restore settings: {e}")
        
        # 2. Import working configs (merge with existing)
        if included("working_configs"):
            history_file = os.path.join(APP_DIR, 'latest_working_configs.json')
            existing = []
            if os.path.exists(history_file):
                try:
                    with open(history_file, 'r') as f:
                        existing = json.load(f)
                except Exception:
                    existing = []
            for wc in data.get("working_configs", []):
                if wc not in existing:
                    existing.insert(0, wc)
            with open(history_file, 'w') as f:
                json.dump(existing[:200], f)
            stats["working_configs"] = len(data.get("working_configs", []))
            
        # 3. Write VPN admin CF configs (for free-configs tab & Play Freedom mining)
        if included("vpn_admin_configs"):
            admin_cache_file = os.path.join(APP_DIR, 'offline_admin_configs.json')
            cf_configs = data.get("vpn_admin_configs", [])
            with open(admin_cache_file, 'w') as f:
                json.dump(cf_configs, f)
            stats["vpn_cf_configs"] = len(cf_configs)

        # 4. Write VPN admin vanilla configs (for Play Freedom Phase 1)
        if included("vpn_admin_vanilla_configs"):
            vanilla_configs = data.get("vpn_admin_vanilla_configs", [])
            if vanilla_configs:
                vanilla_cache_file = os.path.join(APP_DIR, 'offline_admin_vanilla_configs.json')
                with open(vanilla_cache_file, 'w') as f:
                    json.dump(vanilla_configs, f)
                stats["vpn_vanilla_configs"] = len(vanilla_configs)

        # 5. Write Smart Recommendations to fallback
        if included("smart_recommendations"):
            recs = data.get("smart_recommendations", [])
            recs_cache_file = os.path.join(APP_DIR, 'offline_smart_recs.json')
            with open(recs_cache_file, 'w') as f:
                json.dump(recs, f)
            stats["smart_recommendations"] = len(recs)

        # 6. Cache Analytics data for offline viewing
        if included("analytics") and data.get("analytics"):
            try:
                analytics_cache = os.path.join(APP_DIR, 'offline_analytics.json')
                with open(analytics_cache, 'w') as f:
                    json.dump(data["analytics"], f)
                stats["analytics"] = "restored"
            except Exception as e:
                print(f"Failed to cache analytics: {e}")

        # 7. Cache Geo Analytics data for offline viewing
        if included("geo_analytics") and data.get("geo_analytics"):
            try:
                geo_cache = os.path.join(APP_DIR, 'offline_geo_analytics.json')
                with open(geo_cache, 'w') as f:
                    json.dump(data["geo_analytics"], f)
                stats["geo_analytics"] = "restored"
            except Exception as e:
                print(f"Failed to cache geo analytics: {e}")

        # 8. Cache Country Domains for IP generation
        if included("country_domains") and data.get("country_domains"):
            try:
                domains_cache = os.path.join(APP_DIR, 'offline_country_domains.json')
                with open(domains_cache, 'w') as f:
                    json.dump(data["country_domains"], f)
                stats["country_domains"] = len(data["country_domains"])
            except Exception as e:
                print(f"Failed to cache country domains: {e}")

        # 9. Cache Bypass Profiles for ISP-specific settings
        if included("bypass_profiles") and data.get("bypass_profiles"):
            try:
                bypass_cache = os.path.join(APP_DIR, 'offline_bypass_profiles.json')
                with open(bypass_cache, 'w') as f:
                    json.dump(data["bypass_profiles"], f)
                stats["bypass_profiles"] = len(data["bypass_profiles"])
            except Exception as e:
                print(f"Failed to cache bypass profiles: {e}")

        # 10. Tunnel deployments
        if included("tunnel_deployments") and data.get("tunnel_deployments"):
            try:
                td_file = os.path.join(APP_DIR, 'tunnel_deployments.json')
                with open(td_file, 'w') as f:
                    json.dump(data["tunnel_deployments"], f, indent=2)
                stats["tunnel_deployments"] = len(data["tunnel_deployments"])
            except Exception as e:
                print(f"Failed to restore tunnel deployments: {e}")

        # 11. DNS optimizer history
        if included("dns_optimizer_history") and data.get("dns_optimizer_history"):
            try:
                dns_file = os.path.join(APP_DIR, 'dns_optimizer_history.json')
                with open(dns_file, 'w') as f:
                    json.dump(data["dns_optimizer_history"], f, indent=2)
                stats["dns_optimizer_history"] = len(data["dns_optimizer_history"])
            except Exception as e:
                print(f"Failed to restore DNS history: {e}")

        # 12. WARP endpoints
        if included("warp_endpoints") and data.get("warp_endpoints"):
            try:
                warp_file = os.path.join(APP_DIR, 'warp_endpoints.json')
                with open(warp_file, 'w') as f:
                    json.dump(data["warp_endpoints"], f, indent=2)
                stats["warp_endpoints"] = len(data["warp_endpoints"])
            except Exception as e:
                print(f"Failed to restore WARP endpoints: {e}")

        # 13. User subscription text
        if included("user_subscription") and data.get("user_subscription"):
            try:
                sub_file = os.path.join(APP_DIR, 'latest_subscription.txt')
                with open(sub_file, 'w', encoding='utf-8') as f:
                    f.write(data["user_subscription"])
                stats["user_subscription"] = "restored"
            except Exception as e:
                print(f"Failed to restore subscription: {e}")

        # 14. Extra small JSON files
        if included("extra_files") and data.get("extra_files"):
            try:
                restored = 0
                for fn, blob in (data["extra_files"] or {}).items():
                    safe_name = os.path.basename(fn)
                    if not safe_name.endswith('.json'):
                        continue
                    try:
                        with open(os.path.join(APP_DIR, safe_name), 'w', encoding='utf-8') as fh:
                            json.dump(blob, fh, indent=2)
                        restored += 1
                    except Exception:
                        pass
                stats["extra_files"] = restored
            except Exception as e:
                print(f"Failed to restore extra files: {e}")

        # 15. Import Scan Results to SQLite
        import aiosqlite
        inserted = 0
        if included("scan_results") and data.get("scan_results"):
            sqlite_path = getattr(db, 'local_db', None)
            sqlite_path = sqlite_path.path if sqlite_path else os.path.join(APP_DIR, 'offline_cache.db')
            async with aiosqlite.connect(sqlite_path) as ldb:
                await ldb.execute("""
                    CREATE TABLE IF NOT EXISTS scan_results (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT, user_ip TEXT, user_location TEXT, user_isp TEXT, vless_uuid TEXT, scanned_ip TEXT,
                        ip_source TEXT, ping REAL, jitter REAL, download REAL, upload REAL, status TEXT, datacenter TEXT, asn TEXT,
                        network_type TEXT, port INTEGER, sni TEXT, app_version TEXT, provider TEXT, synced INTEGER DEFAULT 0
                    )
                """)
                await ldb.commit()
                
                for r in data["scan_results"]:
                    try:
                        await ldb.execute("""
                            INSERT OR IGNORE INTO scan_results 
                            (timestamp, user_ip, user_location, user_isp, vless_uuid, scanned_ip,
                             ip_source, ping, jitter, download, upload, status, datacenter, asn,
                             network_type, port, sni, app_version, provider)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            r.get("timestamp") or str(datetime.now()), 
                            r.get("user_ip") or "Unknown", 
                            r.get("user_location") or "Unknown",
                            r.get("user_isp") or "Unknown", 
                            r.get("vless_uuid") or "Unknown", 
                            r.get("scanned_ip") or "Unknown",
                            r.get("ip_source") or "Unknown", 
                            float(r.get("ping") or -1), 
                            float(r.get("jitter") or -1),
                            float(r.get("download") or -1), 
                            float(r.get("upload") or -1), 
                            r.get("status") or "Unknown",
                            r.get("datacenter") or "Unknown", 
                            r.get("asn") or "Unknown", 
                            r.get("network_type") or "Unknown",
                            int(r.get("port") or 443), 
                            r.get("sni") or "Unknown", 
                            r.get("app_version") or "1.0.0",
                            r.get("provider") or "cloudflare"
                        ))
                    except Exception as ins_e:
                        print(f"Skipped inserting record due to {ins_e}")
                        continue
                    inserted += 1
                await ldb.commit()
        stats["scan_results"] = inserted

        # Append history entry
        try:
            hist_file = os.path.join(APP_DIR, 'backup_import_history.json')
            history = []
            if os.path.exists(hist_file):
                try:
                    with open(hist_file, 'r') as fh:
                        history = json.load(fh)
                except Exception:
                    history = []
            history.insert(0, {
                "imported_at": datetime.now().isoformat(),
                "filename": getattr(file, 'filename', 'bundle.agdb'),
                "size": len(content),
                "sections": list(wanted) if wanted else "all",
                "stats": {k: v for k, v in stats.items() if k != "_manifest"},
            })
            history = history[:50]
            with open(hist_file, 'w') as fh:
                json.dump(history, fh, indent=2)
        except Exception as e:
            print(f"Failed to log import history: {e}")

        return {
            "success": True, 
            "message": "Full import complete! All app data restored for offline use.",
            "stats": stats
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ==========================================
# DATA SYNC: PREVIEW / SNAPSHOTS / HISTORY
# ==========================================

@app.post('/api/data/preview')
async def db_preview(file: UploadFile = File(...), passphrase: Optional[str] = None):
    """Cheap dry-run: decrypt + return manifest only (no DB writes)."""
    from offline_db import peek_manifest
    try:
        content = await file.read()
        return {"success": True, "preview": peek_manifest(content, passphrase=passphrase)}
    except Exception as e:
        return {"success": False, "error": str(e)}


SNAPSHOT_DIR = os.path.join(APP_DIR, 'snapshots')
os.makedirs(SNAPSHOT_DIR, exist_ok=True)


@app.get('/api/data/snapshots')
async def list_snapshots():
    try:
        items = []
        if os.path.isdir(SNAPSHOT_DIR):
            for fn in sorted(os.listdir(SNAPSHOT_DIR), reverse=True):
                p = os.path.join(SNAPSHOT_DIR, fn)
                try:
                    items.append({
                        "name": fn,
                        "size": os.path.getsize(p),
                        "modified": datetime.fromtimestamp(os.path.getmtime(p)).isoformat(),
                    })
                except Exception:
                    pass
        return {"success": True, "snapshots": items[:100]}
    except Exception as e:
        return {"success": False, "error": str(e)}


class SnapshotCreateRequest(BaseModel):
    label: Optional[str] = None
    passphrase: Optional[str] = None
    sections: Optional[str] = None
    scan_limit: int = 50000


@app.post('/api/data/snapshots/create')
async def create_snapshot(req: SnapshotCreateRequest):
    """Create a server-side snapshot bundle (saved under APP_DIR/snapshots/)."""
    try:
        # Re-use db_export by calling it programmatically
        resp = await db_export(sections=req.sections, passphrase=req.passphrase, scan_limit=req.scan_limit)
        if isinstance(resp, dict):  # error return
            return resp
        ts = int(time.time())
        safe_label = ''.join(c for c in (req.label or 'auto') if c.isalnum() or c in '-_')[:40] or 'auto'
        fn = f"snapshot-{safe_label}-{ts}.agdb"
        path = os.path.join(SNAPSHOT_DIR, fn)
        with open(path, 'wb') as f:
            f.write(resp.body)
        # prune to 20 most recent
        try:
            files = sorted(os.listdir(SNAPSHOT_DIR))
            if len(files) > 20:
                for old in files[:-20]:
                    try:
                        os.remove(os.path.join(SNAPSHOT_DIR, old))
                    except Exception:
                        pass
        except Exception:
            pass
        return {"success": True, "name": fn, "size": os.path.getsize(path)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get('/api/data/snapshots/download')
async def download_snapshot(name: str):
    safe = os.path.basename(name)
    path = os.path.join(SNAPSHOT_DIR, safe)
    if not os.path.exists(path):
        return {"success": False, "error": "Snapshot not found"}
    with open(path, 'rb') as f:
        body = f.read()
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={safe}"},
    )


@app.delete('/api/data/snapshots')
async def delete_snapshot(name: str):
    safe = os.path.basename(name)
    path = os.path.join(SNAPSHOT_DIR, safe)
    if os.path.exists(path):
        try:
            os.remove(path)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    return {"success": False, "error": "not found"}


@app.get('/api/data/history')
async def import_history():
    try:
        hist_file = os.path.join(APP_DIR, 'backup_import_history.json')
        if not os.path.exists(hist_file):
            return {"success": True, "history": []}
        with open(hist_file, 'r') as f:
            return {"success": True, "history": json.load(f)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get('/api/data/sections')
async def list_sections():
    """Return list of all known backup sections + human labels for UI."""
    return {
        "success": True,
        "sections": [
            {"key": "settings", "label": "App Settings"},
            {"key": "working_configs", "label": "Working Configs"},
            {"key": "vpn_admin_configs", "label": "VPN CF Subscriptions"},
            {"key": "vpn_admin_vanilla_configs", "label": "VPN Vanilla Subscriptions"},
            {"key": "scan_results", "label": "Scan Results"},
            {"key": "smart_recommendations", "label": "Smart Recommendations"},
            {"key": "analytics", "label": "Analytics"},
            {"key": "geo_analytics", "label": "Geo Analytics"},
            {"key": "country_domains", "label": "Country Domains"},
            {"key": "bypass_profiles", "label": "Bypass Profiles"},
            {"key": "tunnel_deployments", "label": "Tunnel Deployments"},
            {"key": "dns_optimizer_history", "label": "DNS Optimizer History"},
            {"key": "warp_endpoints", "label": "WARP Endpoints"},
            {"key": "freedom_state", "label": "Play Freedom State"},
            {"key": "user_subscription", "label": "User Subscription"},
            {"key": "scan_history_index", "label": "Scan History Index"},
            {"key": "extra_files", "label": "Extra Cache Files"},
        ]
    }

# ==========================================
# PLAY FREEDOM AUTO-PILOT ENDPOINTS
# ==========================================
import freedom_engine

@app.post('/api/freedom/start')
async def freedom_start(background_tasks: BackgroundTasks):
    if freedom_engine.state.status == "running":
        return {"success": False, "message": "Already running"}
    background_tasks.add_task(freedom_engine.run_play_freedom_loop)
    return {"success": True, "message": "Play Freedom started in background!"}

@app.post('/api/freedom/stop')
async def freedom_stop():
    freedom_engine.state._stop_signal = True
    freedom_engine.push_log("User requested stop. Halting loops...")
    if freedom_engine.state.active_scanner_id and freedom_engine.state.active_scanner_id in active_scans:
        active_scans[freedom_engine.state.active_scanner_id]['stop_requested'] = True
    return {"success": True, "message": "Stop signal sent"}

@app.get('/api/freedom/status')
async def freedom_status():
    return {
        "status": freedom_engine.state.status,
        "phase": freedom_engine.state.phase,
        "logs": freedom_engine.state.logs,
        "found_configs": freedom_engine.state.found_configs
    }

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8000)

# ==========================================
# DNS TUNNEL WIZARD ENDPOINTS
# ==========================================
import tunnel_deployer
import dns_scanner_engine
import speed_matrix

class TunnelConnectRequest(BaseModel):
    host: str
    port: int = 22
    username: str = "root"
    password: Optional[str] = None
    private_key: Optional[str] = None

class TunnelDnsVerifyRequest(BaseModel):
    domain: str
    server_ip: Optional[str] = None

class CloudflareDnsRequest(BaseModel):
    api_token: str
    domain: str
    server_ip: str

class TunnelDeployRequest(BaseModel):
    domain: str
    mtu: int = 1232
    socks_auth: bool = False
    socks_user: str = "proxy"
    socks_pass: str = ""
    ssh_tunnel_user: bool = False
    ssh_user: str = "tunnel"
    ssh_pass: str = ""
    add_xray: bool = False
    xray_protocol: str = "vless"

class DnsScanRequest(BaseModel):
    resolvers: Optional[List[str]] = None
    domain: str = "example.com"
    countries: Optional[List[str]] = None
    concurrency: int = 20
    timeout_ms: int = 5000
    protocol: str = "udp"
    do_payload_test: bool = False
    fronting_domain: Optional[str] = None

class DnsQuickTestRequest(BaseModel):
    resolver: str
    domain: str = "example.com"
    protocol: str = "udp"
    utls_fingerprint: Optional[str] = None

class DnsE2ETestRequest(BaseModel):
    resolver: str
    domain: str = "www.cloudflare.com"
    target_url: str = "https://www.cloudflare.com/cdn-cgi/trace"
    timeout_ms: int = 8000
    protocol: str = "udp"

class DnsBestConfigRequest(BaseModel):
    scan_id: str
    domain: str
    pubkey: Optional[str] = None


# --- Tunnel Deployment ---

@app.get('/api/tunnel/health')
async def tunnel_health():
    """Report DNS Tunnel backend dependency status (paramiko/dnspython/requests).

    Frontend uses this to show a clear banner if a Python dep is missing,
    instead of the user seeing cryptic 404/500 errors per click.
    """
    try:
        deps = tunnel_deployer.get_dependency_status()
    except Exception as e:
        deps = {"ok": False, "missing": [f"tunnel_deployer ({e.__class__.__name__})"], "have": {}}
    try:
        scan_deps = dns_scanner_engine.get_dependency_status() if hasattr(dns_scanner_engine, 'get_dependency_status') else {"ok": True}
    except Exception as e:
        scan_deps = {"ok": False, "missing": [f"dns_scanner_engine ({e.__class__.__name__})"]}
    return {
        "ok": bool(deps.get("ok")) and bool(scan_deps.get("ok", True)),
        "deployer": deps,
        "scanner": scan_deps,
        "hint": "If 'ok' is false, run: pip install -r backend/requirements.txt and rebuild the bundled backend."
    }


@app.post('/api/tunnel/connect')
async def tunnel_connect(req: TunnelConnectRequest):
    """Test SSH connection to the target server."""
    result = tunnel_deployer.ssh_connect(
        host=req.host, port=req.port, username=req.username,
        password=req.password, private_key=req.private_key
    )
    return result

@app.post('/api/tunnel/disconnect')
async def tunnel_disconnect():
    """Disconnect SSH."""
    tunnel_deployer.ssh_disconnect()
    return {"success": True}

@app.post('/api/tunnel/preflight')
async def tunnel_preflight():
    """Run pre-flight checks on the connected server."""
    try:
        result = tunnel_deployer.run_preflight()
        return result
    except ConnectionError as e:
        return {"success": False, "message": str(e)}

@app.post('/api/tunnel/fix-port53')
async def tunnel_fix_port53():
    """Disable systemd-resolved's stub listener so port 53 becomes free."""
    try:
        return tunnel_deployer.fix_port53()
    except ConnectionError as e:
        return {"success": False, "message": str(e)}

@app.post('/api/tunnel/verify-dns')
async def tunnel_verify_dns(req: TunnelDnsVerifyRequest):
    """Verify DNS records are properly configured."""
    result = tunnel_deployer.verify_dns_records(req.domain, req.server_ip)
    return result

@app.post('/api/tunnel/cloudflare-dns')
async def tunnel_cloudflare_dns(req: CloudflareDnsRequest):
    """Auto-create DNS records via Cloudflare API."""
    result = tunnel_deployer.cloudflare_create_dns_records(
        api_token=req.api_token, domain=req.domain, server_ip=req.server_ip
    )
    return result

@app.post('/api/tunnel/deploy')
async def tunnel_deploy(req: TunnelDeployRequest, background_tasks: BackgroundTasks):
    """Start the full deployment process."""
    result = tunnel_deployer.start_deployment(
        domain=req.domain, mtu=req.mtu,
        socks_auth=req.socks_auth, socks_user=req.socks_user, socks_pass=req.socks_pass,
        ssh_tunnel_user=req.ssh_tunnel_user, ssh_user=req.ssh_user, ssh_pass=req.ssh_pass,
        add_xray=req.add_xray, xray_protocol=req.xray_protocol
    )
    return result

@app.get('/api/tunnel/deploy/status')
async def tunnel_deploy_status():
    """Get current deployment progress."""
    return tunnel_deployer.get_deployment_status()

@app.post('/api/tunnel/deploy/cancel')
async def tunnel_deploy_cancel():
    """Cancel the current deployment."""
    return tunnel_deployer.cancel_deployment()

@app.get('/api/tunnel/configs')
async def tunnel_get_configs():
    """Get generated configs from the last deployment."""
    return tunnel_deployer.get_tunnel_configs()


# --- Phase 2: Manage existing deployment -----------------------------------

class TunnelUserAddRequest(BaseModel):
    username: str
    password: str

class TunnelUserRemoveRequest(BaseModel):
    username: str

@app.get('/api/tunnel/manage/status')
async def tunnel_manage_status():
    return tunnel_deployer.manage_status()

@app.post('/api/tunnel/manage/restart')
async def tunnel_manage_restart():
    return tunnel_deployer.manage_restart()

@app.get('/api/tunnel/manage/users')
async def tunnel_manage_users_list():
    return tunnel_deployer.manage_users_list()

@app.post('/api/tunnel/manage/users/add')
async def tunnel_manage_users_add(req: TunnelUserAddRequest):
    return tunnel_deployer.manage_users_add(req.username, req.password)

@app.post('/api/tunnel/manage/users/remove')
async def tunnel_manage_users_remove(req: TunnelUserRemoveRequest):
    return tunnel_deployer.manage_users_remove(req.username)

@app.post('/api/tunnel/manage/update')
async def tunnel_manage_update():
    return tunnel_deployer.manage_update()

@app.post('/api/tunnel/manage/uninstall')
async def tunnel_manage_uninstall():
    return tunnel_deployer.manage_uninstall()


# --- Phase 3: Resolver scanner (for tunnel domain) -------------------------

class TunnelResolverScanRequest(BaseModel):
    domain: str
    top_n: int = 10
    timeout_s: float = 2.5

@app.post('/api/tunnel/scan-resolvers')
async def tunnel_scan_resolvers(req: TunnelResolverScanRequest):
    """Probe public DNS resolvers to find which ones can reach the tunnel
    domain. Returns ranked list (best latency first)."""
    return tunnel_deployer.scan_resolvers_for_tunnel(
        domain=req.domain, top_n=req.top_n, timeout_s=req.timeout_s
    )


# --- Phase 4: Add-on protocols + live metrics ------------------------------

class TunnelNaiveInstallRequest(BaseModel):
    domain: str
    username: str
    password: str

class TunnelStunTlsInstallRequest(BaseModel):
    listen_port: int = 443
    ssh_port: int = 22

class TunnelWarpRequest(BaseModel):
    enable: bool = True

@app.post('/api/tunnel/addon/naive/install')
async def tunnel_addon_naive(req: TunnelNaiveInstallRequest):
    return tunnel_deployer.install_naiveproxy(req.domain, req.username, req.password)

@app.post('/api/tunnel/addon/stuntls/install')
async def tunnel_addon_stuntls(req: TunnelStunTlsInstallRequest):
    return tunnel_deployer.install_stuntls(req.listen_port, req.ssh_port)

@app.post('/api/tunnel/addon/warp')
async def tunnel_addon_warp(req: TunnelWarpRequest):
    return tunnel_deployer.toggle_warp(req.enable)

@app.get('/api/tunnel/manage/metrics')
async def tunnel_manage_metrics():
    return tunnel_deployer.get_live_metrics()


# --- DNS Resolver Scanner ---

@app.post('/api/dns-scan/start')
async def dns_scan_start(req: DnsScanRequest):
    """Start a DNS resolver scan."""
    result = dns_scanner_engine.start_dns_scan(
        resolvers=req.resolvers, domain=req.domain,
        countries=req.countries, concurrency=req.concurrency,
        timeout_ms=req.timeout_ms, protocol=req.protocol,
        do_payload_test=req.do_payload_test, fronting_domain=req.fronting_domain
    )
    return result

@app.get('/api/dns-scan/{scan_id}/status')
async def dns_scan_status(scan_id: str):
    """Get DNS scan progress and results."""
    return dns_scanner_engine.get_scan_status(scan_id)

@app.post('/api/dns-scan/{scan_id}/stop')
async def dns_scan_stop(scan_id: str):
    """Stop a running DNS scan."""
    return dns_scanner_engine.stop_scan(scan_id)

@app.post('/api/dns-scan/quick-test')
async def dns_quick_test(req: DnsQuickTestRequest):
    """Test a single resolver immediately."""
    return dns_scanner_engine.quick_test_resolver(req.resolver, req.domain, req.protocol, req.utls_fingerprint)

@app.post('/api/dns-scan/e2e-test')
async def dns_e2e_test(req: DnsE2ETestRequest):
    """End-to-end test: resolve a target host through the resolver, then HTTP-fetch one of the IPs."""
    return dns_scanner_engine.e2e_test_resolver(req.resolver, req.domain, req.target_url, req.timeout_ms, req.protocol)

@app.post('/api/dns-scan/best-config')
async def dns_best_config(req: DnsBestConfigRequest):
    """Get the best connection configuration from scan results."""
    return dns_scanner_engine.get_best_config(req.scan_id, req.domain, req.pubkey)

@app.get('/api/dns-scan/resolvers')
async def dns_get_resolvers():
    """Get the built-in resolver database."""
    return dns_scanner_engine.BUILTIN_RESOLVERS

@app.get('/api/dns-scan/{scan_id}/export')
async def dns_export_scan(scan_id: str, fmt: str = "json"):
    """Export scan results as JSON or CSV."""
    result = dns_scanner_engine.export_scan(scan_id, fmt)
    if fmt == "csv" and isinstance(result, str):
        from starlette.responses import Response
        return Response(content=result, media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=dns_scan_{scan_id}.csv"})
    return result

@app.post('/api/dns-scan/{scan_id}/retest-top')
async def dns_retest_top(scan_id: str, top_n: int = 10, rounds: int = 10):
    """Re-test top N resolvers with more rounds for accuracy."""
    return dns_scanner_engine.retest_top_resolvers(scan_id, top_n, rounds)

@app.get('/api/dns-scan/history')
async def dns_scan_history():
    """Get past scan summaries."""
    return dns_scanner_engine.get_scan_history()

@app.post('/api/dns-scan/generate-config')
async def dns_generate_config(req: dict):
    """Generate tunnel configs from a resolver + domain."""
    return dns_scanner_engine.generate_config(
        req.get("resolver","8.8.8.8"), req.get("domain","example.com"),
        req.get("tunnel_type","auto"), req.get("pubkey")
    )

@app.get('/api/dns-scan/predict-best')
async def dns_predict_best():
    """Predict best resolver using ML heuristics from local history."""
    return dns_scanner_engine.predict_best_resolver()


# ==========================================
# SPEED MATRIX (config × DNS × transport)
# ==========================================

@app.post('/api/speed-matrix/start')
async def speed_matrix_start(req: dict = Body(...)):
    """Run upload/download speed test for every config across every DNS scenario.

    Body: { configs: [str], resolvers: [str], transports: [str], target_url?: str, timeout_ms?: int }
    """
    return speed_matrix.start_matrix_scan(
        configs=req.get('configs') or [],
        resolvers=req.get('resolvers') or [],
        transports=req.get('transports'),
        target_url=req.get('target_url') or 'https://www.cloudflare.com/cdn-cgi/trace',
        timeout_ms=int(req.get('timeout_ms') or 6000),
    )


@app.get('/api/speed-matrix/{scan_id}/status')
async def speed_matrix_status(scan_id: str):
    return speed_matrix.get_matrix_status(scan_id)


@app.post('/api/speed-matrix/{scan_id}/stop')
async def speed_matrix_stop(scan_id: str):
    return speed_matrix.stop_matrix_scan(scan_id)
