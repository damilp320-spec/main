# 🛡️ Security — how Mythera AI Hub blocks dangerous commands

The single biggest trust question for a tool-using agent is: *what stops it from
destroying my computer?* This document shows the **exact**, real mechanism — the
same code that runs in production (`src/main/system.js`). Nothing here is
hand-wavy: the patterns below are copied from the source and are also viewable
**inside the app** (Settings → Security → “Что именно блокируется?”), where you
can type any command and see whether it would be blocked.

## Layered defense

A command requested by an agent passes through several gates **before** it can run:

1. **Master switch.** Shell execution can be turned off entirely
   (`settings.allowShell`). If off, `run_command` refuses everything.
2. **Pattern screen.** Every command string is tested against a list of
   destructive-operation regexes (below) *and* a user blocklist. Any match →
   the command is rejected and never spawned.
3. **Filesystem sandbox.** File tools (`read_file`/`write_file`/`list_dir`) and
   the shell working directory are confined to the workspace
   (`~/MytheraAI-Workspace`). Paths outside it are rejected unless the user
   explicitly enables *Full disk access* in Settings.
4. **Protected directories.** Even with full disk access, writes to system
   directories (`Windows`, `Program Files`, `System32`, `/etc`, `/bin`, `/usr`,
   `/sys`, `/dev`, …) are **always** blocked.
5. **Process hardening.** Shell runs non-interactive, hidden, with output caps
   and a 60-second timeout; URLs for `open_url`/`http_get` must be `http(s)`.

## The actual block list (`DANGER_PATTERNS`)

From `src/main/system.js` — a command matching **any** of these is blocked:

```js
const DANGER_PATTERNS = [
  /\bformat\b\s+[a-z]:/i,   // format C:
  /\bdiskpart\b/i,          // partition tool
  /\bmkfs\b/i,              // make filesystem (wipe)
  /\bdd\s+if=/i,            // raw disk write
  /\bdel\b\s+\/[sqf]/i,     // recursive/forced delete
  /\brmdir\b\s+\/s/i, /\brd\b\s+\/s/i,
  /rm\s+-rf?\s+[~/]/i,      // rm -rf / or ~
  /rm\s+-rf?\s+\*/i,        // rm -rf *
  /:\(\)\s*\{.*\};:/,       // fork bomb
  /\bshutdown\b/i, /\breboot\b/i,
  /\bvssadmin\b/i,          // delete shadow copies (ransomware pattern)
  /\bbcdedit\b/i,           // boot config tamper
  /\bcipher\b\s+\/w/i,      // secure-wipe free space
  /\bfsutil\b/i,
  /reg\s+delete/i,          // registry deletion
  /\bschtasks\b/i,          // scheduled-task tamper
  /\bnet\s+user\b/i,        // account changes
  /\bnetsh\b/i,
  /Remove-Item.*-Recurse.*-Force/i,
  /\bFormat-Volume\b/i, /\bClear-Disk\b/i,
  /\bRemove-Item\b.*\\Windows/i,
  /chmod\s+-R\s+777\s+\//,
  />\s*\/dev\/sd[a-z]/i,    // overwrite a disk device
  /\bkillall\b/i,
  /Stop-Computer/i, /Restart-Computer/i
];

function screenCommand(command) {
  const extra = store.get('settings.blockedCommands', []);            // user blocklist (substring)
  if (extra.some(b => command.toLowerCase().includes(b.toLowerCase()))) return 'пользовательский фильтр';
  if (DANGER_PATTERNS.some(re => re.test(command))) return 'разрушительная операция';
  return null; // allowed
}
```

> Regex screening is intentionally stricter than naïve substring matching: it
> targets the dangerous *form* of a command (e.g. `rm -rf /`) rather than an
> innocent mention of a word.

## Filesystem confinement (`resolveSafe`)

```js
const PROTECTED = process.platform === 'win32'
  ? [/^[a-z]:\\windows/i, /^[a-z]:\\program files/i, /\\system32/i, /\\\$recycle/i]
  : [/^\/(etc|bin|sbin|boot|sys|proc|dev|usr|lib|var\/lib)(\/|$)/, /^\/$/];

function resolveSafe(p, { write = false } = {}) {
  const root = safeRoot();
  const fullDisk = store.get('settings.fullDiskAccess', false);
  const full = path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(root, p));
  const insideRoot = (full + path.sep).startsWith(path.normalize(root + path.sep));
  if (!fullDisk && !insideRoot) throw new Error('Доступ только к рабочему пространству.');
  if (write && PROTECTED.some(re => re.test(full))) throw new Error('Запись в системный каталог запрещена.');
  return full;
}
```

## Other hardening

- **Secrets at rest:** SSH passwords/keys are encrypted via Electron
  `safeStorage` (`src/main/secrets.js`), not stored in plaintext.
- **Window isolation:** `contextIsolation: true`, `nodeIntegration: false`,
  strict CSP, external navigation/popups denied, links open only in the system
  browser and only for `http(s)`.
- **Remote access (Dispatch):** the local server is bound to `127.0.0.1` by
  default and always requires a random access token; LAN exposure is opt-in.
- **Skills:** plugin “skills” are **declarative** (command/HTTP templates), not
  arbitrary JS. Command skills go through the *same* `screenCommand` filter.

## Verify it yourself

In the app: **Settings → 🔐 Security → “Что именно блокируется?”** lists the live
patterns and lets you test any command string against the real filter. The same
check (`system.screenTest`) is what guards every agent `run_command` call.
