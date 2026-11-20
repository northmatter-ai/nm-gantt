// Sets one version on all published packages (they always release together).
//   pnpm set-version 0.2.0        pnpm set-version 0.2.0-beta.1
// Internal dependencies stay `workspace:*`; `pnpm publish` replaces them with this exact version.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: pnpm set-version <semver>, e.g. 0.2.0 or 0.2.0-beta.1');
  process.exit(1);
}
const root = join(import.meta.dirname, '..');
for (const dir of readdirSync(join(root, 'packages'))) {
  const f = join(root, 'packages', dir, 'package.json');
  const raw = readFileSync(f, 'utf8');
  const pkg = JSON.parse(raw);
  console.log(`${pkg.name}  ${pkg.version} → ${version}`);
  writeFileSync(f, raw.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
}
console.log(`\nNext: update CHANGELOG.md, commit, then  git tag v${version} && git push origin main v${version}`);
