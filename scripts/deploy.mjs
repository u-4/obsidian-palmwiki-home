// Copies main.js, manifest.json and styles.css into the owner's PalmWiki vault.
// The installed files are backed up outside the vault first; plugin settings
// (data.json), enablement and hotkeys are left alone.
// Override the vault with PALMWIKI_VAULT=/path/to/vault.
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vault = process.env.PALMWIKI_VAULT
  ?? path.join(os.homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents/PalmWiki');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const target = path.join(vault, '.obsidian/plugins', manifest.id);
const files = ['main.js', 'manifest.json', 'styles.css'];

const exists = async p => stat(p).then(() => true, () => false);
const sha256 = async p => createHash('sha256').update(await readFile(p)).digest('hex');

if (!await exists(path.join(vault, '.obsidian'))) {
  throw new Error(`Vault not found: ${vault}`);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const backup = path.join(os.homedir(), 'Library/Application Support/ObsidianOps/plugin-backups', manifest.id, stamp);
let backedUp = 0;
for (const name of files) {
  if (!await exists(path.join(target, name))) continue;
  await mkdir(backup, { recursive: true });
  await copyFile(path.join(target, name), path.join(backup, name));
  backedUp += 1;
}

await mkdir(target, { recursive: true });
for (const name of files) {
  await copyFile(path.join(root, name), path.join(target, name));
  if (await sha256(path.join(root, name)) !== await sha256(path.join(target, name))) {
    throw new Error(`Checksum mismatch after copying ${name}`);
  }
}

console.log(`Deployed ${manifest.name} ${manifest.version} to ${target}`);
console.log(backedUp ? `Previous files backed up to ${backup}` : 'No previous files to back up.');
