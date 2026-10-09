"use strict";
let db = null;
let HttpError = class extends Error { constructor(s, m) { super(m); this.status = s; } };
function setContext(database, Err) { db = database; if (Err) HttpError = Err; }
function createGame(type, roomId, hostId) {
  const base = { id: db.nextGameId++, type, roomId, hostId, guestId: null, status: "waiting", winnerId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (type === "tictactoe") { base.board = Array(9).fill(null); base.turn = hostId; }
  else if (type === "connect4") { base.board = Array(6).fill(null).map(() => Array(7).fill(null)); base.turn = hostId; }
  else if (type === "rps") { base.choices = {}; base.round = 1; base.scores = {}; base.scores[hostId] = 0; }
  return base;
}
function publicGame(g) {
  const host = db.users.find((u) => u.id === g.hostId);
  const guest = g.guestId ? db.users.find((u) => u.id === g.guestId) : null;
  return { id: g.id, type: g.type, roomId: g.roomId, status: g.status, hostId: g.hostId, guestId: g.guestId, hostName: host ? host.handle : "?", guestName: guest ? guest.handle : null, turn: g.turn || null, board: g.board || null, choices: g.choices || null, scores: g.scores || null, round: g.round || null, winnerId: g.winnerId, createdAt: g.createdAt, updatedAt: g.updatedAt };
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
    if (game.turn !== userId) throw new HttpError(400, "Not your turn.");
    const i = Number(move);
    if (!(i >= 0 && i < 9) || game.board[i]) throw new HttpError(400, "Invalid move.");
    const mark = userId === game.hostId ? "X" : "O";
    game.board[i] = mark;
    const result = checkTicTacToe(game.board);
    if (result === "draw") { game.status = "done"; game.winnerId = "draw"; }
    else if (result === "X") { game.status = "done"; game.winnerId = game.hostId; }
    else if (result === "O") { game.status = "done"; game.winnerId = game.guestId; }
    else game.turn = userId === game.hostId ? game.guestId : game.hostId;
    return;
  }
  if (game.type === "connect4") {
    if (game.turn !== userId) throw new HttpError(400, "Not your turn.");
    const col = Number(move);
    if (!(col >= 0 && col < 7)) throw new HttpError(400, "Invalid column.");
    let row = -1;
    for (let r = 5; r >= 0; r--) if (!game.board[r][col]) { row = r; break; }
    if (row < 0) throw new HttpError(400, "Column is full.");
    const mark = userId === game.hostId ? "H" : "G";
    game.board[row][col] = mark;
    const result = checkConnect4(game.board);
    if (result === "draw") { game.status = "done"; game.winnerId = "draw"; }
    else if (result === "H") { game.status = "done"; game.winnerId = game.hostId; }
    else if (result === "G") { game.status = "done"; game.winnerId = game.guestId; }
    else game.turn = userId === game.hostId ? game.guestId : game.hostId;
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
  throw new HttpError(400, "Unknown game type.");
}
module.exports = { setContext, createGame, publicGame, applyMove };
