import os
import PyInstaller.__main__
import certifi

# We need to compile backend/main.py
# We also need to copy settings.json, proxy.txt, config.json, tools/* if they exist
# However, for a onefile executable, extra resources are tricky. 
# It's better to let Electron handle distributing extra binaries like Xray-core.

print("Building Antigravity IP Scanner Backend...")

# Get the certifi CA bundle path for bundling SSL certificates
certifi_path = os.path.dirname(certifi.where())

# Create a runtime hook that sets SSL_CERT_FILE so all HTTPS connections work
runtime_hook_path = os.path.join('backend', '_ssl_hook.py')
with open(runtime_hook_path, 'w') as f:
    f.write("""import os, sys
if getattr(sys, 'frozen', False):
    ca_path = os.path.join(sys._MEIPASS, 'certifi', 'cacert.pem')
    os.environ['SSL_CERT_FILE'] = ca_path
    os.environ['REQUESTS_CA_BUNDLE'] = ca_path
""")

PyInstaller.__main__.run([
    'backend/main.py',
    '--name=backend',
    '--onefile',
    '--noconsole',
    '--clean',
    f'--add-data={certifi_path}{os.pathsep}certifi',
    f'--runtime-hook={runtime_hook_path}',
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
    '--hidden-import=httpx',
    '--hidden-import=httpcore',
    '--hidden-import=anyio',
    '--hidden-import=h11',
    '--hidden-import=sniffio',
    '--hidden-import=pydantic',
])
