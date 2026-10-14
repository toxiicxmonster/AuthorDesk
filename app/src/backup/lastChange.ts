/** When each book was last changed in this window (in memory), so automatic backups know what's new. */
const lastChange = new Map<string, number>();

export function noteChange(projectId: string, at = Date.now()) {
  lastChange.set(projectId, at);
}

export function lastChangeAt(projectId: string): number {
  return lastChange.get(projectId) ?? 0;
}

/** For tests. */
export function resetChanges() {
  lastChange.clear();
}
