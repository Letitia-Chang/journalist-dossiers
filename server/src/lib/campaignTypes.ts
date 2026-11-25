/** Plain names for the prompt. Mirrors client/src/lib/campaignTypes.ts; unknown keys are spelled out. */
const LABELS: Record<string, string> = {
  product_launch: 'Product launch', funding: 'Funding announcement', event: 'Event', founder_promo: 'Founder story',
  cold_intro: 'Introduction to the company', hackathon: 'Hackathon',
};

export const campaignTypeName = (key: string): string => LABELS[key] ?? (key.replace(/_/g, ' ').trim() || 'General pitch');
