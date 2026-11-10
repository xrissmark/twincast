// Server test: rooms, join/leave, relay, sharing broadcast, isolation, resume, health, dashboard API.
const assert = require('assert');
const WebSocket = require('ws');
const { startServer } = require('../server/server.js');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  return {
    ws,
    open: () => new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    next: (type) => {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error('timeout waiting for ' + type)), 2000);
      });
    },
    inbox,
  };
}

(async () => {
  const srv = await startServer({ port: 0, log: () => {}, adminPassword: 'test-pw' });
  const a = client(srv.port), b = client(srv.port), c = client(srv.port);
  await Promise.all([a.open(), b.open(), c.open()]);

  a.send({ type: 'join', room: 'Game-Night', name: 'Alice', client: 'app' });
  const wa = await a.next('welcome');
  assert.strictEqual(wa.room, 'game-night');
  assert.deepStrictEqual(wa.peers, []);
  assert.ok(wa.iceServers.length > 0);

  a.send({ type: 'sharing', sharing: true, label: 'Firefox' });
  b.send({ type: 'join', room: 'game-night', name: 'Bob', client: 'mobile' });
  const wb = await b.next('welcome');
  assert.strictEqual(wb.peers.length, 1);
  assert.strictEqual(wb.peers[0].name, 'Alice');
  assert.strictEqual(wb.peers[0].client, 'app', 'peers include their device type');
  assert.deepStrictEqual(wb.peers[0].sharing, { label: 'Firefox', app: 'desktop' }, 'late joiner sees who is sharing');
  const joined = await a.next('peer-joined');
  assert.strictEqual(joined.id, wb.id);
  assert.strictEqual(joined.client, 'mobile', 'joiners announce their device type');

  c.send({ type: 'join', room: 'other-room', name: 'Carol' });
  const wc = await c.next('welcome');
  assert.deepStrictEqual(wc.peers, [], 'rooms are isolated');

  b.send({ type: 'signal', to: wa.id, data: { hello: 1 } });
  const sig = await a.next('signal');
  assert.strictEqual(sig.from, wb.id);
  assert.deepStrictEqual(sig.data, { hello: 1 });

  c.send({ type: 'signal', to: wa.id, data: { evil: 1 } }); // cross-room relay must be dropped

  b.send({ type: 'sharing', sharing: true, label: 'Game' });
  const sh = await a.next('peer-sharing');
  assert.strictEqual(sh.id, wb.id);

  b.send({ type: 'chat', text: 'hi' });
  const chat = await a.next('chat');
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!b.inbox.some((m) => m.type === 'chat'), 'the sender does not get its own chat message back (no duplicate)');
  assert.strictEqual(chat.name, 'Bob');

  b.send({ type: 'leave' });
  const left = await a.next('peer-left');
  assert.strictEqual(left.id, wb.id);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!a.inbox.some((m) => m.type === 'signal'), 'no cross-room signal leaked');

  // Resume: a dropped connection that comes back with the same session keeps its id,
  // and the others see no leave/join (no ghost duplicates).
  const d1 = client(srv.port); await d1.open();
  d1.send({ type: 'join', room: 'game-night', name: 'Dan', session: 'sess-dan' });
  const wd1 = await d1.next('welcome');
  await a.next('peer-joined');
  d1.ws.terminate(); // abrupt drop
  await new Promise((r) => setTimeout(r, 300));
  const d2 = client(srv.port); await d2.open();
  d2.send({ type: 'join', room: 'game-night', name: 'Dan', session: 'sess-dan' });
  const wd2 = await d2.next('welcome');
  assert.strictEqual(wd2.id, wd1.id, 'resumed with the same id');
  assert.strictEqual(wd2.resumed, true);
  assert.strictEqual(wd2.peers.length, 1, 'only Alice listed, not a ghost of Dan');
  d2.send({ type: 'signal', to: wa.id, data: { after: 'resume' } });
  assert.deepStrictEqual((await a.next('signal')).data, { after: 'resume' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!a.inbox.some((m) => m.type === 'peer-left' || m.type === 'peer-joined'), 'no leave/join noise on resume');

  // Annotations: Alice shares, Dan (viewer) draws; permissions, late joiners, cleanup.
  a.send({ type: 'sharing', sharing: false });
  await new Promise((r) => setTimeout(r, 100));
  a.inbox.length = 0; d2.inbox.length = 0;
  a.send({ type: 'sharing', sharing: true, label: 'Firefox' });
  const st0 = await d2.next('ann');
  assert.deepStrictEqual([st0.op, st0.target, st0.enabled, st0.shapes.length], ['state', wa.id, true, 0], 'board announced on share');
  await a.next('ann'); // the sharer gets the state too
  const pen = { id: `${wd2.id}:1`, kind: 'pen', color: '#ff3b30', size: 6, points: [[0.1, 0.1], [0.5, 0.5]] };
  d2.send({ type: 'ann', op: 'add', target: wa.id, shape: pen });
  const added = await a.next('ann');
  assert.strictEqual(added.op, 'add');
  assert.strictEqual(added.shape.author, wd2.id, 'server stamps the author');
  assert.strictEqual(added.shape.name, 'Dan');
  d2.send({ type: 'ann', op: 'add', target: wa.id, shape: { ...pen, id: `${wa.id}:fake` } }); // forged id
  d2.send({ type: 'ann', op: 'draft', target: wa.id, id: `${wd2.id}:2`, kind: 'glow', color: '#ffd60a', size: 6, from: 0, points: [[0.2, 0.2]] });
  const dr = await a.next('ann');
  assert.deepStrictEqual([dr.op, dr.draft.kind, dr.draft.name], ['draft', 'glow', 'Dan'], 'forged id dropped, draft relayed');
  // Late joiner gets current marks.
  const e = client(srv.port); await e.open();
  e.send({ type: 'join', room: 'game-night', name: 'Eve' });
  await e.next('welcome');
  const late = await e.next('ann');
  assert.deepStrictEqual(late.shapes.map((s) => s.id), [pen.id], 'late joiner sees existing marks');
  // A viewer can't remove someone else's mark; the sharer can turn drawing off.
  e.send({ type: 'ann', op: 'remove', target: wa.id, ids: [pen.id] });
  a.send({ type: 'ann', op: 'enabled', target: wa.id, enabled: false });
  assert.deepStrictEqual([(await d2.next('ann')).op], ['enabled']);
  d2.send({ type: 'ann', op: 'add', target: wa.id, shape: { ...pen, id: `${wd2.id}:3` } }); // refused: off
  e.send({ type: 'ann', op: 'enabled', target: wa.id, enabled: true }); // refused: not the sharer
  // Sharer clears all; then stops sharing -> reset.
  a.send({ type: 'ann', op: 'clear', target: wa.id, scope: 'all' });
  const cleared = await d2.next('ann');
  assert.deepStrictEqual([cleared.op, cleared.ids], ['remove', [pen.id]], 'only the real mark existed (no forged/refused ones)');
  a.send({ type: 'sharing', sharing: false });
  assert.strictEqual((await d2.next('ann')).op, 'reset', 'marks wiped when sharing stops');
  e.send({ type: 'leave' });
  await new Promise((r) => setTimeout(r, 100));

  // Health check (public, CORS) and dashboard stats (password protected).
  const base = `http://localhost:${srv.port}`;
  const health = await fetch(base + '/api/health');
  assert.strictEqual(health.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual((await health.json()).app, 'twincast');
  assert.strictEqual((await fetch(base + '/api/admin/stats')).status, 401, 'stats need the password');
  assert.strictEqual((await fetch(base + '/api/admin/stats', { headers: { Authorization: 'Bearer nope' } })).status, 401);
  const st = await (await fetch(base + '/api/admin/stats', { headers: { Authorization: 'Bearer test-pw' } })).json();
  const gn = st.rooms.find((r) => r.name === 'game-night');
  assert.deepStrictEqual(gn.users.map((u) => u.name).sort(), ['Alice', 'Dan']);
  assert.strictEqual(gn.users.find((u) => u.name === 'Dan').reconnects, 1);
  assert.strictEqual(st.now.rooms, 2);
  assert.strictEqual(st.totals.peakUsers >= 3, true);
  assert.ok(st.events.some((e) => e.text === 'Bob left (left)'));
  assert.strictEqual((await fetch(base + '/admin/')).status, 200, 'dashboard page served');
  assert.strictEqual((await fetch(base + '/')).status, 200, 'web client served');

  a.ws.close(); c.ws.close(); d2.ws.close(); srv.close();
  console.log('server tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
