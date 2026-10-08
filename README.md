# Huddle (Railway-ready)

Pocket-sized live chat rooms.

## What’s improved
- **Unique people online**: one person in multiple rooms counts as 1 (no more double-counting)
- **Longer chat history** on open (200 messages)
- **People stay “online” for 15 minutes** after their last message
- **Persistence across deploys**: set a Railway Volume + `DATA_DIR=/data`
- Server listens on `0.0.0.0:$PORT` (no 502)
- People count poll every 20s

## Deploy on Railway
1. Connect this repo: https://github.com/daveishotk6-sudo/huddle
2. Railway runs `node server.js` automatically
3. Settings → Networking → Generate Domain
4. **For chat history to survive redeploys**:
   - Add a Volume, mount it at `/data`
   - Add variable `DATA_DIR=/data`

Health check: `/health`

## Local
```bash
node server.js
# http://localhost:3000
```
