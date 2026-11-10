/* Annotations: data model + drawing, shared by the room page and the sharer's overlay.
 * Positions are fractions (0..1) of the shared picture; sizes are thousandths of its
 * height, so a mark looks the same on a small tile and on the sharer's real screen. */
'use strict';

const Annot = (() => {
  const COLORS = ['#ff3b30', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ffffff', '#000000'];
  const STAMPS = { check: '✔', cross: '✖', star: '★', heart: '❤', arrow: '➜', question: '?' };
  const SIZES = { s: 3, m: 6, l: 12 };
  const GLOW_FADE_MS = 1200;   // spotlight fades out this long after you lift the mouse
  const STALE_MS = 4000;       // a stroke in progress that stops updating (sender dropped)

  class Board {
    constructor() { this.shapes = new Map(); this.drafts = new Map(); this.enabled = true; }
    reset(shapes = [], enabled = true) {
      this.shapes = new Map(shapes.map((s) => [s.id, s])); this.drafts.clear(); this.enabled = enabled;
    }
    add(s) { this.shapes.set(s.id, s); this.drafts.delete(s.id); }
    remove(ids) { for (const id of ids) { this.shapes.delete(id); this.drafts.delete(id); } }
    // Strokes arrive in pieces while being drawn: { id, from, points[] }.
    draft(d, now = performance.now()) {
      let cur = this.drafts.get(d.id);
      if (!cur || d.from === 0) cur = { ...d, points: [] };
      if (d.from <= cur.points.length) { cur.points.length = d.from; cur.points.push(...d.points); }
      cur.updated = now;
      if (d.done) { cur.done = true; cur.doneAt = now; }
      this.drafts.set(d.id, cur);
      if (d.done && d.kind === 'pen') this.drafts.delete(d.id); // the final 'add' follows
    }
    // Apply a server/overlay message. Returns true if something changed.
    apply(m) {
      switch (m.op) {
        case 'state': this.reset(m.shapes, m.enabled); return true;
        case 'add': this.add(m.shape); return true;
        case 'remove': this.remove(m.ids); return true;
        case 'draft': this.draft(m.draft); return true;
        case 'enabled': this.enabled = m.enabled; return true;
        case 'reset': this.reset(); return true;
      }
      return false;
    }
  }

  // Where the picture actually is inside a box (video uses object-fit: contain).
  function contentRect(cw, ch, vw, vh) {
    if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
    const s = Math.min(cw / vw, ch / vh);
    const w = vw * s, h = vh * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }
  const px = (p, r) => [r.x + p[0] * r.w, r.y + p[1] * r.h];
  const lineWidth = (s, r) => Math.max(1.5, (s.size / 1000) * r.h);
  const stampPx = (s, r) => Math.max(16, (s.size / 1000) * r.h * 7);
  const textPx = (s, r) => Math.max(11, (s.size / 1000) * r.h * 4);
  const font = (size) => `600 ${size}px system-ui, "Segoe UI", sans-serif`;

  function strokePath(ctx, pts, r) {
    ctx.beginPath();
    const a = px(pts[0], r);
    ctx.moveTo(a[0], a[1]);
    if (pts.length === 1) { ctx.lineTo(a[0] + 0.01, a[1]); return; }
    for (let i = 1; i < pts.length - 1; i++) { // smooth through midpoints
      const p = px(pts[i], r), q = px(pts[i + 1], r);
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    const z = px(pts[pts.length - 1], r);
    ctx.lineTo(z[0], z[1]);
  }

  function drawShape(ctx, s, r, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.kind === 'pen') {
      ctx.strokeStyle = s.color; ctx.lineWidth = lineWidth(s, r);
      strokePath(ctx, s.points, r); ctx.stroke();
    } else if (s.kind === 'glow') {
      const w = lineWidth(s, r) * 1.6;
      ctx.shadowColor = s.color; ctx.shadowBlur = w * 3;
      ctx.strokeStyle = s.color; ctx.lineWidth = w;
      strokePath(ctx, s.points, r); ctx.stroke(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, w * 0.35);
      ctx.stroke();
    } else if (s.kind === 'stamp') {
      const [x, y] = px([s.x, s.y], r), size = stampPx(s, r);
      ctx.font = font(size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, size / 10); ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(STAMPS[s.stamp] || '?', x, y);
      ctx.fillStyle = s.color; ctx.fillText(STAMPS[s.stamp] || '?', x, y);
    } else if (s.kind === 'text') {
      const [x, y] = px([s.x, s.y], r), size = textPx(s, r);
      ctx.font = font(size); ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = s.color === '#000000' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)';
      ctx.strokeText(s.text, x, y);
      ctx.fillStyle = s.color; ctx.fillText(s.text, x, y);
    }
    ctx.restore();
  }

  function nameTag(ctx, name, x, y, alpha) {
    if (!name) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
    const w = ctx.measureText(name).width + 10;
    ctx.fillStyle = 'rgba(20,16,40,0.85)';
    ctx.beginPath(); ctx.roundRect(x + 8, y + 8, w, 18, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(name, x + 13, y + 17);
    ctx.restore();
  }

  // Draws the whole board. Returns true while something is animating (fading spotlight).
  function render(ctx, board, r, now = performance.now()) {
    for (const s of board.shapes.values()) drawShape(ctx, s, r);
    let animating = false;
    for (const [id, d] of board.drafts) {
      let alpha = 1;
      if (d.kind === 'glow') {
        const since = d.done ? now - d.doneAt : now - d.updated - STALE_MS;
        if (since > 0) alpha = 1 - since / GLOW_FADE_MS;
        animating = true;
      } else if (now - d.updated > STALE_MS) alpha = 0;
      if (alpha <= 0) { board.drafts.delete(id); continue; }
      if (!d.points.length) continue;
      drawShape(ctx, d, r, alpha);
      if (!d.done && d.showName !== false) { const [x, y] = px(d.points[d.points.length - 1], r); nameTag(ctx, d.name, x, y, alpha); }
    }
    return animating;
  }

  // Is the point (in px) on this mark? Used by the eraser.
  function hit(ctx, s, r, x, y, radius) {
    if (s.kind === 'pen') {
      const lim = lineWidth(s, r) / 2 + radius;
      const pts = s.points.map((p) => px(p, r));
      if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= lim;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= lim) return true;
      }
      return false;
    }
    const [sx, sy] = px([s.x, s.y], r);
    if (s.kind === 'stamp') { const h = stampPx(s, r) / 2 + radius; return Math.abs(x - sx) <= h && Math.abs(y - sy) <= h; }
    if (s.kind === 'text') {
      const size = textPx(s, r);
      ctx.save(); ctx.font = font(size); const w = ctx.measureText(s.text).width; ctx.restore();
      return x >= sx - radius && x <= sx + w + radius && y >= sy - radius && y <= sy + size * 1.2 + radius;
    }
    return false;
  }

  // Keep a canvas the size of its box, sharp on high-DPI screens. Returns the 2D context.
  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  return { COLORS, STAMPS, SIZES, Board, contentRect, render, drawShape, hit, fitCanvas, textPx, font };
})();
