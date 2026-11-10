/* TwinCast server dashboard: polls /api/admin/stats every 2 seconds. */
'use strict';

const $ = (id) => document.getElementById(id);
const KEY = 'ss.adminPassword';
let password = null;
let timer = null;
let last = null;

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function saved() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; } }
function save(pw, remember) {
  try {
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
    if (pw) (remember ? localStorage : sessionStorage).setItem(KEY, pw);
  } catch {}
}

function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
function clock(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function dateTime(t) { return new Date(t).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
const num = (n) => Number(n).toLocaleString();

function showLogin(message) {
  clearInterval(timer); timer = null;
  $('dash').hidden = true; $('login').hidden = false;
  $('loginError').textContent = message || '';
  $('pwInput').focus();
}

async function poll() {
  let res;
  try {
    res = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${password}` }, cache: 'no-store' });
  } catch {
    $('live').classList.add('down'); $('liveText').textContent = 'Server unreachable';
    return 'down';
  }
  if (res.status === 401 || res.status === 429) {
    const body = await res.json().catch(() => ({}));
    save(null); password = null;
    showLogin(body.error || 'Wrong password');
    return 'denied';
  }
  if (!res.ok) { $('live').classList.add('down'); $('liveText').textContent = `Error ${res.status}`; return 'down'; }
  last = await res.json();
  $('live').classList.remove('down'); $('liveText').textContent = 'Live';
  render(last);
  return 'ok';
}

function render(d) {
  const { server: s, now: n, totals: t } = d;
  $('version').textContent = `v${s.version}`;
  $('sUsers').textContent = num(n.users);
  const away = d.rooms.reduce((k, r) => k + r.users.filter((u) => !u.online).length, 0);
  $('sUsersSub').textContent = away ? `${away} reconnecting` : `${num(n.sockets)} open connection${n.sockets === 1 ? '' : 's'}`;
  $('sRooms').textContent = num(n.rooms);
  $('sRoomsSub').textContent = `${num(t.roomsCreated)} created since start`;
  $('sSharing').textContent = num(n.sharing);
  $('sPeak').textContent = num(t.peakUsers);
  $('sPeakSub').textContent = t.peakUsers ? `at ${dateTime(t.peakAt)}` : '';
  $('sUptime').textContent = duration(s.now - s.startedAt);
  $('sUptimeSub').textContent = `since ${dateTime(s.startedAt)}`;
  $('sCpu').textContent = `${s.cpuPercent}%`;
  $('sMem').textContent = `CPU · ${s.memoryMB} MB RAM`;

  renderRooms(d);

  $('events').innerHTML = d.events.length
    ? d.events.map((e) => `<li><time title="${esc(new Date(e.at).toLocaleString())}">${clock(e.at)}</time><span><b>${esc(e.room)}</b> · ${esc(e.text)}</span></li>`).join('')
    : '<li class="muted" style="display:block">Nothing yet.</li>';

  $('totals').innerHTML = [
    ['People joined', num(t.totalJoins)],
    ['Connections', num(t.totalConnections)],
    ['Rooms created', num(t.roomsCreated)],
    ['Connection offers relayed', num(t.signals)],
    ['Chat messages', num(t.chats)],
    ['Marks drawn', num(t.annotations || 0)],
    ['Data received', bytes(t.bytesIn)],
    ['Data sent', bytes(t.bytesOut)],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  $('serverInfo').innerHTML = [
    ['Version', s.version], ['Port', s.port], ['Node.js', s.node], ['System', s.platform],
    ['Memory', `${s.memoryMB} MB (heap ${s.heapMB} MB)`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
}

// Same line icons as the room page.
const ICON_PATHS = {
  app: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  browser: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  unknown: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
};
const DEVICES = { app: 'Windows app', browser: 'PC browser', mobile: 'Mobile' };
function device(type) {
  const kind = DEVICES[type] ? type : 'unknown';
  const label = DEVICES[type] || 'Unknown';
  return `<span class="client ${kind}" title="${label}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[kind]}</svg></span><span class="device-label">${label}</span>`;
}

function renderRooms(d) {
  const q = $('filterInput').value.trim().toLowerCase();
  const rooms = d.rooms.filter((r) => !q || r.name.includes(q) || r.users.some((u) => u.name.toLowerCase().includes(q)));
  if (!rooms.length) {
    $('rooms').innerHTML = `<div class="empty">${d.rooms.length ? 'No room matches the filter.' : 'No rooms open right now.'}</div>`;
    return;
  }
  const now = d.server.now;
  $('rooms').innerHTML = rooms.map((r) => {
    const sharing = r.users.filter((u) => u.sharing).length;
    const rows = r.users.map((u) => `
      <tr>
        <td>${esc(u.name)}</td>
        <td class="device">${device(u.client)}</td>
        <td><span class="state ${u.online ? '' : 'away'}"><span class="dot"></span>${u.online ? 'Online' : 'Reconnecting…'}</span></td>
        <td>${u.sharing ? `<span class="tag" title="${esc(u.sharing)}">Sharing</span>` : '<span class="muted">Watching</span>'}</td>
        <td class="num">${duration(now - u.joinedAt)}</td>
        <td class="num hide-sm">${u.reconnects}</td>
        <td class="ip hide-sm">${esc(u.ip || '')}</td>
      </tr>`).join('');
    return `
      <div class="room">
        <div class="room-head">
          <span class="name">${esc(r.name)}</span>
          <span class="badge">${r.users.length} ${r.users.length === 1 ? 'person' : 'people'}</span>
          ${sharing ? `<span class="tag">${sharing} sharing</span>` : ''}
          <span class="meta">open for ${duration(now - r.createdAt)}</span>
        </div>
        <table class="users">
          <thead><tr><th>Name</th><th>Device</th><th>Status</th><th>Doing</th><th>In room</th><th class="hide-sm">Reconnects</th><th class="hide-sm">Address</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

async function start(pw, remember) {
  password = pw;
  const r = await poll();
  if (r === 'denied') return;
  if (r === 'down' && !last) { showLogin('Could not reach the server.'); return; }
  if (remember !== undefined) save(pw, remember);
  $('login').hidden = true; $('dash').hidden = false;
  clearInterval(timer);
  timer = setInterval(poll, 2000);
}

$('loginForm').onsubmit = (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  start($('pwInput').value, $('rememberInput').checked);
};
$('logoutBtn').onclick = () => { save(null); password = null; last = null; $('pwInput').value = ''; showLogin(); };
$('filterInput').oninput = () => { if (last) renderRooms(last); };

const pw = saved();
if (pw) start(pw); else showLogin();
