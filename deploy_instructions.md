# How to Serve Antigravity IP Scanner to Users

Since the Antigravity IP Scanner requires a Python backend (to run Xray binaries) and a MySQL database (for analytics and history), it cannot be hosted on a simple static site host like GitHub Pages or regular cPanel shared hosting. 

It requires **VPS (Virtual Private Server)** hosting where you have full root/terminal access to run Python scripts and the Xray binary.

Here are the recommended ways to get it online:

---

## Architecture Overview
Your application has 3 main parts that need to run continuously:
1. **The MySQL Database**: Stores scan results, history, and analytics.
2. **The Python Backend (FastAPI)**: Listens for requests on port `8000`, runs the `Xray-core` binary to test speeds, and connects to the database.
3. **The React Frontend (Vite)**: The user interface that people see in their browsers.

---

## Option 1: The Standard VPS Setup (Recommended: Ubuntu Server)
*Cost: $5-$10/month (e.g., DigitalOcean, Hetzner, Vultr, Linode)*

This is the most professional and flexible way to host the app.

### Step-by-Step Deployment:
1. **Get a VPS**: Rent a basic Linux Ubuntu VPS (1GB or 2GB RAM is plenty).
2. **Install Dependencies**:
   SSH into the server and install Python, MySQL, Node.js, and Nginx.
   ```bash
   sudo apt update
   sudo apt install python3-pip python3-venv mysql-server nodejs npm nginx
   ```
3. **Upload Files**: Transfer your entire `CF-IP-Scanner` folder to the server (you can use Git or SFTP).
4. **Setup Database**: Log into MySQL on the server and create the `cf_scanner` database with the same credentials you use locally (`root`/`1234`).
5. **Run the Backend as a Service**:
   Use `systemd` or `pm2` to keep the backend Python script running forever in the background.
6. **Build the Frontend**:
   Go to the `frontend` folder and run `npm run build`. This creates a `dist` folder containing optimized HTML/JS files.
7. **Configure Nginx**:
   Use Nginx space as a Web Server. Configure it to:
   - Serve the frontend `dist` files when someone visits your domain (e.g., `scanner.yourdomain.com`).
   - *Reverse Proxy* any requests starting with `/api` to your Python backend running on `localhost:8000`.

---

## Option 2: Windows Server (If you prefer not using Linux)
*Cost: $15-$30/month (Windows licenses cost more)*

Since you developed this on Windows, you can simply rent a Windows VPS, remote-desktop (RDP) into it, and run the app exactly like you do right now using the `run_app.py` script.
- **Pros**: Exact same environment as your local computer. Very easy.
- **Cons**: More expensive. You have to keep the terminal windows open, or figure out how to run the python script as a Windows Background Service.

---

## Option 3: Docker (Advanced but Cleanest)
If you know Docker, you can create a `docker-compose.yml` file that spins up a MySQL container, a Python backend container, and an Nginx frontend container all at once. This makes it incredibly easy to move the app to any server in the future with a single `docker-compose up -d` command.

---

## Important Considerations for Public Serving:

1. **Security**: Right now, the backend has no user authentication. Anyone who finds the URL could trigger massive scans and flood your server's bandwidth or database. You should add API keys or a login system if making it completely public.
2. **Xray Binaries**: The backend currently expects `Xray-core` (typically the `.exe` version since you are on Windows). If you move to a Linux VPS, you MUST download the Linux version of Xray core and update the paths in `backend/core_manager.py` to point to it.
3. **Rate Limiting**: You should implement Cloudflare rate-limiting in front of your domain so people don't crash your python backend by clicking "Scan" 100 times a second.
4. **Changing the API URL**: In your React frontend (`frontend/src/api.js`), the `API_BASE` is currently hardcoded to `http://127.0.0.1:8000`. You will need to change this to your actual public domain name (e.g., `https://api.yourdomain.com`) before building the frontend for production!

---

## Packaging as a Desktop or Mobile App (Local Testing Mode)

If you want users to test their *own* internet (so the scanner finds the best IPs for *them* rather than for a central server), you cannot host it on a public website. You must package everything so the backend runs on their device.

### 1. Windows, macOS, and Linux (Desktop)
This is highly feasible. 
- **The Approach**: We use **Electron** or **Tauri**. We package your built React frontend into the GUI window. We use **PyInstaller** to turn your `backend/main.py` into a hidden, standalone `.exe` (or macOS equivalent). 
- **How it works**: When the user opens the Desktop App, it silently launches the Python `.exe` in the background (which spins up the local FastAPI server and Xray). The React UI then communicates with `localhost:8000` just like it does right now perfectly securely.

### 2. Android and iPhone (Mobile)
This is significantly more difficult, but entirely possible with the right architecture.
- **The Problem**: You cannot easily run Python scripts (FastAPI) or Windows `Xray-core.exe` binaries on mobile operating systems without heavy restrictions.
- **The Solution (Capacitor/React Native + Custom Backend)**:
    1. The React frontend can be easily converted into a mobile app using **Ionic Capacitor** or **React Native**.
    2. However, the Python backend must be completely rewritten. You would need to use native Android (Kotlin/Java) and iOS (Swift) libraries for networking, or compile the Go-based `Xray-core` directly into Android `aar` and iOS `framework` libraries.
    3. Alternatively, you can use the **"Web UI + Local Engine"** model for mobile: You build a standalone Android/iOS app that runs the Xray tunnel locally, and the user controls it via a mobile-optimized webpage.

**Verdict**: We can comfortably package your current stack into a **Desktop App (Windows/Mac)** using Electron and PyInstaller. Packaging for **Mobile (iOS/Android)** would require a significant rewrite of the backend logic to use mobile-native networking APIs instead of the Python/Xray combo.
