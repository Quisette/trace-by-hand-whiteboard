#!/usr/bin/env node
/* A Jev-compatible System One API server, backed by the local engine in src/jev.js.
 *
 *   node tools/jev-server.js [--port 8787] [--host 127.0.0.1] [--key SECRET ...] [--quiet]
 *
 *   POST /v1/systemone     GET /v1/models
 *
 * Point any Jev client at it:
 *   official Python SDK   TYPESAFE_BASE_URL=http://127.0.0.1:8787 TYPESAFE_API_KEY=anything python your_script.py
 *   src/jev-client.js     new JevClient({baseUrl: 'http://127.0.0.1:8787', apiKey: 'anything'})
 *   the whiteboard        open public/index.html?jev=http://127.0.0.1:8787
 *   curl                  curl -H 'Authorization: Bearer x' -H 'content-type: application/json' -d '{"state":"...","model":"jev-latest","questions":{...}}' http://127.0.0.1:8787/v1/systemone
 *
 * Without --key any bearer token is accepted (like a dev server); with one or more --key the key must match,
 * otherwise the answer is 401. Zero dependencies.
 */
const http = require('http');
const Jev = require('../src/jev.js');

const MAX_BODY = 1024 * 1024;

/* opts: {apiKeys: [..], quiet, onRequest(req) → undefined | {status, headers, body}} — onRequest lets tests inject 429s etc. */
function createServer(opts = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      const t0 = Date.now();
      const request = { method: req.method, path: req.url, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined };
      let out;
      try {
        out = tooBig ? { status: 413, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: { detail: 'Request body too large' } }
          : (opts.onRequest && opts.onRequest(request)) || Jev.handle(request, { apiKeys: opts.apiKeys });
      } catch (e) {
        out = { status: 500, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: { detail: 'Internal Server Error' } };
        if (!opts.quiet) console.error(e);
      }
      log.push({ method: req.method, path: req.url, status: out.status });
      if (!opts.quiet) console.error(`${req.method} ${req.url} -> ${out.status} (${Date.now() - t0} ms)`);
      const payload = out.body == null ? '' : JSON.stringify(out.body);
      res.writeHead(out.status, Object.assign({}, out.headers, payload ? { 'content-length': Buffer.byteLength(payload) } : {}));
      res.end(payload);
    });
  });
  server.requestLog = log;
  return server;
}

function main(argv) {
  const o = { port: 8787, host: '127.0.0.1', keys: [], quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = +argv[++i];
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--key') o.keys.push(argv[++i]);
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') { console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ \* ?/gm, '')); return; }
    else { console.error('unknown option ' + a); process.exit(2); }
  }
  if (!Number.isInteger(o.port) || o.port < 0) { console.error('--port must be a number'); process.exit(2); }
  const server = createServer({ apiKeys: o.keys.length ? o.keys : undefined, quiet: o.quiet });
  server.listen(o.port, o.host, () => {
    const a = server.address();
    console.error(`Jev-compatible System One API (${Jev.MODEL}) on http://${a.address}:${a.port}  [POST /v1/systemone, GET /v1/models]${o.keys.length ? '  (API key required)' : '  (any bearer token accepted)'}`);
  });
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { createServer };
