"""產生 ../vocab-watercolor.html（單字水彩）。

watercolor.html 是打包壓縮過的單行程式，沒有原始碼，所以不手改它：
這支腳本讀它、做幾處「錨點替換」、接上答題面板，寫出新頁。原檔不動。
每個錨點都必須剛好出現一次，對不上就停下來（watercolor.html 換版後要回來調錨點）。

用法：python -I build.py
改了 panel.html / vocab.css / vocab.js / 圖，或改了 one-drop.html 的單字，都重跑一次。
只讀 trinkets 裡的檔案（watercolor.html、one-drop.html、這個資料夾），換電腦也能重建。
"""
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "watercolor.html")
OUT = os.path.join(ROOT, "vocab-watercolor.html")

PAGE_VERSION = "2026-10-14"

# 單字清單只有一份：one-drop.html 的 UNITS（修過錯字的版本），這裡原封不動複製過去
ONE_DROP = os.path.join(ROOT, "one-drop.html")

# 「換畫作」選單，由簡到難。regions = 水彩引擎實際切出來的區塊數（在瀏覽器量的：__aw.regions.regions.length）
ART = [
    {"id": "vw-tools",  "name": "畫具桌",   "level": "入門", "regions": 44},
    {"id": "vw-desk",   "name": "書桌窗景", "level": "",     "regions": 84},
    {"id": "vw-vase",   "name": "花瓶靜物", "level": "",     "regions": 93},
    {"id": "vw-fruit",  "name": "水果籃",   "level": "",     "regions": 91},
    {"id": "vw-starry", "name": "星夜",     "level": "進階", "regions": 175},
]


def read(p):
    with open(p, encoding="utf-8", newline="") as f:
        return f.read()


def once(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"錨點「{what}」出現 {n} 次（應該剛好 1 次），watercolor.html 可能換版了")
    return text.replace(old, new)


def units_js():
    t = read(ONE_DROP).replace("\r\n", "\n")
    a = t.index("const UNITS = [\n") + len("const UNITS = ")
    b = t.index("\n];\n", a) + len("\n]")
    block = t[a:b]
    units = json.loads(block)          # 確認是合法 JSON；壞掉就在這裡停
    print(f"單字：{len(units)} 回、{sum(len(u['words']) for u in units)} 字（來自 one-drop.html）")
    return block


def art_js():
    items = []
    for a in ART:
        png = open(os.path.join(HERE, "art", a["id"] + ".png"), "rb").read()
        uri = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        sub = " · ".join(x for x in [a["level"], f"約 {a['regions']} 塊" if a["regions"] else ""] if x)
        items.append({"id": a["id"], "name": a["name"], "latin": sub, "src": uri})
    return "window.__VW_ART=" + json.dumps(items, ensure_ascii=False, separators=(",", ":")) + ";"


def main():
    t = read(SRC)
    if "\r\n" in t:
        sys.exit("watercolor.html 是 CRLF，這支腳本預期 LF")

    # ---- head ----
    t = once(t, "<title>秋牡丹・水彩塗色</title>", "<title>單字水彩</title>", "title")
    t = once(t, "</style>", read(os.path.join(HERE, "vocab.css")) + "</style>", "</style>")

    # ---- 右側面板換成「答題／調色」兩個分頁（調色分頁就是原本的工具列，id 都不變） ----
    a = t.index('  <aside class="tray" aria-label="顏料與工具">')
    b = t.index("  </aside>\n", a) + len("  </aside>\n")
    t = t[:a] + read(os.path.join(HERE, "panel.html")) + t[b:]
    t = once(t, '<button type="button" id="fit" hidden>看整張</button>',
             '<button type="button" id="fit" hidden>看整張</button>\n'
             '    <nav class="vw-games" aria-label="換玩法"><a href="one-drop.html">一滴水</a>'
             '<a href="vocab-watercolor.html" aria-current="page">水彩</a></nav>\n'
             '    <div class="vw-stale" id="vw-stale" role="alert" hidden>另一個分頁也開著這頁，這個分頁先暫停存檔。'
             '<button type="button" onclick="location.reload()">重新載入</button></div>', "#fit")

    # ---- 引擎：拿掉原本內嵌的三張花、換成我們的圖 ----
    for var in ("bp", "np", "ip"):
        t, n = re.subn(var + r'="data:image/[a-z]+;base64,[A-Za-z0-9+/=]+"', var + '=""', t)
        if n != 1:
            sys.exit(f"錨點「{var} 圖片」出現 {n} 次")
    t = once(t,
             'Dt=[{id:"anemone",name:"\\u79CB\\u7261\\u4E39",latin:"Anemone hupehensis"},'
             '{id:"roses",name:"\\u73AB\\u7470\\u8207\\u6BDB\\u831B",latin:"Roses, ranunculus & cosmos",src:bp},'
             '{id:"lisianthus",name:"\\u6D0B\\u6854\\u6897\\u8207\\u7E61\\u7403",latin:"Lisianthus & hydrangea",src:np},'
             '{id:"urn",name:"\\u7E61\\u7403\\u9676\\u74F6",latin:"Hydrangea in an urn",src:ip}]',
             "Dt=window.__VW_ART", "畫作清單 Dt")
    t = once(t, 'drawing:"anemone"', 'drawing:"' + ART[0]["id"] + '"', "預設畫作")
    # 線稿預設「顯示」：手機上畫紙小，淡化的線看不清區塊邊界
    t = once(t, 'line:"faint"', 'line:"show"', "線稿預設")

    # ---- 存檔名稱：不要跟原本的 watercolor.html 共用（github.io 同一個網域） ----
    t = once(t, 'Lr="aw-anemone"', 'Lr="vocab-watercolor"', "IndexedDB 名稱")
    t = once(t, 'kp="aw.anemone.ui"', 'kp="vocab-watercolor.ui"', "設定 key")

    # ---- 閘門：用「上色」點到區塊時先問答題層（沒顏料、又沒塗過就不上色） ----
    t = once(t, "if(!a||!Wt)return;let K=Wt.regions[a-1];",
             'if(!a||!Wt)return;if(H.tool==="paint"&&window.__vwGate&&!window.__vwGate(_.id,a))return;let K=Wt.regions[a-1];',
             "jp 點擊入口")
    # ---- 換畫作完成時通知答題層（更新「這張塗過幾塊」） ----
    t = once(t, "finally{vt=!1,xl=!0,yp.hidden=!0,yt(),he(),ll()}",
             "finally{vt=!1,xl=!0,yp.hidden=!0,yt(),he(),ll(),window.__vwOnDrawing&&window.__vwOnDrawing(_.id,Wt)}",
             "Nt 載入完成")

    # ---- 換畫作選單：拿掉「匯入線稿」，畫名下面標難度與塊數 ----
    t = once(t, '\n      <button type="button" class="pick add" id="do-import"><span class="plus">\\uFF0B</span>'
                '<span>\\u532F\\u5165\\u7DDA\\u7A3F\\u5716</span></button>', "", "匯入按鈕")
    t = once(t, '\n    <p class="small">\\u532F\\u5165\\u7684\\u5716\\u6700\\u597D\\u662F\\u767D\\u5E95\\u9ED1\\u7DDA'
                '\\u3001\\u7DDA\\u689D\\u5C01\\u9589\\u7684\\u8457\\u8272\\u7DDA\\u7A3F\\u3002</p>', "", "匯入說明")
    t = once(t, 'F("#do-import").addEventListener(', 'F("#do-import")?.addEventListener(', "匯入按鈕事件")
    t = once(t, "<span>${t.name}</span></button>",
             '<span>${t.name}${t.latin?"<br><small>"+t.latin+"</small>":""}</span></button>', "選單畫名")

    # ---- 答題層（放在引擎前面：引擎一啟動就會呼叫 __vwOnDrawing） ----
    vocab = read(os.path.join(HERE, "vocab.js"))
    vocab = once(vocab, "__PAGE_VERSION__", PAGE_VERSION, "PAGE_VERSION")
    vocab = once(vocab, "const UNITS = __UNITS__;", "const UNITS = " + units_js() + ";", "UNITS")
    t = once(t, "<script>/*! Watercolor engine",
             "<script>\n" + art_js() + "\n</script>\n<script>\n" + vocab + "</script>\n<script>/*! Watercolor engine",
             "引擎 script 開頭")

    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(t)
    print(f"寫出 {os.path.relpath(OUT, ROOT)}：{len(t.encode('utf-8')) // 1024} KB")


if __name__ == "__main__":
    main()
