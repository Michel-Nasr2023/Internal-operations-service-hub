#!/usr/bin/env node
// Final smoke test: runs the critical user journey against a running hub (live or local) and stops at the
// first failure. It creates one ticket titled "Smoke test <time>" and takes it from submission to Resolved.
//
//   npm run smoke -- https://your-hub.example.org
//
// The API is expected at <url>/api; set SMOKE_API_URL when it is elsewhere (local development:
// SMOKE_API_URL=http://localhost:3000/api npm run smoke -- http://localhost:5173).
// Uses the development accounts unless SMOKE_EMPLOYEE / SMOKE_HELPDESK are set as "email:password".

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!base) {
  console.error('Usage: npm run smoke -- <app url>   e.g. npm run smoke -- https://your-hub.example.org');
  process.exit(2);
}
const api = (process.env.SMOKE_API_URL ?? `${base}/api`).replace(/\/+$/, '');
const credentials = (value, fallback) => {
  const [email, ...password] = (value ?? fallback).split(':');
  return { email, password: password.join(':') };
};
const employeeLogin = credentials(process.env.SMOKE_EMPLOYEE, 'employee@company.com:employee123');
const helpdeskLogin = credentials(process.env.SMOKE_HELPDESK, 'helpdesk@company.com:helpdesk123');
const AI_WAIT_MS = 150_000;
const started = Date.now();

class SmokeFailure extends Error {}

function check(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

function pass(step, detail) {
  console.log(`✓ ${step}${detail ? ` - ${detail}` : ''}`);
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch((error) => {
    throw new SmokeFailure(`${method} ${path} could not reach the server (${error.cause?.code ?? error.name})`);
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function signIn(login, role) {
  const { status, data } = await call('POST', '/auth/login', { body: login });
  check(status === 201 && data?.token && data.role === role, `${role} sign-in failed (${status}: ${data?.message ?? 'no answer'})`);
  return data;
}

async function main() {
  console.log(`Smoke test of ${base} (API ${api})\n`);

  const health = await call('GET', '/health');
  check(health.status === 200 && health.data?.status === 'ok', `health check answered ${health.status}`);
  check(health.data.ai !== 'not-configured', 'the AI is not configured on the server (RQSTY_API_KEY missing)');
  pass('Health', `database ${health.data.database}, AI ${health.data.ai}, email ${health.data.email}`);

  const page = await fetch(base, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const html = page ? await page.text() : '';
  check(page?.status === 200 && html.includes('id="root"'), `the web app did not load (${page?.status ?? 'unreachable'})`);
  pass('Web app loads');

  const employee = await signIn(employeeLogin, 'employee');
  const helpdesk = await signIn(helpdeskLogin, 'helpdesk');
  pass('Sign-in', 'Employee and Helpdesk');

  const anonymous = await call('GET', '/tickets');
  check(anonymous.status === 401, `a request without a session answered ${anonymous.status} instead of 401`);
  pass('Refused without a session', '401');

  const key = `smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const submission = {
    title: `Smoke test ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    description: 'Automated smoke test: the office printer on floor 2 shows a paper jam error after every page.',
    teamId: 'it',
    issueType: 'hardware',
    project: 'Floor 2 printer',
  };
  const created = await call('POST', '/tickets', { token: employee.token, body: submission, headers: { 'Idempotency-Key': key } });
  check(created.status === 201 && created.data?.status === 'Pending Helpdesk Review', `ticket submission answered ${created.status}: ${created.data?.message ?? ''}`);
  const ticketId = created.data.id;
  const ref = ticketId.slice(0, 8);
  pass('Ticket submitted', `ticket ${ref}, Pending Helpdesk Review`);

  const repeated = await call('POST', '/tickets', { token: employee.token, body: submission, headers: { 'Idempotency-Key': key } });
  check(repeated.status === 201 && repeated.data?.id === ticketId, 'sending the same submission again created a second ticket');
  pass('Repeated submission', 'same ticket returned, no duplicate');

  const refused = await call('POST', `/tickets/${ticketId}/approve`, { token: employee.token, body: { priority: 'medium' } });
  check(refused.status === 403, `an employee approving a ticket answered ${refused.status} instead of 403`);
  pass('Rejected action', 'employee cannot approve (403)');

  const approved = await call('POST', `/tickets/${ticketId}/approve`, {
    token: helpdesk.token,
    body: { priority: 'medium', assigneeId: employee.id, expectedDurationHours: 1 },
  });
  check(approved.status === 201 && approved.data?.status === 'Assigned', `approve and assign answered ${approved.status}: ${approved.data?.message ?? ''}`);
  pass('Helpdesk approved and assigned', 'Assigned');

  const claimed = await call('POST', `/tickets/${ticketId}/claim`, { token: employee.token });
  check(claimed.status === 201 && claimed.data?.status === 'In Progress', `claim answered ${claimed.status}: ${claimed.data?.message ?? ''}`);
  const resolved = await call('POST', `/tickets/${ticketId}/resolve`, { token: employee.token, body: { feedback: 'Smoke test: cleared the paper path and printed a test page.' } });
  check(resolved.status === 201 && resolved.data?.status === 'Resolved', `resolve answered ${resolved.status}: ${resolved.data?.message ?? ''}`);
  pass('Assignee claimed and resolved', 'Resolved');

  const history = await call('GET', `/tickets/${ticketId}/audit-events`, { token: employee.token });
  const actions = Array.isArray(history.data) ? history.data.map((event) => event.action) : [];
  for (const action of ['TICKET_SUBMITTED', 'TICKET_APPROVED', 'TICKET_ASSIGNED', 'TICKET_CLAIMED', 'TICKET_RESOLVED']) {
    check(actions.includes(action), `the ticket history is missing ${action}`);
  }
  pass('History recorded', actions.join(' > '));

  // The AI runs in the background; by now it has usually finished.
  let analysis;
  for (const deadline = Date.now() + AI_WAIT_MS; Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 3000))) {
    analysis = (await call('GET', `/tickets/${ticketId}`, { token: helpdesk.token })).data?.aiResult;
    if (analysis && analysis.source !== 'pending') break;
  }
  check(analysis && analysis.source !== 'pending', `the AI analysis did not finish within ${AI_WAIT_MS / 1000} s`);
  check(analysis.source === 'ai', `the AI analysis failed: ${analysis.failureReason ?? analysis.failureCode}`);
  pass('AI analysis', `${analysis.issueType}, ${analysis.severity} severity: "${analysis.summary}"`);

  console.log(`\nSMOKE PASSED in ${((Date.now() - started) / 1000).toFixed(1)} s (ticket ${ref}).`);
}

main().catch((error) => {
  console.log(`✗ ${error instanceof SmokeFailure ? error.message : `unexpected error: ${error.message}`}`);
  console.log('\nSMOKE FAILED: NO-GO until this is fixed.');
  process.exit(1);
});
