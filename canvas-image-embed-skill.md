# Canvas 圖片鑲嵌文字協作 Skill

## 適用場景

需要在**固定背景圖**上疊加動態文字，並讓使用者自助輸入、下載的專案。
例如：證書、獎狀、邀請函、活動通知、個人化卡片。

---

## 核心技術原理

| 技術 | 用途 |
|------|------|
| HTML Canvas | 將背景圖 + 文字合成為一張圖片 |
| base64 內嵌 | 把背景圖編碼進 HTML，不依賴外部伺服器 |
| `toDataURL()` | 把 canvas 內容轉成圖片 URL，顯示或下載 |
| 純靜態 HTML | 可放 GitHub Pages，無需後端 |

### 為什麼用 base64 內嵌？

- 沙盒（Claude artifact、iframe）封鎖外部 URL 載圖，base64 完全繞過
- 單一 `.html` 檔案獨立運作，不需要額外圖片檔
- 缺點：檔案較大（約原圖 1.33 倍），但靜態部署完全沒問題

---

## 標準工作流程

### 步驟 1 — 備圖

請 GPT / DALL-E / Midjourney 生成背景圖，規格：
- 尺寸：**1536 × 1024 px**（橫式）或依需求調整
- **不含任何文字**，所有文字由程式疊加
- 輸出 PNG，背景不透明

### 步驟 2 — 傳圖給 Claude

把背景圖傳給 Claude，說明需要的文字內容與大致配置。
Claude 會產出兩個檔案：

- `certificate.html`：正式使用版，含輸入框、生成、右鍵另存
- `layout-editor.html`：版面調整工具，有背景圖的拖拉介面

### 步驟 3 — 調整版面

在瀏覽器開啟 `layout-editor.html`：
1. 拖動黃色虛線標籤到正確位置
2. 底部即時顯示 canvas 座標（Y / X）
3. 按「複製所有座標」

### 步驟 4 — 回報座標給 Claude

直接貼座標表格，格式如下：

```
標題: y=156, x=770
This cert…: y=263, x=770
姓名: y=390, x=768
has completed: y=468, x=768
The Final…: y=548, x=768
特頒此狀: y=632, x=768
Date: y=755, x=568
Instructor: y=755, x=968
```

### 步驟 5 — Claude 更新 certificate.html

Claude 依座標更新，你下載後覆蓋 GitHub repo 的檔案。

---

## 每學期更換只需改三行

```javascript
const SEMESTER = "114下學期";
const DATE_STR = "Date: 2026/06/10";
const INSTRUCTOR = "Instructor: 黃彥蓉老師";
```

背景圖不需要重換（除非想改風格）。
若要換背景圖，重新傳圖給 Claude，從步驟 2 開始。

---

## 沙盒環境注意事項

| 環境 | 能否載入外部圖片 | 解法 |
|------|-----------------|------|
| Claude artifact / publish | ❌ CSP 封鎖 | base64 內嵌 |
| GitHub Pages | ✅ 可以 | base64 或同目錄圖片皆可 |
| 本機直接開 HTML | ✅ 可以 | 同上 |

**沙盒下載限制：**
- `<a download>` 按鈕在 iframe 沙盒無效
- `window.open()` 會被 popup blocker 擋
- 解法：把合成圖片用 `<img src="...">` 直接顯示，讓使用者右鍵另存

---

## Claude 端操作備忘

背景圖轉 base64（bash）：
```bash
python3 -c "
import base64
with open('bg.png','rb') as f:
    print(base64.b64encode(f.read()).decode())
" > bg_b64.txt
```

壓縮版本（用於 artifact，限 ~100KB）：
```python
from PIL import Image
import base64, io
img = Image.open('bg.png').resize((768, 512), Image.LANCZOS)
buf = io.BytesIO()
img.save(buf, format='JPEG', quality=78)
b64 = base64.b64encode(buf.getvalue()).decode()
```

原始全尺寸（用於 HTML 下載檔，無大小限制）：直接用 `cert_b64.txt`。

---

## 給 GPT 的背景圖 Prompt 範本

```
請製作一張橫式證書背景圖（1536 x 1024 px）：
- 整體風格：[華麗/簡約/現代/傳統]
- 裝飾元素：[金框/緞帶/花紋/...]
- 中央留白：供文字疊加，背景色深（文字用白/金色）
- 不要放任何文字
- 輸出 PNG，背景不透明
```
