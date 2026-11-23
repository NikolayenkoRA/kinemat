// Тесты структурного анализа: node tests/theory.test.mjs
import { analyze, grashof, assurDecompose } from '../src/theory.js';
import { PRESETS, PRESET_KEYS } from '../src/presets.js';
import { dof, emptyMech, addJoint, addLink, setDriver } from '../src/model.js';
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
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
