import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, ['--check', path.join(here, 'main.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, ['--test', path.join(here, 'tests.cjs')], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile(path.join(here, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8'));
const versions = JSON.parse(await readFile(path.join(here, 'versions.json'), 'utf8'));
if (manifest.id !== 'palmwiki-home-lite' || manifest.version !== pkg.version || versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error('Lite metadata mismatch');
}
const out = path.join(here, 'dist', manifest.id);
await mkdir(out, { recursive: true });
// The dependency-free CommonJS source runs directly in Obsidian. No transpilation,
// legacy PalmWiki code, React, npm install, network, or Actions is required.
await copyFile(path.join(here, 'main.cjs'), path.join(out, 'main.js'));
for (const name of ['manifest.json', 'styles.css']) await copyFile(path.join(here, name), path.join(out, name));
let checksums = '';
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const bytes = await readFile(path.join(out, name));
  checksums += `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
}
await writeFile(path.join(here, 'dist', 'SHA256SUMS'), checksums);
await copyFile(path.join(here, 'install-macos.command'), path.join(here, 'dist', 'install-macos.command'));
await copyFile(path.join(here, 'README.md'), path.join(here, 'dist', 'README.md'));
console.log(`\nBuilt ${out}\n${checksums}`);
