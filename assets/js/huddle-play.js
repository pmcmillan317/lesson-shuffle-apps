/* Huddle Up: the student page (/join/). No account, no sign-in.
   The student types a room code and a nickname. The nickname goes only to the teacher's tab, through the relay,
   and is never saved. This tab keeps a random device id in sessionStorage so a refresh rejoins the same seat.
   Needs huddle-common.js first. */
(function () {
  "use strict";

  var HU = window.HU;
  var h = HU.h, $ = HU.$;
  var link = null;
  var me = null;          // { code, pid, name }
  var last = null;        // the last view from the teacher
  var flashTimer = null;
  var freezeTimer = null;
  var hostUp = true;
  // On the demo page several student screens share one browser tab, so each seat keeps its own key.
  var seat = /^[1-9]$/.test(new URLSearchParams(location.search).get("seat") || "") ? new URLSearchParams(location.search).get("seat") : "";
  var ME_KEY = seat ? "huddle.me." + seat : "huddle.me";

  function screen(id) {
    ["#pl-join", "#pl-app"].forEach(function (sel) { $(sel).hidden = sel !== id; });
  }

  function status(text) {
    var el = $("#pl-status");
    el.textContent = text || "";
    el.hidden = !text;
  }

  /* ---- Joining -------------------------------------------------------------------------------- */
  function join(code, name) {
    var saved = HU.store.get("sessionStorage", ME_KEY);
    var pid = saved && saved.code === code ? saved.pid : HU.randomId(20);
    me = { code: code, pid: pid, name: name };
    HU.store.set("sessionStorage", ME_KEY, me);
    screen("#pl-app");
    paint({ phase: "connecting" });
    var url = HU.relayBase + "/room/" + code + "?role=player&pid=" + encodeURIComponent(pid);
    link = HU.connect(url, {
      open: function () { status(""); },
      down: function () { status("Reconnecting..."); },
      final: function (closeCode) {
        if (closeCode === 4004) paint({ phase: "noroom" });
        else if (closeCode === 4005) paint({ phase: "full" });
        else if (closeCode === 1000) paint({ phase: "closed" });
        else paint({ phase: "lost" });
        HU.store.remove("sessionStorage", ME_KEY);
      },
      message: onMessage
    });
  }

  function onMessage(msg) {
    if (msg.t === "hello") {
      hostUp = !!msg.host;
      link.send({ t: "hi", name: me.name });
      if (!hostUp) status("Waiting for your teacher's screen...");
      return;
    }
    if (msg.t === "host") {
      hostUp = !!msg.up;
      status(hostUp ? "" : "Waiting for your teacher's screen...");
      if (hostUp) link.send({ t: "hi", name: me.name });
      return;
    }
    if (msg.t === "closed") { paint({ phase: "closed" }); link.stop(); HU.store.remove("sessionStorage", ME_KEY); return; }
    if (msg.t === "error") return;
    if (msg.t === "view") { paint(msg); return; }
    if (msg.t === "flash") { flash(msg); return; }
  }

  /* ---- Drawing -------------------------------------------------------------------------------- */
  function teamClass(v) { return v.team ? "team-" + HU.TEAMS.indexOf(v.team.name) : ""; }

  function paint(v) {
    last = v;
    var app = $("#pl-app");
    var body = HU.clear($("#pl-body"));
    app.className = "pl-app " + teamClass(v);
    var top = $("#pl-top");
    top.hidden = !v.team && !v.name;
    $("#pl-team").textContent = v.team ? v.team.name : "";
    $("#pl-name").textContent = v.name || "";
    var bar = $("#pl-progress");
    bar.hidden = !(v.phase === "play" && v.target);
    if (v.target) {
      $("#pl-fill").style.setProperty("--p", String(Math.min(1, (v.score || 0) / v.target)));
      $("#pl-score").textContent = (v.score || 0) + " of " + v.target;
      bar.setAttribute("aria-valuenow", String(v.score || 0));
      bar.setAttribute("aria-valuemax", String(v.target));
    }
    clearTimeout(freezeTimer);

    var p = v.phase;
    if (p === "connecting") body.appendChild(msgBlock("Joining...", "Hang on a second."));
    else if (p === "noroom") body.appendChild(msgBlock("We could not find that room.", "Check the code on the board and try again.", true));
    else if (p === "full") body.appendChild(msgBlock("This room is full.", "Ask your teacher what to do next.", true));
    else if (p === "closed") body.appendChild(msgBlock("The game is over.", "Thanks for playing!", true));
    else if (p === "lost") body.appendChild(msgBlock("Lost the connection.", "Check your internet, then join again.", true));
    else if (p === "removed") body.appendChild(msgBlock("Your teacher removed you from this game.", "Ask your teacher if this was a mistake.", true));
    else if (p === "gone") body.appendChild(msgBlock("Joining...", ""));
    else if (p === "lobby") paintLobby(body, v);
    else if (p === "teams") paintTeam(body, v);
    else if (p === "countdown") body.appendChild(h("p", { class: "pl-count", "aria-live": "assertive", text: String(v.n) }));
    else if (p === "paused") body.appendChild(msgBlock("Paused", "Eyes up front."));
    else if (p === "play") paintPlay(body, v);
    else if (p === "finished") body.appendChild(msgBlock("Your team made it!", (v.time ? "Finished in " + HU.clock(v.time) + ". " : "") + "Cheer on the other teams."));
    else if (p === "results") body.appendChild(msgBlock(v.result ? v.result.big : "Round over", v.result ? v.result.small : ""));
  }

  function msgBlock(big, small, again) {
    return h("div", { class: "pl-msg" },
      h("h2", { text: big }),
      small ? h("p", { text: small }) : null,
      again ? h("p", null, h("a", { class: "btn btn-main", href: "/join/" }, "Join a game")) : null);
  }

  function paintLobby(body, v) {
    body.appendChild(msgBlock(v.waiting ? "You're in! Your teacher will add you to a team." : "You're in!", "Watch the board. Your teacher will start soon."));
    if (!v.collect) return;
    var left = (v.subLimit || 10) - (v.subs || 0);
    var form = h("form", { class: "pl-submit", novalidate: true },
      h("h3", { text: "Add to the set" }),
      h("p", { class: "pl-dim", text: left > 0 ? "Your teacher is collecting terms. Add a term and what it means." : "Thanks! You have added the most terms you can." }),
      h("label", { for: "pl-term", text: "Term" }),
      h("input", { id: "pl-term", maxlength: "140", autocomplete: "off", required: true }),
      h("label", { for: "pl-def", text: "What it means" }),
      h("input", { id: "pl-def", maxlength: "240", autocomplete: "off", required: true }),
      h("button", { class: "btn btn-main", type: "submit" }, "Send it"),
      h("p", { class: "pl-dim", "aria-live": "polite", text: v.subs ? "You sent " + v.subs + (v.subs === 1 ? " term." : " terms.") : "" })
    );
    if (left <= 0) form.querySelectorAll("input, button").forEach(function (el) { el.disabled = true; });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var term = $("#pl-term").value.trim(), def = $("#pl-def").value.trim();
      if (!term || !def) { (term ? $("#pl-def") : $("#pl-term")).focus(); return; }
      link.send({ t: "submit", term: term, def: def });
    });
    body.appendChild(form);
  }

  function paintTeam(body, v) {
    body.appendChild(h("div", { class: "pl-msg" },
      h("p", { class: "pl-eyebrow", text: v.heat || v.mode.title }),
      h("h2", { text: "You're on team " + v.team.name + "!" }),
      h("p", { text: v.mode.seat }),
      v.mates && v.mates.length ? h("p", { class: "pl-mates" }, "Your team: ", h("b", { text: v.mates.join(", ") })) : h("p", { text: "You're playing on your own this round." }),
      h("p", { class: "pl-rule", text: v.mode.rule }),
      v.planEndsIn ? h("p", { class: "pl-dim", text: "Planning time! Agree on your signals." }) : null
    ));
  }

  function paintPlay(body, v) {
    var pic = null;
    if (v.pic && /^data:image\/jpeg;base64,/.test(v.pic)) {
      // Tap the picture to see it bigger, tap again to shrink it.
      pic = h("button", { type: "button", class: "pl-pic", "aria-pressed": "false", "aria-label": "Make the picture bigger" },
        h("img", { src: v.pic, alt: "A picture that goes with this meaning" }));
      pic.addEventListener("click", function () {
        var big = pic.classList.toggle("pl-pic-big");
        pic.setAttribute("aria-pressed", big ? "true" : "false");
        pic.setAttribute("aria-label", big ? "Make the picture smaller" : "Make the picture bigger");
      });
    }
    body.appendChild(h("div", { class: "pl-prompt" },
      h("p", { class: "pl-eyebrow" }, v.ask === "def" ? "Who has the term for..." : "Who has the meaning of...",
        v.again ? h("span", { class: "pl-again", text: "Second chance" }) : null),
      h("p", { class: "pl-prompt-text", "aria-live": "polite", text: v.prompt || "" }),
      pic
    ));
    if (!v.tiles || !v.tiles.length) {
      body.appendChild(h("p", { class: "pl-dim pl-none", text: "No answers on your screen this time. Help your team find it!" }));
      return;
    }
    var grid = h("ul", { class: "pl-tiles", role: "list" });
    v.tiles.forEach(function (tile, i) {
      var b = h("button", { type: "button", class: "pl-tile" + (tile.text.length > 60 ? " pl-long" : ""), "aria-keyshortcuts": i < 9 ? String(i + 1) : null }, tile.text);
      b.addEventListener("click", function () {
        if (b.disabled) return;
        grid.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
        b.classList.add("pl-picked");
        link.send({ t: "pick", id: tile.id, seq: v.seq });
      });
      grid.appendChild(h("li", null, b));
    });
    body.appendChild(grid);
    if (v.frozenFor > 0) {
      grid.classList.add("pl-frozen");
      grid.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
      var note = h("p", { class: "pl-freeze", role: "status", text: "Take a breath. Back in a moment." });
      body.appendChild(note);
      freezeTimer = setTimeout(function () { if (last === v) { v.frozenFor = 0; paint(v); } }, v.frozenFor);
    }
  }

  function flash(f) {
    var el = $("#pl-flash");
    HU.clear(el);
    el.className = "pl-flash pl-flash-" + f.kind;
    if (f.kind === "right") {
      el.appendChild(h("p", { class: "pl-flash-big", text: f.relay ? "Next runner!" : "Match!" }));
      if (f.by) el.appendChild(h("p", { text: f.by + " found it." }));
    } else {
      el.appendChild(h("p", { class: "pl-flash-big", text: "Not quite" }));
      el.appendChild(h("p", null, h("b", { text: f.a }), " matches ", h("b", { text: f.b })));
      if (f.penalty === "zero") el.appendChild(h("p", { class: "pl-dim", text: "Back to zero. You've got this." }));
      else if (f.penalty === "point") el.appendChild(h("p", { class: "pl-dim", text: "Your team lost a point." }));
    }
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.hidden = true; }, f.kind === "right" ? 900 : 2600);
  }

  /* ---- Start ---------------------------------------------------------------------------------- */
  function boot() {
    if (!window.WebSocket || !window.crypto || !crypto.getRandomValues) {
      $("#pl-nojs").textContent = "This browser is too old to play. Try a current Chrome, Edge, Firefox or Safari.";
      return;
    }
    $("#pl-nojs").hidden = true;
    screen("#pl-join");
    $("#pl-flash").addEventListener("click", function () { $("#pl-flash").hidden = true; });
    // On a laptop, the number keys 1 to 9 tap the answers in order.
    document.addEventListener("keydown", function (ev) {
      if (!last || last.phase !== "play" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!/^[1-9]$/.test(ev.key)) return;
      var tile = document.querySelectorAll("#pl-body .pl-tile")[Number(ev.key) - 1];
      if (tile && !tile.disabled) { ev.preventDefault(); tile.click(); }
    });

    var codeBox = $("#pl-code"), nameBox = $("#pl-nick");
    var fromUrl = HU.cleanCode(new URLSearchParams(location.search).get("code"));
    if (fromUrl) codeBox.value = fromUrl;
    var saved = HU.store.get("sessionStorage", ME_KEY);
    codeBox.addEventListener("input", function () {
      var clean = HU.cleanCode(codeBox.value);
      if (clean !== codeBox.value) codeBox.value = clean;
    });
    $("#pl-dice").addEventListener("click", function () { nameBox.value = HU.randomName(); nameBox.focus(); });
    $("#pl-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var code = HU.cleanCode(codeBox.value);
      var err = $("#pl-err");
      if (!HU.CODE_RE.test(code)) { err.textContent = "The room code has 6 letters and numbers. Check the board."; codeBox.focus(); return; }
      err.textContent = "";
      join(code, HU.cleanName(nameBox.value));
    });
    // A refresh during a game rejoins the same seat.
    if (saved && saved.code && HU.CODE_RE.test(saved.code) && (!fromUrl || fromUrl === saved.code)) {
      join(saved.code, saved.name || "");
      return;
    }
    (fromUrl ? nameBox : codeBox).focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
