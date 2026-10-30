/* 圖表：折線圖（含水平頻帶與標記點）與鰭片外形圖。全部以 SVG 字串產生，顏色由 CSS 變數決定。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinCharts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function niceStep(span, count) {
    var raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return s * mag;
  }
  function ticks(min, max, count) {
    if (!(max > min)) max = min + 1;
    var step = niceStep(max - min, count), t = [], v = Math.ceil(min / step - 1e-9) * step;
    for (; v <= max + step * 1e-9; v += step) t.push(Math.round(v / step) * step);
    return t;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fnum(v) { return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(parseFloat(v.toPrecision(4))); }

  /*
   * opts: { title, xLabel, yLabel, series: [{ name, cls, pts: [[x,y],...] }],
   *         bands: [{ y0, y1, cls }], marks: [{ x, y, cls, label }], xMax, yMax }
   * 所有座標已是顯示單位。
   */
  function lineChart(opts) {
    var W = 640, H = 300, ml = 56, mr = 18, mt = 14, mb = 44;
    var xs = [], ys = [];
    opts.series.forEach(function (s) { s.pts.forEach(function (p) { if (isFinite(p[0]) && isFinite(p[1])) { xs.push(p[0]); ys.push(p[1]); } }); });
    if (!xs.length) return '';
    var x0 = 0, x1 = opts.xMax !== undefined ? opts.xMax : Math.max.apply(null, xs);
    var y0 = 0, y1 = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, ys) * 1.05;
    if (!(x1 > x0)) x1 = x0 + 1;
    if (!(y1 > y0)) y1 = y0 + 1;
    var xt = ticks(x0, x1, 6), yt = ticks(y0, y1, 5);
    x1 = Math.max(x1, xt[xt.length - 1]); y1 = Math.max(y1, yt[yt.length - 1]);
    var X = function (v) { return ml + (v - x0) / (x1 - x0) * (W - ml - mr); };
    var Y = function (v) { return H - mb - (v - y0) / (y1 - y0) * (H - mt - mb); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.title || '') + '">';
    yt.forEach(function (v) {
      g += '<line class="ch-grid" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>' +
        '<text class="ch-tick" x="' + (ml - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + fnum(v) + '</text>';
    });
    xt.forEach(function (v) {
      g += '<text class="ch-tick" x="' + X(v).toFixed(1) + '" y="' + (H - mb + 16) + '" text-anchor="middle">' + fnum(v) + '</text>';
    });
    g += '<line class="ch-axis" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (H - mb) + '" y2="' + (H - mb) + '"/>' +
      '<line class="ch-axis" x1="' + ml + '" x2="' + ml + '" y1="' + mt + '" y2="' + (H - mb) + '"/>';
    (opts.bands || []).forEach(function (b) {
      var ya = Math.min(Y(Math.max(b.y0, y0)), Y(Math.min(b.y1, y1))), yb = Math.max(Y(Math.max(b.y0, y0)), Y(Math.min(b.y1, y1)));
      g += '<rect class="ch-band ' + (b.cls || '') + '" x="' + ml + '" y="' + ya.toFixed(1) + '" width="' + (W - ml - mr) + '" height="' + Math.max(1, yb - ya).toFixed(1) + '"/>';
    });
    opts.series.forEach(function (s) {
      var d = '', pen = false;
      s.pts.forEach(function (p) {
        if (!isFinite(p[0]) || !isFinite(p[1])) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(Math.min(p[0], x1)).toFixed(1) + ' ' + Y(Math.min(p[1], y1)).toFixed(1) + ' ';
        pen = true;
      });
      g += '<path class="ch-line ' + s.cls + '" d="' + d + '"/>';
    });
    (opts.marks || []).forEach(function (m) {
      g += '<circle class="ch-mark ' + (m.cls || '') + '" cx="' + X(m.x).toFixed(1) + '" cy="' + Y(m.y).toFixed(1) + '" r="5"><title>' + esc(m.label || '') + '</title></circle>';
    });
    g += '<text class="ch-label" x="' + ((ml + W - mr) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(opts.xLabel || '') + '</text>';
    g += '<text class="ch-label" transform="translate(13 ' + ((mt + H - mb) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(opts.yLabel || '') + '</text>';
    return g + '</svg>';
  }

  function legend(items) {
    return '<div class="legend">' + items.map(function (i) {
      return '<span><i class="' + i.cls + '"></i>' + esc(i.name) + '</span>';
    }).join('') + '</div>';
  }

  // 鰭片外形：pts 為 [[x,y],...]（任意單位，x 向後、y 向外）。labels: { cr, ct, b } 為已格式化文字
  function finShape(pts, labels) {
    var W = 260, H = 180;
    var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (!(x1 > x0) || !(y1 > y0)) return '';
    var sc = Math.min((W - 88) / (x1 - x0), (H - 60) / (y1 - y0));
    var ox = (W - (x1 - x0) * sc) / 2, hh = (y1 - y0) * sc, oy = (H + hh) / 2;
    var X = function (v) { return ox + (v - x0) * sc; }, Y = function (v) { return oy - (v - y0) * sc; };
    var poly = pts.map(function (q) { return X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1); }).join(' ');
    var eps = (y1 - y0) * 1e-6 + 1e-9;
    var root = pts.filter(function (q) { return Math.abs(q[1] - y0) <= eps; }).map(function (q) { return q[0]; });
    var tip = pts.filter(function (q) { return Math.abs(q[1] - y1) <= eps; }).map(function (q) { return q[0]; });
    var cxR = (X(Math.min.apply(null, root)) + X(Math.max.apply(null, root))) / 2;
    var cxT = (X(Math.min.apply(null, tip)) + X(Math.max.apply(null, tip))) / 2;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="鰭片外形示意圖，等比例繪製">' +
      '<polygon class="fin" points="' + poly + '"/>' +
      '<text class="lbl" x="' + cxR.toFixed(1) + '" y="' + (oy + 16).toFixed(1) + '" text-anchor="middle">' + esc(labels.cr) + '</text>' +
      '<text class="lbl" x="' + cxT.toFixed(1) + '" y="' + (Y(y1) - 7).toFixed(1) + '" text-anchor="middle">' + esc(labels.ct) + '</text>' +
      '<text class="lbl" x="' + (ox - 8).toFixed(1) + '" y="' + (oy - hh / 2 + 4).toFixed(1) + '" text-anchor="end">' + esc(labels.b) + '</text>' +
      '</svg>';
  }

  return { lineChart: lineChart, legend: legend, finShape: finShape, ticks: ticks };
});
