import { camFollowerHome } from './cam.js';
export function emptyMech() { return { version: 2, joints: [], links: [], driver: null, gears: [], cams: [], walls: [], nextId: 1 }; }
export const wallById = (m, id) => (m.walls || []).find(w => w.id === id);
// Стена / пол: ломаная из ≥ 2 точек; side = 1 — штриховка справа от направления обхода, −1 — слева
export function addWall(m, pts, side = 1, opts = {}) { const w = { id: newId(m, 'w'), pts: pts.map(p => (p[2] ? [+p[0], +p[1], +p[2]] : [+p[0], +p[1]])), side, ...opts }; (m.walls ||= []).push(w); return w; }
export const jointById = (m, id) => m.joints.find(j => j.id === id);
export const linkById = (m, id) => m.links.find(l => l.id === id);
export const linksOfJoint = (m, id) => m.links.filter(l => l.joints.includes(id));
export const camById = (m, id) => (m.cams || []).find(c => c.id === id);

export function nextName(m) {
  const used = new Set(m.joints.map(j => j.name));
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let n = 0; ; n++) { const s = n < 26 ? abc[n] : abc[n % 26] + Math.floor(n / 26); if (!used.has(s)) return s; }
}
export function addJoint(m, x, y, type = 'R') {
  const j = { id: 'j' + m.nextId++, name: nextName(m), x, y, type, angle: 0, rail: null, trace: false };
  m.joints.push(j); return j;
}
export function addLink(m, ids, bars = null) {
  const l = { id: 'l' + m.nextId++, joints: [...new Set(ids)] };
  if (bars && bars.length) l.bars = bars.map(b => [...b]);
  m.links.push(l); return l;
}
// Ломаное (Г-образное) звено: стержни между соседними шарнирами в порядке щелчков
export const chainBars = ids => ids.slice(1).map((id, k) => [ids[k], id]);
// Объединение нескольких звеньев с общими шарнирами в одно жёсткое звено.
// Возвращает новое звено или строку-ошибку ('notConnected' | 'special' | 'few').
export function mergeLinks(m, ids) {
  const ls = ids.map(id => linkById(m, id)).filter(Boolean);
  if (ls.length < 2) return 'few';
  if (ls.some(l => l.gear || l.rack || (m.cams || []).some(c => c.cam === l.id))) return 'special';
  // связность через общие шарниры
  const seen = new Set([ls[0].id]), stack = [ls[0]];
  while (stack.length) { const a = stack.pop(); for (const b of ls) if (!seen.has(b.id) && b.joints.some(j => a.joints.includes(j))) { seen.add(b.id); stack.push(b); } }
  if (seen.size !== ls.length) return 'notConnected';
  const joints = [], bars = [], key = new Set();
  const addBar = (a, b) => { const k = a < b ? a + '|' + b : b + '|' + a; if (a !== b && !key.has(k)) { key.add(k); bars.push([a, b]); } };
  for (const l of ls) {
    for (const j of l.joints) if (!joints.includes(j)) joints.push(j);
    if (l.bars) l.bars.forEach(([a, b]) => addBar(a, b));
    else if (l.joints.length === 2) addBar(l.joints[0], l.joints[1]);
    else l.joints.forEach((a, k) => addBar(a, l.joints[(k + 1) % l.joints.length]));
  }
  const gone = new Set(ls.map(l => l.id)), pos = m.links.indexOf(ls[0]);
  const nl = { id: 'l' + m.nextId++, joints, bars };
  const bend = Object.assign({}, ...ls.map(l => l.bend || {})); if (Object.keys(bend).length) nl.bend = bend;
  const fil = Math.max(0, ...ls.map(l => l.fillet || 0)); if (fil > 0) nl.fillet = fil;
  m.links = m.links.filter(l => !gone.has(l.id)); m.links.splice(Math.min(pos, m.links.length), 0, nl);
  for (const j of m.joints) if (j.rail && gone.has(j.rail)) j.rail = nl.id;
  if (m.driver?.kind === 'rot' && gone.has(m.driver.link)) m.driver.link = nl.id;
  cleanup(m);
  return nl;
}
export function newId(m, p) { return p + m.nextId++; }

// Удаление набора объектов разом (одна запись в истории делается снаружи)
export function deleteItems(m, items) {
  const js = new Set(items.filter(i => i.kind === 'joint').map(i => i.id));
  const ls = new Set(items.filter(i => i.kind === 'link').map(i => i.id));
  const cs = new Set(items.filter(i => i.kind === 'cam').map(i => i.id));
  const ws = new Set(items.filter(i => i.kind === 'wall').map(i => i.id));
  m.walls = (m.walls || []).filter(w => !ws.has(w.id));
  m.joints = m.joints.filter(j => !js.has(j.id));
  m.links = m.links.filter(l => !ls.has(l.id));
  m.links.forEach(l => { l.joints = l.joints.filter(x => !js.has(x)); });
  m.cams = (m.cams || []).filter(c => !cs.has(c.id));
  cleanup(m);
}
export const deleteJoint = (m, id) => deleteItems(m, [{ kind: 'joint', id }]);
export const deleteLink = (m, id) => deleteItems(m, [{ kind: 'link', id }]);

export function cleanup(m) {
  m.links = m.links.filter(l => l.joints.length >= 2);
  for (const l of m.links) if (l.bars) { l.bars = l.bars.filter(([a, b]) => a !== b && l.joints.includes(a) && l.joints.includes(b)); if (!l.bars.length) delete l.bars; }
  const lids = new Set(m.links.map(l => l.id)), jids = new Set(m.joints.map(j => j.id));
  for (const l of m.links) if (l.gear && !l.joints.includes(l.gear.center)) l.gear.center = l.joints[0];
  for (const j of m.joints) if (j.rail && !lids.has(j.rail)) j.rail = null;
  const isGear = id => { const l = linkById(m, id); return l && (l.gear || l.rack); };
  m.gears = (m.gears || []).filter(g => isGear(g.a) && isGear(g.b) && g.a !== g.b);
  m.cams = (m.cams || []).filter(c => lids.has(c.cam) && jids.has(c.center) && jids.has(c.follower) && (c.kind !== 'rocker' || jids.has(c.pivot)) && linkById(m, c.cam).joints.includes(c.center));
  fixDriver(m);
}
export function fixDriver(m) {
  const d = m.driver; if (!d) return;
  if (d.kind === 'lin') { const j = jointById(m, d.joint); if (!j || j.type !== 'P') m.driver = null; return; }
  const p = jointById(m, d.pivot), t = jointById(m, d.tip), l = linkById(m, d.link);
  if (!p || !t || !l || p.type !== 'G' || t.type === 'G' || !l.joints.includes(p.id) || !l.joints.includes(t.id)) m.driver = null;
}
export function setDriver(m, linkId, pivotId) {
  const l = linkById(m, linkId); if (!l) return false;
  const tip = l.joints.find(id => id !== pivotId && jointById(m, id)?.type !== 'G');
  if (!tip) return false;
  const o = m.driver;
  m.driver = { kind: 'rot', link: linkId, pivot: pivotId, tip, speed: o?.kind === 'rot' ? o.speed : 60, dir: o?.dir ?? 1, lock: o?.lock ?? 'reverse' };
  return true;
}
export function setLinearDriver(m, jointId) {
  const o = m.driver;
  m.driver = { kind: 'lin', joint: jointId, speed: o?.kind === 'lin' ? o.speed : 20, dir: o?.dir ?? 1, smin: -20, smax: 20, lock: o?.lock ?? 'reverse' };
}

// Звенья, все шарниры которых — стойки, считаем частью стойки
export const isGroundLink = (m, l) => l.joints.every(id => jointById(m, id)?.type === 'G');
// Структурная формула Чебышёва: W = 3n − 2p₅ − p₄
export function dof(m) {
  const moving = m.links.filter(l => !isGroundLink(m, l));
  let n = moving.length, p5 = 0;
  const p4 = (m.gears || []).length + (m.cams || []).length;
  for (const j of m.joints) {
    const k = moving.filter(l => l.joints.includes(j.id)).length;
    if (j.type === 'P') { n += 1; p5 += k + 1; }
    else if (!k) continue;
    else if (j.type === 'G') p5 += k;
    else p5 += k - 1;
  }
  return { n, p5, p4, W: 3 * n - 2 * p5 - p4 };
}

// Кулачок: создание/перестроение толкателя
export function rebuildCam(m, cam) {
  const C = jointById(m, cam.center); if (!C) return;
  let F = jointById(m, cam.follower);
  if (!F) { F = addJoint(m, 0, 0, 'P'); cam.follower = F.id; F.trace = true; }
  if (cam.kind === 'rocker') {
    let O = jointById(m, cam.pivot);
    if (!O) { O = addJoint(m, C.x + (cam.pivotDist || 2.2 * cam.rb), C.y, 'G'); cam.pivot = O.id; }
    if (!m.links.some(l => l.joints.includes(O.id) && l.joints.includes(F.id))) addLink(m, [O.id, F.id]);
    F.type = 'R'; F.rail = null;
    const p = camFollowerHome(cam, C, O); F.x = +p.x.toFixed(6); F.y = +p.y.toFixed(6);
  } else {
    if (cam.pivot) {
      const O = jointById(m, cam.pivot);
      m.links = m.links.filter(l => !(l.joints.length === 2 && l.joints.includes(cam.pivot) && l.joints.includes(F.id)));
      if (O && !linksOfJoint(m, O.id).length) m.joints = m.joints.filter(j => j.id !== O.id);
      cam.pivot = null;
    }
    const p = camFollowerHome(cam, C);
    F.type = 'P'; F.rail = null; F.angle = p.angle; F.x = +p.x.toFixed(6); F.y = +p.y.toFixed(6);
  }
  cam.phase = 0;
}
export function addCam(m, x, y, centerId = null) {
  let C = centerId && jointById(m, centerId);
  if (!C) C = addJoint(m, x, y, 'G');
  const M = addJoint(m, C.x + 12, C.y, 'R');
  const l = addLink(m, [C.id, M.id]);
  const cam = { id: newId(m, 'c'), cam: l.id, center: C.id, kind: 'trans', follower: null, pivot: null, law: 'cycloidal', h: 15, beta: [120, 60, 120, 60], rb: 30, rr: 6, e: 0, arm: 55, pivotDist: 70, phase: 0 };
  (m.cams ||= []).push(cam);
  rebuildCam(m, cam);
  if (!m.driver) setDriver(m, l.id, C.id);
  return cam;
}

export function validate(obj) {
  if (!obj || !Array.isArray(obj.joints) || !Array.isArray(obj.links)) throw new Error('bad file');
  const m = emptyMech();
  m.joints = obj.joints.map(j => ({ id: String(j.id), name: String(j.name ?? j.id), x: +j.x || 0, y: +j.y || 0, type: ['R', 'G', 'P'].includes(j.type) ? j.type : 'R', angle: +j.angle || 0, rail: j.rail ? String(j.rail) : null, trace: !!j.trace }));
  const ids = new Set(m.joints.map(j => j.id));
  m.links = obj.links.map(l => {
    const o = { id: String(l.id), joints: (l.joints || []).map(String).filter(x => ids.has(x)) };
    if (l.gear) o.gear = { center: String(l.gear.center), r: Math.max(0.1, +l.gear.r || 20), z: Math.max(3, Math.round(+l.gear.z || 20)), ring: !!l.gear.ring };
    if (l.rack) o.rack = { z: 0 };
    if (Array.isArray(l.bars)) { const b = l.bars.filter(p => Array.isArray(p) && p.length === 2).map(p => p.map(String)); if (b.length) o.bars = b; }
    // v6: форма — изгиб участков, скругление изломов, скругление углов пластины
    if (l.bend && typeof l.bend === 'object') { const b = {}; for (const [k, v] of Object.entries(l.bend)) if (/^[^,]+,[^,]+$/.test(k) && +v) b[k] = +v; if (Object.keys(b).length) o.bend = b; }
    if (+l.fillet > 0) o.fillet = +l.fillet;
    if (+l.round > 0) o.round = +l.round;
    return o;
  }).filter(l => l.joints.length >= 2);
  const d = obj.driver;
  if (d) m.driver = d.kind === 'lin'
    ? { kind: 'lin', joint: String(d.joint), speed: +d.speed || 20, dir: d.dir < 0 ? -1 : 1, smin: +d.smin || 0, smax: +d.smax || 0, lock: d.lock === 'stop' ? 'stop' : 'reverse' }
    : { kind: 'rot', link: String(d.link), pivot: String(d.pivot), tip: String(d.tip), speed: +d.speed || 60, dir: d.dir < 0 ? -1 : 1, lock: d.lock === 'stop' ? 'stop' : 'reverse' };
  m.gears = (obj.gears || []).map(g => ({ id: String(g.id), a: String(g.a), b: String(g.b) }));
  m.cams = (obj.cams || []).map(c => ({ id: String(c.id), cam: String(c.cam), center: String(c.center), kind: c.kind === 'rocker' ? 'rocker' : 'trans', follower: String(c.follower), pivot: c.pivot ? String(c.pivot) : null,
    law: ['uniform', 'parabolic', 'harmonic', 'cycloidal'].includes(c.law) ? c.law : 'cycloidal', h: +c.h || 10, beta: (c.beta || [120, 60, 120, 60]).map(Number), rb: +c.rb || 30, rr: +c.rr || 0, e: +c.e || 0, arm: +c.arm || 55, pivotDist: +c.pivotDist || 70, phase: +c.phase || 0 }));
  m.walls = (obj.walls || []).filter(w => Array.isArray(w.pts) && w.pts.length >= 2)
    .map(w => { const o = { id: String(w.id), pts: w.pts.map(p => (+p[2] ? [+p[0] || 0, +p[1] || 0, +p[2]] : [+p[0] || 0, +p[1] || 0])), side: w.side < 0 ? -1 : 1 }; if (+w.fillet > 0) o.fillet = +w.fillet; if (w.closed) o.closed = true; return o; });
  const nums = [...m.joints, ...m.links, ...m.gears, ...m.cams, ...m.walls].map(o => parseInt(o.id.slice(1)) || 0);
  m.nextId = Math.max(obj.nextId || 1, ...nums, 0) + 1;
  cleanup(m);
  return m;
}
