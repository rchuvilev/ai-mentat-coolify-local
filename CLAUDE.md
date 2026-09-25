# CLAUDE.md — Hexstack Mentat Coolify

Electron desktop app that runs [Coolify](https://coolify.io) locally inside a
bundled Lima VM, with an embedded terminal and a Cloudflare tunnel for public
access. No Docker Desktop required.

## Run and test

```sh
npm install
npm run gui                  # bundle main process with esbuild, then launch
npm test                     # 20 unit tests, no deps, no Electron, no display
```

## Architecture

| Layer | File | Notes |
|---|---|---|
| Main process | `electron-main.js` | 33 IPC handlers, Lima/Coolify/tunnel supervision |
| Preload bridge | `preload.js` | contextIsolation on, explicit allowlist |
| UI | `app.html` + `app.css` | single page |
| Terminal backend | `pty-helper.py` | PTY behind the embedded xterm.js |
| **Pure logic** | **`lib/status.js`, `lib/domain.js`** | **the only unit-testable code** |
| Lima fetch | `scripts/download-lima.js` | pulls the bundled limactl |
| Build | `shared/*.js` | esbuild bundling, auto-update, publish/release |

### Why `lib/` exists

`electron-main.js` cannot be loaded outside Electron — `require('electron')`
throws under plain node — and it exports nothing, so anything decided inside it
has **zero test coverage**.

Lima resolution, PATH construction and VM-status parsing used to live in
`lib/lima.js` and `lib/failsafe.js`; both moved into the SDK
(`sdk/logic/lima.js`, `sdk/utils/failsafe.js`) and are covered by its suite.
What stayed behind, and was uncovered until 2026-09-25, is this app's own
decision logic:

- **`lib/status.js`** — the tri-state merge behind `computeStatus()`. Probe
  results are true / false / **null**, where null means "could not ask". Every
  rule here has been wrong at least once, always the same way: null read as
  "no", so an installed, running Coolify reported as absent.
- **`lib/domain.js`** — the hostname guard. Whatever survives `requireHost()`
  is interpolated into `sudo sed` and `sudo tee` inside the VM, so it is a
  trust boundary, not a tidy-up. It is an allowlist: anything that is not a
  dotted hostname is rejected rather than escaped.

**Rule: new platform-conditional or parsing logic goes in `lib/` with a test.**

## Design decisions worth preserving

**Lima resolution order: bundled → PATH → Homebrew locations.** The bundled
binary wins so behaviour does not change based on what the user happens to have
installed. The Homebrew fallbacks exist because a GUI app launched from Finder
inherits a launchd PATH *without* `/opt/homebrew/bin` — a working
`brew install lima` was reported as "not installed" for anyone who had not
started the app from a terminal.

**A present-but-unrunnable binary must not abort the search.** It is as useless
as a missing one; the search continues to the next candidate.

**`limactl list --json` is JSONL** — one object per line, not a JSON array.
A single `JSON.parse` works on a one-VM machine and fails on every multi-VM
one, which is exactly the case a clean-machine test never reaches. A malformed
line is skipped, not fatal, but the skip is *recorded*.

**VM status is a string, not a boolean.** "Stopped", "Broken" and "Absent" need
different UI and different remedies. A VM entry with no status reports
`Unknown`, never `Running` — defaulting to Running would make the app try to
use a dead VM.

**`limaListVms()` returns null for "could not ask"**, distinct from `[]` for
"no VMs". Callers depend on that tri-state.

**The missing-Lima error is actionable.** It names both remedies
(`npm run download:lima`, `brew install lima`) because either genuinely fixes
it, and which is right depends on whether the user wants the app-local copy.

## Error handling convention — fail-safe, never silent

`lib/failsafe.js`. The main process had **21 bare `catch {}` blocks**.
Continuing after a failure is usually correct here — a missing optional binary
must not take down the window — but a failure that leaves no trace is
undiagnosable.

```js
const { quiet, quietAsync, attempt, attemptAsync } = require('./lib/failsafe');

const out = quiet('lima.list', () => execSync(cmd).toString(), null);
attempt('settings.saveStatusCache', () => saveSettings(s));
```

Every suppressed error gets a stable operation label, message, optional
context, and a bounded 200-entry buffer readable via `recentFailures()`.
`quietAsync` never rejects — an unhandled rejection in the main process can
kill the app.

**Rule: do not write `catch {}` for anything whose failure a user could
notice.** The `op` label must be a stable literal, not a template string — it
is what you grep for.

Applied so far to the three that hid real problems:
- `settings.saveStatusCache` — losing it means the next launch shows a wall of
  "unknown" instead of last known good state.
- `settings.saveAppliedDomain` — the domain was already applied inside the VM;
  failing to persist it makes the UI forget a change that really happened.
- `cloudflared.parseConfig` — a parse failure reported "no hostnames
  configured" for a perfectly good tunnel.

16 `catch {}` remain, all process-kill / stream-write calls where failure
genuinely does not matter (killing an already-dead process, writing to a closed
log stream).

## Gotchas

- `main` points at `electron-main.bundle.js`, generated by esbuild before every
  run for packaging. **Edit `electron-main.js`.**
- Use the glob: `node --test 'test/*.js'`. `node --test test/` treats the bare
  directory as a file named `test` and reports a spurious failure.
- `certs/` and `lima-bin/` are gitignored build/signing inputs.
- This repo is the surviving half of a duplicate pair; `ai-mentat-coolify` (an
  older 1-commit extraction) was deleted 2026-08-30.
