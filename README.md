# Casefile — Draw & Guess Mystery Edition

A real-time multiplayer drawing-and-guessing game for 2–4 players. React/Vite frontend, Node/Express server, Socket.IO real-time events. No player accounts required.

## Requirements
- Node.js 20+
- npm

## Run locally
```bash
npm install
npm run dev
```
Open the Vite URL printed by Vite. The server listens on port 3001; Vite proxies Socket.IO to it. To test multiplayer, open the URL in separate browser profiles/devices.

## Production
```bash
npm install
npm run build
npm start
```
The app serves the built frontend and Socket.IO server from the same Node process. Set `PORT` if your host provides one. `/health` returns a simple health check.

## Current implementation notes
- Server-authoritative room membership, round deadline, artist selection, hints, and scoring.
- Rooms and scores are held in memory; server restart ends active games.
- Room code is six characters; nickname only.
- Five rounds, 90 seconds each, category hint at 30 seconds and first-letter hint at 60 seconds.
- Guessers receive speed points (100 minus elapsed seconds, minimum 10); artist receives 25 if at least one player solves the round.
- Curated clue fragments build the final reveal.

## Deployment
Deploy as a Node web service that supports persistent WebSocket connections. Build command: `npm install && npm run build`; start command: `npm start`. Verify `/health` and test a full match using two separate browsers after deployment.

## Known first-pass limitations to fix during playtesting
- The final reveal is currently assembled from the five fragments in the selected case deck; narrative consistency should be checked and curated into explicit five-clue packs.
- Reconnection uses a browser-stored session token and has automated coverage, but cross-device recovery is not supported and reconnect behavior still needs live-browser testing.
- Basic per-socket rate limits exist; they are not a substitute for production abuse monitoring.
- Rooms and scores are in memory, so restarts/deploys clear active games. Persistent storage and multi-instance coordination are not implemented.
- A real two-browser smoke test and production build must pass before treating the deployment as launch-verified.
- Render's free service tier may spin down when idle; use an always-on paid instance if continuous availability is a requirement. No host can guarantee 100% uptime.

## Automated checks
Run `npm test` to test room creation, validation, prompt privacy, guess normalization, reconnecting, and artist-only drawing.
