# 📱 WhatsApp Numbers (WP-Numbers)

A production-ready WhatsApp unregistered number checker, marketplace, and public SMS OTP API platform built with **TanStack Start**, **TypeScript**, **React 19**, **MongoDB**, and **Playwright**.

---

## 🌟 Key Features

- **Automated WhatsApp Registration Checker**: Live browser monitor checks whether Indian numbers are registered on WhatsApp without triggering bans.
- **Auto-Refill Engine**: Automatically maintains a pipeline of verified unregistered numbers ready for purchase.
- **Numbers Marketplace (`/numbers`)**:
  - Live inventory of unregistered WhatsApp numbers.
  - One-click random number assignment.
  - Real-time SMS OTP polling with live status updates.
  - Multi-SMS and cancellation refund support.
  - In-app wallet system with UPI payment verification and test balance modes.
- **Admin Management Panel (`/numbers/admin`)**:
  - Full user management (names, emails, phone numbers, registration dates).
  - Reset and change user passwords securely.
  - Adjust user wallet balances with audit logging.
  - **Unlimited Balance Mode (∞)**: Set VIP users to bypass all wallet and API balance checks with free number claims.
  - Ban / Unban users with automatic session revocation and API key deactivation.
- **Public SMS API & Bot Compatibility (`/api/v1`)**:
  - Standard SMS API format compatible with SMS bots and services (`getBalance`, `getNumber`, `getNumberV2`, `getStatus`, `setStatus`, `regetNumber`).
  - Accepts standard SMS API queries (tolerates extra parameters like `service`, `country`, `server`, `operator`).
- **Interactive API Documentation (`/api-docs`)**:
  - Copy-paste ready code examples in **Python**, **JavaScript / Node.js**, and **PHP**.
  - Interactive secret key generator and instant test top-up.
- **Standalone API Server (`api-server/`)**:
  - A 100% self-contained microservice folder with zero UI dependencies, ready to deploy to any VPS on port 5000.

---

## 🏛 Architecture & Multi-Port System

The platform is designed to separate user traffic from administrative and API workloads:

| Port | Service | Description | Access |
|---|---|---|---|
| **8080** | **Main App & Checker** | WhatsApp session linker, live checker monitor, admin dashboard | Protected (Admin key required) |
| **3000** | **Marketplace Portal** | User-facing marketplace catalog and interactive API documentation | Public |
| **5000** | **Standalone API Server** | High-performance SMS API service for automated bots | Public (API key auth) |

---

## 📁 Repository Structure

```
├── api-server/              # Standalone VPS-ready SMS API server (Port 5000)
│   ├── index.js             # Native Node.js HTTP server
│   ├── db.js                # MongoDB connection pool
│   ├── furysms.js           # FurySMS OTP integration
│   ├── deploy.sh            # Automated 1-step VPS setup script
│   └── ecosystem.config.cjs # PM2 production cluster config
├── data/                    # Included numbers & database backups
│   ├── unregistered-numbers.json  # 44 verified unregistered WhatsApp numbers
│   ├── unregistered-numbers.txt   # Plain phone number list
│   ├── all-numbers-backup.json    # Complete numbers inventory backup
│   └── business-lines-config.json # Business line settings backup
├── scripts/                 # Utility & automation scripts
│   ├── seed-db.ts           # Imports data/unregistered-numbers.json into MongoDB
│   ├── export-all-data.ts   # Exports live database numbers to data/
│   ├── wa-session-monitor.py# Playwright WhatsApp Web lifecycle monitor
│   └── inspect-db.ts        # Database summary and status inspector
├── src/
│   ├── integrations/        # MongoDB client and auth middleware
│   ├── lib/                 # Core business logic, wallet, auth, and checker engine
│   └── routes/              # TanStack Start file-based routing
│       ├── api/v1.ts        # TanStack Start SMS API endpoint
│       ├── api-docs.tsx     # Public interactive API documentation
│       ├── numbers/index.tsx# User numbers marketplace
│       └── numbers/admin.tsx# Admin control panel
├── .env.example             # Complete environment configuration template
└── vite.config.ts           # Vite + TanStack Start bundler configuration
```

---

## 🚀 Quick Start (Local Setup)

### 1. Prerequisites
- **Node.js**: v20 or v22
- **pnpm**: `npm install -g pnpm`
- **MongoDB**: A running MongoDB instance or MongoDB Atlas cluster URI.

### 2. Installation
```bash
git clone https://github.com/Zazbhai/wp-numbers.git
cd wp-numbers
pnpm install
```

### 3. Environment Configuration
Copy the template configuration:
```bash
cp .env.example .env
```
Open `.env` and fill in your MongoDB URI and API keys:
```env
MONGODB_URI="mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/"
MONGODB_DB_NAME="register_checker"
BUSINESS_LINES_ADMIN_KEY="your-admin-password"
FURYSMS_API_KEY="your-furysms-api-key"
TELEGRAM_API_KEY="your-telegram-bot-token"
```

### 4. Seed Included Unregistered Numbers
To seed the included 44+ verified numbers into your MongoDB database:
```bash
pnpm exec tsx scripts/seed-db.ts
```

### 5. Start Development Server
```bash
pnpm dev
```
- Main app: `http://localhost:8080`
- Marketplace: `http://localhost:3000/numbers`
- API Docs: `http://localhost:3000/api-docs`

---

## 🌐 Deploying the Standalone API Server on a VPS

The `api-server` folder is completely standalone and can run on any Linux VPS (Ubuntu/Debian) on port 5000:

1. Copy the `api-server` folder to your VPS:
   ```bash
   scp -r api-server root@YOUR_VPS_IP:/var/www/api-server
   ```
2. SSH into your VPS and run the automated setup:
   ```bash
   ssh root@YOUR_VPS_IP
   cd /var/www/api-server
   chmod +x deploy.sh
   ./deploy.sh
   ```
3. Verify the service is online:
   ```bash
   curl http://YOUR_VPS_IP:5000/health
   # → {"status":"ok","database":"connected","port":5000}
   ```

---

## 📡 API Reference Quickstart

Standard SMS bot format:
```bash
# Check Balance
curl "http://localhost:8080/api/v1?action=getBalance&api_key=YOUR_KEY"
# → ACCESS_BALANCE:999999.00

# Purchase an Unregistered WhatsApp Number
curl "http://localhost:8080/api/v1?action=getNumber&api_key=YOUR_KEY"
# → ACCESS_NUMBER:AbCdEf123456:919876543210

# Poll for SMS OTP
curl "http://localhost:8080/api/v1?action=getStatus&api_key=YOUR_KEY&id=AbCdEf123456"
# → STATUS_OK:Your WhatsApp code is 123-456
```

---

## 🧪 Testing

Run the Vitest test suite (10 test suites, 37 automated tests):
```bash
pnpm test
```
Typecheck with TypeScript:
```bash
pnpm exec tsc --noEmit
```

---

## 📄 License

MIT © [Zazbhai](https://github.com/Zazbhai)
