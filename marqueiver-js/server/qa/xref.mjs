/**
 * Static cross-reference audit for the Marqueiver server.
 *
 * Loads every module and reports:
 *  1. named imports that the target module does not export  (→ "X is not a function")
 *  2. namespace-import member uses (ns.foo) with no matching export
 *  3. route handlers that are undefined at registration time
 *
 * Pure static + real ESM resolution. No network, no DB.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const SRC = path.join(ROOT, 'src');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = await walk(SRC);
const problems = [];

// ---- collect exports per file by actually importing it -----------------
const exportsOf = new Map();
for (const f of files) {
  try {
    const m = await import(pathToFileURL(f).href);
    exportsOf.set(f, new Set(Object.keys(m)));
  } catch (err) {
    problems.push({ kind: 'LOAD', file: rel(f), detail: `${err.constructor.name}: ${err.message}` });
  }
}

function rel(f) { return path.relative(ROOT, f); }

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  return path.resolve(path.dirname(fromFile), spec);
}

// ---- parse imports -----------------------------------------------------
for (const f of files) {
  const src = readFileSync(f, 'utf8');

  // named:  import { a, b as c } from './x.js'
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(f, m[2]);
    if (!target || !exportsOf.has(target)) continue;
    const have = exportsOf.get(target);
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!have.has(name)) {
        problems.push({
          kind: 'MISSING_EXPORT', file: rel(f),
          detail: `imports { ${name} } from ${m[2]} — not exported`,
        });
      }
    }
  }

  // namespace: import * as ns from './x.js'   → then check ns.member uses
  /*
    Scanned with the import statements removed, because the specifier is a
    *string* that very often contains the namespace followed by a dot:

        import * as cashfree from '../../services/cashfree.service.js';
                                                  ^^^^^^^^^^^^^^^^

    `\bcashfree\.(\w+)` matches `cashfree.service` inside that path and reports
    `service` as a missing export — for five real, correct imports in this
    codebase. Every one of those was a false alarm from the checker reading its
    own import line, and five false alarms is enough for a reader to stop
    trusting the section.
  */
  const withoutImports = src.replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"]\s*;?/gm, '');

  for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s*from\s*['"]([^'"]+)['"]/g)) {
    const [, ns, spec] = m;
    const target = resolveSpec(f, spec);
    if (!target || !exportsOf.has(target)) continue;
    const have = exportsOf.get(target);
    const used = new Set([...withoutImports.matchAll(new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((x) => x[1]));
    for (const name of used) {
      if (!have.has(name)) {
        problems.push({
          kind: 'MISSING_EXPORT', file: rel(f),
          detail: `uses ${ns}.${name} from ${spec} — not exported`,
        });
      }
    }
  }
}

// ---- route handlers defined? -------------------------------------------
/**
 * A route handler must resolve to *something* in the module: an import, or a
 * binding declared in the file itself.
 *
 * Only imports were counted before, which made every module-local middleware a
 * reported problem — `const sendLimiter = rateLimit(...)` at the top of
 * auth.routes.js, `const brandsOnly = requireRole('brand','admin')` in
 * discovery.routes.js, and the per-module OAuth limiters. Twenty-five entries,
 * all of them correct code.
 *
 * That is worse than not checking at all. A gate whose output is mostly noise
 * teaches the reader to skim it, and the one genuine failure it is there to
 * catch goes past with the rest. Local declarations are resolved now, and the
 * section is empty unless something is actually undefined.
 */
for (const f of files.filter((x) => x.includes('.routes.'))) {
  const src = readFileSync(f, 'utf8');
  const imported = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of m[1].split(',')) imported.add(raw.trim().split(/\s+as\s+/).pop().trim());
  }
  // Default and namespace imports: `import c from …`, `import * as c from …`.
  for (const m of src.matchAll(/import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) {
    imported.add(m[1]);
  }
  // Bindings the module declares for itself.
  for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) {
    imported.add(m[1]);
  }
  for (const m of src.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    imported.add(m[1]);
  }
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,([^)]*)\)/g)) {
    const [, verb, route, argstr] = m;
    for (const tok of argstr.split(',').map((s) => s.trim()).filter(Boolean)) {
      const bare = tok.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
      if (bare && !imported.has(bare)) {
        problems.push({
          kind: 'ROUTE_HANDLER', file: rel(f),
          detail: `${verb.toUpperCase()} ${route} → handler "${bare}" is not imported here`,
        });
      }
    }
  }
}

// ---- report ------------------------------------------------------------
const byKind = {};
for (const p of problems) (byKind[p.kind] ??= []).push(p);

console.log(`files scanned: ${files.length}   loaded: ${exportsOf.size}   problems: ${problems.length}\n`);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`### ${kind}  (${list.length})`);
  for (const p of list) console.log(`  ${p.file}\n      ${p.detail}`);
  console.log();
}
if (!problems.length) console.log('No cross-reference problems found.');
