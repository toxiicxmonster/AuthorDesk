# ADR 0001 — Local-first PWA with a Windows launcher

**Status:** accepted (2026-10-11)

## Context

The author needs a focused writing app on a Windows PC and an Android phone, usable offline, with private data and portable backups. They want an `.exe` to launch from a desktop shortcut.

## Decision

- Build a React + TypeScript + Vite **PWA**; store the working copy in **IndexedDB** (Dexie) on each device.
- Editor: **TipTap/ProseMirror** (structured documents, positions for suggestions, undo history).
- Validation: **zod** schemas shared by storage and import.
- Desktop launch: a tiny **C# launcher** compiled with the .NET Framework compiler included in Windows (no SDK or runtime install). It serves `app/dist` on `http://localhost:47820` (loopback only) and opens it in an Edge/Chrome **app window with a dedicated profile**, so the data location is stable and isolated from everyday browsing. The fixed port matters because browser storage is per origin.

## Alternatives considered

- **Electron/Tauri:** heavier toolchains and installers; the PWA already covers the phone. Revisit if native file access becomes essential.
- **Packaging Node into an exe (pkg/SEA):** larger binary, still needs a browser; the C# launcher is ~25 KB.
- **GitHub Pages hosting:** rejected for data — public static hosting is not a privacy mechanism.

## Consequences

- Data is tied to the launcher’s browser profile + origin; backups and sync are the way to move it.
- No server is required for single-device use.
