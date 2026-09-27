// Temporary synthetic homes only. macOS process/platform queries are doubled;
// the target selection, validation, backup, copy and rollback code is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
// Optional path points to an assembled distribution, not a user's Vault.
const assets = path.resolve(process.argv[2] || path.join(here, 'dist'));
const names = ['main.js', 'manifest.json', 'styles.css'];
const source = readFileSync(path.join(here, 'install-macos.command'), 'utf8');
assert.equal((source.match(/\/usr\/bin\/pgrep -x Obsidian/g) || []).length, 1);
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'palmwiki-installer-'));
  const home = path.join(dir, 'Home with spaces'), pkg = path.join(dir, 'package'), bin = path.join(dir, 'bin');
  mkdirSync(home); mkdirSync(bin); mkdirSync(pkg);
  cpSync(path.join(assets, 'palmwiki-home-lite'), path.join(pkg, 'palmwiki-home-lite'), { recursive: true });
  cpSync(path.join(assets, 'SHA256SUMS'), path.join(pkg, 'SHA256SUMS'));
  writeFileSync(path.join(pkg, 'install-macos.command'), source.replace('/usr/bin/pgrep -x Obsidian', 'pgrep -x Obsidian'));
  writeFileSync(path.join(bin, 'uname'), '#!/bin/bash\necho "${STUB_PLATFORM:-Darwin}"\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'pgrep'), '#!/bin/bash\nexit "${STUB_PROCESS:-1}"\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'cp'), `#!/bin/bash
last="\${!#}"
if [[ "\${STUB_COPY_FAIL:-}" == backup && "$last" == *PalmWikiHomeLite-Backups* ]]; then exit 1; fi
if [[ "\${STUB_COPY_FAIL:-}" == install && "$last" == */.obsidian/plugins/palmwiki-home-lite/styles.css && ! -e "$HOME/failure-injected" ]]; then touch "$HOME/failure-injected"; exit 1; fi
exec /bin/cp "$@"
`, { mode: 0o755 });
  const docs = path.join(home, 'Library/Mobile Documents/iCloud~md~obsidian/Documents');
  const vault = path.join(docs, 'PalmWiki'), dest = path.join(vault, '.obsidian/plugins/palmwiki-home-lite');
  const backups = path.join(home, 'PalmWikiHomeLite-Backups');
  function existing() {
    mkdirSync(dest, { recursive: true });
    for (const name of names) writeFileSync(path.join(dest, name), 'previous-' + name);
    writeFileSync(path.join(dest, 'data.json'), '{"switchCommand":"keep-me"}');
    writeFileSync(path.join(vault, 'Note.md'), '# Do not change this note');
  }
  function run(env = {}) {
    return spawnSync('/bin/bash', [path.join(pkg, 'install-macos.command')], {
      env: { ...process.env, HOME: home, PATH: bin + path.delimiter + process.env.PATH, ...env }, encoding: 'utf8', timeout: 10000,
    });
  }
  function unchanged() {
    for (const name of names) assert.equal(readFileSync(path.join(dest, name), 'utf8'), 'previous-' + name);
    assert.equal(readFileSync(path.join(dest, 'data.json'), 'utf8'), '{"switchCommand":"keep-me"}');
    assert.equal(readFileSync(path.join(vault, 'Note.md'), 'utf8'), '# Do not change this note');
  }
  return { home, pkg, docs, vault, dest, backups, existing, run, unchanged, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
function check(name, fn) { test(name, () => { const f = fixture(); try { fn(f); } finally { f.clean(); } }); }
check('existing iCloud PalmWiki: back up, replace exactly three assets, preserve settings/notes', f => {
  f.existing(); const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const name of names) assert.deepEqual(readFileSync(path.join(f.dest, name)), readFileSync(path.join(f.pkg, 'palmwiki-home-lite', name)));
  const backup = path.join(f.backups, readdirSync(f.backups)[0]);
  for (const name of names) assert.equal(readFileSync(path.join(backup, name), 'utf8'), 'previous-' + name);
  assert.equal(readFileSync(path.join(f.dest, 'data.json'), 'utf8'), '{"switchCommand":"keep-me"}');
  assert.equal(readFileSync(path.join(f.vault, 'Note.md'), 'utf8'), '# Do not change this note');
});
check('same assets: repeated run makes no extra backup', f => {
  f.existing(); assert.equal(f.run().status, 0); const before = readdirSync(f.backups);
  const r = f.run(); assert.equal(r.status, 0); assert.match(r.stdout, /配置済み/); assert.deepEqual(readdirSync(f.backups), before);
});
check('missing iCloud PalmWiki: stop without creating a vault', f => {
  assert.notEqual(f.run().status, 0); assert.equal(existsSync(f.vault), false); assert.equal(existsSync(f.backups), false);
});
check('LocalTest is not silently substituted for the approved PalmWiki', f => {
  mkdirSync(path.join(f.docs, 'PalmWiki_LocalTest/.obsidian'), { recursive: true });
  assert.notEqual(f.run().status, 0); assert.equal(existsSync(f.vault), false);
});
check('bad distribution hash: no backup or mutation', f => {
  f.existing(); writeFileSync(path.join(f.pkg, 'palmwiki-home-lite/main.js'), 'bad');
  assert.notEqual(f.run().status, 0); f.unchanged(); assert.equal(existsSync(f.backups), false);
});
check('backup failure: stop before changing plugin files', f => {
  f.existing(); assert.notEqual(f.run({ STUB_COPY_FAIL: 'backup' }).status, 0); f.unchanged();
});
check('copy failure after first asset: rollback restores all old assets', f => {
  f.existing(); const r = f.run({ STUB_COPY_FAIL: 'install' }); assert.notEqual(r.status, 0); assert.match(r.stdout, /復旧を確認/); f.unchanged();
});
check('running Obsidian: no changes', f => {
  f.existing(); assert.notEqual(f.run({ STUB_PROCESS: '0' }).status, 0); f.unchanged(); assert.equal(existsSync(f.backups), false);
});
check('non-macOS: no changes', f => {
  f.existing(); assert.notEqual(f.run({ STUB_PLATFORM: 'Linux' }).status, 0); f.unchanged();
});
check('linked Vault: stop instead of following it', f => {
  mkdirSync(f.docs, { recursive: true }); const other = path.join(f.home, 'other'); mkdirSync(other); symlinkSync(other, f.vault);
  assert.notEqual(f.run().status, 0); assert.deepEqual(readdirSync(other), []);
});
check('linked plugin asset: stop without changing its target', f => {
  f.existing(); const other = path.join(f.home, 'other.js'); writeFileSync(other, 'untouched'); rmSync(path.join(f.dest, 'main.js')); symlinkSync(other, path.join(f.dest, 'main.js'));
  assert.notEqual(f.run().status, 0); assert.equal(readFileSync(other, 'utf8'), 'untouched'); assert.equal(existsSync(f.backups), false);
});
check('linked backup destination: stop without writes there', f => {
  f.existing(); const other = path.join(f.home, 'other-backup'); mkdirSync(other); symlinkSync(other, f.backups);
  assert.notEqual(f.run().status, 0); f.unchanged(); assert.deepEqual(readdirSync(other), []);
});
