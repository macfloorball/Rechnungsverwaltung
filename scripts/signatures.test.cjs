'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../frontend/js/signatures.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const context = {};
vm.runInNewContext(source + '\nthis.api = {boundedLayout, gestureLayout, signatureLayout};', context);
const { boundedLayout, gestureLayout } = context.api;
const signature = { image_width: 400, image_height: 100, name_width_mm: 70 };
const layout = { enabled: true, x_mm: 40, y_mm: 240, width_mm: 50 };

test('A4 gestures remain identical at 50, 100 and 150 percent zoom', () => {
  for (const zoom of [0.5, 1, 1.5]) {
    const start = { x: 100, y: 200, rect: { width: 630 * zoom, height: 891 * zoom }, layout };
    const result = gestureLayout(signature, start, 100 + 30 * zoom, 200 + 15 * zoom);
    assert.equal(result.x_mm, 50);
    assert.equal(result.y_mm, 245);
    assert.equal(result.width_mm, 50);
    const resized = gestureLayout(signature, { ...start, resize: true }, 100 + 30 * zoom, 200);
    assert.equal(resized.width_mm, 60);
    assert.equal(resized.x_mm, 40);
  }
});

test('bounds include centred name, aspect ratio, minimum and maximum size', () => {
  const result = boundedLayout(signature, { ...layout, x_mm: -100, y_mm: 1000 });
  assert.equal(result.x_mm, 10);
  assert.equal(result.y_mm, 277.5);
  assert.equal(boundedLayout(signature, { ...layout, width_mm: 1000 }).width_mm, 150);
  assert.equal(boundedLayout(signature, { ...layout, width_mm: 1 }).width_mm, 10);
  const tall = boundedLayout({ ...signature, image_width: 100, image_height: 400 }, { ...layout, width_mm: 1000 });
  assert.equal(tall.width_mm, 72.5);
  assert.equal(tall.y_mm, 0);
});

test('local PDF renderer and font licenses are included in frontend build input', () => {
  for (const name of ['pdf.mjs','pdf.worker.mjs','LICENSE','SOURCE.txt','standard_fonts/LICENSE_FOXIT','standard_fonts/LICENSE_LIBERATION','standard_fonts/LiberationSans-Regular.ttf']) {
    assert.ok(fs.statSync(require('node:path').join(__dirname, '../frontend/vendor/pdfjs', name)).size > 0);
  }
});
