/**
 * Every page route that exists in the current phase. The @overflow check walks all of them.
 * A `[id]` segment is resolved at test time to a real multi-source listing found on the /homes list.
 */
export const ROUTES = ['/', '/homes', '/localities', '/deals', '/listing/[id]'] as const;
