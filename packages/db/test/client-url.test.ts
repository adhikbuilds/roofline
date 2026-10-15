import { describe, expect, it } from 'vitest';
import { isLocalUrl } from '../src/client.js';

describe('isLocalUrl', () => {
  it.each([
    'postgres://roofline:roofline@localhost:5432/roofline',
    'postgres://u:p@127.0.0.1:5432/db',
    'postgres://u:p@[::1]:5432/db',
  ])('accepts %s', (url) => expect(isLocalUrl(url)).toBe(true));

  it.each([
    'postgres://u:p@prod.example.com/db?x=localhost',
    'postgres://localhost:pw@prod.example.com/db',
    'postgres://u:p@localhost:5432/db?host=prod.example.com',
    'postgres://u:p@localhost.evil.com/db',
    'not a url',
  ])('rejects %s', (url) => expect(isLocalUrl(url)).toBe(false));
});
