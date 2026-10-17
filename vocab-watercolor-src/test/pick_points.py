"""挑漏色測試點：每張圖沿著四邊，找「相鄰、被線隔開」的兩塊大區塊，一塊點下去上色、另一塊必須保持乾淨。
舊版的白邊漏色就發生在這種地方。輸出 points.json 給 leak.js 用。

用法：python -I pick_points.py points.json   （需要 numpy、scipy、Pillow）
"""
import os, sys, json, numpy as np
from PIL import Image
from scipy import ndimage as nd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from check_art import segment
ids = ['vw-tools-v2','vw-desk-v2','vw-vase-v2','vw-village-v2','vw-starry-v2','vw-lotus-v2']
out = {}
for id_ in ids:
    g = np.asarray(Image.open(os.path.join(HERE, '..', 'art', id_ + '.png')).convert('L'), dtype=np.int16)
    Z, area = segment(g)
    H, W = Z.shape
    pts = {}
    for lab in range(1, len(area)):
        if area[lab] < 3000: continue
        m = Z == lab
        d = nd.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
        # best interior point within 80px of each edge it touches
        for edge, sl in (('top', (slice(0, 80), slice(None))), ('bottom', (slice(H-80, H), slice(None))),
                         ('left', (slice(None), slice(0, 80))), ('right', (slice(None), slice(W-80, W)))):
            sub = d[sl]
            if sub.max() < 8: continue
            y, x = np.unravel_index(np.argmax(sub), sub.shape)
            y += sl[0].start or 0; x += sl[1].start or 0
            pts.setdefault(edge, []).append((int(x), int(y), int(lab), float(sub.max())))
    pairs, used_tap, used_q = [], set(), set()
    for edge, lst in pts.items():
        key = (lambda p: p[0]) if edge in ('top', 'bottom') else (lambda p: p[1])
        lst.sort(key=key)
        for a, b in zip(lst, lst[1:]):          # neighbours along the edge, different regions
            if a[2] == b[2] or a[2] in used_q or b[2] in used_tap or a[2] in used_tap or b[2] in used_q: continue
            pairs.append({'edge': edge, 'tap': a[:2], 'clean': b[:2], 'tapRegion': a[2], 'cleanRegion': b[2]})
            used_tap.add(a[2]); used_q.add(b[2])
    out[id_] = pairs[:10]
    print(id_, len(pairs), 'pairs, using', len(out[id_]))
json.dump(out, open(sys.argv[1], 'w'), indent=1)
