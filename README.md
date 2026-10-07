# Huddle (fixed for Railway)

`public/` is your original build, untouched, so it looks exactly the same.
`server.js` is the missing backend: it serves `public/` and implements
`/api/users`, `/api/rooms` and `/api/rooms/:slug/messages`. No dependencies.

## Deploy on Railway
1. Put these files at the root of a GitHub repo (or `railway up` from this folder).
2. Railway detects `package.json` and runs `npm start` (`node server.js`).
   The server listens on Railway's `PORT` and `0.0.0.0`, which fixes the 502.
3. Settings -> Networking -> Generate Domain.
4. To keep chats across redeploys: add a Volume mounted at `/data`
   and set the variable `DATA_DIR=/data`. Without it, data resets on each deploy.

Health check: `/health`
