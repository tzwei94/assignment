// Runs the real scripts against in-memory responses. No sockets or k6 process.
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import vm from 'node:vm';

const [root, workload, fault = ''] = process.argv.slice(2);
const samples = new Map();
let clock = 1000;
let cpuAttempt = 0;
let bankRead = 0;
let expected = status => status >= 200 && status < 400;
class Counter {
  constructor(name) {this.name = name; samples.set(name, {type: 'counter', values: []});}
  add(value) {samples.get(this.name).values.push(value);}
}
class Rate extends Counter {
  constructor(name) {super(name); samples.get(name).type = 'rate';}
}
class Trend extends Counter {
  constructor(name) {super(name); samples.get(name).type = 'trend';}
}
const rawFailed = new Rate('http_req_failed');
const rawRequests = new Counter('http_reqs');
const request = (method, url) => {
  let status = 200;
  let body = {status: 'UP'};
  if (url.endsWith('/readyz')) {
    if (fault === 'readiness-429') {status = 429; body = {code: 'cpu_demo_busy'};}
  } else if (url.endsWith('/auth/token')) {
    status = fault === 'auth-401' ? 401 : 200;
    body = {access_token: 'SECRET-FIXTURE-TOKEN', token_type: 'Bearer', expires_in: 900};
  } else if (url.endsWith('/demo/cpu')) {
    cpuAttempt++;
    if (fault === 'request-throws') throw new Error('Synthetic request exception');
    body = {workMs: 50, iterations: 256, checksum: 'a'.repeat(64)};
    if (fault === 'busy' && cpuAttempt === 4) {status = 429; body = {code: 'cpu_demo_busy'};}
    if (fault === 'unexpected-429') {status = 429; body = {code: 'other_limit'};}
    if (fault === 'malformed-429') {status = 429; body = null;}
    if (fault === 'disabled-404') {status = 404; body = {code: 'cpu_demo_disabled'};}
    if (fault === 'server-500') {status = 500; body = {code: 'internal_error'};}
    if (fault === 'network') {status = 0; body = null;}
    if (fault === 'invalid-200') body = {balance: 1};
  } else if (url.endsWith('/balance')) {
    bankRead++;
    body = {balance: 100, currency: 'SGD'};
    if (bankRead > 1 && fault === 'bank-403') {status = 403; body = {};}
    if (bankRead > 1 && fault === 'bank-429') {status = 429; body = {code: 'cpu_demo_busy'};}
  } else throw new Error('Unexpected fixture endpoint');
  rawRequests.add(1);
  rawFailed.add(!expected(status));
  return {status, timings: {duration: 5}, url: `${url}?secret=SECRET-QUERY`, body: 'SECRET-RESPONSE-BODY',
    json() {if (body === null) throw new Error('Malformed JSON'); return body;}};
};
const http = {get: url => request('GET', url), post: url => request('POST', url), request,
  expectedStatuses: (...statuses) => status => statuses.includes(status),
  setResponseCallback: callback => {expected = callback;}};
const context = vm.createContext({__ENV: {BASE_URL: 'https://fixture.invalid', TOKEN_USERNAME: 'synthetic',
  TOKEN_PASSWORD: 'SECRET-FIXTURE-PASSWORD', PROFILE: 'load', WORKLOAD: 'balance', CPU_PROFILE: 'load',
  CPU_WORK_MS: '50', CPU_DURATION_SECONDS: '1', SUMMARY_PATH: '/tmp/fixture/summary.json',
  K6_WEB_DASHBOARD_EXPORT: '/tmp/fixture/report.html'},
  Date: class extends Date {static now() {clock += 100; return clock;}}, console});
const k6 = {check: (response, checks) => Object.values(checks).every(check => check(response)), sleep() {}};
const execution = {test: {abort: message => {throw new Error(message);}}, scenario: {iterationInTest: 0}, vu: {idInTest: 1}};
const stubs = {'k6/http': {default: http}, 'k6/encoding': {default: {b64encode: () => 'synthetic-basic'}},
  'k6/execution': {default: execution}, 'k6': k6, 'k6/metrics': {Counter, Rate, Trend}};
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = new vm.SourceTextModule(await readFile(path, 'utf8'), {context, identifier: path});
  cache.set(path, module);
  await module.link(async specifier => {
    if (stubs[specifier]) {
      const values = stubs[specifier];
      return new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, {context});
    }
    return load(resolve(dirname(path), specifier));
  });
  return module;
}
const module = await load(resolve(root, workload === 'cpu' ? 'cpu-demo.js' : 'banking.js'));
await module.evaluate();
let aborted = false;
let abortedReason = '';
let iterations = 0;
let setup;
try {
  setup = module.namespace.setup();
  for (let index = 0; index < 4; index++) {
    if (workload === 'cpu') module.namespace.cpu(setup);
    else module.namespace.default(setup);
    iterations++;
  }
  module.namespace.teardown(setup);
} catch (error) {aborted = true; abortedReason = error.message;}
const metrics = {};
for (const [name, metric] of samples) {
  if (!metric.values.length) continue;
  const values = metric.type === 'counter' ? {count: metric.values.reduce((sum, value) => sum + Number(value), 0)}
    : metric.type === 'rate' ? {rate: metric.values.filter(Boolean).length / metric.values.length,
      passes: metric.values.filter(Boolean).length, fails: metric.values.filter(value => !value).length}
      : {min: Math.min(...metric.values), max: Math.max(...metric.values)};
  metrics[name] = {values};
}
metrics.iterations = {values: {count: iterations}};
for (const name of ['cpu_unexpected_error_rate', 'cpu_rejection_rate', 'workflow_success']) {
  if (!metrics[name]) continue;
  const threshold = name === 'cpu_unexpected_error_rate' ? 'rate<0.01'
    : name === 'cpu_rejection_rate' ? 'rate<0.5' : 'rate>0.99';
  const value = metrics[name].values.rate;
  const ok = name === 'cpu_unexpected_error_rate' ? value < 0.01
    : name === 'cpu_rejection_rate' ? value < 0.5 : value > 0.99;
  metrics[name].thresholds = {[threshold]: {ok}};
}
const outputs = module.namespace.handleSummary({metrics, state: {testRunDurationMs: 1000}, setup_data: setup});
const htmlPath = Object.keys(outputs).find(path => path.endsWith('.html'));
console.log(JSON.stringify({aborted, abortedReason, iterations, outputs, htmlPath,
  summary: JSON.parse(outputs['/tmp/fixture/summary.json'])}));
