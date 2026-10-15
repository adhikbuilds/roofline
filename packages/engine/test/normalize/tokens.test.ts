import { describe, expect, it } from 'vitest';
import { titleTokens } from '../../src/normalize/tokens';

describe('titleTokens', () => {
  it('lowercases and strips stopwords', () => {
    expect(titleTokens('Spacious 2 BHK Flat for rent in Indiranagar, Bangalore')).toEqual(['spacious', '2', 'indiranagar']);
  });
  it('strips fully/semi/furnished/near/at/sale/apartment/bengaluru', () => {
    expect(titleTokens('Fully Furnished Apartment at HSR near Bengaluru for sale')).toEqual(['hsr']);
    expect(titleTokens('Semi furnished sunny')).toEqual(['sunny']);
  });
  it('dedupes preserving order and handles punctuation and unicode', () => {
    expect(titleTokens('Cozy, cozy!! Café-style flat')).toEqual(['cozy', 'café', 'style']);
  });
  it('is empty for junk', () => {
    for (const x of [null, undefined, '', '   ', 5, {}]) expect(titleTokens(x)).toEqual([]);
  });
});
