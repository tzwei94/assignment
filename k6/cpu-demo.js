import http from 'k6/http';
import encoding from 'k6/encoding';
import execution from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { createResponseRecorder, responseReportOutputs } from './lib/response-report.js';
import { cpuConfig, cpuOptions } from './cpu-config.mjs';

const config = cpuConfig(__ENV);
export const options = cpuOptions(config);
const rejected = new Counter('cpu_rejected');
const completed = new Counter('cpu_completed');
const rejectionRate = new Rate('cpu_rejection_rate');
const unexpectedErrors = new Rate('cpu_unexpected_error_rate');
// Keep k6's default HTTP failure accounting: busy 429s are still HTTP failures.
// CPU acceptance and abort thresholds use the separately validated outcome metrics.
const responses = createResponseRecorder(Counter, Trend);

function readiness() {
  const response = responses.capture(() => http.get(`${config.baseUrl}/readyz`, {
    timeout: '2s', redirects: 0, tags: { name: 'GET /readyz', endpoint: 'readiness' },
  }), 'readiness');
  if (response.status !== 200 || response.timings.duration > 1000) {
    execution.test.abort(`Readiness guard stopped the test (HTTP ${response.status}); inspect service health and latency`);
  }
}

export function setup() {
  if (!__ENV.TOKEN_USERNAME || !__ENV.TOKEN_PASSWORD || __ENV.TOKEN_USERNAME.includes(':')) {
    throw new Error('Set existing TOKEN_USERNAME and TOKEN_PASSWORD locally; username cannot contain a colon');
  }
  readiness();
  const response = responses.capture(() => http.post(`${config.baseUrl}/auth/token`, null, {
    headers: { Authorization: `Basic ${encoding.b64encode(`${__ENV.TOKEN_USERNAME}:${__ENV.TOKEN_PASSWORD}`)}` },
    timeout: '2s', redirects: 0, tags: { name: 'POST /auth/token', endpoint: 'token' },
  }), 'token');
  let body;
  try { body = response.json(); } catch { body = null; }
  if (response.status !== 200 || body?.token_type !== 'Bearer' || typeof body.access_token !== 'string'
      || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in < config.duration + 30) {
    throw new Error(`Token preflight failed (HTTP ${response.status}); no CPU workload was started`);
  }
  // Never print the JWT or serialize it in a report. No banking account data is needed.
  return { token: body.access_token };
}

export function cpu(data) {
  let response;
  try {
    response = responses.capture(() => http.post(`${config.baseUrl}/demo/cpu`, JSON.stringify({ workMs: config.workMs }), {
      headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
      timeout: '2s', redirects: 0, tags: { name: 'POST /demo/cpu', endpoint: 'cpu' },
    }), 'cpu');
  } catch {
    rejectionRate.add(false);
    unexpectedErrors.add(true);
    execution.test.abort('CPU request failed without an HTTP response; inspect connectivity and request configuration');
    return;
  }
  let body;
  try { body = response.json(); } catch { body = null; }
  const busy = response.status === 429 && body?.code === 'cpu_demo_busy';
  const successful = response.status === 200 && body?.workMs === config.workMs
    && Number.isFinite(body.iterations) && body.iterations >= 0 && /^[a-f0-9]{64}$/.test(body.checksum || '');
  if (busy) rejected.add(1);
  if (successful) completed.add(1);
  rejectionRate.add(busy);
  unexpectedErrors.add(!busy && !successful);
  check(response, { 'CPU work completed or was rejected by the bounded worker': () => successful || busy });
  if (!busy && !successful) execution.test.abort(`Unexpected CPU response (HTTP ${response.status}); inspect the deployment`);
  if (config.profile === 'smoke' && busy) execution.test.abort('Smoke was rejected: wait for the per-task recovery gap and retry');
}

export function health() { readiness(); sleep(10); }
export function teardown() { readiness(); }

export function handleSummary(data) {
  const { setup_data: privateSetupData, ...report } = data;
  const summaryPath = __ENV.SUMMARY_PATH || 'summary.json';
  const status = responseReportOutputs(data, {summaryPath, profile: config.profile, workload: 'cpu',
    dashboardPath: __ENV.K6_WEB_DASHBOARD_EXPORT || ''});
  return {
    stdout: `CPU demo: ${config.profile}, ${config.workMs}ms work, ${config.rate} requests/sec, ${config.duration}s configured duration\n${status.text}Full metrics: ${summaryPath}\n`,
    [summaryPath]: JSON.stringify(report, null, 2),
    [status.htmlPath]: status.html,
  };
}
