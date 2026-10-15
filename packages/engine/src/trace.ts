/**
 * Explanation trace: an append-only list of "why" steps recorded by fair-rent, deals, etc.
 * Pure and immutable; carries no timestamps (callers inject time if they need it).
 */
export interface TraceStep {
  /** Stable machine id of the rule/step, e.g. "comps.filter". */
  readonly rule: string;
  /** Human-readable explanation. */
  readonly message: string;
  /** Optional structured evidence. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface Trace {
  readonly steps: readonly TraceStep[];
}

export interface TraceBuilder {
  /** Returns a NEW builder with the step appended; the original is unchanged. */
  step(rule: string, message: string, data?: Record<string, unknown>): TraceBuilder;
  build(): Trace;
}

function make(steps: readonly TraceStep[]): TraceBuilder {
  return {
    step(rule, message, data) {
      const next: TraceStep = data === undefined ? { rule, message } : { rule, message, data: { ...data } };
      return make([...steps, next]);
    },
    build() {
      return { steps: [...steps] };
    },
  };
}

export function createTrace(): TraceBuilder {
  return make([]);
}

/** One-line-per-step rendering for logs and tests. */
export function formatTrace(trace: Trace): string {
  return trace.steps.map((s, i) => `${i + 1}. [${s.rule}] ${s.message}`).join('\n');
}
