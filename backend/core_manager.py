import os
import requests
import zipfile
import subprocess
import platform

XRAY_URL = "https://github.com/XTLS/Xray-core/releases/download/v1.8.4/Xray-windows-64.zip"
XRAY_DIR = "xray_core"
XRAY_EXE = os.path.join(XRAY_DIR, "xray.exe")

def download_xray():
    if not os.path.exists(XRAY_DIR):
        os.makedirs(XRAY_DIR)
    
    if os.path.exists(XRAY_EXE):
        return
    
    print("Downloading Xray Core...")
    response = requests.get(XRAY_URL, stream=True)
    zip_path = "xray.zip"
    
    with open(zip_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
            
    print("Extracting Xray Core...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(XRAY_DIR)
        
    os.remove(zip_path)
    print("Xray Core ready.")

def get_xray_path():
    return os.path.abspath(XRAY_EXE)
