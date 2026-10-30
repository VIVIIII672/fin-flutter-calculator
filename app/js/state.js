/*
 * 狀態、材料表、存檔（快照）與匯入檢查。
 * 狀態內一律使用基準單位（mm、GPa、m/s、m、Pa、°C、g、g/cm³、N/m）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MATS = [
    { id: 'g10', name: '玻纖板 G10', G: 4.5, rho: 1.85 },
    { id: 'cf', name: '碳纖維板（準各向同性）', G: 17, rho: 1.78 },
    { id: 'al6061', name: '鋁 6061-T6', G: 26, rho: 2.7 },
    { id: 'al7075', name: '鋁 7075-T6', G: 26.9, rho: 2.8 },
    { id: 'ply', name: '樺木夾板', G: 0.7, rho: 0.7 }
  ];

  var FORMAT = 'fin-flutter-calculator';
  var VERSION = 1;
  var MAX_SNAPSHOTS = 12;

  function defaults() {
    return {
      units: 'si',
      geom: { r_mm: 150, c_mm: 75, b_mm: 100, m_mm: 0, t_mm: 3 },
      shape: null,
      mat: 'g10', G_GPa: 4.5, Gpct: 30, density_gcc: 1.85,
      method: 'user',
      flight: { vmax: 250, sf: 1.5, aglMax_m: 0, mode: 'std', launchElev_m: 0, launchT_C: 15, stationP_Pa: 101325 },
      traj: null,
      vortex: { St: 0.2, L_mm: 4.7625, tolPct: 10, modes: [500], k_Npm: null, m_g: null },
      mass: { fins: 4, addMass_g: 0, assemblyX_mm: null, baseM_g: null, baseX_mm: null, cp_mm: null, od_mm: null, Cn: 2, lever_mm: null, note: '' }
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
    MATS: MATS, MAX_SNAPSHOTS: MAX_SNAPSHOTS, defaults: defaults, clone: clone, sanitize: sanitize,
    exportCase: exportCase, importCase: importCase, storeGet: storeGet, storeSet: storeSet,
    listSnapshots: listSnapshots, addSnapshot: addSnapshot, deleteSnapshot: deleteSnapshot
  };
});
