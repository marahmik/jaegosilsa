// helpers/real-tmpdir.mjs — temp dirs whose path is already the PHYSICAL path.
//
// repo-root.mjs returns physical (realpath) paths on purpose: a symlinked alias must not let a
// path dodge the cross-repo guard. On macOS os.tmpdir() is /var/folders/… while the physical
// path is /private/var/folders/…, so a fixture that builds its expectations from the raw
// mkdtempSync() string disagrees with every realpath-normalised result. Tests that compare
// production paths against fixture paths take their root from here instead.

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** mkdtempSync(join(tmpdir(), prefix)) normalised through realpath (a no-op where /tmp has no alias). */
export function mkdtempReal(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
