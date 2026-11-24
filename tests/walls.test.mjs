// Стены / пол: node tests/walls.test.mjs
import { compile, sweep, dragPath } from '../src/solver.js';
import { PRESETS } from '../src/presets.js';
import { emptyMech, addJoint, addLink, setDriver, addWall, dof, validate, deleteItems } from '../src/model.js';
import { wallHit, buildWallGeom, floorFor } from '../src/walls.js';
import { analyze } from '../src/theory.js';
let fails = 0, n = 0;
const check = (name, cond, info = '') => { n++; if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const D = (X, i, j) => Math.hypot(X[2 * i] - X[2 * j], X[2 * i + 1] - X[2 * j + 1]);
const deg = r => r * 180 / Math.PI;

// 1. Четырёхзвенник на полу: стойки на полу допустимы, кривошип упирается в пол
{
  const m = PRESETS.floorstop(), s = compile(m), id = nm => s.idx.get(m.joints.find(j => j.name === nm).id);
  const a = id('A'), o = id('O₁'), b = id('B'), o2 = id('O₂');
  check('ground pivots lying on the floor do not count as contact', !wallHit(s.walls, s.X0, s.X0));
  const r = sweep(s, s.X0, s.theta0, 2, 360);
  const minY = Math.min(...r.frames.flatMap(f => m.joints.map((_, i) => f.X[2 * i + 1])));
  check('driven: stops at contact with the floor (crank at 180°)', !r.ok && r.wall && Math.abs(deg(r.frames.at(-1).theta) - 180) < 0.01, `θ=${deg(r.frames.at(-1).theta).toFixed(4)}°, contact (${r.wall.x.toFixed(2)}, ${r.wall.y.toFixed(2)})`);
  check('driven: no joint ever goes below the floor', minY > -1e-6, `min y = ${minY.toExponential(2)}`);
  check('driven: contact point is the crank tip on the floor', Math.abs(r.wall.x + 25) < 0.01 && Math.abs(r.wall.y) < 1e-9);
  const s2 = compile(m); s2.driver.dir = -1; const r2 = sweep(s2, s2.X0, s2.theta0, 2, 360);
  check('driven backwards: stops at 0° (other side of the floor)', !r2.ok && r2.wall && Math.abs(deg(r2.frames.at(-1).theta)) < 0.01, `θ=${deg(r2.frames.at(-1).theta).toFixed(4)}°`);
  const err = Math.max(...r.frames.map(f => Math.abs(D(f.X, a, o) - D(s.X0, a, o)) + Math.abs(D(f.X, b, o2) - D(s.X0, b, o2))));
  check('driven: constraints kept up to the contact', err < 1e-8);
  check('walls do not change the DOF (Chebyshev) nor Theory counts', dof(m).W === 1 && analyze(m).n === 3 && analyze(m).p5 === 4);
}
// 2. Свободное перемещение: маятник упирается в пол и останавливается
{
  const m = emptyMech(); const o = addJoint(m, 0, 50, 'G'), a = addJoint(m, 60, 50); addLink(m, [o.id, a.id]); addWall(m, [[-100, 0], [100, 0]]);
  const s = compile(m), i = s.idx.get(a.id);
  const X = dragPath(s, s.X0, { kind: 'j', i }, 0, -40);
  check('free move: pendulum stops on the floor, does not pass through', X[2 * i + 1] > -1e-6 && Math.abs(X[2 * i] - Math.sqrt(3600 - 2500)) < 0.5 && Math.abs(D(X, 0, 1) - 60) < 1e-8, `A = (${X[2 * i].toFixed(2)}, ${X[2 * i + 1].toFixed(3)})`);
}
// 3. Свободное перемещение: двухзвенная цепь (W=2) скользит по полу
{
  const m = emptyMech(); const o = addJoint(m, 0, 60, 'G'), a = addJoint(m, 50, 60), b = addJoint(m, 50, 20);
  addLink(m, [o.id, a.id]); addLink(m, [a.id, b.id]); addWall(m, [[-200, 0], [200, 0]]);
  const s = compile(m), i = s.idx.get(b.id), j = s.idx.get(a.id);
  let X = s.X0.slice(), minY = Infinity;
  X = dragPath(s, X, { kind: 'j', i }, 100, -30, Y => { minY = Math.min(minY, Y[2 * i + 1], Y[2 * j + 1]); });
  check('free move: chain slides along the floor towards the target', minY > -1e-6 && X[2 * i] > 60 && X[2 * i + 1] < 2, `B = (${X[2 * i].toFixed(2)}, ${X[2 * i + 1].toFixed(3)}), min y ${minY.toExponential(1)}`);
}
// 4. Ребро звена задевает конец стены (шарниры не пересекают стену — работает проверка рёбер)
{
  const m = emptyMech(); const o = addJoint(m, 0, 0, 'G'), a = addJoint(m, 0, 50); const cr = addLink(m, [o.id, a.id]); setDriver(m, cr.id, o.id); m.driver.dir = -1;
  addWall(m, [[20, -3], [20, 3]]);
  const s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 360);
  const th = deg(r.frames.at(-1).theta), exp = deg(Math.atan2(3, 20));
  check('link body (edge) stops at the wall end point', !r.ok && r.wall && Math.abs(th - exp) < 0.05, `stopped at ${th.toFixed(3)}°, expected ${exp.toFixed(3)}°`);
}
// 5. Г-образное звено: проверяются оба стержня
{
  const m = emptyMech(); const o = addJoint(m, 0, 0, 'G'), a = addJoint(m, 0, 30), c = addJoint(m, 40, 30);
  const l = addLink(m, [o.id, a.id, c.id], [[o.id, a.id], [a.id, c.id]]); setDriver(m, l.id, o.id); m.driver.dir = -1;
  addWall(m, [[45, -100], [45, 100]]);
  const s = compile(m), r = sweep(s, s.X0, s.theta0, 1, 360), ci = s.idx.get(c.id);
  const maxX = Math.max(...r.frames.map(f => f.X[2 * ci]));
  check('L-shaped link stops at a vertical wall', !r.ok && r.wall && maxX <= 45 + 1e-6 && maxX > 44.9, `max x of C = ${maxX.toFixed(4)}`);
}
// 6. Колесо с подвижным центром (сателлит) не заходит в стену
{
  const m = PRESETS.planetary(); addWall(m, [[45, -60], [45, 60]]);
  const s = compile(m);
  const r = sweep(s, s.X0, s.theta0, 2, 360);
  check('planet gear circle hits a wall placed inside its orbit', !r.ok && r.wall, r.wall ? `contact (${r.wall.x.toFixed(1)}, ${r.wall.y.toFixed(1)})` : '');
}
// 7. Файлы: стены сохраняются, старые файлы без стен открываются; удаление
{
  const m = PRESETS.floorstop(), back = validate(JSON.parse(JSON.stringify(m)));
  check('JSON round trip keeps walls', JSON.stringify(back.walls) === JSON.stringify(m.walls));
  const old = PRESETS.fourbar(); delete old.walls; const v = validate(JSON.parse(JSON.stringify(old)));
  check('older JSON without walls loads (walls = [])', Array.isArray(v.walls) && v.walls.length === 0 && !compile(v).walls);
  deleteItems(back, [{ kind: 'wall', id: back.walls[0].id }]);
  check('deleteItems removes a wall', back.walls.length === 0);
  const f = floorFor(PRESETS.fourbar());
  check('«Добавить пол»: horizontal floor below the lowest joint', f[0][1] === f[1][1] && f[0][1] < Math.min(...PRESETS.fourbar().joints.map(j => j.y)) && f[1][0] - f[0][0] > 100, JSON.stringify(f));
}
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
