"""產生 ../vocab-watercolor.html（單字水彩）。

watercolor.html 是打包壓縮過的單行程式，沒有原始碼，所以不手改它：
這支腳本讀它、做幾處「錨點替換」、接上答題面板，寫出新頁。原檔不動。
每個錨點都必須剛好出現一次，對不上就停下來（watercolor.html 換版後要回來調錨點）。

用法：python -I build.py
改了 panel.html / vocab.css / vocab.js / 圖，或改了 one-drop.html 的單字，都重跑一次。
換圖、加圖的流程與存檔相容規則見 README.md。
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

PAGE_VERSION = "2026-10-30a"

# 單字從 one-drop.html 的 UNITS 原封不動複製過來。UNITS 本身是從班網同步的：
# 正本 longjin2026/data/wordsblue.xlsx → build_blue.py → 班網 JSON → ../tools/sync_blue.py → one-drop.html → 這裡
ONE_DROP = os.path.join(ROOT, "one-drop.html")

# 「換畫作」選單，由簡到難。regions = 在瀏覽器量的：__aw.regions.regions.filter(r=>r.area>=300).length
# 只算「要花顏料」的區塊（面積 ≥ vocab.js 的 TAP_MIN）；更小的碎塊免費、也不算進完成度
# legacy = 被哪張新版取代的舊版（issue #1：舊版轉檔留了白邊會漏色）。舊版的 id、圖、學生存檔都保留：
#   - 選單只對「這張舊版有進度」的學生顯示（vocab.js 判斷），名稱標「舊版」
#   - 上次停在舊版、但其實沒塗過的學生，打開時直接換到新版
#   - 「全部塗完」只算非舊版
# 已經有人塗過的圖不要直接換檔：區塊編號會整個變掉，解鎖紀錄就對不上。要改線稿就加新 id。
ART = [
    {"id": "vw-tools-v2",   "name": "畫具桌",   "level": "入門", "regions": 52},
    {"id": "vw-tools",      "name": "畫具桌",   "level": "",     "regions": 43,  "legacy": "vw-tools-v2"},
    {"id": "vw-desk-v2",    "name": "書桌窗景", "level": "",     "regions": 85},
    {"id": "vw-desk",       "name": "書桌窗景", "level": "",     "regions": 74,  "legacy": "vw-desk-v2"},
    {"id": "vw-fruit",      "name": "水果籃",   "level": "",     "regions": 84},
    {"id": "vw-vase-v2",    "name": "花瓶靜物", "level": "",     "regions": 94},
    {"id": "vw-vase",       "name": "花瓶靜物", "level": "",     "regions": 88,  "legacy": "vw-vase-v2"},
    {"id": "vw-village-v2", "name": "山間小鎮", "level": "進階", "regions": 157},
    {"id": "vw-village",    "name": "山間小鎮", "level": "進階", "regions": 140, "legacy": "vw-village-v2"},
    {"id": "vw-starry-v2",  "name": "星夜",     "level": "進階", "regions": 199},
    {"id": "vw-starry",     "name": "星夜",     "level": "進階", "regions": 171, "legacy": "vw-starry-v2"},
    {"id": "vw-lotus-v2",   "name": "荷花池",   "level": "挑戰", "regions": 276},
    {"id": "vw-lotus",      "name": "荷花池",   "level": "挑戰", "regions": 253, "legacy": "vw-lotus-v2"},
]


def read(p):
    # 一律轉成 LF：git 在 Windows 上 checkout 可能把檔案變成 CRLF，錨點都是用 LF 寫的
    with open(p, encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def once(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"錨點「{what}」出現 {n} 次（應該剛好 1 次），watercolor.html 可能換版了")
    return text.replace(old, new)


def units_js():
    t = read(ONE_DROP)
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
        legacy = a.get("legacy")
        sub = " · ".join(x for x in ["舊版" if legacy else a["level"], f"約 {a['regions']} 塊" if a["regions"] else ""] if x)
        item = {"id": a["id"], "name": a["name"] + ("（舊版）" if legacy else ""), "latin": sub, "src": uri}
        if legacy:
            ids = [x["id"] for x in ART]
            if legacy not in ids or any(x.get("legacy") for x in ART if x["id"] == legacy):
                sys.exit(f"{a['id']} 的 legacy 要指向清單裡的新版 id")
            item["legacy"] = legacy
        items.append(item)
    return "window.__VW_ART=" + json.dumps(items, ensure_ascii=False, separators=(",", ":")) + ";"


def main():
    t = read(SRC)

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
    # ---- 還原備份時先擋住引擎的自動存檔（不然 reload 前的 pagehide 會把剛還原的畫蓋回去） ----
    t = once(t, "async function At(){if(!vt||ae||!xl)return;",
             "async function At(){if(!vt||ae||!xl||window.__vwHold)return;", "At 存檔入口")
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
    # 選單不列「沒進度的舊版」（vocab.js 的 __vwHideArt）；目前開著的那張一定列
    t = once(t, "let S=await Promise.all(de().map(async t=>{let l=await Or(t)",
             "let S=await Promise.all(de().filter(t=>t.id===_.id||!window.__vwHideArt?.(t.id)).map(async t=>{let l=await Or(t)",
             "ie 選單清單")
    # 開頁時要開哪張：停在沒進度的舊版 → 換成新版（vocab.js 的 __vwStartArt，會查 IndexedDB 所以是 async）
    t = once(t, "await Nt(se(H.drawing)??Dt[0])",
             "await Nt(se(window.__vwStartArt?await window.__vwStartArt(H.drawing):H.drawing)??Dt[0])",
             "開頁畫作")
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
