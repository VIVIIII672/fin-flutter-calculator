const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const P = require('../app/js/physics.js');
const CSV = require('../app/js/csv.js');
const S = require('../app/js/state.js');
const O = require('../app/js/ork.js');

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function zipOf(name, text, method = 8) {
  const raw = Buffer.from(text, 'utf8'), data = method === 8 ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name), crc = crc32(raw);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const off = lh.length + nm.length + data.length, cdl = cd.length + nm.length;
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cdl, 12); eo.writeUInt32LE(off, 16);
  const out = Buffer.concat([lh, nm, data, cd, nm, eo]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

const ORK = `<?xml version="1.0" encoding="UTF-8"?>
<openrocket version="1.11" creator="OpenRocket 23.09">
 <rocket><name>Test &amp; Rocket</name>
  <subcomponents><stage><name>Sustainer</name><subcomponents><bodytube><name>Body</name><subcomponents>
   <trapezoidfinset><name>Main fins</name><material type="bulk" density="1850.0">Fiberglass</material><fincount>4</fincount><thickness>0.003</thickness>
     <rootchord>0.15</rootchord><tipchord>0.075</tipchord><sweeplength>0.05</sweeplength><height>0.1</height></trapezoidfinset>
   <freeformfinset><name>Free</name><material type="bulk" density="1780.0" shearModulus="1.7E10">Carbon fiber</material><fincount>3</fincount><thickness>0.004</thickness>
     <finpoints><point x="0.0" y="0.0"/><point x="0.05" y="0.09"/><point x="0.1" y="0.09"/><point x="0.12" y="0.0"/></finpoints></freeformfinset>
   <ellipticalfinset><name>Ell</name><fincount>3</fincount><thickness>0.003</thickness><rootchord>0.1</rootchord><height>0.05</height></ellipticalfinset>
  </subcomponents></bodytube></subcomponents></stage></subcomponents></rocket>
 <simulations><simulation status="loaded"><name>Sim A</name><flightdata maxaltitude="500" maxvelocity="250" maxmach="0.73">
   <databranch name="Sustainer" types="Time,Altitude,Vertical velocity,Total velocity">
     <datapoint>0.0,0.0,0.0,0.0</datapoint><datapoint>1.0,20.0,40.0,40.0</datapoint><datapoint>2.0,100.0,200.0,NaN</datapoint><datapoint>3.0,300.0,-250.0,250.0</datapoint>
   </databranch></flightdata></simulation>
  <simulation status="outdated"><name>Sim B</name><flightdata maxvelocity="100"></flightdata></simulation></simulations>
</openrocket>`;

test('ork: zip(deflate)、純 XML 都能解析鰭片與模擬', async () => {
  for (const buf of [zipOf('rocket.ork', ORK), zipOf('rocket.ork', ORK, 0), new TextEncoder().encode(ORK).buffer]) {
    const r = await O.parse(buf);
    assert.strictEqual(r.name, 'Test & Rocket');
    assert.strictEqual(r.finsets.length, 3);
    const a = r.finsets[0];
    assert.strictEqual(a.name, 'Main fins'); assert.strictEqual(a.count, 4); assert.strictEqual(a.stage, 'Sustainer');
    assert.deepStrictEqual(a.geom, { r_mm: 150, c_mm: 75, b_mm: 100, m_mm: 50, t_mm: 3 });
    assert.ok(Math.abs(a.mat.density_gcc - 1.85) < 1e-9);
    const f = r.finsets[1];
    assert.deepStrictEqual([f.geom.r_mm, f.geom.c_mm, f.geom.b_mm, f.geom.m_mm, f.geom.t_mm].map(x => Math.round(x * 1e6) / 1e6), [120, 50, 90, 50, 4]);
    assert.ok(Math.abs(f.mat.G_GPa - 17) < 1e-9);
    assert.strictEqual(r.finsets[2].geom, null);
    assert.strictEqual(r.sims.length, 2);
    assert.strictEqual(r.sims[0].rows.length, 3);              // NaN 取樣點略過
    assert.strictEqual(r.sims[0].rows[2].v, 250);              // 取絕對值
    assert.strictEqual(r.sims[1].rows, null);
  }
});

test('ork: 壞檔案與過大的 ZIP 被拒絕', async () => {
  await assert.rejects(() => O.parse(new Uint8Array([0x50, 0x4b, 1, 2, 3]).buffer));
  const big = new Uint8Array(31 * 1024 * 1024).buffer;
  await assert.rejects(() => O.parse(big));
  const r = await O.parse(new TextEncoder().encode('<openrocket><rocket></rocket></openrocket>').buffer);
  assert.strictEqual(r.finsets.length, 0);
});

test('csv: 模態頻率與係數表匯入', () => {
  assert.deepStrictEqual(CSV.parseModes('Mode\tFrequency [Hz]\n1.\t125.3\n2.\t480.1\n3. 902').freqs, [125.3, 480.1, 902]);
  assert.deepStrictEqual(CSV.parseModes('100\n200').freqs, [100, 200]);
  assert.throws(() => CSV.parseModes('abc'));
  assert.deepStrictEqual(CSV.parsePairs('Mach,Cn\n1.2,2.6\n0.5,2.1').map(r => r[0]), [0.5, 1.2]);
  assert.throws(() => CSV.parsePairs('1,2'));
  assert.throws(() => CSV.parsePairs('0.5,1\n0.5,2'));
  assert.throws(() => CSV.parsePairs('-1,1\n2,2'));
});

test('physics: 絕熱壁溫、G 溫度折減、內插', () => {
  assert.ok(Math.abs(P.adiabaticWallT(288.15, 0) - 288.15) < 1e-9);
  assert.ok(Math.abs(P.adiabaticWallT(288.15, 2) - 288.15 * (1 + 0.89 * 0.2 * 4)) < 1e-6);
  assert.strictEqual(P.gTempFactor(20, 10), 1);
  assert.ok(Math.abs(P.gTempFactor(120, 10) - 0.9) < 1e-12);
  assert.strictEqual(P.gTempFactor(5000, 50), 0.05);
  const t = [[0, 1], [1, 3]];
  assert.deepStrictEqual(P.interp(t, 0.5), { v: 2, clamped: false });
  assert.deepStrictEqual(P.interp(t, 2), { v: 3, clamped: true });
  assert.deepStrictEqual(P.interp(t, -1), { v: 1, clamped: true });
});

test('state: 材料名稱對照與匯入驗證（比對案例、係數表、溫度）', () => {
  assert.strictEqual(S.matchMaterial('G10 Fiberglass').id, 'g10');
  assert.strictEqual(S.matchMaterial('Carbon fiber').id, 'cf');
  assert.strictEqual(S.matchMaterial('Unobtainium'), null);
  const st = S.defaults();
  st.thermal = { finT_C: 150, kLoss: 12 };
  st.mass.cnTable = [[0.5, 2], [1.5, 3]];
  st.cal = [{ name: 'a', geom: st.geom, G_GPa: 4.5, aglM: 0, flight: st.flight, Vref: 300 }, { name: 'bad', geom: st.geom, G_GPa: 4.5, aglM: 0, flight: st.flight, Vref: -1 }];
  const r = S.importCase(S.exportCase(st));
  assert.strictEqual(r.state.thermal.finT_C, 150);
  assert.strictEqual(r.state.mass.cnTable.length, 2);
  assert.strictEqual(r.state.cal.length, 1);
  assert.strictEqual(r.state.judge, 'conservative');
});

test('physics: 剖面等效厚度與根部柔度', () => {
  assert.strictEqual(P.sectionFactor('flat'), 1);
  assert.ok(Math.abs(P.sectionFactor('wedge') - Math.cbrt(0.25)) < 1e-12);
  assert.ok(Math.abs(P.sectionFactor('biconvex') - Math.cbrt(64 * 36 / 5040)) < 1e-12);
  // 斜削 f=g=0.1：平均立方 = 1 - 0.75*0.2 = 0.85
  assert.ok(Math.abs(P.sectionFactor('bevel', 0.1, 0.1) - Math.cbrt(0.85)) < 1e-12);
  assert.ok(Number.isNaN(P.sectionFactor('bevel', 0.8, 0.8)));
  // 數值積分驗證雙楔形：t(x) 兩側線性到 0
  let acc = 0, n = 200000; for (let i = 0; i < n; i++) { const x = (i + 0.5) / n, s = x < 0.5 ? 2 * x : 2 * (1 - x); acc += s ** 3 / n; }
  assert.ok(Math.abs(Math.cbrt(acc) - P.sectionFactor('wedge')) < 1e-6);
  assert.strictEqual(P.rootStiffnessRatio(null), 1);
  assert.ok(Math.abs(P.rootStiffnessRatio(1) - 0.5) < 1e-12);
  assert.ok(P.rootStiffnessRatio(100) > 0.99);
});
