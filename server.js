// Huddle server: serves the built frontend from ./public (or root) and implements the
// /api/* endpoints the frontend expects. Zero dependencies.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "huddle.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOT_DIR = __dirname;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Unauthorized601";
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_ROOM = 5000;
const INITIAL_MESSAGES = 200;

let db = { nextUserId: 1, nextRoomId: 1, nextMessageId: 1, users: [], rooms: [], messages: [] };

function load() {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") console.error("Could not read db, starting fresh:", e.message);
  }
  if (db.rooms.length === 0) {
    [
      ["General", "💬", "Anything goes"],
      ["Food", "🍕", "What are you eating?"],
      ["Movies & TV", "🎬", "What are you watching?"],
      ["Tech", "💻", "Gadgets, code, and everything in between"],
      ["Pets", "🐶", "Show off your best friend"],
    ].forEach(([name, emoji, description]) => createRoom(name, emoji, description));
    saveSoon();
  }
}

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error("Save failed:", e.message);
    }
  }, 500);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  } catch (e) { console.error("Save failed:", e.message); }
}

const COLORS = ["#ff6b6b", "#f59f00", "#37b24d", "#1c7ed6", "#7048e8", "#d6336c", "#0ca678", "#e8590c"];
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function slugify(name) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || "room";
}

function createRoom(name, emoji, description) {
  let slug = slugify(name), n = 2;
  while (db.rooms.some((r) => r.slug === slug)) slug = `${slugify(name)}-${n++}`;
  const room = { id: db.nextRoomId++, slug, name, emoji, description, createdAt: new Date().toISOString() };
  db.rooms.push(room);
  return room;
}

const publicRoom = (r) => ({ id: r.id, slug: r.slug, name: r.name, emoji: r.emoji, description: r.description });

function publicMessage(m) {
  const u = db.users.find((x) => x.id === m.userId);
  const isAdmin = !!(u && u.isAdmin);
  return {
    id: m.id, roomId: m.roomId, userId: m.userId,
    author: u ? u.handle : (m.author || "deleted"),
    realName: u ? u.realName : (m.realName || ""),
    nicknames: u ? u.nicknames : (m.nicknames || ""),
    color: u ? u.color : (m.color || "#7a7366"),
    isAdmin,
    body: m.body, createdAt: m.createdAt,
  };
}

function authUser(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || "");
  if (!m) throw new HttpError(401, "Please set up your profile first.");
  const h = hash(m[1]);
  const u = db.users.find((x) => x.tokenHash === h);
  if (!u) throw new HttpError(401, "Your profile wasn't recognised. Please set it up again.");
  return u;
}

function authAdmin(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || "");
  if (!m) throw new HttpError(401, "Admin login required.");
  const h = hash(m[1]);
  const u = db.users.find((x) => x.tokenHash === h && x.isAdmin);
  if (!u) throw new HttpError(401, "Admin login required.");
  return u;
}

const hits = new Map();
function rateLimit(req, key, limit, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const k = `${key}:${ip}`, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) throw new HttpError(429, "Slow down a little and try again.");
  arr.push(now);
  hits.set(k, arr);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) if (!arr.some((t) => now - t < 3600e3)) hits.delete(k);
}, 10 * 60 * 1000).unref();

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new HttpError(413, "Request too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(v && typeof v === "object" ? v : {});
      } catch { reject(new HttpError(400, "Invalid request.")); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}

function findUserByName(query) {
  const q = clean(query, 80).toLowerCase();
  if (!q) return null;
  return db.users.find((u) =>
    u.handle.toLowerCase() === q ||
    (u.realName && u.realName.toLowerCase() === q) ||
    (u.nicknames && u.nicknames.toLowerCase().split(/[,/|]+/).map((s) => s.trim()).includes(q)) ||
    (u.nicknames && u.nicknames.toLowerCase() === q)
  ) || null;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
  const method = req.method;

  if (parts[0] === "users" && parts.length === 1 && method === "POST") {
    rateLimit(req, "register", 10, 60 * 60 * 1000);
    const b = await readJson(req);
    const handle = clean(b.handle, 24), realName = clean(b.realName, 60), nicknames = clean(b.nicknames, 80);
    const color = COLORS.includes(b.color) ? b.color : COLORS[Math.floor(Math.random() * COLORS.length)];
    if (handle.length < 2) throw new HttpError(400, "Pick a name with at least 2 characters.");
    if (realName.length < 2) throw new HttpError(400, "Please enter your real name.");
    if (db.users.some((u) => u.handle.toLowerCase() === handle.toLowerCase()))
      throw new HttpError(409, "That name is already taken — try another.");
    const token = crypto.randomBytes(32).toString("base64url");
    const user = { id: db.nextUserId++, handle, realName, nicknames, color, tokenHash: hash(token), isAdmin: false, createdAt: new Date().toISOString() };
    db.users.push(user);
    saveSoon();
    return send(res, 201, { user: { id: user.id, handle, realName, nicknames, color, isAdmin: false }, token });
  }

  if (parts[0] === "admin" && parts[1] === "login" && parts.length === 2 && method === "POST") {
    rateLimit(req, "admin-login", 5, 15 * 60 * 1000);
    const b = await readJson(req);
    if (String(b.password || "") !== ADMIN_PASSWORD) throw new HttpError(401, "Wrong password.");
    let admin = db.users.find((u) => u.isAdmin && u.handle === "Admin");
    if (!admin) {
      db.users = db.users.filter((u) => u.handle.toLowerCase() !== "admin");
      const token = crypto.randomBytes(32).toString("base64url");
      admin = {
        id: db.nextUserId++,
        handle: "Admin",
        realName: "Administrator",
        nicknames: "admin",
        color: "#ff5a36",
        tokenHash: hash(token),
        isAdmin: true,
        createdAt: new Date().toISOString(),
      };
      db.users.push(admin);
      saveSoon();
      return send(res, 200, {
        token,
        user: { id: admin.id, handle: admin.handle, realName: admin.realName, nicknames: admin.nicknames, color: admin.color, isAdmin: true },
      });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    admin.tokenHash = hash(token);
    admin.isAdmin = true;
    saveSoon();
    return send(res, 200, {
      token,
      user: { id: admin.id, handle: admin.handle, realName: admin.realName, nicknames: admin.nicknames, color: admin.color, isAdmin: true },
    });
  }

  if (parts[0] === "admin" && parts[1] === "users" && parts.length === 2 && method === "GET") {
    authAdmin(req);
    const list = db.users
      .filter((u) => !u.isAdmin)
      .map((u) => ({
        id: u.id,
        handle: u.handle,
        realName: u.realName,
        nicknames: u.nicknames,
        color: u.color,
        createdAt: u.createdAt,
        messageCount: db.messages.filter((m) => m.userId === u.id).length,
      }))
      .sort((a, b) => a.handle.localeCompare(b.handle));
    return send(res, 200, list);
  }

  if (parts[0] === "admin" && parts[1] === "users" && parts.length === 2 && method === "DELETE") {
    authAdmin(req);
    const b = await readJson(req);
    const query = b.query || b.handle || b.name || b.nickname || "";
    const target = findUserByName(query);
    if (!target) throw new HttpError(404, "No user found with that name or nickname.");
    if (target.isAdmin) throw new HttpError(400, "Cannot remove the admin account.");
    const removedHandle = target.handle;
    db.users = db.users.filter((u) => u.id !== target.id);
    for (const m of db.messages) {
      if (m.userId === target.id) {
        m.author = removedHandle;
        m.realName = target.realName;
        m.nicknames = target.nicknames;
        m.color = target.color;
        m.userId = null;
      }
    }
    saveSoon();
    return send(res, 200, { ok: true, removed: removedHandle, message: `"${removedHandle}" removed. That name is free again.` });
  }

  if (parts[0] === "rooms" && parts.length === 1) {
    if (method === "GET") {
      const now = Date.now();
      const list = db.rooms.map((r) => {
        const msgs = db.messages.filter((m) => m.roomId === r.id);
        const last = msgs[msgs.length - 1];
        const active = new Set(msgs.filter((m) => now - new Date(m.createdAt).getTime() < ACTIVE_WINDOW_MS).map((m) => m.userId).filter(Boolean));
        return {
          ...publicRoom(r),
          activeCount: active.size,
          lastMessage: last ? { author: publicMessage(last).author, body: last.body, createdAt: last.createdAt } : null,
          _t: last ? new Date(last.createdAt).getTime() : new Date(r.createdAt).getTime(),
        };
      }).sort((a, b) => b._t - a._t).map(({ _t, ...r }) => r);
      return send(res, 200, list);
    }
    if (method === "POST") {
      rateLimit(req, "room", 10, 60 * 60 * 1000);
      const b = await readJson(req);
      const name = clean(b.name, 40), description = clean(b.description, 120);
      const emoji = clean(b.emoji, 8) || "💬";
      if (name.length < 2) throw new HttpError(400, "Room name must be at least 2 characters.");
      if (db.rooms.length >= 500) throw new HttpError(400, "Too many rooms already.");
      if (db.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase()))
        throw new HttpError(409, "A room with that name already exists.");
      const room = createRoom(name, emoji, description);
      saveSoon();
      return send(res, 201, { ...publicRoom(room), activeCount: 0, lastMessage: null });
    }
  }

  if (parts[0] === "rooms" && parts.length === 3 && parts[2] === "messages") {
    const room = db.rooms.find((r) => r.slug === parts[1]);
    if (!room) throw new HttpError(404, "That room doesn't exist.");

    if (method === "GET") {
      const after = Number(url.searchParams.get("after")) || 0;
      let msgs = db.messages.filter((m) => m.roomId === room.id && m.id > after);
      if (after === 0) msgs = msgs.slice(-INITIAL_MESSAGES);
      return send(res, 200, { room: publicRoom(room), messages: msgs.slice(0, 200).map(publicMessage) });
    }
    if (method === "POST") {
      const user = authUser(req);
      rateLimit(req, "send", 40, 60 * 1000);
      const b = await readJson(req);
      const body = typeof b.body === "string" ? b.body.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1000) : "";
      if (!body) throw new HttpError(400, "Message can't be empty.");
      const m = { id: db.nextMessageId++, roomId: room.id, userId: user.id, body, createdAt: new Date().toISOString() };
      db.messages.push(m);
      const mine = db.messages.filter((x) => x.roomId === room.id);
      if (mine.length > MAX_MESSAGES_PER_ROOM) {
        const drop = new Set(mine.slice(0, mine.length - MAX_MESSAGES_PER_ROOM).map((x) => x.id));
        db.messages = db.messages.filter((x) => !drop.has(x.id));
      }
      saveSoon();
      return send(res, 201, publicMessage(m));
    }
  }

  throw new HttpError(404, "Not found.");
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json",
  ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

function resolveStatic(rel) {
  const candidates = [
    path.normalize(path.join(PUBLIC_DIR, rel)),
    path.normalize(path.join(ROOT_DIR, rel)),
  ];
  for (const file of candidates) {
    if ((file.startsWith(PUBLIC_DIR) || file.startsWith(ROOT_DIR)) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return file;
    }
  }
  return null;
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
  let rel = decodeURIComponent(url.pathname);
  let isAsset = rel.startsWith("/assets/");
  let file = resolveStatic(rel);
  if (!file) {
    if (isAsset || path.extname(rel)) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    file = resolveStatic("/index.html") || path.join(PUBLIC_DIR, "index.html");
    isAsset = false;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Something went wrong." });
  }
});
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

load();
server.listen(PORT, HOST, () => console.log(`Huddle listening on http://${HOST}:${PORT} (data: ${DB_FILE})`));

function shutdown() { flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
