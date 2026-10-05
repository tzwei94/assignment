// Fixed aggregate metric names only: never store URLs, headers, bodies or account IDs.
const statuses = [
  ['200', 'HTTP 200', 'response_status_200'],
  ['other2xx', 'Other HTTP 2xx', 'response_status_other_2xx'],
  ['3xx', 'HTTP 3xx', 'response_status_3xx'],
  ['401', 'HTTP 401 — unauthorized', 'response_status_401'],
  ['403', 'HTTP 403 — forbidden', 'response_status_403'],
  ['404', 'HTTP 404 — not found', 'response_status_404'],
  ['429', 'HTTP 429 — all', 'response_status_429'],
  ['other4xx', 'Other HTTP 4xx', 'response_status_other_4xx'],
  ['5xx', 'HTTP 5xx', 'response_status_5xx'],
  ['network', 'Network / request error — no HTTP response', 'response_status_network'],
  ['other', 'Other / unrecognized response', 'response_status_other'],
];

function statusKey(status) {
  if (status === 0) return 'network';
  if ([200, 401, 403, 404, 429].includes(status)) return String(status);
  if (Number.isInteger(status)) {
    if (status >= 200 && status < 300) return 'other2xx';
    if (status >= 300 && status < 400) return '3xx';
    if (status >= 400 && status < 500) return 'other4xx';
    if (status >= 500 && status < 600) return '5xx';
  }
  return 'other';
}

export function createResponseRecorder(Counter, Trend) {
  const total = new Counter('response_status_total');
  const counters = Object.fromEntries(statuses.map(([key, , name]) => [key, new Counter(name)]));
  const busy = new Counter('response_cpu_busy_429');
  const unexpected = new Counter('response_unexpected_429');
  const started = new Trend('response_window_start_ms');
  const finished = new Trend('response_window_end_ms');

  function record(response, endpoint, body, start, end) {
    total.add(1);
    counters[statusKey(response?.status)].add(1);
    if (response?.status === 429) {
      const confirmed = endpoint === 'cpu' && body?.code === 'cpu_demo_busy';
      (confirmed ? busy : unexpected).add(1);
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      started.add(start);
      finished.add(end);
    }
  }

  function capture(request, endpoint) {
    const start = Date.now();
    let response;
    try {
      response = request();
    } catch (error) {
      record({status: 0}, endpoint, null, start, Date.now());
      throw error;
    }
    const end = Date.now();
    let body = null;
    if (endpoint === 'cpu' && response?.status === 429) {
      try { body = response.json(); } catch { /* An invalid body is an unexpected 429. */ }
    }
    record(response, endpoint, body, start, end);
    return response;
  }
  return {record, capture};
}

function number(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function metricCount(metrics, name) {
  return number(metrics[name]?.values?.count) ?? 0;
}

export function responseSummary(data = {}) {
  const metrics = data.metrics || {};
  const available = number(metrics.response_status_total?.values?.count) !== null;
  const total = metricCount(metrics, 'response_status_total');
  const start = number(metrics.response_window_start_ms?.values?.min);
  const end = number(metrics.response_window_end_ms?.values?.max);
  const durationSeconds = start !== null && end !== null && end > start ? (end - start) / 1000 : null;
  const row = (key, label, name) => {
    const count = metricCount(metrics, name);
    return {key, label, count: available ? count : null,
      percentage: available && total > 0 ? 100 * count / total : null,
      requestsPerSecond: available && durationSeconds !== null ? count / durationSeconds : null};
  };
  const rows = statuses.map(([key, label, name]) => row(key, label, name));
  const accounted = rows.reduce((sum, item) => sum + (item.count || 0), 0);
  const failedThresholds = [];
  let thresholdsEvaluated = 0;
  for (const metric of Object.values(metrics)) {
    for (const threshold of Object.values(metric.thresholds || {})) {
      if (typeof threshold.ok !== 'boolean') continue;
      thresholdsEvaluated++;
      if (!threshold.ok) failedThresholds.push(false);
    }
  }
  const rate = name => {
    const values = metrics[name]?.values;
    if (values?.passes === 0 && values?.fails === 0) return null;
    const value = number(values?.rate);
    return value !== null && value <= 1 ? 100 * value : null;
  };
  return {available, total, rows, accounted, unaccounted: Math.max(0, total - accounted), durationSeconds,
    busy429: row('busy429', 'Confirmed CPU busy 429', 'response_cpu_busy_429'),
    unexpected429: row('unexpected429', 'Unexpected / other 429', 'response_unexpected_429'),
    rawHttpFailurePercent: rate('http_req_failed'), cpuUnexpectedPercent: rate('cpu_unexpected_error_rate'),
    cpuBusyPercent: rate('cpu_rejection_rate'),
    thresholdResult: failedThresholds.length ? 'FAIL' : thresholdsEvaluated ? 'PASS' : 'Not evaluated'};
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

function format(value, suffix = '') {
  return value === null ? '—' : `${value.toFixed(2)}${suffix}`;
}

function directory(path) {
  const position = path.lastIndexOf('/');
  return position < 0 ? '' : path.slice(0, position + 1);
}

export function responseReportOutputs(data, {summaryPath = 'summary.json', profile = '', workload = '', dashboardPath = ''} = {}) {
  const report = responseSummary(data);
  const prefix = directory(summaryPath);
  let htmlPath = `${prefix}status-report.html`;
  for (let index = 1; htmlPath === summaryPath || htmlPath === dashboardPath; index++) {
    htmlPath = `${prefix}response-status-report${index > 1 ? `-${index}` : ''}.html`;
  }
  const hasDashboardLink = dashboardPath === `${prefix}report.html` && dashboardPath !== htmlPath;
  const title = `${profile} / ${workload}`;
  const allRows = report.rows.flatMap(row => row.key === '429' ? [row, report.busy429, report.unexpected429] : [row]);
  const scope = 'This k6 run only: readiness, authentication, workload and final checks. This report does not include all ALB traffic or identify whether an HTTP response originated at the ALB or the app.';
  const rateBasis = report.durationSeconds === null
    ? 'Request window unavailable or zero-length; requests/sec is not calculated.'
    : `Requests/sec uses the ${format(report.durationSeconds)}s observed request window, from first request start to last request completion, including gaps between requests.`;
  const coverage = !report.available ? 'No status metrics were collected. This can happen before requests start or with older scripts.'
    : report.total === 0 ? 'No requests were recorded. A zero-iteration run may still include preflight requests when present.'
      : report.accounted !== report.total ? `Incomplete status metrics: ${report.accounted} of ${report.total} recorded requests are accounted for.` : '';
  const semantics = 'All table percentages use recorded requests as the denominator. The two 429 detail rows are subsets of HTTP 429 and are not additional requests. HTTP 200 describes the status only; response validation can still fail. Raw HTTP failures include confirmed busy 429s. CPU unexpected-error and busy rates use CPU attempts only; their thresholds, readiness guards and process exit status determine test success. Network/request errors have no HTTP response; request exceptions do not by themselves prove a network fault.';
  const lines = ['Response status breakdown', title.replace(/[\r\n]/g, ' '), scope,
    `Recorded requests: ${report.available ? report.total : 'unavailable'}. Thresholds: ${report.thresholdResult}`,
    'Status                                             Count        %      req/s'];
  for (const row of allRows) {
    lines.push(`${row.label.padEnd(50)} ${String(row.count ?? '—').padStart(6)} ${format(row.percentage, '%').padStart(8)} ${format(row.requestsPerSecond).padStart(10)}`);
  }
  lines.push(`Raw HTTP failure rate: ${format(report.rawHttpFailurePercent, '%')}`);
  if (workload === 'cpu') {
    lines.push(`CPU unexpected error rate: ${format(report.cpuUnexpectedPercent, '%')}`,
      `CPU busy rate (CPU attempts only): ${format(report.cpuBusyPercent, '%')}`);
  }
  if (coverage) lines.push(coverage);
  lines.push(rateBasis, semantics, `Status report: ${htmlPath}`);

  const table = allRows.map(row => `<tr${row.key === 'busy429' || row.key === 'unexpected429' ? ' class="detail"' : ''}><th scope="row">${escapeHtml(row.label)}</th><td>${row.count ?? '—'}</td><td>${format(row.percentage, '%')}</td><td>${format(row.requestsPerSecond)}</td></tr>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>k6 response status report</title>
<style>body{margin:0;background:#111827;color:#e5e7eb;font:16px/1.55 system-ui,sans-serif}main{max-width:1000px;margin:40px auto;padding:0 24px}h1{margin-bottom:4px}p{color:#cbd5e1}a{color:#93c5fd}section{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:20px;margin:20px 0}.cards{display:flex;gap:16px;flex-wrap:wrap}.card{flex:1;min-width:160px}.card strong{display:block;font-size:28px;color:#fff}.card span{font-size:14px;color:#cbd5e1}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:540px}caption{text-align:left;padding-bottom:12px}th,td{padding:10px 12px;border-bottom:1px solid #374151;text-align:right}th:first-child{text-align:left}thead{color:#fff}.detail th{padding-left:30px;font-weight:400;color:#cbd5e1}.warning{color:#fcd34d}.notes{font-size:14px}footer{font-size:14px;color:#cbd5e1}</style></head>
<body><main><h1>Response status report</h1><p>${escapeHtml(title)}</p><p>${escapeHtml(scope)}</p>
${hasDashboardLink ? '<p><a href="report.html">Open the built-in k6 dashboard report</a></p>' : ''}
<div class="cards"><section class="card"><span>Recorded requests</span><strong>${report.available ? report.total : '—'}</strong></section><section class="card"><span>Raw HTTP failure rate</span><strong>${format(report.rawHttpFailurePercent, '%')}</strong></section><section class="card"><span>Thresholds</span><strong>${report.thresholdResult}</strong></section></div>
${workload === 'cpu' ? `<section><strong>CPU unexpected error rate: ${format(report.cpuUnexpectedPercent, '%')}</strong><br>CPU busy rate (CPU attempts only): ${format(report.cpuBusyPercent, '%')}</section>` : ''}
${coverage ? `<p class="warning">${escapeHtml(coverage)}</p>` : ''}
<section class="table-wrap"><table><caption>Response counts for this run</caption><thead><tr><th scope="col">Status</th><th scope="col">Count</th><th scope="col">% of requests</th><th scope="col">Requests/sec</th></tr></thead><tbody>${table}</tbody></table></section>
<p class="notes">${escapeHtml(rateBasis)}</p><footer>${escapeHtml(semantics)} No credentials, response bodies or request URLs are included.</footer></main></body></html>`;
  return {htmlPath, html, text: `${lines.join('\n')}\n`, report};
}
