#!/data/data/com.termux/files/usr/bin/bash
# Copyright (c) 2026 Taher AkbariSaeed
# Termux-compatible launcher — swaps SWC for Babel (pure JS, no native binaries)
set -e

echo "═══════════════════════════════════════════════"
echo "  Antigravity Scanner — Termux Launcher"
echo "═══════════════════════════════════════════════"
echo ""

# Step 1: Install the Babel-based React plugin (works on ARM)
echo "[1/4] Installing Termux-compatible Vite plugin..."
cd frontend
npm install --save-dev @vitejs/plugin-react --legacy-peer-deps 2>/dev/null

# Step 2: Swap vite.config.js to use Babel instead of SWC
echo "[2/4] Patching Vite config for ARM compatibility..."
cat > vite.config.js << 'VITEEOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version)
  }
})
VITEEOF
cd ..

# Step 3: Start backend
echo "[3/4] Starting Python backend..."
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
cd ..

# Step 4: Start frontend
echo "[4/4] Starting React frontend..."
cd frontend
npx vite --host 0.0.0.0 &
FRONTEND_PID=$!
cd ..

echo ""
echo "══════════════════════════════════════════════"
echo "  ✅ App is running!"
echo "  Backend:  http://127.0.0.1:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "  Open Chrome on this phone and go to:"
echo "  👉 http://localhost:5173"
echo "══════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
