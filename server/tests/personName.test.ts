import { describe, expect, it } from 'vitest';
import { personName } from '../src/lib/personName';

const isPersonName = (s: string) => personName(s) !== null;

describe('personName', () => {
  it('accepts names from many languages', () => {
    for (const n of ['Jane Roe', 'José García', 'Anna Müller', "Sinéad O'Connor", 'Ludwig van Beethoven', 'María de la Cruz', 'J. R. Smith', 'Jean-Luc Picard', 'Łukasz Żak', 'Анна Иванова', 'Νίκος Παππάς', 'Ngozi Okonjo-Iweala', 'Jose\u0301 Garci\u0301a', 'D’Angelo Russell', 'Bill Press', 'Abd al-Rahman', "Vincent d'Onofrio", 'Juan Carlos de la Torre']) expect([n, isPersonName(n)]).toEqual([n, true]);
  });
  it('rejects what is not a person', () => {
    for (const n of ['', 'Jane', 'jane roe', 'Editorial Staff', 'The Newsroom', 'Associated Press', 'News Desk', 'Team Verge', 'Read more here', 'Jane Roe 2025', 'Best Gaming Laptops Of The Year', 'Senior Vice President Of Sales', 'Terms Of Service And Privacy Policy', 'Agence France-Presse', 'Detroit Free Press', 'United Press International', 'Contact Us!', 'A'.repeat(300) + ' B', 'Subscribe to our weekly newsletter today']) expect([n, isPersonName(n)]).toEqual([n, false]);
  });
  it('tidies spacing', () => {
    expect(personName('  Jane\n   Roe\u00a0Smith ')).toBe('Jane Roe Smith');
  });
});
