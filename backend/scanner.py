import json
import subprocess
import time
import asyncio
import aiohttp
from aiohttp_socks import ProxyConnector
import os
import random
from core_manager import get_xray_path
import urllib.parse

def parse_vless(vless_url: str):
    if not vless_url.startswith("vless://"):
        raise ValueError("Invalid VLESS URL")
    
    parts = vless_url.replace("vless://", "").split("@")
    uuid = parts[0]
    rest = parts[1].split("?")
    address_port = rest[0].split(":")
    address = address_port[0]
    port = int(address_port[1])
    
    params = {}
    if len(rest) > 1:
        param_str = rest[1].split("#")[0]
        for p in param_str.split("&"):
            if "=" in p:
                k, v = p.split("=")
                params[k] = v
                
    return {
        "uuid": uuid,
        "address": address,
        "port": port,
        "params": params
    }

def generate_xray_config(vless_data, target_ip, local_port):
    # Prepare TLS settings
    tls_settings = None
    if vless_data["params"].get("security") == "tls":
        tls_settings = {
            "serverName": vless_data["params"].get("sni", ""),
            "allowInsecure": True,
            "fingerprint": vless_data["params"].get("fp", "")
        }
        if "alpn" in vless_data["params"]:
            alpn_val = urllib.parse.unquote(vless_data["params"]["alpn"])
            tls_settings["alpn"] = alpn_val.split(",")

    config = {
        "log": {"loglevel": "none"},
        "inbounds": [{
            "port": local_port,
            "protocol": "socks",
            "settings": {"auth": "noauth", "udp": True},
            "sniffing": {"enabled": True, "destOverride": ["http", "tls"]}
        }],
        "outbounds": [{
            "protocol": "vless",
            "settings": {
                "vnext": [{
                    "address": target_ip,
                    "port": vless_data["port"],
                    "users": [{
                        "id": vless_data["uuid"],
                        "encryption": vless_data["params"].get("encryption", "none")
                    }]
                }]
            },
            "streamSettings": {
                "network": vless_data["params"].get("type", "tcp"),
                "security": vless_data["params"].get("security", "none"),
                "wsSettings": {
                    "path": urllib.parse.unquote(vless_data["params"].get("path", "/")),
                    "headers": {
                        "Host": vless_data["params"].get("host", "")
                    }
                } if vless_data["params"].get("type") == "ws" else None,
                 "tlsSettings": tls_settings
            }
        }]
    }
    return config

async def measure_ping(session, url):
    start = time.time()
    try:
        async with session.get(url, timeout=10) as response:
            if response.status == 204 or response.status == 200:
                duration = (time.time() - start) * 1000
                return duration
    except Exception as e:
        # print(f"Ping Error: {e}")
        return -1
    return -1

async def measure_speed(session, url, size_mb=1, is_upload=False):
    start = time.time()
    try:
        if is_upload:
            # Upload 1MB
            data = b'0' * (1024 * 1024 * size_mb) 
            async with session.post(url, data=data, timeout=20) as response:
                 # Accept 200 or 204 or even others if stream worked
                if response.status < 400:
                    duration = time.time() - start
                    if duration > 0:
                        speed_mbps = (size_mb * 8) / duration
                        return speed_mbps
        else:
            # Download
            async with session.get(url, timeout=20) as response:
                 await response.read()
                 duration = time.time() - start
                 if duration > 0:
                     speed_mbps = (size_mb * 8) / duration
                     return speed_mbps
    except Exception as e:
        pass
    return 0

def reconstruct_vless(parts, new_ip):
    # Rebuild the VLESS URL with the new IP
    query = "&".join([f"{k}={v}" for k, v in parts["params"].items()])
    # Preserve original remark if possible, but here we don't have it stored separately in parts. 
    # Usually it's extracting from the end. Let's just use a generic one or try to keep it.
    # For now, we will use a generated remark
    
    # We need to construct the URL
    base = f"vless://{parts['uuid']}@{new_ip}:{parts['port']}"
    url = f"{base}?{query}#IP-{new_ip}"
    return url

async def scan_ip(ip, vless_parts, thresholds, speed_sem=None):
    ip = ip.strip()
    if not ip: return {"status": "error"}
    
    local_port = random.randint(10000, 20000)
    config = generate_xray_config(vless_parts, ip, local_port)
    
    safe_ip = ip.replace(":", "_")
    config_path = f"config_{safe_ip}_{local_port}.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
        
    xray_path = get_xray_path()
    process = subprocess.Popen([xray_path, "-c", config_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    await asyncio.sleep(2) 
    
    connector = ProxyConnector.from_url(f"socks5://127.0.0.1:{local_port}")
    
    result = {
        "ip": ip, 
        "ping": -1, 
        "jitter": -1, 
        "download": -1, 
        "upload": -1,
        "status": "timeout",
        "link": ""
    }
    
    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            # 1. PING & JITTER
            pings = []
            test_url = "http://cp.cloudflare.com/generate_204"
            
            # Warmup with Retry
            warmup_success = False
            for _ in range(2):
                if await measure_ping(session, test_url) != -1:
                    warmup_success = True
                    break
                await asyncio.sleep(1)
            
            if not warmup_success:
                 result["status"] = "unreachable"
                 raise Exception("Warmup failed")

            for _ in range(5):
                p = await measure_ping(session, test_url)
                if p != -1:
                    pings.append(p)
                await asyncio.sleep(0.2)
            
            if not pings:
                 result["status"] = "timeout"
                 raise Exception("All pings failed")

            avg_ping = sum(pings) / len(pings)
            jitter = max(pings) - min(pings)
            result["ping"] = round(avg_ping, 2)
            result["jitter"] = round(jitter, 2)
            
            # FAIL-FAST CHECK: PING
            if avg_ping > thresholds.get("max_ping", 1000):
                result["status"] = "high_ping"
                return result # STOP HERE
            
            # FAIL-FAST CHECK: JITTER
            if jitter > thresholds.get("max_jitter", 1000):
                result["status"] = "high_jitter"
                return result # STOP HERE

            # Tentatively set status to scanning_speed or similar if needed, 
            # but we just wait to set 'ok' until the end.
            
            sem_ctx = speed_sem if speed_sem else asyncio.Semaphore(1)
            
            async with sem_ctx:
                 # 2. DOWNLOAD SPEED
                 download_url = "http://speed.cloudflare.com/__down?bytes=1000000" 
                 speed_down = await measure_speed(session, download_url, size_mb=1, is_upload=False)
                 result["download"] = round(speed_down, 2)
                 
                 # Force fail if speed is 0 or low
                 if speed_down <= 0 or speed_down < thresholds.get("min_download", 0):
                     result["status"] = "low_download"
                     return result

                 # 3. UPLOAD SPEED
                 upload_url = "http://speed.cloudflare.com/__up"
                 speed_up = await measure_speed(session, upload_url, size_mb=1, is_upload=True)
                 result["upload"] = round(speed_up, 2)
                 
                 if speed_up <= 0 or speed_up < thresholds.get("min_upload", 0):
                     result["status"] = "low_upload"
                     return result

                 # PASSED ALL
                 result["status"] = "ok"
                 result["link"] = reconstruct_vless(vless_parts, ip)

    except Exception as e:
        # print(f"Scan fatal error {ip}: {e}")
        pass
    finally:
        process.terminate()
        try:
             outs, errs = process.communicate(timeout=1)
        except:
             pass

        try:
            os.remove(config_path)
        except:
            pass
            
    return result
