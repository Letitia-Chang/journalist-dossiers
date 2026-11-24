/**
 * Everything in this file is fictional: the company, the journalists, the outlets and
 * every URL (all on example.com). Any resemblance to real people or publications is
 * coincidental.
 */
import type { CompanyProfile } from '../lib/companyProfile';

export const DEMO_ORG_ID = '00000000-0000-4000-8000-0000000000d1';
export const DEMO_USER_ID = '00000000-0000-4000-8000-0000000000d2';
export const DEMO_USER_EMAIL = 'demo@example.com';

export const DEMO_PROFILE: CompanyProfile = {
  name: 'Lumen Grid',
  website: 'https://lumengrid.example.com',
  one_liner: 'Software that gets clean-energy projects connected to the grid years sooner.',
  industry: 'Climate tech / grid software',
  products:
    'QueueScope, an interconnection-queue analytics platform that forecasts study timelines and flags the upgrades holding up each project. Utility Console, a workflow tool that helps utilities clear study backlogs.',
  target_audience: 'Utility interconnection teams, renewable-energy developers, and the investors who fund them.',
  regions: ['United States', 'Texas', 'Midwest'],
  key_messages: [
    'Interconnection queues, not generation costs, are now the bottleneck for clean energy',
    'Utilities can clear study backlogs about 3x faster with better data, not more staff',
    'Transparent queue data lowers financing risk for developers',
  ],
  newsworthy_items: [
    { type: 'funding', title: 'Series A: $12M led by Fictional Ventures', date: '2026-10', description: 'Funds expansion of QueueScope to five more grid regions.', url: 'https://lumengrid.example.com/news/series-a' },
    { type: 'launch', title: 'QueueScope 2.0 adds upgrade-cost forecasting', date: '2026-09', description: 'Developers see likely network-upgrade costs before they file.', url: 'https://lumengrid.example.com/news/queuescope-2' },
    { type: 'research', title: 'State of the Queue: an analysis of 2,100 projects', date: '2026-08', description: 'Median wait times rose from 2.1 to 4.8 years in a decade.', url: 'https://lumengrid.example.com/research/state-of-the-queue' },
  ],
  competitors: ['Gridwell', 'Kilovolt Foundry', 'Queuely'],
  press_coverage: [
    { title: 'Why the interconnection queue keeps growing', url: 'https://gridlineweekly.example.com/2026/08/why-the-queue-keeps-growing' },
    { title: 'Seven grid-software startups to watch', url: 'https://climateledger.example.com/2026/07/grid-software-startups' },
  ],
  spokespeople: [
    { name: 'Rin Okada', title: 'CEO', topics: ['interconnection', 'clean energy', 'funding', 'grid'] },
    { name: 'Tomas Brightwater', title: 'CTO', topics: ['forecasting', 'machine learning', 'data', 'software'] },
    { name: 'Ines Calloway', title: 'Head of Policy', topics: ['regulation', 'state policy', 'utilities', 'co-ops'] },
  ],
  pitch_tone: 'Direct and specific. Lead with a number or a concrete example. No buzzwords.',
  email_signature: 'Rin Okada\nCEO, Lumen Grid\nrin@lumengrid.example.com',
  app_name: 'Press Dossier',
  logo_url: '',
  brand_color: '#0f766e',
};

export const DEMO_OUTLETS = [
  { key: 'kw', name: 'The Daily Kilowatt', url: 'https://dailykilowatt.example.com', tier: 'A', focus: 'National energy and utilities news' },
  { key: 'gw', name: 'Gridline Weekly', url: 'https://gridlineweekly.example.com', tier: 'B', focus: 'Trade publication on transmission and interconnection' },
  { key: 'mb', name: 'Meridian Business Journal', url: 'https://meridianbj.example.com', tier: 'A', focus: 'Business and venture coverage' },
  { key: 'cl', name: 'Climate Ledger', url: 'https://climateledger.example.com', tier: 'B', focus: 'Climate markets and policy' },
  { key: 'nt', name: 'Northfield Tribune', url: 'https://northfieldtribune.example.com', tier: 'C', focus: 'Regional daily newspaper' },
  { key: 'tt', name: 'The Transmission', url: 'https://thetransmission.example.com', tier: 'C', focus: 'Newsletter on power-sector software' },
  { key: 'os', name: 'Open Source Energy Report', url: 'https://opensourceenergy.example.com', tier: 'C', focus: 'Open data and energy software' },
  { key: 'pe', name: 'Plains Energy Review', url: 'https://plainsenergy.example.com', tier: 'C', focus: 'Rural electric cooperatives' },
] as const;

export type AngleKey = 'queue' | 'utility' | 'finance' | 'research' | 'data' | 'rural' | 'consumer';

export interface DemoJournalist {
  name: string;
  outlet: (typeof DEMO_OUTLETS)[number]['key'];
  email: string;
  beats: string[];
  beatPhrase: string;
  region: string;
  bio: string;
  /** Scores for the six default dimensions, in order. */
  scores: [number, number, number, number, number, number];
  articles: { title: string; slug: string; date: string }[];
  angle: AngleKey;
  hook: string;
  /** 'sent' journalists already have an outreach log. */
  outreach?: 'Pitched' | 'Responded' | 'Covered';
}

export const DEMO_JOURNALISTS: DemoJournalist[] = [
  {
    name: 'Maren Alderwood', outlet: 'kw', email: 'maren.alderwood@dailykilowatt.example.com',
    beats: ['Grid policy', 'Utilities'], beatPhrase: 'grid policy and utilities', region: 'US national',
    bio: 'National correspondent covering utility regulation and the politics of the power grid. Previously a state-house reporter.',
    scores: [24, 18, 19, 9, 13, 8], angle: 'queue', outreach: 'Responded',
    articles: [
      { title: 'Inside the 2,000-project backlog stalling clean power', slug: 'backlog-stalling-clean-power', date: '2026-10-14' },
      { title: 'Regulators weigh a faster study process', slug: 'regulators-faster-study-process', date: '2026-09-22' },
      { title: 'What utilities say about interconnection delays', slug: 'utilities-interconnection-delays', date: '2026-08-30' },
    ],
    hook: 'Your piece on the 2,000-project backlog stalling clean power is the clearest explanation of the problem I have read this year.',
  },
  {
    name: 'Tobias Quillfeather', outlet: 'gw', email: 'tobias.quillfeather@gridlineweekly.example.com',
    beats: ['Interconnection', 'Transmission'], beatPhrase: 'interconnection and transmission', region: 'US national',
    bio: 'Senior editor at a trade weekly read by transmission planners and developers. Writes the long-running "Queue Watch" column.',
    scores: [23, 19, 18, 8, 12, 9], angle: 'research', outreach: 'Covered',
    articles: [
      { title: 'Queue Watch: study timelines hit a new high', slug: 'queue-watch-study-timelines', date: '2026-10-09' },
      { title: 'Why network-upgrade costs surprise developers', slug: 'network-upgrade-costs-surprise', date: '2026-09-18' },
      { title: 'Why the queue keeps growing', slug: 'why-the-queue-keeps-growing', date: '2026-08-12' },
    ],
    hook: 'Your latest Queue Watch on study timelines hitting a new high lines up with data we have just finished analysing.',
  },
  {
    name: 'Sunita Marchetti-Lowe', outlet: 'mb', email: 'sunita.marchetti-lowe@meridianbj.example.com',
    beats: ['Climate-tech funding', 'Venture'], beatPhrase: 'climate-tech funding', region: 'US national',
    bio: 'Business reporter tracking where venture money goes in energy and climate. Writes a weekly deals roundup.',
    scores: [18, 16, 17, 7, 14, 7], angle: 'finance',
    articles: [
      { title: 'Climate-tech deals: the week in funding', slug: 'climate-tech-deals-week', date: '2026-10-20' },
      { title: 'Investors bet on grid software', slug: 'investors-bet-grid-software', date: '2026-09-30' },
      { title: 'The new math of clean-energy financing', slug: 'new-math-clean-energy-financing', date: '2026-09-03' },
    ],
    hook: 'Your piece on investors betting on grid software caught my eye, since we have just closed a round in exactly that space.',
  },
  {
    name: 'Dev Okafor-Brandt', outlet: 'cl', email: 'dev.okafor-brandt@climateledger.example.com',
    beats: ['Clean-energy markets'], beatPhrase: 'clean-energy markets', region: 'US and Europe',
    bio: 'Markets reporter who follows power prices, project finance and the economics of renewables.',
    scores: [19, 15, 14, 8, 13, 6], angle: 'finance',
    articles: [
      { title: 'Renewables developers face a financing squeeze', slug: 'developers-financing-squeeze', date: '2026-10-02' },
      { title: 'Seven grid-software startups to watch', slug: 'grid-software-startups', date: '2026-07-15' },
      { title: 'How interconnection risk is priced', slug: 'interconnection-risk-priced', date: '2026-06-24' },
    ],
    hook: 'Your reporting on how interconnection risk is priced raises the question we are working on: what if developers could see the delay coming?',
  },
  {
    name: 'Linnea Faircloth', outlet: 'nt', email: 'linnea.faircloth@northfieldtribune.example.com',
    beats: ['Regional energy', 'Local utilities'], beatPhrase: 'regional energy and local utilities', region: 'Midwest',
    bio: 'Regional reporter covering the local utility, rate cases and new wind and solar projects around Northfield.',
    scores: [12, 13, 6, 10, 6, 8], angle: 'utility',
    articles: [
      { title: 'Rate case: what the proposed increase means for Northfield', slug: 'rate-case-northfield', date: '2026-10-11' },
      { title: 'A wind farm waits on the grid', slug: 'wind-farm-waits-on-grid', date: '2026-09-08' },
    ],
    hook: 'Your story about the Northfield wind farm waiting on the grid describes a problem we help utilities solve.',
  },
  {
    name: 'Caspian Mbeki-Doyle', outlet: 'tt', email: 'caspian.mbeki-doyle@thetransmission.example.com',
    beats: ['Power-sector software', 'Data'], beatPhrase: 'power-sector software', region: 'US national',
    bio: 'Independent writer behind a well-read newsletter on software and data in the power sector.',
    scores: [21, 17, 16, 6, 8, 10], angle: 'data',
    articles: [
      { title: 'The data problem inside every utility', slug: 'data-problem-inside-utility', date: '2026-10-17' },
      { title: 'Forecasting the queue: a technical look', slug: 'forecasting-the-queue', date: '2026-09-26' },
      { title: 'Five tools utilities actually use', slug: 'five-tools-utilities-use', date: '2026-08-19' },
    ],
    hook: 'Your technical look at forecasting the queue is the best treatment of the modelling problem we have seen.',
  },
  {
    name: 'Odalys Thornbury', outlet: 'os', email: 'odalys.thornbury@opensourceenergy.example.com',
    beats: ['Open data', 'Energy software'], beatPhrase: 'open data and energy software', region: 'Global',
    bio: 'Covers open datasets and open-source tools for the energy transition. Maintains a public directory of grid data sources.',
    scores: [14, 12, 9, 5, 7, 9], angle: 'data',
    articles: [
      { title: 'A guide to public interconnection datasets', slug: 'guide-public-interconnection-datasets', date: '2026-10-05' },
      { title: 'Open-source tools for grid planners', slug: 'open-source-grid-planners', date: '2026-08-27' },
    ],
    hook: 'Your guide to public interconnection datasets is the reason I am writing: we are publishing the data behind a new study.',
  },
  {
    name: 'Wilhelmina Strand', outlet: 'pe', email: 'wilhelmina.strand@plainsenergy.example.com',
    beats: ['Rural electric co-ops'], beatPhrase: 'rural electric cooperatives', region: 'Great Plains',
    bio: 'Covers rural electric cooperatives, their member-owners and the cost of keeping the lights on.',
    scores: [11, 10, 5, 9, 5, 6], angle: 'rural',
    articles: [
      { title: 'How a co-op keeps rates steady', slug: 'co-op-keeps-rates-steady', date: '2026-09-29' },
      { title: 'Co-ops and the push for new transmission', slug: 'coops-new-transmission', date: '2026-08-16' },
    ],
    hook: 'Your piece on co-ops and the push for new transmission touches the same study backlogs that slow small utilities.',
  },
  {
    name: 'Rafferty Nakamura-Hale', outlet: 'mb', email: 'rafferty.nakamura-hale@meridianbj.example.com',
    beats: ['Startups', 'Venture capital'], beatPhrase: 'startups and venture capital', region: 'US national',
    bio: 'Generalist startup reporter covering funding rounds across sectors, from fintech to health to hardware.',
    scores: [9, 11, 8, 6, 14, 5], angle: 'finance',
    articles: [
      { title: 'Ten Series A rounds worth knowing about', slug: 'ten-series-a-rounds', date: '2026-10-21' },
      { title: 'How founders pitch investors in a slow market', slug: 'founders-pitch-slow-market', date: '2026-09-14' },
    ],
    hook: 'Your roundup of Series A rounds worth knowing about is the kind of list we hope to be on.',
  },
  {
    name: 'Zephyrine Calloway', outlet: 'kw', email: 'zephyrine.calloway@dailykilowatt.example.com',
    beats: ['Home solar', 'Consumer energy'], beatPhrase: 'home solar and consumer energy', region: 'US national',
    bio: 'Consumer-energy reporter writing about rooftop solar, batteries and household energy bills.',
    scores: [4, 6, 2, 4, 12, 3], angle: 'consumer',
    articles: [
      { title: 'Is a home battery worth it in 2026?', slug: 'home-battery-worth-it', date: '2026-10-18' },
      { title: 'Rooftop solar installers brace for a slowdown', slug: 'rooftop-solar-slowdown', date: '2026-09-11' },
    ],
    hook: 'Your coverage of home batteries and rooftop solar made me think about what delays them upstream.',
  },
];

export const DEMO_CAMPAIGN = {
  name: 'Series A announcement',
  type: 'cold_intro',
  brief: 'Announce the $12M Series A and the QueueScope 2.0 launch. Lead with the queue-delay data from State of the Queue.',
  styleInstructions: 'Keep it under 150 words. Name one spokesperson. Never use the words "revolutionary" or "game-changing".',
};

export const DEMO_COVERAGE = {
  title: 'Lumen Grid raises $12M to speed up interconnection',
  url: 'https://gridlineweekly.example.com/2026/10/lumen-grid-raises-12m',
  notes: 'Gridline Weekly, a trade-press write-up after the Series A pitch.',
};
