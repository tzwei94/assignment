import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.env.K6_RUNNER_DIRECTORY || fileURLToPath(new URL('..', import.meta.url));
const keys = ['K6_WEB_DASHBOARD', 'K6_WEB_DASHBOARD_OPEN', 'K6_WEB_DASHBOARD_HOST',
  'K6_WEB_DASHBOARD_PORT', 'K6_WEB_DASHBOARD_EXPORT', 'SUMMARY_PATH'];

async function fixture(runner, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'k6-dashboard-launcher-'));
  try {
    await copyFile(join(source, runner), join(directory, runner));
    await mkdir(join(directory, 'bin'));
    await writeFile(join(directory, 'bin', 'k6'), `#!${process.execPath}\n` +
      `console.log('CAPTURE ' + JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key]]))));\n`, {mode: 0o700});
    await writeFile(join(directory, 'fixture.env'),
      "K6_WEB_DASHBOARD='true'\nK6_WEB_DASHBOARD_OPEN='true'\n" +
      "K6_WEB_DASHBOARD_HOST='127.0.0.1'\nK6_WEB_DASHBOARD_PORT='5665'\nK6_WEB_DASHBOARD_EXPORT='report.html'\n");
    const captures = [];
    for (let run = 0; run < 2; run++) {
      const result = spawnSync('bash', [join(directory, runner), 'smoke'], {
        encoding: 'utf8', env: {PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          ENV_FILE: join(directory, 'fixture.env'), ...overrides},
      });
      assert.equal(result.status, 0, result.stderr);
      captures.push(JSON.parse(result.stdout.split('\n').find(line => line.startsWith('CAPTURE ')).slice(8)));
    }
    return captures;
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

for (const runner of ['run.sh', 'run-cpu.sh']) {
  test(`${runner} passes localhost dashboard settings and allocates distinct HTML reports`, async () => {
    const [first, second] = await fixture(runner);
    assert.equal(first.K6_WEB_DASHBOARD, 'true');
    assert.equal(first.K6_WEB_DASHBOARD_OPEN, 'true');
    assert.equal(first.K6_WEB_DASHBOARD_HOST, '127.0.0.1');
    assert.equal(first.K6_WEB_DASHBOARD_PORT, '5665');
    assert.equal(first.K6_WEB_DASHBOARD_EXPORT, join(dirname(first.SUMMARY_PATH), 'report.html'));
    assert.notEqual(first.K6_WEB_DASHBOARD_EXPORT, second.K6_WEB_DASHBOARD_EXPORT);
  });

  test(`${runner} preserves explicit dashboard overrides and a custom HTML path`, async () => {
    const [result] = await fixture(runner, {K6_WEB_DASHBOARD: 'false',
      K6_WEB_DASHBOARD_OPEN: 'false', K6_WEB_DASHBOARD_PORT: '5666',
      K6_WEB_DASHBOARD_EXPORT: '/tmp/custom-k6-report.html'});
    assert.equal(result.K6_WEB_DASHBOARD, 'false');
    assert.equal(result.K6_WEB_DASHBOARD_OPEN, 'false');
    assert.equal(result.K6_WEB_DASHBOARD_PORT, '5666');
    assert.equal(result.K6_WEB_DASHBOARD_EXPORT, '/tmp/custom-k6-report.html');
  });

  test(`${runner} preserves an empty dashboard export and still isolates status reports`, async () => {
    const [first, second] = await fixture(runner, {K6_WEB_DASHBOARD_EXPORT: ''});
    assert.equal(first.K6_WEB_DASHBOARD_EXPORT, '');
    assert.equal(typeof first.SUMMARY_PATH, 'string');
    assert.notEqual(first.SUMMARY_PATH, second.SUMMARY_PATH);
  });
}
