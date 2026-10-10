// node tests/run.js           — engine, interpreter, trainer and Go generation tests
// node tests/run.js --write   — also rewrite training/go/* from the demo traces
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const Jev = require('../src/jev.js'), NL = require('../src/nlboard.js'), Trainer = require('../src/trainer.js');

let n = 0, failed = 0;
function test(name, fn) { n++; try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); } }
const L = (arr) => arr.map((t, i) => ({ id: 'L' + i, text: t }));
const run = (arr, step) => NL.replay(L(arr), step == null ? null : step);
const comp = (st, name) => st.comps.find(c => c.name === name);

/* ---------- Jev (System One wire format; the HTTP side is tested in tests/jev-api.js) ---------- */
test('jev answers typed questions in one call, in the real answer shapes', () => {
  const r = Jev.systemOne({ state: 'move PTR to NUM', model: 'jev-latest', questions: {
    intent: { type: 'choice', criteria: { assign: ['move PTR to NUM'], push: ['push NUM onto STK'] } },
    neg: { type: 'noul', criteria: { true: ['not'], false: ['is'] } },
    delta: { type: 'score', criteria: [['PTR --'], ['move PTR to NUM'], ['PTR ++']] } } });
  assert.equal(r.answers.intent.type, 'choice'); assert.equal(r.answers.intent.choice, 'assign');
  assert.ok(r.answers.intent.probabilities.assign > 0.9); assert.ok(r.answers.intent.confidence > 0.5);
  assert.equal(r.answers.neg.type, 'noul'); assert.ok(r.answers.neg.noul <= 0.5); assert.deepEqual(Object.keys(r.answers.neg).sort(), ['noul', 'type']);
  assert.equal(r.answers.delta.type, 'score'); assert.ok(Math.abs(r.answers.delta.score - 1) < 0.3);
  assert.deepEqual(Object.keys(r.answers.delta.probabilities), ['0', '1', '2']);
  assert.ok(!('text' in r.answers.intent), 'no free text');
});

/* ---------- interpreter ---------- */
const INTENT_CASES = [
  ['array nums = [2, 7, 11, 15]', [], 'create'], ['make a stack called st', [], 'create'], ['陣列 a = [1,2,3]', [], 'create'], ['建立字典 seen', [], 'create'],
  ['x = 3', [], 'assign'], ['move i to 2', ['array nums = [1,2,3]', 'pointer i at nums[0]'], 'assign'], ['i 移到 2', ['array nums = [1,2,3]', 'pointer i at nums[0]'], 'assign'],
  ['increment i', ['array nums = [1,2,3]', 'pointer i at nums[0]'], 'assign'], ['push 3 onto st', ['stack st'], 'push'], ['把 3 推入 st', ['stack st'], 'push'],
  ['pop st', ['stack st', 'push 1 onto st'], 'pop'], ['put 2 -> 0 into seen', ['dict seen'], 'put'], ['remove 1 from vis', ['set vis', 'add 1 to vis'], 'remove'],
  ['highlight nums[1]', ['array nums = [1,2,3]'], 'mark'], ['2 is in seen', ['dict seen'], 'assert'], ['2 不在 seen 裡', ['dict seen'], 'assert'],
  ['return [0, 1]', [], 'ret'], ['回傳 true', [], 'ret']];
INTENT_CASES.forEach(([line, before, want]) => test(`intent: "${line}" → ${want}`, () => {
  const r = run(before.concat(line));
  const last = r.results[r.results.length - 1];
  assert.ok(last.status !== 'err', last.msg);
  assert.equal(last.intent, want);
}));

test('values are written onto the board', () => {
  const r = run(['array nums = [2,7,11,15]', 'pointer i at nums[0]', 'dict seen', 'x = nums[i]', 'put x -> i into seen', 'i++', 'seen[nums[i]] = i', 'stack st', 'st.push(4)', 'push 5 onto st', 'pop st', 'set vis', 'add 3 to vis', 'add 3 to vis']);
  assert.deepEqual(comp(r.state, 'seen').rows, [['2', '0'], ['7', '1']]);
  assert.equal(comp(r.state, 'i').idx, 1);
  assert.deepEqual(comp(r.state, 'st').cells, ['4']);
  assert.deepEqual(comp(r.state, 'vis').cells, ['3']);
  assert.equal(comp(r.state, 'x').value, '2');
});

test('check lines pass or fail against the board', () => {
  const r = run(['dict seen', 'put 2 -> 0 into seen', '2 is in seen', '3 is in seen', '3 is not in seen', 'x = 4', 'x == 4', 'x == 5', 'stack st', 'st is empty']);
  assert.deepEqual(r.results.slice(2).filter(x => x.status === 'pass' || x.status === 'fail').map(x => x.status), ['pass', 'fail', 'pass', 'pass', 'fail', 'pass']);
});

test('errors are reported per line, the rest still runs', () => {
  const r = run(['push 3 onto nowhere', 'x = y + 1', 'array a = [1]', 'pop a', 'pop a']);
  assert.equal(r.results[0].status, 'err');
  assert.equal(r.results[1].status, 'err');
  assert.ok(/unknown name "y"/.test(r.results[1].msg), r.results[1].msg);
  assert.equal(r.results[3].status, 'ok');
  assert.equal(r.results[4].status, 'err');
});

test('components are owned by the line that made them', () => {
  const lines = L(['array nums = [1,2]', 'stack st', 'push 1 onto st']);
  let r = NL.replay(lines, null);
  assert.equal(comp(r.state, 'nums').key, 'L0');
  assert.equal(comp(r.state, 'st').key, 'L1');
  lines[0].text = 'array numbers = [1,2,3]';            // edit the line: same key, new content
  r = NL.replay(lines, null);
  assert.equal(comp(r.state, 'numbers').key, 'L0');
  assert.deepEqual(comp(r.state, 'numbers').cells, ['1', '2', '3']);
  r = NL.replay(lines.filter(l => l.id !== 'L1'), null); // delete the line: its component is gone
  assert.equal(comp(r.state, 'st'), undefined);
  assert.equal(r.results[1].status, 'err');                // "push 1 onto st" no longer has a target
});

test('stepping shows the board after a given line', () => {
  const r = run(['array nums = [1,2,3]', 'pointer i at nums[0]', 'i++', 'i++'], 2);
  assert.equal(comp(r.board, 'i').idx, 1);
  assert.equal(comp(r.state, 'i').idx, 2);
});

/* ---------- trainer ---------- */
const DEMOS = { 'two-sum': { nums: [2, 7, 11, 15], target: 9 }, 'valid-parentheses': { s: '([)]' } };
Object.keys(DEMOS).forEach(id => {
  test(`${id}: demo trace runs cleanly and checks out`, () => {
    const lines = Trainer.demo(id, DEMOS[id]);
    const r = run(lines);
    r.results.forEach((x, i) => assert.ok(['ok', 'pass', 'comment'].includes(x.status), `line ${i} "${lines[i]}": ${x.status} ${x.msg}`));
    const c = Trainer.check(id, r);
    assert.ok(c.ok, JSON.stringify(c.items));
  });
});
test('two-sum: a wrong answer and a wrong dict are caught', () => {
  const lines = Trainer.demo('two-sum', DEMOS['two-sum']).map(t => t.replace('return [seen[need], i]', 'return [1, 2]').replace('put x -> i into seen', 'put x -> 5 into seen'));
  const c = Trainer.check('two-sum', run(lines));
  assert.ok(!c.ok);
  assert.ok(c.items.some(x => !x.ok && /answer \[1,2\] is wrong; expected \[0,1\]/.test(x.msg)), JSON.stringify(c.items));
  assert.ok(c.items.some(x => !x.ok && /dict seen/.test(x.msg)));
});
test('valid-parentheses: a wrong stack operation is caught', () => {
  const lines = Trainer.demo('valid-parentheses', { s: '(]' }).map(t => t === 'push c onto st' ? 'push "[" onto st' : t);
  const c = Trainer.check('valid-parentheses', run(lines));
  assert.ok(c.items.some(x => !x.ok && /stack op #1/.test(x.msg)), JSON.stringify(c.items));
});
test('chinese trace for two sum', () => {
  const lines = ['題目：1. Two Sum', '陣列 nums = [3, 2, 4]', '變數 target = 6', '建立字典 seen', '指標 i 指向 nums[0]', 'x = nums[i]', 'need = target - x', 'need 3 不在 seen 裡', '把 x -> i 放進 seen',
    'i 移到 1', 'x = nums[i]', 'need = target - x', 'need 4 不在 seen 裡', '把 x -> i 放進 seen', 'i 往右', 'x = nums[i]', 'need = target - x', 'need 2 在 seen 裡', '回傳 [seen[need], i]'];
  const r = run(lines);
  r.results.forEach((x, i) => assert.ok(['ok', 'pass'].includes(x.status), `line ${i} "${lines[i]}": ${x.status} ${x.msg}`));
  const c = Trainer.check('two-sum', r);
  assert.ok(c.ok, JSON.stringify(c.items));
});

test('the problem is guessed from the title line', () => {
  assert.equal(Trainer.guess(run(['title: 1. Two Sum']).state), 'two-sum');
  assert.equal(Trainer.guess(run(['題目：20. Valid Parentheses']).state), 'valid-parentheses');
  assert.equal(Trainer.guess(run(['title: 11. Container With Most Water']).state), null);
  const c = Trainer.check(null, run(Trainer.demo('two-sum', DEMOS['two-sum'])));
  assert.equal(c.caseId, 'two-sum'); assert.ok(c.ok);
});


/* ---------- loops, branches, common syntax ---------- */
const val = (r, name) => { const c = comp(r.state, name); return c && (c.value !== undefined ? c.value : c.cells || c.rows || c.idx); };
const LOOP_CASES = [
  ['for each value', ['array a = [3,1,4]', 'total = 0', 'for x in a:', '  total += x'], r => { assert.equal(val(r, 'total'), '8'); assert.equal(val(r, 'x'), '4'); assert.equal(r.results[3].runs, 3); }],
  ['for in range(a, b)', ['total = 0', 'for i in range(1, 5):', '  total += i'], r => assert.equal(val(r, 'total'), '10')],
  ['for in range(n) and a step', ['t = 0', 'for i in range(3): t += 1', 'u = 0', 'for j in range(5, 0, -2): u += j'], r => { assert.equal(val(r, 't'), '3'); assert.equal(val(r, 'u'), '9'); }],
  ['for i from a to b (inclusive)', ['t = 0', 'for k from 1 to 3: t += k'], r => assert.equal(val(r, 't'), '6')],
  ['for i over an array: a pointer walks it', ['array nums = [4,5,6]', 'for i over nums:', '  x = nums[i]'], r => { assert.equal(comp(r.state, 'i').type, 'pointer'); assert.equal(val(r, 'i'), 2); assert.equal(val(r, 'x'), '6'); assert.deepEqual(r.state.events.filter(e => e.t === 'move').map(e => e.idx), [0, 1, 2]); }],
  ['an existing pointer walks the array it points at', ['array nums = [4,5,6]', 'pointer p at nums[0]', 'for p in nums:', '  x = nums[p]'], r => { assert.equal(val(r, 'p'), 2); assert.equal(val(r, 'x'), '6'); }],
  ['enumerate over a string', ['s = "abc"', 'for i, c in enumerate(s):', '  last = c'], r => { assert.equal(val(r, 'i'), 2); assert.equal(val(r, 'c'), 'c'); assert.equal(comp(r.state, 'i').key, 'L1'); assert.equal(comp(r.state, 'c').key, 'L1#1'); }],
  ['dict pairs', ['dict d', 'put 1 -> 10 into d', 'put 2 -> 20 into d', 'sum = 0', 'for k, v in d.items():', '  sum += v', 'ks = 0', 'for k2 in d:', '  ks += k2'], r => { assert.equal(val(r, 'sum'), '30'); assert.equal(val(r, 'ks'), '3'); }],
  ['string and list literals', ['n = 0', 'for ch in "xyz":', '  n++', 't = 0', 'for x in [1, 2, 3]:', '  t += x'], r => { assert.equal(val(r, 'n'), '3'); assert.equal(val(r, 't'), '6'); }],
  ['loop variable named like a keyword', ['array items = [1,2]', 't = 0', 'for item in items:', '  t += item'], r => assert.equal(val(r, 't'), '3')],
  ['while with a condition', ['n = 3', 'c = 0', 'while n > 0:', '  n -= 1', '  c++'], r => { assert.equal(val(r, 'n'), '0'); assert.equal(val(r, 'c'), '3'); }],
  ['while a stack is not empty', ['stack st', 'push 1 onto st', 'push 2 onto st', 'n = 0', 'while st:', '  pop st', '  n++'], r => { assert.deepEqual(comp(r.state, 'st').cells, []); assert.equal(val(r, 'n'), '2'); }],
  ['repeat N times', ['c = 0', 'repeat 4 times', '  c++', '重複 2 次', '  c++'], r => assert.equal(val(r, 'c'), '6')],
  ['break and continue', ['array a = [1,2,3,4,5]', 'sum = 0', 'for x in a:', '  if x == 2: continue', '  if x == 5: break', '  sum += x'], r => assert.equal(val(r, 'sum'), '8')],
  ['if / elif / else runs one branch', ['x = 5', 'if x > 10:', '  r = 1', 'elif x > 3:', '  r = 2', 'else:', '  r = 3'], r => { assert.equal(val(r, 'r'), '2'); assert.deepEqual([2, 4, 5, 6].map(i => r.results[i].status), ['ok', 'ok', 'skip', 'skip'].map((x, k) => k === 0 ? 'skip' : x === 'ok' && k === 1 ? 'ok' : x)); }],
  ['else branch', ['x = 1', 'if x > 3:', '  r = 1', 'else:', '  r = 3'], r => { assert.equal(val(r, 'r'), '3'); assert.equal(r.results[2].status, 'skip'); }],
  ['nested loops', ['t = 0', 'for i in range(3):', '  for j in range(2):', '    t += 1'], r => { assert.equal(val(r, 't'), '6'); assert.equal(r.results[3].runs, 6); }],
  ['one-line bodies', ['a = 0', 'for i in range(3): a += i', 'if a == 3: b = 1', 'else: b = 2'], r => { assert.equal(val(r, 'a'), '3'); assert.equal(val(r, 'b'), '1'); assert.equal(r.results[3].status, 'skip'); }],
  ['conditions: and / or / not / in / not in / is empty', ['array a = [1,2]', 'dict d', 'put 1 -> 5 into d', 'x = 0', 'if 1 in d and not a is empty: x = 1', 'if 3 in d or x == 1: x = 2', 'if 3 not in d and x == 2: x = 3', 'if x != 3 or a is empty: x = 9'], r => assert.equal(val(r, 'x'), '3')],
  ['a string character in a literal', ['s = "(a"', 'n = 0', 'for c in s:', '  if c in "([{": n++'], r => assert.equal(val(r, 'n'), '1')],
  ['negative index, pop and peek as values', ['stack st', 'push 1 onto st', 'push 2 onto st', 'push 3 onto st', 'a = st[-1]', 'b = pop st', 'c = st.pop()', 'd = peek st'], r => { assert.deepEqual(['a', 'b', 'c', 'd'].map(n => val(r, n)), ['3', '3', '2', '1']); assert.deepEqual(comp(r.state, 'st').cells, ['1']); }],
  ['dict literal with quotes and braces inside', ['dict m = {")": "(", "}": "{", "k": 3}'], r => assert.deepEqual(comp(r.state, 'm').rows, [[')', '('], ['}', '{'], ['k', '3']])],
  ['chinese loops and branches', ['陣列 a = [1,2,3]', 'sum = 0', '對每個 x 在 a 裡', '  sum += x', '如果 sum 等於 6', '  回傳 true', '否則', '  回傳 false'], r => { assert.equal(r.state.answer, true); assert.equal(r.results[7].status, 'skip'); }],
  ['chinese while / repeat / break', ['n = 0', '當 n < 5', '  n++', '  如果 n 等於 3', '    跳出'], r => assert.equal(val(r, 'n'), '3')],
];
LOOP_CASES.forEach(([name, lines, check]) => test('syntax: ' + name, () => {
  const r = run(lines);
  r.results.forEach((x, i) => assert.notEqual(x.status, 'err', `line ${i} "${lines[i]}": ${x.msg}`));
  check(r);
}));

test('return stops the whole script, the rest is "not run"', () => {
  const r = run(['x = 1', 'array a = [1,2]', 'for v in a:', '  return v', 'x = 2']);
  assert.equal(r.state.answer, 1); assert.equal(val(r, 'x'), '1');
  assert.equal(r.results[4].status, 'skip');
  assert.equal(r.trace.length, 4);
});
test('flow errors are per line and readable', () => {
  const e = (lines, i, re) => { const r = run(lines); assert.equal(r.results[i].status, 'err', JSON.stringify(r.results[i])); assert.ok(re.test(r.results[i].msg), r.results[i].msg); return r; };
  e(['break'], 0, /only works inside a loop/);
  e(['else', '  x = 1'], 0, /no matching if/);
  e(['for x in nowhere', '  y = 1'], 0, /unknown name "nowhere"/);
  e(['for x'], 0, /did not understand the loop/);
  e(['array a = [1]', 'for i, x in a:'], 1, /two names need a dict/);
  e(['for i in range(2.5):'], 0, /whole number/);
  e(['if', '  x = 1'], 0, /missing condition/);
  const r = e(['n = 0', 'while true:', '  n++'], 1, /ran more than 1000 rounds/); assert.equal(val(r, 'n'), '1000');
  const r2 = run(['n = 0', 'repeat 1000 times', '  repeat 1000 times', '    n++']);
  assert.equal(r2.trace.length, 3000); assert.ok(r2.results.some(x => x.status === 'err' && /stopped after 3000 steps/.test(x.msg)));
});
test('every executed line is a step; the board can be shown at any step', () => {
  const lines = Trainer.demo('two-sum', DEMOS['two-sum'], true), r = run(lines);
  assert.equal(r.trace.length, 12);
  const iter2 = r.trace.findIndex(t => /\(2\/4\)/.test(t.sum || ''));
  assert.equal(iter2, 8);
  let b = NL.replay(L(lines), 7).board;                    // after "put x -> i into seen" of round 1
  assert.equal(comp(b, 'i').idx, 0); assert.deepEqual(comp(b, 'seen').rows, [['2', '0']]);
  b = NL.replay(L(lines), iter2).board;                    // round 2 has just started
  assert.equal(comp(b, 'i').idx, 1); assert.equal(comp(b, 'x').value, '7');
  b = NL.replay(L(lines), -1).board; assert.equal(b.comps.length, 0);
});
test('components made by a loop belong to its header line', () => {
  const r = run(Trainer.demo('two-sum', DEMOS['two-sum'], true));
  assert.deepEqual(['i', 'x', 'need'].map(n => comp(r.state, n).key), ['L4', 'L4#1', 'L5']);
  assert.ok(comp(r.state, 'i').loopVar && comp(r.state, 'x').loopVar);
  assert.ok(!comp(r.state, 'need').loopVar);
});
test('loop examples run, pass the checker, and wrong versions are caught', () => {
  [[ 'two-sum', { nums: [2, 7, 11, 15], target: 9 }], ['two-sum', { nums: [3, 2, 4], target: 6 }], ['two-sum', { nums: [3, 3], target: 6 }], ['two-sum', { nums: [1, 5, 3, 7], target: 10 }]].forEach(([id, inp]) => {
    const r = run(Trainer.demo(id, inp, true)); const c = Trainer.check(id, r);
    assert.ok(c.ok, JSON.stringify(inp) + JSON.stringify(c.items));
  });
  ['()', '([)]', '{[]}', ']', '(((', '()[]{}', '(]', '{[}'].forEach(s => {
    const lines = Trainer.demo('valid-parentheses', { s }, true), r = run(lines), c = Trainer.check('valid-parentheses', r);
    r.results.forEach((x, i) => assert.notEqual(x.status, 'err', `${s} line ${i} "${lines[i]}": ${x.msg}`));
    assert.equal(r.state.answer, Trainer.CASES['valid-parentheses'].solve({ s }).answer, s);
    assert.ok(c.ok, s + JSON.stringify(c.items));
  });
  const bad = Trainer.demo('two-sum', DEMOS['two-sum'], true).map(t => t.replace('put x -> i into seen', 'put x -> 5 into seen'));
  const c = Trainer.check('two-sum', run(bad)); assert.ok(!c.ok); assert.ok(c.items.some(x => !x.ok && /answer \[5,1\] is wrong/.test(x.msg)), JSON.stringify(c.items));
  const bad2 = Trainer.demo('valid-parentheses', { s: '([)]' }, true).map(t => t.replace('if top != pair[c]:', 'if top == pair[c]:'));
  assert.ok(!Trainer.check('valid-parentheses', run(bad2)).ok);
});
test('jev picks the loop shape', () => {
  const criteria = { each: ['ID in ARR', 'ID , ID in MAP'], index: ['PTR in ARR', 'ID over ARR'], range: ['ID in range ( NUM )', 'ID from NUM to NUM'], enumerate: ['ID , ID in enumerate ( ARR )'] };
  const kinds = { 'ID in ARR': 'each', 'PTR in ARR': 'index', 'ID over ARR': 'index', 'ID in range ( NUM )': 'range', 'ID from NUM to NUM': 'range', 'ID , ID in enumerate ( ARR )': 'enumerate', 'ID , ID in MAP': 'each' };
  Object.keys(kinds).forEach(k => assert.equal(Jev.systemOne({ state: k, model: 'jev-latest', questions: { q: { type: 'choice', criteria } } }).answers.q.choice, kinds[k], k));
});


/* ---------- Go ---------- */
const hasGo = (() => { try { cp.execSync('go version', { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
const GO_DIRS = { 'two-sum': 'twosum', 'valid-parentheses': 'validparentheses' };
Object.keys(DEMOS).forEach(id => {
  const lines = L(Trainer.demo(id, DEMOS[id])), r = NL.replay(lines, null);
  test(`${id}: Go solution from the board passes go test`, () => {
    const files = Trainer.goCode(id, r, lines, { solution: true });
    assert.ok(/traced on your whiteboard/.test(files['solution_test.go']));
    const repo = path.join(__dirname, '..', 'training', 'go', GO_DIRS[id]);
    if (process.argv.includes('--write')) { fs.mkdirSync(repo, { recursive: true }); for (const f in files) fs.writeFileSync(path.join(repo, f), files[f]); }
    for (const f in files) assert.equal(fs.readFileSync(path.join(repo, f), 'utf8'), files[f], `training/go/${GO_DIRS[id]}/${f} is stale; run node tests/run.js --write`);
    if (!hasGo) return console.log('     (go not installed, skipped go test)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbh-'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module solution\n\ngo 1.21\n');
    for (const f in files) fs.writeFileSync(path.join(dir, f), files[f]);
    cp.execSync('go test ./...', { cwd: dir, stdio: 'pipe' });
  });
  test(`${id}: Go skeleton from the board compiles (and its test fails until you fill it in)`, () => {
    const files = Trainer.goCode(id, r, lines, {});
    assert.ok(/TODO/.test(files['solution.go']));
    if (!hasGo) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbh-'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module solution\n\ngo 1.21\n');
    for (const f in files) fs.writeFileSync(path.join(dir, f), files[f]);
    cp.execSync('go vet ./...', { cwd: dir, stdio: 'pipe' });
    let res = cp.spawnSync('go', ['test', './...'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(res.status, 0, 'skeleton should not pass yet');
    assert.ok(!/build failed|syntax error|declared and not used/.test(res.stdout + res.stderr), res.stdout + res.stderr);
  });
});

Object.keys(DEMOS).forEach(id => {
  const lines = L(Trainer.demo(id, DEMOS[id], true)), r = NL.replay(lines, null);
  test(`${id}: loop version → Go skeleton mirrors the script's loops and compiles`, () => {
    const files = Trainer.goCode(id, r, lines, {}), code = files['solution.go'];
    assert.ok(/for i, x := range nums \{|for i := 0; i < len\(s\); i\+\+ \{/.test(code), code);
    assert.ok(/if _, ok := seen\[need\]; ok \{|if _, ok := pair\[c\]; ok \{/.test(code), code);
    if (id === 'valid-parentheses') assert.ok(/\} else \{/.test(code) && /if len\(st\) == 0 \{/.test(code) && /if top != pair\[c\] \{/.test(code), code);
    if (!hasGo) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbh-'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module solution\n\ngo 1.21\n');
    for (const f in files) fs.writeFileSync(path.join(dir, f), files[f]);
    cp.execSync('go vet ./...', { cwd: dir, stdio: 'pipe' });
    cp.execSync('gofmt -l .', { cwd: dir, stdio: 'pipe' });
    const res = cp.spawnSync('go', ['test', './...'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(res.status, 0); assert.ok(!/build failed|syntax error|declared and not used/.test(res.stdout + res.stderr), res.stdout + res.stderr);
    const sol = Trainer.goCode(id, r, lines, { solution: true }); for (const f in sol) fs.writeFileSync(path.join(dir, f), sol[f]);
    cp.execSync('go test ./...', { cwd: dir, stdio: 'pipe' });
  });
});

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
