// node tests/jev-api.js — the Jev-compatible API: wire format, validation, HTTP surface, client, NLBoard.prime,
// and (when an interpreter with the official `typesafe-sdk` is available) conformance with the OFFICIAL models and client.
//   SDK_PYTHON=/path/to/venv/bin/python node tests/jev-api.js     (uv venv v && VIRTUAL_ENV=v uv pip install typesafe-sdk)
const assert = require('assert');
const cp = require('child_process'), http = require('http'), path = require('path');
const Jev = require('../src/jev.js'), JevClient = require('../src/jev-client.js'), NL = require('../src/nlboard.js');
const { createServer } = require('../tools/jev-server.js');

let n = 0, failed = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const listen = (server) => new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise(r => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); });
const { OK, BAD, STRICTER, GOOD } = require('./jev-fixtures.js');
const ids = (errs) => errs.map(e => JSON.stringify([e.type, ...e.loc])).sort();

/* ---------- engine: the three answer shapes ---------- */
test('noul answers carry only {type, noul}; choice and score carry what the API documents', () => {
  const r = Jev.systemOne({ state: 'I was charged twice. Please help.', model: 'jev-latest', questions: {
    billing: { type: 'noul', criteria: { true: ['charged twice', 'invoice'], false: ['password reset'] } },
    tone: { type: 'choice', criteria: { calm: ['thanks'], angry: ['please help', 'charged twice'] } },
    urgency: { type: 'score', criteria: ['can wait', 'this week', ['please help', 'asap']] } } });
  assert.deepEqual(Object.keys(r).sort(), ['answers', 'model', 'usage']);
  assert.equal(r.model, 'jev-local-1');
  assert.deepEqual(Object.keys(r.answers.billing).sort(), ['noul', 'type']); assert.ok(r.answers.billing.noul > 0.9);
  assert.deepEqual(Object.keys(r.answers.tone).sort(), ['choice', 'confidence', 'probabilities', 'type']); assert.equal(r.answers.tone.choice, 'angry');
  const u = r.answers.urgency; assert.deepEqual(Object.keys(u).sort(), ['confidence', 'legend', 'probabilities', 'score', 'type']);
  assert.deepEqual(Object.keys(u.legend), ['0', '1', '2']); assert.deepEqual(u.legend['2'], ['please help', 'asap']);
  const expected = Object.keys(u.probabilities).reduce((s, k) => s + (+k) * u.probabilities[k], 0);
  assert.ok(Math.abs(expected - u.score) < 0.001, 'score is the probability-weighted level');
  assert.ok(Math.abs(Object.values(r.answers.tone.probabilities).reduce((a, b) => a + b, 0) - 1) < 0.01);
  assert.ok(Number.isInteger(r.usage.input_tokens) && r.usage.input_tokens > 0 && r.usage.output_tokens === 3);
});
test('criteria can be text, arrays or objects (the documented {meaning, examples} form); a bare label counts as an example', () => {
  const ask = (state, criteria) => Jev.systemOne({ state, model: 'jev-latest', questions: { q: { type: 'choice', criteria } } }).answers.q.choice;
  assert.equal(ask('refund my money', { billing: 'refund my money', other: 'something else' }), 'billing');
  assert.equal(ask('refund my money', { billing: { meaning: 'payments', examples: ['refund my money'] }, other: null }), 'billing');
  assert.equal(ask('I need technical support', { billing: null, technical: null, other: null }), 'technical');
  assert.equal(ask('xyz', { a: null, b: null }), 'a');                                    // nothing matches: the first label, with a flat distribution
  assert.ok(Jev.systemOne({ state: 'xyz', model: 'jev-latest', questions: { q: { type: 'choice', criteria: { a: null, b: null } } } }).answers.q.confidence < 0.1);
});
test('state may be text, an object or an array; answers do not depend on the other questions', () => {
  const q = { type: 'choice', criteria: { a: ['alpha beta'], b: ['gamma delta'] } };
  const one = (state, extra) => Jev.systemOne({ state, model: 'jev-latest', questions: Object.assign({ q }, extra) }).answers.q;
  assert.equal(one('alpha beta').choice, 'a'); assert.equal(one({ note: 'gamma delta' }).choice, 'b'); assert.equal(one(['gamma', 'delta']).choice, 'b');
  assert.deepEqual(one('alpha beta'), one('alpha beta', { extra: { type: 'noul', instructions: 'Is it?' } }));
});
test('noul: one described side, both sides, and instructions only ("unsure")', () => {
  const noul = (state, criteria, instructions) => Jev.systemOne({ state, model: 'jev-latest', questions: { q: { type: 'noul', criteria, instructions } } }).answers.q.noul;
  assert.ok(noul('is not in the set', { true: ['is not in', 'not in'] }) > 0.5); assert.ok(noul('hello', { true: ['is not in'] }) < 0.5);
  assert.ok(noul('x is in y', { true: ['not in'], false: ['is in'] }) < 0.5); assert.ok(noul('x not in y', { true: ['not in'], false: ['is in'] }) > 0.5);
  assert.equal(noul('anything', undefined, 'Is it spam?'), 0.5);
});

/* ---------- validation: same error lists as the official pydantic models ---------- */
test('every malformed request is rejected with a 422 error list', () => {
  BAD.concat(STRICTER).forEach(([name, body]) => { const e = Jev.validate(body); assert.ok(e.length, name); e.forEach(x => { assert.ok(x.type && Array.isArray(x.loc) && x.loc[0] === 'body' && typeof x.msg === 'string', name); }); });
  GOOD.forEach(b => assert.deepEqual(Jev.validate(b), []));
  assert.equal(Jev.validate([1])[0].type, 'model_attributes_type');
});

/* ---------- the HTTP surface (no sockets) ---------- */
test('handle(): routes, auth, CORS, JSON errors, request ids', () => {
  const body = JSON.stringify(OK({ questions: { a: { type: 'choice', criteria: { x: null, y: null } } } }));
  let r = Jev.handle({ method: 'POST', path: '/v1/systemone', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'application/json'); assert.ok(/^req_/.test(r.headers['x-typesafe-request-id'])); assert.equal(r.body.model, 'jev-local-1');
  r = Jev.handle({ method: 'GET', path: '/v1/models' }); assert.equal(r.status, 200); assert.deepEqual(r.body.models.map(m => Object.keys(m).sort().join()), Array(2).fill('description,name,release_date'));
  assert.ok(r.body.models.some(m => m.name === 'jev-latest'));
  r = Jev.handle({ method: 'GET', path: '/v2/nothing' }); assert.equal(r.status, 404);
  r = Jev.handle({ method: 'GET', path: '/v1/systemone' }); assert.equal(r.status, 405); assert.equal(r.headers.allow, 'POST');
  r = Jev.handle({ method: 'POST', path: '/v1/systemone/', body: '{nope' }); assert.equal(r.status, 422); assert.equal(r.body.detail[0].type, 'json_invalid'); assert.deepEqual(r.body.detail[0].loc, ['body', 0]);
  r = Jev.handle({ method: 'POST', path: '/v1/systemone', body: JSON.stringify(OK({ model: 'gpt-4' })) }); assert.equal(r.status, 404); assert.ok(/gpt-4/.test(r.body.detail));
  r = Jev.handle({ method: 'POST', path: '/v1/systemone', body: JSON.stringify(OK({ model: 'jev-latest' })) }, { apiKeys: ['k'] }); assert.equal(r.status, 401);
  r = Jev.handle({ method: 'POST', path: '/v1/systemone', headers: { authorization: 'Bearer k' }, body: JSON.stringify(OK({})) }, { apiKeys: ['k'] }); assert.equal(r.status, 200);
  r = Jev.handle({ method: 'OPTIONS', path: '/v1/systemone' }, { apiKeys: ['k'] }); assert.equal(r.status, 204); assert.ok(/authorization/.test(r.headers['access-control-allow-headers']));
  const a = Jev.handle({ method: 'GET', path: '/v1/models' }).headers['x-typesafe-request-id'], b = Jev.handle({ method: 'GET', path: '/v1/models' }).headers['x-typesafe-request-id']; assert.notEqual(a, b);
});

/* ---------- client + server over real HTTP ---------- */
test('client ↔ server: answers, models, typed errors, no retry on 4xx', async () => {
  const server = createServer({ quiet: true }), url = await listen(server);
  try {
    const sleeps = [], c = new JevClient({ apiKey: 'k', baseUrl: url, sleep: ms => { sleeps.push(ms); return Promise.resolve(); } });
    const r = await c.systemOne({ state: 'move PTR to NUM', questions: { intent: JevClient.choice({ assign: ['move PTR to NUM'], push: ['push NUM onto STK'] }, 'What?'), neg: JevClient.noul('Negated?', { true: ['not'], false: ['is'] }), step: JevClient.score(['left', 'set', 'right']) } });
    assert.equal(r.model, 'jev-local-1'); assert.equal(r.choices.intent.choice, 'assign'); assert.ok(r.nouls.neg.noul <= 0.5); assert.ok(r.scores.step.score >= 0 && r.scores.step.score <= 2); assert.ok(r.usage.input_tokens > 0);
    assert.deepEqual((await c.models.list()).models.map(m => m.name), ['jev-latest', 'jev-local-1']);
    await assert.rejects(() => c.systemOne({ state: 'x', questions: { a: { type: 'bogus' } } }), e => e instanceof JevClient.JevUnprocessableEntityError && e.status === 422 && /questions\.a/.test(e.message) && e.requestId && e.body.detail[0].type === 'union_tag_invalid');
    await assert.rejects(() => c.systemOne({ state: 'x', model: 'nope', questions: { a: JevClient.noul('x?') } }), e => e instanceof JevClient.JevNotFoundError && /nope/.test(e.message));
    await assert.rejects(() => c.systemOne({ state: 'x', questions: {} }), e => e instanceof JevClient.JevError && /At least one question/.test(e.message));
    assert.equal(sleeps.length, 0);                                                                     // 4xx is never retried
    assert.equal(server.requestLog.filter(l => l.method === 'POST').length, 3);                         // ok + 422 + 404; the empty-questions call never leaves the client
  } finally { await close(server); }
});
test('client: API key checks, 401 with a key-protected server', async () => {
  assert.throws(() => new JevClient({ apiKey: '' }), /No API key/); assert.throws(() => new JevClient({ apiKey: 'a b' }), /printable ASCII/);
  const server = createServer({ quiet: true, apiKeys: ['secret'] }), url = await listen(server);
  try {
    await assert.rejects(() => new JevClient({ apiKey: 'wrong', baseUrl: url, retry: { maxRetries: 0 } }).models.list(), e => e instanceof JevClient.JevAuthenticationError && e.status === 401);
    assert.ok((await new JevClient({ apiKey: 'secret', baseUrl: url }).models.list()).models.length);
  } finally { await close(server); }
});
test('client: retries 429 and 5xx honouring retry-after-ms / retry-after, then gives up with the typed error', async () => {
  let fails = 2, headers = { 'retry-after-ms': '20' };
  const server = createServer({ quiet: true, onRequest: () => fails-- > 0 ? { status: 429, headers: Object.assign({ 'content-type': 'application/json' }, headers), body: { detail: 'Rate limit exceeded' } } : undefined }), url = await listen(server);
  try {
    const sleeps = [], mk = (retry) => new JevClient({ apiKey: 'k', baseUrl: url, retry, sleep: ms => { sleeps.push(ms); return Promise.resolve(); } });
    const q = { a: JevClient.choice({ x: null, y: null }) };
    assert.ok((await mk({}).systemOne({ state: 'hi', questions: q })).choices.a);
    assert.deepEqual(sleeps, [20, 20]);
    fails = 5; headers = { 'retry-after': '1' }; sleeps.length = 0;
    await assert.rejects(() => mk({ maxRetries: 1 }).systemOne({ state: 'hi', questions: q }), e => e instanceof JevClient.JevRateLimitError && e.retryAfterMs === 1000);
    assert.deepEqual(sleeps, [1000]);
    fails = 1; headers = {}; sleeps.length = 0;
    assert.ok((await mk({ backoffInitial: 0.1, backoffMax: 0.1, backoffJitter: 0 }).systemOne({ state: 'hi', questions: q })).choices.a); assert.deepEqual(sleeps, [100]);   // no header → backoff
    fails = 3; sleeps.length = 0;
    await assert.rejects(() => mk({ timeout: 0.05, backoffInitial: 0.2, backoffMax: 0.2, backoffJitter: 0 }).systemOne({ state: 'hi', questions: q }), JevClient.JevRateLimitError);   // retry budget would be exceeded
    assert.equal(sleeps.length, 0);
  } finally { await close(server); }
});
test('client: timeouts, connection errors, bad responses, unknown answer types', async () => {
  const hang = http.createServer(() => {}), hangUrl = await listen(hang);
  try { await assert.rejects(() => new JevClient({ apiKey: 'k', baseUrl: hangUrl, timeout: 0.05, retry: { maxRetries: 0 } }).models.list(), e => e instanceof JevClient.JevTimeoutError && e instanceof JevClient.JevConnectionError); } finally { await close(hang); }
  const dead = http.createServer(), deadUrl = await listen(dead); await close(dead);
  await assert.rejects(() => new JevClient({ apiKey: 'k', baseUrl: deadUrl, retry: { maxRetries: 0 } }).models.list(), e => e instanceof JevClient.JevConnectionError && !(e instanceof JevClient.JevTimeoutError));
  let reply; const odd = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply)); }); }), oddUrl = await listen(odd);
  try {
    const c = new JevClient({ apiKey: 'k', baseUrl: oddUrl, retry: { maxRetries: 0 } }), q = { q: JevClient.noul('Is it?') };
    reply = { model: 'm', answers: { q: { type: 'noul' } }, usage: {} };
    await assert.rejects(() => c.systemOne({ state: 'x', questions: q }), e => e instanceof JevClient.JevResponseValidationError && e.fieldPath === 'answers.q.noul');
    reply = { model: 'm', answers: { q: { type: 'noul', noul: 0.25 }, future: { type: 'ranking', order: [1] } } };
    const r = await c.systemOne({ state: 'x', questions: q }); assert.deepEqual(Object.keys(r.answers), ['q']); assert.equal(r.nouls.q.noul, 0.25); assert.equal(r.usage.input_tokens, null);
    reply = { model: 5, answers: {} };
    await assert.rejects(() => c.systemOne({ state: 'x', questions: q }), e => e.fieldPath === 'model');
  } finally { await close(odd); }
});

/* ---------- NLBoard.prime: the whiteboard can ask a real Jev API ---------- */
test('NLBoard.prime asks the API for every state it answered locally, and uses the API\'s answers afterwards', async () => {
  const lines = [{ id: 'a', text: 'array nums = [4,5,6]' }, { id: 'b', text: 'pointer p at nums[0]' }, { id: 'c', text: 'move p to 2' }];
  const before = NL.replay(lines, null);
  assert.deepEqual(before.results.map(r => r.status), ['ok', 'ok', 'ok']);
  const asked = [];
  const server = createServer({ quiet: true, onRequest: (req) => {
    if (req.method !== 'POST') return undefined;
    const body = JSON.parse(req.body.toString()); asked.push(body.state);
    const out = Jev.systemOne(body);
    if (body.state === 'move PTR to NUM') { out.answers.intent.probabilities = { assign: 0.71, create: 0.2, push: 0.09, pop: 0, put: 0, remove: 0, mark: 0, assert: 0, ret: 0 }; out.answers.intent.confidence = 0.42; }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: out };
  } }), url = await listen(server);
  try {
    const c = new JevClient({ apiKey: 'k', baseUrl: url });
    const r1 = await NL.prime(c);
    assert.ok(r1.asked >= 3 && r1.updated === r1.asked && r1.failed === 0, JSON.stringify(r1)); assert.ok(asked.includes('move PTR to NUM') && asked.includes('array ID = LIST'));
    const after = NL.replay(lines, null);
    assert.deepEqual(after.results.map(r => r.status), ['ok', 'ok', 'ok']);
    assert.equal(after.results[2].p, 0.71); assert.equal(after.results[2].confidence, 0.42);          // the API's answer replaced the local one
    assert.deepEqual((await NL.prime(c)), { asked: 0, updated: 0, failed: 0 });                         // nothing new to ask
  } finally { await close(server); }
  const sick = createServer({ quiet: true, onRequest: () => ({ status: 500, headers: { 'content-type': 'application/json' }, body: { detail: 'down' } }) }), sickUrl = await listen(sick);
  try {
    NL.replay([{ id: 'z', text: 'dict zzz' }], null);
    const r2 = await NL.prime(new JevClient({ apiKey: 'k', baseUrl: sickUrl, retry: { maxRetries: 0 } }));
    assert.ok(r2.failed >= 1 && r2.updated === 0); assert.equal(NL.replay([{ id: 'z', text: 'dict zzz' }], null).results[0].status, 'ok');   // falls back to the local answer
  } finally { await close(sick); }
});

/* ---------- the official models and the official SDK ---------- */
const SDK_PYTHON = process.env.SDK_PYTHON || (() => { try { cp.execSync('python3 -c "import typesafe_sdk"', { stdio: 'ignore' }); return 'python3'; } catch (e) { return null; } })();
test('conformance with the official generated wire models (typesafe_sdk._schemas.models)', () => {
  if (!SDK_PYTHON) return console.log('     (no interpreter with typesafe-sdk: set SDK_PYTHON; skipped)');
  const requests = GOOD.concat([OK({ state: 'I was charged twice', questions: { billing: { type: 'noul', criteria: { true: ['charged twice'] } }, tone: { type: 'choice', criteria: { calm: null, angry: 'upset' } }, urgency: { type: 'score', criteria: ['can wait', 'today'] } } })]);
  const fixtures = { requests, responses: requests.map(b => Jev.systemOne(b)), errors: BAD.concat(STRICTER).map(([, b]) => ({ detail: Jev.validate(b) })), models: Jev.handle({ method: 'GET', path: '/v1/models' }).body, invalid: BAD.concat(STRICTER).map(([, b]) => b) };
  const res = cp.spawnSync(SDK_PYTHON, ['-I', path.join(__dirname, 'conformance.py')], { input: JSON.stringify(fixtures), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr); const rep = JSON.parse(res.stdout);
  assert.deepEqual(rep.ok, [], 'official models accept our requests, responses, errors and model list');
  BAD.forEach(([name, body], i) => { // the same errors as pydantic reports (FastAPI prefixes "body")
    assert.equal(rep.invalid[i].accepted, false, name + ': the official model rejects it too');
    assert.deepEqual(ids(Jev.validate(body)), rep.invalid[i].errors.map(e => JSON.stringify(e)).sort(), name);
  });
  STRICTER.forEach(([name], k) => assert.equal(rep.invalid[BAD.length + k].accepted, true, name + ': only this server is stricter'));
});
test('the OFFICIAL typesafe-sdk (Python) works against tools/jev-server.js', async () => {
  if (!SDK_PYTHON) return console.log('     (no interpreter with typesafe-sdk: set SDK_PYTHON; skipped)');
  let flakyFails = 2;
  const plain = createServer({ quiet: true }), keyed = createServer({ quiet: true, apiKeys: ['secret-key'] });
  const flaky = createServer({ quiet: true, onRequest: (req) => req.method === 'POST' && flakyFails-- > 0 ? { status: 429, headers: { 'content-type': 'application/json', 'retry-after-ms': '30' }, body: { detail: 'Rate limit exceeded' } } : undefined });
  const urls = [await listen(plain), await listen(keyed), await listen(flaky)];
  try {
    const out = await new Promise((resolve) => {
      const p = cp.spawn(SDK_PYTHON, ['-I', path.join(__dirname, 'sdk_e2e.py'), ...urls], { env: Object.assign({}, process.env, { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }) });
      let so = '', se = ''; p.stdout.on('data', d => so += d); p.stderr.on('data', d => se += d); p.on('close', code => resolve({ code, so, se }));
    });
    assert.equal(out.code, 0, out.se || out.so); assert.ok(/sdk e2e ok/.test(out.so), out.so);
    assert.equal(flaky.requestLog.filter(l => l.status === 429).length, 2); assert.equal(flaky.requestLog.filter(l => l.status === 200).length, 1, 'the SDK retried after the 429s');
    console.log('     ' + out.so.trim());
  } finally { await Promise.all([close(plain), close(keyed), close(flaky)]); }
});

(async () => {
  for (const [name, fn] of queue) {
    n++;
    try { await fn(); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n     ')); }
  }
  console.log(`\n${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})();
