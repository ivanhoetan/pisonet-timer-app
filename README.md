# Pisonet Account-Based Timer System

Phase 1 MVP: backend API + Windows kiosk client for account-based time wallets.

## Stack

- **Backend:** Node.js, Express, Socket.io, MongoDB
- **Windows client:** Electron + Vue 3
- **Shared:** TypeScript types and Zod schemas

## Quick start (local)

### 1. Install dependencies

```bash
npm install
```

### 2. Start MongoDB

```bash
docker compose up -d
```

### 3. Configure server

```bash
cp apps/server/.env.example apps/server/.env
```

### 4. Seed demo data

```bash
npm run seed
```

This creates:
- Admin: `admin@pisonet.local` / `admin123`
- Demo user: `demo` / PIN `1234` with 60 minutes
- Computer `PC01` with a dev auth secret

### 5. Run the server

```bash
npm run dev:server
```

Server runs at `http://localhost:3000`. Health check: `GET /health`

### 6. Run the Windows client (dev)

```bash
npm run dev:client
```

On first launch, pair the PC using values from the seed output:
- **Server URL:** `http://localhost:3000`
- **Computer ID:** from seed output
- **Auth secret:** `dev-secret-pc01-change-in-production`

Then log in with `demo` / `1234`.

## Manual API test flow

```bash
# 1. Admin login
curl -s -X POST http://localhost:3000/auth/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@pisonet.local","password":"admin123"}'

# 2. Register a computer (use admin token)
curl -s -X POST http://localhost:3000/computers/register \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -d '{"computerCode":"PC02","name":"PC 02"}'

# 3. Top up a user (use admin token + user id)
curl -s -X POST http://localhost:3000/transactions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -d '{"userId":"<USER_ID>","minutesAdded":60,"paymentMethod":"manual"}'

# 4. PIN login on a PC
curl -s -X POST http://localhost:3000/auth/pin-login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","pin":"1234","computerId":"<COMPUTER_ID>"}'
```

## Deploy to Render (free tier)

1. Create a **MongoDB Atlas M0** cluster (free) and copy the connection string.
2. Push this repo to GitHub.
3. In Render, create a **Web Service** from `render.yaml` or manually:
   - Build: `npm install && npm run build -w @pisonet/shared && npm run build -w @pisonet/server`
   - Start: `npm run start -w @pisonet/server`
   - Health check path: `/health`
4. Set environment variables:
   - `MONGODB_URI` — Atlas connection string
   - `JWT_SECRET` — long random string
   - `ADMIN_PASSWORD` — choose a strong password
5. After deploy, run seed once (locally pointed at Atlas, or via a one-off Render shell):
   ```bash
   MONGODB_URI="your-atlas-uri" npm run seed
   ```
6. Pair each Windows PC with:
   - **Server URL:** `https://<your-app>.onrender.com`
   - **Computer ID** and **auth secret** from admin computer registration

### Keep-alive (Render free tier)

Render free services sleep after ~15 minutes of inactivity. Mitigations:

- Set up a free pinger (UptimeRobot, cron-job.org) to `GET https://<your-app>.onrender.com/health` every 10 minutes during cafe hours.
- Windows clients maintain WebSocket connections while PCs are on.
- Timers are server-authoritative (timestamp-based), so cold starts do not corrupt balances.

## Build the Windows installer

The client is packaged with electron-builder into an NSIS `.exe` installer that
auto-starts on Windows boot and runs in kiosk mode.

### Option A: GitHub Actions (recommended, builds on Windows)

A workflow at `.github/workflows/build-windows-client.yml` builds the installer
on a Windows runner.

- Trigger manually: GitHub repo → Actions → "Build Windows Client" → Run workflow
- Or push a tag: `git tag v1.0.0 && git push --tags`
- Download the `.exe` from the workflow run's Artifacts.

### Option B: Build locally on a Windows machine

```bash
npm install
npm run dist:client
```

The installer is written to `apps/windows-client/release/`.

> Cross-building a Windows installer from macOS/Linux requires Wine and is not
> recommended. Use Option A or a Windows machine.

### Install on each cafe PC

1. Run the `.exe` installer (requires admin — installs per-machine, which also
   means uninstall requires admin).
2. On first launch, pair the PC:
   - **Server URL:** `https://<your-app>.onrender.com`
   - **Computer ID** and **Auth secret** from admin computer registration
3. The app auto-starts on boot, runs fullscreen kiosk, and minimizes to the
   system tray when closed.

## Project structure

```
apps/
  server/           # Express API + Socket.io
  windows-client/   # Electron kiosk app
packages/
  shared/           # Shared types and schemas
```

## Phase 1 features

- User registration and PIN login
- Admin computer registration and manual top-up
- Server-authoritative session timer
- WebSocket events: `START_SESSION`, `ADD_TIME`, `SESSION_ENDED`, `SESSION_EXPIRED`, `FORCE_LOCK`
- Session rehydration from MongoDB after server restart
- Windows kiosk: lock screen, countdown, logout, reconnect overlay

## Upgrade path

If Render free-tier cold starts become annoying, upgrade to **Render Starter (~$7/mo)** with no code changes.
