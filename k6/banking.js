import http from 'k6/http';
import encoding from 'k6/encoding';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { createResponseRecorder, responseReportOutputs } from './lib/response-report.js';
import { configFromEnv, optionsFor } from './lib/config.js';

const config = configFromEnv(__ENV);
export const options = optionsFor(config);
const workflowSuccess = new Rate('workflow_success');
const unpairedDeposits = new Counter('unpaired_deposits');
const balanceRestored = new Rate('balance_restored');
const responses = createResponseRecorder(Counter, Trend);
let tokenCache;

function authenticate() {
  if (!__ENV.TOKEN_USERNAME || !__ENV.TOKEN_PASSWORD || __ENV.TOKEN_USERNAME.includes(':')) {
    throw new Error('Set TOKEN_USERNAME and TOKEN_PASSWORD locally; username cannot contain a colon');
  }
  const response = responses.capture(() => http.post(`${config.baseUrl}/auth/token`, null, {
    headers: { Authorization: `Basic ${encoding.b64encode(`${__ENV.TOKEN_USERNAME}:${__ENV.TOKEN_PASSWORD}`)}` },
    tags: { name: 'POST /auth/token', phase: 'auth', endpoint: 'token' },
    timeout: config.timeout, redirects: 0,
  }), 'token');
  let body;
  try { body = response.json(); } catch { body = null; }
  const valid = check(response, {
    'login returns a usable Bearer token': r => r.status === 200 && body?.token_type === 'Bearer'
      && typeof body.access_token === 'string' && body.access_token.length > 0
      && Number.isFinite(body.expires_in) && body.expires_in > 0,
  });
  if (!valid) throw new Error(`Token request failed (HTTP ${response.status}); check local credentials and target`);
  const refreshBefore = Math.min(30, body.expires_in / 2);
  return { value: body.access_token, refreshAt: Date.now() + (body.expires_in - refreshBefore) * 1000 };
}

function token(initial) {
  if (!tokenCache) tokenCache = initial;
  if (!tokenCache || Date.now() >= tokenCache.refreshAt) tokenCache = authenticate();
  return tokenCache.value;
}

function request(endpoint, accountId, initialToken, phase = 'workload', key) {
  const path = endpoint === 'balance' ? 'balance' : endpoint === 'deposit' ? 'deposits' : 'withdrawals';
  const method = endpoint === 'balance' ? 'GET' : 'POST';
  const headers = { Authorization: `Bearer ${token(initialToken)}` };
  if (key) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = key;
  }
  return responses.capture(() => http.request(method, `${config.baseUrl}/accounts/${accountId}/${path}`,
    key ? `{"amount":${config.amount}}` : null, {
      headers, timeout: config.timeout, redirects: 0,
      tags: { name: `${method} /accounts/{id}/${path}`, endpoint, phase },
    }), endpoint);
}

function balanceBody(response, endpoint) {
  let body;
  try { body = response.json(); } catch { body = null; }
  const valid = check(response, {
    [`${endpoint}: HTTP 200 with a valid balance`]: r => r.status === 200
      && body !== null && typeof body.balance === 'number' && Number.isFinite(body.balance)
      && body.balance >= 0 && body.currency === config.currency,
  });
  return valid ? body : null;
}

export function setup() {
  // Reject missing credentials before making even the readiness request.
  if (!__ENV.TOKEN_USERNAME || !__ENV.TOKEN_PASSWORD) throw new Error('Set TOKEN_USERNAME and TOKEN_PASSWORD locally');
  const ready = responses.capture(() => http.get(`${config.baseUrl}/readyz`, {
    tags: { name: 'GET /readyz', phase: 'preflight', endpoint: 'readiness' },
    timeout: config.timeout, redirects: 0,
  }), 'readiness');
  if (ready.status !== 200) throw new Error(`Readiness check failed (HTTP ${ready.status})`);
  const initialToken = authenticate();
  const startingBalances = {};
  for (const id of config.accountIds) {
    const body = balanceBody(request('balance', id, initialToken, 'preflight'), 'preflight');
    if (!body) throw new Error('Account preflight failed; verify ACCOUNT_IDS, token ownership, and CURRENCY');
    startingBalances[id] = body.balance;
  }
  return {
    token: initialToken, startingBalances,
    runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
  };
}

export default function banking(data) {
  let successful = false;
  try {
    const iteration = exec.scenario.iterationInTest;
    const account = config.accountIds[(exec.vu.idInTest - 1) % config.accountIds.length];
    if (!balanceBody(request('balance', account, data.token), 'balance')) return;
    if (config.workload === 'balance' || iteration % config.writeEvery !== 0) {
      successful = true;
      return;
    }
    // Different keys for the two operations; globally unique within this run.
    const prefix = `k6-${data.runId}-${exec.vu.idInTest}-${iteration}`;
    const deposit = request('deposit', account, data.token, 'workload', `${prefix}-d`);
    const validDeposit = balanceBody(deposit, 'deposit');
    // A confirmed deposit gets a withdrawal even if its response body is malformed.
    if (deposit.status !== 200) return;
    let paired = false;
    try {
      const withdrawal = request('withdrawal', account, data.token, 'workload', `${prefix}-w`);
      const validWithdrawal = balanceBody(withdrawal, 'withdrawal');
      paired = withdrawal.status === 200;
      successful = Boolean(validDeposit && validWithdrawal);
    } finally {
      if (!paired) unpairedDeposits.add(1);
    }
  } catch {
    // Do not log response bodies, authorization headers, or account identifiers.
    successful = false;
  } finally {
    workflowSuccess.add(successful);
    // Create the zero-valued metric as well, so its threshold is evaluated.
    if (config.workload === 'mixed') unpairedDeposits.add(0);
  }
}

export function teardown(data) {
  if (config.workload !== 'mixed') return;
  for (const id of config.accountIds) {
    let restored = false;
    try {
      const body = balanceBody(request('balance', id, data.token, 'verification'), 'final balance');
      restored = body !== null && body.balance === data.startingBalances[id];
    } catch { /* Recorded as a failed restoration below. */ }
    balanceRestored.add(restored);
  }
}

export function handleSummary(data) {
  const lines = [`Banking API: ${config.profile} / ${config.workload}`];
  const completed = data.metrics.iterations?.values.count || 0;
  lines.push(`Completed iterations: ${completed}`);
  if (completed === 0) lines.push('No workload completed. Check the process exit status and preflight errors.');
  for (const [name, metric] of Object.entries(data.metrics)) {
    if (!metric.thresholds) continue;
    for (const [expression, threshold] of Object.entries(metric.thresholds)) {
      lines.push(`${threshold.ok ? 'PASS' : 'FAIL'} ${name}: ${expression}`);
    }
    const values = metric.values;
    if (name.startsWith('http_req_duration')) {
      lines.push(`  p95=${values['p(95)'].toFixed(2)}ms p99=${values['p(99)'].toFixed(2)}ms`);
    }
  }
  const summaryPath = __ENV.SUMMARY_PATH || 'summary.json';
  lines.push(`Full metrics: ${summaryPath}`);
  // k6 includes setup return values in the summary, including the JWT and account IDs.
  // Export only aggregate results; never serialize setup_data.
  const { setup_data: privateSetupData, ...report } = data;
  const status = responseReportOutputs(data, {summaryPath, profile: config.profile, workload: config.workload,
    dashboardPath: __ENV.K6_WEB_DASHBOARD_EXPORT || ''});
  return {stdout: `${lines.join('\n')}\n${status.text}`, [summaryPath]: JSON.stringify(report, null, 2),
    [status.htmlPath]: status.html};
}
