import os
import json
import zlib
import base64
import decimal
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from datetime import datetime
from dotenv import load_dotenv

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return float(o)
        return super(DecimalEncoder, self).default(o)

def _load_env():
    candidates = []
    import sys
    if getattr(sys, 'frozen', False):
        candidates.append(os.path.join(sys._MEIPASS, '.env'))
        candidates.append(os.path.join(os.path.dirname(sys.executable), '.env'))
        candidates.append(os.path.join(os.path.dirname(sys.executable), 'backend', '.env'))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
    
    for path in candidates:
        if os.path.exists(path):
            load_dotenv(path)
            return

_load_env()
env_key = os.environ.get('AGDB_SECRET_KEY')
if not env_key or len(env_key.encode('utf-8')) < 32:
    raise RuntimeError("AGDB_SECRET_KEY is missing or invalid in your .env file! It must be at least 32 bytes for AES-256-CBC.")

MAGIC_HEADER = b'AGDB01'
SECRET_KEY = env_key.encode('utf-8')[:32]

def pad(data: bytes) -> bytes:
    pad_len = 16 - (len(data) % 16)
    return data + bytes([pad_len] * pad_len)

def unpad(data: bytes) -> bytes:
    pad_len = data[-1]
    return data[:-pad_len]

def encrypt_payload(data: dict) -> bytes:
    json_bytes = json.dumps(data, cls=DecimalEncoder).encode('utf-8')
    compressed = zlib.compress(json_bytes)
    
    iv = os.urandom(16)
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    
    padded_data = pad(compressed)
    encrypted = encryptor.update(padded_data) + encryptor.finalize()
    
    return MAGIC_HEADER + iv + encrypted

def decrypt_payload(file_bytes: bytes) -> dict:
    if not file_bytes.startswith(MAGIC_HEADER):
        raise ValueError("Invalid file format. Missing AGDB01 header.")
        
    actual_data = file_bytes[len(MAGIC_HEADER):]
    iv = actual_data[:16]
    encrypted = actual_data[16:]
    
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    
    padded_compressed = decryptor.update(encrypted) + decryptor.finalize()
    compressed = unpad(padded_compressed)
    json_bytes = zlib.decompress(compressed)
    
    return json.loads(json_bytes.decode('utf-8'))
