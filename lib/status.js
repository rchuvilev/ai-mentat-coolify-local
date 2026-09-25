/**
 * Status derivation — the decision core of computeStatus().
 *
 * Pure on purpose. The probes themselves shell out to limactl and docker, and
 * that is exactly why the rules ABOUT them were never covered: they only ran
 * inside Electron, against a real VM, so the one part that has already been
 * wrong twice could not be asserted anywhere.
 *
 * Every flag here is TRI-STATE: true / false / null. `null` means "could not
 * ask" — the VM is still booting, limactl is slow — and is not the same as
 * "no". Collapsing the two is the original bug this module exists to prevent.
 */
'use strict';

/** The flags that carry a tri-state and can therefore be filled from cache. */
const TRI_KEYS = ['vmExists', 'vmRunning', 'coolifyInstalled', 'coolifyRunning'];

/**
 * Decide which Coolify probes are worth running.
 *
 * Skipping them when the VM is definitively stopped saves two shell round
 * trips per poll. Skipping them when `vmRunning` is null does NOT — that reads
 * "cannot tell" as "stopped" and reports an installed, running Coolify as
 * absent, which is what made a working stack light up red on launch.
 *
 * @param {boolean|null} vmRunning
 * @param {() => boolean|null} probeInstalled
 * @param {() => boolean|null} probeRunning
 */
function gateCoolifyProbes(vmRunning, probeInstalled, probeRunning) {
  const coolifyInstalled = vmRunning === false ? false : probeInstalled();
  // Same rule one level down: nothing can be running if it is not installed,
  // but "we could not tell whether it is installed" is not that.
  const coolifyRunning = coolifyInstalled === false ? false : probeRunning();
  return { coolifyInstalled, coolifyRunning };
}

/**
 * Fill unknown flags from the last confirmed reading, and say whether any
 * filling happened.
 *
 * A fresh launch should not open on a wall of red while the VM boots — it
 * should show what was true last time, marked stale so the UI can say
 * "checking" instead of asserting a false negative.
 *
 * Only booleans are accepted from the cache: a cached `null` is not an answer,
 * and letting one through would make `stale` true forever.
 *
 * @param {object} fresh  flags from this poll; mutated copy is returned
 * @param {object} [last] the previous confirmed reading
 * @returns {object} fresh flags with unknowns filled and a `stale` boolean
 */
function fillFromCache(fresh, last) {
  const out = { ...fresh };
  const cached = last || {};
  let stale = false;
  for (const k of TRI_KEYS) {
    if (out[k] === null || out[k] === undefined) {
      stale = true;
      out[k] = typeof cached[k] === 'boolean' ? cached[k] : null;
    }
  }
  out.stale = stale;
  return out;
}

/**
 * Is this reading worth caching?
 *
 * Only a complete one. Writing a partially-filled reading back would cache a
 * value that was itself read from the cache, so a single failed probe would
 * pin that flag forever.
 */
function isCacheable(status) {
  return status.stale === false;
}

module.exports = { TRI_KEYS, gateCoolifyProbes, fillFromCache, isCacheable };
