'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../app/js/physics.js');
const U = require('../app/js/units.js');
const CSV = require('../app/js/csv.js');

function near(actual, expected, relTol, msg) {
  const err = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(err <= relTol, (msg || '') + ' 預期 ' + expected + '，實際 ' + actual + '（誤差 ' + (err * 100).toFixed(4) + '%）');
}

const FIN = { r_mm: 150, c_mm: 75, b_mm: 100, m_mm: 0, t_mm: 3 };
const STD0 = { mode: 'std', launchElev_m: 0 };

test('標準大氣：海平面與 11 km', () => {
  const a0 = P.standardAtmosphere(0);
  near(a0.a, 340.294, 1e-4); near(a0.p, 101325, 1e-9);
  const a11 = P.standardAtmosphere(11000);
  near(a11.T, 216.65, 1e-9); near(a11.p, 22632, 5e-4);
  assert.equal(P.standardAtmosphere(25000).outOfRange, true);
});

test('你提供的公式：範例鰭片海平面約 410.8 m/s', () => {
  const at = P.atmosphereAt(STD0, 0);
  const r = P.flutter(FIN, 4.5, at.p, at.a, 'user');
  near(r.Vf, 410.8, 5e-4);
});

test('固定 ε = 0.25 等於去掉多出的 2，比你的公式低 √2 倍', () => {
  const at = P.atmosphereAt(STD0, 0);
  const u = P.flutter(FIN, 4.5, at.p, at.a, 'user').Vf;
  const m = P.flutter(FIN, 4.5, at.p, at.a, 'martin').Vf;
  near(u / m, Math.SQRT2, 1e-12);
});

test('Bennett 公開基準案例（英制範例）：Vf ≈ 2087.3 ft/s、餘量 ≈ 39.15%', () => {
  const inch = 25.4;
  const geom = { r_mm: 7.5 * inch, c_mm: 2.5 * inch, b_mm: 3 * inch, m_mm: 4.285 * inch, t_mm: 0.1875 * inch };
  const flight = { mode: 'local', launchT_C: (95 - 32) * 5 / 9, stationP_Pa: 14.73462 * U.constants.PSI };
  const st = { geom: geom, G_GPa: 600000 * U.constants.PSI / 1e9, Gpct: 0, method: 'bennett', flight: flight };
  const pt = P.evaluatePoint(st, 2200 * U.constants.FT, 1500 * U.constants.FT);
  near(pt.Vf.nom / U.constants.FT, 2087.3, 1e-3, 'Vf');
  assert.ok(Math.abs(pt.margin.nom - 39.15) < 0.05, '餘量 ' + pt.margin.nom);
});

test('Bennett：ε ≤ 0 時回報無效而不是給數字', () => {
  const bad = { r_mm: 100, c_mm: 0, b_mm: 100, m_mm: 0, t_mm: 3 };   // 形心在 1/3 弦長，ε>0；改用極端值測試
  const f = P.planform(bad);
  assert.ok(f.eps > 0);
  const weird = P.flutter({ r_mm: 100, c_mm: 100, b_mm: 100, m_mm: -200, t_mm: 3 }, 4, 101325, 340, 'bennett');
  assert.equal(weird.valid, false);
});

test('G 敏感度：Vf 與 √G 成正比', () => {
  const st = { geom: FIN, G_GPa: 10, Gpct: 30, method: 'user', flight: STD0 };
  const pt = P.evaluatePoint(st, 0, 100);
  near(pt.Vf.low / pt.Vf.nom, Math.sqrt(0.7), 1e-12);
  near(pt.Vf.high / pt.Vf.nom, Math.sqrt(1.3), 1e-12);
});

test('單位換算來回一致，溫度為仿射換算', () => {
  ['length', 'modulus', 'speed', 'altitude', 'pressure', 'temp', 'mass', 'density', 'force', 'moment', 'stiffness'].forEach((d) => {
    const base = 123.456;
    near(U.toBase(d, 'imperial', U.fromBase(d, 'imperial', base)), base, 1e-12, d);
  });
  assert.ok(Math.abs(U.toBase('temp', 'imperial', 95) - 35) < 1e-9);
  near(U.toBase('length', 'imperial', 1), 25.4, 1e-12);
  near(U.toBase('modulus', 'imperial', 600000), 4.1368543759, 1e-9);
});

test('CSV：略過事件註解、讀取 # 開頭的標題、轉換單位', () => {
  const text = '# Event LAUNCH at t=0.0 seconds\n# Time (s),Altitude (ft),Vertical velocity (ft/s),Total velocity (ft/s)\n0,0,0,0\n1,100,200,200\n2,3.5e2,300,300\n';
  const r = CSV.parse(text);
  assert.equal(r.rows.length, 3);
  near(r.rows[2].alt_m, 350 * 0.3048, 1e-12);
  near(r.rows[2].v, 300 * 0.3048, 1e-12);
});

test('CSV：拒絕時間未遞增、跨行引號、缺少欄位', () => {
  assert.throws(() => CSV.parse('Time (s),Altitude (m),Total velocity (m/s)\n0,0,0\n0,1,1\n'), /遞增/);
  assert.throws(() => CSV.parse('Time (s),Altitude (m),Total velocity (m/s)\n0,"0,0\n1,1,1\n'), /引號/);
  assert.throws(() => CSV.parse('Time (s),Altitude (m),Foo (m/s)\n0,0,0\n1,1,1\n'), /速度/);
  assert.throws(() => CSV.parse(''), /空的/);
});

test('軌跡：逐點餘量與最小值', () => {
  const st = { geom: FIN, G_GPa: 4.5, Gpct: 30, method: 'user', flight: STD0 };
  const rows = [{ t: 0, alt_m: 0, v: 0 }, { t: 1, alt_m: 100, v: 150 }, { t: 2, alt_m: 500, v: 300 }, { t: 3, alt_m: 900, v: 200 }];
  const res = P.evaluateTrajectory(st, rows);
  const manual = rows.slice(1).map((r) => P.evaluatePoint(st, r.alt_m, r.v).margin.low);
  near(res.minMargin, Math.min.apply(null, manual), 1e-12);
  assert.equal(res.minIdx, manual.indexOf(Math.min.apply(null, manual)) + 1);
  assert.ok(res.maxQ > 0);
});

test('渦流與模態：Strouhal 關係', () => {
  near(P.strouhal(0.2, 4.7625, 100), 0.2 * 100 / 0.0047625, 1e-12);
  near(P.crossingSpeed(500, 0.2, 4.7625), 500 * 0.0047625 / 0.2, 1e-12);
  const b = P.modeBand(500, 10, 0.2, 4.7625);
  assert.ok(b.lo < b.center && b.center < b.hi);
  near(P.singleDof(1e5, 100), Math.sqrt(1e5 / 0.1) / (2 * Math.PI), 1e-12);
});

test('安裝與配重：鰭片質量、合成重心、靜態餘裕、載荷', () => {
  const ms = { fins: 4, density_gcc: 1.85, addMass_g: 20, assemblyX_mm: 1800, baseM_g: 10000, baseX_mm: 1200, cp_mm: 1800, od_mm: 100, Cn: 2, lever_mm: 100 };
  const r = P.massStudy(FIN, ms, 5000);
  const S = (0.15 + 0.075) * 0.1 / 2;
  near(r.finMass_g, S * 0.003 * 1850 * 1000, 1e-12);
  near(r.assembly_g, 4 * r.finMass_g + 20, 1e-12);
  near(r.cg_mm, (10000 * 1200 + r.assembly_g * 1800) / (10000 + r.assembly_g), 1e-12);
  near(r.staticMargin_cal, (1800 - r.cg_mm) / 100, 1e-12);
  near(r.F_N, 5000 * S * 2, 1e-12);
  near(r.M_Nm, r.F_N * 0.1, 1e-12);
});

test('建議值：代回公式後剛好達到要求速度', () => {
  ['user', 'martin', 'bennett'].forEach((method) => {
    const geom = Object.assign({}, FIN, { m_mm: 60 });
    const st = { geom: geom, G_GPa: 4.5, Gpct: 0, method: method, flight: STD0 };
    const at = P.atmosphereAt(st.flight, 0), req = 600;
    const s = P.suggestions(st, 0, req, 4.5);
    near(P.flutter(Object.assign({}, geom, { t_mm: s.t_mm }), 4.5, at.p, at.a, method).Vf, req, 1e-9, method + ' 厚度');
    near(P.flutter(geom, s.G_GPa, at.p, at.a, method).Vf, req, 1e-9, method + ' G');
    if (!s.bCap && isFinite(s.b_mm)) near(P.flutter(Object.assign({}, geom, { b_mm: s.b_mm }), 4.5, at.p, at.a, method).Vf, req, 1e-6, method + ' 翼展');
  });
});
