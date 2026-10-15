import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from '../src/cli';

function deps(over: Partial<CliDeps> = {}): CliDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    seed: async () => void calls.push('seed'),
    run: async (week, _log, opts) => void calls.push(`run:${week}${opts?.full ? ':full' : ''}`),
    evalDedup: async () => {
      calls.push('eval-dedup');
      return { ok: true, lines: ['pairwise_precision=1.0000'] };
    },
    modelFit: async (opts) => void calls.push(`model-fit:${opts.asOf ?? ''}:${opts.windowDays ?? ''}`),
    evalFairRent: async () => {
      calls.push('eval-fairrent');
      return { ok: true, lines: ['eval:fairrent OK'] };
    },
    evalDeals: async () => {
      calls.push('eval-deals');
      return { ok: true, lines: ['eval:deals OK'] };
    },
    evalQuality: async () => {
      calls.push('eval');
      return { ok: true, lines: ['planted_rejects=3 matched=3 extra_rejects=0'] };
    },
    ...over,
  };
}

describe('cli', () => {
  it('lists run, seed and eval commands, with eval quality and dedup as subcommands', () => {
    const p = buildProgram(() => {}, deps());
    expect(p.commands.map((c) => c.name())).toEqual(['run', 'seed', 'model', 'eval']);
    expect(p.commands.find((c) => c.name() === 'model')?.commands.map((c) => c.name())).toEqual(['fit']);
    expect(p.commands.find((c) => c.name() === 'eval')?.commands.map((c) => c.name())).toEqual(['quality', 'dedup', 'fairrent', 'deals']);
  });

  it('seed runs the injected seeder', async () => {
    const d = deps();
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'seed']);
    expect(d.calls).toEqual(['seed']);
  });

  it('run passes the week index and defaults to week 0', async () => {
    const d = deps();
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', '--week', '7']);
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run']);
    expect(d.calls).toEqual(['run:7', 'run:0']);
  });

  it('run rejects an out-of-range or non-numeric week', async () => {
    const d = deps();
    await expect(buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', '--week', '26'])).rejects.toThrow(/week/);
    await expect(buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', '--week', 'x'])).rejects.toThrow(/week/);
    expect(d.calls).toEqual([]);
  });

  it('eval quality prints the report lines and sets a failing exit code when not ok', async () => {
    const lines: string[] = [];
    const prev = process.exitCode;
    await buildProgram((m) => lines.push(m), deps()).parseAsync(['node', 'cli', 'eval', 'quality']);
    expect(lines).toEqual(['planted_rejects=3 matched=3 extra_rejects=0']);
    expect(process.exitCode).toBe(prev);

    const fail = vi.fn();
    await buildProgram(fail, deps({ evalQuality: async () => ({ ok: false, lines: ['planted_rejects=3 matched=2 extra_rejects=0'] }) })).parseAsync(['node', 'cli', 'eval', 'quality']);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
  });

  it('run accepts --source synthetic, resolves --as-of to its week and passes --full', async () => {
    const d = deps();
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', '--source', 'synthetic', '--as-of', '2026-10-01']);
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', '--source', 'synthetic', '--as-of', '2026-04-09', '--full']);
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', '--week', '3', '--full']);
    expect(d.calls).toEqual(['run:25', 'run:0:full', 'run:3:full']);
  });

  it('run rejects an unknown source, an off-week as-of, a malformed date and both --week and --as-of', async () => {
    const d = deps();
    const run = (...a: string[]) => buildProgram(() => {}, d).parseAsync(['node', 'cli', 'run', ...a]);
    await expect(run('--source', 'elsewhere')).rejects.toThrow(/unknown source/);
    await expect(run('--as-of', '2026-10-02')).rejects.toThrow(/weekly/);
    await expect(run('--as-of', 'yesterday')).rejects.toThrow(/YYYY-MM-DD/);
    await expect(run('--week', '1', '--as-of', '2026-10-01')).rejects.toThrow(/either/);
    expect(d.calls).toEqual([]);
  });

  it('eval dedup prints the report and sets a failing exit code when not ok', async () => {
    const lines: string[] = [];
    const prev = process.exitCode;
    await buildProgram((m) => lines.push(m), deps()).parseAsync(['node', 'cli', 'eval', 'dedup']);
    expect(lines).toEqual(['pairwise_precision=1.0000']);
    expect(process.exitCode).toBe(prev);
    await buildProgram(() => {}, deps({ evalDedup: async () => ({ ok: false, lines: ['x'] }) })).parseAsync(['node', 'cli', 'eval', 'dedup']);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
  });

  it('model fit passes --as-of and --window-days through', async () => {
    const d = deps();
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'model', 'fit']);
    await buildProgram(() => {}, d).parseAsync(['node', 'cli', 'model', 'fit', '--as-of', '2026-10-01', '--window-days', '91']);
    expect(d.calls).toEqual(['model-fit::', 'model-fit:2026-10-01:91']);
  });

  it('model fit rejects a bad date or window', async () => {
    const d = deps();
    await expect(buildProgram(() => {}, d).parseAsync(['node', 'cli', 'model', 'fit', '--as-of', '10/01'])).rejects.toThrow(/as-of/);
    await expect(buildProgram(() => {}, d).parseAsync(['node', 'cli', 'model', 'fit', '--window-days', '0'])).rejects.toThrow(/window/);
    expect(d.calls).toEqual([]);
  });

  it.each(['fairrent', 'deals'])('eval %s prints lines and fails the exit code when not ok', async (name) => {
    const prev = process.exitCode;
    const lines: string[] = [];
    await buildProgram((m) => lines.push(m), deps()).parseAsync(['node', 'cli', 'eval', name]);
    expect(lines).toEqual([`eval:${name} OK`]);
    expect(process.exitCode).toBe(prev);
    const bad = { ok: false, lines: ['x'] };
    await buildProgram(() => {}, deps({ evalFairRent: async () => bad, evalDeals: async () => bad })).parseAsync(['node', 'cli', 'eval', name]);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
  });
});
