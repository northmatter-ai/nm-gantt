// Packs every publishable package the way `pnpm publish` would and checks the tarball:
// - no `workspace:` ranges left, no `private`, licence MIT and LICENSE file present;
// - every `exports` / `main` / `types` target exists in the tarball;
// - no test files, no .ts worker URL left in dist.
// Run after `pnpm build:packages` (or use `pnpm check:packages`, which builds first).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'nm-pack-'));
let failed = 0;
const fail = (pkg, msg) => { failed++; console.error(`✗ ${pkg}: ${msg}`); };

for (const dir of readdirSync(join(root, 'packages'))) {
  const cwd = join(root, 'packages', dir);
  const tgz = execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd, encoding: 'utf8' }).trim().split('\n').pop();
  const listing = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.replace(/^package\//, ''));
  const files = new Set(listing);
  const pkg = JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
  const name = pkg.name;

  if (pkg.private) fail(name, 'is private');
  if (pkg.license !== 'MIT') fail(name, `licence is ${pkg.license}`);
  if (!files.has('LICENSE')) fail(name, 'LICENSE missing');
  if (!files.has('README.md')) fail(name, 'README.md missing');
  for (const k of ['dependencies', 'peerDependencies']) {
    for (const [d, v] of Object.entries(pkg[k] ?? {})) if (String(v).startsWith('workspace:')) fail(name, `${d}@${v} not rewritten`);
  }
  const targets = [pkg.main, pkg.types];
  const walk = (v) => (typeof v === 'string' ? targets.push(v) : v && Object.values(v).forEach(walk));
  walk(pkg.exports);
  for (const t of targets.filter(Boolean)) {
    if (!t.startsWith('./dist/')) fail(name, `export target ${t} is not in dist`);
    if (!files.has(t.replace(/^\.\//, ''))) fail(name, `export target ${t} missing from tarball`);
  }
  for (const f of listing) {
    if (/\.test\.|(^|\/)test\//.test(f)) fail(name, `test file shipped: ${f}`);
    if (f.startsWith('dist/') && f.endsWith('.js') && /new URL\(['"][^'"]+\.ts['"]/.test(execFileSync('tar', ['-xzOf', tgz, `package/${f}`], { encoding: 'utf8' }))) {
      fail(name, `${f} still points a worker at a .ts file`);
    }
  }
  const kb = Math.round(readFileSync(tgz).length / 1024);
  console.log(`✓ ${name}@${pkg.version}  ${listing.length} files, ${kb} kB`);
}

rmSync(out, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} problem(s)`); process.exit(1); }
console.log('\nAll packages ready to publish.');
