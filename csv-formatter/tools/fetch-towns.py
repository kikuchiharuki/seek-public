# ゆうパック日数データ作成 ステップ1: 全国の市区町村→町域→郵便番号をHeartRails Geo APIで集める
# 出力: towns.json [[都道府県, 市区町村, 郵便番号7桁], ...]（途中再開可）
import json, sys, time, urllib.request, urllib.parse, os
PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split()
API = "https://geoapi.heartrails.com/api/json?"
out = sys.argv[1] if len(sys.argv) > 1 else "towns.json"
def get(params):
    for i in range(5):
        try:
            with urllib.request.urlopen(API + urllib.parse.urlencode(params), timeout=20) as r:
                return json.load(r)["response"].get("location", [])
        except Exception as e:
            print("retry", params, e, file=sys.stderr); time.sleep(3 * (i + 1))
    raise SystemExit("failed: %s" % params)
done = json.load(open(out)) if os.path.exists(out) else {}
for p in PREFS:
    for c in get({"method": "getCities", "prefecture": p}):
        key = p + "|" + c["city"]
        if key in done: continue
        done[key] = sorted({t["postal"] for t in get({"method": "getTowns", "prefecture": p, "city": c["city"]})})
        time.sleep(0.15)
    json.dump(done, open(out, "w"), ensure_ascii=False)
    print(p, len(done), file=sys.stderr)
