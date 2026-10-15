# ゆうパック日数データ作成 ステップ2: 福山通運データ(LEADTIME)と同じ市区町村ごとに、日本郵便「お届け日数を調べる」で日数を引き、
# index.html の YUPACK_LEADTIME 行を差し替える
# 使い方: /usr/bin/python3 fetch-yupack-days.py towns.json days.json csv-formatter/index.html lead-time.html
#   書き込み先htmlは複数指定可（1つ目から福山通運データ LEADTIME を読む）。差出元を変えるときは環境変数 ORIGIN
#   towns.json = fetch-towns.py の出力 {"都道府県|市区町村": [郵便番号...]}
#   days.json  = 問い合わせ結果のキャッシュ {郵便番号: [午前差出, 午後差出]}（途中再開可・再生成時は消してから）
#   市区町村の代表 = その市区町村で一番小さい郵便番号。「〇〇郡」は配下の町村すべてを引いて一番遅い値（安全側）
#   値は午後差出。LTコードは福山通運と同じ書式（"1AM"=翌日午前、"2"=翌々日、"3PM"=3日後午後）
import json, re, sys, time, os, datetime, urllib.request, urllib.parse, html
towns, cache, html_paths = sys.argv[1], sys.argv[2], sys.argv[3:]
ORIGIN = os.environ.get("ORIGIN", "4260013")  # 静岡工場（藤枝市立花）→ 藤枝郵便局
URL = "https://www.post.japanpost.jp/send/deli_days/index.html?zip1=%s&zip2=%s"
Z2H = str.maketrans("０１２３４５６７８９", "0123456789")

def code(txt):
    t = re.sub(r"[\s※]|以降", "", txt.translate(Z2H))  # 「翌日午後 ※」の注記（午後2時以降の時間帯指定可）・「7日後以降」の以降は外す
    if re.match(r"^\d+(AM|PM)?$", t): return t  # 変換済み
    m = re.match(r"^(翌日|翌々日|(\d+)日後)(午前|午後|夕方|夜間)?$", t)
    if not m: return None
    d = 1 if m.group(1) == "翌日" else 2 if m.group(1) == "翌々日" else int(m.group(2))
    return str(d) + {"午前": "AM", "午後": "PM", "夕方": "PM", "夜間": "PM"}.get(m.group(3), "")  # 夕方・夜間も「その日の午後以降」としてPM

def rank(c):  # 遅いほど大きい: 日数 → 午前 < 午後 < 時間帯なし
    m = re.match(r"^(\d+)(AM|PM)?$", c)
    return int(m.group(1)) * 3 + {"AM": 0, "PM": 1, None: 2}[m.group(2)]

def query(z):
    for i in range(4):
        try:
            req = urllib.request.Request(URL % (ORIGIN, z), headers={"User-Agent": "Mozilla/5.0"})
            s = urllib.request.urlopen(req, timeout=30).read().decode()
            i0 = s.find('youpack.php">ゆうパック<')
            if i0 < 0: return None
            vals = re.findall(r'<div class="data">\s*(.*?)\s*</div>', s[i0:i0 + 3000], re.S)[:2]
            return [code(html.unescape(v)) or html.unescape(v) for v in vals]
        except Exception as e:
            print("retry", z, e, file=sys.stderr); time.sleep(5 * (i + 1))
    return None

src = open(html_paths[0], encoding="utf-8").read()
L = json.loads(re.search(r"^const LEADTIME=(\{.*?\});$", src, re.M).group(1))
T = json.load(open(towns))
cities = {}  # 都道府県 → {市区町村: 代表郵便番号}
for k, v in T.items():
    p, c = k.split("|", 1)
    if v: cities.setdefault(p, {})[c] = min(v)

_towns = {}
def towns_of(pref, city):  # 町域名つきで取り直す（市区町村の一部地域だけの行用）
    if (pref, city) not in _towns:
        u = "https://geoapi.heartrails.com/api/json?" + urllib.parse.urlencode({"method": "getTowns", "prefecture": pref, "city": city})
        _towns[pref, city] = json.load(urllib.request.urlopen(u, timeout=30))["response"].get("location", [])
        time.sleep(0.15)
    return _towns[pref, city]

def reps_for(pref, name):
    """福山データの市区町村名 → 代表郵便番号のリスト（findLeadTime と同じく「、」区切りは先頭の市名を引き継ぐ）
    福山データは郡名を省くことがある（上砂川町＝空知郡上砂川町）、市の一部地域の行もある（石狩市厚田区、十勝郡厚内）"""
    N = lambda x: x.replace("ヶ", "ケ").replace("竃", "竈")  # 表記ゆれ（龍ヶ崎/龍ケ崎、塩竃/塩竈）
    C = {N(c): z for c, z in cities.get(pref, {}).items()}
    name = N(name)
    parts = name.split("、")
    m = re.match(r"^(.*?[市郡])", parts[0]); head = m.group(1) if m else ""
    out = []
    for i, nm in enumerate(parts):
        if i > 0 and head and not any(c.startswith(nm) or c.endswith("郡" + nm) for c in C): nm = head + nm
        hit = [z for c, z in C.items() if c == nm or c.endswith("郡" + nm) or (nm[-1:] in "郡市" and c.startswith(nm))]
        if not hit: hit = [z for c, z in C.items() if c == nm + "市"]  # 陸前高田
        if not hit:  # 市区町村＋地域名: 町域名で絞る
            for c in C:
                g = re.match(r"^(.*?郡)", c)
                base = c if nm.startswith(c) else g.group(1) if g and nm.startswith(g.group(1)) else None
                if not base: continue
                rest = nm[len(base):]
                rest = re.sub(r"区$", "", rest)  # 石狩市厚田区 → 町域「厚田〇〇」
                hit += [t["postal"] for t in towns_of(pref, c) if rest and t["town"].startswith(rest)]
            hit = [min(hit)] if hit else []
        if not hit and not nm.endswith("郡"):  # 合併で消えた旧町村名（牟礼町→高松市牟礼町）→ 町域名の頭で探す
            base = re.sub(r"[町村]$", "", nm)
            hit = [t["postal"] for c in cities.get(pref, {}) for t in towns_of(pref, c) if t["town"].startswith(nm) or (len(base) >= 2 and t["town"].startswith(base))]
            hit = [min(hit)] if hit else []
        if not hit and head.endswith("市"):  # 区の再編で消えた旧区名（浜松市中区など）→ その市の今の区すべて
            hit = [z for c, z in C.items() if c.startswith(head)]
        out += hit
    return sorted(set(out))

targets = []  # [都道府県index, 市区町村名, [代表郵便番号...]]（例外地区の行は福山側の検索でも使われないので除く）
for r in L["d"]:
    if len(r) > 3 and r[3]: continue
    targets.append([r[0], r[1], reps_for(L["p"][r[0]], r[1])])
miss = [t[:2] for t in targets if not t[2]]
print("市区町村", len(targets), "郵便番号の見つからない市区町村", len(miss), miss[:30], file=sys.stderr)

D = json.load(open(cache)) if os.path.exists(cache) else {}
todo = sorted({z for t in targets for z in t[2]} - set(D))
print("問い合わせ", len(todo), "件", file=sys.stderr)
for n, z in enumerate(todo, 1):
    D[z] = query(z); time.sleep(0.5)
    if n % 50 == 0 or n == len(todo):
        json.dump(D, open(cache, "w"), ensure_ascii=False); print(n, "/", len(todo), z, D[z], file=sys.stderr)

rows = []
for pi, name, zs in targets:
    cs = [c for c in (code(D[z][1] or "") for z in zs if D.get(z) and len(D[z]) > 1) if c]
    if cs: rows.append([pi, name, max(cs, key=rank)])
    else: print("日数なし", L["p"][pi], name, [D.get(z) for z in zs], file=sys.stderr)
data = {"o": ORIGIN, "at": datetime.date.today().isoformat(), "d": rows}
line = "const YUPACK_LEADTIME=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
for hp in html_paths:
    s2, n = re.subn(r"^const YUPACK_LEADTIME=.*;$", lambda m: line, open(hp, encoding="utf-8").read(), flags=re.M)
    assert n == 1, "YUPACK_LEADTIME 行が見つからない: " + hp
    open(hp, "w", encoding="utf-8").write(s2)
print("書き込み", len(rows), "件", file=sys.stderr)
