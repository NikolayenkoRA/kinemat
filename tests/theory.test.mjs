// Тесты структурного анализа: node tests/theory.test.mjs
import { analyze, grashof, assurDecompose } from '../src/theory.js';
import { PRESETS, PRESET_KEYS } from '../src/presets.js';
import { dof, emptyMech, addJoint, addLink, setDriver, mergeLinks, chainBars, validate } from '../src/model.js';
import { compile, sweep, dragTo } from '../src/solver.js';
let fails = 0, n = 0;
const check = (name, cond, info = '') => { n++; if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const types = a => a.links.map(l => l.type).join(',');

// Классификация звеньев
{
  const a = analyze(PRESETS.fourbar());
  check('four-bar: links = стойка, кривошип, шатун, коромысло', types(a) === 'frame,crank,coupler,rocker', types(a));
  check('four-bar: 4 revolute pairs p5, closed', a.pairs.length === 4 && a.pairs.every(p => p.kind === 'R' && p.cls === 5 && p.closure === 'geom'));
  check('four-bar: pair designations O₁(0–1), A(1–2)…', a.pairs.some(p => p.joint === 'O₁' && p.a === 0 && p.b === 1) && a.pairs.some(p => p.joint === 'A' && p.a === 1 && p.b === 2));
  check('four-bar: Chebyshev W = 3·3 − 2·4 − 0 = 1, rank check agrees', a.n === 3 && a.p5 === 4 && a.p4 === 0 && a.W === 1 && a.Wreal === 1);
  check('four-bar: I class initial + one II-class dyad вида 1 (ВВВ), mechanism class II', a.assur.ok && a.assur.groups.length === 1 && a.assur.groups[0].cls === 2 && a.assur.groups[0].vid === 1 && a.assur.groups[0].order === 2 && a.assur.cls === 2 && a.formula === 'I(0,1) → II(2,3)', a.formula);
  check('four-bar: Grashof crank-rocker, input is a crank', a.fourbar && a.fourbar.kind === 'crank-rocker' && a.fourbar.inputIsCrank && a.fourbar.mu.min > 40, a.fourbar && `μmin=${a.fourbar.mu.min.toFixed(1)}°`);
}
{
  const a = analyze(PRESETS.crankslider());
  check('crank-slider: links = стойка, кривошип, шатун, ползун', types(a) === 'frame,crank,coupler,slider', types(a));
  check('crank-slider: one prismatic pair', a.pairs.filter(p => p.kind === 'P').length === 1);
  check('crank-slider: group вида 2 (ВВП)', a.assur.groups.length === 1 && a.assur.groups[0].vid === 2 && a.assur.cls === 2);
  check('crank-slider: crank exists (r + e ≤ l)', a.crankslider && a.crankslider.crank);
}
for (const k of ['watt', 'stephenson']) {
  const a = analyze(PRESETS[k]());
  check(`${k}: two II-class groups, mechanism class II`, a.assur.ok && a.assur.groups.length === 2 && a.assur.groups.every(g => g.cls === 2 && g.vid === 1) && a.assur.cls === 2, a.formula);
  check(`${k}: n=5, p5=7, W=1`, a.n === 5 && a.p5 === 7 && a.W === 1);
}
{
  const a = analyze(PRESETS.stephenson());
  check('stephenson: types crank, 2 couplers, 2 rockers', types(a) === 'frame,crank,coupler,rocker,coupler,rocker', types(a));
  const j = analyze(PRESETS.jansen());
  check('jansen: three dyads, class II', j.assur.ok && j.assur.groups.length === 3 && j.assur.cls === 2, j.formula);
}
{
  const a = analyze(PRESETS.kulisa());
  check('kulisa: кулисный камень + качающаяся кулиса, dyad вида 3 (ВПВ)', a.links.some(l => l.type === 'stone') && a.links.some(l => l.type === 'kulisaSwing') && a.assur.groups[0].vid === 3, types(a));
  const s = analyze(PRESETS.sliderdriven());
  check('slider-driven: input is the slider, rocker output, dyad вида 1', s.links[1].type === 'slider' && s.links[1].driver && s.links.some(l => l.type === 'rocker') && s.assur.groups[0].vid === 1, types(s));
}
{
  const g = analyze(PRESETS.gears()), p = analyze(PRESETS.planetary()), r = analyze(PRESETS.rack()), c = analyze(PRESETS.camTrans()), cr = analyze(PRESETS.camRocker());
  check('gears: two gears, p4 = 1, substitute mechanism → one dyad', types(g) === 'frame,gear,gear' && g.p4 === 1 && g.assur.ok && g.assur.substitute && g.assur.groups.length === 1, g.formula);
  check('planetary: carrier = кривошип, planet + ring gear, p4 = 2, two groups', p.links.some(l => l.type === 'ringGear') && p.links[1].type === 'crank' && p.p4 === 2 && p.assur.groups.length === 2, p.formula);
  check('rack: рейка moves translationally, gear', r.links.some(l => l.type === 'rack' && l.motion.kind === 'transl') && r.links.some(l => l.type === 'gear') && r.W === 1);
  check('cam (translating): кулачок + толкатель, force-closed higher pair', c.links.some(l => l.type === 'cam') && c.links.some(l => l.type === 'follower') && c.pairs.some(p => p.kind === 'H' && p.closure === 'force') && c.assur.groups[0].vid === 2);
  check('cam (rocker): коромысловый толкатель, dyad вида 1', cr.links.some(l => l.type === 'rockerFollower') && cr.assur.groups[0].vid === 1);
}
// Все примеры: формула Чебышёва совпадает с моделью и рангом
for (const k of PRESET_KEYS) {
  const m = PRESETS[k](), a = analyze(m);
  check(`preset ${k}: W(theory) = W(model) = rank mobility, decomposed`, a.W === dof(m).W && a.Wreal === a.W && a.assur.ok, `${a.formula}`);
}
// Грасгоф
{
  check('Grashof: crank-rocker (80,25,70,60)', grashof(80, 25, 70, 60).kind === 'crank-rocker');
  check('Grashof: double-crank (20,60,50,70)', grashof(20, 60, 50, 70).kind === 'double-crank');
  check('Grashof: double-rocker, shortest coupler (60,50,20,70)', grashof(60, 50, 20, 70).kind === 'double-rocker');
  check('Grashof: non-Grashof triple rocker (40,60,45,50)', grashof(40, 60, 45, 50).kind === 'triple-rocker' && !grashof(40, 60, 45, 50).ok);
  check('Grashof: change point s+l = p+q (40,20,40,20)', grashof(40, 20, 40, 20).change);
  // non-Grashof четырёхзвенник из модели
  const m = emptyMech(); const o1 = addJoint(m, 0, 0, 'G'), o2 = addJoint(m, 40, 0, 'G'), a = addJoint(m, 0, 60), b = addJoint(m, 40, 35);
  const cr = addLink(m, [o1.id, a.id]); addLink(m, [a.id, b.id]); addLink(m, [o2.id, b.id]); setDriver(m, cr.id, o1.id);
  const r = analyze(m);
  check('non-Grashof model: no crank, input link classified as коромысло', r.fourbar.kind === 'triple-rocker' && r.links[1].type === 'rocker', types(r));
}
// Избыточные связи: параллелограмм с лишним шатуном
{
  const m = emptyMech(); const o1 = addJoint(m, 0, 0, 'G'), o2 = addJoint(m, 50, 0, 'G'), o3 = addJoint(m, 100, 0, 'G');
  const a = addJoint(m, 0, 30), b = addJoint(m, 50, 30), c = addJoint(m, 100, 30);
  const cr = addLink(m, [o1.id, a.id]); addLink(m, [o2.id, b.id]); addLink(m, [o3.id, c.id]); addLink(m, [a.id, b.id, c.id]); setDriver(m, cr.id, o1.id);
  const r = analyze(m);
  check('parallelogram with extra crank: W = 0 by formula, rank finds q = 1 redundant constraint', r.W === 0 && r.Wreal === 1, `W=${r.W}, Wreal=${r.Wreal}`);
}
// Группа III класса (трёхповодковая) из графа пар
{
  // тела: 0 стойка, 1 ведущее, 2 базовое (3 пары), 3,4,5 поводки
  const P = (a, b) => ({ kind: 'R', a, b });
  const pairs = [P(0, 1), P(1, 3), P(3, 2), P(0, 4), P(4, 2), P(0, 5), P(5, 2)];
  const d = assurDecompose(6, pairs, [1]);
  check('Assur: triad recognised as one class III group of order 3', d.ok && d.groups.length === 1 && d.groups[0].cls === 3 && d.groups[0].order === 3);
}
// v4: Г-образное звено
{
  const m = PRESETS.bellcrank(), a = analyze(m), bell = a.links.find(l => l.name === 'BO₂C');
  check('bell crank: L-shaped link BO₂C is ONE link (rocker) with 3 joints', bell && bell.type === 'rocker' && bell.joints.length === 3 && a.n === 5 && a.p5 === 7 && a.W === 1 && a.Wreal === 1, a.formula);
  check('bell crank: two II-class dyads', a.assur.ok && a.assur.groups.length === 2 && a.assur.cls === 2);
  const s = compile(m), r = sweep(s, s.X0, s.theta0, 2, 360), id = nm => s.idx.get(m.joints.find(j => j.name === nm).id);
  const [b, o, c] = ['B', 'O₂', 'C'].map(id), d = (X, i, j) => Math.hypot(X[2 * i] - X[2 * j], X[2 * i + 1] - X[2 * j + 1]);
  const ang = X => Math.atan2((X[2 * b] - X[2 * o]) * (X[2 * c + 1] - X[2 * o + 1]) - (X[2 * b + 1] - X[2 * o + 1]) * (X[2 * c] - X[2 * o]), (X[2 * b] - X[2 * o]) * (X[2 * c] - X[2 * o]) + (X[2 * b + 1] - X[2 * o + 1]) * (X[2 * c + 1] - X[2 * o + 1]));
  const a0 = ang(s.X0), l1 = d(s.X0, b, o), l2 = d(s.X0, o, c); let err = 0;
  for (const f of r.frames) err = Math.max(err, Math.abs(d(f.X, b, o) - l1), Math.abs(d(f.X, o, c) - l2), Math.abs(ang(f.X) - a0));
  check('bell crank: full revolution, arms and 90° bend stay rigid', r.ok && err < 1e-8 && Math.abs(Math.abs(a0) - Math.PI / 2) < 1e-6, `err=${err.toExponential(2)}`);
  let X = s.X0.slice(), worst = 0;
  for (let k = 1; k <= 20; k++) { X = dragTo(s, X, { kind: 'j', i: c }, s.X0[2 * c] - k, s.X0[2 * c + 1] + 0.5 * k); worst = Math.max(worst, Math.abs(d(X, b, o) - l1), Math.abs(d(X, o, c) - l2), Math.abs(ang(X) - a0)); }
  check('bell crank: free move of C keeps the L-shape rigid', worst < 1e-8 && Math.hypot(X[2 * c] - s.X0[2 * c], X[2 * c + 1] - s.X0[2 * c + 1]) > 1, `err=${worst.toExponential(2)}`);
  const back = validate(JSON.parse(JSON.stringify(m)));
  check('bell crank: JSON round trip keeps bars', JSON.stringify(back.links.find(l => l.bars)?.bars) === JSON.stringify(m.links.find(l => l.bars).bars));
}
{
  // объединение двух звеньев с общим шарниром → одно жёсткое Г-образное звено
  const m = emptyMech(); const o1 = addJoint(m, 0, 0, 'G'), a = addJoint(m, 0, 20), b = addJoint(m, 60, 20), c = addJoint(m, 60, -20), o2 = addJoint(m, 60, -60, 'G');
  const cr = addLink(m, [o1.id, a.id]), ab = addLink(m, [a.id, b.id]), bc = addLink(m, [b.id, c.id]); addLink(m, [c.id, o2.id]); setDriver(m, cr.id, o1.id);
  const before = analyze(m);
  const r = mergeLinks(m, [ab.id, bc.id]);
  const after = analyze(m);
  check('merge: two links sharing a joint → one link with 3 joints and 2 bars', typeof r === 'object' && r.joints.length === 3 && r.bars.length === 2 && m.links.length === 3);
  check('merge: Chebyshev n −1, p5 −1 (one fewer link and pair), counted as one link', after.n === before.n - 1 && after.p5 === before.p5 - 1 && after.W === before.W - 1 && after.links.filter(l => l.no > 0).length === 3, `W ${before.W} → ${after.W}`);
  check('merge: four-bar with L-shaped coupler is W=1, decomposes', after.W === 1 && after.assur.ok && after.links.some(l => l.joints.length === 3 && l.type === 'coupler'), after.formula);
  const s = compile(m), sw = sweep(s, s.X0, s.theta0, 2, 360);
  const ia = s.idx.get(a.id), ic = s.idx.get(c.id), L0 = Math.hypot(s.X0[2 * ia] - s.X0[2 * ic], s.X0[2 * ia + 1] - s.X0[2 * ic + 1]);
  const e2 = Math.max(...sw.frames.map(f => Math.abs(Math.hypot(f.X[2 * ia] - f.X[2 * ic], f.X[2 * ia + 1] - f.X[2 * ic + 1]) - L0)));
  check('merge: L-shaped coupler mechanism makes a full turn, A–C distance kept (rigid)', sw.ok && sw.frames.length === 181 && e2 < 1e-8, `err=${e2.toExponential(2)}`);
  const m2 = PRESETS.gears(); check('merge: gears refused', mergeLinks(m2, m2.links.map(l => l.id)) === 'special');
  const m3 = emptyMech(); const p = addJoint(m3, 0, 0), q = addJoint(m3, 10, 0), u = addJoint(m3, 50, 0), v = addJoint(m3, 60, 0);
  const l1 = addLink(m3, [p.id, q.id]), l2 = addLink(m3, [u.id, v.id]);
  check('merge: unconnected links refused', mergeLinks(m3, [l1.id, l2.id]) === 'notConnected' && m3.links.length === 2);
  check('chainBars builds a polyline', JSON.stringify(chainBars(['a', 'b', 'c'])) === JSON.stringify([['a', 'b'], ['b', 'c']]));
}
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
