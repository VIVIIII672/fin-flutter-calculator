/*
 * 進階模式：梯形薄板懸臂鰭片的 Rayleigh-Ritz 模態分析，加上簡化氣動力的顫振掃描。
 * 結構：Kirchhoff 薄板（等向、均勻厚度），根部固定，基底函數 ŷ²·P̃_i(ŷ)·P_j(x̂)（滿足根部固定）。
 * 氣動力：壓力正比於局部下洗 Δp = −½ρU·CLα(M)·f(ξ)·(w_t + U·w_x)。
 *         Mach 低時 CLα 取 Helmbold 三維升力斜率、載荷沿弦向偏前緣 f = 3(1−ξ)²（壓力中心在 1/4 弦長）；
 *         Mach ≥ 1.5 時 CLα = 4/M、f = 1，等同一階活塞理論；0.9 到 1.5 之間線性混合（不可靠區間）。
 * 這是實驗性模型，沒有用實驗驗證過顫振速度；模態頻率部分有用解析解驗證。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 數值工具 ----------
  function gaussLegendre(n) {      // [0,1] 上的節點與權重
    var x = [], w = [], i, k;
    for (i = 0; i < n; i++) {
      var z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 1;
      for (var it = 0; it < 100; it++) {
        var p1 = 1, p2 = 0;
        for (k = 0; k < n; k++) { var p3 = p2; p2 = p1; p1 = ((2 * k + 1) * z * p2 - k * p3) / (k + 1); }
        pp = n * (z * p1 - p2) / (z * z - 1);
        var dz = p1 / pp; z -= dz;
        if (Math.abs(dz) < 1e-15) break;
      }
      x.push((1 - z) / 2); w.push(1 / ((1 - z * z) * pp * pp));
    }
    return { x: x, w: w };
  }

  // Legendre 多項式 P_0..P_n 及一、二階導數（在 [-1,1]）
  function legendre(n, x) {
    var P = [1, x], D = [0, 1], D2 = [0, 0], k;
    for (k = 1; k < n; k++) {
      P[k + 1] = ((2 * k + 1) * x * P[k] - k * P[k - 1]) / (k + 1);
      D[k + 1] = D[k - 1] + (2 * k + 1) * P[k];
      D2[k + 1] = D2[k - 1] + (2 * k + 1) * D[k];
    }
    return { P: P.slice(0, n + 1), D: D.slice(0, n + 1), D2: D2.slice(0, n + 1) };
  }

  function zeros(n, m) { var a = []; for (var i = 0; i < n; i++) a.push(new Float64Array(m)); return a; }

  function cholesky(A, n) {
    var L = zeros(n, n);
    for (var i = 0; i < n; i++) for (var j = 0; j <= i; j++) {
      var s = A[i][j];
      for (var k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) throw new Error('質量矩陣不是正定，請檢查尺寸。'); L[i][i] = Math.sqrt(s); }
      else L[i][j] = s / L[j][j];
    }
    return L;
  }

  // 對稱矩陣的 Jacobi 特徵分解。回傳 { values, vectors（欄為特徵向量）}，由小到大排序。
  function jacobiEigen(A0, n) {
    var A = A0.map(function (r) { return Float64Array.from(r); }), V = zeros(n, n), i, j, k;
    for (i = 0; i < n; i++) V[i][i] = 1;
    for (var sweep = 0; sweep < 100; sweep++) {
      var off = 0;
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-26) break;
      for (var p = 0; p < n - 1; p++) for (var q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        var th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        var t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (k = 0; k < n; k++) { var akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
        for (k = 0; k < n; k++) { var apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
        for (k = 0; k < n; k++) { var vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    var idx = []; for (i = 0; i < n; i++) idx.push(i);
    idx.sort(function (a, b) { return A[a][a] - A[b][b]; });
    return { values: idx.map(function (i) { return A[i][i]; }), vectors: idx.map(function (c) { var v = new Float64Array(n); for (var r = 0; r < n; r++) v[r] = V[r][c]; return v; }) };
  }

  // 一般實矩陣的特徵值（平衡 → Hessenberg → QR），回傳 { re, im }
  function eigenvalues(M0) {
    var n = M0.length, a = M0.map(function (r) { return Array.prototype.slice.call(r); }), i, j, k, m;
    // 平衡
    var last = false;
    while (!last) {
      last = true;
      for (i = 0; i < n; i++) {
        var r = 0, c = 0;
        for (j = 0; j < n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
        if (c && r) {
          var g = r / 2, f = 1, s = c + r;
          while (c < g) { f *= 2; c *= 4; }
          g = r * 2;
          while (c > g) { f /= 2; c /= 4; }
          if ((c + r) / f < 0.95 * s) { last = false; g = 1 / f; for (j = 0; j < n; j++) a[i][j] *= g; for (j = 0; j < n; j++) a[j][i] *= f; }
        }
      }
    }
    // Hessenberg（高斯消去，含選主元）
    for (m = 1; m < n - 1; m++) {
      var x = 0; i = m;
      for (j = m; j < n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
      if (i !== m) {
        for (j = m - 1; j < n; j++) { var tmp = a[i][j]; a[i][j] = a[m][j]; a[m][j] = tmp; }
        for (j = 0; j < n; j++) { var tmp2 = a[j][i]; a[j][i] = a[j][m]; a[j][m] = tmp2; }
      }
      if (x !== 0) for (i = m + 1; i < n; i++) {
        var y = a[i][m - 1];
        if (y !== 0) {
          y /= x; a[i][m - 1] = y;
          for (j = m; j < n; j++) a[i][j] -= y * a[m][j];
          for (j = 0; j < n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
    for (i = 2; i < n; i++) for (j = 0; j < i - 1; j++) a[i][j] = 0;
    // QR（Francis 雙重位移）
    var wr = new Array(n).fill(0), wi = new Array(n).fill(0), anorm = 0;
    for (i = 0; i < n; i++) for (j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
    var nn = n - 1, t = 0, l, its, p, q, z, w, u, v, ss;
    var sign = function (aa, bb) { return bb >= 0 ? Math.abs(aa) : -Math.abs(aa); };
    while (nn >= 0) {
      its = 0;
      do {
        for (l = nn; l >= 1; l--) {
          ss = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
          if (ss === 0) ss = anorm;
          if (Math.abs(a[l][l - 1]) + ss === ss) { a[l][l - 1] = 0; break; }
        }
        x = a[nn][nn];
        if (l === nn) { wr[nn] = x + t; wi[nn] = 0; nn--; }
        else {
          y = a[nn - 1][nn - 1]; w = a[nn][nn - 1] * a[nn - 1][nn];
          if (l === nn - 1) {
            p = 0.5 * (y - x); q = p * p + w; z = Math.sqrt(Math.abs(q)); x += t;
            if (q >= 0) { z = p + sign(z, p); wr[nn - 1] = wr[nn] = x + z; if (z) wr[nn] = x - w / z; wi[nn - 1] = wi[nn] = 0; }
            else { wr[nn - 1] = wr[nn] = x + p; wi[nn - 1] = -(wi[nn] = z); }
            nn -= 2;
          } else {
            if (its === 60) throw new Error('特徵值計算未收斂。');
            if (its === 10 || its === 20) {
              t += x; for (i = 0; i <= nn; i++) a[i][i] -= x;
              ss = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]); y = x = 0.75 * ss; w = -0.4375 * ss * ss;
            }
            ++its;
            var rr;
            for (m = nn - 2; m >= l; m--) {
              z = a[m][m]; rr = x - z; ss = y - z;
              p = (rr * ss - w) / a[m + 1][m] + a[m][m + 1]; q = a[m + 1][m + 1] - z - rr - ss; rr = a[m + 2][m + 1];
              ss = Math.abs(p) + Math.abs(q) + Math.abs(rr); p /= ss; q /= ss; rr /= ss;
              if (m === l) break;
              u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(rr));
              v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
              if (u + v === v) break;
            }
            for (i = m + 2; i <= nn; i++) { a[i][i - 2] = 0; if (i !== m + 2) a[i][i - 3] = 0; }
            for (k = m; k <= nn - 1; k++) {
              if (k !== m) {
                p = a[k][k - 1]; q = a[k + 1][k - 1]; rr = 0;
                if (k !== nn - 1) rr = a[k + 2][k - 1];
                if ((x = Math.abs(p) + Math.abs(q) + Math.abs(rr)) !== 0) { p /= x; q /= x; rr /= x; }
              }
              if ((ss = sign(Math.sqrt(p * p + q * q + rr * rr), p)) !== 0) {
                if (k === m) { if (l !== m) a[k][k - 1] = -a[k][k - 1]; } else a[k][k - 1] = -ss * x;
                p += ss; x = p / ss; y = q / ss; z = rr / ss; q /= p; rr /= p;
                for (j = k; j <= nn; j++) {
                  p = a[k][j] + q * a[k + 1][j];
                  if (k !== nn - 1) { p += rr * a[k + 2][j]; a[k + 2][j] -= p * z; }
                  a[k + 1][j] -= p * y; a[k][j] -= p * x;
                }
                var mmin = nn < k + 3 ? nn : k + 3;
                for (i = l; i <= mmin; i++) {
                  p = x * a[i][k] + y * a[i][k + 1];
                  if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * rr; }
                  a[i][k + 1] -= p * q; a[i][k] -= p;
                }
              }
            }
          }
        }
      } while (l < nn - 1);
    }
    return { re: wr, im: wi };
  }
  var x, y;   // eigenvalues() 內使用的工作變數（避免嚴格模式下的隱含全域）

  // ---------- 模態分析 ----------
  /*
   * geom: { r_mm, c_mm, b_mm, m_mm, t_mm }；mat: { E_GPa 或 G_GPa, nu, rho_gcc }
   * opts: { nx, ny, nModes }
   */
  function modal(geom, mat, opts) {
    opts = opts || {};
    var nx = opts.nx || 6, ny = opts.ny || 7, nModes = Math.min(opts.nModes || 6, nx * ny);
    var cr = geom.r_mm / 1000, ct = geom.c_mm / 1000, b = geom.b_mm / 1000, m = (geom.m_mm || 0) / 1000, t = geom.t_mm / 1000;
    if (!(cr > 0 && ct >= 0 && b > 0 && t > 0)) throw new Error('尺寸必須是正數。');
    var nu = mat.nu === undefined ? 0.3 : mat.nu;
    if (!(nu > -1 && nu < 0.5)) throw new Error('蒲松比必須在 -1 到 0.5 之間。');
    var E = (mat.E_GPa !== undefined ? mat.E_GPa : 2 * mat.G_GPa * (1 + nu)) * 1e9, rho = mat.rho_gcc * 1000;
    if (!(E > 0 && rho > 0)) throw new Error('彈性模量與密度必須大於 0。');
    var D = E * t * t * t / (12 * (1 - nu * nu)), mu = rho * t;
    var xmin = Math.min(0, m), xmax = Math.max(cr, m + ct), Lx = xmax - xmin, N = nx * ny;
    var gq = gaussLegendre(opts.nq || 14), nq = gq.x.length;
    var K = zeros(N, N), M = zeros(N, N), Gx = zeros(N, N), Mf = zeros(N, N), Gf = zeros(N, N);

    function basis(x, y) {           // 回傳各基底的 w, w_x, w_xx, w_yy, w_xy
      var xh = 2 * (x - xmin) / Lx - 1, yh = y / b, s = 2 * yh - 1;
      var Lj = legendre(nx - 1, xh), Li = legendre(ny - 1, s);
      var out = { w: new Float64Array(N), wx: new Float64Array(N), wxx: new Float64Array(N), wyy: new Float64Array(N), wxy: new Float64Array(N) };
      var kx = 2 / Lx, ky = 1 / b, idx = 0;
      for (var i = 0; i < ny; i++) {
        var A = Li.P[i], A1 = 2 * Li.D[i], A2 = 4 * Li.D2[i];
        var g = yh * yh * A, g1 = 2 * yh * A + yh * yh * A1, g2 = 2 * A + 4 * yh * A1 + yh * yh * A2;
        for (var j = 0; j < nx; j++, idx++) {
          out.w[idx] = g * Lj.P[j];
          out.wx[idx] = g * Lj.D[j] * kx;
          out.wxx[idx] = g * Lj.D2[j] * kx * kx;
          out.wyy[idx] = g2 * Lj.P[j] * ky * ky;
          out.wxy[idx] = g1 * Lj.D[j] * kx * ky;
        }
      }
      return out;
    }

    var a, c, ia, ib;
    for (a = 0; a < nq; a++) for (c = 0; c < nq; c++) {
      var eta = gq.x[a], xi = gq.x[c], chord = cr + (ct - cr) * eta;
      var X = m * eta + xi * chord, Y = b * eta, W = gq.w[a] * gq.w[c] * chord * b;
      var B = basis(X, Y);
      for (ia = 0; ia < N; ia++) for (ib = 0; ib <= ia; ib++) {
        K[ia][ib] += W * D * (B.wxx[ia] * B.wxx[ib] + B.wyy[ia] * B.wyy[ib] + nu * (B.wxx[ia] * B.wyy[ib] + B.wyy[ia] * B.wxx[ib]) + 2 * (1 - nu) * B.wxy[ia] * B.wxy[ib]);
        M[ia][ib] += W * mu * B.w[ia] * B.w[ib];
      }
      var fsub = 3 * (1 - xi) * (1 - xi);
      for (ia = 0; ia < N; ia++) for (ib = 0; ib < N; ib++) {
        Gx[ia][ib] += W * B.w[ia] * B.wx[ib];
        Mf[ia][ib] += W * fsub * B.w[ia] * B.w[ib];
        Gf[ia][ib] += W * fsub * B.w[ia] * B.wx[ib];
      }
    }
    for (ia = 0; ia < N; ia++) for (ib = ia + 1; ib < N; ib++) { K[ia][ib] = K[ib][ia]; M[ia][ib] = M[ib][ia]; }

    // 廣義特徵問題 K q = ω² M q
    var L = cholesky(M, N), i, j, k;
    var Linv = zeros(N, N);   // L⁻¹
    for (i = 0; i < N; i++) {
      Linv[i][i] = 1 / L[i][i];
      for (j = 0; j < i; j++) { var s = 0; for (k = j; k < i; k++) s -= L[i][k] * Linv[k][j]; Linv[i][j] = s / L[i][i]; }
    }
    var T = zeros(N, N), A2 = zeros(N, N);
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) { var s2 = 0; for (k = 0; k < N; k++) s2 += Linv[i][k] * K[k][j]; T[i][j] = s2; }
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) { var s3 = 0; for (k = 0; k < N; k++) s3 += T[i][k] * Linv[j][k]; A2[i][j] = s3; }
    for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) { var av = 0.5 * (A2[i][j] + A2[j][i]); A2[i][j] = A2[j][i] = av; }
    var eig = jacobiEigen(A2, N), modes = [];
    for (k = 0; k < nModes; k++) {
      var v = eig.vectors[k], q = new Float64Array(N);          // q = L⁻ᵀ v
      for (i = 0; i < N; i++) { var s4 = 0; for (j = i; j < N; j++) s4 += Linv[j][i] * v[j]; q[i] = s4; }
      modes.push({ omega: Math.sqrt(Math.max(0, eig.values[k])), q: q });
    }
    return {
      N: N, nModes: nModes, D: D, mu: mu, E: E, nu: nu, rho: rho, geom: { cr: cr, ct: ct, b: b, m: m, t: t, xmin: xmin, xmax: xmax, Lx: Lx },
      freqs: modes.map(function (md) { return md.omega / (2 * Math.PI); }), omegas: modes.map(function (md) { return md.omega; }),
      modes: modes, M: M, Gx: Gx, Mf: Mf, Gf: Gf, basis: basis
    };
  }

  // ---------- 氣動力 ----------
  function liftSlopeSub(AR, mach) {   // 3D 升力斜率（每 rad），Helmbold/DATCOM 形式，無後掠修正
    var M = Math.min(mach, 0.95), beta = Math.sqrt(1 - M * M);
    return 2 * Math.PI * AR / (2 + Math.sqrt(4 + Math.pow(beta * AR, 2)));
  }
  function liftSlope(AR, mach) {
    var wP = Math.min(1, Math.max(0, (mach - 0.9) / 0.6));
    return (1 - wP) * liftSlopeSub(AR, mach) + wP * 4 / Math.max(mach, 1.5);
  }

  function toModal(md, A) {            // Φᵀ A Φ，只取前 nModes 個模態
    var n = md.nModes, N = md.N, out = zeros(n, n), tmp = [];
    for (var i = 0; i < n; i++) {
      var qi = md.modes[i].q; tmp[i] = new Float64Array(N);
      for (var r = 0; r < N; r++) { var s = 0; for (var c = 0; c < N; c++) s += qi[c] * A[c][r]; tmp[i][r] = s; }
    }
    for (var ii = 0; ii < n; ii++) for (var jj = 0; jj < n; jj++) { var qj = md.modes[jj].q, s2 = 0; for (var r2 = 0; r2 < N; r2++) s2 += tmp[ii][r2] * qj[r2]; out[ii][jj] = s2; }
    return out;
  }

  /*
   * atm: { rho, a }（空氣密度、音速）。opts.model: 'auto'（依 Mach 混合）、'subsonic'（強制低速）、'piston'（強制活塞）
   * 回傳 sys(U) → { C, Ka }（模態座標，n×n）
   */
  function aeroModel(md, atm, opts) {
    opts = opts || {};
    var n = md.nModes, g = md.geom, S = (g.cr + g.ct) * g.b / 2, AR = g.b * g.b / S, model = opts.model || 'auto';
    var C0 = toModal(md, md.M), C1 = toModal(md, md.Mf), G0 = toModal(md, md.Gx), G1 = toModal(md, md.Gf);
    var rho = atm.rho, a = atm.a, mu = md.mu;
    function sys(U) {
      var mach = U / a, wP = model === 'piston' ? 1 : model === 'subsonic' ? 0 : Math.min(1, Math.max(0, (mach - 0.9) / 0.6));
      var cla = model === 'piston' ? 4 / Math.max(mach, 1.5) : model === 'subsonic' ? liftSlopeSub(AR, mach) : liftSlope(AR, mach);
      var C = zeros(n, n), Ka = zeros(n, n), kc = 0.5 * rho * U * cla, kk = 0.5 * rho * U * U * cla;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        C[i][j] = kc * ((1 - wP) * C1[i][j] + wP * C0[i][j]) / mu;
        Ka[i][j] = kk * ((1 - wP) * G1[i][j] + wP * G0[i][j]);
      }
      return { C: C, Ka: Ka, mach: mach, wPiston: wP, cla: cla };
    }
    return { sys: sys, AR: AR, S: S };
  }

  // 對某速度算 M p² + C p + (K+Ka) = 0 的特徵值（模態質量為單位）
  function rootsAt(md, am, U) {
    var n = md.nModes, s = am.sys(U), A = zeros(2 * n, 2 * n), i, j;
    for (i = 0; i < n; i++) {
      A[i][n + i] = 1;
      for (j = 0; j < n; j++) {
        A[n + i][j] = -((i === j ? md.omegas[i] * md.omegas[i] : 0) + s.Ka[i][j]);
        A[n + i][n + j] = -s.C[i][j];
      }
    }
    var e = eigenvalues(A), out = [];
    for (i = 0; i < 2 * n; i++) out.push({ re: e.re[i], im: e.im[i] });
    return { roots: out, mach: s.mach, wPiston: s.wPiston };
  }

  function worstRoot(r) {
    var best = r[0];
    r.forEach(function (z) { if (z.re > best.re) best = z; });
    return best;
  }

  /*
   * 顫振掃描。回傳 { kind: 'flutter'|'divergence'|'none', Vf, freq, mach, scan:[{U, maxRe, f}], freqs }
   */
  function flutterScan(geom, mat, atm, opts) {
    opts = opts || {};
    var md = modal(geom, mat, { nx: opts.nx, ny: opts.ny, nModes: opts.nModes || 6 });
    var am = aeroModel(md, atm, { model: opts.model });
    var Umax = opts.Umax || 1500, dU = opts.dU || 5, scan = [], prev = null, hit = null, U, res;
    var tol = 1e-6 * md.omegas[0];
    for (U = dU; U <= Umax; U += dU) {
      res = rootsAt(md, am, U);
      var w = worstRoot(res.roots);
      scan.push({ U: U, maxRe: w.re, f: Math.abs(w.im) / (2 * Math.PI), mach: res.mach });
      if (w.re > tol) { hit = { lo: prev === null ? U - dU : prev, hi: U, w: w }; break; }
      prev = U;
    }
    var out = { kind: 'none', Vf: NaN, freq: NaN, mach: NaN, scan: scan, freqs: md.freqs.slice(), md: md };
    if (!hit) return out;
    var lo = hit.lo, hi = hit.hi, wHi = hit.w;
    for (var it = 0; it < 40; it++) {
      var mid = (lo + hi) / 2, wm = worstRoot(rootsAt(md, am, mid).roots);
      if (wm.re > tol) { hi = mid; wHi = wm; } else lo = mid;
    }
    out.Vf = hi; out.mach = hi / atm.a; out.freq = Math.abs(wHi.im) / (2 * Math.PI);
    out.kind = Math.abs(wHi.im) < 1e-3 * Math.hypot(wHi.re, wHi.im) + 1e-9 ? 'divergence' : 'flutter';
    out.blended = out.mach > 0.9 && out.mach < 1.5;
    return out;
  }

  return { modal: modal, flutterScan: flutterScan, rootsAt: rootsAt, aeroModel: aeroModel, eigenvalues: eigenvalues, jacobiEigen: jacobiEigen, gaussLegendre: gaussLegendre, liftSlope: liftSlope };
});
