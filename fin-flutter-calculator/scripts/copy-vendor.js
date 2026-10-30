// 把文字辨識所需的檔案複製到 app/vendor，讓程式完全離線運作
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'app', 'vendor');
const tj = path.join(root, 'node_modules', 'tesseract.js', 'dist');
const core = path.join(root, 'node_modules', 'tesseract.js-core');
const lang = path.join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz');

fs.mkdirSync(path.join(out, 'core'), { recursive: true });
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });
fs.copyFileSync(path.join(tj, 'tesseract.min.js'), path.join(out, 'tesseract.min.js'));
fs.copyFileSync(path.join(tj, 'worker.min.js'), path.join(out, 'worker.min.js'));
['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'].forEach(function (f) {
  fs.copyFileSync(path.join(core, f), path.join(out, 'core', f));
});
fs.copyFileSync(lang, path.join(out, 'lang', 'eng.traineddata.gz'));
console.log('vendor files copied to', out);
