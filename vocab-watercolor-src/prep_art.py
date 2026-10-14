"""把 Gemini 生的著色線稿整理成水彩引擎吃的格式（一次性；換圖或加圖時再跑）。

輸出 art/<id>.png：剛好 1000×1250、白底、灰階、16 階。
- 尺寸剛好等於引擎的畫紙，引擎畫上去是 1:1、不重新取樣，所以每台電腦切出來的區塊編號都一樣
  （解鎖紀錄存的是區塊編號，編號一變，學生塗過的地方就對不上）。
- 保留灰階（不是純黑白）是為了線稿顯示時邊緣平滑；引擎自己用亮度 <140 判斷是不是線。

用法：python -I prep_art.py <id> <原始圖檔> [<id> <原始圖檔> …]   （需要 Pillow）
例：  python -I prep_art.py vw-fruit 水果籃.jfif
新圖的 id 也要加進 build.py 的 ART 清單（並在瀏覽器量實際塊數）。

目前 art/ 裡的 7 張（2026-10-14，Gemini 生成）：
  vw-tools 畫具桌、vw-desk 書桌窗景、vw-vase 花瓶靜物、vw-fruit 水果籃、vw-starry 星夜、
  vw-village 山間小鎮、vw-lotus 荷花池
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1000, 1250

def prep(src, dst):
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGBA", im.size, "white")
        bg.alpha_composite(im.convert("RGBA"))
        im = bg
    g = im.convert("L")
    s = min(W / g.width, H / g.height)
    w, h = round(g.width * s), round(g.height * s)
    g = g.resize((w, h), Image.LANCZOS)
    out = Image.new("L", (W, H), 255)
    out.paste(g, ((W - w) // 2, (H - h) // 2))
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
        print(f"{id_}: {prep(src, dst) // 1024} KB")
