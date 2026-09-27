export { TasteQueryDock } from "./TasteQueryDock";
export { WorkspaceQueryDock } from "./WorkspaceQueryDock";
/*
 * `LabQueryDock` is deliberately not re-exported here.
 *
 * `AppShell` imports this barrel for `WorkspaceQueryDock`, which puts every module the
 * barrel names into the client graph of every workspace page — including a composer only
 * `/focus/[itemId]` renders. The Lab imports it by path.
 */
