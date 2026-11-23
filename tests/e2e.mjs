// E2E: node tests/e2e.mjs  (собирает? нет — ожидает готовый dist/)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'screenshots');
const PORT = 8766;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(root, 'dist'), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
let fails = 0; const check = (n, c, i = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${i}`); };
const errors = [];
import fs from 'node:fs';
import os from 'node:os';
let browser;
try { browser = await chromium.launch(); }
catch { // запасной вариант: любой уже скачанный headless shell
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const dir = fs.readdirSync(base).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
  browser = await chromium.launch({ executablePath: path.join(base, dir, 'chrome-headless-shell-linux64/chrome-headless-shell') });
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(300);
  check('UI is Russian by default', (await page.textContent('#modes')).includes('Симуляция'));
  check('RU: drag mode named «Свободное перемещение»', (await page.textContent('[data-mode=drag]')).trim() === 'Свободное перемещение' && !(await page.textContent('body')).includes('Перетаскивание'));
  let canvasBox = await page.locator('#cv').boundingBox();
  const scr = async id => { canvasBox = await page.locator('#cv').boundingBox(); return page.evaluate(id => { const a = window.__app; const [x, y] = a.toS(...a.P(id)); return [x, y]; }, id); };
  const jid = name => page.evaluate(n => window.__app.mech.joints.find(j => j.name === n).id, name);

  // --- редактор: создаём звено инструментом, проверяем undo ---
  const n0 = await page.evaluate(() => window.__app.mech.links.length);
  await page.click('[data-tool=link]');
  await page.mouse.click(canvasBox.x + 150, canvasBox.y + 120);
  await page.mouse.click(canvasBox.x + 260, canvasBox.y + 160);
  await page.mouse.click(canvasBox.x + 220, canvasBox.y + 240);
  await page.keyboard.press('Enter');
  const tern = await page.evaluate(() => window.__app.mech.links.at(-1).joints.length);
  check('editor: ternary link created with link tool', (await page.evaluate(() => window.__app.mech.links.length)) === n0 + 1 && tern === 3);
  await page.click('#btnUndo'); await page.click('#btnUndo');
  check('editor: undo removes it', (await page.evaluate(() => window.__app.mech.links.length)) === n0);

  // --- пример Уатта, выбор шарнира, скриншот редактора ---
  await page.selectOption('#preset', 'watt');
  await page.click('[data-tool=select]');
  const [ex, ey] = await scr(await jid('E'));
  await page.mouse.click(canvasBox.x + ex, canvasBox.y + ey);
  check('editor: joint selected via click', (await page.inputValue('#props [data-f=name]')) === 'E');
  check('DOF shown W = 1', (await page.textContent('#mechInfo')).includes('W = 1'));
  await page.screenshot({ path: path.join(shots, '1-editor.png') });

  // --- симуляция ---
  await page.selectOption('#preset', 'fourbar');
  await page.click('[data-mode=sim]');
  await page.click('#btnPlay');
  await page.waitForTimeout(4200);
  const simState = await page.evaluate(() => ({ th: window.__app.sim.theta, tr: [...window.__app.sim.traces.values()].map(a => a.length) }));
  check('sim: crank rotated > 300°', Math.abs(simState.th - await page.evaluate(() => window.__app.sim.sys.theta0)) > 5.2, `θ=${(simState.th * 180 / Math.PI).toFixed(0)}°`);
  check('sim: coupler trace recorded', simState.tr[0] > 50, `points=${simState.tr[0]}`);
  await page.click('#btnPlay'); // пауза
  const [px, py] = await scr(await jid('P'));
    await page.mouse.click(canvasBox.x + px, canvasBox.y + py);
  await page.waitForTimeout(300);
  check('sim: joint P selected for chart', (await page.textContent('#chartTarget')).includes('P'));
  await page.click('#btnPlay'); await page.waitForTimeout(700); await page.click('#btnPlay');
  await page.screenshot({ path: path.join(shots, '2-simulation-traces.png') });
  const lenErr = () => page.evaluate(() => {
    const a = window.__app, s = a.sim.sys, m = a.mech; let e = 0;
    for (const l of m.links) for (let p = 0; p < l.joints.length; p++) for (let q = p + 1; q < l.joints.length; q++) {
      const i = s.idx.get(l.joints[p]), j = s.idx.get(l.joints[q]);
      e = Math.max(e, Math.abs(Math.hypot(a.sim.X[2 * i] - a.sim.X[2 * j], a.sim.X[2 * i + 1] - a.sim.X[2 * j + 1]) - Math.hypot(s.X0[2 * i] - s.X0[2 * j], s.X0[2 * i + 1] - s.X0[2 * j + 1])));
    }
    return e;
  });
  check('sim: link lengths preserved', (await lenErr()) < 1e-6, (await lenErr()).toExponential(2));

  // --- график ---
  await page.selectOption('#chartOut', 'ov');
  await page.waitForTimeout(200);
  const csvOk = await page.evaluate(() => document.querySelector('#chartOut').options.length > 0);
  check('chart: outputs available for selected joint', csvOk);
  const dl = page.waitForEvent('download');
  await page.click('#btnCsv');
  const d = await dl; const csvPath = path.join(root, 'test-output', 'P.csv'); await d.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  check('CSV export: 362 lines (header + 361 samples)', csv.length === 362, `lines=${csv.length}`);
  await page.locator('.chartPanel').screenshot({ path: path.join(shots, '4-chart.png') });

  // --- свободное перемещение (Янсен): тянем шарнир E и точку на звене ---
  await page.selectOption('#preset', 'jansen');
  await page.click('[data-mode=drag]');
  await page.click('#btnClearTr');
  const [fx, fy] = await scr(await jid('F'));
  await page.mouse.move(canvasBox.x + fx, canvasBox.y + fy);
  await page.mouse.down();
  let crankTurned = 0;
  for (let k = 1; k <= 45; k++) {
    const a = k / 60 * 2 * Math.PI; await page.mouse.move(canvasBox.x + fx + 60 * Math.sin(a), canvasBox.y + fy - 40 + 40 * Math.cos(a));
    crankTurned = Math.max(crankTurned, await page.evaluate(() => Math.abs(window.__app.sim.theta - window.__app.sim.sys.theta0)));
  }
  await page.screenshot({ path: path.join(shots, '3-drag-mode.png') });
  await page.mouse.up();
  check('drag: grabbing foot F turns the crank (no driver used)', crankTurned > 0.3, `Δθ=${(crankTurned * 180 / Math.PI).toFixed(0)}°`);
  check('drag: constraints kept', (await lenErr()) < 1e-6, (await lenErr()).toExponential(2));
  // захват середины звена Q–D
  const [qx, qy] = await scr(await jid('Q')), [dx, dy] = await scr(await jid('D'));
  const mx = (qx + dx) / 2, my = (qy + dy) / 2;
  await page.mouse.move(canvasBox.x + mx, canvasBox.y + my); await page.mouse.down();
  for (let k = 1; k <= 15; k++) await page.mouse.move(canvasBox.x + mx - k * 2, canvasBox.y + my + k);
  await page.mouse.up();
  check('drag: point on link, constraints kept', (await lenErr()) < 1e-6, (await lenErr()).toExponential(2));

  // --- v2: рамка выделения + удаление + отмена ---
  await page.selectOption('#preset', 'fourbar');
  await page.click('[data-tool=select]');
  canvasBox = await page.locator('#cv').boundingBox();
  const cnt = () => page.evaluate(() => ({ j: window.__app.mech.joints.length, l: window.__app.mech.links.length, sel: window.__app.selCount() }));
  const before = await cnt();
  const bx = canvasBox.x, by = canvasBox.y, bw = canvasBox.width, bh = canvasBox.height;
  await page.mouse.move(bx + 20, by + 60); await page.mouse.down(); await page.mouse.move(bx + bw / 2, by + bh / 2, { steps: 5 }); await page.mouse.move(bx + bw - 20, by + bh - 70, { steps: 5 });
  await page.screenshot({ path: path.join(shots, '14-box-select.png') });
  await page.mouse.up();
  const selAll = await cnt();
  check('box select L→R (window) selects everything inside', selAll.sel === before.j + before.l, `selected ${selAll.sel} of ${before.j + before.l}`);
  check('selection count shown in badge', (await page.textContent('#dofBadge')).includes(String(selAll.sel)));
  await page.keyboard.press('Delete');
  const afterDel = await cnt();
  check('Delete removes all selected', afterDel.j === 0 && afterDel.l === 0);
  await page.click('#btnUndo');
  const afterUndo = await cnt();
  check('single undo restores everything', afterUndo.j === before.j && afterUndo.l === before.l, JSON.stringify(afterUndo));
  // рамка справа налево (пересечение): маленькая рамка через середину шатуна A–B
  const mid = await page.evaluate(() => { const a = window.__app, m = a.mech, A = m.joints.find(j => j.name === 'A').id, B = m.joints.find(j => j.name === 'B').id; const p = a.toS(...a.P(A)), q = a.toS(...a.P(B)); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
  await page.keyboard.press('Escape');
  await page.mouse.move(bx + mid[0] + 12, by + mid[1] - 12); await page.mouse.down(); await page.mouse.move(bx + mid[0] - 12, by + mid[1] + 12, { steps: 4 }); await page.mouse.up();
  const cross = await page.evaluate(() => [...window.__app.st.selSet.keys()]);
  check('box select R→L (crossing) picks crossed link only', cross.length === 1 && cross[0].startsWith('link:'), cross.join(','));
  // мультивыбор Shift+клик и Ctrl+A / Esc
  const [ax, ay] = await scr(await jid('A')); await page.keyboard.down('Shift'); await page.mouse.click(bx + ax, by + ay); await page.keyboard.up('Shift');
  check('Shift+click adds to selection', (await cnt()).sel === 2);
  await page.keyboard.down('Control'); await page.mouse.click(bx + ax, by + ay); await page.keyboard.up('Control');
  check('Ctrl+click toggles off', (await cnt()).sel === 1);
  await page.keyboard.press('Control+a'); check('Ctrl+A selects all', (await cnt()).sel === before.j + before.l);
  await page.keyboard.press('Escape'); check('Esc clears selection', (await cnt()).sel === 0);
  // групповое перемещение
  await page.keyboard.press('Control+a');
  const p0 = await page.evaluate(() => window.__app.mech.joints.map(j => [j.x, j.y]));
  const [ox1, oy1] = await scr(await jid('O₁'));
  await page.mouse.move(bx + ox1, by + oy1); await page.mouse.down(); await page.mouse.move(bx + ox1 + 40, by + oy1, { steps: 4 }); await page.mouse.up();
  const p1 = await page.evaluate(() => window.__app.mech.joints.map(j => [j.x, j.y]));
  const dxs = p1.map((p, k) => p[0] - p0[k][0]);
  check('group move shifts all joints equally', dxs.every(d => Math.abs(d - dxs[0]) < 1e-9 && Math.abs(d) > 1), `dx=${dxs[0]}`);
  await page.click('#btnUndo'); await page.keyboard.press('Escape');

  // --- v2: новые примеры ---
  const newPresets = [['kulisa', '6-kulisa'], ['sliderdriven', '7-slider-driven'], ['gears', '8-gears'], ['planetary', '9-planetary'], ['rack', '10-rack-pinion'], ['camTrans', '11-cam-translating'], ['camRocker', '12-cam-rocker']];
  for (const [k, shot] of newPresets) {
    await page.click('[data-mode=edit]');
    await page.selectOption('#preset', k);
    await page.click('[data-mode=sim]');
    const q0 = await page.evaluate(() => window.__app.sim.theta);
    await page.click('#btnPlay'); await page.waitForTimeout(1500);
    const res = await page.evaluate(() => ({ q: window.__app.sim.theta, nan: [...window.__app.sim.X].some(v => !Number.isFinite(v)), W: document.querySelector('#mechInfo').textContent.match(/W = (-?\d+)/)?.[1] }));
    check(`preset ${k}: runs in browser (W=${res.W})`, !res.nan && Math.abs(res.q - q0) > 1e-3 && res.W === '1', `Δq=${(res.q - q0).toFixed(3)}`);
    await page.click('#btnPlay');
    await page.screenshot({ path: path.join(shots, shot + '.png') });
  }
  // кулачок: график s и угол давления
  const camId = await page.evaluate(() => window.__app.mech.cams[0].id);
  await page.evaluate(id => window.__app.select('cam', id), camId);
  await page.selectOption('#chartOut', 'cpress'); await page.waitForTimeout(200);
  check('cam chart: pressure-angle output available', (await page.textContent('#chartTarget')).length > 0);
  await page.screenshot({ path: path.join(shots, '13-cam-chart.png') });
  await page.selectOption('#chartOut', 'cs'); await page.waitForTimeout(150);
  await page.locator('.chartPanel').screenshot({ path: path.join(shots, '13b-cam-s-chart.png') });

  // --- английский ---
  await page.selectOption('#lang', 'en');
  check('EN switch works', (await page.textContent('#modes')).includes('Simulate'));
  check("EN: drag mode named 'Free move'", (await page.textContent('[data-mode=drag]')).trim() === 'Free move');
  await page.selectOption('#lang', 'ru');

  // --- touch/узкий экран ---
  const mob = await browser.newPage({ viewport: { width: 400, height: 820 }, hasTouch: true, isMobile: true });
  mob.on('pageerror', e => errors.push(String(e)));
  await mob.goto(`http://127.0.0.1:${PORT}/`); await mob.waitForTimeout(400);
  await mob.screenshot({ path: path.join(shots, '5-mobile.png'), fullPage: true });
} finally {
  await browser.close(); srv.kill();
}
check('no console errors', errors.length === 0, errors.join(' | '));
process.exit(fails ? 1 : 0);
