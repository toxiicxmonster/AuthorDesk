# ADR 0002 — Private sync via a self-hosted, authenticated server

**Status:** accepted (2026-10-11)

## Context

Work must move between PC and phone without exposing manuscripts publicly, without long-lived tokens in browser storage, without “last write wins”, and without locking the author into one vendor. The original specification listed a GitHub-repo-as-storage option but requires server-side OAuth for it.

## Decision

- Ship a **small self-hostable sync server** (`server/`, Node built-ins only, SQLite) that also serves the app. Users are created by the owner via CLI.
- **Auth:** username + passphrase → random session token stored server-side as a SHA-256 hash and sent to the browser only as an **HttpOnly, SameSite=Strict** cookie. All API calls require an `X-AuthorDesk` header (CSRF defence; CORS never enabled). HTTPS is required for anything but localhost.
- **Same origin everywhere:** the phone uses the app served by the sync server; the PC launcher proxies `/api/*` to it (configured in `sync-server.txt`), so the PC keeps its local data origin and the cookie remains HttpOnly.
- **Protocol:** per-record pull (since a server cursor) and push with `baseVersion`; the server rejects pushes based on stale versions. Ordering uses server-assigned versions, never device clocks.
- **Merging on the client:** three-way merge against the last agreed base. Independent fields merge; prose conflicts keep the local text, store the other version as a snapshot and a conflict entry, and let the author choose (mine / theirs / keep both). Edits beat deletes. Remote overwrites of prose snapshot the local text first.
- Snapshots and per-device preferences do not sync.

## Alternatives considered

- **Managed BaaS (Firebase/Supabase):** quick, but vendor lock-in, accounts/billing, and manuscripts on a third party by default. The sync engine’s transport interface allows adding one later.
- **Private GitHub repo as storage:** needs a server-side OAuth broker anyway, has rate limits, and commits private prose into git history. Not chosen; archives remain the GitHub-independent export path.
- **CRDT (Yjs/Automerge):** stronger merging of concurrent prose, but larger storage/complexity. Revisit if simultaneous editing becomes common; the conflict UI covers the single-author case.

## Consequences

- The owner must host the server with HTTPS (Tailscale is the easiest private option). Documented in `docs/sync-server.md`.
- Deleting a project locally doesn’t delete the cloud copy (explicit “Delete cloud copy” instead), which errs on the side of not losing work.
