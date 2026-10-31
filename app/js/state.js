/*
 * 狀態、材料表、存檔（快照）與匯入檢查。
 * 狀態內一律使用基準單位（mm、GPa、m/s、m、Pa、°C、g、g/cm³、N/m）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // G、密度皆為典型參考值（範圍代表常見板材的差異），實際請以供應商資料或測試為準。lo/hi 為 G 的範圍。
  var MATS = [
    { id: 'g10', name: '玻纖板 G10', G: 4.5, lo: 3.5, hi: 5.5, rho: 1.85, kw: ['g10', 'g-10', 'fr4', 'fr-4', 'fiberglass', 'glass', '玻纖'] },
    { id: 'cf', name: '碳纖維板（準各向同性）', G: 17, lo: 8, hi: 28, rho: 1.78, kw: ['carbon', 'graphite', '碳'] },
    { id: 'al6061', name: '鋁 6061-T6', G: 26, lo: 25, hi: 27, rho: 2.7, kw: ['6061', 'aluminum', 'aluminium', '鋁'] },
    { id: 'al7075', name: '鋁 7075-T6', G: 26.9, lo: 26, hi: 28, rho: 2.8, kw: ['7075'] },
    { id: 'steel', name: '鋼', G: 79, lo: 76, hi: 81, rho: 7.85, kw: ['steel', '鋼'] },
    { id: 'ti', name: '鈦合金 Ti-6Al-4V', G: 42, lo: 40, hi: 44, rho: 4.43, kw: ['titanium', '鈦'] },
    { id: 'ply', name: '樺木夾板', G: 0.7, lo: 0.4, hi: 1.0, rho: 0.7, kw: ['plywood', 'birch', '夾板'] },
    { id: 'balsa', name: '輕木', G: 0.15, lo: 0.08, hi: 0.25, rho: 0.15, kw: ['balsa', '輕木'] },
    { id: 'acrylic', name: '壓克力 PMMA', G: 1.1, lo: 0.9, hi: 1.3, rho: 1.18, kw: ['acrylic', 'pmma', 'plexi', '壓克力'] },
    { id: 'abs', name: 'ABS 塑膠', G: 0.8, lo: 0.6, hi: 1.0, rho: 1.05, kw: ['abs'] }
  ];

  // 依材料名稱比對（OpenRocket 的材料只有名稱與密度）。找不到回傳 null。
  function matchMaterial(name) {
    var n = String(name || '').toLowerCase();
    if (!n) return null;
    for (var i = 0; i < MATS.length; i++) {
      for (var j = 0; j < MATS[i].kw.length; j++) if (n.indexOf(MATS[i].kw[j]) >= 0) return MATS[i];
    }
    return null;
  }

  var FORMAT = 'fin-flutter-calculator';
  var VERSION = 1;
  var MAX_SNAPSHOTS = 12;

  function defaults() {
    return {
      units: 'si',
      geom: { r_mm: 150, c_mm: 75, b_mm: 100, m_mm: 0, t_mm: 3 },
      shape: null,
      mat: 'g10', G_GPa: 4.5, Gpct: 30, density_gcc: 1.85,
      method: 'user', judge: 'conservative',
      thermal: { finT_C: null, kLoss: 10 },
      cal: [],
      flight: { vmax: 250, sf: 1.5, aglMax_m: 0, mode: 'std', launchElev_m: 0, launchT_C: 15, stationP_Pa: 101325 },
      traj: null,
      vortex: { St: 0.2, L_mm: 4.7625, tolPct: 10, modes: [500], k_Npm: null, m_g: null },
      mass: { fins: 4, addMass_g: 0, assemblyX_mm: null, baseM_g: null, baseX_mm: null, cp_mm: null, od_mm: null, Cn: 2, cnTable: null, lever_mm: null, note: '' }
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 依預設值的結構逐欄檢查，型別不對的欄位保留預設值；回傳 { state, problems }
  function sanitize(raw) {
    var problems = [], st = defaults();
    if (!raw || typeof raw !== 'object') throw new Error('檔案內容不是有效的案例。');
    function takeNum(dst, src, key, allowNull) {
      if (!src || !(key in src)) return;
      var v = src[key];
      if (allowNull && v === null) { dst[key] = null; return; }
      if (isNum(v)) dst[key] = v; else problems.push(key + ' 不是有效數字，已使用預設值');
    }
    function takeEnum(dst, src, key, allowed) {
      if (!src || !(key in src)) return;
      if (allowed.indexOf(src[key]) >= 0) dst[key] = src[key]; else problems.push(key + ' 的值無法辨識，已使用預設值');
    }
    takeEnum(st, raw, 'units', ['si', 'imperial']);
    ['r_mm', 'c_mm', 'b_mm', 'm_mm', 't_mm'].forEach(function (k) { takeNum(st.geom, raw.geom, k); });
    takeEnum(st, raw, 'mat', MATS.map(function (m) { return m.id; }).concat(['custom']));
    takeNum(st, raw, 'G_GPa'); takeNum(st, raw, 'Gpct'); takeNum(st, raw, 'density_gcc');
    takeEnum(st, raw, 'method', ['user', 'martin', 'bennett']);
    takeEnum(st, raw, 'judge', ['conservative', 'selected']);
    takeNum(st.thermal, raw.thermal, 'kLoss'); takeNum(st.thermal, raw.thermal, 'finT_C', true);
    if (raw.mass && Array.isArray(raw.mass.cnTable) && raw.mass.cnTable.length >= 2 && raw.mass.cnTable.length <= 500 &&
        raw.mass.cnTable.every(function (q) { return Array.isArray(q) && isNum(q[0]) && isNum(q[1]) && q[0] >= 0; })) {
      st.mass.cnTable = raw.mass.cnTable.map(function (q) { return [q[0], q[1]]; }).sort(function (a, b) { return a[0] - b[0]; });
    }
    if (Array.isArray(raw.cal)) {
      raw.cal.slice(0, 20).forEach(function (c) {
        if (!c || !c.geom || !isNum(c.Vref) || !(c.Vref > 0) || !isNum(c.G_GPa) || !isNum(c.aglM) || !c.flight) return;
        var g = {}, ok = ['r_mm', 'c_mm', 'b_mm', 'm_mm', 't_mm'].every(function (k) { g[k] = c.geom[k]; return isNum(g[k]); });
        var f = defaults().flight;
        ['launchElev_m', 'launchT_C', 'stationP_Pa'].forEach(function (k) { if (isNum(c.flight[k])) f[k] = c.flight[k]; });
        if (c.flight.mode === 'std' || c.flight.mode === 'local') f.mode = c.flight.mode;
        if (ok) st.cal.push({ name: String(c.name || '').slice(0, 60), geom: g, G_GPa: c.G_GPa, aglM: c.aglM, flight: f, Vref: c.Vref, source: String(c.source || '').slice(0, 60) });
      });
    }
    ['vmax', 'sf', 'aglMax_m', 'launchElev_m', 'launchT_C', 'stationP_Pa'].forEach(function (k) { takeNum(st.flight, raw.flight, k); });
    takeEnum(st.flight, raw.flight, 'mode', ['std', 'local']);
    ['St', 'L_mm', 'tolPct'].forEach(function (k) { takeNum(st.vortex, raw.vortex, k); });
    ['k_Npm', 'm_g'].forEach(function (k) { takeNum(st.vortex, raw.vortex, k, true); });
    if (raw.vortex && Array.isArray(raw.vortex.modes)) {
      st.vortex.modes = raw.vortex.modes.filter(isNum).slice(0, 12);
    }
    ['fins', 'addMass_g', 'Cn'].forEach(function (k) { takeNum(st.mass, raw.mass, k); });
    ['assemblyX_mm', 'baseM_g', 'baseX_mm', 'cp_mm', 'od_mm', 'lever_mm'].forEach(function (k) { takeNum(st.mass, raw.mass, k, true); });
    if (raw.mass && typeof raw.mass.note === 'string') st.mass.note = raw.mass.note.slice(0, 4000);
    if (Array.isArray(raw.shape) && raw.shape.length >= 3 && raw.shape.length <= 64 &&
        raw.shape.every(function (q) { return Array.isArray(q) && isNum(q[0]) && isNum(q[1]); })) {
      st.shape = raw.shape.map(function (q) { return [q[0], q[1]]; });
    }
    if (raw.traj && Array.isArray(raw.traj.rows)) {
      var rows = raw.traj.rows, ok = rows.length >= 2 && rows.length <= 10000;
      for (var i = 0; ok && i < rows.length; i++) {
        var r = rows[i];
        ok = r && isNum(r.t) && isNum(r.alt_m) && isNum(r.v) && r.v >= 0 && (i === 0 || r.t > rows[i - 1].t);
      }
      if (ok) st.traj = { name: typeof raw.traj.name === 'string' ? raw.traj.name.slice(0, 200) : '', rows: rows.map(function (r) { return { t: r.t, alt_m: r.alt_m, v: r.v }; }) };
      else problems.push('飛行軌跡資料不完整或時間未遞增，已略過');
    }
    return { state: st, problems: problems };
  }

  // ---- 匯出入 ----
  function exportCase(state) {
    return JSON.stringify({ format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), state: state }, null, 2);
  }

  function importCase(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('檔案不是有效的 JSON。'); }
    if (!obj || obj.format !== FORMAT) throw new Error('這不是本程式匯出的案例檔。');
    if (obj.version !== VERSION) throw new Error('案例檔版本（' + obj.version + '）與本程式（' + VERSION + '）不相容。');
    return sanitize(obj.state);
  }

  // ---- 儲存（Electron 用檔案，瀏覽器用 localStorage） ----
  function storeGet(key) {
    if (typeof window !== 'undefined' && window.finStore) return window.finStore.get(key);
    return new Promise(function (resolve) {
      try { var v = localStorage.getItem('finflutter:' + key); resolve(v ? JSON.parse(v) : null); } catch (e) { resolve(null); }
    });
  }
  function storeSet(key, value) {
    if (typeof window !== 'undefined' && window.finStore) return window.finStore.set(key, value);
    return new Promise(function (resolve, reject) {
      try { localStorage.setItem('finflutter:' + key, JSON.stringify(value)); resolve(true); } catch (e) { reject(e); }
    });
  }

  // 快照不含飛行軌跡（體積大），完整案例請用 JSON 匯出
  function listSnapshots() { return storeGet('snapshots').then(function (v) { return Array.isArray(v) ? v : []; }); }
  function addSnapshot(name, state) {
    return listSnapshots().then(function (list) {
      var snap = clone(state); snap.traj = null;
      list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || '未命名', savedAt: new Date().toISOString(), state: snap });
      list = list.slice(0, MAX_SNAPSHOTS);
      return storeSet('snapshots', list).then(function () { return list; });
    });
  }
  function deleteSnapshot(id) {
    return listSnapshots().then(function (list) {
      list = list.filter(function (s) { return s.id !== id; });
      return storeSet('snapshots', list).then(function () { return list; });
    });
  }

  return {
    MATS: MATS, matchMaterial: matchMaterial, MAX_SNAPSHOTS: MAX_SNAPSHOTS, defaults: defaults, clone: clone, sanitize: sanitize,
    exportCase: exportCase, importCase: importCase, storeGet: storeGet, storeSet: storeSet,
    listSnapshots: listSnapshots, addSnapshot: addSnapshot, deleteSnapshot: deleteSnapshot
  };
});
