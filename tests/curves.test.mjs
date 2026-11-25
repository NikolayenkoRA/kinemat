// Криволинейные стены и звенья (v6): node tests/curves.test.mjs
import { compile, sweep, dragPath } from '../src/solver.js';
import { PRESETS } from '../src/presets.js';
import { emptyMech, addJoint, addLink, setDriver, addWall, validate, deleteItems, dof, mergeLinks } from '../src/model.js';
import { wallHit, wallSegments } from '../src/walls.js';
import { arcFrom, barsShape, wallPrims, linkPrims, primCross, primPoints, roundedHull, setBend, bendOf } from '../src/curves.js';
let fails = 0, n = 0;
const check = (name, cond, info = '') => { n++; if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const deg = r => r * 180 / Math.PI, near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const W0 = (walls, extra = {}) => ({ segs: wallSegments(walls), pts: [0], edges: [], shapes: [], circles: [], idx: new Map(), eps: 1e-6, tl: 1e-5, ...extra });

// 1. Геометрия: дуга по изгибу, скругление угла, скруглённая пластина
{
  const a = arcFrom(0, 0, 100, 0, 50), mid = primPoints(a, 1)[Math.round(primPoints(a, 1).length / 2) - 1];
  check('arc from bend: semicircle through both ends, apex at the bend', near(a.cx, 50) && near(a.cy, 0) && near(a.r, 50) && near(Math.abs(a.sw), Math.PI) && Math.hypot(mid[0] - 50, mid[1] - 50) < 1, `R=${a.r}, sweep=${deg(a.sw).toFixed(1)}°`);
  const b = arcFrom(0, 0, 100, 0, -20);
  check('negative bend bulges to the right (R = (L²/4 + s²)/2|s|)', near(b.r, 72.5) && near(b.cy, 52.5) && primPoints(b).every(p => p[1] <= 1e-9));
  const f = wallPrims({ pts: [[0, 50], [0, 0], [50, 0]], fillet: 20 }), arc = f.find(q => q.k === 'A'), ls = f.filter(q => q.k === 'L');
  check('fillet: tangent arc of radius r, straight parts trimmed by r at a right angle', arc && near(arc.cx, 20) && near(arc.cy, 20) && near(arc.r, 20) && near(Math.abs(arc.sw), Math.PI / 2) && near(ls[0].y2, 20) && near(ls[1].x1, 20));
  const big = wallPrims({ pts: [[0, 10], [0, 0], [10, 0]], fillet: 100 }).find(q => q.k === 'A');
  check('fillet radius is clamped to half of the shorter segment', big && near(big.r, 5));
  const rh = roundedHull([[0, 0], [30, 0], [15, 25]], 8), arcs = rh.filter(q => q.k === 'A');
  const tot = arcs.reduce((s, q) => s + q.sw, 0);
  check('rounded plate: hull offset by r, corner arcs add up to a full turn', arcs.length === 3 && near(tot, 2 * Math.PI) && rh.filter(q => q.k === 'L').length === 3);
  const c = wallPrims({ pts: [[40, 0, 20], [80, 0, 20]], closed: true });
  check('closed 2-point wall with bends = L/2 is a full circle', c.length === 2 && c.every(q => q.k === 'A' && near(q.r, 20) && near(q.cx, 60) && near(q.cy, 0)) && near(Math.abs(c[0].sw) + Math.abs(c[1].sw), 2 * Math.PI));
}
// 2. Пересечения по настоящим дугам
{
  const w = { id: 'w1', pts: [[0, 0, 20], [100, 0]] }, W = W0([w]);
  check('joint crossing the chord but not the arc: no contact', !wallHit(W, [50, 10], [50, -10]));
  const h = wallHit(W, [50, 30], [50, 10]);
  check('joint crossing the arc: contact on the arc apex, tangent of the arc', h && near(h.x, 50) && near(h.y, 20, 1e-9) && near(Math.abs(h.tan[0]), 1, 1e-9), h ? `(${h.x.toFixed(3)}, ${h.y.toFixed(3)})` : '');
  const h2 = wallHit(W, [10, 30], [10, 0]), yArc = -52.5 + Math.sqrt(72.5 ** 2 - 40 ** 2);
  check('contact point lies exactly on the arc away from the apex', h2 && near(h2.y, yArc, 1e-9), h2 ? `y=${h2.y.toFixed(4)} (exact ${yArc.toFixed(4)})` : '');
  const fw = { id: 'w2', pts: [[0, 50], [0, 0], [50, 0]], fillet: 20 }, WF = W0([fw]), WS = W0([{ id: 'w3', pts: [[0, 50], [0, 0], [50, 0]] }]);
  check('fillet: a joint inside the rounded-off corner passes freely (would hit the sharp corner)', !wallHit(WF, [3, 6], [3, -6]) && !!wallHit(WS, [3, 6], [3, -6]));
  const hf = wallHit(WF, [3, 15], [3, 5]);
  check('fillet: crossing the fillet arc is a contact on the arc', hf && near(Math.hypot(hf.x - 20, hf.y - 20), 20, 1e-9), hf ? `(${hf.x.toFixed(3)}, ${hf.y.toFixed(3)})` : '');
  const A = arcFrom(0, 0, 100, 0, 20), B = arcFrom(50, -10, 50, 40, 10), p = primCross(A, B, 1e-6, 1e-6);
  check('arc × arc: crossing point lies on both circles', p && near(Math.hypot(p[0] - A.cx, p[1] - A.cy), A.r, 1e-9) && near(Math.hypot(p[0] - B.cx, p[1] - B.cy), B.r, 1e-9));
  const T1 = arcFrom(-10, 0, 10, 0, 10), T2 = arcFrom(30, 0, 10, 0, 10);
  check('arc × arc: touching arcs are not a crossing', !primCross(T1, T2, 1e-6, 1e-6) && !primCross(arcFrom(0, 0, 100, 0, 20), { k: 'L', x1: 0, y1: 20, x2: 100, y2: 20 }, 1e-6, 1e-6));
  const WG = W0([w], { pts: [], circles: [[0, 10]] });
  check('gear circle vs arc wall: contact when the pitch circle reaches the arc', !!wallHit(WG, [50, 40], [50, 29]) && !wallHit(WG, [50, 40], [50, 31]));
}
// 3. Ведомое движение: кривошип упирается в круглый упор (точная дуга, не хорда)
{
  const m = emptyMech(); const o = addJoint(m, 0, 0, 'G'), a = addJoint(m, 0, 50); const l = addLink(m, [o.id, a.id]); setDriver(m, l.id, o.id); m.driver.dir = -1;
  addWall(m, [[40, 0, 20], [80, 0, 20]], 1, { closed: true });
  const s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 360), th = deg(r.frames.at(-1).theta), ex = deg(Math.acos(0.95)), X = r.frames.at(-1).X;
  check('driven crank stops on a circular post at the exact arc contact', !r.ok && r.wall && Math.abs(th - ex) < 0.01, `θ=${th.toFixed(4)}° (exact ${ex.toFixed(4)}°; a chord would give 0°)`);
  check('crank tip never enters the post', Math.min(...r.frames.map(f => Math.hypot(f.X[2] - 60, f.X[3]))) >= 20 - 1e-6);
  const err = Math.max(...r.frames.map(f => Math.abs(Math.hypot(f.X[2], f.X[3]) - 50)));
  check('constraints kept (crank length)', err < 1e-8 && Math.abs(Math.hypot(X[2], X[3]) - 50) < 1e-8);
}
// 4. Изогнутое звено: упирается в стену своей дугой раньше, чем конец прямого звена
{
  const run = bend => {
    const m = emptyMech(); const o = addJoint(m, 0, 0, 'G'), a = addJoint(m, 50, 0); const l = addLink(m, [o.id, a.id]); setDriver(m, l.id, o.id);
    if (bend) setBend(l, o.id, a.id, bend);
    addWall(m, [[-100, 25], [100, 25]], -1);
    const s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 360), P = f => id => { const i = s.idx.get(id); return [f.X[2 * i], f.X[2 * i + 1]]; };
    return { r, th: deg(r.frames.at(-1).theta), prims: linkPrims(l, P(r.frames.at(-1))), all: r.frames.map(f => linkPrims(l, P(f))) };
  };
  const st = run(0), cv = run(15), arc = cv.prims && cv.prims[0], wc = cv.r.wall;
  check('straight link: stops when its tip reaches the wall (30°)', !st.r.ok && Math.abs(st.th - 30) < 0.01, `θ=${st.th.toFixed(3)}°`);
  check('curved link (bend 15 mm): its arc hits the wall first', !cv.r.ok && cv.th < st.th - 1 && arc && arc.k === 'A', `θ=${cv.th.toFixed(3)}° < ${st.th.toFixed(3)}°`);
  check('contact point is inside the link arc (not an end) and on the wall', wc && Math.abs(Math.hypot(wc.x - arc.cx, wc.y - arc.cy) - arc.r) < 0.02 && Math.abs(wc.y - 25) < 1e-9 && Math.hypot(wc.x - arc.x2, wc.y - arc.y2) > 1, wc ? `(${wc.x.toFixed(3)}, ${wc.y.toFixed(3)}), off the arc by ${Math.abs(Math.hypot(wc.x - arc.cx, wc.y - arc.cy) - arc.r).toExponential(1)} mm` : '');
  const maxY = Math.max(...cv.all.flatMap(pr => pr.flatMap(q => primPoints(q, 0.25)).map(p => p[1])));
  check('the curved body never crosses the wall', maxY <= 25 + 1e-3, `max y = ${maxY.toFixed(4)}`);
}
// 5. Пластина со скруглёнными углами: контур упирается на расстоянии r от шарнира
{
  const run = round => {
    const m = emptyMech(); const o = addJoint(m, 0, 0, 'G'), a = addJoint(m, 30, 0), b = addJoint(m, 15, 25); const l = addLink(m, [o.id, a.id, b.id]); setDriver(m, l.id, o.id);
    if (round) l.round = round;
    addWall(m, [[-100, 35], [100, 35]]);
    const s = compile(m); return { r: sweep(s, s.X0, s.theta0, 1, 360), s };
  };
  const plain = run(0), rd = run(8), F = rd.r.frames.at(-1), gap = Math.min(35 - F.X[3], 35 - F.X[5]);
  check('plain plate (joints stay 5.8 mm below the wall) turns a full cycle', plain.r.ok);
  check('rounded plate (8 mm) stops when its outline touches the wall: nearest joint 8 mm away', !rd.r.ok && Math.abs(gap - 8) < 0.02, `gap = ${gap.toFixed(4)} mm`);
}
// 6. Свободное перемещение: маятник упирается в круглый упор и не проходит сквозь него
{
  const m = emptyMech(); const o = addJoint(m, 0, 0, 'G'), a = addJoint(m, 50, 0); addLink(m, [o.id, a.id]);
  const c = [50 * Math.SQRT1_2, 50 * Math.SQRT1_2]; addWall(m, [[c[0] - 8, c[1], 8], [c[0] + 8, c[1], 8]], 1, { closed: true });
  const s = compile(m), g = { kind: 'j', i: s.idx.get(a.id) };
  let minD = Infinity; const X = dragPath(s, s.X0, g, 0, 80, Y => { minD = Math.min(minD, Math.hypot(Y[2] - c[0], Y[3] - c[1])); });
  const d = Math.hypot(X[2] - c[0], X[3] - c[1]), ang = deg(Math.atan2(X[3], X[2]));
  check('free move: pendulum stops at the round post (stays outside the circle)', minD >= 8 - 1e-6 && d < 8.6 && ang < 45, `distance to post centre ${d.toFixed(3)} (R = 8), angle ${ang.toFixed(2)}°`);
  check('free move: length kept', Math.abs(Math.hypot(X[2], X[3]) - 50) < 1e-6);
}
// 7. Кинематика не меняется от формы; пример; файлы
{
  const plain = PRESETS.fourbar(), cur = PRESETS.fourbar();
  const crank = cur.links.find(l => l.id === cur.driver.link); setBend(crank, crank.joints[0], crank.joints[1], 6);
  for (const l of cur.links) if (l.joints.length >= 3) l.round = 5;
  const sa = compile(plain), sb = compile(cur), ra = sweep(sa, sa.X0, sa.theta0, 1, 360), rb = sweep(sb, sb.X0, sb.theta0, 1, 360);
  const diff = Math.max(...ra.frames.map((f, k) => Math.max(...f.X.map((v, q) => Math.abs(v - rb.frames[k].X[q])))));
  check('curvature is shape only: the same motion and DOF as straight links', ra.ok && rb.ok && diff === 0 && dof(cur).W === dof(plain).W);
  const m = PRESETS.curvedstop(), s = compile(m), r1 = sweep(s, s.X0, s.theta0, 2, 360), s2 = compile(m); s2.driver.dir = -1; const r2 = sweep(s2, s2.X0, s2.theta0, 2, 360);
  const wa = m.walls[0], arc = wallPrims(wa)[0];
  check('preset «curved lever»: stops on the arc wall (contact on the arc)', !r1.ok && r1.wall?.wall === wa.id && Math.abs(Math.hypot(r1.wall.x - arc.cx, r1.wall.y - arc.cy) - arc.r) < 1e-6, `θ=${deg(r1.frames.at(-1).theta).toFixed(2)}°`);
  check('preset «curved lever»: backwards stops on the round post', !r2.ok && r2.wall?.wall === m.walls[1].id && Math.abs(Math.hypot(r2.wall.x - 70, r2.wall.y + 50) - 10) < 1e-6, `θ=${deg(r2.frames.at(-1).theta).toFixed(2)}°`);
  const j = JSON.parse(JSON.stringify(m)); j.walls[0].fillet = 4; j.links[0].fillet = 3; j.links[0].round = 2;
  const v = validate(j);
  check('JSON round trip keeps bends, fillets, rounding and closed contours', JSON.stringify(v.walls[1]) === JSON.stringify(m.walls[1]) && v.walls[0].pts[0][2] === -25 && v.walls[0].fillet === 4 && bendOf(v.links[0], v.links[0].joints[0], v.links[0].joints[1]) === 14 && v.links[0].fillet === 3 && v.links[0].round === 2);
  const old = JSON.parse(JSON.stringify(PRESETS.floorstop())), vo = validate(old);
  check('v5 files (no curves) load unchanged', JSON.stringify(vo.walls) === JSON.stringify(old.walls) && vo.links.every(l => !l.bend && !l.fillet && !l.round));
  const rev = { bend: { 'a,b': 5 } };
  check('bend is stored per segment direction (b→a gives the opposite sign)', bendOf(rev, 'b', 'a') === -5 && (setBend(rev, 'b', 'a', 0), !rev.bend));
  const mm = PRESETS.bellcrank(), ls = mm.links.filter(l => !l.gear && !l.rack).slice(0, 2);
  setBend(ls[0], ls[0].joints[0], ls[0].joints[1], 4);
  const shared = ls[0].joints.some(x => ls[1].joints.includes(x)), nl = shared ? mergeLinks(mm, [ls[0].id, ls[1].id]) : null;
  check('merging links keeps segment bends', !shared || (nl && typeof nl === 'object' && bendOf(nl, ls[0].joints[0], ls[0].joints[1]) === 4));
  deleteItems(m, [{ kind: 'joint', id: m.joints[1].id }]);
  check('deleting a joint of a curved link leaves a valid model', m.links.length === 0 && m.walls.length === 2);
}
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
