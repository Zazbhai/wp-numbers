# 🚀 FurySMS Standalone Public SMS API Server

This folder is a **100% self-contained** standalone API service. You can copy or move just this `api-server` folder to any VPS (Ubuntu, Debian, CentOS, etc.) and host it independently on any port you choose.

---

## 📁 Folder Contents

- `index.js` - High-performance native HTTP API server (zero bloat, pure Node.js + MongoDB)
- `db.js` - Reusable MongoDB connection pool
- `furysms.js` - Provider integration for OTP polling and number reget
- `package.json` - Standalone package configuration
- `ecosystem.config.cjs` - PM2 configuration for production cluster mode
- `deploy.sh` - Automated 1-step VPS setup script
- `test-api.js` - Self-testing script for all endpoints
- `.env` & `.env.example` - Environment configuration

---

## ⚡ Quick Start (Local)

1. Navigate into the folder:
   ```bash
   cd api-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server (defaults to port **5000**):
   ```bash
   npm start
   ```

4. Verify it's running:
   ```bash
   curl http://localhost:5000/health
   # → {"status":"ok","database":"connected","port":5000,...}
   ```

---

## 🌐 How to Move and Host on a VPS

### Option A: Using `scp` (Secure Copy)

From your local terminal, upload the `api-server` folder to your VPS:

```bash
# Upload folder to /var/www/api-server on your VPS:
scp -r api-server root@YOUR_VPS_IP:/var/www/api-server
```

### Option B: Using a ZIP file

1. Zip the `api-server` folder on your computer.
2. Upload via SFTP (FileZilla / WinSCP / Cyberduck) to `/var/www/api-server`.
3. Unzip on the VPS:
   ```bash
   unzip api-server.zip -d /var/www/api-server
   ```

---

## 🛠️ Running on VPS (Step-by-Step)

SSH into your VPS:
```bash
ssh root@YOUR_VPS_IP
cd /var/www/api-server
```

### Step 1: Run the automated setup script
```bash
chmod +x deploy.sh
./deploy.sh
```

Or do it manually:
```bash
# Install Node.js 20 LTS (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies
npm install --production

# Install PM2 for background process management
npm install -g pm2

# Start the API server
pm2 start ecosystem.config.cjs

# Make it restart automatically on VPS reboot
pm2 save
pm2 startup
```

---

## 🔒 Nginx Reverse Proxy & SSL (Recommended for Custom Domain)

If you want to host the API under your domain (e.g., `https://api.yourdomain.com` or `https://furysms.shop`):

1. Install Nginx and Certbot:
   ```bash
   sudo apt update
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

2. Create an Nginx site config:
   ```bash
   sudo nano /etc/nginx/sites-available/api-server
   ```

3. Paste this configuration:
   ```nginx
   server {
       listen 80;
       server_name api.yourdomain.com; # Replace with your domain

       location / {
           proxy_pass http://127.0.0.1:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

4. Enable the site and restart Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/api-server /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. Issue a free SSL certificate with Let's Encrypt:
   ```bash
   sudo certbot --nginx -d api.yourdomain.com
   ```

Now your API will be securely accessible at:
- `https://api.yourdomain.com/api/v1`
- `https://api.yourdomain.com/stubs/handler_api.php`

---

## ⚙️ Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Port for the API server to listen on |
| `MONGODB_URI` | *Required* | MongoDB connection string (same database as website) |
| `MONGODB_DB_NAME` | `register_checker` | MongoDB database name |
| `FURYSMS_API_KEY` | *Optional* | Upstream FurySMS provider API key |
| `FURYSMS_BASE_URL` | `https://furysms.shop/stubs/handler_api.php` | Upstream provider endpoint |
| `NUMBER_PRICE` | `49` | Cost per number deduction from API balance |
| `RATE_LIMIT_PER_SEC` | `30` | Max requests per second per API key |
| `CORS_ORIGIN` | `*` | Allowed CORS origins for browser/client requests |

---

## 📡 API Endpoints Reference

All requests accept `action` and `api_key` as query parameters.

### 1. `getBalance`
Check wallet balance:
```bash
curl "http://localhost:5000/api/v1?action=getBalance&api_key=YOUR_API_KEY"
# → ACCESS_BALANCE:150.00
```

### 2. `getNumber`
Purchase a WhatsApp virtual number:
```bash
curl "http://localhost:5000/api/v1?action=getNumber&api_key=YOUR_API_KEY"
# → ACCESS_NUMBER:AbCdEf123456:919876543210
```

### 3. `getNumberV2`
Purchase with structured JSON output:
```bash
curl "http://localhost:5000/api/v1?action=getNumberV2&api_key=YOUR_API_KEY"
# → {"status":"OK","order_id":"AbCdEf123456","number":"919876543210","price":49,...}
```

### 4. `getStatus`
Poll for SMS OTP (poll every 3-5 seconds):
```bash
curl "http://localhost:5000/api/v1?action=getStatus&api_key=YOUR_API_KEY&id=AbCdEf123456"
# → STATUS_WAIT_CODE
# → STATUS_OK:265421
```

### 5. `setStatus`
Cancel order or request next SMS:
```bash
# Cancel (status=8) — requires 2 minute cooldown:
curl "http://localhost:5000/api/v1?action=setStatus&api_key=YOUR_API_KEY&id=AbCdEf123456&status=8"
# → STATUS_CANCEL

# Next SMS (status=3):
curl "http://localhost:5000/api/v1?action=setStatus&api_key=YOUR_API_KEY&id=AbCdEf123456&status=3"
# → ACCESS_RETRY_GET
```

### 6. `regetNumber`
Get another OTP on the same phone number for completed orders:
```bash
curl "http://localhost:5000/api/v1?action=regetNumber&api_key=YOUR_API_KEY&id=AbCdEf123456"
# → REGET_NUMBER_OK:NewOrderId456:919876543210
```

### 7. Compatibility (SMS Bots)
- `getCountries` -> `{"22":"India"}`
- `getServices` -> `{"whatsapp":{"name":"WhatsApp","price":"49","server":"india"}}`
- `getServers` -> `{"india":{"id":"india","name":"India","countryCode":"22"}}`

---

## 🔍 Monitoring Commands (PM2)

- View live status: `pm2 status`
- View live streaming logs: `pm2 logs fury-sms-api`
- Restart server: `pm2 restart fury-sms-api`
- Stop server: `pm2 stop fury-sms-api`
- Reload zero-downtime: `pm2 reload fury-sms-api`

