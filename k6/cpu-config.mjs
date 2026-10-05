function integer(env, key, fallback, minimum, maximum) {
  const raw = env[key] === undefined || env[key] === '' ? String(fallback) : env[key];
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function cpuConfig(env) {
  const profile = env.CPU_PROFILE || 'smoke';
  if (!['smoke', 'load'].includes(profile)) throw new Error('CPU_PROFILE must be smoke or load');
  const baseUrl = (env.BASE_URL || '').replace(/\/$/, '');
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::(\d+))?$/.exec(baseUrl);
  if (!match || (match[1] === 'http' && !['localhost', '127.0.0.1', '[::1]'].includes(match[2].toLowerCase()))) {
    throw new Error('Set BASE_URL to an HTTPS origin, or loopback HTTP; credentials, paths and query strings are forbidden');
  }
  return {
    baseUrl, profile,
    workMs: integer(env, 'CPU_WORK_MS', profile === 'smoke' ? 50 : 500, 50, 500),
    rate: integer(env, 'CPU_RATE', 4, 1, 4),
    maxVus: integer(env, 'CPU_MAX_VUS', 8, 2, 8),
    duration: integer(env, 'CPU_DURATION_SECONDS', 300, 1, 300),
  };
}

export function cpuOptions(config) {
  const scenarios = config.profile === 'smoke'
    ? { cpu: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '10s', exec: 'cpu' } }
    : {
      cpu: { executor: 'constant-arrival-rate', rate: config.rate, timeUnit: '1s',
        duration: `${config.duration}s`, preAllocatedVUs: Math.min(4, config.maxVus - 1),
        maxVUs: config.maxVus - 1, gracefulStop: '2s', exec: 'cpu' },
      health: { executor: 'constant-vus', vus: 1, duration: `${config.duration}s`, gracefulStop: '0s', exec: 'health' },
    };
  return {
    scenarios, setupTimeout: '10s', teardownTimeout: '5s',
    systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
    thresholds: {
      cpu_unexpected_error_rate: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '15s' }],
      cpu_rejection_rate: [{ threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '15s' }],
      'http_req_duration{endpoint:cpu}': [{ threshold: 'p(95)<1500', abortOnFail: true, delayAbortEval: '15s' }],
      dropped_iterations: ['count==0'],
    },
  };
}
