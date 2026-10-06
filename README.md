# Huddle

Pocket-sized live chat rooms.

**People count now updates every 20 seconds.**

## Deploy on Railway / static host

This is the production build of the frontend.

- `index.html`
- `assets/index-Cklpbby4.js` (main app, interval fixed to 20s)
- `assets/index-DLUjAQq1.css`
- `icon.svg`
- `manifest.webmanifest`

Note: the original Netlify version used serverless functions + a database for rooms/messages/users. This static build will need those APIs re-implemented or pointed at a backend if you want full functionality on Railway.

Replace the placeholder JS file with the real one from the attached zip if needed.
