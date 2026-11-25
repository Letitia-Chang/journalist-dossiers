/** What a campaign announces. Stored keys never change, so saved campaigns keep working. */
interface CampaignTypeInfo { label: string; badge: string; border: string; brief: string; style: string }

export const CAMPAIGN_TYPES: Record<string, CampaignTypeInfo> = {
  product_launch: {
    label: 'Product Launch',
    badge: 'bg-emerald-50 text-emerald-700',
    border: 'border-emerald-200 focus:border-emerald-400',
    brief: "What's launching, when, who it's for, and what people can do now that they couldn't before. Include a number or a customer example if you have one.",
    style: `Examples:
- Lead with what changes for the user, not the feature name.
- Always include the launch date and a link to try it.
- Offer a demo or early access.`,
  },
  funding: {
    label: 'Funding',
    badge: 'bg-amber-50 text-amber-700',
    border: 'border-amber-200 focus:border-amber-400',
    brief: "Amount, round, who led it, and what it pays for. Say why now, and what the money makes possible.",
    style: `Examples:
- Say what the money is for in the first paragraph.
- Never mention valuation.
- Offer an interview with a named spokesperson.`,
  },
  event: {
    label: 'Event',
    badge: 'bg-blue-50 text-blue-700',
    border: 'border-blue-200 focus:border-blue-400',
    brief: "Event name, date, location, what's happening, why it's newsworthy, and who's attending.",
    style: `Examples:
- Always include the date and city in the first paragraph.
- Offer a press pass or reserved seat.
- Mention one speaker the journalist is likely to know.`,
  },
  founder_promo: {
    label: 'Founder Story',
    badge: 'bg-violet-50 text-violet-700',
    border: 'border-violet-200 focus:border-violet-400',
    brief: "Who the founder is, why they started, what they've built so far, and the angle that makes it a story.",
    style: `Examples:
- Lead with why they started before what the company does.
- Use concrete results if the founder has shared them.
- Avoid "disruptive". Say what they built.`,
  },
  cold_intro: {
    label: 'Introduction',
    badge: 'bg-slate-100 text-slate-700',
    border: 'border-slate-300 focus:border-slate-400',
    brief: "Who you are, what you do, and why you're worth covering. Add any stories or angles you want journalists to know about.",
    style: `Examples:
- End every email with: "Happy to send more details if useful."
- Keep the introduction to one sentence.
- Never mention funding.`,
  },
};

/** No longer offered, but campaigns saved with it still show a name. */
const RETIRED: Record<string, string> = { hackathon: 'Hackathon' };

export const campaignTypeLabel = (key: string): string => CAMPAIGN_TYPES[key]?.label ?? RETIRED[key] ?? (key ? key.replace(/_/g, ' ') : 'Campaign');
export const campaignTypeBadge = (key: string): string => CAMPAIGN_TYPES[key]?.badge ?? 'bg-slate-100 text-slate-600';
