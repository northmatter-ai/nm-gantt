/**
 * In-browser stand-in for the Planning service (spec: Server API). It applies command batches
 * in order, all or nothing, checks the base version (409 VERSION_CONFLICT), recalculates with the
 * engine and returns the authoritative result — the same contract the real service will keep.
 */
import { calculate, type ScheduleResult } from '@nm/schedule-engine';
import { applyCommands, CommandError, makeBaseline, toScheduleInput, type BaselineView, type Command, type ScheduleDoc } from '@nm/schedule-commands';
import type { CommandResult } from '@nm/gantt';

export interface ServerState {
  doc: ScheduleDoc;
  results: ScheduleResult;
  baselines: BaselineView[];
}

const LATENCY_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockPlanningServer {
  private state: ServerState;
  private listeners = new Set<(s: ServerState) => void>();
  private applied = new Set<string>();

  constructor(doc: ScheduleDoc, baselines: BaselineView[] = [], private readonly storageKey?: string) {
    this.state = { doc, results: calculate(toScheduleInput(doc)), baselines };
  }

  static restore(storageKey: string): MockPlanningServer | null {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const { doc, baselines } = JSON.parse(raw) as { doc: ScheduleDoc; baselines: BaselineView[] };
      return new MockPlanningServer(doc, baselines, storageKey);
    } catch {
      return null;
    }
  }

  get current(): ServerState { return this.state; }

  subscribe(fn: (s: ServerState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private publish(next: ServerState) {
    this.state = next;
    if (this.storageKey) {
      try { localStorage.setItem(this.storageKey, JSON.stringify({ doc: next.doc, baselines: next.baselines })); } catch { /* quota or private mode */ }
    }
    for (const l of this.listeners) l(next);
  }

  /** POST /api/schedule-versions/{id}/commands */
  async commands(cmds: Command[], baseVersion = this.state.doc.version): Promise<CommandResult> {
    await sleep(LATENCY_MS);
    if (baseVersion !== this.state.doc.version) {
      return { ok: false, code: 'VERSION_CONFLICT', error: `Version conflict: you edited version ${baseVersion}, the server has ${this.state.doc.version}` };
    }
    const fresh = cmds.filter((c) => !this.applied.has(c.id)); // idempotent by command id
    try {
      const { doc } = applyCommands(this.state.doc, fresh);
      const results = calculate(toScheduleInput(doc));
      for (const c of fresh) this.applied.add(c.id);
      this.publish({ ...this.state, doc, results });
      return { ok: true, doc, results };
    } catch (e) {
      if (e instanceof CommandError) return { ok: false, error: e.message, code: e.code, ...(e.commandId ? { commandId: e.commandId } : {}) };
      throw e;
    }
  }

  /** POST /api/schedule-versions/{id}/baseline */
  saveBaseline(label: string): BaselineView {
    const b = makeBaseline(`bl-${this.state.baselines.length + 1}`, label, this.state.doc, this.state.results);
    this.publish({ ...this.state, baselines: [...this.state.baselines, b] });
    return b;
  }

  /** Changes that are not edit commands (data date, import). */
  replace(doc: ScheduleDoc) {
    this.publish({ ...this.state, doc: { ...doc, version: this.state.doc.version + 1 }, results: calculate(toScheduleInput(doc)) });
  }
}
