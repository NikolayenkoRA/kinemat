// Стены и пол: односторонние неподвижные ограничения (упоры). Не звенья — в подвижность не входят.
// Проверка столкновений между двумя положениями механизма Xo → Xn:
//  • путь каждого подвижного шарнира не должен пересечь отрезок стены;
//  • ребро звена не должно начать пересекать стену (если пересекало до шага — допускаем, это
//    исходное наложение); касание (шарнир-стойка на стене) не считается пересечением;
//  • окружность колеса с подвижным центром не должна начать перекрывать стену.

import { wallPrims, linkPrims, linkBars, primCross, primClosest, primTan, line } from './curves.js';
// v6: стены и звенья могут быть криволинейными (дуги «Изгиб», скругления) — проверка по точной геометрии дуг.

export const wallSegments = walls => (walls || []).flatMap(w => wallPrims(w).map(p => Object.assign(p, { wall: w.id })));

export function buildWallGeom(mech, idx, scale) {
  const segs = wallSegments(mech.walls);
  if (!segs.length) return null;
  const isG = id => mech.joints.find(j => j.id === id)?.type === 'G';
  const pts = mech.joints.filter(j => j.type !== 'G').map(j => idx.get(j.id));
  const edges = [], key = new Set(), shapes = [];
  const add = (a, b) => { const i = idx.get(a), k = idx.get(b); if (i === undefined || k === undefined || i === k) return; const s = i < k ? i + ',' + k : k + ',' + i; if (!key.has(s) && !(isG(a) && isG(b))) { key.add(s); edges.push([i, k]); } };
  for (const l of mech.links) {
    if (l.joints.some(id => !idx.has(id))) continue;
    // криволинейное звено: контур считается заново в каждом положении (форма жёсткая — вместе со звеном)
    if (!l.gear && !l.rack && (l.round > 0 && !l.bars && l.joints.length >= 3 || (l.bend || l.fillet > 0) && linkBars(l).length)) {
      if (!l.joints.every(isG)) shapes.push(l);
      continue;
    }
    if (l.bars) l.bars.forEach(([a, b]) => add(a, b));
    else for (let p = 0; p < l.joints.length; p++) for (let q = p + 1; q < Math.min(l.joints.length, 8); q++) add(l.joints[p], l.joints[q]);
  }
  const circles = mech.links.filter(l => l.gear && !isG(l.gear.center) && idx.has(l.gear.center)).map(l => [idx.get(l.gear.center), l.gear.r]);
  return { segs, pts, edges, shapes, idx, circles, eps: 1e-10 * scale * scale, tl: 1e-7 * scale };
}
const shapeAt = (W, l, X) => linkPrims(l, id => { const i = W.idx.get(id); return [X[2 * i], X[2 * i + 1]]; }) || [];
const hitOf = (s, x, y) => ({ x, y, wall: s.wall, tan: primTan(s, x, y) });
// Возвращает null или точку контакта {x, y, wall, tan} (tan — касательная стены в точке контакта)
export function wallHit(W, Xo, Xn) {
  if (!W) return null;
  const e = W.eps, tl = W.tl;
  const SO = W.shapes.map(l => shapeAt(W, l, Xo)), SN = W.shapes.map(l => shapeAt(W, l, Xn));
  for (const s of W.segs) {
    for (const i of W.pts) {
      const c = primCross(line(Xo[2 * i], Xo[2 * i + 1], Xn[2 * i], Xn[2 * i + 1]), s, e, tl);
      if (c) return hitOf(s, c[0], c[1]);
    }
    for (const [i, k] of W.edges) {
      const cn = primCross(line(Xn[2 * i], Xn[2 * i + 1], Xn[2 * k], Xn[2 * k + 1]), s, e, tl);
      if (cn && !primCross(line(Xo[2 * i], Xo[2 * i + 1], Xo[2 * k], Xo[2 * k + 1]), s, e, tl)) return hitOf(s, cn[0], cn[1]);
    }
    for (let q = 0; q < SN.length; q++) {
      const pn = SN[q], po = SO[q], same = pn.length === po.length;
      for (let r = 0; r < pn.length; r++) {
        const cn = primCross(pn[r], s, e, tl); if (!cn) continue;
        // исходное наложение допускаем: тот же участок (или, если контур перестроился, всё звено) уже пересекал стену
        if (same ? primCross(po[r], s, e, tl) : po.some(p => primCross(p, s, e, tl))) continue;
        return hitOf(s, cn[0], cn[1]);
      }
    }
    for (const [c, r] of W.circles) {
      const qn = primClosest(Xn[2 * c], Xn[2 * c + 1], s), qo = primClosest(Xo[2 * c], Xo[2 * c + 1], s);
      if (Math.hypot(Xn[2 * c] - qn[0], Xn[2 * c + 1] - qn[1]) < r && Math.hypot(Xo[2 * c] - qo[0], Xo[2 * c + 1] - qo[1]) >= r) return hitOf(s, qn[0], qn[1]);
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
