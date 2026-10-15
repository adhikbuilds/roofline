import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli';

describe('cli', () => {
  it('lists run, seed and eval commands', () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toEqual(['run', 'seed', 'eval']);
  });

  it.each(['run', 'seed', 'eval'])('%s is a stub that logs not implemented', async (cmd) => {
    const lines: string[] = [];
    await buildProgram((m) => lines.push(m)).parseAsync(['node', 'cli', cmd]);
    expect(lines).toEqual([`${cmd}: not implemented until Phase 1`]);
  });
});
