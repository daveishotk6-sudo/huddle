(function () {
  var lastSend = 0, COOLDOWN = 3000;
  var gamePoll = null, listPoll = null;
  function getProfile() {
    try { return JSON.parse(localStorage.getItem("huddle:profile") || "null"); } catch (e) { return null; }
  }
  function getTheme() {
    try { return localStorage.getItem("huddle:theme") || "light"; } catch (e) { return "light"; }
  }
  function setTheme(t) {
    try { localStorage.setItem("huddle:theme", t); } catch (e) {}
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#12110e" : "#f6f1e7");
    var btn = document.getElementById("huddle-theme-btn");
    if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
  }
  function roomSlug() {
    return (location.pathname.match(/\/r\/([^/]+)/) || [])[1] || null;
  }
  function authHeaders() {
    var p = getProfile();
    return p && p.token
      ? { "content-type": "application/json", authorization: "Bearer " + p.token }
      : { "content-type": "application/json" };
  }
  function myUserId() {
    var p = getProfile();
    if (!p) return null;
    if (p.id != null) return Number(p.id);
    if (p.user && p.user.id != null) return Number(p.user.id);
    return null;
  }
  function ensureChrome() {
    if (!document.getElementById("huddle-theme-btn")) {
      var t = document.createElement("button");
      t.id = "huddle-theme-btn"; t.className = "huddle-theme-btn"; t.type = "button";
      t.title = "Dark mode"; t.textContent = getTheme() === "dark" ? "☀️" : "🌙";
      t.onclick = function () { setTheme(getTheme() === "dark" ? "light" : "dark"); };
      document.body.appendChild(t);
    }
    if (!document.getElementById("huddle-games-btn")) {
      var g = document.createElement("button");
      g.id = "huddle-games-btn"; g.className = "huddle-games-btn"; g.type = "button";
      g.title = "Games"; g.textContent = "🎮";
      g.onclick = openGamesPanel;
      document.body.appendChild(g);
    }
  }
  setTheme(getTheme());
  function openGamesPanel() {
    var existing = document.getElementById("huddle-games-panel");
    if (existing) {
      existing.remove();
      if (listPoll) { clearInterval(listPoll); listPoll = null; }
      return;
    }
    var slug = roomSlug();
    var panel = document.createElement("div");
    panel.id = "huddle-games-panel";
    panel.className = "huddle-panel";
    panel.innerHTML =
      '<div class="huddle-panel-card">' +
      '<button class="close" type="button" aria-label="Close">×</button>' +
      "<h2>Games</h2>" +
      '<p class="huddle-status">' + (slug ? "Start a game — invite posts in this room. Friend taps Join." : "Open a chat room first, then start a game.") + "</p>" +
      '<div class="huddle-game-list">' +
      '<button type="button" class="huddle-game-btn" data-type="tictactoe">❌ Tic-Tac-Toe</button>' +
      '<button type="button" class="huddle-game-btn" data-type="connect4">🔴 Connect Four</button>' +
      '<button type="button" class="huddle-game-btn" data-type="rps">✊ Rock Paper Scissors</button>' +
      '<button type="button" class="huddle-game-btn" data-type="fight">🥊 Fight</button>' +
      "</div>" +
      '<h3 style="margin:16px 0 4px;font-size:14px;opacity:.7">Open games</h3>' +
      '<div id="huddle-open-games">Loading…</div>' +
      "</div>";
    document.body.appendChild(panel);
    panel.querySelector(".close").onclick = function () {
      panel.remove();
      if (listPoll) { clearInterval(listPoll); listPoll = null; }
    };
    panel.onclick = function (e) {
      if (e.target === panel) {
        panel.remove();
        if (listPoll) { clearInterval(listPoll); listPoll = null; }
      }
    };
    panel.querySelectorAll("[data-type]").forEach(function (btn) {
      btn.onclick = function () { startGame(btn.getAttribute("data-type")); };
    });
    refreshOpenGames();
    if (listPoll) clearInterval(listPoll);
    listPoll = setInterval(refreshOpenGames, 2000);
  }
  async function refreshOpenGames() {
    var box = document.getElementById("huddle-open-games");
    if (!box) return;
    var slug = roomSlug();
    try {
      var res = await fetch("/api/games" + (slug ? ("?room=" + encodeURIComponent(slug)) : ""));
      var list = await res.json();
      if (!Array.isArray(list)) list = [];
      if (!list.length && slug) {
        var res2 = await fetch("/api/games");
        var all = await res2.json();
        if (Array.isArray(all)) list = all;
      }
      if (!list.length) {
        box.innerHTML = '<p class="huddle-status">No open games yet. Start one above.</p>';
        return;
      }
      var p = getProfile();
      var uid = myUserId();
      box.innerHTML = list.map(function (g) {
        var label = (g.type || "?") + " · " + (g.hostName || "?") + (g.guestName ? (" vs " + g.guestName) : " (waiting)");
        var action = "";
        var isHost = uid != null && Number(g.hostId) === uid;
        var isGuest = uid != null && g.guestId != null && Number(g.guestId) === uid;
        if (g.status === "waiting") {
          if (isHost) action = '<button type="button" data-play="' + g.id + '">Waiting…</button>';
          else if (p && p.token) action = '<button type="button" data-join="' + g.id + '">Join</button>';
          else action = "<span>Login to join</span>";
        } else if (g.status === "active") {
          if (isHost || isGuest) action = '<button type="button" data-play="' + g.id + '">Play</button>';
          else action = '<button type="button" data-play="' + g.id + '">Watch</button>';
        } else if (g.status === "done") {
          action = "<span>Done</span>";
        }
        return '<div class="huddle-open-game"><span>' + label + "</span>" + action + "</div>";
      }).join("");
      box.querySelectorAll("[data-join]").forEach(function (b) {
        b.onclick = function () { joinGame(Number(b.getAttribute("data-join"))); };
      });
      box.querySelectorAll("[data-play]").forEach(function (b) {
        b.onclick = function () { openBoard(Number(b.getAttribute("data-play"))); };
      });
    } catch (e) {
      box.innerHTML = '<p class="huddle-status">Could not load games.</p>';
    }
  }
  async function startGame(type) {
    var slug = roomSlug();
    if (!slug) { alert("Open a room first."); return; }
    var p = getProfile();
    if (!p || !p.token) { alert("Set up your profile first."); return; }
    try {
      var res = await fetch("/api/games", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ type: type, roomSlug: slug })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Could not start game");
      var panel = document.getElementById("huddle-games-panel");
      if (panel) panel.remove();
      if (listPoll) { clearInterval(listPoll); listPoll = null; }
      alert("Invite sent to chat! Friend opens Games and taps Join.");
      if (data.game) openBoard(data.game.id);
    } catch (e) {
      alert(e.message || "Failed");
    }
  }
  async function joinGame(id) {
    var p = getProfile();
    if (!p || !p.token) { alert("Set up your profile first."); return; }
    try {
      var res = await fetch("/api/games/" + id + "/join", {
        method: "POST",
        headers: authHeaders(),
        body: "{}"
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Could not join");
      var panel = document.getElementById("huddle-games-panel");
      if (panel) panel.remove();
      if (listPoll) { clearInterval(listPoll); listPoll = null; }
      openBoard(id);
    } catch (e) {
      alert(e.message || "Failed to join");
    }
  }
  function stopGamePoll() {
    if (gamePoll) { clearInterval(gamePoll); gamePoll = null; }
  }
  async function openBoard(id) {
    stopGamePoll();
    var existing = document.getElementById("huddle-board");
    if (existing) existing.remove();
    var wrap = document.createElement("div");
    wrap.id = "huddle-board";
    wrap.className = "huddle-board";
    wrap.innerHTML = '<div class="huddle-board-card"><div class="huddle-status">Loading game…</div></div>';
    document.body.appendChild(wrap);
    wrap.onclick = function (e) {
      if (e.target === wrap) { stopGamePoll(); wrap.remove(); }
    };
    await renderBoard(id);
    gamePoll = setInterval(function () { renderBoard(id); }, 800);
  }
  async function renderBoard(id) {
    var wrap = document.getElementById("huddle-board");
    if (!wrap) return;
    try {
      var res = await fetch("/api/games/" + id);
      var g = await res.json();
      if (!res.ok) throw new Error(g.error || "Gone");
      var card = wrap.querySelector(".huddle-board-card");
      var status = g.status === "waiting" ? "Waiting for opponent… (they open Games → Join)" :
        g.status === "done" ? (g.winnerId === "draw" ? "Draw!" : "Game over") : "In progress";
      var title = ({ tictactoe: "Tic-Tac-Toe", connect4: "Connect Four", rps: "Rock Paper Scissors", fight: "Fight" })[g.type] || g.type;
      var html = '<button class="close" type="button" style="float:right;border:0;background:transparent;font-size:22px;cursor:pointer;color:inherit">×</button>';
      html += '<h2 style="margin:0 0 4px;font-size:18px">' + title + "</h2>";
      html += '<div class="huddle-status">' + (g.hostName || "") + (g.guestName ? (" vs " + g.guestName) : "") + " · " + status + "</div>";
      if (g.type === "tictactoe" && g.board) {
        html += '<div class="ttt-grid">';
        for (var i = 0; i < 9; i++) {
          html += '<button type="button" class="ttt-cell" data-i="' + i + '">' + (g.board[i] || "") + "</button>";
        }
        html += "</div>";
      } else if (g.type === "connect4" && g.board) {
        html += '<div class="c4-cols">';
        for (var c = 0; c < 7; c++) html += '<button type="button" data-col="' + c + '">▼</button>';
        html += '</div><div class="c4-grid">';
        for (var r = 0; r < 6; r++) {
          for (var c2 = 0; c2 < 7; c2++) {
            var cell = g.board[r][c2];
            html += '<div class="c4-cell ' + (cell || "") + '"></div>';
          }
        }
        html += "</div>";
      } else if (g.type === "rps") {
        var scores = g.scores || {};
        html += '<div class="huddle-status">Round ' + (g.round || 1) + " · First to 3</div>";
        html += '<div class="huddle-status">Score: ' + (g.hostName || "Host") + " " + (scores[g.hostId] || 0) + " — " + (scores[g.guestId] || 0) + " " + (g.guestName || "?") + "</div>";
        if (g.status === "active") {
          html += '<div class="rps-row">';
          html += '<button type="button" data-rps="rock">✊</button>';
          html += '<button type="button" data-rps="paper">✋</button>';
          html += '<button type="button" data-rps="scissors">✌️</button>';
          html += "</div>";
        }
      } else if (g.type === "fight") {
        var hp = g.hp || {};
        var maxHp = g.maxHp || 100;
        var hHp = hp[g.hostId] != null ? hp[g.hostId] : maxHp;
        var gHp = g.guestId != null && hp[g.guestId] != null ? hp[g.guestId] : maxHp;
        html += '<div class="huddle-status">Round ' + (g.round || 1) + ' · First to KO</div>';
        if (g.lastResult) html += '<div class="huddle-status">' + g.lastResult + '</div>';
        html += '<div class="fight-bars">';
        html += '<div class="fight-fighter"><div class="fight-name">' + (g.hostName || "Host") + '</div>';
        html += '<div class="fight-bar"><div class="fight-fill" style="width:' + Math.max(0, Math.min(100, hHp)) + '%"></div></div>';
        html += '<div class="fight-hp">' + hHp + ' / ' + maxHp + '</div></div>';
        html += '<div class="fight-fighter"><div class="fight-name">' + (g.guestName || "Waiting…") + '</div>';
        html += '<div class="fight-bar"><div class="fight-fill guest" style="width:' + Math.max(0, Math.min(100, gHp)) + '%"></div></div>';
        html += '<div class="fight-hp">' + (g.guestName ? (gHp + ' / ' + maxHp) : '—') + '</div></div>';
        html += '</div>';
        if (g.status === "active") {
          html += '<div class="rps-row">';
          html += '<button type="button" data-fight="punch" class="fight-btn punch">👊 Punch</button>';
          html += '<button type="button" data-fight="block" class="fight-btn block">🛡️ Block</button>';
          html += '</div>';
          html += '<p class="huddle-status">Both choose each round. Punch vs Block = weak hit. Both punch = big damage.</p>';
        }
      }
      if (g.status === "done") {
        html += '<p class="huddle-status">Winner: ' + (g.winnerId === "draw" ? "Draw" : (Number(g.winnerId) === Number(g.hostId) ? g.hostName : g.guestName)) + "</p>";
      }
      html += '<button type="button" id="huddle-cancel-game" style="margin-top:8px;border:0;background:transparent;color:#ff5a36;cursor:pointer">Leave / cancel</button>';
      card.innerHTML = html;
      card.querySelector(".close").onclick = function () { stopGamePoll(); wrap.remove(); };
      var cancel = card.querySelector("#huddle-cancel-game");
      if (cancel) cancel.onclick = async function () {
        try { await fetch("/api/games/" + id + "/cancel", { method: "POST", headers: authHeaders(), body: "{}" }); } catch (e) {}
        stopGamePoll(); wrap.remove();
      };
      card.querySelectorAll("[data-i]").forEach(function (btn) {
        btn.onclick = function () { sendMove(id, Number(btn.getAttribute("data-i"))); };
      });
      card.querySelectorAll("[data-col]").forEach(function (btn) {
        btn.onclick = function () { sendMove(id, Number(btn.getAttribute("data-col"))); };
      });
      card.querySelectorAll("[data-rps]").forEach(function (btn) {
        btn.onclick = function () { sendMove(id, btn.getAttribute("data-rps")); };
      });
      card.querySelectorAll("[data-fight]").forEach(function (btn) {
        btn.onclick = function () { sendMove(id, btn.getAttribute("data-fight")); };
      });
    } catch (e) {
      wrap.querySelector(".huddle-board-card").innerHTML = "<p>Game unavailable.</p>";
    }
  }
  async function sendMove(id, move) {
    var p = getProfile();
    if (!p || !p.token) { alert("Set up your profile first."); return; }
    try {
      var res = await fetch("/api/games/" + id + "/move", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ move: move })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Invalid move");
      renderBoard(id);
    } catch (e) {
      alert(e.message || "Move failed");
    }
  }
  function attachInviteButtons() {
    document.querySelectorAll(".bubble").forEach(function (bubble) {
      if (bubble.dataset.gameInviteDone) return;
      var text = bubble.textContent || "";
      var idMatch = text.match(/game\s*#\s*(\d+)/i);
      if (!idMatch) return;
      bubble.dataset.gameInviteDone = "1";
      var gid = Number(idMatch[1]);
      if (!gid) return;
      var row = document.createElement("div");
      row.style.marginTop = "6px";
      row.innerHTML = '<button type="button" style="border:0;background:#ff5a36;color:#fff;border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer">Join game</button>';
      row.querySelector("button").onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        joinGame(gid);
      };
      bubble.appendChild(row);
    });
  }
  function attachUploadButton() {
    document.querySelectorAll(".composer").forEach(function (composer) {
      if (composer.querySelector(".huddle-img-btn")) return;
      var input = composer.querySelector(".input, textarea, input");
      var send = composer.querySelector(".send");
      if (!input || !send) return;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "huddle-img-btn"; btn.title = "Send image"; btn.textContent = "🖼";
      var file = document.createElement("input");
      file.type = "file"; file.accept = "image/*"; file.style.display = "none";
      btn.onclick = function () { file.click(); };
      file.onchange = async function () {
        var f = file.files && file.files[0]; file.value = "";
        if (!f || !/^image\//.test(f.type)) return;
        if (f.size > 2.5 * 1024 * 1024) { alert("Max 2.5MB"); return; }
        if (Date.now() - lastSend < COOLDOWN) { alert("Wait a few seconds."); return; }
        var profile = getProfile();
        if (!profile || !profile.token) { alert("Set up profile first."); return; }
        btn.disabled = true;
        try {
          var dataUrl = await new Promise(function (resolve, reject) {
            var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(f);
          });
          var up = await fetch("/api/upload", {
            method: "POST", headers: authHeaders(), body: JSON.stringify({ dataUrl: dataUrl })
          });
          var uj = await up.json().catch(function () { return {}; });
          if (!up.ok) throw new Error(uj.error || "Upload failed");
          var slug = roomSlug();
          if (!slug) throw new Error("Open a room first.");
          var caption = (input.value || "").trim();
          var body = caption ? (caption + "\n[image:" + uj.url + "]") : ("[image:" + uj.url + "]");
          var res = await fetch("/api/rooms/" + encodeURIComponent(slug) + "/messages", {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ body: body, imageUrl: uj.url })
          });
          var jj = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(jj.error || "Send failed");
          lastSend = Date.now();
          if (input.value !== undefined) input.value = "";
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
      img.className = "huddle-msg-img"; img.src = m[1]; img.alt = "image"; img.loading = "lazy";
      bubble.appendChild(img);
    });
  }
  var orig = window.fetch;
  window.fetch = function () {
    var args = arguments;
    return orig.apply(this, args).then(function (res) {
      try {
        var u = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        var opts = args[1] || {};
        if (res.ok && opts.method === "POST" && /\/messages$/.test(String(u).split("?")[0])) lastSend = Date.now();
        if (res.ok && /\/api\/users$/.test(String(u).split("?")[0]) && opts.method === "POST") {
          res.clone().json().then(function (data) {
            try {
              var p = getProfile() || {};
              if (data.token) p.token = data.token;
              if (data.user) {
                p.id = data.user.id;
                p.name = data.user.handle || data.user.name || p.name;
                p.handle = data.user.handle;
                p.color = data.user.color;
              }
              localStorage.setItem("huddle:profile", JSON.stringify(p));
            } catch (e) {}
          }).catch(function () {});
        }
      } catch (e) {}
      return res;
    });
  };
  setInterval(function () {
    ensureChrome();
    attachUploadButton();
    renderImages();
    attachInviteButtons();
  }, 700);
  ensureChrome();
})();
