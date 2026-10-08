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

/* ---------- Jev ---------- */
test('jev answers typed questions in one pass', () => {
  const r = Jev.ask({ state: 'move PTR to NUM', questions: [
    { id: 'intent', kind: 'choice', options: [{ id: 'assign', hints: ['move PTR to NUM'] }, { id: 'push', hints: ['push NUM onto STK'] }] },
    { id: 'neg', kind: 'noul', yes: ['not'], no: ['is'] },
    { id: 'delta', kind: 'score', range: [-1, 1], anchors: [{ at: 1, hints: ['PTR ++'] }, { at: 0, hints: ['move PTR to NUM'] }] }] });
  assert.equal(r.answers.intent.choice, 'assign');
  assert.ok(r.answers.intent.probs.assign > 0.9);
  assert.ok(r.answers.intent.confidence > 0.5);
  assert.equal(r.answers.neg.value, false);
  assert.ok(Math.abs(r.answers.delta.score) < 0.3);
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

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
