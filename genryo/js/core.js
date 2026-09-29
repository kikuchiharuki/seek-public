/* core.js — データの持ち方・読み書き・共通関数・タブの仕組み
 *
 * データの正本は「原料データ.xlsx」（普通のExcel）。シート＝表1つ。
 *   原料     : コード / 商品名 / 表示名称 / INCI名 / メーカー / 発注先 / 入目 / 備考 / 有効
 *   価格履歴 : コード / 適用日 / 単価(円/kg) / 元の価格 / 元の単位 / メモ
 * 単価は上書きしない。変わったら行を足す（過去の見積が後から変わらないようにするため）。
 */

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 検索・比較用：全角半角・大小・空白の違いを無視 */
const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const str = v => v instanceof Date ? ymd(v) : String(v ?? '').trim();
const yen = n => n == null || !isFinite(n) ? '' : Math.round(n).toLocaleString();

/** セルの値から yyyy-mm-dd を取り出す（Excel日付・"2024/7/5"・"新2024/12/24" など）。取れなければ '' */
function parseDate(v) {
  if (v instanceof Date) return ymd(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const m = String(v ?? '').normalize('NFKC').match(/(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

/** 価格と単位から 円/kg を出す。換算できない単位（L・缶など）は perKg=null で理由を返す */
function toPerKg(price, unit) {
  const p = typeof price === 'number' ? price : String(price ?? '').normalize('NFKC').replace(/[,\s¥\\円]/g, '');
  if (p === '' || !/^\d+(\.\d+)?$/.test(String(p))) return { perKg: null, warn: `価格「${str(price)}」が数値でない` };
  const n = +p;
  const u = String(unit ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
  if (u === '') return { perKg: n, warn: '単位が空（/kgとみなした）' };
  const m = u.match(/^\/?(\d*\.?\d*)(kg|g)$/);
  if (m) {
    const qty = m[1] === '' ? 1 : +m[1];
    return { perKg: n / (m[2] === 'kg' ? qty : qty / 1000), warn: '' };
  }
  return { perKg: null, warn: `単位「${str(unit)}」はkgに換算できない` };
}

/* ---------- データ ---------- */
const DB = { materials: [], prices: [], fileHandle: null, fileName: '', dirty: false };

/** 原料ごとの最新価格（適用日が新しいもの。同日なら後に登録したもの） */
function latestPrices() {
  const map = new Map();
  DB.prices.forEach(p => { const c = map.get(p.code); if (!c || (p.date || '') >= (c.date || '')) map.set(p.code, p); });
  return map;
}
const latestPrice = code => latestPrices().get(code);
const findMaterial = code => DB.materials.find(m => m.code === code);
function nextCode() {
  const max = DB.materials.reduce((a, m) => /^\d+$/.test(m.code) ? Math.max(a, +m.code) : a, 0);
  return String(max + 1).padStart(4, '0');
}

/* ---------- タブ（モジュール） ---------- */
const App = {
  modules: [], tab: null,
  register(mod) { this.modules.push(mod); },
  start(first) { this.tab = first; $('sampleBtn').hidden = !window.SEED; this.render(); setStatus(); },
  setTab(id) { this.tab = id; this.render(); },
  render() {
    $('tabs').innerHTML = this.modules.map(m =>
      `<button class="${m.id === this.tab ? 'active' : ''}" onclick="App.setTab('${m.id}')">${esc(m.label)}</button>`).join('');
    this.modules.find(m => m.id === this.tab).render($('view'));
  },
  changed() { DB.dirty = true; setStatus(); },
};
function setStatus() {
  $('status').textContent = (DB.fileName || 'データ未読込') + ` / 原料${DB.materials.length}件・価格${DB.prices.length}件`
    + (DB.dirty ? ' / ●未保存の変更あり' : '');
}
window.addEventListener('beforeunload', e => { if (DB.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- 読み書き ---------- */
const SHEETS = {
  原料: { rows: () => DB.materials, cols: [['コード', 'code'], ['商品名', 'name'], ['表示名称', 'disp'], ['INCI名', 'inci'], ['メーカー', 'maker'], ['発注先', 'supplier'], ['入目', 'pack'], ['備考', 'note'], ['有効', 'active']] },
  価格履歴: { rows: () => DB.prices, cols: [['コード', 'code'], ['適用日', 'date'], ['単価(円/kg)', 'perKg'], ['元の価格', 'raw'], ['元の単位', 'unit'], ['メモ', 'memo']] },
};

const Core = {
  loadSample() {
    if (!confirmDiscard()) return;
    reset('（サンプル：' + SEED.source.master + '）');
    // サンプルも「取込」と同じ処理を通す（取込機能の動作確認を兼ねる）
    const map = { code: 0, name: 1, disp: 2, maker: 3, price: 4, unit: 5, pack: 6, note: 7, supplier: 8, quoteDate: 9, inci: 10 };
    Importer.apply(Importer.plan(SEED.masterRows, 0, map, Importer.defaultOpts), SEED.source.master);
    DB.dirty = false; App.render(); setStatus();
  },
  async open() {
    if (!confirmDiscard()) return;
    try {
      let file;
      if (window.showOpenFilePicker) {
        const [h] = await showOpenFilePicker({ types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
        try { await h.requestPermission?.({ mode: 'readwrite' }); } catch (_) { }
        file = await h.getFile(); DB.fileHandle = h;
      } else {
        file = await pickFile('.xlsx'); DB.fileHandle = null;
      }
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      if (!wb.Sheets['原料']) { alert('「原料」シートがありません。原料データ.xlsx を選んでください。\n（元の原料マスタExcelやCSVは「取込」タブから）'); return; }
      const h = DB.fileHandle; this.fromWorkbook(wb, file.name); DB.fileHandle = h;
      App.render(); setStatus();
    } catch (e) { if (e.name !== 'AbortError') alert('読込エラー: ' + e.message); }
  },
  fromWorkbook(wb, name) {
    reset(name);
    for (const [sheet, def] of Object.entries(SHEETS)) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet] || {}, { defval: '' });
      def.rows().push(...rows.map(r => Object.fromEntries(def.cols.map(([jp, k]) => [k, r[jp] instanceof Date ? ymd(r[jp]) : r[jp]]))));
    }
    DB.materials.forEach(m => { m.code = str(m.code); m.active = m.active !== '×' && m.active !== false; });
    DB.prices.forEach(p => { p.code = str(p.code); p.perKg = p.perKg === '' ? null : +p.perKg; });
  },
  toWorkbook() {
    const wb = XLSX.utils.book_new();
    for (const [sheet, def] of Object.entries(SHEETS)) {
      const rows = def.rows().map(r => Object.fromEntries(def.cols.map(([jp, k]) => [jp, k === 'active' ? (r.active ? '○' : '×') : (r[k] ?? '')])));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: def.cols.map(c => c[0]) }), sheet);
    }
    return wb;
  },
  async save() {
    const wb = this.toWorkbook();
    try {
      if (!DB.fileHandle && window.showSaveFilePicker) {
        DB.fileHandle = await showSaveFilePicker({ suggestedName: '原料データ.xlsx', types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
      }
      if (DB.fileHandle) {
        const w = await DB.fileHandle.createWritable();
        await w.write(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })); await w.close();
        DB.fileName = DB.fileHandle.name;
      } else {
        XLSX.writeFile(wb, '原料データ.xlsx');
      }
      DB.dirty = false; setStatus();
    } catch (e) { if (e.name !== 'AbortError') alert('保存エラー: ' + e.message); }
  },
};
function reset(name) { DB.materials = []; DB.prices = []; DB.fileHandle = null; DB.fileName = name; DB.dirty = false; }
function confirmDiscard() { return !DB.dirty || confirm('未保存の変更があります。破棄して読み込みますか？'); }
function pickFile(accept) {
  return new Promise((res, rej) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => inp.files[0] ? res(inp.files[0]) : rej({ name: 'AbortError' });
    inp.click();
  });
}
