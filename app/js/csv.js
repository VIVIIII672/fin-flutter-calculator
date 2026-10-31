/*
 * 飛行軌跡 CSV：讀取 OpenRocket 風格的匯出檔，並輸出評估結果。
 * 限制：檔案 2 MB、10,000 列、時間必須嚴格遞增、不接受跨行的引號欄位。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinCSV = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_CHARS = 2 * 1024 * 1024, MAX_ROWS = 10000;

  function splitFields(line, lineNo) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    if (inQ) throw new Error('第 ' + lineNo + ' 行的引號沒有結束。這個工具不接受跨行的引號欄位。');
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function isNum(s) { return s !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s); }

  function unitOf(name) {
    var m = /\(([^)]*)\)\s*$/.exec(name);
    return m ? m[1].trim().toLowerCase() : '';
  }

  var TIME_K = { '': 1, s: 1, sec: 1, ms: 0.001, min: 60 };
  var LEN_K = { '': 1, m: 1, ft: 0.3048, km: 1000 };
  var SPD_K = { '': 1, 'm/s': 1, 'ft/s': 0.3048, 'km/h': 1 / 3.6, mph: 0.44704, kt: 0.514444, 'mi/h': 0.44704 };

  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('檔案是空的。');
    if (text.length > MAX_CHARS) throw new Error('檔案超過 2 MB，請減少取樣點。');
    text = text.replace(/^﻿/, '');
    var lines = text.split(/\r\n|\n|\r/);
    var header = null, headerLine = 0, rows = [], map = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw.trim()) continue;
      var lineNo = i + 1, isComment = /^\s*#/.test(raw);
      var body = isComment ? raw.replace(/^\s*#+\s*/, '') : raw;
      if (!header) {
        var cand = body.indexOf(',') >= 0 ? splitFields(body, lineNo) : [];
        var looksHeader = cand.length >= 3 && cand.some(function (c) { return /^time\b/i.test(c); }) && !cand.every(isNum);
        if (looksHeader) {
          header = cand; headerLine = lineNo;
          map = mapColumns(header);
        }
        continue;
      }
      if (isComment) continue;
      var f = splitFields(raw, lineNo);
      if (f.length < header.length) throw new Error('第 ' + lineNo + ' 行的欄位數量（' + f.length + '）少於標題列（' + header.length + '）。');
      var t = f[map.t.i], alt = f[map.alt.i], v = f[map.v.i];
      if (!isNum(t) || !isNum(alt) || !isNum(v)) throw new Error('第 ' + lineNo + ' 行的時間、高度或速度不是有效數字。');
      var row = { t: parseFloat(t) * map.t.k, alt_m: parseFloat(alt) * map.alt.k, v: parseFloat(v) * map.v.k };
      if (rows.length && !(row.t > rows[rows.length - 1].t)) throw new Error('第 ' + lineNo + ' 行的時間沒有嚴格遞增。');
      if (row.v < 0) throw new Error('第 ' + lineNo + ' 行的速度為負數，請使用總速度（Total velocity）。');
      rows.push(row);
      if (rows.length > MAX_ROWS) throw new Error('資料超過 10,000 列，請減少取樣點。');
    }
    if (!header) throw new Error('找不到標題列。需要包含時間（Time）、高度（Altitude）與速度（Total velocity）欄位。');
    if (rows.length < 2) throw new Error('資料列少於 2 列。');
    return {
      rows: rows,
      meta: { time: header[map.t.i], altitude: header[map.alt.i], velocity: header[map.v.i], headerLine: headerLine }
    };
  }

  function mapColumns(header) {
    function find(re, not) {
      for (var i = 0; i < header.length; i++) if (re.test(header[i]) && !(not && not.test(header[i]))) return i;
      return -1;
    }
    var ti = find(/^time\b/i);
    var ai = find(/^altitude\b/i, /max|apogee/i);
    var vi = find(/^total velocity\b/i);
    if (vi < 0) vi = find(/^(air[- ]?relative )?(velocity|speed)\b/i, /vertical|lateral|max/i);
    if (ti < 0) throw new Error('標題列缺少時間（Time）欄位。');
    if (ai < 0) throw new Error('標題列缺少高度（Altitude）欄位。');
    if (vi < 0) throw new Error('標題列缺少速度（Total velocity）欄位。');
    function conv(i, table, what) {
      var u = unitOf(header[i]);
      if (!(u in table)) throw new Error(what + '欄位的單位「' + u + '」無法辨識。');
      return { i: i, k: table[u] };
    }
    return { t: conv(ti, TIME_K, '時間'), alt: conv(ai, LEN_K, '高度'), v: conv(vi, SPD_K, '速度') };
  }

  function q(s) { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function num(x, d) { return isFinite(x) ? Number(x.toFixed(d)).toString() : ''; }

  // 輸出評估結果（內部 SI 單位）
  function evaluatedCsv(recs, info) {
    var head = ['time_s', 'altitude_agl_m', 'velocity_mps', 'mach', 'q_Pa', 'Vf_lowG_mps', 'Vf_nominal_mps', 'Vf_highG_mps', 'margin_lowG_pct'];
    var out = [];
    if (info) Object.keys(info).forEach(function (k) { out.push('# ' + k + ': ' + String(info[k]).replace(/[\r\n]+/g, ' ')); });
    out.push(head.join(','));
    recs.forEach(function (r) {
      out.push([num(r.t, 3), num(r.alt, 2), num(r.v, 2), num(r.mach, 4), num(r.q, 1), num(r.VfLow, 2), num(r.VfNom, 2), num(r.VfHigh, 2), num(r.marginLow, 2)].map(q).join(','));
    });
    return out.join('\r\n') + '\r\n';
  }

  // ---- 匯入 Ansys 的模態頻率與 Fluent 的係數表 ----
  var NUM_G = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  function numbersIn(line) {
    // 去掉括號內的單位，例如 "Frequency [Hz]"
    var clean = line.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
    var m = clean.match(NUM_G) || [], rest = clean.replace(NUM_G, '').replace(/[\s,;\t.]/g, '');
    return rest.length > 0 && m.length === 0 ? [] : m.map(parseFloat);
  }
  function lines(text) {
    if (text.length > 200000) throw new Error('文字過長。');
    return text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#'; });
  }
  // 每行最多取一個頻率：有兩個以上數字時取第二個（第一個是模態編號），否則取第一個
  function parseModes(text) {
    var out = [];
    lines(text).forEach(function (l) {
      var n = numbersIn(l);
      if (!n.length) return;
      var f = n.length >= 2 ? n[1] : n[0];
      if (isFinite(f) && f > 0) out.push(f);
    });
    if (!out.length) throw new Error('找不到頻率數字。每行一個頻率，或「模態編號, 頻率」兩欄都可以。');
    return { freqs: out.slice(0, 12), truncated: out.length > 12 };
  }
  // 兩欄（Mach, 係數），其餘欄位忽略；標題行自動略過
  function parsePairs(text) {
    var rows = [];
    lines(text).forEach(function (l) {
      var n = numbersIn(l);
      if (n.length >= 2 && isFinite(n[0]) && isFinite(n[1])) rows.push([n[0], n[1]]);
    });
    if (rows.length < 2) throw new Error('至少需要 2 列「Mach, 係數」。');
    if (rows.length > 500) throw new Error('超過 500 列。');
    rows.sort(function (a, b) { return a[0] - b[0]; });
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] < 0) throw new Error('Mach 不可為負。');
      if (i && rows[i][0] === rows[i - 1][0]) throw new Error('Mach 有重複的列。');
    }
    return rows;
  }

  return { parseModes: parseModes, parsePairs: parsePairs, parse: parse, evaluatedCsv: evaluatedCsv, MAX_ROWS: MAX_ROWS, MAX_CHARS: MAX_CHARS };
});
