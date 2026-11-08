#!/usr/bin/env node
// Every installed npm package must carry an OSI-approved licence (run after `pnpm install`).
// Reads the pnpm virtual store, so it covers every package of every workspace, dev tools included.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'OFL-1.1',
  'CC0-1.0',
  'Unlicense',
  '0BSD',
  'Zlib',
  'BSL-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
]);
// LGPL, GPL and AGPL are OSI licences too ("-only", "-or-later" and "+" variants included).
const COPYLEFT = /^(?:A|L)?GPL-\d(?:\.\d)?(?:-only|-or-later|\+)?$/;

// Packages whose licence is not OSI but is not software either. Review each entry before adding.
const EXCEPTIONS = new Map([
  // Browser support data (not code), CC-BY-4.0, pulled in by browserslist.
  ['caniuse-lite', 'CC-BY-4.0'],
]);

export function allowed(licence) {
  if (!licence) return false;
  // "(MIT OR Apache-2.0)": one choice is enough. "AND": every part must be allowed.
  const text = String(licence).replace(/[()]/g, '');
  const ok = (part) => {
    const id = part.trim().replace(/\s+WITH\s+.+$/i, '');
    return ALLOWED.has(id) || COPYLEFT.test(id);
  };
  return text.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every(ok));
}

function licenceOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (Array.isArray(l)) return l.map((x) => x?.type ?? x).join(' OR ');
  return typeof l === 'object' && l ? l.type : l;
}

export function scan(storeDir) {
  const bad = [];
  const check = (dir, name) => {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) return;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const licence = licenceOf(pkg);
    if (allowed(licence) || EXCEPTIONS.get(pkg.name ?? name) === licence) return;
    bad.push(`${pkg.name ?? name}@${pkg.version}: ${licence ?? 'no licence field'}`);
  };
  for (const entry of readdirSync(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    // .pnpm/<name>@<version>/node_modules/<name>: the package itself is a real directory, its
    // dependencies next to it are symlinks to other store entries (skipped here, checked there).
    const modules = join(storeDir, entry.name, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const sub of readdirSync(modules, { withFileTypes: true })) {
      if (sub.isSymbolicLink() || !sub.isDirectory()) continue;
      if (sub.name.startsWith('@')) {
        for (const scoped of readdirSync(join(modules, sub.name), { withFileTypes: true })) {
          if (!scoped.isSymbolicLink() && scoped.isDirectory()) {
            check(join(modules, sub.name, scoped.name), `${sub.name}/${scoped.name}`);
          }
        }
      } else check(join(modules, sub.name), sub.name);
    }
  }
  return [...new Set(bad)].sort();
}

const store = new URL('../node_modules/.pnpm/', import.meta.url).pathname;
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (!existsSync(store)) {
    console.error('node_modules/.pnpm not found: run `pnpm install` first');
    process.exit(2);
  }
  const bad = scan(store);
  if (bad.length) {
    console.error('Packages without an OSI-approved licence:');
    for (const line of bad) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log('licences ok');
}
