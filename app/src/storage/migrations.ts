import { db } from './db';
import { SCHEMA_VERSION } from '../domain/schema';

/**
 * Data migrations. Each step upgrades records persisted at version N to N+1.
 * IndexedDB index changes go in AuthorDb's Dexie versions; record-shape changes go here
 * and are also applied to imported archives (see importExport/archive.ts).
 */
export type RecordMigration = (table: string, rec: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Record<number, RecordMigration> = {
  // 1 -> 2 example: 2: (table, rec) => (table === 'scenes' ? { ...rec, newField: '' } : rec),
};

export function migrateRecord(table: string, rec: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let out = rec;
  for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (m) out = m(table, out);
  }
  return out;
}

export async function runMigrations(): Promise<void> {
  const row = await db.settings.get('schemaVersion');
  const current = typeof row?.value === 'number' ? row.value : SCHEMA_VERSION;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `This data was written by a newer version of AuthorDesk (schema ${current}). Update the app before editing, so nothing is lost.`,
    );
  }
  if (current < SCHEMA_VERSION) {
    const tables = db.tables.filter((t) => !['settings', 'changes', 'ignored'].includes(t.name));
    await db.transaction('rw', tables, async () => {
      for (const t of tables) {
        await t.toCollection().modify((rec: Record<string, unknown>) => {
          Object.assign(rec, migrateRecord(t.name, rec, current));
        });
      }
    });
  }
  await db.settings.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
}
