# Releasing to npm

The six packages in `packages/` are published to npm as public MIT packages under the **`@northmatter-ai`** scope. They always share one version number and are released together. `apps/demo` and the repo root are private and are never published.

| Package | Depends on |
|---|---|
| `@northmatter-ai/calendar` | — |
| `@northmatter-ai/schedule-engine` | calendar |
| `@northmatter-ai/schedule-commands` | calendar, schedule-engine |
| `@northmatter-ai/schedule-io` | calendar, schedule-engine, schedule-commands |
| `@northmatter-ai/gantt` | calendar, schedule-engine, schedule-commands |
| `@northmatter-ai/construction-views` | the four above, except schedule-io |

## How packaging works

- **In the repo**, `exports` points at `src/*.ts`, so Vite, Vitest and `tsc` use the source directly. You don't need a build to develop.
- **In the published package**, `publishConfig.exports` replaces that with `dist/*.js` + `dist/*.d.ts`. pnpm applies this at pack time, and also turns `workspace:*` into the exact version.
- `pnpm build:packages` runs [scripts/build-package.mjs](scripts/build-package.mjs) in each package, in dependency order. It:
  - compiles with `tsc` ([tsconfig.build.json](tsconfig.build.json)), with no bundler;
  - copies the `.css` files;
  - points the engine worker URL at `engine.worker.js`;
  - copies `LICENSE`.
- `pnpm check:packages` builds, then packs every package and checks the tarball ([scripts/check-packages.mjs](scripts/check-packages.mjs)):
  - no `workspace:` ranges left;
  - every export target is present;
  - LICENSE and README are included;
  - no tests are shipped;
  - no `.ts` worker URL is left.
- **Always publish with `pnpm`, never `npm publish`.** npm doesn't rewrite `workspace:*` or apply `publishConfig.exports`.

## One-time setup

1. **npm account.** Sign up at npmjs.com, turn on 2FA (Account → Two-Factor Authentication, "Authorization and writes"), then run `npm login` on your machine. `npm whoami` should print your username.
2. **npm org.** On npmjs.com: avatar → *Add Organization* → name **`northmatter-ai`** → *Unlimited public packages* (free). Invite other maintainers under *Members*.
3. **First publish (by hand, from your machine).** npm trusted publishing can only be set up for a package that already exists, so the first release goes from a laptop:
   ```bash
   git checkout master && git pull
   pnpm install
   pnpm release:dry                 # builds, checks tarballs, dry-run publish
   pnpm release                     # full CI, then publishes all six (asks for your 2FA code)
   git tag v0.1.0 && git push origin v0.1.0
   ```
   Check the result: `npm view @northmatter-ai/gantt`, and https://www.npmjs.com/package/@northmatter-ai/gantt.
4. **Trusted publishing (for every release after that).** For **each of the six packages** on npmjs.com, go to *Settings → Trusted publishing → GitHub Actions* and enter:
   - Organization or user: `northmatter-ai`
   - Repository: `nm-gantt`
   - Workflow filename: `release.yml`
   - Environment: leave empty

   Then [.github/workflows/release.yml](.github/workflows/release.yml) can publish with provenance and no stored token. Optional: under *Settings → Publishing access*, choose "Require two-factor authentication and disallow tokens".

## Every release after the first

```bash
git checkout master && git pull
pnpm set-version 0.2.0          # bumps all six packages
# add a "## 0.2.0" section to CHANGELOG.md
pnpm install                    # refreshes the lockfile
pnpm release:dry                # optional local check
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin master v0.2.0     # the tag starts the Release workflow
```

The workflow:
- checks that the tag matches the package versions;
- runs the whole CI (typecheck, tests, licences, e2e) and `check:packages`;
- publishes all six with `--provenance`.

**Pre-releases:** `pnpm set-version 0.2.0-beta.1` and tag `v0.2.0-beta.1`. Anything with a `-` goes to the `next` dist-tag, so `npm install @northmatter-ai/gantt` still gets the last stable version. Users opt in with `@next`.

## Versioning rules

We follow semver. Under 1.0, a minor bump (0.x.0) may break things and a patch bump (0.0.x) may not. Things that count as breaking:
- removing or renaming an export or prop;
- changing the `ScheduleDoc` shape;
- changing the `percentComplete` scale;
- changing engine results for the same input, unless it's a bug fix against MS Project.

## If something goes wrong

- **A bad version was published:** `npm deprecate @northmatter-ai/gantt@0.2.0 "broken worker URL, use 0.2.1"`, then release a fix. `npm unpublish` only works within 72 hours, and a version number can never be reused, so prefer deprecating.
- **Publish failed halfway:** run the same `pnpm release` or workflow again. pnpm skips versions that are already on the registry.
- **`E403` / `E404` on publish:** you aren't a member of the `northmatter-ai` org, or (in CI) the trusted publisher entry doesn't match the repo or workflow name exactly.
