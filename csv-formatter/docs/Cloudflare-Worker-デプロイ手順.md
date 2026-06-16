# ExcelAPI プロキシ Cloudflare Worker デプロイ手順

ExcelAPI（`api.excelapi.org`）はブラウザのCORS制約で直接呼べないため、Cloudflare Workers で中継するプロキシを建てます。**無料枠（100,000 リクエスト/日）で十分**。

## なぜ必要か

- **住所分割（address-separate）** で送り状の3行（住所1/住所2/住所3）をバランス良く配置するため
- ExcelAPI は HeartRails より住所網羅性が高く、字（あざ）名を含む住所などでも取得可能
- ブラウザ直接呼び出しは CORS で弾かれる → Worker で中継しつつ CORS ヘッダーを付与

## 1. Cloudflare アカウントを作る

1. https://dash.cloudflare.com/sign-up にアクセス
2. メール+パスワードでサインアップ（無料）
3. ドメインの登録は**不要**（Workers だけ使う）

## 2. Worker を作成

1. ダッシュボード左メニュー → 「Workers & Pages」 → 「Create application」 → 「Create Worker」
2. Worker 名を入力（例: `excelapi-proxy`）→ 「Deploy」
3. デプロイ後、「Edit code」をクリック
4. 左ペインのエディタを全選択して削除
5. `csv-formatter/cloudflare-worker/lookup.js` の内容を全コピペ
6. 右上「Save and deploy」

## 3. 動作確認

ブラウザで以下にアクセスして JSON が返ってくれば成功:

```
https://excelapi-proxy.YOUR-NAME.workers.dev/lookup?address=三重県松阪市久保田町字上沖127-1
```

期待されるレスポンス:
```json
{
  "zipcode": "5150814",
  "parts": ["三重県", "松阪市", "久保田町", "字上沖127-1"]
}
```

## 4. CSV整形ツール側の設定

`csv-formatter/index.html` の `CONFIG.addressLookup.proxyUrl` に上記URLをセット:

```js
addressLookup: {
  enabled: true,
  proxyUrl: 'https://excelapi-proxy.YOUR-NAME.workers.dev/lookup',
  requestIntervalMs: 200,
  maxRetries: 3,
  retryWaitMs: 500,
},
```

ここを空文字 `''` のままにすると住所分割は無効化され、従来通り（住所1=都道府県・住所2=合算住所）で動作します。

## 仕様メモ

- **エンドポイント**: `GET /lookup?address=...&zipcode=...(任意)`
- **動作**: ExcelAPI の `/post/zipcode` と `/post/address-separate?parts=1..4` を**並列で5本叩いて1レスポンスにまとめる**（クライアントの往復回数 5 → 1）
- **キャッシュ**: 同じ住所は Cloudflare側で24時間キャッシュされる（無料枠の節約 + 高速化）
- **CORS**: `Access-Control-Allow-Origin: *`
- **失敗時**: ExcelAPI が `ERROR: ...` を返した場合は空文字に正規化

## トラブルシュート

- **404 が返る**: パスを `/lookup` にしているか確認。`/` だけだと案内テキストが返る
- **502 Upstream error**: ExcelAPI 側の一時的な問題。リトライで解決する想定
- **クライアントで `住所分割: 0/N件成功` と出る**: proxyUrl のタイポ・Worker 未デプロイの可能性
