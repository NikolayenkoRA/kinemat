import { t, lang, setLang, applyStatic } from './i18n.js';
import { initTheory, refreshTheory, toggleTheory, theoryAnalysis, setTheoryTab } from './theory-ui.js';
import { emptyMech, addJoint, addLink, deleteItems, setDriver, setLinearDriver, fixDriver, dof, jointById, linkById, linksOfJoint, camById, addCam, rebuildCam, cleanup, newId, validate, mergeLinks, chainBars, addWall, wallById } from './model.js';
import { floorFor } from './walls.js';
import { compile, advance, tangent, dragTo, dragPath, pointOf, localGrab, driverAngle, sweep, angCont, railFrame, saveAngles, loadAngles } from './solver.js';
import { camProfile, camLaw, LAWS, camBetas } from './cam.js';
import { PRESETS, PRESET_KEYS } from './presets.js';
import { drawChart } from './chart.js';
import { drawGear, drawRack, drawCam, camWorld } from './gfx.js';

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#4f46e5', '#65a30d', '#db2777', '#0d9488'];
const LS = 'linkage-web:mech';
const D2R = Math.PI / 180;

let mech = loadLocal() || PRESETS.fourbar();
const st = {
  mode: 'edit', tool: 'select', selSet: new Map(), hover: null, draft: [], wdraft: [], cursor: null, meshFirst: null, space: false,
  view: { x: 0, y: 0, s: 4 }, snap: true, grid: 5, undo: [], redo: [], geom: 0,
};
const sim = { sys: null, ver: -1, X: null, theta: 0, dir: 1, playing: false, mul: 1, traces: new Map(), V: null, A: null, Tprev: null, thPrev: null, grab: null, target: null };
let chart = null;
let action = null;
const pointers = new Map();

// ---------- выделение ----------
const key = it => it.kind + ':' + it.id;
const isSel = (kind, id) => st.selSet.has(kind + ':' + id);
const selItems = () => [...st.selSet.values()].filter(it => exists(it));
const exists = it => it.kind === 'joint' ? !!jointById(mech, it.id) : it.kind === 'link' ? !!linkById(mech, it.id) : it.kind === 'wall' ? !!wallById(mech, it.id) : !!camById(mech, it.id);
function primary() { const a = selItems(); return a.length === 1 ? a[0] : null; }
function selectOnly(it) { st.selSet.clear(); if (it) st.selSet.set(key(it), it); }
function toggleSel(it) { const k = key(it); st.selSet.has(k) ? st.selSet.delete(k) : st.selSet.set(k, it); }

// ---------- хранение / история ----------
function loadLocal() { try { const s = localStorage.getItem(LS); return s ? validate(JSON.parse(s)) : null; } catch { return null; } }
function saveLocal() { try { localStorage.setItem(LS, JSON.stringify(mech)); } catch {} }
function pushUndo() { st.undo.push(JSON.stringify(mech)); if (st.undo.length > 200) st.undo.shift(); st.redo = []; }
function changed(geom = true) { if (geom) { st.geom++; chart = null; } cleanup(mech); saveLocal(); renderPanels(); if (geom) autoChart(); refreshTheory(); }
function undo() { if (!st.undo.length || st.mode !== 'edit') return; st.redo.push(JSON.stringify(mech)); mech = validate(JSON.parse(st.undo.pop())); selectOnly(null); changed(); }
function redo() { if (!st.redo.length || st.mode !== 'edit') return; st.undo.push(JSON.stringify(mech)); mech = validate(JSON.parse(st.redo.pop())); selectOnly(null); changed(); }
function setMech(m) { pushUndo(); mech = m; selectOnly(null); st.draft = []; st.draftNew = []; $('#chartMsg').textContent = ''; changed(); fitView(); }

// ---------- система и позиции ----------
function ensureSys() {
  if (sim.ver !== st.geom || !sim.sys) {
    sim.sys = compile(mech); sim.ver = st.geom; sim.X = sim.sys.X0.slice(); sim.theta = sim.sys.theta0;
    sim.dir = mech.driver?.dir ?? 1; sim.traces.clear(); sim.V = sim.A = sim.Tprev = sim.contact = null; sim.playing = false;
    updateV();
  }
  return sim.sys;
}
const live = () => st.mode !== 'edit';
const isLin = () => mech.driver?.kind === 'lin';
function P(id) {
  if (live() && sim.sys) { const i = sim.sys.idx.get(id); if (i !== undefined) return [sim.X[2 * i], sim.X[2 * i + 1]]; }
  const j = jointById(mech, id); return [j.x, j.y];
}
const inputRate = () => mech.driver ? (isLin() ? mech.driver.speed : mech.driver.speed * D2R) : 0;
const omega = () => inputRate() * sim.dir;
function updateV() {
  const s = sim.sys; if (!s || !s.driver) { sim.V = sim.A = null; return; }
  const T = tangent(s, sim.X, sim.theta), w = omega();
  sim.V = T.map(v => v * w);
  if (sim.Tprev && Math.abs(sim.theta - sim.thPrev) > 1e-9) sim.A = T.map((v, q) => (v - sim.Tprev[q]) / (sim.theta - sim.thPrev) * w * w);
  sim.Tprev = T; sim.thPrev = sim.theta;
}
// угол поворота тела относительно положения в редакторе
function rotDelta(cId, oId) { // поворот отрезка center→other относительно положения в редакторе
  if (!live() || !sim.sys || !oId) return 0;
  const a = jointById(mech, cId), b = jointById(mech, oId), [ax, ay] = P(cId), [bx, by] = P(oId);
  return Math.atan2(by - ay, bx - ax) - Math.atan2(b.y - a.y, b.x - a.x);
}
const otherJ = (l, c) => l.joints.find(id => id !== c);
const camRot = c => { const l = linkById(mech, c.cam); return l ? rotDelta(c.center, otherJ(l, c.center)) : 0; };

// ---------- кэш геометрии (профили кулачков, фазы зубьев) ----------
let geomCache = { ver: -1 };
function geo() {
  if (geomCache.ver === st.geom) return geomCache;
  const prof = new Map();
  for (const c of mech.cams || []) { const p = camProfile(mech, c); if (p) prof.set(c.id, p); }
  geomCache = { ver: st.geom, prof, ...gearPhases() };
  return geomCache;
}
const frac = x => x - Math.floor(x);
function gearPhases() {
  const ph = new Map(), racks = new Map(), J = id => jointById(mech, id);
  const gearInfo = l => { const c = J(l.gear.center); return { cx: c.x, cy: c.y, p: 2 * Math.PI / l.gear.z }; };
  for (const g of mech.gears || []) {
    const A = linkById(mech, g.a), B = linkById(mech, g.b); if (!A || !B) continue;
    if (A.rack || B.rack) {
      const [Pn, R] = A.rack ? [B, A] : [A, B]; if (!Pn.gear) continue;
      const r1 = J(R.joints[0]), r2 = J(R.joints[1]); let dx = r2.x - r1.x, dy = r2.y - r1.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const gi = gearInfo(Pn), m = 2 * Pn.gear.r / Pn.gear.z, Pl = Math.PI * m;
      let nx = -dy, ny = dx; if ((gi.cx - r1.x) * nx + (gi.cy - r1.y) * ny < 0) { nx = -nx; ny = -ny; }
      const tc = (gi.cx - r1.x) * dx + (gi.cy - r1.y) * dy, beta = Math.atan2(-ny, -nx), Tg = [-Math.sin(beta), Math.cos(beta)], td = Tg[0] * dx + Tg[1] * dy;
      const ts = R.joints.map(id => (J(id).x - r1.x) * dx + (J(id).y - r1.y) * dy);
      const info = { m, nx: nx, ny: ny, sgn: Math.sign(dx * nx + dy * ny) || 1, tmin: Math.min(...ts, tc - Pn.gear.r) - 2 * Pl, tmax: Math.max(...ts, tc + Pn.gear.r) + 2 * Pl, nLocal: [(nx * dx + ny * dy), (-nx * dy + ny * dx)] };
      if (!ph.has(Pn.id) && !racks.has(R.id)) ph.set(Pn.id, 0);
      if (ph.has(Pn.id)) { const dl = frac((beta - ph.get(Pn.id)) / gi.p); info.phase = tc - dl * Pl * td + 0.5 * Pl; }
      else { const tau = frac((tc - (racks.get(R.id).phase + 0.5 * Pl)) / Pl); ph.set(Pn.id, beta - tau / td * gi.p); info.phase = racks.get(R.id).phase; }
      racks.set(R.id, info);
      continue;
    }
    if (!A.gear || !B.gear) continue;
    const ga = gearInfo(A), gb = gearInfo(B), internal = A.gear.ring || B.gear.ring;
    if (!ph.has(A.id) && !ph.has(B.id)) ph.set(A.id, 0);
    const [gg, h, gi, hi] = ph.has(A.id) ? [A, B, ga, gb] : [B, A, gb, ga];
    if (ph.has(h.id)) continue;
    let bg, bh;
    if (internal) { const [ring, pl] = gg.gear.ring ? [gi, hi] : [hi, gi]; bg = bh = Math.atan2(pl.cy - ring.cy, pl.cx - ring.cx); }
    else { bg = Math.atan2(hi.cy - gi.cy, hi.cx - gi.cx); bh = bg + Math.PI; }
    const dl = frac((bg - ph.get(gg.id)) / gi.p);
    ph.set(h.id, internal ? bh - dl * hi.p + 0.5 * hi.p : bh + (dl + 0.5) * hi.p);
  }
  return { phases: ph, racks };
}

// ---------- вид ----------
function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const W = () => cv.clientWidth, H = () => cv.clientHeight;
const toS = (x, y) => [W() / 2 + (x - st.view.x) * st.view.s, H() / 2 - (y - st.view.y) * st.view.s];
const toW = (sx, sy) => [st.view.x + (sx - W() / 2) / st.view.s, st.view.y - (sy - H() / 2) / st.view.s];
function fitView() {
  const pts = mech.joints.map(j => [j.x, j.y]);
  if (!pts.length) { st.view = { x: 0, y: 0, s: 4 }; return; }
  try {
    const s = compile(mech);
    if (s.driver) { const lin = s.driver.kind === 'lin'; const r = lin ? sweep(s, s.X0, s.theta0, 1, Math.max(4, (mech.driver.smax || 0) / 2), 2) : sweep(s, s.X0, s.theta0, 6, 360); r.frames.forEach(f => { for (let i = 0; i < s.N; i++) pts.push([f.X[2 * i], f.X[2 * i + 1]]); }); }
  } catch {}
  for (const l of mech.links) if (l.gear) { const c = jointById(mech, l.gear.center); const R = l.gear.r * 1.25 + 4; pts.push([c.x - R, c.y - R], [c.x + R, c.y + R]); }
  for (const c of mech.cams || []) { const cj = jointById(mech, c.center); const R = c.rb + c.h * 1.2 + c.rr; pts.push([cj.x - R, cj.y - R], [cj.x + R, cj.y + R]); }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  st.view.s = Math.min(20, Math.max(0.2, Math.min((W() - 80) / Math.max(10, x1 - x0), (H() - 150) / Math.max(10, y1 - y0))));
  st.view.x = (x0 + x1) / 2; st.view.y = (y0 + y1) / 2 - 12 / st.view.s;
}
const snapW = (x, y) => st.snap ? [Math.round(x / st.grid) * st.grid, Math.round(y / st.grid) * st.grid] : [x, y];

// ---------- геометрия для поиска ----------
function hull(pts) {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}
function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
  return c;
}
function segRect(a, b, r) { // пересечение отрезка с прямоугольником (Лианг–Барски)
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const tt = q / p; if (p < 0) { if (tt > t1) return false; if (tt > t0) t0 = tt; } else { if (tt < t0) return false; if (tt < t1) t1 = tt; }
  }
  return true;
}
const inRect = (p, r) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
function camScreenPts(c) {
  const g = geo(), prof = g.prof.get(c.id); if (!prof) return null;
  const [cx, cy] = P(c.center);
  return camWorld(prof, cx, cy, camRot(c)).filter((_, k) => k % 6 === 0).map(p => toS(...p));
}
function gearScreen(l) { const [cx, cy] = P(l.gear.center); const [x, y] = toS(cx, cy); return { x, y, r: l.gear.r * st.view.s }; }
function hitJoint(sx, sy, filter = () => true) {
  let best = null, bd = 14;
  for (const j of mech.joints) { if (!filter(j)) continue; const [x, y] = toS(...P(j.id)); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = j; } }
  return best;
}
function hitLink(sx, sy) {
  let best = null, bd = 10;
  for (const l of mech.links) {
    if (l.bars) { for (const [a, b] of l.bars) { const d = segDist([sx, sy], toS(...P(a)), toS(...P(b))); if (d < bd) { bd = d; best = l; } } continue; }
    const pts = hull(l.joints.map(id => toS(...P(id))));
    if (pts.length >= 3 && inPoly([sx, sy], pts)) return l;
    for (let i = 0; i < pts.length; i++) { const d = segDist([sx, sy], pts[i], pts[(i + 1) % pts.length]); if (d < bd) { bd = d; best = l; } }
  }
  if (best) return best;
  for (const l of mech.links) if (l.gear) { const g = gearScreen(l), d = Math.hypot(sx - g.x, sy - g.y); if (l.gear.ring ? Math.abs(d - g.r) < 12 : d < g.r + 4) return l; }
  for (const l of mech.links) if (l.rack) { const [a, b] = l.joints.slice(0, 2).map(id => toS(...P(id))); if (segDist([sx, sy], a, b) < 14) return l; }
  return null;
}
function hitCam(sx, sy) { for (const c of mech.cams || []) { const pts = camScreenPts(c); if (pts && inPoly([sx, sy], pts)) return c; } return null; }
function hitWall(sx, sy, tol = 8) {
  for (const w of mech.walls || []) for (let k = 1; k < w.pts.length; k++) if (segDist([sx, sy], toS(...w.pts[k - 1]), toS(...w.pts[k])) < tol) return w;
  return null;
}
// вершина выделенной стены под курсором (для правки концов)
function hitWallVertex(sx, sy) {
  for (const w of mech.walls || []) if (isSel('wall', w.id)) for (let k = 0; k < w.pts.length; k++) { const [x, y] = toS(...w.pts[k]); if (Math.hypot(x - sx, y - sy) < 9) return { w, k }; }
  return null;
}
function hitAny(sx, sy) {
  const j = hitJoint(sx, sy); if (j) return { kind: 'joint', id: j.id };
  const l = hitLink(sx, sy);
  if (l && !(mech.cams || []).some(c => c.cam === l.id)) return { kind: 'link', id: l.id };
  const c = hitCam(sx, sy); if (c) return { kind: 'cam', id: c.id };
  if (l) return { kind: 'link', id: l.id };
  const w = hitWall(sx, sy); return w ? { kind: 'wall', id: w.id } : null;
}

// ---------- рисование ----------
// Стена: толстая линия + штриховка с «твёрдой» стороны
function wallPath(pts, side, col, lw, hatch = true) {
  const S = pts.map(p => toS(...p));
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); S.forEach((p, k) => (k ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke();
  if (!hatch) return;
  ctx.lineWidth = 1.3; ctx.beginPath();
  for (let k = 1; k < S.length; k++) {
    const [ax, ay] = S[k - 1], [bx, by] = S[k], L = Math.hypot(bx - ax, by - ay); if (L < 1) continue;
    const tx = (bx - ax) / L, ty = (by - ay) / L, nx = -ty * side, ny = tx * side; // экран: y вниз — справа от обхода в мировых осях
    for (let d = 4; d < L; d += 9) { const x = ax + tx * d, y = ay + ty * d; ctx.moveTo(x, y); ctx.lineTo(x + 9 * nx - 6 * tx, y + 9 * ny - 6 * ty); }
  }
  ctx.stroke();
}
function drawWalls(editing) {
  const now = performance.now(), hot = sim.contact && now - sim.contact.t < 1800 && st.mode !== 'edit' ? sim.contact : null;
  for (const w of mech.walls || []) {
    const sel = isSel('wall', w.id), hov = st.hover?.kind === 'wall' && st.hover.id === w.id;
    if (sel) wallPath(w.pts, w.side, 'rgba(37,99,235,.25)', 12, false);
    wallPath(w.pts, w.side, hot && hot.wall === w.id ? '#dc2626' : sel || hov ? '#1d4ed8' : '#334155', 3.2);
    if (sel && editing) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2; for (const p of w.pts) { const [x, y] = toS(...p); ctx.beginPath(); ctx.rect(x - 4.5, y - 4.5, 9, 9); ctx.fill(); ctx.stroke(); } }
  }
  if (editing && st.tool === 'wall' && st.wdraft.length) {
    ctx.setLineDash([6, 5]); wallPath(st.cursor ? [...st.wdraft, st.cursor] : st.wdraft, 1, '#2563eb', 2.5); ctx.setLineDash([]);
  }
  if (hot) { const [x, y] = toS(hot.x, hot.y), r = 10 + 4 * Math.sin(now / 90); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
}
function draw() {
  const w = W(), h = H();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fbfcfd'; ctx.fillRect(0, 0, w, h);
  drawGrid(w, h);
  const g = geo(), editing = st.mode === 'edit';
  drawWalls(editing);
  // направляющие ползунов
  const camF = new Set((mech.cams || []).filter(c => c.kind !== 'rocker').map(c => c.follower));
  for (const j of mech.joints) if (j.type === 'P' && !camF.has(j.id)) {
    const f = railOf(j), [x, y] = toS(f.x, f.y);
    const onLink = j.rail && linkById(mech, j.rail);
    ctx.strokeStyle = onLink ? '#64748b' : '#9aa3b2'; ctx.lineWidth = onLink ? 3 : 2; ctx.setLineDash(onLink ? [] : [10, 6]);
    const L = onLink ? railLen(j) * st.view.s : 4000;
    ctx.beginPath(); ctx.moveTo(x - L * f.dx, y + L * f.dy); ctx.lineTo(x + L * f.dx, y - L * f.dy); ctx.stroke(); ctx.setLineDash([]);
  }
  // траектории
  if (live() && $('#chkTr').checked) for (const [, pts] of sim.traces) {
    if (pts.length < 2) continue;
    ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.6; ctx.beginPath();
    let pen = false;
    for (const p of pts) { if (!p) { pen = false; continue; } const [x, y] = toS(p[0], p[1]); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
    ctx.stroke();
  }
  // кулачки
  for (const c of mech.cams || []) {
    const prof = g.prof.get(c.id); if (!prof) continue;
    const [cx, cy] = P(c.center);
    const pts = camWorld(prof, cx, cy, camRot(c));
    drawCam(ctx, toS, pts, cx, cy, prof.maxP > 30, isSel('cam', c.id) || (st.hover?.kind === 'cam' && st.hover.id === c.id));
    // ролик и толкатель
    const [fx, fy] = P(c.follower), [rx, ry] = toS(fx, fy);
    if (c.kind !== 'rocker') {
      const F = jointById(mech, c.follower), a = (F.angle || 0) * D2R, L = (c.rb + c.h + 25);
      const [ex, ey] = toS(fx + L * Math.cos(a), fy + L * Math.sin(a));
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 7; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(ex, ey); ctx.stroke();
      // неподвижная направляющая втулка толкателя
      const gy0 = F.y + (c.h + 12) * Math.sin(a), gx0 = F.x + (c.h + 12) * Math.cos(a), nx = -Math.sin(a), ny = Math.cos(a);
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3;
      for (const sg of [-1, 1]) { const [p1x, p1y] = toS(gx0 + sg * 8 * nx, gy0 + sg * 8 * ny), [p2x, p2y] = toS(gx0 + sg * 8 * nx + 14 * Math.cos(a), gy0 + sg * 8 * ny + 14 * Math.sin(a)); ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); }
    }
    ctx.fillStyle = '#e2e8f0'; ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(rx, ry, Math.max(3, c.rr * st.view.s), 0, 7); ctx.fill(); ctx.stroke();
  }
  // колёса и рейки
  mech.links.forEach((l, k) => {
    const col = COLORS[k % COLORS.length], sel = isSel('link', l.id) || (st.hover?.kind === 'link' && st.hover.id === l.id) || st.meshFirst === l.id;
    if (l.gear) {
      const [cx, cy] = P(l.gear.center);
      const rot = (g.phases.get(l.id) ?? 0) + rotDelta(l.gear.center, otherJ(l, l.gear.center));
      drawGear(ctx, toS, st.view.s, { cx, cy, r: l.gear.r, z: l.gear.z, rot, ring: l.gear.ring }, col, sel);
    }
    if (l.rack && g.racks.has(l.id)) {
      const ri = g.racks.get(l.id), [x0, y0] = P(l.joints[0]), [x1, y1] = P(l.joints[1]); const L = Math.hypot(x1 - x0, y1 - y0) || 1, dx = (x1 - x0) / L, dy = (y1 - y0) / L;
      const nx = ri.nLocal[0] * dx - ri.nLocal[1] * dy, ny = ri.nLocal[0] * dy + ri.nLocal[1] * dx;
      drawRack(ctx, toS, { x0, y0, dx, dy, nx, ny, tmin: ri.tmin, tmax: ri.tmax, m: ri.m, phase: ri.phase }, col, sel);
    }
  });
  // звенья
  mech.links.forEach((l, k) => {
    const col = COLORS[k % COLORS.length], body = l.gear || l.rack || (mech.cams || []).some(c => c.cam === l.id);
    const pts = l.joints.map(id => toS(...P(id)));
    const sel = isSel('link', l.id), hov = st.hover?.kind === 'link' && st.hover.id === l.id;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (l.bars) { // ломаное (Г-образное) звено: стержни с изгибом в шарнирах
      ctx.beginPath(); for (const [a, b] of l.bars) { ctx.moveTo(...toS(...P(a))); ctx.lineTo(...toS(...P(b))); }
      ctx.strokeStyle = col + (sel ? 'ff' : '55'); ctx.lineWidth = sel ? 18 : 16; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = sel || hov ? 4 : 3; ctx.stroke();
    } else {
    const hp = hull(pts);
    ctx.beginPath(); hp.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); if (hp.length > 2) ctx.closePath();
    ctx.strokeStyle = col + (sel ? 'ff' : '55'); ctx.lineWidth = body ? (sel ? 9 : 7) : sel ? 18 : 16; ctx.stroke();
    if (hp.length > 2) { ctx.fillStyle = col + '40'; ctx.fill(); }
    ctx.strokeStyle = col; ctx.lineWidth = sel || hov ? 4 : body ? 2 : 3; ctx.stroke();
    }
    if (mech.driver?.kind !== 'lin' && mech.driver?.link === l.id) drawDriverArrow();
  });
  // ползуны (камни)
  for (const j of mech.joints) if (j.type === 'P' && !camF.has(j.id)) {
    const f = railOf(j), [x, y] = toS(...P(j.id)), a = -Math.atan2(f.dy, f.dx);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = '#e5e7eb'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-18, -11, 36, 22, 4); ctx.fill(); ctx.stroke();
    if (mech.driver?.kind === 'lin' && mech.driver.joint === j.id) {
      ctx.strokeStyle = ctx.fillStyle = '#dc2626'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-34, -18); ctx.lineTo(34, -18); ctx.stroke();
      for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * 40, -18); ctx.lineTo(sgn * 31, -23); ctx.lineTo(sgn * 31, -13); ctx.fill(); }
    }
    ctx.restore();
  }
  // стойки
  for (const j of mech.joints) if (j.type === 'G') {
    const [x, y] = toS(...P(j.id));
    ctx.fillStyle = '#cbd5e1'; ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 13, y + 20); ctx.lineTo(x + 13, y + 20); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 18, y + 20); ctx.lineTo(x + 18, y + 20); ctx.stroke();
    for (let k = -16; k <= 12; k += 6) { ctx.beginPath(); ctx.moveTo(x + k, y + 27); ctx.lineTo(x + k + 6, y + 21); ctx.stroke(); }
  }
  if (editing && (st.tool === 'link' || st.tool === 'bent') && st.draft.length) {
    ctx.strokeStyle = '#2563eb'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.beginPath();
    st.draft.forEach((id, k) => { const p = toS(...P(id)); k ? ctx.lineTo(...p) : ctx.moveTo(...p); });
    if (st.cursor) ctx.lineTo(...toS(...st.cursor)); ctx.stroke(); ctx.setLineDash([]);
  }
  // шарниры
  for (const j of mech.joints) {
    const [x, y] = toS(...P(j.id));
    const sel = isSel('joint', j.id), hov = st.hover?.kind === 'joint' && st.hover.id === j.id, inDraft = st.draft.includes(j.id);
    if (sel || hov || inDraft) { ctx.fillStyle = sel ? 'rgba(37,99,235,.28)' : 'rgba(37,99,235,.13)'; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill(); }
    ctx.fillStyle = j.type === 'G' ? '#334155' : '#fff'; ctx.strokeStyle = '#111827'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, linksOfJoint(mech, j.id).length === 1 && j.type === 'R' && j.trace ? 4.5 : 6, 0, 7); ctx.fill(); ctx.stroke();
    if (j.trace) { ctx.fillStyle = '#e11d48'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#111827'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(j.name, x + 9, y - 9);
  }
  if (live() && sim.sys) {
    if ($('#chkVel').checked && sim.V) drawVectors(sim.V, '#16a34a');
    if ($('#chkAcc').checked && sim.A) drawVectors(sim.A, '#ea580c');
  }
  if (st.mode === 'drag' && sim.grab) {
    const [gx, gy] = toS(...pointOf(sim.X, sim.grab)), [tx, ty] = toS(...sim.target);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(gx, gy, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, 7); ctx.stroke();
  }
  // рамка выделения
  if (action?.type === 'box') {
    const { sx0, sy0, sx, sy } = action, win = sx >= sx0;
    ctx.fillStyle = win ? 'rgba(37,99,235,.10)' : 'rgba(22,163,74,.10)'; ctx.strokeStyle = win ? '#2563eb' : '#16a34a'; ctx.lineWidth = 1.5;
    ctx.setLineDash(win ? [] : [6, 4]); ctx.fillRect(Math.min(sx0, sx), Math.min(sy0, sy), Math.abs(sx - sx0), Math.abs(sy - sy0));
    ctx.strokeRect(Math.min(sx0, sx) + .5, Math.min(sy0, sy) + .5, Math.abs(sx - sx0), Math.abs(sy - sy0)); ctx.setLineDash([]);
  }
}
function railOf(j) {
  if (live() && sim.sys) { const i = sim.sys.idx.get(j.id), R = sim.sys.rails.get(i); if (R) { const f = railFrame(R, sim.X); return { x: j.rail ? f.x : R.x, y: j.rail ? f.y : R.y, dx: f.dx, dy: f.dy }; } }
  const a = (j.angle || 0) * D2R; return { x: j.x, y: j.y, dx: Math.cos(a), dy: Math.sin(a) };
}
function railLen(j) { const l = linkById(mech, j.rail); let L = 20; if (l) for (const id of l.joints) { const q = jointById(mech, id); L = Math.max(L, Math.hypot(q.x - j.x, q.y - j.y)); } return L * 1.1; }
function drawGrid(w, h) {
  let step = st.grid; while (step * st.view.s < 12) step *= 2; while (step * st.view.s > 60) step /= 2;
  const [x0, y1] = toW(0, 0), [x1, y0] = toW(w, h);
  ctx.lineWidth = 1;
  for (let k = Math.floor(x0 / step); k <= x1 / step; k++) { const sx = Math.round(toS(k * step, 0)[0]) + .5; ctx.strokeStyle = k % 5 ? '#eef1f5' : '#dde2ea'; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); }
  for (let k = Math.floor(y0 / step); k <= y1 / step; k++) { const sy = Math.round(toS(0, k * step)[1]) + .5; ctx.strokeStyle = k % 5 ? '#eef1f5' : '#dde2ea'; ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); }
  const [ox, oy] = toS(0, 0); ctx.strokeStyle = '#b8c0cc'; ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
}
function drawDriverArrow() {
  const d = mech.driver, [x, y] = toS(...P(d.pivot)), dir = live() ? sim.dir : d.dir;
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2.5; const r = 22, a0 = -0.6, a1 = 1.2;
  ctx.beginPath(); ctx.arc(x, y, r, -a1, -a0); ctx.stroke();
  const end = dir > 0 ? -a1 : -a0, tang = dir > 0 ? -1 : 1;
  const ex = x + r * Math.cos(end), ey = y + r * Math.sin(end), tx = -Math.sin(end) * tang, ty = Math.cos(end) * tang;
  ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(ex + tx * 8, ey + ty * 8); ctx.lineTo(ex - ty * 5, ey + tx * 5); ctx.lineTo(ex + ty * 5, ey - tx * 5); ctx.fill();
}
function drawVectors(V, col) {
  let mx = 0; for (let i = 0; i < sim.sys.N; i++) mx = Math.max(mx, Math.hypot(V[2 * i], V[2 * i + 1]));
  if (mx < 1e-9) return; const k = 70 / mx;
  for (let i = 0; i < sim.sys.N; i++) {
    const vx = V[2 * i] * k, vy = V[2 * i + 1] * k, len = Math.hypot(vx, vy); if (len < 3) continue;
    const [x, y] = toS(sim.X[2 * i], sim.X[2 * i + 1]), ex = x + vx, ey = y - vy, ux = vx / len, uy = -vy / len;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex - ux * 6, ey - uy * 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ux * 10 - uy * 5, ey - uy * 10 + ux * 5); ctx.lineTo(ex - ux * 10 + uy * 5, ey - uy * 10 - ux * 5); ctx.fill();
  }
}

// ---------- симуляция ----------
let toastTimer = 0;
function toast(msg, ok = false) { const el = $('#toast'); el.textContent = msg; el.style.background = ok ? '#1d4ed8' : '#b91c1c'; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400); }
const TRACE_GAP = 0.08;
function recordTraces() {
  const s = sim.sys;
  for (const j of mech.joints) if (j.trace) {
    const i = s.idx.get(j.id); if (i === undefined) continue;
    let arr = sim.traces.get(j.id); if (!arr) sim.traces.set(j.id, arr = []);
    const p = [sim.X[2 * i], sim.X[2 * i + 1]], q = arr.at(-1), dq = q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : 0;
    // разрыв линии при скачке: хорды через кривую не рисуем
    if (q && dq > TRACE_GAP * s.scale) arr.push(null);
    if (!q || dq * st.view.s > 0.7) { arr.push(p); if (arr.length > 6000) arr.shift(); }
  }
}
function stepSim(dAbs) {
  const s = ensureSys(); if (!s.driver) { toast(t('noDriverMsg')); sim.playing = false; syncSimUi(); return; }
  let d = sim.dir * dAbs, bound = false;
  if (s.driver.kind === 'lin') {
    const { smin, smax } = mech.driver, target = sim.theta + d;
    if (target > smax) { d = smax - sim.theta; bound = true; } else if (target < smin) { d = smin - sim.theta; bound = true; }
  }
  const r = Math.abs(d) > 1e-12 ? advance(s, sim.X, sim.theta, d) : { ok: true, X: sim.X, theta: sim.theta };
  sim.X = r.X; sim.theta = r.theta;
  if (!r.ok && r.wall) { // упор в стену: остановка или реверс
    sim.contact = { ...r.wall, t: performance.now() };
    if ((mech.driver.lock ?? 'reverse') === 'reverse') { sim.dir = -sim.dir; sim.Tprev = null; toast(t('wallReverseMsg')); }
    else { sim.playing = false; syncSimUi(); toast(t('wallStopMsg')); }
  } else if (!r.ok) {
    if ((mech.driver.lock ?? 'reverse') === 'reverse') { sim.dir = -sim.dir; sim.Tprev = null; toast(t('lockReverseMsg')); }
    else { sim.playing = false; syncSimUi(); toast(t('lockStopMsg')); }
  } else if (bound) { sim.dir = -sim.dir; sim.Tprev = null; }
  updateV(); recordTraces();
}
let lastT = performance.now();
// Свободное перемещение: ведём захваченную точку к цели малыми подшагами (см. dragPath)
function grabStep(tmax) {
  const before = pointOf(sim.X, sim.grab), wpt = sim.target;
  sim.X = dragPath(sim.sys, sim.X, sim.grab, wpt[0], wpt[1], X => { sim.X = X; recordTraces(); }, 0.02 * sim.sys.scale, tmax);
  const after = pointOf(sim.X, sim.grab);
  if (sim.sys.contact) { sim.contact = { ...sim.sys.contact, t: performance.now() }; sim.sys.contact = null; }
  sim.grabLag = Math.hypot(after[0] - wpt[0], after[1] - wpt[1]) > 1e-4 * sim.sys.scale && Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-4 * sim.sys.scale;
  if (sim.sys.driver) { const th = driverAngle(sim.sys, sim.X); sim.theta = sim.sys.driver.kind === 'lin' ? th : sim.theta + Math.atan2(Math.sin(th - sim.theta), Math.cos(th - sim.theta)); }
  sim.V = sim.A = sim.Tprev = null; recordTraces(); updateCoordInputs();
}
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (st.mode === 'sim' && sim.playing) stepSim(inputRate() * sim.mul * dt);
  if (sim.grab && sim.grabLag && action?.type === 'grab') grabStep(12);
  draw();
  if (chart && live() && (sim.playing || sim.grab)) renderChart();
  requestAnimationFrame(loop);
}

// ---------- ввод ----------
function evPos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  const [sx, sy] = evPos(e); pointers.set(e.pointerId, [sx, sy]);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; action = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: st.view.s, v: { ...st.view } }; sim.grab = null; return; }
  if (e.button === 1 || e.button === 2 || st.space) { action = { type: 'pan', sx, sy, v: { ...st.view } }; return; }
  const wpt = toW(sx, sy);
  if (st.mode === 'drag') {
    ensureSys();
    const j = hitJoint(sx, sy, j => j.type !== 'G');
    if (j) sim.grab = { kind: 'j', i: sim.sys.idx.get(j.id) };
    else {
      const it = hitAny(sx, sy), l = it?.kind === 'link' ? linkById(mech, it.id) : it?.kind === 'cam' ? linkById(mech, camById(mech, it.id).cam) : null;
      if (l) { const ids = l.joints.map(id => sim.sys.idx.get(id)); const [a, b] = farPair(ids); sim.grab = localGrab(sim.X, a, b, ...wpt); }
    }
    if (sim.grab) { sim.target = wpt; action = { type: 'grab' }; sim.playing = false; syncSimUi(); }
    else action = { type: 'pan', sx, sy, v: { ...st.view } };
    return;
  }
  if (st.mode === 'sim') {
    const it = hitAny(sx, sy);
    if (it) { selectOnly(it); renderPanels(); autoChart(); } else action = { type: 'pan', sx, sy, v: { ...st.view } };
    return;
  }
  editDown(sx, sy, wpt, e);
});
function farPair(ids) {
  let best = -1, r = [ids[0], ids[1]];
  for (let p = 0; p < ids.length; p++) for (let q = p + 1; q < ids.length; q++) { const d = Math.hypot(sim.X[2 * ids[p]] - sim.X[2 * ids[q]], sim.X[2 * ids[p] + 1] - sim.X[2 * ids[q] + 1]); if (d > best) { best = d; r = [ids[p], ids[q]]; } }
  return r;
}
// все шарниры, которые двигаются при групповом перемещении
function jointsOfSelection() {
  const s = new Set();
  for (const it of selItems()) {
    if (it.kind === 'joint') s.add(it.id);
    else if (it.kind === 'link') linkById(mech, it.id).joints.forEach(id => s.add(id));
    else if (it.kind === 'cam') { const c = camById(mech, it.id); linkById(mech, c.cam).joints.forEach(id => s.add(id)); s.add(c.follower); if (c.pivot) s.add(c.pivot); }
  }
  return [...s];
}
function editDown(sx, sy, wpt, e) {
  const tool = st.tool, [gx, gy] = snapW(...wpt), mod = e.shiftKey || e.ctrlKey || e.metaKey;
  const it = hitAny(sx, sy), j = it?.kind === 'joint' ? jointById(mech, it.id) : null, l = it?.kind === 'link' ? linkById(mech, it.id) : null;
  if (tool === 'select') {
    const wv = !mod && hitWallVertex(sx, sy);
    if (wv) { action = { type: 'wallpt', w: wv.w, k: wv.k, pushed: false }; return; }
    if (it && mod) { toggleSel(it); renderPanels(); return; }
    if (it) {
      if (!isSel(it.kind, it.id)) selectOnly(it);
      const ids = jointsOfSelection(), ws = selItems().filter(i => i.kind === 'wall').map(i => wallById(mech, i.id));
      action = { type: 'move', ids, start: wpt, orig: ids.map(id => { const q = jointById(mech, id); return [q.x, q.y]; }), walls: ws.map(w => ({ w, pts: w.pts.map(p => [...p]) })), pushed: false, anchor: j ? [j.x, j.y] : null };
      renderPanels(); autoChart();
    } else action = { type: 'box', sx0: sx, sy0: sy, sx, sy, add: mod };
  } else if (tool === 'wall') {
    const p = [gx, gy], last = st.wdraft.at(-1);
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-9) st.wdraft.push(p);
    syncLinkBar();
  } else if (tool === 'joint') {
    pushUndo(); const nj = addJoint(mech, gx, gy);
    if (l) { l.joints.push(nj.id); nj.trace = true; }
    selectOnly({ kind: 'joint', id: nj.id }); changed();
  } else if (tool === 'link' || tool === 'bent') {
    if (j && st.draft.at(-1) === j.id) { finishLink(); return; }
    if (j) { if (!st.draft.includes(j.id)) st.draft.push(j.id); }
    else { if (!st.draftCreated) pushUndo(); const nj = addJoint(mech, gx, gy); st.draft.push(nj.id); st.draftCreated = true; (st.draftNew ||= []).push(nj.id); changed(); }
    syncLinkBar();
  } else if (tool === 'ground' || tool === 'slider') {
    pushUndo(); let type = tool === 'ground' ? 'G' : 'P';
    if (j && tool === 'ground' && j.type === 'G') type = 'R'; // повторный щелчок по стойке — снова подвижный шарнир
    const tj = j || addJoint(mech, gx, gy, type); tj.type = type; if (type !== 'P') tj.rail = null;
    selectOnly({ kind: 'joint', id: tj.id }); changed();
    if (tool === 'ground') toast(t(type === 'G' ? 'madeFixed' : 'madeFree'), true);
  } else if (tool === 'gear') {
    pushUndo();
    if (l && !l.gear && !l.rack) {
      let best = l.joints[0], bd = Infinity; for (const id of l.joints) { const q = jointById(mech, id), d = Math.hypot(q.x - wpt[0], q.y - wpt[1]); if (d < bd) { bd = d; best = id; } }
      l.gear = { center: best, r: 20, z: 20, ring: false }; selectOnly({ kind: 'link', id: l.id });
    } else {
      const c = j || addJoint(mech, gx, gy, 'G'), mk = addJoint(mech, c.x + 10, c.y, 'R');
      const nl = addLink(mech, [c.id, mk.id]); nl.gear = { center: c.id, r: 20, z: 20, ring: false };
      if (!mech.driver && c.type === 'G') setDriver(mech, nl.id, c.id);
      selectOnly({ kind: 'link', id: nl.id });
    }
    changed();
  } else if (tool === 'mesh') {
    if (!l || !(l.gear || l.rack)) { st.meshFirst = null; toast(t('meshPick')); return; }
    if (!st.meshFirst || st.meshFirst === l.id) { st.meshFirst = l.id; syncHint(); return; }
    const a = linkById(mech, st.meshFirst), b = l; st.meshFirst = null;
    if (a.rack && b.rack) { toast(t('meshPick')); return; }
    pushUndo(); mech.gears.push({ id: newId(mech, 'g'), a: a.id, b: b.id }); changed();
    const w = meshWarning(mech.gears.at(-1)); if (w) toast(w); else toast(t('meshDone'), true);
    syncHint();
  } else if (tool === 'cam') {
    pushUndo(); const c = addCam(mech, gx, gy, j?.id); selectOnly({ kind: 'cam', id: c.id }); changed();
  } else if (tool === 'delete') {
    if (it) { pushUndo(); deleteItems(mech, [it]); selectOnly(null); changed(); }
  }
}
function meshWarning(g) {
  const A = linkById(mech, g.a), B = linkById(mech, g.b); if (!A || !B) return '';
  if (A.rack || B.rack) return '';
  const ca = jointById(mech, A.gear.center), cb = jointById(mech, B.gear.center), d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const need = A.gear.ring || B.gear.ring ? Math.abs(A.gear.r - B.gear.r) : A.gear.r + B.gear.r;
  const mA = 2 * A.gear.r / A.gear.z, mB = 2 * B.gear.r / B.gear.z;
  if (Math.abs(d - need) > 0.01 * need + 0.05) return t('meshDist').replace('{d}', d.toFixed(2)).replace('{n}', need.toFixed(2));
  if (Math.abs(mA - mB) > 1e-6) return t('meshModule');
  return '';
}
function finishLink() {
  if (st.draft.length >= 2) { if (!st.draftCreated) pushUndo(); const l = addLink(mech, st.draft, st.tool === 'bent' && st.draft.length >= 3 ? chainBars(st.draft) : null); selectOnly({ kind: 'link', id: l.id }); }
  st.draft = []; st.draftCreated = false; st.draftNew = []; changed(); syncLinkBar();
}
function finishWall() {
  if (st.wdraft.length >= 2) { pushUndo(); const w = addWall(mech, st.wdraft); selectOnly({ kind: 'wall', id: w.id }); st.wdraft = []; changed(); }
  else st.wdraft = [];
  syncLinkBar();
}
function cancelLink() {
  st.wdraft = [];
  // шарниры, поставленные только что для недостроенного звена, убираем
  const tmp = (st.draftNew || []).filter(id => !linksOfJoint(mech, id).length);
  st.draft = []; st.draftCreated = false; st.draftNew = []; st.meshFirst = null;
  if (tmp.length) { deleteItems(mech, tmp.map(id => ({ kind: 'joint', id }))); changed(); }
  syncLinkBar();
}
function finishBox(a) {
  const r = { x0: Math.min(a.sx0, a.sx), x1: Math.max(a.sx0, a.sx), y0: Math.min(a.sy0, a.sy), y1: Math.max(a.sy0, a.sy) };
  if (!a.add) st.selSet.clear();
  if (r.x1 - r.x0 < 4 && r.y1 - r.y0 < 4) { renderPanels(); return; }
  const win = a.sx >= a.sx0, sp = id => toS(...P(id));
  for (const j of mech.joints) if (inRect(sp(j.id), r)) st.selSet.set('joint:' + j.id, { kind: 'joint', id: j.id });
  for (const l of mech.links) {
    const pts = l.joints.map(sp);
    const segs = l.bars ? l.bars.map(([a, b]) => [sp(a), sp(b)]) : hull(pts).map((p, i, h) => [p, h[(i + 1) % h.length]]);
    let hit = win ? pts.every(p => inRect(p, r)) : pts.some(p => inRect(p, r)) || segs.some(([p, q]) => segRect(p, q, r));
    if (l.gear) { const g = gearScreen(l); const gr = { x0: g.x - g.r, x1: g.x + g.r, y0: g.y - g.r, y1: g.y + g.r }; if (win) hit = hit && gr.x0 >= r.x0 && gr.x1 <= r.x1 && gr.y0 >= r.y0 && gr.y1 <= r.y1; }
    if (hit) st.selSet.set('link:' + l.id, { kind: 'link', id: l.id });
  }
  for (const w of mech.walls || []) {
    const pts = w.pts.map(p => toS(...p));
    if (win ? pts.every(p => inRect(p, r)) : pts.some(p => inRect(p, r)) || pts.slice(1).some((p, k) => segRect(pts[k], p, r))) st.selSet.set('wall:' + w.id, { kind: 'wall', id: w.id });
  }
  for (const c of mech.cams || []) {
    const pts = camScreenPts(c); if (!pts) continue;
    if (win ? pts.every(p => inRect(p, r)) : pts.some(p => inRect(p, r)) || pts.some((p, i) => segRect(p, pts[(i + 1) % pts.length], r))) st.selSet.set('cam:' + c.id, { kind: 'cam', id: c.id });
  }
  renderPanels(); autoChart();
}
function deleteSelection() {
  const items = selItems(); if (!items.length || st.mode !== 'edit') return;
  pushUndo(); deleteItems(mech, items); selectOnly(null); changed();
}
function selectAll() {
  st.selSet.clear();
  mech.joints.forEach(j => st.selSet.set('joint:' + j.id, { kind: 'joint', id: j.id }));
  mech.links.forEach(l => st.selSet.set('link:' + l.id, { kind: 'link', id: l.id }));
  (mech.cams || []).forEach(c => st.selSet.set('cam:' + c.id, { kind: 'cam', id: c.id }));
  (mech.walls || []).forEach(w => st.selSet.set('wall:' + w.id, { kind: 'wall', id: w.id }));
  renderPanels();
}
cv.addEventListener('dblclick', () => { if (st.mode === 'edit' && st.tool === 'wall') { finishWall(); return; } if (st.mode === 'edit' && (st.tool === 'link' || st.tool === 'bent') && st.draft.length >= 2) finishLink(); });
cv.addEventListener('pointermove', e => {
  const [sx, sy] = evPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
  const wpt = toW(sx, sy); st.cursor = snapW(...wpt);
  if (!action) {
    st.hover = hitAny(sx, sy);
    cv.style.cursor = st.space ? 'grab' : st.mode === 'drag' ? (st.hover ? 'grab' : 'default') : st.hover ? 'pointer' : st.tool === 'select' ? 'default' : 'crosshair';
    return;
  }
  if (action.type === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    st.view = { ...action.v }; const before = toW(...action.m);
    st.view.s = Math.max(0.1, Math.min(60, action.s * d / action.d));
    const after = toW(...m); st.view.x += before[0] - after[0]; st.view.y += before[1] - after[1];
  } else if (action.type === 'pan') {
    st.view.x = action.v.x - (sx - action.sx) / st.view.s; st.view.y = action.v.y + (sy - action.sy) / st.view.s;
  } else if (action.type === 'box') { action.sx = sx; action.sy = sy; }
  else if (action.type === 'move') {
    let dx = wpt[0] - action.start[0], dy = wpt[1] - action.start[1];
    if (!action.pushed) { if (Math.hypot(dx, dy) * st.view.s < 2) return; pushUndo(); action.pushed = true; }
    if (action.anchor) { const [ax, ay] = snapW(action.anchor[0] + dx, action.anchor[1] + dy); dx = ax - action.anchor[0]; dy = ay - action.anchor[1]; } else [dx, dy] = snapW(dx, dy);
    action.ids.forEach((id, k) => { const q = jointById(mech, id); q.x = action.orig[k][0] + dx; q.y = action.orig[k][1] + dy; });
    (action.walls || []).forEach(({ w, pts }) => { w.pts = pts.map(p => [p[0] + dx, p[1] + dy]); });
    st.geom++; chart = null; updateCoordInputs();
  } else if (action.type === 'wallpt') {
    if (!action.pushed) { pushUndo(); action.pushed = true; }
    action.w.pts[action.k] = snapW(...wpt); st.geom++; chart = null; renderPanels();
  } else if (action.type === 'grab') {
    sim.target = wpt; grabStep(40);
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!action) return;
  if ((action.type === 'move' || action.type === 'wallpt') && action.pushed) changed();
  if (action.type === 'box') finishBox(action);
  if (action.type === 'grab') { sim.grab = null; updateV(); }
  action = null;
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', e => {
  e.preventDefault(); const [sx, sy] = evPos(e), before = toW(sx, sy);
  st.view.s = Math.max(0.1, Math.min(60, st.view.s * Math.exp(-e.deltaY * 0.0015)));
  const after = toW(sx, sy); st.view.x += before[0] - after[0]; st.view.y += before[1] - after[1];
}, { passive: false });
window.addEventListener('keyup', e => { if (e.key === ' ') st.space = false; });
window.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (k === 'z' || k === 'я')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && (k === 'y' || k === 'н')) { e.preventDefault(); redo(); }
  else if (ctrl && (k === 'a' || k === 'ф')) { if (st.mode === 'edit') { e.preventDefault(); selectAll(); } }
  else if (k === 'enter' && (st.tool === 'link' || st.tool === 'bent')) finishLink();
  else if (k === 'enter' && st.tool === 'wall') finishWall();
  else if (k === 'escape') escape();
  else if ((k === 'delete' || k === 'backspace') && st.mode === 'edit') { e.preventDefault(); deleteSelection(); }
  else if (k === ' ') { e.preventDefault(); if (st.mode === 'sim') togglePlay(); else st.space = true; }
  else if (st.mode === 'edit' && !ctrl) { const map = { v: 'select', j: 'joint', l: 'link', b: 'bent', w: 'wall', g: 'ground', s: 'slider', z: 'gear', m: 'mesh', k: 'cam', d: 'delete' }; if (map[k]) setTool(map[k]); }
});

// Esc: прервать начатое построение и вернуться к инструменту «Выбор»; если он уже активен — снять выделение
function escape() {
  const busy = st.draft.length || st.wdraft.length || st.meshFirst || action;
  cancelLink(); if (action?.type === 'box') action = null;
  if (st.mode === 'edit' && st.tool !== 'select') { setTool('select'); if (document.activeElement?.closest?.('#tools')) document.activeElement.blur(); }
  else if (!busy) selectOnly(null);
  renderPanels(); syncHint();
}
// ---------- режимы / инструменты ----------
function setMode(m) {
  if (m === st.mode) return;
  cancelLink(); action = null; sim.grab = null;
  st.mode = m;
  if (m !== 'edit') { ensureSys(); const p = primary(); selectOnly(p); } else sim.playing = false;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#tools').classList.toggle('disabled', m !== 'edit');
  syncSimUi(); renderPanels(); syncHint();
}
function setTool(tl) { st.tool = tl; cancelLink(); document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tl)); syncHint(); }
function syncHint() {
  let k = st.mode === 'sim' ? 'hintSim' : st.mode === 'drag' ? 'hintDrag' : 'hint' + st.tool[0].toUpperCase() + st.tool.slice(1);
  if (st.mode === 'edit' && st.tool === 'mesh' && st.meshFirst) k = 'hintMesh2';
  $('#hint').textContent = t(k);
}
function syncLinkBar() { $('#linkBar').classList.toggle('show', st.mode === 'edit' && ((st.tool === 'link' || st.tool === 'bent') && st.draft.length > 0 || st.tool === 'wall' && st.wdraft.length > 0)); }
function syncSimUi() {
  $('#simCtl').classList.toggle('hidden', st.mode === 'edit');
  $('#btnPlay').innerHTML = sim.playing ? `⏸ <span>${t('pause')}</span>` : `▶ <span>${t('play')}</span>`;
  ['btnPlay', 'btnStep'].forEach(id => { $('#' + id).disabled = st.mode !== 'sim'; });
}
function togglePlay() { if (st.mode !== 'sim') return; ensureSys(); sim.playing = !sim.playing; syncSimUi(); }

// ---------- панели ----------
const fmt = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(3));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lname = l => l.joints.map(id => jointById(mech, id).name).join('–');
const num = (attr, v, step = 0.5, ro = '', extra = '') => `<input type="number" step="${step}" ${attr} value="${v}" ${ro} ${extra}>`;
const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
function renderPanels() {
  const ro = st.mode !== 'edit' ? 'disabled' : '';
  const items = selItems(), it = items.length === 1 ? items[0] : null;
  const pr = $('#props'); let html = '';
  if (items.length > 1) {
    const c = k => items.filter(i => i.kind === k).length;
    html = `<div class="selcount"><b>${t('selected')}: ${items.length}</b><br><span class="muted small">${t('joints')}: ${c('joint')} · ${t('linksW')}: ${c('link')} · ${t('cams')}: ${c('cam')}${c('wall') ? ` · ${t('wallsW')}: ${c('wall')}` : ''}</span></div>
      ${ro ? '' : `<div class="row wrap">${c('link') >= 2 ? `<button data-act="merge" class="primary" title="${t('mergeTip')}">${t('merge')}</button>` : ''}<button data-act="delSel" class="danger">${t('delSel')}</button></div><div class="muted small">${t('multiHint')}${c('link') >= 2 ? ' ' + t('mergeHint') : ''}</div>`}`;
  } else if (it?.kind === 'joint') html = jointPanel(jointById(mech, it.id), ro);
  else if (it?.kind === 'link') html = linkPanel(linkById(mech, it.id), ro);
  else if (it?.kind === 'cam') html = camPanel(camById(mech, it.id), ro);
  else if (it?.kind === 'wall') html = wallPanel(wallById(mech, it.id), ro);
  else html = `<div class="muted small">${t('nothingSel')}</div>${ro ? '' : `<div class="row wrap" style="margin-top:8px"><button data-act="addFloor" title="${t('addFloorTip')}">${t('addFloor')}</button></div>`}`;
  pr.innerHTML = html;
  const d = dof(mech);
  const note = d.W < 0 ? ` <span class="muted small">(${t('dofOver')})</span>` : d.W === 0 ? ` <span class="muted small">(${t('dofZero')})</span>` : '';
  $('#mechInfo').innerHTML = `<div class="row"><span>${t('dofLabel')}</span><span class="dofbig">W = ${d.W}</span></div><div class="muted small">${t('dofHint')}: 3·${d.n} − 2·${d.p5} − ${d.p4} = ${d.W}${note}<br>n = ${d.n} ${t('links')}, p₅ = ${d.p5} ${t('pairs')}, p₄ = ${d.p4} ${t('pairs4')}</div>
    ${(mech.gears || []).length ? `<h3>${t('meshes')}</h3>` + mech.gears.map(g => { const a = linkById(mech, g.a), b = linkById(mech, g.b), w = meshWarning(g); const kind = a.rack || b.rack ? t('mRack') : a.gear.ring || b.gear.ring ? t('mInt') : t('mExt'); return `<div class="row small"><span>${esc(lname(a))} ⟷ ${esc(lname(b))} <span class="muted">(${kind})</span>${w ? `<br><span class="warn">⚠ ${esc(w)}</span>` : ''}</span>${ro ? '' : `<button data-delmesh="${g.id}" title="${t('del')}">✕</button>`}</div>`; }).join('') : ''}`;
  const n = items.length;
  $('#dofBadge').innerHTML = `W = <b>${d.W}</b> · ${mech.links.length} ${t('links')}${n > 1 ? ` · <span class="selbadge">${t('selected')}: ${n}</span>` : ''}`;
  const dr = mech.driver;
  let dh = '';
  if (dr?.kind === 'lin') {
    dh = `<h3>${t('driver')}: ${t('linDriver')} ${esc(jointById(mech, dr.joint).name)}</h3><div class="prop">
      <span>${t('speedLin')}</span>${num('data-d="speed"', dr.speed, 1)}
      <span>${t('dir')}</span><select data-d="dir">${opt(1, '→ ' + t('fwd'), dr.dir)}${opt(-1, '← ' + t('back'), dr.dir)}</select>
      <span>${t('strokeMin')}</span>${num('data-d="smin"', dr.smin, 1)}
      <span>${t('strokeMax')}</span>${num('data-d="smax"', dr.smax, 1)}
      <span>${t('onLock')}</span><select data-d="lock">${opt('reverse', t('lockReverse'), dr.lock ?? 'reverse')}${opt('stop', t('lockStop'), dr.lock)}</select></div>`;
  } else if (dr) {
    dh = `<h3>${t('driver')}: ${esc(jointById(mech, dr.pivot).name)}–${esc(jointById(mech, dr.tip).name)}</h3><div class="prop">
      <span>${t('speedDeg')}</span>${num('data-d="speed"', dr.speed, 10)}
      <span></span><span class="muted small">${fmt(dr.speed / 6)} ${t('rpm')}</span>
      <span>${t('dir')}</span><select data-d="dir">${opt(1, '↺ ' + t('ccw'), dr.dir)}${opt(-1, '↻ ' + t('cw'), dr.dir)}</select>
      <span>${t('onLock')}</span><select data-d="lock">${opt('reverse', t('lockReverse'), dr.lock ?? 'reverse')}${opt('stop', t('lockStop'), dr.lock)}</select></div>`;
  } else dh = `<div class="muted small" style="margin-top:8px">${t('noDriver')}</div>`;
  $('#driverPanel').innerHTML = dh;
  syncChartOptions();
}
function wallPanel(w, ro) {
  return `<div class="muted small">${t('wallInfo')}</div><h3>${t('wallPts')}</h3><div class="wallpts">${w.pts.map((p, k) => `<span>${k + 1}</span>${num(`data-wp="${k}|0"`, fmt(p[0]), 0.5, ro)}${num(`data-wp="${k}|1"`, fmt(p[1]), 0.5, ro)}${!ro && w.pts.length > 2 ? `<button data-act="wallDelPt" data-k="${k}" title="${t('del')}">✕</button>` : '<span></span>'}`).join('')}</div>
    <div class="prop"><span>${t('wallSide')}</span><select data-wside="1" ${ro}>${opt(1, t('sideRight'), w.side)}${opt(-1, t('sideLeft'), w.side)}</select></div>
    ${ro ? '' : `<div class="row wrap"><button data-act="wallAddPt">${t('wallAddPt')}</button><button data-act="delSel">${t('del')}</button></div>`}`;
}
function jointPanel(j, ro) {
  const [x, y] = P(j.id), ls = linksOfJoint(mech, j.id);
  const rails = mech.links.filter(l => !l.joints.includes(j.id));
  return `<div class="prop">
    <span>${t('name')}</span><input type="text" data-f="name" value="${esc(j.name)}" ${ro}>
    <span>x, ${t('mm')}</span>${num('data-f="x"', fmt(x), 0.5, ro)}
    <span>y, ${t('mm')}</span>${num('data-f="y"', fmt(y), 0.5, ro)}
    <span>${t('type')}</span><select data-f="type" ${ro}>${['R', 'G', 'P'].map(k => opt(k, t('t' + k), j.type)).join('')}</select>
    ${j.type === 'P' ? `<span>${t('rail')}</span><select data-f="rail" ${ro}>${opt('', t('railGround'), j.rail || '')}${rails.map(l => opt(l.id, t('railLink') + ' ' + esc(lname(l)), j.rail || '')).join('')}</select>
      <span>${t('railAngle')}</span>${num('data-f="angle"', fmt(j.angle || 0), 5, ro)}
      ${!j.rail ? `<span>${t('linDriverMake')}</span><input type="checkbox" data-f="lindriver" ${mech.driver?.kind === 'lin' && mech.driver.joint === j.id ? 'checked' : ''} ${ro}>` : ''}` : ''}
    <span>${t('trace')}</span><input type="checkbox" data-f="trace" ${j.trace ? 'checked' : ''}>
    ${j.type === 'G' && ls.length ? `<span>${t('makeDriver')}</span><select data-f="driver" ${ro}>${opt('', t('none'), '')}${ls.map(l => `<option value="${l.id}" ${mech.driver?.kind !== 'lin' && mech.driver?.pivot === j.id && mech.driver.link === l.id ? 'selected' : ''}>${esc(lname(l))}</option>`).join('')}</select>` : ''}
  </div>
  <div class="row"><span class="muted small">${t('link')}: ${ls.map(l => `<span class="chip">${esc(lname(l))}</span>`).join(' ') || '—'}</span></div>
  ${ro ? '' : `<div class="row wrap"><button data-act="toggleFix" title="${t('toggleFixTip')}">${j.type === 'G' ? t('makeFree') : t('makeFixed')}</button><button data-act="delSel">${t('del')}</button></div>`}`;
}
function linkPanel(l, ro) {
  const nm = id => jointById(mech, id).name;
  const prs = []; for (let a = 0; a < l.joints.length; a++) for (let b = a + 1; b < l.joints.length; b++) prs.push([l.joints[a], l.joints[b]]);
  const g = l.gear;
  return `<div class="muted small">${t('jointsOfLink')}: ${l.joints.map(id => `<span class="chip">${esc(nm(id))}</span>`).join('')}</div>
    <h3>${t('lengths')}</h3><div class="prop">${prs.map(([a, b]) => { const pa = P(a), pb = P(b); return `<span>${esc(nm(a))}${esc(nm(b))}, ${t('mm')}</span>${num(`data-len="${a}|${b}"`, fmt(Math.hypot(pa[0] - pb[0], pa[1] - pb[1])), 0.5, ro)}`; }).join('')}</div>
    ${l.joints.length >= 3 && !g && !l.rack ? `<div class="prop"><span>${t('shape')}</span><select data-shape="1" ${ro}>${opt('plate', t('shapePlate'), l.bars ? 'bent' : 'plate')}${opt('bent', t('shapeBent'), l.bars ? 'bent' : 'plate')}</select></div>` : ''}
    <h3>${t('gearSec')}</h3><div class="prop">
      <span>${t('isGear')}</span><input type="checkbox" data-g="on" ${g ? 'checked' : ''} ${ro}>
      ${g ? `<span>${t('gearCenter')}</span><select data-g="center" ${ro}>${l.joints.map(id => opt(id, esc(nm(id)), g.center)).join('')}</select>
      <span>${t('gearR')}</span>${num('data-g="r"', g.r, 0.5, ro)}
      <span>${t('gearZ')}</span>${num('data-g="z"', g.z, 1, ro)}
      <span>${t('module')}</span><span class="muted small">m = ${fmt(2 * g.r / g.z)} ${t('mm')}</span>
      <span>${t('gearRing')}</span><input type="checkbox" data-g="ring" ${g.ring ? 'checked' : ''} ${ro}>` : ''}
      ${!g ? `<span>${t('isRack')}</span><input type="checkbox" data-g="rack" ${l.rack ? 'checked' : ''} ${ro}>` : ''}
    </div>
    ${ro ? '' : `<div class="row wrap"><button data-act="addPt">${t('addPoint')}</button><button data-act="delSel">${t('del')}</button></div>`}`;
}
function camPanel(c, ro) {
  const prof = geo().prof.get(c.id), warn = prof && prof.maxP > 30;
  const B = c.beta || [120, 60, 120, 60], hUnit = c.kind === 'rocker' ? '°' : t('mm');
  return `<div class="prop">
    <span>${t('followerKind')}</span><select data-c="kind" ${ro}>${opt('trans', t('fTrans'), c.kind)}${opt('rocker', t('fRocker'), c.kind)}</select>
    <span>${t('law')}</span><select data-c="law" ${ro}>${LAWS.map(k => opt(k, t('law_' + k), c.law)).join('')}</select>
    <span>${t('camH')}, ${hUnit}</span>${num('data-c="h"', c.h, 1, ro)}
    <span>${t('bRise')}, °</span>${num('data-c="b0"', B[0], 5, ro)}
    <span>${t('bDwellTop')}, °</span>${num('data-c="b1"', B[1], 5, ro)}
    <span>${t('bReturn')}, °</span>${num('data-c="b2"', B[2], 5, ro)}
    <span>${t('bDwellLow')}, °</span><span class="muted small">${fmt(camBetas(c)[3])}° ${t('auto360')}</span>
    <span>${t('rb')}, ${t('mm')}</span>${num('data-c="rb"', c.rb, 1, ro)}
    <span>${t('rr')}, ${t('mm')}</span>${num('data-c="rr"', c.rr, 0.5, ro)}
    ${c.kind === 'rocker' ? `<span>${t('arm')}, ${t('mm')}</span>${num('data-c="arm"', c.arm, 1, ro)}<span>${t('pivotDist')}, ${t('mm')}</span>${num('data-c="pivotDist"', c.pivotDist, 1, ro)}`
      : `<span>${t('offset')}, ${t('mm')}</span>${num('data-c="e"', c.e, 0.5, ro)}`}
  </div>
  <div class="row small"><span>${t('pressMax')}</span><b class="${warn ? 'warn' : ''}">${prof ? prof.maxP.toFixed(1) : '—'}°</b></div>
  ${warn ? `<div class="warnbox">⚠ ${t('pressWarn')}</div>` : ''}
  ${ro ? '' : `<div class="row"><button data-act="delSel">${t('del')}</button></div>`}`;
}
function updateCoordInputs() {
  const it = primary(); if (it?.kind !== 'joint') return;
  const [x, y] = P(it.id), ix = $('#props [data-f=x]'), iy = $('#props [data-f=y]');
  if (ix && document.activeElement !== ix) ix.value = fmt(x);
  if (iy && document.activeElement !== iy) iy.value = fmt(y);
}
$('#props').addEventListener('change', e => {
  const el = e.target, it = primary();
  if ((el.dataset.wp || el.dataset.wside) && it?.kind === 'wall') {
    const w = wallById(mech, it.id); pushUndo();
    if (el.dataset.wside) w.side = +el.value < 0 ? -1 : 1;
    else { const [k, c] = el.dataset.wp.split('|').map(Number); w.pts[k][c] = +el.value || 0; }
    changed(); return;
  }
  if (el.dataset.shape && it?.kind === 'link') {
    const l = linkById(mech, it.id); pushUndo();
    if (el.value === 'bent') l.bars = chainBars(l.joints); else delete l.bars;
    changed(); return;
  }
  if (el.dataset.len) {
    const [a, b] = el.dataset.len.split('|'), ja = jointById(mech, a), jb = jointById(mech, b), L = +el.value;
    if (!(L > 0)) return renderPanels();
    pushUndo(); const [mv, fx] = jb.type === 'G' && ja.type !== 'G' ? [ja, jb] : [jb, ja];
    const dx = mv.x - fx.x, dy = mv.y - fx.y, d = Math.hypot(dx, dy) || 1; mv.x = fx.x + dx / d * L; mv.y = fx.y + dy / d * L;
    return changed();
  }
  if (el.dataset.g && it?.kind === 'link') {
    const l = linkById(mech, it.id), k = el.dataset.g; pushUndo();
    if (k === 'on') { if (el.checked) { l.gear = { center: l.joints[0], r: 20, z: 20, ring: false }; delete l.rack; } else delete l.gear; }
    else if (k === 'rack') { if (el.checked) l.rack = { z: 0 }; else delete l.rack; }
    else if (k === 'center') l.gear.center = el.value;
    else if (k === 'r') l.gear.r = Math.max(0.5, +el.value || l.gear.r);
    else if (k === 'z') l.gear.z = Math.max(4, Math.round(+el.value || l.gear.z));
    else if (k === 'ring') l.gear.ring = el.checked;
    return changed();
  }
  if (el.dataset.c && it?.kind === 'cam') {
    const c = camById(mech, it.id), k = el.dataset.c; pushUndo();
    if (k === 'kind' || k === 'law') c[k] = el.value;
    else if (k[0] === 'b' && k.length === 2) { c.beta = camBetas(c); c.beta[+k[1]] = Math.max(k === 'b1' ? 0 : 1, +el.value || 0); c.beta = camBetas(c); }
    else c[k] = Math.max(k === 'e' ? -1e9 : k === 'rr' ? 0 : 0.5, +el.value || 0);
    rebuildCam(mech, c);
    return changed();
  }
  const j = it?.kind === 'joint' && jointById(mech, it.id); if (!j) return;
  const f = el.dataset.f;
  if (f === 'trace') { j.trace = el.checked; if (!j.trace) sim.traces.delete(j.id); changed(false); return; }
  pushUndo();
  if (f === 'name') j.name = el.value || j.name;
  else if (f === 'x' || f === 'y' || f === 'angle') j[f] = +el.value || 0;
  else if (f === 'type') { j.type = el.value; if (j.type !== 'P') j.rail = null; }
  else if (f === 'rail') j.rail = el.value || null;
  else if (f === 'driver') { if (el.value) setDriver(mech, el.value, j.id); else mech.driver = null; }
  else if (f === 'lindriver') { if (el.checked) setLinearDriver(mech, j.id); else mech.driver = null; }
  changed(f !== 'name');
});
$('#props').addEventListener('click', e => {
  const a = e.target.dataset.act; if (!a) return;
  if (a === 'delSel') return deleteSelection();
  if (a === 'addFloor') {
    pushUndo(); const w = addWall(mech, floorFor(mech)); selectOnly({ kind: 'wall', id: w.id }); changed(); toast(t('floorAdded'), true); return;
  }
  if (a === 'merge') {
    const ids = selItems().filter(i => i.kind === 'link').map(i => i.id);
    const r = mergeLinks(JSON.parse(JSON.stringify(mech)), ids); // пробное объединение на копии
    if (typeof r === 'string') { toast(t('merge_' + r)); return; }
    pushUndo(); const nl = mergeLinks(mech, ids);
    selectOnly({ kind: 'link', id: nl.id }); changed(); toast(t('mergeDone'), true); return;
  }
  const it = primary(); if (!it) return;
  pushUndo();
  if (a === 'wallAddPt' || a === 'wallDelPt') {
    const w = wallById(mech, it.id); if (!w) return;
    if (a === 'wallDelPt') w.pts.splice(+e.target.dataset.k, 1);
    else { const p = w.pts.at(-1), q = w.pts.at(-2); w.pts.push([p[0] + (p[0] - q[0]) * 0.5, p[1] + (p[1] - q[1]) * 0.5]); }
    changed(); return;
  }
  if (a === 'toggleFix') {
    const j = jointById(mech, it.id); if (!j) return;
    j.type = j.type === 'G' ? 'R' : 'G'; j.rail = null; changed(); toast(t(j.type === 'G' ? 'madeFixed' : 'madeFree'), true); return;
  }
  if (a === 'addPt') {
    const l = linkById(mech, it.id), pts = l.joints.map(id => jointById(mech, id));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const [ax, ay] = [pts[0].x, pts[0].y], [bx, by] = [pts[1].x, pts[1].y], L = Math.hypot(bx - ax, by - ay) || 1;
    const off = pts.length === 2 ? 0.3 * L : 0;
    const nj = addJoint(mech, +(cx - (by - ay) / L * off).toFixed(3), +(cy + (bx - ax) / L * off).toFixed(3)); nj.trace = true;
    l.joints.push(nj.id); if (l.bars) l.bars.push([l.joints[0], nj.id]); selectOnly({ kind: 'joint', id: nj.id });
  }
  changed();
});
$('#mechInfo').addEventListener('click', e => {
  const id = e.target.dataset.delmesh; if (!id || st.mode !== 'edit') return;
  pushUndo(); mech.gears = mech.gears.filter(g => g.id !== id); changed();
});
$('#driverPanel').addEventListener('change', e => {
  const k = e.target.dataset.d, dr = mech.driver; if (!k || !dr) return;
  if (k === 'speed') dr.speed = Math.max(0.1, +e.target.value || dr.speed);
  if (k === 'dir') { dr.dir = +e.target.value; sim.dir = dr.dir; sim.Tprev = null; }
  if (k === 'lock') dr.lock = e.target.value;
  if (k === 'smin') dr.smin = Math.min(0, +e.target.value || 0);
  if (k === 'smax') dr.smax = Math.max(0, +e.target.value || 0);
  if (sim.sys?.driver) sim.sys.driver.speed = dr.speed;
  chart = null; changed(false); updateV(); autoChart();
});

// ---------- анализ ----------
function chartItem() {
  const it = primary(); if (!it) return null;
  if (it.kind === 'joint') return { ...it, label: jointById(mech, it.id).name };
  if (it.kind === 'link') return { ...it, label: lname(linkById(mech, it.id)) };
  return it.kind === 'cam' ? { ...it, label: t('cam') } : null;
}
function syncChartOptions() {
  const it = chartItem(), sel = $('#chartOut'), prev = sel.value;
  const keys = !it ? [] : it.kind === 'joint' ? ['ox', 'oy', 'ovx', 'ovy', 'ov', 'oa'] : it.kind === 'link' ? ['ophi', 'oomega', 'oeps'] : ['cs', 'cv', 'ca', 'cpress'];
  const cam = it?.kind === 'cam' && camById(mech, it.id), rk = cam && cam.kind === 'rocker';
  sel.innerHTML = keys.map(k => `<option value="${k}">${t(rk && k !== 'cpress' ? k + 'R' : k)}</option>`).join('');
  if (keys.includes(prev)) sel.value = prev;
  $('#chartTarget').textContent = it ? `${t(it.kind === 'cam' ? 'cam' : it.kind === 'joint' ? 'joint' : 'link')} ${it.kind === 'cam' ? '' : it.label}` : t('selForChart');
}
function buildChart() {
  const it = chartItem(); if (!it) { chart = null; return; }
  const s = compile(mech);
  if (!s.driver) { chart = null; $('#chartMsg').textContent = t('noDriverMsg'); return; }
  const fresh = live() && sim.sys && sim.ver === st.geom;
  let X0 = fresh ? sim.X : s.X0, q0 = fresh ? sim.theta : s.theta0;
  if (fresh) loadAngles(s, saveAngles(sim.sys));
  const lin = s.driver.kind === 'lin';
  let r;
  if (lin) {
    s.driver.dir = 1; const { smin, smax } = mech.driver;
    const pre = advance(s, X0, q0, smin - q0); X0 = pre.X; q0 = pre.theta;
    r = sweep(s, X0, q0, 1, Math.max(1, Math.round((smax - smin) / 0.5)), 0.5);
  } else { s.driver.dir = sim.dir || mech.driver.dir; r = sweep(s, X0, q0, 1, 360); }
  const F = r.frames, w = (lin ? mech.driver.speed : mech.driver.speed * D2R) * s.driver.dir;
  const off = lin ? 0 : Math.floor(F[0].theta / D2R / 360) * 360;
  const xs = F.map(f => (lin ? f.theta : f.theta / D2R - off)), cols = {};
  const diff = arr => arr.map((_, k) => { const a = Math.max(0, k - 1), b = Math.min(arr.length - 1, k + 1); return b > a ? (arr[b] - arr[a]) / (F[b].theta - F[a].theta) : 0; });
  const unwrapDeg = arr => { let prev = null; return arr.map(a => { if (prev != null) a = prev + ((a - prev + 540) % 360 - 180); prev = a; return a; }); };
  if (it.kind === 'joint') {
    const i = s.idx.get(it.id);
    cols.ox = F.map(f => f.X[2 * i]); cols.oy = F.map(f => f.X[2 * i + 1]);
    cols.ovx = F.map(f => f.V[2 * i] * w); cols.ovy = F.map(f => f.V[2 * i + 1] * w);
    cols.ov = cols.ovx.map((v, k) => Math.hypot(v, cols.ovy[k]));
    const ax = diff(cols.ovx).map(v => v * w), ay = diff(cols.ovy).map(v => v * w);
    cols.oa = ax.map((v, k) => Math.hypot(v, ay[k]));
  } else if (it.kind === 'link') {
    const l = linkById(mech, it.id), a = s.idx.get(l.joints[0]), b = s.idx.get(l.joints[1]);
    cols.ophi = unwrapDeg(F.map(f => Math.atan2(f.X[2 * b + 1] - f.X[2 * a + 1], f.X[2 * b] - f.X[2 * a]) / D2R));
    cols.oomega = diff(cols.ophi).map(v => v * w);
    cols.oeps = diff(cols.oomega).map(v => v * w);
  } else {
    const c = camById(mech, it.id), info = s.camInfo.get(c.id), prof = geo().prof.get(c.id); if (!info || !prof) { chart = null; return; }
    const Fi = s.idx.get(c.follower), base = c.h * info.L0;
    const camAng = F.map(f => f.A[info.body][1]);
    if (c.kind === 'rocker') { const ab = info.arm; cols.cs = F.map(f => base + info.sg * f.A[ab][1] / D2R); }
    else cols.cs = F.map(f => base + (f.X[2 * Fi] - info.fx) * info.dx + (f.X[2 * Fi + 1] - info.fy) * info.dy);
    cols.cv = diff(cols.cs).map(v => v * w); cols.ca = diff(cols.cv).map(v => v * w);
    cols.cpress = camAng.map(a => { let k = Math.round(a / (2 * Math.PI) * prof.N) % prof.N; if (k < 0) k += prof.N; return prof.press[k]; });
  }
  chart = { xs, cols, item: it, ok: r.ok, ver: st.geom, lin };
  $('#chartMsg').textContent = r.ok ? '' : t('cycleShort');
}
function autoChart() { buildChart(); renderChart(); }
function renderChart() {
  const cvc = $('#chart'), k = $('#chartOut').value;
  if (!chart || !chart.cols[k]) { drawChart(cvc, [], []); return; }
  let mk = null;
  if (live() && sim.sys) {
    if (chart.lin) mk = sim.theta;
    else { mk = sim.theta / D2R; const x0 = Math.min(...chart.xs), x1 = Math.max(...chart.xs); while (mk < x0) mk += 360; while (mk > x1 && mk - 360 >= x0) mk -= 360; }
  }
  const opt = $('#chartOut').selectedOptions[0]?.textContent || k;
  drawChart(cvc, chart.xs, chart.cols[k], { xLabel: t(chart.lin ? 'inputLin' : 'input'), yLabel: `${chart.item.label}: ${opt}`, marker: mk, limit: k === 'cpress' ? 30 : null });
}
function exportCsv() {
  if (!chart) buildChart(); if (!chart) return;
  const keys = Object.keys(chart.cols);
  const lines = [[chart.lin ? 'q_mm' : 'theta_deg', ...keys.map(k => t(k).replace(/,/g, ' '))].join(',')];
  chart.xs.forEach((x, n) => lines.push([x.toFixed(4), ...keys.map(k => chart.cols[k][n].toFixed(6))].join(',')));
  download(`${chart.item.label}.csv`, '\ufeff' + lines.join('\n'), 'text/csv');
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- кнопки ----------
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
$('#btnSnap').onclick = () => { st.snap = !st.snap; $('#btnSnap').classList.toggle('on', st.snap); };
$('#btnFit').onclick = fitView;
$('#gridStep').onchange = e => { st.grid = Math.max(0.1, +e.target.value || 5); };
$('#btnPlay').onclick = togglePlay;
$('#btnStep').onclick = () => { if (st.mode === 'sim') { sim.playing = false; syncSimUi(); stepSim(isLin() ? 1 : 5 * D2R); } };
$('#btnReset').onclick = () => { sim.ver = -1; ensureSys(); syncSimUi(); };
$('#speed').oninput = e => { sim.mul = +e.target.value; $('#speedVal').textContent = sim.mul.toFixed(1) + '×'; };
$('#btnClearTr').onclick = () => sim.traces.clear();
$('#btnApply').onclick = () => {
  if (!sim.sys) return; pushUndo();
  for (const c of mech.cams || []) c.phase = +((((c.phase || 0) + camRot(c) / D2R) % 360 + 360) % 360).toFixed(9);
  if (mech.driver?.kind === 'lin') { mech.driver.smin -= sim.theta; mech.driver.smax -= sim.theta; mech.driver.smin = Math.min(0, mech.driver.smin); mech.driver.smax = Math.max(0, mech.driver.smax); }
  mech.joints.forEach(j => { const i = sim.sys.idx.get(j.id); if (i !== undefined) { j.x = +sim.X[2 * i].toFixed(6); j.y = +sim.X[2 * i + 1].toFixed(6); } });
  for (const j of mech.joints) if (j.type === 'P') { const f = railOf(j); j.angle = +(Math.atan2(f.dy, f.dx) / D2R).toFixed(6); }
  changed(); setMode('edit');
};
$('#btnLinkDone').onclick = () => (st.tool === 'wall' ? finishWall() : finishLink()); $('#btnLinkCancel').onclick = cancelLink;
$('#btnChart').onclick = autoChart; $('#btnCsv').onclick = exportCsv;
$('#chartOut').onchange = renderChart;
$('#lang').value = lang;
$('#lang').onchange = e => { setLang(e.target.value); fillPresets(); renderPanels(); syncHint(); syncSimUi(); renderChart(); refreshTheory(); };
initTheory({ getMech: () => mech, getCanvas: () => cv, download });
$('#btnTheory').onclick = () => toggleTheory();
function fillPresets() { $('#preset').innerHTML = `<option value="">${t('choosePreset')}</option>` + PRESET_KEYS.map(k => `<option value="${k}">${t('p_' + k)}</option>`).join(''); }
$('#preset').onchange = e => { const k = e.target.value; if (!k) return; setMode('edit'); setMech(PRESETS[k]()); e.target.value = ''; };
$('#btnNew').onclick = () => { if (confirm(t('confirmNew'))) { setMode('edit'); setMech(emptyMech()); st.view = { x: 0, y: 0, s: 4 }; } };
$('#btnSave').onclick = () => download('mechanism.json', JSON.stringify(mech, null, 2), 'application/json');
$('#btnOpen').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { setMode('edit'); setMech(validate(JSON.parse(await f.text()))); } catch { alert(t('badFile')); }
  e.target.value = '';
};
new ResizeObserver(() => { resize(); renderChart(); }).observe(cv);

// ---------- старт ----------
applyStatic(); fillPresets(); resize(); fitView();
document.querySelector('#modes [data-mode=edit]').classList.add('on'); setTool('select');
syncSimUi(); renderPanels(); syncHint();
requestAnimationFrame(loop);
window.__app = {
  st, sim, get mech() { return mech; }, setMode, loadPreset: k => setMech(PRESETS[k]()), toS, P,
  theory: theoryAnalysis, toggleTheory, setTheoryTab,
  select: (kind, id) => { selectOnly({ kind, id }); renderPanels(); autoChart(); }, selCount: () => selItems().length, fitView, geo,
};
