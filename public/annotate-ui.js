/* Annotation tools in the room: Draw, Spotlight, Stamp, Text, Eraser, Undo/Redo, Clear.
 * Drawing: desktop app and PC browsers. Phones/tablets only see the marks.
 * Being drawn on: only screens shared from the desktop app (a browser can't show marks on the sharer's screen).
 * Uses globals from app.js (state, send, native, toast, load, store, toggleFocus, $). */
'use strict';

const ann = {
  boards: new Map(),   // sharer id -> Annot.Board
  undo: new Map(),     // sharer id -> [{ t: 'add' | 'remove', shapes }]
  redo: new Map(),
  active: null,        // { target, tile, bar, canvas, stroke, erased, input }
  tool: load('ss.ann.tool') || 'pen',
  color: load('ss.ann.color') || Annot.COLORS[0],
  size: load('ss.ann.size') || 'm',
  stamp: load('ss.ann.stamp') || 'check',
  seq: 0,
  raf: 0,
  overlayOpen: false,
};
// Phones and tablets: no drawing (awkward with a finger, easy to trigger while scrolling).
const CAN_DRAW = CLIENT_TYPE !== 'mobile';
const TOOL_KEYS = { d: 'pen', s: 'glow', m: 'stamp', t: 'text', e: 'eraser' };

const boardFor = (target) => {
  let b = ann.boards.get(target);
  if (!b) { b = new Annot.Board(); ann.boards.set(target, b); }
  return b;
};
const tileTarget = (tile) => (tile.dataset.id === 'me' ? state.myId : tile.dataset.id);
const tileOf = (target) => document.querySelector(`.tile[data-id="${target === state.myId ? 'me' : target}"]`);
const isMine = (target) => target === state.myId;
const newId = () => `${state.myId}:${Date.now().toString(36)}${(ann.seq++).toString(36)}`;
const stack = (map, target) => { if (!map.has(target)) map.set(target, []); return map.get(target); };

function pictureRect(tile) {
  const v = tile.querySelector('video');
  return Annot.contentRect(tile.clientWidth, tile.clientHeight, v.videoWidth, v.videoHeight);
}

// ------------------------------------------------------------------ drawing
function redrawAnn() { if (!ann.raf) ann.raf = requestAnimationFrame(drawAll); }
function drawAll() {
  ann.raf = 0;
  let animating = false;
  for (const tile of document.querySelectorAll('.tile')) {
    const canvas = tile.querySelector('canvas.ann');
    if (!canvas || tile.classList.contains('collapsed')) continue;
    const ctx = Annot.fitCanvas(canvas);
    const board = ann.boards.get(tileTarget(tile));
    if (board) animating = Annot.render(ctx, board, pictureRect(tile)) || animating;
  }
  if (animating) redrawAnn();
}
new ResizeObserver(redrawAnn).observe($('stage'));

// The sharer's own marks are also mirrored to the transparent overlay on their real screen.
function toOverlay(m) {
  if (native && ann.overlayOpen && m.target === state.myId) native.overlaySend(m);
}

// ------------------------------------------------------------------ messages
function onAnnMessage(m) {
  const b = boardFor(m.target);
  b.apply(m);
  if (m.op === 'reset') { ann.boards.delete(m.target); ann.undo.delete(m.target); ann.redo.delete(m.target); }
  const a = ann.active;
  if (a && a.target === m.target && !isMine(m.target) && (m.op === 'reset' || !b.enabled)) {
    stopAnnotating();
    if (m.op !== 'reset') toast(tr('ann.offBySharer', { name: (state.peers.get(m.target) || {}).name || tr('ann.theSharer') }));
  }
  toOverlay(m);
  updateAnnUi();
  redrawAnn();
}

// Local changes: apply here, tell the server (it relays to the room), mirror to overlay.
function doAdd(target, shapes) {
  for (const s of shapes) {
    // New marks are ours; marks put back by undo keep their original author.
    const shape = s.author ? s : Object.assign(s, { author: state.myId, name: state.myName });
    const m = { op: 'add', target, shape };
    boardFor(target).apply(m); send({ type: 'ann', ...m }); toOverlay(m);
  }
  redrawAnn();
}
function doRemove(target, shapes) {
  if (!shapes.length) return;
  const m = { op: 'remove', target, ids: shapes.map((s) => s.id) };
  boardFor(target).apply(m); send({ type: 'ann', ...m }); toOverlay(m);
  redrawAnn();
}
function doDraft(target, d) {
  const draft = { ...d, author: state.myId, name: state.myName };
  boardFor(target).draft({ ...draft, showName: false });
  send({ type: 'ann', op: 'draft', target, ...d });
  toOverlay({ op: 'draft', target, draft });
  redrawAnn();
}
function record(target, action) {
  stack(ann.undo, target).push(action);
  if (ann.undo.get(target).length > 200) ann.undo.get(target).shift();
  ann.redo.set(target, []);
  updateAnnUi();
}

function undo(target) {
  const a = stack(ann.undo, target).pop();
  if (!a) return;
  if (a.t === 'add') doRemove(target, a.shapes); else doAdd(target, a.shapes);
  stack(ann.redo, target).push(a);
  updateAnnUi();
}
function redo(target) {
  const a = stack(ann.redo, target).pop();
  if (!a) return;
  if (a.t === 'add') doAdd(target, a.shapes); else doRemove(target, a.shapes);
  stack(ann.undo, target).push(a);
  updateAnnUi();
}
function clearMarks(target, all) {
  const board = ann.boards.get(target);
  if (!board) return;
  const shapes = [...board.shapes.values()].filter((s) => (all && isMine(target)) || s.author === state.myId);
  if (!shapes.length) return toast(all ? tr('ann.noMarks') : tr('ann.noMine'), 2000);
  doRemove(target, shapes);
  record(target, { t: 'remove', shapes });
}

// ------------------------------------------------------------------ toolbar
function startAnnotating(tile) {
  if (!CAN_DRAW || tile.dataset.id === 'me') return;
  stopAnnotating();
  const target = tileTarget(tile);
  const board = ann.boards.get(target);
  if (!board || (!board.enabled && !isMine(target))) return toast(tr('ann.disabledHere'), 2500);
  if (!tile.classList.contains('focus')) toggleFocus(tile);
  const bar = document.createElement('div');
  bar.className = 'ann-bar';
  const sizeDot = (k) => { const d = { s: 5, m: 9, l: 14 }[k]; return `<i style="width:${d}px;height:${d}px"></i>`; };
  bar.innerHTML = `
    <button data-tool="pen" title="${tr('ann.toolDraw')}">${svgIcon('pencil')}</button>
    <button data-tool="glow" title="${tr('ann.toolSpot')}">${svgIcon('highlighter')}</button>
    <button data-tool="stamp" title="${tr('ann.toolStamp')}">${svgIcon('stamp')}</button>
    <button data-tool="text" title="${tr('ann.toolText')}">${svgIcon('text')}</button>
    <button data-tool="eraser" title="${tr('ann.toolEraser')}">${svgIcon('eraser')}</button>
    <span class="sep"></span>
    ${Annot.COLORS.map((c) => `<button class="swatch" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('')}
    <span class="sep"></span>
    ${['s', 'm', 'l'].map((k) => `<button class="size" data-size="${k}" title="${{ s: tr('ann.thin'), m: tr('ann.medium'), l: tr('ann.thick') }[k]}">${sizeDot(k)}</button>`).join('')}
    <span class="sep"></span>
    <button data-act="undo" title="${tr('ann.undo')}">${svgIcon('undo')}</button>
    <button data-act="redo" title="${tr('ann.redo')}">${svgIcon('redo')}</button>
    <button data-act="clear" title="${tr('ann.clear')}">${svgIcon('broom')}</button>
    <button data-act="close" title="${tr('ann.close')}">${svgIcon('close')}</button>
    <div class="ann-pop row stamps" hidden>${Object.entries(Annot.STAMPS).map(([k, v]) => `<button data-stamp="${k}" title="${k}">${v}</button>`).join('')}</div>
    <div class="ann-pop clears" hidden>
      <button data-clear="mine">${tr('ann.clearMine')}</button>
      ${isMine(target) ? `<button data-clear="all">${tr('ann.clearAll')}</button>` : ''}
    </div>`;
  const pops = { stamps: bar.querySelector('.stamps'), clears: bar.querySelector('.clears') };
  const placePop = (pop, btn) => { pop.style.left = `${btn.offsetLeft}px`; };
  bar.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) {
      setTool(b.dataset.tool);
      pops.clears.hidden = true;
      if (b.dataset.tool === 'stamp') { pops.stamps.hidden = !pops.stamps.hidden; placePop(pops.stamps, b); } else pops.stamps.hidden = true;
    } else if (b.dataset.color) { ann.color = b.dataset.color; store('ss.ann.color', ann.color); updateAnnUi(); }
    else if (b.dataset.size) { ann.size = b.dataset.size; store('ss.ann.size', ann.size); updateAnnUi(); }
    else if (b.dataset.stamp) {
      ann.stamp = b.dataset.stamp; store('ss.ann.stamp', ann.stamp); setTool('stamp');
      pops.stamps.hidden = true;
    } else if (b.dataset.clear) { clearMarks(target, b.dataset.clear === 'all'); pops.clears.hidden = true; }
    else if (b.dataset.act === 'undo') undo(target);
    else if (b.dataset.act === 'redo') redo(target);
    else if (b.dataset.act === 'close') stopAnnotating();
    else if (b.dataset.act === 'clear') { pops.stamps.hidden = true; pops.clears.hidden = !pops.clears.hidden; placePop(pops.clears, b); }
  };
  bar.onpointerdown = (e) => e.stopPropagation();
  tile.appendChild(bar);
  const canvas = tile.querySelector('canvas.ann');
  canvas.onpointerdown = onPointerDown;
  canvas.onpointermove = onPointerMove;
  canvas.onpointerup = canvas.onpointercancel = onPointerUp;
  tile.classList.add('annotating');
  ann.active = { target, tile, bar, canvas, stroke: null, erased: null, input: null };
  setTool(ann.tool);
  updateAnnUi();
}

function stopAnnotating() {
  const a = ann.active;
  if (!a) return;
  if (a.input) commitText(true);
  if (a.stroke) finishStroke();
  a.bar.remove();
  a.tile.classList.remove('annotating', 'tool-eraser', 'tool-text');
  a.canvas.onpointerdown = a.canvas.onpointermove = a.canvas.onpointerup = a.canvas.onpointercancel = null;
  ann.active = null;
  updateAnnUi();
}

function setTool(tool) {
  ann.tool = tool; store('ss.ann.tool', tool);
  const a = ann.active;
  if (a) {
    a.tile.classList.toggle('tool-eraser', tool === 'eraser');
    a.tile.classList.toggle('tool-text', tool === 'text');
  }
  updateAnnUi();
}

// Show/refresh the Annotate buttons on tiles, the toolbar state and the sharer's controls.
function updateAnnUi() {
  for (const tile of document.querySelectorAll('.tile')) {
    const btn = tile.querySelector('.ann-btn');
    if (!btn) continue;
    // Only on other people's screens; your own share has the controls in the bottom bar.
    const target = tileTarget(tile);
    const board = ann.boards.get(target);
    const peer = state.peers.get(target);
    btn.hidden = !CAN_DRAW || !board || tile.dataset.id === 'me';
    // Drawing turned off: keep the button, greyed out, and say why.
    btn.disabled = !board || !board.enabled;
    const who = (peer && peer.name) || tr('ann.theSharer');
    btn.querySelector('.lbl').textContent = board && board.enabled ? tr('ann.annotate') : tr('ann.off');
    btn.title = board && board.enabled ? tr('ann.drawTitle')
      : peer && peer.sharing && peer.sharing.app === 'browser'
        ? tr('ann.offBrowser', { name: who })
        : tr('ann.offBySharer', { name: who });
    btn.classList.toggle('on', !!ann.active && ann.active.tile === tile);
  }
  const a = ann.active;
  if (a) {
    a.bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === ann.tool));
    a.bar.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('active', b.dataset.color === ann.color));
    a.bar.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('active', b.dataset.size === ann.size));
    a.bar.querySelector('[data-act="undo"]').disabled = !stack(ann.undo, a.target).length;
    a.bar.querySelector('[data-act="redo"]').disabled = !stack(ann.redo, a.target).length;
  }
  const mine = state.myId && ann.boards.get(state.myId);
  // Sharer: annotations switch (right of the footer) + broom = clear all marks, shown while on.
  $('annControls').hidden = !(native && state.local && mine);
  if (mine) { $('annToggle').checked = mine.enabled; $('annClearBtn').hidden = !mine.enabled; }
}

// ------------------------------------------------------------------ pointer input
function pointAt(e) {
  const a = ann.active;
  const box = a.canvas.getBoundingClientRect();
  const r = pictureRect(a.tile);
  const x = e.clientX - box.left, y = e.clientY - box.top;
  return { x, y, n: [+((x - r.x) / r.w).toFixed(4), +((y - r.y) / r.h).toFixed(4)], inside: x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h };
}

function onPointerDown(e) {
  const a = ann.active;
  if (!a || e.button !== 0) return;
  a.bar.querySelectorAll('.ann-pop').forEach((p) => { p.hidden = true; });
  if (a.input) { commitText(); return; }
  const p = pointAt(e);
  if (!p.inside && ann.tool !== 'eraser') return;
  e.preventDefault();
  a.canvas.setPointerCapture(e.pointerId);
  const size = Annot.SIZES[ann.size];
  if (ann.tool === 'pen' || ann.tool === 'glow') {
    a.stroke = { id: newId(), kind: ann.tool, color: ann.color, size, points: [p.n], sent: 0, lastSend: 0, lastPx: [p.x, p.y] };
    flushStroke(false);
  } else if (ann.tool === 'stamp') {
    const s = { id: newId(), kind: 'stamp', stamp: ann.stamp, color: ann.color, size, x: p.n[0], y: p.n[1] };
    doAdd(a.target, [s]); record(a.target, { t: 'add', shapes: [s] });
  } else if (ann.tool === 'text') {
    openText(p);
  } else if (ann.tool === 'eraser') {
    a.erased = [];
    eraseAt(p);
  }
}

function onPointerMove(e) {
  const a = ann.active;
  if (!a) return;
  if (a.stroke) {
    const p = pointAt(e);
    if (Math.hypot(p.x - a.stroke.lastPx[0], p.y - a.stroke.lastPx[1]) < 2 || a.stroke.points.length >= 4000) return;
    a.stroke.lastPx = [p.x, p.y];
    a.stroke.points.push([Math.max(0, Math.min(1, p.n[0])), Math.max(0, Math.min(1, p.n[1]))]);
    if (performance.now() - a.stroke.lastSend > 40) flushStroke(false); else redrawLocalStroke();
  } else if (a.erased) eraseAt(pointAt(e));
}

function onPointerUp() {
  const a = ann.active;
  if (!a) return;
  if (a.stroke) finishStroke();
  if (a.erased) {
    if (a.erased.length) record(a.target, { t: 'remove', shapes: a.erased });
    a.erased = null;
  }
}

function redrawLocalStroke() {
  const s = ann.active.stroke;
  boardFor(ann.active.target).draft({ id: s.id, kind: s.kind, color: s.color, size: s.size, author: state.myId, from: 0, points: s.points, showName: false });
  redrawAnn();
}

function flushStroke(done) {
  const a = ann.active, s = a.stroke;
  doDraft(a.target, { id: s.id, kind: s.kind, color: s.color, size: s.size, from: s.sent, points: s.points.slice(s.sent), done });
  s.sent = s.points.length;
  s.lastSend = performance.now();
}

function finishStroke() {
  const a = ann.active, s = a.stroke;
  flushStroke(true);
  a.stroke = null;
  if (s.kind === 'pen') {
    const shape = { id: s.id, kind: 'pen', color: s.color, size: s.size, points: s.points };
    doAdd(a.target, [shape]); record(a.target, { t: 'add', shapes: [shape] });
  }
}

function eraseAt(p) {
  const a = ann.active;
  const board = boardFor(a.target);
  const ctx = a.canvas.getContext('2d');
  const r = pictureRect(a.tile);
  const hits = [...board.shapes.values()].filter((s) => (isMine(a.target) || s.author === state.myId) && Annot.hit(ctx, s, r, p.x, p.y, 8));
  if (!hits.length) return;
  doRemove(a.target, hits);
  a.erased.push(...hits);
}

// Text: a small input where you clicked; Enter places it, Esc cancels.
function openText(p) {
  const a = ann.active;
  const r = pictureRect(a.tile);
  const input = document.createElement('input');
  input.className = 'ann-text';
  input.maxLength = 200;
  input.placeholder = tr('ann.textPlaceholder');
  const fontPx = Annot.textPx({ size: Annot.SIZES[ann.size] }, r);
  Object.assign(input.style, { left: `${p.x}px`, top: `${p.y}px`, font: Annot.font(fontPx), color: ann.color });
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitText();
    else if (e.key === 'Escape') commitText(true);
  };
  input.onblur = () => setTimeout(() => { if (ann.active && ann.active.input && ann.active.input.el === input) commitText(); }, 0);
  a.tile.appendChild(input);
  a.input = { el: input, n: p.n, color: ann.color, size: Annot.SIZES[ann.size] };
  setTimeout(() => input.focus(), 0);
}

function commitText(cancel) {
  const a = ann.active, t = a && a.input;
  if (!t) return;
  a.input = null;
  const text = t.el.value.trim();
  t.el.remove();
  if (cancel || !text) return;
  const s = { id: newId(), kind: 'text', text, color: t.color, size: t.size, x: t.n[0], y: t.n[1] };
  doAdd(a.target, [s]); record(a.target, { t: 'add', shapes: [s] });
}

document.addEventListener('keydown', (e) => {
  const a = ann.active;
  if (!a || e.target.matches('input, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(a.target); }
  else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(a.target); }
  else if (k === 'escape') stopAnnotating();
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
});

// ------------------------------------------------------------------ hooks called from app.js
function annTileCreated(tile) {
  const btn = tile.querySelector('.ann-btn');
  if (btn) btn.onclick = () => (ann.active && ann.active.tile === tile ? stopAnnotating() : startAnnotating(tile));
  const v = tile.querySelector('video');
  v.addEventListener('resize', redrawAnn);
  v.addEventListener('loadedmetadata', redrawAnn);
  updateAnnUi();
  redrawAnn();
}
function annTileRemoved(tile) { if (ann.active && ann.active.tile === tile) stopAnnotating(); }

// Sharer: "Annotations: on/off" (remembered) and "Clear all marks".
function annAllowsOnShare() { return !!native && load('ss.annAllow') !== '0'; }
// Remove every mark from my own screen (no undo: used when turning annotations off / changing screen).
function wipeMyMarks() {
  const board = state.myId && ann.boards.get(state.myId);
  if (!board) return;
  const shapes = [...board.shapes.values()];
  if (shapes.length) doRemove(state.myId, shapes);
  ann.undo.delete(state.myId); ann.redo.delete(state.myId);
}
$('annToggle').onchange = () => {
  const board = state.myId && ann.boards.get(state.myId);
  if (!board) return;
  const m = { op: 'enabled', target: state.myId, enabled: $('annToggle').checked };
  board.apply(m); send({ type: 'ann', ...m }); toOverlay(m);
  store('ss.annAllow', m.enabled ? '1' : '0');
  if (!m.enabled) wipeMyMarks(); // off = no marks left on your screen
  toast(m.enabled ? tr('ann.enabledToast') : tr('ann.disabledToast'), 3000);
  updateAnnUi();
};
$('annClearBtn').onclick = () => clearMarks(state.myId, true);

async function annShareStarted(sourceId) {
  if (!native || !sourceId) return;
  try { ann.overlayOpen = await native.overlayOpen(sourceId); } catch { ann.overlayOpen = false; }
  const b = state.myId && ann.boards.get(state.myId);
  if (b) toOverlay({ op: 'state', target: state.myId, enabled: b.enabled, shapes: [...b.shapes.values()] });
}
// Shared screen changed: marks belonged to the old one; move the overlay to the new one.
async function annShareChanged(sourceId) {
  if (ann.active && isMine(ann.active.target)) stopAnnotating();
  wipeMyMarks();
  if (native) { native.overlayClose(); ann.overlayOpen = false; }
  await annShareStarted(sourceId);
  updateAnnUi();
}
function annShareStopped() {
  if (ann.active && isMine(ann.active.target)) stopAnnotating();
  if (native) native.overlayClose();
  ann.overlayOpen = false;
  if (state.myId) { ann.boards.delete(state.myId); ann.undo.delete(state.myId); ann.redo.delete(state.myId); }
  updateAnnUi();
}
function annReset() {
  stopAnnotating();
  ann.boards.clear(); ann.undo.clear(); ann.redo.clear();
  redrawAnn();
}
