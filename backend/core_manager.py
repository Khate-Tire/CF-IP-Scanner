# Copyright (c) 2026 Taher AkbariSaeed
import os
import urllib.request
import zipfile
import subprocess
import platform

APP_DIR = os.path.join(os.path.expanduser("~"), ".antigravity_scanner")
XRAY_URL = "https://github.com/XTLS/Xray-core/releases/download/v1.8.4/Xray-windows-64.zip"
XRAY_DIR = os.path.join(APP_DIR, "xray_core")
XRAY_EXE = os.path.join(XRAY_DIR, "xray.exe")

def download_xray():
    if not os.path.exists(APP_DIR):
        os.makedirs(APP_DIR, exist_ok=True)
        
    if not os.path.exists(XRAY_DIR):
        os.makedirs(XRAY_DIR, exist_ok=True)
    
    if os.path.exists(XRAY_EXE):
        return
    
    print("Downloading Xray Core...")
    zip_path = os.path.join(APP_DIR, "xray.zip")
    
    with urllib.request.urlopen(XRAY_URL) as response, open(zip_path, 'wb') as out_file:
        data = response.read()
        out_file.write(data)
            
    print("Extracting Xray Core...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(XRAY_DIR)
        
    os.remove(zip_path)
    print("Xray Core ready.")

def get_xray_path():
    return os.path.abspath(XRAY_EXE)
