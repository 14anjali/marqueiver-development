/**
 * Frontend ↔ backend API contract check.
 *
 * Boots the real Express app, walks its router stack for every mounted route,
 * then extracts every call the frontend actually makes and matches the two.
 *
 * Answers three questions that static reading cannot:
 *   - which endpoints does the frontend call that the backend does not serve?
 *   - which endpoints exist that nothing calls?
 *   - does each side agree on the HTTP method?
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SERVER = process.argv[2];
const FRONTEND = process.argv[3];

process.env.NODE_ENV = 'test';
process.env.INTEGRATION_MODE = 'mock';

/* ── 1. every route the server actually mounts ─────────────────────────────── */

const { createApp } = await import(path.join(SERVER, 'src/app.js'));
const app = createApp();

const routes = [];
function walk(stack, prefix = '') {
  for (const layer of stack) {
    if (layer.route) {
      const p = prefix + layer.route.path;
      for (const [m, on] of Object.entries(layer.route.methods)) {
        const clean = p.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
        if (on) routes.push({ method: m.toUpperCase(), path: clean, layer: layer.route.stack.length });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      // Recover the mount path from the layer's regexp.
      const src = layer.regexp?.source ?? '';
      const m = src.match(/^\^\\\/(?:\(\?:\)\?)?((?:[\w\-.~%]|\\\/)*)/);
      const mounted = m ? '/' + m[1].replace(/\\\//g, '/') : '';
      walk(layer.handle.stack, (prefix + mounted).replace(/\/+/g, '/').replace(/\/$/, ''));
    }
  }
}
walk(app._router?.stack ?? app.router?.stack ?? []);

/* ── 2. every call the frontend makes ──────────────────────────────────────── */

function files(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(jsx?|tsx?)$/.test(e)) out.push(p);
  }
  return out;
}

const calls = [];
for (const f of files(path.join(FRONTEND, 'src'))) {
  const src = readFileSync(f, 'utf8');

  // req('/api/...', { method: 'POST' })  — the shared client
  for (const m of src.matchAll(/req\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*(?:,\s*\{([^}]*)\})?/g)) {
    const raw = m[1].slice(1, -1);
    if (!raw.startsWith('/api') && !raw.startsWith('/health')) continue;
    const method = (m[2]?.match(/method:\s*'(\w+)'/)?.[1] ?? 'GET').toUpperCase();
    calls.push({ raw, method, file: path.relative(FRONTEND, f) });
  }
}

/* ── 3. match ──────────────────────────────────────────────────────────────── */

/**
 * `${...}` can contain nested braces and backticks — a ternary building a query
 * string is the common case — so scan with a depth counter. A non-greedy
 * `[^}]*` stops at the first inner `}` and leaves the tail in the path, which
 * made ten query-string builders look like calls to endpoints that do not exist.
 */
function stripHoles(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth += 1;
        else if (raw[i] === '}') depth -= 1;
        i += 1;
      }
      i -= 1;
      out += '\u0001';   // a value went here — keeps the segment
    } else out += raw[i];
  }
  return out;
}

/**
 * `/api/deals/${id}/apply` -> parts that tolerate :params on the server side.
 *
 * The extraction regex above uses `` `[^`]*` ``, which stops at the first
 * backtick *inside* a nested template — so a query builder like
 * `` `/api/x${q ? `?${q}` : ''}` `` arrives here already truncated to
 * `/api/x${q ? `. An unterminated `${` is therefore not a path segment at all;
 * everything from it onward is a query string being assembled, and the route
 * is what precedes it.
 */
function toMatcher(raw) {
  const opens = (raw.match(/\$\{/g) ?? []).length;
  const closes = (raw.match(/\}/g) ?? []).length;
  const truncated = opens > closes ? raw.slice(0, raw.indexOf('${')) : raw;

  return stripHoles(truncated)
    .replace(/\?.*$/, '')
    .split('/')
    .filter(Boolean)
    /**
     * A hole is only a path parameter when it IS the whole segment.
     *
     * `/api/deals/${id}` — the segment is the value, so it must line up with a
     * `:param`. `/api/notifications${unread ? '?unread=true' : ''}` — the hole
     * is glued to the end of a literal segment, which means it is building a
     * query string, not naming a resource. Treated as a parameter it would look
     * like a call to an endpoint that does not exist.
     */
    .map((seg) => (seg === '' ? seg : seg.replace(//g, '')));
}

function serverParts(p) {
  return p.split('/').filter(Boolean);
}

function matches(callParts, routeParts) {
  if (callParts.length !== routeParts.length) return false;
  return callParts.every((c, i) => {
    const r = routeParts[i];
    if (r.startsWith(':')) return true;          // any value fills a param
    if (c.includes("\u0001")) return r.startsWith(':'); // a hole must be a param
    return c === r;
  });
}

const unmatched = [];
const methodMismatch = [];
const matchedRoutes = new Set();

for (const call of calls) {
  const cp = toMatcher(call.raw);
  const samePath = routes.filter((r) => matches(cp, serverParts(r.path)));

  if (!samePath.length) {
    unmatched.push(call);
    continue;
  }
  const exact = samePath.find((r) => r.method === call.method);
  if (!exact) {
    methodMismatch.push({ call, serverHas: [...new Set(samePath.map((r) => r.method))] });
  } else {
    matchedRoutes.add(`${exact.method} ${exact.path}`);
  }
}

const uncalled = routes
  .filter((r) => !matchedRoutes.has(`${r.method} ${r.path}`))
  .filter((r) => !r.path.includes('webhook') && !r.path.includes('deauthorize')
    && !r.path.includes('data-deletion') && r.path !== '/health');

/* ── report ────────────────────────────────────────────────────────────────── */

console.log(`routes mounted : ${routes.length}`);
console.log(`frontend calls : ${calls.length} (${new Set(calls.map((c) => c.raw)).size} distinct)`);
console.log(`matched        : ${matchedRoutes.size}`);
console.log();

if (unmatched.length) {
  console.log(`### CALLED BUT NOT SERVED (${unmatched.length}) — these 404 at runtime`);
  for (const c of unmatched) console.log(`  ${c.method.padEnd(6)} ${c.raw}\n         ${c.file}`);
  console.log();
}

if (methodMismatch.length) {
  console.log(`### METHOD MISMATCH (${methodMismatch.length})`);
  for (const m of methodMismatch) {
    console.log(`  frontend ${m.call.method} ${m.call.raw}`);
    console.log(`  server has ${m.serverHas.join(', ')}  (${m.call.file})`);
  }
  console.log();
}

console.log(`### SERVED BUT NEVER CALLED (${uncalled.length})`);
for (const r of uncalled) console.log(`  ${r.method.padEnd(6)} ${r.path}`);
console.log();

const fatal = unmatched.length + methodMismatch.length;
console.log(fatal ? `FAIL — ${fatal} contract break(s)` : 'PASS — no contract breaks');
process.exit(0);
