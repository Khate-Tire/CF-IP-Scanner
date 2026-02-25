# Copyright (c) 2026 Taher AkbariSaeed
import json
import subprocess
import asyncio
import os
import sys
import atexit
from core_manager import get_xray_path, APP_DIR
import urllib.parse
from dotenv import load_dotenv

# Load .env (PyInstaller-compatible)
if getattr(sys, 'frozen', False):
    _env_path = os.path.join(os.path.dirname(sys.executable), '.env')
else:
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(_env_path):
    load_dotenv(_env_path)

db_xray_process = None

def generate_proxy_config(vless_data, local_port, remote_address, remote_port):
    params = vless_data.get("params", {})
    # Prepare TLS settings
    tls_settings = None
    if params.get("security") == "tls":
        tls_settings = {
            "serverName": params.get("sni", ""),
            "allowInsecure": True,
            "fingerprint": params.get("fp", "")
        }
        if "alpn" in params:
            alpn_val = urllib.parse.unquote(params["alpn"])
            tls_settings["alpn"] = alpn_val.split(",")

    vless_stream_settings = {
        "network": params.get("type", "tcp"),
        "security": params.get("security", "none"),
        "wsSettings": {
            "path": urllib.parse.unquote(params.get("path", "/")),
            "headers": {
                "Host": params.get("host", "")
            }
        } if params.get("type") == "ws" else None,
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
                        "address": vless_data.get("address", "127.0.0.1"),
                        "port": vless_data.get("port", 443),
                        "users": [{
                            "id": vless_data.get("uuid", ""),
                            "encryption": params.get("encryption", "none")
                        }]
                    }]
                },
                "streamSettings": vless_stream_settings
            }
        ]
    }
    return config

import psutil

def stop_db_tunnel():
    global db_xray_process
    if db_xray_process:
        try:
            parent = psutil.Process(db_xray_process.pid)
            for child in parent.children(recursive=True):
                child.kill()
            parent.kill()
            parent.wait(timeout=2)
        except:
            pass
        db_xray_process = None

def start_db_tunnel(vless_parts, target_db_host=None, target_db_port=3306, local_port=33060):
    global db_xray_process
    if target_db_host is None:
        target_db_host = os.environ.get('DB_HOST', '')
    
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
