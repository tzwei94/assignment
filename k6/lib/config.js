const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function integer(env, key, fallback) {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
}

function duration(value, key) {
  if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value) || !/[1-9]/.test(value)) {
    throw new Error(`${key} must be a positive k6 duration, for example 30s or 5m`);
  }
  return value;
}

export function configFromEnv(env) {
  const profile = env.PROFILE || 'smoke';
  const workload = env.WORKLOAD || 'balance';
  if (!['smoke', 'load', 'stress', 'soak'].includes(profile)) throw new Error('Unknown PROFILE');
  if (!['balance', 'mixed'].includes(workload)) throw new Error('WORKLOAD must be balance or mixed');
  if (workload === 'mixed' && env.ALLOW_WRITES !== 'true') throw new Error('Mixed workload requires ALLOW_WRITES=true');
  const baseUrl = (env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s@]+(?:\/[^?#\s]*)?$/.test(baseUrl)) {
    throw new Error('BASE_URL must be an HTTP(S) URL without credentials, query, or fragment');
  }
  const accountIds = (env.ACCOUNT_IDS || '00000000-0000-0000-0000-000000000001').split(',').map(id => id.trim());
  if (!accountIds.every(id => UUID.test(id))) throw new Error('ACCOUNT_IDS must contain comma-separated UUIDs');
  const amount = env.AMOUNT || '0.01';
  if (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/.test(amount) || Number(amount) < 0.01) {
    throw new Error('AMOUNT must be positive with at most 17 integer digits and 2 decimal places, without leading zeros');
  }
  const errorRate = Number(env.ERROR_RATE || '0.01');
  if (!Number.isFinite(errorRate) || errorRate <= 0 || errorRate > 1) throw new Error('ERROR_RATE must be greater than 0 and at most 1');
  const preAllocatedVUs = integer(env, 'PRE_ALLOCATED_VUS', 20);
  const maxVUs = integer(env, 'MAX_VUS', 200);
  if (maxVUs < preAllocatedVUs) throw new Error('MAX_VUS must be at least PRE_ALLOCATED_VUS');
  const stressRates = (env.STRESS_RATES || '10,25,50,100').split(',').map(value => {
    if (!value.trim()) throw new Error('STRESS_RATES must contain positive integers');
    return integer({ RATE: value }, 'RATE', 10);
  });
  return {
    baseUrl, profile, workload, accountIds, amount, errorRate, preAllocatedVUs, maxVUs, stressRates,
    rate: integer(env, 'RATE', 10),
    iterations: integer(env, 'SMOKE_ITERATIONS', 5),
    writeEvery: integer(env, 'WRITE_EVERY', 5),
    p95Ms: integer(env, 'P95_MS', 500),
    timeout: duration(env.REQUEST_TIMEOUT || '10s', 'REQUEST_TIMEOUT'),
    duration: duration(env.DURATION || (profile === 'soak' ? '30m' : '5m'), 'DURATION'),
    rampDuration: duration(env.RAMP_DURATION || '30s', 'RAMP_DURATION'),
    holdDuration: duration(env.HOLD_DURATION || '1m', 'HOLD_DURATION'),
    currency: env.CURRENCY || 'SGD',
  };
}

export function optionsFor(config) {
  let scenario;
  if (config.profile === 'smoke') {
    scenario = { executor: 'shared-iterations', vus: 1, iterations: config.iterations, maxDuration: '2m' };
  } else {
    scenario = { timeUnit: '1s', preAllocatedVUs: config.preAllocatedVUs, maxVUs: config.maxVUs };
    if (config.profile === 'stress') {
      Object.assign(scenario, {
        executor: 'ramping-arrival-rate', startRate: config.stressRates[0],
        stages: config.stressRates.flatMap(target => [
          { target, duration: config.rampDuration }, { target, duration: config.holdDuration },
        ]).concat([{ target: 0, duration: config.rampDuration }]),
      });
    } else Object.assign(scenario, { executor: 'constant-arrival-rate', rate: config.rate, duration: config.duration });
  }
  const thresholds = {
    workflow_success: ['rate>0.99'],
    'http_req_failed{phase:auth}': [`rate<${config.errorRate}`],
    dropped_iterations: ['count==0'],
  };
  const endpoints = config.workload === 'mixed' ? ['balance', 'deposit', 'withdrawal'] : ['balance'];
  for (const endpoint of endpoints) {
    const tags = `phase:workload,endpoint:${endpoint}`;
    thresholds[`http_req_duration{${tags}}`] = [`p(95)<${config.p95Ms}`];
    thresholds[`http_req_failed{${tags}}`] = [`rate<${config.errorRate}`];
  }
  if (config.workload === 'mixed') {
    thresholds.unpaired_deposits = ['count==0'];
    thresholds.balance_restored = ['rate==1'];
  }
  return {
    scenarios: { banking: { ...scenario, gracefulStop: '30s' } }, thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    // Omit URL tags so exported results do not contain account UUIDs.
    systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code', 'check'],
    tags: { project: 'banking-api', profile: config.profile, workload: config.workload },
  };
}
