import os
import json
import zlib
import hashlib
import hmac
import base64
import decimal
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from datetime import datetime
from dotenv import load_dotenv

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return float(o)
        if isinstance(o, (datetime,)):
            return o.isoformat()
        try:
            return super(DecimalEncoder, self).default(o)
        except TypeError:
            return str(o)

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

MAGIC_HEADER = b'AGDB01'         # legacy: AES-256-CBC w/ env key
MAGIC_HEADER_V2 = b'AGDB02'      # v2: env-key + section manifest + HMAC-SHA256
MAGIC_HEADER_PWD = b'AGDB03'     # v3: passphrase (PBKDF2 -> AES-256-GCM)
SECRET_KEY = env_key.encode('utf-8')[:32]

# ---------- shared helpers ----------

def _build_manifest(data: dict) -> dict:
    """Return a per-section size + sha256 manifest for integrity verification."""
    manifest = {
        "bundle_version": data.get("version", "2.0"),
        "exported_at": data.get("exported_at") or datetime.now().isoformat(),
        "sections": {},
    }
    for key, value in data.items():
        if key in ("version", "exported_at", "_manifest"):
            continue
        try:
            raw = json.dumps(value, cls=DecimalEncoder, sort_keys=True).encode("utf-8")
            manifest["sections"][key] = {
                "type": type(value).__name__,
                "count": len(value) if isinstance(value, (list, dict)) else 1,
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        except Exception:
            manifest["sections"][key] = {"type": "unknown", "count": 0, "bytes": 0, "sha256": ""}
    return manifest


def pad(data: bytes) -> bytes:
    pad_len = 16 - (len(data) % 16)
    return data + bytes([pad_len] * pad_len)

def unpad(data: bytes) -> bytes:
    pad_len = data[-1]
    return data[:-pad_len]

# ---------- v1 (legacy) ----------

def _encrypt_v1(data: dict) -> bytes:
    json_bytes = json.dumps(data, cls=DecimalEncoder).encode('utf-8')
    compressed = zlib.compress(json_bytes)
    iv = os.urandom(16)
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    padded_data = pad(compressed)
    encrypted = encryptor.update(padded_data) + encryptor.finalize()
    return MAGIC_HEADER + iv + encrypted


def _decrypt_v1(file_bytes: bytes) -> dict:
    actual_data = file_bytes[len(MAGIC_HEADER):]
    iv = actual_data[:16]
    encrypted = actual_data[16:]
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded_compressed = decryptor.update(encrypted) + decryptor.finalize()
    compressed = unpad(padded_compressed)
    json_bytes = zlib.decompress(compressed)
    return json.loads(json_bytes.decode('utf-8'))

# ---------- v2 (env-key + manifest + HMAC) ----------

def _encrypt_v2(data: dict) -> bytes:
    if "_manifest" not in data:
        data["_manifest"] = _build_manifest(data)
    payload = json.dumps(data, cls=DecimalEncoder).encode("utf-8")
    compressed = zlib.compress(payload, level=9)
    iv = os.urandom(16)
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted = encryptor.update(pad(compressed)) + encryptor.finalize()
    body = iv + encrypted
    mac = hmac.new(SECRET_KEY, body, hashlib.sha256).digest()
    return MAGIC_HEADER_V2 + body + mac


def _decrypt_v2(file_bytes: bytes) -> dict:
    actual = file_bytes[len(MAGIC_HEADER_V2):]
    if len(actual) < 16 + 32:
        raise ValueError("Truncated AGDB02 file.")
    body = actual[:-32]
    mac = actual[-32:]
    expected = hmac.new(SECRET_KEY, body, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expected):
        raise ValueError("Integrity check failed (HMAC mismatch). Bundle is corrupt or tampered.")
    iv = body[:16]
    encrypted = body[16:]
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    compressed = unpad(decryptor.update(encrypted) + decryptor.finalize())
    return json.loads(zlib.decompress(compressed).decode("utf-8"))

# ---------- v3 (passphrase / AES-256-GCM) ----------

PBKDF2_ITERS = 200_000

def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=PBKDF2_ITERS, backend=default_backend())
    return kdf.derive(passphrase.encode("utf-8"))


def _encrypt_v3(data: dict, passphrase: str) -> bytes:
    if not passphrase or len(passphrase) < 6:
        raise ValueError("Passphrase must be at least 6 characters.")
    if "_manifest" not in data:
        data["_manifest"] = _build_manifest(data)
    payload = json.dumps(data, cls=DecimalEncoder).encode("utf-8")
    compressed = zlib.compress(payload, level=9)
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(passphrase, salt)
    aesgcm_cipher = Cipher(algorithms.AES(key), modes.GCM(nonce), backend=default_backend())
    encryptor = aesgcm_cipher.encryptor()
    encrypted = encryptor.update(compressed) + encryptor.finalize()
    tag = encryptor.tag
    # layout: MAGIC(6) | salt(16) | nonce(12) | tag(16) | ciphertext
    return MAGIC_HEADER_PWD + salt + nonce + tag + encrypted


def _decrypt_v3(file_bytes: bytes, passphrase: str) -> dict:
    if not passphrase:
        raise ValueError("Bundle is passphrase-protected. Provide the passphrase.")
    actual = file_bytes[len(MAGIC_HEADER_PWD):]
    if len(actual) < 16 + 12 + 16:
        raise ValueError("Truncated AGDB03 file.")
    salt = actual[:16]
    nonce = actual[16:28]
    tag = actual[28:44]
    encrypted = actual[44:]
    key = _derive_key(passphrase, salt)
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce, tag), backend=default_backend())
    decryptor = cipher.decryptor()
    try:
        compressed = decryptor.update(encrypted) + decryptor.finalize()
    except Exception:
        raise ValueError("Invalid passphrase or corrupt bundle.")
    return json.loads(zlib.decompress(compressed).decode("utf-8"))

# ---------- public API ----------

def encrypt_payload(data: dict, passphrase: str | None = None, version: int = 2) -> bytes:
    """Encrypt payload.
    - passphrase given -> AGDB03 (passphrase, AES-GCM, integrity built-in)
    - else version=2  -> AGDB02 (env key + HMAC + manifest)
    - else version=1  -> AGDB01 (legacy, no manifest)
    """
    if passphrase:
        return _encrypt_v3(data, passphrase)
    if version == 1:
        return _encrypt_v1(data)
    return _encrypt_v2(data)


def decrypt_payload(file_bytes: bytes, passphrase: str | None = None) -> dict:
    if file_bytes.startswith(MAGIC_HEADER_PWD):
        return _decrypt_v3(file_bytes, passphrase or "")
    if file_bytes.startswith(MAGIC_HEADER_V2):
        return _decrypt_v2(file_bytes)
    if file_bytes.startswith(MAGIC_HEADER):
        return _decrypt_v1(file_bytes)
    raise ValueError("Invalid file format. Missing AGDB header (AGDB01/02/03).")


def peek_manifest(file_bytes: bytes, passphrase: str | None = None) -> dict:
    """Decrypt + return only the manifest section (cheap dry-run preview)."""
    data = decrypt_payload(file_bytes, passphrase=passphrase)
    manifest = data.get("_manifest")
    if not manifest:
        manifest = _build_manifest(data)
    # sanitize: drop sensitive blobs from preview
    return {
        "manifest": manifest,
        "format": (
            "AGDB03" if file_bytes.startswith(MAGIC_HEADER_PWD)
            else "AGDB02" if file_bytes.startswith(MAGIC_HEADER_V2)
            else "AGDB01"
        ),
        "size_bytes": len(file_bytes),
    }
