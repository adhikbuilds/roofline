import { describe, expect, it } from 'vitest';
import { readFlags } from '../src/flags';
import { ENGINE_VERSION } from '../src/version';

describe('readFlags', () => {
  it('uses safe defaults for an empty env', () => {
    expect(readFlags({})).toEqual({
      dataMode: 'synthetic',
      llmEnabled: false,
      devMailbox: false,
      commuteProvider: 'heuristic',
    });
  });

  it('reads injected values', () => {
    expect(
      readFlags({
        ROOFLINE_DATA_MODE: 'licensed',
        ANTHROPIC_API_KEY: 'k',
        ROOFLINE_DEV_MAILBOX: '1',
        ROOFLINE_COMMUTE_PROVIDER: 'OSRM',
      }),
    ).toEqual({ dataMode: 'licensed', llmEnabled: true, devMailbox: true, commuteProvider: 'osrm' });
  });

  it('falls back on invalid enum values and treats blank key as disabled', () => {
    const f = readFlags({ ROOFLINE_DATA_MODE: 'bogus', ANTHROPIC_API_KEY: '  ', ROOFLINE_DEV_MAILBOX: 'yes' });
    expect(f.dataMode).toBe('synthetic');
    expect(f.llmEnabled).toBe(false);
    expect(f.devMailbox).toBe(false);
  });
});

describe('ENGINE_VERSION', () => {
  it('is a semver string', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
