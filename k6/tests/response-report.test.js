import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseRecorder, responseSummary, responseReportOutputs } from '../lib/response-report.js';

function fixture() {
  const samples = new Map();
  class Counter {
    constructor(name) { this.name = name; samples.set(name, []); }
    add(value) { samples.get(this.name).push(value); }
  }
  const recorder = createResponseRecorder(Counter, Counter);
  function summary() {
    const metrics = Object.fromEntries([...samples].filter(([, values]) => values.length).map(([name, values]) =>
      [name, { values: name.endsWith('_ms') ? { min: Math.min(...values), max: Math.max(...values) }
        : { count: values.reduce((a, b) => a + b, 0) } }]));
    return { metrics, state: {testRunDurationMs: 12345}, setup_data: {token: 'SECRET-JWT', account: 'SECRET-ACCOUNT'} };
  }
  return {recorder, summary};
}

test('status rows count every request and share an observed-window denominator', () => {
  const {recorder, summary} = fixture();
  const statuses = [200, 201, 302, 401, 403, 404, 429, 418, 500, 0, 700];
  for (const status of statuses) recorder.record({status}, 'balance', null, 1000, 11000);
  const report = responseSummary(summary());
  assert.equal(report.total, 11);
  assert.equal(report.accounted, 11);
  assert.equal(report.durationSeconds, 10);
  for (const row of report.rows) {
    assert.equal(row.count, 1);
    assert.equal(row.percentage, 100 / 11);
    assert.equal(row.requestsPerSecond, 0.1);
  }
});

test('CPU busy requires the CPU endpoint, status 429 and exact parsed body code', () => {
  const {recorder, summary} = fixture();
  recorder.record({status: 429}, 'cpu', {code: 'cpu_demo_busy'}, 1000, 2000);
  recorder.record({status: 429}, 'token', {code: 'cpu_demo_busy'}, 1000, 2000);
  recorder.record({status: 429}, 'cpu', {code: 'rate_limited'}, 1000, 2000);
  recorder.record({status: 429}, 'cpu', null, 1000, 2000);
  recorder.record({status: 200}, 'cpu', {code: 'cpu_demo_busy'}, 1000, 2000);
  const report = responseSummary(summary());
  assert.equal(report.rows.find(row => row.key === '429').count, 4);
  assert.equal(report.busy429.count, 1);
  assert.equal(report.unexpected429.count, 3);
  assert.equal(report.busy429.percentage, 20);
  assert.equal(report.unexpected429.percentage, 60);
});

test('a response that aborts the test is counted before validation', () => {
  const {recorder, summary} = fixture();
  const response = recorder.capture(() => ({status: 401}), 'token');
  assert.equal(response.status, 401);
  assert.equal(responseSummary(summary()).rows.find(row => row.key === '401').count, 1);
});

test('request exceptions are counted as network errors and rethrown', () => {
  const {recorder, summary} = fixture();
  const failure = new Error('request exception');
  assert.throws(() => recorder.capture(() => {throw failure;}, 'cpu'), error => error === failure);
  assert.equal(responseSummary(summary()).rows.find(row => row.key === 'network').count, 1);
});

test('empty, absent and incomplete metrics remain explicit instead of inventing rates', () => {
  const absent = responseSummary({metrics: {http_reqs: {values: {count: 6}}}});
  assert.equal(absent.available, false);
  assert.equal(absent.durationSeconds, null);
  assert.equal(responseSummary({}).available, false);
  const zero = responseSummary({metrics: {response_status_total: {values: {count: 0}}}});
  assert.equal(zero.total, 0);
  assert.ok(zero.rows.every(row => row.percentage === null && row.requestsPerSecond === null));
  const incomplete = responseSummary({metrics: {response_status_total: {values: {count: 3}}, response_status_200: {values: {count: 1}}}});
  assert.equal(incomplete.accounted, 1);
  assert.equal(incomplete.unaccounted, 2);
  assert.equal(incomplete.rows[0].requestsPerSecond, null);
});

test('HTML and console show truthful raw HTTP failures alongside unexpected CPU errors', () => {
  const {recorder, summary} = fixture();
  recorder.record({status: 429}, 'cpu', {code: 'cpu_demo_busy'}, 1000, 2000);
  const data = summary();
  data.metrics.http_req_failed = {values: {rate: 1, passes: 1, fails: 0}};
  data.metrics.cpu_unexpected_error_rate = {values: {rate: 0}};
  data.metrics.cpu_unexpected_error_rate.thresholds = {'rate<0.01': {ok: true}};
  const output = responseReportOutputs(data, {summaryPath: '/tmp/run/summary.json', profile: 'load', workload: 'cpu', dashboardPath: '/tmp/run/report.html'});
  const html = output.html;
  assert.match(html, /Confirmed CPU busy 429/);
  assert.match(html, /Raw HTTP failure rate/);
  assert.match(html, /100\.00%/);
  assert.match(html, /CPU unexpected error rate/);
  assert.match(html, /0\.00%/);
  assert.match(html, /href="report\.html"/);
  assert.match(output.text, /Status report: \/tmp\/run\/status-report\.html/);
  assert.equal(output.htmlPath, '/tmp/run/status-report.html');
});

test('rendering never serializes credentials, bodies, URLs or account identifiers', () => {
  const {recorder, summary} = fixture();
  recorder.record({status: 401, url: 'https://example.test/?token=SECRET-QUERY', body: 'SECRET-BODY'}, 'token', null, 1000, 2000);
  const data = summary();
  data.metrics['SECRET-METRIC-NAME'] = {values: {secret: 'SECRET-METRIC-VALUE'}};
  const output = responseReportOutputs(data, {profile: 'smoke', workload: 'balance', summaryPath: 'summary.json'});
  for (const secret of ['SECRET-JWT', 'SECRET-ACCOUNT', 'SECRET-QUERY', 'SECRET-BODY', 'SECRET-METRIC-NAME', 'SECRET-METRIC-VALUE']) {
    assert.ok(!output.html.includes(secret));
    assert.ok(!output.text.includes(secret));
  }
  assert.match(output.html, /This k6 run only/);
  assert.match(output.html, /ALB/);
});

test('HTML escapes displayed metadata and avoids conflicting export paths', () => {
  const output = responseReportOutputs({}, {summaryPath: '/tmp/status-report.html', dashboardPath: '/tmp/response-status-report.html', profile: '<script>alert("x")</script>', workload: 'cpu'});
  assert.ok(!output.html.includes('<script>'));
  assert.match(output.html, /&lt;script&gt;/);
  assert.notEqual(output.htmlPath, '/tmp/status-report.html');
  assert.notEqual(output.htmlPath, '/tmp/response-status-report.html');
});
