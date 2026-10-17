"""把 Gemini 生的著色線稿整理成水彩引擎吃的格式（一次性；換圖或加圖時再跑）。

輸出 art/<id>.png：剛好 1000×1250、白底、灰階、16 階。
- 尺寸剛好等於引擎的畫紙，引擎畫上去是 1:1、不重新取樣，所以每台電腦切出來的區塊編號都一樣
  （解鎖紀錄存的是區塊編號，編號一變，學生塗過的地方就對不上）。
- 保留灰階（不是純黑白）是為了線稿顯示時邊緣平滑；引擎自己用亮度 <140 判斷是不是線。
- 四邊各先裁掉 1%，再「放大填滿」畫紙（多出來的置中裁掉），不留白邊。
  以前是「縮進去、補白邊」：原圖比例不是剛好 4:5 時，上下會多出 4～5px 的白條，
  所有碰到上緣／下緣的區塊經由白條連成一塊，顏色就漏過去（2026-10 的 issue #1）。
  裁 1% 也順便吃掉「線差幾 px 沒碰到邊」的情況。

用法：python -I prep_art.py <id> <原始圖檔> [<id> <原始圖檔> …]   （需要 Pillow）
例：  python -I prep_art.py vw-tools-v2 art-src/vw-tools-v2.jpg
新圖的 id 也要加進 build.py 的 ART 清單；做完用 check_art.py 檢查區塊，並在瀏覽器量實際塊數。
已經有學生塗過的圖不要用同一個 id 覆蓋（區塊編號會整個變掉），要給新 id、舊的在 build.py 標 legacy。
完整流程見 README.md。

目前 art/ 裡的圖：
  2026-10-14 第一版（Gemini 生成，舊的縮進去補白邊做法）：
    vw-tools 畫具桌、vw-desk 書桌窗景、vw-vase 花瓶靜物、vw-fruit 水果籃、vw-starry 星夜、
    vw-village 山間小鎮、vw-lotus 荷花池
  2026-10-17 v2（裁 1% 填滿）：
    vw-tools-v2、vw-starry-v2 ← art-src/ 裡老師修過線的原圖
    vw-desk-v2、vw-vase-v2、vw-village-v2、vw-lotus-v2 ← 直接拿第一版的 art/<id>.png 重裁（沒有原圖）
  vw-fruit 沒有白邊問題，不重做。
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1000, 1250
TRIM = 0.01   # 四邊各裁掉的比例


def prep(src, dst):
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGBA", im.size, "white")
        bg.alpha_composite(im.convert("RGBA"))
        im = bg
    g = im.convert("L")
    dx, dy = round(g.width * TRIM), round(g.height * TRIM)
    g = g.crop((dx, dy, g.width - dx, g.height - dy))
    s = max(W / g.width, H / g.height)
    w, h = max(W, round(g.width * s)), max(H, round(g.height * s))
    g = g.resize((w, h), Image.LANCZOS)
    x, y = (w - W) // 2, (h - H) // 2
    out = g.crop((x, y, x + W, y + H))
    # 16 階灰：檔案小很多，邊緣仍然平滑；接近白的雜點直接變白
    out = out.point(lambda v: 255 if v > 235 else (v // 16) * 17)
    out.save(dst, optimize=True)
    return os.path.getsize(dst)


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if not args or len(args) % 2:
        sys.exit(__doc__)
    for id_, src in zip(args[::2], args[1::2]):
        dst = os.path.join(HERE, "art", id_ + ".png")
        if os.path.abspath(src) == os.path.abspath(dst):
            sys.exit(f"{id_}: 輸出會蓋掉輸入檔，請換一個新 id")
        print(f"{id_}: {prep(src, dst) // 1024} KB")
