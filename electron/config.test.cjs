'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getFrontendURL } = require('./config.cjs');

test('ohne URL wird die zentrale Loopback-Adresse verwendet', () => {
  assert.equal(getFrontendURL(undefined), 'http://127.0.0.1:8000/');
});
test('explizite Loopback-Origins mit frei wählbarem Port', () => {
  assert.equal(getFrontendURL('http://127.0.0.1:8123'), 'http://127.0.0.1:8123/');
  assert.equal(getFrontendURL('http://[::1]:8000/'), 'http://[::1]:8000/');
});
test('fremde Inhalte und mehrdeutige Konfiguration ablehnen', () => {
  for (const url of ['', 'https://example.org', 'http://0.0.0.0:8000',
    'file:///tmp/index.html', 'http://localhost:8000', 'http://127.0.0.1.evil.test',
    'http://user:pass@127.0.0.1', 'http://127.0.0.1/api', 'http://127.0.0.1/?x=1',
    'http://127.0.0.1/#test']) {
    assert.throws(() => getFrontendURL(url), url);
  }
});
