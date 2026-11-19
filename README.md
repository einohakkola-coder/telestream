# Telestream control

Control panel for Telegram live streams (channel/group "Start live stream with…" → Server URL + Stream key).

Vercel can't run ffmpeg or hold a long RTMP connection, so there are two parts:

- **Panel** (this folder) → deploy to Vercel. The page you open and tap.
- **Relay** (`relay/`) → small Docker app on Fly.io, Railway, Render or any VPS. It runs ffmpeg and pushes to Telegram.

## 1. Deploy the relay
Deploy `relay/` as a Docker service (needs at least 1 vCPU for 720p). Set env var:

    RELAY_TOKEN=<long random string>

Note its public URL, e.g. https://telestream-relay.fly.dev

## 2. Deploy the panel to Vercel
Import this folder (root = this folder, no build command). Add env vars:

    RELAY_URL=https://telestream-relay.fly.dev
    RELAY_TOKEN=<same string as the relay>
    APP_PASSWORD=<password you type to unlock the panel>

## 3. Use it
Open the Vercel URL, unlock, paste Server URL + Stream key, pick a source, press **Go live**.
Start with "Test pattern" to confirm Telegram receives it.

Notes: the key is sent to your relay only when you press Go live and is masked in logs.
"Remember" stores it in this browser's localStorage, so leave it off on shared devices.
