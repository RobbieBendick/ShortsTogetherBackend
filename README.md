# ShortsTogetherBackend

WebSocket sync server for the ShortsTogether Chrome extension.

Keeps two browsers on the same YouTube Short when either person swipes.

## Deploy on Render

1. Push this repo to GitHub.
2. Render → **New** → **Web Service** → connect the repo.
3. Settings:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance | Free |

4. Open the HTTPS URL — you should see:

```json
{"ok":true,"service":"shortstogether"}
```

5. In the ShortsTogether extension, set **Sync server** to:

```text
wss://YOUR-SERVICE-NAME.onrender.com
```

Both people use that same URL + the same room code.

> Free Render apps sleep when idle. First connect after sleep can take ~30–60s.

## Local

```bash
npm install
npm run dev
```

→ `ws://localhost:3001`

## Protocol (JSON over WebSocket)

- `{ "type": "create-room" }`
- `{ "type": "join-room", "roomId": "abc123" }`
- `{ "type": "set-video", "videoId": "youtubeId" }`
- `{ "type": "leave-room" }`
