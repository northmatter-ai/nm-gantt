/** The user's own projects, kept in localStorage until the Planning service exists. */
export const STORAGE = 'nm-gantt-demo:v1';

export interface ProjectEntry { id: string; name: string; createdAt: number }

const INDEX = `${STORAGE}:projects`;

export const projectSource = (id: string) => `p:${id}`;
export const projectStorageKey = (id: string) => `${STORAGE}:p:${id}`;

export function listProjects(): ProjectEntry[] {
  try { return JSON.parse(localStorage.getItem(INDEX) ?? '[]') as ProjectEntry[]; } catch { return []; }
}

export function saveProjects(list: ProjectEntry[]): void {
  try { localStorage.setItem(INDEX, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function removeProjectData(id: string): void {
  try { localStorage.removeItem(projectStorageKey(id)); } catch { /* ignore */ }
}

export function newProjectId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
