import subprocess
import time
import os
import sys

def start_backend():
    print("Starting Backend...")
    # Using specific python executable if needed, otherwise 'python'
    return subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"], cwd="backend")

def start_frontend():
    print("Starting Frontend (Vite)...")
    # shell=True is often needed on Windows for npm/npx
    return subprocess.Popen("npm run dev", shell=True, cwd="frontend")

if __name__ == "__main__":
    try:
        backend_proc = start_backend()
        frontend_proc = start_frontend()
        
        print("\nApp is running!")
        print("Backend: http://127.0.0.1:8000")
        print("Frontend: http://localhost:5173") 
        print("\nPress Ctrl+C to stop.")
        
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\nStopping services...")
        backend_proc.terminate()
        frontend_proc.terminate()
        sys.exit(0)
