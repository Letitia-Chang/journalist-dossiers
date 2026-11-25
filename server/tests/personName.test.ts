import { describe, expect, it } from 'vitest';
import { isPersonName } from '../src/lib/personName';

describe('isPersonName', () => {
  it('accepts names from many languages', () => {
    for (const n of ['Jane Roe', 'José García', 'Anna Müller', "Sinéad O'Connor", 'Ludwig van Beethoven', 'María de la Cruz', 'J. R. Smith', 'Jean-Luc Picard', 'Łukasz Żak', 'Анна Иванова', 'Νίκος Παππάς', 'Ngozi Okonjo-Iweala', 'Jose\u0301 Garci\u0301a', 'D’Angelo Russell']) expect([n, isPersonName(n)]).toEqual([n, true]);
  });
  it('rejects what is not a person', () => {
    for (const n of ['', 'Jane', 'jane roe', 'Editorial Staff', 'The Newsroom', 'Associated Press', 'News Desk', 'Team Verge', 'Read more here', 'Jane Roe 2025', 'Contact Us!', 'A'.repeat(300) + ' B', 'Subscribe to our weekly newsletter today']) expect([n, isPersonName(n)]).toEqual([n, false]);
  });
});
