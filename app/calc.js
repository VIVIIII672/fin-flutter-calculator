(function () {
  var $ = function (id) { return document.getElementById(id); };
  var ids = ['cr', 'ct', 'b', 't', 'G', 'vmax', 'sf', 'alt'];
  var customShape = null; // 截圖讀到的鰭片頂點（mm），手動改尺寸後清除

  function shapeEdges(pts) {
    var ys = pts.map(function (q) { return q[1]; });
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), eps = (y1 - y0) * 1e-6 + 1e-9;
    var root = pts.filter(function (q) { return Math.abs(q[1] - y0) <= eps; }).map(function (q) { return q[0]; });
    var tip = pts.filter(function (q) { return Math.abs(q[1] - y1) <= eps; }).map(function (q) { return q[0]; });
    return { y0: y0, y1: y1, rMin: Math.min.apply(null, root), rMax: Math.max.apply(null, root), tMin: Math.min.apply(null, tip), tMax: Math.max.apply(null, tip) };
  }
  var MATS = [
    { name: '玻纖板 G10', G: 4.5 },
    { name: '碳纖維板（準各向同性）', G: 17 },
    { name: '鋁 6061-T6', G: 26 },
    { name: '樺木夾板', G: 0.7 }
  ];

  // 標準大氣：0–11 km 對流層，11–20 km 等溫層
  function isa(h) {
    h = Math.min(Math.max(h, 0), 20000);
    var T, P;
    if (h <= 11000) {
      T = 288.15 - 0.0065 * h;
      P = 101325 * Math.pow(T / 288.15, 5.25588);
    } else {
      T = 216.65;
      P = 22632.06 * Math.exp(-9.80665 * (h - 11000) / (287.05 * T));
    }
    return { T: T, P: P, a: Math.sqrt(1.4 * 287.05 * T) };
  }

  // λ = ct/cr；S = (cr+ct)/2 · b；AR = b²/S；
  // Vf = a·√( 2G(t/cr)³(AR+2) / (1.337·AR³(λ+1)·P) )
  function calc(p) {
    var lam = p.ct / p.cr;
    var S = (p.cr + p.ct) / 2 * p.b;
    var AR = p.b * p.b / S;
    var num = 2 * p.G * Math.pow(p.t / p.cr, 3) * (AR + 2);
    var den = 1.337 * Math.pow(AR, 3) * (lam + 1) * p.P;
    return { lam: lam, S: S, AR: AR, Vf: p.a * Math.sqrt(num / den) };
  }
  window.__calc = calc;
  window.__isa = isa;

  function f(x, d) { return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function ceilTo(x, step) { return Math.ceil(x / step - 1e-9) * step; }
  function floorTo(x, step) { return Math.floor(x / step + 1e-9) * step; }

  function finSVG(cr, ct, b) {
    var W = 260, H = 180, pad = 30;
    if (customShape) {
      var se = shapeEdges(customShape);
      var xs = customShape.map(function (q) { return q[0]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      var sc = Math.min((W - 88) / (x1 - x0), (H - 60) / (se.y1 - se.y0));
      var ox = (W - (x1 - x0) * sc) / 2, hh = (se.y1 - se.y0) * sc, oy = (H + hh) / 2;
      var px = function (x) { return ox + (x - x0) * sc; };
      var py = function (y) { return oy - (y - se.y0) * sc; };
      var pp = customShape.map(function (q) { return px(q[0]).toFixed(1) + ',' + py(q[1]).toFixed(1); }).join(' ');
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="依截圖座標繪製的鰭片外形，等比例">' +
        '<polygon class="fin" points="' + pp + '"/>' +
        '<text class="lbl" x="' + ((px(se.rMin) + px(se.rMax)) / 2).toFixed(1) + '" y="' + (oy + 16).toFixed(1) + '" text-anchor="middle">cr ' + f(cr, 0) + '</text>' +
        '<text class="lbl" x="' + ((px(se.tMin) + px(se.tMax)) / 2).toFixed(1) + '" y="' + (py(se.y1) - 7).toFixed(1) + '" text-anchor="middle">ct ' + f(ct, 0) + '</text>' +
        '<text class="lbl" x="' + (ox - 8).toFixed(1) + '" y="' + (oy - hh / 2 + 4).toFixed(1) + '" text-anchor="end">b ' + f(b, 0) + '</text>' +
        '</svg>';
    }
    var wMax = Math.max(cr, ct);
    var s = Math.min((W - 2 * pad) / wMax, (H - 2 * pad) / b);
    var w = wMax * s, h = b * s;
    var xL = (W - w) / 2, xR = xL + w;
    var yT = (H - h) / 2, yB = yT + h;
    var pts = [(xR - cr * s), yB, xR, yB, xR, yT, (xR - ct * s), yT].map(function (n, i) {
      return n.toFixed(1) + (i % 2 ? ' ' : ',');
    });
    var poly = pts[0] + pts[1] + pts[2] + pts[3] + pts[4] + pts[5] + pts[6] + pts[7];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="鰭片外形示意圖，依輸入尺寸等比例繪製">' +
      '<polygon class="fin" points="' + poly + '"/>' +
      '<text class="lbl" x="' + (xR - cr * s / 2).toFixed(1) + '" y="' + (yB + 16).toFixed(1) + '" text-anchor="middle">cr ' + f(cr, 0) + '</text>' +
      '<text class="lbl" x="' + (xR - ct * s / 2).toFixed(1) + '" y="' + (yT - 7).toFixed(1) + '" text-anchor="middle">ct ' + f(ct, 0) + '</text>' +
      '<text class="lbl" x="' + (xR + 8).toFixed(1) + '" y="' + ((yT + yB) / 2 + 4).toFixed(1) + '">b ' + f(b, 0) + '</text>' +
      '</svg>';
  }

  function render() {
    var v = {};
    ids.forEach(function (k) { v[k] = parseFloat($(k).value); });
    var out = $('out');
    var valid = ['cr', 'ct', 'b', 't', 'G', 'vmax', 'sf'].every(function (k) { return isFinite(v[k]) && v[k] > 0; }) && isFinite(v.alt) && v.alt >= 0;
    if (!valid) {
      out.innerHTML = '<section class="panel"><p class="note">請把所有欄位填入大於 0 的數值（高度可為 0）。</p></section>';
      return;
    }

    var atm = isa(v.alt);
    var base = { cr: v.cr, ct: v.ct, b: v.b, t: v.t, G: v.G * 1e9, a: atm.a, P: atm.P };
    var r = calc(base);
    var req = v.vmax * v.sf;
    var margin = r.Vf / req;
    var state = margin >= 1.1 ? 'ok' : (margin >= 1 ? 'tight' : 'bad');
    var label = { ok: '合格', tight: '勉強合格', bad: '不合格' }[state];
    var pct = Math.abs(margin - 1) * 100;
    var vfOf = function (o) { return calc(Object.assign({}, base, o)).Vf; };

    // 建議值：每一項都假設其他參數不變
    var tReq = ceilTo(v.t * Math.pow(req / r.Vf, 2 / 3), 0.1);
    var gReq = ceilTo(v.G * Math.pow(req / r.Vf, 2), 0.1);
    var lo = v.b * 0.01, hi = v.b * 10, bCap = false, bMax;
    if (vfOf({ b: hi }) >= req) { bCap = true; bMax = hi; }
    else {
      for (var i = 0; i < 70; i++) {
        var mid = (lo + hi) / 2;
        if (vfOf({ b: mid }) >= req) lo = mid; else hi = mid;
      }
      bMax = floorTo(lo, 0.1);
    }

    // 警告
    var warns = [];
    if (v.ct > v.cr) warns.push('尖端弦長大於根部弦長（λ = ' + f(r.lam, 2) + '），請確認是否填反。');
    if (v.t / v.cr > 0.1) warns.push('厚度與根部弦長的比值 t/c_r = ' + f(v.t / v.cr, 3) + '，鰭片相對偏厚，簡化公式的誤差可能變大。');
    if (v.alt > 20000) warns.push('高度超過 20,000 m，已以 20,000 m 計算。');
    if (customShape) {
      var se2 = shapeEdges(customShape), sw = se2.tMin - se2.rMin;
      if (sw > 1) warns.push('截圖的鰭片有後掠，前緣後退 ' + f(sw, 0) + ' mm（約 ' + f(Math.atan2(sw, se2.y1 - se2.y0) * 180 / Math.PI, 1) + '°）。這個公式不計入後掠，請把結果當作參考。');
    }

    // 速度尺
    var max = Math.max(r.Vf, req, v.vmax) * 1.12;
    var p = function (x) { return (x / max * 100).toFixed(2); };

    var html = '';
    if (warns.length) {
      html += '<div class="notes">' + warns.map(function (w) { return '<p class="note">' + w + '</p>'; }).join('') + '</div>';
    }

    html += '<section class="verdict ' + state + '">' +
      '<div class="top"><span class="pill"><span>' + label + '</span></span>' +
      '<div class="big">' + f(r.Vf, 0) + '<small>m/s</small></div></div>' +
      '<p>顫振速度 V<sub>f</sub> ' + (margin >= 1 ? '高於' : '低於') + '要求速度 ' + f(req, 0) + ' m/s（' + f(v.vmax, 0) + ' m/s × 安全係數 ' + f(v.sf, 2) + '），' +
      (margin >= 1 ? '餘量 +' : '不足 ') + f(pct, 1) + '%。</p>' +
      '<div class="sub">' + f(r.Vf * 3.6, 0) + ' km/h · Mach ' + f(r.Vf / atm.a, 2) + ' · 此設計可承受的最大飛行速度 ' + f(r.Vf / v.sf, 0) + ' m/s</div>' +
      '</section>';

    html += '<section class="panel"><h2>速度對照</h2><div class="bar-wrap">' +
      '<div class="track"><div class="fill ' + state + '" style="width:' + p(r.Vf) + '%"></div>' +
      '<div class="mk vmax" style="left:' + p(v.vmax) + '%"></div>' +
      '<div class="mk req" style="left:' + p(req) + '%"></div></div>' +
      '<div class="axis"><span>0</span><span>' + f(max, 0) + ' m/s</span></div>' +
      '<div class="legend">' +
      '<span><i class="l-fill ' + state + '"></i>顫振速度 <b>' + f(r.Vf, 0) + '</b></span>' +
      '<span><i class="l-req"></i>要求 <b>' + f(req, 0) + '</b></span>' +
      '<span><i class="l-vmax"></i>最大速度 <b>' + f(v.vmax, 0) + '</b></span>' +
      '</div></div></section>';

    var failing = margin < 1;
    html += '<section class="panel"><h2>' + (failing ? '建議調整（任選一項即可達標）' : '設計餘裕（單項調整的極限）') + '</h2><div class="sugg">' +
      '<div class="row"><div><div class="name">' + (failing ? '加厚鰭片，厚度至少' : '厚度最薄可到') + '</div>' +
      '<div class="val">' + f(tReq, 1) + ' mm <em>目前 ' + f(v.t, 1) + ' mm（' + (tReq >= v.t ? '+' : '−') + f(Math.abs(tReq / v.t - 1) * 100, 0) + '%）</em></div></div>' +
      (failing ? '<button class="btn" data-apply="t" data-val="' + tReq.toFixed(1) + '">套用</button>' : '') + '</div>' +
      '<div class="row"><div><div class="name">' + (failing ? '縮短翼展，單片翼展不超過' : '翼展最長可到') + '</div>' +
      '<div class="val">' + (bCap ? '> ' + f(hi, 0) : f(bMax, 1)) + ' mm <em>目前 ' + f(v.b, 1) + ' mm</em></div></div>' +
      (failing && !bCap ? '<button class="btn" data-apply="b" data-val="' + bMax.toFixed(1) + '">套用</button>' : '') + '</div>' +
      '<div class="row"><div><div class="name">' + (failing ? '換成更硬的材料，剪切模量至少' : '材料剪切模量最低可到') + '</div>' +
      '<div class="val">' + f(gReq, 1) + ' GPa <em>目前 ' + f(v.G, 1) + ' GPa</em></div></div>' +
      (failing ? '<button class="btn" data-apply="G" data-val="' + gReq.toFixed(1) + '">套用</button>' : '') + '</div>' +
      '</div>' +
      '<p class="hint">三項都是各自獨立計算，其餘參數保持目前的輸入。數值已朝合格方向進位。</p></section>';

    var rows = MATS.map(function (m) {
      var vf = vfOf({ G: m.G * 1e9 });
      var ok = vf >= req;
      var tm = ceilTo(v.t * Math.pow(req / vf, 2 / 3), 0.1);
      return '<tr><td>' + m.name + '</td><td class="n">' + f(m.G, 1) + '</td><td class="n">' + f(vf, 0) + '</td>' +
        '<td><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '達標' : '不足') + '</span></td>' +
        '<td class="n">' + f(tm, 1) + '</td></tr>';
    }).join('');
    html += '<section class="panel"><h2>換材料會怎樣（尺寸不變）</h2><div class="tablewrap"><table>' +
      '<thead><tr><th>材料</th><th class="n">G（GPa）</th><th class="n">V<sub>f</sub>（m/s）</th><th>判定</th><th class="n">達標最小厚度（mm）</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></section>';

    html += '<section class="panel"><h2>計算過程</h2>' +
      '<div class="formula">V<sub>f</sub> = a · √( 2G(t/c<sub>r</sub>)³(AR+2) / (1.337 · AR³ (λ+1) · P) )</div>' +
      '<div class="detail"><div>' + finSVG(v.cr, v.ct, v.b) + '</div><dl>' +
      '<dt>錐度比 λ = c<sub>t</sub>/c<sub>r</sub></dt><dd>' + f(r.lam, 3) + '</dd>' +
      '<dt>面積 S</dt><dd>' + f(r.S, 0) + ' mm²</dd>' +
      '<dt>展弦比 AR = b²/S</dt><dd>' + f(r.AR, 3) + '</dd>' +
      '<dt>厚度比 t/c<sub>r</sub></dt><dd>' + f(v.t / v.cr, 4) + '</dd>' +
      '<dt>音速 a</dt><dd>' + f(atm.a, 1) + ' m/s</dd>' +
      '<dt>氣壓 P</dt><dd>' + f(atm.P / 1000, 2) + ' kPa</dd>' +
      '<dt>顫振速度 V<sub>f</sub></dt><dd>' + f(r.Vf, 1) + ' m/s</dd>' +
      '</dl></div></section>';

    out.innerHTML = html;
  }

  // 材料選單與 G 欄位連動
  $('mat').addEventListener('change', function () {
    if (this.value !== 'custom') $('G').value = this.value;
    render();
  });
  $('G').addEventListener('input', function () {
    var val = parseFloat(this.value), hit = 'custom';
    MATS.forEach(function (m) { if (m.G === val) hit = String(m.G); });
    $('mat').value = hit;
  });
  ids.forEach(function (k) {
    $(k).addEventListener('input', function () {
      if (k === 'cr' || k === 'ct' || k === 'b') customShape = null;
      render();
    });
  });

  // 套用建議值
  $('out').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-apply]') : null;
    if (!btn) return;
    var k = btn.getAttribute('data-apply');
    if (k === 'b') customShape = null;
    $(k).value = btn.getAttribute('data-val');
    if (k === 'G') $('G').dispatchEvent(new Event('input'));
    else render();
  });

  // 提供給截圖讀取程式（scan.js）使用
  function r1(x) { return Math.round(x * 10) / 10; }
  window.FinCalc = {
    get: function (id) { return $(id).value; },
    apply: function (g) {
      if (g.cr > 0) $('cr').value = r1(g.cr);
      if (g.ct >= 0 && g.ct !== undefined && g.ct !== null) $('ct').value = r1(g.ct);
      if (g.b > 0) $('b').value = r1(g.b);
      if (g.t > 0) $('t').value = r1(g.t);
      customShape = g.pointsMm || null;
      render();
    }
  };

  render();
})();
