# @northmatter/schedule-engine

Pure CPM engine: `calculate(input): ScheduleResult` and `compare(current, baseline, keyOf, { calendar })`.

Steps:
1. Validate (Tarjan SCC for cycles).
2. Order with Kahn's algorithm and a min-heap on id.
3. Forward pass, including progress and the data date.
4. Backward pass, with constraints and deadlines.
5. Float: total and free.
6. Driving links, critical flag and longest path.
7. ALAP, level of effort, summaries.

Never throws on a bad schedule; it returns `ok: false` with errors. Same input gives the same output, independent of input order. See [DECISIONS.md](../../DECISIONS.md) for every interpretation.
