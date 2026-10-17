// 漏色實測：在瀏覽器真的點一塊上色，再用引擎匯出透明圖，檢查隔壁那塊的像素是不是還沒有顏色。
// 先在 trinkets 上一層開伺服器，new/ 放這次產生的 vocab-watercolor.html，old/ 放改版前的（git show <舊 commit>:vocab-watercolor.html）：
//   python -m http.server 8765
// 先跑 python -I pick_points.py points.json 產生測試點（放在這個資料夾）。
// 用法：node leak.js new   （或 old：拿同樣的點測舊圖，當對照組）  BASE=http://… 可換網址；ONLY=vw-vase-v2 只測一張
const { chromium } = require('playwright');
const fs = require('fs');
const points = JSON.parse(fs.readFileSync(__dirname + '/points.json', 'utf8'));
const which = process.argv[2] || 'new';            // new | old
const base = (process.env.BASE || 'http://localhost:8765') + '/' + which + '/vocab-watercolor.html';

async function openArt(browser, id) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(id => {
    if (!localStorage.getItem('vocab-watercolor-v1')) {
      localStorage.setItem('vocab-watercolor-v1', JSON.stringify({ v: 1, credits: 999, tab: 'paint' }));
      localStorage.setItem('vocab-watercolor.ui', JSON.stringify({ drawing: id, tool: 'paint', line: 'show' }));
    }
  }, id);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.__aw && window.__aw.regions, null, { timeout: 60000 });
  return { ctx, page };
}
async function alphaAt(page, pts) {
  return page.evaluate(async pts => {
    window.__aw.finishRun();
    const blob = await window.__aw.engine.exportImage({ format: 'png', background: 'transparent', texture: false });
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const k = bmp.width / 1000;
    return pts.map(([x, y]) => {
      // max alpha in a 5x5 patch
      const d = g.getImageData(Math.round(x * k) - 2, Math.round(y * k) - 2, 5, 5).data; let m = 0;
      for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m;
    });
  }, pts);
}
const tapMode = { mouse: 0, act: 0 };
async function tap(page, x, y) {
  const [cx, cy] = await page.evaluate(([x, y]) => window.__aw.engine.docToClient(x / 1000, 1 - y / 1250), [x, y]);
  const onPaper = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id === 'touch', [cx, cy]);
  if (onPaper) await page.mouse.click(cx, cy);
  else await page.evaluate(([x, y]) => window.__aw.act(x, y), [cx, cy]);   // UI covers this spot: same handler the tap calls
  tapMode[onPaper ? 'mouse' : 'act']++;
  await page.waitForTimeout(250);
  // 點到連結跳走了就整個停下，不要在別的頁面上繼續點
  if (page.url() !== base) throw new Error(`點擊後網址變成 ${page.url()}（應該是 ${base}），停止測試`);
}
(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const [v2, pairs] of Object.entries(points)) {
    if (process.env.ONLY && v2 !== process.env.ONLY) continue;
    const id = which === 'new' ? v2 : v2.replace('-v2', '');
    const { ctx, page } = await openArt(browser, id);
    const cur = await page.evaluate(() => window.__aw.ui.drawing);
    if (cur !== id) { console.log(id, 'WRONG DRAWING', cur); await ctx.close(); continue; }
    let ok = 0, leak = 0, miss = 0; const leaks = [];
    for (const p of pairs) {
      const [before] = await alphaAt(page, [p.clean]);
      if (before > 0) { miss++; leaks.push('SKIP already painted ' + JSON.stringify(p.clean)); continue; }          // already painted by an earlier tap: skip
      await tap(page, ...p.tap);
      const [ta, ca] = await alphaAt(page, [p.tap, p.clean]);
      if (ta === 0) { miss++; leaks.push('SKIP tap not painted ' + JSON.stringify(p.tap)); continue; }            // tap did not paint (gate/miss)
      if (ca > 0) { leak++; leaks.push(p.edge + ' tap' + JSON.stringify(p.tap) + '→' + JSON.stringify(p.clean)); } else ok++;
    }
    report[id] = { pairs: pairs.length, clean: ok, leaked: leak, skipped: miss, leaks };
    console.log(id.padEnd(15), `pairs=${pairs.length} clean=${ok} leaked=${leak} skipped=${miss}`, leaks.slice(0, 3).join(' | '));
    await ctx.close();
  }
  console.log('taps:', JSON.stringify(tapMode));
  fs.writeFileSync(__dirname + `/leak-${which}.json`, JSON.stringify(report, null, 1));
  await browser.close();
})();
