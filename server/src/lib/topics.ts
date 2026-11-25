import type { CompanyProfile } from './companyProfile';

/**
 * What a company cares about, as search terms taken from its own profile. Discovery ranks by these,
 * so it favors whatever this company does rather than any fixed set of topics.
 */
export interface Topics { phrases: string[]; words: Set<string> }

const STOPWORDS = new Set(('about above after again against also among and any are because been before being between both build '
  + 'business businesses can client clients come company companies could customer customers data does each every for from gets give have helps help into '
  + 'its just know latest like made make makes many more most much need new news next not now offer only other our over people '
  + 'platform product products provide provides service services software solution solutions some such team teams than that the their them then there these they thing this those through '
  + 'tool tools under use used users using was way well were what when where which while who why will with within without work works world would year years you your').split(' '));

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+#]+/g, ' ').trim();
/** Very light stemming, so "utilities" and "utility", "queues" and "queue" meet. */
const stem = (w: string) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
const wordsOf = (s: string) => normalize(s).split(' ').filter(Boolean);
const significant = (s: string) => wordsOf(s).filter(w => (w.length >= 4 || /^(ai|vc|ev|hr|iot|api|b2b|law|tax)$/.test(w)) && !STOPWORDS.has(w)).map(stem);
const stemmed = (s: string) => ` ${wordsOf(s).map(stem).join(' ')} `;

export function topicsFrom(profile: CompanyProfile | null): Topics {
  if (!profile) return { phrases: [], words: new Set() };
  const listed = [
    ...profile.industry.split(/[,/|&;]|\band\b/),
    ...profile.spokespeople.flatMap(s => s.topics),
    ...profile.competitors,
  ];
  const phrases = [...new Set(listed.map(p => stemmed(p).trim()).filter(p => p.length >= 2 && !STOPWORDS.has(p)))];
  const words = new Set([
    ...listed, profile.one_liner, profile.products, profile.target_audience, ...profile.key_messages,
  ].flatMap(significant));
  return { phrases, words };
}

export interface Match { points: number; matched: string[] }

/** How closely a headline and its feed categories match. Categories are deliberate, so they count more. */
export function matchTopics(topics: Topics, title: string, categories: string[]): Match {
  const matched = new Set<string>();
  let points = 0;
  const score = (text: string, phrasePoints: number, wordPoints: number) => {
    const hay = stemmed(text);
    const phrase = topics.phrases.find(p => hay.includes(` ${p} `));
    if (phrase) { points += phrasePoints; matched.add(phrase); return; }
    const word = [...new Set(significant(text))].find(w => topics.words.has(w));
    if (word) { points += wordPoints; matched.add(word); }
  };
  for (const c of categories) score(c, 3, 2);
  score(title, 2, 1);
  return { points, matched: [...matched] };
}

/** A journalist's beat, as their publication labels it: the feed category they use most. */
export function commonCategory(categoryLists: string[][]): string {
  const counts = new Map<string, number>();
  for (const list of categoryLists) for (const c of new Set(list.map(x => x.trim()).filter(x => x.length >= 2))) counts.set(c, (counts.get(c) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top?.[0] ?? '';
}
