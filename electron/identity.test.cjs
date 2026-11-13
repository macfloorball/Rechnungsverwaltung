'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { APP_NAME, configureIdentity, getWindowOptions } = require('./identity.cjs');

test('name and title come from package metadata; old profile paths are preserved', (t) => {
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ttc-identity-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const paths = { userData: path.join(profile, APP_NAME), sessionData: '/custom/session' };
  let name;
  let modelId;
  configureIdentity({ getPath: (key) => paths[key], setPath: (key, value) => { paths[key] = value; }, setName: (value) => { name = value; }, setAppUserModelId: (value) => { modelId = value; } }, 'win32');
  assert.equal(modelId, 'de.mac-floorball.ttc-rechnungsverwaltung');
  assert.equal(name, 'TTC Rechnungsverwaltung');
  assert.equal(paths.userData, path.join(profile, 'ttc-rechnungsverwaltung'));
  assert.ok(fs.statSync(paths.userData).isDirectory());
  assert.equal(paths.sessionData, '/custom/session');
});

test('default geometry is centered and respects minimum dimensions', () => {
  const options = getWindowOptions({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.deepEqual([options.width,options.height,options.minWidth,options.minHeight], [1280,800,1000,650]);
  assert.deepEqual([options.x,options.y], [320,120]);
  assert.equal(options.title, APP_NAME);
  assert.ok(options.resizable && options.maximizable && !options.fullscreen);
});

test('small/scaled displays and monitors with negative coordinates stay in bounds', () => {
  for (const work of [
    { x: -1600, y: -200, width: 1600, height: 900 },
    { x: 1920, y: 0, width: 800, height: 560 },
    { x: 0, y: 0, width: 960, height: 540 },
  ]) {
    const o = getWindowOptions(work);
    assert.ok(o.x >= work.x && o.y >= work.y);
    assert.ok(o.x + o.width <= work.x + work.width && o.y + o.height <= work.y + work.height);
    assert.ok(o.minWidth <= o.width && o.minHeight <= o.height);
  }
});

test('Windows ICO and cross-platform PNG exist with expected formats', () => {
  const ico = fs.readFileSync(getWindowOptions({x:0,y:0,width:1920,height:1080},'win32').icon);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  const png = fs.readFileSync(getWindowOptions({x:0,y:0,width:1920,height:1080},'linux').icon);
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});
