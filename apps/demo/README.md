# Gantt demo

`pnpm dev` from the repo root, then open http://localhost:3600.

`src/mockServer.ts` stands in for the Planning API. It applies command batches all or nothing, rejects stale versions with `VERSION_CONFLICT`, recalculates, and saves baselines.

`e2e/` holds the Playwright suite (`pnpm e2e`). Set `SHOT_DIR=/some/dir` to save screenshots.
