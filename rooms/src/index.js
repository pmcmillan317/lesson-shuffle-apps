// Lesson Shuffle Rooms: a tiny WebSocket relay for classroom games.
// Privacy rules (NY Ed Law 2-d): store no student data, log nothing about
// messages, keep live state only in memory and socket attachments. The only
// thing ever written to storage is the teacher's random host key and a
// created timestamp, and both are deleted when the room ends.
import { DurableObject } from "cloudflare:workers";

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PAGES_RE = /^https:\/\/[a-z0-9-]+\.lesson-shuffle-apps\.pages\.dev$/i;
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

const MAX_PLAYERS = 80;
const PLAYER_MAX_BYTES = 2048;
const HOST_MAX_BYTES = 32768;
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 10_000;
const ROOM_MAX_MS = 4 * 60 * 60 * 1000;
const EMPTY_GRACE_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

function originAllowed(origin) {
  if (!origin) return false;
  return (
    origin === "https://apps.lessonshuffle.com" ||
    PAGES_RE.test(origin) ||
    LOCAL_RE.test(origin)
  );
}

function text(body, status) {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return text("not found", 404);
    const url = new URL(request.url);

    if (url.pathname === "/health") return text("ok", 200);

    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return text("not found", 404);
    }

    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code)) return text("bad room code", 400);

    if (!originAllowed(request.headers.get("Origin"))) return text("forbidden", 403);

    const role = url.searchParams.get("role");
    if (role === "host") {
      if (!ID_RE.test(url.searchParams.get("key") || "")) return text("bad key", 400);
    } else if (role === "player") {
      if (!ID_RE.test(url.searchParams.get("pid") || "")) return text("bad pid", 400);
    } else {
      return text("bad role", 400);
    }

    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime without waking this object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // In-memory only. Losing this on hibernation is fine.
    this.rate = new Map();
  }

  // ---- helpers ----
  hostSockets() {
    return this.ctx.getWebSockets("host").filter((s) => s.readyState === WebSocket.OPEN);
  }
  playerSockets() {
    return this.ctx
      .getWebSockets()
      .filter((s) => s.readyState === WebSocket.OPEN && this.pidOf(s));
  }
  pidOf(ws) {
    try {
      return ws.deserializeAttachment()?.pid || null;
    } catch {
      return null;
    }
  }
  send(ws, obj) {
    try {
      ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
    } catch {}
  }
  closeSock(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {}
  }
  sendHost(obj) {
    for (const h of this.hostSockets()) this.send(h, obj);
  }
  openCount(except) {
    return this.ctx.getWebSockets().filter((s) => s !== except && s.readyState === WebSocket.OPEN)
      .length;
  }
  // Accept a socket just to tell it why it is being turned away.
  reject(code, errCode, reason) {
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    this.send(server, { t: "error", code: errCode });
    this.closeSock(server, code, reason);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- connect ----
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    return role === "host"
      ? this.connectHost(url.searchParams.get("key"))
      : this.connectPlayer(url.searchParams.get("pid"));
  }

  async connectHost(key) {
    const stored = await this.ctx.storage.get("hostKey");
    if (stored && stored !== key) return this.reject(4003, "taken", "taken");

    const olds = this.hostSockets();

    if (!stored) {
      await this.ctx.storage.put({ hostKey: key, created: Date.now() });
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["host"]);
    for (const old of olds) this.closeSock(old, 4000, "replaced");
    const players = this.playerSockets().map((s) => this.pidOf(s));
    this.send(pair[1], { t: "hello", role: "host", players });
    for (const p of this.playerSockets()) this.send(p, { t: "host", up: true });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_MAX_MS);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async connectPlayer(pid) {
    const stored = await this.ctx.storage.get("hostKey");
    if (!stored) return this.reject(4004, "no-room", "no room");

    const players = this.playerSockets();
    const same = players.filter((s) => this.pidOf(s) === pid);
    if (players.length - same.length >= MAX_PLAYERS) return this.reject(4005, "full", "full");

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["p:" + pid]);
    pair[1].serializeAttachment({ pid });
    for (const old of same) this.closeSock(old, 4000, "replaced");
    this.send(pair[1], { t: "hello", role: "player", host: this.hostSockets().length > 0 });
    this.sendHost({ t: "join", pid });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- messages ----
  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    const isHost = this.ctx.getTags(ws).includes("host");
    if (isHost) return this.onHost(message);
    return this.onPlayer(ws, message);
  }

  onPlayer(ws, message) {
    const pid = this.pidOf(ws);
    if (!pid) return;
    if (enc.encode(message).length > PLAYER_MAX_BYTES) {
      this.closeSock(ws, 1009, "too big");
      return;
    }
    const now = Date.now();
    const stamps = (this.rate.get(pid) || []).filter((t) => now - t < RATE_WINDOW_MS);
    stamps.push(now);
    this.rate.set(pid, stamps);
    if (stamps.length > RATE_LIMIT) {
      this.closeSock(ws, 4008, "slow down");
      return;
    }
    const m = parseObject(message);
    if (!m) return;
    this.sendHost({ t: "from", pid, m });
  }

  async onHost(message) {
    if (enc.encode(message).length > HOST_MAX_BYTES) return;
    const msg = parseObject(message);
    if (!msg) return;

    if (msg.t === "close-room") {
      await this.endRoom();
      return;
    }
    if (!msg.m || typeof msg.m !== "object" || Array.isArray(msg.m)) return;
    const to = msg.to;
    let want;
    if (to === "*") want = null;
    else if (typeof to === "string") want = new Set([to]);
    else if (Array.isArray(to)) want = new Set(to.filter((x) => typeof x === "string"));
    else return;

    const payload = JSON.stringify(msg.m);
    for (const p of this.playerSockets()) {
      if (want === null || want.has(this.pidOf(p))) this.send(p, payload);
    }
  }

  async endRoom() {
    for (const s of this.ctx.getWebSockets()) {
      if (this.pidOf(s)) this.send(s, { t: "closed" });
    }
    // Wipe storage first so late close events see an ended room.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const s of this.ctx.getWebSockets()) this.closeSock(s, 1000, "closed");
    this.rate.clear();
  }

  // ---- closing ----
  async webSocketClose(ws) {
    await this.afterClose(ws);
  }
  async webSocketError(ws) {
    await this.afterClose(ws);
  }

  async afterClose(ws) {
    this.closeSock(ws, 1000, "bye");
    const key = await this.ctx.storage.get("hostKey");
    if (!key) return; // room already ended

    if (this.ctx.getTags(ws).includes("host")) {
      if (this.hostSockets().filter((s) => s !== ws).length === 0) {
        for (const p of this.playerSockets()) this.send(p, { t: "host", up: false });
      }
    } else {
      const pid = this.pidOf(ws);
      if (pid) {
        const stillThere = this.playerSockets().some((s) => s !== ws && this.pidOf(s) === pid);
        if (!stillThere) {
          this.rate.delete(pid);
          this.sendHost({ t: "leave", pid });
        }
      }
    }
    if (this.openCount(ws) === 0) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_GRACE_MS);
    }
  }

  async alarm() {
    for (const s of this.ctx.getWebSockets()) {
      if (this.pidOf(s)) this.send(s, { t: "closed" });
    }
    for (const s of this.ctx.getWebSockets()) this.closeSock(s, 1000, "closed");
    this.rate.clear();
    await this.ctx.storage.deleteAll();
  }
}

function parseObject(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
