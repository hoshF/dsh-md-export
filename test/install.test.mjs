/** Installer integration over a temporary checkout/profile and a package-manager test double. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const installer = fs.readFileSync(new URL('../install.sh', import.meta.url));
const PACKAGE = 'dsh-md-export';
const OTHER = 'other-plugin';
const options = { skip: process.platform === 'win32' };

// Model a local-tarball store: a cached same-version package needs a forced refresh.
// The double updates only its own lock entry, exposing any installer-wide deletion.
const pnpmDouble = `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const command = args[0];
const read = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n');
if (command === 'pack') {
  const pkg = read('package.json');
  const dest = args[args.indexOf('--pack-destination') + 1];
  fs.mkdirSync(dest, { recursive: true });
  write(path.join(dest, pkg.name + '-' + pkg.version + '.tgz'), pkg);
} else {
  const manifest = read('package.json');
  const lock = read('pnpm-lock.yaml', { dependencies: {}, packages: {} });
  if (command === 'remove') {
    const name = args[1];
    delete manifest.dependencies[name];
    delete lock.dependencies[name];
    fs.rmSync(path.join('node_modules', name), { recursive: true, force: true });
  } else if (command === 'add') {
    if (process.env.INSTALL_TEST_FAIL_ADD === '1') {
      console.error('package installation failed');
      process.exit(2);
    }
    // Local specs must remain resolvable until the target dependency is removed.
    for (const oldSpec of Object.values(manifest.dependencies)) {
      if (oldSpec.startsWith('file:') && !fs.existsSync(oldSpec.slice(5))) {
        throw new Error('missing old local tarball: ' + oldSpec);
      }
    }
    const spec = args.find(arg => arg.startsWith('file:'));
    const pkg = read(spec.slice(5));
    const store = read('.test-store.json', {});
    const key = pkg.name + '@' + pkg.version;
    const installed = args.includes('--force') || !store[key] ? pkg : store[key];
    store[key] = installed;
    write('.test-store.json', store);
    const dir = path.join('node_modules', pkg.name);
    fs.mkdirSync(dir, { recursive: true });
    write(path.join(dir, 'package.json'), installed);
    manifest.dependencies[pkg.name] = spec;
    lock.dependencies[pkg.name] = { specifier: spec, version: key };
    lock.packages[key] = { integrity: 'fixture-' + installed.marker };
  } else {
    throw new Error('unexpected package-manager command: ' + command);
  }
  write('package.json', manifest);
  write('pnpm-lock.yaml', lock);
}
`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-md-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout with spaces');
  const profile = path.join(root, 'profile with spaces');
  fs.mkdirSync(checkout);
  fs.mkdirSync(path.join(profile, 'node_modules', OTHER), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'install.sh'), installer);
  const pnpm = path.join(root, 'pnpm-double.mjs');
  fs.writeFileSync(pnpm, pnpmDouble);
  const otherDependency = { specifier: '^1.0.0', version: '1.0.4' };
  const otherPackage = { integrity: 'fixture-other-locked' };
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    name: 'fixture-profile', private: true,
    dependencies: { [OTHER]: '^1.0.0' },
    dsh: { profile: { bundles: [OTHER] } },
  }));
  fs.writeFileSync(path.join(profile, 'pnpm-lock.yaml'), JSON.stringify({
    dependencies: { [OTHER]: otherDependency }, packages: { [`${OTHER}@1.0.4`]: otherPackage },
  }));
  const otherManifest = JSON.stringify({ name: OTHER, version: '1.0.4' });
  const otherPath = path.join(profile, 'node_modules', OTHER, 'package.json');
  fs.writeFileSync(otherPath, otherManifest);

  const read = (name) => JSON.parse(fs.readFileSync(path.join(profile, name), 'utf8'));
  const source = (marker) => fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({
    name: PACKAGE, version: '1.7.2', marker, dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  source('initial');
  return {
    checkout, profile, read, source,
    run(extraEnv = {}) {
      return spawnSync('sh', [path.join(checkout, 'install.sh')], {
        cwd: root, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, DSH_HOME: path.join(root, 'dsh-home'), DSH_PROFILE_DIR: profile,
          DSH_NODE: process.execPath, DSH_PNPM: pnpm, ...extraEnv },
      });
    },
    installed() { return read(path.join('node_modules', PACKAGE, 'package.json')); },
    assertOtherPreserved() {
      assert.equal(read('package.json').dependencies[OTHER], '^1.0.0');
      assert.ok(read('package.json').dsh.profile.bundles.includes(OTHER));
      assert.equal(fs.readFileSync(otherPath, 'utf8'), otherManifest);
      const lock = read('pnpm-lock.yaml');
      assert.deepEqual(lock.dependencies[OTHER], otherDependency);
      assert.deepEqual(lock.packages[`${OTHER}@1.0.4`], otherPackage);
    },
  };
}

function succeeded(result) {
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
}

test('installer registers a fresh bundle and preserves other plugins and lock entries', options, (t) => {
  const f = fixture(t);
  succeeded(f.run());
  assert.equal(f.installed().marker, 'initial');
  assert.deepEqual(f.read('package.json').dsh.profile.bundles, [OTHER, PACKAGE]);
  f.assertOtherPreserved();
});

test('installer refreshes a rebuilt same-version package without duplicate registration', options, (t) => {
  const f = fixture(t);
  succeeded(f.run());
  f.source('rebuilt');
  succeeded(f.run());
  assert.equal(f.installed().marker, 'rebuilt');
  assert.deepEqual(f.read('package.json').dsh.profile.bundles, [OTHER, PACKAGE]);
  f.assertOtherPreserved();
});

test('installer replaces a dependency whose old tarball no longer exists', options, (t) => {
  const f = fixture(t);
  const manifest = f.read('package.json');
  manifest.dependencies[PACKAGE] = `file:${path.join(f.profile, 'missing-old.tgz')}`;
  fs.writeFileSync(path.join(f.profile, 'package.json'), JSON.stringify(manifest));
  const lock = f.read('pnpm-lock.yaml');
  lock.dependencies[PACKAGE] = { specifier: manifest.dependencies[PACKAGE], version: 'old-fixture' };
  fs.writeFileSync(path.join(f.profile, 'pnpm-lock.yaml'), JSON.stringify(lock));
  succeeded(f.run());
  const newSpec = f.read('package.json').dependencies[PACKAGE];
  assert.ok(fs.existsSync(newSpec.slice(5)));
  assert.equal(f.installed().marker, 'initial');
  f.assertOtherPreserved();
});

test('installer propagates an installation failure without registering a bundle', options, (t) => {
  const f = fixture(t);
  const result = f.run({ INSTALL_TEST_FAIL_ADD: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package installation failed/);
  assert.doesNotMatch(result.stdout, /done\./);
  assert.deepEqual(f.read('package.json').dsh.profile.bundles, [OTHER]);
  f.assertOtherPreserved();
});
