"""把一滴水（one-drop.html）的藍鵝本單字跟班網同步。

藍鵝本的正本在班網 longjin2026 的 data/wordsblue.xlsx，由那邊的 tools/build_blue.py 產生
data/blue/blue_unit{N}.json 並部署到 https://longjin2026.vercel.app/data/blue/ 。
這支腳本照班網 data/blue/units.json 列的回數，把 one-drop.html 的 UNITS 換成班網的最新內容；
one-drop 裡還沒有的回數會自動補上（2026-10-30 起全本 24 回）。已經有的回數，字的編號必須一樣。

用法：python -I tools/sync_blue.py                 # dry-run：列出會改的字
      python -I tools/sync_blue.py --write         # 寫回 one-drop.html
      python -I tools/sync_blue.py --from <資料夾>  # 改讀本機的 data/blue（班網還沒上線時）
寫回之後：升 one-drop.html 的 PAGE_VERSION，再到 vocab-watercolor-src/ 跑 build.py（單字水彩讀的是同一份）。
"""
import argparse
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ONE_DROP = os.path.join(os.path.dirname(HERE), "one-drop.html")
BASE = "https://longjin2026.vercel.app/data/blue/"
START, END = "const UNITS = [", "];"   # 中間一回一行；換行照檔案原本的（Windows 工作目錄是 CRLF）


def fetch(name, src):
    if src:
        with open(os.path.join(src, name), encoding="utf-8") as f:
            return json.load(f)
    with urllib.request.urlopen(BASE + name + "?nocache", timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def line(u):
    return json.dumps(u, ensure_ascii=False, separators=(",", ":"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--from", dest="src", help="本機的 data/blue 資料夾（不指定就讀班網）")
    args = ap.parse_args()

    with open(ONE_DROP, encoding="utf-8", newline="") as f:
        t = f.read()
    nl = "\r\n" if "\r\n" in t else "\n"
    a = t.index(START + nl) + len(START + nl)
    b = t.index(nl + END + nl, a)
    old = [json.loads(l.rstrip(",")) for l in t[a:b].split(nl)]
    assert ("," + nl).join(line(u) for u in old) == t[a:b], "UNITS 的寫法跟預期不同（一回一行、緊湊 JSON），先看一下再改這支"

    have = {u["unit"]: u for u in old}
    new, changed, added = [], 0, []
    for m in sorted(fetch("units.json", args.src)["units"], key=lambda m: m["unit"]):
        src = fetch(f"blue_unit{m['unit']}.json", args.src)
        assert src["unit"] == m["unit"], f"blue_unit{m['unit']}.json 裡寫的回數不對"
        nu = {"unit": src["unit"], "unit_label": src["unit_label"],
              "words": [{k: w[k] for k in ("id", "word", "pos", "meaning", "example", "example_zh")} for w in src["words"]]}
        u = have.pop(m["unit"], None)
        if u is None:
            added.append(m["unit"])
            new.append(nu)
            continue
        assert src["unit_label"] == u["unit_label"], f"第 {u['unit']} 回的頁碼對不上"
        ow = {w["id"]: w for w in u["words"]}
        assert [w["id"] for w in nu["words"]] == [w["id"] for w in u["words"]], f"第 {u['unit']} 回的字（編號）不一樣"
        for w in nu["words"]:
            if ow[w["id"]] != w:
                changed += 1
                if all(ow[w["id"]].get(k) == w[k] for k in ("pos", "meaning")):
                    continue  # 只有例句不同，不逐筆列出
                print(f"  第{u['unit']}回 {w['id']} {w['word']}：{ow[w['id']]['pos']}｜{ow[w['id']]['meaning']}  →  {w['pos']}｜{w['meaning']}")
        new.append(nu)
    assert not have, f"one-drop 有、班網 units.json 沒有的回數：{sorted(have)}（先確認再處理）"
    print(f"{len(new)} 回（{new[0]['unit']}–{new[-1]['unit']}），{changed} 個字有變動" + (f"，新增第 {added} 回" if added else ""))
    if args.write and (changed or added):
        t = t[:a] + ("," + nl).join(line(u) for u in new) + t[b:]
        with open(ONE_DROP, "w", encoding="utf-8", newline="") as f:
            f.write(t)
        print("已寫回 one-drop.html：記得升 PAGE_VERSION、重建單字水彩")
    elif not args.write:
        print("（dry-run，沒有寫入。確認後加 --write）")


if __name__ == "__main__":
    main()
