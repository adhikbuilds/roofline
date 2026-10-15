/**
 * Every page route that exists in the current phase. The @overflow check walks all of them.
 * A `[id]` segment is resolved at test time to a real multi-source listing found on the home list.
 */
export const ROUTES = ['/', '/localities', '/listing/[id]'] as const;
