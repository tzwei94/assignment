import test from 'node:test';
import assert from 'node:assert/strict';
import { configFromEnv, optionsFor } from '../lib/config.js';

test('defaults to a local read-only smoke test', () => {
  const config = configFromEnv({});
  assert.equal(config.baseUrl, 'http://localhost:8080');
  assert.equal(config.workload, 'balance');
  assert.equal(optionsFor(config).scenarios.banking.iterations, 5);
});

test('mixed writes require an explicit opt-in', () => {
  assert.throws(() => configFromEnv({ WORKLOAD: 'mixed' }), /ALLOW_WRITES/);
  assert.equal(configFromEnv({ WORKLOAD: 'mixed', ALLOW_WRITES: 'true' }).workload, 'mixed');
});

test('rejects invalid input before sending requests', () => {
  for (const env of [
    { PROFILE: 'unknown' }, { WORKLOAD: 'transfer' }, { RATE: '0' },
    { RATE: '2.5' }, { DURATION: 'forever' }, { BASE_URL: 'ftp://example.com' },
    { ACCOUNT_IDS: 'not-a-uuid' }, { AMOUNT: '0.001' }, { AMOUNT: '0' },
    { AMOUNT: '00.01' }, { AMOUNT: '01' },
    { ERROR_RATE: '2' }, { PRE_ALLOCATED_VUS: '10', MAX_VUS: '5' },
    { STRESS_RATES: '10,nope' }, { BASE_URL: 'https://user:secret@example.com' },
  ]) assert.throws(() => configFromEnv(env), undefined, JSON.stringify(env));
});

test('arrival rate is configurable and not paced by sleeps', () => {
  const config = configFromEnv({ PROFILE: 'load', RATE: '25', DURATION: '2m' });
  const scenario = optionsFor(config).scenarios.banking;
  assert.equal(scenario.executor, 'constant-arrival-rate');
  assert.equal(scenario.rate, 25);
  assert.equal(scenario.duration, '2m');
});

test('stress steps hold at each target before recovery', () => {
  const config = configFromEnv({ PROFILE: 'stress', STRESS_RATES: '5,15', RAMP_DURATION: '10s', HOLD_DURATION: '20s' });
  assert.deepEqual(optionsFor(config).scenarios.banking.stages, [
    { target: 5, duration: '10s' }, { target: 5, duration: '20s' },
    { target: 15, duration: '10s' }, { target: 15, duration: '20s' },
    { target: 0, duration: '10s' },
  ]);
});

test('soak lasts beyond the server token lifetime', () => {
  assert.equal(optionsFor(configFromEnv({ PROFILE: 'soak' })).scenarios.banking.duration, '30m');
});

test('creates per-operation latency and failure gates for the selected workload', () => {
  const config = configFromEnv({ WORKLOAD: 'mixed', ALLOW_WRITES: 'true', P95_MS: '250' });
  const thresholds = optionsFor(config).thresholds;
  for (const endpoint of ['balance', 'deposit', 'withdrawal']) {
    assert.deepEqual(thresholds[`http_req_duration{phase:workload,endpoint:${endpoint}}`], ['p(95)<250']);
  }
  assert.deepEqual(thresholds.dropped_iterations, ['count==0']);
});
