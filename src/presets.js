import { emptyMech, setDriver, setLinearDriver, addCam, rebuildCam, addWall } from './model.js';

const rad = d => d * Math.PI / 180;
// Пересечение окружностей (P,rp) и (Q,rq); pick выбирает одну из двух точек
function circ(P, rp, Q, rq, pick) {
  const dx = Q[0] - P[0], dy = Q[1] - P[1], d = Math.hypot(dx, dy);
  const a = (rp * rp - rq * rq + d * d) / (2 * d), h = Math.sqrt(Math.max(0, rp * rp - a * a));
  const mx = P[0] + a * dx / d, my = P[1] + a * dy / d;
  const s1 = [mx - h * dy / d, my + h * dx / d], s2 = [mx + h * dy / d, my - h * dx / d];
  return pick(s1, s2);
}
const up = (a, b) => (a[1] >= b[1] ? a : b), down = (a, b) => (a[1] < b[1] ? a : b);
const left = (a, b) => (a[0] <= b[0] ? a : b);
const polar = (O, r, deg) => [O[0] + r * Math.cos(rad(deg)), O[1] + r * Math.sin(rad(deg))];
// точка на отрезке AB (доля t) + смещение по нормали h
const offs = (A, B, t, h) => {
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
  return [A[0] + t * dx - h * dy / L, A[1] + t * dy + h * dx / L];
};

function builder() {
  const m = emptyMech();
  const J = (name, P, type = 'R', extra = {}) => {
    const id = 'j' + m.nextId++;
    m.joints.push({ id, name, x: +P[0].toFixed(6), y: +P[1].toFixed(6), type, angle: 0, trace: false, ...extra });
    return id;
  };
  const L = (...ids) => { const id = 'l' + m.nextId++; m.links.push({ id, joints: ids }); return id; };
  return { m, J, L };
}

export const PRESETS = {
  fourbar() {
    const { m, J, L } = builder();
    const O2 = [0, 0], O4 = [80, 0], A = polar(O2, 25, 60), B = circ(A, 70, O4, 60, up), P = offs(A, B, 0.5, 30);
    const o2 = J('O₁', O2, 'G'), o4 = J('O₂', O4, 'G'), a = J('A', A), b = J('B', B), p = J('P', P, 'R', { trace: true });
    const crank = L(o2, a); L(a, b, p); L(o4, b);
    setDriver(m, crank, o2); m.driver.speed = 90;
    return m;
  },
  crankslider() {
    const { m, J, L } = builder();
    const O = [0, 0], A = polar(O, 25, 30), B = [A[0] + Math.sqrt(80 * 80 - A[1] * A[1]), 0], C = offs(A, B, 0.4, 20);
    const o = J('O', O, 'G'), a = J('A', A), b = J('B', B, 'P', { angle: 0, trace: true }), c = J('C', C, 'R', { trace: true });
    const crank = L(o, a); L(a, b, c);
    setDriver(m, crank, o); m.driver.speed = 120;
    return m;
  },
  watt() {
    const { m, J, L } = builder();
    const O2 = [0, 0], O4 = [70, 0], A = polar(O2, 20, 45), B = circ(A, 60, O4, 50, up);
    const C = offs(A, B, 0.5, 25), D = offs(O4, B, 1.4, -10), E = circ(C, 60, D, 45, up);
    const o2 = J('O₁', O2, 'G'), o4 = J('O₂', O4, 'G'), a = J('A', A), b = J('B', B), c = J('C', C), d = J('D', D), e = J('E', E, 'R', { trace: true });
    const crank = L(o2, a); L(a, b, c); L(o4, b, d); L(c, e); L(d, e);
    setDriver(m, crank, o2); m.driver.speed = 90;
    return m;
  },
  stephenson() {
    const { m, J, L } = builder();
    const O2 = [0, 0], O4 = [70, 0], O6 = [100, 60], A = polar(O2, 20, 45), B = circ(A, 60, O4, 50, up);
    const C = offs(A, B, 0.5, 30), D = circ(C, 70, O6, 60, up), F = offs(C, D, 0.5, -15);
    const o2 = J('O₁', O2, 'G'), o4 = J('O₂', O4, 'G'), o6 = J('O₃', O6, 'G');
    const a = J('A', A), b = J('B', B), c = J('C', C), d = J('D', D), f = J('F', F, 'R', { trace: true });
    const crank = L(o2, a); L(a, b, c); L(o4, b); L(c, d, f); L(o6, d);
    setDriver(m, crank, o2); m.driver.speed = 90;
    return m;
  },
  jansen() {
    const { m, J, L } = builder();
    // «Святые числа» Тео Янсена
    const O = [0, 0], Q = [-38, -7.8], M = polar(O, 15, 30);
    const J1 = circ(M, 50, Q, 41.5, up), J2 = circ(M, 61.9, Q, 39.3, down);
    const J3 = circ(Q, 40.1, J1, 55.8, left), J4 = circ(J3, 39.4, J2, 36.7, left), F = circ(J4, 65.7, J2, 49, down);
    const o = J('O', O, 'G'), q = J('Q', Q, 'G'), mm = J('M', M), j1 = J('B', J1), j2 = J('C', J2), j3 = J('D', J3), j4 = J('E', J4), f = J('F', F, 'R', { trace: true });
    const crank = L(o, mm); L(mm, j1); L(mm, j2); L(q, j1, j3); L(q, j2); L(j3, j4); L(j2, j4, f);
    setDriver(m, crank, o); m.driver.speed = 120;
    return m;
  },
};
// --- v2 ---
const gearLink = (m, L, center, other, r, z, extra = {}) => { const id = L(center, other); const l = m.links.find(q => q.id === id); l.gear = { center, r, z, ring: false, ...extra }; return id; };
const mesh = (m, a, b) => { m.gears.push({ id: 'g' + m.nextId++, a, b }); };
Object.assign(PRESETS, {
  // Кулисный механизм: камень A шарнирно на кривошипе, скользит вдоль кулисы O₂B
  kulisa() {
    const { m, J, L } = builder();
    const O1 = [0, 40], O2 = [0, 0], A = polar(O1, 20, 20), ang = Math.atan2(A[1], A[0]), B = polar(O2, 110, ang / Math.PI * 180);
    const o1 = J('O₁', O1, 'G'), o2 = J('O₂', O2, 'G'), b = J('B', B, 'R', { trace: true });
    const rocker = L(o2, b);
    const a = J('A', A, 'P', { angle: ang / Math.PI * 180, rail: rocker });
    const crank = L(o1, a);
    setDriver(m, crank, o1); m.driver.speed = 90;
    return m;
  },
  // Привод от ползуна (гидроцилиндр): линейный ведущий ползун S качает коромысло OB
  sliderdriven() {
    const { m, J, L } = builder();
    const O = [0, 0], B = polar(O, 40, 60), S = [B[0] + Math.sqrt(70 * 70 - (B[1] + 20) ** 2), -20], P = polar(O, 60, 100);
    const o = J('O', O, 'G'), b = J('B', B), s = J('S', S, 'P', { angle: 0 }), p = J('P', P, 'R', { trace: true });
    L(s, b); L(o, b, p);
    setLinearDriver(m, s); Object.assign(m.driver, { speed: 25, smin: -25, smax: 25 });
    return m;
  },
  // Цилиндрическая зубчатая передача внешнего зацепления
  gears() {
    const { m, J, L } = builder();
    const o1 = J('O₁', [0, 0], 'G'), o2 = J('O₂', [60, 0], 'G'), m1 = J('M₁', [12, 0]), m2 = J('M₂', [60, 25]);
    const g1 = gearLink(m, L, o1, m1, 20, 16), g2 = gearLink(m, L, o2, m2, 40, 32);
    mesh(m, g1, g2);
    setDriver(m, g1, o1); m.driver.speed = 60;
    return m;
  },
  // Планетарная передача: солнце неподвижно, ведёт водило, выход — коронная шестерня
  planetary() {
    const { m, J, L } = builder();
    const S = J('S', [0, 0], 'G'), Sm = J('S₁', [10, 0], 'G'), P = J('P', [30, 0]), Pm = J('P₁', [30, 6], 'R', { trace: true }), Rm = J('R', [0, -48]);
    const sun = gearLink(m, L, S, Sm, 20, 20), carrier = L(S, P), planet = gearLink(m, L, P, Pm, 10, 10), ring = gearLink(m, L, S, Rm, 40, 40, { ring: true });
    mesh(m, sun, planet); mesh(m, planet, ring);
    setDriver(m, carrier, S); m.driver.speed = 45;
    return m;
  },
  // Реечная передача: ведущий ползун-рейка вращает шестерню
  rack() {
    const { m, J, L } = builder();
    const O = J('O', [0, 0], 'G'), M = J('M', [0, 12], 'R', { trace: true });
    const R1 = J('R₁', [-50, -20], 'P', { angle: 0 }), R2 = J('R₂', [50, -20], 'P', { angle: 0 });
    const pin = gearLink(m, L, O, M, 20, 16), rk = L(R1, R2); m.links.find(l => l.id === rk).rack = { z: 0 };
    mesh(m, pin, rk);
    setLinearDriver(m, R1); Object.assign(m.driver, { speed: 30, smin: -40, smax: 40 });
    return m;
  },
  // Г-образный (угловой) рычаг: кривошип → шатун → Г-образное коромысло BO₂C → шатун → ползун
  bellcrank() {
    const { m, J, L } = builder();
    const O1 = [0, 0], O2 = [70, 30], A = polar(O1, 15, 60), B = circ(A, 70, O2, 30, down);
    const u = [(B[0] - O2[0]) / 30, (B[1] - O2[1]) / 30], C = [O2[0] - u[1] * 45, O2[1] + u[0] * 45];
    const yD = C[1] - 5, D = [C[0] + Math.sqrt(55 * 55 - 25), yD];
    const o1 = J('O₁', O1, 'G'), o2 = J('O₂', O2, 'G'), a = J('A', A), b = J('B', B), c = J('C', C), d = J('D', D, 'P', { angle: 0, trace: true });
    const crank = L(o1, a); L(a, b);
    const bell = L(b, o2, c); m.links.find(l => l.id === bell).bars = [[b, o2], [o2, c]];
    L(c, d);
    setDriver(m, crank, o1); m.driver.speed = 90;
    return m;
  },
  // Четырёхзвенник на полу: стойки стоят на полу, кривошип упирается в пол и качается туда-обратно
  floorstop() {
    const m = PRESETS.fourbar();
    addWall(m, [[-60, 0], [150, 0]], 1);
    m.driver.lock = 'reverse';
    return m;
  },
  camTrans() {
    const m = emptyMech(); const c = addCam(m, 0, 0);
    Object.assign(c, { law: 'cycloidal', h: 18, beta: [120, 45, 120, 75], rb: 30, rr: 7, e: 8 }); rebuildCam(m, c);
    m.joints.find(j => j.id === c.center).name = 'O'; m.joints.find(j => j.id === c.follower).name = 'F';
    m.driver.speed = 90; return m;
  },
  camRocker() {
    const m = emptyMech(); const c = addCam(m, 0, 0);
    Object.assign(c, { kind: 'rocker', law: 'harmonic', h: 20, beta: [150, 30, 150, 30], rb: 30, rr: 6, arm: 60, pivotDist: 75 }); rebuildCam(m, c);
    m.joints.find(j => j.id === c.center).name = 'O₁'; m.joints.find(j => j.id === c.follower).name = 'F'; m.joints.find(j => j.id === c.pivot).name = 'O₂';
    m.driver.speed = 90; return m;
  },
});
export const PRESET_KEYS = ['fourbar', 'crankslider', 'watt', 'stephenson', 'jansen', 'kulisa', 'sliderdriven', 'gears', 'planetary', 'rack', 'camTrans', 'camRocker', 'bellcrank', 'floorstop'];
