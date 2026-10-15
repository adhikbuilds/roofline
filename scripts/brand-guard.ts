/**
 * Fails when a reference-product / portal name appears anywhere in the repo,
 * except in files that legitimately discuss them (PLAN.md, CLAUDE.md, docs/recon/**)
 * and this file, which defines the pattern.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BANNED = /casasetu|nobroker|magicbricks|nestaway|rentmystay|99acres|housing\.com|staticmb/i;

const EXEMPT_EXACT = new Set(['PLAN.md', 'CLAUDE.md', 'docs/PLAN.md', 'scripts/brand-guard.ts']);
const EXEMPT_PREFIX = ['docs/recon/'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', '.turbo']);

export interface Violation {
  file: string; // posix-style, relative to root
  line: number;
  text: string;
}

function isExempt(rel: string): boolean {
  return EXEMPT_EXACT.has(rel) || EXEMPT_PREFIX.some((p) => rel.startsWith(p));
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(root, abs, out);
    else if (st.isFile()) out.push(relative(root, abs).split(sep).join('/'));
  }
  return out;
}

/** git ls-files (tracked + untracked, non-ignored); falls back to a directory walk outside a git repo. */
function listFiles(root: string): string[] {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    // Only trust git when root IS the repo top-level.
    if (realpathSync(top) !== realpathSync(root)) throw new Error('not a repo root');
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    return [...new Set(out.split('\0').filter(Boolean))];
  } catch {
    return walk(root);
  }
}

export function scan(root: string): Violation[] {
  const hits: Violation[] = [];
  for (const rel of listFiles(root).sort()) {
    if (isExempt(rel) || rel.split('/').some((s) => SKIP_DIRS.has(s))) continue;
    let buf: Buffer;
    try {
      const abs = join(root, rel);
      if (!statSync(abs).isFile()) continue;
      buf = readFileSync(abs);
    } catch {
      continue; // deleted or unreadable
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    buf
      .toString('utf8')
      .split(/\r?\n/)
      .forEach((text, i) => {
        if (BANNED.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim().slice(0, 160) });
      });
  }
  return hits;
}

function main(): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const hits = scan(root);
  if (hits.length === 0) {
    console.log('brand-guard: clean');
    return 0;
  }
  console.error(`brand-guard: ${hits.length} banned reference(s) found`);
  for (const h of hits) console.error(`${h.file}:${h.line}: ${h.text}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
