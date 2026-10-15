/**
 * Typed feature flags. The engine never touches process.env; callers inject an env-like object.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export type DataMode = 'synthetic' | 'licensed';
export type CommuteProvider = 'heuristic' | 'osrm';

export interface Flags {
  readonly dataMode: DataMode;
  /** True when an LLM key is configured. The app must work without it. */
  readonly llmEnabled: boolean;
  readonly devMailbox: boolean;
  readonly commuteProvider: CommuteProvider;
}

export type Flag = keyof Flags;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = value?.trim().toLowerCase();
  return allowed.find((a) => a === v) ?? fallback;
}

export function readFlags(env: EnvLike): Flags {
  return {
    dataMode: oneOf(env.ROOFLINE_DATA_MODE, ['synthetic', 'licensed'], 'synthetic'),
    llmEnabled: (env.ANTHROPIC_API_KEY ?? '').trim() !== '',
    devMailbox: env.ROOFLINE_DEV_MAILBOX?.trim() === '1',
    commuteProvider: oneOf(env.ROOFLINE_COMMUTE_PROVIDER, ['heuristic', 'osrm'], 'heuristic'),
  };
}
