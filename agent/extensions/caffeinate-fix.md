# Caffeinate Extension Leak Fix

## Root Cause
Race condition in `proc.on("exit", () => { proc = null; })` handler in `begin()`.
When old caffeinate exits asynchronously after a new process is spawned,
the old handler overwrites `proc` with null. New process becomes untracked.
On `agent_end`, `stop()` sees `proc === null` and skips kill → leak.

## Pre-Fix Code (buggy)
```javascript
proc = spawn("caffeinate", ["-w", String(process.pid), "-di"], ...);
if (!proc.pid) { proc = null; return; }
proc.on("exit", () => {
  proc = null;  // ← RACE: can null a NEWER proc reference
});
proc.unref();
```

## Post-Fix Code (fixed)
```javascript
proc = spawn("caffeinate", ["-w", String(process.pid), "-di"], ...);
if (!proc.pid) { proc = null; return; }
// Removed proc.on("exit", ...) handler
// killProc() sets proc = null synchronously in stop()
proc.unref();
```

## Why This Fixes It
- `begin()` calls `stop()` → `killProc()` → sets `proc = null` BEFORE spawning new process
- No stale exit handlers can overwrite the new proc reference
- `agent_end` → `stop()` → always kills the current tracked process

## Evidence
- File: `~/.pi/agent/extensions/caffeinate.ts`
- mtime shows recent edit
- Leaked processes killed: 30067, 31817, 36169 (old session 55714), 41388
