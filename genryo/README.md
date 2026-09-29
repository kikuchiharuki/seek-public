# 原料マスタ（試作）

原料マスタExcel＋原価計算Excelを置き換える試作。サーバー不要・単一HTML・データは普通の `原料データ.xlsx`（inventory と同じ考え方）。

## 作り方：1機能＝1ファイル（モジュール）

進め方は `docs/進め方.md`、データの形は `docs/データ構成.md`（ER図）を正とする。

| ファイル | 機能 |
|---|---|
| `css/dads.css` | デザインの土台（デジタル庁デザインシステムの値。`docs/デザイン.md`） |
| `js/core.js` | データの持ち方、xlsxの開く/保存、共通関数（kg換算・日付解析）、タブの仕組み |
| `js/materials.js` | 原料マスタ：検索・点検・詳細編集・価格履歴（v1。v2の「品目」へ直す予定） |
| `js/import.js` | CSV/Excel取込：見出し行→列の当てはめ→確認→取込 |

機能を足すときは `js/xxx.js` を作って `App.register(...)` し、`index.html` に `<script>` を1行足す。

## データ（原料データ.xlsx）

- **原料**：コード / 商品名 / 表示名称 / INCI名 / メーカー / 発注先 / 入目 / 備考 / 有効
- **価格履歴**：コード / 適用日 / 単価(円/kg) / 元の価格 / 元の単位 / メモ
  - 単価は上書きしない。変わったら行を足す（過去の見積が後から変わらない）
  - `/kg` `/g` `/500g` `/20kg` はkg換算。`/L` `/缶` などは「単位要確認」

## 動かし方

```
python3 -m http.server 8640 --directory genryo   # http://localhost:8640/（Edge/Chrome）
```

`seed-data.js`（本番の単価入りサンプル）は**公開しない**（.gitignore）。社内PCで作る場合：

```
python3 tools/build_seed.py   # /Volumes/server の原料マスタ.xls・原価計算.xlsm を読むだけ（元ファイルは変更しない）
```
