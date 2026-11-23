// Простой график на Canvas2D
export function drawChart(cv, xs, ys, { xLabel = '', yLabel = '', marker = null, color = '#2563eb', limit = null } = {}) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.body), fg = css.getPropertyValue('--fg') || '#222', mute = css.getPropertyValue('--muted') || '#888';
  g.font = '11px system-ui, sans-serif';
  if (!xs || xs.length < 2) return;
  const L = 56, R = 12, T = 12, B = 30;
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (limit != null) { y0 = Math.min(y0, 0); y1 = Math.max(y1, limit * 1.1); }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const X = x => L + (x - x0) / (x1 - x0 || 1) * (W - L - R), Y = y => T + (y1 - y) / (y1 - y0) * (H - T - B);
  const nice = (span, n) => { const r = span / n, p = Math.pow(10, Math.floor(Math.log10(r))); return [1, 2, 5, 10].map(k => k * p).find(s => s >= r); };
  g.strokeStyle = 'rgba(128,128,128,.25)'; g.fillStyle = mute; g.lineWidth = 1;
  const sx = nice(x1 - x0, 8); for (let v = Math.ceil(x0 / sx) * sx; v <= x1; v += sx) { g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), H - B); g.stroke(); g.textAlign = 'center'; g.fillText(+v.toFixed(6), X(v), H - B + 13); }
  const sy = nice(y1 - y0, 5); for (let v = Math.ceil(y0 / sy) * sy; v <= y1; v += sy) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.textAlign = 'right'; g.fillText(+v.toPrecision(4), L - 4, Y(v) + 4); }
  g.fillStyle = fg; g.textAlign = 'center'; g.fillText(xLabel, (L + W - R) / 2, H - 4);
  g.save(); g.translate(12, (T + H - B) / 2); g.rotate(-Math.PI / 2); g.fillText(yLabel, 0, 0); g.restore();
  g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
  xs.forEach((x, i) => (i ? g.lineTo(X(x), Y(ys[i])) : g.moveTo(X(x), Y(ys[i])))); g.stroke();
  if (limit != null) { g.strokeStyle = '#ea580c'; g.setLineDash([6, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(L, Y(limit)); g.lineTo(W - R, Y(limit)); g.stroke(); g.setLineDash([]); g.fillStyle = '#ea580c'; g.textAlign = 'left'; g.fillText(limit + '°', L + 4, Y(limit) - 4); }
  if (marker != null && marker >= x0 && marker <= x1) {
    g.strokeStyle = '#ef4444'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(marker), T); g.lineTo(X(marker), H - B); g.stroke();
  }
}
