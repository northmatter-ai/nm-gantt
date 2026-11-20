/// <reference lib="webworker" />
import { calculate, type ScheduleInput } from '@northmatter-ai/schedule-engine';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<{ seq: number; input: ScheduleInput }>) => {
  const { seq, input } = e.data;
  try {
    self.postMessage({ seq, result: calculate(input) });
  } catch (err) {
    self.postMessage({ seq, error: err instanceof Error ? err.message : String(err) });
  }
};
