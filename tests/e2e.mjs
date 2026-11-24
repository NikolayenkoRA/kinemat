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
catch { // запасные варианты: скачанный headless shell или системный Chrome/Chromium
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const cands = [process.env.CHROME_PATH];
  if (fs.existsSync(base)) for (const d of fs.readdirSync(base).sort().reverse()) cands.push(path.join(base, d, 'chrome-headless-shell-linux64/chrome-headless-shell'), path.join(base, d, 'chrome-linux/chrome'));
  cands.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  const exe = cands.find(c => c && fs.existsSync(c));
  if (!exe) throw new Error('No Chromium found: run `npx playwright install chromium` or set CHROME_PATH');
  browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
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
  const newPresets = [['bellcrank', '24-bellcrank-sim'], ['kulisa', '6-kulisa'], ['sliderdriven', '7-slider-driven'], ['gears', '8-gears'], ['planetary', '9-planetary'], ['rack', '10-rack-pinion'], ['camTrans', '11-cam-translating'], ['camRocker', '12-cam-rocker']];
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

  // --- свободное перемещение: быстрые рывки точки шатуна не дают хорд ---
  await page.selectOption('#preset', 'fourbar'); await page.waitForTimeout(200);
  await page.click('[data-mode=drag]'); await page.waitForTimeout(100);
  {
    const pId = await jid('P'), [px, py] = await scr(pId);
    await page.mouse.move(canvasBox.x + px, canvasBox.y + py); await page.mouse.down();
    const jumps = [[-120, 40], [-40, 160], [120, 140], [160, -20], [0, -60], [-150, 60]];
    for (const [dx, dy] of jumps) { await page.mouse.move(canvasBox.x + px + dx, canvasBox.y + py + dy, { steps: 1 }); await page.waitForTimeout(30); }
    await page.mouse.up();
    const tr = await page.evaluate(id => { const a = window.__app, pts = a.sim.traces.get(id) || []; let mx = 0, br = 0; for (let k = 1; k < pts.length; k++) { if (!pts[k] || !pts[k - 1]) { br++; continue; } mx = Math.max(mx, Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])); } return { n: pts.length, mx, br, scale: a.sim.sys.scale }; }, pId);
    check('free move: fast pointer jumps leave no chord in the coupler trace', tr.n > 20 && tr.mx <= 0.08 * tr.scale, `points=${tr.n}, max segment ${tr.mx.toFixed(2)} mm, breaks=${tr.br}`);
    await page.screenshot({ path: path.join(shots, '15-free-move-fast-drag.png') });
  }
  await page.click('[data-mode=edit]');

  // --- v4: неподвижный шарнир, Г-образное звено, объединение, Esc → «Выбор» ---
  page.on('dialog', d => d.accept());
  await page.click('#btnNew'); await page.waitForTimeout(200);
  canvasBox = await page.locator('#cv').boundingBox();
  const at = (x, y) => page.mouse.click(canvasBox.x + x, canvasBox.y + y);
  const app = (f, arg) => page.evaluate(f, arg);
  // Esc отменяет начатое звено и включает «Выбор»
  await page.click('[data-tool=link]'); await at(300, 200); await page.waitForTimeout(50);
  await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  const esc1 = await app(() => ({ tool: window.__app.st.tool, draft: window.__app.st.draft.length, links: window.__app.mech.links.length }));
  check('Esc cancels the link in progress and switches to «Выбор»', esc1.tool === 'select' && esc1.draft === 0 && esc1.links === 0 && await page.$eval('[data-tool=select]', b => b.classList.contains('on')), JSON.stringify(esc1));
  await page.click('[data-tool=cam]'); await page.keyboard.press('Escape');
  check('Esc from any tool returns to «Выбор»', (await app(() => window.__app.st.tool)) === 'select');
  // инструмент «Неподвижный шарнир — стойка»
  check('fixed-pivot tool has a clear tooltip', (await page.getAttribute('[data-tool=ground]', 'title')).includes('Неподвижный шарнир'));
  await page.click('[data-tool=ground]'); await at(320, 300); await page.waitForTimeout(60);
  const g1 = await app(() => window.__app.mech.joints.map(j => j.type));
  await page.click('[data-tool=joint]'); await at(520, 300); await page.waitForTimeout(60);
  await page.click('[data-tool=ground]'); await at(520, 300); await page.waitForTimeout(60);
  const g2 = await app(() => window.__app.mech.joints.map(j => j.type));
  check('fixed-pivot tool: places a new ground pivot and fixes an existing joint', g1.join() === 'G' && g2.join() === 'G,G', g2.join());
  await page.screenshot({ path: path.join(shots, '25-fixed-pivot-tool.png') });
  await at(520, 300); await page.waitForTimeout(60);
  check('fixed-pivot tool: clicking a ground pivot again makes it movable', (await app(() => window.__app.mech.joints.map(j => j.type).join())) === 'G,R');
  const btn = page.locator('#props button[data-act=toggleFix]');
  check('joint properties: button «Сделать неподвижным»', (await btn.textContent()).includes('Сделать неподвижным'));
  await btn.click(); await page.waitForTimeout(60);
  check('button toggles the joint to fixed, label becomes «Сделать подвижным»', (await app(() => window.__app.mech.joints[1].type)) === 'G' && (await page.locator('#props button[data-act=toggleFix]').textContent()).includes('Сделать подвижным'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(60);
  check('undo restores the movable joint', (await app(() => window.__app.mech.joints[1].type)) === 'R');
  // Г-образное звено инструментом: стойка → угол → конец
  await page.click('[data-tool=bent]');
  check('bent-link tool has a clear tooltip', (await page.getAttribute('[data-tool=bent]', 'title')).includes('Г-образное'));
  await at(320, 300); await at(320, 160); await at(470, 160); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  const bl = await app(() => { const m = window.__app.mech; return { links: m.links.length, joints: m.links[0]?.joints.length, bars: m.links[0]?.bars?.length, W: window.__app.theory ? null : null }; });
  check('bent-link tool: one link with 3 joints drawn as a polyline (2 bars)', bl.links === 1 && bl.joints === 3 && bl.bars === 2, JSON.stringify(bl));
  check('Enter finishes, tool stays for the next link', (await app(() => window.__app.st.tool)) === 'bent');
  await page.keyboard.press('Escape');
  const badge = await page.textContent('#dofBadge');
  check('L-shaped link on a ground pivot: W = 1, 1 link', badge.includes('W = 1') && badge.includes('1 зв'), badge);
  await page.screenshot({ path: path.join(shots, '26-L-shaped-link-tool.png') });
  // свободное перемещение Г-образного звена: форма сохраняется
  await page.click('[data-mode=drag]'); await page.waitForTimeout(60);
  {
    const ids = await app(() => window.__app.mech.links[0].joints);
    const [ex, ey] = await scr(ids[2]);
    await page.mouse.move(canvasBox.x + ex, canvasBox.y + ey); await page.mouse.down();
    await page.mouse.move(canvasBox.x + ex - 60, canvasBox.y + ey + 120, { steps: 4 }); await page.mouse.up();
    const r = await app(ids => { const a = window.__app, P = id => a.P(id), m = a.mech, J = id => m.joints.find(j => j.id === id);
      const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]), d0 = (p, q) => Math.hypot(J(p).x - J(q).x, J(p).y - J(q).y);
      return { moved: d(P(ids[2]), [J(ids[2]).x, J(ids[2]).y]), err: Math.max(...[[0, 1], [1, 2], [0, 2]].map(([i, k]) => Math.abs(d(P(ids[i]), P(ids[k])) - d0(ids[i], ids[k])))) }; }, ids);
    check('free move: L-shaped link rotates about the pivot as one rigid body', r.moved > 5 && r.err < 1e-6, `moved ${r.moved.toFixed(1)} mm, err ${r.err.toExponential(1)}`);
    await page.screenshot({ path: path.join(shots, '27-L-shaped-free-move.png') });
  }
  await page.click('[data-mode=edit]');
  // «Объединить в одно звено»: шатун + коромысло четырёхзвенника
  await page.selectOption('#preset', 'fourbar'); await page.waitForTimeout(200);
  {
    const [ab, ob] = await app(() => { const m = window.__app.mech, J = n => m.joints.find(j => j.name === n).id; return [m.links.find(l => l.joints.includes(J('A')) && l.joints.includes(J('B'))).id, m.links.find(l => l.joints.includes(J('O₂'))).id]; });
    await app(([a, b]) => { window.__app.select('link', a); }, [ab, ob]);
    await page.evaluate(b => { const a = window.__app; a.st.selSet.set('link:' + b, { kind: 'link', id: b }); }, ob);
    await page.click('[data-tool=select]'); // перерисовать панель
    await page.evaluate(() => window.__app.select && null);
    await page.keyboard.down('Shift'); const [mx, my] = await app(id => { const a = window.__app, l = a.mech.links.find(q => q.id === id), [p, q] = l.joints.map(j => a.toS(...a.P(j))); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }, ob);
    await page.keyboard.up('Shift');
    await app(([a, b]) => { const x = window.__app; x.select('link', a); }, [ab, ob]);
    await page.keyboard.down('Shift'); await page.mouse.click(canvasBox.x + mx, canvasBox.y + my); await page.keyboard.up('Shift'); await page.waitForTimeout(80);
    const mbtn = page.locator('#props button[data-act=merge]');
    check('multi-select of two links shows «Объединить в одно звено»', (await mbtn.count()) === 1 && (await mbtn.textContent()).includes('Объединить в одно звено'));
    await mbtn.click(); await page.waitForTimeout(120);
    const mg = await app(() => { const m = window.__app.mech; return { links: m.links.length, big: m.links.find(l => l.bars)?.joints.length, W: document.querySelector('#mechInfo').textContent.match(/W = (-?\d+)/)?.[1] }; });
    check('merge: coupler + rocker became one rigid link (3 links → 2, W = 0 → structure)', mg.links === 2 && mg.big === 4 && mg.W === '0', JSON.stringify(mg));
    await page.screenshot({ path: path.join(shots, '28-merged-link.png') });
    await page.keyboard.press('Control+z'); await page.waitForTimeout(80);
    check('undo splits the merged link back', (await app(() => window.__app.mech.links.length)) === 3);
  }
  // Пример «Г-образный рычаг» + Теория: одно звено BO₂C
  await page.selectOption('#preset', 'bellcrank'); await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(shots, '29-bellcrank-editor.png') });
  // --- v5: стены / пол ---
  await page.selectOption('#preset', 'fourbar'); await page.waitForTimeout(200);
  {
    const W2S = ([x, y]) => page.evaluate(([x, y]) => window.__app.toS(x, y), [x, y]);
    canvasBox = await page.locator('#cv').boundingBox();
    check('wall tool has a clear tooltip «Стена / пол (W)»', (await page.getAttribute('[data-tool=wall]', 'title')) === 'Стена / пол (W)');
    await page.keyboard.press('w');
    check('hotkey W selects the wall tool', (await app(() => window.__app.st.tool)) === 'wall');
    for (const p of [[-40, -15], [60, -15], [130, -15]]) { const [x, y] = await W2S(p); await page.mouse.click(canvasBox.x + x, canvasBox.y + y); }
    await page.keyboard.press('Enter'); await page.waitForTimeout(80);
    const w1 = await app(() => window.__app.mech.walls);
    check('wall drawn as a polyline (3 points), selected', w1.length === 1 && w1[0].pts.length === 3 && (await app(() => window.__app.selCount())) === 1, JSON.stringify(w1[0]?.pts));
    check('walls do not change W', (await page.textContent('#dofBadge')).includes('W = 1'));
    await app(() => document.querySelector('#toast').classList.remove('show')); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, '31-wall-tool.png') });
    await page.keyboard.press('Escape');
    check('Esc after the wall returns to «Выбор»', (await app(() => window.__app.st.tool)) === 'select');
    // выделение, удаление, отмена
    const [mx, my] = await W2S([100, -15]);
    await page.mouse.click(canvasBox.x + mx, canvasBox.y + my); await page.waitForTimeout(60);
    check('click selects the wall, properties show its points', (await page.locator('#props .wallpts input').count()) === 6);
    await page.keyboard.press('Delete'); await page.waitForTimeout(60);
    const nDel = await app(() => window.__app.mech.walls.length);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(60);
    check('Delete removes the wall, Ctrl+Z restores it', nDel === 0 && (await app(() => window.__app.mech.walls.length)) === 1);
    // правка конца стены перетаскиванием вершины
    await page.mouse.click(canvasBox.x + mx, canvasBox.y + my); await page.waitForTimeout(60);
    const [vx, vy] = await W2S([130, -15]);
    await page.mouse.move(canvasBox.x + vx, canvasBox.y + vy); await page.mouse.down(); await page.mouse.move(canvasBox.x + vx, canvasBox.y + vy - 40, { steps: 3 }); await page.mouse.up();
    const end = await app(() => window.__app.mech.walls[0].pts[2]);
    check('wall end point can be dragged', end[0] === 130 && end[1] > -10, JSON.stringify(end));
    // свободное перемещение в стену: кривошип не проходит сквозь неё
    await page.click('[data-mode=drag]'); await page.waitForTimeout(60);
    const aId = await jid('A'); const [ax, ay] = await scr(aId);
    await page.mouse.move(canvasBox.x + ax, canvasBox.y + ay); await page.mouse.down();
    let minY = Infinity;
    for (const p of [[-10, 0], [-20, -30], [0, -60], [20, -60], [30, -40]]) { const [x, y] = await W2S(p); await page.mouse.move(canvasBox.x + x, canvasBox.y + y, { steps: 3 }); await page.waitForTimeout(40); minY = Math.min(minY, await app(id => window.__app.P(id)[1], aId)); }
    const contact = await app(() => !!window.__app.sim.contact);
    await page.screenshot({ path: path.join(shots, '33-drag-against-wall.png') });
    await page.mouse.up();
    check('free move: dragging the crank into the wall stops at the wall', minY >= -15 - 1e-6 && minY < -12 && contact, `min y of A = ${minY.toFixed(3)} (wall at −15)`);
    await page.click('[data-mode=edit]');
  }
  // пример «Четырёхзвенник на полу»: двигатель упирается в пол
  await page.selectOption('#preset', 'floorstop'); await page.waitForTimeout(200);
  {
    await page.click('[data-mode=sim]'); await page.click('#btnPlay');
    let hit = false, minY = Infinity, toastTxt = '';
    for (let k = 0; k < 240 && !hit; k++) {
      await page.waitForTimeout(50);
      const r = await app(() => { const a = window.__app, ys = a.mech.joints.map(j => a.P(j.id)[1]); return { c: !!a.sim.contact, y: Math.min(...ys), toast: document.querySelector('#toast').textContent }; });
      minY = Math.min(minY, r.y); if (r.c) { hit = true; toastTxt = r.toast; }
    }
    await page.screenshot({ path: path.join(shots, '32-floor-contact-sim.png') });
    await page.waitForTimeout(600);
    const d = await app(() => window.__app.sim.dir);
    await page.click('#btnPlay');
    check('simulation: crank hits the floor, message «Упор в стену», contact highlighted', hit && toastTxt.includes('Упор в стену') && minY > -1e-6, `toast «${toastTxt}», min y ${minY.toExponential(1)}`);
    check('simulation: motor reverses after the contact (mode «реверс»)', d === -1);
    await page.click('[data-mode=edit]');
  }
  // «Добавить пол» и Теория
  await page.selectOption('#preset', 'fourbar'); await page.waitForTimeout(200); await page.keyboard.press('Escape');
  await page.click('#props button[data-act=addFloor]'); await page.waitForTimeout(80);
  const fl = await app(() => window.__app.mech.walls);
  check('«Добавить пол» adds a horizontal floor under the mechanism', fl.length === 1 && fl[0].pts[0][1] === fl[0].pts[1][1] && fl[0].pts[0][1] < 0);
  await page.screenshot({ path: path.join(shots, '34-add-floor.png') });
  await page.click('#btnTheory'); await page.waitForTimeout(400);
  check('Theory mentions walls as unilateral constraints, counts unchanged', (await page.textContent('#thBody')).includes('односторонние ограничения') && (await app(() => window.__app.theory().n)) === 3);
  await page.click('#thClose');
  await page.selectOption('#preset', 'fourbar'); await page.waitForTimeout(200);

  // --- Теория ---
  await page.click('#btnTheory'); await page.waitForTimeout(400);
  check('Theory panel opens (RU)', await page.isVisible('#theory') && (await page.textContent('#theory')).includes('Степень подвижности'));
  {
    const a = await page.evaluate(() => window.__app.theory());
    const txt = await page.textContent('#thBody');
    check('Theory four-bar: W=1, I(0,1)→II(2,3), dyad вид 1', a.W === 1 && a.formula === 'I(0,1) → II(2,3)' && a.assur.groups[0].vid === 1, a.formula);
    check('Theory four-bar: links table classified (кривошип/шатун/коромысло)', ['кривошип', 'шатун', 'коромысло', 'стойка'].every(w => txt.includes(w)) && (await page.$$('#thBody table')).length >= 3);
    check('Theory four-bar: Grashof verdict shown', txt.includes('Грасгофа') && txt.includes('кривошипно-коромысловый'));
    await page.screenshot({ path: path.join(shots, '16-theory-fourbar.png') });
    const dl = page.waitForEvent('download'); await page.click('#thCsv'); const d = await dl;
    const csv = fs.readFileSync(await d.path(), 'utf8');
    check('Theory CSV export: links, pairs and Assur sections', csv.includes('Звенья') && csv.includes('Кинематические пары') && csv.includes('I(0,1) → II(2,3)'), d.suggestedFilename());
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(150);
    check('Theory print view hides the editor', !(await page.isVisible('#cv')) && await page.isVisible('#thBody'));
    await page.screenshot({ path: path.join(shots, '17-theory-print.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
  }
  for (const [k, shot, test] of [
    ['crankslider', '18-theory-crankslider', a => a.assur.groups.length === 1 && a.assur.groups[0].vid === 2],
    ['watt', '19-theory-watt', a => a.assur.groups.length === 2 && a.assur.cls === 2],
    ['kulisa', '20-theory-kulisa', a => a.assur.groups[0].vid === 3 && a.links.some(l => l.type === 'stone')],
    ['planetary', '21-theory-planetary', a => a.p4 === 2 && a.assur.substitute && a.assur.ok],
    ['camTrans', '22-theory-cam', a => a.p4 === 1 && a.links.some(l => l.type === 'cam') && a.links.some(l => l.type === 'follower')],
    ['bellcrank', '30-theory-bellcrank', a => a.n === 5 && a.links.some(l => l.name === 'BO₂C' && l.type === 'rocker') && a.assur.groups.length === 2],
  ]) {
    await page.selectOption('#preset', k); await page.waitForTimeout(450);
    const a = await page.evaluate(() => window.__app.theory());
    const shown = await page.textContent('#thBody');
    check(`Theory ${k}: live update, structure ${a.formula}`, test(a) && shown.includes(String(a.links.at(-1).name)));
    await page.screenshot({ path: path.join(shots, shot + '.png') });
  }
  await page.click('#theory [data-tab=ref]'); await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelectorAll('#thBody details').forEach(d => { d.open = ['grashof', 'cam'].includes(d.dataset.art); }));
  check('Theory reference: 7 articles with KaTeX formulas', (await page.$$('#thBody details')).length === 7 && (await page.$$('#thBody .katex')).length > 10);
  await page.screenshot({ path: path.join(shots, '23-theory-reference.png') });
  await page.selectOption('#lang', 'en'); await page.waitForTimeout(250);
  check('Theory reference in EN', (await page.textContent('#theory')).includes('Grashof condition'));
  await page.selectOption('#lang', 'ru');
  await page.click('#thClose');

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
