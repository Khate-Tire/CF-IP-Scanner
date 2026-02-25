import json
import subprocess
import time
# Copyright (c) 2026 Taher AkbariSaeed
import asyncio
import aiohttp
from aiohttp_socks import ProxyConnector
import os
import random
from core_manager import get_xray_path, APP_DIR
import urllib.parse
import socket
import ssl

def parse_vless(vless_url: str):
    try:
        protocol = "vless"
        url_stripped = vless_url.strip()
        if url_stripped.startswith("vless://"):
            url_stripped = url_stripped.replace("vless://", "", 1)
        elif url_stripped.startswith("trojan://"):
            protocol = "trojan"
            url_stripped = url_stripped.replace("trojan://", "", 1)
        else:
            raise ValueError("Invalid URL: Must be vless:// or trojan://")
        
        parts = url_stripped.split("@")
        if len(parts) < 2:
            raise ValueError("Invalid format: missing '@' separator")
            
        uuid = parts[0]
        rest = parts[1].split("?")
        
        address_port = rest[0].split(":")
        if len(address_port) < 2:
            raise ValueError("Invalid format: missing port suffix")
            
        address = address_port[0]
        # Strip trailing slashes or weird chars from port
        port_raw = "".join(filter(str.isdigit, address_port[1]))
        if not port_raw:
            port = 443 # default
        else:
            port = int(port_raw)
        
        params = {}
        if len(rest) > 1:
            # Handle potential #name fragment
            param_str = rest[1].split("#")[0]
            for p in param_str.split("&"):
                if "=" in p:
                    k, v = p.split("=", 1)
                    params[k] = v
                    
        return {
            "protocol": protocol,
            "uuid": uuid,
            "address": address,
            "port": port,
            "params": params
        }
    except Exception as e:
        print(f"Error parsing VLESS/Trojan URI: {e}")
        # Return a safe fallback to prevent crashes down the line
        return {
            "protocol": "vless",
            "uuid": "invalid",
            "address": "127.0.0.1",
            "port": 443,
            "params": {}
        }

def generate_xray_config(vless_data, target_ip, local_port, test_port=None, fragment=None, test_sni=None, advanced_dns_config=None):
    params = vless_data.get("params", {})
    # Prepare TLS settings
    tls_settings = None
    if params.get("security") == "tls":
        tls_settings = {
            "serverName": test_sni if test_sni else params.get("sni", ""),
            "allowInsecure": True,
            "fingerprint": params.get("fp", "")
        }
        if "alpn" in params:
            alpn_val = urllib.parse.unquote(params["alpn"])
            tls_settings["alpn"] = alpn_val.split(",")

    vless_stream_settings = {
        "network": params.get("type", "tcp"),
        "security": params.get("security", "none"),
        "sockopt": {
            "tcpNoDelay": True,
            "tcpKeepAliveIdle": 30,
            "tcpKeepAliveInterval": 15,
            "tcpUserTimeout": 10000,
            "tcpMaxSeg": 1440
        },
        "wsSettings": {
            "path": urllib.parse.unquote(params.get("path", "/")),
            "headers": {
                "Host": test_sni if test_sni else params.get("host", "")
            }
        } if params.get("type") == "ws" else None,
        "tlsSettings": tls_settings,
        "realitySettings": {
            "serverName": test_sni if test_sni else params.get("sni", ""),
            "fingerprint": params.get("fp", "chrome"),
            "publicKey": params.get("pbk", ""),
            "shortId": params.get("sid", ""),
            "spiderX": params.get("spx", "/")
        } if params.get("security") == "reality" else None
    }

    outbounds = [{
        "protocol": vless_data.get("protocol", "vless"),
        "settings": {
            "vnext": [{
                "address": target_ip,
                "port": test_port if test_port is not None else vless_data.get("port", 443),
                "users": [{
                    "id": vless_data.get("uuid", ""),
                    "encryption": params.get("encryption", "none"),
                    "flow": params.get("flow", "")
                }] if vless_data.get("protocol", "vless") == "vless" else [{
                    "password": vless_data.get("uuid", "")
                }]
            }]
        },
        "streamSettings": vless_stream_settings
    }]

    if fragment:
        vless_stream_settings["sockopt"] = {
            "dialerProxy": "fragment",
            "tcpKeepAliveIdle": 100,
            "tcpNoDelay": True
        }
        outbounds.append({
            "protocol": "freedom",
            "tag": "fragment",
            "domainStrategy": "UseIP",
            "sniffing": {
                "enabled": True,
                "destOverride": ["http", "tls"]
            },
            "settings": {
                "fragment": {
                    "packets": fragment.get("packets", "tlshello"),
                    "length": fragment.get("length", "10-20"),
                    "interval": fragment.get("interval", "10-20")
                }
            },
            "streamSettings": {
                "sockopt": {
                    "tcpNoDelay": True,
                    "tcpKeepAliveIdle": 100
                }
            }
        })

    config = {
        "log": {"loglevel": "none"},
        "inbounds": [{
            "port": local_port,
            "protocol": "socks",
            "settings": {"auth": "noauth", "udp": True},
            "sniffing": {"enabled": True, "destOverride": ["http", "tls"]}
        }],
        "outbounds": outbounds
    }

    if advanced_dns_config:
        dns_server = advanced_dns_config.get("server") or "8.8.8.8"
        config["dns"] = {
            "servers": [dns_server],
            "queryStrategy": "UseIP"
        }
        config["routing"] = {
            "domainStrategy": "AsIs",
            "rules": [
                {"type": "field", "port": 53, "outboundTag": "dns-out"},
            ]
        }
        config["outbounds"].append({
            "protocol": "dns",
            "tag": "dns-out"
        })
        
        # Apply uTLS fingerprint override if provided
        utls_fp = advanced_dns_config.get("utls_fingerprint")
        if utls_fp:
            for ob in config["outbounds"]:
                ss = ob.get("streamSettings", {})
                if ss.get("tlsSettings"):
                    ss["tlsSettings"]["fingerprint"] = utls_fp
                if ss.get("realitySettings"):
                    ss["realitySettings"]["fingerprint"] = utls_fp

    return config

async def tcp_ping(ip: str, port: int = 443, timeout: float = 2.0) -> bool:
    try:
        fut = asyncio.open_connection(ip, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False

async def measure_ping(session, url, check_status_cb=None):
    if check_status_cb:
        while check_status_cb() == 'paused':
            await asyncio.sleep(0.5)
        if check_status_cb() not in ['running', 'paused']:
            return -1

    start = time.time()
    try:
        async with session.get(url, timeout=12) as response:
            if response.status == 204 or response.status == 200:
                duration = (time.time() - start) * 1000
                return duration
    except Exception as e:
        # print(f"Ping Error: {e}")
        return -1
    return -1

def check_tls_cert_sync(ip, port=443, sni=None):
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        with socket.create_connection((ip, port), timeout=3) as sock:
            with ctx.wrap_socket(sock, server_hostname=sni or "cloudflare.com") as ssock:
                cert = ssock.getpeercert()
                issuer = dict(x[0] for x in cert.get('issuer', []))
                org = issuer.get('organizationName', '')
                subject = dict(x[0] for x in cert.get('subject', []))
                subj_cn = subject.get('commonName', '')
                
                valid_orgs = ['Cloudflare', 'Google Trust Services', "Let's Encrypt", 'DigiCert', 'GlobalSign']
                is_valid_org = any(vo in org for vo in valid_orgs)
                is_valid_subj = 'cloudflare' in subj_cn.lower() or 'sni.cloudflaressl.com' in subj_cn.lower()
                
                return is_valid_org or is_valid_subj
    except Exception as e:
        return False

async def verify_cloudflare_tls(ip, port=443, sni=None):
    return await asyncio.to_thread(check_tls_cert_sync, ip, port, sni)

async def measure_speed(session, url, size_mb=1, is_upload=False, check_status_cb=None):
    if check_status_cb:
        while check_status_cb() == 'paused':
            await asyncio.sleep(0.5)
        if check_status_cb() not in ['running', 'paused']:
            return 0

    start = time.time()
    try:
        if is_upload:
            # Upload 1MB
            data = b'0' * (1024 * 1024 * size_mb) 
            async with session.post(url, data=data, timeout=25) as response:
                 # Accept 200 or 204 or even others if stream worked
                if response.status < 400:
                    duration = time.time() - start
                    if duration > 0:
                        speed_mbps = (size_mb * 8) / duration
                        return speed_mbps
        else:
            # Download
            async with session.get(url, timeout=25) as response:
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

async def scan_ip(ip, vless_parts, thresholds, speed_sem=None, test_port=None, fragment=None, test_sni=None, verify_tls=False, check_status_cb=None, provider="cloudflare", advanced_dns_config=None):
    ip = ip.strip()
    if not ip: return {"status": "error"}
    
    if check_status_cb:
        while check_status_cb() == 'paused':
            await asyncio.sleep(0.5)
        if check_status_cb() not in ['running', 'paused']:
            return {"status": "abort"}
    
    local_port = random.randint(10000, 20000)
    config = generate_xray_config(vless_parts, ip, local_port, test_port=test_port, fragment=fragment, test_sni=test_sni, advanced_dns_config=advanced_dns_config)
    
    safe_ip = ip.replace(":", "_")
    config_path = os.path.join(APP_DIR, f"config_{safe_ip}_{local_port}.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
        
    xray_path = get_xray_path()
    
    # Hide terminal window on Windows Pyinstaller builds
    creationflags = 0
    if os.name == 'nt':
        creationflags = subprocess.CREATE_NO_WINDOW
        
    process = subprocess.Popen([xray_path, "-c", config_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creationflags)
    
    # FIX #3: Adaptive Xray boot - poll readiness instead of fixed 2s wait
    connector = ProxyConnector.from_url(f"socks5://127.0.0.1:{local_port}")
    xray_ready = False
    for _ in range(10):  # Up to 5 seconds (10 x 500ms)
        await asyncio.sleep(0.5)
        try:
            async with aiohttp.ClientSession(connector=ProxyConnector.from_url(f"socks5://127.0.0.1:{local_port}")) as probe:
                async with probe.get("http://cp.cloudflare.com/generate_204", timeout=2) as r:
                    if r.status in [200, 204]:
                        xray_ready = True
                        break
        except:
            pass
    
    result = {
        "ip": ip, 
        "ping": -1, 
        "jitter": -1, 
        "download": -1, 
        "upload": -1,
        "status": "timeout",
        "datacenter": "Unknown",
        "link": ""
    }
    
    if verify_tls:
        if check_status_cb:
            while check_status_cb() == 'paused':
                await asyncio.sleep(0.5)
            if check_status_cb() not in ['running', 'paused']:
                result["status"] = "abort"
                return result

        is_valid_tls = await verify_cloudflare_tls(ip, port=test_port or vless_parts.get('port', 443), sni=test_sni or vless_parts['params'].get('sni'))
        if not is_valid_tls:
            result["status"] = "compromised"
            return result

    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            # 1. PING & JITTER
            pings = []
            test_url = "http://cp.cloudflare.com/generate_204"
            
            # Warmup with Retry (skip if adaptive boot already confirmed)
            if not xray_ready:
                warmup_success = False
                for _ in range(5):
                    if await measure_ping(session, test_url, check_status_cb) != -1:
                        warmup_success = True
                        break
                    await asyncio.sleep(2)
                
                if not warmup_success:
                     result["status"] = "unreachable"
                     raise Exception("Warmup failed")
            
            # FIX #5: Post-warmup cooldown - let TLS session stabilize
            await asyncio.sleep(0.5)

            # FIX #1: Run 6 pings, drop the first (cold-start TLS overhead)
            for i in range(6):
                p = await measure_ping(session, test_url, check_status_cb)
                if p != -1:
                    if i == 0:
                        pass  # Discard first ping (cold-start bias)
                    else:
                        pings.append(p)
                await asyncio.sleep(0.2)
            
            if not pings:
                 result["status"] = "timeout"
                 raise Exception("All pings failed")

            avg_ping = sum(pings) / len(pings)
            jitter = max(pings) - min(pings)
            result["ping"] = round(avg_ping, 2)
            result["jitter"] = round(jitter, 2)
            
            # Extract Datacenter Colo
            if provider == 'fastly':
                 # Fastly POP check
                 try:
                     async with session.get("http://www.fastly.com", timeout=5) as t_resp:
                         if 'x-served-by' in t_resp.headers:
                             served_by = t_resp.headers['x-served-by']
                             # extract POP, e.g. cache-iad-kiad7000185-IAD -> IAD
                             parts = served_by.split('-')
                             if len(parts) >= 2:
                                  result["datacenter"] = "Fastly-" + parts[-1].upper()
                             else:
                                  result["datacenter"] = "Fastly-Edge"
                         else:
                             result["datacenter"] = "Fastly-Edge"
                 except:
                     result["datacenter"] = "Fastly-Edge"
            else:
                 # Default Cloudflare Colo Check
                 try:
                     async with session.get("http://cp.cloudflare.com/cdn-cgi/trace", timeout=5) as t_resp:
                         if t_resp.status == 200:
                             trace_text = await t_resp.text()
                             for line in trace_text.splitlines():
                                 if line.startswith("colo="):
                                     result["datacenter"] = line.split("=")[1].strip()
                                     break
                 except:
                     pass
            
            # FIX #4: Borderline retry - 10% grace margin
            max_ping_threshold = thresholds.get("max_ping", 1000)
            max_jitter_threshold = thresholds.get("max_jitter", 1000)
            
            # FAIL-FAST CHECK: PING (with grace margin retry)
            if avg_ping > max_ping_threshold:
                # If within 10% grace, retry once
                if avg_ping <= max_ping_threshold * 1.1:
                    retry_pings = []
                    for _ in range(3):
                        p = await measure_ping(session, test_url, check_status_cb)
                        if p != -1:
                            retry_pings.append(p)
                        await asyncio.sleep(0.2)
                    if retry_pings:
                        avg_ping = sum(retry_pings) / len(retry_pings)
                        result["ping"] = round(avg_ping, 2)
                if avg_ping > max_ping_threshold:
                    result["status"] = "high_ping"
                    return result
            
            # FAIL-FAST CHECK: JITTER (with grace margin retry)
            if jitter > max_jitter_threshold:
                if jitter <= max_jitter_threshold * 1.1:
                    retry_pings = []
                    for _ in range(3):
                        p = await measure_ping(session, test_url, check_status_cb)
                        if p != -1:
                            retry_pings.append(p)
                        await asyncio.sleep(0.2)
                    if len(retry_pings) >= 2:
                        jitter = max(retry_pings) - min(retry_pings)
                        result["jitter"] = round(jitter, 2)
                if jitter > max_jitter_threshold:
                    result["status"] = "high_jitter"
                    return result

            sem_ctx = speed_sem if speed_sem else asyncio.Semaphore(1)
            
            async with sem_ctx:
                 # FIX #2: Best-of-2 speed tests
                 download_url = "http://speed.cloudflare.com/__down?bytes=1000000" 
                 
                 # 2. DOWNLOAD SPEED (best of 2)
                 speed_down_1 = await measure_speed(session, download_url, size_mb=1, is_upload=False, check_status_cb=check_status_cb)
                 speed_down_2 = await measure_speed(session, download_url, size_mb=1, is_upload=False, check_status_cb=check_status_cb)
                 speed_down = max(speed_down_1, speed_down_2)
                 result["download"] = round(speed_down, 2)
                 
                 if speed_down <= 0 or speed_down < thresholds.get("min_download", 0):
                     result["status"] = "low_download"
                     return result

                 # 3. UPLOAD SPEED (best of 2)
                 upload_url = "http://speed.cloudflare.com/__up"
                 speed_up_1 = await measure_speed(session, upload_url, size_mb=1, is_upload=True, check_status_cb=check_status_cb)
                 speed_up_2 = await measure_speed(session, upload_url, size_mb=1, is_upload=True, check_status_cb=check_status_cb)
                 speed_up = max(speed_up_1, speed_up_2)
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
        import psutil
        try:
            parent = psutil.Process(process.pid)
            for child in parent.children(recursive=True):
                child.kill()
            parent.kill()
            parent.wait(timeout=2)
        except psutil.NoSuchProcess:
            pass
        except Exception:
            try:
                 process.terminate()
                 process.wait(timeout=1)
            except:
                 pass

        try:
            os.remove(config_path)
        except:
            pass
            
    return result
