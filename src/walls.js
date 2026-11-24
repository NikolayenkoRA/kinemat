// Стены и пол: односторонние неподвижные ограничения (упоры). Не звенья — в подвижность не входят.
// Проверка столкновений между двумя положениями механизма Xo → Xn:
//  • путь каждого подвижного шарнира не должен пересечь отрезок стены;
//  • ребро звена не должно начать пересекать стену (если пересекало до шага — допускаем, это
//    исходное наложение); касание (шарнир-стойка на стене) не считается пересечением;
//  • окружность колеса с подвижным центром не должна начать перекрывать стену.

export const wallSegments = walls => (walls || []).flatMap(w => w.pts.slice(1).map((p, k) => [w.pts[k][0], w.pts[k][1], p[0], p[1], w.id]));

export function buildWallGeom(mech, idx, scale) {
  const segs = wallSegments(mech.walls);
  if (!segs.length) return null;
  const isG = id => mech.joints.find(j => j.id === id)?.type === 'G';
  const pts = mech.joints.filter(j => j.type !== 'G').map(j => idx.get(j.id));
  const edges = [], key = new Set();
  const add = (a, b) => { const i = idx.get(a), k = idx.get(b); if (i === undefined || k === undefined || i === k) return; const s = i < k ? i + ',' + k : k + ',' + i; if (!key.has(s) && !(isG(a) && isG(b))) { key.add(s); edges.push([i, k]); } };
  for (const l of mech.links) {
    if (l.bars) l.bars.forEach(([a, b]) => add(a, b));
    else for (let p = 0; p < l.joints.length; p++) for (let q = p + 1; q < Math.min(l.joints.length, 8); q++) add(l.joints[p], l.joints[q]);
  }
  const circles = mech.links.filter(l => l.gear && !isG(l.gear.center) && idx.has(l.gear.center)).map(l => [idx.get(l.gear.center), l.gear.r]);
  return { segs, pts, edges, circles, eps: 1e-10 * scale * scale };
}

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
// собственное пересечение отрезков (касание и наложение на одной прямой не считаются)
function cross(p1x, p1y, p2x, p2y, s, e) {
  const d1 = orient(s[0], s[1], s[2], s[3], p1x, p1y), d2 = orient(s[0], s[1], s[2], s[3], p2x, p2y);
  if (!((d1 > e && d2 < -e) || (d1 < -e && d2 > e))) return null;
  const d3 = orient(p1x, p1y, p2x, p2y, s[0], s[1]), d4 = orient(p1x, p1y, p2x, p2y, s[2], s[3]);
  if (!((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return null;
  const t = d1 / (d1 - d2);
  return [p1x + t * (p2x - p1x), p1y + t * (p2y - p1y)];
}
export function segDistPt(px, py, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L2));
  return Math.hypot(px - s[0] - u * dx, py - s[1] - u * dy);
}
// Возвращает null или точку контакта {x, y, wall}
export function wallHit(W, Xo, Xn) {
  if (!W) return null;
  const e = W.eps;
  for (const s of W.segs) {
    for (const i of W.pts) {
      const c = cross(Xo[2 * i], Xo[2 * i + 1], Xn[2 * i], Xn[2 * i + 1], s, e);
      if (c) return { x: c[0], y: c[1], wall: s[4], seg: s };
    }
    for (const [i, k] of W.edges) {
      const cn = cross(Xn[2 * i], Xn[2 * i + 1], Xn[2 * k], Xn[2 * k + 1], s, e);
      if (cn && !cross(Xo[2 * i], Xo[2 * i + 1], Xo[2 * k], Xo[2 * k + 1], s, e)) return { x: cn[0], y: cn[1], wall: s[4], seg: s };
    }
    for (const [c, r] of W.circles) {
      const dn = segDistPt(Xn[2 * c], Xn[2 * c + 1], s);
      if (dn < r && segDistPt(Xo[2 * c], Xo[2 * c + 1], s) >= r) return { x: Xn[2 * c], y: Xn[2 * c + 1], wall: s[4], seg: s };
    }
  }
  return null;
}
// Пол под механизмом: горизонтальная стена ниже самой низкой точки (с запасом)
export function floorFor(mech, X = null, margin = 5) {
  const P = mech.joints.map((j, i) => (X ? [X[2 * i], X[2 * i + 1]] : [j.x, j.y]));
  if (!P.length) return [[-100, 0], [100, 0]];
  let x0 = Math.min(...P.map(p => p[0])), x1 = Math.max(...P.map(p => p[0])), y0 = Math.min(...P.map(p => p[1]));
  for (const l of mech.links) if (l.gear) { const c = mech.joints.findIndex(j => j.id === l.gear.center); if (c >= 0) y0 = Math.min(y0, P[c][1] - l.gear.r * 1.15); }
  const y = Math.floor((y0 - margin) / 5) * 5, pad = Math.max(60, 0.5 * (x1 - x0));
  return [[Math.round(x0 - pad), y], [Math.round(x1 + pad), y]];
}
