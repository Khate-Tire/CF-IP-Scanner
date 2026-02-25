# 🐧 Linux Installation Guide

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| 🪟 **Windows 10/11** | ✅ Full Support | Download `.exe` from [Releases](https://github.com/Khate-Tire/CF-IP-Scanner/releases) |
| 🍎 **macOS** | ✅ Full Support | Download `.dmg` from [Releases](https://github.com/Khate-Tire/CF-IP-Scanner/releases) |
| 🐧 **Linux (Ubuntu/Debian)** | ✅ Manual Setup | Follow guide below |
| 🐧 **Linux (Fedora/Arch)** | ✅ Manual Setup | Use your package manager equivalents |
| 📱 **Termux (Android)** | ⚠️ Experimental | Requires Rust — see [Termux Guide](#-termux-android--experimental) |

---

## 🚀 Ubuntu / Debian — Full Setup

### 1. Install System Dependencies

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv nodejs npm git unzip wget
```

> **Node.js tip:** If your distro has an old Node.js (< 18), install via [NodeSource](https://github.com/nodesource/distributions):
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
> sudo apt install -y nodejs
> ```

### 2. Clone the Repository

```bash
git clone https://github.com/Khate-Tire/CF-IP-Scanner.git
cd CF-IP-Scanner
```

### 3. Install Python Dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 4. Install Frontend Dependencies

```bash
cd frontend
npm install --legacy-peer-deps
cd ..
```

### 5. Download Xray-core for Linux

```bash
wget https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-linux-64.zip
mkdir -p xray_core
unzip Xray-linux-64.zip -d xray_core
chmod +x xray_core/xray
rm Xray-linux-64.zip
```

### 6. Run the Application

```bash
source .venv/bin/activate  # if not already activated
python3 run_app.py
```

Open your browser at **http://localhost:5173** 🎉

---

## 🎩 Fedora / RHEL

```bash
sudo dnf install python3 python3-pip nodejs npm git unzip wget
# Then follow steps 2-6 above
```

## 🏗️ Arch Linux

```bash
sudo pacman -S python python-pip nodejs npm git unzip wget
# Then follow steps 2-6 above
```

---

## ⚠️ Common Issues

### SSL Handshake Failure
If you see `SSLV3_ALERT_HANDSHAKE_FAILURE`:
```bash
pip install --upgrade certifi
export SSL_CERT_FILE=$(python3 -c "import certifi; print(certifi.where())")
```

### Port Already in Use
```bash
# Kill any process on port 8000
kill $(lsof -t -i:8000) 2>/dev/null
# Kill any process on port 5173
kill $(lsof -t -i:5173) 2>/dev/null
```

### No `.env` File Warning
This is normal for local development. The app works without a database — just skip the warning. You can create `backend/.env` if you want to connect to the community database.

---

## 📱 Termux (Android) — Experimental

> ⚠️ **This works but takes 10-15 minutes** because `pydantic-core` must be compiled from source with Rust on ARM devices.

### 1. Install Required Packages

```bash
pkg update && pkg upgrade -y
pkg install python rust nodejs git unzip wget
```

### 2. Clone the Repository

```bash
git clone https://github.com/Khate-Tire/CF-IP-Scanner.git
cd CF-IP-Scanner
```

### 3. Install Python Dependencies (Slow — Compiling Rust)

```bash
pip install -r backend/requirements.txt
```

> ☕ **This step takes 10-15 minutes** because `pydantic-core` compiles from Rust source on ARM. Be patient and don't close Termux!

### 4. Install Frontend Dependencies

```bash
cd frontend
npm install --legacy-peer-deps
cd ..
```

### 5. Download Xray-core for Android

```bash
wget https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-android-arm64-v8a.zip
mkdir -p xray_core
unzip Xray-android-arm64-v8a.zip -d xray_core
chmod +x xray_core/xray
rm Xray-android-arm64-v8a.zip
```

### 6. Run the App

```bash
python run_app.py
```

Open your Android browser (Chrome) at **http://localhost:5173** 🎉

### Common Termux Issues

| Problem | Fix |
|---------|-----|
| `Rust not found` | Run `pkg install rust` first |
| Build takes forever | Normal — Rust compilation is slow on phones (10-15 min) |
| `STORAGE PERMISSION` | Run `termux-setup-storage` once |
| Can't open in browser | Use `http://127.0.0.1:5173` instead |

### Alternative: Scan on PC, Use on Phone
If Termux is too slow, scan on a PC and export results:
1. Scan for clean IPs on your PC
2. Click **Export → Base64 (V2RayNG)**
3. Copy the subscription link to **V2RayNG** on Android
4. Connect using the discovered clean IPs

---

## 🔧 Development Mode (Optional)

If you want to modify the code:

```bash
# Terminal 1 — Backend
source .venv/bin/activate
cd backend
python main.py

# Terminal 2 — Frontend (hot-reload)
cd frontend
npm run dev
```

---

<div align="center">
  <p>🕊️ Built for a free and open internet</p>
  <p>Made with ❤️ by <a href="https://t.me/hossein_shiravani">@Khate-Tire</a></p>
</div>
