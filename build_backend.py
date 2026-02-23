import os
import PyInstaller.__main__

# We need to compile backend/main.py
# We also need to copy settings.json, proxy.txt, config.json, tools/* if they exist
# However, for a onefile executable, extra resources are tricky. 
# It's better to let Electron handle distributing extra binaries like Xray-core.

print("Building Antigravity IP Scanner Backend...")

PyInstaller.__main__.run([
    'backend/main.py',
    '--name=backend',
    '--onefile',
    '--noconsole',
    '--clean',
    '--hidden-import=aiohttp',
    '--hidden-import=aiohttp_socks',
    '--hidden-import=urllib.parse',
    '--hidden-import=pymysql',
    '--hidden-import=cryptography',
    '--hidden-import=yaml',
    '--exclude-module=PyQt5',
    '--exclude-module=PyQt6',
    '--exclude-module=tkinter',
    '--exclude-module=matplotlib',
    '--distpath=backend/dist',
    '--workpath=backend/build',
    '--specpath=backend',
    '--hidden-import=requests',
    '--hidden-import=cloudscraper',
    '--hidden-import=certifi',
    '--hidden-import=websockets',
    '--hidden-import=aiomysql',
    '--hidden-import=cryptography',
    '--hidden-import=dotenv',
    '--hidden-import=aiodns',
    '--hidden-import=pycares',
])
