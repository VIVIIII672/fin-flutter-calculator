/* 主程式：欄位、檢查、五個分頁的計算與顯示、存檔與匯出入、列印 */
(function () {
  'use strict';
  var P = window.FinPhysics, U = window.FinUnits, CSV = window.FinCSV, S = window.FinState, CH = window.FinCharts;
  var $ = function (id) { return document.getElementById(id); };
  var state = S.defaults();
  var currentTab = 'analysis';
  var timer = null;

  // ================= 小工具 =================
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return a[k]; }, o)[last] = v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fu(dim, v, d) { return U.fmt(dim, state.units, v, d); }
  function un(dim) { return U.unit(dim, state.units); }
  function fn(x, d) { return isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; }
  function ceilTo(x, step) { return Math.ceil(x / step - 1e-9) * step; }
  function disp(dim, v) { return U.fromBase(dim, state.units, v); }
  function qStr(q) { return state.units === 'si' ? fn(q / 1000, 2) + ' kPa' : fn(q / U.constants.PSI, 3) + ' psi'; }
  function spd(v, d) { return fu('speed', v, d === undefined ? 0 : d) + ' ' + un('speed'); }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function stamp() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes());
  }
  function toolMsg(msg, kind) { var el = $('toolMsg'); el.textContent = msg; el.className = 'tool-msg' + (kind ? ' ' + kind : ''); }

  // ================= 欄位定義 =================
  var MODE_OPTS = [['std', '標準大氣（發射場海拔加離地高度）'], ['local', '當地大氣（發射場溫度與測站氣壓）']];
  var FIELD_SETS = {
    'f-geom': [
      { path: 'geom.r_mm', label: '根部弦長', sym: 'c<sub>r</sub>', dim: 'length', gt: true },
      { path: 'geom.c_mm', label: '尖端弦長', sym: 'c<sub>t</sub>', dim: 'length', ge: true },
      { path: 'geom.b_mm', label: '單片翼展', sym: 'b', dim: 'length', gt: true },
      { path: 'geom.t_mm', label: '鰭片厚度', sym: 't', dim: 'length', gt: true },
      { path: 'geom.m_mm', label: '前緣後退長度', sym: 'm', dim: 'length', ge: true, wide: true, hint: '尖端前緣相對根部前緣往後退的距離（OpenRocket 的 Sweep length）。只有 Bennett 修正會用到。' }
    ],
    'f-mat': [
      { type: 'select', path: 'mat', label: '常用材料', wide: true },
      { path: 'G_GPa', label: '剪切模量', sym: 'G', dim: 'modulus', gt: true, wide: true, hint: '典型參考值，實際請以供應商資料為準。OpenRocket 的材料只有密度，沒有 G。' },
      { path: 'Gpct', label: 'G 的敏感度範圍 ±', sym: 'u', dim: 'pct', ge: true, max: 90, hint: '算出 G 下限與上限的結果。這是敏感度，不是統計信賴區間。' },
      { path: 'density_gcc', label: '密度', sym: 'ρ', dim: 'density', gt: true, hint: '用在「安裝與配重」。' }
    ],
    'f-method': [
      { type: 'select', path: 'method', label: '顫振公式', wide: true }
    ],
    'f-flight': [
      { path: 'flight.vmax', label: '預期最大速度', sym: 'V<sub>max</sub>', dim: 'speed', gt: true },
      { path: 'flight.sf', label: '安全係數', dim: 'none', gt: true },
      { path: 'flight.aglMax_m', label: '最大速度發生的離地高度', dim: 'altitude', ge: true, wide: true, hint: '填 0 最保守，因為高度越高，顫振速度通常越大。' },
      { type: 'select', path: 'flight.mode', label: '大氣模型', wide: true },
      { path: 'flight.launchElev_m', label: '發射場海拔', dim: 'altitude', wide: true, showIf: function (s) { return s.flight.mode === 'std'; } },
      { path: 'flight.launchT_C', label: '發射場氣溫', dim: 'temp', showIf: function (s) { return s.flight.mode === 'local'; } },
      { path: 'flight.stationP_Pa', label: '測站氣壓', dim: 'pressure', gt: true, showIf: function (s) { return s.flight.mode === 'local'; }, hint: '發射場當下的絕對氣壓，不是換算到海平面的氣壓。' }
    ],
    'f-vortex': [
      { path: 'vortex.St', label: '史特魯哈數', sym: 'St', dim: 'none', gt: true },
      { path: 'vortex.L_mm', label: '特徵長度', sym: 'L', dim: 'length', gt: true },
      { path: 'vortex.tolPct', label: '頻帶範圍 ±', dim: 'pct', ge: true, max: 90, wide: true }
    ],
    'f-sdof': [
      { path: 'vortex.k_Npm', label: '等效剛度', sym: 'k<sub>eff</sub>', dim: 'stiffness', opt: true, gt: true },
      { path: 'vortex.m_g', label: '等效質量', sym: 'm<sub>eff</sub>', dim: 'mass', opt: true, gt: true }
    ],
    'f-mass1': [
      { path: 'mass.fins', label: '鰭片數量', dim: 'none', gt: true, int: true },
      { path: 'mass.addMass_g', label: '附加質量（鰭根、膠、補強）', dim: 'mass', ge: true, wide: true, hint: '板材密度與厚度已計算的部分不要重複填。' }
    ],
    'f-mass2': [
      { path: 'mass.baseM_g', label: '不含鰭片組的質量', dim: 'mass', opt: true, gt: true },
      { path: 'mass.baseX_mm', label: '該質量的重心位置', dim: 'length', opt: true },
      { path: 'mass.assemblyX_mm', label: '鰭片組重心位置', dim: 'length', opt: true },
      { path: 'mass.cp_mm', label: '壓力中心 CP 位置', dim: 'length', opt: true },
      { path: 'mass.od_mm', label: '箭身外徑', dim: 'length', opt: true, gt: true }
    ],
    'f-mass3': [
      { path: 'mass.Cn', label: '法向力係數 Cn', dim: 'none', ge: true, hint: '以鰭片外露平面面積為基準。' },
      { path: 'mass.lever_mm', label: '力臂（到根部彎曲軸）', dim: 'length', opt: true, ge: true }
    ]
  };

  function selectOptions(path) {
    if (path === 'mat') return S.MATS.map(function (m) { return [m.id, m.name]; }).concat([['custom', '自訂']]);
    if (path === 'method') return Object.keys(P.METHODS).map(function (k) { return [k, k === 'bennett' ? 'Bennett 形心修正（計入前緣後退）' : P.METHODS[k]]; });
    if (path === 'flight.mode') return MODE_OPTS;
    return [];
  }

  function fid(f) { return 'in-' + f.path.replace(/\./g, '-'); }

  function buildFields() {
    Object.keys(FIELD_SETS).forEach(function (cid) {
      var box = $(cid), html = '';
      FIELD_SETS[cid].forEach(function (f) {
        var id = fid(f), cls = 'field' + (f.wide ? ' wide' : '');
        if (f.type === 'select') {
          html += '<div class="' + cls + '" id="w-' + id + '"><label for="' + id + '">' + esc(f.label) + '</label><div class="inp"><select id="' + id + '">' +
            selectOptions(f.path).map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') +
            '</select></div>' + (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</div>';
        } else {
          html += '<div class="' + cls + '" id="w-' + id + '"><label for="' + id + '">' + esc(f.label) + (f.sym ? ' <b>' + f.sym + '</b>' : '') + '</label>' +
            '<div class="inp"><input id="' + id + '" type="number" inputmode="decimal" step="any"><span class="unit" id="u-' + id + '"></span></div>' +
            (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</div>';
        }
      });
      box.innerHTML = html;
    });
    Object.keys(FIELD_SETS).forEach(function (cid) {
      FIELD_SETS[cid].forEach(function (f) {
        var el = $(fid(f));
        if (f.type === 'select') el.addEventListener('change', function () { onSelect(f, el.value); });
        else el.addEventListener('input', function () { onNumber(f, el); });
      });
    });
  }

  function onNumber(f, el) {
    var raw = el.value.trim(), v = raw === '' ? null : parseFloat(raw);
    if (v !== null && !isFinite(v)) v = null;
    setPath(state, f.path, v === null ? null : U.toBase(f.dim, state.units, v));
    if (f.path.indexOf('geom.') === 0 && f.path !== 'geom.t_mm') state.shape = null;
    if (f.path === 'geom.t_mm') { /* 厚度不影響外形 */ }
    if (f.path === 'G_GPa') {
      var hit = S.MATS.filter(function (m) { return Math.abs(m.G - state.G_GPa) < 1e-9; })[0];
      state.mat = hit ? hit.id : 'custom';
      $('in-mat').value = state.mat;
    }
    schedule();
  }

  function onSelect(f, v) {
    setPath(state, f.path, v);
    if (f.path === 'mat' && v !== 'custom') {
      var m = S.MATS.filter(function (x) { return x.id === v; })[0];
      if (m) { state.G_GPa = m.G; state.density_gcc = m.rho; refreshInputs(true); }
    }
    refreshVisibility();
    schedule();
  }

  function refreshInputs(force) {
    Object.keys(FIELD_SETS).forEach(function (cid) {
      FIELD_SETS[cid].forEach(function (f) {
        var el = $(fid(f)), v = getPath(state, f.path);
        if (f.type === 'select') { el.value = v; return; }
        var u = $('u-' + fid(f));
        if (u) u.textContent = un(f.dim);
        el.step = U.spec(f.dim, state.units).step;
        if (force || document.activeElement !== el) el.value = U.inputValue(f.dim, state.units, v);
      });
    });
    $('massNote').value = state.mass.note || '';
    refreshVisibility();
  }

  function refreshVisibility() {
    Object.keys(FIELD_SETS).forEach(function (cid) {
      FIELD_SETS[cid].forEach(function (f) { if (f.showIf) $('w-' + fid(f)).hidden = !f.showIf(state); });
    });
  }

  // ================= 輸入檢查 =================
  function fieldErrors(cids) {
    var errs = [];
    cids.forEach(function (cid) {
      FIELD_SETS[cid].forEach(function (f) {
        if (f.type === 'select') return;
        if (f.showIf && !f.showIf(state)) return;
        var v = getPath(state, f.path), name = f.label;
        if (v === null || v === undefined) { if (!f.opt) errs.push({ path: f.path, msg: name + '不可空白' }); return; }
        if (!isNum(v)) errs.push({ path: f.path, msg: name + '不是有效數字' });
        else if (f.gt && !(v > 0)) errs.push({ path: f.path, msg: name + '必須大於 0' });
        else if (f.ge && v < 0) errs.push({ path: f.path, msg: name + '不可為負數' });
        else if (f.max !== undefined && v > f.max) errs.push({ path: f.path, msg: name + '不可超過 ' + f.max });
        else if (f.int && Math.round(v) !== v) errs.push({ path: f.path, msg: name + '必須是整數' });
      });
    });
    return errs;
  }

  function physState(method) {
    return { geom: state.geom, G_GPa: state.G_GPa, Gpct: state.Gpct, method: method || state.method, flight: state.flight };
  }

  function analysisErrors() {
    var errs = fieldErrors(['f-geom', 'f-mat', 'f-flight']);
    if (errs.length) return errs;
    var f = state.flight;
    if (f.mode === 'std' && f.launchElev_m + f.aglMax_m > P.STD_LIMIT_M) errs.push({ path: 'flight.aglMax_m', msg: '海拔加高度超過標準大氣模型的上限 ' + fu('altitude', P.STD_LIMIT_M, 0) + ' ' + un('altitude') });
    if (f.mode === 'local' && f.aglMax_m > P.TROPO_LIMIT_M) errs.push({ path: 'flight.aglMax_m', msg: '當地大氣模型只適用於離地 ' + fu('altitude', P.TROPO_LIMIT_M, 0) + ' ' + un('altitude') + ' 以下' });
    if (f.mode === 'local' && !(f.launchT_C > -80 && f.launchT_C < 60)) errs.push({ path: 'flight.launchT_C', msg: '發射場氣溫不在合理範圍' });
    if (state.method === 'bennett') {
      var pf = P.planform(state.geom);
      if (!(pf.eps > 0)) errs.push({ path: 'geom.m_mm', msg: 'Bennett 修正的 ε = ' + pf.eps.toFixed(3) + '，必須大於 0（請檢查弦長與前緣後退長度）' });
    }
    return errs;
  }

  function markInvalid(errs, cids) {
    var bad = {};
    errs.forEach(function (e) { bad[e.path] = true; });
    cids.forEach(function (cid) {
      FIELD_SETS[cid].forEach(function (f) { var w = $('w-' + fid(f)); if (w) w.classList.toggle('invalid', !!bad[f.path]); });
    });
  }

  function pausedBox(errs, what) {
    return '<section class="paused"><h2>' + esc(what) + '已暫停</h2><p>下列輸入有問題，修正後會自動重新計算：</p><ul>' +
      errs.map(function (e) { return '<li>' + esc(e.msg) + '</li>'; }).join('') + '</ul></section>';
  }

  // ================= 分頁：顫振分析 =================
  function trapezoidPts() {
    var g = state.geom;
    return [[0, 0], [g.m_mm, g.b_mm], [g.m_mm + g.c_mm, g.b_mm], [g.r_mm, 0]];
  }

  function renderAnalysis() {
    var out = $('out-analysis'), errs = analysisErrors();
    markInvalid(errs, ['f-geom', 'f-mat', 'f-flight']);
    if (errs.length) { out.innerHTML = pausedBox(errs, '計算'); return; }
    var st = physState(), fl = state.flight, g = state.geom;
    var req = fl.vmax * fl.sf;
    var pt = P.evaluatePoint(st, fl.aglMax_m, fl.vmax);
    var Vn = pt.Vf.nom, Vl = pt.Vf.low, Vh = pt.Vf.high;
    var ratioNom = Vn / req, ratioLow = Vl / req;

    // 三種方法比較
    var mrows = Object.keys(P.METHODS).map(function (k) {
      var r = P.evaluatePoint(physState(k), fl.aglMax_m, fl.vmax);
      return { key: k, valid: r.valid, reason: r.reason, Vf: r.Vf.nom, ratio: r.Vf.nom / req };
    });
    var validM = mrows.filter(function (m) { return m.valid; });
    var worst = validM.reduce(function (a, b) { return a.Vf <= b.Vf ? a : b; });
    var best = validM.reduce(function (a, b) { return a.Vf >= b.Vf ? a : b; });

    var base = ratioNom >= 1.1 ? 'ok' : (ratioNom >= 1 ? 'tight' : 'bad'), notes = [];
    if (base !== 'bad') {
      if (ratioLow < 1) notes.push('G 下限（' + fu('modulus', pt.G.low, state.units === 'si' ? 2 : 0) + ' ' + un('modulus') + '）時，顫振速度低於要求速度');
      if (worst.key !== state.method && worst.ratio < 1) notes.push('「' + P.METHODS[worst.key] + '」算出的顫振速度低於要求速度');
    }
    var cls = base;
    if (base === 'ok' && notes.length) cls = 'tight';
    var label = cls === 'ok' ? '合格' : cls === 'bad' ? '不合格' : (base === 'tight' ? '勉強合格' : '需注意');

    // 警告
    var warns = [];
    if (pt.mach > 1.5) warns.push('這個條件的馬赫數為 ' + fn(pt.mach, 2) + '，超過 1.5。公式是外推，結果不可靠，請用更完整的分析確認。');
    if (best.Vf / worst.Vf > 1.05) warns.push('三種公式的結果差異很大（最低 ' + spd(worst.Vf) + '，最高 ' + spd(best.Vf) + '）。請看下方的方法比較，並以較保守的結果為準。');
    if (g.m_mm > 0 && state.method !== 'bennett') warns.push('目前的公式不計入前緣後退長度（' + fu('length', g.m_mm, 1) + ' ' + un('length') + '）。Bennett 修正會計入，且後掠越大結果越低。');
    if (g.c_mm > g.r_mm) warns.push('尖端弦長大於根部弦長（λ = ' + fn(pt.f.lam, 2) + '），請確認是否填反。');
    if (g.t_mm / g.r_mm > 0.1) warns.push('厚度與根部弦長的比值 t/c_r = ' + fn(g.t_mm / g.r_mm, 3) + '，鰭片相對偏厚，簡化公式的誤差可能變大。');
    if (state.shape && state.shape.length > 4) warns.push('截圖的外形有 ' + state.shape.length + ' 個頂點，計算以梯形近似（根部弦長、尖端弦長、翼展與前緣後退長度）。');

    var max = Math.max(Vh, req, fl.vmax) * 1.12, p = function (x) { return (x / max * 100).toFixed(2); };

    var html = '';
    if (warns.length) html += '<div class="notes">' + warns.map(function (w) { return '<p class="note">' + esc(w) + '</p>'; }).join('') + '</div>';

    html += '<section class="verdict ' + cls + '"><div class="top"><span class="pill"><span>' + label + '</span></span>' +
      '<div class="big">' + fu('speed', Vn, 0) + '<small>' + un('speed') + '</small></div></div>' +
      '<p>顫振速度 V<sub>f</sub>（標稱 G）' + (ratioNom >= 1 ? '高於' : '低於') + '要求速度 ' + spd(req) + '（' + spd(fl.vmax) + ' × 安全係數 ' + fn(fl.sf, 2) + '），' +
      (ratioNom >= 1 ? '餘量 +' : '不足 ') + fn(Math.abs(ratioNom - 1) * 100, 1) + '%。</p>' +
      '<p>G 下限到上限的範圍：' + spd(Vl) + ' 到 ' + spd(Vh) + '（G ±' + fn(state.Gpct, 0) + '%）。</p>' +
      (notes.length ? '<p>' + esc(notes.join('；')) + '。</p>' : '') +
      '<div class="sub">Mach ' + fn(pt.mach, 2) + ' · 此設計可承受的最大飛行速度 ' + spd(Vn / fl.sf) + '（標稱）· ' + esc(P.METHODS[state.method]) + '</div></section>';

    html += '<section class="panel"><h2>速度對照</h2><div class="bar-wrap"><div class="track">' +
      '<div class="fill ' + (ratioNom >= 1.1 ? 'ok' : ratioNom >= 1 ? 'tight' : 'bad') + '" style="width:' + p(Vn) + '%"></div>' +
      '<div class="range-band" style="left:' + p(Vl) + '%;width:' + (p(Vh) - p(Vl)).toFixed(2) + '%"></div>' +
      '<div class="mk vmax" style="left:' + p(fl.vmax) + '%"></div><div class="mk req" style="left:' + p(req) + '%"></div></div>' +
      '<div class="axis"><span>0</span><span>' + fu('speed', max, 0) + ' ' + un('speed') + '</span></div>' +
      '<div class="legend"><span><i class="l-fill ' + (ratioNom >= 1.1 ? '' : ratioNom >= 1 ? 'tight' : 'bad') + '"></i>顫振速度 <b>' + fu('speed', Vn, 0) + '</b></span>' +
      '<span><i class="l-band"></i>G 下限到上限</span>' +
      '<span><i class="l-req"></i>要求 <b>' + fu('speed', req, 0) + '</b></span>' +
      '<span><i class="l-vmax"></i>最大速度 <b>' + fu('speed', fl.vmax, 0) + '</b></span></div></div></section>';

    // G 敏感度
    var srows = [['G 下限（−' + fn(state.Gpct, 0) + '%）', pt.G.low, Vl], ['標稱', pt.G.nom, Vn], ['G 上限（+' + fn(state.Gpct, 0) + '%）', pt.G.high, Vh]];
    html += '<section class="panel"><h2>G 的敏感度</h2><div class="tablewrap"><table><thead><tr><th>情況</th><th class="n">G（' + un('modulus') + '）</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th class="n">對要求速度</th><th>判定</th></tr></thead><tbody>' +
      srows.map(function (r) {
        var rt = r[2] / req, ok = rt >= 1;
        return '<tr><td>' + r[0] + '</td><td class="n">' + fu('modulus', r[1], state.units === 'si' ? 2 : 0) + '</td><td class="n">' + fu('speed', r[2], 0) + '</td><td class="n">' + fn(rt * 100, 0) + '%</td><td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">V<sub>f</sub> 與 √G 成正比。這是輸入不確定度的敏感度，不是機率。</p></section>';

    // 方法比較
    html += '<section class="panel"><h2>三種公式的比較（標稱 G）</h2><div class="tablewrap"><table><thead><tr><th>公式</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th class="n">對要求速度</th><th>判定</th></tr></thead><tbody>' +
      mrows.map(function (m) {
        if (!m.valid) return '<tr><td>' + esc(P.METHODS[m.key]) + '</td><td class="n">—</td><td class="n">—</td><td><span class="tag bad">無法計算</span></td></tr>';
        var ok = m.ratio >= 1;
        return '<tr><td>' + esc(P.METHODS[m.key]) + (m.key === state.method ? '（使用中）' : '') + '</td><td class="n">' + fu('speed', m.Vf, 0) + '</td><td class="n">' + fn(m.ratio * 100, 0) + '%</td><td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">差異的來源請看「方法與來源」分頁。判斷安全性時，請以較保守的結果為準。</p></section>';

    // 建議
    var sN = P.suggestions(st, fl.aglMax_m, req, state.G_GPa), sL = P.suggestions(st, fl.aglMax_m, req, pt.G.low);
    if (sN && sL) {
      var needN = ratioNom < 1, needL = ratioLow < 1;
      var bCell = function (s) { return s.bCap ? '不受翼展限制' : (isFinite(s.b_mm) ? fu('length', Math.floor(s.b_mm * 10) / 10, 1) + ' ' + un('length') : '無法達標'); };
      var btn = function (show, path, val) { return show ? ' <button type="button" class="btn tb-sm" data-set="' + path + '" data-val="' + val + '">套用</button>' : ''; };
      html += '<section class="panel"><h2>' + (needN || needL ? '建議調整（任選一項即可達標）' : '設計餘裕（單項調整的極限）') + '</h2><div class="tablewrap"><table><thead><tr><th>項目</th><th class="n">標稱 G</th><th class="n">G 下限</th><th class="n">目前</th></tr></thead><tbody>' +
        '<tr><td>' + (needN || needL ? '厚度至少' : '厚度最薄可到') + '</td><td class="n">' + fu('length', ceilTo(sN.t_mm, 0.1), 1) + ' ' + un('length') + btn(needN, 'geom.t_mm', ceilTo(sN.t_mm, 0.1)) + '</td><td class="n">' + fu('length', ceilTo(sL.t_mm, 0.1), 1) + ' ' + un('length') + btn(needL, 'geom.t_mm', ceilTo(sL.t_mm, 0.1)) + '</td><td class="n">' + fu('length', g.t_mm, 1) + ' ' + un('length') + '</td></tr>' +
        '<tr><td>' + (needN || needL ? '單片翼展不超過' : '翼展最長可到') + '</td><td class="n">' + bCell(sN) + btn(needN && isFinite(sN.b_mm) && !sN.bCap, 'geom.b_mm', Math.floor(sN.b_mm * 10) / 10) + '</td><td class="n">' + bCell(sL) + btn(needL && isFinite(sL.b_mm) && !sL.bCap, 'geom.b_mm', Math.floor(sL.b_mm * 10) / 10) + '</td><td class="n">' + fu('length', g.b_mm, 1) + ' ' + un('length') + '</td></tr>' +
        '<tr><td>剪切模量至少</td><td class="n">' + fu('modulus', ceilTo(sN.G_GPa, 0.1), state.units === 'si' ? 1 : 0) + ' ' + un('modulus') + btn(needN, 'G_GPa', ceilTo(sN.G_GPa, 0.1)) + '</td><td class="n">（G 下限需達到）' + fu('modulus', ceilTo(sL.G_GPa, 0.1), state.units === 'si' ? 1 : 0) + ' ' + un('modulus') + '</td><td class="n">' + fu('modulus', state.G_GPa, state.units === 'si' ? 1 : 0) + ' ' + un('modulus') + '</td></tr>' +
        '</tbody></table></div><p class="hint">每一項都是各自獨立計算，其餘參數保持目前的輸入，數值已朝合格方向進位。用「G 下限」欄可確保材料偏軟時仍達標。</p></section>';
    }

    // 材料比較
    html += '<section class="panel"><h2>換材料會怎樣（尺寸不變）</h2><div class="tablewrap"><table><thead><tr><th>材料</th><th class="n">G（' + un('modulus') + '）</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th>判定</th><th class="n">達標最小厚度（' + un('length') + '）</th></tr></thead><tbody>' +
      S.MATS.map(function (m) {
        var r = P.evaluatePoint(Object.assign({}, st, { G_GPa: m.G, Gpct: 0 }), fl.aglMax_m, fl.vmax), ok = r.Vf.nom >= req;
        var tmin = g.t_mm * Math.pow(req / r.Vf.nom, 2 / 3);
        return '<tr><td>' + esc(m.name) + '</td><td class="n">' + fu('modulus', m.G, state.units === 'si' ? 1 : 0) + '</td><td class="n">' + fu('speed', r.Vf.nom, 0) + '</td><td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td><td class="n">' + fu('length', ceilTo(tmin, 0.1), state.units === 'si' ? 1 : 2) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

    // 計算過程
    var f = pt.f, shape = state.shape || trapezoidPts();
    var shapeDisp = shape.map(function (q) { return [disp('length', q[0]), disp('length', q[1])]; });
    var formulas = {
      user: 'V<sub>f</sub> = a · √( 2G (t/c<sub>r</sub>)³ (AR+2) / (1.337 · AR³ (λ+1) · P) )',
      martin: 'V<sub>f</sub> = a · √( G (t/c<sub>r</sub>)³ (AR+2) / (1.337 · AR³ (λ+1) · P) )',
      bennett: 'ε = C<sub>x</sub>/c<sub>r</sub> − 0.25　D = (24 ε γ P / π) · AR³ / ((t/c<sub>r</sub>)³ (AR+2)) · (λ+1)/2　V<sub>f</sub> = a · √(G / D)'
    };
    html += '<section class="panel"><h2>計算過程</h2><div class="formula">' + formulas[state.method] + '</div><div class="detail"><div>' +
      CH.finShape(shapeDisp, { cr: 'cr ' + fn(disp('length', g.r_mm), state.units === 'si' ? 0 : 2), ct: 'ct ' + fn(disp('length', g.c_mm), state.units === 'si' ? 0 : 2), b: 'b ' + fn(disp('length', g.b_mm), state.units === 'si' ? 0 : 2) }) +
      '</div><dl>' +
      '<dt>錐度比 λ = c<sub>t</sub>/c<sub>r</sub></dt><dd>' + fn(f.lam, 3) + '</dd>' +
      '<dt>面積 S</dt><dd>' + fn(f.S * 1e6 / (state.units === 'si' ? 1 : 645.16), state.units === 'si' ? 0 : 2) + ' ' + (state.units === 'si' ? 'mm²' : 'in²') + '</dd>' +
      '<dt>展弦比 AR = b²/S</dt><dd>' + fn(f.AR, 3) + '</dd>' +
      '<dt>厚度比 t/c<sub>r</sub></dt><dd>' + fn(f.tau, 4) + '</dd>' +
      '<dt>形心 C<sub>x</sub>、ε</dt><dd>' + fu('length', f.Cx * 1000, 1) + ' ' + un('length') + '、' + fn(f.eps, 3) + '</dd>' +
      '<dt>音速 a</dt><dd>' + spd(pt.atm.a, 1) + '</dd>' +
      '<dt>氣壓 P</dt><dd>' + fu('pressure', pt.atm.p, state.units === 'si' ? 1 : 3) + ' ' + un('pressure') + '</dd>' +
      '<dt>溫度 T</dt><dd>' + fu('temp', pt.atm.T - 273.15, 1) + ' ' + un('temp') + '</dd>' +
      '<dt>顫振速度 V<sub>f</sub></dt><dd>' + spd(Vn, 1) + '</dd></dl></div></section>';
    out.innerHTML = html;
  }

  // ================= 分頁：飛行軌跡 =================
  function renderTraj() {
    var out = $('out-traj'), tj = state.traj;
    $('btnTrajClear').hidden = !tj;
    if (!tj) {
      out.innerHTML = '<section class="panel"><h2>還沒有軌跡資料</h2><p class="info">在 OpenRocket 的模擬結果視窗按「Plot / Export」，在 Export data 分頁選好欄位後匯出 CSV，再把檔案拖到左側。匯入後會逐點計算顫振餘量，找出整個飛行中最危險的一點。</p>' +
        '<p class="hint">需要的欄位：Time、Altitude、Total velocity。預設匯出的檔案可直接使用。</p></section>';
      return;
    }
    var errs = analysisErrors();
    if (errs.length) { out.innerHTML = pausedBox(errs, '軌跡評估'); return; }
    var res = P.evaluateTrajectory(physState(), tj.rows), fl = state.flight;
    if (res.outOfRange > 0) {
      out.innerHTML = pausedBox([{ msg: '有 ' + res.outOfRange + ' 個取樣點的高度超出大氣模型範圍（標準大氣 ' + fu('altitude', P.STD_LIMIT_M, 0) + ' ' + un('altitude') + '，當地大氣 ' + fu('altitude', P.TROPO_LIMIT_M, 0) + ' ' + un('altitude') + '）。請檢查高度單位或大氣模型。' }], '軌跡評估');
      return;
    }
    var reqMargin = (fl.sf - 1) * 100, mm = res.minMargin;
    var cls = !isNum(mm) ? 'tight' : mm >= reqMargin * 1.1 + 0 ? 'ok' : mm >= 0 ? 'tight' : 'bad';
    if (isNum(mm) && mm >= reqMargin) cls = 'ok'; else if (isNum(mm) && mm >= 0) cls = 'tight';
    var mi = res.rows[res.minIdx] || {}, qi = res.rows[res.maxQIdx] || {}, xi = res.rows[res.maxMachIdx] || {};
    var peakV = res.rows.reduce(function (a, r) { return Math.max(a, r.v); }, 0);
    var html = '<div class="notes">';
    if (res.supersonicRows > 0) html += '<p class="note">' + res.supersonicRows + ' 個取樣點的馬赫數超過 1.5（最高 ' + fn(res.maxMach, 2) + '）。這些點的結果是外推，不可靠。</p>';
    if (res.invalid > 0) html += '<p class="note">有 ' + res.invalid + ' 個取樣點無法用目前的公式計算。</p>';
    html += '<p class="note">只計算取樣點，點與點之間不內插。取樣太稀疏時，最小餘量可能被低估或高估。</p></div>';
    html += '<section class="panel"><h2>最小餘量（G 下限）</h2><div class="tiles">' +
      '<div class="tile ' + cls + '"><span class="k">最小顫振餘量</span><span class="v">' + (isNum(mm) ? (mm >= 0 ? '+' : '') + fn(mm, 1) + '%' : '—') + '</span><span class="s">要求 +' + fn(reqMargin, 0) + '%（安全係數 ' + fn(fl.sf, 2) + '）</span></div>' +
      '<div class="tile"><span class="k">發生在</span><span class="v">' + fn(mi.t, 2) + ' s</span><span class="s">' + fu('altitude', mi.alt, 0) + ' ' + un('altitude') + '，' + spd(mi.v) + '，Mach ' + fn(mi.mach, 2) + '</span></div>' +
      '<div class="tile"><span class="k">該點的顫振速度（G 下限）</span><span class="v">' + spd(mi.VfLow) + '</span><span class="s">標稱 ' + spd(mi.VfNom) + '</span></div>' +
      '<div class="tile"><span class="k">最大動壓 q</span><span class="v">' + qStr(qi.q) + '</span><span class="s">' + fn(qi.t, 2) + ' s，' + fu('altitude', qi.alt, 0) + ' ' + un('altitude') + '</span></div>' +
      '<div class="tile"><span class="k">最高 Mach</span><span class="v">' + fn(res.maxMach, 2) + '</span><span class="s">' + fn(xi.t, 2) + ' s，' + spd(xi.v) + '</span></div>' +
      '<div class="tile"><span class="k">最高速度</span><span class="v">' + spd(peakV) + '</span><span class="s">' + tj.rows.length + ' 個取樣點，共 ' + fn(tj.rows[tj.rows.length - 1].t, 1) + ' s</span></div></div>' +
      '<p class="hint">' + esc(tj.name) + ' · 公式：' + esc(P.METHODS[state.method]) + '</p></section>';

    var k = state.units === 'si' ? 1 : 1 / U.constants.FT;
    var series = [
      { name: '飛行速度', cls: 's-speed', pts: res.rows.map(function (r) { return [r.t, r.v * k]; }) },
      { name: '要求（速度 × 安全係數）', cls: 's-req', pts: res.rows.map(function (r) { return [r.t, r.v * fl.sf * k]; }) },
      { name: '顫振速度（G 下限）', cls: 's-low', pts: res.rows.map(function (r) { return [r.t, r.VfLow * k]; }) },
      { name: '顫振速度（標稱）', cls: 's-nom', pts: res.rows.map(function (r) { return [r.t, r.VfNom * k]; }) },
      { name: '顫振速度（G 上限）', cls: 's-high', pts: res.rows.map(function (r) { return [r.t, r.VfHigh * k]; }) }
    ];
    var yMax = Math.max(peakV * fl.sf, 1) * 1.15 * k;
    html += '<section class="panel"><h2>速度與顫振速度</h2><div class="chart">' +
      CH.lineChart({ title: '飛行速度與顫振速度隨時間變化', xLabel: '時間（s）', yLabel: '速度（' + un('speed') + '）', series: series, yMax: yMax,
        marks: isNum(mm) ? [{ x: mi.t, y: mi.VfLow * k, cls: '', label: '最小餘量 ' + fn(mm, 1) + '%' }] : [] }) +
      '</div>' + CH.legend([{ cls: 'l-speed', name: '飛行速度' }, { cls: 'l-req', name: '要求' }, { cls: 'l-low', name: '顫振速度（G 下限）' }, { cls: 'l-nom', name: '標稱' }, { cls: 'l-high', name: 'G 上限' }]) +
      '<p class="hint">紅色圓點是最小餘量的位置。顫振速度曲線會隨高度（空氣變稀薄）變化。</p></section>';

    var low = res.rows.filter(function (r) { return r.v > 0 && isNum(r.marginLow); }).sort(function (a, b) { return a.marginLow - b.marginLow; }).slice(0, 10);
    html += '<section class="panel"><h2>餘量最低的 10 個取樣點</h2><div class="tablewrap"><table><thead><tr><th class="n">時間（s）</th><th class="n">高度（' + un('altitude') + '）</th><th class="n">速度（' + un('speed') + '）</th><th class="n">Mach</th><th class="n">V<sub>f</sub> 下限（' + un('speed') + '）</th><th class="n">餘量</th></tr></thead><tbody>' +
      low.map(function (r) {
        return '<tr><td class="n">' + fn(r.t, 2) + '</td><td class="n">' + fu('altitude', r.alt, 0) + '</td><td class="n">' + fu('speed', r.v, 0) + '</td><td class="n">' + fn(r.mach, 2) + '</td><td class="n">' + fu('speed', r.VfLow, 0) + '</td><td class="n">' + (r.marginLow >= 0 ? '+' : '') + fn(r.marginLow, 1) + '%</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pts-actions no-print"><button type="button" class="btn" id="btnTrajCsv">匯出全部評估結果（CSV）</button></div></section>';
    out.innerHTML = html;
    $('btnTrajCsv').addEventListener('click', function () {
      var info = { tool: '鰭片顫振計算器', file: tj.name, method: P.METHODS[state.method], 'G_nominal_GPa': state.G_GPa, 'G_sensitivity_pct': state.Gpct, units: 'SI' };
      download('flutter-trajectory-' + stamp() + '.csv', CSV.evaluatedCsv(res.rows, info), 'text/csv');
      toolMsg('已匯出評估結果 CSV。', 'ok');
    });
  }

  function loadTrajectoryText(name, text) {
    var st = $('trajStatus');
    try {
      var r = CSV.parse(text);
      state.traj = { name: name, rows: r.rows };
      st.textContent = '已讀取 ' + r.rows.length + ' 列。使用欄位：' + r.meta.time + '、' + r.meta.altitude + '、' + r.meta.velocity + '。';
      st.className = 'scan-status ok';
    } catch (e) {
      st.textContent = '匯入失敗：' + e.message;
      st.className = 'scan-status bad';
    }
    renderAll();
  }

  function readTrajFile(file) {
    if (!file) return;
    if (file.size > CSV.MAX_CHARS * 2) { loadTrajectoryText(file.name, ''); return; }
    var fr = new FileReader();
    fr.onload = function () { loadTrajectoryText(file.name, String(fr.result)); };
    fr.onerror = function () { $('trajStatus').textContent = '讀取檔案失敗。'; $('trajStatus').className = 'scan-status bad'; };
    fr.readAsText(file);
  }

  // ================= 分頁：渦流與模態 =================
  function operatingSpeed() {
    var tj = state.traj, v = state.flight.vmax;
    if (tj) v = Math.max(v, tj.rows.reduce(function (a, r) { return Math.max(a, r.v); }, 0));
    return v;
  }

  function renderModeList() {
    var box = $('modeList');
    if (!state.vortex.modes.length) { box.innerHTML = '<p class="hint">還沒有模態頻率。按下方「新增模態」加入，沒有的話可以留空。</p>'; return; }
    box.innerHTML = state.vortex.modes.map(function (f, i) {
      return '<div class="mode-row"><div class="field"><label for="mode' + i + '">第 ' + (i + 1) + ' 模態</label><div class="inp"><input id="mode' + i + '" type="number" step="any" inputmode="decimal" value="' + (f === null ? '' : esc(f)) + '"><span class="unit">Hz</span></div></div>' +
        '<button type="button" class="btn tb-sm" data-rm="' + i + '">移除</button></div>';
    }).join('');
    state.vortex.modes.forEach(function (f, i) {
      $('mode' + i).addEventListener('input', function (e) {
        var v = parseFloat(e.target.value);
        state.vortex.modes[i] = isFinite(v) ? v : null;
        schedule();
      });
    });
    box.querySelectorAll('[data-rm]').forEach(function (b) {
      b.addEventListener('click', function () { state.vortex.modes.splice(parseInt(b.getAttribute('data-rm'), 10), 1); renderModeList(); schedule(); });
    });
  }

  function renderVortex() {
    var out = $('out-vortex'), errs = fieldErrors(['f-vortex', 'f-sdof']);
    markInvalid(errs, ['f-vortex', 'f-sdof']);
    var sd = $('sdofOut');
    var v = state.vortex;
    if (isNum(v.k_Npm) && isNum(v.m_g) && v.k_Npm > 0 && v.m_g > 0) {
      var fe = P.singleDof(v.k_Npm, v.m_g);
      sd.innerHTML = '<p class="info">估算的模態頻率：<b>' + fn(fe, 1) + ' Hz</b>。只用你填的等效值計算，要確認兩者用同一種正規化。</p><div class="pts-actions"><button type="button" class="btn tb-sm" id="btnSdofAdd">加入模態清單</button></div>';
      $('btnSdofAdd').addEventListener('click', function () { v.modes.push(Math.round(fe * 10) / 10); renderModeList(); schedule(); });
    } else sd.innerHTML = '';
    if (errs.length) { out.innerHTML = pausedBox(errs, '渦流篩選'); return; }
    var Uop = operatingSpeed(), St = v.St, L = v.L_mm, tol = v.tolPct;
    var fs = P.strouhal(St, L, Uop);
    var modes = v.modes.filter(function (f) { return isNum(f) && f > 0; });
    var html = '<div class="notes"><p class="note">這是篩選，不是顫振預測。頻帶相交只代表渦流脫落頻率可能接近某個結構模態，需要用 CFD、風洞或試飛確認。預設的 St 與特徵長度只是示意值。</p></div>';
    html += '<section class="panel"><h2>渦流脫落頻率</h2><div class="tiles">' +
      '<div class="tile"><span class="k">檢查速度</span><span class="v">' + spd(Uop) + '</span><span class="s">' + (state.traj ? '軌跡的最高速度或最大速度，取較大者' : '預期最大速度') + '</span></div>' +
      '<div class="tile"><span class="k">渦流脫落頻率 f<sub>s</sub></span><span class="v">' + fn(fs, 0) + ' Hz</span><span class="s">f<sub>s</sub> = St · U / L</span></div>' +
      '<div class="tile"><span class="k">角頻率 ω<sub>s</sub></span><span class="v">' + fn(2 * Math.PI * fs, 0) + ' rad/s</span><span class="s">St = ' + fn(St, 3) + '，L = ' + fu('length', L, state.units === 'si' ? 2 : 3) + ' ' + un('length') + '</span></div></div></section>';
    if (modes.length) {
      html += '<section class="panel"><h2>與結構模態的相交</h2><div class="tablewrap"><table><thead><tr><th class="n">模態（Hz）</th><th class="n">相交速度（' + un('speed') + '）</th><th class="n">頻帶速度範圍（' + un('speed') + '）</th><th>與檢查速度的關係</th></tr></thead><tbody>' +
        modes.map(function (f) {
          var b = P.modeBand(f, tol, St, L), c, t;
          if (b.center <= Uop) { c = 'bad'; t = '相交速度在檢查速度內'; }
          else if (b.lo <= Uop) { c = 'tight'; t = '頻帶下緣已進入'; }
          else { c = 'ok'; t = '頻帶在檢查速度之上'; }
          return '<tr><td class="n">' + fn(f, 1) + '</td><td class="n">' + fu('speed', b.center, 0) + '</td><td class="n">' + fu('speed', b.lo, 0) + ' 到 ' + fu('speed', b.hi, 0) + '</td><td><span class="tag ' + c + '">' + t + '</span></td></tr>';
        }).join('') + '</tbody></table></div></section>';
      var k = state.units === 'si' ? 1 : 1 / U.constants.FT, xMax = Uop * 1.2;
      var bands = modes.map(function (f) { return { y0: f * (1 - tol / 100), y1: f * (1 + tol / 100), cls: '' }; });
      var marks = modes.map(function (f) { var xc = P.crossingSpeed(f, St, L); return xc <= xMax ? { x: xc * k, y: f, cls: '', label: '相交 ' + fn(xc * k, 0) + ' ' + un('speed') } : null; }).filter(Boolean);
      var yMax = Math.max(P.strouhal(St, L, xMax), Math.max.apply(null, modes) * (1 + tol / 100)) * 1.08;
      html += '<section class="panel"><h2>頻率與速度</h2><div class="chart">' +
        CH.lineChart({ title: '渦流脫落頻率與結構模態頻帶', xLabel: '速度（' + un('speed') + '）', yLabel: '頻率（Hz）', xMax: xMax * k, yMax: yMax, bands: bands, marks: marks,
          series: [{ name: '渦流脫落頻率', cls: 's-nom', pts: [[0, 0], [xMax * k, P.strouhal(St, L, xMax)]] }] }) +
        '</div>' + CH.legend([{ cls: 'l-nom', name: '渦流脫落頻率 f_s' }, { cls: 'l-band', name: '模態 ± ' + fn(tol, 0) + '%' }]) +
        '<p class="hint">頻帶只是你選的接近範圍，不是預測的鎖定區間，也不是驗收餘量。</p></section>';
    } else {
      html += '<section class="panel"><h2>與結構模態的相交</h2><p class="info">還沒有模態頻率。在左側新增後，會顯示相交速度與圖表。</p></section>';
    }
    out.innerHTML = html;
  }

  // ================= 分頁：安裝與配重 =================
  function renderMass() {
    var out = $('out-mass'), errs = fieldErrors(['f-mass1', 'f-mass2', 'f-mass3']).concat(fieldErrors(['f-geom']).filter(function (e) { return true; }));
    var needDensity = !(state.density_gcc > 0) ? [{ path: 'density_gcc', msg: '密度必須大於 0' }] : [];
    errs = errs.concat(needDensity);
    markInvalid(errs, ['f-mass1', 'f-mass2', 'f-mass3', 'f-mat', 'f-geom']);
    if (errs.length) { out.innerHTML = pausedBox(errs, '配重計算'); return; }
    var fl = state.flight, ae = analysisErrors();
    var q = null, qNote = '';
    if (!ae.length) {
      var pt = P.evaluatePoint(physState(), fl.aglMax_m, fl.vmax);
      q = pt.q; qNote = '預期最大速度與其高度';
      if (state.traj) {
        var tr = P.evaluateTrajectory(physState(), state.traj.rows);
        if (tr.outOfRange === 0 && tr.maxQ > q) { q = tr.maxQ; qNote = '軌跡的最大動壓'; }
      }
    }
    var m = state.mass, ms = {
      fins: m.fins, density_gcc: state.density_gcc, addMass_g: m.addMass_g, assemblyX_mm: m.assemblyX_mm, baseM_g: m.baseM_g, baseX_mm: m.baseX_mm,
      cp_mm: m.cp_mm, od_mm: m.od_mm, Cn: m.Cn, lever_mm: m.lever_mm === null ? 0 : m.lever_mm
    };
    var r = P.massStudy(state.geom, ms, q === null ? -1 : q);
    var massD = function (g) { return fu('mass', g, state.units === 'si' ? 1 : 2) + ' ' + un('mass'); };
    var html = '<section class="panel"><h2>質量與重心</h2><div class="tiles">' +
      '<div class="tile"><span class="k">單片鰭片質量</span><span class="v">' + massD(r.finMass_g) + '</span><span class="s">S · t · ρ（外露部分）</span></div>' +
      '<div class="tile"><span class="k">鰭片組總質量</span><span class="v">' + massD(r.assembly_g) + '</span><span class="s">' + fn(m.fins, 0) + ' 片 + 附加 ' + massD(m.addMass_g) + '</span></div>' +
      '<div class="tile"><span class="k">合成重心</span><span class="v">' + (isNum(r.cg_mm) ? fu('length', r.cg_mm, 1) + ' ' + un('length') : '—') + '</span><span class="s">' + (isNum(r.cg_mm) ? '含鰭片組後的整體重心' : '需填基準質量與兩個重心位置') + '</span></div>' +
      '<div class="tile ' + (isNum(r.staticMargin_cal) ? (r.staticMargin_cal >= 1.5 ? 'ok' : r.staticMargin_cal >= 1 ? 'tight' : 'bad') : '') + '"><span class="k">靜態餘裕</span><span class="v">' + (isNum(r.staticMargin_cal) ? fn(r.staticMargin_cal, 2) + ' cal' : '—') + '</span><span class="s">' + (isNum(r.staticMargin_cal) ? '(CP − CG) / 外徑' : '需填 CP 與外徑') + '</span></div></div>' +
      '<p class="hint">這個工具不計算 CP 或整體穩定性。靜態餘裕只是用你提供的 CP 與合成重心算出的數字。</p></section>';
    html += '<section class="panel"><h2>載荷</h2>';
    if (q === null) html += '<p class="info">飛行條件還有問題，無法算動壓。請先到「顫振分析」分頁修正輸入。</p>';
    else {
      html += '<div class="tiles"><div class="tile"><span class="k">動壓 q</span><span class="v">' + qStr(q) + '</span><span class="s">' + qNote + '</span></div>' +
        '<div class="tile"><span class="k">單片法向力</span><span class="v">' + fn(disp('force', r.F_N), 0) + ' ' + un('force') + '</span><span class="s">F = q · S · Cn</span></div>' +
        '<div class="tile"><span class="k">根部力矩</span><span class="v">' + (m.lever_mm === null ? '—' : fn(disp('moment', r.M_Nm), 1) + ' ' + un('moment')) + '</span><span class="s">' + (m.lever_mm === null ? '需填力臂' : 'M = F · 力臂') + '</span></div></div>' +
        '<p class="hint">不計算扭轉、剝離應力、膠的容許值、框架剛度、挫屈與強度。這些需要另外分析。</p>';
    }
    html += '</section>';
    if (m.note && m.note.trim()) html += '<section class="panel"><h2>安裝與載荷路徑說明</h2><p style="white-space:pre-wrap;margin:0">' + esc(m.note) + '</p></section>';
    out.innerHTML = html;
  }

  // ================= 分頁：方法與來源 =================
  function renderMethods() {
    $('methodsText').innerHTML =
      '<h2 style="margin:0;font-size:18px">方法與來源</h2>' +
      '<p>這個工具是設計初期的篩選用計算，把鰭片當成「均勻、薄、各向同性的梯形平板」。它不是氣動彈性分析，也不能取代試飛或正式的結構與顫振驗證。</p>' +
      '<h3>三種顫振公式</h3>' +
      '<pre>λ = c_t / c_r\nS = (c_r + c_t) · b / 2\nAR = b² / S\nτ = t / c_r\n\n你提供的公式：\nV_f = a · √( 2G τ³ (AR+2) / (1.337 · AR³ (λ+1) · P) )\n\n固定 ε = 0.25（去掉多出的 2）：\nV_f = a · √( G τ³ (AR+2) / (1.337 · AR³ (λ+1) · P) )\n\nBennett 形心修正：\nC_x = (2·c_t·m + c_t² + m·c_r + c_t·c_r + c_r²) / (3 (c_t + c_r))\nε = C_x / c_r − 0.25\nD = (24 ε γ P / π) · AR³ / (τ³ (AR+2)) · (λ+1)/2\nV_f = a · √(G / D)</pre>' +
      '<p>m 是尖端前緣相對根部前緣往後退的距離，γ = 1.4。當 ε = 0.25 時，Bennett 的式子化簡後和你提供的公式只差一個因子 2，也就是 V<sub>f</sub> 差 √2（約 41%）。這是可以用代數驗證的事實。</p>' +
      '<div class="warnbox">哪一個才正確，這個工具無法替你判定。Bennett 的方法文件主張，較舊的公式多算了一次因子 2，使顫振速度被高估。此外 Bennett 修正把前緣後退（後掠）算進形心，後掠越大，ε 越大，算出的顫振速度越低，與「後掠會提高顫振速度」的常見說法相反。判斷安全性時，請以三者中較保守的結果為準，並用更完整的分析確認。</div>' +
      '<h3>大氣</h3>' +
      '<p>標準大氣（1976）：T = 288.15 − 0.0065·h，P 由等溫壓力公式計算，11 到 20 km 為等溫層。「標準大氣」用發射場海拔加離地高度。「當地大氣」以發射場的氣溫與測站絕對氣壓為起點，只用對流層模型，離地高度上限 11 km。音速 a = √(γ R T)。馬赫數超過 1.5 時，工具會標示為外推。</p>' +
      '<h3>G 的敏感度</h3>' +
      '<p>在幾何與大氣不變時，G 改變 ±u% 會使 V<sub>f</sub> 依 √(1 ± u) 改變。這是輸入不確定度的敏感度，不是統計上的信賴區間。</p>' +
      '<h3>飛行軌跡</h3>' +
      '<p>逐點算顫振速度與餘量：餘量 = 100 · (V<sub>f</sub> / U − 1)，使用 G 下限。報告最小餘量與最大動壓 q = ½ρU²。只計算取樣點，不內插、不外推，也不做質量修正或飛行模擬。</p>' +
      '<h3>渦流與模態</h3>' +
      '<pre>St = f_s · L / U\nf_s = St · U / L\nU_cross = f_n · L / St</pre>' +
      '<p>頻帶是你選的接近範圍，不是預測的鎖定區間。預設的 St = 0.2 與特徵長度只是示意值，不是鰭片的實測關聯式。雷諾數、馬赫數與外形的影響需另外處理。單自由度估算 f = √(k/m) / 2π 只使用你填入且正規化一致的等效值。</p>' +
      '<h3>安裝與配重</h3>' +
      '<pre>外露鰭片質量 = S · t · ρ\n鰭片組質量 = 片數 · 單片質量 + 附加質量\nCG = (M·x + 鰭片組質量·x_fin) / (M + 鰭片組質量)\n靜態餘裕 = (CP − CG) / 外徑\n單片法向力 F = q · S · Cn\n根部力矩 = F · 力臂</pre>' +
      '<h3>不處理的項目</h3>' +
      '<ul><li>翼型剖面、斜削邊、厚度變化、密度不均、混合層板</li><li>根部柔度、圓角、支撐、固定件滑動</li><li>扭轉、剝離應力、膠的容許值、挫屈與強度</li><li>有風時的對空速度修正</li></ul>' +
      '<h3>驗證</h3>' +
      '<p>自動測試確認：大氣數值、公式的代數關係、單位換算、CSV 解析，以及 Bennett 公開的基準案例（英制範例，顫振速度約 2087.3 ft/s、餘量約 39.15%）。測試只能證明程式實作與這些數字一致，不代表飛行安全。</p>' +
      '<h3>來源</h3>' +
      '<ul><li>Martin, H. C., NACA Technical Note 4197, 1958（顫振公式的原始來源）</li><li>John K. Bennett 在 Peak of Flight 的鰭片顫振文章與試算表（形心修正與基準案例）</li><li>U.S. Standard Atmosphere, 1976</li><li>NASA TM-2016-219166（Strouhal 篩選的架構）</li></ul>' +
      '<p>形心修正與渦流篩選的描述，依據公開的 STAR Fin Lab 方法文件整理。本程式的程式碼為獨立撰寫，沒有使用該專案的程式碼。</p>';
  }

  // ================= 總控 =================
  function renderAll() {
    var jobs = [['out-analysis', renderAnalysis], ['out-traj', renderTraj], ['out-vortex', renderVortex], ['out-mass', renderMass]];
    jobs.forEach(function (j) {
      try { j[1](); } catch (e) { var el = $(j[0]); if (el) el.innerHTML = '<section class="paused"><h2>顯示時發生錯誤</h2><p>' + esc(e && e.message ? e.message : e) + '</p></section>'; if (window.console) console.error(e); }
    });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(renderAll, 60); }

  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    document.querySelectorAll('.tabpanel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
  }

  // ================= 單位、存檔、匯出入、列印 =================
  function setUnits(sys, persist) {
    state.units = sys;
    $('unitSi').setAttribute('aria-pressed', sys === 'si' ? 'true' : 'false');
    $('unitImp').setAttribute('aria-pressed', sys === 'imperial' ? 'true' : 'false');
    refreshInputs(true);
    renderAll();
    if (persist) S.storeSet('prefs', { units: sys }).catch(function () {});
  }

  function exportable() {
    var c = S.clone(state);
    c.vortex.modes = c.vortex.modes.filter(isNum);
    return c;
  }

  function adopt(newState, keepTraj) {
    var traj = state.traj;
    state = newState;
    if (keepTraj) state.traj = traj;
    setUnits(state.units, true);
    renderModeList();
    $('trajStatus').textContent = state.traj ? '已載入軌跡：' + state.traj.name : '';
    $('trajStatus').className = 'scan-status' + (state.traj ? ' ok' : '');
  }

  function refreshSnapList() {
    S.listSnapshots().then(function (list) {
      var box = $('snapList');
      if (!list.length) { box.innerHTML = '<p class="hint">還沒有存檔。輸入名稱後按「存檔目前設定」。</p>'; return; }
      box.innerHTML = list.map(function (s) {
        return '<div class="snap-row"><div><div class="snap-name">' + esc(s.name) + '</div><div class="snap-time">' + esc(new Date(s.savedAt).toLocaleString()) + '</div></div>' +
          '<button type="button" class="btn tb-sm" data-load="' + esc(s.id) + '">載入</button><button type="button" class="tb tb-sm" data-del="' + esc(s.id) + '">刪除</button></div>';
      }).join('');
      box.querySelectorAll('[data-load]').forEach(function (b) {
        b.addEventListener('click', function () {
          var snap = list.filter(function (s) { return s.id === b.getAttribute('data-load'); })[0];
          if (!snap) return;
          var r = S.sanitize(snap.state);
          adopt(r.state, true);
          toolMsg('已載入「' + snap.name + '」。' + (r.problems.length ? '\n' + r.problems.join('\n') : ''), 'ok');
        });
      });
      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () { S.deleteSnapshot(b.getAttribute('data-del')).then(refreshSnapList); });
      });
    });
  }

  function wireToolbar() {
    $('unitSi').addEventListener('click', function () { setUnits('si', true); });
    $('unitImp').addEventListener('click', function () { setUnits('imperial', true); });
    $('btnSnaps').addEventListener('click', function () {
      var p = $('snapPanel'), open = p.hidden;
      p.hidden = !open; $('btnSnaps').setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refreshSnapList();
    });
    $('btnSnapSave').addEventListener('click', function () {
      var name = $('snapName').value.trim() || ('設計 ' + new Date().toLocaleString());
      S.addSnapshot(name, exportable()).then(function () { $('snapName').value = ''; refreshSnapList(); toolMsg('已存檔「' + name + '」。', 'ok'); })
        .catch(function () { toolMsg('存檔失敗，可能是儲存空間不足。', 'bad'); });
    });
    $('btnExport').addEventListener('click', function () {
      download('fin-flutter-case-' + stamp() + '.json', S.exportCase(exportable()), 'application/json');
      toolMsg('已匯出案例（含所有輸入與飛行軌跡）。', 'ok');
    });
    $('importJson').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { toolMsg('匯入失敗：檔案超過 8 MB。目前的設定沒有變動。', 'bad'); e.target.value = ''; return; }
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var r = S.importCase(String(fr.result));
          adopt(r.state, false);
          toolMsg('已匯入「' + file.name + '」。' + (r.problems.length ? '\n' + r.problems.join('\n') : ''), 'ok');
        } catch (err) { toolMsg('匯入失敗：' + err.message + '目前的設定沒有變動。', 'bad'); }
        e.target.value = '';
      };
      fr.readAsText(file);
    });
    $('btnPrint').addEventListener('click', function () {
      $('printHead').textContent = '鰭片顫振計算器 · ' + new Date().toLocaleString() + ' · ' + P.METHODS[state.method] + ' · ' + (state.units === 'si' ? '公制' : '英制');
      window.print();
    });
  }

  function wireMisc() {
    document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
    $('massNote').addEventListener('input', function (e) { state.mass.note = e.target.value; schedule(); });
    $('btnAddMode').addEventListener('click', function () { if (state.vortex.modes.length < 12) { state.vortex.modes.push(null); renderModeList(); schedule(); } });
    $('trajFile').addEventListener('change', function (e) { readTrajFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    var td = $('trajDrop');
    ['dragenter', 'dragover'].forEach(function (n) { td.addEventListener(n, function (e) { e.preventDefault(); td.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { td.addEventListener(n, function () { td.classList.remove('over'); }); });
    td.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readTrajFile(f); });
    $('btnTrajClear').addEventListener('click', function () { state.traj = null; $('trajStatus').textContent = ''; $('trajStatus').className = 'scan-status'; renderAll(); });
    // 建議值的「套用」按鈕（事件委派）
    $('out-analysis').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-set]') : null;
      if (!b) return;
      var path = b.getAttribute('data-set'), val = parseFloat(b.getAttribute('data-val'));
      if (!isFinite(val)) return;
      setPath(state, path, val);
      if (path === 'geom.b_mm') state.shape = null;
      if (path === 'G_GPa') { var hit = S.MATS.filter(function (m) { return Math.abs(m.G - val) < 1e-9; })[0]; state.mat = hit ? hit.id : 'custom'; }
      refreshInputs(true);
      renderAll();
    });
  }

  // 給截圖辨識使用
  window.FinApp = {
    applyGeometry: function (g) {
      ['r_mm', 'c_mm', 'b_mm', 'm_mm', 't_mm'].forEach(function (k) { if (isNum(g[k])) state.geom[k] = g[k]; });
      state.shape = g.pointsMm && g.pointsMm.length >= 3 ? g.pointsMm : null;
      refreshInputs(true);
      renderAll();
    },
    getThickness: function () { return state.geom.t_mm; },
    getG: function () { return state.G_GPa; }
  };

  // ================= 啟動 =================
  buildFields();
  wireToolbar();
  wireMisc();
  renderMethods();
  renderModeList();
  showTab('analysis');
  setUnits('si', false);
  S.storeGet('prefs').then(function (p) { if (p && (p.units === 'si' || p.units === 'imperial') && p.units !== state.units) setUnits(p.units, false); }).catch(function () {});
})();
