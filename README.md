# Trace-by-Hand Whiteboard · 手動跑題白板

A digital whiteboard for tracing algorithm problems by hand — drag in arrays, pointers, stacks, queues, dictionaries, sets, trees, linked lists, graphs and tables, then walk through a LeetCode problem step by step before you write code.

一個「寫 code 之前先手動跑一遍」用的數位白板：把陣列、指標、堆疊、佇列、字典、集合、樹、串列、圖、表格拉到畫布上，一步一步把題目跑一遍。

**Live:** https://draw.prod-stack.com

## Features

- Components: title, text, code, sticky note, array, pointer, stack, queue, dictionary, set, 2D array, variable, tree / list / graph nodes, table
- Drawing tools: pen, eraser, rectangle, circle, line, arrow, connectors
- Multi-select, copy/paste, layers, undo/redo, minimap, zoom
- "My boards": open a board for any LeetCode problem by number or title (3,000+ problems built in)
- Export / import as JSON; everything is saved in your browser (localStorage) — nothing is sent to a server
- 7 languages: 繁體中文, 简体中文, English, 日本語, 한국어, Français, हिन्दी (auto-detected; switch in the top-left, or use `?lang=en`)

## Practice script (natural language → board → Go)

Open **✎ Practice script** in the left panel. It turns a LeetCode problem into three steps:

1. **Say it** — write one sentence per line and the board builds itself:
   `array nums = [2,7,11,15]`, `variable target = 9`, `dict seen`, `pointer i at nums[0]`,
   `x = nums[i]`, `put x -> i into seen`, `move i to 1`, `push c onto st`, `pop st`, `return [seen[need], i]`.
   Chinese works too (`陣列 a = [1,2,3]`, `把 3 推入 st`, `2 在 seen 裡`, `回傳 true`).
2. **Trace it** — step through the script line by line; the board shows the state after the selected line.
   Check lines (`7 is not in seen`, `st is empty`, `x == 2`) are verified against the board, and **Check** replays a
   reference solution on the inputs that are on the board (pointer path, dict / stack contents, answer).
   Built-in cases: 1. Two Sum and 20. Valid Parentheses (picked from the board's problem or the `title:` line);
   other problems run in free mode (check lines and the returned value only).
3. **Write it in Go** — a skeleton (or the reference solution) with the board's data structures declared, plus a
   table test that includes the example you traced. `training/go/` holds the output for the two built-in examples.

Every component made by a line belongs to that line: you can drag it, recolor it or copy it (a copy is an ordinary
component), but it can only be deleted by editing or deleting its line.

Sentences are understood by a local, Jev-style "System One" decider (`src/jev.js`). Like TypeSafe's Jev it never
writes text: it answers typed questions about the tagged sentence (a **Choice** of intent and component type, a
**Noul** yes/no for negation, a **Score** for which way a pointer steps) with probabilities and a confidence, all in one
pass. It is an exemplar matcher over tokens and character trigrams that runs in the browser — no network, no
weights. `src/nlboard.js` turns the answers into board operations; `src/trainer.js` holds the cases, the checker
and the Go generator.

## Project structure

```
src/canvas_src.html   # the app (single file: HTML + CSS + JS)
src/jev.js            # local Jev-style System One decider (Choice / Noul / Score)
src/nlboard.js        # practice script: sentence → typed questions → board operations
src/trainer.js        # LeetCode cases, trace checker, Go generator
tests/run.js          # node tests (engine, interpreter, checker, generated Go via go test)
tests/e2e.js          # browser test of the practice script (Playwright)
training/go/          # Go generated from the built-in example traces
i18n/                 # UI translations; keys are the Traditional Chinese source strings
data/problems.csv     # LeetCode problem list (id, title, slug, difficulty)
build.py              # builds public/index.html (embeds problems + translations)
public/index.html     # built, self-contained page
wrangler.jsonc        # Cloudflare Workers static-assets deploy config
```

## Build & deploy

```bash
python3 build.py          # -> public/index.html
npx wrangler deploy       # deploy to Cloudflare (needs your own account / domain)
```

Opening `public/index.html` directly in a browser also works.

```bash
node tests/run.js                                   # add --write to refresh training/go/
python3 build.py && NODE_PATH=$(npm root -g) node tests/e2e.js
(cd training/go && go test ./...)
```

## Adding UI text

Wrap any new user-facing string in `_T('…')` in `src/canvas_src.html`, add the same key to `i18n/source_zh-TW.json`, and add translations to each `i18n/<lang>.json`.

---

LeetCode is a trademark of LeetCode LLC. This project is not affiliated with LeetCode; problem titles are only used to link to the original problems.
