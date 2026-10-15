import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from '../src/cli';

function deps(over: Partial<CliDeps> = {}): CliDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    seed: async () => void calls.push('seed'),
    run: async (week) => void calls.push(`run:${week}`),
    evalQuality: async () => {
      calls.push('eval');
      return { ok: true, lines: ['planted_rejects=3 matched=3 extra_rejects=0'] };
    },
    ...over,
  };
}

describe('cli', () => {
  it('lists run, seed and eval commands, with eval quality as a subcommand', () => {
    const p = buildProgram(() => {}, deps());
    expect(p.commands.map((c) => c.name())).toEqual(['run', 'seed', 'eval']);
    expect(p.commands.find((c) => c.name() === 'eval')?.commands.map((c) => c.name())).toEqual(['quality']);
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
});
