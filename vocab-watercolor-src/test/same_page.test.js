// leak.js 的「點擊後網址檢查」：用真的 Chromium 確認正規化網址不會誤判、真的跳頁仍會被抓到。
// 請求用 Playwright 攔截回應，不用開伺服器，也不用佔 port 80。
// 用法：node --test same_page.test.js
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { samePage } = require('./same_page');

const PAGE = '<title>paper</title><a id="nav" href="/one-drop.html">一滴水</a>';

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await fn(await ctx.newPage());
  } finally {
    await browser.close();
  }
}

test('BASE=http://localhost:80：瀏覽器回報 http://localhost/… 不算跳頁', async () => {
  const base = 'http://localhost:80/new/vocab-watercolor.html';
  await withPage(async page => {
    await page.goto(base);
    assert.strictEqual(page.url(), 'http://localhost/new/vocab-watercolor.html');   // 瀏覽器真的會拿掉 :80
    assert.notStrictEqual(page.url(), base);                                        // 舊的字串比較會誤判
    assert.ok(samePage(page.url(), base));
  });
});

test('主機名稱大小寫不同也不算跳頁', () => {
  assert.ok(samePage('http://localhost:8765/new/vocab-watercolor.html', 'http://LOCALHOST:8765/new/vocab-watercolor.html'));
});

test('真的點到連結跳到別頁，仍判定為跳頁', async () => {
  const base = 'http://localhost:80/new/vocab-watercolor.html';
  await withPage(async page => {
    await page.goto(base);
    await Promise.all([page.waitForURL('**/one-drop.html'), page.click('#nav')]);
    assert.strictEqual(page.url(), 'http://localhost/one-drop.html');
    assert.ok(!samePage(page.url(), base));
  });
});
