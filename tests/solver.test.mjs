// Автотесты решателя: node tests/solver.test.mjs
import { compile, sweep, dragTo, dragPath, pointOf, localGrab, residual, advance, railFrame } from '../src/solver.js';
import { lawY, camLaw, LAWS } from '../src/cam.js';
import { validate } from '../src/model.js';
import { PRESETS, PRESET_KEYS } from '../src/presets.js';
import { dof, emptyMech, addJoint, addLink, setDriver } from '../src/model.js';

let fails = 0, n = 0;
const check = (name, cond, info = '') => { n++; if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const dist = (X, i, j) => Math.hypot(X[2 * i] - X[2 * j], X[2 * i + 1] - X[2 * j + 1]);
const pairs = (m, s) => m.links.flatMap(l => { const ids = l.joints.map(id => s.idx.get(id)); const out = []; for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) out.push([ids[a], ids[b]]); return out; });
const maxLenErr = (m, s, X) => Math.max(...pairs(m, s).map(([i, j]) => Math.abs(dist(X, i, j) - dist(s.X0, i, j))));

// 1. Четырёхзвенник: длины сохраняются на полном обороте
{
  const m = PRESETS.fourbar(), s = compile(m);
  const r = sweep(s, s.X0, s.theta0, 1, 360);
  const err = Math.max(...r.frames.map(f => maxLenErr(m, s, f.X)));
  check('four-bar: full revolution completes', r.ok && r.frames.length === 361);
  check('four-bar: all link lengths (incl. ternary coupler) preserved < 1e-6', err < 1e-6, `max err = ${err.toExponential(2)}`);
  const last = r.frames.at(-1).X; let back = 0; for (let q = 0; q < last.length; q++) back = Math.max(back, Math.abs(last[q] - s.X0[q]));
  check('four-bar: returns to start pose after 360°', back < 1e-6, `Δ = ${back.toExponential(2)}`);
}
// 2. Кривошипно-ползунный: аналитика x_B = r cosθ + sqrt(L² − r² sin²θ)
{
  const m = PRESETS.crankslider(), s = compile(m);
  const r = sweep(s, s.X0, s.theta0, 1, 360);
  const bi = s.idx.get(m.joints.find(j => j.name === 'B').id), ai = s.idx.get(m.joints.find(j => j.name === 'A').id), oi = s.idx.get(m.joints.find(j => j.name === 'O').id);
  const R = dist(s.X0, oi, ai), L = dist(s.X0, ai, bi);
  let err = 0, verr = 0;
  for (const f of r.frames) {
    const th = f.theta, xa = R * Math.cos(th) + Math.sqrt(L * L - (R * Math.sin(th)) ** 2);
    err = Math.max(err, Math.abs(f.X[2 * bi] - xa), Math.abs(f.X[2 * bi + 1]));
    const dxa = -R * Math.sin(th) - (R * R * Math.sin(th) * Math.cos(th)) / Math.sqrt(L * L - (R * Math.sin(th)) ** 2);
    verr = Math.max(verr, Math.abs(f.V[2 * bi] - dxa));
  }
  check('crank-slider: slider position = analytic formula', r.ok && err < 1e-6, `max err = ${err.toExponential(2)}`);
  check('crank-slider: slider velocity dx/dθ = analytic', verr < 1e-6, `max err = ${verr.toExponential(2)}`);
}
// 3. Все примеры: полный оборот, W = 1
for (const k of PRESET_KEYS) {
  const m = PRESETS[k](), s = compile(m), r = s.driver.kind === 'lin' ? sweep(s, s.X0, s.theta0, 1, 40, 0.5) : sweep(s, s.X0, s.theta0, 2, 360);
  const err = Math.max(...r.frames.map(f => maxLenErr(m, s, f.X)));
  check(`preset ${k}: W=${dof(m).W}, full cycle, lengths kept`, dof(m).W === 1 && r.ok && err < 1e-6, `err=${err.toExponential(2)}`);
}
// 4. Свободное перемещение сохраняет связи
function dragTest(key, jointName, path) {
  const m = PRESETS[key](), s = compile(m);
  const i = s.idx.get(m.joints.find(j => j.name === jointName).id);
  let X = s.X0.slice(), worst = 0, moved = 0;
  for (const [tx, ty] of path) {
    const Xn = dragTo(s, X, { kind: 'j', i }, tx, ty);
    moved += Math.hypot(Xn[2 * i] - X[2 * i], Xn[2 * i + 1] - X[2 * i + 1]);
    X = Xn; worst = Math.max(worst, maxLenErr(m, s, X), residual(s, X));
  }
  return { X, worst, moved, s, i };
}
{
  // тянем шарнир B (не ведущий!) по окружности — четырёхзвенник должен провернуться
  const m = PRESETS.fourbar(), s0 = compile(m), bi = s0.idx.get(m.joints.find(j => j.name === 'B').id), o4 = s0.idx.get(m.joints.find(j => j.name === 'O₂').id);
  const path = []; const R = dist(s0.X0, bi, o4), a0 = Math.atan2(s0.X0[2 * bi + 1], s0.X0[2 * bi] - 80);
  for (let k = 1; k <= 40; k++) path.push([80 + R * Math.cos(a0 + k * 0.02), R * Math.sin(a0 + k * 0.02)]);
  const r = dragTest('fourbar', 'B', path);
  check('drag four-bar joint B: constraints kept', r.worst < 1e-8, `max err = ${r.worst.toExponential(2)}, moved ${r.moved.toFixed(1)} mm`);
  check('drag four-bar joint B: follows reachable target', Math.hypot(r.X[2 * bi] - path.at(-1)[0], r.X[2 * bi + 1] - path.at(-1)[1]) < 1e-3);
  // недостижимая цель: остаётся на границе, связи целы
  const far = dragTest('fourbar', 'P', [[500, 500], [-300, 200], [0, -400]]);
  check('drag to unreachable target: constraints kept', far.worst < 1e-8, `max err = ${far.worst.toExponential(2)}`);
}
{
  // захват произвольной точки звена (Янсен, точка на шатуне)
  const m = PRESETS.jansen(), s = compile(m);
  const a = s.idx.get(m.joints.find(j => j.name === 'Q').id), b = s.idx.get(m.joints.find(j => j.name === 'D').id);
  const [px, py] = [(s.X0[2 * a] + s.X0[2 * b]) / 2, (s.X0[2 * a + 1] + s.X0[2 * b + 1]) / 2];
  const g = localGrab(s.X0, a, b, px, py);
  let X = s.X0.slice(), worst = 0;
  for (let k = 1; k <= 30; k++) { X = dragTo(s, X, g, px - k * 0.5, py + k * 0.3); worst = Math.max(worst, maxLenErr(m, s, X)); }
  const [qx, qy] = pointOf(X, g);
  check('drag point on a link (Jansen): constraints kept & moved', worst < 1e-8 && Math.hypot(qx - px, qy - py) > 1, `err=${worst.toExponential(2)}, moved ${Math.hypot(qx - px, qy - py).toFixed(1)} mm`);
  // слайдер
  const c = PRESETS.crankslider(), sc = compile(c), ci = sc.idx.get(c.joints.find(j => j.name === 'B').id);
  let Xc = sc.X0.slice(); Xc = dragTo(sc, Xc, { kind: 'j', i: ci }, sc.X0[2 * ci] - 20, 15);
  check('drag slider: stays on rail, moves along it', Math.abs(Xc[2 * ci + 1]) < 1e-9 && Math.abs(Xc[2 * ci] - (sc.X0[2 * ci] - 20)) < 1e-3 && maxLenErr(c, sc, Xc) < 1e-8);
}
{
  // свободное звено (W=3) и диада (W=2) тоже таскаются
  const m = emptyMech(); const a = addJoint(m, 0, 0), b = addJoint(m, 40, 0); addLink(m, [a.id, b.id]);
  const s = compile(m); const X = dragTo(s, s.X0, { kind: 'j', i: 1 }, 10, 30);
  check('free link (W=3): drags, length kept', Math.abs(dist(X, 0, 1) - 40) < 1e-8 && Math.hypot(X[2] - 10, X[3] - 30) < 1e-3);
  check('dof free link = 3', dof(m).W === 3);
}
// 4b. Быстрое перемещение точки шатуна большими скачками: без хорд и без смены ветви сборки
{
  const m = PRESETS.fourbar(), s = compile(m), id = n => s.idx.get(m.joints.find(j => j.name === n).id);
  const pi = id('P'), ai = id('A'), bi = id('B'), o2 = id('O₂');
  const branch = X => Math.sign((X[2 * ai] - X[2 * bi]) * (X[2 * o2 + 1] - X[2 * bi + 1]) - (X[2 * ai + 1] - X[2 * bi + 1]) * (X[2 * o2] - X[2 * bi]));
  const ref = sweep(s, s.X0, s.theta0, 1, 360), curve = ref.frames.map(f => [f.X[2 * pi], f.X[2 * pi + 1]]);
  const b0 = branch(s.X0), thr = 0.08 * s.scale;
  let X = s.X0.slice(), prev = [X[2 * pi], X[2 * pi + 1]], maxSeg = 0, flips = 0, worst = 0;
  const targets = []; for (let k = 40; k <= 720; k += 40) targets.push(curve[k % 360]);
  targets.push([prev[0] + 60, prev[1] - 50], [prev[0] - 70, prev[1] + 40]); // и пара рывков мимо кривой
  for (const [tx, ty] of targets) X = dragPath(s, X, { kind: 'j', i: pi }, tx, ty, Xs => {
    const p = [Xs[2 * pi], Xs[2 * pi + 1]]; maxSeg = Math.max(maxSeg, Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p;
    if (branch(Xs) !== b0) flips++; worst = Math.max(worst, maxLenErr(m, s, Xs));
  });
  const gotEnd = Math.hypot(X[2 * pi] - curve[0][0], X[2 * pi + 1] - curve[0][1]);
  check('fast drag of coupler point: no trace segment longer than threshold', maxSeg <= thr, `max segment ${maxSeg.toFixed(2)} mm ≤ ${thr.toFixed(2)} mm`);
  check('fast drag of coupler point: same assembly branch, constraints kept', flips === 0 && worst < 1e-8, `flips=${flips}, err=${worst.toExponential(2)}`);
  let Y = s.X0.slice(); for (const tg of targets.slice(0, 18)) Y = dragPath(s, Y, { kind: 'j', i: pi }, ...tg);
  const e = Math.hypot(Y[2 * pi] - curve[0][0], Y[2 * pi + 1] - curve[0][1]);
  check('fast drag along coupler curve: two full loops reach the target', e < 1e-3, `Δ=${e.toExponential(2)} mm`);
}
// 5. Мёртвое положение: коромысло-коромысло, ведомое от коромысла, должно заклинить
{
  const m = emptyMech(); const o1 = addJoint(m, 0, 0, 'G'), o2 = addJoint(m, 40, 0, 'G'), a = addJoint(m, 0, 60), b = addJoint(m, 40, 30);
  const cr = addLink(m, [o1.id, a.id]); addLink(m, [a.id, b.id]); addLink(m, [o2.id, b.id]);
  setDriver(m, cr.id, o1.id);
  const s = compile(m); const r = sweep(s, s.X0, s.theta0, 1, 360);
  check('non-Grashof double rocker: lock-up detected', !r.ok && r.frames.length < 360, `stopped after ${r.frames.length - 1}°`);
  const last = r.frames.at(-1); check('lock-up: pose still valid', maxLenErr(m, s, last.X) < 1e-8);
}
// ===== v2 =====
const ang = (X, i, j) => Math.atan2(X[2 * j + 1] - X[2 * i + 1], X[2 * j] - X[2 * i]);
const unwrapSeries = a => { const o = [a[0]]; for (let k = 1; k < a.length; k++) { let d = a[k] - a[k - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); o.push(o[k - 1] + d); } return o; };
const J = (m, s, name) => s.idx.get(m.joints.find(j => j.name === name).id);
const series = (fr, i, j) => unwrapSeries(fr.map(f => ang(f.X, i, j))).map((v, k, a) => v - a[0]);
// 6. Зубчатая пара внешнего зацепления: Δφ₂ = −(r₁/r₂)Δφ₁
{
  const m = PRESETS.gears(), s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 720);
  const p1 = series(r.frames, J(m, s, 'O₁'), J(m, s, 'M₁')), p2 = series(r.frames, J(m, s, 'O₂'), J(m, s, 'M₂'));
  const err = Math.max(...p1.map((v, k) => Math.abs(p2[k] + v * 20 / 40)));
  check('gear pair (external): ratio −r1/r2 over 2 turns < 1e-9', r.ok && err < 1e-9, `err=${err.toExponential(2)}, Δφ1=${(p1.at(-1) * 180 / Math.PI).toFixed(0)}°`);
  check('gear pair: DOF counts p4 (W=1)', dof(m).p4 === 1 && dof(m).W === 1);
}
{ // внутреннее зацепление: Δφ_кольца = (r₁/r₂)Δφ₁
  const m = emptyMech(); const O = addJoint(m, 0, 0, 'G'), Rm = addJoint(m, 0, -30), P = addJoint(m, 15, 0, 'G'), Pm = addJoint(m, 15, 5);
  const ring = addLink(m, [O.id, Rm.id]); ring.gear = { center: O.id, r: 25, z: 50, ring: true };
  const pin = addLink(m, [P.id, Pm.id]); pin.gear = { center: P.id, r: 10, z: 20, ring: false };
  m.gears.push({ id: 'g99', a: pin.id, b: ring.id }); setDriver(m, pin.id, P.id);
  const s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 360);
  const p1 = series(r.frames, 2, 3), p2 = series(r.frames, 0, 1);
  const err = Math.max(...p1.map((v, k) => Math.abs(p2[k] - v * 10 / 25)));
  check('gear pair (internal): ratio +r1/r2 < 1e-9', r.ok && err < 1e-9, `err=${err.toExponential(2)}`);
}
// 7. Планетарная передача — формула Виллиса
{
  const m = PRESETS.planetary(), s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 720);
  const S = J(m, s, 'S'), Pp = J(m, s, 'P'), R = J(m, s, 'R'), Pm = J(m, s, 'P₁');
  const c = series(r.frames, S, Pp), ring = series(r.frames, S, R), pl = series(r.frames, Pp, Pm);
  // (ω_R − ω_H)/(ω_S − ω_H) = −z_S/z_R, ω_S = 0  ⇒ φ_R = φ_H(1 + z_S/z_R)
  const err = Math.max(...c.map((v, k) => Math.abs(ring[k] - v * (1 + 20 / 40))));
  const errP = Math.max(...c.map((v, k) => Math.abs(pl[k] - v * (1 + 20 / 10))));
  check('planetary: Willis formula (ring) < 1e-9', r.ok && err < 1e-9, `err=${err.toExponential(2)}`);
  check('planetary: planet φ_P = φ_H(1 + z_S/z_P) < 1e-9', errP < 1e-9, `err=${errP.toExponential(2)}`);
  check('planetary: W = 1 (p4 = 2)', dof(m).W === 1 && dof(m).p4 === 2);
  // скорость через якобиан: ω_R/ω_H = 1.5
  const f = r.frames[100], wR = (() => { const dx = f.X[2 * R] - f.X[2 * S], dy = f.X[2 * R + 1] - f.X[2 * S + 1]; return (dx * f.V[2 * R + 1] - dy * f.V[2 * R]) / (dx * dx + dy * dy); })();
  check('planetary: ω_R/ω_H from Jacobian = 1.5', Math.abs(wR - 1.5) < 1e-6, `ω_R/ω_H=${wR.toFixed(9)}`);
}
// 8. Реечная передача с линейным приводом: Δφ = Δx/r
{
  const m = PRESETS.rack(), s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 80, 0.5);
  const R1 = J(m, s, 'R₁'), O = J(m, s, 'O'), M = J(m, s, 'M');
  const ph = series(r.frames, O, M);
  const err = Math.max(...r.frames.map((f, k) => Math.abs(ph[k] - (f.X[2 * R1] - s.X0[2 * R1]) / 20)));
  const errq = Math.max(...r.frames.map(f => Math.abs(f.X[2 * R1] - s.X0[2 * R1] - (f.theta - s.theta0))));
  check('rack & pinion: Δφ = Δx/r < 1e-9', r.ok && err < 1e-9, `err=${err.toExponential(2)}`);
  check('linear driver: slider displacement = input q', errq < 1e-9, `err=${errq.toExponential(2)}`);
}
// 9. Законы кулачка
{
  let e = 0;
  for (const law of LAWS) { e = Math.max(e, Math.abs(lawY(law, 0)), Math.abs(lawY(law, 1) - 1)); for (let k = 0; k <= 100; k++) { const x = k / 100; e = Math.max(e, Math.abs(lawY(law, x) + lawY(law, 1 - x) - 1)); } }
  const ex = { uniform: 0.3, parabolic: 0.18, harmonic: (1 - Math.cos(0.3 * Math.PI)) / 2, cycloidal: 0.3 - Math.sin(0.6 * Math.PI) / (2 * Math.PI) };
  ex.parabolic = 2 * 0.09;
  for (const law of LAWS) e = Math.max(e, Math.abs(lawY(law, 0.3) - ex[law]));
  check('cam laws: endpoints, symmetry, closed-form values < 1e-12', e < 1e-12, `err=${e.toExponential(2)}`);
  for (const key of ['camTrans', 'camRocker']) {
    const m = PRESETS[key](), s = compile(m), cam = m.cams[0], r = sweep(s, s.X0, s.theta0, 1, 720);
    const C = s.idx.get(cam.center), Mk = s.idx.get(m.links.find(l => l.id === cam.cam).joints.find(id => id !== cam.center)), F = s.idx.get(cam.follower);
    const phi = series(r.frames, C, Mk); let err = 0;
    if (cam.kind === 'trans') {
      const an = m.joints.find(j => j.id === cam.follower).angle * Math.PI / 180;
      r.frames.forEach((f, k) => { const sv = (f.X[2 * F] - s.X0[2 * F]) * Math.cos(an) + (f.X[2 * F + 1] - s.X0[2 * F + 1]) * Math.sin(an); err = Math.max(err, Math.abs(sv - cam.h * camLaw(cam, phi[k]))); });
    } else {
      const O = s.idx.get(cam.pivot), arm = series(r.frames, O, F);
      r.frames.forEach((f, k) => { err = Math.max(err, Math.abs(Math.abs(arm[k]) - cam.h * Math.PI / 180 * camLaw(cam, phi[k]))); });
    }
    check(`cam ${key}: follower follows law (${cam.law}) over 2 turns < 1e-9`, r.ok && err < 1e-9, `err=${err.toExponential(2)}`);
  }
}
// 10. Кулиса (ползун на подвижном звене): замкнутость контура
{
  const m = PRESETS.kulisa(), s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 360);
  const O1 = J(m, s, 'O₁'), O2 = J(m, s, 'O₂'), A = J(m, s, 'A'), B = J(m, s, 'B');
  let e1 = 0, e2 = 0, e3 = 0;
  const X0 = s.X0, rc = Math.hypot(X0[2 * A] - X0[2 * O1], X0[2 * A + 1] - X0[2 * O1 + 1]), lb = Math.hypot(X0[2 * B] - X0[2 * O2], X0[2 * B + 1] - X0[2 * O2 + 1]);
  const off = f => { const ax = f[2 * A] - f[2 * O2], ay = f[2 * A + 1] - f[2 * O2 + 1], bx = f[2 * B] - f[2 * O2], by = f[2 * B + 1] - f[2 * O2 + 1]; return (ax * by - ay * bx) / Math.hypot(bx, by); };
  const off0 = off(X0);
  for (const f of r.frames) {
    const ax = f.X[2 * A] - f.X[2 * O2], ay = f.X[2 * A + 1] - f.X[2 * O2 + 1], bx = f.X[2 * B] - f.X[2 * O2], by = f.X[2 * B + 1] - f.X[2 * O2 + 1];
    { const R = railFrame(s.rails.get(A), f.X); e1 = Math.max(e1, Math.abs((f.X[2 * A] - R.x) * R.dy - (f.X[2 * A + 1] - R.y) * R.dx)); }
    e1 = Math.max(e1, Math.abs(off(f.X) - off0) > 1e-6 ? 1 : 0); // и неподвижно относительно кулисы                        // A на линии кулисы
    e2 = Math.max(e2, Math.hypot(f.X[2 * A] - (f.X[2 * O1] + rc * Math.cos(f.theta)), f.X[2 * A + 1] - (f.X[2 * O1 + 1] + rc * Math.sin(f.theta)))); // замыкание O₂→O₁→A
    e3 = Math.max(e3, Math.abs(Math.hypot(bx, by) - lb));
  }
  check('inverted slider (кулиса): loop closure A on rail < 1e-9', r.ok && e1 < 1e-9 && e2 < 1e-9 && e3 < 1e-9, `rail=${e1.toExponential(2)} loop=${e2.toExponential(2)} len=${e3.toExponential(2)}`);
  check('kulisa: W = 1', dof(m).W === 1);
}
// 11. Линейный привод: аналитика коромысла
{
  const m = PRESETS.sliderdriven(), s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 50, 0.5); // весь ход 0…+25 мм
  const O = J(m, s, 'O'), B = J(m, s, 'B'), S = J(m, s, 'S'); let err = 0;
  const r1 = Math.hypot(s.X0[2 * B], s.X0[2 * B + 1]), r2 = Math.hypot(s.X0[2 * B] - s.X0[2 * S], s.X0[2 * B + 1] - s.X0[2 * S + 1]);
  for (const f of r.frames) {
    const sx = s.X0[2 * S] + (f.theta - s.theta0), sy = s.X0[2 * S + 1];
    const d = Math.hypot(sx, sy), a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(r1 * r1 - a * a);
    const mx = a * sx / d, my = a * sy / d, c1 = [mx - h * sy / d, my + h * sx / d], c2 = [mx + h * sy / d, my - h * sx / d];
    const pb = [f.X[2 * B], f.X[2 * B + 1]], cb = Math.hypot(c1[0] - pb[0], c1[1] - pb[1]) < Math.hypot(c2[0] - pb[0], c2[1] - pb[1]) ? c1 : c2;
    err = Math.max(err, Math.abs(f.X[2 * S] - sx), Math.hypot(f.X[2 * B] - cb[0], f.X[2 * B + 1] - cb[1]));
  }
  check('linear driver: slider-driven rocker = analytic < 1e-9', r.ok && err < 1e-9, `err=${err.toExponential(2)}`);
}
// 12. Совместимость с JSON v1
{
  const v1 = { version: 1, joints: [{ id: 'j1', name: 'O', x: 0, y: 0, type: 'G', angle: 0, trace: false }, { id: 'j2', name: 'A', x: 20, y: 0, type: 'R' }, { id: 'j3', name: 'B', x: 80, y: 0, type: 'P', angle: 0 }],
    links: [{ id: 'l4', joints: ['j1', 'j2'] }, { id: 'l5', joints: ['j2', 'j3'] }], driver: { link: 'l4', pivot: 'j1', tip: 'j2', speed: 60, dir: 1 }, nextId: 6 };
  const m = validate(v1), s = compile(m), r = sweep(s, s.X0, s.theta0, 2, 360);
  check('v1 JSON loads (driver→rot, gears/cams empty) and runs', m.driver.kind === 'rot' && m.gears.length === 0 && m.cams.length === 0 && r.ok && dof(m).W === 1);
}
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
