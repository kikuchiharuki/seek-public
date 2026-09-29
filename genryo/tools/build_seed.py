"""本番の原料マスタ(.xls)と原価計算(.xlsm)から、デモ用 seed-data.js を作る。

元ファイルは読むだけ(コピーして解析)。取込ロジックはアプリ側(index.html)の
CSV/Excel取込と同じ処理を通すため、ここでは「生の表」と処方・見積条件だけを書き出す。

  python3 tools/build_seed.py [原料マスタ.xls] [原価計算.xlsm]
"""
import json, shutil, sys, tempfile, pathlib
import xlrd, openpyxl

SRV = '/Volumes/server'
MASTER = sys.argv[1] if len(sys.argv) > 1 else f'{SRV}/コスメ静岡工場（工場長・事務）/工場事務(森安)/原料マスタ【原価計算用】.xls'
COST = sys.argv[2] if len(sys.argv) > 2 else f'{SRV}/◆データ作成（菊地）/菊地原料マスタ★リンクあり.xlsm'
OUT = pathlib.Path(__file__).resolve().parent.parent / 'seed-data.js'

tmp = pathlib.Path(tempfile.mkdtemp())
m = tmp / 'm.xls'; c = tmp / 'c.xlsm'
shutil.copy(MASTER, m); shutil.copy(COST, c)

sh = xlrd.open_workbook(m).sheet_by_name('Sheet1')
def cell(r, k):
    v = sh.cell(r, k)
    if v.ctype == xlrd.XL_CELL_DATE:  # 日付セルは yyyy-mm-dd 文字列で渡す
        y, mo, d, *_ = xlrd.xldate_as_tuple(v.value, 0)
        return f'{y:04d}-{mo:02d}-{d:02d}'
    return v.value
rows = [[cell(r, k) for k in range(sh.ncols)] for r in range(sh.nrows)]
while rows and all(x == '' for x in rows[-1]): rows.pop()

ws = openpyxl.load_workbook(c, data_only=False)['原価計算']
lines = []
for r in range(7, 41):
    code, pct = ws.cell(r, 1).value, ws.cell(r, 3).value
    if code and isinstance(pct, (int, float)):
        lines.append({'code': str(code), 'pct': pct})
L = lambda a: ws[a].value
seed = {
    'source': {'master': pathlib.Path(MASTER).name, 'cost': pathlib.Path(COST).name},
    'masterRows': rows,
    'formula': {'product': ws['B3'].value, 'lines': lines},
    'quote': {'fillG': L('L22'), 'cartonQty': L('L23'), 'cartonPrice': L('L24'), 'units': L('L25'),
              'mfg': L('L26'), 'fill': L('L27'), 'finish': L('L28')},
}
OUT.write_text('window.SEED=' + json.dumps(seed, ensure_ascii=False) + ';\n', encoding='utf-8')
print(OUT, 'rows', len(rows), 'formula lines', len(lines), seed['quote'])
