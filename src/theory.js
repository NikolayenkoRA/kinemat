// Структурный анализ механизма: звенья, кинематические пары, формула Чебышёва,
// разложение на группы Ассура, условие Грасгофа. Чистые функции (без DOM) — тестируются в node.
import { compile, sweep, jac, railFrame } from './solver.js';
import { jointById, isGroundLink, dof } from './model.js';

const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const roman = k => ROMAN[k] || String(k);

// --- Тела и пары -------------------------------------------------------------
function buildBodies(m) {
  const bodies = [{ key: 'G', kind: 'ground' }];
  const byLink = new Map(), byBlock = new Map();
  const ground = l => isGroundLink(m, l);
  for (const l of m.links) if (!ground(l)) { byLink.set(l.id, bodies.length); bodies.push({ key: 'L' + l.id, kind: 'link', link: l }); }
  const linkBody = id => { const l = m.links.find(q => q.id === id); return !l || ground(l) ? 0 : byLink.get(id); };
  const movingOf = jid => m.links.filter(l => !ground(l) && l.joints.includes(jid)).map(l => byLink.get(l.id));
  for (const j of m.joints) if (j.type === 'P') { byBlock.set(j.id, bodies.length); bodies.push({ key: 'B' + j.id, kind: 'block', joint: j }); }
  return { bodies, byLink, byBlock, linkBody, movingOf };
}
// провизорный порядок обхода: от ведущего звена по смежности
function bfsOrder(bodies, pairs, start) {
  const adj = bodies.map(() => []);
  for (const p of pairs) { adj[p.a].push(p.b); adj[p.b].push(p.a); }
  const dist = bodies.map(() => Infinity), q = [];
  if (start > 0) { dist[start] = 0; q.push(start); }
  dist[0] = start > 0 ? 1 : 0; q.push(0);
  while (q.length) { const v = q.shift(); for (const w of adj[v]) if (dist[w] === Infinity) { dist[w] = dist[v] + 1; q.push(w); } }
  return dist;
}
function buildPairs(m, B, order = null) {
  const pairs = [];
  const rank = b => (order ? order[b] : b);
  for (const j of m.joints) {
    let L = B.movingOf(j.id);
    if (j.type === 'P') {
      const blk = B.byBlock.get(j.id);
      for (const l of L) pairs.push({ kind: 'R', a: blk, b: l, joint: j.id });
      const rail = j.rail ? B.linkBody(j.rail) : 0;
      pairs.push({ kind: 'P', a: blk, b: rail ?? 0, joint: j.id });
      continue;
    }
    if (!L.length) continue;
    if (j.type === 'G') { for (const l of L) pairs.push({ kind: 'R', a: 0, b: l, joint: j.id }); continue; }
    L = [...L].sort((x, y) => rank(x) - rank(y));
    for (let i = 1; i < L.length; i++) pairs.push({ kind: 'R', a: L[0], b: L[i], joint: j.id });
  }
  (m.gears || []).forEach((g, k) => pairs.push({ kind: 'H', sub: 'gear', a: B.linkBody(g.a), b: B.linkBody(g.b), gear: g, idx: k + 1 }));
  (m.cams || []).forEach((c, k) => {
    const F = jointById(m, c.follower);
    const fb = c.kind === 'rocker' ? (B.movingOf(F.id)[0] ?? 0) : (B.byBlock.get(F.id) ?? 0);
    pairs.push({ kind: 'H', sub: 'cam', a: B.linkBody(c.cam), b: fb, cam: c, idx: k + 1 });
  });
  return pairs;
}

// --- Движение звеньев за цикл (для классификации) -----------------------------
export function motionSweep(m) {
  let sys; try { sys = compile(m); } catch { return null; }
  if (!sys.driver) return null;
  const frames = [];
  if (sys.driver.kind === 'lin') {
    const d = m.driver, q0 = sys.theta0, h = 0.5;
    for (const [dir, to] of [[1, d.smax], [-1, d.smin]]) {
      const s2 = compile(m); s2.driver.dir = dir;
      const n = Math.max(0, Math.round(Math.abs(to - q0) / h));
      const r = sweep(s2, s2.X0, s2.theta0, 1, n, h);
      (dir > 0 ? r.frames : r.frames.slice(1).reverse()).forEach(f => frames.push(f));
      if (dir > 0) frames.reverse();
    }
    return { sys, frames, ok: true, lin: true };
  }
  const s2 = compile(m); s2.driver.dir = 1;
  const r = sweep(s2, s2.X0, s2.theta0, 2, 360);
  return { sys, frames: r.frames, ok: r.ok, lin: false };
}
function angleRange(frames, i, k) {
  let prev = null, acc = 0, lo = 0, hi = 0;
  for (const f of frames) {
    const a = Math.atan2(f.X[2 * k + 1] - f.X[2 * i + 1], f.X[2 * k] - f.X[2 * i]);
    if (prev !== null) { acc += wrap(a - prev); lo = Math.min(lo, acc); hi = Math.max(hi, acc); }
    prev = a;
  }
  return hi - lo;
}
function posRange(frames, i) {
  let lo = Infinity, hi = -Infinity, x0 = frames[0].X[2 * i], y0 = frames[0].X[2 * i + 1], dir = null;
  for (const f of frames) {
    const dx = f.X[2 * i] - x0, dy = f.X[2 * i + 1] - y0;
    if (!dir && Math.hypot(dx, dy) > 1e-9) dir = [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)];
    const s = dir ? dx * dir[0] + dy * dir[1] : 0; lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  return hi - lo;
}

// --- Классификация звеньев ----------------------------------------------------
function classify(m, B, mot) {
  const rails = new Set(m.joints.filter(j => j.type === 'P' && j.rail).map(j => j.rail));
  const camLinks = new Set((m.cams || []).map(c => c.cam));
  const followers = new Set();
  for (const c of m.cams || []) {
    const F = jointById(m, c.follower);
    if (c.kind === 'rocker') { const b = B.movingOf(F.id)[0]; if (b) followers.add(b); }
    else if (B.byBlock.has(F.id)) followers.add(B.byBlock.get(F.id));
  }
  const idx = mot?.sys.idx;
  B.bodies.forEach((b, bi) => {
    b.motion = null;
    if (b.kind === 'ground') { b.type = 'frame'; return; }
    if (b.kind === 'block') {
      const j = b.joint;
      b.type = followers.has(bi) ? 'follower' : j.rail && B.linkBody(j.rail) ? 'stone' : 'slider';
      if (mot && idx.has(j.id) && !(j.rail && B.linkBody(j.rail))) b.motion = { kind: 'stroke', value: posRange(mot.frames, idx.get(j.id)) };
      else if (j.rail && B.linkBody(j.rail)) b.motion = { kind: 'alongRail', value: null };
      return;
    }
    const l = b.link, js = l.joints.map(id => jointById(m, id));
    const g = js.find(j => j.type === 'G');
    let full = null;
    if (mot) {
      const a = g || js[0], o = js.find(j => j !== a);
      const rng = angleRange(mot.frames, idx.get(a.id), idx.get(o.id));
      full = rng > 2 * Math.PI - 1e-3;
      const deg = rng * 180 / Math.PI;
      if (l.gear && g) b.motion = { kind: 'turn', value: deg };
      else if (g) b.motion = { kind: full ? 'full' : 'swing', value: deg };
      else if (deg < 1e-4) b.motion = { kind: 'transl', value: posRange(mot.frames, idx.get(a.id)) };
      else b.motion = { kind: 'plane', value: deg };
    }
    if (l.gear) b.type = l.gear.ring ? 'ringGear' : 'gear';
    else if (l.rack) b.type = 'rack';
    else if (camLinks.has(l.id)) b.type = 'cam';
    else if (followers.has(bi)) b.type = 'rockerFollower';
    else if (rails.has(l.id)) b.type = g ? (full ? 'kulisaRot' : full === false ? 'kulisaSwing' : 'kulisa') : 'kulisaMoving';
    else if (g) b.type = full === null ? 'pivoted' : full ? 'crank' : 'rocker';
    else b.type = 'coupler';
  });
}

// --- Разложение на группы Ассура --------------------------------------------
function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
}
const VID = { RRR: 1, RRP: 2, PRR: 2, RPR: 3, PRP: 4, RPP: 5, PPR: 5 };
function longestCycle(nodes, edges) {
  const adj = new Map(nodes.map(v => [v, []]));
  for (const [a, b] of edges) { adj.get(a).push(b); adj.get(b).push(a); }
  let best = 0;
  const dfs = (start, v, seen, len) => {
    for (const w of adj.get(v)) {
      if (w === start && len >= 3) best = Math.max(best, len);
      else if (!seen.has(w) && w > start) { seen.add(w); dfs(start, w, seen, len + 1); seen.delete(w); }
    }
  };
  for (const s of nodes) dfs(s, s, new Set([s]), 1);
  return best;
}
export function assurDecompose(nBodies, pairs, drivers) {
  const A = new Set([0, ...drivers]);
  const rest = []; for (let b = 1; b < nBodies; b++) if (!A.has(b)) rest.push(b);
  const groups = [];
  while (rest.length) {
    let found = null;
    for (let size = 2; size <= Math.min(rest.length, 8) && !found; size += 2) {
      for (const S of combos(rest, size)) {
        const inS = new Set(S);
        const ps = pairs.filter(p => (inS.has(p.a) || inS.has(p.b)) && (inS.has(p.a) || A.has(p.a)) && (inS.has(p.b) || A.has(p.b)));
        if (3 * size !== 2 * ps.length) continue;
        if (S.some(b => ps.filter(p => p.a === b || p.b === b).length < 2)) continue;
        if (ps.some(p => p.kind === 'H')) continue;
        found = { bodies: S, pairs: ps }; break;
      }
    }
    if (!found) return { ok: false, groups, rest };
    const inS = new Set(found.bodies);
    const internal = found.pairs.filter(p => inS.has(p.a) && inS.has(p.b)), external = found.pairs.filter(p => !(inS.has(p.a) && inS.has(p.b)));
    const g = { bodies: found.bodies, pairs: found.pairs, order: external.length };
    if (found.bodies.length === 2) {
      const [s1, s2] = found.bodies, e1 = external.find(p => p.a === s1 || p.b === s1), e2 = external.find(p => (p.a === s2 || p.b === s2) && p !== e1);
      const code = (e1?.kind || '?') + (internal[0]?.kind || '?') + (e2?.kind || '?');
      g.cls = 2; g.code = code; g.vid = VID[code] || null;
    } else {
      const c = longestCycle(found.bodies, internal.map(p => [p.a, p.b]));
      g.cls = Math.max(3, c);
    }
    groups.push(g);
    found.bodies.forEach(b => { A.add(b); rest.splice(rest.indexOf(b), 1); });
  }
  return { ok: true, groups, cls: Math.max(1, ...groups.map(g => g.cls)) };
}

// --- Условие Грасгофа ----------------------------------------------------------
// a — стойка, b — кривошип (входное звено), c — шатун, d — коромысло (выходное звено)
export function grashof(ground, input, coupler, output) {
  const L = [ground, input, coupler, output], s = Math.min(...L), l = Math.max(...L);
  const sum = L.reduce((x, y) => x + y, 0), pq = sum - s - l, eps = 1e-9 * l;
  const ok = s + l <= pq + eps, change = Math.abs(s + l - pq) <= eps;
  let kind, crank = [];
  if (!ok) kind = 'triple-rocker';
  else if (s === ground) { kind = 'double-crank'; crank = ['input', 'output']; }
  else if (s === input) { kind = 'crank-rocker'; crank = ['input']; }
  else if (s === output) { kind = 'rocker-crank'; crank = ['output']; }
  else kind = 'double-rocker';
  return { s, l, pq, ok, change, kind, crank, inputIsCrank: crank.includes('input') };
}

// --- Главная функция ---------------------------------------------------------------
export function analyze(m) {
  const B0 = buildBodies(m);
  const drv = m.driver?.kind === 'lin' ? B0.byBlock.get(m.driver.joint) : m.driver ? B0.linkBody(m.driver.link) : null;
  const provisional = buildPairs(m, B0);
  const dist = bfsOrder(B0.bodies, provisional, drv || 0);
  const pairs0 = buildPairs(m, B0, dist);
  const n = B0.bodies.length - 1;
  const p5 = pairs0.filter(p => p.kind !== 'H').length, p4 = pairs0.filter(p => p.kind === 'H').length;
  const W = 3 * n - 2 * p5 - p4;

  // заменяющий механизм: высшая пара → условное звено с двумя низшими парами
  const sbodies = B0.bodies.length, spairs = pairs0.filter(p => p.kind !== 'H').map(p => ({ ...p }));
  const subs = [];
  for (const p of pairs0.filter(q => q.kind === 'H')) {
    const s = sbodies + subs.length; subs.push({ of: p });
    const rackSide = p.sub === 'gear' ? [p.a, p.b].find(b => B0.bodies[b].link?.rack) : undefined;
    const knife = p.sub === 'cam' && !(p.cam.rr > 0);
    const other = rackSide !== undefined ? (rackSide === p.a ? p.b : p.a) : p.a;
    const far = rackSide !== undefined ? rackSide : p.b;
    spairs.push({ kind: 'R', a: other, b: s, sub: true, subOf: p });
    spairs.push({ kind: rackSide !== undefined || knife ? 'P' : 'R', a: s, b: far, sub: true, subOf: p });
  }
  let assur;
  const drivers = drv ? [drv] : [];
  if (!m.driver || !drv) assur = { ok: false, reason: 'noDriver' };
  else if (W !== 1) assur = { ok: false, reason: 'W' };
  else {
    assur = assurDecompose(sbodies + subs.length, spairs, drivers);
    if (!assur.ok) assur.reason = 'fail';
    assur.substitute = subs.length > 0;
  }

  // окончательная нумерация: 1 — ведущее, затем по группам; условные звенья — в конце
  const num = new Array(sbodies + subs.length).fill(-1); num[0] = 0; let k = 1;
  if (drv) num[drv] = k++;
  if (assur.groups) for (const g of assur.groups) for (const b of [...g.bodies].sort((x, y) => dist[x] - dist[y])) if (b < sbodies && num[b] < 0) num[b] = k++;
  [...Array(sbodies).keys()].sort((x, y) => dist[x] - dist[y]).forEach(b => { if (num[b] < 0) num[b] = k++; });
  for (let s = sbodies; s < sbodies + subs.length; s++) num[s] = k++;

  const mot = motionSweep(m);
  classify(m, B0, mot);

  const names = id => jointById(m, id)?.name ?? id;
  const links = B0.bodies.map((b, bi) => {
    const o = { no: num[bi], body: bi, type: b.type, motion: b.motion, joints: [], lengths: [] };
    if (b.kind === 'ground') {
      o.joints = m.joints.filter(j => j.type === 'G').map(j => j.name);
      const G = m.joints.filter(j => j.type === 'G');
      for (let a = 0; a < G.length && o.lengths.length < 6; a++) for (let c = a + 1; c < G.length && o.lengths.length < 6; c++) {
        const d = hyp(G[a], G[c]); if (d > 1e-9) o.lengths.push({ label: G[a].name + G[c].name, value: d });
      }
      o.name = o.joints.join(', ');
    } else if (b.kind === 'block') {
      o.joints = [b.joint.name]; o.name = b.joint.name;
    } else {
      const js = b.link.joints.map(id => jointById(m, id));
      o.joints = js.map(j => j.name); o.name = o.joints.join('');
      for (let a = 0; a < js.length; a++) for (let c = a + 1; c < js.length; c++) o.lengths.push({ label: js[a].name + js[c].name, value: hyp(js[a], js[c]) });
      if (b.link.gear) o.gear = { r: b.link.gear.r, z: b.link.gear.z, m: 2 * b.link.gear.r / b.link.gear.z, ring: !!b.link.gear.ring };
      const cam = (m.cams || []).find(c => c.cam === b.link.id); if (cam) o.cam = { rb: cam.rb, h: cam.h, rr: cam.rr, e: cam.e, law: cam.law, kind: cam.kind };
    }
    o.driver = bi === drv;
    return o;
  }).sort((x, y) => x.no - y.no);

  const pairName = p => p.kind === 'H' ? null : names(p.joint);
  const pairs = pairs0.map(p => {
    const [i, j] = [num[p.a], num[p.b]].sort((x, y) => x - y);
    return { kind: p.kind, cls: p.kind === 'H' ? 4 : 5, a: i, b: j, joint: pairName(p), sub: p.sub || null, idx: p.idx || null,
      closure: p.kind === 'H' && p.sub === 'cam' ? 'force' : 'geom' };
  }).sort((x, y) => x.a - y.a || x.b - y.b);

  // реальная подвижность по рангу якобиана (точечная модель) — избыточные связи / местные подвижности
  let Wreal = null;
  try {
    const sys = compile(m);
    if (sys.nv) {
      const { J, m: rows } = jac(sys, sys.X0, 0, false);
      Wreal = sys.nv - rankOf(J, rows, sys.nv);
    } else Wreal = 0;
  } catch { Wreal = null; }

  const groups = (assur.groups || []).map(g => ({
    bodies: g.bodies.map(b => num[b]).sort((x, y) => x - y), cls: g.cls, order: g.order, vid: g.vid || null, code: g.code || null,
    pairs: g.pairs.map(p => ({ kind: p.kind, a: num[p.a], b: num[p.b], joint: p.sub ? null : names(p.joint) })),
    hasSub: g.bodies.some(b => b >= sbodies),
  }));
  const res = {
    n, p5, p4, W, Wreal, check: dof(m), links, pairs,
    movingNums: links.filter(l => l.no > 0).map(l => l.no),
    assur: { ok: !!assur.ok, reason: assur.reason || null, substitute: !!assur.substitute, groups, cls: assur.ok ? assur.cls : null,
      initial: drv ? [0, num[drv]] : null, subs: subs.map((s, q) => ({ no: num[sbodies + q], kind: s.of.sub, a: num[s.of.a], b: num[s.of.b] })) },
    motionOk: mot ? mot.ok : null, lin: mot?.lin ?? null,
  };
  res.formula = res.assur.ok ? [`I(0,${num[drv]})`, ...groups.map(g => `${roman(g.cls)}(${g.bodies.join(',')})`)].join(' → ') : null;
  res.fourbar = fourbarCheck(m, B0, pairs0, mot, num);
  res.crankslider = crankSliderCheck(m, B0, pairs0, num);
  return res;
}

function rankOf(J, rows, cols) {
  const A = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => J[i * cols + j]));
  let mx = 0; for (const r of A) for (const v of r) mx = Math.max(mx, Math.abs(v));
  const tol = 1e-8 * (mx || 1); let rank = 0;
  for (let c = 0; c < cols && rank < rows; c++) {
    let piv = rank; for (let r = rank + 1; r < rows; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) <= tol) continue;
    [A[rank], A[piv]] = [A[piv], A[rank]];
    for (let r = rank + 1; r < rows; r++) { const f = A[r][c] / A[rank][c]; if (f) for (let q = c; q < cols; q++) A[r][q] -= f * A[rank][q]; }
    rank++;
  }
  return rank;
}

// Шарнирный четырёхзвенник: стойка + 3 подвижных звена, 4 вращательные пары
function fourbarCheck(m, B, pairs, mot, num) {
  const mv = B.bodies.slice(1);
  if (mv.length !== 3 || mv.some(b => b.kind !== 'link') || pairs.length !== 4 || pairs.some(p => p.kind !== 'R')) return null;
  const gp = pairs.filter(p => p.a === 0);
  if (gp.length !== 2) return null;
  const drvB = m.driver?.kind === 'rot' ? B.linkBody(m.driver.link) : null;
  let [pi, po] = gp; if (drvB && po.b === drvB) [pi, po] = [po, pi];
  const inB = pi.b, outB = po.b, cB = [1, 2, 3].find(b => b !== inB && b !== outB);
  const pc1 = pairs.find(p => (p.a === inB && p.b === cB) || (p.b === inB && p.a === cB)), pc2 = pairs.find(p => (p.a === outB && p.b === cB) || (p.b === outB && p.a === cB));
  if (!pc1 || !pc2) return null;
  const J = id => jointById(m, id), O1 = J(pi.joint), O2 = J(po.joint), A = J(pc1.joint), Bj = J(pc2.joint);
  const r = { ground: hyp(O1, O2), input: hyp(O1, A), coupler: hyp(A, Bj), output: hyp(O2, Bj) };
  const g = grashof(r.ground, r.input, r.coupler, r.output);
  let mu = null;
  if (mot && mot.frames.length > 1) {
    const ix = mot.sys.idx, a = ix.get(A.id), b = ix.get(Bj.id), o = ix.get(O2.id);
    let lo = 180, hi = 0;
    for (const f of mot.frames) {
      const ux = f.X[2 * a] - f.X[2 * b], uy = f.X[2 * a + 1] - f.X[2 * b + 1], vx = f.X[2 * o] - f.X[2 * b], vy = f.X[2 * o + 1] - f.X[2 * b + 1];
      let ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))) * 180 / Math.PI;
      if (ang > 90) ang = 180 - ang; lo = Math.min(lo, ang); hi = Math.max(hi, ang);
    }
    mu = { min: lo, max: hi };
  }
  return { ...g, lengths: r, names: { O1: O1.name, O2: O2.name, A: A.name, B: Bj.name }, nums: { input: num[inB], coupler: num[cB], output: num[outB] }, mu };
}
// Кривошипно-ползунный: кривошип существует при r + |e| ≤ l
function crankSliderCheck(m, B, pairs, num) {
  const mv = B.bodies.slice(1);
  if (m.driver?.kind !== 'rot' || mv.length !== 3 || mv.filter(b => b.kind === 'link').length !== 2 || mv.filter(b => b.kind === 'block').length !== 1) return null;
  const blk = mv.find(b => b.kind === 'block'), S = blk.joint; if (S.rail) return null;
  const gp = pairs.filter(p => p.a === 0 && p.kind === 'R'); if (gp.length !== 1) return null;
  const O = jointById(m, gp[0].joint), crankB = gp[0].b, cB = [1, 2, 3].find(b => B.bodies[b].kind === 'link' && b !== crankB);
  const pc = pairs.find(p => p.kind === 'R' && ((p.a === crankB && p.b === cB) || (p.b === crankB && p.a === cB))); if (!pc) return null;
  if (B.linkBody(m.driver.link) !== crankB) return null;
  const A = jointById(m, pc.joint), rad = S.angle * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
  const r = hyp(O, A), l = hyp(A, S), e = Math.abs((O.x - S.x) * dy - (O.y - S.y) * dx);
  return { r, l, e, crank: r + e <= l + 1e-9 * l, names: { O: O.name, A: A.name, B: S.name }, nums: { crank: num[crankB], coupler: num[cB] } };
}
