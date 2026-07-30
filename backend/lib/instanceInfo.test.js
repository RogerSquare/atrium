// Unit tests for the /api/instance builder (feat-mcp-bootstrap-001).

const { test } = require('node:test');
const assert = require('node:assert');
const { buildInstanceInfo } = require('./instanceInfo');

test('builds a url from protocol + host', () => {
  const info = buildInstanceInfo({ protocol: 'http', host: 'localhost:3001', port: 3001, version: '1.0.0' });
  assert.strictEqual(info.url, 'http://localhost:3001');
  assert.strictEqual(info.port, 3001);
  assert.strictEqual(info.version, '1.0.0');
  assert.strictEqual(info.name, 'Atrium');
});

test('reflects the real published port/host, not an assumed :3001', () => {
  const info = buildInstanceInfo({ protocol: 'http', host: 'localhost:3100', port: 3001 });
  // url is what the client reached (3100); port is the internal listen port.
  assert.strictEqual(info.url, 'http://localhost:3100');
});

test('honors reverse-proxy forwarded headers', () => {
  const info = buildInstanceInfo({
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'board.example.com' },
    protocol: 'http',
    host: 'internal:3001',
  });
  assert.strictEqual(info.url, 'https://board.example.com');
});

test('url is null when no host is knowable', () => {
  const info = buildInstanceInfo({ protocol: 'http', host: null });
  assert.strictEqual(info.url, null);
});

test('version defaults to null when absent', () => {
  const info = buildInstanceInfo({ host: 'x:1' });
  assert.strictEqual(info.version, null);
  assert.strictEqual(info.port, null);
});

test('name can be overridden', () => {
  const info = buildInstanceInfo({ host: 'x:1', name: 'My Board' });
  assert.strictEqual(info.name, 'My Board');
});
