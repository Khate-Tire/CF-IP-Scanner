from fastapi import FastAPI, BackgroundTasks, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio
import uuid
from typing import List, Dict, Optional
import json
import os
import json
import os
import time
import random

from scanner import scan_ip, parse_vless
from cf_ips import get_random_ips, update_cf_ranges
from core_manager import download_xray
import aiohttp

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Settings(BaseModel):
    concurrency: int = 5
    stop_after: int = 10
    max_ping: int = 800
    max_jitter: int = 200
    min_download: float = 0
    min_upload: float = 0

SETTINGS_FILE = "settings.json"

def load_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r") as f:
                return Settings(**json.load(f))
    except:
        pass
    return Settings()

def save_settings(settings: Settings):
    try:
        with open(SETTINGS_FILE, "w") as f:
            json.dump(settings.dict(), f, indent=2)
    except:
        pass

class ScanRequest(BaseModel):
    vless_config: str
    max_ping: int = 1000
    max_jitter: int = 1000
    min_download: float = 0 # Mbps
    min_upload: float = 0 # Mbps
    ip_count: int = 20
    manual_ips: Optional[List[str]] = None
    stop_after: int = 10
    concurrency: int = 5
    ip_version: str = "all"

# Global state
active_scans: Dict[str, Dict] = {}
results: Dict[str, List] = {}

@app.on_event("startup")
def startup_event():
    # Ensure Xray is ready
    download_xray()
    # Update IP ranges
    update_cf_ranges()

@app.get("/settings")
def get_settings():
    return load_settings()

@app.post("/settings")
def update_settings(settings: Settings):
    save_settings(settings)
    save_settings(settings)
    return settings

@app.get("/my-ip")
async def get_my_ip():
    try:
        # Fetch own IP info
        async with aiohttp.ClientSession() as session:
            async with session.get("http://ip-api.com/json/", timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {
                        "ip": data.get("query", "Unknown"),
                        "location": f"{data.get('country', '')} - {data.get('city', '')}",
                        "isp": data.get("isp", "Unknown")
                    }
    except:
        pass
    return {"ip": "Unknown", "location": "Unknown", "isp": "Unknown"}

@app.post("/scan")
async def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    # Auto-save settings on scan start
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
        return {"error": f"Invalid config: {str(e)}"}
    
    active_scans[scan_id] = {
        "status": "running", 
        "total": req.ip_count, 
        "completed": 0, 
        "found_good": 0, 
        "logs": [],
        "stats": {
            "scanned": 0,
            "high_ping": 0,
            "high_jitter": 0,
            "low_download": 0,
            "low_upload": 0,
            "timeout": 0,
            "unreachable": 0,
            "error": 0
        }
    }
    results[scan_id] = []
    
    if req.manual_ips and len(req.manual_ips) > 0:
        import ipaddress
        # Expand CIDRs
        expanded_ips = []
        for item in req.manual_ips:
            item = item.strip()
            if "/" in item:
                try:
                    net = ipaddress.ip_network(item, strict=False)
                    # Limit expansion to avoid memory explosion (e.g. limit to 100k or just let it be)
                    # A /16 is 65k, /13 is 500k. 500k is fine in memory.
                    for ip in net:
                        expanded_ips.append(str(ip))
                except:
                    pass
            else:
                expanded_ips.append(item)
        
        # Shuffle specifically for ranges to avoid getting stuck in sequential dead blocks
        if len(expanded_ips) > 100:
            random.shuffle(expanded_ips)
            
        ips_source = expanded_ips 
        active_scans[scan_id]["total"] = len(ips_source)
    else:
        ips_source = None # Dynamic Mode
        active_scans[scan_id]["total"] = req.ip_count
    
    background_tasks.add_task(run_scan_job, scan_id, ips_source, vless_parts, req)
    
    return {"scan_id": scan_id}

async def enrich_ip_data(ip):
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://ip-api.com/json/{ip}?fields=country,city,isp", timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return f"{data.get('country', '')} - {data.get('city', '')} ({data.get('isp', '')})"
    except:
        pass
    return "Unknown"

def add_log(scan_id, message):
    if scan_id in active_scans:
        # Keep only last 100 logs
        logs = active_scans[scan_id]["logs"]
        timestamp = time.strftime("%H:%M:%S")
        logs.append(f"[{timestamp}] {message}")
        if len(logs) > 100:
            active_scans[scan_id]["logs"] = logs[-100:]

async def run_scan_job(scan_id, ips_static, vless_parts, req):
    try:
        thresholds = {
            "max_ping": req.max_ping, 
            "max_jitter": req.max_jitter,
            "min_download": req.min_download,
            "min_upload": req.min_upload
        }
        
        from cf_ips import get_smart_ip, report_good_ip
        
        # Dual Semaphore Strategy
        discovery_sem = asyncio.Semaphore(req.concurrency * 5)
        speed_sem = asyncio.Semaphore(req.concurrency) 
        
        good_ips_count = 0
        scanned_count = 0
        
        # In Manual Mode, we stop after checking all provided IPs.
        # In Smart Discovery Mode, we keep going until we find enough Good IPs (or hit a safety limit).
        if ips_static:
            target_count = len(ips_static)
            mode_name = "Manual"
        else:
            target_count = 100000 # Effectively infinite for this session
            mode_name = "Smart Discovery"
        
        add_log(scan_id, f"Started scan. Goal: Find {req.stop_after} Good IPs. Threads: {req.concurrency}. Mode: {mode_name}")
        
        running_tasks = set()
        
        async def bounded_scan(ip):
            nonlocal good_ips_count
            if active_scans[scan_id]["status"] != "running": return
            
            async with discovery_sem:
                add_log(scan_id, f"Checking {ip}...")
                res = await scan_ip(ip, vless_parts, thresholds, speed_sem)
                
                # Update Stats
                if "stats" in active_scans[scan_id]:
                    stats = active_scans[scan_id]["stats"]
                    stats["scanned"] += 1
                    
                    status_key = res["status"]
                    if status_key == "ok":
                        pass 
                    elif status_key == "high_ping":
                        stats["high_ping"] += 1
                    elif status_key == "high_jitter":
                        stats["high_jitter"] += 1
                    elif status_key == "low_download":
                        stats["low_download"] += 1
                    elif status_key == "low_upload":
                        stats["low_upload"] += 1
                    elif status_key == "unreachable":
                        stats["unreachable"] += 1
                    elif status_key == "timeout":
                        stats["timeout"] += 1
                    else:
                        stats["error"] += 1

                is_good = res["status"] == "ok"
                
                if is_good:
                    add_log(scan_id, f"GOOD IP FOUND: {ip} (Ping: {res['ping']}ms, DL: {res['download']}Mbps)")
                    # Feedback loop
                    report_good_ip(ip)
                    
                    res["location"] = await enrich_ip_data(ip)
                    good_ips_count += 1
                    active_scans[scan_id]["found_good"] = good_ips_count
                else:
                    add_log(scan_id, f"Failed {ip}: {res['status']}")
                
                results[scan_id].append(res)
                active_scans[scan_id]["completed"] += 1
                
                if good_ips_count >= req.stop_after:
                    add_log(scan_id, "Limit reached. Stopping scan.")
                    active_scans[scan_id]["status"] = "completed"

        while active_scans[scan_id]["status"] == "running":
            # Check stop conditions
            if good_ips_count >= req.stop_after: break
            if scanned_count >= target_count: break
            
            # Fill pool
            while len(running_tasks) < req.concurrency * 5 and scanned_count < target_count:
                if active_scans[scan_id]["status"] != "running": break
                
                if ips_static:
                    ip = ips_static[scanned_count]
                else:
                    ip = get_smart_ip(req.ip_version)
                    
                task = asyncio.create_task(bounded_scan(ip))
                running_tasks.add(task)
                task.add_done_callback(running_tasks.discard)
                scanned_count += 1
                
            if not running_tasks:
                break
                
            await asyncio.sleep(0.1) # Yield to event loop
            
        # Wait for remaining
        if running_tasks:
            await asyncio.gather(*running_tasks)
        
        active_scans[scan_id]["status"] = "completed"
        add_log(scan_id, "Scan finished.")
        
        # Save Results
        try:
            os.makedirs("results", exist_ok=True)
            good_results = [r for r in results[scan_id] if r["status"] == "ok"]
            if good_results:
                with open(f"results/scan_{scan_id}.json", "w") as f:
                    json.dump(good_results, f, indent=2)
        except:
            pass

    except Exception as e:
        import traceback
        err_msg = f"Fatal Scan Error: {str(e)}\n{traceback.format_exc()}"
        print(err_msg)
        add_log(scan_id, f"CRITICAL ERROR: {str(e)}")
        active_scans[scan_id]["status"] = "failed"

@app.get("/scan/{scan_id}")
def get_scan_status(scan_id: str):
    if scan_id not in active_scans:
        return {"error": "Scan not found"}
    
    # Filter only OK results for the frontend table
    all_results = results[scan_id]
    valid_results = [r for r in all_results if r.get("status") == "ok"]
    
    return {
        "status": active_scans[scan_id],
        "results": sorted(valid_results, key=lambda x: x.get("ping", 9999))
    }

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
