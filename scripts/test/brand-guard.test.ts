import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scan } from '../brand-guard';

// Banned words are assembled at runtime so this file itself stays clean.
const BANNED = ['casa', 'setu'].join('');
const BANNED_ALL = [
  BANNED,
  ['no', 'broker'].join(''),
  ['magic', 'bricks'].join(''),
  ['nest', 'away'].join(''),
  ['rentmy', 'stay'].join(''),
  ['99', 'acres'].join(''),
  ['housing', '.com'].join(''),
  ['static', 'mb'].join(''),
];

let root: string;

function put(rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brand-guard-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('brand-guard scan', () => {
  it('passes on a clean directory', () => {
    put('apps/web/page.tsx', 'export const x = "Roofline";\n');
    expect(scan(root)).toEqual([]);
  });

  it('fails on a file under apps/ containing a banned word, reporting file and line', () => {
    put('apps/web/page.tsx', `line one\nvisit ${BANNED} now\n`);
    const hits = scan(root);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: 'apps/web/page.tsx', line: 2 });
  });

  it.each(BANNED_ALL)('detects %s case-insensitively', (word) => {
    put('packages/x/a.ts', `// ${word.toUpperCase()}\n`);
    expect(scan(root)).toHaveLength(1);
  });

  it('exempts PLAN.md, CLAUDE.md and docs/recon/**', () => {
    put('PLAN.md', BANNED);
    put('CLAUDE.md', BANNED);
    put('docs/recon/notes.md', BANNED);
    put('docs/recon/deep/x.md', BANNED);
    expect(scan(root)).toEqual([]);
  });

  it('does not exempt other docs or look-alike paths', () => {
    put('docs/other.md', BANNED);
    put('docs/reconnaissance.md', BANNED);
    put('apps/PLAN.md', BANNED);
    expect(scan(root).map((h) => h.file).sort()).toEqual(['apps/PLAN.md', 'docs/other.md', 'docs/reconnaissance.md']);
  });

  it('skips node_modules and binary files', () => {
    put('node_modules/pkg/index.js', BANNED);
    writeFileSync(join(root, 'img.bin'), Buffer.from([0, 1, 2, ...Buffer.from(BANNED)]));
    expect(scan(root)).toEqual([]);
  });

  it('in a git repo scans tracked and untracked files but honours .gitignore', () => {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    put('.gitignore', 'ignored/\n');
    put('ignored/a.txt', BANNED);
    put('tracked.txt', BANNED);
    git('add', 'tracked.txt');
    put('untracked.txt', BANNED);
    expect(scan(root).map((h) => h.file).sort()).toEqual(['tracked.txt', 'untracked.txt']);
  });

  it('ignores a tracked file that was deleted from disk', () => {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    put('gone.txt', BANNED);
    git('add', 'gone.txt');
    rmSync(join(root, 'gone.txt'));
    expect(scan(root)).toEqual([]);
  });
});
