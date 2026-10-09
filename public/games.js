(function () {
  var lastSend = 0, COOLDOWN = 3000, gamePoll = null;
  function getProfile() { try { return JSON.parse(localStorage.getItem("huddle:profile") || "null"); } catch (e) { return null; } }
  function getTheme() { try { return localStorage.getItem("huddle:theme") || "light"; } catch (e) { return "light"; } }
  function setTheme(t) {
    try { localStorage.setItem("huddle:theme", t); } catch (e) {}
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    var btn = document.getElementById("huddle-theme-btn");
    if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
  }
  function roomSlug() { return (location.pathname.match(/\/r\/([^/]+)/) || [])[1] || null; }
  function authHeaders() {
    var p = getProfile();
    return p && p.token ? { "content-type": "application/json", authorization: "Bearer " + p.token } : { "content-type": "application/json" };
  }
  function ensureChrome() {
    if (!document.getElementById("huddle-theme-btn")) {
      var t = document.createElement("button");
      t.id = "huddle-theme-btn"; t.className = "huddle-theme-btn"; t.type = "button";
      t.textContent = getTheme() === "dark" ? "☀️" : "🌙";
      t.onclick = function () { setTheme(getTheme() === "dark" ? "light" : "dark"); };
      document.body.appendChild(t);
    }
    if (!document.getElementById("huddle-games-btn")) {
      var g = document.createElement("button");
      g.id = "huddle-games-btn"; g.className = "huddle-games-btn"; g.type = "button";
      g.textContent = "🎮"; g.onclick = openGamesPanel;
      document.body.appendChild(g);
    }
  }
  setTheme(getTheme());
  function openGamesPanel() {
    var existing = document.getElementById("huddle-games-panel");
    if (existing) { existing.remove(); return; }
    var slug = roomSlug();
    var panel = document.createElement("div");
    panel.id = "huddle-games-panel"; panel.className = "huddle-panel";
    panel.innerHTML = '<div class="huddle-panel-card"><button class="close" type="button">×</button><h2>Games</h2><p class="huddle-status">' +
      (slug ? "Invites post to this room." : "Open a room first.") +
      '</p><div class="huddle-game-list">' +
      '<button type="button" class="huddle-game-btn" data-type="tictactoe">❌ Tic-Tac-Toe</button>' +
      '<button type="button" class="huddle-game-btn" data-type="connect4">🔴 Connect Four</button>' +
      '<button type="button" class="huddle-game-btn" data-type="rps">✊ Rock Paper Scissors</button>' +
      '</div><h3 style="margin:16px 0 4px;font-size:14px;opacity:.7">Open games</h3><div id="huddle-open-games">Loading…</div></div>';
    document.body.appendChild(panel);
    panel.querySelector(".close").onclick = function () { panel.remove(); };
    panel.onclick = function (e) { if (e.target === panel) panel.remove(); };
    panel.querySelectorAll("[data-type]").forEach(function (btn) {
      btn.onclick = function () { startGame(btn.getAttribute("data-type")); };
    });
    refreshOpenGames();
  }
  async function refreshOpenGames() {
    var box = document.getElementById("huddle-open-games");
    if (!box) return;
    try {
      var slug = roomSlug();
      var res = await fetch("/api/games" + (slug ? "?room=" + encodeURIComponent(slug) : ""));
      var list = await res.json();
      if (!Array.isArray(list) || !list.length) { box.innerHTML = '<p class="huddle-status">No open games yet.</p>'; return; }
      var p = getProfile();
      box.innerHTML = list.map(function (g) {
        var label = g.type + " · " + g.hostName + (g.guestName ? " vs " + g.guestName : " (waiting)");
        var action = "";
        if (g.status === "waiting" && p && p.token) action = '<button type="button" data-join="' + g.id + '">Join</button>';
        else if (g.status === "active") action = '<button type="button" data-play="' + g.id + '">Play</button>';
        return '<div class="huddle-open-game"><span>' + label + '</span>' + action + '</div>';
      }).join("");
      box.querySelectorAll("[data-join]").forEach(function (b) { b.onclick = function () { joinGame(Number(b.getAttribute("data-join"))); }; });
      box.querySelectorAll("[data-play]").forEach(function (b) { b.onclick = function () { openBoard(Number(b.getAttribute("data-play"))); }; });
    } catch (e) { box.innerHTML = '<p class="huddle-status">Could not load games.</p>'; }
  }
  async function startGame(type) {
    var slug = roomSlug();
    if (!slug) { alert("Open a room first."); return; }
    var p = getProfile();
    if (!p || !p.token) { alert("Set up your profile first."); return; }
    try {
      var res = await fetch("/api/games", { method: "POST", headers: authHeaders(), body: JSON.stringify({ type: type, roomSlug: slug }) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Could not start game");
      var panel = document.getElementById("huddle-games-panel");
      if (panel) panel.remove();
      alert("Invite sent to chat!");
      if (data.game) openBoard(data.game.id);
    } catch (e) { alert(e.message || "Failed"); }
  }
  async function joinGame(id) {
    var p = getProfile();
    if (!p || !p.token) { alert("Set up your profile first."); return; }
    try {
      var res = await fetch("/api/games/" + id + "/join", { method: "POST", headers: authHeaders(), body: "{}" });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Could not join");
      var panel = document.getElementById("huddle-games-panel");
      if (panel) panel.remove();
      openBoard(id);
    } catch (e) { alert(e.message || "Failed"); }
  }
  function stopGamePoll() { if (gamePoll) { clearInterval(gamePoll); gamePoll = null; } }
  async function openBoard(id) {
    stopGamePoll();
    var existing = document.getElementById("huddle-board");
    if (existing) existing.remove();
    var wrap = document.createElement("div");
    wrap.id = "huddle-board"; wrap.className = "huddle-board";
    wrap.innerHTML = '<div class="huddle-board-card"><div class="huddle-status">Loading…</div></div>';
    document.body.appendChild(wrap);
    wrap.onclick = function (e) { if (e.target === wrap) { stopGamePoll(); wrap.remove(); } };
    await renderBoard(id);
    gamePoll = setInterval(function () { renderBoard(id); }, 1000);
  }
  async function renderBoard(id) {
    var wrap = document.getElementById("huddle-board");
    if (!wrap) return;
    try {
      var res = await fetch("/api/games/" + id);
      var g = await res.json();
      if (!res.ok) throw new Error("Gone");
      var card = wrap.querySelector(".huddle-board-card");
      var status = g.status === "waiting" ? "Waiting…" : g.status === "done" ? (g.winnerId === "draw" ? "Draw!" : "Game over") : "Playing";
      var title = ({ tictactoe: "Tic-Tac-Toe", connect4: "Connect Four", rps: "RPS" })[g.type] || g.type;
      var html = '<button class="close" type="button" style="float:right;border:0;background:transparent;font-size:22px;cursor:pointer;color:inherit">×</button>';
      html += '<h2 style="margin:0 0 4px;font-size:18px">' + title + '</h2>';
      html += '<div class="huddle-status">' + g.hostName + (g.guestName ? " vs " + g.guestName : "") + " · " + status + '</div>';
      if (g.type === "tictactoe") {
        html += '<div class="ttt-grid">';
        for (var i = 0; i < 9; i++) html += '<button type="button" class="ttt-cell" data-i="' + i + '">' + (g.board[i] || "") + '</button>';
        html += '</div>';
      } else if (g.type === "connect4") {
        html += '<div class="c4-cols">';
        for (var c = 0; c < 7; c++) html += '<button type="button" data-col="' + c + '">▼</button>';
        html += '</div><div class="c4-grid">';
        for (var r = 0; r < 6; r++) for (var c2 = 0; c2 < 7; c2++) html += '<div class="c4-cell ' + (g.board[r][c2] || "") + '"></div>';
        html += '</div>';
      } else if (g.type === "rps" && g.status === "active") {
        html += '<div class="rps-row"><button type="button" data-rps="rock">✊</button><button type="button" data-rps="paper">✋</button><button type="button" data-rps="scissors">✌️</button></div>';
      }
      if (g.status === "done") html += '<p class="huddle-status">Winner: ' + (g.winnerId === "draw" ? "Draw" : (g.winnerId === g.hostId ? g.hostName : g.guestName)) + '</p>';
      html += '<button type="button" id="huddle-cancel-game" style="margin-top:8px;border:0;background:transparent;color:#ff5a36;cursor:pointer">Leave</button>';
      card.innerHTML = html;
      card.querySelector(".close").onclick = function () { stopGamePoll(); wrap.remove(); };
      var cancel = card.querySelector("#huddle-cancel-game");
      if (cancel) cancel.onclick = async function () {
        try { await fetch("/api/games/" + id + "/cancel", { method: "POST", headers: authHeaders(), body: "{}" }); } catch (e) {}
        stopGamePoll(); wrap.remove();
      };
      card.querySelectorAll("[data-i]").forEach(function (btn) { btn.onclick = function () { sendMove(id, Number(btn.getAttribute("data-i"))); }; });
      card.querySelectorAll("[data-col]").forEach(function (btn) { btn.onclick = function () { sendMove(id, Number(btn.getAttribute("data-col"))); }; });
      card.querySelectorAll("[data-rps]").forEach(function (btn) { btn.onclick = function () { sendMove(id, btn.getAttribute("data-rps")); }; });
    } catch (e) { wrap.querySelector(".huddle-board-card").innerHTML = "<p>Unavailable</p>"; }
  }
  async function sendMove(id, move) {
    var p = getProfile();
    if (!p || !p.token) { alert("Set up profile first."); return; }
    try {
      var res = await fetch("/api/games/" + id + "/move", { method: "POST", headers: authHeaders(), body: JSON.stringify({ move: move }) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Invalid move");
      renderBoard(id);
    } catch (e) { alert(e.message || "Move failed"); }
  }
  function attachUploadButton() {
    document.querySelectorAll(".composer").forEach(function (composer) {
      if (composer.querySelector(".huddle-img-btn")) return;
      var input = composer.querySelector(".input, textarea, input");
      var send = composer.querySelector(".send");
      if (!input || !send) return;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "huddle-img-btn"; btn.textContent = "🖼";
      var file = document.createElement("input"); file.type = "file"; file.accept = "image/*"; file.style.display = "none";
      btn.onclick = function () { file.click(); };
      file.onchange = async function () {
        var f = file.files && file.files[0]; file.value = "";
        if (!f || !/^image\//.test(f.type)) return;
        if (f.size > 2.5 * 1024 * 1024) { alert("Max 2.5MB"); return; }
        var profile = getProfile();
        if (!profile || !profile.token) return;
        btn.disabled = true;
        try {
          var dataUrl = await new Promise(function (resolve, reject) {
            var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(f);
          });
          var up = await fetch("/api/upload", { method: "POST", headers: authHeaders(), body: JSON.stringify({ dataUrl: dataUrl }) });
          var uj = await up.json().catch(function () { return {}; });
          if (!up.ok) throw new Error(uj.error || "Upload failed");
          var slug = roomSlug();
          var body = "[image:" + uj.url + "]";
          await fetch("/api/rooms/" + encodeURIComponent(slug) + "/messages", {
            method: "POST", headers: authHeaders(), body: JSON.stringify({ body: body, imageUrl: uj.url })
          });
        } catch (e) { alert(e.message || "Failed"); }
        finally { btn.disabled = false; }
      };
      composer.insertBefore(btn, send);
      composer.appendChild(file);
    });
  }
  function renderImages() {
    document.querySelectorAll(".bubble").forEach(function (bubble) {
      if (bubble.dataset.imgDone) return;
      var text = bubble.textContent || "";
      var m = text.match(/\[image:(\/uploads\/[a-zA-Z0-9._-]+)\]/);
      if (!m) return;
      bubble.dataset.imgDone = "1";
      bubble.textContent = text.replace(m[0], "").trim();
      var img = document.createElement("img");
      img.className = "huddle-msg-img"; img.src = m[1]; img.alt = "image";
      bubble.appendChild(img);
    });
  }
  setInterval(function () { ensureChrome(); attachUploadButton(); renderImages(); }, 700);
  ensureChrome();
})();
