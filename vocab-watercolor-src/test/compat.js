// 舊存檔相容、舊版顯示規則、備份還原。舊頁和新頁放在同一個網址底下（共用同一份 localStorage / IndexedDB），
// 模擬「學生在舊版頁面塗過，老師更新頁面後再打開」。伺服器設定同 leak.js。用法：node compat.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const OLD = BASE + '/old/vocab-watercolor.html', NEW = BASE + '/new/vocab-watercolor.html';
let fails = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
async function open(ctx, url) {
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(url);
  await p.waitForFunction(() => document.body.classList.contains('ready') && window.__aw && window.__aw.regions, null, { timeout: 60000 });
  await p.waitForTimeout(300);
  return p;
}
async function tapDoc(p, x, y) {
  const [cx, cy] = await p.evaluate(([x, y]) => window.__aw.engine.docToClient(x / 1000, 1 - y / 1250), [x, y]);
  await p.mouse.click(cx, cy); await p.waitForTimeout(250);
  await p.evaluate(() => window.__aw.finishRun());
}
async function pickerIds(p) {
  if (!(await p.isVisible('#change'))) await p.click('#vw-tab-paint');
  await p.click('#change'); await p.waitForSelector('[data-pick]'); await p.waitForTimeout(300);
  const ids = await p.$$eval('[data-pick]', b => b.map(x => x.dataset.pick + '|' + x.textContent.trim()));
  await p.keyboard.press('Escape'); await p.evaluate(() => { const d = document.getElementById('dialog'); if (d) d.hidden = true; });
  return ids;
}
async function paintSig(p) {
  return p.evaluate(async () => {
    window.__aw.finishRun();
    const blob = await window.__aw.engine.exportImage({ format: 'png', background: 'transparent', texture: false });
    const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, h = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { n++; h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13 + d[i + 3] * 17 + i) >>> 0; }
    return n + ':' + h;
  });
}
const save = p => p.evaluate(() => JSON.parse(localStorage.getItem('vocab-watercolor-v1') || 'null'));
const flush = async p => { await p.evaluate(() => window.__aw.saveNow()); await p.waitForTimeout(300); };
const LEGACY = ['vw-tools', 'vw-desk', 'vw-vase', 'vw-village', 'vw-starry', 'vw-lotus'];
const STARRY_PTS = [[500, 150], [880, 640], [600, 1000]];

(async () => {
  const browser = await chromium.launch();

  // ---- A. brand-new student ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p = await open(ctx, NEW);
    check('A1 新學生預設開新版畫具桌', await p.evaluate(() => window.__aw.ui.drawing) === 'vw-tools-v2');
    const ids = (await pickerIds(p)).map(s => s.split('|')[0]);
    check('A2 新學生選單沒有任何舊版', !ids.some(i => LEGACY.includes(i)), ids.join(','));
    check('A3 選單有 6 張新版＋水果籃', ids.length === 7 && ids.includes('vw-fruit'), String(ids.length));
    await ctx.close();
  }

  // ---- B. student who painted the OLD starry on the old page, and only opened old tools ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  let oldBackup;
  {
    const p = await open(ctx, OLD);   // old default = vw-tools, opened but never painted
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('vocab-watercolor-v1') || '{}'); s.v = 1; s.credits = 50; localStorage.setItem('vocab-watercolor-v1', JSON.stringify(s)); });
    await p.reload(); await p.waitForFunction(() => document.body.classList.contains('ready') && window.__aw && window.__aw.regions);
    await p.evaluate(() => window.__aw.loadDrawing(window.__aw.BUILTIN.find(a => a.id === 'vw-starry')));
    await p.waitForTimeout(500);
    for (const [x, y] of STARRY_PTS) await tapDoc(p, x, y);
    await flush(p);
    const s = await save(p);
    check('B0 舊版頁面：星夜塗了 3 塊', (s.unlocked['vw-starry'] || []).length === 3, JSON.stringify(s.unlocked));
    oldBackup = await p.evaluate(() => window.__vwBackup.make());
    await p.close();
  }
  let oldSig;
  const before = (await (async () => { const p = await open(ctx, OLD); const r = await save(p); oldSig = await paintSig(p); await p.close(); return r; })());
  check('B0b 舊版頁面重新載入後有顏色', +oldSig.split(':')[0] > 1000, oldSig);
  {
    const p = await open(ctx, NEW);
    check('B1 新版頁面：上次停在舊版星夜 → 仍開舊版星夜', await p.evaluate(() => window.__aw.ui.drawing) === 'vw-starry');
    const sig = await paintSig(p);
    check('B2 舊版星夜的顏色跟舊版頁面逐像素相同', sig === oldSig, sig + ' vs ' + oldSig);
    const s = await save(p);
    check('B3 解鎖紀錄、顏料完全沒變', JSON.stringify(s.unlocked) === JSON.stringify(before.unlocked) && s.credits === before.credits, JSON.stringify(s.unlocked) + ' credits=' + s.credits);
    const prog = await p.textContent('#vw-prog');
    check('B4 進度顯示用舊版塊數', /3 \/ 171/.test(prog), prog);
    const picks = await pickerIds(p), ids = picks.map(s => s.split('|')[0]);
    check('B5 選單有舊版星夜、標「舊版」', picks.some(s => s.startsWith('vw-starry|') && s.includes('舊版')), picks.filter(s => s.includes('舊版')).join(','));
    check('B6 沒塗過的舊版（畫具桌等）不顯示', !ids.some(i => LEGACY.includes(i) && i !== 'vw-starry'), ids.join(','));
    check('B7 新版星夜也在選單', ids.includes('vw-starry-v2'));
    // switch to new starry and back: old work still there
    await p.evaluate(() => window.__aw.loadDrawing(window.__aw.BUILTIN.find(a => a.id === 'vw-starry-v2'))); await p.waitForTimeout(400);
    check('B8 新版星夜是空白的新畫', (await paintSig(p)).startsWith('0:'));
    await p.evaluate(() => window.__aw.loadDrawing(window.__aw.BUILTIN.find(a => a.id === 'vw-starry'))); await p.waitForTimeout(400);
    check('B9 切回舊版星夜，顏色逐像素相同', (await paintSig(p)) === oldSig);
    await p.close();
  }
  // ---- C. student whose last drawing was the old default (tools) but never painted it ----
  {
    const p = await open(ctx, NEW);
    await p.evaluate(() => { const u = JSON.parse(localStorage.getItem('vocab-watercolor.ui')); u.drawing = 'vw-tools'; localStorage.setItem('vocab-watercolor.ui', JSON.stringify(u)); });
    await p.close();
    const q = await open(ctx, NEW);
    check('C1 停在「沒塗過的舊版畫具桌」→ 自動換新版', await q.evaluate(() => window.__aw.ui.drawing) === 'vw-tools-v2', await q.evaluate(() => window.__aw.ui.drawing));
    await q.close();
  }
  // ---- D. paint only in IndexedDB (no unlocked record) still counts as progress ----
  {
    const p = await open(ctx, NEW);
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('vocab-watercolor-v1')); delete s.unlocked['vw-starry']; localStorage.setItem('vocab-watercolor-v1', JSON.stringify(s)); });
    await p.close();
    const q = await open(ctx, NEW);
    const ids = (await pickerIds(q)).map(s => s.split('|')[0]);
    check('D1 只有顏色、沒有解鎖紀錄的舊版仍顯示', ids.includes('vw-starry'));
    await q.close();
  }
  await ctx.close();

  // ---- E. restore an OLD-page backup on another device (empty storage) into the NEW page ----
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p = await open(c2, NEW);
    check('E0 新裝置：沒有舊版', !(await pickerIds(p)).some(s => s.includes('舊版')));
    await Promise.all([p.waitForNavigation(), p.evaluate(d => window.__vwBackup.restore(d), oldBackup)]);
    await p.waitForFunction(() => document.body.classList.contains('ready') && window.__aw && window.__aw.regions, null, { timeout: 60000 });
    await p.waitForTimeout(400);
    check('E1 還原舊版備份後開的是舊版星夜', await p.evaluate(() => window.__aw.ui.drawing) === 'vw-starry');
    check('E2 顏色逐像素還原', (await paintSig(p)) === oldSig);
    const s = await save(p);
    check('E3 解鎖紀錄還原', (s.unlocked['vw-starry'] || []).length === 3);
    check('E4 選單看得到舊版星夜', (await pickerIds(p)).some(s => s.startsWith('vw-starry|')));
    // new-page backup round trip
    const bk = await p.evaluate(() => window.__vwBackup.make());
    check('E5 新版備份含舊版顏色', Object.keys(bk.paint).includes('paint:vw-starry'), Object.keys(bk.paint).join(','));
    await c2.close();
  }
  // ---- F. IndexedDB unavailable → show every legacy picture ----
  {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await c3.addInitScript(() => { const f = () => { throw new Error('blocked'); }; try { Object.defineProperty(window, 'indexedDB', { get() { return { open: f }; } }); } catch (e) {} });
    const p = await c3.newPage(); await p.goto(NEW);
    await p.waitForFunction(() => window.__vwHideArt, null, { timeout: 30000 }); await p.waitForTimeout(800);
    const hidden = await p.evaluate(L => L.filter(id => window.__vwHideArt(id)), LEGACY);
    check('F1 讀不到資料庫 → 舊版全部顯示（不隱藏）', hidden.length === 0, hidden.join(','));
    await c3.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
