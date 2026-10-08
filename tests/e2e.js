// End-to-end check of the practice script in a real browser.
//   python3 build.py && NODE_PATH=$(npm root -g) node tests/e2e.js [screenshot-dir]
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
const shots = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'public', 'index.html') + '?lang=en');
  await page.evaluate(() => { const h = document.getElementById('help'); if (h) h.hidden = true; });
  await page.click('#trainBtn');
  const typeLine = async (t) => { const inputs = page.locator('#tpLines .tpi'); const n = await inputs.count(); const last = inputs.nth(n - 1);
    if ((await last.inputValue()) !== '') { await last.press('End'); await last.press('Enter'); }
    await page.locator('#tpLines .tpi').last().type(t); };
  const script = ['title: 1. Two Sum', 'array nums = [2, 7, 11, 15]', 'variable target = 9', 'dict seen', 'pointer i at nums[0]', 'x = nums[i]', 'need = target - x', 'need 7 is not in seen',
    'put x -> i into seen', 'move i to 1', 'x = nums[i]', 'need = target - x', 'need 2 is in seen', 'return [seen[need], i]'];
  for (const t of script) await typeLine(t);
  await page.locator('#tpLines .tpi').last().blur();
  const statuses = await page.$$eval('#tpLines .tpst', els => els.map(e => e.className.replace('tpst ', '')));
  assert.deepEqual(statuses, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'pass', 'ok', 'ok', 'ok', 'ok', 'pass', 'ok'], statuses.join(','));
  const board = () => page.evaluate(() => JSON.parse(localStorage.getItem('drycanvas-b-' + localStorage.getItem('drycanvas-cur'))));
  let B = await board();
  const item = (name) => B.items.find(i => i.name === name);
  assert.deepEqual(item('nums').cells, ['2', '7', '11', '15']);
  assert.deepEqual(item('seen').rows, [['2', '0']]);
  assert.equal(item('return').value, '[0,1]');
  if (shots) await page.screenshot({ path: path.join(shots, '1-say.png') });

  // owned components cannot be deleted directly
  await page.click('[data-id="sL4"] .grip');            // dict "seen" (line 4)
  await page.keyboard.press('Delete');
  B = await board(); assert.ok(item('seen'), 'seen survived Delete');
  assert.ok(await page.locator('.toast').count(), 'a toast explains why');
  // …but they can be moved
  const g = await page.locator('[data-id="sL4"] .grip').boundingBox();
  await page.mouse.move(g.x + 5, g.y + 5); await page.mouse.down(); await page.mouse.move(g.x + 125, g.y + 85, { steps: 6 }); await page.mouse.up();
  B = await board(); const moved = item('seen'); 
  // editing a later line keeps the moved position
  const inp = page.locator('#tpLines .tpi').nth(8); await inp.fill('put x -> i into seen'); await inp.blur();
  B = await board(); assert.equal(item('seen').x, moved.x); assert.equal(item('seen').y, moved.y);

  // step through the trace
  await page.click('.tptab[data-tp="run"]');
  await page.click('#tpFirst');
  B = await board(); assert.equal(B.items.filter(i => i.src).length, 0, 'empty board before line 1');
  for (let k = 0; k < 9; k++) await page.click('#tpNext');   // after "put x -> i into seen"
  B = await board(); assert.deepEqual(item('seen').rows, [['2', '0']]); assert.equal(item('x').value, '2');
  if (shots) await page.screenshot({ path: path.join(shots, '2-run.png') });
  await page.click('#tpCheck');
  const report = await page.textContent('#tpReport');
  assert.ok(/answer \[0,1\] is correct/.test(report), report);
  if (shots) await page.screenshot({ path: path.join(shots, '3-check.png') });

  // Go
  await page.click('.tptab[data-tp="go"]');
  let code = await page.inputValue('#tpCode');
  assert.ok(/func twoSum\(nums \[\]int, target int\) \[\]int/.test(code) && /seen := map\[int\]int\{\}/.test(code), code);
  await page.click('[data-gf="solution_test.go"]');
  code = await page.inputValue('#tpCode'); assert.ok(/\{\[\]int\{2, 7, 11, 15\}, 9, \[\]int\{0, 1\}\}, \/\/ traced on your whiteboard/.test(code), code);
  if (shots) await page.screenshot({ path: path.join(shots, '4-go.png') });

  // deleting the line removes its component
  await page.click('.tptab[data-tp="say"]');
  const dictLine = page.locator('#tpLines .tpi').nth(3);
  await dictLine.fill(''); await dictLine.press('Backspace');
  B = await board(); assert.equal(item('seen'), undefined, 'seen is gone with its line');
  const st2 = await page.$$eval('#tpLines .tpst', els => els.map(e => e.className.replace('tpst ', '')));
  assert.ok(st2.includes('err'), 'lines that used seen now report an error');
  // undo brings both back
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  B = await board(); assert.ok(item('seen'), 'undo restores the line and the dict');
  assert.equal(await page.locator('#tpLines .tpi').count(), 14);

  // ---- loops: typing with auto-indent, stepping into round 2, Check, loop example, Go skeleton ----
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p2.on('pageerror', e => errors.push(e.message)); p2.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p2.on('dialog', d => d.accept());
  await p2.goto('file://' + path.join(__dirname, '..', 'public', 'index.html') + '?lang=en');
  await p2.evaluate(() => { document.getElementById('help').hidden = true; });
  await p2.click('#trainBtn');
  await p2.locator('#tpLines .tpi').first().click();
  const type = async (t) => { await p2.keyboard.type(t); };
  await type('title: 1. Two Sum'); await p2.keyboard.press('Enter');
  await type('array nums = [2, 7, 11, 15]'); await p2.keyboard.press('Enter');
  await type('variable target = 9'); await p2.keyboard.press('Enter');
  await type('dict seen'); await p2.keyboard.press('Enter');
  await type('for i, x in enumerate(nums):'); await p2.keyboard.press('Enter');       // next line is indented by itself
  await type('need = target - x'); await p2.keyboard.press('Enter');                  // stays indented
  await type('if need in seen:'); await p2.keyboard.press('Enter');                   // one level deeper
  await type('return [seen[need], i]'); await p2.keyboard.press('Enter');
  await p2.keyboard.press('Shift+Tab');                                               // back out of the if
  await type('put x -> i into seen');
  const texts = await p2.$$eval('#tpLines .tpi', els => els.map(e => e.value));
  assert.deepEqual(texts, ['title: 1. Two Sum', 'array nums = [2, 7, 11, 15]', 'variable target = 9', 'dict seen', 'for i, x in enumerate(nums):', '  need = target - x', '  if need in seen:', '    return [seen[need], i]', '  put x -> i into seen']);
  const st3 = await p2.$$eval('#tpLines .tpst', els => els.map(e => e.className.replace('tpst ', '')));
  assert.ok(st3.every(x => x === 'ok'), st3.join(','));
  await p2.evaluate(() => document.activeElement && document.activeElement.blur());
  await p2.click('.tptab[data-tp="run"]');
  assert.equal((await p2.textContent('#tpStep')).trim(), '12 / 12');
  await p2.click('#tpFirst');
  for (let k = 0; k < 9; k++) await p2.click('#tpNext');                              // step 8: round 2 of the loop starts
  assert.equal((await p2.textContent('#tpStep')).trim(), '9 / 12');
  let B2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('drycanvas-b-' + localStorage.getItem('drycanvas-cur'))));
  const it2 = (n) => B2.items.find(i => i.name === n);
  assert.equal(it2('i')._i, 1); assert.equal(it2('x').value, '7'); assert.deepEqual(it2('seen').rows, [['2', '0']]);
  assert.ok(await p2.locator('#tpLines2 .tpl.cur').count() === 1 && /for i, x/.test(await p2.locator('#tpLines2 .tpl.cur .tpi').inputValue()), 'the loop header row is the current one');
  assert.ok(/\(2\/4\)/.test(await p2.textContent('#tpLines2 .tpl.cur .tpsum')));
  assert.ok(await p2.locator('[data-id$="#1"]').count() === 1, 'x is owned by the loop line (key …#1)');
  assert.ok(/#5/.test(await p2.getAttribute('[data-id$="#1"]', 'data-line')), 'its badge shows line 5');
  await p2.click('[data-id$="#1"] .varbox');                                          // select x: the toolbar offers a jump to the line, not delete
  await p2.keyboard.press('Delete');
  B2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('drycanvas-b-' + localStorage.getItem('drycanvas-cur')))); assert.ok(it2('x'), 'x survived Delete');
  await p2.click('#tpLast'); await p2.click('#tpCheck');
  const rep2 = await p2.textContent('#tpReport'); assert.ok(/answer \[0,1\] is correct/.test(rep2) && /pointer path \[0,1\]/.test(rep2), rep2);
  const skips = await p2.$$eval('#tpLines2 .tpst', els => els.map(e => e.className.replace('tpst ', '')));
  assert.equal(skips.filter(x => x === 'skip').length, 0);
  if (shots) await p2.screenshot({ path: path.join(shots, '7-loop-run.png') });
  // loop example + Go skeleton
  await p2.click('.tptab[data-tp="say"]'); await p2.click('#tpDemoLoop');
  assert.equal((await p2.$$eval('#tpLines .tpi', els => els.length)), 9);
  await p2.click('.tptab[data-tp="go"]');
  const go = await p2.inputValue('#tpCode');
  assert.ok(/for i, x := range nums \{/.test(go) && /if _, ok := seen\[need\]; ok \{/.test(go), go);
  if (shots) await p2.screenshot({ path: path.join(shots, '8-loop-go.png') });
  // valid parentheses loop example from a problem board: skipped lines are dimmed
  await p2.click('.tptab[data-tp="say"]'); await p2.selectOption('#tpCase', 'valid-parentheses'); await p2.click('#tpDemoLoop');
  const vp = await p2.$$eval('#tpLines .tpst', els => els.map(e => e.className.replace('tpst ', '')));
  assert.equal(vp.filter(x => x === 'skip').length, 2, vp.join(','));   // two lines are never reached for ([)]: the return under "st is empty" and the final return
  await p2.click('.tptab[data-tp="run"]'); await p2.click('#tpCheck');
  assert.ok(/answer false is correct/.test(await p2.textContent('#tpReport')));
  if (shots) await p2.screenshot({ path: path.join(shots, '9-vp-loop.png') });

  assert.deepEqual(errors, []);
  console.log('e2e ok');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
