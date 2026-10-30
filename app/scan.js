/* 截圖輸入的操作介面：選檔、拖放、貼上，讀取後填入計算器，並提供座標確認表 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var drop = $('drop'), shot = $('shot'), thumb = $('thumb'), status = $('scanStatus'), ptsBox = $('scanPts'), unitSel = $('unit');
  var UNIT_MM = { cm: 10, mm: 1, 'in': 25.4 };
  var busy = false, thumbUrl = null;

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = 'scan-status' + (kind ? ' ' + kind : '');
  }
  function fmt(x) { return String(Math.round(x * 100) / 100); }

  function edges(pts) {
    var ys = pts.map(function (q) { return q[1]; });
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), eps = (y1 - y0) * 1e-6 + 1e-9;
    var root = pts.filter(function (q) { return Math.abs(q[1] - y0) <= eps; }).map(function (q) { return q[0]; });
    var tip = pts.filter(function (q) { return Math.abs(q[1] - y1) <= eps; }).map(function (q) { return q[0]; });
    return { y0: y0, y1: y1, rMin: Math.min.apply(null, root), rMax: Math.max.apply(null, root), tMin: Math.min.apply(null, tip), tMax: Math.max.apply(null, tip) };
  }

  // 由頂點（截圖單位）算出幾何並套用到計算器
  function applyPoints(pts, unit, thickness) {
    var k = UNIT_MM[unit] || 10;
    var e = edges(pts);
    if (!(e.y1 > e.y0)) return null;
    var g = {
      cr: (e.rMax - e.rMin) * k,
      ct: (e.tMax - e.tMin) * k,
      b: (e.y1 - e.y0) * k,
      pointsMm: pts.map(function (q) { return [q[0] * k, q[1] * k]; })
    };
    if (thickness > 0) g.t = thickness;
    window.FinCalc.apply(g);
    return g;
  }

  // 可編輯的座標確認表：讀錯的數字直接改
  function showPoints(pts, unit) {
    ptsBox.hidden = false;
    var html = '<p class="pts-head">讀到的鰭片頂點（單位 ' + unit + '）。請和截圖核對，讀錯的直接修改。</p>' +
      '<table class="pts-table"><thead><tr><th>#</th><th>X</th><th>Y</th></tr></thead><tbody>';
    pts.forEach(function (q, i) {
      html += '<tr><td>' + (i + 1) + '</td>' +
        '<td><input type="number" step="any" id="px' + i + '" value="' + fmt(q[0]) + '" aria-label="頂點 ' + (i + 1) + ' 的 X"></td>' +
        '<td><input type="number" step="any" id="py' + i + '" value="' + fmt(q[1]) + '" aria-label="頂點 ' + (i + 1) + ' 的 Y"></td></tr>';
    });
    html += '</tbody></table><div class="pts-actions"><button type="button" class="btn" id="ptsApply">套用修改</button></div>';
    ptsBox.innerHTML = html;
    $('ptsApply').addEventListener('click', function () {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var x = parseFloat($('px' + i).value), y = parseFloat($('py' + i).value);
        if (!isFinite(x) || !isFinite(y)) { setStatus('頂點 ' + (i + 1) + ' 的數字不完整，請補上。', 'bad'); return; }
        out.push([x, y]);
      }
      var g = applyPoints(out, unit, 0);
      if (!g || !(g.cr > 0) || !(g.ct > 0) || !(g.b > 0)) { setStatus('這組座標算不出有效的弦長與翼展，請再檢查。', 'bad'); return; }
      setStatus('已用修改後的座標重新計算：根部弦長 ' + fmt(g.cr) + ' mm、尖端弦長 ' + fmt(g.ct) + ' mm、翼展 ' + fmt(g.b) + ' mm。', 'ok');
    });
  }

  function run(blob) {
    if (busy || !blob) return;
    if (!window.Tesseract || !window.FinOCR) { setStatus('文字辨識元件沒有載入，請重新開啟程式。', 'bad'); return; }
    busy = true; drop.classList.add('off'); shot.disabled = true;
    ptsBox.hidden = true; ptsBox.innerHTML = '';
    if (thumbUrl) { try { URL.revokeObjectURL(thumbUrl); } catch (e) {} }
    try { thumbUrl = URL.createObjectURL(blob); thumb.src = thumbUrl; thumb.hidden = false; } catch (e) { thumb.hidden = true; }
    setStatus('正在辨識截圖，第一次約需 5 到 15 秒…');
    var unit = unitSel.value;
    window.FinOCR.read(blob, { unit: unit }).then(function (r) {
      var lines = [];
      if (r.kind === 'freeform' && r.pointsMm) {
        var g = applyPoints(r.points, unit, r.mm.t);
        if (!g || !(g.cr > 0) || !(g.b > 0)) { setStatus('讀到座標表，但算不出有效的鰭片尺寸，請確認截圖包含完整的座標表。', 'bad'); return; }
        lines.push('已讀取 Freeform 座標表（' + r.points.length + ' 個頂點）：根部弦長 ' + fmt(g.cr) + ' mm、尖端弦長 ' + fmt(g.ct) + ' mm、翼展 ' + fmt(g.b) + ' mm。');
        showPoints(r.points, unit);
        if (!(g.ct > 0)) lines.push('尖端弦長為 0。如果鰭片不是三角形，代表漏讀了頂點，請在下方補正。');
        if (r.points.length < 4) lines.push('只讀到 ' + r.points.length + ' 個頂點，一般梯形鰭片有 4 個，請對照截圖確認有沒有漏列。');
      } else if (r.kind === 'trapezoid') {
        var m = r.mm;
        if (!(m.cr > 0) || !(m.ct >= 0) || !(m.b > 0)) {
          setStatus('只讀到部分欄位（' + Object.keys(r.fields).join('、') + '），請確認截圖包含 Root chord、Tip chord、Height。', 'bad');
          return;
        }
        var g2 = { cr: m.cr, ct: m.ct, b: m.b, t: m.t };
        if (r.pointsMm) g2.pointsMm = r.pointsMm;
        window.FinCalc.apply(g2);
        lines.push('已讀取 Trapezoidal 欄位：根部弦長 ' + fmt(m.cr) + ' mm、尖端弦長 ' + fmt(m.ct) + ' mm、翼展 ' + fmt(m.b) + ' mm' +
          (m.t > 0 ? '、厚度 ' + fmt(m.t) + ' mm。' : '。'));
      } else if (r.kind === 'thickness') {
        window.FinCalc.apply({ t: r.mm.t });
        lines.push('只讀到厚度 ' + fmt(r.mm.t) + ' mm，已填入。尺寸請另外上傳 Shape 或 General 分頁的截圖。');
      } else {
        setStatus('在這張圖裡找不到鰭片的尺寸欄位或座標表。請上傳 OpenRocket 的鰭片設定視窗截圖（需包含欄位名稱）。', 'bad');
        return;
      }
      if (r.kind !== 'thickness' && !(r.mm.t > 0)) lines.push('這張截圖沒有厚度，厚度維持 ' + window.FinCalc.get('t') + ' mm。厚度在 General 分頁，可再上傳一張。');
      lines.push('材料與剪切模量不會從截圖讀取，G 維持 ' + window.FinCalc.get('G') + ' GPa，請自行確認。');
      lines.push('請核對上面的數字與截圖一致。');
      setStatus(lines.join('\n'), 'ok');
    }).catch(function (err) {
      setStatus('辨識失敗：' + (err && err.message ? err.message : '未知錯誤') + '\n請換一張更清楚的截圖，或手動輸入。', 'bad');
    }).then(function () {
      busy = false; drop.classList.remove('off'); shot.disabled = false; shot.value = '';
    });
  }

  shot.addEventListener('change', function () { if (shot.files && shot.files[0]) run(shot.files[0]); });
  ['dragenter', 'dragover'].forEach(function (n) {
    drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (n) {
    drop.addEventListener(n, function () { drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) run(f);
  });
  // Ctrl+V 貼上截圖（例如 Windows 的剪取工具）
  document.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) { e.preventDefault(); run(f); return; }
      }
    }
  });
})();
