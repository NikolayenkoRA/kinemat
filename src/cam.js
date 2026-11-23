// Законы движения толкателя и профиль кулачка
export const LAWS = ['uniform', 'parabolic', 'harmonic', 'cycloidal'];
const TAU = 2 * Math.PI;
// нормированный закон y(x), x∈[0,1] → y∈[0,1]
export function lawY(law, x) {
  x = Math.min(1, Math.max(0, x));
  switch (law) {
    case 'uniform': return x;
    case 'parabolic': return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    case 'harmonic': return (1 - Math.cos(Math.PI * x)) / 2;
    default: return x - Math.sin(TAU * x) / TAU; // cycloidal
  }
}
export function camBetas(cam) {
  let [b1, b2, b3, b4] = (cam.beta || [120, 60, 120, 60]).map(v => Math.max(0, +v || 0));
  b1 = Math.max(1, b1); b3 = Math.max(1, b3);
  const sum = b1 + b2 + b3 + b4;
  if (Math.abs(sum - 360) > 1e-9) { b4 = Math.max(0, 360 - b1 - b2 - b3); if (b1 + b2 + b3 > 360) { const k = 360 / (b1 + b2 + b3); b1 *= k; b2 *= k; b3 *= k; b4 = 0; } }
  return [b1, b2, b3, b4];
}
// нормированное перемещение (0…1) при угле кулачка psi (рад, периодично)
export function camLaw(cam, psi) {
  const [b1, b2, b3] = camBetas(cam);
  let d = (psi / Math.PI * 180) % 360; if (d < 0) d += 360;
  if (d < b1) return lawY(cam.law, d / b1);
  if (d < b1 + b2) return 1;
  if (d < b1 + b2 + b3) return 1 - lawY(cam.law, (d - b1 - b2) / b3);
  return 0;
}
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// Профиль по положению в редакторе. Возвращает центровой профиль, рабочий профиль (в системе кулачка,
// относительно центра), углы давления, s(ψ) и максимальный угол давления.
export function camProfile(mech, cam, N = 720) {
  const J = id => mech.joints.find(j => j.id === id);
  const C = J(cam.center), F = J(cam.follower), O = cam.kind === 'rocker' ? J(cam.pivot) : null;
  if (!C || !F || (cam.kind === 'rocker' && !O)) return null;
  const ph = (cam.phase || 0) * Math.PI / 180, L0 = camLaw(cam, ph);
  const an = (F.angle || 0) * Math.PI / 180, d = [Math.cos(an), Math.sin(an)];
  const sgn = cam.kind === 'rocker' ? rockerSign(C, F, O) : 1;
  const hr = cam.kind === 'rocker' ? cam.h * Math.PI / 180 : cam.h;
  const Fw = psi => {
    const ds = hr * (camLaw(cam, psi) - L0);
    if (cam.kind !== 'rocker') return [F.x + d[0] * ds, F.y + d[1] * ds];
    const [x, y] = rot(F.x - O.x, F.y - O.y, sgn * ds); return [O.x + x, O.y + y];
  };
  const pitch = [], world = [];
  for (let k = 0; k < N; k++) {
    const psi = ph + k / N * 2 * Math.PI, p = Fw(psi); world.push(p);
    pitch.push(rot(p[0] - C.x, p[1] - C.y, -(psi - ph)));
  }
  const surf = [], press = []; let maxP = 0;
  for (let k = 0; k < N; k++) {
    const a = pitch[(k + N - 1) % N], b = pitch[(k + 1) % N], q = pitch[k];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let nx = ty, ny = -tx; if (nx * q[0] + ny * q[1] < 0) { nx = -nx; ny = -ny; }
    surf.push([q[0] - cam.rr * nx, q[1] - cam.rr * ny]);
    const psi = ph + k / N * 2 * Math.PI, [wx, wy] = rot(nx, ny, psi - ph);
    let vx, vy;
    if (cam.kind === 'rocker') { const p = world[k]; vx = -(p[1] - O.y); vy = p[0] - O.x; const l = Math.hypot(vx, vy) || 1; vx /= l; vy /= l; }
    else { vx = d[0]; vy = d[1]; }
    const al = Math.acos(Math.min(1, Math.abs(wx * vx + wy * vy))) * 180 / Math.PI;
    press.push(al); maxP = Math.max(maxP, al);
  }
  return { pitch, surf, press, maxP, N };
}
// знак поворота коромысла, при котором ролик удаляется от центра кулачка
export function rockerSign(C, F, O) {
  const px = -(F.y - O.y), py = F.x - O.x;
  return (F.x - C.x) * px + (F.y - C.y) * py >= 0 ? 1 : -1;
}
// положение ролика в «нулевой» фазе для заданной геометрии
export function camFollowerHome(cam, C, O) {
  const R = cam.rb + cam.rr;
  if (cam.kind !== 'rocker') {
    const e = Math.min(cam.e || 0, R * 0.95), s0 = Math.sqrt(R * R - e * e);
    return { x: C.x + e, y: C.y + s0, angle: 90 };
  }
  // пересечение окружностей (C,R) и (O,L), верхняя точка
  const dx = O.x - C.x, dy = O.y - C.y, dd = Math.hypot(dx, dy), L = cam.arm;
  const a = (R * R - L * L + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, R * R - a * a));
  const mx = C.x + a * dx / dd, my = C.y + a * dy / dd;
  const p1 = [mx - h * dy / dd, my + h * dx / dd], p2 = [mx + h * dy / dd, my - h * dx / dd];
  const p = p1[1] >= p2[1] ? p1 : p2;
  return { x: p[0], y: p[1] };
}
