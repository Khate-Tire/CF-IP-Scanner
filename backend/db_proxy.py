import json
import subprocess
import asyncio
import os
import atexit
from core_manager import get_xray_path, APP_DIR
import urllib.parse

db_xray_process = None

def generate_proxy_config(vless_data, local_port, remote_address, remote_port):
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

    vless_stream_settings = {
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

    config = {
        "log": {
            "loglevel": "warning"
        },
        "inbounds": [
            {
                "listen": "127.0.0.1",
                "port": local_port,
                "protocol": "dokodemo-door",
                "settings": {
                    "address": remote_address,
                    "port": remote_port,
                    "network": "tcp"
                }
            }
        ],
        "outbounds": [
            {
                "protocol": "vless",
                "settings": {
                    "vnext": [{
                        "address": vless_data["address"],
                        "port": vless_data["port"],
                        "users": [{
                            "id": vless_data["uuid"],
                            "encryption": vless_data["params"].get("encryption", "none")
                        }]
                    }]
                },
                "streamSettings": vless_stream_settings
            }
        ]
    }
    return config

def stop_db_tunnel():
    global db_xray_process
    if db_xray_process:
        try:
            db_xray_process.terminate()
            db_xray_process.wait(timeout=2)
        except:
            pass
        db_xray_process = None

def start_db_tunnel(vless_parts, target_db_host='aapanel.amnvpn.org', target_db_port=3306, local_port=33060):
    global db_xray_process
    
    stop_db_tunnel()
    
    config = generate_proxy_config(vless_parts, local_port, target_db_host, target_db_port)
    config_path = os.path.join(APP_DIR, "db_proxy_config.json")
    
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
        
    xray_path = get_xray_path()
    
    # Hide terminal window on Windows Pyinstaller builds
    creationflags = 0
    if os.name == 'nt':
        creationflags = subprocess.CREATE_NO_WINDOW
        
    db_xray_process = subprocess.Popen([xray_path, "-c", config_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creationflags)
    
    return True

atexit.register(stop_db_tunnel)
