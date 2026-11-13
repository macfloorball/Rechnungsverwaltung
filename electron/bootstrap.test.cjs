'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const scenario of ['valid', 'damaged', 'missing-validator']) {
  test(`installed bootstrap handles ${scenario} before starting application code`, async () => {
    let validated = false;
    let starts = 0;
    const messages = [];
    const exits = [];
    const app = { getAppPath: () => '/installed/app', whenReady: async () => {}, exit: (code) => exits.push(code) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8'), {
      console: { error() {} }, require(name) {
        if (name === 'electron') return { app, dialog: { showErrorBox: (...args) => messages.push(args) } };
        if (name === './installation.cjs') {
          if (scenario === 'missing-validator') throw Error('private path');
          return { validateInstallation(root, installed) {
            assert.equal(root, '/installed/app');
            assert.equal(installed, true);
            if (scenario === 'damaged') throw Error('private customer path');
            validated = true;
          } };
        }
        if (name === './main.cjs') { assert.equal(validated, true); starts++; return; }
        throw Error(name);
      },
    });
    await new Promise(setImmediate);
    assert.equal(starts, scenario === 'valid' ? 1 : 0);
    assert.deepEqual(exits, scenario === 'valid' ? [] : [1]);
    assert.equal(messages.length, scenario === 'valid' ? 0 : 1);
    if (messages.length) {
      assert.match(messages[0][1], /Installer reparieren/);
      assert.doesNotMatch(messages[0][1], /private|customer/);
    }
  });
}
