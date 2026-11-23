# Changelog

All `@northmatter/*` packages share one version. See [RELEASING.md](RELEASING.md).

## 0.1.1 — 2026-11-23

- Every package's `exports` now has a `default` condition beside `import`. In 0.1.0 a CommonJS app (NestJS, Jest) couldn't load the packages: `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Node 22+ loads the ESM build through `require()`, so no CommonJS build is needed. `pnpm check:packages` now fails if a package loses that condition.

## 0.1.0 — 2026-11-23

First public release, MIT-licensed. It's a preview: the engine hasn't been checked against real MS Project files to the minute yet (README → "Status against the build plan").

- `@northmatter/calendar`: working-time calendars.
- `@northmatter/schedule-engine`: CPM engine.
- `@northmatter/schedule-commands`: document model and undoable edit commands.
- `@northmatter/schedule-io`: MSPDI and Excel import/export.
- `@northmatter/gantt`: React Gantt, phone view.
- `@northmatter/construction-views`: tower × floor grid, line of balance, look-ahead.
