import type { Minutes } from '@nm/calendar';
import type { Command, ScheduleDoc, ScheduleVersionView } from '@nm/schedule-commands';
import type { ScheduleResult } from '@nm/schedule-engine';

export type Zoom = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type GroupBy = 'none' | 'tower' | 'floor' | 'wbs';
export type Locale = 'en' | 'hi';

export type ColumnKey =
  | 'wbs' | 'code' | 'name' | 'duration' | 'start' | 'finish' | 'totalFloat' | 'freeFloat'
  | 'predecessors' | 'percent' | 'constraint' | 'calendar' | 'tower' | 'floor' | 'status';

export interface ColumnDef {
  key: ColumnKey;
  width: number;
  title?: string;
}

export interface FilterSpec {
  criticalOnly?: boolean;
  longestPath?: boolean;
  negativeFloat?: boolean;
  towerId?: string;
  floorId?: string;
  workFrontId?: string;
  status?: ('not_started' | 'in_progress' | 'complete')[];
  text?: string;
  window?: { from: Minutes; to: Minutes };
}

export type CommandResult =
  | { ok: true; doc: ScheduleDoc; results: ScheduleResult }
  | { ok: false; error: string; commandId?: string; code?: string };

export interface GanttProps {
  version: ScheduleVersionView;
  mode?: 'edit' | 'view' | 'print';
  columns?: ColumnDef[];
  zoom?: Zoom;
  onZoomChange?: (z: Zoom) => void;
  showBaselineId?: string;
  showFloat?: boolean;
  filter?: FilterSpec;
  groupBy?: GroupBy;
  /** Edit mode only. Resolves with the server's recalculated version. */
  onCommands?: (cmds: Command[]) => Promise<CommandResult>;
  onSelect?: (ids: string[]) => void;
  compact?: boolean;
  locale?: Locale;
  /** "Today" line; defaults to the current time. */
  today?: Minutes;
  /** Remembers the splitter position per user. */
  userKey?: string;
  /** Override the engine worker (tests, SSR). Return null to calculate on the main thread. */
  createWorker?: () => Worker | null;
  /** Height of the component; defaults to filling its parent. */
  height?: number | string;
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'wbs', width: 76 },
  { key: 'name', width: 260 },
  { key: 'duration', width: 70 },
  { key: 'start', width: 128 },
  { key: 'finish', width: 128 },
  { key: 'predecessors', width: 120 },
  { key: 'totalFloat', width: 64 },
];
