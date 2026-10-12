// AuthorDesk sync store: users, sessions and versioned records in SQLite (node:sqlite, no dependencies).
// Every write is version-checked: a push succeeds only if the client's base version matches the server's,
// so one device can never silently overwrite another device's newer edit.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const TABLES = new Set([
  'projects', 'books', 'parts', 'chapters', 'scenes', 'references', 'plotThreads', 'timelineEvents',
  'boardLanes', 'boardCards', 'notes', 'snapshots', 'dictionary',
]);

const SESSION_DAYS = 30;
const MAX_RECORD_BYTES = 15 * 1024 * 1024;

export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pw_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS records (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tbl TEXT NOT NULL,
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      device TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, tbl, id)
    );
    CREATE INDEX IF NOT EXISTS records_by_version ON records(user_id, version);
    CREATE TABLE IF NOT EXISTS counters (user_id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
  `);

  const q = {
    insertUser: db.prepare('INSERT INTO users (username, pw_hash, created_at) VALUES (?, ?, ?)'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    setPw: db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?'),
    listUsers: db.prepare('SELECT id, username, created_at FROM users ORDER BY id'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at, label) VALUES (?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    getRecord: db.prepare('SELECT * FROM records WHERE user_id = ? AND tbl = ? AND id = ?'),
    upsert: db.prepare(`INSERT INTO records (user_id, tbl, id, project_id, version, rev, deleted, data, device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, tbl, id) DO UPDATE SET project_id = excluded.project_id, version = excluded.version,
        rev = excluded.rev, deleted = excluded.deleted, data = excluded.data, device = excluded.device`),
    since: db.prepare('SELECT * FROM records WHERE user_id = ? AND version > ? ORDER BY version LIMIT ?'),
    counter: db.prepare('SELECT version FROM counters WHERE user_id = ?'),
    setCounter: db.prepare('INSERT INTO counters (user_id, version) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET version = excluded.version'),
    deleteProject: db.prepare('DELETE FROM records WHERE user_id = ? AND project_id = ?'),
    stats: db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(version), 0) AS v FROM records WHERE user_id = ?'),
  };

  const hashPw = (pw) => {
    const salt = randomBytes(16);
    const key = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
  };
  const checkPw = (pw, stored) => {
    const [, saltHex, keyHex] = stored.split('$');
    const key = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    const want = Buffer.from(keyHex, 'hex');
    return key.length === want.length && timingSafeEqual(key, want);
  };
  const sha = (s) => createHash('sha256').update(s).digest('hex');

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const rowToRecord = (r) => ({
    table: r.tbl,
    id: r.id,
    projectId: r.project_id,
    rev: r.rev,
    serverVersion: r.version,
    deleted: !!r.deleted,
    data: r.data ? JSON.parse(r.data) : null,
  });

  return {
    db,
    addUser(username, password) {
      if (!/^[\w.@-]{2,64}$/.test(username)) throw new Error('Username: 2-64 letters, digits, . _ - @');
      if (typeof password !== 'string' || password.length < 10) throw new Error('Use a passphrase of at least 10 characters.');
      q.insertUser.run(username, hashPw(password), new Date().toISOString());
    },
    setPassword(username, password) {
      const u = q.userByName.get(username);
      if (!u) throw new Error('No such user');
      if (password.length < 10) throw new Error('Use a passphrase of at least 10 characters.');
      q.setPw.run(hashPw(password), u.id);
      q.deleteUserSessions.run(u.id);
    },
    listUsers: () => q.listUsers.all(),
    /** Returns a session token (store only in an HttpOnly cookie) or null for bad credentials. */
    login(username, password, label = '') {
      const u = q.userByName.get(String(username ?? ''));
      // Hash anyway so timing does not reveal whether the user exists.
      const ok = u ? checkPw(String(password ?? ''), u.pw_hash) : (hashPw('x'), false);
      if (!ok) return null;
      const token = randomBytes(32).toString('base64url');
      q.insertSession.run(sha(token), u.id, Date.now() + SESSION_DAYS * 86400_000, new Date().toISOString(), String(label).slice(0, 80));
      return token;
    },
    session(token) {
      if (!token) return null;
      const s = q.session.get(sha(token));
      if (!s || s.expires_at < Date.now()) return null;
      return { userId: s.user_id, username: s.username };
    },
    logout(token) {
      if (token) q.deleteSession.run(sha(token));
    },
    logoutEverywhere(userId) {
      q.deleteUserSessions.run(userId);
    },
    purgeExpired() {
      q.purgeSessions.run(Date.now());
    },
    pull(userId, since, limit = 500) {
      const rows = q.since.all(userId, Number(since) || 0, Math.min(Math.max(1, limit), 2000));
      const records = rows.map(rowToRecord);
      const cursor = rows.length ? rows[rows.length - 1].version : Number(since) || 0;
      return { records, cursor: String(cursor), more: rows.length === limit };
    },
    /**
     * Apply pushed changes. Each change: { record: {table,id,projectId,rev,deleted,data}, baseVersion }.
     * baseVersion must equal the server's current version for that record (null = record must not exist yet).
     */
    push(userId, changes, device = '') {
      return tx(() => {
        const accepted = [];
        const rejected = [];
        let version = q.counter.get(userId)?.version ?? 0;
        for (const ch of changes) {
          const r = ch?.record;
          if (!r || !TABLES.has(r.table) || typeof r.id !== 'string' || typeof r.projectId !== 'string' || r.id.length > 64) {
            throw new Error('Malformed change');
          }
          const data = r.deleted ? null : JSON.stringify(r.data ?? null);
          if (data && data.length > MAX_RECORD_BYTES) throw new Error(`Record ${r.table}/${r.id} is too large`);
          const cur = q.getRecord.get(userId, r.table, r.id);
          const base = ch.baseVersion ?? null;
          if ((cur && cur.version !== base) || (!cur && base !== null)) {
            if (cur) {
              rejected.push({ table: r.table, id: r.id, current: rowToRecord(cur) });
              continue;
            }
            // Server lost the record (e.g. project deleted from cloud) — accept as new.
          }
          version += 1;
          q.upsert.run(userId, r.table, r.id, r.projectId, version, Number(r.rev) || 0, r.deleted ? 1 : 0, data, String(device).slice(0, 64));
          accepted.push({ table: r.table, id: r.id, serverVersion: version });
        }
        q.setCounter.run(userId, version);
        return { accepted, rejected };
      });
    },
    /** Remove a project's cloud copy (local copies and exports are unaffected). */
    deleteProject(userId, projectId) {
      return tx(() => {
        const n = q.deleteProject.run(userId, projectId).changes;
        return { deleted: Number(n) };
      });
    },
    stats(userId) {
      const s = q.stats.get(userId);
      return { records: s.n, latestVersion: s.v };
    },
    close() {
      db.close();
    },
  };
}
