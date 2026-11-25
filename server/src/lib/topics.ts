import type { CompanyProfile } from './companyProfile';

/**
 * What a company cares about, as search terms taken from its own profile. Discovery ranks by these,
 * so it favors whatever this company does rather than any fixed set of topics.
 *
 * Listed terms (industry, spokesperson topics, competitors) are deliberate, so a whole one counts
 * fully, even when its words are common ("future of work"). One word of a longer term, or ordinary
 * words from the profile's sentences, count a little and can't lift anyone past "low".
 */
export interface Topics { phrases: string[]; exact: RegExp[]; words: Set<string>; prose: Set<string> }

/** Words with no subject of their own: a term made only of these can't be searched for. */
const FUNCTION_WORDS = new Set(('a about after all also am an and any are as at be because before but by can did do for from had has have he her him his how if in into is it its just me more most my no not now of off on one only or other our out over own she so than that the their them then there these they this those to too up upon us was we were what when where which who why will with you your').split(' '));
/** Common words: fine inside a listed term, too vague on their own. */
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
/** What kind of thing a company makes says little; "HR software" is about HR. */
const GENERIC = /^(software|service|services|platform|solution|solutions|tool|tools|product|products|industry|technology|technologies|tech|company|companies|systems?|apps?)$/;
/** Scripts written without spaces, where a word boundary means nothing. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();

/** Very light stemming, so plural and singular meet: utilities/utility, EVs/EV, taxes/tax, buses/bus, caches/cache. */
function stem(w: string): string {
  if (w.length < 4) return w.endsWith('s') && SHORT.test(w.slice(0, -1)) ? w.slice(0, -1) : w;
  const singular = w.length > 4 && /ies?$/.test(w) ? w.replace(/ies?$/, 'y') : w.replace(/([^su])s$/, '$1');
  return singular.length > 3 ? singular.replace(/e$/, '') : singular;
}

const wordsOf = (s: string) => normalize(s).split(' ').filter(Boolean);
const significant = (s: string) => wordsOf(s)
  .filter(w => (w.length >= 4 || SHORT.test(w) || SHORT.test(stem(w)) || (UNSPACED.test(w) && w.length >= 2)) && !STOPWORDS.has(w)).map(stem);
const stemmed = (s: string) => ` ${wordsOf(s).map(stem).join(' ')} `;

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A short all-caps name ("IT", "5G", "SAP") only means itself when written that way, or plural. */
const isAcronym = (t: string) => /^[\p{Lu}\p{N}&]{2,5}$/u.test(t) && /\p{Lu}/u.test(t);
const exactly = (t: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?:[’']?s)?(?![\\p{L}\\p{N}])`, 'u');

export function topicsFrom(profile: CompanyProfile | null): Topics {
  if (!profile) return { phrases: [], exact: [], words: new Set(), prose: new Set() };
  const trim = (list: string[]) => list.map(t => t.trim()).filter(Boolean);
  const subjects = trim([...profile.industry.split(/[,/|&;、，]|\band\b/i), ...profile.spokespeople.flatMap(s => s.topics)]);
  const competitors = trim(profile.competitors);

  const phrases = new Set<string>();
  const exact = new Map<string, RegExp>();
  const add = (words: string[]) => { if (words.length) phrases.add(words.map(stem).join(' ')); };

  for (const subject of subjects) {
    if (isAcronym(subject)) { exact.set(subject, exactly(subject)); continue; }
    const words = wordsOf(subject);
    if (words.every(w => FUNCTION_WORDS.has(w)) || words.join('').length < 2) continue;
    add(words);
    const core = words.filter(w => !GENERIC.test(w));
    if (core.length === 1 && core.length < words.length && !STOPWORDS.has(core[0])) {
      const asWritten = subject.split(/\s+/).find(w => isAcronym(w));
      if (asWritten) exact.set(asWritten, exactly(asWritten)); else add(core);
    }
  }
  for (const rival of competitors) {
    const words = wordsOf(rival);
    if (words.length === 1 && rival.length < 4) {
      if (!FUNCTION_WORDS.has(words[0]) && !STOPWORDS.has(words[0])) exact.set(rival, exactly(rival));
    } else if (words.some(w => !STOPWORDS.has(w))) add(words); // "Next" alone would match everything
  }

  const words = new Set(subjects.filter(t => !isAcronym(t)).flatMap(significant));
  const prose = new Set([profile.one_liner, profile.products, profile.target_audience, ...profile.key_messages].flatMap(significant).filter(w => !words.has(w)));
  return { phrases: [...phrases], exact: [...exact.values()], words, prose };
}

/** `points`: whole listed terms. `partial`: one word of one. `weak`: ordinary words from sentences. */
export interface Match { points: number; partial: number; weak: number; matched: string[] }

/** How closely a headline and its feed categories (the publication's own labels, so worth more) match. */
export function matchTopics(topics: Topics, title: string, categories: string[]): Match {
  const matched = new Set<string>();
  const m = { points: 0, partial: 0, weak: 0 };
  const score = (raw: string, full: number) => {
    const text = raw.slice(0, 500);
    const hay = stemmed(text);
    const phrase = topics.phrases.find(p => (UNSPACED.test(p) ? hay.includes(p) : hay.includes(` ${p} `)));
    if (phrase) { m.points += full; matched.add(phrase); return; }
    // In an ALL-CAPS headline every word looks like an acronym.
    const hit = text !== text.toUpperCase() || wordsOf(text).length === 1 ? topics.exact.map(re => re.exec(text)?.[0]).find(Boolean) : undefined;
    if (hit) { m.points += full; matched.add(hit); return; }
    const found = [...new Set(significant(text))];
    const word = found.find(w => topics.words.has(w));
    if (word) { m.partial += 1; matched.add(word); return; }
    const ordinary = found.filter(w => topics.prose.has(w));
    if (ordinary.length >= 2) { m.weak += 1; ordinary.slice(0, 2).forEach(w => matched.add(w)); }
  };
  for (const c of categories.slice(0, 20)) score(c, 3);
  score(title, 2);
  return { ...m, matched: [...matched] };
}

/** 0–10 across a journalist's articles. Without a whole listed term, nobody gets past "low". */
export function relevance(matches: Match[]): number {
  const sum = (f: (m: Match) => number) => matches.reduce((n, m) => n + f(m), 0);
  return Math.min(10, sum(m => m.points) + Math.min(2, sum(m => m.partial + m.weak)));
}

/** One match's strength, for picking the article that best shows why someone was suggested. */
export const strength = (m: Match) => m.points * 10 + m.partial * 2 + m.weak;

const NOT_A_BEAT = /^(uncategori[sz]ed|news|latest|latest news|top news|top stories|featured|feature|features|home|homepage|blog|article|articles|post|posts|general|other|all|misc|miscellaneous|editor[’']?s[’']? picks?|editors choice|sponsored|sponsored content|advertisement|advertorial|promoted|partner content|press releases?|trending|popular|breaking|breaking news|headlines|stories|story|main|default|archive|\d[\d\s/-]*)$/i;

/** A journalist's beat, as their publication labels it: the feed category they use most. */
export function commonCategory(categoryLists: string[][]): string {
  const counts = new Map<string, { label: string; n: number }>();
  for (const list of categoryLists) {
    const seen = new Set<string>();
    for (const raw of list) {
      const label = raw.trim();
      const key = normalize(label);
      if (label.length < 2 || !key || NOT_A_BEAT.test(label) || /^(https?:|www\.)/i.test(label) || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { label, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
  }
  const [top] = [...counts.values()].sort((a, b) => b.n - a.n);
  return top?.label ?? '';
}

/** Tags from a person's search: each subject whole, plus its words when none of them is too vague alone. */
export function searchTags(query: string): string[] {
  const tags: string[] = [];
  for (const part of query.split(/[,;/]|\band\b|\bor\b/i)) {
    const words = wordsOf(part).filter(w => !FUNCTION_WORDS.has(w));
    if (words.length === 0 || words.length > 6) { if (words.length) tags.push(...words.filter(w => !STOPWORDS.has(w) && w.length >= 3)); continue; }
    if (words.length <= 3) tags.push(words.join('-'));
    if (words.length > 1 && (words.length > 3 || words.every(w => !STOPWORDS.has(w)))) tags.push(...words.filter(w => !STOPWORDS.has(w) && (w.length >= 3 || SHORT.test(w))));
  }
  return [...new Set(tags)].filter(t => t.length >= 2).slice(0, 5);
}
