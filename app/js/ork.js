/*
 * 讀取 OpenRocket 的 .ork 檔（ZIP 內的 rocket.ork XML，或純 XML，或 .gz）。
 * 只取鰭片組與已存的模擬資料。單位視為 SI（m、m/s、s、kg/m³、Pa）。
 * 全部在本機解析，不用外部函式庫。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinOrk = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_INFLATED = 60 * 1024 * 1024;   // 解壓後上限
  var MAX_FILE = 30 * 1024 * 1024;

  // ---------- ZIP / gzip ----------
  function inflate(bytes, format) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('這個環境不支援解壓縮，請改用較新的瀏覽器或 Windows 版。'));
    var ds = new DecompressionStream(format);
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) {
      if (buf.byteLength > MAX_INFLATED) throw new Error('解壓後的檔案過大。');
      return new Uint8Array(buf);
    });
  }

  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }

  function readZip(buf) {
    var bytes = new Uint8Array(buf), v = new DataView(buf), n = bytes.length, i;
    var eocd = -1;
    for (i = n - 22; i >= Math.max(0, n - 65557); i--) { if (u32(v, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('不是有效的 ZIP 檔。');
    var count = u16(v, eocd + 10), cdOff = u32(v, eocd + 16), p = cdOff, entries = [];
    for (i = 0; i < count; i++) {
      if (p + 46 > n || u32(v, p) !== 0x02014b50) throw new Error('ZIP 目錄損毀。');
      var method = u16(v, p + 10), csize = u32(v, p + 20), usize = u32(v, p + 24);
      var nl = u16(v, p + 28), el = u16(v, p + 30), cl = u16(v, p + 32), lo = u32(v, p + 42);
      var name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nl));
      entries.push({ name: name, method: method, csize: csize, usize: usize, offset: lo });
      p += 46 + nl + el + cl;
    }
    return { entries: entries, bytes: bytes, view: v };
  }

  function extract(zip, e) {
    if (e.usize > MAX_INFLATED) return Promise.reject(new Error('檔案內容過大。'));
    var v = zip.view, o = e.offset;
    if (u32(v, o) !== 0x04034b50) return Promise.reject(new Error('ZIP 內容損毀。'));
    var start = o + 30 + u16(v, o + 26) + u16(v, o + 28);
    var data = zip.bytes.subarray(start, start + e.csize);
    if (e.method === 0) return Promise.resolve(data);
    if (e.method === 8) return inflate(data, 'deflate-raw');
    return Promise.reject(new Error('不支援的壓縮方式。'));
  }

  function loadText(buf) {
    if (buf.byteLength > MAX_FILE) return Promise.reject(new Error('檔案超過 30 MB。'));
    var b = new Uint8Array(buf), dec = function (u) { return new TextDecoder('utf-8').decode(u); };
    if (b[0] === 0x50 && b[1] === 0x4b) {
      var zip = readZip(buf), best = null;
      zip.entries.forEach(function (e) {
        if (/(^|\/)rocket\.ork$/i.test(e.name)) best = e;
        else if (!best && /\.ork$|\.xml$/i.test(e.name)) best = e;
      });
      if (!best) return Promise.reject(new Error('ZIP 裡找不到 rocket.ork。'));
      return extract(zip, best).then(dec);
    }
    if (b[0] === 0x1f && b[1] === 0x8b) return inflate(b, 'gzip').then(dec);
    return Promise.resolve(dec(b));
  }

  // ---------- 簡易 XML ----------
  function decodeEnt(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (m, e) {
      e = e.toLowerCase();
      if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
      var c = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : '';
    });
  }

  function parseXml(text) {
    var re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.\-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    var rootNode = { name: '#root', attrs: {}, children: [], text: '' }, stack = [rootNode], last = 0, m, depth = 0;
    while ((m = re.exec(text))) {
      var cur = stack[stack.length - 1];
      if (m.index > last) cur.text += text.slice(last, m.index);
      last = re.lastIndex;
      if (m[1] !== undefined) { cur.text += m[1]; continue; }
      if (!m[3]) continue;
      if (m[2]) {   // 結束標籤
        if (stack.length > 1) stack.pop();
        continue;
      }
      var node = { name: m[3], attrs: {}, children: [], text: '' }, ar = /([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, a;
      while ((a = ar.exec(m[4]))) node.attrs[a[1]] = decodeEnt(a[2] !== undefined ? a[2] : a[3]);
      cur.children.push(node);
      if (!m[5]) { stack.push(node); if (++depth > 5000) throw new Error('XML 巢狀過深。'); }
    }
    return rootNode;
  }

  function find(node, name, out) {
    out = out || [];
    node.children.forEach(function (c) { if (c.name.toLowerCase() === name) out.push(c); find(c, name, out); });
    return out;
  }
  function child(node, name) {
    for (var i = 0; i < node.children.length; i++) if (node.children[i].name.toLowerCase() === name) return node.children[i];
    return null;
  }
  function num(node, name) {
    var c = child(node, name); if (!c) return NaN;
    var s = decodeEnt(c.text).trim(); return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }
  function txt(node, name) { var c = child(node, name); return c ? decodeEnt(c.text).trim() : ''; }

  // ---------- 鰭片 ----------
  function edges(pts) {
    var ys = pts.map(function (q) { return q[1]; }), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), eps = (y1 - y0) * 1e-6 + 1e-9;
    var root = pts.filter(function (q) { return Math.abs(q[1] - y0) <= eps; }).map(function (q) { return q[0]; });
    var tip = pts.filter(function (q) { return Math.abs(q[1] - y1) <= eps; }).map(function (q) { return q[0]; });
    return { y0: y0, y1: y1, rMin: Math.min.apply(null, root), rMax: Math.max.apply(null, root), tMin: Math.min.apply(null, tip), tMax: Math.max.apply(null, tip) };
  }

  function materialOf(n) {
    var m = child(n, 'material');
    if (!m) return { name: '', density_gcc: NaN, G_GPa: NaN };
    var d = parseFloat(m.attrs.density), sm = parseFloat(m.attrs.shearmodulus !== undefined ? m.attrs.shearmodulus : m.attrs.shearModulus);
    return { name: decodeEnt(m.text).trim(), density_gcc: isFinite(d) ? d / 1000 : NaN, G_GPa: isFinite(sm) && sm > 0 ? sm / 1e9 : NaN };
  }

  function stageName(node, ancestors) {
    for (var i = ancestors.length - 1; i >= 0; i--) if (/^(stage|rocket)$/.test(ancestors[i].name.toLowerCase())) { var n = txt(ancestors[i], 'name'); if (n) return n; }
    return '';
  }

  function collectFins(node, anc, out) {
    node.children.forEach(function (c) {
      var nm = c.name.toLowerCase();
      if (nm === 'trapezoidfinset' || nm === 'freeformfinset' || nm === 'ellipticalfinset' || nm === 'tubefinset') {
        out.push(readFin(c, nm, anc));
      } else collectFins(c, anc.concat([c]), out);
    });
  }

  function readFin(n, kind, anc) {
    var fs = { name: txt(n, 'name') || kind, kind: kind.replace('finset', ''), stage: stageName(n, anc), count: num(n, 'fincount'), mat: materialOf(n), geom: null, shape: null, note: '' };
    var t = num(n, 'thickness'), k = 1000;
    if (!isFinite(fs.count) || fs.count < 1) fs.count = 3;
    if (kind === 'trapezoidfinset') {
      var r = num(n, 'rootchord'), c = num(n, 'tipchord'), b = num(n, 'height'), m = num(n, 'sweeplength');
      if (!isFinite(m)) { var ang = num(n, 'sweepangle'); if (isFinite(ang) && isFinite(b)) m = b * Math.tan(ang); }
      if (isFinite(r) && isFinite(c) && isFinite(b) && isFinite(t)) {
        fs.geom = { r_mm: r * k, c_mm: c * k, b_mm: b * k, m_mm: isFinite(m) ? m * k : 0, t_mm: t * k };
        fs.shape = [[0, 0], [fs.geom.m_mm, fs.geom.b_mm], [fs.geom.m_mm + fs.geom.c_mm, fs.geom.b_mm], [fs.geom.r_mm, 0]];
      } else fs.note = '缺少尺寸欄位。';
    } else if (kind === 'freeformfinset') {
      var fp = child(n, 'finpoints'), pts = [];
      if (fp) fp.children.forEach(function (p) { if (p.name.toLowerCase() === 'point') { var x = parseFloat(p.attrs.x), y = parseFloat(p.attrs.y); if (isFinite(x) && isFinite(y)) pts.push([x * k, y * k]); } });
      if (pts.length >= 3 && isFinite(t)) {
        var e = edges(pts);
        if (e.y1 > e.y0) {
          fs.geom = { r_mm: e.rMax - e.rMin, c_mm: e.tMax - e.tMin, b_mm: e.y1 - e.y0, m_mm: e.tMin - e.rMin, t_mm: t * k };
          fs.shape = pts;
          if (pts.length > 4) fs.note = '自由外形（' + pts.length + ' 個頂點）以梯形近似。';
        } else fs.note = '外形座標無效。';
      } else fs.note = '座標點不足或缺少厚度。';
    } else if (kind === 'ellipticalfinset') {
      fs.note = '橢圓鰭無法用梯形公式，已略過。';
    } else {
      fs.note = '管狀鰭不適用。';
    }
    if (fs.geom && !(fs.geom.r_mm > 0 && fs.geom.b_mm > 0 && fs.geom.t_mm > 0 && fs.geom.c_mm >= 0)) { fs.geom = null; fs.shape = null; fs.note = (fs.note ? fs.note + ' ' : '') + '尺寸不是正數。'; }
    return fs;
  }

  // ---------- 模擬資料 ----------
  function readSims(doc) {
    var sims = [];
    find(doc, 'simulation').forEach(function (s) {
      var fd = child(s, 'flightdata');
      if (!fd) return;
      var info = { name: txt(s, 'name') || ('模擬 ' + (sims.length + 1)), maxV: parseFloat(fd.attrs.maxvelocity), maxAlt: parseFloat(fd.attrs.maxaltitude), maxMach: parseFloat(fd.attrs.maxmach), rows: null, note: '' };
      var branches = fd.children.filter(function (c) { return c.name.toLowerCase() === 'databranch'; });
      if (!branches.length) { info.note = '沒有儲存飛行資料點（存檔時要勾選保留模擬資料）。'; sims.push(info); return; }
      var br = branches[0], types = (br.attrs.types || '').split(',').map(function (x) { return x.trim().toLowerCase(); });
      var ti = types.findIndex(function (x) { return /^time\b/.test(x); });
      var ai = types.findIndex(function (x) { return /^altitude\b/.test(x); });
      var vi = types.findIndex(function (x) { return /^total velocity\b/.test(x); });
      if (vi < 0) vi = types.findIndex(function (x) { return /^velocity\b|total vel/.test(x); });
      if (ti < 0 || ai < 0 || vi < 0) { info.note = '資料點缺少 Time、Altitude 或 Total velocity 欄位。'; sims.push(info); return; }
      var rows = [], bad = false;
      br.children.forEach(function (d) {
        if (d.name.toLowerCase() !== 'datapoint') return;
        var f = decodeEnt(d.text).split(',');
        var t = parseFloat(f[ti]), a = parseFloat(f[ai]), v = parseFloat(f[vi]);
        if (!isFinite(t) || !isFinite(a) || !isFinite(v)) return;   // NaN 的取樣點略過
        if (rows.length && !(t > rows[rows.length - 1].t)) { bad = true; return; }
        rows.push({ t: t, alt_m: a, v: Math.abs(v) });
      });
      if (rows.length < 2) info.note = '資料點不足。';
      else if (rows.length > 10000) info.note = '資料點超過 10,000 個，請先降低取樣。';
      else { info.rows = rows; if (bad) info.note = '部分取樣點的時間未遞增，已略過。'; }
      sims.push(info);
    });
    return sims;
  }

  // 解析文字 -> { name, finsets, sims }
  function parseText(text) {
    var doc = parseXml(text);
    var oro = find(doc, 'openrocket')[0] || doc, rocket = child(oro, 'rocket') || oro;
    var fins = [];
    collectFins(rocket, [rocket], fins);
    return { name: txt(rocket, 'name') || '', finsets: fins, sims: readSims(oro) };
  }

  function parse(buf) { return Promise.resolve().then(function () { return loadText(buf); }).then(parseText); }

  return { parse: parse, parseText: parseText, parseXml: parseXml, readZip: readZip };
});
