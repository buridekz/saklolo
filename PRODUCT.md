# Saklolo

## Platform
Web prototype in the local Windows workspace. No deployment requested.

## Users and task
Residents request emergency help through SOS or voice. A simulated LGU operator reviews location and details and acknowledges the report. No real response agency is connected.

## Stack
React, TypeScript, Vite, Express, local SQLite, IndexedDB, Leaflet, OpenAI Realtime. Node's built-in SQLite avoids native package compilation on Windows.

## Boundaries
OpenAI voice requires internet. Offline reports persist locally and retry while the app is open. Map tiles currently require internet. No SMS, mesh relay, background wake word, automatic dispatch, medical diagnosis, or production authentication is claimed.

## Working assumptions
Saklolo is a provisional name. Use a restrained, accessible interface with green navigation and red reserved for SOS. This is a scaffold for a five-hour hackathon, not a production emergency service.
