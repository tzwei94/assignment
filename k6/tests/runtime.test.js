import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('..', import.meta.url));
const account = '00000000-0000-0000-0000-000000000001';
const binary = process.env.K6_BIN || 'k6';

async function runFixture(overrides = {}, fault = '', runner = false) {
  let balance = 10000;
  let logins = 0;
  let reads = 0;
  const mutations = [];
  const cpuRequests = [];
  const tokens = new Map();
  const operations = new Map();
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/readyz') return send(200, { status: 'UP' });
    if (request.url === '/auth/token') {
      if (request.headers.authorization !== `Basic ${Buffer.from('fixture:fixture-password').toString('base64')}`) return send(401, {});
      const token = `fixture-token-${++logins}`;
      const lifetime = overrides.WORKLOAD === 'cpu' ? 900 : 2;
      tokens.set(token, Date.now() + lifetime * 1000);
      return send(200, { access_token: token, token_type: 'Bearer', expires_in: lifetime });
    }
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!tokens.has(token) || tokens.get(token) <= Date.now()) return send(401, {});
    if (request.url === '/demo/cpu' && request.method === 'POST') {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      cpuRequests.push(body.workMs);
      if (fault === 'cpu-disabled') return send(404, { code: 'cpu_demo_disabled' });
      if (fault === 'cpu-rejections' && cpuRequests.length % 3 === 0) return send(429, { code: 'cpu_demo_busy' });
      return send(200, { workMs: body.workMs, elapsedMs: body.workMs, cpuMs: body.workMs,
        iterations: 256, checksum: 'a'.repeat(64), stopReason: 'deadline' });
    }
    if (request.url === `/accounts/${account}/balance`) {
      reads++;
      if (reads > 1 && fault === 'server-error') return send(500, { code: 'internal_error' });
      if (reads > 1 && fault === 'bad-body') return send(200, { currency: 'SGD' });
      return send(200, { balance: balance / 100, currency: 'SGD' });
    }
    const match = request.url.match(new RegExp(`^/accounts/${account}/(deposits|withdrawals)$`));
    if (!match || request.method !== 'POST') return send(404, {});
    const kind = match[1];
    const key = request.headers['idempotency-key'];
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key || '')) return send(400, {});
    const amount = Math.round(JSON.parse(Buffer.concat(chunks).toString()).amount * 100);
    if (operations.has(key)) return send(200, operations.get(key));
    if (kind === 'withdrawals' && fault === 'withdrawal-error') return send(500, {});
    balance += kind === 'deposits' ? amount : -amount;
    mutations.push({ kind, key, amount });
    const body = { balance: balance / 100, currency: 'SGD' };
    operations.set(key, body);
    send(200, body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'banking-k6-test-'));
  try {
    const envFile = join(outputDirectory, 'fixture.env');
    await writeFile(envFile, "BASE_URL='http://127.0.0.1:1'\nTOKEN_USERNAME='wrong'\nTOKEN_PASSWORD='wrong'\nPROFILE='stress'\nCPU_WORK_MS='100'\nCPU_RATE='1'\nCPU_DURATION_SECONDS='1'\n");
    const child = spawn(runner ? 'bash' : binary, runner ? ['run.sh', typeof runner === 'string' ? runner : 'smoke'] : ['run', '--quiet', 'banking.js'], {
      cwd: directory,
      env: {
        ...process.env, BASE_URL: `http://127.0.0.1:${server.address().port}`,
        TOKEN_USERNAME: 'fixture', TOKEN_PASSWORD: 'fixture-password',
        PROFILE: 'smoke', WORKLOAD: 'balance', ALLOW_WRITES: 'false', ACCOUNT_IDS: account,
        SUMMARY_PATH: join(outputDirectory, 'summary.json'),
        K6_BIN: binary, ENV_FILE: envFile,
        ...overrides,
      },
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    let summary = null;
    try { summary = JSON.parse(await readFile(join(outputDirectory, 'summary.json'), 'utf8')); } catch {}
    return { exitCode, output, summary, balance, logins, reads, mutations, cpuRequests };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test('real k6 smoke reads the account without mutation or credential exports', async () => {
  const result = await runFixture();
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.reads >= 6);
  assert.equal(result.mutations.length, 0);
  assert.ok(result.summary);
  const serialized = JSON.stringify(result.summary);
  assert.ok(!serialized.includes('fixture-password'));
  assert.ok(!serialized.includes('fixture-token'), `Summary top-level keys: ${Object.keys(result.summary).join(', ')}`);
  assert.ok(!serialized.includes(account));
});

test('mixed workload pairs writes, restores balance, and never reuses a key', async () => {
  const result = await runFixture({ WORKLOAD: 'mixed', ALLOW_WRITES: 'true', SMOKE_ITERATIONS: '10', WRITE_EVERY: '1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.balance, 10000);
  assert.equal(result.mutations.length, 20);
  assert.equal(new Set(result.mutations.map(item => item.key)).size, 20);
});

test('arrival-rate workload refreshes expired short-lived tokens', async () => {
  const result = await runFixture({ PROFILE: 'load', RATE: '5', DURATION: '4s', PRE_ALLOCATED_VUS: '1', MAX_VUS: '2' });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.logins >= 3, `Expected refreshes, got ${result.logins}`);
  assert.ok(result.reads >= 16);
});

test('stress profile runs ramp, hold, and recovery stages in real k6', async () => {
  const result = await runFixture({ PROFILE: 'stress', STRESS_RATES: '2,4', RAMP_DURATION: '1s', HOLD_DURATION: '1s', PRE_ALLOCATED_VUS: '2', MAX_VUS: '4' });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.reads > 5);
});

test('HTTP server failures make k6 exit unsuccessfully', async () => {
  const result = await runFixture({}, 'server-error');
  assert.equal(result.exitCode, 99, result.output);
});

test('a malformed success response fails workflow thresholds', async () => {
  const result = await runFixture({}, 'bad-body');
  assert.equal(result.exitCode, 99, result.output);
});

test('failed withdrawals expose unfinished pairs and balance drift', async () => {
  const result = await runFixture({ WORKLOAD: 'mixed', ALLOW_WRITES: 'true' }, 'withdrawal-error');
  assert.equal(result.exitCode, 99, result.output);
  assert.ok(result.balance > 10000);
  assert.equal(result.summary.metrics.unpaired_deposits.values.count, 1);
  assert.equal(result.summary.metrics.balance_restored.values.rate, 0);
});

test('run.sh preserves explicit environment overrides and selects the requested profile', async () => {
  const result = await runFixture({}, '', true);
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.summary);
  assert.equal(result.summary.metrics.iterations.values.count, 5);
});

test('CPU workload smoke targets only POST /demo/cpu and redacts its summary', async () => {
  const result = await runFixture({ WORKLOAD: 'cpu', CPU_WORK_MS: '50' }, '', 'smoke');
  assert.equal(result.exitCode, 0, result.output);
  assert.deepEqual(result.cpuRequests, [50]);
  assert.equal(result.reads, 0);
  assert.equal(result.mutations.length, 0);
  assert.ok(result.summary);
  assert.ok(!JSON.stringify(result.summary).includes('fixture-token'));
  assert.ok(!JSON.stringify(result.summary).includes('fixture-password'));
});

test('CPU stress selects sustained load, honors CPU settings, and records bounded rejections', async () => {
  const result = await runFixture({ WORKLOAD: 'cpu', CPU_WORK_MS: '500', CPU_RATE: '4', CPU_DURATION_SECONDS: '3', CPU_MAX_VUS: '8' }, 'cpu-rejections', 'stress');
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.cpuRequests.length >= 10);
  assert.ok(result.cpuRequests.every(workMs => workMs === 500));
  assert.equal(result.reads, 0);
  assert.ok(result.summary.metrics.cpu_rejected.values.count > 0);
  assert.equal(result.summary.metrics.cpu_unexpected_error_rate.values.rate, 0);
  // Expected busy responses remain visible in raw HTTP failure accounting.
  assert.ok(result.summary.metrics.http_req_failed.values.rate > 0);
});

test('CPU workload aborts when the deployment has the demo disabled', async () => {
  const result = await runFixture({ WORKLOAD: 'cpu', CPU_WORK_MS: '50' }, 'cpu-disabled', 'smoke');
  assert.notEqual(result.exitCode, 0, result.output);
  assert.equal(result.reads, 0);
  assert.match(result.output, /Unexpected CPU response \(HTTP 404\)/);
});
