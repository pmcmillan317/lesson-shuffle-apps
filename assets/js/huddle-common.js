/* Huddle Up: shared helpers for the teacher page (/huddle-up/host/) and the student page (/join/).
   No dependencies. Nothing here is saved anywhere except the browser tab's own sessionStorage.

   The relay (rooms.lessonshuffle.com, see /rooms/README.md) only passes messages between the teacher's tab and
   the students' devices. It keeps no game, no names and no answers. The game itself runs in the teacher's tab. */
(function () {
  "use strict";

  var HU = (window.HU = {});

  /* ---- Where the relay lives ------------------------------------------------------------------ */
  // On a computer running the site locally, use the local relay (`npx wrangler dev` in /rooms on port 8790).
  var host = location.hostname;
  HU.relayBase = (host === "localhost" || host === "127.0.0.1")
    ? "ws://" + host + ":8790"
    : "wss://rooms.lessonshuffle.com";

  // Room codes: six characters, no I, O, 0 or 1, so nobody mixes them up on the board.
  HU.CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  HU.CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

  HU.randomInt = function (n) {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  };
  HU.randomId = function (len) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    for (var i = 0; i < len; i++) out += chars[HU.randomInt(chars.length)];
    return out;
  };
  HU.newCode = function () {
    var out = "";
    for (var i = 0; i < 6; i++) out += HU.CODE_CHARS[HU.randomInt(HU.CODE_CHARS.length)];
    return out;
  };
  HU.cleanCode = function (s) {
    return String(s || "").toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
  };
  HU.shuffle = function (list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = HU.randomInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  /* ---- Random student names (used when names are turned off, or a name box is left empty) ---- */
  var ADJ = ["Swift", "Quiet", "Bright", "Clever", "Lucky", "Brave", "Calm", "Jolly", "Sunny", "Bold", "Witty", "Zippy",
    "Cosmic", "Mighty", "Gentle", "Rapid", "Sparky", "Breezy", "Daring", "Fuzzy", "Nimble", "Plucky", "Snappy", "Steady"];
  var NOUN = ["Comet", "Maple", "Pebble", "Rocket", "Cactus", "Pickle", "Waffle", "Meteor", "Acorn", "Canyon", "Glacier",
    "Lantern", "Marble", "Noodle", "Pretzel", "Quasar", "Sprout", "Thunder", "Tulip", "Volcano", "Walnut", "Yeti", "Zephyr", "Biscuit"];
  HU.randomName = function () {
    return ADJ[HU.randomInt(ADJ.length)] + " " + NOUN[HU.randomInt(NOUN.length)];
  };
  // Keep names short and plain. The teacher can swap any name for a random one.
  HU.cleanName = function (s) {
    return String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 18);
  };

  /* ---- Teams: a colour and an animal, so students can find each other fast ------------------- */
  HU.TEAMS = [
    "Blue Whales", "Green Frogs", "Gold Bees", "Red Foxes", "Purple Owls",
    "Orange Tigers", "Teal Turtles", "Pink Flamingos", "Silver Wolves", "Lime Geckos"
  ];

  /* ---- The ways to play ------------------------------------------------------------------------ */
  // These are Patrick's classroom variants. `seat` is what students see on the team screen.
  HU.MODES = {
    classic: {
      title: "Team Race",
      short: "Sit with your team. First team to the finish wins.",
      seat: "Find your team and sit together.",
      rule: "Talk it out. Only one of you has the right answer each time."
    },
    eleven: {
      title: "Eleven",
      short: "No team gets left behind. Every team keeps going until it reaches eleven.",
      seat: "Find your team and sit together.",
      rule: "Every team plays until it reaches eleven. Beat your time next round."
    },
    cacophony: {
      title: "Cacophony",
      short: "Stay in your seats. Teammates are spread around the room, so you call out across it. It gets loud.",
      seat: "Stay in your seat. Your team is spread around the room.",
      rule: "Call out across the room to find your teammates. The louder it gets, the harder it is to hear!"
    },
    silent: {
      title: "Silent",
      short: "Not a word. Teams talk with hand signals, so give them a couple of minutes to plan their signals.",
      seat: "Find your team and sit together.",
      rule: "No talking at all. Use your hand signals."
    },
    relay: {
      title: "Relay",
      short: "Team devices sit side by side. One runner at a time checks every screen, makes the match, then tags the next runner.",
      seat: "Set your team's devices side by side, then line up behind them.",
      rule: "One runner at a time. Make the match, then tag the next runner."
    },
    tagteam: {
      title: "Tag Team",
      short: "Silent. Sitters keep heads down in front of two devices. Standers tap a shoulder, left or right, to say which device has the answer.",
      seat: "Half of your team sits with two devices. The other half stands behind them.",
      rule: "No talking. Standers tap a shoulder, left or right. The sitter looks up and answers on that device."
    },
    playoffs: {
      title: "Playoffs",
      short: "String games together. Each game's winner moves on and sits out, until two teams meet in the final. Waiting teams play a consolation game.",
      seat: "Find your team and sit together.",
      rule: "Win the game to move on to the next round."
    }
  };

  /* ---- A tiny element builder (always textContent, never innerHTML, for anything typed) ---- */
  HU.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
        if (k === "text") el.textContent = attrs[k];
        else if (k === "class") el.className = attrs[k];
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
        else el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  };
  HU.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  HU.$ = function (sel, root) { return (root || document).querySelector(sel); };

  HU.clock = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  };

  /* ---- A WebSocket that reconnects, with a quiet heartbeat ------------------------------------ */
  // Close codes from the relay that mean "do not try again": 4003 taken, 4004 no room, 4005 full,
  // 4008 too many messages. 1000 is a normal close (the room ended).
  var FINAL = { 1000: 1, 4003: 1, 4004: 1, 4005: 1, 4008: 1 };

  HU.connect = function (url, on) {
    var ws = null;
    var tries = 0;
    var stopped = false;
    var beat = null;
    var link = {
      send: function (obj) {
        if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
        return false;
      },
      stop: function () {
        stopped = true;
        clearInterval(beat);
        if (ws) try { ws.close(1000); } catch (e) { /* already closed */ }
      },
      get open() { return !!ws && ws.readyState === 1; }
    };
    function open() {
      if (stopped) return;
      ws = new WebSocket(url);
      ws.onopen = function () {
        tries = 0;
        clearInterval(beat);
        beat = setInterval(function () { if (ws.readyState === 1) ws.send("ping"); }, 25000);
        if (on.open) on.open();
      };
      ws.onmessage = function (ev) {
        if (ev.data === "pong") return;
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && typeof msg === "object" && on.message) on.message(msg);
      };
      ws.onclose = function (ev) {
        clearInterval(beat);
        if (stopped) return;
        if (FINAL[ev.code]) { stopped = true; if (on.final) on.final(ev.code); return; }
        if (on.down) on.down();
        tries++;
        setTimeout(open, Math.min(8000, 600 * Math.pow(2, tries - 1)));
      };
    }
    open();
    return link;
  };

  HU.store = {
    get: function (area, key) {
      try { var v = window[area].getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (area, key, value) {
      try { window[area].setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: the game still works */ }
    },
    remove: function (area, key) {
      try { window[area].removeItem(key); } catch (e) { /* ignore */ }
    }
  };
})();
