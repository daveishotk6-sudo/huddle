"use strict";
let db = null;
let HttpError = class extends Error { constructor(s, m) { super(m); this.status = s; } };
function setContext(database, Err) { db = database; if (Err) HttpError = Err; }
function createGame(type, roomId, hostId) {
  const base = { id: db.nextGameId++, type, roomId, hostId, guestId: null, status: "waiting", winnerId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (type === "tictactoe") { base.board = Array(9).fill(null); base.turn = hostId; }
  else if (type === "connect4") { base.board = Array(6).fill(null).map(() => Array(7).fill(null)); base.turn = hostId; }
  else if (type === "rps") { base.choices = {}; base.round = 1; base.scores = {}; base.scores[hostId] = 0; }
  else if (type === "fight") {
    base.hp = {}; base.hp[hostId] = 100;
    base.choices = {};
    base.round = 1;
    base.lastResult = null;
    base.maxHp = 100;
  } else if (type === "uno") {
    base.turn = hostId;
    base.uno = null;
  }
  return base;
}
function publicGame(g, viewerId) {
  const host = db.users.find((u) => u.id === g.hostId);
  const guest = g.guestId ? db.users.find((u) => u.id === g.guestId) : null;
  const out = { id: g.id, type: g.type, roomId: g.roomId, status: g.status, hostId: g.hostId, guestId: g.guestId, hostName: host ? host.handle : "?", guestName: guest ? guest.handle : null, turn: g.turn || null, board: g.board || null, choices: g.choices || null, scores: g.scores || null, round: g.round || null, hp: g.hp || null, lastResult: g.lastResult || null, maxHp: g.maxHp || 100, winnerId: g.winnerId, createdAt: g.createdAt, updatedAt: g.updatedAt };
  if (g.type === "uno") out.uno = unoView(g, viewerId);
  return out;
}
function checkTicTacToe(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) { if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]; }
  if (board.every(Boolean)) return "draw";
  return null;
}
function checkConnect4(board) {
  const rows = 6, cols = 7, dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = board[r][c]; if (!cell) continue;
    for (const [dr, dc] of dirs) {
      let ok = true;
      for (let k = 1; k < 4; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || board[nr][nc] !== cell) { ok = false; break; }
      }
      if (ok) return cell;
    }
  }
  if (board.every((row) => row.every(Boolean))) return "draw";
  return null;
}
function applyMove(game, userId, move) {
  if (game.type === "tictactoe") {
    if (Number(game.turn) !== Number(userId)) throw new HttpError(400, "Not your turn.");
    const i = Number(move);
    if (!(i >= 0 && i < 9) || game.board[i]) throw new HttpError(400, "Invalid move.");
    const mark = Number(userId) === Number(game.hostId) ? "X" : "O";
    game.board[i] = mark;
    const result = checkTicTacToe(game.board);
    if (result === "draw") { game.status = "done"; game.winnerId = "draw"; }
    else if (result === "X") { game.status = "done"; game.winnerId = game.hostId; }
    else if (result === "O") { game.status = "done"; game.winnerId = game.guestId; }
    else game.turn = Number(userId) === Number(game.hostId) ? game.guestId : game.hostId;
    return;
  }
  if (game.type === "connect4") {
    if (Number(game.turn) !== Number(userId)) throw new HttpError(400, "Not your turn.");
    const col = Number(move);
    if (!(col >= 0 && col < 7)) throw new HttpError(400, "Invalid column.");
    let row = -1;
    for (let r = 5; r >= 0; r--) if (!game.board[r][col]) { row = r; break; }
    if (row < 0) throw new HttpError(400, "Column is full.");
    const mark = Number(userId) === Number(game.hostId) ? "H" : "G";
    game.board[row][col] = mark;
    const result = checkConnect4(game.board);
    if (result === "draw") { game.status = "done"; game.winnerId = "draw"; }
    else if (result === "H") { game.status = "done"; game.winnerId = game.hostId; }
    else if (result === "G") { game.status = "done"; game.winnerId = game.guestId; }
    else game.turn = Number(userId) === Number(game.hostId) ? game.guestId : game.hostId;
    return;
  }
  if (game.type === "rps") {
    const choice = String(move || "").toLowerCase();
    if (!["rock", "paper", "scissors"].includes(choice)) throw new HttpError(400, "Pick rock, paper, or scissors.");
    if (!game.choices) game.choices = {};
    if (game.choices[userId]) throw new HttpError(400, "You already chose this round.");
    game.choices[userId] = choice;
    const hostC = game.choices[game.hostId], guestC = game.choices[game.guestId];
    if (hostC && guestC) {
      if (!game.scores) game.scores = {};
      if (game.scores[game.hostId] == null) game.scores[game.hostId] = 0;
      if (game.scores[game.guestId] == null) game.scores[game.guestId] = 0;
      const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
      if (hostC !== guestC) {
        if (beats[hostC] === guestC) game.scores[game.hostId]++;
        else game.scores[game.guestId]++;
      }
      if (game.scores[game.hostId] >= 3 || game.scores[game.guestId] >= 3) {
        game.status = "done";
        game.winnerId = game.scores[game.hostId] >= 3 ? game.hostId : game.guestId;
      } else { game.round = (game.round || 1) + 1; game.choices = {}; }
    }
    return;
  }
  if (game.type === "fight") {
    const choice = String(move || "").toLowerCase();
    if (!["punch", "block"].includes(choice)) throw new HttpError(400, "Pick punch or block.");
    if (game.status !== "active") throw new HttpError(400, "Game is not active.");
    if (!game.guestId) throw new HttpError(400, "Waiting for opponent.");
    if (!game.choices) game.choices = {};
    if (!game.hp) game.hp = {};
    if (game.hp[game.hostId] == null) game.hp[game.hostId] = 100;
    if (game.hp[game.guestId] == null) game.hp[game.guestId] = 100;
    const uid = Number(userId);
    if (game.choices[uid] || game.choices[userId]) throw new HttpError(400, "You already chose this round.");
    game.choices[uid] = choice;
    game.choices[userId] = choice;
    const hostC = game.choices[game.hostId] || game.choices[Number(game.hostId)];
    const guestC = game.choices[game.guestId] || game.choices[Number(game.guestId)];
    if (hostC && guestC) {
      let hostDmg = 0, guestDmg = 0;
      let text = "";
      if (hostC === "punch" && guestC === "punch") {
        hostDmg = 18; guestDmg = 18;
        text = "Both punched! \u221218 HP each";
      } else if (hostC === "punch" && guestC === "block") {
        guestDmg = 6;
        text = "Host punches \u2014 Guest blocks (only \u22126)";
      } else if (hostC === "block" && guestC === "punch") {
        hostDmg = 6;
        text = "Guest punches \u2014 Host blocks (only \u22126)";
      } else {
        text = "Both blocked \u2014 no damage";
      }
      game.hp[game.hostId] = Math.max(0, (game.hp[game.hostId] || 100) - guestDmg);
      game.hp[game.guestId] = Math.max(0, (game.hp[game.guestId] || 100) - hostDmg);
      game.hp[Number(game.hostId)] = game.hp[game.hostId];
      game.hp[Number(game.guestId)] = game.hp[game.guestId];
      game.lastResult = text;
      if (game.hp[game.hostId] <= 0 && game.hp[game.guestId] <= 0) {
        game.status = "done"; game.winnerId = "draw";
      } else if (game.hp[game.hostId] <= 0) {
        game.status = "done"; game.winnerId = game.guestId;
      } else if (game.hp[game.guestId] <= 0) {
        game.status = "done"; game.winnerId = game.hostId;
      } else {
        game.round = (game.round || 1) + 1;
        game.choices = {};
      }
    }
    return;
  }
  if (game.type === "uno") return applyUno(game, userId, move);
  throw new HttpError(400, "Unknown game type.");
}

const UNO_COLORS = ["r", "y", "g", "b"];
function unoKey(id) { return String(id); }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function buildUnoDeck() {
  const cards = [];
  let n = 1;
  const add = (color, value, count) => {
    for (let i = 0; i < count; i++) cards.push({ id: "c" + (n++), color, value: String(value) });
  };
  for (const color of UNO_COLORS) {
    add(color, "0", 1);
    for (let v = 1; v <= 9; v++) add(color, v, 2);
    add(color, "skip", 2);
    add(color, "rev", 2);
    add(color, "d2", 2);
  }
  add("w", "wild", 4);
  add("w", "d4", 4);
  return shuffle(cards);
}
function unoTop(u) { return u.discard[u.discard.length - 1] || null; }
function unoOther(game, uid) {
  return Number(uid) === Number(game.hostId) ? game.guestId : game.hostId;
}
function drawUnoCard(u) {
  if (!u.deck.length) {
    const top = u.discard.pop();
    u.deck = shuffle(u.discard);
    u.discard = top ? [top] : [];
  }
  if (!u.deck.length) return null;
  return u.deck.pop();
}
function cardMatches(card, top, color) {
  if (!card) return false;
  if (card.color === "w") return true;
  if (card.color === color) return true;
  if (top && card.value === top.value && top.color !== "w" && card.value !== "wild" && card.value !== "d4") return true;
  return false;
}
function setupUno(game) {
  const deck = buildUnoDeck();
  const hk = unoKey(game.hostId);
  const gk = unoKey(game.guestId);
  const hands = {};
  hands[hk] = [];
  hands[gk] = [];
  for (let i = 0; i < 7; i++) {
    hands[hk].push(deck.pop());
    hands[gk].push(deck.pop());
  }
  let start = deck.pop();
  while (start && (start.color === "w" || start.value === "d2" || start.value === "skip" || start.value === "rev")) {
    deck.unshift(start);
    shuffle(deck);
    start = deck.pop();
  }
  const color = start.color;
  game.uno = { deck, discard: [start], hands, color, drawn: false, last: "Game on \u2014 match color or number.", dealt: true };
  game.turn = game.hostId;
  game.lastResult = game.uno.last;
}
function onJoin(game) {
  if (game.type === "uno" && game.guestId && !(game.uno && game.uno.dealt)) setupUno(game);
}
function giveCards(game, userId, n) {
  const u = game.uno;
  const hand = u.hands[unoKey(userId)];
  let got = 0;
  for (let i = 0; i < n; i++) {
    const c = drawUnoCard(u);
    if (!c) break;
    hand.push(c);
    got++;
  }
  return got;
}
function endTurn(game) {
  game.turn = unoOther(game, game.turn);
  game.uno.drawn = false;
  game.uno.drawnId = null;
}
function applyUno(game, userId, move) {
  if (game.status !== "active") throw new HttpError(400, "Game is not active.");
  if (!game.guestId || !game.uno || !game.uno.dealt) throw new HttpError(400, "Waiting for opponent.");
  const uid = Number(userId);
  if (uid !== Number(game.hostId) && uid !== Number(game.guestId)) throw new HttpError(403, "You're not in this game.");
  if (Number(game.turn) !== uid) throw new HttpError(400, "Not your turn.");
  const u = game.uno;
  const key = unoKey(uid);
  const hand = u.hands[key];
  if (!hand) throw new HttpError(400, "No hand.");
  const raw = String(move || "");
  const top = unoTop(u);
  if (raw === "draw") {
    if (u.drawn) throw new HttpError(400, "You already drew.");
    const c = drawUnoCard(u);
    if (!c) throw new HttpError(400, "No cards left to draw.");
    hand.push(c);
    u.drawn = true;
    u.drawnId = c.id;
    if (!cardMatches(c, top, u.color)) {
      u.last = "Drew a card and couldn't play.";
      game.lastResult = u.last;
      endTurn(game);
    } else {
      u.last = "Drew a playable card \u2014 play it or pass.";
      game.lastResult = u.last;
    }
    return;
  }
  if (raw === "pass") {
    if (!u.drawn) throw new HttpError(400, "Play a card or draw first.");
    u.last = "Passed.";
    game.lastResult = u.last;
    endTurn(game);
    return;
  }
  const parts = raw.split(":");
  if (parts[0] !== "c" || !parts[1]) throw new HttpError(400, "Play a card, draw, or pass.");
  const cid = parts[1];
  const idx = hand.findIndex((c) => c.id === cid);
  if (idx < 0) throw new HttpError(400, "You don't have that card.");
  const card = hand[idx];
  if (u.drawn && u.drawnId && card.id !== u.drawnId) throw new HttpError(400, "You can only play the card you just drew.");
  if (!cardMatches(card, top, u.color)) throw new HttpError(400, "That card doesn't match.");
  let chosen = parts[2];
  if (card.color === "w") {
    if (!UNO_COLORS.includes(chosen)) throw new HttpError(400, "Pick a color for the wild.");
  } else chosen = card.color;
  hand.splice(idx, 1);
  u.discard.push(card);
  u.color = chosen;
  u.drawn = false;
  u.drawnId = null;
  const opp = unoOther(game, uid);
  if (hand.length === 0) {
    game.status = "done";
    game.winnerId = uid;
    u.last = "UNO! Empty hand.";
    game.lastResult = u.last;
    return;
  }
  if (hand.length === 1) u.last = "UNO! One card left.";
  else u.last = "Played.";
  if (card.value === "d2") {
    const n = giveCards(game, opp, 2);
    u.last = "Draw Two \u2014 opponent draws " + n + " and misses a turn.";
    game.lastResult = u.last;
    return;
  }
  if (card.value === "d4") {
    const n = giveCards(game, opp, 4);
    u.last = "Wild Draw Four (" + chosen + ") \u2014 opponent draws " + n + " and misses a turn.";
    game.lastResult = u.last;
    return;
  }
  if (card.value === "skip" || card.value === "rev") {
    u.last = (card.value === "skip" ? "Skip" : "Reverse") + " \u2014 you go again.";
    game.lastResult = u.last;
    return;
  }
  game.lastResult = u.last;
  endTurn(game);
}
function unoView(g, viewerId) {
  const u = g.uno;
  if (!u || !u.dealt) return { waiting: true };
  const me = viewerId != null ? unoKey(viewerId) : null;
  const top = unoTop(u);
  const hostC = (u.hands[unoKey(g.hostId)] || []).length;
  const guestC = g.guestId ? (u.hands[unoKey(g.guestId)] || []).length : 0;
  const myHand = me && u.hands[me] ? u.hands[me] : [];
  return {
    top, color: u.color, deck: u.deck.length, myHand, hostCount: hostC, guestCount: guestC,
    drawn: !!u.drawn, drawnId: me && u.drawn && Number(g.turn) === Number(viewerId) ? (u.drawnId || null) : null,
    last: u.last || ""
  };
}
module.exports = { setContext, createGame, publicGame, applyMove, onJoin };
