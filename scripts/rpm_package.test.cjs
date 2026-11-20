'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spec, rpmRelease } = require('./rpm_package.cjs');
const path = require('node:path');
test('RPM specs preserve runtime bytes, root ownership and fail-safe process guards', () => {
  const text = spec('0.1.1', '1', "if __name__ == '__main__':\n    refuse_running_application()\n");
  assert.match(text, /%defattr\(-,root,root,-\)/);
  assert.match(text, /%global __os_install_post %\{nil\}/);
  assert.match(text, /%pre -p \/usr\/bin\/python3/);
  assert.match(text, /int\(sys.argv\[1\]\) == 0/);
  assert.doesNotMatch(text, /kill|rm -rf|\/home\//);
  assert.throws(() => spec('0.1.1\n%post', '1', ''), /Invalid/);
  assert.throws(() => spec('0.1.1', '1;touch bad', ''), /Invalid/);
});
test('development RPM provenance is separate from production desktop tags', () => {
  const root = path.join(__dirname, '..');
  const release = rpmRelease(root, { tag: null });
  assert.equal(release.channel, 'development');
  assert.equal(release.commit, null);
  assert.throws(() => rpmRelease(root, { tag: 'desktop-v0.1.1' }), /RPM tag/);
  assert.throws(() => rpmRelease(root, { release: 0 }), /release number/);
});
