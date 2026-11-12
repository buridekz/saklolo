# Saklolo

A local hackathon prototype for resident SOS reporting, optional OpenAI voice intake, and a simulated LGU response desk.

**This app is a demo. No LGU, police, ambulance, or rescue agency is connected.** An acknowledgement records an action in this prototype; it does not mean responders have been dispatched.

## Run locally

Use **Node.js 22.13 or newer** and npm. SQLite uses Node's built-in `node:sqlite` module; some Node releases print an experimental-feature warning.

```powershell
npm install
```

If `.env` does not already exist, copy `.env.example` to `.env`. Set `OPENAI_API_KEY` in that file for voice support. Keep the key on the backend: never prefix it with `VITE_`, commit it, or paste it into frontend code. `.env` and local database files are ignored by Git. Voice is optional; SOS reporting works without an API key.

```powershell
npm run dev
```

Open **http://127.0.0.1:5173**. The Vite frontend proxies `/api` and Socket.IO to the Express backend on port 3001. Use the app's resident/operator navigation to switch interfaces.

To run the production build locally:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3001**. The production build registers a service worker and caches the app shell after it has loaded successfully. Test offline reopening against this build, not the Vite development server.

When a new build is ready, the app offers **Reload app** or **Later** so edits and voice sessions can finish first. If an older cached version has no update prompt, open **http://127.0.0.1:3001/api/app-refresh** and choose **Update and open app**. This recovery page bypasses the offline navigation cache and activates the latest worker while keeping IndexedDB reports and the active request. Avoid clearing site data to update the interface.

## What the prototype does

- Saves a resident's SOS to IndexedDB on the device before attempting delivery.
- Queues failed submissions and retries while the app is open.
- Stores received incidents in SQLite on the server's laptop.
- Uses stable incident IDs so retries do not create duplicate records.
- Distinguishes saved-on-device, delivered-to-server, and acknowledged-by-demo-desk states.
- Starts a permission-based location watch when the resident screen opens. The current active report can receive location updates while that screen remains open; the operator sees the last received coordinates and capture time. This is not guaranteed continuous or background tracking.
- Supports online OpenAI Realtime voice intake over a TLS WebSocket, visible conversation transcripts, and microphone controls. Browser AudioWorklet capture sends PCM audio; returned audio is played in the browser. The model can create and revise one report per voice session; it cannot dispatch real responders or provide a diagnosis.

## Connectivity boundaries

| Capability | Current behavior |
| --- | --- |
| SOS without a server connection | Stored locally, pending delivery. |
| Retry after reconnecting | Supported while the app is running; no guaranteed closed-app background delivery. |
| Reopen app without internet | Production PWA app shell must have been cached beforehand. Browser storage deletion removes local pending reports. |
| OpenAI voice | Requires internet access to OpenAI and a valid API key with model access. A configured key alone does not verify account access, quota, or a working voice session. |
| Map background | Uses online OpenStreetMap tiles. Offline tile packaging is not implemented. |
| GPS | Automatically requests browser permission on the resident screen. Denial opens the landmark form. Known coordinates retain their capture timestamp, with a stale-location label after two minutes. A denied or unavailable location is never replaced with fabricated coordinates. |
| Local Wi-Fi delivery | Architecturally possible with a reachable local backend; multi-device HTTPS/network setup is not provided by the default loopback configuration. |
| SMS fallback | When a report is not delivered, the resident can send it as a text through the phone's own SMS app (works without mobile data). There is no SMS gateway: the operator pastes received texts into **Log SMS**. The report keeps its ID, so a later data delivery updates it instead of duplicating it. Peer relay is not implemented. |
| Wake word / locked-screen voice | Not implemented. Voice requires opening and starting an app session. |

The default servers bind to loopback for a local demo. A phone accessing a laptop's plain HTTP LAN address will not have the same secure-context privileges as localhost: microphone, geolocation, and service-worker behavior require a properly trusted HTTPS setup. A public tunnel is an internet dependency, not an offline transport solution.

## Demo sequence

1. Open the resident interface and submit a clearly marked **test** SOS.
2. Open the operator interface and confirm the incident appears.
3. Acknowledge the incident; return to the resident interface and check the confirmed status.
4. On the production build, disconnect the browser from the server and save another test report. Confirm it is pending, not delivered.
5. Reopen the cached app and confirm the pending report remains.
6. Reconnect and verify the report is delivered once, then acknowledge it.
7. Demonstrate voice separately with internet enabled. Use synthetic details, not real emergency or personal information.

For the voice-companion demo, tap **Talk to Saklolo**, describe a fictional incident, then add a correction or landmark. The assistant saves the initial help request before asking for missing details and updates the same report. Ask whether it has been delivered to exercise the read-only status tool. While voice remains connected, acknowledge the report at `/operator`; with **Spoken status updates on**, the companion announces the confirmed change when conversation and playback are idle. **Mute mic** controls input; the spoken-update switch controls unsolicited status announcements. **End voice** closes the session. This requires an explicit tap and internet, with no always-on wake word.

## Checks

```powershell
npm test
npm run build
```

Backend tests cover validation, idempotent delivery, acknowledgement preservation across restart, temporary credential filtering, provider failures, and malformed/cross-site requests. Voice announcement tests cover busy-state deferral, status coalescing, deduplication, tool-result suppression, disabling, and cleanup. Tests do not call the paid OpenAI API. Live voice testing requires a microphone, browser permission, internet, and an account with access to the configured model.

Browser QA verified SOS delivery, operator acknowledgement, offline save and production-app reload, automatic reconnection delivery (including while viewing the operator route), and a map marker using simulated geolocation. The resident redesign was checked at 320px and 390px, including progressive report details and reduced-motion behavior. Location QA covers automatic capture, permission-denied fallback, and attaching a fresh fix to an already delivered report.

A live OpenAI WebSocket test used two turns of synthetic English speech fed through Chrome's fake microphone. The agent created one flood report, then revised that same report from three people to four people including an older adult. The correct landmark, simulated GPS coordinates, and revision 2 reached the operator, who acknowledged the report. A second fresh browser session connected, produced the assistant greeting, and successfully muted, unmuted, and ended. All test voice sessions were stopped.

This verifies a real API audio/tool path with synthetic input, **not a physical microphone, real GPS, Filipino speech accuracy, or reliable emergency assessment**. Two local browser runs are a functional check, not a reliability benchmark. Earlier WebRTC attempts had intermittent post-SDP connection failures in the test environment; the default transport now uses a WebSocket over TLS instead of relying on RTC/ICE establishment. No real emergency was reported.

## Project layout

- `src/`: resident and operator interfaces, IndexedDB queue, map, and voice client.
- `server/app.mjs`: report API, SQLite storage, acknowledgement API, and temporary voice-session credentials.
- `server/index.mjs`: local server and Socket.IO notifications.
- `server/app.test.mjs`: backend integration tests.
- `data/`: local runtime database; ignored by Git.
- `.env.example`: backend configuration template without a credential.

## Before any real deployment

This scaffold deliberately has no production authentication or per-resident authorization. Its report list and acknowledgement endpoints are for a trusted local demonstration only. Add identity, role enforcement, privacy controls, retention rules, abuse prevention, and an agency-approved operational workflow before exposing it to real users. Do not expose the prototype or its voice credential endpoint publicly as-is.

The offline roadmap is local-network delivery with tested HTTPS provisioning, licensed offline map data, and optional local speech processing. Those are future milestones, not completed capabilities.
