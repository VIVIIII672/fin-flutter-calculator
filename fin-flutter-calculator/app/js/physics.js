/*
 * 計算核心（純函式，瀏覽器與 Node 都能用）
 *
 * 內部單位：長度 mm、剪切模量 GPa、速度 m/s、高度 m、壓力 Pa、溫度 °C、
 *          質量 g、密度 g/cm³、力 N、力矩 N·m、剛度 N/m。
 * 公式內部一律換成 SI（m、Pa、kg）再計算。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = { T0: 288.15, p0: 101325, lapse: 0.0065, R: 287.05287, g: 9.80665, gamma: 1.4 };
  var TROPO_LIMIT_M = 11000;
  var STD_LIMIT_M = 20000;

  // ---------- 大氣 ----------
  // 標準大氣：mslM 為海平面以上高度，11 到 20 km 為等溫層
  function standardAtmosphere(mslM) {
    var h = mslM, T, p;
    if (h <= TROPO_LIMIT_M) {
      T = C.T0 - C.lapse * h;
      p = C.p0 * Math.pow(T / C.T0, C.g / (C.R * C.lapse));
    } else {
      T = 216.65;
      var p11 = C.p0 * Math.pow(216.65 / C.T0, C.g / (C.R * C.lapse));
      p = p11 * Math.exp(-C.g * (h - TROPO_LIMIT_M) / (C.R * T));
    }
    return finishAtm(T, p, h > STD_LIMIT_M || h < 0);
  }

  // 當地大氣：以發射場的溫度與測站氣壓為起點，往上只用對流層模型
  function localAtmosphere(aglM, launchTempK, stationPa) {
    var T = launchTempK - C.lapse * aglM;
    var p = stationPa * Math.pow(T / launchTempK, C.g / (C.R * C.lapse));
    return finishAtm(T, p, aglM > TROPO_LIMIT_M || aglM < 0);
  }

  function finishAtm(T, p, outOfRange) {
    return { T: T, p: p, rho: p / (C.R * T), a: Math.sqrt(C.gamma * C.R * T), outOfRange: !!outOfRange };
  }

  // flight: { mode: 'std' | 'local', launchElev_m, launchT_C, stationP_Pa }
  function atmosphereAt(flight, aglM) {
    if (flight.mode === 'local') return localAtmosphere(aglM, flight.launchT_C + 273.15, flight.stationP_Pa);
    return standardAtmosphere(flight.launchElev_m + aglM);
  }

  // ---------- 鰭片幾何 ----------
  // geom: { r_mm, c_mm, b_mm, m_mm, t_mm }
  function planform(geom) {
    var r = geom.r_mm / 1000, c = geom.c_mm / 1000, b = geom.b_mm / 1000, m = (geom.m_mm || 0) / 1000, t = geom.t_mm / 1000;
    var S = (r + c) * b / 2;
    var AR = b * b / S;
    var lam = c / r;
    var tau = t / r;
    var Cx = (2 * c * m + c * c + m * r + c * r + r * r) / (3 * (c + r));
    return { r: r, c: c, b: b, m: m, t: t, S: S, AR: AR, lam: lam, tau: tau, Cx: Cx, eps: Cx / r - 0.25 };
  }

  // ---------- 顫振速度 ----------
  // method: 'user'（使用者提供的公式，含 2G 與 1.337）
  //         'martin'（固定 ε = 0.25，去掉多出來的因子 2）
  //         'bennett'（形心修正，ε = Cx/r − 0.25）
  // G_GPa：剪切模量；p_Pa、a_mps：該高度的壓力與音速
  function flutter(geom, G_GPa, p_Pa, a_mps, method) {
    var f = planform(geom), G = G_GPa * 1e9;
    var out = { f: f, Vf: NaN, valid: true, reason: '' };
    if (!(p_Pa > 0) || !(a_mps > 0) || !(G > 0)) { out.valid = false; out.reason = '壓力、音速與剪切模量必須大於 0'; return out; }
    var common = Math.pow(f.tau, 3) * (f.AR + 2) / (Math.pow(f.AR, 3) * (f.lam + 1) * p_Pa);
    if (method === 'bennett') {
      if (!(f.eps > 0)) { out.valid = false; out.reason = 'Bennett 修正的 ε 必須大於 0（ε = ' + f.eps.toFixed(3) + '）'; return out; }
      var D = (24 * f.eps * C.gamma * p_Pa / Math.PI) * Math.pow(f.AR, 3) / (Math.pow(f.tau, 3) * (f.AR + 2)) * (f.lam + 1) / 2;
      out.Vf = a_mps * Math.sqrt(G / D);
    } else if (method === 'martin') {
      out.Vf = a_mps * Math.sqrt(G * common / 1.337);
    } else {
      out.Vf = a_mps * Math.sqrt(2 * G * common / 1.337);
    }
    return out;
  }

  var METHODS = {
    user: '你提供的公式（含 2G）',
    martin: '固定 ε = 0.25（去掉多出的 2）',
    bennett: 'Bennett 形心修正'
  };

  // ---------- 輸入檢查 ----------
  function validateGeometry(geom) {
    var errs = [];
    function pos(v, name) { if (!(typeof v === 'number' && isFinite(v) && v > 0)) errs.push(name + '必須大於 0'); }
    pos(geom.r_mm, '根部弦長'); pos(geom.b_mm, '單片翼展'); pos(geom.t_mm, '厚度');
    if (!(typeof geom.c_mm === 'number' && isFinite(geom.c_mm) && geom.c_mm >= 0)) errs.push('尖端弦長不可為負數');
    if (!(typeof geom.m_mm === 'number' && isFinite(geom.m_mm) && geom.m_mm >= 0)) errs.push('前緣後退長度不可為負數');
    return errs;
  }

  // ---------- 單點評估 ----------
  // st: { geom, G_GPa, Gpct, method, flight }
  // 回傳在指定高度（離地）與速度下的結果
  function evaluatePoint(st, aglM, speed) {
    var atm = atmosphereAt(st.flight, aglM);
    var u = (st.Gpct || 0) / 100;
    var Gs = { low: st.G_GPa * (1 - u), nom: st.G_GPa, high: st.G_GPa * (1 + u) };
    var res = { atm: atm, speed: speed, mach: speed / atm.a, q: 0.5 * atm.rho * speed * speed, Vf: {}, margin: {}, valid: true, reason: '' };
    ['low', 'nom', 'high'].forEach(function (k) {
      var fl = flutter(st.geom, Gs[k], atm.p, atm.a, st.method);
      res.Vf[k] = fl.Vf;
      if (!fl.valid) { res.valid = false; res.reason = fl.reason; }
      res.margin[k] = speed > 0 ? 100 * (fl.Vf / speed - 1) : NaN;
      res.f = fl.f;
    });
    res.G = Gs;
    return res;
  }

  // ---------- 軌跡 ----------
  function evaluateTrajectory(st, rows) {
    var out = [], minMargin = Infinity, minIdx = -1, maxQ = 0, maxQIdx = -1, maxMach = 0, maxMachIdx = -1;
    var outOfRange = 0, supersonicRows = 0, invalid = 0;
    rows.forEach(function (row, i) {
      var pt = evaluatePoint(st, row.alt_m, row.v);
      var rec = { t: row.t, alt: row.alt_m, v: row.v, mach: pt.mach, q: pt.q, VfLow: pt.Vf.low, VfNom: pt.Vf.nom, VfHigh: pt.Vf.high, marginLow: pt.margin.low, oor: pt.atm.outOfRange, valid: pt.valid };
      out.push(rec);
      if (pt.atm.outOfRange) outOfRange++;
      if (!pt.valid) invalid++;
      if (pt.mach > 1.5) supersonicRows++;
      if (pt.q > maxQ) { maxQ = pt.q; maxQIdx = i; }
      if (pt.mach > maxMach) { maxMach = pt.mach; maxMachIdx = i; }
      if (row.v > 0 && isFinite(rec.marginLow) && rec.marginLow < minMargin) { minMargin = rec.marginLow; minIdx = i; }
    });
    return {
      rows: out, minMargin: minIdx >= 0 ? minMargin : NaN, minIdx: minIdx, maxQ: maxQ, maxQIdx: maxQIdx,
      maxMach: maxMach, maxMachIdx: maxMachIdx, outOfRange: outOfRange, supersonicRows: supersonicRows, invalid: invalid
    };
  }

  // ---------- 渦流與模態 ----------
  function strouhal(St, L_mm, U) { return St * U / (L_mm / 1000); }            // 渦流脫落頻率 Hz
  function crossingSpeed(fn, St, L_mm) { return fn * (L_mm / 1000) / St; }      // 與模態頻率相交的速度 m/s
  function modeBand(fn, tolPct, St, L_mm) {
    var tol = tolPct / 100;
    return { lo: crossingSpeed(fn * (1 - tol), St, L_mm), center: crossingSpeed(fn, St, L_mm), hi: crossingSpeed(fn * (1 + tol), St, L_mm) };
  }
  function singleDof(k_Npm, m_g) { return Math.sqrt(k_Npm / (m_g / 1000)) / (2 * Math.PI); }

  // ---------- 安裝與配重 ----------
  // ms: { fins, density_gcc, addMass_g, assemblyX_mm, baseM_g, baseX_mm, cp_mm, od_mm, Cn, lever_mm }
  function massStudy(geom, ms, q_Pa) {
    var f = planform(geom);
    // S[m²]·t[m]·ρ[kg/m³] = kg，再乘 1000 換成 g（密度 g/cm³ × 1000 = kg/m³）
    var finMass_g = f.S * f.t * (ms.density_gcc * 1000) * 1000;
    var assembly_g = ms.fins * finMass_g + ms.addMass_g;
    var out = { finMass_g: finMass_g, assembly_g: assembly_g, S_m2: f.S };
    if (ms.baseM_g > 0 && isFinite(ms.baseX_mm) && isFinite(ms.assemblyX_mm)) {
      out.cg_mm = (ms.baseM_g * ms.baseX_mm + assembly_g * ms.assemblyX_mm) / (ms.baseM_g + assembly_g);
      if (ms.od_mm > 0 && isFinite(ms.cp_mm)) out.staticMargin_cal = (ms.cp_mm - out.cg_mm) / ms.od_mm;
    }
    if (q_Pa >= 0 && ms.Cn >= 0) {
      out.F_N = q_Pa * f.S * ms.Cn;
      out.M_Nm = out.F_N * (ms.lever_mm / 1000);
    }
    return out;
  }

  // ---------- 建議值 ----------
  // 速度比 req/Vf：厚度 ∝ Vf^(2/3)，剪切模量 ∝ Vf²，翼展用二分法
  function suggestions(st, aglM, speedReq, GGPa) {
    var atm = atmosphereAt(st.flight, aglM);
    function vf(over) {
      var g = Object.assign({}, st.geom, over.geom || {});
      return flutter(g, over.G !== undefined ? over.G : GGPa, atm.p, atm.a, st.method);
    }
    var base = vf({});
    if (!base.valid || !(base.Vf > 0)) return null;
    var ratio = speedReq / base.Vf;
    var out = { Vf: base.Vf, t_mm: st.geom.t_mm * Math.pow(ratio, 2 / 3), G_GPa: GGPa * ratio * ratio, b_mm: null, bCap: false };
    var lo = st.geom.b_mm * 0.01, hi = st.geom.b_mm * 10;
    var top = vf({ geom: { b_mm: hi } });
    if (top.valid && top.Vf >= speedReq) { out.bCap = true; out.b_mm = hi; }
    else {
      var bot = vf({ geom: { b_mm: lo } });
      if (!bot.valid || bot.Vf < speedReq) { out.b_mm = NaN; }
      else {
        for (var i = 0; i < 80; i++) {
          var mid = (lo + hi) / 2, r = vf({ geom: { b_mm: mid } });
          if (r.valid && r.Vf >= speedReq) lo = mid; else hi = mid;
        }
        out.b_mm = lo;
      }
    }
    return out;
  }

  return {
    C: C, METHODS: METHODS, TROPO_LIMIT_M: TROPO_LIMIT_M, STD_LIMIT_M: STD_LIMIT_M,
    standardAtmosphere: standardAtmosphere, localAtmosphere: localAtmosphere, atmosphereAt: atmosphereAt,
    planform: planform, flutter: flutter, validateGeometry: validateGeometry,
    evaluatePoint: evaluatePoint, evaluateTrajectory: evaluateTrajectory,
    strouhal: strouhal, crossingSpeed: crossingSpeed, modeBand: modeBand, singleDof: singleDof,
    massStudy: massStudy, suggestions: suggestions
  };
});
