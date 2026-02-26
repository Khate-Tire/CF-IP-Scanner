# Copyright (c) 2026 Taher AkbariSaeed
import os
import urllib.request
import zipfile
import subprocess
import platform
import stat
import sys

APP_DIR = os.path.join(os.path.expanduser("~"), ".antigravity_scanner")

# Platform-aware Xray binary configuration
_system = platform.system().lower()
if _system == "windows":
    _XRAY_BINARY = "xray.exe"
    _XRAY_DL_URL = "https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-windows-64.zip"
elif _system == "darwin":
    _XRAY_BINARY = "xray"
    _XRAY_DL_URL = "https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-macos-64.zip"
else:  # Linux / Android
    _XRAY_BINARY = "xray"
    _XRAY_DL_URL = "https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-linux-64.zip"

XRAY_DIR = os.path.join(APP_DIR, "xray_core")
XRAY_EXE = os.path.join(XRAY_DIR, _XRAY_BINARY)

def download_xray():
    if not os.path.exists(APP_DIR):
        os.makedirs(APP_DIR, exist_ok=True)
        
    if not os.path.exists(XRAY_DIR):
        os.makedirs(XRAY_DIR, exist_ok=True)
    
    if os.path.exists(XRAY_EXE):
        # Ensure execute permission on non-Windows
        if _system != "windows":
            _ensure_executable(XRAY_EXE)
        return
    
    print("Downloading Xray Core...")
    zip_path = os.path.join(APP_DIR, "xray.zip")
    
    with urllib.request.urlopen(_XRAY_DL_URL) as response, open(zip_path, 'wb') as out_file:
        data = response.read()
        out_file.write(data)
            
    print("Extracting Xray Core...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(XRAY_DIR)
        
    os.remove(zip_path)
    
    # Set execute permission on macOS/Linux
    if _system != "windows":
        _ensure_executable(XRAY_EXE)
    
    print("Xray Core ready.")

def _ensure_executable(path):
    """Grant execute permission to a binary on Unix-like systems."""
    try:
        st = os.stat(path)
        os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    except Exception as e:
        print(f"WARNING: Could not set execute permission on {path}: {e}")

def get_xray_path():
    # In packaged mode, check next to the executable (PyInstaller) or in resources (Electron)
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
        # PyInstaller: xray_core next to the .exe
        bundled = os.path.join(exe_dir, 'xray_core', _XRAY_BINARY)
        if os.path.exists(bundled):
            if _system != "windows":
                _ensure_executable(bundled)
            return os.path.abspath(bundled)
        # Electron: xray_core inside resources/ (one level up from backend binary)
        resources = os.path.join(exe_dir, '..', 'xray_core', _XRAY_BINARY)
        if os.path.exists(resources):
            if _system != "windows":
                _ensure_executable(resources)
            return os.path.abspath(resources)
    return os.path.abspath(XRAY_EXE)
