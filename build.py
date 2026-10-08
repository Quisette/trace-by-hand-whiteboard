"""Build public/index.html from src/canvas_src.html.

- Embeds the LeetCode problem list (data/problems.csv) into /*PROBLEMS*/[]
- Inlines src/jev.js, src/nlboard.js, src/trainer.js into /*MODULES*/ (practice script)
- Embeds UI translations (i18n/<lang>.json, keys = Traditional Chinese source strings) into /*I18N*/{}

Usage: python3 build.py
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
LANGS = ['zh-CN', 'en', 'ja', 'ko', 'fr', 'hi']

probs = []
with open(os.path.join(HERE, 'data', 'problems.csv'), encoding='utf-8') as f:
    for r in csv.DictReader(f):
        probs.append([int(r['id']), r['title'], r['slug'], r['difficulty']])
probs.sort()

src = open(os.path.join(HERE, 'src', 'canvas_src.html'), encoding='utf-8').read()
assert '/*PROBLEMS*/[]' in src and '/*I18N*/{}' in src
page = src.replace('/*PROBLEMS*/[]', json.dumps(probs, ensure_ascii=False, separators=(',', ':')))

keys = json.load(open(os.path.join(HERE, 'i18n', 'source_zh-TW.json'), encoding='utf-8'))
i18n = {}
for lang in LANGS:
    d = json.load(open(os.path.join(HERE, 'i18n', lang + '.json'), encoding='utf-8'))
    missing = [k for k in keys if k not in d]
    if missing:
        print(f'[{lang}] missing {len(missing)} keys, e.g. {missing[:3]}')
    i18n[lang] = {k: v for k, v in d.items() if k in keys and v}
mods = '\n'.join(open(os.path.join(HERE, 'src', m), encoding='utf-8').read() for m in ('jev.js', 'nlboard.js', 'trainer.js'))
assert page.count('/*MODULES*/') == 1
page = page.replace('/*MODULES*/', mods.replace('</script', '<\\/script'))
page = page.replace('/*I18N*/{}', json.dumps(i18n, ensure_ascii=False, separators=(',', ':')))

body = page.replace('<meta charset="utf-8">\n', '')
cut = body.index('</style>') + len('</style>')
html = ('<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + body[:cut] +
        '\n</head>\n<body>\n' + body[cut:] + '\n</body>\n</html>\n')
os.makedirs(os.path.join(HERE, 'public'), exist_ok=True)
open(os.path.join(HERE, 'public', 'index.html'), 'w', encoding='utf-8').write(html)
print(f'{len(probs)} problems, {len(i18n)} translations, {round(len(html) / 1024)} KB -> public/index.html')
