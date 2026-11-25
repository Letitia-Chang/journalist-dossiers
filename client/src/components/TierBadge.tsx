const STYLES: Record<string, string> = {
  A: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
};

export default function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STYLES[tier] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>
      Tier {tier}
    </span>
  );
}
