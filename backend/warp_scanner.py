# Copyright (c) 2026 Taher AkbariSaeed
import asyncio
import aiohttp
import time

async def scan_warp_ip(ip, port=2408):
    start = time.time()
    result = {
        "ip": ip,
        "endpoint": f"{ip}:{port}",
        "ping": -1,
        "datacenter": "Unknown",
        "status": "timeout"
    }
    try:
        # Test HTTP on port 80 to confirm CF edge logic
        async with aiohttp.ClientSession() as session:
            headers = {"Host": "cp.cloudflare.com"}
            async with session.get(f"http://{ip}/cdn-cgi/trace", headers=headers, timeout=5) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    result["ping"] = round((time.time() - start) * 1000, 2)
                    for line in text.splitlines():
                        if line.startswith("colo="):
                            result["datacenter"] = line.split("=")[1].strip()
                    result["status"] = "ok"
    except Exception as e:
        import sys
        print(f"[WARP] Scan error for {ip}:{port} -> {e}", file=sys.stderr)
    return result
