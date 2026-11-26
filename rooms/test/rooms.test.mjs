// End-to-end test: starts `wrangler dev --local` and talks to it over real WebSockets.
// (--local-upstream stops wrangler from rewriting the Origin header to rooms.lessonshuffle.com)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import WebSocket from "ws"; // Node's built-in WebSocket cannot set the Origin header

const PORT = 8790;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `ws://localhost:${PORT}`;
let proc;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  proc = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local", "--local-upstream", `localhost:${PORT}`], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${ORIGIN}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("wrangler dev did not start");
});

after(() => {
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
});

// Raw upgrade request, returns the HTTP status (101 when accepted).
function upgradeStatus(path, origin) {
  return new Promise((resolve, reject) => {
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    };
    if (origin) headers.Origin = origin;
    const req = http.request({ host: "localhost", port: PORT, path, headers });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on("error", reject);
    req.end();
  });
}

// Wrapper that queues messages and close events.
function connect(code, query, origin = ORIGIN) {
  const ws = new WebSocket(`${BASE}/room/${code}?${query}`, { headers: { Origin: origin } });
  const c = { ws, msgs: [], waiters: [], closed: null, closeWaiters: [] };
  ws.on("message", (data) => {
    const v = JSON.parse(data.toString());
    const w = c.waiters.shift();
    if (w) w(v); else c.msgs.push(v);
  });
  ws.on("close", (code, reason) => {
    c.closed = { code, reason: reason.toString() };
    c.closeWaiters.forEach((w) => w(c.closed));
  });
  c.next = (ms = 5000) =>
    c.msgs.length
      ? Promise.resolve(c.msgs.shift())
      : new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("timeout waiting for message")), ms);
          c.waiters.push((v) => { clearTimeout(t); res(v); });
        });
  c.close = (ms = 5000) =>
    c.closed
      ? Promise.resolve(c.closed)
      : new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("timeout waiting for close")), ms);
          c.closeWaiters.push((v) => { clearTimeout(t); res(v); });
        });
  c.open = new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", (e) => rej(e));
  });
  c.none = async (ms = 400) => { await sleep(ms); assert.equal(c.msgs.length, 0, JSON.stringify(c.msgs)); };
  return c;
}

const KEY = "hostkey-abcdef12";
const code = (n) => "ABCDE" + "23456789"[n];

test("health, bad code, bad origin, 404", async () => {
  assert.equal((await fetch(`${ORIGIN}/health`)).status, 200);
  assert.equal((await fetch(`${ORIGIN}/nope`)).status, 404);
  assert.equal(await upgradeStatus(`/room/ABC?role=player&pid=player-0001`, ORIGIN), 400);
  assert.equal(await upgradeStatus(`/room/ABCDEI?role=player&pid=player-0001`, ORIGIN), 400);
  assert.equal(await upgradeStatus(`/room/ABCDE2?role=player&pid=short`, ORIGIN), 400);
  assert.equal(await upgradeStatus(`/room/ABCDE2?role=player&pid=player-0001`, "https://evil.example"), 403);
  assert.equal(await upgradeStatus(`/room/ABCDE2?role=player&pid=player-0001`, null), 403);
  assert.equal(await upgradeStatus(`/room/ABCDE2?role=player&pid=player-0001`, "https://apps.lessonshuffle.com.evil.com"), 403);
  assert.equal(await upgradeStatus(`/room/ABCDE2?role=player&pid=player-0001`, "https://x.lesson-shuffle-apps.pages.dev"), 101);
  assert.equal(await upgradeStatus(`/room/abcde2?role=player&pid=player-0001`, "https://apps.lessonshuffle.com"), 101);
});

test("player before host gets no-room", async () => {
  const p = connect(code(0), "role=player&pid=player-0001");
  assert.deepEqual(await p.next(), { t: "error", code: "no-room" });
  assert.equal((await p.close()).code, 4004);
});

test("full protocol", async () => {
  const C = code(1);
  const host = connect(C, `role=host&key=${KEY}`);
  assert.deepEqual(await host.next(), { t: "hello", role: "host", players: [] });

  const a = connect(C, "role=player&pid=player-aaaa");
  assert.deepEqual(await a.next(), { t: "hello", role: "player", host: true });
  assert.deepEqual(await host.next(), { t: "join", pid: "player-aaaa" });
  const b = connect(C, "role=player&pid=player-bbbb");
  assert.deepEqual(await b.next(), { t: "hello", role: "player", host: true });
  assert.deepEqual(await host.next(), { t: "join", pid: "player-bbbb" });

  // player -> host
  await a.open;
  a.ws.send(JSON.stringify({ hi: 1 }));
  assert.deepEqual(await host.next(), { t: "from", pid: "player-aaaa", m: { hi: 1 } });
  a.ws.send("not json");
  a.ws.send("[1,2]");
  await host.none();

  // host -> one, "*", array
  host.ws.send(JSON.stringify({ to: "player-aaaa", m: { x: 1 } }));
  assert.deepEqual(await a.next(), { x: 1 });
  await b.none();
  host.ws.send(JSON.stringify({ to: "*", m: { all: true } }));
  assert.deepEqual(await a.next(), { all: true });
  assert.deepEqual(await b.next(), { all: true });
  host.ws.send(JSON.stringify({ to: ["player-bbbb", "player-zzzz"], m: { arr: 1 } }));
  assert.deepEqual(await b.next(), { arr: 1 });
  await a.none();

  // second host with wrong key
  const bad = connect(C, "role=host&key=wrongkey-12345");
  assert.deepEqual(await bad.next(), { t: "error", code: "taken" });
  assert.equal((await bad.close()).code, 4003);

  // host reconnect with same key replaces old
  const host2 = connect(C, `role=host&key=${KEY}`);
  const hello = await host2.next();
  assert.equal(hello.t, "hello");
  assert.deepEqual([...hello.players].sort(), ["player-aaaa", "player-bbbb"]);
  assert.deepEqual(await a.next(), { t: "host", up: true });
  assert.deepEqual(await b.next(), { t: "host", up: true });
  const closedOld = await host.close();
  assert.equal(closedOld.code, 4000);
  // the replaced socket must not have told players the host went down
  await a.none();

  // player leave notifies host
  b.ws.close(1000);
  assert.deepEqual(await host2.next(), { t: "leave", pid: "player-bbbb" });

  // host drop notifies players
  host2.ws.close(1000);
  assert.deepEqual(await a.next(), { t: "host", up: false });

  // host comes back, then closes the room
  const host3 = connect(C, `role=host&key=${KEY}`);
  assert.equal((await host3.next()).t, "hello");
  assert.deepEqual(await a.next(), { t: "host", up: true });
  host3.ws.send(JSON.stringify({ t: "close-room" }));
  assert.deepEqual(await a.next(), { t: "closed" });
  assert.equal((await a.close()).code, 1000);
  assert.equal((await host3.close()).code, 1000);

  const late = connect(C, "role=player&pid=player-cccc");
  assert.deepEqual(await late.next(), { t: "error", code: "no-room" });
  assert.equal((await late.close()).code, 4004);
});

test("oversize player message closes 1009", async () => {
  const C = code(2);
  const host = connect(C, `role=host&key=${KEY}`);
  await host.next();
  const p = connect(C, "role=player&pid=player-dddd");
  await p.next();
  await host.next();
  p.ws.send("x".repeat(3000));
  assert.equal((await p.close()).code, 1009);
  assert.deepEqual(await host.next(), { t: "leave", pid: "player-dddd" });
  host.ws.close(1000);
});

test("rate limit closes 4008", async () => {
  const C = code(3);
  const host = connect(C, `role=host&key=${KEY}`);
  await host.next();
  const p = connect(C, "role=player&pid=player-eeee");
  await p.next();
  for (let i = 0; i < 45; i++) p.ws.send("{}");
  assert.equal((await p.close()).code, 4008);
  host.ws.close(1000);
});
