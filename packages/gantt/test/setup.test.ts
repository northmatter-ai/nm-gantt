import { describe, expect, it } from 'vitest';
import { applyCommands, type ScheduleDoc } from '@northmatter-ai/schedule-commands';
import { defaultTenantCalendar } from '@northmatter-ai/calendar';
import { floorOptions, tradeOptions } from '../src/ActivityEditor.js';
import { setupCommand } from '../src/ProjectSetup.js';

const doc: ScheduleDoc = {
  id: 'v', name: 'p', kind: 'draft', version: 1, projectStart: 0, dataDate: 0, defaultCalendarId: 'std', calendars: [defaultTenantCalendar('std')],
  settings: {}, links: [],
  towers: { TA: 'Tower A', TB: 'Tower B' },
  floors: { F10: 'Floor 10', F2: 'Floor 2', F1: 'Floor 1' },
  templates: [{ id: 'COL', name: 'Columns' }, { id: 'SLAB', name: 'Slab' }],
  activities: [{ id: 'a', stableKey: 'a', code: 'A', name: 'A', sortKey: 'a', type: 'task', duration: 480, constraint: 'ASAP', towerId: 'TA', floorId: 'F2', activityTemplateId: 'X-OLD' }],
};

describe('towers, floors and trades setup', () => {
  it('floors default to natural order; trades include ids activities use but the list lacks', () => {
    expect(floorOptions(doc).map(([, n]) => n)).toEqual(['Floor 1', 'Floor 2', 'Floor 10']);
    expect(floorOptions({ ...doc, floorOrder: ['F10', 'F1', 'F2'] }).map(([id]) => id)).toEqual(['F10', 'F1', 'F2']);
    expect(tradeOptions(doc)).toEqual([['COL', 'Columns'], ['SLAB', 'Slab'], ['X-OLD', 'X-OLD']]);
  });

  it('no change → no command', () => {
    const floors = floorOptions(doc).map(([id, name]) => ({ id, name }));
    const c = setupCommand({ ...doc, floorOrder: floors.map((f) => f.id) }, [{ id: 'TA', name: 'Tower A' }, { id: 'TB', name: 'Tower B' }], floors, [{ id: 'COL', name: 'Columns' }, { id: 'SLAB', name: 'Slab' }]);
    expect(c).toBeNull();
  });

  it('renames, removes, adds and reorders in one command that applies cleanly', () => {
    const c = setupCommand(doc,
      [{ id: 'TA', name: 'Kaveri A' }, { id: 'TC', name: 'Tower C' }],
      [{ id: 'F1', name: 'Floor 1' }, { id: 'F2', name: 'Floor 2' }, { id: 'F3', name: 'Floor 3' }],
      [{ id: 'SLAB', name: 'Slab' }, { id: 'COL', name: 'Columns', short: 'Col' }])!;
    expect(c.kind).toBe('updateLookups');
    const { doc: d } = applyCommands(doc, [c]);
    expect(d.towers).toEqual({ TA: 'Kaveri A', TC: 'Tower C' });
    expect(d.floors).toEqual({ F2: 'Floor 2', F1: 'Floor 1', F3: 'Floor 3' });
    expect(d.floorOrder).toEqual(['F1', 'F2', 'F3']);
    expect(d.templates).toEqual([{ id: 'SLAB', name: 'Slab' }, { id: 'COL', name: 'Columns', short: 'Col' }]);
  });
});
