// TwinCast server: room/signaling server + web client + admin dashboard.
//   node server.js                 (PORT=8080 by default)
//
// Media never goes through this server: people connect peer-to-peer (WebRTC).
// The server only introduces people in the same room and relays connection offers,
// so it needs very little CPU, memory or bandwidth.
//
//   /             web client (browser users join rooms here)
//   /ws           signaling WebSocket
//   /api/health   public "is the server up?" check, used by the desktop app's "Test connection"
//   /admin        dashboard (password protected)
//
// Settings (environment variables):
//   PORT=8080
//   HOST=::                      listen address (default: IPv6 + IPv4)
//   ADMIN_PASSWORD=...           dashboard password. If unset, one is generated and
//                                saved in admin-password.txt next to this file.
//   WEB_DIR=...                  where the web client files are (default ./public or ../public)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const VERSION = require('./package.json').version;
// Web client: ./public in a built server package, ../public in the source tree.
const WEB_DIR = path.resolve(process.env.WEB_DIR
  || [path.join(__dirname, 'public'), path.join(__dirname, '..', 'public')].find((d) => fs.existsSync(path.join(d, 'index.html')))
  || path.join(__dirname, 'public'));
const DASH_DIR = path.join(__dirname, 'dashboard');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

// STUN only tells each PC its own public address so peers can connect directly.
// No media ever passes through it (no TURN relay is used). These answer over IPv6 too.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// A dropped connection keeps its place for this long, so a quick reconnect resumes
// as the same person (no ghost duplicates, and the peer-to-peer video keeps running).
const RESUME_GRACE_MS = 20000;

function loadAdminPassword(log) {
  if (process.env.ADMIN_PASSWORD) return { password: process.env.ADMIN_PASSWORD, source: 'ADMIN_PASSWORD' };
  const file = path.join(__dirname, 'admin-password.txt');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved) return { password: saved, source: file };
  } catch {}
  const password = crypto.randomBytes(9).toString('base64url');
  try { fs.writeFileSync(file, password + '\n', { mode: 0o600 }); }
  catch (e) { log(`Could not save ${file} (${e.message}); the password below is only valid until restart.`); }
  return { password, source: file, generated: true };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function clientIp(req) {
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  // Behind a reverse proxy on the same machine (Caddy, nginx): trust its header.
  if ((remote === '127.0.0.1' || remote === '::1') && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return remote;
}

function startServer({ port = Number(process.env.PORT) || 8080, host = process.env.HOST, log = console.log, adminPassword } = {}) {
  const admin = adminPassword ? { password: adminPassword, source: 'option' } : loadAdminPassword(log);
  const rooms = new Map(); // roomName -> { createdAt, clients: Map(id -> client) }

  // ---------------------------------------------------------------- statistics
  const stats = {
    startedAt: Date.now(),
    totalConnections: 0, totalJoins: 0, signals: 0, chats: 0, annotations: 0,
    bytesIn: 0, bytesOut: 0,
    peakUsers: 0, peakAt: Date.now(),
    roomsCreated: 0,
  };
  const events = []; // recent activity, newest last
  function event(room, text) {
    events.push({ at: Date.now(), room, text });
    if (events.length > 200) events.splice(0, events.length - 200);
  }
  let cpuPercent = 0;
  let lastCpu = process.cpuUsage(), lastCpuAt = process.hrtime.bigint();
  const cpuTimer = setInterval(() => {
    const now = process.hrtime.bigint(), used = process.cpuUsage(lastCpu);
    cpuPercent = ((used.user + used.system) / 1000) / (Number(now - lastCpuAt) / 1e6) * 100;
    lastCpu = process.cpuUsage(); lastCpuAt = now;
  }, 2000);
  cpuTimer.unref();

  const usersOnline = () => { let n = 0; for (const r of rooms.values()) n += r.clients.size; return n; };
  function notePeak() {
    const n = usersOnline();
    if (n > stats.peakUsers) { stats.peakUsers = n; stats.peakAt = Date.now(); }
  }

  function snapshot() {
    const mem = process.memoryUsage();
    const list = [...rooms.entries()].map(([name, r]) => ({
      name, createdAt: r.createdAt,
      users: [...r.clients.values()].map((c) => ({
        id: c.id, name: c.name, ip: c.ip, joinedAt: c.joinedAt, online: !c.leaveTimer,
        sharing: c.sharing ? c.sharing.label || 'screen' : null, reconnects: c.reconnects, client: c.client,
      })),
    })).sort((a, b) => b.users.length - a.users.length || a.name.localeCompare(b.name));
    return {
      server: {
        version: VERSION, node: process.version, platform: `${process.platform} ${process.arch}`,
        startedAt: stats.startedAt, now: Date.now(), port: actualPort,
        memoryMB: +(mem.rss / 1048576).toFixed(1), heapMB: +(mem.heapUsed / 1048576).toFixed(1),
        cpuPercent: +cpuPercent.toFixed(1),
      },
      now: {
        rooms: rooms.size, users: usersOnline(), sharing: list.reduce((n, r) => n + r.users.filter((u) => u.sharing).length, 0),
        sockets: wss.clients.size,
      },
      totals: { ...stats },
      rooms: list,
      events: events.slice(-100).reverse(),
    };
  }

  // ---------------------------------------------------------------- HTTP
  const failedLogins = new Map(); // ip -> { count, until }
  function checkAdmin(req) {
    const ip = clientIp(req);
    const f = failedLogins.get(ip);
    if (f && f.until > Date.now()) return 'locked';
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m && safeEqual(m[1], admin.password)) { failedLogins.delete(ip); return 'ok'; }
    const n = (f && f.until > Date.now() - 60000 ? f.count : 0) + 1;
    // 5 wrong passwords -> locked out for a minute.
    failedLogins.set(ip, { count: n, until: n >= 5 ? Date.now() + 60000 : 0 });
    if (failedLogins.size > 1000) failedLogins.clear();
    return 'denied';
  }

  function json(res, code, body, extra = {}) {
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  }

  function serveFile(res, root, urlPath) {
    const file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400); return res.end(); }

    if (urlPath === '/api/health') {
      // Public and harmless: lets the desktop app check the address before joining.
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      return json(res, 200, { ok: true, app: 'twincast', version: VERSION }, cors);
    }
    if (urlPath === '/api/admin/stats') {
      const auth = checkAdmin(req);
      if (auth === 'locked') return json(res, 429, { error: 'Too many wrong passwords. Wait a minute.' });
      if (auth !== 'ok') return json(res, 401, { error: 'Wrong password' });
      return json(res, 200, snapshot());
    }
    if (urlPath === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
    if (urlPath.startsWith('/admin/')) {
      const sub = urlPath.slice('/admin'.length);
      return serveFile(res, DASH_DIR, sub === '/' ? '/index.html' : sub);
    }
    return serveFile(res, WEB_DIR, urlPath === '/' ? '/index.html' : urlPath);
  });

  // ---------------------------------------------------------------- signaling
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
  // ws re-emits the HTTP server's errors (e.g. EADDRINUSE). They are handled by the
  // listen() promise below; without this listener they would crash the process.
  wss.on('error', () => {});

  const send = (ws, msg) => {
    if (ws.readyState !== 1) return;
    const data = JSON.stringify(msg);
    stats.bytesOut += data.length;
    ws.send(data);
  };
  const broadcast = (room, msg, exceptId) => {
    for (const [id, c] of room.clients) if (id !== exceptId) send(c.ws, msg);
  };

  // ---------------------------------------------------------------- annotations
  // Marks drawn on a shared screen. One board per person sharing, kept here so late
  // joiners and the sharer's on-screen overlay get the current marks. Coordinates are
  // fractions (0..1) of the shared picture. Wiped when that person stops sharing.
  const ANN = { maxShapes: 3000, maxPoints: 4000, maxText: 200 };
  const STAMPS = new Set(['check', 'cross', 'star', 'heart', 'arrow', 'question']);
  const num = (v) => (Number.isFinite(+v) ? Math.max(-0.2, Math.min(1.2, +v)) : 0);
  const color = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : '#ff3b30');
  const size = (v) => (Number.isFinite(+v) ? Math.max(1, Math.min(40, +v)) : 6);
  const points = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])
    .filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [+num(p[0]).toFixed(4), +num(p[1]).toFixed(4)]);

  function cleanShape(raw, me, isSharer) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').slice(0, 48);
    // Only the sharer may put back someone else's mark (undoing "Clear all").
    const own = !isSharer || !raw.author || raw.author === me.id;
    if (!id || (own && !id.startsWith(me.id + ':'))) return null;
    const s = { id, author: own ? me.id : String(raw.author).slice(0, 24), name: own ? me.name : String(raw.name || '').slice(0, 32),
      kind: raw.kind, color: color(raw.color), size: size(raw.size) };
    if (s.kind === 'pen') { s.points = points(raw.points, ANN.maxPoints); if (!s.points.length) return null; }
    else if (s.kind === 'stamp') { if (!STAMPS.has(raw.stamp)) return null; s.stamp = raw.stamp; s.x = num(raw.x); s.y = num(raw.y); }
    else if (s.kind === 'text') { s.text = String(raw.text || '').slice(0, ANN.maxText); if (!s.text.trim()) return null; s.x = num(raw.x); s.y = num(raw.y); }
    else return null;
    return s;
  }

  function annState(room, target) {
    const b = room.boards.get(target);
    return { type: 'ann', op: 'state', target, enabled: b.enabled, shapes: [...b.shapes.values()] };
  }

  function onAnnotation(room, me, msg) {
    const target = String(msg.target || '');
    const board = room.boards.get(target);
    if (!board) return;
    const isSharer = me.id === target;
    const relay = (m) => broadcast(room, { type: 'ann', target, ...m }, me.id);
    switch (msg.op) {
      case 'add': {
        if (!board.enabled && !isSharer) return;
        const s = cleanShape(msg.shape, me, isSharer);
        if (!s || (board.shapes.size >= ANN.maxShapes && !board.shapes.has(s.id))) return;
        board.shapes.set(s.id, s);
        stats.annotations++;
        relay({ op: 'add', shape: s });
        break;
      }
      case 'draft': { // a stroke being drawn right now, or a spotlight (never stored)
        if (!board.enabled && !isSharer) return;
        const id = String(msg.id || '').slice(0, 48);
        if (!id.startsWith(me.id + ':') || !['pen', 'glow'].includes(msg.kind)) return;
        relay({ op: 'draft', draft: { id, kind: msg.kind, color: color(msg.color), size: size(msg.size), author: me.id, name: me.name,
          from: Math.max(0, Math.floor(+msg.from) || 0), points: points(msg.points, 500), done: !!msg.done } });
        break;
      }
      case 'remove': {
        const ids = (Array.isArray(msg.ids) ? msg.ids : []).slice(0, ANN.maxShapes).map(String)
          .filter((id) => { const s = board.shapes.get(id); return s && (isSharer || s.author === me.id); });
        ids.forEach((id) => board.shapes.delete(id));
        if (ids.length) relay({ op: 'remove', ids });
        break;
      }
      case 'clear': { // "mine" for anyone, "all" for the sharer
        const ids = [...board.shapes.values()].filter((s) => (msg.scope === 'all' && isSharer) || s.author === me.id).map((s) => s.id);
        ids.forEach((id) => board.shapes.delete(id));
        if (ids.length) relay({ op: 'remove', ids });
        break;
      }
      case 'enabled': {
        if (!isSharer) return;
        board.enabled = !!msg.enabled;
        relay({ op: 'enabled', enabled: board.enabled });
        break;
      }
    }
  }

  function endBoard(room, id) {
    if (room.boards.delete(id)) broadcast(room, { type: 'ann', op: 'reset', target: id });
  }

  function removeClient(c, reason) {
    const room = c.room && rooms.get(c.room);
    if (!room || room.clients.get(c.id) !== c) return;
    clearTimeout(c.leaveTimer);
    room.clients.delete(c.id);
    endBoard(room, c.id);
    broadcast(room, { type: 'peer-left', id: c.id });
    log(`[${c.room}] ${c.name} left (${reason}, ${room.clients.size} in room)`);
    event(c.room, `${c.name} left (${reason})`);
    if (room.clients.size === 0) { rooms.delete(c.room); event(c.room, 'room closed (empty)'); }
  }

  wss.on('connection', (ws, req) => {
    stats.totalConnections++;
    let me = {
      id: crypto.randomBytes(6).toString('hex'), session: null, name: 'Guest', room: null, sharing: null, ws,
      ip: clientIp(req), joinedAt: null, reconnects: 0, leaveTimer: null,
    };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      ws.isAlive = true;
      stats.bytesIn += raw.length;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'join' && !me.room) {
        const roomName = String(msg.room || '').trim().toLowerCase().slice(0, 64);
        if (!roomName) return send(ws, { type: 'error', message: 'Room name required' });
        if (!rooms.has(roomName)) {
          rooms.set(roomName, { createdAt: Date.now(), clients: new Map(), boards: new Map() });
          stats.roomsCreated++;
          event(roomName, 'room created');
        }
        const room = rooms.get(roomName);
        const session = typeof msg.session === 'string' ? msg.session.slice(0, 64) : null;
        const old = session && [...room.clients.values()].find((c) => c.session === session);
        const peers = () => [...room.clients.values()].filter((c) => c !== me).map((c) => ({ id: c.id, name: c.name, client: c.client, sharing: c.sharing }));

        if (old) {
          // Resume: take over the old entry, silently drop its stale socket.
          clearTimeout(old.leaveTimer); old.leaveTimer = null;
          const stale = old.ws;
          old.ws = ws; old.ip = me.ip; old.reconnects++;
          me = old;
          if (stale !== ws && stale.readyState <= 1) stale.terminate();
          send(ws, { type: 'welcome', id: me.id, room: roomName, iceServers: ICE_SERVERS, resumed: true, peers: peers() });
          for (const target of room.boards.keys()) send(ws, annState(room, target));
          log(`[${roomName}] ${me.name} reconnected`);
          event(roomName, `${me.name} reconnected`);
          return;
        }
        me.session = session;
        me.name = String(msg.name || 'Guest').trim().slice(0, 32) || 'Guest';
        // What they're using: 'app' (Windows app), 'browser' (PC browser) or 'mobile'.
        me.client = ['app', 'browser', 'mobile'].includes(msg.client) ? msg.client : null;
        me.room = roomName;
        me.joinedAt = Date.now();
        send(ws, { type: 'welcome', id: me.id, room: roomName, iceServers: ICE_SERVERS, peers: peers() });
        for (const target of room.boards.keys()) send(ws, annState(room, target));
        room.clients.set(me.id, me);
        broadcast(room, { type: 'peer-joined', id: me.id, name: me.name, client: me.client }, me.id);
        stats.totalJoins++;
        notePeak();
        log(`[${roomName}] ${me.name} joined (${room.clients.size} in room)`);
        event(roomName, `${me.name} joined`);
        return;
      }
      if (msg.type === 'ping') return send(ws, { type: 'pong' });
      if (me.ws !== ws) return; // this socket was replaced by a newer one

      const room = me.room && rooms.get(me.room);
      if (!room) return;

      switch (msg.type) {
        case 'signal': {
          const target = room.clients.get(msg.to);
          if (target) { stats.signals++; send(target.ws, { type: 'signal', from: me.id, data: msg.data }); }
          break;
        }
        case 'sharing': {
          const was = !!me.sharing;
          // app: 'desktop' or 'browser' (browser sharers can't show marks on their screen)
          me.sharing = msg.sharing ? { label: String(msg.label || '').slice(0, 80), app: msg.app === 'browser' ? 'browser' : 'desktop' } : null;
          broadcast(room, { type: 'peer-sharing', id: me.id, sharing: me.sharing }, me.id);
          if (was !== !!me.sharing) event(me.room, me.sharing ? `${me.name} started sharing` : `${me.name} stopped sharing`);
          if (!me.sharing) endBoard(room, me.id);
          else if (!room.boards.has(me.id)) {
            // Annotations start allowed, unless the sharer said otherwise (browser sharers can't see them).
            room.boards.set(me.id, { enabled: msg.annotations !== false, shapes: new Map() });
            broadcast(room, annState(room, me.id));
          }
          break;
        }
        case 'ann': onAnnotation(room, me, msg); break;
        case 'chat': {
          const text = String(msg.text || '').slice(0, 500);
          if (text) { stats.chats++; broadcast(room, { type: 'chat', id: me.id, name: me.name, text, at: Date.now() }, me.id); } // not back to the sender (it shows its own message already)
          break;
        }
        case 'leave': removeClient(me, 'left'); ws.close(); break;
      }
    });

    ws.on('close', () => {
      if (me.ws !== ws || !me.room) return; // replaced by a reconnect, or never joined
      const c = me;
      clearTimeout(c.leaveTimer);
      c.leaveTimer = setTimeout(() => removeClient(c, 'connection lost'), RESUME_GRACE_MS);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => { clearInterval(heartbeat); clearInterval(cpuTimer); });

  // ---------------------------------------------------------------- listen
  // '::' = IPv6 and IPv4 together (falls back to IPv4-only if IPv6 is off).
  let actualPort = port;
  const listen = (h) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, h, () => { server.removeListener('error', reject); resolve(); });
  });
  return (host ? listen(host) : listen('::').catch((e) => {
    if (e.code === 'EADDRINUSE') throw e;
    return listen('0.0.0.0');
  })).catch((e) => { wss.close(); throw e; }).then(() => {
    actualPort = server.address().port;
    log(`TwinCast server ${VERSION} running on http://localhost:${actualPort}`);
    log(`Dashboard: http://localhost:${actualPort}/admin/`);
    if (admin.generated) log(`Dashboard password: ${admin.password}  (saved in ${admin.source})`);
    else if (!adminPassword) log(`Dashboard password from ${admin.source}`);
    return { server, wss, port: actualPort, snapshot, close: () => { wss.close(); server.close(); } };
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer().catch((e) => { console.error(e.message); process.exit(1); });
}
