/*
 * 單位換算。內部基準單位：mm、GPa、m/s、m、Pa、°C、g、g/cm³、N、N·m、N/m。
 * 每個量綱有公制與英制兩種顯示單位；toBase / fromBase 做轉換。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinUnits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IN = 25.4, FT = 0.3048, PSI = 6894.757293168, OZ = 28.349523125, LBF = 4.4482216152605;
  var GCC_TO_LBFT3 = 62.42796;

  // si / imperial: { unit: 顯示單位, k: 顯示值 × k = 基準值, off: 顯示值 × k + off = 基準值, dec: 小數位, step }
  var DIM = {
    length:   { si: { u: 'mm', k: 1, dec: 1, step: 0.1 },        imp: { u: 'in', k: IN, dec: 3, step: 0.001 } },
    modulus:  { si: { u: 'GPa', k: 1, dec: 2, step: 0.1 },       imp: { u: 'psi', k: PSI / 1e9, dec: 0, step: 1000 } },
    speed:    { si: { u: 'm/s', k: 1, dec: 1, step: 1 },         imp: { u: 'ft/s', k: FT, dec: 1, step: 1 } },
    altitude: { si: { u: 'm', k: 1, dec: 0, step: 10 },          imp: { u: 'ft', k: FT, dec: 0, step: 10 } },
    pressure: { si: { u: 'hPa', k: 100, dec: 2, step: 0.1 },     imp: { u: 'psi', k: PSI, dec: 4, step: 0.01 } },
    temp:     { si: { u: '°C', k: 1, off: 0, dec: 1, step: 0.5 }, imp: { u: '°F', k: 5 / 9, off: -32 * 5 / 9, dec: 1, step: 0.5 } },
    mass:     { si: { u: 'g', k: 1, dec: 1, step: 1 },           imp: { u: 'oz', k: OZ, dec: 2, step: 0.1 } },
    density:  { si: { u: 'g/cm³', k: 1, dec: 3, step: 0.01 },    imp: { u: 'lb/ft³', k: 1 / GCC_TO_LBFT3, dec: 1, step: 1 } },
    force:    { si: { u: 'N', k: 1, dec: 1, step: 1 },           imp: { u: 'lbf', k: LBF, dec: 1, step: 1 } },
    moment:   { si: { u: 'N·m', k: 1, dec: 1, step: 1 },         imp: { u: 'lbf·in', k: 0.1129848290276, dec: 1, step: 1 } },
    stiffness:{ si: { u: 'N/m', k: 1, dec: 0, step: 100 },       imp: { u: 'lbf/in', k: 175.12683525, dec: 1, step: 1 } },
    freq:     { si: { u: 'Hz', k: 1, dec: 1, step: 1 },          imp: { u: 'Hz', k: 1, dec: 1, step: 1 } },
    pct:      { si: { u: '%', k: 1, dec: 1, step: 1 },           imp: { u: '%', k: 1, dec: 1, step: 1 } },
    none:     { si: { u: '', k: 1, dec: 2, step: 0.01 },         imp: { u: '', k: 1, dec: 2, step: 0.01 } }
  };

  function spec(dim, sys) { return DIM[dim][sys === 'imperial' ? 'imp' : 'si']; }
  function toBase(dim, sys, v) { var s = spec(dim, sys); return v * s.k + (s.off || 0); }
  function fromBase(dim, sys, v) { var s = spec(dim, sys); return (v - (s.off || 0)) / s.k; }
  function unit(dim, sys) { return spec(dim, sys).u; }

  function fmt(dim, sys, baseValue, decOverride) {
    if (!(typeof baseValue === 'number' && isFinite(baseValue))) return '—';
    var s = spec(dim, sys), d = decOverride === undefined ? s.dec : decOverride;
    return fromBase(dim, sys, baseValue).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // 輸入框顯示用：去掉多餘的小數尾數，避免 0.1 + 0.2 之類的雜訊
  function inputValue(dim, sys, baseValue) {
    if (!(typeof baseValue === 'number' && isFinite(baseValue))) return '';
    var s = spec(dim, sys), v = fromBase(dim, sys, baseValue);
    var d = Math.max(s.dec, 0) + 2;
    return String(parseFloat(v.toFixed(d)));
  }

  return { DIM: DIM, spec: spec, toBase: toBase, fromBase: fromBase, unit: unit, fmt: fmt, inputValue: inputValue, constants: { IN: IN, FT: FT, PSI: PSI, OZ: OZ, LBF: LBF } };
});
