import json
# Copyright (c) 2026 Taher AkbariSaeed
import base64
import yaml

def export_base64(ips, vless_parts):
    lines = []
    protocol = vless_parts.get("protocol", "vless")
    for ip in ips:
        if protocol == "vmess":
            # VMess uses base64-encoded JSON
            params = vless_parts.get('params', {})
            data = {
                "v": "2",
                "ps": ip,
                "add": ip,
                "port": str(vless_parts.get('port', 443)),
                "id": vless_parts['uuid'],
                "aid": params.get("alterId", "0"),
                "scy": params.get("encryption", "auto"),
                "net": params.get("type", "tcp"),
                "type": "none",
                "host": params.get("host", ""),
                "path": params.get("path", "/"),
                "tls": "tls" if params.get("security") == "tls" else "",
                "sni": params.get("sni", ""),
                "alpn": params.get("alpn", ""),
                "fp": params.get("fp", "")
            }
            encoded = base64.b64encode(json.dumps(data).encode()).decode()
            lines.append(f"vmess://{encoded}")
        else:
            # VLESS/Trojan use URI format
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
        elif protocol == "vmess":
            proxy["uuid"] = vless_parts['uuid']
            proxy["alterId"] = int(params.get("alterId", "0"))
            proxy["cipher"] = params.get("encryption", "auto")
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
        elif proxy["network"] == "h2" or proxy["network"] == "http":
            proxy["h2-opts"] = {
                "path": params.get("path", "/"),
                "host": [params.get("host", params.get("sni", ""))]
            }
        elif proxy["network"] == "httpupgrade":
            proxy["ws-opts"] = {
                "path": params.get("path", "/"),
                "headers": {
                    "Host": params.get("host", params.get("sni", ""))
                },
                "v2ray-http-upgrade": True
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
        elif protocol == "vmess":
            outbound["uuid"] = vless_parts['uuid']
            outbound["alter_id"] = int(params.get("alterId", "0"))
            outbound["security"] = params.get("encryption", "auto")
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
        elif params.get("type") in ("h2", "http"):
            outbound["transport"] = {
                "type": "http",
                "path": params.get("path", "/"),
                "host": [params.get("host", params.get("sni", ""))]
            }
        elif params.get("type") == "httpupgrade":
            outbound["transport"] = {
                "type": "httpupgrade",
                "path": params.get("path", "/"),
                "host": params.get("host", params.get("sni", ""))
            }
        elif params.get("type") in ("xhttp", "splithttp"):
            outbound["transport"] = {
                "type": "http",
                "path": params.get("path", "/"),
                "host": [params.get("host", params.get("sni", ""))]
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
