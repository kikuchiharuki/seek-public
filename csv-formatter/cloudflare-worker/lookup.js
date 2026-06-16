// ============================================================================
// ExcelAPI プロキシ（Cloudflare Workers）
//   - 用途: ブラウザCORSで直接呼べない api.excelapi.org を中継する
//   - エンドポイント: GET /lookup?address=...&zipcode=...(任意)
//   - 動作: zipcode（住所→郵便番号） と parts=1..4（住所分割） を並列取得し
//          1リクエストでまとめてJSONを返す（クライアントの往復回数を 5 → 1 に短縮）
//   - キャッシュ: 24時間（同じ住所は何度叩いてもCF側でキャッシュ）
//
// デプロイ手順は ../docs/Cloudflare-Worker-デプロイ手順.md を参照
// ============================================================================

const UPSTREAM = 'https://api.excelapi.org';
const CACHE_TTL = 86400;  // 1日

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': `public, max-age=${CACHE_TTL}`,
  };
}

async function fetchText(path, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${UPSTREAM}${path}?${qs}`, {
    cf: { cacheEverything: true, cacheTtl: CACHE_TTL },
  });
  const text = (await res.text()).trim();
  // ExcelAPI はエラー時 "ERROR: ..." を返すので空文字に正規化
  if (text.startsWith('ERROR') || text.startsWith('!')) return '';
  return text;
}

async function handleLookup(address, zipcode) {
  if (!address) {
    return new Response(JSON.stringify({ error: 'address is required' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  // 並列で 5 本叩く（zipcode + parts 1..4）
  // zipcode が既に分かっていれば省略可能
  const tasks = [
    zipcode ? Promise.resolve(zipcode) : fetchText('/post/zipcode', { address }),
    fetchText('/post/address-separate', { address, parts: 1 }),
    fetchText('/post/address-separate', { address, parts: 2 }),
    fetchText('/post/address-separate', { address, parts: 3 }),
    fetchText('/post/address-separate', { address, parts: 4 }),
  ];
  const [zip, p1, p2, p3, p4] = await Promise.all(tasks);
  return new Response(
    JSON.stringify({ zipcode: zip || '', parts: [p1, p2, p3, p4] }),
    { headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' } }
  );
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(request.url);
    if (url.pathname === '/lookup') {
      try {
        return await handleLookup(
          url.searchParams.get('address') || '',
          url.searchParams.get('zipcode') || ''
        );
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 502,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('OK: ExcelAPI proxy. Use /lookup?address=...', {
      headers: corsHeaders(),
    });
  },
};
