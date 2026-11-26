/* Huddle Up: the teacher's page (/huddle-up/host/). The whole game runs here, in this browser tab.
   - Term lists the teacher saves stay in this browser (localStorage). They are the teacher's own content.
   - The live game (nicknames, teams, scores) lives in this tab only (sessionStorage, so a refresh can pick up
     where it left off). Closing the tab or pressing "End and close the room" clears it.
   - Students' devices talk to this tab through the relay, which passes messages along and keeps nothing.
   Needs huddle-common.js and vendor/qrcode.js first. */
(function () {
  "use strict";

  var HU = window.HU;
  var h = HU.h, $ = HU.$;

  var SETS_KEY = "huddle.sets";      // localStorage: the teacher's saved term lists
  var GAME_KEY = "huddle.game";      // sessionStorage: the live game in this tab
  var MAX_PAIRS = 200;
  var MAX_PLAYERS = 80;
  var TILE_COUNT = 12;
  var FREEZE_MS = 3000;
  var SUBMIT_LIMIT = 10;

  var SAMPLE = [
    "Mercury\tThe planet closest to the Sun",
    "Venus\tThe hottest planet, wrapped in thick clouds",
    "Earth\tThe only planet known to have life",
    "Mars\tThe red planet, home of Olympus Mons",
    "Jupiter\tThe largest planet in our solar system",
    "Saturn\tThe planet best known for its bright rings",
    "Uranus\tThe planet that spins on its side",
    "Neptune\tThe windiest planet, farthest from the Sun",
    "Moon\tA natural satellite that orbits a planet",
    "Orbit\tThe curved path of one object around another",
    "Asteroid\tA rocky object that orbits the Sun, mostly between Mars and Jupiter",
    "Comet\tAn icy body that grows a glowing tail near the Sun",
    "Galaxy\tA huge system of stars, gas and dust held together by gravity",
    "Gravity\tThe force that pulls objects toward each other",
    "Light-year\tThe distance light travels in one year",
    "Eclipse\tWhen one object in space blocks the light of another"
  ].join("\n");

  /* ================================================================================================
     State
     ================================================================================================ */
  var S = null;        // the game state (saved to sessionStorage)
  var link = null;     // the relay connection
  var timers = { tick: null, countdown: null, plan: null, save: null };

  function freshState() {
    return {
      v: 1,
      code: null, key: null,
      phase: "setup",                // setup | lobby | teams | countdown | play | paused | results
      title: "", raw: "", pairs: [],
      pics: {},                      // pictures the teacher added: lower-case term -> small JPEG data URL
      settings: {
        mode: "classic", target: 12, teams: 0, ask: "def", penalty: "point", names: "typed",
        shuffle: true, playoffStyle: "classic"
      },
      players: {},                   // pid: { name, team (index or -1), online, subs }
      order: [],                     // pids in join order
      removed: {},
      teams: [],                     // { name, members:[pid], score, seq, cur, queue, qi, done, doneAt, frozen:{} }
      heats: [],                     // { id, label, mode, teams:[index], done, winner }
      round: null,                   // { n, startedAt, endedAt, pausedAt, pausedMs }
      bestTimes: {},                 // Eleven: best time per team name
      misses: {},                    // pair id: wrong picks this round
      collect: false,
      subs: [],                      // { id, pid, name, term, def }
      series: null,                  // Playoffs: { pool, advanced, out, need, stage, game, champion, points }
      countdown: 0,
      planEndsAt: 0
    };
  }

  function save() {
    clearTimeout(timers.save);
    timers.save = setTimeout(function () {
      try { sessionStorage.setItem(GAME_KEY, JSON.stringify(S)); }
      catch (e) {
        // Too full with pictures: keep the game itself so a refresh still picks up where it left off.
        var lite = Object.assign({}, S, { pics: {} });
        HU.store.set("sessionStorage", GAME_KEY, lite);
      }
    }, 150);
  }

  /* ================================================================================================
     Term lists
     ================================================================================================ */
  // One pair per line. The first separator found wins: a tab, " = ", " - ", " : ", a comma, then a colon.
  // Lines in quotes ("a, b","c") are read as CSV. Blank lines and lines with only one side are skipped.
  function splitLine(line) {
    if (/^\s*"/.test(line) && line.indexOf(",") > -1) {
      var cells = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (q) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') q = false;
          else cur += c;
        } else if (c === '"') q = true;
        else if (c === ",") { cells.push(cur); cur = ""; }
        else cur += c;
      }
      cells.push(cur);
      if (cells.length >= 2) return [cells[0], cells.slice(1).join(", ")];
    }
    var seps = ["\t", " = ", " - ", " \u2013 ", " \u2014 ", " : ", ",", ":", "="];
    for (var s = 0; s < seps.length; s++) {
      var at = line.indexOf(seps[s]);
      if (at > 0) return [line.slice(0, at), line.slice(at + seps[s].length)];
    }
    return null;
  }

  function parsePairs(text, flip) {
    var out = [], skipped = 0, seen = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var parts = splitLine(line);
      if (!parts) { skipped++; return; }
      var a = parts[0].replace(/\s+/g, " ").trim().slice(0, 140);
      var b = parts[1].replace(/\s+/g, " ").trim().slice(0, 240);
      if (flip) { var t = a; a = b; b = t; }
      if (!a || !b) { skipped++; return; }
      var k = a.toLowerCase() + "\u0001" + b.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      if (out.length < MAX_PAIRS) out.push({ id: out.length, term: a, def: b });
    });
    return { pairs: out, skipped: skipped };
  }

  function pairsToText(pairs) {
    return pairs.map(function (p) { return p.term + "\t" + p.def; }).join("\n");
  }

  function savedSets() { return HU.store.get("localStorage", SETS_KEY) || []; }
  function writeSets(list) { HU.store.set("localStorage", SETS_KEY, list); }

  /* ================================================================================================
     Talking to students
     ================================================================================================ */
  function sendTo(pids, m) {
    if (!link) return;
    if (!Array.isArray(pids)) pids = [pids];
    if (!pids.length) return;
    // The relay takes up to 32 KB per message, so long lists go out in pieces.
    for (var i = 0; i < pids.length; i += 40) link.send({ to: pids.slice(i, i + 40), m: m });
  }

  function onlinePids() {
    return S.order.filter(function (pid) { return S.players[pid] && S.players[pid].online; });
  }

  function teamOf(pid) {
    var p = S.players[pid];
    return p && p.team > -1 ? S.teams[p.team] : null;
  }

  function heatOf(ti) {
    for (var i = 0; i < S.heats.length; i++) if (S.heats[i].teams.indexOf(ti) > -1) return S.heats[i];
    return null;
  }

  function modeOfHeat(heat) { return heat ? heat.mode : S.settings.mode; }

  function targetFor(mode) { return mode === "eleven" ? 11 : S.settings.target; }

  // What one student's screen should show right now.
  function viewFor(pid) {
    var p = S.players[pid];
    if (!p) return { t: "view", phase: "gone" };
    var v = { t: "view", phase: S.phase, name: p.name, code: S.code };
    var team = teamOf(pid);
    if (S.phase === "lobby" || S.phase === "setup") {
      v.phase = "lobby";
      v.collect = S.collect;
      v.subs = p.subs || 0;
      v.subLimit = SUBMIT_LIMIT;
      return v;
    }
    if (!team) { v.phase = "lobby"; v.waiting = true; return v; }
    var ti = S.teams.indexOf(team);
    var heat = heatOf(ti);
    var mode = modeOfHeat(heat);
    v.team = { name: team.name, i: ti };
    v.mates = team.members.filter(function (m) { return m !== pid && S.players[m]; }).map(function (m) { return S.players[m].name; });
    v.mode = { id: mode, title: HU.MODES[mode].title, seat: HU.MODES[mode].seat, rule: HU.MODES[mode].rule };
    if (heat) v.heat = heat.label;
    v.score = team.score;
    v.target = targetFor(mode);
    if (S.phase === "teams") {
      v.planEndsIn = S.planEndsAt ? Math.max(0, S.planEndsAt - Date.now()) : 0;
      return v;
    }
    if (S.phase === "countdown") { v.n = S.countdown; return v; }
    if (S.phase === "paused") return v;
    if (S.phase === "results") {
      v.result = resultLineFor(ti);
      return v;
    }
    if (S.phase === "play") {
      if (team.done) {
        v.phase = "finished";
        v.place = team.place || 0;
        v.time = team.doneAt ? team.doneAt : 0;
        return v;
      }
      if (heat && heat.done) { v.phase = "results"; v.result = resultLineFor(ti); return v; }
      var cur = team.cur;
      if (!cur) return v;
      var pair = S.pairs[cur.pair];
      v.seq = team.seq;
      v.ask = cur.ask;
      v.prompt = cur.ask === "def" ? pair.def : pair.term;
      // A picture goes with the meaning side, so it shows when students are finding the term.
      if (cur.ask === "def" && S.pics[pair.term.toLowerCase()] && S.pics[pair.term.toLowerCase()].length <= PIC_BYTES) v.pic = S.pics[pair.term.toLowerCase()];
      if (cur.again) v.again = true;
      v.tiles = (cur.deal[pid] || []).map(function (id) {
        var q = S.pairs[id];
        return { id: id, text: cur.ask === "def" ? q.term : q.def };
      });
      var fz = team.frozen && team.frozen[pid];
      v.frozenFor = fz && fz > Date.now() ? fz - Date.now() : 0;
      return v;
    }
    return v;
  }

  function resultLineFor(ti) {
    var team = S.teams[ti];
    var heat = heatOf(ti);
    if (S.series && S.series.champion != null) {
      return S.series.champion === ti
        ? { big: "Champions!", small: team.name + " wins the playoffs." }
        : { big: "Playoffs over", small: S.teams[S.series.champion].name + " is the champion." };
    }
    if (heat && heat.mode === "eleven") {
      return { big: team.done ? "You made it!" : "Time!", small: team.done ? "Your team finished in " + HU.clock(team.doneAt) + "." : "Your team reached " + team.score + "." };
    }
    if (heat && heat.winner === ti) {
      return { big: "Your team won!", small: S.series ? "You move on in the playoffs." : "Nice teamwork." };
    }
    if (heat && heat.winner != null) {
      return { big: "Round over", small: S.teams[heat.winner].name + " got there first." };
    }
    return { big: "Round over", small: "Eyes up front." };
  }

  function sendView(pid) { sendTo(pid, viewFor(pid)); }
  function sendAllViews() { onlinePids().forEach(sendView); }
  function sendTeamViews(team) {
    team.members.forEach(function (pid) { if (S.players[pid] && S.players[pid].online) sendView(pid); });
  }

  /* ================================================================================================
     The relay
     ================================================================================================ */
  function openRoom(isNew) {
    if (isNew) { S.code = HU.newCode(); S.key = HU.randomId(24); }
    var url = HU.relayBase + "/room/" + S.code + "?role=host&key=" + encodeURIComponent(S.key);
    setConn("connecting");
    link = HU.connect(url, {
      open: function () { setConn("up"); },
      down: function () { setConn("down"); },
      final: function (code) {
        if (code === 4003 && isNew && S.phase === "lobby") { openRoom(true); return; }
        setConn("lost");
      },
      message: onRelay
    });
  }

  function onRelay(msg) {
    if (msg.t === "hello") {
      var here = {};
      (msg.players || []).forEach(function (pid) { here[pid] = 1; });
      Object.keys(S.players).forEach(function (pid) { S.players[pid].online = !!here[pid]; });
      (msg.players || []).forEach(function (pid) { if (S.players[pid]) sendView(pid); });
      render();
      return;
    }
    if (msg.t === "error" && msg.code === "taken") return;
    if (msg.t === "join") return onJoin(msg.pid);
    if (msg.t === "leave") return onLeave(msg.pid);
    if (msg.t === "from" && msg.m && typeof msg.m.t === "string") return onPlayer(msg.pid, msg.m);
  }

  function onJoin(pid) {
    if (S.removed[pid]) { sendTo(pid, { t: "view", phase: "removed" }); return; }
    var p = S.players[pid];
    if (p) {
      p.online = true;
      if (p.name) {
        sendView(pid);
        if (S.phase === "play") redealIfStuck(teamOf(pid));
      }
    }
    // A new device is added when it says hi with its name.
    render();
  }

  function onLeave(pid) {
    var p = S.players[pid];
    if (!p) return;
    p.online = false;
    if (S.phase === "play") {
      var team = teamOf(pid);
      if (team && !team.done && team.cur && team.cur.deal[pid] && team.cur.deal[pid].length) redeal(team);
    }
    render();
    save();
  }

  function onPlayer(pid, m) {
    if (S.removed[pid]) return;
    if (m.t === "hi") return onHi(pid, m);
    var p = S.players[pid];
    if (!p) return;
    if (m.t === "pick") return onPick(pid, m);
    if (m.t === "submit") return onSubmit(pid, m);
  }

  function onHi(pid, m) {
    var p = S.players[pid];
    if (p) { p.online = true; sendView(pid); render(); return; }
    var count = Object.keys(S.players).length;
    if (count >= MAX_PLAYERS) { sendTo(pid, { t: "view", phase: "full" }); return; }
    var name = S.settings.names === "random" ? "" : HU.cleanName(m.name);
    if (!name) name = HU.randomName();
    name = uniqueName(name);
    S.players[pid] = { name: name, team: -1, online: true, subs: 0 };
    S.order.push(pid);
    if (S.phase !== "lobby" && S.phase !== "setup") placeLateJoiner(pid);
    sendView(pid);
    render();
    save();
  }

  function uniqueName(name) {
    var taken = {};
    Object.keys(S.players).forEach(function (k) { taken[S.players[k].name.toLowerCase()] = 1; });
    if (!taken[name.toLowerCase()]) return name;
    for (var i = 2; i < 99; i++) if (!taken[(name + " " + i).toLowerCase()]) return name + " " + i;
    return name + " " + HU.randomInt(1000);
  }

  // Someone joins after teams are set: put them on the smallest team that is still playing.
  function placeLateJoiner(pid) {
    var best = -1;
    S.teams.forEach(function (t, i) {
      if (t.done) return;
      if (best < 0 || t.members.length < S.teams[best].members.length) best = i;
    });
    if (best < 0) best = 0;
    if (!S.teams[best]) return;
    S.teams[best].members.push(pid);
    S.players[pid].team = best;
    if (S.phase === "play" && !S.teams[best].done) redeal(S.teams[best]);
    else sendTeamViews(S.teams[best]);
  }

  /* ================================================================================================
     Teams and rounds
     ================================================================================================ */
  function autoTeamCount(n) {
    if (S.settings.teams) return Math.max(1, Math.min(S.settings.teams, n, HU.TEAMS.length));
    // About three players a team, at least two teams once there are four players.
    if (n < 4) return 1;
    return Math.max(2, Math.min(HU.TEAMS.length, Math.round(n / 3)));
  }

  function makeTeams() {
    var pids = HU.shuffle(onlinePids().filter(function (pid) { return S.players[pid].name; }));
    var count = autoTeamCount(pids.length);
    var names = HU.shuffle(HU.TEAMS).slice(0, count);
    S.teams = names.map(function (name) {
      return { name: name, members: [], score: 0, seq: 0, cur: null, queue: [], qi: 0, done: false, doneAt: 0, frozen: {}, place: 0 };
    });
    Object.keys(S.players).forEach(function (pid) { S.players[pid].team = -1; });
    pids.forEach(function (pid, i) {
      var t = i % count;
      S.teams[t].members.push(pid);
      S.players[pid].team = t;
    });
  }

  function setupHeats() {
    var mode = S.settings.mode;
    if (mode === "playoffs") {
      var sr = S.series;
      var main = { id: "main", label: stageLabel(sr), mode: S.settings.playoffStyle, teams: sr.pool.slice(), done: false, winner: null };
      var rest = S.teams.map(function (_, i) { return i; }).filter(function (i) { return sr.pool.indexOf(i) < 0; });
      S.heats = [main];
      if (rest.length) S.heats.push({ id: "cons", label: "Consolation game", mode: S.settings.playoffStyle, teams: rest, done: false, winner: null });
    } else {
      S.heats = [{ id: "main", label: "", mode: mode, teams: S.teams.map(function (_, i) { return i; }), done: false, winner: null }];
    }
  }

  function startSeries() {
    var all = S.teams.map(function (_, i) { return i; });
    S.series = { pool: all, advanced: [], out: [], need: needFor(all.length), stage: 1, game: 1, champion: null, wins: {} };
    if (all.length < 2) S.series.champion = null;
  }

  function needFor(n) { return n <= 2 ? 1 : Math.ceil(n / 2); }

  function stageLabel(sr) {
    var n = sr.pool.length + sr.advanced.length;
    var name = n <= 2 ? "Final" : n <= 4 ? "Semifinals" : n <= 8 ? "Quarterfinals" : "Opening round";
    return name + (sr.need > 1 ? ", game " + sr.game + " of " + sr.need : "");
  }

  function resetTeamsForRound() {
    S.teams.forEach(function (t) {
      t.score = 0; t.seq = 0; t.cur = null; t.done = false; t.doneAt = 0; t.frozen = {}; t.place = 0;
      t.queue = HU.shuffle(S.pairs.map(function (p) { return p.id; }));
      t.qi = 0;
      t.retry = [];
    });
    S.misses = {};
  }

  function nextPrompt(team) {
    if (!team.queue.length) team.queue = HU.shuffle(S.pairs.map(function (p) { return p.id; }));
    if (team.qi >= team.queue.length) {
      // Went through the whole list: shuffle again, and do not repeat the last one first.
      var last = team.queue[team.queue.length - 1];
      team.queue = HU.shuffle(team.queue);
      if (team.queue[0] === last && team.queue.length > 1) team.queue.push(team.queue.shift());
      team.qi = 0;
    }
    var id = team.queue[team.qi++];
    // Second chance: a missed match comes back a few prompts later, so the team can get it right.
    var again = false;
    if (team.retry && team.retry.length && team.seq >= team.retry[0].at) {
      team.qi--;
      id = team.retry.shift().id;
      again = true;
    }
    var ask = S.settings.ask === "mix" ? (HU.randomInt(2) ? "def" : "term") : S.settings.ask;
    var pair = S.pairs[id];
    var answerText = function (p) { return (ask === "def" ? p.term : p.def).toLowerCase(); };
    var mine = answerText(pair);
    var others = HU.shuffle(S.pairs.filter(function (p) { return p.id !== id && answerText(p) !== mine; }));
    var seenText = {};
    seenText[mine] = 1;
    var options = [id];
    for (var i = 0; i < others.length && options.length < TILE_COUNT; i++) {
      var tx = answerText(others[i]);
      if (seenText[tx]) continue;
      seenText[tx] = 1;
      options.push(others[i].id);
    }
    team.seq++;
    team.cur = { pair: id, ask: ask, options: HU.shuffle(options), deal: {}, again: again };
    deal(team);
  }

  // Spread the answer tiles across the team's online devices, so the right one lands on a random teammate.
  function deal(team) {
    var cur = team.cur;
    cur.deal = {};
    var here = team.members.filter(function (pid) { return S.players[pid] && S.players[pid].online; });
    if (!here.length) return;
    here = HU.shuffle(here);
    here.forEach(function (pid) { cur.deal[pid] = []; });
    cur.options.forEach(function (id, i) { cur.deal[here[i % here.length]].push(id); });
  }

  function redeal(team) {
    if (!team || !team.cur || team.done) return;
    deal(team);
    sendTeamViews(team);
  }

  function redealIfStuck(team) {
    if (!team || !team.cur || team.done) return;
    var holder = null;
    Object.keys(team.cur.deal).forEach(function (pid) { if (team.cur.deal[pid].indexOf(team.cur.pair) > -1) holder = pid; });
    if (!holder || !S.players[holder] || !S.players[holder].online) redeal(team);
  }

  function elapsed() {
    var r = S.round;
    if (!r) return 0;
    var end = r.endedAt || (r.pausedAt || Date.now());
    return end - r.startedAt - (r.pausedMs || 0);
  }

  function beginCountdown() {
    S.phase = "countdown";
    S.countdown = 3;
    S.planEndsAt = 0;
    clearInterval(timers.plan);
    sendAllViews();
    render();
    clearInterval(timers.countdown);
    timers.countdown = setInterval(function () {
      S.countdown--;
      sound(S.countdown <= 0 ? "go" : "tick");
      if (S.countdown <= 0) {
        clearInterval(timers.countdown);
        startPlay();
      } else {
        sendAllViews();
        render();
      }
    }, 1000);
  }

  function startPlay() {
    resetTeamsForRound();
    setupHeats();
    S.round = { n: (S.round ? S.round.n : 0) + 1, startedAt: Date.now(), endedAt: 0, pausedAt: 0, pausedMs: 0 };
    S.phase = "play";
    S.teams.forEach(function (t, i) { if (heatOf(i)) nextPrompt(t); });
    sendAllViews();
    render();
    save();
    startTick();
  }

  function startTick() {
    clearInterval(timers.tick);
    timers.tick = setInterval(function () {
      var el = $("#hu-clock");
      if (el) el.textContent = HU.clock(elapsed());
    }, 250);
  }

  function onPick(pid, m) {
    if (S.phase !== "play") return;
    var team = teamOf(pid);
    if (!team || team.done || !team.cur) return;
    var ti = S.teams.indexOf(team);
    var heat = heatOf(ti);
    if (!heat || heat.done) return;
    // An old tap from the last prompt, a tile this device does not hold, or a tap while frozen:
    // ignore it, and send the current screen again so the buttons come back.
    var id = m.id;
    var now = Date.now();
    if (m.seq !== team.seq || (team.cur.deal[pid] || []).indexOf(id) < 0 || (team.frozen[pid] && team.frozen[pid] > now)) {
      sendView(pid);
      return;
    }
    var pair = S.pairs[team.cur.pair];
    var askDef = team.cur.ask === "def";
    var mode = heat.mode;
    var target = targetFor(mode);
    if (id === team.cur.pair) {
      team.score++;
      var flash = { t: "flash", kind: "right", by: S.players[pid].name, relay: mode === "relay" };
      if (team.score >= target) {
        team.done = true;
        team.doneAt = elapsed();
        team.place = heat.teams.filter(function (i) { return S.teams[i].done; }).length;
        sendTo(team.members, flash);
        sound("finish");
        teamFinished(heat, ti);
        return;
      }
      sendTo(team.members, flash);
      sound("match");
      nextPrompt(team);
    } else {
      S.misses[team.cur.pair] = (S.misses[team.cur.pair] || 0) + 1;
      if (!team.retry) team.retry = [];
      if (!team.retry.some(function (r) { return r.id === team.cur.pair; })) team.retry.push({ id: team.cur.pair, at: team.seq + 3 });
      sound("miss");
      if (S.settings.penalty === "zero") team.score = 0;
      else if (S.settings.penalty === "point") team.score = Math.max(0, team.score - 1);
      team.frozen[pid] = now + FREEZE_MS;
      sendTo(team.members, {
        t: "flash", kind: "wrong", by: S.players[pid].name,
        a: askDef ? pair.def : pair.term, b: askDef ? pair.term : pair.def,
        penalty: S.settings.penalty
      });
      nextPrompt(team);
    }
    sendTeamViews(team);
    renderBoard();
    save();
  }

  function teamFinished(heat, ti) {
    if (heat.mode === "eleven") {
      sendTeamViews(S.teams[ti]);
      var all = heat.teams.every(function (i) { return S.teams[i].done; });
      if (all) endHeat(heat, firstFinisher(heat));
    } else {
      endHeat(heat, ti);
    }
    renderBoard();
    save();
  }

  function firstFinisher(heat) {
    var best = null;
    heat.teams.forEach(function (i) { if (S.teams[i].done && (best == null || S.teams[i].doneAt < S.teams[best].doneAt)) best = i; });
    return best;
  }

  function endHeat(heat, winner) {
    heat.done = true;
    heat.winner = winner;
    heat.teams.forEach(function (i) { sendTeamViews(S.teams[i]); });
    if (heat.id === "main") endRound();
  }

  function endRound(early) {
    if (S.phase !== "play" && S.phase !== "paused") return;
    if (S.phase === "paused") resume(true);
    S.round.endedAt = Date.now();
    clearInterval(timers.tick);
    S.heats.forEach(function (heat) {
      if (!heat.done) {
        heat.done = true;
        if (heat.winner == null) heat.winner = early ? leader(heat) : leader(heat);
      }
    });
    var main = S.heats[0];
    // Eleven: remember each team's best time, to beat next round.
    if (main.mode === "eleven") {
      main.teams.forEach(function (i) {
        var t = S.teams[i];
        if (t.done && (!S.bestTimes[t.name] || t.doneAt < S.bestTimes[t.name])) S.bestTimes[t.name] = t.doneAt;
      });
    }
    if (S.series && main.winner != null) advanceSeries(main.winner);
    S.phase = "results";
    sendAllViews();
    render();
    save();
  }

  function leader(heat) {
    var best = null;
    heat.teams.forEach(function (i) { if (best == null || S.teams[i].score > S.teams[best].score) best = i; });
    return best;
  }

  function advanceSeries(winner) {
    var sr = S.series;
    if (sr.pool.indexOf(winner) < 0) return;
    sr.wins[winner] = (sr.wins[winner] || 0) + 1;
    sr.pool.splice(sr.pool.indexOf(winner), 1);
    sr.advanced.push(winner);
    if (sr.advanced.length >= sr.need || sr.pool.length === 0) {
      sr.out = sr.out.concat(sr.pool);
      sr.pool = sr.advanced;
      sr.advanced = [];
      if (sr.pool.length <= 1) { sr.champion = sr.pool[0]; return; }
      sr.need = needFor(sr.pool.length);
      sr.stage++;
      sr.game = 1;
    } else {
      sr.game++;
    }
  }

  function pause() {
    if (S.phase !== "play") return;
    S.phase = "paused";
    S.round.pausedAt = Date.now();
    sendAllViews();
    render();
    save();
  }

  function resume(quiet) {
    if (S.phase !== "paused") return;
    S.round.pausedMs += Date.now() - S.round.pausedAt;
    S.round.pausedAt = 0;
    S.phase = "play";
    if (quiet) return;
    sendAllViews();
    render();
    save();
  }

  function closeRoom() {
    if (link) { link.send({ t: "close-room" }); setTimeout(function () { link.stop(); link = null; }, 300); }
    clearInterval(timers.tick);
    clearInterval(timers.countdown);
    clearInterval(timers.plan);
    var keep = { title: S.title, raw: S.raw, pairs: S.pairs, settings: S.settings, pics: S.pics };
    S = freshState();
    S.title = keep.title; S.raw = keep.raw; S.pairs = keep.pairs; S.settings = keep.settings; S.pics = keep.pics || {};
    HU.store.remove("sessionStorage", GAME_KEY);
    setConn("none");
    render();
  }

  /* ================================================================================================
     Sound (the teacher's board only; students' devices stay quiet)
     ================================================================================================ */
  var audio = null;
  var muted = HU.store.get("localStorage", "huddle.muted") === true;
  function sound(kind) {
    if (muted || !window.AudioContext) return;
    try {
      if (!audio) audio = new AudioContext();
      if (audio.state === "suspended") audio.resume();
      var notes = { match: [[660, 0, 0.09]], miss: [[220, 0, 0.16]], tick: [[520, 0, 0.12]], go: [[784, 0, 0.25]],
        finish: [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.3]] }[kind] || [];
      notes.forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + n[1];
        o.type = kind === "miss" ? "triangle" : "sine";
        o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(kind === "match" ? 0.08 : 0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[2]);
        o.connect(g); g.connect(audio.destination);
        o.start(t); o.stop(t + n[2] + 0.05);
      });
    } catch (e) { /* no sound, no problem */ }
  }
  function renderMute() {
    document.querySelectorAll(".hu-mute").forEach(function (b) {
      b.textContent = muted ? "Sound off" : "Sound on";
      b.setAttribute("aria-pressed", muted ? "false" : "true");
    });
  }

  /* ================================================================================================
     Students write the set
     ================================================================================================ */
  function onSubmit(pid, m) {
    var p = S.players[pid];
    if (!S.collect || S.phase !== "lobby") return;
    if ((p.subs || 0) >= SUBMIT_LIMIT) return;
    var term = String(m.term || "").replace(/\s+/g, " ").trim().slice(0, 140);
    var def = String(m.def || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!term || !def) return;
    p.subs = (p.subs || 0) + 1;
    S.subs.push({ id: HU.randomId(8), pid: pid, name: p.name, term: term, def: def });
    sendView(pid);
    renderSubs();
    save();
  }

  function keepSub(id) {
    var at = S.subs.findIndex(function (s) { return s.id === id; });
    if (at < 0) return;
    var s = S.subs[at];
    S.subs.splice(at, 1);
    S.raw = (S.raw.trim() ? S.raw.replace(/\s+$/, "") + "\n" : "") + s.term + "\t" + s.def;
    S.pairs = parsePairs(S.raw).pairs;
    renderSubs();
    renderLobbyCount();
    save();
  }

  function dropSub(id) {
    S.subs = S.subs.filter(function (s) { return s.id !== id; });
    renderSubs();
    save();
  }

  /* ================================================================================================
     Drawing the teacher's screen
     ================================================================================================ */
  var view = {};

  function setConn(state) {
    view.conn = state;
    var el = $("#hu-conn");
    if (!el) return;
    var text = { none: "", connecting: "Connecting to the room...", up: "", down: "Reconnecting...", lost: "The room connection was lost. Refresh the page to try again." }[state] || "";
    el.textContent = text;
    el.hidden = !text;
  }

  function show(id) {
    ["#hu-setup", "#hu-lobby", "#hu-teams", "#hu-game", "#hu-results"].forEach(function (sel) {
      $(sel).hidden = sel !== id;
    });
    document.body.classList.toggle("hu-live", id !== "#hu-setup");
  }

  function render() {
    if (S.phase === "setup") { show("#hu-setup"); renderSetup(); return; }
    if (S.phase === "lobby") { show("#hu-lobby"); renderLobby(); return; }
    if (S.phase === "teams" || S.phase === "countdown") { show("#hu-teams"); renderTeams(); return; }
    if (S.phase === "play" || S.phase === "paused") { show("#hu-game"); renderGame(); return; }
    if (S.phase === "results") { show("#hu-results"); renderResults(); return; }
  }

  /* ---- Setup ---------------------------------------------------------------------------------- */
  function renderSetup() {
    var ta = $("#hu-terms");
    if (ta.value !== S.raw) ta.value = S.raw;
    $("#hu-title").value = S.title || "";
    var mode = S.settings.mode;
    document.querySelectorAll("input[name=hu-mode]").forEach(function (r) { r.checked = r.value === mode; });
    $("#hu-target").value = String(S.settings.target);
    $("#hu-teamcount").value = String(S.settings.teams);
    $("#hu-ask").value = S.settings.ask;
    $("#hu-penalty").value = S.settings.penalty;
    $("#hu-names").value = S.settings.names;
    $("#hu-shuffle").checked = !!S.settings.shuffle;
    $("#hu-pstyle").value = S.settings.playoffStyle;
    $("#hu-target-row").hidden = mode === "eleven";
    $("#hu-eleven-note").hidden = mode !== "eleven";
    $("#hu-pstyle-row").hidden = mode !== "playoffs";
    $("#hu-shuffle-row").hidden = mode === "playoffs";
    $("#hu-open").textContent = S.code ? "Back to the room" : "Open a room";
    renderParse();
    renderSaved();
  }

  function renderParse() {
    var res = parsePairs(S.raw);
    S.pairs = res.pairs;
    var el = $("#hu-parse");
    var n = res.pairs.length;
    var msg;
    if (!n) msg = "Paste a list to get started. Put one term and its match on each line.";
    else if (n < 4) msg = n + (n === 1 ? " match" : " matches") + " so far. Add at least 4 to play (12 or more works best).";
    else msg = n + " matches ready." + (n < 12 ? " 12 or more works best, so every team sees a full set of answers." : "");
    if (res.skipped) msg += " " + res.skipped + (res.skipped === 1 ? " line was" : " lines were") + " skipped because I could not find where the term ends.";
    el.textContent = msg;
    el.classList.toggle("hu-warn", n > 0 && n < 4);
    $("#hu-open").disabled = n < 4;
    var list = HU.clear($("#hu-preview"));
    res.pairs.slice(0, 6).forEach(function (p) {
      list.appendChild(h("li", null, h("b", { text: p.term }), h("span", { text: p.def })));
    });
    if (n > 6) list.appendChild(h("li", { class: "hu-more", text: "and " + (n - 6) + " more" }));
    var picCount = res.pairs.filter(function (p) { return S.pics[p.term.toLowerCase()]; }).length;
    $("#hu-pics-toggle").textContent = picCount ? "Pictures (" + picCount + ")" : "Add pictures";
    if (!$("#hu-pics").hidden) renderPics();
  }

  /* ---- Pictures ------------------------------------------------------------------------------- */
  // The teacher picks an image file for a match. It is shrunk in this browser to a small JPEG, kept with the
  // list, and shown on students' screens with the meaning. Nothing is uploaded anywhere.
  var PIC_MAX = 480, PIC_LIMIT = 60, PIC_BYTES = 150000; // the relay takes teacher messages up to 192 KB
  function renderPics() {
    var list = HU.clear($("#hu-pics-list"));
    S.pairs.forEach(function (p) {
      var key = p.term.toLowerCase();
      var pic = S.pics[key];
      var input = h("input", { type: "file", accept: "image/*", class: "hu-pic-input", "aria-label": "Choose a picture for " + p.term });
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (file) addPic(key, file);
      });
      list.appendChild(h("li", null,
        pic ? h("img", { src: pic, alt: "Picture for " + p.term, width: "64", height: "64", class: "hu-pic-thumb" }) : h("span", { class: "hu-pic-thumb hu-pic-empty", "aria-hidden": "true" }),
        h("span", { class: "hu-pic-term" }, h("b", { text: p.term }), h("span", { class: "hu-dim", text: p.def })),
        h("label", { class: "btn btn-ghost btn-sm hu-file" }, pic ? "Change" : "Add picture", input),
        pic ? h("button", { type: "button", class: "hu-x", "aria-label": "Remove the picture for " + p.term, onclick: function () { delete S.pics[key]; renderParse(); save(); } }, "\u00d7") : null
      ));
    });
  }

  function addPic(key, file) {
    var note = $("#hu-pics-note");
    if (!/^image\//.test(file.type)) { note.textContent = "That file is not a picture."; return; }
    if (!S.pics[key] && Object.keys(S.pics).length >= PIC_LIMIT) { note.textContent = "That is the most pictures one list can hold (" + PIC_LIMIT + ")."; return; }
    // Read the file as a data address (the page's security rules allow data: pictures, not blob: ones).
    var reader = new FileReader();
    reader.onerror = function () { note.textContent = "That picture could not be opened. Try a JPG or PNG."; };
    reader.onload = function () { shrink(String(reader.result || "")); };
    reader.readAsDataURL(file);
    function shrink(url) {
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, PIC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      var g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      var data = c.toDataURL("image/jpeg", 0.72);
      if (data.length > 90000) data = c.toDataURL("image/jpeg", 0.5);
      if (data.length > PIC_BYTES) { note.textContent = "That picture is too detailed to send. Try a simpler one."; return; }
      S.pics[key] = data;
      note.textContent = "";
      renderParse();
      save();
    };
    img.onerror = function () { note.textContent = "That picture could not be opened. Try a JPG or PNG."; };
    img.src = url;
    }
  }

  function picsFor(pairs) {
    var out = {};
    pairs.forEach(function (p) { var k = p.term.toLowerCase(); if (S.pics[k]) out[k] = S.pics[k]; });
    return out;
  }

  /* ---- Share a list as a link ----------------------------------------------------------------- */
  // The list rides in the part of the address after #, which browsers never send to a server.
  // Pictures stay out of the link (they would make it far too long).
  function shareLink() {
    var res = parsePairs(S.raw);
    if (!res.pairs.length) return;
    var json = JSON.stringify({ t: (S.title || "").slice(0, 80), r: pairsToText(res.pairs) });
    var bytes = new TextEncoder().encode(json), bin = "";
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    var code = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    var link = location.origin + "/huddle-up/host/#list=" + code;
    var note = $("#hu-save-note");
    function done(ok) {
      note.textContent = ok ? "Link copied. Anyone who opens it gets this list (without pictures)." : "Copy this link: " + link;
      setTimeout(function () { note.textContent = ""; }, ok ? 4000 : 20000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  function listFromHash() {
    var m = /^#list=([A-Za-z0-9_-]+)$/.exec(location.hash || "");
    if (!m) return null;
    try {
      var b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var obj = JSON.parse(new TextDecoder().decode(bytes));
      if (!obj || typeof obj.r !== "string") return null;
      return { title: String(obj.t || "").slice(0, 80), raw: obj.r.slice(0, 60000) };
    } catch (e) { return null; }
  }

  function renderSaved() {
    var sets = savedSets();
    var wrap = $("#hu-saved");
    var list = HU.clear($("#hu-saved-list"));
    wrap.hidden = !sets.length;
    sets.forEach(function (set, i) {
      list.appendChild(h("li", null,
        h("button", { type: "button", class: "hu-link", onclick: function () { loadSet(i); } }, set.title || "Untitled list"),
        h("span", { class: "hu-dim", text: " " + set.count + " matches " }),
        h("button", { type: "button", class: "hu-x", "aria-label": "Delete " + (set.title || "Untitled list"), onclick: function () { deleteSet(i); } }, "×")
      ));
    });
  }

  function loadSet(i) {
    var set = savedSets()[i];
    if (!set) return;
    S.title = set.title || "";
    S.raw = set.raw || "";
    if (set.pics) Object.keys(set.pics).forEach(function (k) { S.pics[k] = set.pics[k]; });
    renderSetup();
    save();
  }

  function deleteSet(i) {
    var sets = savedSets();
    sets.splice(i, 1);
    writeSets(sets);
    renderSaved();
  }

  function saveSet() {
    var title = ($("#hu-title").value || "").trim().slice(0, 80) || "Untitled list";
    var res = parsePairs(S.raw);
    if (!res.pairs.length) return;
    var sets = savedSets().filter(function (s) { return s.title !== title; });
    var pics = picsFor(res.pairs);
    sets.unshift({ title: title, raw: pairsToText(res.pairs), count: res.pairs.length, saved: Date.now(), pics: pics });
    writeSets(sets.slice(0, 40));
    S.title = title;
    var note = $("#hu-save-note");
    var check = savedSets();
    if (!check.length || check[0].title !== title) {
      // Browser storage is full (pictures take room). Save the words, and say so.
      sets[0].pics = {};
      writeSets(sets.slice(0, 40));
      note.textContent = "Saved the words in this browser. The pictures did not fit, so add them again next time.";
    } else note.textContent = "Saved in this browser.";
    setTimeout(function () { note.textContent = ""; }, 2500);
    renderSaved();
  }

  function readSettings() {
    var picked = document.querySelector("input[name=hu-mode]:checked");
    S.settings.mode = picked ? picked.value : "classic";
    S.settings.target = parseInt($("#hu-target").value, 10) || 12;
    S.settings.teams = parseInt($("#hu-teamcount").value, 10) || 0;
    S.settings.ask = $("#hu-ask").value;
    S.settings.penalty = $("#hu-penalty").value;
    S.settings.names = $("#hu-names").value;
    S.settings.shuffle = $("#hu-shuffle").checked;
    S.settings.playoffStyle = $("#hu-pstyle").value;
    S.title = $("#hu-title").value.trim().slice(0, 80);
  }

  function openOrReturn() {
    readSettings();
    S.pairs = parsePairs(S.raw).pairs;
    if (S.pairs.length < 4) return;
    S.series = null;
    S.phase = "lobby";
    if (!S.code) openRoom(true);
    sendAllViews();
    render();
    save();
  }

  /* ---- Lobby ---------------------------------------------------------------------------------- */
  function joinUrl() { return "https://apps.lessonshuffle.com/join/"; }

  function renderLobby() {
    $("#hu-code").textContent = S.code ? S.code.slice(0, 3) + " " + S.code.slice(3) : "";
    $("#hu-code").setAttribute("aria-label", "Room code " + (S.code || "").split("").join(" "));
    renderQr();
    $("#hu-lobby-mode").textContent = HU.MODES[S.settings.mode].title + ": " + HU.MODES[S.settings.mode].short;
    $("#hu-collect").setAttribute("aria-pressed", S.collect ? "true" : "false");
    $("#hu-collect").textContent = S.collect ? "Stop collecting terms" : "Students write the set";
    $("#hu-subs-wrap").hidden = !S.collect && !S.subs.length;
    renderPlayers();
    renderSubs();
    renderLobbyCount();
  }

  var qrFor = null;
  function renderQr() {
    if (!S.code || qrFor === S.code || typeof window.qrcode !== "function") return;
    qrFor = S.code;
    var qr = window.qrcode(0, "M");
    qr.addData("https://apps.lessonshuffle.com/join/?code=" + S.code);
    qr.make();
    var n = qr.getModuleCount(), q = 4, size = n + q * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + (c + q) + " " + (r + q) + "h1v1h-1z";
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code that opens the join page with this room code filled in.");
    svg.setAttribute("shape-rendering", "crispEdges");
    var bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", size); bg.setAttribute("height", size); bg.setAttribute("fill", "#fff");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#14212e");
    svg.appendChild(bg); svg.appendChild(path);
    HU.clear($("#hu-qr")).appendChild(svg);
  }

  function renderLobbyCount() {
    var named = S.order.filter(function (pid) { return S.players[pid] && S.players[pid].online && S.players[pid].name; }).length;
    $("#hu-count").textContent = named === 1 ? "1 player" : named + " players";
    $("#hu-start").disabled = named < 1;
    var t = autoTeamCount(named);
    $("#hu-start-note").textContent = named ? "That makes " + t + (t === 1 ? " team" : " teams") + ". " + S.pairs.length + " matches in the set." : "Waiting for players to join.";
  }

  function renderPlayers() {
    var list = HU.clear($("#hu-players"));
    S.order.forEach(function (pid) {
      var p = S.players[pid];
      if (!p || !p.name) return;
      list.appendChild(h("li", { class: p.online ? "" : "hu-off" },
        h("span", { text: p.name }),
        h("button", { type: "button", class: "hu-mini", title: "Give a random name", "aria-label": "Give " + p.name + " a random name", onclick: function () { renamePlayer(pid); } }, "New name"),
        h("button", { type: "button", class: "hu-x", "aria-label": "Remove " + p.name, onclick: function () { removePlayer(pid); } }, "×")
      ));
    });
  }

  function renamePlayer(pid) {
    var p = S.players[pid];
    if (!p) return;
    p.name = uniqueName(HU.randomName());
    sendView(pid);
    render();
    save();
  }

  function removePlayer(pid) {
    var p = S.players[pid];
    if (!p) return;
    S.removed[pid] = 1;
    sendTo(pid, { t: "view", phase: "removed" });
    var team = teamOf(pid);
    if (team) {
      team.members = team.members.filter(function (m) { return m !== pid; });
      if (S.phase === "play") redeal(team); else sendTeamViews(team);
    }
    delete S.players[pid];
    S.order = S.order.filter(function (m) { return m !== pid; });
    render();
    save();
  }

  function renderSubs() {
    var wrap = $("#hu-subs-wrap");
    if (!wrap) return;
    wrap.hidden = !S.collect && !S.subs.length;
    var list = HU.clear($("#hu-subs"));
    $("#hu-subs-empty").hidden = S.subs.length > 0;
    $("#hu-keep-all").hidden = S.subs.length < 2;
    S.subs.forEach(function (s) {
      list.appendChild(h("li", null,
        h("div", null, h("b", { text: s.term }), h("span", { text: s.def }), h("small", { class: "hu-dim", text: "from " + s.name })),
        h("div", { class: "hu-row" },
          h("button", { type: "button", class: "btn btn-main btn-sm", onclick: function () { keepSub(s.id); } }, "Keep"),
          h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: function () { dropSub(s.id); } }, "Drop"))
      ));
    });
  }

  /* ---- Teams ---------------------------------------------------------------------------------- */
  function renderTeams() {
    var mode = S.settings.mode === "playoffs" ? S.settings.playoffStyle : S.settings.mode;
    var m = HU.MODES[mode];
    var heading = S.settings.mode === "playoffs" && S.series ? "Playoffs: " + stageLabel(S.series) : m.title;
    $("#hu-teams-mode").textContent = heading;
    $("#hu-teams-rule").textContent = m.seat + " " + m.rule;
    var grid = HU.clear($("#hu-team-grid"));
    S.teams.forEach(function (t, i) {
      var inMain = !S.series || S.series.pool.indexOf(i) > -1;
      grid.appendChild(h("li", { class: "hu-team team-" + (HU.TEAMS.indexOf(t.name)) + (inMain ? "" : " hu-cons") },
        h("h3", { text: t.name }),
        S.series && !inMain ? h("p", { class: "hu-tag", text: S.series.advanced.indexOf(i) > -1 ? "Moved on! Consolation game for fun" : "Consolation game" }) : null,
        h("ul", { role: "list" }, t.members.map(function (pid) { return h("li", { text: S.players[pid] ? S.players[pid].name : "" }); }))
      ));
    });
    var plan = $("#hu-plan");
    plan.hidden = mode !== "silent" && mode !== "tagteam";
    $("#hu-reshuffle").hidden = !!S.series || S.phase === "countdown";
    $("#hu-go").disabled = S.phase === "countdown";
    $("#hu-go").textContent = S.phase === "countdown" ? String(S.countdown) : "Start the round";
    $("#hu-plan-clock").textContent = S.planEndsAt ? HU.clock(S.planEndsAt - Date.now()) : "";
  }

  function toTeams(reshuffle) {
    if (reshuffle || !S.teams.length) makeTeams();
    S.phase = "teams";
    S.planEndsAt = 0;
    sendAllViews();
    render();
    save();
  }

  function startPlan() {
    S.planEndsAt = Date.now() + 120000;
    sendAllViews();
    clearInterval(timers.plan);
    timers.plan = setInterval(function () {
      var left = S.planEndsAt - Date.now();
      $("#hu-plan-clock").textContent = HU.clock(left);
      if (left <= 0) { clearInterval(timers.plan); S.planEndsAt = 0; $("#hu-plan-clock").textContent = "Time is up!"; sendAllViews(); }
    }, 250);
  }

  /* ---- The game board (what the class sees on the projector) --------------------------------- */
  function renderGame() {
    var main = S.heats[0];
    var mode = main ? main.mode : S.settings.mode;
    $("#hu-game-mode").textContent = (S.series ? "Playoffs: " + main.label + " · " : "") + HU.MODES[mode].title;
    $("#hu-game-rule").textContent = HU.MODES[mode].rule;
    $("#hu-pause").textContent = S.phase === "paused" ? "Resume" : "Pause";
    $("#hu-paused").hidden = S.phase !== "paused";
    $("#hu-clock").textContent = HU.clock(elapsed());
    renderBoard();
  }

  function renderBoard() {
    var board = $("#hu-board");
    if (!board || $("#hu-game").hidden) return;
    HU.clear(board);
    S.heats.forEach(function (heat) {
      var target = targetFor(heat.mode);
      var sec = h("section", { class: "hu-heat" + (heat.id === "cons" ? " hu-heat-cons" : "") });
      if (heat.label) sec.appendChild(h("h2", { class: "hu-heat-label", text: heat.label + (heat.id === "cons" ? " (just for fun)" : "") }));
      var list = h("ol", { class: "hu-lanes", role: "list" });
      heat.teams.forEach(function (i) {
        var t = S.teams[i];
        var bar = h("div", { class: "hu-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(target), "aria-valuenow": String(t.score), "aria-label": t.name });
        var fill = h("span", { class: "hu-fill" });
        fill.style.setProperty("--p", String(Math.min(1, t.score / target)));
        bar.appendChild(fill);
        var status = t.done ? (heat.mode === "eleven" ? "Done in " + HU.clock(t.doneAt) : "Winner!") : t.score + " of " + target;
        var best = heat.mode === "eleven" && S.bestTimes[t.name] ? "Best " + HU.clock(S.bestTimes[t.name]) : "";
        list.appendChild(h("li", { class: "hu-lane team-" + HU.TEAMS.indexOf(t.name) + (t.done ? " hu-done" : "") },
          h("span", { class: "hu-lane-name", text: t.name }),
          bar,
          h("span", { class: "hu-lane-score", text: status }),
          best ? h("span", { class: "hu-lane-best", text: best }) : null
        ));
      });
      sec.appendChild(list);
      board.appendChild(sec);
    });
  }

  /* ---- Results -------------------------------------------------------------------------------- */
  function renderResults() {
    var main = S.heats[0];
    var head = $("#hu-res-head"), sub = $("#hu-res-sub");
    var sr = S.series;
    if (sr && sr.champion != null) {
      head.textContent = S.teams[sr.champion].name + " is the champion!";
      sub.textContent = "That's the playoffs. Shuffle new teams to play again.";
    } else if (main.mode === "eleven") {
      var allDone = main.teams.every(function (i) { return S.teams[i].done; });
      head.textContent = allDone ? "Every team made it!" : "Time!";
      sub.textContent = "Round time " + HU.clock(elapsed()) + ". Try to beat your best time next round.";
    } else if (main.winner != null) {
      head.textContent = S.teams[main.winner].name + " wins!";
      sub.textContent = sr ? "On to the next game. Next up: " + stageLabel(sr) + "." : "Round time " + HU.clock(elapsed()) + ".";
    } else {
      head.textContent = "Round over";
      sub.textContent = "";
    }
    var table = HU.clear($("#hu-res-teams"));
    var ranked = main.teams.slice().sort(function (a, b) {
      var A = S.teams[a], B = S.teams[b];
      if (A.done !== B.done) return A.done ? -1 : 1;
      if (A.done) return A.doneAt - B.doneAt;
      return B.score - A.score;
    });
    ranked.forEach(function (i) {
      var t = S.teams[i];
      table.appendChild(h("li", { class: "team-" + HU.TEAMS.indexOf(t.name) }, h("b", { text: t.name }),
        h("span", { text: t.done ? (main.mode === "eleven" ? "finished in " + HU.clock(t.doneAt) : "reached " + t.score) : "reached " + t.score })));
    });
    // The matches that tripped teams up. No names, just the terms.
    var tough = Object.keys(S.misses).map(function (id) { return { id: +id, n: S.misses[id] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    var tl = HU.clear($("#hu-tough"));
    $("#hu-tough-wrap").hidden = !tough.length;
    tough.forEach(function (x) {
      var p = S.pairs[x.id];
      if (!p) return;
      tl.appendChild(h("li", null, h("b", { text: p.term }), h("span", { text: p.def }), h("small", { class: "hu-dim", text: x.n + (x.n === 1 ? " miss" : " misses") })));
    });
    // Buttons
    var inSeries = !!sr && sr.champion == null;
    $("#hu-next-game").hidden = !inSeries;
    $("#hu-pstyle-next-row").hidden = !inSeries;
    $("#hu-pstyle-next").value = S.settings.playoffStyle;
    $("#hu-again").hidden = inSeries;
    $("#hu-again").textContent = S.settings.shuffle || sr ? "Shuffle teams and play again" : "Play again";
    $("#hu-same").hidden = inSeries || !S.settings.shuffle || !!sr;
  }

  /* ================================================================================================
     Wiring
     ================================================================================================ */
  function wire() {
    var ta = $("#hu-terms");
    ta.addEventListener("input", function () { S.raw = ta.value; renderParse(); save(); });
    $("#hu-title").addEventListener("input", function () { S.title = $("#hu-title").value; save(); });
    $("#hu-sample").addEventListener("click", function () { S.raw = SAMPLE; S.title = "The solar system (sample)"; renderSetup(); save(); });
    $("#hu-flip").addEventListener("click", function () {
      var res = parsePairs(S.raw, true);
      S.raw = pairsToText(res.pairs);
      renderSetup();
      save();
    });
    $("#hu-clear").addEventListener("click", function () { S.raw = ""; S.title = ""; renderSetup(); save(); });
    $("#hu-file").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      if (file.size > 500000) { $("#hu-parse").textContent = "That file is too big. Try a plain text or CSV file of terms."; return; }
      var reader = new FileReader();
      reader.onload = function () {
        S.raw = String(reader.result || "").replace(/^﻿/, "");
        if (!S.title) S.title = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
        renderSetup();
        save();
        ev.target.value = "";
      };
      reader.readAsText(file);
    });
    $("#hu-save").addEventListener("click", saveSet);
    $("#hu-share").addEventListener("click", shareLink);
    $("#hu-pics-toggle").addEventListener("click", function () {
      var panel = $("#hu-pics");
      panel.hidden = !panel.hidden;
      $("#hu-pics-toggle").setAttribute("aria-expanded", panel.hidden ? "false" : "true");
      if (!panel.hidden) renderPics();
    });
    document.querySelectorAll(".hu-mute").forEach(function (b) {
      b.addEventListener("click", function () { muted = !muted; HU.store.set("localStorage", "huddle.muted", muted); renderMute(); if (!muted) sound("match"); });
    });
    renderMute();
    document.querySelectorAll("input[name=hu-mode]").forEach(function (r) {
      r.addEventListener("change", function () { readSettings(); renderSetup(); save(); });
    });
    ["#hu-target", "#hu-teamcount", "#hu-ask", "#hu-penalty", "#hu-names", "#hu-shuffle", "#hu-pstyle"].forEach(function (sel) {
      $(sel).addEventListener("change", function () { readSettings(); save(); });
    });
    $("#hu-setup-form").addEventListener("submit", function (ev) { ev.preventDefault(); openOrReturn(); });

    $("#hu-collect").addEventListener("click", function () { S.collect = !S.collect; sendAllViews(); renderLobby(); save(); });
    $("#hu-keep-all").addEventListener("click", function () { S.subs.slice().forEach(function (s) { keepSub(s.id); }); });
    $("#hu-start").addEventListener("click", function () {
      S.collect = false;
      makeTeams();
      if (S.settings.mode === "playoffs") startSeries();
      toTeams(false);
    });
    $("#hu-edit").addEventListener("click", function () { S.phase = "setup"; sendAllViews(); render(); save(); });

    $("#hu-reshuffle").addEventListener("click", function () { toTeams(true); });
    $("#hu-plan-start").addEventListener("click", startPlan);
    $("#hu-go").addEventListener("click", beginCountdown);
    $("#hu-teams-back").addEventListener("click", function () { S.phase = "lobby"; S.series = null; sendAllViews(); render(); save(); });

    $("#hu-pause").addEventListener("click", function () { if (S.phase === "paused") resume(); else pause(); });
    $("#hu-end").addEventListener("click", function () { endRound(true); });

    $("#hu-again").addEventListener("click", function () {
      if (S.series) { S.series = null; makeTeams(); if (S.settings.mode === "playoffs") startSeries(); toTeams(false); return; }
      toTeams(S.settings.shuffle);
    });
    $("#hu-same").addEventListener("click", function () { toTeams(false); });
    $("#hu-next-game").addEventListener("click", function () {
      S.settings.playoffStyle = $("#hu-pstyle-next").value;
      toTeams(false);
    });
    $("#hu-change").addEventListener("click", function () { S.series = null; S.phase = "setup"; sendAllViews(); render(); save(); });
    document.querySelectorAll(".hu-close").forEach(function (b) {
      b.addEventListener("click", function () {
        if (window.confirm("End the game and close the room? Students will see that the game is over.")) closeRoom();
      });
    });
    window.addEventListener("beforeunload", function () { HU.store.set("sessionStorage", GAME_KEY, S); });
  }

  function boot() {
    if (!window.WebSocket || !window.crypto || !crypto.getRandomValues) {
      $("#hu-nojs").textContent = "This browser is too old to host a game. Try a current Chrome, Edge, Firefox or Safari.";
      return;
    }
    $("#hu-nojs").hidden = true;
    $("#hu-app").hidden = false;
    var saved = HU.store.get("sessionStorage", GAME_KEY);
    S = saved && saved.v === 1 ? saved : freshState();
    if (!S.pics) S.pics = {};
    // A shared list link (#list=...) fills in the terms, unless a game is already running in this tab.
    var shared = listFromHash();
    if (shared) {
      if (!S.code) { S.raw = shared.raw; S.title = shared.title; }
      try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
    }
    if (S.phase === "countdown") S.phase = "teams";
    S.planEndsAt = 0;
    Object.keys(S.players).forEach(function (pid) { S.players[pid].online = false; });
    wire();
    if (S.code) openRoom(false);
    if (S.phase === "play" || S.phase === "paused") startTick();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
