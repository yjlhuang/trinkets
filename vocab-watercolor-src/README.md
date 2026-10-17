# 單字水彩（vocab-watercolor）原始碼

`../vocab-watercolor.html` 是由這個資料夾產生的頁面。**不要直接改那個 html**，改這裡的檔案後重跑 `build.py`。

## 檔案

| 檔案 | 用途 |
|---|---|
| `build.py` | 讀 `../watercolor.html`（水彩引擎）和 `../one-drop.html`（單字），做錨點替換、接上答題面板，寫出 `../vocab-watercolor.html`。畫作清單 `ART` 也在這裡 |
| `panel.html`、`vocab.css`、`vocab.js` | 答題／調色面板、樣式、答題與解鎖邏輯 |
| `art/<id>.png` | 引擎用的線稿：1000×1250、白底、16 階灰 |
| `art-src/` | 線稿原圖（目前只有 `vw-tools-v2`、`vw-starry-v2`；第一版的原圖沒留下） |
| `prep_art.py` | 原圖 → `art/<id>.png` |
| `check_art.py` | 離線檢查線稿會被切成哪些區塊、邊緣有沒有白條 |
| `test/` | 瀏覽器實測：漏色（`leak.js`）、舊存檔相容與備份還原（`compat.js`） |

## 存檔怎麼存（改圖前一定要懂）

每張畫用 `id` 辨認，學生的進度分兩處存：

- **顏色**：IndexedDB `vocab-watercolor`，key `paint:<id>`，存的是像素。
- **解鎖了哪些塊、塗完沒**：localStorage `vocab-watercolor-v1` 的 `unlocked[<id>]`、`done[<id>]`，存的是**區塊編號**。

區塊編號是引擎把線稿由上往下掃描排出來的。**線條只要一改，編號就整個變了**，學生付過顏料的塊會對到別的地方。所以：

> **有人塗過的圖，不要用同一個 id 換檔。** 要改線稿就給新 id（例如 `-v2`），舊的在 `ART` 標 `legacy`。

標了 `legacy` 的舊版（`vocab.js` 最後一段處理）：

- 選單只對「這張舊版有進度」的學生顯示，名稱加「（舊版）」。有進度＝有解鎖或完成紀錄，或 IndexedDB 有這張的顏色。讀不到 IndexedDB 時，一律當作有進度。
- 上次停在舊版、但其實沒塗過的學生，開頁時直接換到新版。
- 「全部塗完」只計算非舊版。
- 舊版的 png、id、存檔都不要刪，學生的舊作品靠它們才打得開。

## 換圖／加圖流程

```bash
# 1. 轉檔（四邊各裁 1% 再填滿；不會補白邊）
python -I prep_art.py vw-xxx-v2 art-src/vw-xxx-v2.png

# 2. 檢查：塊數、邊緣白條；--map 輸出區塊上色圖，兩個不該相連的地方同色＝會漏
python -I check_art.py --map out/ art/vw-xxx-v2.png

# 3. 加進 build.py 的 ART（換舊圖時舊的標 legacy），重建
python -I build.py

# 4. 在瀏覽器開頁、切到這張，console 量實際塊數，填回 ART 的 regions
#    __aw.regions.regions.filter(r=>r.area>=300).length
```

`check_art.py` 有警告時結束碼是 1。`vw-fruit` 有上下白條警告，但這些白條沒有讓任何區塊連在一起，所以刻意保留原樣。

需要的工具：Pillow（轉檔、建置）；numpy、scipy（`check_art.py`、`test/pick_points.py`）；Node 和 Playwright（瀏覽器測試）。

## 瀏覽器測試

舊頁和新頁要放在**同一個網址底下**，才會共用同一份存檔：

```bash
# 在 trinkets 上一層
mkdir -p www/old www/new
git -C trinkets show <改版前的 commit>:vocab-watercolor.html > www/old/vocab-watercolor.html
cp trinkets/vocab-watercolor.html www/new/
cd www && python -m http.server 8765

# 另一個終端機
cd trinkets/vocab-watercolor-src/test
python -I pick_points.py points.json    # 挑「相鄰、被線隔開」的兩塊當測試點
node leak.js new                        # 點一塊上色，隔壁那塊必須沒顏色
node leak.js old                        # 對照組：舊圖同樣位置
node compat.js                          # 舊存檔、選單顯示、備份還原
```

2026-10-17 改版（issue #1、PR #2）在雲端 Chromium 141 的結果：

- `leak.js new`：55 組，0 組漏色，1 組跳過。跳過的那組是引擎把點擊吸附到旁邊的小區塊，兩塊都沒被染到。
- `leak.js old`：7 組漏色。
- `compat.js`：23 項全部通過。

`leak.js` 的 `skipped` 不一定是錯誤：點擊被吸附、或那塊已被先前的漏色染到，都會算成跳過。

## 還沒驗證的地方

- **iPad／iPhone Safari 實機**：以上都是桌面 Chromium、滑鼠事件，觸控和 Safari 的儲存行為沒有測過。
- 從第一版重裁的四張（書桌窗景、花瓶靜物、山間小鎮、荷花池），只修了白邊造成的漏色，圖片內部沒有逐塊人工點過。
- 已經把舊版塗完的學生，不會收到「有新版」的提示。
