// Отрисовка зубчатых колёс, рейки и кулачка (Canvas2D, мировые координаты через toS)
export function gearPath(ctx, toS, cx, cy, r, z, rot, ring = false, begin = true) {
  const m = 2 * r / z, p = 2 * Math.PI / z;
  const rt = ring ? r - m : r + m, rr = ring ? r + 1.25 * m : r - 1.25 * m;
  if (begin) ctx.beginPath();
  for (let i = 0; i < z; i++) {
    const a = rot + i * p;
    const pts = [[rr, a - 0.30 * p], [rt, a - 0.16 * p], [rt, a + 0.16 * p], [rr, a + 0.30 * p], [rr, a + 0.70 * p]];
    pts.forEach(([R, A], k) => { const [x, y] = toS(cx + R * Math.cos(A), cy + R * Math.sin(A)); (i === 0 && k === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  }
  ctx.closePath();
}
export function drawGear(ctx, toS, s, g, col, sel) {
  const { cx, cy, r, z, rot, ring } = g, m = 2 * r / z;
  ctx.save();
  if (ring) {
    const ro = r + 1.25 * m + Math.max(3 * m, 4);
    ctx.beginPath(); const [ox, oy] = toS(cx, cy); ctx.moveTo(ox + ro * s, oy); ctx.arc(ox, oy, ro * s, 0, 2 * Math.PI, false); ctx.closePath();
    gearPath(ctx, toS, cx, cy, r, z, rot, true, false);
    ctx.fillStyle = col + '30'; ctx.fill('evenodd');
    ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.5 : 1.4; ctx.stroke();
  } else {
    gearPath(ctx, toS, cx, cy, r, z, rot);
    ctx.fillStyle = col + '30'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.5 : 1.4; ctx.stroke();
    // спицы — видно вращение
    const [ox, oy] = toS(cx, cy); ctx.lineWidth = 1.2; ctx.strokeStyle = col + 'aa';
    for (let k = 0; k < 3; k++) { const a = rot + k * 2 * Math.PI / 3; const [x, y] = toS(cx + 0.7 * r * Math.cos(a), cy + 0.7 * r * Math.sin(a)); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x, y); ctx.stroke(); }
  }
  // делительная окружность
  ctx.setLineDash([4, 4]); ctx.strokeStyle = col + '88'; ctx.lineWidth = 1;
  const [ox, oy] = toS(cx, cy); ctx.beginPath(); ctx.arc(ox, oy, r * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}
// Рейка: начало (x0,y0) — первая точка звена, направление (dx,dy), нормаль к шестерне (nx,ny)
export function drawRack(ctx, toS, rk, col, sel) {
  const { x0, y0, dx, dy, nx, ny, tmin, tmax, m, phase } = rk, p = Math.PI * m;
  const P = (t, h) => toS(x0 + dx * t + nx * h, y0 + dy * t + ny * h);
  ctx.save(); ctx.beginPath();
  const body = -1.25 * m - Math.max(3 * m, 4);
  ctx.moveTo(...P(tmin, body));
  let t = phase + Math.floor((tmin - phase) / p) * p;
  ctx.lineTo(...P(tmin, -1.25 * m));
  for (; t < tmax + p; t += p) {
    const seq = [[t - 0.30 * p, -1.25 * m], [t - 0.16 * p, m], [t + 0.16 * p, m], [t + 0.30 * p, -1.25 * m]];
    for (const [tt, h] of seq) if (tt >= tmin && tt <= tmax) ctx.lineTo(...P(tt, h));
  }
  ctx.lineTo(...P(tmax, -1.25 * m)); ctx.lineTo(...P(tmax, body)); ctx.closePath();
  ctx.fillStyle = col + '30'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.5 : 1.4; ctx.stroke();
  ctx.setLineDash([4, 4]); ctx.strokeStyle = col + '88'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...P(tmin, 0)); ctx.lineTo(...P(tmax, 0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}
export function camWorld(prof, cx, cy, rot, key = 'surf') {
  const c = Math.cos(rot), s = Math.sin(rot);
  return prof[key].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}
export function drawCam(ctx, toS, pts, cx, cy, warn, sel) {
  ctx.save(); ctx.beginPath();
  pts.forEach((p, k) => { const [x, y] = toS(...p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
  ctx.fillStyle = warn ? 'rgba(234,88,12,.18)' : 'rgba(100,116,139,.22)'; ctx.fill();
  ctx.strokeStyle = sel ? '#2563eb' : warn ? '#ea580c' : '#475569'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
  ctx.restore();
}
