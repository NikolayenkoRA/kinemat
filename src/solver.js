import { camLaw, rockerSign } from './cam.js';
// Численный решатель плоских механизмов.
// Переменные — координаты всех не-стоечных шарниров. Связи:
//  'd' — расстояние между базовой парой шарниров звена,
//  'l' — остальные шарниры звена в локальных координатах базы (жёсткость без сингулярностей),
//  's' — ползун на неподвижной направляющей,
//  driver — угол кривошипа (только в режиме симуляции).
// Позиционная задача: Ньютон с минимальной нормой шага (Jᵀ(JJᵀ+εI)⁻¹r) и тёплым стартом,
// свободное перемещение: взвешенные МНК (связи ≫ цель) + проекция на многообразие связей.

export function compile(mech) {
  const J = mech.joints, N = J.length;
  const idx = new Map(J.map((j, i) => [j.id, i]));
  const X = new Float64Array(2 * N);
  J.forEach((j, i) => { X[2 * i] = j.x; X[2 * i + 1] = j.y; });
  const varOf = new Int32Array(2 * N).fill(-1);
  let nv = 0;
  J.forEach((j, i) => { if (j.type !== 'G') { varOf[2 * i] = nv++; varOf[2 * i + 1] = nv++; } });
  const free = i => varOf[2 * i] >= 0;
  const cons = [], lens = [];
  for (const L of mech.links) {
    const ids = [...new Set(L.joints.map(id => idx.get(id)).filter(i => i !== undefined))];
    if (ids.length < 2) continue;
    let a = ids[0], b = ids[1], best = -1;
    for (let p = 0; p < ids.length; p++) for (let q = p + 1; q < ids.length; q++) {
      const d = Math.hypot(X[2 * ids[p]] - X[2 * ids[q]], X[2 * ids[p] + 1] - X[2 * ids[q] + 1]);
      if (d > best) { best = d; a = ids[p]; b = ids[q]; }
    }
    lens.push(best);
    if (best < 1e-9) continue;
    if (free(a) || free(b)) cons.push({ t: 'd', i: a, j: b, L: best });
    const ex = X[2 * b] - X[2 * a], ey = X[2 * b + 1] - X[2 * a + 1], e2 = ex * ex + ey * ey;
    for (const k of ids) {
      if (k === a || k === b) continue;
      if (!(free(a) || free(b) || free(k))) continue;
      const dx = X[2 * k] - X[2 * a], dy = X[2 * k + 1] - X[2 * a + 1];
      cons.push({ t: 'l', k, a, b, u: (dx * ex + dy * ey) / e2, v: (-dx * ey + dy * ex) / e2 });
    }
  }
  const linkOf = new Map(mech.links.map(l => [l.id, l]));
  // углы тел (непрерывные, с учётом полных оборотов)
  const ang = [];
  const track = (a, b) => { ang.push({ a, b, last: Math.atan2(X[2 * b + 1] - X[2 * a + 1], X[2 * b] - X[2 * a]), acc: 0 }); return ang.length - 1; };
  const linkBody = (l, center) => {
    const ids = l.joints.map(id => idx.get(id)); const c = center != null ? idx.get(center) : ids[0];
    const o = ids.find(i => i !== c); return o === undefined ? -1 : track(c, o);
  };
  // направляющие ползунов
  const rails = new Map();
  J.forEach((j, i) => {
    if (j.type !== 'P') return;
    const an = (j.angle || 0) * Math.PI / 180, dx = Math.cos(an), dy = Math.sin(an);
    const rl = j.rail && linkOf.get(j.rail);
    const rIds = rl && !rl.joints.includes(j.id) ? rl.joints.map(id => idx.get(id)) : null;
    if (rIds && rIds.some(free)) {
      const a = rIds[0], b = rIds.find(q => q !== a && Math.hypot(X[2 * q] - X[2 * a], X[2 * q + 1] - X[2 * a + 1]) > 1e-9);
      if (b !== undefined) {
        const ex = X[2 * b] - X[2 * a], ey = X[2 * b + 1] - X[2 * a + 1], e2 = ex * ex + ey * ey;
        const px = X[2 * i] - X[2 * a], py = X[2 * i + 1] - X[2 * a + 1];
        const R = { kind: 'link', a, b, u0: (px * ex + py * ey) / e2, v0: (-px * ey + py * ex) / e2, du: (dx * ex + dy * ey) / e2, dv: (-dx * ey + dy * ex) / e2 };
        rails.set(i, R);
        cons.push({ t: 'f', js: [i, a, b], fn: Y => { const f = railFrame(R, Y); return [(Y[2 * i] - f.x) * f.dy - (Y[2 * i + 1] - f.y) * f.dx]; } });
        return;
      }
    }
    rails.set(i, { kind: 'ground', x: j.x, y: j.y, dx, dy });
    cons.push({ t: 's', i, ax: j.x, ay: j.y, c: dx, s: dy });
  });
  const sys = { N, ids: J.map(j => j.id), idx, X0: X.slice(), varOf, nv, cons, driver: null, ang, rails, gearBodies: new Map(), camInfo: new Map() };
  // зубчатые зацепления (высшие пары): r1(φ1−ψ) ± r2(φ2−ψ) = 0, ψ — угол линии центров (водило)
  for (const g of mech.gears || []) {
    const A = linkOf.get(g.a), B = linkOf.get(g.b); if (!A || !B) continue;
    if (A.rack && B.rack) continue;
    const [P, K] = A.rack ? [B, A] : [A, B];
    if (!P.gear) continue;
    const pc = idx.get(P.gear.center), pb = linkBody(P, P.gear.center); if (pb < 0) continue;
    sys.gearBodies.set(P.id, pb);
    if (K.rack) {
      const kids = K.joints.map(id => idx.get(id)), R1 = kids[0], R2 = kids[1], kb = track(R1, R2);
      sys.gearBodies.set(K.id, kb);
      const xr = Y => { const ex = Y[2 * R2] - Y[2 * R1], ey = Y[2 * R2 + 1] - Y[2 * R1 + 1], l = Math.hypot(ex, ey) || 1; return [((Y[2 * pc] - Y[2 * R1]) * ex + (Y[2 * pc + 1] - Y[2 * R1 + 1]) * ey) / l, (-(Y[2 * pc] - Y[2 * R1]) * ey + (Y[2 * pc + 1] - Y[2 * R1 + 1]) * ex) / l]; };
      const [x0, n0] = xr(X), sg = n0 >= 0 ? 1 : -1, r = P.gear.r;
      cons.push({ t: 'f', js: uniq([pc, ang[pb].b, R1, R2]), fn: Y => [(xr(Y)[0] - x0) + sg * r * (angCont(sys, Y, pb) - angCont(sys, Y, kb))] });
      continue;
    }
    if (!K.gear) continue;
    const kc = idx.get(K.gear.center), kb = linkBody(K, K.gear.center); if (kb < 0 || kc === pc) continue;
    sys.gearBodies.set(K.id, kb);
    const cb = track(pc, kc), internal = !!(P.gear.ring || K.gear.ring), r1 = P.gear.r, r2 = K.gear.r;
    const k = internal ? -1 : 1;
    cons.push({ t: 'f', js: uniq([pc, ang[pb].b, kc, ang[kb].b]), fn: Y => { const ps = angCont(sys, Y, cb); return [r1 * (angCont(sys, Y, pb) - ps) + k * r2 * (angCont(sys, Y, kb) - ps)]; } });
  }
  // кулачки (высшие пары)
  for (const cm of mech.cams || []) {
    const L = linkOf.get(cm.cam), F = idx.get(cm.follower), C = idx.get(cm.center); if (!L || F === undefined || C === undefined) continue;
    const cb = linkBody(L, cm.center); if (cb < 0) continue;
    const ph = (cm.phase || 0) * Math.PI / 180, L0 = camLaw(cm, ph);
    const info = { cam: cm, body: cb, ph, L0 };
    sys.camInfo.set(cm.id, info);
    if (cm.kind === 'rocker') {
      const O = idx.get(cm.pivot); if (O === undefined) continue;
      const jf = J[F], jo = J[O], jc = J[C], sg = rockerSign(jc, jf, jo), ab = track(O, F), hr = cm.h * Math.PI / 180;
      Object.assign(info, { arm: ab, sg, hr });
      cons.push({ t: 'f', js: uniq([C, ang[cb].b, O, F]), fn: Y => [angCont(sys, Y, ab) - sg * hr * (camLaw(cm, ph + angCont(sys, Y, cb)) - L0)] });
    } else {
      const R = rails.get(F); if (!R || R.kind !== 'ground') continue;
      const fx = X[2 * F], fy = X[2 * F + 1];
      Object.assign(info, { fx, fy, dx: R.dx, dy: R.dy });
      cons.push({ t: 'f', js: uniq([C, ang[cb].b, F]), fn: Y => [(Y[2 * F] - fx) * R.dx + (Y[2 * F + 1] - fy) * R.dy - cm.h * (camLaw(cm, ph + angCont(sys, Y, cb)) - L0)] });
    }
  }
  const d = mech.driver;
  lens.sort((p, q) => p - q);
  sys.scale = lens.length ? Math.max(1e-3, lens[lens.length >> 1]) : 10;
  sys.h = 1e-6 * sys.scale;
  if (d && d.kind === 'lin' && idx.has(d.joint) && rails.has(idx.get(d.joint)) && free(idx.get(d.joint))) {
    const i = idx.get(d.joint), R = rails.get(i);
    sys.driver = { kind: 'lin', i, rail: R, js: uniq(R.kind === 'link' ? [i, R.a, R.b] : [i]), speed: d.speed ?? 20, dir: d.dir ?? 1, hmax: 0.02 * sys.scale };
  } else if (d && d.kind !== 'lin' && idx.has(d.pivot) && idx.has(d.tip) && d.pivot !== d.tip) {
    const p = idx.get(d.pivot), t = idx.get(d.tip);
    if (free(t)) sys.driver = { kind: 'rot', pivot: p, tip: t, speed: d.speed ?? 60, dir: d.dir ?? 1, hmax: 2 * Math.PI / 180 };
  }
  sys.theta0 = sys.driver ? driverAngle(sys, X) : 0;
  return sys;
}
const uniq = a => [...new Set(a)];
const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
export function angCont(sys, X, k) {
  const b = sys.ang[k]; return b.acc + wrap(Math.atan2(X[2 * b.b + 1] - X[2 * b.a + 1], X[2 * b.b] - X[2 * b.a]) - b.last);
}
export function commitAngles(sys, X) {
  for (let k = 0; k < sys.ang.length; k++) { const b = sys.ang[k], raw = Math.atan2(X[2 * b.b + 1] - X[2 * b.a + 1], X[2 * b.b] - X[2 * b.a]); b.acc += wrap(raw - b.last); b.last = raw; }
}
export const saveAngles = sys => sys.ang.map(b => [b.last, b.acc]);
export const loadAngles = (sys, s) => s.forEach((v, k) => { if (sys.ang[k]) { sys.ang[k].last = v[0]; sys.ang[k].acc = v[1]; } });
// направляющая: точка и единичное направление
export function railFrame(R, X) {
  if (R.kind === 'ground') return { x: R.x, y: R.y, dx: R.dx, dy: R.dy };
  const ax = X[2 * R.a], ay = X[2 * R.a + 1], ex = X[2 * R.b] - ax, ey = X[2 * R.b + 1] - ay;
  let dx = R.du * ex - R.dv * ey, dy = R.du * ey + R.dv * ex; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  return { x: ax + R.u0 * ex - R.v0 * ey, y: ay + R.u0 * ey + R.v0 * ex, dx, dy };
}

export function driverAngle(sys, X) {
  const d = sys.driver;
  if (d.kind === 'lin') { const f = railFrame(d.rail, X); return (X[2 * d.i] - f.x) * f.dx + (X[2 * d.i + 1] - f.y) * f.dy; }
  return Math.atan2(X[2 * d.tip + 1] - X[2 * d.pivot + 1], X[2 * d.tip] - X[2 * d.pivot]);
}

// Невязки и якобиан (плотный m×nv)
export function jac(sys, X, theta, useDriver) {
  const { varOf, nv } = sys;
  const r = [], rows = [];
  const R = (val, ...pairs) => { r.push(val); rows.push(pairs); };
  const vx = i => varOf[2 * i], vy = i => varOf[2 * i + 1];
  for (const c of sys.cons) {
    if (c.t === 'd') {
      const dx = X[2 * c.i] - X[2 * c.j], dy = X[2 * c.i + 1] - X[2 * c.j + 1];
      const d = Math.hypot(dx, dy) || 1e-12;
      R(d - c.L, vx(c.i), dx / d, vy(c.i), dy / d, vx(c.j), -dx / d, vy(c.j), -dy / d);
    } else if (c.t === 'l') {
      const { k, a, b, u, v } = c;
      const ex = X[2 * b] - X[2 * a], ey = X[2 * b + 1] - X[2 * a + 1];
      R(X[2 * k] - X[2 * a] - u * ex + v * ey, vx(k), 1, vx(a), u - 1, vx(b), -u, vy(a), -v, vy(b), v);
      R(X[2 * k + 1] - X[2 * a + 1] - u * ey - v * ex, vy(k), 1, vy(a), u - 1, vy(b), -u, vx(a), v, vx(b), -v);
    } else if (c.t === 's') {
      R(-c.s * (X[2 * c.i] - c.ax) + c.c * (X[2 * c.i + 1] - c.ay), vx(c.i), -c.s, vy(c.i), c.c);
    } else numeric(c.js, c.fn);
  }
  function numeric(js, fn) {
    const f0 = fn(X), rr = f0.map(() => []), h = sys.h;
    for (const j of js) for (let q = 2 * j; q < 2 * j + 2; q++) {
      const vi = varOf[q]; if (vi < 0) continue;
      const old = X[q]; X[q] = old + h; const fp = fn(X); X[q] = old - h; const fm = fn(X); X[q] = old;
      for (let k = 0; k < f0.length; k++) rr[k].push(vi, (fp[k] - fm[k]) / (2 * h));
    }
    f0.forEach((v, k) => R(v, ...rr[k]));
  }
  if (useDriver && sys.driver?.kind === 'lin') {
    const d = sys.driver; numeric(d.js, Y => { const f = railFrame(d.rail, Y); return [(Y[2 * d.i] - f.x) * f.dx + (Y[2 * d.i + 1] - f.y) * f.dy - theta]; });
  } else if (useDriver && sys.driver) {
    const { pivot: p, tip: t } = sys.driver, s = Math.sin(theta), co = Math.cos(theta);
    const dx = X[2 * t] - X[2 * p], dy = X[2 * t + 1] - X[2 * p + 1];
    R(-s * dx + co * dy, vx(t), -s, vy(t), co, vx(p), s, vy(p), -co);
  }
  const m = r.length, Jm = new Float64Array(m * nv);
  rows.forEach((pr, i) => { for (let q = 0; q < pr.length; q += 2) if (pr[q] >= 0) Jm[i * nv + pr[q]] += pr[q + 1]; });
  return { r: Float64Array.from(r), J: Jm, m };
}

// Решение SPD-системы (Холецкий) с регуляризацией
function solveSPD(A, n, b) {
  let maxd = 0; for (let i = 0; i < n; i++) maxd = Math.max(maxd, A[i * n + i]);
  const reg = 1e-10 * (maxd || 1) + 1e-14;
  for (let tries = 0; tries < 6; tries++) {
    const L = new Float64Array(n * n), add = reg * Math.pow(100, tries);
    let ok = true;
    for (let j = 0; j < n && ok; j++) {
      let s = A[j * n + j] + add;
      for (let k = 0; k < j; k++) s -= L[j * n + k] * L[j * n + k];
      if (!(s > 0)) { ok = false; break; }
      const ljj = Math.sqrt(s); L[j * n + j] = ljj;
      for (let i = j + 1; i < n; i++) {
        let t = A[i * n + j];
        for (let k = 0; k < j; k++) t -= L[i * n + k] * L[j * n + k];
        L[i * n + j] = t / ljj;
      }
    }
    if (!ok) continue;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= L[i * n + k] * y[k]; y[i] = t / L[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < n; k++) t -= L[k * n + i] * y[k]; y[i] = t / L[i * n + i]; }
    return y;
  }
  return new Float64Array(n);
}

// Минимально-нормальное решение J dx = rhs
function minNorm(J, m, nv, rhs) {
  const A = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = i; j < m; j++) {
    let s = 0; for (let k = 0; k < nv; k++) s += J[i * nv + k] * J[j * nv + k];
    A[i * m + j] = A[j * m + i] = s;
  }
  const y = solveSPD(A, m, rhs);
  const dx = new Float64Array(nv);
  for (let i = 0; i < m; i++) if (y[i]) for (let k = 0; k < nv; k++) dx[k] += J[i * nv + k] * y[i];
  return dx;
}

function applyDx(sys, X, dx, f = 1) {
  const { varOf } = sys;
  for (let q = 0; q < varOf.length; q++) if (varOf[q] >= 0) X[q] += f * dx[varOf[q]];
}
const maxAbs = a => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };

export function residual(sys, X, theta = 0, useDriver = false) { return maxAbs(jac(sys, X, theta, useDriver).r); }

// Ньютон на многообразии связей (X меняется на месте)
export function solveHard(sys, X, theta = 0, useDriver = false, maxIt = 40) {
  const tol = 1e-12 * Math.max(1, sys.scale);
  let nr = Infinity;
  for (let it = 0; it < maxIt; it++) {
    const { r, J, m } = jac(sys, X, theta, useDriver);
    nr = maxAbs(r);
    if (nr < tol || m === 0) return { ok: true, res: nr, it };
    const dx = minNorm(J, m, sys.nv, r);
    const mx = maxAbs(dx), lim = 0.3 * sys.scale;
    applyDx(sys, X, dx, mx > lim ? -lim / mx : -1);
  }
  return { ok: nr < 1e-7 * Math.max(1, sys.scale), res: nr };
}

// dX/dθ (касательная): J·v = −∂r/∂θ
export function tangent(sys, X, theta) {
  const out = new Float64Array(2 * sys.N);
  if (!sys.driver) return out;
  const { r, J, m } = jac(sys, X, theta, true);
  const rhs = new Float64Array(m);
  if (sys.driver.kind === 'lin') rhs[m - 1] = 1;
  else {
    const { pivot: p, tip: t } = sys.driver;
    const dx = X[2 * t] - X[2 * p], dy = X[2 * t + 1] - X[2 * p + 1];
    rhs[m - 1] = -(-Math.cos(theta) * dx - Math.sin(theta) * dy);
  }
  const v = minNorm(J, m, sys.nv, rhs);
  for (let q = 0; q < out.length; q++) if (sys.varOf[q] >= 0) out[q] = v[sys.varOf[q]];
  return out;
}

function tryStep(sys, X, th, h) {
  const v = tangent(sys, X, th);
  let pred = 0; for (let q = 0; q < v.length; q++) pred = Math.max(pred, Math.abs(v[q] * h));
  if (pred > 0.25 * sys.scale) return null;
  const Xn = X.slice();
  for (let q = 0; q < v.length; q++) Xn[q] += v[q] * h;
  const Xp = Xn.slice();
  const res = solveHard(sys, Xn, th + h, true, 25);
  if (!res.ok) return null;
  if (sys.driver.kind === 'rot') {
    const { pivot: p, tip: t } = sys.driver;
    if ((Xn[2 * t] - Xn[2 * p]) * Math.cos(th + h) + (Xn[2 * t + 1] - Xn[2 * p + 1]) * Math.sin(th + h) <= 0) return null;
  }
  let jump = 0; for (let q = 0; q < Xn.length; q++) jump = Math.max(jump, Math.abs(Xn[q] - Xp[q]));
  if (jump > 0.05 * sys.scale + 50 * pred * pred / sys.scale) return null;
  return Xn;
}

// Повернуть кривошип на dth (рад) с адаптивным шагом. ok=false → мёртвое положение/заклинивание.
export function advance(sys, X, theta, dth) {
  let cur = X, th = theta, rem = dth;
  const sg = Math.sign(dth) || 1;
  const hmax = sys.driver.hmax;
  let h = Math.min(Math.abs(dth), hmax);
  while (Math.abs(rem) > 1e-12 * hmax) {
    const step = sg * Math.min(h, Math.abs(rem));
    const Xn = tryStep(sys, cur, th, step);
    if (Xn) { cur = Xn; th += step; rem -= step; commitAngles(sys, cur); h = Math.min(h * 2, hmax); }
    else { h /= 2; if (h < 1e-3 * hmax) return { ok: false, X: cur, theta: th }; }
  }
  return { ok: true, X: cur, theta: th };
}

// Точка захвата: шарнир {kind:'j', i} или точка звена {kind:'l', a, b, u, v}
export function pointOf(X, g) {
  if (g.kind === 'j') return [X[2 * g.i], X[2 * g.i + 1]];
  const ax = X[2 * g.a], ay = X[2 * g.a + 1], ex = X[2 * g.b] - ax, ey = X[2 * g.b + 1] - ay;
  return [ax + g.u * ex - g.v * ey, ay + g.u * ey + g.v * ex];
}
export function localGrab(X, a, b, px, py) {
  const ax = X[2 * a], ay = X[2 * a + 1], ex = X[2 * b] - ax, ey = X[2 * b + 1] - ay, e2 = ex * ex + ey * ey || 1;
  const dx = px - ax, dy = py - ay;
  return { kind: 'l', a, b, u: (dx * ex + dy * ey) / e2, v: (-dx * ey + dy * ex) / e2 };
}
function grabRows(sys, g) {
  const { varOf } = sys;
  if (g.kind === 'j') return [[varOf[2 * g.i], 1], [varOf[2 * g.i + 1], 1]];
  const { a, b, u, v } = g;
  return [
    [varOf[2 * a], 1 - u, varOf[2 * b], u, varOf[2 * a + 1], v, varOf[2 * b + 1], -v],
    [varOf[2 * a + 1], 1 - u, varOf[2 * b + 1], u, varOf[2 * a], -v, varOf[2 * b], v],
  ];
}

// Свободное перемещение: точка захвата тянется к цели (мягкая связь), жёсткие связи сохраняются.
// Возвращает новый X (или старый, если двигаться некуда).
export function dragTo(sys, X0, g, tx, ty, iters = 12, maxStep = 0.1 * sys.scale, budget = Infinity) {
  const nv = sys.nv; let X = X0.slice();
  if (!nv) return X;
  const W2 = 1e4, mu = 1e-4;
  const gr = grabRows(sys, g);
  for (let it = 0; it < iters; it++) {
    const [px, py] = pointOf(X, g);
    const rt = [px - tx, py - ty];
    if (Math.hypot(rt[0], rt[1]) < 1e-7 * sys.scale) break;
    const { r, J, m } = jac(sys, X, 0, false);
    const M = new Float64Array(nv * nv), gvec = new Float64Array(nv);
    for (let i = 0; i < m; i++) for (let a = 0; a < nv; a++) {
      const ja = J[i * nv + a]; if (!ja) continue;
      gvec[a] += W2 * ja * r[i];
      for (let b = 0; b < nv; b++) M[a * nv + b] += W2 * ja * J[i * nv + b];
    }
    const Jt = gr.map(row => { const d = new Float64Array(nv); for (let q = 0; q < row.length; q += 2) if (row[q] >= 0) d[row[q]] += row[q + 1]; return d; });
    for (let k = 0; k < 2; k++) for (let a = 0; a < nv; a++) {
      const ja = Jt[k][a]; if (!ja) continue;
      gvec[a] += ja * rt[k];
      for (let b = 0; b < nv; b++) M[a * nv + b] += ja * Jt[k][b];
    }
    for (let a = 0; a < nv; a++) M[a * nv + a] += mu;
    const dx = solveSPD(M, nv, gvec);
    const mx = maxAbs(dx); if (mx < 1e-10 * sys.scale) break;
    const lim = Math.min(0.1 * sys.scale, maxStep);
    const Xt = X.slice();
    applyDx(sys, Xt, dx, mx > lim ? -lim / mx : -1);
    const res = solveHard(sys, Xt, 0, false, 25);
    let jump = 0; for (let q = 0; q < Xt.length; q++) jump = Math.max(jump, Math.abs(Xt[q] - X[q]));
    // защита от перескока на другую ветвь сборки: шарнир не может уйти намного дальше шага
    if (!res.ok || jump > Math.min(0.4 * sys.scale, 4 * lim + 0.01 * sys.scale)) break;
    if (budget < Infinity) { let tot = 0; for (let q = 0; q < Xt.length; q++) tot = Math.max(tot, Math.abs(Xt[q] - X0[q])); if (tot > budget) break; }
    const [nx, ny] = pointOf(Xt, g);
    if (Math.hypot(nx - tx, ny - ty) > Math.hypot(rt[0], rt[1]) - 1e-9 * sys.scale) break;
    X = Xt; commitAngles(sys, X);
  }
  return X;
}

// Перемещение мышью с подшагами: цель ведётся от текущего положения точки к новой
// небольшими шагами (≤ step), каждый шаг решается с тёплым стартом — механизм движется
// непрерывно и не перескакивает на другую ветвь сборки. onStep(X) — после каждого подшага.
export function dragPath(sys, X0, g, tx, ty, onStep = null, step = 0.02 * sys.scale, tmax = Infinity) {
  let X = X0.slice(); if (!sys.nv) return X;
  const [fx, fy] = pointOf(X, g), D = Math.hypot(tx - fx, ty - fy);
  const n = Math.min(500, Math.max(1, Math.ceil(D / step)));
  const dist = Y => { const [px, py] = pointOf(Y, g); return Math.hypot(px - tx, py - ty); };
  const t0 = Date.now(), late = () => Date.now() - t0 > tmax; // не подвешиваем интерфейс: остаток догонит следующее событие
  for (let k = 1; k <= n && !late(); k++) {
    const t = k / n;
    X = dragTo(sys, X, g, fx + (tx - fx) * t, fy + (ty - fy) * t, 12, step / 2, 1.5 * step);
    if (onStep) onStep(X);
  }
  // точка отстала (упор, особое положение) — догоняем теми же малыми шагами, пока есть прогресс
  for (let k = 0, d = dist(X); k < 300 && d > 1e-7 * sys.scale && !late(); k++) {
    const Xn = dragTo(sys, X, g, tx, ty, 12, step / 2, 1.5 * step), dn = dist(Xn);
    if (dn > d - 1e-6 * sys.scale) break;
    X = Xn; d = dn; if (onStep) onStep(X);
  }
  return X;
}

// Обход: n шагов по h (рад или мм) от q0
export function sweep(sys, X0, theta0, stepDeg = 1, totalDeg = 360, hLin = null) {
  const frames = []; let X = X0.slice(), th = theta0;
  const dir = sys.driver?.dir ?? 1;
  const lin = sys.driver?.kind === 'lin';
  const h = lin ? dir * (hLin ?? 0.5) : dir * stepDeg * Math.PI / 180, n = lin ? Math.round(totalDeg) : Math.round(totalDeg / stepDeg);
  frames.push({ theta: th, X: X.slice(), A: saveAngles(sys) });
  let ok = true;
  for (let k = 0; k < n; k++) {
    const s = advance(sys, X, th, h);
    if (!s.ok) { ok = false; break; }
    X = s.X; th = s.theta; frames.push({ theta: th, X: X.slice(), A: saveAngles(sys) });
  }
  for (const f of frames) f.V = tangent(sys, f.X, f.theta);
  return { ok, frames };
}
