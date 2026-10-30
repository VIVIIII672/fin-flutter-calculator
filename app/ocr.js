/*
 * OpenRocket 鰭片設定視窗截圖讀取（離線文字辨識，不使用 AI）
 *
 * 做法：
 *  1. 整張圖先辨識一次，找出「Root chord」「Tip chord」「Height」「Thickness」
 *     「Sweep length」等標籤，或 Freeform 的座標表。
 *  2. 數字欄位在輸入框裡，整張圖辨識常把小數點或第一碼吃掉。
 *     所以改成：找出輸入框的左右邊框，只裁出框內的數字，放大後用「只認數字」模式再辨識。
 *  3. Freeform 座標表的每個數字也各自裁出重新辨識。
 *
 * 對外：FinOCR.read(blob, { unit: 'cm' | 'mm' | 'in' }) -> 結果物件
 */
(function () {
  var worker = null;
  var digitWorker = null;

  var UNIT_MM = { cm: 10, mm: 1, 'in': 25.4 };

  function loadWorker(whitelist) {
    // 一律用絕對網址，避免 Worker 內把相對路徑解析到錯誤的資料夾
    var base = new URL('vendor/', document.baseURI).href;
    var opts = {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core',
      langPath: base + 'lang',
      gzip: true,
      workerBlobURL: false
    };
    return Tesseract.createWorker('eng', 1, opts).then(function (w) {
      var params = { tessedit_pageseg_mode: whitelist ? '7' : '3' };
      if (whitelist) params.tessedit_char_whitelist = '0123456789.-';
      return w.setParameters(params).then(function () { return w; });
    });
  }

  function getWorkers() {
    if (!worker) worker = loadWorker(false);
    if (!digitWorker) digitWorker = loadWorker(true);
    return Promise.all([worker, digitWorker]);
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // 載入圖片，必要時放大，深色主題轉成淺底深字
  function prepare(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var scale = bmp.width < 1800 ? Math.min(3, 1800 / bmp.width) : 1;
      var c = makeCanvas(bmp.width * scale, bmp.height * scale);
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      var d = ctx.getImageData(0, 0, c.width, c.height);
      var px = d.data, sum = 0, n = 0;
      for (var i = 0; i < px.length; i += 4 * 97) { sum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; n++; }
      if (sum / n < 110) {
        for (var j = 0; j < px.length; j += 4) { px[j] = 255 - px[j]; px[j + 1] = 255 - px[j + 1]; px[j + 2] = 255 - px[j + 2]; }
        ctx.putImageData(d, 0, 0);
      }
      return { canvas: c, ctx: ctx, scale: scale, width: c.width, height: c.height };
    });
  }

  function lum(px, i) { return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; }

  // 在 [yTop, yBot] 這個高度帶內，找出像「輸入框邊框」的垂直線欄位
  function findBorders(ctx, imgW, x0, x1, yTop, yBot) {
    x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(imgW - 1, Math.floor(x1));
    var w = x1 - x0 + 1, h = Math.max(1, Math.floor(yBot - yTop));
    var d = ctx.getImageData(x0, Math.floor(yTop), w, h).data;
    var cols = [];
    for (var x = 0; x < w; x++) {
      var hit = 0;
      for (var y = 0; y < h; y++) {
        var L = lum(d, (y * w + x) * 4);
        if (L > 120 && L < 232) hit++;
      }
      cols.push(hit / h >= 0.88);
    }
    var groups = [], start = -1;
    for (var k = 0; k <= cols.length; k++) {
      if (cols[k]) { if (start < 0) start = k; }
      else if (start >= 0) { groups.push([x0 + start, x0 + k - 1]); start = -1; }
    }
    return groups;
  }

  function cropToCanvas(src, x, y, w, h, up) {
    var c = makeCanvas(w * up + 40, h * up + 40);
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, x, y, w, h, 20, 20, w * up, h * up);
    return c;
  }

  function parseNum(text) {
    var t = String(text || '').replace(/[\s,]/g, '').replace(/^\.+|\.+$/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    return parseFloat(t);
  }

  function norm(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); }

  // 以相鄰單字找標籤，例如 ['root','chord']
  function findLabel(words, seq, maxX) {
    for (var i = 0; i < words.length; i++) {
      var ok = true;
      for (var j = 0; j < seq.length; j++) {
        var w = words[i + j];
        if (!w || norm(w.text).indexOf(seq[j]) !== 0) { ok = false; break; }
      }
      if (ok && words[i].bbox.x0 < maxX) return { first: words[i], last: words[i + seq.length - 1] };
    }
    return null;
  }

  function readField(prep, label, digitW) {
    var first = label.first.bbox, last = label.last.bbox;
    var h = Math.max(last.y1 - first.y0, 10);
    var cy = (first.y0 + last.y1) / 2;
    var yTop = cy - h * 0.6, yBot = cy + h * 0.6;
    var borders = findBorders(prep.ctx, prep.width, last.x1 + 2, last.x1 + h * 9, yTop, yBot);
    if (!borders.length) return Promise.resolve({ value: null, why: '找不到輸入框' });
    var left = borders[0][1] + 4;
    var right = borders.length > 1 && borders[1][0] - left > h ? borders[1][0] - 4 : left + h * 4.5;
    var crop = cropToCanvas(prep.canvas, left, cy - h * 0.55, right - left, h * 1.1, 3);
    return digitW.recognize(crop).then(function (r) {
      var txt = r.data.text.trim();
      return { value: parseNum(txt), raw: txt };
    });
  }

  function isNum(t) { return /^-?\d+(\.\d+)?$/.test(t.replace(/[,|]/g, '')); }

  // 座標表：不依賴文字行的切法，改為收集左側欄位內的數字單字，依 y 位置分列
  function readTable(prep, words, lines, digitW) {
    var W = prep.width;
    var tabsBottom = 0;
    words.forEach(function (w) {
      var t = norm(w.text);
      if ((t === 'general' || t === 'shape' || t === 'fintabs' || t === 'override' || t === 'appearance') && w.bbox.y1 > tabsBottom) tabsBottom = w.bbox.y1;
    });
    var cand = words.filter(function (w) {
      return w.bbox.x0 < W * 0.16 && w.bbox.y0 > tabsBottom && (isNum(w.text) || /^-?[\dOo]+[.]?\d*$/.test(w.text.replace(/[,|]/g, '')));
    });
    if (cand.length < 6) return Promise.resolve(null);
    cand.sort(function (a, b) { return (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1); });
    var rows = [];
    cand.forEach(function (w) {
      var cy = (w.bbox.y0 + w.bbox.y1) / 2, h = w.bbox.y1 - w.bbox.y0;
      var last = rows[rows.length - 1];
      if (last && Math.abs(cy - last.cy) < h * 0.6) { last.words.push(w); }
      else rows.push({ cy: cy, words: [w] });
    });
    rows = rows.filter(function (r) { return r.words.length >= 2; });
    rows.forEach(function (r) { r.words.sort(function (a, b) { return a.bbox.x0 - b.bbox.x0; }); r.words = r.words.slice(0, 2); });
    if (rows.length < 3) return Promise.resolve(null);
    var jobs = [];
    rows.forEach(function (r) {
      r.words.forEach(function (w) {
        var b = w.bbox, hh = b.y1 - b.y0, pad = Math.max(4, hh * 0.25);
        var crop = cropToCanvas(prep.canvas, b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, hh + pad * 2, 3);
        jobs.push(digitW.recognize(crop).then(function (res) {
          var v = parseNum(res.data.text);
          return v === null ? parseNum(w.text) : v;
        }));
      });
    });
    return Promise.all(jobs).then(function (vals) {
      var pts = [];
      for (var i = 0; i < vals.length; i += 2) {
        if (vals[i] === null || vals[i + 1] === null) return null;
        pts.push([vals[i], vals[i + 1]]);
      }
      return pts;
    });
  }


  // 座標表（像素法）：找出表格框、每一列、每一欄，再逐格辨識，不依賴首輪的文字切分
  function readTablePx(prep, tabsBottom, digitW) {
    var W = prep.width, H = prep.height, ctx = prep.ctx;
    var y0 = Math.floor(tabsBottom + H * 0.02), y1 = Math.min(H - 1, Math.floor(tabsBottom + H * 0.30));
    if (y1 - y0 < 40) return Promise.resolve(null);
    // 表格右邊框：左側第一條長垂直線
    var borders = findBorders(ctx, W, W * 0.06, W * 0.32, y0, y1);
    if (!borders.length) return Promise.resolve(null);
    var xR = borders[0][0];
    var xL = Math.max(0, Math.floor(W * 0.005));
    var sw = xR - xL - 4;
    if (sw < 60) return Promise.resolve(null);
    var d = ctx.getImageData(xL, y0, sw, y1 - y0).data, h = y1 - y0;
    function dark(x, y) { return lum(d, (y * sw + x) * 4) < 110; }
    // 水平投影：文字帶
    var bands = [], start = -1;
    for (var y = 0; y <= h; y++) {
      var cnt = 0;
      if (y < h) for (var x = 0; x < sw; x++) if (dark(x, y)) { cnt++; if (cnt > 0) break; }
      if (cnt > 0) { if (start < 0) start = y; }
      else if (start >= 0) { if (y - start >= 8) bands.push([start, y - 1]); start = -1; }
    }
    if (bands.length < 3) return Promise.resolve(null);
    // 每個文字帶：垂直投影分欄
    var cells = [];
    bands.forEach(function (bd, bi) {
      var bh = bd[1] - bd[0] + 1, runs = [], rs = -1, gap = 0;
      for (var x = 0; x <= sw; x++) {
        var ink = false;
        if (x < sw) for (var yy = bd[0]; yy <= bd[1]; yy++) if (dark(x, yy)) { ink = true; break; }
        if (ink) { if (rs < 0) rs = x; gap = 0; }
        else if (rs >= 0) {
          gap++;
          if (gap > bh * 0.9 || x === sw) { runs.push([rs, x - gap]); rs = -1; gap = 0; }
        }
      }
      cells.push({ band: bd, runs: runs });
    });
    var jobs = cells.map(function (c) {
      if (c.runs.length < 2) return Promise.resolve(null);
      var pair = c.runs.slice(0, 2).map(function (r) {
        var cw = r[1] - r[0] + 1, ch = c.band[1] - c.band[0] + 1, pad = Math.max(3, ch * 0.25);
        var crop = cropToCanvas(prep.canvas, xL + r[0] - pad, y0 + c.band[0] - pad, cw + pad * 2, ch + pad * 2, 3);
        return digitW.recognize(crop).then(function (res) { return parseNum(res.data.text); });
      });
      return Promise.all(pair).then(function (v) { return v[0] === null || v[1] === null ? null : [v[0], v[1]]; });
    });
    return Promise.all(jobs).then(function (list) {
      var pts = list.filter(function (q) { return q; });
      return pts.length >= 3 ? pts : null;
    });
  }

  // 圖上每個頂點都有紅色方框：數出紅色方框的數量，用來檢查座標表有沒有漏列
  function countMarkers(prep) {
    var W = prep.width, H = prep.height;
    var d = prep.ctx.getImageData(0, 0, W, H).data;
    var mask = new Uint8Array(W * H);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) mask[p] = 1;
    }
    var seen = new Uint8Array(W * H), comps = [], stack = [];
    for (var s = 0; s < mask.length; s++) {
      if (!mask[s] || seen[s]) continue;
      var minx = W, maxx = 0, miny = H, maxy = 0, area = 0;
      stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        var q = stack.pop(), x = q % W, y = (q - x) / W;
        area++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          var nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var np = ny * W + nx;
          if (mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
        }
      }
      var w = maxx - minx + 1, h = maxy - miny + 1;
      if (area >= 20 && w >= 8 && h >= 8 && w <= W * 0.06 && h <= W * 0.06 && Math.abs(w - h) <= Math.max(w, h) * 0.35) comps.push([minx, miny, w, h]);
    }
    return comps.length;
  }

  function edges(pts) {
    var ys = pts.map(function (q) { return q[1]; });
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var eps = (y1 - y0) * 1e-6 + 1e-9;
    var root = pts.filter(function (q) { return Math.abs(q[1] - y0) <= eps; }).map(function (q) { return q[0]; });
    var tip = pts.filter(function (q) { return Math.abs(q[1] - y1) <= eps; }).map(function (q) { return q[0]; });
    return { y0: y0, y1: y1, rMin: Math.min.apply(null, root), rMax: Math.max.apply(null, root), tMin: Math.min.apply(null, tip), tMax: Math.max.apply(null, tip) };
  }

  function read(blob, opts) {
    var unit = (opts && opts.unit) || 'cm';
    var k = UNIT_MM[unit] || 10;
    var prepP = prepare(blob);
    return Promise.all([prepP, getWorkers()]).then(function (arr) {
      var prep = arr[0], gen = arr[1][0], dig = arr[1][1];
      return gen.recognize(prep.canvas, {}, { blocks: true }).then(function (res) {
        var data = res.data;
        var words = [];
        (data.lines || []).forEach(function (ln) { (ln.words || []).forEach(function (w) { words.push(w); }); });
        if (!words.length && data.words) words = data.words;
        var W = prep.width;
        var title = words.slice(0, 14).map(function (w) { return norm(w.text); }).join(' ');
        var out = { kind: null, fields: {}, raw: {}, points: null, mm: {}, notes: [], title: title };

        var specs = [
          ['cr', ['root', 'chord']],
          ['ct', ['tip', 'chord']],
          ['b', ['height']],
          ['sweep', ['sweep', 'length']],
          ['t', ['thickness']]
        ];
        var found = specs.map(function (s) { return { key: s[0], label: findLabel(words, s[1], W * 0.45) }; })
          .filter(function (s) { return s.label; });

        // Thickness 在 Freeform 的 General 分頁也會出現；Fillet 之類不處理
        var jobs = found.map(function (s) {
          return readField(prep, s.label, dig).then(function (r) { out.raw[s.key] = r.raw || r.why || ''; if (r.value !== null) out.fields[s.key] = r.value; });
        });

        var tabsBottom = 0;
        words.forEach(function (w) {
          var t = norm(w.text);
          if ((t === 'general' || t === 'shape' || t === 'fintabs' || t === 'override' || t === 'appearance' || t === 'comment') && w.bbox.y1 > tabsBottom && w.bbox.y1 < prep.height * 0.3) tabsBottom = w.bbox.y1;
        });
        var isFree = words.slice(0, 14).some(function (w) { return norm(w.text).indexOf('freeform') === 0; });
        var tableP = (isFree || !found.length) && tabsBottom > 0
          ? readTablePx(prep, tabsBottom, dig).then(function (pts) { return pts || readTable(prep, words, data.lines || [], dig); })
          : Promise.resolve(null);
        out.markers = countMarkers(prep);

        return Promise.all(jobs.concat([tableP.then(function (pts) { if (pts) out.points = pts; })])).then(function () {
          var f = out.fields;
          if (out.points && out.points.length >= 3) {
            out.kind = 'freeform';
            var e = edges(out.points);
            if (e.y1 > e.y0) {
              out.mm.b = (e.y1 - e.y0) * k;
              out.mm.cr = (e.rMax - e.rMin) * k;
              out.mm.ct = (e.tMax - e.tMin) * k;
              out.mm.m = (e.tMin - e.rMin) * k;
              out.pointsMm = out.points.map(function (q) { return [q[0] * k, q[1] * k]; });
            }
          } else if (f.cr !== undefined || f.ct !== undefined || f.b !== undefined) {
            out.kind = 'trapezoid';
            if (f.cr !== undefined) out.mm.cr = f.cr * k;
            if (f.ct !== undefined) out.mm.ct = f.ct * k;
            if (f.b !== undefined) out.mm.b = f.b * k;
            if (out.mm.cr > 0 && out.mm.ct >= 0 && out.mm.b > 0 && f.sweep !== undefined) {
              var s = f.sweep * k;
              out.mm.m = s;
              out.pointsMm = [[0, 0], [s, out.mm.b], [s + out.mm.ct, out.mm.b], [out.mm.cr, 0]];
            }
          } else if (f.t !== undefined) {
            out.kind = 'thickness';
          }
          if (f.t !== undefined) out.mm.t = f.t * k;
          return out;
        });
      });
    });
  }

  window.FinOCR = { read: read };
})();
