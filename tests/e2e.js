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

  assert.deepEqual(errors, []);
  console.log('e2e ok');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
