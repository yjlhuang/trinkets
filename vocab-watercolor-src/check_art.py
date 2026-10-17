"""檢查線稿會被引擎切成哪些區塊（換圖、加圖後跑；需要 numpy、scipy、Pillow）。

照 watercolor.html 引擎（函式 Up）的切法在電腦上重做一次：亮度 <140 是線、線往外加粗 1px、
剩下的白色依上下左右相連分成區塊。數字跟瀏覽器量的可能差幾塊（瀏覽器畫圖時的取樣不同），
build.py 的 regions 仍以瀏覽器量的為準：__aw.regions.regions.filter(r=>r.area>=300).length

用法：python -I check_art.py [--map 輸出資料夾] art/vw-tools-v2.png [更多 png…]
  --map：每張輸出一張「區塊上色圖」（每塊不同顏色）。兩個不該相連的地方變成同一個顏色＝會漏色。

「邊緣白條」警告：某一邊最外圈有 1～15px 完全沒有線、往內才開始有線，
通常是轉檔時補了白邊（prep_art.py 舊做法），碰到那一邊的區塊會經由白條連成一塊。
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

FOUR = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
TAP_MIN = 300   # 同 vocab.js：小於這個面積的碎塊免費、不算塊數


def segment(gray, r=10, u=3):
    """回傳 (區塊編號圖, 每塊面積)。編號順序同引擎（由上往下、由左往右掃）。"""
    y = gray < 140
    k = nd.binary_dilation(y, structure=np.ones((3, 3), bool))
    V, v = nd.label(~k, structure=FOUR)
    q, J = nd.label(~y, structure=FOUR)
    x = np.bincount(V.ravel(), minlength=v + 1)
    jsz = np.bincount(q.ravel(), minlength=J + 1)
    flatV, flatq = V.ravel(), q.ravel()
    idx = np.flatnonzero(flatV)[::-1]
    first = np.zeros(v + 1, int)
    first[flatV[idx]] = idx
    N = np.zeros(v + 1, int)
    N[1:] = flatq[first[1:]]
    big = np.zeros(J + 1, int)                  # 每個未加粗區塊裡最大的加粗區塊
    for c in range(1, v + 1):
        if not big[N[c]] or x[c] > x[big[N[c]]]:
            big[N[c]] = c
    A = np.zeros(v + 1, int)
    Q = 0
    for c in range(1, v + 1):
        if x[c] >= 120 or (big[N[c]] == c and x[c] >= r):
            Q += 1
            A[c] = Q
    for c in range(1, v + 1):
        if not A[c] and big[N[c]] and A[big[N[c]]]:
            A[c] = A[big[N[c]]]
    rt = np.zeros(J + 1, int)
    for c in range(1, J + 1):
        if (not big[c] or not A[big[c]]) and jsz[c] >= r:
            Q += 1
            rt[c] = Q
    Z = np.where(V > 0, A[V], 0)
    Z = np.where((Z == 0) & ~y, rt[q], Z)

    def grow(Z, allowed, steps=None):
        n = 0
        while steps is None or n < steps:
            m = nd.grey_dilation(Z, footprint=FOUR)
            new = (Z == 0) & allowed & (m > 0)
            if not new.any():
                break
            Z = np.where(new, m, Z)
            n += 1
        return Z
    Z = grow(grow(Z, ~y), y, u)
    return Z, np.bincount(Z.ravel(), minlength=Q + 1)


def edge_gaps(gray):
    """每一邊從最外圈往內，第一次碰到線之前有幾列／行完全沒線。"""
    ink = gray < 140
    rows, cols = np.flatnonzero(ink.any(1)), np.flatnonzero(ink.any(0))
    if not len(rows):
        return {}
    h, w = ink.shape
    return {"上": rows[0], "下": h - 1 - rows[-1], "左": cols[0], "右": w - 1 - cols[-1]}


def region_map(Z, gray, out):
    rng = np.random.default_rng(1)
    pal = rng.integers(60, 255, size=(Z.max() + 1, 3)).astype(np.uint8)
    pal[0] = 0
    rgb = pal[Z]
    rgb[gray < 140] = 0
    Image.fromarray(rgb).save(out)


def main(argv):
    out_dir = None
    if argv[:1] == ["--map"]:
        out_dir, argv = argv[1], argv[2:]
        os.makedirs(out_dir, exist_ok=True)
    if not argv:
        sys.exit(__doc__)
    bad = 0
    for p in argv:
        gray = np.asarray(Image.open(p).convert("L"), dtype=np.int16)
        Z, area = segment(gray)
        n = int((area[1:] >= TAP_MIN).sum())
        top = sorted(area[1:].tolist(), reverse=True)[:3]
        gaps = edge_gaps(gray)
        warn = [f"{k}邊 {v}px" for k, v in gaps.items() if 1 <= v <= 15]
        bad += bool(warn)
        print(f"{os.path.basename(p):20s} {gray.shape[1]}×{gray.shape[0]}  塊數(≥{TAP_MIN})={n:4d}  "
              f"最大三塊={top}" + (f"  ⚠ 邊緣白條：{'、'.join(warn)}" if warn else ""))
        if out_dir:
            region_map(Z, gray, os.path.join(out_dir, os.path.basename(p)[:-4] + "-regions.png"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
