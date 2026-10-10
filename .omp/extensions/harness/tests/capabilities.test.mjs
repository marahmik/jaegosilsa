// Pins the capability-skip contract (#92/#94): a host WITHOUT symlinks/FIFOs (Windows native
// without Developer Mode) gets an explicit, reasoned skip — and a host WITH them gets none.
//
// Run: node --test .omp/extensions/harness/tests/capabilities.test.mjs
//
// The "no capability" host is simulated by forcing the probe result via HARNESS_TEST_FORCE_NO_CAPS
// in a CHILD `node --test` run, so the parent suite itself never loses a real test. The child is a
// throwaway file that uses the same `{ skip: skipUnless(...) }` shape the real tests use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasCapability, skipUnless, FORCE_ENV } from './helpers/capabilities.mjs';

const HELPER_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'capabilities.mjs')).href;

const CHILD = `
import { test } from 'node:test';
import { skipUnless } from ${JSON.stringify(HELPER_URL)};
test('needs-symlink', { skip: skipUnless('symlink') }, () => { console.log('BODY-RAN needs-symlink'); });
test('needs-fifo', { skip: skipUnless('fifo') }, () => { console.log('BODY-RAN needs-fifo'); });
test('needs-both', { skip: skipUnless('fifo', 'symlink') }, () => { console.log('BODY-RAN needs-both'); });
test('needs-nothing', () => { console.log('BODY-RAN needs-nothing'); });
`;

function runChild(force) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-child-'));
  try {
    const file = join(dir, 'child.test.mjs');
    writeFileSync(file, CHILD);
    const env = { ...process.env };
    delete env[FORCE_ENV];
    delete env.NODE_TEST_CONTEXT;   // else the child believes it is inside this test run and refuses to start its own
    if (force) env[FORCE_ENV] = force;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf-8', env });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a host without symlink+FIFO support skips exactly the dependent tests and prints the reason', () => {
  const { status, out } = runChild('symlink,fifo');
  assert.equal(status, 0, `skips must not fail the run:\n${out}`);
  assert.match(out, /# SKIP host cannot create symlinks \(on Windows this needs Developer Mode[^\n]*forced missing via HARNESS_TEST_FORCE_NO_CAPS/, `symlink skip reason missing:\n${out}`);
  assert.match(out, /# SKIP host has no working mkfifo[^\n]*forced missing via HARNESS_TEST_FORCE_NO_CAPS/, `fifo skip reason missing:\n${out}`);
  assert.doesNotMatch(out, /BODY-RAN needs-(symlink|fifo|both)/, 'a skipped body must not execute');
  assert.match(out, /BODY-RAN needs-nothing/, 'a test that needs no capability is never skipped (no blanket skip)');
  assert.match(out, /# skipped 3\b/, `exactly the three capability-gated tests are skipped:\n${out}`);
});

test('forcing only FIFOs missing leaves the symlink-gated test to the real probe', { skip: skipUnless('symlink') }, () => {
  const { out } = runChild('fifo');
  assert.match(out, /BODY-RAN needs-symlink/, 'symlinks are present on this host and were not forced away');
  assert.match(out, /# SKIP host has no working mkfifo/);
  assert.doesNotMatch(out, /BODY-RAN needs-(fifo|both)/);
});

test('a host that HAS both capabilities skips nothing (capability-present hosts keep full coverage)', { skip: skipUnless('symlink', 'fifo') }, () => {
  const { status, out } = runChild('');
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /# SKIP/, `no skip may appear when the host can do it:\n${out}`);
  for (const n of ['needs-symlink', 'needs-fifo', 'needs-both', 'needs-nothing']) assert.match(out, new RegExp(`BODY-RAN ${n}`));
});

test('unknown capability names fail loudly instead of silently running or skipping', () => {
  assert.throws(() => hasCapability('telepathy'), /unknown capability 'telepathy'/);
  assert.throws(() => hasCapability('constructor'), /unknown capability 'constructor'/, 'prototype names are not capabilities');
});

test('POSIX: an mkfifo that exists but fails is an environment fault — the probe throws instead of skipping', { skip: process.platform === 'win32' ? 'POSIX-only contract (on Windows a failing MSYS mkfifo legitimately means "missing")' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-shim-'));
  try {
    writeFileSync(join(dir, 'mkfifo'), '#!/bin/sh\necho boom >&2\nexit 3\n');
    chmodSync(join(dir, 'mkfifo'), 0o755);
    const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
    delete env[FORCE_ENV];
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync('node', ['--input-type=module', '-e', `import { hasCapability } from ${JSON.stringify(HELPER_URL)}; hasCapability('fifo');`], { encoding: 'utf-8', env });
    assert.notEqual(r.status, 0, 'a failing mkfifo must not be read as "capability missing"');
    assert.match(r.stderr, /mkfifo probe failed on \w+: status=3 .*boom/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
