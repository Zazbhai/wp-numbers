#!/bin/bash
# ============================================================
# Quick VPS Deployment Script for FurySMS Standalone API Server
# ============================================================

set -e

echo "=== FurySMS API Server Setup ==="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js version: $(node -v)"
echo "NPM version: $(npm -v)"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 process manager..."
    sudo npm install -g pm2
fi

# Install dependencies
echo "Installing server dependencies..."
npm install --production

# Create .env from .env.example if missing
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️ Please edit .env with your MongoDB and FurySMS credentials."
fi

# Start with PM2
echo "Starting API server with PM2..."
pm2 start ecosystem.config.cjs

# Save PM2 process list
pm2 save

echo ""
echo "=== Deployment Complete! ==="
echo "Status check: pm2 status"
echo "View logs:    pm2 logs fury-sms-api"
echo "Health check: curl http://localhost:5000/health"

