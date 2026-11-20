// Builds the package in the current directory into dist/ for npm.
// Run via `pnpm build` inside a package (or `pnpm build:packages` at the root).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = process.cwd();
const dist = join(pkgDir, 'dist');

rmSync(dist, { recursive: true, force: true });
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.build.json'], { stdio: 'inherit', cwd: pkgDir });

// Stylesheets ship as-is.
for (const f of readdirSync(join(pkgDir, 'src'))) {
  if (f.endsWith('.css')) copyFileSync(join(pkgDir, 'src', f), join(dist, f));
}

// Worker URLs point at the .ts source for Vite in development; the published files must point at .js.
// `new URL('./x.worker.js', import.meta.url)` is understood by Vite, webpack 5, Rollup and Parcel.
for (const f of readdirSync(dist)) {
  if (!f.endsWith('.js')) continue;
  const file = join(dist, f);
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/new URL\((['"])(\.\/[^'"]+\.worker)\.ts\1/g, 'new URL($1$2.js$1');
  if (out !== src) writeFileSync(file, out);
}

// npm only picks up a LICENSE that sits in the package folder.
copyFileSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'));
if (!existsSync(join(dist, 'index.js'))) throw new Error('build produced no dist/index.js');
