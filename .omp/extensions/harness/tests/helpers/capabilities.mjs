// capabilities.mjs — measure what the host can do, and skip a test ONLY for a capability it lacks.
//
// Issue #92 (Windows native): symlinkSync needs Developer Mode / an elevated shell (EPERM
// otherwise) and mkfifo does not exist. Those tests pin real security-gate behaviour, so the
// rule is: probe the capability once; if it is present the test runs exactly as before (a Linux
// run must not gain a single skip); if it is absent the test is skipped WITH the reason printed
// in the report. Never blanket-skip a file, and never swallow an unexpected probe error — only
// the specific "this OS/user cannot do it" codes count as "missing".
//
//   import { skipUnless, mkfifoSync } from './helpers/capabilities.mjs';
//   test('symlinked sidecar is refused', { skip: skipUnless('symlink') }, () => { … });
//
// `skip` accepts `false | string`, which is exactly what skipUnless returns.
//
// Simulating a host without a capability (what the Windows-native path looks like) without a
// Windows machine: HARNESS_TEST_FORCE_NO_CAPS=symlink,fifo — pinned in capabilities.test.mjs.

import { mkdtempSync, rmSync, symlinkSync, lstatSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const FORCE_ENV = 'HARNESS_TEST_FORCE_NO_CAPS';

// errno codes meaning "this host/user cannot do that" (as opposed to a bug or a broken tmpdir).
// EACCES/UNKNOWN count only on Windows (where an unprivileged symlinkSync / MSYS mkfifo reports
// them); on POSIX they are a real environment fault and must fail the probe loudly instead of
// silently turning security-gate tests into skips.
const WIN = process.platform === 'win32';
const MISSING_CODES = new Set(['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', ...(WIN ? ['EACCES', 'UNKNOWN'] : [])]);

const REASONS = {
  symlink: 'host cannot create symlinks (on Windows this needs Developer Mode or an elevated shell: symlinkSync fails with EPERM)',
  fifo: 'host has no working mkfifo (POSIX FIFOs are unavailable, e.g. Windows native)',
};

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-probe-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function probeSymlink() {
  return withTmp((dir) => {
    const target = join(dir, 'target.txt');
    const link = join(dir, 'link');
    writeFileSync(target, 'x');
    try {
      symlinkSync(target, link);
    } catch (e) {
      if (MISSING_CODES.has(e?.code)) return false;
      throw e;   // an unexpected failure must stay loud, not become a skip
    }
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`symlink probe: ${link} was created but is not a symlink`);
    return true;
  });
}

function probeFifo() {
  return withTmp((dir) => {
    const p = join(dir, 'probe.fifo');
    const r = spawnSync('mkfifo', [p], { encoding: 'utf-8' });
    if (r.error) {
      if (r.error.code === 'ENOENT' || MISSING_CODES.has(r.error.code)) return false;   // no such binary / not runnable
      throw r.error;
    }
    if (r.status !== 0 || r.signal) {
      // Windows: an MSYS mkfifo on NTFS exits non-zero ("Permission denied") — present but unusable = missing.
      // POSIX: a mkfifo that exists and fails is an environment fault, not a missing capability.
      if (WIN) return false;
      throw new Error(`mkfifo probe failed on ${process.platform}: status=${r.status} signal=${r.signal} stderr=${r.stderr}`);
    }
    if (!lstatSync(p).isFIFO()) throw new Error(`mkfifo probe: ${p} was created but is not a FIFO`);
    return true;
  });
}

const PROBES = { symlink: probeSymlink, fifo: probeFifo };
const measured = new Map();

function forced(name) {
  return (process.env[FORCE_ENV] ?? '').split(',').map((s) => s.trim()).includes(name);
}

/** Does this host have the capability? (measured once per process; honours the force-missing env). */
export function hasCapability(name) {
  if (!Object.hasOwn(PROBES, name)) throw new Error(`unknown capability '${name}' (known: ${Object.keys(PROBES).join(', ')})`);
  if (forced(name)) return false;
  if (!measured.has(name)) measured.set(name, PROBES[name]());
  return measured.get(name);
}

/** `false` when every named capability is present (run the test), else the first missing one's skip reason. */
export function skipUnless(...names) {
  for (const name of names) {
    if (hasCapability(name)) continue;
    return forced(name) ? `${REASONS[name]} [forced missing via ${FORCE_ENV}]` : REASONS[name];
  }
  return false;
}

/** mkfifo with an argv array (no shell) so a path containing spaces cannot be split. Throws on failure. */
export function mkfifoSync(path) {
  const r = spawnSync('mkfifo', [path], { encoding: 'utf-8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`mkfifo ${path} failed (${r.status}): ${r.stderr}`);
}
