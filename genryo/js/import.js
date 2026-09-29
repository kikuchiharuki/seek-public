/* import.js — CSV/Excelから原料を登録：①ファイル ②見出し行 ③列の当てはめ ④確認 ⑤取込
 *
 * 取込の中身（plan/apply）は画面と分けてあるので、サンプル読込や将来の自動取込でも同じ処理を使う。
 */

const IMPORT_FIELDS = [
  { k: 'code', label: 'コード', req: true, syn: ['コード', 'code', '原料コード', '品番'] },
  { k: 'name', label: '商品名（原料名）', req: true, syn: ['商品名', '原料名', '品名', '名称'] },
  { k: 'disp', label: '表示名称', syn: ['表示名称', '表示名', '成分名'] },
  { k: 'inci', label: 'INCI名', syn: ['inci', 'inci名', '英名'] },
  { k: 'maker', label: 'メーカー', syn: ['メーカー', '製造元', 'maker'] },
  { k: 'supplier', label: '発注先', syn: ['発注先', '仕入先', '購入先'] },
  { k: 'price', label: '価格', syn: ['価格', '単価', '仕入単価', 'price'] },
  { k: 'unit', label: '価格の単位', syn: ['単位', 'unit'] },
  { k: 'pack', label: '入目', syn: ['入目', '入れ目', '荷姿', '容量'] },
  { k: 'quoteDate', label: '見積日（価格の適用日）', syn: ['見積日', '適用日', '年月日', '見積'] },
  { k: 'note', label: '備考', syn: ['備考', 'メモ', 'note'] },
];

const Importer = {
  id: 'import', label: '取込（CSV/Excel）',
  defaultOpts: { pad4: true, skipNoName: true, existing: 'update' },
  S: null, // { fileName, wb, sheet, aoa, hdr, map, opts, mapSource, plan }

  /* ---------- 取込の中身 ---------- */

  /** 見出しから列を推定（完全一致を優先し、同じ列を二重に使わない） */
  guessMap(headers, aoa, hdr) {
    const cand = [];
    IMPORT_FIELDS.forEach(f => headers.forEach((h, i) => {
      const nh = norm(h); if (!nh) return;
      const s = Math.max(...f.syn.map(sy => nh === norm(sy) ? 3 : nh.includes(norm(sy)) ? 1 : 0));
      if (s) cand.push({ k: f.k, i, s });
    }));
    cand.sort((a, b) => b.s - a.s);
    const map = {}, used = new Set();
    cand.forEach(c => { if (map[c.k] == null && !used.has(c.i)) { map[c.k] = c.i; used.add(c.i); } });
    // 見出しの無い列のうち、英字だけ（かな漢字なし）の値がいちばん多い列を INCI名とみなす
    if (map.inci == null) {
      let best = { i: null, n: 4 };
      headers.forEach((h, i) => {
        if (used.has(i) || norm(h)) return;
        const n = aoa.slice(hdr + 1).map(r => str(r[i]).replace(/[、・　]/g, ''))
          .filter(v => /[A-Za-z]{3}/.test(v) && !/[぀-ヿ一-鿿]/.test(v)).length;
        if (n > best.n) best = { i, n };
      });
      map.inci = best.i;
    }
    return map;
  },

  plan(aoa, hdr, map, opts) {
    const has = k => map[k] != null && map[k] !== '';
    const get = (row, k) => has(k) ? row[map[k]] : '';
    const byCode = new Map(DB.materials.map(m => [m.code, m]));
    const lp = latestPrices();
    const res = { add: [], upd: [], same: 0, skip: [], warn: [] };
    const seen = new Set();
    for (let r = hdr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [], rn = r + 1;
      if (row.every(v => str(v) === '')) continue;
      let code = str(get(row, 'code'));
      if (opts.pad4 && /^\d{1,3}$/.test(code)) code = code.padStart(4, '0');
      const name = str(get(row, 'name'));
      if (!code) { res.skip.push({ rn, why: 'コードが空' }); continue; }
      if (!name && opts.skipNoName) { res.skip.push({ rn, code, why: '商品名が空（空き番号）' }); continue; }
      if (seen.has(code)) { res.warn.push({ rn, code, msg: 'ファイル内でコードが重複（この行は無視）' }); continue; }
      seen.add(code);

      const rec = { code, name };
      ['disp', 'inci', 'maker', 'supplier', 'pack', 'note'].forEach(k => { if (has(k)) rec[k] = str(get(row, k)); });

      let price = null;
      const pv = get(row, 'price');
      if (str(pv) !== '') {
        const unit = str(get(row, 'unit'));
        const { perKg, warn } = toPerKg(pv, unit);
        const qd = get(row, 'quoteDate');
        const date = parseDate(qd);
        const plainDate = qd instanceof Date || typeof qd === 'number' || /^\s*\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s*$/.test(str(qd));
        price = { date, perKg, raw: typeof pv === 'number' ? pv : str(pv), unit, memo: str(qd) && !plainDate ? `見積日欄「${str(qd)}」` : '' };
        if (warn) res.warn.push({ rn, code, msg: warn });
      }

      const cur = byCode.get(code);
      if (!cur) { res.add.push({ rn, rec, price }); continue; }
      const diffs = Object.keys(rec).filter(k => k !== 'code' && str(cur[k]) !== rec[k]).map(k => [k, cur[k], rec[k]]);
      const old = lp.get(code);
      const priceChanged = price && (!old || String(old.raw) !== String(price.raw) || str(old.unit) !== price.unit);
      if (!diffs.length && !priceChanged) { res.same++; continue; }
      if (opts.existing === 'skip') { res.skip.push({ rn, code, why: '既存コード（更新しない設定）' }); continue; }
      if (priceChanged && !price.date) price.date = today();
      res.upd.push({ rn, rec, price: priceChanged ? price : null, diffs, oldPrice: old });
    }
    return res;
  },

  apply(p, source) {
    const memo = m => [m, '取込: ' + source].filter(Boolean).join(' / ');
    p.add.forEach(a => {
      DB.materials.push({ disp: '', inci: '', maker: '', supplier: '', pack: '', note: '', active: true, ...a.rec });
      if (a.price) DB.prices.push({ code: a.rec.code, ...a.price, memo: memo(a.price.memo) });
    });
    p.upd.forEach(u => {
      Object.assign(findMaterial(u.rec.code), u.rec);
      if (u.price) DB.prices.push({ code: u.rec.code, ...u.price, memo: memo(u.price.memo) });
    });
    DB.materials.sort((a, b) => a.code.localeCompare(b.code));
    App.changed();
  },

  /* ---------- 画面 ---------- */

  render(el) {
    const S = this.S;
    el.innerHTML = `
      <div class="step"><h2>① ファイルを選ぶ</h2>
        <div class="toolbar">
          <button class="primary" onclick="Importer.pick()">CSV / Excel を選ぶ</button>
          ${window.SEED ? `<button onclick="Importer.loadRows(SEED.masterRows, SEED.source.master + '（同梱サンプル）')">本番の原料マスタ（${esc(SEED.source.master)}）で試す</button>` : ''}
          <span class="muted">${S ? '選択中：' + esc(S.fileName) : 'CSVは Shift-JIS / UTF-8 どちらも可。.xlsx .xls .xlsm 可'}</span>
        </div></div>
      <div class="step ${S ? '' : 'off'}" id="st2"></div>
      <div class="step ${S ? '' : 'off'}" id="st3"></div>
      <div class="step ${S?.plan ? '' : 'off'}" id="st4"></div>`;
    if (S) { this.drawHeader(); this.drawMap(); this.drawPlan(); }
  },

  async pick() {
    try {
      const file = await pickFile('.csv,.txt,.xlsx,.xls,.xlsm');
      const buf = await file.arrayBuffer();
      let wb;
      if (/\.(csv|txt)$/i.test(file.name)) {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { text = new TextDecoder('shift_jis').decode(buf); }
        wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true }); // raw: "0001" を数値化しない
      } else {
        wb = XLSX.read(buf, { type: 'array', cellDates: true });
      }
      this.S = { fileName: file.name, wb };
      this.selectSheet(wb.SheetNames[0]);
    } catch (e) { if (e.name !== 'AbortError') alert('読込エラー: ' + e.message); }
  },

  loadRows(aoa, name) { this.S = { fileName: name, wb: null, aoa }; this.setAoa(aoa); },

  selectSheet(name) {
    this.S.sheet = name;
    this.setAoa(XLSX.utils.sheet_to_json(this.S.wb.Sheets[name], { header: 1, raw: true, defval: '' }));
  },

  setAoa(aoa) {
    const S = this.S;
    S.aoa = aoa;
    // 見出し行：文字の入ったセルが3つ以上ある最初の行
    S.hdr = Math.max(0, aoa.slice(0, 20).findIndex(r => r.filter(v => typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim())).length >= 3));
    S.opts = { ...this.defaultOpts };
    this.resetMap();
    this.render($('view'));
  },

  headers() { const S = this.S; const n = Math.max(...S.aoa.slice(S.hdr, S.hdr + 30).map(r => r.length)); return Array.from({ length: n }, (_, i) => str(S.aoa[S.hdr][i])); },
  memoKey() { return 'genryo.importMap:' + norm(this.headers().join('|')); },

  resetMap() {
    const S = this.S; S.plan = null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.memoKey())); } catch (_) { }
    if (saved) { S.map = saved; S.mapSource = '前回この見出しで使った当てはめを復元しました'; }
    else { S.map = this.guessMap(this.headers(), S.aoa, S.hdr); S.mapSource = '見出し名から自動で当てはめました。違うところだけ直してください'; }
  },

  drawHeader() {
    const S = this.S, headers = this.headers();
    const sheetSel = S.wb && S.wb.SheetNames.length > 1
      ? `シート <select onchange="Importer.selectSheet(this.value)">${S.wb.SheetNames.map(n => `<option ${n === S.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '';
    const rows = S.aoa.slice(S.hdr, S.hdr + 6).map((r, j) =>
      `<tr class="${j === 0 ? 'hdrrow' : ''}"><td class="muted">${S.hdr + j + 1}</td>${headers.map((_, i) => `<td>${esc(str(r[i])).slice(0, 40)}</td>`).join('')}</tr>`).join('');
    $('st2').innerHTML = `<h2>② 見出し行を確認</h2>
      <div class="toolbar">${sheetSel} 見出しは <input type="number" min="1" style="width:70px" value="${S.hdr + 1}"
        onchange="Importer.S.hdr=Math.max(0,this.value-1);Importer.resetMap();Importer.render($('view'))"> 行目
        <span class="muted">（全${S.aoa.length}行）黄色の行が見出しになります</span></div>
      <div class="scroll"><table><thead><tr><th></th>${headers.map((_, i) => `<th>${XLSX.utils.encode_col(i)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  },

  drawMap() {
    const S = this.S, headers = this.headers();
    const sample = i => {
      if (i == null || i === '') return '';
      const vals = S.aoa.slice(S.hdr + 1).map(r => str(r[i])).filter(Boolean).slice(0, 3);
      return vals.map(v => `<span class="tag info">${esc(v.slice(0, 24))}</span>`).join('');
    };
    const opt = (k) => `<select onchange="Importer.setMap('${k}',this.value)"><option value="">（使わない）</option>${headers.map((h, i) =>
      `<option value="${i}" ${S.map[k] === i ? 'selected' : ''}>${XLSX.utils.encode_col(i)}：${esc(h || '（見出しなし）')}</option>`).join('')}</select>`;
    $('st3').innerHTML = `<h2>③ 列の当てはめ</h2>
      <p class="hint">${esc(S.mapSource)}。右側に実際の値が出るので、合っているか目で確認できます。</p>
      <div class="grid2">${IMPORT_FIELDS.map(f => `<div class="maprow"><div>${f.label}${f.req ? ' <span class="req">*</span>' : ''}</div>${opt(f.k)}<div>${sample(S.map[f.k])}</div></div>`).join('')}</div>
      <h2>取込の設定</h2>
      <div class="toolbar">
        <label><input type="checkbox" ${S.opts.pad4 ? 'checked' : ''} onchange="Importer.S.opts.pad4=this.checked;Importer.S.plan=null;Importer.drawPlan()"> 数字だけのコードは4桁にそろえる（1→0001）</label>
        <label><input type="checkbox" ${S.opts.skipNoName ? 'checked' : ''} onchange="Importer.S.opts.skipNoName=this.checked;Importer.S.plan=null;Importer.drawPlan()"> 商品名が空の行は飛ばす</label>
        <label>登録済みのコードは <select onchange="Importer.S.opts.existing=this.value;Importer.S.plan=null;Importer.drawPlan()">
          <option value="update" ${S.opts.existing === 'update' ? 'selected' : ''}>内容を更新する</option>
          <option value="skip" ${S.opts.existing === 'skip' ? 'selected' : ''}>そのままにする</option></select></label>
      </div>
      <div class="toolbar"><button class="primary" onclick="Importer.check()">内容を確認する</button>
        <span class="muted">まだ登録はされません</span></div>`;
  },

  setMap(k, v) {
    const S = this.S;
    const i = v === '' ? null : +v;
    if (i != null) Object.keys(S.map).forEach(o => { if (S.map[o] === i) S.map[o] = null; }); // 1列は1項目にだけ
    S.map[k] = i; S.plan = null;
    this.drawMap(); this.drawPlan();
  },

  check() {
    const S = this.S;
    if (S.map.code == null || S.map.name == null) { alert('「コード」と「商品名」の列は必ず選んでください'); return; }
    S.plan = this.plan(S.aoa, S.hdr, S.map, S.opts);
    this.drawPlan();
    $('st4').scrollIntoView({ behavior: 'smooth' });
  },

  drawPlan() {
    const S = this.S, p = S.plan, st = $('st4');
    st.classList.toggle('off', !p);
    if (!p) { st.innerHTML = '<h2>④ 確認して取り込む</h2><p class="muted">③で「内容を確認する」を押してください</p>'; return; }
    const label = k => IMPORT_FIELDS.find(f => f.k === k)?.label || k;
    const n = p.add.length + p.upd.length;
    const list = (arr, fn, max = 50) => arr.slice(0, max).map(fn).join('') + (arr.length > max ? `<tr><td colspan="4" class="muted">ほか ${arr.length - max}件</td></tr>` : '');
    st.innerHTML = `<h2>④ 確認して取り込む</h2>
      <div class="toolbar" style="gap:24px">
        <div>新規<div class="big ok">${p.add.length}</div></div>
        <div>更新<div class="big">${p.upd.length}</div></div>
        <div>変更なし<div class="big muted">${p.same}</div></div>
        <div>飛ばす<div class="big muted">${p.skip.length}</div></div>
        <div>要確認<div class="big" style="color:var(--caution)">${p.warn.length}</div></div>
        <span class="grow"></span>
        <button class="primary" ${n ? '' : 'disabled'} onclick="Importer.run()">${n}件を取り込む</button>
      </div>
      ${p.upd.length ? `<h2>更新される内容</h2><div class="scroll"><table><thead><tr><th>行</th><th>コード</th><th>項目</th><th>変更前 → 変更後</th></tr></thead><tbody>
        ${list(p.upd, u => [...u.diffs.map(([k, a, b]) => `<tr><td>${u.rn}</td><td>${esc(u.rec.code)}</td><td>${label(k)}</td><td>${esc(a)} → <b>${esc(b)}</b></td></tr>`),
          u.price ? `<tr><td>${u.rn}</td><td>${esc(u.rec.code)}</td><td>価格（履歴に追加）</td><td>${esc(u.oldPrice?.raw ?? 'なし')} → <b>${esc(u.price.raw)} ${esc(u.price.unit)}</b>（適用日 ${esc(u.price.date)}）</td></tr>` : ''].join(''))}
      </tbody></table></div>` : ''}
      ${p.warn.length ? `<h2>要確認（取り込みはされます）</h2><div class="scroll"><table><thead><tr><th>行</th><th>コード</th><th colspan="2">内容</th></tr></thead><tbody>
        ${list(p.warn, w => `<tr><td>${w.rn}</td><td>${esc(w.code)}</td><td colspan="2">${esc(w.msg)}</td></tr>`, 200)}</tbody></table></div>` : ''}
      ${p.skip.length ? `<h2>飛ばす行</h2><div class="scroll"><table><thead><tr><th>行</th><th>コード</th><th colspan="2">理由</th></tr></thead><tbody>
        ${list(p.skip, s => `<tr><td>${s.rn}</td><td>${esc(s.code || '')}</td><td colspan="2">${esc(s.why)}</td></tr>`)}</tbody></table></div>` : ''}`;
  },

  run() {
    const S = this.S;
    try { localStorage.setItem(this.memoKey(), JSON.stringify(S.map)); } catch (_) { }
    const n = S.plan.add.length + S.plan.upd.length;
    this.apply(S.plan, S.fileName);
    if (!DB.fileName) DB.fileName = '（未保存の新規データ）';
    setStatus();
    this.S = null;
    alert(`${n}件を取り込みました。右上「保存」で原料データ.xlsxに書き出されます。`);
    App.setTab('materials');
  },
};
App.register(Importer);
