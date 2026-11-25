import type { CompanyProfile } from './companyProfile';

/**
 * What a company cares about, as search terms taken from its own profile. Discovery ranks by these,
 * so it favors whatever this company does rather than any fixed set of topics.
 *
 * Listed terms (industry, spokesperson topics, competitors) are deliberate, so each counts. Words
 * from sentences are mostly ordinary, so they only count two at a time and can't rank anyone high.
 */
export interface Topics { phrases: string[]; words: Set<string>; prose: Set<string> }

const STOPWORDS = new Set((
  'a about above across after again against all almost already also always am an and another any are as at back be became because been before began being below best better between beyond big both build building but by '
  + 'call came can change client clients come coming common companies company could create current customer customers data date day deal deals did different do does doing done down due during each early easy else end even ever every everyone everything '
  + 'experience far fast feel few find first five for four free from full fully future gave get getting give gives go goal goes going good got great group grow growing had half hard has have having he help helping helps her here high higher him his home hour how however '
  + 'idea if important improve in inside instead into is it its job just keep kind know known large last late later latest lead leader leading learn least leave less let level life light like line little live local long longer look looking lot low made main make makes making many market matter may me mean means might mind modern moment more most move much must my '
  + 'name near need needs never new news next nine no not now number of off offer often old on once one only open or order other others our out over own part past pay people place plan platform play point possible power process product products program project provide put quality quick question quite '
  + 'rather reach read ready real really reason result results right rise run same save say says second see seen service services set seven several she short should show side simple simply since six small so solution solutions some something soon special stand start state still stop story strong such support sure system '
  + 'take team teams tell ten than that the their them then there these they thing things think this those three through thus time to today together too tool tools top toward tried true try turn two type under until up upon us use used user users using value very view want was way we week well went were what when where whether which while who whole whose why wide will with within without wonder word work worker workers working works world would year years yes yet you young your'
).split(' '));
/** Short words that are real subjects. Anything else under four letters is too ambiguous. */
const SHORT = /^(ai|vc|ev|hr|iot|api|b2b|law|tax|art|gas|oil|pet|car|bus|rna|dna|esg|seo)$/;
/** Scripts written without spaces, where a word boundary means nothing. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();

/** Very light stemming, so "utilities" and "utility", "queues" and "queue", "taxes" and "tax" meet. */
function stem(w: string): string {
  if (w.length < 4) return w;
  return w.replace(/ies?$/, 'y').replace(/(ss|x|z|ch|sh)es$/, '$1').replace(/([^su])s$/, '$1');
}

const wordsOf = (s: string) => normalize(s).split(' ').filter(Boolean);
const significant = (s: string) => wordsOf(s)
  .filter(w => (w.length >= 4 || SHORT.test(w) || (UNSPACED.test(w) && w.length >= 2)) && !STOPWORDS.has(w)).map(stem);
const stemmed = (s: string) => ` ${wordsOf(s).map(stem).join(' ')} `;

export function topicsFrom(profile: CompanyProfile | null): Topics {
  if (!profile) return { phrases: [], words: new Set(), prose: new Set() };
  const subjects = [...profile.industry.split(/[,/|&;、，]|\band\b/), ...profile.spokespeople.flatMap(s => s.topics)];
  // A phrase needs at least one significant word, so an industry of "IT" or a rival called "On" can't match everything.
  const phrases = [...new Set([...subjects, ...profile.competitors].filter(p => significant(p).length > 0).map(p => stemmed(p).trim()))];
  const words = new Set(subjects.flatMap(significant));
  const prose = new Set([profile.one_liner, profile.products, profile.target_audience, ...profile.key_messages].flatMap(significant).filter(w => !words.has(w)));
  return { phrases, words, prose };
}

export interface Match { points: number; weak: number; matched: string[] }

/**
 * How closely a headline and its feed categories match. Categories are the publication's own labels,
 * so they count more. `weak` points come only from ordinary words in the profile's sentences.
 */
export function matchTopics(topics: Topics, title: string, categories: string[]): Match {
  const matched = new Set<string>();
  let points = 0;
  let weak = 0;
  const score = (raw: string, phrasePoints: number, wordPoints: number) => {
    const text = raw.slice(0, 500);
    const hay = stemmed(text);
    const phrase = topics.phrases.find(p => (UNSPACED.test(p) ? hay.includes(p) : hay.includes(` ${p} `)));
    if (phrase) { points += phrasePoints; matched.add(phrase); return; }
    const found = [...new Set(significant(text))];
    const word = found.find(w => topics.words.has(w));
    if (word) { points += wordPoints; matched.add(word); return; }
    const ordinary = found.filter(w => topics.prose.has(w));
    if (ordinary.length >= 2) { weak += 1; ordinary.slice(0, 2).forEach(w => matched.add(w)); }
  };
  for (const c of categories.slice(0, 20)) score(c, 3, 2);
  score(title, 2, 1);
  return { points, weak, matched: [...matched] };
}

/** 0–10 across a journalist's articles. Ordinary words alone can't get anyone past "low". */
export function relevance(matches: Match[]): number {
  const sum = (f: (m: Match) => number) => matches.reduce((n, m) => n + f(m), 0);
  return Math.min(10, sum(m => m.points) + Math.min(2, sum(m => m.weak)));
}

const NOT_A_BEAT = /^(uncategori[sz]ed|news|latest|latest news|top news|top stories|featured|feature|features|home|homepage|blog|article|articles|post|posts|general|other|all|misc|miscellaneous|editor'?s? picks?|trending|popular|breaking|breaking news|headlines|stories|story|main|default|archive|\d[\d\s/-]*)$/i;

/** A journalist's beat, as their publication labels it: the feed category they use most. */
export function commonCategory(categoryLists: string[][]): string {
  const counts = new Map<string, { label: string; n: number }>();
  for (const list of categoryLists) {
    const seen = new Set<string>();
    for (const raw of list) {
      const label = raw.trim();
      const key = normalize(label);
      if (label.length < 2 || !key || NOT_A_BEAT.test(label) || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { label, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
  }
  const [top] = [...counts.values()].sort((a, b) => b.n - a.n);
  return top?.label ?? '';
}

/** Search words from a person's query, for services organized by tag. */
export function searchTags(query: string): string[] {
  const words = [...new Set(wordsOf(query))].filter(w => !STOPWORDS.has(w) && (w.length >= 3 || SHORT.test(w) || UNSPACED.test(w)));
  const joined = words.length >= 2 && words.length <= 3 ? [words.join('-')] : [];
  return [...joined, ...words].slice(0, 5);
}
