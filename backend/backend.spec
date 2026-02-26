# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('E:\\Anacoda\\Lib\\site-packages\\certifi', 'certifi'), ('E:\\my-final-app\\CF-IP-Scanner\\backend\\.env', '.')],
    hiddenimports=['aiohttp', 'aiohttp_socks', 'aiodns', 'pycares', 'urllib.parse', 'pymysql', 'cryptography', 'yaml', 'requests', 'cloudscraper', 'certifi', 'websockets', 'aiomysql', 'cryptography', 'dotenv', 'aiodns', 'pycares', 'httpx', 'httpcore', 'anyio', 'h11', 'sniffio', 'pydantic', 'aiosqlite'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['backend\\_ssl_hook.py'],
    excludes=['PyQt5', 'PyQt6', 'tkinter', 'matplotlib'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
