// Type declarations for store.js (used by the app's tests and editors).
export interface ServerRecord {
  table: string;
  id: string;
  projectId: string;
  rev: number;
  serverVersion: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}
export interface Change {
  record: { table: string; id: string; projectId: string; rev: number; deleted: boolean; data: unknown };
  baseVersion: number | null;
}
export interface Store {
  addUser(username: string, password: string): void;
  setPassword(username: string, password: string): void;
  listUsers(): { id: number; username: string; created_at: string }[];
  login(username: string, password: string, label?: string): string | null;
  session(token: string | null | undefined): { userId: number; username: string } | null;
  logout(token: string | null | undefined): void;
  logoutEverywhere(userId: number): void;
  purgeExpired(): void;
  pull(userId: number, since: string, limit?: number): { records: ServerRecord[]; cursor: string; more: boolean };
  push(
    userId: number,
    changes: Change[],
    device?: string,
  ): { accepted: { table: string; id: string; serverVersion: number }[]; rejected: { table: string; id: string; current: ServerRecord }[] };
  deleteProject(userId: number, projectId: string): { deleted: number };
  stats(userId: number): { records: number; latestVersion: number };
  close(): void;
}
export const TABLES: Set<string>;
export function openStore(path?: string): Store;
