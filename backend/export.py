import json
# Copyright (c) 2026 Taher AkbariSaeed
import base64
import yaml

def export_base64(ips, vless_parts):
    lines = []
    protocol = vless_parts.get("protocol", "vless")
    for ip in ips:
        params = vless_parts.get('params', {})
        param_str = "&".join([f"{k}={v}" for k, v in params.items()])
        port = vless_parts.get('port', 443)
        url = f"{protocol}://{vless_parts['uuid']}@{ip}:{port}?{param_str}#{ip}"
        lines.append(url)
    raw = "\n".join(lines)
    return base64.b64encode(raw.encode('utf-8')).decode('utf-8')

def export_clash(ips, vless_parts):
    proxies = []
    protocol = vless_parts.get("protocol", "vless")
    for ip in ips:
        params = vless_parts.get('params', {})
        port = vless_parts.get('port', 443)
        proxy = {
            "name": f"CF-{ip}",
            "type": protocol,
            "server": ip,
            "port": int(port),
            "udp": True,
            "sni": params.get("sni", ""),
            "network": params.get("type", "ws")
        }
        if protocol == "vless":
            proxy["uuid"] = vless_parts['uuid']
        else:
            proxy["password"] = vless_parts['uuid']
            
        if params.get("security") == "tls" or params.get("security") == "reality":
            proxy["tls"] = True
        elif params.get("security") == "none":
            proxy["tls"] = False
        
        # Clash Meta specific reality settings
        if params.get("security") == "reality":
            proxy["tls"] = True
            proxy["servername"] = params.get("sni", "")
            proxy["reality-opts"] = {
                "public-key": params.get("pbk", ""),
                "short-id": params.get("sid", "")
            }
            if "fp" in params:
                proxy["client-fingerprint"] = params["fp"]
                
        if proxy["network"] == "ws":
            proxy["ws-opts"] = {
                "path": params.get("path", "/"),
                "headers": {
                    "Host": params.get("host", params.get("sni", ""))
                }
            }
        elif proxy["network"] == "grpc":
            proxy["grpc-opts"] = {
                "grpc-service-name": params.get("serviceName", "")
            }
            
        proxies.append(proxy)
        
    config = {
        "proxies": proxies,
        "proxy-groups": [
            {
                "name": "Proxy",
                "type": "select",
                "proxies": [p["name"] for p in proxies]
            }
        ],
        "rules": [
            "MATCH,Proxy"
        ]
    }
    return yaml.dump(config, sort_keys=False)

def export_singbox(ips, vless_parts):
    outbounds = []
    protocol = vless_parts.get("protocol", "vless")
    for ip in ips:
        params = vless_parts.get('params', {})
        port = vless_parts.get('port', 443)
        outbound = {
            "type": protocol,
            "tag": f"CF-{ip}",
            "server": ip,
            "server_port": int(port)
        }
        if protocol == "vless":
            outbound["uuid"] = vless_parts['uuid']
        else:
            outbound["password"] = vless_parts['uuid']
        if params.get("security") == "tls":
            outbound["tls"] = {
                "enabled": True,
                "server_name": params.get("sni", ""),
                "insecure": True
            }
        elif params.get("security") == "reality":
            outbound["tls"] = {
                "enabled": True,
                "server_name": params.get("sni", ""),
                "reality": {
                    "enabled": True,
                    "public_key": params.get("pbk", ""),
                    "short_id": params.get("sid", "")
                }
            }
            if "fp" in params:
                outbound["tls"]["utls"] = {
                    "enabled": True,
                    "fingerprint": params["fp"]
                }
        
        if params.get("type") == "ws":
            outbound["transport"] = {
                "type": "ws",
                "path": params.get("path", "/"),
                "headers": {
                    "Host": params.get("host", params.get("sni", ""))
                }
            }
        elif params.get("type") == "grpc":
            outbound["transport"] = {
                "type": "grpc",
                "service_name": params.get("serviceName", "")
            }
            
        outbounds.append(outbound)
        
    config = {
        "outbounds": [
            {
                "type": "selector",
                "tag": "select",
                "outbounds": [o["tag"] for o in outbounds]
            }
        ] + outbounds
    }
    return json.dumps(config, indent=2)
