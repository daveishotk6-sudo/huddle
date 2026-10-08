# Huddle (Railway-ready)

Pocket-sized live chat rooms.

- **Frontend**: original build (people count updates every **20 seconds**)
- **Backend**: zero-dependency Node server (`server.js`) that serves the static files and implements `/api/users`, `/api/rooms`, `/api/rooms/:slug/messages`
- Listens on `0.0.0.0:$PORT` so Railway works (no more 502)

## Deploy on Railway

1. Connect this GitHub repo: https://github.com/daveishotk6-sudo/huddle
2. Railway will detect `package.json` and run `npm start` → `node server.js`
3. Generate a public domain under **Settings → Networking**
4. (Recommended) Add a **Volume** mounted at `/data` and set variable `DATA_DIR=/data` so chats survive redeploys

Health check: `/health`

## Local

```bash
node server.js
# open http://localhost:3000
```
