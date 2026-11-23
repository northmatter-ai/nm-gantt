#!/usr/bin/env node
/**
 * Licence gate (spec: "Rules for the agent → Licences").
 * Walks every installed package in node_modules/.pnpm and fails unless its licence is
 * MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC (an SPDX "OR" expression passes if any
 * branch is allowed). GPL, LGPL, AGPL, SSPL and "Commons Clause" always fail.
 *
 * Exceptions are listed in scripts/license-exceptions.json with a reason, and only for
 * build-time tools that never ship in a bundle.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']);
const FORBIDDEN = /\b(A?GPL|LGPL|SSPL|Commons Clause)/i;
const root = new URL('..', import.meta.url).pathname;
const store = join(root, 'node_modules', '.pnpm');
const exceptionsFile = join(root, 'scripts', 'license-exceptions.json');
const exceptions = existsSync(exceptionsFile) ? JSON.parse(readFileSync(exceptionsFile, 'utf8')) : {};

function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function allowed(expr) {
  if (FORBIDDEN.test(expr)) return false;
  const clean = expr.replace(/[()]/g, ' ').trim();
  if (/\sAND\s/.test(clean)) return clean.split(/\s+AND\s+/).every((p) => allowed(p));
  return clean.split(/\s+OR\s+/).some((p) => ALLOWED.has(p.trim()));
}

if (!existsSync(store)) {
  console.error('node_modules/.pnpm not found — run pnpm install first');
  process.exit(2);
}

const seen = new Map();
for (const entry of readdirSync(store)) {
  const nm = join(store, entry, 'node_modules');
  if (!existsSync(nm)) continue;
  for (const scopeOrName of readdirSync(nm)) {
    const dirs = scopeOrName.startsWith('@') ? readdirSync(join(nm, scopeOrName)).map((n) => join(scopeOrName, n)) : [scopeOrName];
    for (const d of dirs) {
      const file = join(nm, d, 'package.json');
      if (!existsSync(file)) continue;
      let pkg;
      try { pkg = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
      if (!pkg.name || !pkg.version || pkg.name.startsWith('@northmatter/')) continue;
      seen.set(`${pkg.name}@${pkg.version}`, licenceOf(pkg));
    }
  }
}

const bad = [];
for (const [id, lic] of [...seen].sort()) {
  const name = id.slice(0, id.lastIndexOf('@'));
  if (allowed(lic)) continue;
  if (exceptions[name] && !FORBIDDEN.test(lic)) { console.log(`exception  ${id}  ${lic}  — ${exceptions[name]}`); continue; }
  bad.push(`${id}  ${lic}`);
}

console.log(`checked ${seen.size} packages`);
if (bad.length) {
  console.error(`\n${bad.length} package(s) with a licence outside MIT / Apache-2.0 / BSD / ISC:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('licence check passed');
