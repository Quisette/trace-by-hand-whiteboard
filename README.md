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

## Project structure

```
src/canvas_src.html   # the app (single file: HTML + CSS + JS)
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

## Adding UI text

Wrap any new user-facing string in `_T('…')` in `src/canvas_src.html`, add the same key to `i18n/source_zh-TW.json`, and add translations to each `i18n/<lang>.json`.

---

LeetCode is a trademark of LeetCode LLC. This project is not affiliated with LeetCode; problem titles are only used to link to the original problems.
