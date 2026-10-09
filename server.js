// Huddle server — emergency restore
"use strict";
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const gamesLogic = require("./games-logic");
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "huddle.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOT_DIR = __dirname;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Unauthorized601";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const SEND_COOLDOWN_MS = 3000;
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const IMAGE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_ROOM = 5000;
const INITIAL_MESSAGES = 200;
const DEFAULT_ROOMS = [["General","💬","Anything goes"],["Food","🍕","What are you eating?"],["Movies & TV","🎬","What are you watching?"],["Tech","💻","Gadgets, code, and everything in between"],["Pets","🐶","Show off your best friend"],["AI","🤖","Chat with AI — ask anything"]];
let db = { nextUserId: 1, nextRoomId: 1, nextMessageId: 1, nextGameId: 1, users: [], rooms: [], messages: [], games: [] };
function load() {
  try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; if (!db.games) db.games = []; if (!db.nextGameId) db.nextGameId = 1; }
  catch (e) { if (e.code !== "ENOENT") console.error("Could not read db:", e.message); }
  ensureDefaultRooms(); ensureAiUser(); saveSoon();
}
function ensureDefaultRooms() {
  for (const [name, emoji, description] of DEFAULT_ROOMS) {
    if (!db.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase() || r.slug === slugify(name))) createRoom(name, emoji, description);
  }
}
function ensureAiUser() {
  let ai = db.users.find((u) => u.isAI);
  if (!ai) {
    db.users = db.users.filter((u) => u.handle.toLowerCase() !== "ai");
    ai = { id: db.nextUserId++, handle: "AI", realName: "Assistant", nicknames: "bot", color: "#7048e8", tokenHash: hash(crypto.randomBytes(32).toString("base64url")), isAdmin: false, isAI: true, createdAt: new Date().toISOString() };
    db.users.push(ai);
  }
  return ai;
}
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = DB_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB_FILE); }
    catch (e) { console.error("Save failed:", e.message); }
  }, 500);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error("Save failed:", e.message); }
}
function cleanupOldImages() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const now = Date.now(); let removed = 0;
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      const file = path.join(UPLOAD_DIR, name);
      try { const st = fs.statSync(file); if (st.isFile() && now - st.mtimeMs > IMAGE_MAX_AGE_MS) { fs.unlinkSync(file); removed++; } } catch (e) {}
    }
    if (removed) console.log("Cleaned", removed, "old image(s)");
  } catch (e) { console.error("Image cleanup failed:", e.message); }
}
const COLORS = ["#ff6b6b", "#f59f00", "#37b24d", "#1c7ed6", "#7048e8", "#d6336c", "#0ca678", "#e8590c"];
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function slugify(name) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || "room";
}
function createRoom(name, emoji, description) {
  let slug = slugify(name), n = 2;
  while (db.rooms.some((r) => r.slug === slug)) slug = slugify(name) + "-" + (n++);
  const room = { id: db.nextRoomId++, slug, name, emoji, description, createdAt: new Date().toISOString() };
  db.rooms.push(room); return room;
}
const publicRoom = (r) => ({ id: r.id, slug: r.slug, name: r.name, emoji: r.emoji, description: r.description });
function publicMessage(m) {
  const u = db.users.find((x) => x.id === m.userId);
  return { id: m.id, roomId: m.roomId, userId: m.userId, author: u ? u.handle : (m.author || "deleted"), realName: u ? u.realName : (m.realName || ""), nicknames: u ? u.nicknames : (m.nicknames || ""), color: u ? u.color : (m.color || "#7a7366"), isAdmin: !!(u && u.isAdmin), isAI: !!(u && u.isAI), body: m.body, imageUrl: m.imageUrl || null, gameId: m.gameId || null, createdAt: m.createdAt };
}
function authUser(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || "");
  if (!m) throw new HttpError(401, "Please set up your profile first.");
  const h = hash(m[1]); const u = db.users.find((x) => x.tokenHash === h);
  if (!u) throw new HttpError(401, "Your profile wasn't recognised. Please set it up again.");
  return u;
}
function authAdmin(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || "");
  if (!m) throw new HttpError(401, "Admin login required.");
  const h = hash(m[1]); const u = db.users.find((x) => x.tokenHash === h && x.isAdmin);
  if (!u) throw new HttpError(401, "Admin login required.");
  return u;
}
const hits = new Map(); const lastSendAt = new Map();
function rateLimit(req, key, limit, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const k = key + ":" + ip, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) throw new HttpError(429, "Slow down a little and try again.");
  arr.push(now); hits.set(k, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, arr] of hits) if (!arr.some((t) => now - t < 3600e3)) hits.delete(k); }, 10 * 60 * 1000).unref();
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 16 * 1024) { reject(new HttpError(413, "Request too large.")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(v && typeof v === "object" ? v : {}); } catch (e) { reject(new HttpError(400, "Invalid request.")); } });
    req.on("error", reject);
  });
}
function send(res, status, body, headers) {
  headers = headers || {};
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers));
  res.end(data);
}
function findUserByName(query) {
  const q = clean(query, 80).toLowerCase();
  if (!q) return null;
  return db.users.find((u) => u.handle.toLowerCase() === q || (u.realName && u.realName.toLowerCase() === q) || (u.nicknames && u.nicknames.toLowerCase().split(/[,/|]+/).map((s) => s.trim()).includes(q)) || (u.nicknames && u.nicknames.toLowerCase() === q)) || null;
}
function openRouterChat(messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: OPENROUTER_MODEL, messages, max_tokens: 800, temperature: 0.7 });
    const req = https.request({ hostname: "openrouter.ai", path: "/api/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + OPENROUTER_API_KEY, "HTTP-Referer": "https://huddle.app", "X-Title": "Huddle AI Chat", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
        try { const data = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (data.error) return reject(new Error(data.error.message || "AI error")); const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content; if (!text) return reject(new Error("Empty AI response")); resolve(String(text).slice(0, 2000)); } catch (e) { reject(new Error("Bad AI response")); }
      });
    });
    req.on("error", reject); req.setTimeout(45000, () => { req.destroy(); reject(new Error("AI timed out")); }); req.write(payload); req.end();
  });
}
async function replyAsAi(room) {
  if (!OPENROUTER_API_KEY) { const ai = ensureAiUser(); const m = { id: db.nextMessageId++, roomId: room.id, userId: ai.id, body: "AI is not configured. Set OPENROUTER_API_KEY on Railway.", imageUrl: null, gameId: null, createdAt: new Date().toISOString() }; db.messages.push(m); saveSoon(); return m; }
  const ai = ensureAiUser();
  const recent = db.messages.filter((m) => m.roomId === room.id).slice(-12).map((m) => { const u = db.users.find((x) => x.id === m.userId); return { role: (u && u.isAI) ? "assistant" : "user", content: (m.body || "").slice(0, 500) }; }).filter((m) => m.content);
  try { const text = await openRouterChat([{ role: "system", content: "You are the Huddle AI assistant. Keep replies concise and friendly." }].concat(recent)); const m = { id: db.nextMessageId++, roomId: room.id, userId: ai.id, body: text, imageUrl: null, gameId: null, createdAt: new Date().toISOString() }; db.messages.push(m); saveSoon(); return m; }
  catch (e) { console.error("AI reply failed:", e.message); const m = { id: db.nextMessageId++, roomId: room.id, userId: ai.id, body: "Sorry — I couldn't reply just now.", imageUrl: null, gameId: null, createdAt: new Date().toISOString() }; db.messages.push(m); saveSoon(); return m; }
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
    if (handle.toLowerCase() === "ai" || handle.toLowerCase() === "admin") throw new HttpError(409, "That name is reserved.");
    if (db.users.some((u) => u.handle.toLowerCase() === handle.toLowerCase())) throw new HttpError(409, "That name is already taken — try another.");
    const token = crypto.randomBytes(32).toString("base64url");
    const user = { id: db.nextUserId++, handle, realName, nicknames, color, tokenHash: hash(token), isAdmin: false, isAI: false, createdAt: new Date().toISOString() };
    db.users.push(user); saveSoon();
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
      admin = { id: db.nextUserId++, handle: "Admin", realName: "Administrator", nicknames: "admin", color: "#ff5a36", tokenHash: hash(token), isAdmin: true, isAI: false, createdAt: new Date().toISOString() };
      db.users.push(admin); saveSoon();
      return send(res, 200, { token, user: { id: admin.id, handle: admin.handle, realName: admin.realName, nicknames: admin.nicknames, color: admin.color, isAdmin: true } });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    admin.tokenHash = hash(token); admin.isAdmin = true; saveSoon();
    return send(res, 200, { token, user: { id: admin.id, handle: admin.handle, realName: admin.realName, nicknames: admin.nicknames, color: admin.color, isAdmin: true } });
  }
  if (parts[0] === "admin" && parts[1] === "users" && parts.length === 2 && method === "GET") {
    authAdmin(req);
    return send(res, 200, db.users.filter((u) => !u.isAdmin && !u.isAI).map((u) => ({ id: u.id, handle: u.handle, realName: u.realName, nicknames: u.nicknames, color: u.color, createdAt: u.createdAt, messageCount: db.messages.filter((m) => m.userId === u.id).length })).sort((a, b) => a.handle.localeCompare(b.handle)));
  }
  if (parts[0] === "admin" && parts[1] === "users" && parts.length === 2 && method === "DELETE") {
    authAdmin(req);
    const b = await readJson(req);
    const target = findUserByName(b.query || b.handle || b.name || "");
    if (!target) throw new HttpError(404, "No user found with that name or nickname.");
    if (target.isAdmin || target.isAI) throw new HttpError(400, "Cannot remove that account.");
    const removedHandle = target.handle;
    db.users = db.users.filter((u) => u.id !== target.id);
    for (const m of db.messages) { if (m.userId === target.id) { m.author = removedHandle; m.userId = null; } }
    saveSoon();
    return send(res, 200, { ok: true, removed: removedHandle });
  }
  if (parts[0] === "admin" && parts[1] === "wipe" && parts.length === 2 && method === "POST") {
    authAdmin(req);
    rateLimit(req, "admin-wipe", 3, 60 * 60 * 1000);
    db.messages = []; db.nextMessageId = 1; db.rooms = []; db.nextRoomId = 1; db.games = []; db.nextGameId = 1;
    for (const row of DEFAULT_ROOMS) createRoom(row[0], row[1], row[2]);
    ensureAiUser();
    try { if (fs.existsSync(UPLOAD_DIR)) for (const name of fs.readdirSync(UPLOAD_DIR)) try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch (e) {} } catch (e) {}
    saveSoon();
    return send(res, 200, { ok: true, message: "Wiped. Rooms + AI restored.", rooms: db.rooms.map(publicRoom) });
  }
  if (parts[0] === "upload" && parts.length === 1 && method === "POST") {
    const user = authUser(req);
    rateLimit(req, "upload", 20, 60 * 60 * 1000);
    const b = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > 4 * 1024 * 1024) { reject(new HttpError(413, "Image too large.")); req.destroy(); return; } chunks.push(c); });
      req.on("end", () => { try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(v && typeof v === "object" ? v : {}); } catch (e) { reject(new HttpError(400, "Invalid request.")); } });
      req.on("error", reject);
    });
    const dataUrl = typeof b.dataUrl === "string" ? b.dataUrl : "";
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!m) throw new HttpError(400, "Only PNG, JPEG, WebP, or GIF images are allowed.");
    const ext = m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase();
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Image too large (max ~2.5MB).");
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + "." + (ext === "jpeg" ? "jpg" : ext);
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return send(res, 201, { url: "/uploads/" + name });
  }
  if (parts[0] === "games") {
    gamesLogic.setContext(db, HttpError);
    if (parts.length === 1 && method === "GET") {
      const roomSlug = url.searchParams.get("room") || "";
      const room = roomSlug ? db.rooms.find((r) => r.slug === roomSlug) : null;
      let list = (db.games || []).filter((g) => g.status !== "done" && g.status !== "cancelled");
      if (room) list = list.filter((g) => g.roomId === room.id);
      return send(res, 200, list.map(gamesLogic.publicGame));
    }
    if (parts.length === 1 && method === "POST") {
      const user = authUser(req);
      rateLimit(req, "game", 20, 60 * 1000);
      const b = await readJson(req);
      const type = String(b.type || "").toLowerCase();
      const TYPES = { tictactoe: "Tic-Tac-Toe", connect4: "Connect Four", rps: "Rock Paper Scissors", fight: "Fight" };
      if (!TYPES[type]) throw new HttpError(400, "Unknown game. Try tictactoe, connect4, rps, or fight.");
      const room = db.rooms.find((r) => r.slug === String(b.roomSlug || ""));
      if (!room) throw new HttpError(400, "Open a room first, then start a game.");
      for (const g of (db.games || [])) { if (g.roomId === room.id && g.hostId === user.id && g.status === "waiting") g.status = "cancelled"; }
      const game = gamesLogic.createGame(type, room.id, user.id);
      db.games.push(game);
      const msg = { id: db.nextMessageId++, roomId: room.id, userId: user.id, body: "🎮 Let's play " + TYPES[type] + "! Open Games and tap Join. (game #" + game.id + ")", imageUrl: null, gameId: game.id, createdAt: new Date().toISOString() };
      db.messages.push(msg); saveSoon();
      return send(res, 201, { game: gamesLogic.publicGame(game), message: publicMessage(msg) });
    }
    if (parts.length === 2 && method === "GET") {
      const game = (db.games || []).find((g) => Number(g.id) === Number(parts[1]));
      if (!game) throw new HttpError(404, "Game not found.");
      return send(res, 200, gamesLogic.publicGame(game));
    }
    if (parts.length === 3 && parts[2] === "join" && method === "POST") {
      const user = authUser(req);
      const game = (db.games || []).find((g) => Number(g.id) === Number(parts[1]));
      if (!game) throw new HttpError(404, "Game not found.");
      const uid = Number(user.id);
      const hostId = Number(game.hostId);
      const guestId = game.guestId != null ? Number(game.guestId) : null;
      if (uid === hostId || (guestId != null && uid === guestId)) {
        return send(res, 200, gamesLogic.publicGame(game));
      }
      if (game.status === "active" || game.status === "done" || game.status === "cancelled") {
        throw new HttpError(400, "This game already started or ended.");
      }
      if (game.status !== "waiting") throw new HttpError(400, "This game already started or ended.");
      if (guestId != null) throw new HttpError(400, "Someone already joined.");
      game.guestId = uid;
      game.status = "active";
      game.updatedAt = new Date().toISOString();
      if (game.type === "rps") {
        if (!game.scores) game.scores = {};
        game.scores[hostId] = game.scores[hostId] || 0;
        game.scores[uid] = 0;
      }
      if (game.type === "fight") {
        if (!game.hp) game.hp = {};
        game.hp[hostId] = game.hp[hostId] != null ? game.hp[hostId] : 100;
        game.hp[uid] = 100;
        game.choices = {};
        game.round = game.round || 1;
      }
      try {
        const room = db.rooms.find((r) => r.id === game.roomId);
        if (room) {
          const notice = { id: db.nextMessageId++, roomId: room.id, userId: user.id, body: "✅ Joined game #" + game.id + " — open Games → Play", imageUrl: null, gameId: game.id, createdAt: new Date().toISOString() };
          db.messages.push(notice);
        }
      } catch (e) {}
      saveSoon();
      return send(res, 200, gamesLogic.publicGame(game));
    }
    if (parts.length === 3 && parts[2] === "move" && method === "POST") {
      const user = authUser(req);
      const game = (db.games || []).find((g) => Number(g.id) === Number(parts[1]));
      if (!game) throw new HttpError(404, "Game not found.");
      if (game.status !== "active") throw new HttpError(400, "Game is not active.");
      const uid = Number(user.id);
      if (uid !== Number(game.hostId) && uid !== Number(game.guestId)) throw new HttpError(403, "You're not in this game.");
      const b = await readJson(req);
      gamesLogic.applyMove(game, user.id, b.move);
      game.updatedAt = new Date().toISOString(); saveSoon();
      return send(res, 200, gamesLogic.publicGame(game));
    }
    if (parts.length === 3 && parts[2] === "cancel" && method === "POST") {
      const user = authUser(req);
      const game = (db.games || []).find((g) => Number(g.id) === Number(parts[1]));
      if (!game) throw new HttpError(404, "Game not found.");
      const uid = Number(user.id);
      if (uid !== Number(game.hostId) && uid !== Number(game.guestId || -1)) throw new HttpError(403, "Not your game.");
      game.status = "cancelled"; game.updatedAt = new Date().toISOString(); saveSoon();
      return send(res, 200, gamesLogic.publicGame(game));
    }
  }
  if (parts[0] === "rooms" && parts.length === 1) {
    if (method === "GET") {
      const now = Date.now();
      const active = new Set();
      for (const m of db.messages) {
        if (now - new Date(m.createdAt).getTime() <= ACTIVE_WINDOW_MS && m.userId) active.add(m.userId);
      }
      const rooms = db.rooms.map((r) => {
        const msgs = db.messages.filter((m) => m.roomId === r.id);
        const last = msgs.length ? msgs[msgs.length - 1] : null;
        return Object.assign(publicRoom(r), { activeCount: active.size, lastMessage: last ? publicMessage(last) : null });
      });
      return send(res, 200, rooms);
    }
    if (method === "POST") {
      const user = authUser(req);
      rateLimit(req, "room", 10, 60 * 60 * 1000);
      const b = await readJson(req);
      const name = clean(b.name, 40), emoji = clean(b.emoji || "💬", 8), description = clean(b.description || "", 120);
      if (name.length < 2) throw new HttpError(400, "Room name too short.");
      const room = createRoom(name, emoji, description); saveSoon();
      return send(res, 201, { id: room.id, slug: room.slug, name: room.name, emoji: room.emoji, description: room.description, activeCount: 0, lastMessage: null });
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
      if (user.isAI) throw new HttpError(403, "AI cannot post as a user.");
      const now = Date.now();
      const last = lastSendAt.get(user.id) || 0;
      if (now - last < SEND_COOLDOWN_MS) throw new HttpError(429, "Wait " + Math.ceil((SEND_COOLDOWN_MS - (now - last)) / 1000) + "s before sending again.");
      rateLimit(req, "send", 40, 60 * 1000);
      const b = await readJson(req);
      let body = typeof b.body === "string" ? b.body.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1000) : "";
      let imageUrl = null;
      if (typeof b.imageUrl === "string" && b.imageUrl.startsWith("/uploads/")) imageUrl = b.imageUrl.slice(0, 200);
      if (!body && !imageUrl) throw new HttpError(400, "Message can't be empty.");
      lastSendAt.set(user.id, now);
      const msg = { id: db.nextMessageId++, roomId: room.id, userId: user.id, body, imageUrl, gameId: null, createdAt: new Date().toISOString() };
      db.messages.push(msg);
      const mine = db.messages.filter((x) => x.roomId === room.id);
      if (mine.length > MAX_MESSAGES_PER_ROOM) { const drop = new Set(mine.slice(0, mine.length - MAX_MESSAGES_PER_ROOM).map((x) => x.id)); db.messages = db.messages.filter((x) => !drop.has(x.id)); }
      saveSoon();
      if ((room.slug === "ai" || room.name.toLowerCase() === "ai") && body) setImmediate(() => { replyAsAi(room).catch((e) => console.error(e)); });
      return send(res, 201, publicMessage(msg));
    }
  }
  throw new HttpError(404, "Not found.");
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2" };
function resolveStatic(rel) {
  const candidates = [path.normalize(path.join(PUBLIC_DIR, rel)), path.normalize(path.join(ROOT_DIR, rel))];
  for (const file of candidates) { if ((file.startsWith(PUBLIC_DIR) || file.startsWith(ROOT_DIR)) && fs.existsSync(file) && fs.statSync(file).isFile()) return file; }
  return null;
}
function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/admin" || rel === "/admin/") rel = "/admin.html";
  let isAsset = rel.startsWith("/assets/");
  let file = resolveStatic(rel);
  if (!file) { if (isAsset || path.extname(rel)) return send(res, 404, "Not found", { "Content-Type": "text/plain" }); file = resolveStatic("/index.html") || path.join(PUBLIC_DIR, "index.html"); isAsset = false; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache" });
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
    if (url.pathname.startsWith("/uploads/")) {
      const name = path.basename(url.pathname);
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) return send(res, 404, { error: "Not found." });
      const file = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(file)) return send(res, 404, { error: "Not found." });
      const ext = path.extname(file).toLowerCase();
      const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      return fs.createReadStream(file).pipe(res);
    }
    return serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    return send(res, status, { error: e.message || "Server error." });
  }
});
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
load();
cleanupOldImages();
setInterval(cleanupOldImages, 60 * 60 * 1000).unref();
server.listen(PORT, HOST, () => console.log("Huddle listening on " + HOST + ":" + PORT));
process.on("SIGTERM", () => { flush(); process.exit(0); });
process.on("SIGINT", () => { flush(); process.exit(0); });
