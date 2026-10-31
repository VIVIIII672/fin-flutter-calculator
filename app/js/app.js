/* 主程式：欄位、檢查、五個分頁的計算與顯示、存檔與匯出入、列印 */
(function () {
  'use strict';
  var P = window.FinPhysics, U = window.FinUnits, CSV = window.FinCSV, S = window.FinState, CH = window.FinCharts;
  var $ = function (id) { return document.getElementById(id); };
  var O = window.FinOrk;
  var state = S.defaults();
  var ui = { sweep: 't', ork: null, adv: null };
  var SV = window.FinSolver;
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
      { type: 'select', path: 'judge', label: '判定依據', wide: true },
      { type: 'select', path: 'method', label: '指定的公式（只在「只用上面選的公式」時使用）', wide: true }
    ],
    'f-adv': [
      { path: 'adv.nu', label: '蒲松比 ν', sym: 'ν', dim: 'none', gt: true, max: 0.49, hint: '用來由 G 算出 E = 2G(1+ν)。玻纖約 0.15 到 0.3，鋁約 0.33。' },
      { type: 'select', path: 'adv.model', label: '氣動力模型', wide: true }
    ],
    'f-corr': [
      { type: 'select', path: 'corr.sect', label: '剖面形狀', wide: true },
      { path: 'corr.bevelLE_pct', label: '前緣斜削長度（佔弦長）', dim: 'pct', ge: true, max: 45, showIf: function (s) { return s.corr.sect === 'bevel'; } },
      { path: 'corr.bevelTE_pct', label: '後緣斜削長度（佔弦長）', dim: 'pct', ge: true, max: 45, showIf: function (s) { return s.corr.sect === 'bevel'; } },
      { path: 'corr.rootK', label: '根部剛度 ÷ 鰭片懸臂剛度', dim: 'none', opt: true, gt: true, wide: true, hint: '留空表示剛性固定。數值越小，根部越軟，顫振速度依 √[k/(1+k)] 折減。可由 FEA 的根部轉動剛度估出。' }
    ],
    'f-thermal': [
      { path: 'thermal.finT_C', label: '鰭片溫度', dim: 'temp', opt: true, wide: true },
      { path: 'thermal.kLoss', label: 'G 的損失（每升高 100 °C）', dim: 'pct', ge: true, max: 100, wide: true, hint: '預設 10% 只是粗略值，不同材料差很多（環氧樹脂接近玻璃轉移溫度時會急遽下降）。' }
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
    if (path === 'adv.model') return [['auto', '自動（依 Mach 混合）'], ['subsonic', '只用低速模型'], ['piston', '只用活塞理論（Mach ≥ 1.5 才合理）']];
    if (path === 'corr.sect') return [['flat', '平板（不修正）'], ['bevel', '前後緣斜削'], ['wedge', '雙楔形（中間最厚）'], ['biconvex', '雙凸形（拋物線）']];
    if (path === 'judge') return [['conservative', '最保守（三種公式取最低）'], ['selected', '只用下面指定的公式']];
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
      if (m) { state.G_GPa = m.G; state.density_gcc = m.rho; state.Gpct = Math.max(10, Math.ceil(100 * Math.max((m.hi - m.G) / m.G, (m.G - m.lo) / m.G))); refreshInputs(true); }
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
    if ($('btnCnClear')) $('btnCnClear').hidden = !state.mass.cnTable;
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

  function tFactor() {
    var c = state.corr;
    return P.sectionFactor(c.sect, c.bevelLE_pct / 100, c.bevelTE_pct / 100);
  }
  // 等效幾何：厚度換成等效厚度（其餘不變）
  function effGeom() {
    var q = tFactor();
    return isNum(q) && q !== 1 ? Object.assign({}, state.geom, { t_mm: state.geom.t_mm * q }) : state.geom;
  }
  function effG() {
    var t = state.thermal, G = state.G_GPa;
    if (t && isNum(t.finT_C)) G *= P.gTempFactor(t.finT_C, t.kLoss);
    return G * P.rootStiffnessRatio(state.corr.rootK);
  }
  function physState(method) {
    return { geom: effGeom(), G_GPa: effG(), Gpct: state.Gpct, method: method || judgedMethod(), flight: state.flight };
  }

  function analysisErrors() {
    var errs = fieldErrors(['f-geom', 'f-mat', 'f-flight', 'f-thermal', 'f-corr']);
    if (errs.length) return errs;
    var f = state.flight;
    if (state.corr.sect === 'bevel' && !(state.corr.bevelLE_pct + state.corr.bevelTE_pct < 90)) errs.push({ path: 'corr.bevelLE_pct', msg: '前後緣斜削長度加起來必須小於弦長的 90%' });
    if (!isNum(tFactor())) errs.push({ path: 'corr.bevelLE_pct', msg: '斜削設定算不出有效的等效厚度' });
    if (f.mode === 'std' && f.launchElev_m + f.aglMax_m > P.STD_LIMIT_M) errs.push({ path: 'flight.aglMax_m', msg: '海拔加高度超過標準大氣模型的上限 ' + fu('altitude', P.STD_LIMIT_M, 0) + ' ' + un('altitude') });
    if (f.mode === 'local' && f.aglMax_m > P.TROPO_LIMIT_M) errs.push({ path: 'flight.aglMax_m', msg: '當地大氣模型只適用於離地 ' + fu('altitude', P.TROPO_LIMIT_M, 0) + ' ' + un('altitude') + ' 以下' });
    if (f.mode === 'local' && !(f.launchT_C > -80 && f.launchT_C < 60)) errs.push({ path: 'flight.launchT_C', msg: '發射場氣溫不在合理範圍' });
    if (state.judge === 'selected' && state.method === 'bennett') {
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

  // 一組幾何與 G 在設計點的三種公式結果；回傳 { rows, worst, best, valid }
  function methodTable(geom, G_GPa, req) {
    var fl = state.flight;
    var rows = Object.keys(P.METHODS).map(function (k) {
      var r = P.evaluatePoint({ geom: geom, G_GPa: G_GPa, Gpct: state.Gpct, method: k, flight: fl }, fl.aglMax_m, fl.vmax);
      return { key: k, valid: r.valid, reason: r.reason, Vf: r.Vf.nom, VfLow: r.Vf.low, ratio: r.Vf.nom / req, ratioLow: r.Vf.low / req, mach: r.mach };
    });
    var valid = rows.filter(function (m) { return m.valid && isNum(m.Vf); });
    if (!valid.length) return { rows: rows, valid: valid, worst: null, best: null };
    return {
      rows: rows, valid: valid,
      worst: valid.reduce(function (a, b) { return a.Vf <= b.Vf ? a : b; }),
      best: valid.reduce(function (a, b) { return a.Vf >= b.Vf ? a : b; })
    };
  }

  function judgedMethod() {
    if (state.judge === 'selected') return state.method;
    try {
      var g = effGeom(), fl = state.flight;
      if (![g.r_mm, g.c_mm, g.b_mm, g.t_mm, fl.vmax, fl.sf, state.G_GPa].every(isNum)) return state.method;
      var mt = methodTable(g, effG(), fl.vmax * fl.sf);
      return mt.worst ? mt.worst.key : state.method;
    } catch (e) { return state.method; }
  }

  function verdictClass(ratioNom, ratioLow) {
    if (!(ratioNom >= 1)) return 'bad';
    return ratioNom >= 1.1 && ratioLow >= 1 ? 'ok' : 'tight';
  }

  function trajHeating(rows) {
    var best = null;
    rows.forEach(function (r) {
      var a = P.atmosphereAt(state.flight, r.alt_m != null ? r.alt_m : r.alt);
      if (a.outOfRange) return;
      var M = r.v / a.a, T = P.adiabaticWallT(a.T, M);
      if (!best || T > best.T) best = { T: T - 273.15, t: r.t, M: M, v: r.v };
    });
    return best;
  }

  function renderAnalysis() {
    var out = $('out-analysis'), errs = analysisErrors();
    markInvalid(errs, ['f-geom', 'f-mat', 'f-flight', 'f-thermal', 'f-corr']);
    if (errs.length) { out.innerHTML = pausedBox(errs, '計算'); return; }
    var fl = state.flight, g = effGeom(), gN = state.geom, qT = tFactor(), Geff = effG();
    var req = fl.vmax * fl.sf;
    var mt = methodTable(g, Geff, req), mrows = mt.rows;
    if (!mt.worst) { out.innerHTML = pausedBox([{ msg: '三種公式都無法計算，請檢查尺寸（' + (mrows[0].reason || '') + '）。' }], '計算'); return; }
    var jk = judgedMethod(), st = physState(jk);
    var pt = P.evaluatePoint(st, fl.aglMax_m, fl.vmax);
    var Vn = pt.Vf.nom, Vl = pt.Vf.low, Vh = pt.Vf.high;
    var ratioNom = Vn / req, ratioLow = Vl / req;
    var cls = verdictClass(ratioNom, ratioLow), notes = [];
    if (cls !== 'bad') {
      if (ratioLow < 1) notes.push('G 下限（' + fu('modulus', pt.G.low, state.units === 'si' ? 2 : 0) + ' ' + un('modulus') + '）時，顫振速度低於要求速度');
      if (state.judge === 'selected' && mt.worst.key !== state.method && mt.worst.ratio < 1) notes.push('「' + P.METHODS[mt.worst.key] + '」算出的顫振速度低於要求速度');
    }
    var label = cls === 'ok' ? '合格' : cls === 'bad' ? '不合格' : (ratioLow >= 1 && ratioNom < 1.1 ? '勉強合格' : '需注意');

    var warns = [];
    if (state.judge === 'conservative') warns.push('判定依據是三種公式中最低的「' + P.METHODS[jk] + '」。可在左側「計算方法」改成只用單一公式。');
    if (pt.mach > 1.5) warns.push('這個條件的馬赫數為 ' + fn(pt.mach, 2) + '，超過 1.5。公式是外推，結果不可靠，請用更完整的分析確認。');
    else if (pt.mach >= 0.8) warns.push('馬赫數 ' + fn(pt.mach, 2) + ' 在跨音速區（0.8 到 1.2 附近）。顫振速度在這個區間常出現最低點，簡化公式在此最不可靠，請留更大的餘量，並用 CFD 或流固耦合分析驗證。');
    if (mt.best.Vf / mt.worst.Vf > 1.05) warns.push('三種公式的結果差異很大（最低 ' + spd(mt.worst.Vf) + '，最高 ' + spd(mt.best.Vf) + '）。請看下方的方法比較，並以較保守的結果為準。');
    if (g.m_mm > 0 && jk !== 'bennett') warns.push('目前判定用的公式不計入前緣後退長度（' + fu('length', g.m_mm, 1) + ' ' + un('length') + '）。Bennett 修正會計入，且後掠越大結果越低。');
    if (g.c_mm > g.r_mm) warns.push('尖端弦長大於根部弦長（λ = ' + fn(pt.f.lam, 2) + '），請確認是否填反。');
    if (g.t_mm / g.r_mm > 0.1) warns.push('厚度與根部弦長的比值 t/c_r = ' + fn(g.t_mm / g.r_mm, 3) + '，鰭片相對偏厚，簡化公式的誤差可能變大。');
    if (state.shape && state.shape.length > 4) warns.push('外形有 ' + state.shape.length + ' 個頂點，計算以梯形近似（根部弦長、尖端弦長、翼展與前緣後退長度）。');
    if (isNum(state.thermal.finT_C)) warns.push('G 已依鰭片溫度 ' + fu('temp', state.thermal.finT_C, 0) + ' ' + un('temp') + ' 折減（×' + fn(P.gTempFactor(state.thermal.finT_C, state.thermal.kLoss), 2) + '）。折減率只是粗略的預設。');
    if (qT !== 1) warns.push('剖面修正：等效厚度 = ' + fu('length', g.t_mm, 2) + ' ' + un('length') + '（標稱厚度的 ' + fn(qT, 2) + ' 倍，以彎曲剛度等效）。這是工程近似，沒有實驗驗證，也沒有計入扭轉剛度的變化。');
    if (isNum(state.corr.rootK)) warns.push('根部柔度修正：Vf ×' + fn(Math.sqrt(P.rootStiffnessRatio(state.corr.rootK)), 2) + '（根部剛度為鰭片的 ' + fn(state.corr.rootK, 2) + ' 倍，彈簧串聯估算）。');

    var max = Math.max(Vh, req, fl.vmax) * 1.12, p = function (x) { return (x / max * 100).toFixed(2); };
    var html = '';
    if (warns.length) html += '<div class="notes">' + warns.map(function (w) { return '<p class="note">' + esc(w) + '</p>'; }).join('') + '</div>';

    html += '<section class="verdict ' + cls + '"><div class="top"><span class="pill"><span>' + label + '</span></span>' +
      '<div class="big">' + fu('speed', Vn, 0) + '<small>' + un('speed') + '</small></div></div>' +
      '<p>顫振速度 V<sub>f</sub>（標稱 G）' + (ratioNom >= 1 ? '高於' : '低於') + '要求速度 ' + spd(req) + '（' + spd(fl.vmax) + ' × 安全係數 ' + fn(fl.sf, 2) + '），' +
      (ratioNom >= 1 ? '餘量 +' : '不足 ') + fn(Math.abs(ratioNom - 1) * 100, 1) + '%。</p>' +
      '<p>G 下限到上限的範圍：' + spd(Vl) + ' 到 ' + spd(Vh) + '（G ±' + fn(state.Gpct, 0) + '%）。</p>' +
      (notes.length ? '<p>' + esc(notes.join('；')) + '。</p>' : '') +
      '<div class="sub">Mach ' + fn(pt.mach, 2) + ' · 此設計可承受的最大飛行速度 ' + spd(Vn / fl.sf) + '（標稱）· ' + esc(P.METHODS[jk]) + '</div></section>';

    var fillCls = ratioNom >= 1.1 ? 'ok' : ratioNom >= 1 ? 'tight' : 'bad';
    html += '<section class="panel"><h2>速度對照</h2><div class="bar-wrap"><div class="track">' +
      '<div class="fill ' + fillCls + '" style="width:' + p(Vn) + '%"></div>' +
      '<div class="range-band" style="left:' + p(Vl) + '%;width:' + (p(Vh) - p(Vl)).toFixed(2) + '%"></div>' +
      '<div class="mk vmax" style="left:' + p(fl.vmax) + '%"></div><div class="mk req" style="left:' + p(req) + '%"></div></div>' +
      '<div class="axis"><span>0</span><span>' + fu('speed', max, 0) + ' ' + un('speed') + '</span></div>' +
      '<div class="legend"><span><i class="l-fill ' + (fillCls === 'ok' ? '' : fillCls) + '"></i>顫振速度 <b>' + fu('speed', Vn, 0) + '</b></span>' +
      '<span><i class="l-band"></i>G 下限到上限</span>' +
      '<span><i class="l-req"></i>要求 <b>' + fu('speed', req, 0) + '</b></span>' +
      '<span><i class="l-vmax"></i>最大速度 <b>' + fu('speed', fl.vmax, 0) + '</b></span></div></div></section>';

    var srows = [['G 下限（−' + fn(state.Gpct, 0) + '%）', pt.G.low, Vl], ['標稱', pt.G.nom, Vn], ['G 上限（+' + fn(state.Gpct, 0) + '%）', pt.G.high, Vh]];
    html += '<section class="panel"><h2>G 的敏感度</h2><div class="tablewrap"><table><thead><tr><th>情況</th><th class="n">G（' + un('modulus') + '）</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th class="n">對要求速度</th><th>判定</th></tr></thead><tbody>' +
      srows.map(function (r) {
        var rt = r[2] / req, ok = rt >= 1;
        return '<tr><td>' + r[0] + '</td><td class="n">' + fu('modulus', r[1], state.units === 'si' ? 2 : 0) + '</td><td class="n">' + fu('speed', r[2], 0) + '</td><td class="n">' + fn(rt * 100, 0) + '%</td><td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">V<sub>f</sub> 與 √G 成正比。這是輸入不確定度的敏感度，不是機率。</p></section>';

    html += '<section class="panel"><h2>三種公式的比較（標稱 G）</h2><div class="tablewrap"><table><thead><tr><th>公式</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th class="n">對要求速度</th><th>判定</th></tr></thead><tbody>' +
      mrows.map(function (m) {
        if (!m.valid) return '<tr><td>' + esc(P.METHODS[m.key]) + '</td><td class="n">—</td><td class="n">—</td><td><span class="tag bad">無法計算</span></td></tr>';
        var ok = m.ratio >= 1;
        return '<tr><td>' + esc(P.METHODS[m.key]) + (m.key === jk ? '（判定依據）' : '') + '</td><td class="n">' + fu('speed', m.Vf, 0) + '</td><td class="n">' + fn(m.ratio * 100, 0) + '%</td><td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">差異的來源請看「方法與來源」分頁。想知道哪個公式比較可靠，請到「與 Ansys 比對」分頁用實驗室的結果驗證。</p></section>';

    // 參數掃描
    html += sweepPanel(pt, jk, req);

    // 建議
    var sN = P.suggestions(st, fl.aglMax_m, req, Geff), sL = P.suggestions(st, fl.aglMax_m, req, pt.G.low);
    if (sN && sL) {
      var needN = ratioNom < 1, needL = ratioLow < 1;
      var bCell = function (s) { return s.bCap ? '不受翼展限制' : (isFinite(s.b_mm) ? fu('length', Math.floor(s.b_mm * 10) / 10, 1) + ' ' + un('length') : '無法達標'); };
      var btn = function (show, path, val) { return show ? ' <button type="button" class="btn tb-sm" data-set="' + path + '" data-val="' + val + '">套用</button>' : ''; };
      var gd = state.units === 'si' ? 1 : 0;
      html += '<section class="panel"><h2>' + (needN || needL ? '建議調整（任選一項即可達標）' : '設計餘裕（單項調整的極限）') + '</h2><div class="tablewrap"><table><thead><tr><th>項目</th><th class="n">標稱 G</th><th class="n">G 下限</th><th class="n">目前</th></tr></thead><tbody>' +
        '<tr><td>' + (needN || needL ? '厚度至少' : '厚度最薄可到') + '</td><td class="n">' + fu('length', ceilTo(sN.t_mm / qT, 0.1), 1) + ' ' + un('length') + btn(needN, 'geom.t_mm', ceilTo(sN.t_mm / qT, 0.1)) + '</td><td class="n">' + fu('length', ceilTo(sL.t_mm / qT, 0.1), 1) + ' ' + un('length') + btn(needL, 'geom.t_mm', ceilTo(sL.t_mm / qT, 0.1)) + '</td><td class="n">' + fu('length', gN.t_mm, 1) + ' ' + un('length') + '</td></tr>' +
        '<tr><td>' + (needN || needL ? '單片翼展不超過' : '翼展最長可到') + '</td><td class="n">' + bCell(sN) + btn(needN && isFinite(sN.b_mm) && !sN.bCap, 'geom.b_mm', Math.floor(sN.b_mm * 10) / 10) + '</td><td class="n">' + bCell(sL) + btn(needL && isFinite(sL.b_mm) && !sL.bCap, 'geom.b_mm', Math.floor(sL.b_mm * 10) / 10) + '</td><td class="n">' + fu('length', g.b_mm, 1) + ' ' + un('length') + '</td></tr>' +
        '<tr><td>剪切模量至少</td><td class="n">' + fu('modulus', ceilTo(sN.G_GPa, 0.1), gd) + ' ' + un('modulus') + btn(needN, 'G_GPa', ceilTo(sN.G_GPa, 0.1)) + '</td><td class="n">（G 下限需達到）' + fu('modulus', ceilTo(sL.G_GPa, 0.1), gd) + ' ' + un('modulus') + '</td><td class="n">' + fu('modulus', Geff, gd) + ' ' + un('modulus') + '</td></tr>' +
        '</tbody></table></div><p class="hint">每一項都是各自獨立計算，其餘參數保持目前的輸入，數值已朝合格方向進位。用「G 下限」欄可確保材料偏軟時仍達標。</p></section>';
    }

    // 材料比較
    html += '<section class="panel"><h2>換材料會怎樣（尺寸不變）</h2><div class="tablewrap"><table><thead><tr><th>材料</th><th class="n">G（' + un('modulus') + '）</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th>判定</th><th class="n">達標最小厚度（' + un('length') + '）</th></tr></thead><tbody>' +
      S.MATS.map(function (m) {
        var r = P.evaluatePoint(Object.assign({}, st, { G_GPa: m.G * (Geff / state.G_GPa), Gpct: 0 }), fl.aglMax_m, fl.vmax), ok = r.Vf.nom >= req;
        var tmin = gN.t_mm * Math.pow(req / r.Vf.nom, 2 / 3);
        return '<tr><td>' + esc(m.name) + '</td><td class="n">' + fu('modulus', m.G, state.units === 'si' ? 1 : 0) + '</td><td class="n">' + fu('speed', r.Vf.nom, 0) + '</td><td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td><td class="n">' + fu('length', ceilTo(tmin, 0.1), state.units === 'si' ? 1 : 2) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">G 為各材料的典型參考值。</p></section>';

    // 溫度
    html += heatingPanel(pt);

    // 專案內所有鰭片
    html += orkAllPanel(req);

    // 計算過程
    var f = pt.f, shape = state.shape || trapezoidPts();
    var shapeDisp = shape.map(function (q) { return [disp('length', q[0]), disp('length', q[1])]; });
    var formulas = {
      user: 'V<sub>f</sub> = a · √( 2G (t/c<sub>r</sub>)³ (AR+2) / (1.337 · AR³ (λ+1) · P) )',
      martin: 'V<sub>f</sub> = a · √( G (t/c<sub>r</sub>)³ (AR+2) / (1.337 · AR³ (λ+1) · P) )',
      bennett: 'ε = C<sub>x</sub>/c<sub>r</sub> − 0.25　D = (24 ε γ P / π) · AR³ / ((t/c<sub>r</sub>)³ (AR+2)) · (λ+1)/2　V<sub>f</sub> = a · √(G / D)'
    };
    html += '<section class="panel"><h2>計算過程</h2><div class="formula">' + formulas[jk] + '</div><div class="detail"><div>' +
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

  function sweepPanel(pt, jk, req) {
    var g = effGeom(), qT = tFactor(), fl = state.flight, v = ui.sweep, key = v === 'b' ? 'b_mm' : 't_mm', cur = key === 't_mm' ? state.geom.t_mm : g[key];
    var k = state.units === 'si' ? 1 : 1 / U.constants.FT, lk = state.units === 'si' ? 1 : 1 / U.constants.IN;
    var lo = cur * (v === 'b' ? 0.5 : 0.4), hi = cur * (v === 'b' ? 1.6 : 2.2), N = 30, pts = { low: [], nom: [], high: [], req: [] };
    var Gs = pt.G, atm = pt.atm;
    for (var i = 0; i <= N; i++) {
      var x = lo + (hi - lo) * i / N, gg = Object.assign({}, g); gg[key] = key === 't_mm' ? x * qT : x;
      var row = {};
      ['low', 'nom', 'high'].forEach(function (w) {
        var r = P.flutter(gg, Gs[w], atm.p, atm.a, jk);
        pts[w].push([x * lk, r.valid ? r.Vf * k : NaN]);
      });
      pts.req.push([x * lk, req * k]);
    }
    var ymax = Math.max.apply(null, pts.high.map(function (q) { return isFinite(q[1]) ? q[1] : 0; }).concat([req * k])) * 1.1;
    var chart = CH.lineChart({
      title: '顫振速度對' + (v === 'b' ? '翼展' : '厚度') + '的變化', xLabel: (v === 'b' ? '單片翼展（' : '鰭片厚度（') + un('length') + '）', yLabel: '速度（' + un('speed') + '）',
      series: [{ name: '要求', cls: 's-req', pts: pts.req }, { name: 'G 下限', cls: 's-low', pts: pts.low }, { name: '標稱', cls: 's-nom', pts: pts.nom }, { name: 'G 上限', cls: 's-high', pts: pts.high }],
      yMax: ymax, marks: [{ x: cur * lk, y: pt.Vf.nom * k, cls: '', label: '目前設計' }]
    });
    return '<section class="panel"><h2>參數掃描</h2><div class="field"><label for="sweepVar">掃描的參數</label><div class="inp"><select id="sweepVar">' +
      '<option value="t"' + (v === 't' ? ' selected' : '') + '>鰭片厚度</option><option value="b"' + (v === 'b' ? ' selected' : '') + '>單片翼展</option></select></div></div>' +
      '<div class="chart">' + chart + '</div>' + CH.legend([{ cls: 'l-req', name: '要求' }, { cls: 'l-low', name: 'G 下限' }, { cls: 'l-nom', name: '標稱' }, { cls: 'l-high', name: 'G 上限' }]) +
      '<p class="hint">其他參數維持目前輸入，圓點是目前的設計。曲線與「要求」線的交點就是剛好達標的值。公式：' + esc(P.METHODS[jk]) + '。</p></section>';
  }

  function heatingPanel(pt) {
    var T0 = pt.atm.T, Taw = P.adiabaticWallT(T0, pt.mach) - 273.15;
    var tj = state.traj ? trajHeating(state.traj.rows) : null;
    var Tmax = tj ? tj.T : Taw, set = Math.ceil(Tmax);
    return '<section class="panel"><h2>氣動加熱估算</h2><div class="tiles">' +
      '<div class="tile"><span class="k">設計點的絕熱壁溫</span><span class="v">' + fu('temp', Taw, 0) + ' ' + un('temp') + '</span><span class="s">Mach ' + fn(pt.mach, 2) + '，環境 ' + fu('temp', T0 - 273.15, 0) + ' ' + un('temp') + '</span></div>' +
      (tj ? '<div class="tile"><span class="k">整條軌跡的最高絕熱壁溫</span><span class="v">' + fu('temp', tj.T, 0) + ' ' + un('temp') + '</span><span class="s">' + fn(tj.t, 2) + ' s，Mach ' + fn(tj.M, 2) + '</span></div>' : '') + '</div>' +
      '<p class="hint">T<sub>aw</sub> = T(1 + r(γ−1)/2 · M²)，恢復係數 r = 0.89。這是氣流能把表面加熱到的上限，真實鰭片因為熱慣性升溫慢得多，前緣和尖端則可能更熱。要把溫度算進 G，請在左側填「鰭片溫度」，或' +
      ' <button type="button" class="btn tb-sm" data-thermal="' + set + '">用上述最高值（保守）</button>' + (state.thermal.finT_C !== null ? ' <button type="button" class="btn tb-sm" data-thermal="off">取消溫度修正</button>' : '') + '。</p></section>';
  }

  function orkFinCheck(fs, req) {
    var mm = S.matchMaterial(fs.mat.name), G = isNum(fs.mat.G_GPa) ? fs.mat.G_GPa : (mm ? mm.G : state.G_GPa);
    var src = isNum(fs.mat.G_GPa) ? '檔案內' : (mm ? '對照表' : '目前輸入');
    var mt = methodTable(fs.geom, G, req);
    if (!mt.worst) return { src: src, G: G, bad: true };
    var Gp = mm && !isNum(fs.mat.G_GPa) ? Math.max(10, Math.ceil(100 * Math.max((mm.hi - mm.G) / mm.G, (mm.G - mm.lo) / mm.G))) : state.Gpct;
    var lowF = mt.worst.Vf * Math.sqrt(Math.max(0, 1 - Gp / 100));
    return { src: src, G: G, Gp: Gp, worst: mt.worst, lowF: lowF, ratio: mt.worst.Vf / req, ratioLow: lowF / req };
  }

  function orkAllPanel(req) {
    if (!ui.ork || !ui.ork.finsets.some(function (f) { return f.geom; })) return '';
    var rows = ui.ork.finsets.map(function (fs, i) {
      if (!fs.geom) return '<tr><td>' + esc(fs.name) + '</td><td colspan="5">' + esc(fs.note || '無法使用') + '</td></tr>';
      var c = orkFinCheck(fs, req);
      if (c.bad) return '<tr><td>' + esc(fs.name) + '</td><td colspan="5">無法計算</td></tr>';
      var cl = verdictClass(c.ratio, c.ratioLow), lab = cl === 'ok' ? '合格' : cl === 'bad' ? '不合格' : '需注意';
      return '<tr><td>' + esc(fs.name) + (fs.stage ? '<br><span class="hint">' + esc(fs.stage) + '</span>' : '') + '</td><td class="n">' + fn(fs.count, 0) + '</td>' +
        '<td class="n">' + fu('length', fs.geom.t_mm, 1) + '</td><td class="n">' + fu('modulus', c.G, state.units === 'si' ? 1 : 0) + '<br><span class="hint">' + c.src + '</span></td>' +
        '<td class="n">' + fu('speed', c.worst.Vf, 0) + '<br><span class="hint">' + fn(c.ratio * 100, 0) + '%</span></td><td><span class="tag ' + (cl === 'ok' ? 'ok' : cl === 'bad' ? 'bad' : 'tight') + '">' + lab + '</span></td></tr>';
    }).join('');
    return '<section class="panel"><h2>專案內所有鰭片（最保守公式）</h2><div class="tablewrap"><table><thead><tr><th>鰭片組</th><th class="n">片數</th><th class="n">厚度（' + un('length') + '）</th><th class="n">G（' + un('modulus') + '）</th><th class="n">V<sub>f</sub>（' + un('speed') + '）</th><th>判定</th></tr></thead><tbody>' + rows +
      '</tbody></table></div><p class="hint">使用目前的飛行條件與安全係數，材料依檔案或對照表。「合格」表示標稱與 G 下限都達標且有 10% 以上餘量。要看某一組的細節，請在左側「從 OpenRocket 檔案讀取」按「載入」。</p></section>';
  }

  // ================= 分頁：飛行軌跡 =================
  // 保守判定時，逐一算三種公式，取最小餘量最低的那個
  function trajResult(tj) {
    var keys = state.judge === 'selected' ? [state.method] : Object.keys(P.METHODS), best = null;
    keys.forEach(function (k) {
      var r = P.evaluateTrajectory(physState(k), tj.rows);
      if (!(r.invalid < tj.rows.length)) return;
      if (!best || (isNum(r.minMargin) && (!isNum(best.res.minMargin) || r.minMargin < best.res.minMargin))) best = { key: k, res: r };
    });
    if (!best) best = { key: keys[0], res: P.evaluateTrajectory(physState(keys[0]), tj.rows) };
    return best;
  }

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
    var tr0 = trajResult(tj), res = tr0.res, fl = state.flight;
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
    var trans = res.rows.filter(function (r) { return r.mach >= 0.8 && r.mach <= 1.2; }).length;
    if (trans > 0) html += '<p class="note">有 ' + trans + ' 個取樣點在跨音速區（Mach 0.8 到 1.2）。顫振速度在這個區間常出現最低點，簡化公式在此最不可靠。</p>';
    var maxDt = 0; for (var di = 1; di < tj.rows.length; di++) maxDt = Math.max(maxDt, tj.rows[di].t - tj.rows[di - 1].t);
    if (maxDt > 1) html += '<p class="note">取樣間隔最大到 ' + fn(maxDt, 2) + ' s。取樣太稀疏，可能漏掉最低餘量的瞬間，建議在 OpenRocket 提高取樣頻率後重新匯出。</p>';
    html += '<p class="note">只計算取樣點，點與點之間不內插。判定公式：' + esc(P.METHODS[tr0.key]) + (state.judge === 'conservative' ? '（三種中最保守者）' : '') + '。</p></div>';
    html += '<section class="panel"><h2>最小餘量（G 下限）</h2><div class="tiles">' +
      '<div class="tile ' + cls + '"><span class="k">最小顫振餘量</span><span class="v">' + (isNum(mm) ? (mm >= 0 ? '+' : '') + fn(mm, 1) + '%' : '—') + '</span><span class="s">要求 +' + fn(reqMargin, 0) + '%（安全係數 ' + fn(fl.sf, 2) + '）</span></div>' +
      '<div class="tile"><span class="k">發生在</span><span class="v">' + fn(mi.t, 2) + ' s</span><span class="s">' + fu('altitude', mi.alt, 0) + ' ' + un('altitude') + '，' + spd(mi.v) + '，Mach ' + fn(mi.mach, 2) + '</span></div>' +
      '<div class="tile"><span class="k">該點的顫振速度（G 下限）</span><span class="v">' + spd(mi.VfLow) + '</span><span class="s">標稱 ' + spd(mi.VfNom) + '</span></div>' +
      '<div class="tile"><span class="k">最大動壓 q</span><span class="v">' + qStr(qi.q) + '</span><span class="s">' + fn(qi.t, 2) + ' s，' + fu('altitude', qi.alt, 0) + ' ' + un('altitude') + '</span></div>' +
      '<div class="tile"><span class="k">最高 Mach</span><span class="v">' + fn(res.maxMach, 2) + '</span><span class="s">' + fn(xi.t, 2) + ' s，' + spd(xi.v) + '</span></div>' +
      '<div class="tile"><span class="k">最高速度</span><span class="v">' + spd(peakV) + '</span><span class="s">' + tj.rows.length + ' 個取樣點，共 ' + fn(tj.rows[tj.rows.length - 1].t, 1) + ' s</span></div></div>' +
      '<p class="hint">' + esc(tj.name) + ' · 公式：' + esc(P.METHODS[tr0.key]) + '</p></section>';

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
      var info = { tool: '鰭片顫振計算器', file: tj.name, method: P.METHODS[tr0.key], 'G_nominal_GPa': effG(), 'G_sensitivity_pct': state.Gpct, units: 'SI' };
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
    var q = null, qNote = '', qMach = 0, cnUsed = state.mass.Cn, cnNote = '', cnClamp = false;
    if (!ae.length) {
      var pt = P.evaluatePoint(physState(), fl.aglMax_m, fl.vmax);
      q = pt.q; qNote = '預期最大速度與其高度'; qMach = pt.mach;
      if (state.traj) {
        var tr = P.evaluateTrajectory(physState(), state.traj.rows);
        if (tr.outOfRange === 0 && tr.maxQ > q) { q = tr.maxQ; qNote = '軌跡的最大動壓'; qMach = tr.rows[tr.maxQIdx].mach; }
      }
    }
    var m = state.mass;
    if (m.cnTable && q !== null) {
      var ip = P.interp(m.cnTable, qMach); cnUsed = ip.v; cnClamp = ip.clamped;
      cnNote = '（係數表在 Mach ' + fn(qMach, 2) + ' 的內插值 ' + fn(cnUsed, 3) + (cnClamp ? '，超出表格範圍，採用邊界值' : '') + '）';
    }
    var ms = {
      fins: m.fins, density_gcc: state.density_gcc, addMass_g: m.addMass_g, assemblyX_mm: m.assemblyX_mm, baseM_g: m.baseM_g, baseX_mm: m.baseX_mm,
      cp_mm: m.cp_mm, od_mm: m.od_mm, Cn: cnUsed, lever_mm: m.lever_mm === null ? 0 : m.lever_mm
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
        '<div class="tile"><span class="k">單片法向力</span><span class="v">' + fn(disp('force', r.F_N), 0) + ' ' + un('force') + '</span><span class="s">F = q · S · Cn' + esc(cnNote) + '</span></div>' +
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
      '<h3>判定依據與比對</h3>' +
      '<p>預設以三種公式中最低的結果判定（最保守）。因為三種公式在同一支鰭片上可能差很多，而本工具無法替你決定哪個正確。「與 Ansys 比對」分頁可以用實驗室的流固耦合結果或實測，累積案例後看哪個公式最接近、是否偏樂觀。程式不會自動用比值修正結果。</p>' +
      '<h3>溫度</h3>' +
      '<p>絕熱壁溫 T_aw = T (1 + r (γ−1)/2 · M²)，r = 0.89，是氣流能加熱表面的上限；鰭片因熱慣性實際升溫較慢，前緣與尖端可能更熱。G 的溫度折減為每高於 20 °C 的 100 °C 損失固定百分比，只是粗略預設，請以材料資料取代。</p>' +
      '<h3>OpenRocket 檔案與外部結果</h3>' +
      '<p>.ork 檔的鰭片尺寸與已儲存的模擬資料視為 SI 單位。材料只有名稱與密度，G 由名稱對照表給出典型值（僅供參考）。匯入的模態頻率與 Cn 係數表由你負責確認來源與條件；Cn 依 Mach 線性內插，不外推。</p>' +
      '<h3>不處理的項目</h3>' +
      '<ul><li>翼型剖面、斜削邊、厚度變化、密度不均、混合層板</li><li>根部柔度、圓角、支撐、固定件滑動</li><li>扭轉、剝離應力、膠的容許值、挫屈與強度</li><li>有風時的對空速度修正</li></ul>' +
      '<h3>驗證</h3>' +
      '<p>自動測試確認：大氣數值、公式的代數關係、單位換算、CSV 解析，以及 Bennett 公開的基準案例（英制範例，顫振速度約 2087.3 ft/s、餘量約 39.15%）。測試只能證明程式實作與這些數字一致，不代表飛行安全。</p>' +
      '<h3>來源</h3>' +
      '<ul><li>Martin, H. C., NACA Technical Note 4197, 1958（顫振公式的原始來源）</li><li>John K. Bennett 在 Peak of Flight 的鰭片顫振文章與試算表（形心修正與基準案例）</li><li>U.S. Standard Atmosphere, 1976</li><li>NASA TM-2016-219166（Strouhal 篩選的架構）</li></ul>' +
      '<p>形心修正與渦流篩選的描述，依據公開的 STAR Fin Lab 方法文件整理。本程式的程式碼為獨立撰寫，沒有使用該專案的程式碼。</p>';
  }

  // ================= 分頁：進階求解器 =================
  function advSig() {
    return JSON.stringify([state.geom, state.G_GPa, state.thermal, state.density_gcc, state.flight, state.adv]);
  }

  function runAdv() {
    var errs = analysisErrors().concat(fieldErrors(['f-adv']));
    if (errs.length) { setStatusEl('advStatus', '輸入有問題：' + errs[0].msg, 'bad'); return; }
    if (!SV) { setStatusEl('advStatus', '求解器元件沒有載入。', 'bad'); return; }
    setStatusEl('advStatus', '計算中…');
    setTimeout(function () {
      try {
        var fl = state.flight, atm = P.atmosphereAt(fl, fl.aglMax_m);
        var G = state.G_GPa * (isNum(state.thermal.finT_C) ? P.gTempFactor(state.thermal.finT_C, state.thermal.kLoss) : 1);
        var mat = { G_GPa: G, nu: state.adv.nu, rho_gcc: state.density_gcc };
        var Umax = Math.min(4000, 8 * atm.a), t0 = Date.now();
        var r = SV.flutterScan(state.geom, mat, { rho: atm.rho, a: atm.a }, { Umax: Umax, dU: Umax / 400, model: state.adv.model, nx: 6, ny: 7, nModes: 6 });
        var req = fl.vmax * fl.sf, mt = methodTable(state.geom, effG(), req);
        ui.adv = { sig: advSig(), r: r, atm: atm, mat: mat, formulaMin: mt.worst ? mt.worst.Vf : NaN, req: req, ms: Date.now() - t0 };
        setStatusEl('advStatus', '完成（' + ui.adv.ms + ' ms）。', 'ok');
      } catch (e) { ui.adv = null; setStatusEl('advStatus', '計算失敗：' + (e && e.message ? e.message : e), 'bad'); }
      renderAdv();
    }, 20);
  }

  function renderAdv() {
    var out = $('out-adv'), a = ui.adv;
    if (!a) {
      out.innerHTML = '<section class="panel"><h2>還沒有結果</h2><p class="info">按左側的「執行」，會算出鰭片的前 6 個固有頻率，並在設計點的空氣條件下掃描顫振速度。</p>' +
        '<p class="hint">模型：Kirchhoff 薄板（等向、均勻厚度、根部固定）的 Rayleigh-Ritz 解，加上壓力正比於局部下洗的簡化氣動力。沒有跨音速效應、沒有翼型、沒有結構阻尼。</p></section>';
      return;
    }
    var r = a.r, stale = a.sig !== advSig(), req = a.req, html = '';
    if (stale) html += '<div class="notes"><p class="note">輸入已經改變，下面是上一次的結果。請重新執行。</p></div>';
    html += '<div class="notes"><p class="note">這是實驗性模型。結構頻率用解析解驗證過；氣動力是簡化模型，沒有跨音速效應，通常比經驗公式樂觀。<b>不要因為這裡的顫振速度較高就放寬設計。</b>要驗證請用實驗室的 Ansys 流固耦合。</p></div>';
    html += '<section class="panel"><h2>固有頻率（根部固定的平板）</h2><div class="tablewrap"><table><thead><tr><th class="n">模態</th><th class="n">頻率（Hz）</th></tr></thead><tbody>' +
      r.freqs.map(function (f, i) { return '<tr><td class="n">' + (i + 1) + '</td><td class="n">' + fn(f, 1) + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="pts-actions no-print"><button type="button" class="btn tb-sm" id="btnAdvModes">加入渦流分頁的模態清單</button></div>' +
      '<p class="hint">E = ' + fn(a.mat.G_GPa * 2 * (1 + a.mat.nu), 2) + ' GPa（由 G 與 ν 算出）。不含安裝柔度、膠層與包覆層，真實鰭片的頻率通常較低。</p></section>';
    var kindTxt = r.kind === 'flutter' ? '顫振' : r.kind === 'divergence' ? '靜態發散' : '未發生';
    var ratio = r.kind === 'none' ? NaN : r.Vf / a.formulaMin;
    html += '<section class="panel"><h2>顫振掃描</h2><div class="tiles">' +
      '<div class="tile ' + (r.kind === 'none' ? '' : (r.Vf >= req ? 'ok' : 'bad')) + '"><span class="k">模型預測的不穩定速度</span><span class="v">' + (r.kind === 'none' ? '無' : spd(r.Vf)) + '</span><span class="s">' + (r.kind === 'none' ? '掃描範圍內沒有出現不穩定' : kindTxt + '，Mach ' + fn(r.mach, 2) + '，頻率 ' + fn(r.freq, 0) + ' Hz') + '</span></div>' +
      '<div class="tile"><span class="k">三種公式中最低</span><span class="v">' + spd(a.formulaMin) + '</span><span class="s">要求速度 ' + spd(req) + '</span></div>' +
      '<div class="tile"><span class="k">求解器 ÷ 最低公式</span><span class="v">' + (isNum(ratio) ? fn(ratio, 2) : '—') + '</span><span class="s">大於 1 表示求解器比公式樂觀</span></div></div>';
    var msgs = [];
    if (r.kind !== 'none' && r.blended) msgs.push('預測的不穩定發生在 Mach 0.9 到 1.5 的混合區間，氣動力在這裡沒有物理依據，結果不可靠。');
    if (r.kind === 'none' || (isNum(ratio) && ratio > 1.3)) msgs.push('求解器的結果明顯高於（或找不到）經驗公式的預測。這很可能是因為簡化氣動力沒有包含跨音速區的顫振速度下降，不代表設計安全。請以較保守的結果為準。');
    if (r.kind === 'flutter' && r.Vf < req) msgs.push('求解器預測的速度低於要求速度。');
    html += msgs.map(function (m) { return '<p class="note">' + esc(m) + '</p>'; }).join('');
    var pick = r.scan.filter(function (s, i) { return i % Math.max(1, Math.floor(r.scan.length / 10)) === 0; });
    html += '<div class="tablewrap"><table><thead><tr><th class="n">速度（' + un('speed') + '）</th><th class="n">Mach</th><th class="n">最不穩定根的衰減率（1/s）</th></tr></thead><tbody>' +
      pick.map(function (s) { return '<tr><td class="n">' + fu('speed', s.U, 0) + '</td><td class="n">' + fn(s.mach, 2) + '</td><td class="n">' + fn(s.maxRe, 1) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="hint">衰減率為負表示穩定，轉為正表示開始不穩定。大氣條件取自設計點（' + fu('altitude', state.flight.aglMax_m, 0) + ' ' + un('altitude') + '離地），密度 ' + fn(a.atm.rho, 3) + ' kg/m³。</p></section>';
    out.innerHTML = html;
  }

  // ================= 分頁：與 Ansys 比對 =================
  function renderCalList() {
    var box = $('calList');
    if (!state.cal.length) { box.innerHTML = ''; return; }
    box.innerHTML = state.cal.map(function (c, i) {
      return '<div class="snap-row"><div><div class="snap-name">' + esc(c.name || ('案例 ' + (i + 1))) + '</div><div class="snap-time">參考 ' + esc(spd(c.Vref)) + ' · t ' + esc(fu('length', c.geom.t_mm, 1)) + ' ' + esc(un('length')) + '</div></div>' +
        '<button type="button" class="tb tb-sm" data-calrm="' + i + '">刪除</button></div>';
    }).join('');
  }

  function renderCal() {
    var out = $('out-cal');
    $('u-calVref').textContent = un('speed');
    renderCalList();
    if (!state.cal.length) {
      out.innerHTML = '<section class="panel"><h2>還沒有比對案例</h2><p class="info">用實驗室的 Ansys（流固耦合、或其他方法）或實測得到某支鰭片的顫振速度後，在左側填入參考值，按「用目前的設計加入」。累積幾個案例，就能看出三種公式哪一個最接近，以及各自偏保守還是偏樂觀。</p>' +
        '<p class="hint">一個案例只能說明那一組條件。至少要 3 個、涵蓋不同厚度或後掠，結論才有參考價值。</p></section>';
      return;
    }
    var keys = Object.keys(P.METHODS), per = {}, rows = [];
    keys.forEach(function (k) { per[k] = []; });
    state.cal.forEach(function (c, i) {
      var atm = P.atmosphereAt(c.flight, c.aglM), cells = '';
      keys.forEach(function (k) {
        var r = P.flutter(c.geom, c.G_GPa, atm.p, atm.a, k);
        if (!r.valid || !isNum(r.Vf)) { per[k].push(null); cells += '<td class="n">—</td>'; return; }
        var ratio = c.Vref / r.Vf; per[k].push(ratio);
        cells += '<td class="n">' + fu('speed', r.Vf, 0) + '<br><span class="tag ' + (ratio >= 1 ? 'ok' : 'bad') + '">參考/公式 ' + fn(ratio, 2) + '</span></td>';
      });
      rows.push('<tr><td>' + esc(c.name || ('案例 ' + (i + 1))) + '</td><td class="n">' + fu('speed', c.Vref, 0) + '</td>' + cells + '</tr>');
    });
    var summary = keys.map(function (k) {
      var v = per[k], complete = v.every(isNum);
      if (!complete) return { k: k, ok: false };
      var gm = Math.exp(v.reduce(function (a, b) { return a + Math.log(b); }, 0) / v.length);
      return { k: k, ok: true, gm: gm, min: Math.min.apply(null, v), max: Math.max.apply(null, v), over: v.filter(function (x) { return x < 1; }).length };
    });
    var cand = summary.filter(function (x) { return x.ok; });
    var closest = cand.length ? cand.reduce(function (a, b) { return Math.abs(Math.log(a.gm)) <= Math.abs(Math.log(b.gm)) ? a : b; }) : null;
    var html = '<section class="panel"><h2>比對結果</h2><div class="tablewrap"><table><thead><tr><th>案例</th><th class="n">參考值（' + un('speed') + '）</th>' +
      keys.map(function (k) { return '<th class="n">' + esc(P.METHODS[k]) + '<br>V<sub>f</sub>（' + un('speed') + '）</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<p class="hint">「參考/公式」小於 1，表示公式高估了顫振速度（偏樂觀、不保守）。大於 1 表示公式偏保守。</p></section>';
    html += '<section class="panel"><h2>各公式的整體表現</h2><div class="tablewrap"><table><thead><tr><th>公式</th><th class="n">平均比值（幾何平均）</th><th class="n">範圍</th><th class="n">高估的案例數</th></tr></thead><tbody>' +
      summary.map(function (x) {
        if (!x.ok) return '<tr><td>' + esc(P.METHODS[x.k]) + '</td><td colspan="3">有案例無法計算</td></tr>';
        return '<tr><td>' + esc(P.METHODS[x.k]) + (closest && closest.k === x.k ? '（最接近）' : '') + '</td><td class="n">' + fn(x.gm, 2) + '</td><td class="n">' + fn(x.min, 2) + ' 到 ' + fn(x.max, 2) + '</td><td class="n">' + x.over + ' / ' + state.cal.length + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var msg = [];
    if (state.cal.length < 3) msg.push('目前只有 ' + state.cal.length + ' 個案例，不足以下結論。');
    if (closest) {
      msg.push('平均而言，「' + P.METHODS[closest.k] + '」最接近你的參考值（比值 ' + fn(closest.gm, 2) + '）。');
      if (closest.over > 0) msg.push('但它在 ' + closest.over + ' 個案例中高估了顫振速度，用來判定安全性要特別小心。');
    }
    var spread = cand.length ? Math.max.apply(null, cand.map(function (x) { return x.max / x.min; })) : 1;
    if (spread > 1.3) msg.push('同一個公式在不同案例的比值差異很大（最大約 ' + fn(spread, 2) + ' 倍），代表這個公式的形式本身和參考方法不一致，不能只靠乘一個係數修正。');
    html += msg.map(function (m) { return '<p class="note">' + esc(m) + '</p>'; }).join('') +
      '<p class="hint">這個工具不會自動用比值修正計算結果，避免用少數案例得出過度自信的係數。要採用修正，請自行評估並加上額外餘量。</p></section>';
    out.innerHTML = html;
  }

  function addCalCase() {
    var v = parseFloat($('calVref').value);
    var errs = analysisErrors();
    if (errs.length) { toolMsg('目前的輸入有問題，無法加入：' + errs[0].msg, 'bad'); return; }
    if (!(v > 0)) { toolMsg('請先填入參考的顫振速度（大於 0）。', 'bad'); return; }
    if (state.cal.length >= 20) { toolMsg('最多 20 個比對案例。', 'bad'); return; }
    state.cal.push({ name: $('calName').value.trim().slice(0, 60), geom: S.clone(effGeom()), G_GPa: effG(), aglM: state.flight.aglMax_m, flight: S.clone(state.flight), Vref: U.toBase('speed', state.units, v) });
    $('calName').value = ''; $('calVref').value = '';
    toolMsg('已加入比對案例。', 'ok');
    renderAll();
  }

  // ================= OpenRocket 檔案、Ansys 結果匯入 =================
  function setStatusEl(id, msg, kind) { var el = $(id); el.textContent = msg; el.className = 'scan-status' + (kind ? ' ' + kind : ''); }

  function renderOrkPanel() {
    var list = $('orkList'), sims = $('orkSims');
    if (!ui.ork) { list.innerHTML = ''; sims.innerHTML = ''; return; }
    list.innerHTML = ui.ork.finsets.length ? '<div class="tablewrap"><table><thead><tr><th>鰭片組</th><th class="n">片數</th><th></th></tr></thead><tbody>' +
      ui.ork.finsets.map(function (fs, i) {
        return '<tr><td>' + esc(fs.name) + (fs.stage ? '<br><span class="hint">' + esc(fs.stage) + '</span>' : '') + (fs.note ? '<br><span class="hint">' + esc(fs.note) + '</span>' : '') + '</td><td class="n">' + fn(fs.count, 0) + '</td>' +
          '<td>' + (fs.geom ? '<button type="button" class="btn tb-sm" data-orkload="' + i + '">載入</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="hint">檔案裡沒有找到鰭片組。</p>';
    var usable = ui.ork.sims;
    sims.innerHTML = usable.length ? '<div class="field wide"><label for="orkSimSel">使用已儲存的模擬結果</label><div class="inp"><select id="orkSimSel">' +
      usable.map(function (s, i) {
        return '<option value="' + i + '"' + (s.rows ? '' : ' disabled') + '>' + esc(s.name) + (isFinite(s.maxV) ? '（最大速度 ' + fn(s.maxV, 0) + ' m/s）' : '') + (s.rows ? '' : '：' + esc(s.note)) + '</option>';
      }).join('') + '</select></div></div><div class="pts-actions"><button type="button" class="btn" id="btnOrkSim">套用軌跡與最大速度</button></div>' :
      '<p class="hint">檔案裡沒有模擬結果。</p>';
  }

  function loadOrkFin(i) {
    var fs = ui.ork.finsets[i]; if (!fs || !fs.geom) return;
    state.geom = S.clone(fs.geom); state.shape = fs.shape ? S.clone(fs.shape) : null;
    state.mass.fins = fs.count;
    var notes = ['已載入「' + fs.name + '」的尺寸與片數。'];
    if (isNum(fs.mat.density_gcc) && fs.mat.density_gcc > 0) state.density_gcc = fs.mat.density_gcc;
    var mm = S.matchMaterial(fs.mat.name);
    if (isNum(fs.mat.G_GPa)) { state.G_GPa = fs.mat.G_GPa; state.mat = 'custom'; notes.push('G 取自檔案內的材料資料（' + fn(fs.mat.G_GPa, 2) + ' GPa）。'); }
    else if (mm) {
      state.G_GPa = mm.G; state.mat = mm.id; state.Gpct = Math.max(10, Math.ceil(100 * Math.max((mm.hi - mm.G) / mm.G, (mm.G - mm.lo) / mm.G)));
      notes.push('材料「' + fs.mat.name + '」對照到「' + mm.name + '」，G 設為典型值 ' + mm.G + ' GPa（敏感度 ±' + state.Gpct + '%）。這只是參考，請以供應商資料為準。');
    } else notes.push('材料「' + (fs.mat.name || '未命名') + '」不在對照表中，G 沒有變動，請自行確認。');
    refreshInputs(true); renderAll();
    toolMsg(notes.join('\n'), 'ok');
  }

  function applyOrkSim() {
    var sel = $('orkSimSel'), s = ui.ork.sims[parseInt(sel.value, 10)];
    if (!s || !s.rows) return;
    state.traj = { name: s.name, rows: s.rows };
    var pk = s.rows.reduce(function (a, r) { return r.v > a.v ? r : a; }, s.rows[0]);
    state.flight.vmax = Math.round(pk.v * 10) / 10; state.flight.aglMax_m = Math.round(pk.alt_m);
    refreshInputs(true); setStatusEl('trajStatus', '已載入 .ork 內的模擬「' + s.name + '」：' + s.rows.length + ' 個取樣點。', 'ok');
    renderAll();
    toolMsg('已套用「' + s.name + '」：最大速度 ' + fn(pk.v, 1) + ' m/s（發生在離地 ' + fn(pk.alt_m, 0) + ' m）。海拔與大氣設定請自行確認。軌跡高度視為離地高度。', 'ok');
  }

  function readOrkFile(file) {
    if (!file) return;
    setStatusEl('orkStatus', '讀取中…');
    if (!O) { setStatusEl('orkStatus', '讀檔元件沒有載入。', 'bad'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      O.parse(fr.result).then(function (r) {
        ui.ork = r; renderOrkPanel();
        var ok = r.finsets.filter(function (f) { return f.geom; }).length, withData = r.sims.filter(function (s) { return s.rows; }).length;
        setStatusEl('orkStatus', (r.name ? '「' + r.name + '」：' : '') + '找到 ' + r.finsets.length + ' 組鰭片（' + ok + ' 組可用）、' + r.sims.length + ' 個模擬（' + withData + ' 個有資料點）。請核對後載入。', ok ? 'ok' : 'bad');
        renderAll();
      }).catch(function (e) { ui.ork = null; renderOrkPanel(); setStatusEl('orkStatus', '讀取失敗：' + (e && e.message ? e.message : e), 'bad'); renderAll(); });
    };
    fr.onerror = function () { setStatusEl('orkStatus', '讀取檔案失敗。', 'bad'); };
    fr.readAsArrayBuffer(file);
  }

  function importModes(text) {
    try {
      var r = CSV.parseModes(text), n = 0;
      r.freqs.forEach(function (f) { if (state.vortex.modes.length < 12) { state.vortex.modes.push(f); n++; } });
      renderModeList(); schedule();
      setStatusEl('modeStatus', '已加入 ' + n + ' 個頻率' + (r.truncated || n < r.freqs.length ? '（最多 12 個）' : '') + '。', 'ok');
    } catch (e) { setStatusEl('modeStatus', e.message, 'bad'); }
  }

  function readTextFile(file, cb, statusId) {
    if (!file) return;
    if (file.size > 400000) { setStatusEl(statusId, '檔案過大。', 'bad'); return; }
    var fr = new FileReader(); fr.onload = function () { cb(String(fr.result)); }; fr.onerror = function () { setStatusEl(statusId, '讀取檔案失敗。', 'bad'); }; fr.readAsText(file);
  }

  function importCn(text) {
    try {
      state.mass.cnTable = CSV.parsePairs(text);
      setStatusEl('cnStatus', '已匯入 ' + state.mass.cnTable.length + ' 列（Mach ' + fn(state.mass.cnTable[0][0], 2) + ' 到 ' + fn(state.mass.cnTable[state.mass.cnTable.length - 1][0], 2) + '）。', 'ok');
    } catch (e) { setStatusEl('cnStatus', e.message, 'bad'); }
    $('btnCnClear').hidden = !state.mass.cnTable; renderAll();
  }

  // ================= 報告 =================
  function reportCss() {
    return fetch('styles.css').then(function (r) { if (!r.ok) throw 0; return r.text(); }).catch(function () {
      try { return Array.prototype.map.call(document.styleSheets, function (sh) { return Array.prototype.map.call(sh.cssRules, function (r) { return r.cssText; }).join('\n'); }).join('\n'); } catch (e) { return ''; }
    });
  }
  function inputRows() {
    var g = state.geom, fl = state.flight, rows = [
      ['根部弦長 c_r', fu('length', g.r_mm, 1) + ' ' + un('length')], ['尖端弦長 c_t', fu('length', g.c_mm, 1) + ' ' + un('length')],
      ['單片翼展 b', fu('length', g.b_mm, 1) + ' ' + un('length')], ['前緣後退長度 m', fu('length', g.m_mm, 1) + ' ' + un('length')], ['厚度 t', fu('length', g.t_mm, 2) + ' ' + un('length')],
      ['剪切模量 G', fu('modulus', state.G_GPa, 2) + ' ' + un('modulus') + '（敏感度 ±' + fn(state.Gpct, 0) + '%）'],
      ['判定依據', state.judge === 'conservative' ? '三種公式取最低' : P.METHODS[state.method]],
      ['預期最大速度', spd(fl.vmax)], ['安全係數', fn(fl.sf, 2)], ['最大速度的離地高度', fu('altitude', fl.aglMax_m, 0) + ' ' + un('altitude')],
      ['大氣', fl.mode === 'std' ? '標準大氣，發射場海拔 ' + fu('altitude', fl.launchElev_m, 0) + ' ' + un('altitude') : '當地大氣，氣溫 ' + fu('temp', fl.launchT_C, 1) + ' ' + un('temp') + '，測站氣壓 ' + fu('pressure', fl.stationP_Pa, 2) + ' ' + un('pressure')]
    ];
    if (state.corr.sect !== 'flat') rows.push(['剖面修正', ({ bevel: '前後緣斜削', wedge: '雙楔形', biconvex: '雙凸形' })[state.corr.sect] + '，等效厚度 ×' + fn(tFactor(), 2)]);
    if (isNum(state.corr.rootK)) rows.push(['根部剛度比', fn(state.corr.rootK, 2)]);
    if (isNum(state.thermal.finT_C)) rows.push(['鰭片溫度', fu('temp', state.thermal.finT_C, 0) + ' ' + un('temp') + '（G 折減 ×' + fn(effG() / state.G_GPa, 2) + '）']);
    return rows;
  }
  function makeReport() {
    renderAll();
    reportCss().then(function (css) {
      var parts = [['顫振分析', 'out-analysis']]; if (state.traj) parts.push(['飛行軌跡', 'out-traj']); parts.push(['渦流與模態', 'out-vortex']); if (state.cal.length) parts.push(['與 Ansys 比對', 'out-cal']);
      var body = '<h1>鰭片顫振計算報告</h1><p class="hint">' + esc(new Date().toLocaleString()) + ' · ' + (state.units === 'si' ? '公制' : '英制') + '</p>' +
        '<section class="panel"><h2>輸入</h2><div class="tablewrap"><table><tbody>' + inputRows().map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' +
        parts.map(function (p) { return '<h2 class="rep-h">' + p[0] + '</h2>' + $(p[1]).innerHTML; }).join('') +
        '<p class="hint">本報告由「鰭片顫振計算器」產生，是設計階段的篩選計算，不能取代正式的氣動彈性分析或飛行測試。</p>';
      var html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>鰭片顫振計算報告</title><style>' + css +
        '\n:root:root:root{--bg:#fff;--surface:#fff;--surface-2:#f4f6f9;--fg:#111;--muted:#444;--line:#bbb;--accent:#1f4fd1;--accent-fg:#fff;--ok:#17794a;--ok-bg:#dff3e8;--warn:#8a5a00;--warn-bg:#fbefd2;--bad:#b3261e;--bad-bg:#fbe4e1;color-scheme:light}' +
        '\nbody{padding:16px;background:#fff;max-width:900px;margin:0 auto}button,.btn,.tb,select,.no-print,.pts-actions{display:none!important}.rep-h{margin:24px 0 8px}.panel,.verdict{break-inside:avoid;margin-bottom:12px}</style></head><body>' + body + '</body></html>';
      download('flutter-report-' + stamp() + '.html', html, 'text/html');
      toolMsg('已匯出報告。用瀏覽器開啟後，可以列印或存成 PDF。', 'ok');
    });
  }

  // ================= 總控 =================
  function renderAll() {
    var jobs = [['out-analysis', renderAnalysis], ['out-traj', renderTraj], ['out-vortex', renderVortex], ['out-mass', renderMass], ['out-cal', renderCal], ['out-adv', renderAdv]];
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
    // OpenRocket 檔案
    $('orkFile').addEventListener('change', function (e) { readOrkFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    var od = $('orkDrop');
    ['dragenter', 'dragover'].forEach(function (n) { od.addEventListener(n, function (e) { e.preventDefault(); od.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { od.addEventListener(n, function () { od.classList.remove('over'); }); });
    od.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readOrkFile(f); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-orkload],#btnOrkSim,[data-calrm],[data-thermal]') : null;
      if (!t) return;
      if (t.hasAttribute('data-orkload')) loadOrkFin(parseInt(t.getAttribute('data-orkload'), 10));
      else if (t.id === 'btnOrkSim') applyOrkSim();
      else if (t.hasAttribute('data-calrm')) { state.cal.splice(parseInt(t.getAttribute('data-calrm'), 10), 1); renderAll(); }
      else if (t.hasAttribute('data-thermal')) {
        var v = t.getAttribute('data-thermal');
        state.thermal.finT_C = v === 'off' ? null : parseFloat(v);
        refreshInputs(true); renderAll();
      }
    });
    $('out-analysis').addEventListener('change', function (e) { if (e.target && e.target.id === 'sweepVar') { ui.sweep = e.target.value === 'b' ? 'b' : 't'; renderAnalysis(); } });
    // Ansys 結果匯入
    $('btnModeImport').addEventListener('click', function () { importModes($('modeText').value); });
    $('modeFile').addEventListener('change', function (e) { readTextFile(e.target.files && e.target.files[0], importModes, 'modeStatus'); e.target.value = ''; });
    $('cnFile').addEventListener('change', function (e) { readTextFile(e.target.files && e.target.files[0], importCn, 'cnStatus'); e.target.value = ''; });
    $('btnCnClear').addEventListener('click', function () { state.mass.cnTable = null; $('btnCnClear').hidden = true; setStatusEl('cnStatus', ''); renderAll(); });
    $('btnCalAdd').addEventListener('click', addCalCase);
    $('btnAdvRun').addEventListener('click', runAdv);
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'btnAdvModes' && ui.adv) {
        var n = 0; ui.adv.r.freqs.forEach(function (f) { if (state.vortex.modes.length < 12) { state.vortex.modes.push(Math.round(f * 10) / 10); n++; } });
        renderModeList(); schedule(); toolMsg('已把 ' + n + ' 個頻率加入渦流分頁。這是平板模型的值，不含安裝柔度。', 'ok');
      }
    });
    $('btnReport').addEventListener('click', makeReport);
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
