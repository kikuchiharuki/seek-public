/* materials.js — 原料マスタ：一覧・検索・点検フィルタ・詳細（編集／価格履歴） */

const Materials = {
  id: 'materials', label: '原料マスタ',
  q: '', filter: 'all', limit: 200,

  render(el) {
    el.innerHTML = `
      <div class="toolbar">
        <input id="mq" type="search" placeholder="コード・原料名・表示名称・INCI・メーカー・発注先で検索" value="${esc(this.q)}">
        <span id="mchips"></span>
        <span class="grow"></span>
        <button class="primary" onclick="Materials.openDetail(null)">＋ 原料を追加</button>
      </div>
      <div id="mtable"></div>`;
    $('mq').oninput = e => { this.q = e.target.value; this.limit = 200; this.draw(); };
    this.draw();
    $('mq').focus();
  },

  /** 点検項目：一覧の絞り込みチップと、行のタグに使う */
  checks() {
    const lp = latestPrices();
    const nameCount = new Map();
    DB.materials.forEach(m => nameCount.set(norm(m.name), (nameCount.get(norm(m.name)) || 0) + 1));
    const flags = new Map();
    DB.materials.forEach(m => {
      const p = lp.get(m.code);
      flags.set(m.code, {
        noPrice: !p,
        unitCheck: !!p && p.perKg == null,
        dupName: nameCount.get(norm(m.name)) > 1,
      });
    });
    return { lp, flags };
  },

  draw() {
    const { lp, flags } = this.checks();
    const F = [
      ['all', 'すべて', m => m.active],
      ['noPrice', '単価なし', m => m.active && flags.get(m.code).noPrice],
      ['unitCheck', '単位要確認', m => m.active && flags.get(m.code).unitCheck],
      ['dupName', '同名あり', m => m.active && flags.get(m.code).dupName],
      ['inactive', '無効', m => !m.active],
    ];
    $('mchips').innerHTML = F.map(([k, label, fn]) =>
      `<button class="chip ${this.filter === k ? 'on' : ''}" onclick="Materials.filter='${k}';Materials.draw()">${label} ${DB.materials.filter(fn).length}</button>`).join(' ');

    if (!DB.materials.length) {
      $('mtable').innerHTML = `<p class="hint">原料がまだありません。<br>
        ${window.SEED ? `・右上「サンプルで見る」… 本番の原料マスタ（${esc(SEED.source.master)}）の中身で試す<br>` : ''}
        ・「取込」タブ … CSV／Excelから列を当てはめて登録<br>
        ・「原料データ.xlsx を開く」… 保存済みデータを開く</p>`;
      return;
    }
    const q = norm(this.q);
    const fn = F.find(f => f[0] === this.filter)[2];
    const hit = DB.materials.filter(m => fn(m) &&
      (!q || [m.code, m.name, m.disp, m.inci, m.maker, m.supplier].some(v => norm(v).includes(q))));
    const rows = hit.slice(0, this.limit).map(m => {
      const p = lp.get(m.code), f = flags.get(m.code);
      const price = !p ? '' : p.perKg != null ? yen(p.perKg) : `<span class="tag caution">${esc(p.raw)} ${esc(p.unit)}</span>`;
      const tags = [f.noPrice && '<span class="tag warn">単価なし</span>', f.unitCheck && '<span class="tag caution">単位要確認</span>',
        f.dupName && '<span class="tag info">同名あり</span>'].filter(Boolean).join('');
      return `<tr class="click ${m.active ? '' : 'inactive'}" onclick="Materials.openDetail('${esc(m.code)}')">
        <td>${esc(m.code)}</td>
        <td>${esc(m.name)}${m.disp ? `<div class="sub">${esc(m.disp)}</div>` : ''}</td>
        <td>${esc(m.maker)}</td><td>${esc(m.supplier)}</td><td>${esc(m.pack)}</td>
        <td class="n">${price}</td><td class="n sub">${esc(p?.date || '')}</td><td>${tags}</td></tr>`;
    }).join('');
    $('mtable').innerHTML = `
      <p class="hint">${hit.length}件${hit.length > this.limit ? `（先頭${this.limit}件を表示）` : ''}。行をクリックで詳細・編集。</p>
      <table><thead><tr><th>コード</th><th>商品名 / 表示名称</th><th>メーカー</th><th>発注先</th><th>入目</th>
        <th class="n">単価 円/kg</th><th class="n">価格日</th><th>点検</th></tr></thead><tbody>${rows}</tbody></table>
      ${hit.length > this.limit ? `<p><button onclick="Materials.limit+=500;Materials.draw()">さらに表示</button></p>` : ''}`;
  },

  /** 詳細ダイアログ。code=null なら新規 */
  openDetail(code) {
    const isNew = code == null;
    const m = isNew ? { code: nextCode(), name: '', disp: '', inci: '', maker: '', supplier: '', pack: '', note: '', active: true } : findMaterial(code);
    const prices = DB.prices.filter(p => p.code === m.code).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const same = isNew ? [] : DB.materials.filter(o => o !== m && norm(o.name) === norm(m.name));
    const f = (k, label, cls = '') => `<label>${label}</label><input type="text" id="f_${k}" class="${cls}" value="${esc(m[k])}">`;
    const dlg = $('dlg');
    dlg.innerHTML = `
      <div class="dlg-head"><b>${isNew ? '原料を追加' : esc(m.code) + '　' + esc(m.name)}</b><span class="grow"></span>
        <button class="ghost" onclick="$('dlg').close()">閉じる</button></div>
      <div class="dlg-body">
        <div class="form">
          ${f('code', 'コード')}${f('name', '商品名')}
          ${f('disp', '表示名称')}${f('inci', 'INCI名')}
          ${f('maker', 'メーカー')}${f('supplier', '発注先')}
          ${f('pack', '入目')}<label>有効</label><label style="text-align:left"><input type="checkbox" id="f_active" ${m.active ? 'checked' : ''}> 使用中</label>
          <label>備考</label><textarea id="f_note" class="wide" rows="2">${esc(m.note)}</textarea>
        </div>
        ${same.length ? `<p class="hint"><span class="tag info">同名あり</span> ${same.map(o => `<a href="#" onclick="Materials.openDetail('${esc(o.code)}');return false">${esc(o.code)}（${yen(latestPrice(o.code)?.perKg) || '単価なし'}）</a>`).join('、')}</p>` : ''}

        <h2>価格履歴 <span class="sub">上書きせず行を追加。いちばん新しい適用日の単価が使われます</span></h2>
        <table><thead><tr><th>適用日</th><th class="n">単価 円/kg</th><th class="n">元の価格</th><th>元の単位</th><th>メモ</th></tr></thead><tbody>
          ${prices.map((p, i) => `<tr${i === 0 ? ' style="font-weight:700"' : ''}><td>${esc(p.date || '（日付不明）')}</td>
            <td class="n">${p.perKg != null ? yen(p.perKg) : '<span class="tag caution">要確認</span>'}</td>
            <td class="n">${esc(p.raw)}</td><td>${esc(p.unit)}</td><td class="sub">${esc(p.memo)}</td></tr>`).join('')
            || '<tr><td colspan="5" class="muted">価格の登録がありません</td></tr>'}
          <tr><td><input type="date" id="np_date" value="${today()}"></td>
            <td class="n muted" id="np_perkg"></td>
            <td class="n"><input type="text" id="np_raw" size="8" placeholder="価格"></td>
            <td><input type="text" id="np_unit" size="6" value="/kg"></td>
            <td><input type="text" id="np_memo" style="width:100%" placeholder="例：2026/9見積 値上げ"></td></tr>
        </tbody></table>
        <p class="hint">新しい価格を入れて「保存」すると履歴に1行追加されます。「/kg」「/g」「/500g」「/20kg」はkg換算、L・缶などは要確認として保存。</p>
        ${isNew ? '' : `<p class="hint">元データの備考: ${esc(m.note) || 'なし'}</p>`}
      </div>
      <div class="dlg-foot"><button onclick="$('dlg').close()">キャンセル</button><button class="primary" id="dsave">保存</button></div>`;
    const preview = () => {
      if (!$('np_raw').value.trim()) { $('np_perkg').textContent = ''; return; }
      const r = toPerKg($('np_raw').value, $('np_unit').value);
      $('np_perkg').textContent = r.perKg != null ? yen(r.perKg) : r.warn;
    };
    $('np_raw').oninput = $('np_unit').oninput = preview;
    $('dsave').onclick = () => {
      const v = k => $('f_' + k).value.trim();
      const newCode = v('code');
      if (!newCode || !v('name')) { alert('コードと商品名は必須です'); return; }
      if (newCode !== m.code || isNew) {
        if (findMaterial(newCode)) { alert(`コード ${newCode} は既に使われています`); return; }
        if (!isNew) DB.prices.forEach(p => { if (p.code === m.code) p.code = newCode; });
      }
      Object.assign(m, { code: newCode, name: v('name'), disp: v('disp'), inci: v('inci'), maker: v('maker'), supplier: v('supplier'), pack: v('pack'), note: $('f_note').value.trim(), active: $('f_active').checked });
      if (isNew) DB.materials.push(m);
      const raw = $('np_raw').value.trim();
      if (raw) {
        const r = toPerKg(raw, $('np_unit').value);
        DB.prices.push({ code: m.code, date: $('np_date').value, perKg: r.perKg, raw: /^\d+(\.\d+)?$/.test(raw) ? +raw : raw, unit: $('np_unit').value.trim(), memo: [$('np_memo').value.trim(), r.warn].filter(Boolean).join(' / ') });
      }
      App.changed(); dlg.close(); this.draw();
    };
    dlg.showModal();
  },
};
App.register(Materials);
