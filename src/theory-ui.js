// Панель «Теория»: живой структурный анализ + справка, экспорт CSV, печать.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { analyze } from './theory.js';
import { TT } from './theory-text.js';
import { ARTICLES } from './theory-ref.js';
import { lang } from './i18n.js';

const tt = (k, v = {}) => String(TT[lang]?.[k] ?? TT.ru[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ''));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = n => String(n).split('').map(d => SUB[+d] ?? d).join('');
export function tex(html) {
  const r = (src, display) => { try { return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, output: 'html' }); } catch { return esc(src); } };
  return html.replace(/\$\$([\s\S]+?)\$\$/g, (_, s) => r(s, true)).replace(/\$([^$]+?)\$/g, (_, s) => r(s, false));
}
const num = (v, d = 2) => { const s = (+v).toFixed(d); return lang === 'ru' ? s.replace('.', ',') : s; };
const numT = (v, d = 2) => num(v, d).replace(',', '{,}'); // запятая в TeX без лишнего пробела

let ui = null, getMech = null, getCanvas = null, cache = { key: '', a: null }, tab = 'analysis', timer = 0;

export function pairLabel(p) {
  if (p.kind === 'H') return `${p.sub === 'gear' ? (lang === 'ru' ? 'З' : 'G') : (lang === 'ru' ? 'К' : 'C')}${sub(p.idx)}(${p.a}–${p.b})`;
  return `${p.joint}(${p.a}–${p.b})`;
}
const pairKind = p => p.kind === 'R' ? tt('kindR') : p.kind === 'P' ? tt('kindP') : `${tt('kindH')} (${tt(p.sub === 'gear' ? 'subGear' : 'subCam')})`;
const VIDC = { 1: 'ВВВ', 2: 'ВВП', 3: 'ВПВ', 4: 'ПВП', 5: 'ВПП' }, VIDE = { 1: 'RRR', 2: 'RRP', 3: 'RPR', 4: 'PRP', 5: 'RPP' };
function motionText(l) {
  const mo = l.motion; if (!mo) return '—';
  return tt('m_' + mo.kind, { v: mo.value == null ? '' : num(mo.value, mo.kind === 'stroke' || mo.kind === 'transl' ? 1 : 1) });
}
function sizeText(l) {
  const out = l.lengths.map(x => `${x.label} = ${num(x.value)}`);
  if (l.gear) out.push(`r = ${num(l.gear.r)}, z = ${l.gear.z}, m = ${num(l.gear.m, 3)}`);
  if (l.cam) out.push(`r₀ = ${num(l.cam.rb)}, h = ${num(l.cam.h)}${l.cam.kind === 'rocker' ? '°' : ''}, r${lang === 'ru' ? 'р' : 'r'} = ${num(l.cam.rr)}${l.cam.kind !== 'rocker' ? `, e = ${num(l.cam.e)}` : ''}`);
  return out.join('; ') || '—';
}
const typeText = l => tt('t_' + l.type) + (l.driver ? ` (${tt('driver')})` : '');

// --- таблицы (общие для HTML и CSV) ---
export function tables(a) {
  const links = { head: [tt('cNo'), tt('cName'), tt('cType'), tt('cJoints'), tt('cSize'), tt('cMotion')],
    rows: a.links.map(l => [String(l.no), l.name, typeText(l), l.joints.join(', '), sizeText(l), l.no === 0 ? '—' : motionText(l)]) };
  const pairs = { head: [tt('cDes'), tt('cLinks'), tt('cKind'), tt('cClass'), tt('cMob'), tt('cClosure')],
    rows: a.pairs.map(p => [pairLabel(p), `${p.a}–${p.b}`, pairKind(p), p.cls === 5 ? tt('clsV') : tt('clsIV'), p.cls === 5 ? tt('mob1') : tt('mob2'), p.closure === 'force' ? tt('closeForce') : tt('closeGeom')]) };
  const groups = { head: [tt('gNo'), tt('gLinks'), tt('gPairs'), tt('gClass'), tt('gOrder'), tt('gVid')],
    rows: a.assur.groups.map((g, i) => [String(i + 1), g.bodies.join(', '), g.pairs.map(p => p.joint ? `${p.joint}(${Math.min(p.a, p.b)}–${Math.max(p.a, p.b)})` : `∗(${Math.min(p.a, p.b)}–${Math.max(p.a, p.b)})`).join(', '),
      roman(g.cls), String(g.order), g.vid ? tt('vid', { v: g.vid, c: lang === 'ru' ? VIDC[g.vid] : VIDE[g.vid] }) : '—']) };
  return { links, pairs, groups };
}
const ROM = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'], roman = k => ROM[k] || String(k);
const table = t => `<div class="th-wrap"><table class="th-table"><thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function analysisHtml(a, m) {
  if (!m.links.length) return `<p class="muted">${tt('empty')}</p>`;
  const T = tables(a), H = [];
  // 1. Чебышёв
  const lower = a.pairs.filter(p => p.cls === 5).map(pairLabel), higher = a.pairs.filter(p => p.cls === 4).map(pairLabel);
  H.push(`<section><h3>1. ${tt('secDof')}</h3>`);
  H.push(tex(`$$W = 3n - 2p_5 - p_4 = 3\\cdot ${a.n} - 2\\cdot ${a.p5} - ${a.p4} = ${3 * a.n} - ${2 * a.p5} - ${a.p4} = ${a.W}$$`));
  H.push(`<ul class="th-terms"><li>${tex(`$n = ${a.n}$`)} — ${tt('nTerm')}: ${a.movingNums.join(', ') || tt('none')} (${tt('frameNot')});</li>`);
  H.push(`<li>${tex(`$p_5 = ${a.p5}$`)} — ${tt('p5Term')}: ${esc(lower.join(', ') || tt('none'))};</li>`);
  H.push(`<li>${tex(`$p_4 = ${a.p4}$`)} — ${tt('p4Term')}: ${esc(higher.join(', ') || tt('none'))}.</li></ul>`);
  H.push(`<p>${a.W === 1 ? tt('W1') : a.W === 0 ? tt('W0') : a.W < 0 ? tt('Wneg') : tt('Wmany', { w: a.W })}</p>`);
  const notes = [];
  if (a.links.some(l => l.type === 'slider' || l.type === 'stone' || l.type === 'follower')) notes.push(tt('blockNote'));
  const jc = {}; a.pairs.filter(p => p.kind === 'R').forEach(p => { jc[p.joint] = (jc[p.joint] || 0) + 1; });
  if (Object.entries(jc).some(([, c]) => c >= 2)) notes.push(tt('compoundNote'));
  if (a.Wreal != null) notes.push(tex(a.Wreal === a.W ? tt('rankOk', { r: a.Wreal }) : a.Wreal > a.W ? tt('rankRed', { r: a.Wreal, w: a.W, q: a.Wreal - a.W }) : tt('rankPass', { r: a.Wreal, w: a.W, q: a.W - a.Wreal })));
  if ((m.cams || []).some(c => c.rr > 0)) notes.push(tex(tt('rollerNote')));
  H.push(`<ul class="th-notes">${notes.map(x => `<li>${x}</li>`).join('')}</ul></section>`);
  // 2–3. Таблицы
  H.push(`<section><h3>2. ${tt('secLinks')}</h3>${table(T.links)}`);
  if (!m.driver) H.push(`<p class="muted small">${tt('noMotion')}</p>`); else if (a.motionOk === false) H.push(`<p class="muted small">${tt('lockNote')}</p>`);
  H.push(`</section><section><h3>3. ${tt('secPairs')}</h3>${table(T.pairs)}</section>`);
  // 4. Ассур
  H.push(`<section><h3>4. ${tt('secAssur')}</h3>`);
  if (!a.assur.ok) H.push(`<p>${tt(a.assur.reason === 'noDriver' ? 'rNoDriver' : a.assur.reason === 'W' ? 'rW' : 'rFail')}</p>`);
  else {
    const d = a.links.find(l => l.no === a.assur.initial[1]);
    H.push(`<p>${esc(tt('initial', { d: d.no, name: `${typeText(d)} ${d.name}` }))}</p>`);
    if (T.groups.rows.length) H.push(table(T.groups));
    if (a.assur.substitute) H.push(`<p class="small">${tt('subNote')}</p><ul class="small">${a.assur.subs.map(s => `<li>${esc(tt('subItem', { n: s.no, what: tt(s.kind === 'gear' ? 'subGearW' : 'subCamW'), a: s.a, b: s.b }))}</li>`).join('')}</ul><p class="small muted">∗ — ${lang === 'ru' ? 'пары условного звена' : 'pairs of a virtual link'}</p>`);
    H.push(`<p>${esc(tt('mechClass', { c: roman(a.assur.cls) }))}</p>`);
    H.push(`<p><b>${tt('formula')}:</b> ${tex(`$${a.formula.replace(/→/g, '\\to')}$`)}</p>`);
  }
  H.push('</section>');
  const ch = checksHtml(a);
  if (ch) H.push(`<section><h3>5. ${tt('secChecks')}</h3>${ch}</section>`);
  return H.join('');
}
function checksHtml(a) {
  const out = [];
  const f = a.fourbar;
  if (f) {
    const L = f.lengths;
    out.push(`<div class="th-check"><b>${tt('grTitle')}</b><p>${esc(tt('grLens', { g: num(L.ground), i: num(L.input), c: num(L.coupler), o: num(L.output) }))}</p>`);
    out.push(tex(`$$s + l = ${numT(f.s)} + ${numT(f.l)} = ${numT(f.s + f.l)} \\;${f.ok ? '\\le' : '>'}\\; p + q = ${numT(f.pq)}$$`));
    out.push(`<p class="${f.inputIsCrank || f.kind === 'double-crank' ? 'ok' : 'warn'}">${esc(tt('gr_' + f.kind.replace('-', ''), { i: f.nums.input, o: f.nums.output }))}</p>`);
    if (f.change) out.push(`<p class="warn">${tt('grChange')}</p>`);
    if (f.mu) out.push(`<p>${esc(tt('muLine', { a: num(f.mu.min, 1), b: num(f.mu.max, 1), verdict: f.mu.min >= 40 ? tt('muOk') : tt('muBad') }))}</p>`);
    out.push('</div>');
  }
  const c = a.crankslider;
  if (c) out.push(`<div class="th-check"><b>${tt('csTitle')}</b><p>${tex(tt('csLine', { r: num(c.r), l: num(c.l), e: num(c.e), v: c.crank ? tt('csYes') : tt('csNo') }))}</p></div>`);
  return out.join('');
}
function refHtml(a) {
  return ARTICLES[lang].map((ar, i) => {
    const live = ar.id === 'grashof' ? checksHtml(a) : '';
    return `<details class="th-art" data-art="${ar.id}" ${i === 0 ? 'open' : ''}><summary>${esc(ar.title)}</summary><div class="th-art-body">${tex(ar.html)}${live ? `<div class="th-live">${live}</div>` : ''}</div></details>`;
  }).join('');
}

function current() {
  const m = getMech(), key = JSON.stringify([m.joints, m.links, m.gears, m.cams, m.driver]);
  if (cache.key !== key) { let a = null; try { a = analyze(m); } catch (e) { console.warn('theory', e); } cache = { key, a }; }
  return { m, a: cache.a };
}
export function renderTheory() {
  if (!ui || ui.hidden) return;
  toggleTheory.place?.();
  const { m, a } = current();
  ui.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ui.querySelector('#thTitle').textContent = tt('theory');
  ui.querySelector('[data-tab=analysis]').textContent = tt('tabAnalysis');
  ui.querySelector('[data-tab=ref]').textContent = tt('tabRef');
  ui.querySelector('#thCsv').textContent = tt('csv'); ui.querySelector('#thPrint').textContent = tt('print'); ui.querySelector('#thClose').title = tt('close');
  const body = ui.querySelector('#thBody');
  const open = new Set([...body.querySelectorAll('details[open]')].map(d => d.dataset.art));
  body.innerHTML = !a ? `<p class="muted">${tt('rFail')}</p>` : tab === 'analysis' ? analysisHtml(a, m) : refHtml(a);
  if (tab === 'ref' && open.size) body.querySelectorAll('details').forEach(d => { d.open = open.has(d.dataset.art); });
}
export function refreshTheory() { clearTimeout(timer); timer = setTimeout(renderTheory, 120); }
export function theoryAnalysis() { return current().a; }

function csvText() {
  const { m, a } = current(); if (!a) return '';
  const T = tables(a), q = s => /[;"\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const L = [];
  const row = r => L.push(r.map(q).join(';'));
  row([tt('printTitle')]); row(['W = 3n − 2p5 − p4', 'n', 'p5', 'p4', 'W']); row(['', a.n, a.p5, a.p4, a.W]);
  row([]); row([tt('secLinks')]); row(T.links.head); T.links.rows.forEach(row);
  row([]); row([tt('secPairs')]); row(T.pairs.head); T.pairs.rows.forEach(row);
  row([]); row([tt('secAssur')]);
  if (a.assur.ok) { row(T.groups.head); T.groups.rows.forEach(row); row([tt('formula'), a.formula]); row([tt('mechClass', { c: roman(a.assur.cls) })]); }
  else row([tt(a.assur.reason === 'noDriver' ? 'rNoDriver' : a.assur.reason === 'W' ? 'rW' : 'rFail')]);
  void m;
  return '\ufeff' + L.join('\r\n');
}
export const theoryCsv = csvText;

export function initTheory(opts) {
  getMech = opts.getMech; getCanvas = opts.getCanvas;
  ui = document.createElement('aside'); ui.id = 'theory'; ui.className = 'theory'; ui.hidden = true;
  ui.innerHTML = `<div class="th-head"><b id="thTitle"></b><div class="seg"><button data-tab="analysis"></button><button data-tab="ref"></button></div><div class="spacer"></div>
<button id="thCsv"></button><button id="thPrint"></button><button id="thClose" aria-label="close">✕</button></div>
<div class="th-print-head"><h2 id="thPrintTitle"></h2><img id="thShot" alt=""><div id="thDate" class="muted small"></div></div>
<div class="th-body" id="thBody"></div>`;
  document.body.appendChild(ui);
  const place = () => { const h = document.querySelector('header.top'), r = h?.getBoundingClientRect(); if (r && r.height > 0) ui.style.top = r.bottom + 'px'; };
  window.addEventListener('resize', place);
  ui.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab; renderTheory(); }; });
  ui.querySelector('#thClose').onclick = () => toggleTheory(false);
  ui.querySelector('#thCsv').onclick = () => opts.download(lang === 'ru' ? 'структурный-анализ.csv' : 'structural-analysis.csv', csvText(), 'text/csv');
  ui.querySelector('#thPrint').onclick = () => {
    ui.querySelector('#thPrintTitle').textContent = tt('printTitle');
    ui.querySelector('#thDate').textContent = tt('printed', { d: new Date().toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB') });
    try { ui.querySelector('#thShot').src = getCanvas().toDataURL('image/png'); } catch { /* ignore */ }
    window.print();
  };
  toggleTheory.place = place;
}
export function toggleTheory(on = ui.hidden) {
  ui.hidden = !on; document.body.classList.toggle('theory-open', on);
  document.getElementById('btnTheory')?.classList.toggle('on', on);
  if (on) { toggleTheory.place?.(); renderTheory(); }
}
export function setTheoryTab(t) { tab = t; renderTheory(); }
