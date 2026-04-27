#!/bin/bash
# CF-IP-Scanner Linux Installation Script (Debian/Ubuntu)
# Copyright (c) 2026 Khate Tire

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Starting CF-IP-Scanner Installation ===${NC}"

# Check for root/sudo
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run this script with sudo or as root.${NC}"
  exit 1
fi

echo -e "${GREEN}[1/5] Updating package lists & installing system dependencies...${NC}"
apt-get update -y
apt-get install -y python3 python3-pip python3-venv nodejs npm git curl unzip xz-utils libssl-dev libc-ares-dev net-tools wget

echo -e "${GREEN}[2/5] Setting up Python Backend Environment...${NC}"
cd /opt
if [ -d "CF-IP-Scanner" ]; then
    echo "Found existing directory, backing up..."
    mv CF-IP-Scanner CF-IP-Scanner_backup_$(date +%s)
fi

git clone https://github.com/Khate-Tire/CF-IP-Scanner.git
cd CF-IP-Scanner/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip

# Install dependencies and pycares from source or wheel
pip install aiohttp aiomysql aiodns psutil fastapi uvicorn pydantic python-dotenv pyinstaller
pip install pycares || echo -e "${RED}Pycares failed. This might need python3-dev.${NC}"
pip install ipaddress urllib3 requests httpx

echo -e "${GREEN}[3/5] Setting up Node Frontend Environment...${NC}"
cd ../frontend
# Requires Node 20+, install via nodesource if needed
if ! node -v | grep -q 'v20\|v22'; then
    echo "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
npm install
npm run build || echo -e "${RED}Frontend build failed, check Node version!${NC}"

echo -e "${GREEN}[4/5] Copying Frontend dist to Backend backend/dist...${NC}"
cd ..
mkdir -p backend/dist
# If build succeeded, copy it
if [ -d "frontend/dist" ]; then
    cp -r frontend/dist/* backend/dist/
fi

echo -e "${GREEN}[5/5] Building Python Executable with PyInstaller...${NC}"
cd backend
pyinstaller --onefile --add-data "dist:dist" --hidden-import pycares --hidden-import aiodns --hidden-import aiomysql main.py

echo -e "${BLUE}=== Installation Complete ===${NC}"
echo -e "You can run the scanner server from: /opt/CF-IP-Scanner/backend/dist/main"
echo -e "Or run it in dev mode using: source /opt/CF-IP-Scanner/backend/venv/bin/activate && python3 main.py"
