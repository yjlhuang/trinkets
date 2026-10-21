# trinkets

高中英文老師做的教學小工具合集。多數是單一 HTML 檔，直接用瀏覽器開就能用，不需要安裝或建置。

線上版：<https://trinkets-sigma.vercel.app>（網址 ＋ 檔名，例如 `/hoops.html`）。push 到 `main` 會自動部署到 Vercel。

## 給學生用的

| 檔案 | 說明 |
|---|---|
| `hoops.html` | 文法投籃機：3D 投籃遊戲，投進對的動詞才得分 |
| `hoops-practice.html` | 文法刷題：同一份題庫，不計時、不用玩遊戲，答完看解說 |
| `one-drop.html` | 一滴水・單字：單字答題 |
| `ipas-one-drop.html` | 一滴水・iPAS AI：iPAS 題目版 |
| `vocab-watercolor.html` | 單字水彩：答題後上色（原始碼在 `vocab-watercolor-src/`） |
| `the-road-not-taken.html` | The Road Not Taken 互動動畫繪本 |
| `wordday.html` | 字日 Wordday：每天一點單字 |

## 老師用的工具

| 檔案 | 說明 |
|---|---|
| `ExamShuffler-v1.html` | 選擇題洗牌加工廠 |
| `word-quiz-generator.html` | 單字小考產生器 |
| `seat_planner.html` | 座位表編排器 |
| `grade_ranker.html` | 成績排序表 |
| `prompt_test.html` | 貼紙盲測發牌機 |
| `certificate.html` | 自主學習成果完成證書 |
| `editor.html` | 復盤編輯器 |
| `mosaic-tool.html` | 馬賽克工具 |

## 其他小玩意

`daily-tarot.html`（每日一牌）、`dance-notes.html`、`monet-pond.html`、`watercolor.html`、`zen-aquarium-3d.html`、`sniper-eye.html`、`terminal-quest.html`、`waverunner.html`；
另有 `desk-clock/`（Windows 桌面指針時鐘）、`gym-sniper/`（Python）、`tools/`（維護用腳本）。

## 改題庫

文法投籃機與刷題頁共用 `hoops-questions.js`，改題目只要改這一個檔。

## 授權

[PolyForm Noncommercial License 1.0.0](LICENSE)：個人、學習、教學、研究等非商業用途可自由使用與修改；商業用途請先聯絡作者取得授權。
