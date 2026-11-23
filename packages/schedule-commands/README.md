# @northmatter/schedule-commands

The schedule version document (`ScheduleDoc`), conversion to engine input (`toScheduleInput`), and the 12 edit commands from the spec:

`addActivity`, `updateActivity`, `deleteActivity`, `moveActivity`, `indent`, `outdent`, `addLink`, `updateLink`, `deleteLink`, `setConstraint`, `setCalendar`, `setProgress`

`applyCommands(doc, cmds)` applies a batch in order, all or nothing, and returns the inverse commands for undo. The Planning service should use this same function so the client and server agree.

Also here: fractional sort keys (`keyBetween`, `evenKeys`), and text forms for durations (`5d`, `3w`, `16h`) and predecessors (`12FS+2d; 15SS`).
