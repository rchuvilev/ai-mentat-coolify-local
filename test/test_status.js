/**
 * Status derivation.
 *
 * These rules have been wrong twice, and both times the symptom was the same:
 * a Coolify that was installed and running reported as absent, because a probe
 * that could not answer was read as answering "no". The probes shell out, so
 * nothing here could be asserted until the decisions moved into lib/status.js.
 *
 *   node --test 'test/*.js'
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../lib/status');

/* ── probe gating ───────────────────────────────────────────────────────── */

test('a definitively stopped VM skips both Coolify probes', () => {
  let installedCalls = 0;
  let runningCalls = 0;
  const r = S.gateCoolifyProbes(false,
    () => { installedCalls++; return true; },
    () => { runningCalls++; return true; });

  assert.deepStrictEqual(r, { coolifyInstalled: false, coolifyRunning: false });
  assert.strictEqual(installedCalls, 0, 'nothing can be installed in a VM that is not running');
  assert.strictEqual(runningCalls, 0);
});

test('an UNKNOWN vm state still probes — this is the original bug', () => {
  // vmRunning === null means "could not ask", not "stopped". Reading it as
  // stopped is what made a working stack light up red on launch.
  let asked = 0;
  const r = S.gateCoolifyProbes(null,
    () => { asked++; return true; },
    () => true);

  assert.strictEqual(asked, 1, 'must still ask when the VM state is unknown');
  assert.strictEqual(r.coolifyInstalled, true);
  assert.strictEqual(r.coolifyRunning, true);
});

test('a running VM probes both', () => {
  const r = S.gateCoolifyProbes(true, () => true, () => false);
  assert.deepStrictEqual(r, { coolifyInstalled: true, coolifyRunning: false });
});

test('not installed short-circuits running, but UNKNOWN installed does not', () => {
  let ran = 0;
  const off = S.gateCoolifyProbes(true, () => false, () => { ran++; return true; });
  assert.strictEqual(off.coolifyRunning, false);
  assert.strictEqual(ran, 0, 'nothing runs when it is definitively not installed');

  const unknown = S.gateCoolifyProbes(true, () => null, () => { ran++; return true; });
  assert.strictEqual(ran, 1, 'but "could not tell if installed" must still ask');
  assert.strictEqual(unknown.coolifyRunning, true);
});

/* ── filling from cache ─────────────────────────────────────────────────── */

const FRESH = (over = {}) => ({
  vmExists: true, vmRunning: true, coolifyInstalled: true, coolifyRunning: true, ...over,
});

test('a complete reading is returned untouched and is not stale', () => {
  const out = S.fillFromCache(FRESH(), { vmRunning: false });
  assert.strictEqual(out.stale, false);
  assert.strictEqual(out.vmRunning, true, 'a real answer must beat the cache');
  assert.strictEqual(S.isCacheable(out), true);
});

test('an unknown flag is filled from the last confirmed reading and flagged stale', () => {
  const out = S.fillFromCache(FRESH({ coolifyRunning: null }),
    { coolifyRunning: true, vmRunning: false });

  assert.strictEqual(out.coolifyRunning, true, 'filled from cache');
  assert.strictEqual(out.stale, true);
  assert.strictEqual(out.vmRunning, true, 'flags that DID answer are left alone');
});

test('with no cache an unknown stays unknown rather than becoming false', () => {
  const out = S.fillFromCache(FRESH({ vmExists: null }), undefined);
  assert.strictEqual(out.vmExists, null, 'null is not "no"');
  assert.strictEqual(out.stale, true);
});

test('a non-boolean cache entry is refused', () => {
  // A cached null is not an answer; letting one through would keep the
  // reading stale forever and never re-cache.
  for (const bad of [null, undefined, 'true', 1, {}]) {
    const out = S.fillFromCache(FRESH({ vmRunning: null }), { vmRunning: bad });
    assert.strictEqual(out.vmRunning, null, `cache value ${JSON.stringify(bad)} must be ignored`);
  }
});

test('undefined counts as unknown, not as a value', () => {
  const out = S.fillFromCache({ vmExists: true, vmRunning: true, coolifyInstalled: true }, {});
  assert.strictEqual(out.coolifyRunning, null);
  assert.strictEqual(out.stale, true);
});

test('a stale reading is never cached', () => {
  // Caching it would store a value that came FROM the cache, so one failed
  // probe would pin that flag forever.
  const stale = S.fillFromCache(FRESH({ vmRunning: null }), { vmRunning: true });
  assert.strictEqual(stale.stale, true);
  assert.strictEqual(S.isCacheable(stale), false);
});

test('the input is not mutated', () => {
  const fresh = FRESH({ vmRunning: null });
  S.fillFromCache(fresh, { vmRunning: true });
  assert.strictEqual(fresh.vmRunning, null, 'caller keeps its own object');
  assert.ok(!('stale' in fresh));
});

test('every tri-state flag is covered by the fill', () => {
  // Control against the list drifting: if a flag is added to the status shape
  // and not to TRI_KEYS, it would silently stop being filled.
  for (const k of S.TRI_KEYS) {
    const out = S.fillFromCache(FRESH({ [k]: null }), { [k]: false });
    assert.strictEqual(out[k], false, `${k} must be fillable`);
    assert.strictEqual(out.stale, true);
  }
  assert.deepStrictEqual(
    S.TRI_KEYS,
    ['vmExists', 'vmRunning', 'coolifyInstalled', 'coolifyRunning'],
    'TRI_KEYS is the contract computeStatus() builds its fresh object against',
  );
});
