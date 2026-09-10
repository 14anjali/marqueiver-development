/**
 * Every `api.something(...)` in the frontend resolves to a method the client
 * actually exports.
 *
 * ── Why this gate exists ────────────────────────────────────────────────────
 *
 * `contract.mjs` matches the URLs the frontend requests against the routes the
 * server registers, which catches a call to an endpoint that does not exist. It
 * cannot catch this: a page calling `api.disconnectInstagram()` when the client
 * only exports `api.instagramDisconnect` never reaches the network at all. The
 * property is `undefined`, calling it throws `TypeError`, and — because these
 * calls almost always sit inside a `try { … } catch (e) { toast.push(e.message)
 * }` — the user is shown a toast reading
 *
 *     api.disconnectInstagram is not a function
 *
 * and the button simply never works. That is exactly what happened to the
 * Instagram disconnect on the profile page: the endpoint existed, the route was
 * registered, `contract.mjs` passed, and the feature had never worked.
 *
 * JavaScript gives no compile step to catch a typo in a property name, so this
 * is the compile step.
 *
 * ── What it does and does not check ─────────────────────────────────────────
 *
 * It resolves NAMES, not signatures — `api.login()` with the wrong number of
 * arguments is out of scope, as is anything reached through a variable
 * (`api[name]()`), which it reports separately so a dynamic call is a visible
 * exception rather than a silent hole.
 *
 * Comments are stripped before scanning, so a `//` or `/* … *\/` line that
 * *names* a removed method — for instance one documenting the bug above — is
 * not itself reported as a use of it.
 *
 * Usage:  node qa/apiref.mjs <frontendDir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FE = process.argv[2];
if (!FE) {
    console.error('usage: node qa/apiref.mjs <frontendDir>');
    process.exit(2);
}

const API_FILE = path.join(FE, 'src/lib/api.js');

/**
 * Remove comments and string/template contents.
 *
 * A naive regex over raw source counts `api.foo` inside a doc comment as a
 * call, which turns a note explaining a fixed bug into a permanent failure. It
 * also counts one inside a string. Neither is code.
 *
 * This is a small scanner rather than a parser because the only thing it has to
 * get right is "which byte ranges are code", and the state machine for that is
 * five states long.
 */
function stripNonCode(src) {
    let out = '';
    let i = 0;
    const n = src.length;

    while (i < n) {
        const c = src[i];
        const next = src[i + 1];

        // line comment
        if (c === '/' && next === '/') {
            while (i < n && src[i] !== '\n') i += 1;
            continue;
        }
        // block comment
        if (c === '/' && next === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        // string or template literal — keep the quotes so the surrounding code
        // still parses positionally, drop the contents
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += quote;
            i += 1;
            let depth = 0;
            while (i < n) {
                if (src[i] === '\\') { i += 2; continue; }
                // A `${ … }` hole in a template is code and must be kept.
                if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
                    depth += 1;
                    out += '${';
                    i += 2;
                    continue;
                }
                if (depth > 0) {
                    if (src[i] === '}') { depth -= 1; out += '}'; i += 1; continue; }
                    out += src[i];
                    i += 1;
                    continue;
                }
                if (src[i] === quote) { out += quote; i += 1; break; }
                i += 1;
            }
            continue;
        }

        out += c;
        i += 1;
    }
    return out;
}

/** The keys of the exported `api` object literal, at its top level only. */
function exportedApiMethods() {
    const src = stripNonCode(readFileSync(API_FILE, 'utf8'));
    const start = src.indexOf('export const api = {');
    if (start === -1) throw new Error('could not find `export const api = {` in src/lib/api.js');

    // Walk to the matching brace so nested option objects are not mistaken for
    // more methods.
    const open = src.indexOf('{', start);
    let braces = 0;
    let end = open;
    for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') braces += 1;
        else if (src[i] === '}') {
            braces -= 1;
            if (braces === 0) { end = i; break; }
        }
    }

    const body = src.slice(open + 1, end);

    /*
      Top-level keys are those declared on a line that *begins* at nesting
      depth 0.

      Testing the depth at the END of the line instead is wrong, and wrong in a
      way that quietly shrinks the known-methods set: a method whose body opens
      a brace —

          downloadMediaKit: async (filename = 'media-kit.pdf') => {

      — ends its first line at depth 1, so the key was skipped, and every page
      calling it was then reported as calling something that does not exist.
      That is a false failure that would train someone to ignore this gate.
    */
    const keys = new Set();
    let depth = 0;
    for (const line of body.split('\n')) {
        if (depth === 0) {
            const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
            if (m) keys.add(m[1]);
        }
        for (const ch of line) {
            if (ch === '{' || ch === '[' || ch === '(') depth += 1;
            else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
        }
    }
    return keys;
}

function walk(dir, out = []) {
    for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.jsx?$/.test(e)) out.push(p);
    }
    return out;
}

const methods = exportedApiMethods();
const files = walk(path.join(FE, 'src'));

const missing = [];
let dynamic = 0;
let references = 0;

for (const file of files) {
    if (path.resolve(file) === path.resolve(API_FILE)) continue;
    const code = stripNonCode(readFileSync(file, 'utf8'));

    for (const m of code.matchAll(/\bapi\.([A-Za-z_$][\w$]*)/g)) {
        references += 1;
        const name = m[1];
        if (!methods.has(name)) {
            const line = code.slice(0, m.index).split('\n').length;
            missing.push({ name, file: path.relative(FE, file), line });
        }
    }

    // `api[expr]()` — legitimate, but it cannot be checked, so it is counted
    // and shown rather than passed over in silence.
    dynamic += [...code.matchAll(/\bapi\[/g)].length;
}

console.log(`${methods.size} api methods exported`);
console.log(`${references} static api.* references across ${files.length} files`);
if (dynamic) console.log(`${dynamic} dynamic api[...] reference(s) — not checkable, review by hand`);

if (missing.length) {
    console.log();
    for (const r of missing) {
        console.log(`  ${r.file}:${r.line}  api.${r.name} does not exist`);
    }
    console.log(`\nFAIL — ${missing.length} unresolved api.* reference(s)`);
    process.exit(1);
}

console.log('\nPASS — every api.* reference resolves');
