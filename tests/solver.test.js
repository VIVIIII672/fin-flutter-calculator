const test = require('node:test');
const assert = require('node:assert');
const S = require('../app/js/solver.js');
const P = require('../app/js/physics.js');

const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

test('solver: 細長板退化成懸臂樑，頻率對得上解析解（1.8751²、4.6941²、7.8548²）', () => {
  const md = S.modal({ r_mm: 4, c_mm: 4, b_mm: 200, m_mm: 0, t_mm: 2 }, { E_GPa: 70, nu: 0, rho_gcc: 2.7 }, { nx: 3, ny: 8, nModes: 3, nq: 20 });
  const L = 0.2, k = md.omegas.map(w => w * L * L / Math.sqrt(md.D / md.mu));
  assert.ok(near(k[0], 1.8751 ** 2, 1e-4)); assert.ok(near(k[1], 4.6941 ** 2, 1e-4)); assert.ok(near(k[2], 7.8548 ** 2, 1e-4));
});

test('solver: 方形懸臂板與文獻值（Barton/Leissa 上界）及自身收斂', () => {
  const mat = { E_GPa: 70, nu: 0.3, rho_gcc: 2.7 }, g = { r_mm: 100, c_mm: 100, b_mm: 100, m_mm: 0, t_mm: 2 };
  const lam = (nx, ny) => { const md = S.modal(g, mat, { nx, ny, nModes: 4, nq: 20 }); return md.omegas.map(w => w * 0.01 / Math.sqrt(md.D / md.mu)); };
  const a = lam(6, 7), b = lam(10, 11), ref = [3.4917, 8.5246, 21.440, 27.456];
  for (let i = 0; i < 4; i++) {
    assert.ok(b[i] <= a[i] + 1e-9, '增加項數頻率不應變高（Ritz 單調）');
    assert.ok(Math.abs(a[i] - ref[i]) / ref[i] < 0.02, `模態 ${i + 1}：${a[i]} vs ${ref[i]}`);
  }
  assert.ok(b[0] > 3.46 && b[0] < 3.4917);
});

test('solver: 頻率標度（∝ t，∝ √E）', () => {
  const g = { r_mm: 150, c_mm: 75, b_mm: 100, m_mm: 50, t_mm: 3 }, f = (mat, geom) => S.modal(geom || g, mat, { nModes: 2 }).freqs[0];
  const base = f({ E_GPa: 10, nu: 0.3, rho_gcc: 1.8 });
  assert.ok(near(f({ E_GPa: 40, nu: 0.3, rho_gcc: 1.8 }), base * 2, 1e-9));
  assert.ok(near(f({ E_GPa: 10, nu: 0.3, rho_gcc: 1.8 }, Object.assign({}, g, { t_mm: 6 })), base * 2, 1e-9));
  assert.ok(near(f({ E_GPa: 10, nu: 0.3, rho_gcc: 7.2 }), base / 2, 1e-9));
});

test('solver: 一般矩陣特徵值（已知根）', () => {
  // 多項式 (s-1)(s-2)(s+3)(s^2+2s+5) 的友矩陣，根 = 1, 2, -3, -1±2i
  const c = [1, 2, -3, 0, 0, 0].length; // 佔位，避免誤用
  const poly = [1, 2 + 0, 0, 0, 0]; // 重新展開如下
  // (s-1)(s-2)(s+3) = s^3 + 0 s^2 -7 s + 6；乘 (s^2+2s+5)
  const p3 = [1, 0, -7, 6], q = [1, 2, 5], pr = new Array(6).fill(0);
  p3.forEach((a, i) => q.forEach((b, j) => { pr[i + j] += a * b; }));
  const n = 5, A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 1; i < n; i++) A[i][i - 1] = 1;
  for (let i = 0; i < n; i++) A[i][n - 1] = -pr[n - i];
  const e = S.eigenvalues(A), got = e.re.map((r, i) => [r, e.im[i]]), want = [[1, 0], [2, 0], [-3, 0], [-1, 2], [-1, -2]];
  for (const w of want) assert.ok(got.some(g => Math.hypot(g[0] - w[0], g[1] - w[1]) < 1e-9), `缺少根 ${w}`);
});

test('solver: 顫振掃描的基本性質', () => {
  const geom = { r_mm: 150, c_mm: 75, b_mm: 100, m_mm: 50, t_mm: 3 }, mat = { G_GPa: 4.5, nu: 0.3, rho_gcc: 1.85 };
  const at = h => { const a = P.standardAtmosphere(h); return { rho: a.rho, a: a.a }; };
  const r0 = S.flutterScan(geom, mat, at(0), { Umax: 2500, dU: 10, model: 'subsonic' });
  assert.ok(r0.scan[0].maxRe < 0, '低速應穩定（氣動阻尼為正）');
  assert.strictEqual(r0.kind, 'flutter');
  const r1 = S.flutterScan(geom, mat, at(8000), { Umax: 4000, dU: 10, model: 'subsonic' });
  assert.ok(r1.Vf > r0.Vf, '空氣越稀薄，不穩定速度越高');
  const thick = S.flutterScan(Object.assign({}, geom, { t_mm: 4 }), mat, at(0), { Umax: 4000, dU: 10, model: 'subsonic' });
  assert.ok(thick.Vf > r0.Vf, '越厚越不容易顫振');
  // 密度趨近 0：頻率回到結構頻率，不應不穩定
  const vac = S.flutterScan(geom, mat, { rho: 1e-9, a: 340 }, { Umax: 3000, dU: 100, model: 'subsonic' });
  assert.strictEqual(vac.kind, 'none');
});
