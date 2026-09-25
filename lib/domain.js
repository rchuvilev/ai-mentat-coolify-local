/**
 * Hostname normalisation and validation for the "use my own domain" flow.
 *
 * This is a trust boundary, not a convenience. The accepted string is
 * interpolated into commands that run as root inside the VM:
 *
 *     sudo sed -i 's|^APP_URL=.*|APP_URL=https://<host>|' /data/coolify/source/.env
 *
 * so anything that survives this function decides what `sed` and `tee` see. A
 * quote, a newline or a shell metacharacter reaching that line is a root-level
 * injection, which is why validation happens here — once, before any command
 * is built — rather than being spread across the callers.
 */
'use strict';

/**
 * Strip the things people paste but do not mean: a scheme, trailing slashes,
 * surrounding whitespace. Case is preserved; hostnames are compared
 * case-insensitively by the validator.
 *
 * @param {unknown} input
 * @returns {string}
 */
function normaliseHost(input) {
  return String(input == null ? '' : input)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

/**
 * A hostname is a dotted run of letters, digits and hyphens ending in a TLD of
 * at least two letters. Deliberately narrow: this is an allowlist, so anything
 * it does not describe — a space, a quote, a semicolon, a newline, a path, a
 * port — is rejected rather than escaped. Escaping is a thing you get wrong
 * once; an allowlist is not.
 */
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** True when the string is a hostname this app will act on. */
function isValidHost(host) {
  return typeof host === 'string' && host.length <= 253 && HOSTNAME.test(host);
}

/**
 * Normalise, then insist. Returns the cleaned hostname or throws with a
 * message the UI shows verbatim.
 *
 * @param {unknown} input
 * @returns {string} the cleaned hostname
 */
function requireHost(input) {
  const clean = normaliseHost(input);
  if (!clean) throw new Error('No hostname given');
  if (!isValidHost(clean)) throw new Error(`"${clean}" is not a valid hostname`);
  return clean;
}

module.exports = { normaliseHost, isValidHost, requireHost, HOSTNAME };
