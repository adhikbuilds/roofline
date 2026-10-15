/**
 * GET /api/health body. The probe is injected so this stays unit-testable; the route wires it to a
 * read-only query as the unprivileged app role (the same path every page uses).
 */
export type HealthBody = {
  ok: boolean;
  db: boolean;
  /** Id of the active model run (what every fair-rent number was computed from), null when none or unreadable. */
  dataVersion: number | null;
  engineVersion: string;
  dataMode: string;
};
export type HealthProbe = () => Promise<{ activeRunId: number | string | null }>;

export async function buildHealth(
  probe: HealthProbe,
  meta: { engineVersion: string; dataMode: string },
): Promise<{ status: 200 | 503; body: HealthBody }> {
  try {
    const { activeRunId } = await probe();
    const n = activeRunId === null ? NaN : Number(activeRunId);
    return {
      status: 200,
      body: { ok: true, db: true, dataVersion: Number.isSafeInteger(n) ? n : null, ...meta },
    };
  } catch {
    // Never echo the driver error: it can carry hostnames or credentials.
    return { status: 503, body: { ok: false, db: false, dataVersion: null, ...meta } };
  }
}
