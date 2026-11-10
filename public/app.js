/* TwinCast web client.
 * Works in any modern browser (watch + share) and inside the desktop app, which adds
 * per-application audio capture through window.desktop (see electron/preload.js). */
'use strict';

const $ = (id) => document.getElementById(id);
const native = window.desktop || null; // present only in the desktop app

// What this person is using: the Windows app, a browser on a PC, or a phone/tablet.
const IS_TOUCH_DEVICE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) // iPadOS
  || !matchMedia('(any-pointer: fine)').matches;
const CLIENT_TYPE = native ? 'app' : IS_TOUCH_DEVICE ? 'mobile' : 'browser';
// Line icons (drawn inline: no icon font to download, works offline in the app).
const ICON_PATHS = {
  app: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  browser: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  unknown: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  share: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M12 13V7M9 10l3-3 3 3"/>',
  change: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  watcher: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m10 7 5 3-5 3z"/>',
  eyeOff: '<path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  broom: '<path d="M10 2.5h4v6.5h-4z"/><path d="M5 12a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1H5z"/><path d="M5 13l-1 8h16l-1-8"/><path d="M9 17v4M12 16v5M15 17v4"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  stamp: '<path d="M5 22h14"/><path d="M19.3 13.7A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.7-.3-1.3-.7-1.8z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  join: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  test: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
};
const svgIcon = (name) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
const CLIENT_INFO = {
  app: { label: tr('client.app') },
  browser: { label: tr('client.browser') },
  mobile: { label: tr('client.mobile') },
};

const AUDIO_BITRATE = 160_000;
// WebRTC normally starts around 0.3 Mbps and ramps up slowly (blurry first seconds/minutes).
// These Chrome hints start it high and stop it from falling to "potato" levels.
const VIDEO_KBPS = { start: 4000, min: 1000, max: 25000 };

const state = {
  ws: null, myId: null, myName: '', room: '', iceServers: [], serverHttp: '',
  peers: new Map(),       // id -> peer
  watching: new Set(),    // ids of the sharers I chose to watch
  local: null,            // { stream, label, stopAudio }
  leaving: false,
};

// ------------------------------------------------------------------ helpers
function toast(text, ms = 3000) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function store(k, v) { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

// Normalise whatever the user typed into { http, ws } base URLs.
function serverUrls(input) {
  let s = (input || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) {
    // No scheme typed: IP addresses and localhost use http, domain names https.
    if (/^[0-9a-f]*:[0-9a-f:]+$/i.test(s)) s = `[${s}]`; // bare IPv6 address
    s = (/^(localhost|\[|\d+\.\d+\.\d+\.\d+)/i.test(s) ? 'http://' : 'https://') + s;
  }
  const u = new URL(s);
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  return { http: `${secure ? 'https' : 'http'}://${u.host}`, ws: `${secure ? 'wss' : 'ws'}://${u.host}/ws` };
}

// Opus: ask for stereo + high bitrate (default is mono voice quality).
// Video: x-google bitrate hints (start high instead of ramping up from ~300 kbps).
function setFmtp(sdp, pt, drop, add) {
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (re.test(sdp)) {
    return sdp.replace(re, (line, params) => {
      const p = params.split(';').filter((x) => x.trim() && !drop.test(x.trim()));
      return `a=fmtp:${pt} ${p.concat(add).join(';')}`;
    });
  }
  return sdp.replace(new RegExp(`(a=rtpmap:${pt} [^\\r\\n]*\\r?\\n)`), `$1a=fmtp:${pt} ${add.join(';')}\r\n`);
}

function tuneSdp(sdp) {
  const opus = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (opus) {
    sdp = setFmtp(sdp, opus[1], /^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec)=/,
      ['stereo=1', 'sprop-stereo=1', `maxaveragebitrate=${AUDIO_BITRATE}`, 'useinbandfec=1']);
  }
  for (const m of sdp.matchAll(/a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/gi)) {
    sdp = setFmtp(sdp, m[1], /^x-google-(start|min|max)-bitrate=/,
      [`x-google-start-bitrate=${VIDEO_KBPS.start}`, `x-google-min-bitrate=${VIDEO_KBPS.min}`, `x-google-max-bitrate=${VIDEO_KBPS.max}`]);
  }
  return sdp;
}

// ------------------------------------------------------------------ join screen
function initJoin() {
  I18N.apply();
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svgIcon(el.dataset.icon); });
  const ls = $('langSelect');
  ls.innerHTML = I18N.LANGS.map(([code, name]) => `<option value="${code}"${code === I18N.lang ? ' selected' : ''}>${name}</option>`).join('');
  ls.onchange = () => {
    // keep what was typed, then reload in the new language
    store('ss.name', $('nameInput').value.trim()); store('ss.room', $('roomInput').value.trim());
    if (native) store('ss.server', $('serverInput').value.trim());
    I18N.setLang(ls.value);
  };
  $('nameInput').value = load('ss.name') || '';
  $('roomInput').value = decodeURIComponent(location.hash.slice(1)) || load('ss.room') || '';
  if (native) {
    $('desktopServer').hidden = false;
    $('serverInput').value = new URLSearchParams(location.search).get('server') || load('ss.server') || '';
    $('testBtn').onclick = testConnection;
    $('serverInput').oninput = () => { $('testResult').hidden = true; };
  }
  $('joinForm').onsubmit = (e) => { e.preventDefault(); join(); };
}

// Desktop app: check the server address before joining a room.
// 1) /api/health over HTTP (is it a TwinCast server?)  2) the WebSocket used for rooms.
async function testConnection() {
  const out = $('testResult'), btn = $('testBtn');
  const show = (cls, html) => { out.className = 'test-result small ' + cls; out.innerHTML = html; out.hidden = false; };
  let urls;
  try { urls = serverUrls($('serverInput').value); } catch { urls = null; }
  if (!urls) return show('fail', tr('test.empty'));
  btn.disabled = true;
  show('', tr('test.testing', { url: esc(urls.http) }));
  try {
    const t0 = performance.now();
    let info;
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(urls.http + '/api/health', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      info = await res.json().catch(() => null);
      // 'screenshare' = servers from before the rename
      if (!res.ok || !info || !['twincast', 'screenshare'].includes(info.app)) throw new Error('not-screenshare');
    } catch (e) {
      return show('fail', e.message === 'not-screenshare'
        ? tr('test.notScreenshare', { url: esc(urls.http) })
        : tr('test.unreachable', { url: esc(urls.http) }));
    }
    const httpMs = Math.round(performance.now() - t0);
    const wsMs = await new Promise((resolve) => {
      const t1 = performance.now();
      const ws = new WebSocket(urls.ws);
      const done = (v) => { clearTimeout(to); try { ws.close(); } catch {} resolve(v); };
      const to = setTimeout(() => done(null), 6000);
      ws.onopen = () => ws.send('{"type":"ping"}');
      ws.onmessage = (ev) => { try { if (JSON.parse(ev.data).type === 'pong') done(Math.round(performance.now() - t1)); } catch {} };
      ws.onerror = () => done(null);
    });
    if (wsMs == null) {
      return show('fail', tr('test.wsBlocked', { version: esc(info.version) }));
    }
    const host = new URL(urls.http).hostname;
    const via = host.startsWith('[') ? tr('test.viaIPv6') : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? tr('test.viaIPv4') : '';
    show('ok', tr('test.ok', { version: esc(info.version), via, ms: Math.max(httpMs, wsMs) }));
    store('ss.server', $('serverInput').value.trim());
  } finally { btn.disabled = false; }
}

function join() {
  $('joinError').textContent = '';
  const name = $('nameInput').value.trim();
  const room = $('roomInput').value.trim().toLowerCase();
  let urls;
  try {
    urls = native ? serverUrls($('serverInput').value)
      : { http: location.origin, ws: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` };
  } catch { urls = null; }
  if (!urls) { $('joinError').textContent = tr('join.badServer'); return; }
  store('ss.name', name); store('ss.room', room); if (native) store('ss.server', $('serverInput').value.trim());
  state.myName = name; state.serverHttp = urls.http; state.leaving = false;
  // Lets the server recognise us after a dropped connection (resume instead of a duplicate).
  state.session = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  state.retry = 0;
  connect(urls.ws, room);
}

function connect(wsUrl, room) {
  const ws = new WebSocket(wsUrl);
  state.ws = ws;
  let keepAlive = null;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room, name: state.myName, session: state.session, client: CLIENT_TYPE }));
    // App-level keep-alive: routers/proxies close websockets that look idle.
    keepAlive = setInterval(() => { if (ws.readyState === 1) ws.send('{"type":"ping"}'); }, 20000);
  };
  ws.onmessage = (ev) => { state.retry = 0; onServerMessage(JSON.parse(ev.data)); };
  ws.onerror = () => { if (!state.myId) $('joinError').textContent = tr('join.unreachable', { url: wsUrl }); };
  ws.onclose = () => {
    clearInterval(keepAlive);
    if (state.leaving || state.ws !== ws || !state.myId) return;
    // Video keeps flowing peer-to-peer while we reconnect to the server.
    toast(tr('conn.lost'), 4000);
    const delay = Math.min(1000 * 2 ** state.retry++, 10000);
    setTimeout(() => { if (!state.leaving && state.ws === ws) connect(wsUrl, room); }, delay);
  };
}

function send(msg) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(msg)); }

// ------------------------------------------------------------------ server messages
function onServerMessage(msg) {
  switch (msg.type) {
    case 'welcome': {
      // A new id means the server forgot us (restart / too long offline): start over.
      if (state.myId && (msg.id !== state.myId || !msg.resumed)) resetRoom();
      const resumed = state.myId === msg.id;
      state.myId = msg.id; state.room = msg.room; state.iceServers = msg.iceServers || [];
      enterRoom();
      const present = new Set(msg.peers.map((p) => p.id));
      for (const id of [...state.peers.keys()]) if (!present.has(id)) removePeer(id);
      for (const p of msg.peers) {
        const peer = addPeer(p.id, p.name, p.client);
        peer.sharing = p.sharing;
        if (!p.sharing) removeTile(p.id); else if (peer.stream) showTile(peer);
      }
      renderPeople();
      if (resumed) toast(tr('conn.back'), 2000);
      if (state.local) send({ type: 'sharing', sharing: true, label: state.local.label, annotations: annAllowsOnShare(), app: native ? 'desktop' : 'browser' });
      break;
    }
    case 'peer-joined':
      addPeer(msg.id, msg.name, msg.client); renderPeople(); sysChat(tr('chat.joined', { name: msg.name }));
      break;
    case 'peer-left': {
      const p = state.peers.get(msg.id);
      if (p) { sysChat(tr('chat.left', { name: p.name })); removePeer(msg.id); renderPeople(); }
      break;
    }
    case 'peer-sharing': {
      const p = state.peers.get(msg.id);
      if (!p) break;
      const wasSharing = !!p.sharing;
      p.sharing = msg.sharing;
      if (!msg.sharing) removeTile(msg.id); else if (p.stream) showTile(p);
      if (msg.sharing && !wasSharing) sysChat(tr('chat.startedSharing', { name: p.name }));
      renderPeople();
      updateAnnUi();
      break;
    }
    case 'signal': onSignal(msg.from, msg.data); break;
    case 'chat': addChat(msg.name, msg.text); break;
    case 'ann': onAnnMessage(msg); break;
    case 'error': $('joinError').textContent = msg.message; break;
  }
}

// ------------------------------------------------------------------ WebRTC mesh (perfect negotiation)
function addPeer(id, name, client) {
  if (state.peers.has(id)) return state.peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: state.iceServers });
  const peer = { id, name, client, pc, polite: state.myId < id, makingOffer: false, ignoreOffer: false, stream: null, sharing: null, transceivers: [],
    wantsMine: false }; // wantsMine: they chose to watch my stream
  state.peers.set(id, peer);

  pc.onicecandidate = ({ candidate }) => { if (candidate) send({ type: 'signal', to: id, data: { candidate } }); };
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      offer.sdp = tuneSdp(offer.sdp);
      await pc.setLocalDescription(offer);
      send({ type: 'signal', to: id, data: { description: pc.localDescription } });
    } catch (e) { console.warn('negotiation', e); } finally { peer.makingOffer = false; }
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] || new MediaStream([track]);
    peer.stream = stream;
    track.onunmute = () => { if (peer.sharing) showTile(peer); };
    if (peer.sharing) showTile(peer);
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') pc.restartIce();
    if (pc.iceConnectionState === 'connected') for (const t of peer.transceivers) applyVideoParams(t.sender);
    renderPeople();
  };
  if (state.local && wantsMyStream(peer)) addLocalTracks(peer);
  return peer;
}

// Send my stream to someone only if they chose to watch it. Older versions of the app
// don't ask (client unknown), so they get it automatically, like before.
function wantsMyStream(peer) { return peer.wantsMine || !peer.client; }

async function onSignal(from, { description, candidate, watch }) {
  const peer = state.peers.get(from);
  if (!peer) return;
  if (typeof watch === 'boolean') { // they started / stopped watching my stream
    peer.wantsMine = watch;
    if (state.local && watch && !peer.transceivers.length) addLocalTracks(peer);
    if (state.local && !watch && peer.transceivers.length) removeLocalTracks(peer);
    renderPeople();
    return;
  }
  const pc = peer.pc;
  try {
    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        const answer = await pc.createAnswer();
        answer.sdp = tuneSdp(answer.sdp);
        await pc.setLocalDescription(answer);
        send({ type: 'signal', to: from, data: { description: pc.localDescription } });
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate); } catch (e) { if (!peer.ignoreOffer) throw e; }
    }
  } catch (e) { console.warn('signal', e); }
}

function addLocalTracks(peer) {
  const { stream, quality: q } = state.local;
  for (const track of stream.getTracks()) {
    const enc = track.kind === 'video'
      ? { maxBitrate: q.bitrate, maxFramerate: q.fps, priority: 'high', networkPriority: 'high' }
      : { maxBitrate: AUDIO_BITRATE, priority: 'high', networkPriority: 'high' };
    const t = peer.pc.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [enc] });
    if (track.kind === 'video') applyVideoParams(t.sender);
    peer.transceivers.push(t);
  }
}

// (Re)apply encoder settings; called again once connected, because some browsers
// ignore setParameters before the connection is negotiated.
function applyVideoParams(sender) {
  if (!state.local || !sender.track || sender.track.kind !== 'video') return;
  const q = state.local.quality;
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) return;
    p.encodings[0].maxBitrate = q.bitrate;
    p.encodings[0].maxFramerate = q.fps;
    p.encodings[0].scaleResolutionDownBy = 1;
    p.degradationPreference = q.degradation;
    sender.setParameters(p).catch((e) => console.warn('setParameters', e));
  } catch (e) { console.warn('setParameters', e); }
}

function removeLocalTracks(peer) {
  for (const t of peer.transceivers) {
    try { peer.pc.removeTrack(t.sender); } catch {}
    try { t.direction = 'inactive'; } catch {}
  }
  peer.transceivers = [];
}

function removePeer(id) {
  state.watching.delete(id);
  const p = state.peers.get(id);
  if (!p) return;
  p.pc.close();
  state.peers.delete(id);
  removeTile(id);
}

// ------------------------------------------------------------------ sharing
// Browsers only allow screen capture on secure pages: https://, or http://localhost.
// On http://<ip or name> navigator.mediaDevices doesn't exist at all.
function browserShareProblem() {
  if (native) return null;
  if (!window.isSecureContext) {
    return tr('share.insecure', { host: location.host });
  }
  if (!navigator.mediaDevices?.getDisplayMedia) return tr('share.unsupported');
  return null;
}

// Capture what the popup chose: video (+ the chosen sound in the desktop app).
async function captureChoice(choice) {
  const q = choice.quality;
  let stream, label, stopAudio = null, audioNote = '';
  if (native) {
    await native.selectSource(choice.sourceId);
    stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints(q), audio: false });
    label = choice.label;
    const au = choice.audio;
    if (au.mode !== 'none') {
      try {
        const a = await startDesktopAudio(au.targets);
        stream.addTrack(a.track); stopAudio = a.stop;
        if (au.mode === 'allBut') a.watchApps((x) => !isDiscord(x.name));
        audioNote = au.mode === 'all' ? tr('audio.all') : au.mode === 'allBut' ? tr('audio.allBut')
          : tr('audio.sendingFrom', { apps: au.names.join(', ') });
      } catch (e) { stream.getTracks().forEach((t) => t.stop()); throw e; }
    } else audioNote = tr('audio.none');
  } else {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints(q),
      // Tab audio only (Chrome/Edge). "systemAudio: exclude" keeps Discord & co. out.
      audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
    });
    const surface = stream.getVideoTracks()[0].getSettings().displaySurface;
    label = { monitor: tr('surface.monitor'), window: tr('surface.window'), browser: tr('surface.browser') }[surface] || tr('surface.monitor');
    audioNote = stream.getAudioTracks().length ? tr('audio.tab') : tr('audio.browserNone');
  }
  const vt = stream.getVideoTracks()[0];
  // "Source" resolution: size the bitrate to what is actually being captured.
  if (q.res === 'source') q.bitrate = Math.round(mbpsFor(vt.getSettings().height || 1080, q.fps) * 1e6);
  vt.contentHint = q.fps >= 60 ? 'motion' : 'detail';
  return { stream, label, stopAudio, audioNote, quality: q, sourceId: native ? choice.sourceId : null };
}

async function startShare() {
  if (state.local) return;
  const problem = browserShareProblem();
  if (problem) { toast(problem, 12000); return; }
  try {
    const choice = await openSharePopup();
    if (!choice) return;
    const c = await captureChoice(choice);
    c.stream.getVideoTracks()[0].onended = () => stopShare();
    state.local = { stream: c.stream, label: c.label, stopAudio: c.stopAudio, quality: c.quality, sourceId: c.sourceId };
    for (const p of state.peers.values()) if (wantsMyStream(p)) addLocalTracks(p);
    send({ type: 'sharing', sharing: true, label: c.label, annotations: annAllowsOnShare(), app: native ? 'desktop' : 'browser' });
    showLocalTile();
    annShareStarted(c.sourceId);
    $('shareBtn').hidden = true; $('changeBtn').hidden = false; $('stopBtn').hidden = false; $('previewBtn').hidden = false;
    $('audioStatus').textContent = c.audioNote;
  } catch (e) {
    if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(tr('share.failed', { error: e.message || e }), 6000);
  }
}

// Change what is shared without stopping: viewers keep their connection and tile; the
// new picture/sound replaces the old one in place. Marks are cleared (they belonged to
// the old screen).
async function changeShare() {
  const l = state.local;
  if (!l) return;
  let c;
  try {
    const choice = await openSharePopup({ changing: true });
    if (!choice || state.local !== l) return;
    c = await captureChoice(choice);
  } catch (e) {
    if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(tr('share.failed', { error: e.message || e }), 6000);
    return;
  }
  if (state.local !== l) { c.stream.getTracks().forEach((t) => t.stop()); if (c.stopAudio) c.stopAudio(); return; }
  const newVideo = c.stream.getVideoTracks()[0];
  const newAudio = c.stream.getAudioTracks()[0] || null;
  const oldTracks = l.stream.getTracks();
  const oldStopAudio = l.stopAudio;
  // Keep the same outgoing MediaStream object, so viewers see the same stream id.
  oldTracks.forEach((t) => { t.onended = null; l.stream.removeTrack(t); });
  l.stream.addTrack(newVideo);
  if (newAudio) l.stream.addTrack(newAudio);
  Object.assign(l, { label: c.label, stopAudio: c.stopAudio, quality: c.quality, sourceId: c.sourceId });
  newVideo.onended = () => stopShare();
  for (const p of state.peers.values()) {
    if (!p.transceivers.length) continue; // not watching me
    let hasAudio = false;
    for (const t of p.transceivers) {
      const kind = t.receiver.track.kind;
      if (kind === 'video') { t.sender.replaceTrack(newVideo).then(() => applyVideoParams(t.sender)).catch(() => {}); }
      else if (kind === 'audio') { hasAudio = true; t.sender.replaceTrack(newAudio).catch(() => {}); }
    }
    if (newAudio && !hasAudio) { // the old share had no sound: add a sound slot (renegotiates)
      const t = p.pc.addTransceiver(newAudio, { direction: 'sendonly', streams: [l.stream],
        sendEncodings: [{ maxBitrate: AUDIO_BITRATE, priority: 'high', networkPriority: 'high' }] });
      p.transceivers.push(t);
    }
  }
  oldTracks.forEach((t) => t.stop());
  if (oldStopAudio) oldStopAudio();
  send({ type: 'sharing', sharing: true, label: c.label, annotations: annAllowsOnShare(), app: native ? 'desktop' : 'browser' });
  // refresh my own preview with the new picture
  const v = document.querySelector('.tile[data-id="me"] video');
  if (v) v.srcObject = null;
  const who = document.querySelector('.tile[data-id="me"] .who');
  if (who) who.textContent = tr('tile.you', { label: c.label });
  showLocalTile();
  annShareChanged(c.sourceId);
  $('audioStatus').textContent = c.audioNote;
}

function stopShare() {
  const l = state.local;
  if (!l) return;
  state.local = null;
  for (const p of state.peers.values()) removeLocalTracks(p);
  l.stream.getTracks().forEach((t) => t.stop());
  if (l.stopAudio) l.stopAudio();
  send({ type: 'sharing', sharing: false });
  annShareStopped();
  removeTile('me');
  $('shareBtn').hidden = false; $('changeBtn').hidden = true; $('stopBtn').hidden = true; $('previewBtn').hidden = true;
  $('audioStatus').textContent = '';
}

// ------------------------------------------------------------------ native: per-app audio
const WORKLET_SRC = `
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000 * 2; this.buf = new Float32Array(this.cap * 2);
    this.r = 0; this.w = 0; this.count = 0; this.primed = false;
    this.port.onmessage = (e) => {
      const s = e.data, frames = s.length >> 1;
      for (let i = 0; i < frames; i++) {
        this.buf[this.w * 2] = s[i * 2] / 32768; this.buf[this.w * 2 + 1] = s[i * 2 + 1] / 32768;
        this.w = (this.w + 1) % this.cap;
      }
      this.count = Math.min(this.count + frames, this.cap);
      if (this.count > 9600) { const drop = this.count - 2400; this.r = (this.r + drop) % this.cap; this.count -= drop; } // keep latency low
    };
  }
  process(inputs, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L;
    if (!this.primed && this.count >= 1920) this.primed = true;
    for (let i = 0; i < L.length; i++) {
      if (this.primed && this.count > 0) {
        L[i] = this.buf[this.r * 2]; R[i] = this.buf[this.r * 2 + 1];
        this.r = (this.r + 1) % this.cap; this.count--;
      } else { L[i] = 0; R[i] = 0; this.primed = false; }
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);`;

// Sound from apps on this PC -> one audio track. Each capture (one app, or "everything
// except X") gets its own buffer node; they are mixed into the track. More apps can be
// added while sharing (add), and watchApps() keeps adding apps that start playing later.
let audioSessionSeq = 0;
async function startDesktopAudio(targets) {
  const sid = ++audioSessionSeq;
  const own = (t) => ({ ...t, key: `${sid}:${t.key}` });
  targets = targets.map(own);
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  const nodes = new Map();
  const ensureNode = (key) => {
    if (!nodes.has(key)) {
      const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(dest);
      nodes.set(key, node);
    }
    return nodes.get(key);
  };
  targets.forEach((t) => ensureNode(t.key));
  const off = native.onAudioData((key, chunk) => {
    const node = nodes.get(key);
    if (!node) return;
    const pcm = new Int16Array(chunk.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(new Uint8Array(chunk.buffer, chunk.byteOffset, pcm.byteLength));
    node.port.postMessage(pcm, [pcm.buffer]);
  });
  const offErr = native.onAudioError((key, message) => toast(tr('audio.problem', { message }), 6000));
  // A capture ended (its app closed): forget it, so the app is picked up again if it comes back.
  const offEnd = native.onAudioEnded((key) => { const n = nodes.get(key); if (n) { n.disconnect(); nodes.delete(key); } });
  await native.startAudio(targets);
  if (ctx.state !== 'running') await ctx.resume();
  let watchTimer = null;
  const add = async (more) => {
    const fresh = more.map(own).filter((t) => !nodes.has(t.key));
    if (!fresh.length) return;
    fresh.forEach((t) => ensureNode(t.key));
    await native.addAudio(fresh);
  };
  return {
    track: dest.stream.getAudioTracks()[0],
    add,
    // Every few seconds, add apps that started playing sound and pass the filter.
    watchApps(filter) {
      clearInterval(watchTimer);
      watchTimer = setInterval(async () => {
        const apps = await native.listAudioApps().catch(() => []);
        add(apps.filter(filter).map((x) => ({ key: 'p' + x.pid, pid: x.pid })));
      }, 3000);
    },
    stop: () => { clearInterval(watchTimer); native.stopAudio([...nodes.keys(), ...targets.map((t) => t.key)]); off(); offErr(); offEnd(); ctx.close(); },
  };
}

// ------------------------------------------------------------------ share popup
// "Screen Share" popup, Discord-style: a summary with three sections.
//  - What you're streaming -> window/screen selector (desktop app)
//  - Also share audio + Sound configuration -> sound selector (Share all / All but Discord / Advanced)
//  - Stream quality: resolution x frame rate
// Browsers get only the quality section; the browser itself asks what to share.

// Quality: resolution (720 / 1080 / 1440 / Source = native size) x frame rate (15 / 30 / 60).
const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], source: null };
const FPS_LIST = [15, 30, 60];
// Upload per viewer, in Mbps: 720p30 = 4, 1080p30 = 8, 1440p30 = 12 (more for 60 fps, less for 15).
function mbpsFor(height, fps) {
  const base = height <= 720 ? 4 : height <= 1080 ? 8 : height <= 1440 ? 12 : 12 * (height / 1440) ** 2;
  return Math.min(25, base * ({ 15: 0.6, 30: 1, 60: 1.5 }[fps] || 1));
}
function makeQuality(res, fps) {
  const size = RES[res];
  return {
    res, fps,
    width: size ? size[0] : undefined, height: size ? size[1] : undefined,
    bitrate: Math.round(mbpsFor(size ? size[1] : 1080, fps) * 1e6), // Source: corrected once the real size is known
    degradation: fps >= 60 ? 'balanced' : 'maintain-resolution',
  };
}
const videoConstraints = (q) => ({
  ...(q.width ? { width: { ideal: q.width }, height: { ideal: q.height } } : {}),
  frameRate: { ideal: q.fps, max: q.fps },
});

const isDiscord = (name) => /^discord/i.test(name || '');
const appName = (name) => String(name || '').replace(/\.exe$/i, '');

async function openSharePopup({ changing = false } = {}) {
  const dlg = $('picker');
  $('pickerShare').querySelector('.lbl').textContent = tr(changing ? 'pick.switch' : 'pick.goLive');
  const views = { main: $('pickMain'), source: $('pickSourceView'), sound: $('pickSoundView') };
  const show = (v) => { for (const [k, el] of Object.entries(views)) el.hidden = k !== v; };

  // --- quality (both app and browser) ---
  let res = Object.prototype.hasOwnProperty.call(RES, load('ss.res')) ? load('ss.res') : '1080';
  let fps = FPS_LIST.includes(Number(load('ss.fps'))) ? Number(load('ss.fps')) : 30;
  function renderQuality() {
    $('resSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.res === res));
    $('fpsSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.fps) === fps));
    const mbps = mbpsFor(RES[res] ? RES[res][1] : 1080, fps);
    $('pickEstimate').textContent = tr(res === 'source' ? 'pick.estimateSource' : 'pick.estimate', { mbps: mbps.toFixed(mbps < 10 ? 1 : 0) });
  }
  $('resSeg').querySelectorAll('button').forEach((b) => { b.onclick = () => { res = b.dataset.res; store('ss.res', res); renderQuality(); }; });
  $('fpsSeg').querySelectorAll('button').forEach((b) => { b.onclick = () => { fps = Number(b.dataset.fps); store('ss.fps', String(fps)); renderQuality(); }; });
  renderQuality();

  const waitClose = () => new Promise((r) => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }));

  if (!native) {
    $('pickSourceSection').hidden = true; $('pickAudioRow').hidden = true; $('pickSoundSection').hidden = true;
    $('pickBrowserNote').hidden = false;
    $('pickerShare').disabled = false;
    show('main');
    dlg.showModal();
    return (await waitClose()) === 'share' ? { quality: makeQuality(res, fps) } : null;
  }

  // --- desktop app: source + sound ---
  const [sources, firstApps] = await Promise.all([native.getSources(), native.listAudioApps().catch(() => [])]);
  let apps = firstApps;
  let selected = sources.find((x) => x.id === load('ss.lastSource')) || null; // last choice, if still there
  let tab = selected && selected.id.startsWith('screen:') ? 'screen' : 'window';
  let windowApp = null;   // { pid, name } owning the selected window
  let windowSound = load('ss.windowSound') !== '0';
  let screenSound = load('ss.screenSound') !== '0';
  let mode = ['all', 'allBut', 'advanced'].includes(load('ss.soundMode')) ? load('ss.soundMode') : 'all';
  const picked = new Set((load('ss.soundApps') || '').split('|').filter(Boolean)); // app names, remembered
  let pickToken = 0;
  const isWindow = () => !!selected && selected.id.startsWith('window:');

  function groupsOf(list) { // one entry per app name (an app can run as several processes)
    const groups = new Map();
    for (const a of list) {
      const k = a.name.toLowerCase();
      if (!groups.has(k)) groups.set(k, { name: a.name, playing: false, pids: [] });
      const g = groups.get(k); g.pids.push(a.pid); g.playing = g.playing || a.playing;
    }
    return groups;
  }

  function soundSummary() {
    if (mode === 'all') return tr('picker.modeAll');
    if (mode === 'allBut') return tr('picker.modeAllBut');
    const names = [...groupsOf(apps).entries()].filter(([k]) => picked.has(k)).map(([, g]) => appName(g.name));
    return names.length ? tr('pick.advancedApps', { apps: names.join(', ') }) : tr('pick.advancedNone');
  }

  function renderMain() {
    $('pickSourceIcon').innerHTML = svgIcon(isWindow() ? 'window' : 'app');
    $('pickSourceName').textContent = selected ? selected.name : tr('pick.choose');
    $('pickSourceName').classList.toggle('placeholder', !selected);
    const audioOn = isWindow() ? windowSound : screenSound;
    $('pickAudioOn').checked = audioOn;
    $('pickAudioLabel').textContent = isWindow()
      ? tr('pick.windowAudio', { app: windowApp ? appName(windowApp.name) : '…' })
      : tr('pick.screenAudio');
    $('pickAudioRow').hidden = !selected;
    $('pickAudioNote').hidden = !isWindow() || !windowApp || !/^(firefox|chrome|msedge|opera|brave|vivaldi)/i.test(windowApp.name);
    $('pickSoundSection').hidden = !selected || isWindow() || !screenSound;
    $('pickSoundIcon').innerHTML = svgIcon('sound');
    $('pickSoundName').textContent = soundSummary();
    $('pickerShare').disabled = !selected;
  }

  function renderSources() {
    dlg.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
    const grid = $('sourceGrid'); grid.innerHTML = '';
    for (const x of sources.filter((y) => y.id.startsWith(tab + ':'))) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'source' + (selected && selected.id === x.id ? ' selected' : '');
      b.innerHTML = `<img class="thumb" src="${x.thumbnail}" alt=""><div class="name">${x.appIcon ? `<img src="${x.appIcon}" alt="">` : ''}<span>${esc(x.name)}</span></div>`;
      b.onclick = () => selectSource(x);
      grid.appendChild(b);
    }
  }

  function renderSound() {
    const box = $('audioApps');
    box.innerHTML = '';
    $('soundModes').querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('soundHint').textContent = tr({ all: 'picker.modeAllHint', allBut: 'picker.modeAllButHint', advanced: 'picker.modeAdvancedHint' }[mode]);
    if (mode !== 'advanced') return;
    if (!apps.length) { box.innerHTML = `<span class="muted small">${esc(tr('picker.noApps'))}</span>`; return; }
    for (const [k, g] of groupsOf(apps)) {
      const el = document.createElement('label');
      el.className = 'audio-app';
      el.title = `${g.name} (pid ${g.pids.join(', ')})`;
      el.innerHTML = `<input type="checkbox"> ${g.playing ? '<span class="eq"></span>' : ''}<span></span>`;
      el.querySelector('span:last-child').textContent = appName(g.name);
      const input = el.querySelector('input');
      input.checked = picked.has(k);
      input.onchange = () => { input.checked ? picked.add(k) : picked.delete(k); store('ss.soundApps', [...picked].join('|')); };
      box.appendChild(el);
    }
  }

  async function selectSource(src) {
    selected = src; windowApp = null;
    store('ss.lastSource', src.id);
    show('main'); renderMain();
    if (src.id.startsWith('window:')) {
      const token = ++pickToken;
      const owner = await native.resolveSourceApp(src.id).catch(() => null);
      if (token !== pickToken) return; // another window was picked meanwhile
      windowApp = owner;
      renderMain();
    }
  }
  if (selected) selectSource(selected);

  // wiring
  $('pickSourceField').onclick = () => { renderSources(); show('source'); };
  $('pickSoundField').onclick = () => { renderSound(); show('sound'); };
  dlg.querySelectorAll('.pick-back').forEach((b) => { b.onclick = () => { show('main'); renderMain(); }; });
  dlg.querySelectorAll('.tab').forEach((tb) => { tb.onclick = () => { tab = tb.dataset.tab; renderSources(); }; });
  $('soundModes').querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => { mode = b.dataset.mode; store('ss.soundMode', mode); renderSound(); };
  });
  $('pickAudioOn').onchange = (e) => {
    if (isWindow()) { windowSound = e.target.checked; store('ss.windowSound', windowSound ? '1' : '0'); }
    else { screenSound = e.target.checked; store('ss.screenSound', screenSound ? '1' : '0'); }
    renderMain();
  };

  $('pickSourceSection').hidden = false; $('pickBrowserNote').hidden = true;
  renderMain();
  show(selected ? 'main' : 'source');
  if (!selected) renderSources();
  dlg.showModal();
  // Keep the app list fresh while the popup is open (e.g. you join a Discord call meanwhile).
  const appKeyOf = (list) => list.map((x) => x.pid + (x.playing ? '*' : '')).join(',');
  const refresh = setInterval(async () => {
    const next = await native.listAudioApps().catch(() => null);
    if (!next || appKeyOf(next) === appKeyOf(apps)) return;
    apps = next;
    if (!views.sound.hidden) renderSound();
    renderMain();
  }, 2000);
  const result = await waitClose();
  clearInterval(refresh);
  if (result !== 'share' || !selected) return null;

  let audio = { mode: 'none', targets: [], names: [] };
  if (isWindow()) {
    if (windowSound && windowApp) audio = { mode: 'window', targets: [{ key: 'p' + windowApp.pid, pid: windowApp.pid }], names: [appName(windowApp.name)] };
  } else if (!screenSound) {
    // no sound
  } else if (mode === 'all') {
    audio = { mode: 'all', targets: [{ key: 'all', self: true, exclude: true }], names: [] };
  } else if (mode === 'allBut') {
    const list = apps.filter((x) => !isDiscord(x.name));
    audio = { mode: 'allBut', targets: list.map((x) => ({ key: 'p' + x.pid, pid: x.pid })), names: [] };
  } else {
    const list = apps.filter((x) => picked.has(x.name.toLowerCase()));
    if (list.length) audio = { mode: 'advanced', targets: list.map((x) => ({ key: 'p' + x.pid, pid: x.pid })), names: [...new Set(list.map((x) => appName(x.name)))] };
  }
  return { sourceId: selected.id, label: selected.name, audio, quality: makeQuality(res, fps) };
}

// ------------------------------------------------------------------ tiles
function tileFor(id, name, isLocal) {
  let tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (tile) return tile;
  tile = document.createElement('div');
  tile.className = 'tile'; tile.dataset.id = id;
  tile.innerHTML = `
    <span class="live">${tr('room.live')}</span>
    <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
    <canvas class="ann"></canvas>
    <div class="stats" ${statsOn() ? '' : 'hidden'}></div>
    <div class="bar">
      <span class="who"></span>
      ${isLocal ? '' : `<input class="vol" type="range" min="0" max="1" step="0.01" value="1" title="${tr('tile.volume')}">`}
      <button class="ann-btn" title="${tr('ann.drawTitle')}" hidden><span class="ico">${svgIcon('pencil')}</span><span class="lbl">${tr('ann.annotate')}</span></button>
      <button class="stats-btn" title="${tr('tile.statsTitle')}">${tr('tile.stats')}</button>
      <button class="focus-btn" title="${tr('tile.focus')}">${tr('tile.focus')}</button>
      ${isLocal ? '' : `<button class="unwatch-btn" title="${tr('watch.stop')}"><span class="ico">${svgIcon('eyeOff')}</span></button>`}
      <button class="fs-btn" title="${tr('tile.fullscreen')}">⛶</button>
    </div>`;
  tile.querySelector('.who').textContent = isLocal ? tr('tile.you', { label: name }) : name;
  const video = tile.querySelector('video');
  const vol = tile.querySelector('.vol');
  if (vol) {
    const saved = load('ss.vol.' + name);
    if (saved !== null) vol.value = saved;
    video.volume = Number(vol.value);
    vol.oninput = () => { video.volume = Number(vol.value); store('ss.vol.' + name, vol.value); };
  }
  tile.querySelector('.stats-btn').onclick = () => {
    const on = !statsOn();
    store('ss.stats', on ? '1' : '0');
    document.querySelectorAll('.tile .stats').forEach((s) => { s.hidden = !on; });
    updateStats();
  };
  tile.querySelector('.fs-btn').onclick =() => (document.fullscreenElement ? document.exitFullscreen() : tile.requestFullscreen());
  tile.querySelector('.focus-btn').onclick = () => toggleFocus(tile);
  if (!isLocal) tile.querySelector('.unwatch-btn').onclick = () => setWatch(id, false);
  video.ondblclick = () => (document.fullscreenElement ? document.exitFullscreen() : tile.requestFullscreen());
  $('stage').appendChild(tile);
  updateEmpty();
  annTileCreated(tile);
  return tile;
}

function playVideo(tile, stream) {
  const video = tile.querySelector('video');
  if (video.srcObject !== stream) video.srcObject = stream;
  video.play().catch(() => {
    // Autoplay with sound blocked: ask for a click.
    if (tile.querySelector('.play-overlay')) return;
    const o = document.createElement('div'); o.className = 'play-overlay';
    o.innerHTML = `<button class="primary">${esc(tr('tile.clickToWatch'))}</button>`;
    o.onclick = () => { video.play(); o.remove(); };
    tile.appendChild(o);
  });
}

function showTile(peer) {
  if (!peer.stream || !peer.sharing || !state.watching.has(peer.id)) return;
  const tile = tileFor(peer.id, peer.name, false);
  tile.querySelector('.who').textContent = peer.sharing.label ? `${peer.name} — ${peer.sharing.label}` : peer.name;
  playVideo(tile, peer.stream);
}

// The sharer's own preview can be hidden: the video element is detached from the
// stream (no rendering work), the tile shrinks to a one-line bar. Viewers are unaffected.
function previewHidden() { return load('ss.hidePreview') === '1'; }

function showLocalTile() {
  const tile = tileFor('me', state.local.label, true);
  const hidden = previewHidden();
  tile.classList.toggle('collapsed', hidden);
  // Hidden: move to the strip above the stage so friends' streams get the whole area.
  const home = hidden ? $('localBar') : $('stage');
  if (tile.parentElement !== home) home.appendChild(tile);
  if (!tile.querySelector('.collapsed-msg')) {
    const m = document.createElement('div');
    m.className = 'collapsed-msg';
    m.textContent = tr('tile.sharingHidden');
    tile.insertBefore(m, tile.querySelector('.stats'));
  }
  const video = tile.querySelector('video');
  if (hidden) {
    if (tile.classList.contains('focus')) toggleFocus(tile);
    video.pause();
    video.srcObject = null;
  } else playVideo(tile, state.local.stream);
  $('previewBtn').querySelector('.lbl').textContent = hidden ? tr('room.showPreview') : tr('room.hidePreview');
  $('previewBtn').querySelector('.ico').innerHTML = svgIcon(hidden ? 'eye' : 'eyeOff');
  updateAnnUi(); redrawAnn();
}

function togglePreview() {
  store('ss.hidePreview', previewHidden() ? '0' : '1');
  if (state.local) showLocalTile();
}

function removeTile(id) {
  const t = document.querySelector(`.tile[data-id="${id}"]`);
  if (!t) return;
  annTileRemoved(t);
  if (t.classList.contains('focus')) $('stage').classList.remove('focused');
  t.remove();
  updateEmpty();
}

function toggleFocus(tile) {
  const stage = $('stage');
  const on = !tile.classList.contains('focus');
  stage.querySelectorAll('.tile.focus').forEach((t) => { t.classList.remove('focus'); t.querySelector('.focus-btn').textContent = tr('tile.focus'); });
  stage.classList.toggle('focused', on);
  if (on) { tile.classList.add('focus'); tile.querySelector('.focus-btn').textContent = tr('tile.showAll'); }
}

// Size the stream tiles so they all fit in the stage, as big as possible, keeping 16:9.
// Tries every column count and keeps the one that gives the largest tiles.
function layoutStage() {
  const stage = $('stage');
  const tiles = [...stage.children].filter((t) => t.classList.contains('tile'));
  if (stage.classList.contains('focused') || !tiles.length) { tiles.forEach((t) => { t.style.width = ''; }); return; }
  const cs = getComputedStyle(stage);
  const gap = parseFloat(cs.columnGap) || 10;
  const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let best = 0;
  for (let cols = 1; cols <= tiles.length; cols++) {
    const rows = Math.ceil(tiles.length / cols);
    const byWidth = (W - gap * (cols - 1)) / cols;
    const byHeight = ((H - gap * (rows - 1)) / rows) * 16 / 9;
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  const w = `${Math.max(120, Math.floor(best) - 2)}px`; // -2: borders
  tiles.forEach((t) => { if (t.style.width !== w) t.style.width = w; });
  if (typeof redrawAnn === 'function') redrawAnn();
}
let layoutQueued = false;
function queueLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  setTimeout(() => { layoutQueued = false; layoutStage(); }, 0); // not rAF: it pauses in hidden windows
}
new ResizeObserver(queueLayout).observe($('stage'));
window.addEventListener('resize', queueLayout);
// Safety net: some environments don't report resizes (minimized/hidden windows).
let lastStageSize = '';
setInterval(() => { const st = $('stage'); const k = st.clientWidth + 'x' + st.clientHeight; if (k !== lastStageSize) { lastStageSize = k; queueLayout(); } }, 1000);
new MutationObserver(queueLayout).observe($('stage'), { childList: true, attributes: true, attributeFilter: ['class'] });

// ------------------------------------------------------------------ choosing what to watch
// Click a streamer in the People tab to watch them (several at once is fine).
function setWatch(id, on) {
  const p = state.peers.get(id);
  if (on) state.watching.add(id); else state.watching.delete(id);
  send({ type: 'signal', to: id, data: { watch: on } }); // the sharer sends only to watchers
  if (on) { if (p && p.stream) showTile(p); } else removeTile(id);
  renderPeople();
}

function updateEmpty() {
  const hasTile = !!$('stage').querySelector('.tile');
  $('emptyStage').hidden = hasTile;
  if (hasTile) return;
  const choosable = [...state.peers.values()].some((p) => p.sharing);
  $('emptyTitle').textContent = tr(choosable ? 'room.pickTitle' : 'room.emptyTitle');
  $('emptyHint').innerHTML = tr(choosable ? 'room.pickHint' : 'room.emptyHint');
}

// ------------------------------------------------------------------ quality stats
function statsOn() { return load('ss.stats') !== '0'; }
const LIMIT_TEXT = { bandwidth: tr('stats.limitBandwidth'), cpu: tr('stats.limitCpu'), other: tr('stats.limitOther') };

async function connInfo(stats) {
  let pair = null;
  stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
  if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
  if (!pair) return '';
  const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
  const relay = (local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay');
  const addr = (remote && (remote.address || remote.ip)) || '';
  const fam = addr.includes(':') ? 'IPv6' : addr ? 'IPv4' : '';
  const rtt = pair.currentRoundTripTime != null ? ` · ${Math.round(pair.currentRoundTripTime * 1000)} ms` : '';
  return `${relay ? tr('stats.relay') : tr('stats.direct')}${fam ? ' ' + fam : ''}${rtt}`;
}

function rate(peer, key, bytes, ts) {
  peer.prev = peer.prev || {};
  const p = peer.prev[key];
  peer.prev[key] = { bytes, ts };
  if (!p || ts <= p.ts) return null;
  return ((bytes - p.bytes) * 8) / ((ts - p.ts) / 1000) / 1e6; // Mbps
}

async function updateStats() {
  if (!statsOn()) return;
  // Viewing: what we receive from each sharer.
  for (const peer of state.peers.values()) {
    const box = document.querySelector(`.tile[data-id="${peer.id}"] .stats`);
    if (!box) continue;
    const stats = await peer.pc.getStats();
    let v = null;
    stats.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video' && s.bytesReceived > 0) v = s; });
    if (!v) { box.textContent = tr('stats.waiting'); continue; }
    const mbps = rate(peer, 'in', v.bytesReceived, v.timestamp);
    const codec = v.codecId && stats.get(v.codecId) ? stats.get(v.codecId).mimeType.split('/')[1] : '';
    const lost = v.packetsLost && v.packetsReceived ? ` · ${tr('stats.loss')} ${((v.packetsLost / (v.packetsLost + v.packetsReceived)) * 100).toFixed(1)}%` : '';
    box.textContent = `${v.frameWidth || '?'}×${v.frameHeight || '?'} · ${Math.round(v.framesPerSecond || 0)} fps · ` +
      `${mbps == null ? '…' : mbps.toFixed(1)} Mbps · ${codec}${lost} · ${await connInfo(stats)}`;
  }
  // Sharing: what we send to each viewer.
  const mine = document.querySelector('.tile[data-id="me"] .stats');
  if (mine && state.local) {
    const lines = [];
    for (const peer of state.peers.values()) {
      if (!peer.transceivers.length) continue; // not watching
      const stats = await peer.pc.getStats();
      let o = null;
      stats.forEach((s) => { if (s.type === 'outbound-rtp' && s.kind === 'video' && s.bytesSent > 0) o = s; });
      if (!o) { lines.push(tr('stats.connecting', { name: peer.name })); continue; }
      const mbps = rate(peer, 'out', o.bytesSent, o.timestamp);
      const lim = o.qualityLimitationReason && o.qualityLimitationReason !== 'none' ? ` · ${LIMIT_TEXT[o.qualityLimitationReason] || o.qualityLimitationReason}` : '';
      lines.push(`→ ${peer.name}: ${o.frameWidth || '?'}×${o.frameHeight || '?'} · ${Math.round(o.framesPerSecond || 0)} fps · ` +
        `${mbps == null ? '…' : mbps.toFixed(1)} Mbps${lim} · ${await connInfo(stats)}`);
    }
    mine.textContent = lines.join('\n') || tr('stats.nobody');
  }
}
setInterval(() => { updateStats().catch(() => {}); }, 1000);

// ------------------------------------------------------------------ people + chat
// Each person gets an icon for what they're using instead of a plain dot.
function clientIcon(type, failed) {
  const c = CLIENT_INFO[type];
  const kind = c ? type : 'unknown';
  const title = esc((c ? c.label : tr('client.unknown')) + (failed ? ' · ' + tr('client.cantConnect') : ''));
  return `<span class="client ${kind}${failed ? ' failed' : ''}" title="${title}" role="img" aria-label="${title}">${svgIcon(kind)}</span>`;
}

// People tab: "Streaming" (click to watch / stop) and "Online".
// Left of the name: device icon, then white status icons:
//   eye    = you are watching this streamer
//   screen = this person is watching your stream
function personRow(p, isMe) {
  const ice = isMe ? 'connected' : p.pc.iceConnectionState;
  const failed = ice === 'failed';
  const conn = ice === 'connected' || ice === 'completed' || ice === 'new' ? '' : failed ? tr('client.cantConnect') : ice;
  const status = [];
  if (!isMe && p.sharing && state.watching.has(p.id)) status.push(`<span class="status-ico" title="${esc(tr('people.youWatch'))}">${svgIcon('eye')}</span>`);
  if (!isMe && state.local && p.transceivers.length) status.push(`<span class="status-ico" title="${esc(tr('people.watchingYou'))}">${svgIcon('watcher')}</span>`);
  const streamer = !isMe && !!p.sharing;
  const watching = streamer && state.watching.has(p.id);
  const action = streamer ? `<span class="row-action">${esc(tr(watching ? 'watch.stop' : 'watch.watch'))}</span>` : '';
  const title = streamer ? ` title="${esc(tr(watching ? 'people.clickStop' : 'people.clickWatch'))}${p.sharing.label ? ' · ' + esc(p.sharing.label) : ''}"` : '';
  return `<li class="person${streamer ? ' streamer' : ''}${watching ? ' watching' : ''}"${streamer ? ` data-id="${p.id}" role="button" tabindex="0"` : ''}${title}>` +
    `${clientIcon(isMe ? CLIENT_TYPE : p.client, failed)}${status.join('')}` +
    `<span class="person-name">${isMe ? `<b>${esc(state.myName)}</b> ${esc(tr('room.you'))}` : esc(p.name)}</span>` +
    `${conn ? `<span class="state">${esc(conn)}</span>` : action}</li>`;
}

function renderPeople() {
  const others = [...state.peers.values()];
  const me = { sharing: state.local };
  const streaming = others.filter((p) => p.sharing);
  const online = others.filter((p) => !p.sharing);
  $('streamingList').innerHTML = (state.local ? personRow(me, true) : '') + streaming.map((p) => personRow(p, false)).join('');
  $('peopleList').innerHTML = (state.local ? '' : personRow(me, true)) + online.map((p) => personRow(p, false)).join('');
  const nStreaming = streaming.length + (state.local ? 1 : 0);
  $('streamingCount').textContent = nStreaming;
  $('onlineCount').textContent = online.length + (state.local ? 0 : 1);
  $('noStreamers').hidden = nStreaming > 0;
  $('peopleCount').textContent = state.peers.size + 1;
  updateEmpty();
}
// Click (or Enter/Space) on a streamer: watch / stop watching.
$('streamingList').onclick = (e) => {
  const li = e.target.closest('li.streamer');
  if (li) setWatch(li.dataset.id, !state.watching.has(li.dataset.id));
};
$('streamingList').onkeydown = (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li.streamer')) { e.preventDefault(); e.target.click(); }
};

// People / Chat tabs; Chat shows how many messages arrived while you were on People.
let chatUnread = 0;
function showSide(name) {
  document.querySelectorAll('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.side === name));
  $('sidePeople').hidden = name !== 'people';
  $('sideChat').hidden = name !== 'chat';
  if (name === 'chat') {
    chatUnread = 0; $('chatUnread').hidden = true;
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    $('chatInput').focus();
  }
}
document.querySelectorAll('.side-tab').forEach((t) => { t.onclick = () => showSide(t.dataset.side); });
function noteUnread() {
  if (!$('sideChat').hidden) return;
  chatUnread++;
  $('chatUnread').textContent = chatUnread > 99 ? '99+' : String(chatUnread);
  $('chatUnread').hidden = false;
}

function addChat(name, text, mine = false) {
  if (!mine) noteUnread();
  const log = $('chatLog');
  const d = document.createElement('div'); d.className = 'msg';
  d.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function sysChat(text) {
  const log = $('chatLog');
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}

// ------------------------------------------------------------------ room lifecycle
function enterRoom() {
  $('join').hidden = true; $('room').hidden = false;
  $('roomName').textContent = state.room;
  if (!native) history.replaceState(null, '', '#' + encodeURIComponent(state.room));
  document.title = `TwinCast · ${state.room}`;
}

function resetRoom() {
  annReset();
  for (const id of [...state.peers.keys()]) removePeer(id);
  state.myId = null;
}

function leave() {
  stopShare();
  send({ type: 'leave' });
  state.leaving = true;
  resetRoom();
  if (state.ws) state.ws.close();
  $('chatLog').innerHTML = '';
  showSide('people'); chatUnread = 0; $('chatUnread').hidden = true;
  $('room').hidden = true; $('join').hidden = false;
  document.title = 'TwinCast';
}

// Opens the room in any browser; desktop-app friends paste the server part into "Server address".
function inviteLink() { return `${state.serverHttp}/#${encodeURIComponent(state.room)}`; }

$('shareBtn').onclick = startShare;
$('stopBtn').onclick = stopShare;
$('changeBtn').onclick = changeShare;
$('previewBtn').onclick = togglePreview;
$('leaveBtn').onclick = leave;
$('copyLinkBtn').onclick = async () => {
  const link = inviteLink();
  try { await navigator.clipboard.writeText(link); toast(tr('room.inviteCopied', { link })); }
  catch { prompt(tr('room.copyPrompt'), link); }
  if (/\/\/(localhost|127\.0\.0\.1)/.test(link)) toast(tr('room.localOnly'), 7000);
};
$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  send({ type: 'chat', text }); addChat(state.myName, text, true); $('chatInput').value = '';
};
window.addEventListener('pagehide', () => { send({ type: 'leave' }); state.leaving = true; });

if (browserShareProblem()) {
  $('shareBtn').title = browserShareProblem();
  $('shareBtn').classList.replace('primary', 'secondary');
  $('shareBtn').querySelector('.lbl').textContent = window.isSecureContext ? tr('share.btnUnsupported') : tr('share.btnNeedsHttps');
}
initJoin();
