const STOPWORDS = new Set([
  'for', 'rent', 'bhk', 'flat', 'apartment', 'in', 'at', 'near',
  'bangalore', 'bengaluru', 'sale', 'fully', 'semi', 'furnished',
]);

/** Lowercased, stopword-stripped, de-duplicated title tokens used by dedup. */
export function titleTokens(title: unknown): string[] {
  if (typeof title !== 'string') return [];
  const words = title.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u);
  const seen = new Set<string>();
  for (const w of words) if (w && !STOPWORDS.has(w)) seen.add(w);
  return [...seen];
}
