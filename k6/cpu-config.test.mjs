import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuConfig, cpuOptions } from './cpu-config.mjs';

test('default smoke performs one small CPU request', () => {
  const config = cpuConfig({ BASE_URL: 'https://example.test' });
  assert.equal(config.workMs, 50);
  assert.equal(cpuOptions(config).scenarios.cpu.iterations, 1);
});

test('load stays within four CPU requests per second, eight total VUs and five minutes', () => {
  const options = cpuOptions(cpuConfig({ BASE_URL: 'https://example.test', CPU_PROFILE: 'load' }));
  assert.equal(options.scenarios.cpu.rate, 4);
  assert.equal(options.scenarios.cpu.maxVUs + options.scenarios.health.vus, 8);
  assert.equal(options.scenarios.cpu.duration, '300s');
});

test('unsafe ceilings and malformed configuration fail before HTTP', () => {
  for (const override of [{ CPU_RATE: '5' }, { CPU_MAX_VUS: '9' }, { CPU_DURATION_SECONDS: '301' },
    { CPU_WORK_MS: '501' }, { CPU_WORK_MS: '49' }, { CPU_WORK_MS: '50.5' },
    { CPU_RATE: 'NaN' }, { CPU_PROFILE: 'stress' }, { BASE_URL: 'http://example.test' },
    { BASE_URL: 'https://user:secret@example.test' }, { BASE_URL: 'https://example.test/?token=secret' }]) {
    assert.throws(() => cpuConfig({ BASE_URL: 'https://example.test', ...override }));
  }
});

test('local HTTP is allowed only for loopback', () => {
  assert.equal(cpuConfig({ BASE_URL: 'http://127.0.0.1:8080/' }).baseUrl, 'http://127.0.0.1:8080');
});
