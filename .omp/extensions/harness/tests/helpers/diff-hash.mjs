// diff-hash.mjs — the test-side oracle for the gates' diff hash: sha256 of `git diff <args>` bytes.
//
// Tests used to shell out to `git diff … | shasum -a 256`, which needs `shasum` (absent on
// Windows native, #92). Hashing the same bytes with node:crypto gives the identical hex digest
// on every platform and needs no pipe, so a path with spaces cannot break it either.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** sha256 hex of the raw stdout of `git <args>` (e.g. ['diff', '--cached']). */
export function gitDiffSha256(cwd, args, env) {
  const out = execFileSync('git', args, { cwd, env, maxBuffer: 256 * 1024 * 1024 });
  return createHash('sha256').update(out).digest('hex');
}
