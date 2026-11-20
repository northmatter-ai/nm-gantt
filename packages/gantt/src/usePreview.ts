/** Runs the engine in a Web Worker to preview edits; falls back to the main thread. */
import { useCallback, useEffect, useRef } from 'react';
import { calculate, type ScheduleResult } from '@nm/schedule-engine';
import { toScheduleInput, type ScheduleDoc } from '@nm/schedule-commands';

export function defaultWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export function usePreview(createWorker: (() => Worker | null) | undefined, onResult: (r: ScheduleResult, doc: ScheduleDoc) => void) {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const docs = useRef(new Map<number, ScheduleDoc>());
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    const w = (createWorker ?? defaultWorker)();
    workerRef.current = w;
    if (w) {
      w.onmessage = (e: MessageEvent<{ seq: number; result?: ScheduleResult }>) => {
        const doc = docs.current.get(e.data.seq);
        docs.current.delete(e.data.seq);
        // Only the newest request's result is shown.
        if (e.data.seq === seqRef.current && e.data.result && doc) cb.current(e.data.result, doc);
      };
    }
    return () => { w?.terminate(); workerRef.current = null; };
  }, [createWorker]);

  return useCallback((doc: ScheduleDoc) => {
    const seq = ++seqRef.current;
    const w = workerRef.current;
    if (!w) {
      cb.current(calculate(toScheduleInput(doc)), doc);
      return;
    }
    docs.current.clear();
    docs.current.set(seq, doc);
    w.postMessage({ seq, input: toScheduleInput(doc) });
  }, []);
}
