import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = process.env.K6_SCRIPT_DIRECTORY || fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./k6-report-fixture.mjs', import.meta.url));
function simulate(workload, fault = '') {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', fixture, root, workload, fault],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
}

test('CPU script reports confirmed busy 429s while preserving raw HTTP failures', () => {
  const result = simulate('cpu', 'busy');
  assert.equal(result.aborted, false);
  assert.ok(result.htmlPath);
  assert.equal(result.summary.metrics.response_status_total.values.count, 7);
  assert.equal(result.summary.metrics.response_cpu_busy_429.values.count, 1);
  assert.ok(result.summary.metrics.http_req_failed.values.rate > 0);
  assert.equal(result.summary.metrics.cpu_unexpected_error_rate.values.rate, 0);
  assert.equal(result.summary.metrics.cpu_unexpected_error_rate.thresholds['rate<0.01'].ok, true);
  assert.match(result.outputs.stdout, /Confirmed CPU busy 429/);
  assert.match(result.outputs[result.htmlPath], /CPU unexpected error rate: 0.00%/);
});

for (const fault of ['unexpected-429', 'malformed-429', 'disabled-404', 'server-500', 'network', 'request-throws', 'invalid-200']) {
  test(`CPU ${fault} remains an unexpected failure and still produces its report`, () => {
    const result = simulate('cpu', fault);
    assert.equal(result.aborted, true);
    assert.ok(result.htmlPath);
    assert.ok(result.summary.metrics.cpu_unexpected_error_rate, 'Every failed CPU attempt must reach the unexpected-error metric');
    assert.equal(result.summary.metrics.cpu_unexpected_error_rate.values.rate, 1);
    assert.equal(result.summary.metrics.cpu_unexpected_error_rate.thresholds['rate<0.01'].ok, false);
    assert.match(result.outputs[result.htmlPath], /Thresholds<\/span><strong>FAIL/);
    assert.equal(result.summary.metrics.response_cpu_busy_429, undefined);
    if (fault.includes('429')) assert.equal(result.summary.metrics.response_unexpected_429.values.count, 1);
  });
}

for (const fault of ['auth-401', 'readiness-429']) {
  test(`preflight ${fault} is counted even when no CPU iterations run`, () => {
    const result = simulate('cpu', fault);
    assert.equal(result.aborted, true);
    assert.equal(result.iterations, 0);
    assert.ok(result.htmlPath);
    assert.ok(result.summary.metrics.response_status_total.values.count > 0);
    assert.equal(result.summary.metrics.response_cpu_busy_429, undefined);
    assert.ok(result.summary.metrics.http_req_failed.values.rate > 0);
  });
}

for (const fault of ['', 'bank-403', 'bank-429']) {
  test(`banking ${fault || 'success'} reports only its own responses without private data`, () => {
    const result = simulate('banking', fault);
    assert.ok(result.htmlPath);
    assert.equal(result.summary.metrics.response_status_total.values.count, 7);
    assert.equal(result.summary.metrics.response_cpu_busy_429, undefined);
    if (fault === 'bank-429') assert.equal(result.summary.metrics.response_unexpected_429.values.count, 4);
    if (fault) assert.equal(result.summary.metrics.workflow_success.thresholds['rate>0.99'].ok, false);
    for (const value of Object.values(result.outputs)) assert.ok(!value.includes('SECRET-'));
    assert.match(result.outputs[result.htmlPath], /This k6 run only/);
  });
}
