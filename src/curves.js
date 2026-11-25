// Криволинейная геометрия стен и звеньев (v6). Только форма — на кинематику не влияет.
//  • «Изгиб» (стрелка прогиба) s участка A→B: s > 0 — дуга выгнута влево от направления A→B,
//    s < 0 — вправо, |s| = L/2 — полуокружность. Дуга всегда проходит через A и B.
//  • «Радиус скругления» r: угол между двумя прямыми участками заменяется касательной дугой.
//  • «Скругление углов» пластины: контур — выпуклая оболочка шарниров, раздутая на r.
// Примитивы: { k:'L', x1,y1,x2,y2 } и { k:'A', cx,cy,r,a0,sw, x1,y1,x2,y2 } (sw — угол со знаком).
const TAU = 2 * Math.PI;
export const nrm = a => ((a % TAU) + TAU) % TAU;
export const line = (x1, y1, x2, y2) => ({ k: 'L', x1, y1, x2, y2 });
function arcPrim(cx, cy, r, a0, sw) {
  return { k: 'A', cx, cy, r, a0, sw, x1: cx + r * Math.cos(a0), y1: cy + r * Math.sin(a0), x2: cx + r * Math.cos(a0 + sw), y2: cy + r * Math.sin(a0 + sw) };
}
// Дуга через A и B со стрелкой прогиба s (или отрезок при s ≈ 0)
export function arcFrom(ax, ay, bx, by, s) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (!s || L < 1e-12 || Math.abs(s) < 1e-9 * L) return line(ax, ay, bx, by);
  const nx = -dy / L, ny = dx / L, mx = (ax + bx) / 2, my = (ay + by) / 2;
  const R = (L * L / 4 + s * s) / (2 * s), cx = mx + nx * (s - R), cy = my + ny * (s - R);
  const a0 = Math.atan2(ay - cy, ax - cx), a1 = Math.atan2(by - cy, bx - cx), am = Math.atan2(my + ny * s - cy, mx + nx * s - cx);
  const d = nrm(a1 - a0), dm = nrm(am - a0);
  const p = arcPrim(cx, cy, Math.abs(R), a0, dm < d ? d : d - TAU);
  p.x1 = ax; p.y1 = ay; p.x2 = bx; p.y2 = by; return p;
}
// Средняя точка участка с изгибом (ручка «Изгиб») и нормаль участка
export function bulgeHandle(ax, ay, bx, by, s) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  return { x: (ax + bx) / 2 + nx * s, y: (ay + by) / 2 + ny * s, mx: (ax + bx) / 2, my: (ay + by) / 2, nx, ny, L };
}
// Граф участков: bars = [[a, b, s], …] (a, b — ключи точек), P(key) → [x, y]. Скругление r — в вершинах,
// где сходятся ровно два прямых участка. Возвращает список примитивов.
export function barsShape(P, bars, fillet = 0) {
  const ends = bars.map(() => [0, 0]), arcs = [];
  if (fillet > 0) {
    const inc = new Map();
    bars.forEach(([a, b], k) => { for (const [v, e] of [[a, 0], [b, 1]]) { if (!inc.has(v)) inc.set(v, []); inc.get(v).push([k, e]); } });
    // e = 1: вершина — конец участка (входящий), 0 — начало
    for (const [v, lst] of inc) {
      if (lst.length !== 2 || lst.some(([k]) => Math.abs(bars[k][2] || 0) > 0)) continue;
      lst.sort((p, q) => q[1] - p[1]); // сначала входящий: дуга идёт по направлению обхода
      const [V] = [P(v)], dirs = lst.map(([k, e]) => { const o = P(e ? bars[k][0] : bars[k][1]), L = Math.hypot(o[0] - V[0], o[1] - V[1]); return { L, x: (o[0] - V[0]) / (L || 1), y: (o[1] - V[1]) / (L || 1) }; });
      const ca = Math.max(-1, Math.min(1, dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y)), al = Math.acos(ca);
      if (al < 1e-3 || al > Math.PI - 1e-3 || dirs.some(d => d.L < 1e-9)) continue;
      const th = Math.tan(al / 2), t = Math.min(fillet / th, 0.5 * dirs[0].L, 0.5 * dirs[1].L), r = t * th;
      const bx = dirs[0].x + dirs[1].x, by = dirs[0].y + dirs[1].y, bl = Math.hypot(bx, by), h = r / Math.sin(al / 2);
      const cx = V[0] + bx / bl * h, cy = V[1] + by / bl * h;
      const T1 = [V[0] + dirs[0].x * t, V[1] + dirs[0].y * t], T2 = [V[0] + dirs[1].x * t, V[1] + dirs[1].y * t];
      const a0 = Math.atan2(T1[1] - cy, T1[0] - cx), d = nrm(Math.atan2(T2[1] - cy, T2[0] - cx) - a0);
      arcs.push(arcPrim(cx, cy, r, a0, d <= Math.PI ? d : d - TAU));
      lst.forEach(([k, e]) => { ends[k][e] = t; });
    }
  }
  const out = bars.map(([a, b, s], k) => {
    const A = P(a), B = P(b);
    if (s) return arcFrom(A[0], A[1], B[0], B[1], s);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, [t0, t1] = ends[k];
    return line(A[0] + ux * t0, A[1] + uy * t0, B[0] - ux * t1, B[1] - uy * t1);
  });
  return out.concat(arcs);
}
// Выпуклая оболочка (против часовой стрелки, мировые оси)
export function hullCCW(pts) {
  const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 1e-12) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 1e-12) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// Пластина со скруглёнными углами: оболочка, раздутая на r (отрезки + дуги вокруг шарниров), по порядку обхода
export function roundedHull(pts, r) {
  const H = hullCCW(pts), n = H.length, out = [];
  if (n < 2 || !(r > 0)) return out;
  const nrmOf = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dy / L, -dx / L]; };
  const N = H.map((p, i) => nrmOf(p, H[(i + 1) % n]));
  for (let i = 0; i < n; i++) {
    const p = H[i], q = H[(i + 1) % n], [nx, ny] = N[i], [px, py] = N[(i - 1 + n) % n];
    const a0 = Math.atan2(py, px), sw = n === 2 && i === 0 ? Math.PI : nrm(Math.atan2(ny, nx) - a0);
    if (sw > 1e-9) out.push(arcPrim(p[0], p[1], r, a0, n === 2 ? Math.PI : sw));
    out.push(line(p[0] + nx * r, p[1] + ny * r, q[0] + nx * r, q[1] + ny * r));
  }
  return out;
}
// Стена → примитивы. Точка стены [x, y, s]: s — изгиб участка, начинающегося в этой точке.
export function wallBars(w) {
  const n = w.pts.length, m = w.closed && n >= 2 ? n : n - 1, bars = [];
  for (let k = 0; k < m; k++) bars.push([k, (k + 1) % n, w.pts[k][2] || 0]);
  return bars;
}
export const wallPrims = w => barsShape(k => w.pts[k], wallBars(w), w.fillet || 0);
// Изгиб участка звена a–b (хранится в l.bend["a,b"], с обратным знаком для b–a)
export function bendOf(l, a, b) { const m = l.bend || {}; return m[a + ',' + b] ?? (m[b + ',' + a] != null ? -m[b + ',' + a] : 0); }
export function setBend(l, a, b, s) {
  l.bend ||= {}; delete l.bend[b + ',' + a];
  if (Math.abs(s) > 1e-9) l.bend[a + ',' + b] = s; else delete l.bend[a + ',' + b];
  if (!Object.keys(l.bend).length) delete l.bend;
}
// Участки звена, которым можно задать изгиб: стержни ломаного звена или единственный стержень двухшарнирного
export function linkBars(l) {
  if (l.gear || l.rack) return [];
  if (l.bars) return l.bars.map(([a, b]) => [a, b]);
  return l.joints.length === 2 ? [[l.joints[0], l.joints[1]]] : [];
}
export const isCurvedLink = l => !!(l.bend || l.fillet > 0 || l.round > 0);
// Контур звена в текущем положении P(id) → [x, y]; null — обычная (прямолинейная) форма
export function linkPrims(l, P) {
  if (l.gear || l.rack) return null;
  if (l.round > 0 && !l.bars && l.joints.length >= 3) return roundedHull(l.joints.map(P), l.round);
  const bars = linkBars(l); if (!bars.length || !(l.bend || l.fillet > 0)) return null;
  return barsShape(P, bars.map(([a, b]) => [a, b, bendOf(l, a, b)]), l.bars ? l.fillet || 0 : 0);
}

// ---------- пересечения и расстояния ----------
const onArc = (A, ang, tol) => { const rel = A.sw > 0 ? nrm(ang - A.a0) : nrm(A.a0 - ang); return rel > tol && rel < Math.abs(A.sw) - tol; };
const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function segSeg(a, b, e) {
  const d1 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1), d2 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  if (!((d1 > e && d2 < -e) || (d1 < -e && d2 > e))) return null;
  const d3 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1), d4 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  if (!((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return null;
  const t = d1 / (d1 - d2); return [a.x1 + t * (a.x2 - a.x1), a.y1 + t * (a.y2 - a.y1)];
}
function segArc(s, A, tl) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, a = dx * dx + dy * dy; if (a < 1e-30) return null;
  const fx = s.x1 - A.cx, fy = s.y1 - A.cy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - A.r * A.r, disc = b * b - 4 * a * c;
  if (disc <= 0 || Math.sqrt(disc) / (2 * Math.sqrt(a)) < tl) return null; // касание — не пересечение
  const sq = Math.sqrt(disc), L = Math.sqrt(a), tau = tl / L, at = tl / A.r;
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t <= tau || t >= 1 - tau) continue;
    const x = s.x1 + t * dx, y = s.y1 + t * dy;
    if (onArc(A, Math.atan2(y - A.cy, x - A.cx), at)) return [x, y];
  }
  return null;
}
function arcArc(A, B, tl) {
  const dx = B.cx - A.cx, dy = B.cy - A.cy, d = Math.hypot(dx, dy);
  if (d < tl || d >= A.r + B.r - tl || d <= Math.abs(A.r - B.r) + tl) return null;
  const a = (d * d + A.r * A.r - B.r * B.r) / (2 * d), h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
  const mx = A.cx + dx * a / d, my = A.cy + dy * a / d;
  for (const sg of [-1, 1]) {
    const x = mx - sg * h * dy / d, y = my + sg * h * dx / d;
    if (onArc(A, Math.atan2(y - A.cy, x - A.cx), tl / A.r) && onArc(B, Math.atan2(y - B.cy, x - B.cx), tl / B.r)) return [x, y];
  }
  return null;
}
// Собственное пересечение двух примитивов (касание и концы не считаются). e — допуск площади для отрезков, tl — длины.
export function primCross(p, q, e, tl) {
  if (p.k === 'L' && q.k === 'L') return segSeg(p, q, e);
  if (p.k === 'L') return segArc(p, q, tl);
  if (q.k === 'L') return segArc(q, p, tl);
  return arcArc(p, q, tl);
}
export function primClosest(px, py, p) {
  if (p.k === 'L') {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1, L2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((px - p.x1) * dx + (py - p.y1) * dy) / L2));
    return [p.x1 + u * dx, p.y1 + u * dy];
  }
  const ang = Math.atan2(py - p.cy, px - p.cx);
  if (onArc(p, ang, 0)) return [p.cx + p.r * Math.cos(ang), p.cy + p.r * Math.sin(ang)];
  return Math.hypot(px - p.x1, py - p.y1) < Math.hypot(px - p.x2, py - p.y2) ? [p.x1, p.y1] : [p.x2, p.y2];
}
export const primDist = (px, py, p) => { const [x, y] = primClosest(px, py, p); return Math.hypot(px - x, py - y); };
// Касательная (единичная) примитива в точке
export function primTan(p, x, y) {
  if (p.k === 'L') { const dx = p.x2 - p.x1, dy = p.y2 - p.y1, L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; }
  const rx = x - p.cx, ry = y - p.cy, L = Math.hypot(rx, ry) || 1; return [-ry / L, rx / L];
}
// Точки примитива для рисования (шаг по углу ≤ 4°)
export function primPoints(p, maxDeg = 4) {
  if (p.k === 'L') return [[p.x1, p.y1], [p.x2, p.y2]];
  const n = Math.max(2, Math.ceil(Math.abs(p.sw) / (maxDeg * Math.PI / 180))), out = [];
  for (let i = 0; i <= n; i++) { const a = p.a0 + p.sw * i / n; out.push([p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)]); }
  return out;
}
