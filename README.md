# ShortsTogetherBackend

WebSocket sync for ShortsTogether’s **shared web player** + YouTube **feed bridges**.

## Roles

- **watcher** — browser on the website (shared player)
- **bridge** — Chrome extension on `youtube.com/shorts` supplying algorithm “next”

## Deploy on Render

Already set up if you deployed earlier. Push updates to redeploy.

1. Push this repo to GitHub.
2. Render Web Service: Build `npm install`, Start `npm start`.
3. Extension + website Sync server: `wss://YOUR-SERVICE.onrender.com`

## Local

```bash
npm install
npm run dev
```

## Protocol

- `create-room` / `join-room` with `{ clientId, name, role: "watcher" | "bridge" }`
- `set-feed-owner` — whose bridge supplies next
- `request-navigate` `{ direction: "next" | "prev" }` — next asks the feed bridge to advance YouTube
- `set-video` — only accepted from the feed owner (bridge)
