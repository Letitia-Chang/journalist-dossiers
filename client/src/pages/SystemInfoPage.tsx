import { Clock, Zap, ShieldAlert, Bell, RefreshCw, Users, Star, BookOpen } from 'lucide-react';

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ icon: Icon, title, color, children }: {
  icon: React.ElementType; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="card p-6 mb-5">
      <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-base">
        <Icon className={`w-4 h-4 ${color}`} />
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <div className="w-52 shrink-0 text-sm font-medium text-slate-700">{label}</div>
      <div className="flex-1">
        <div className="text-sm text-slate-900">{value}</div>
        {note && <div className="text-xs text-slate-400 mt-0.5">{note}</div>}
      </div>
    </div>
  );
}

function Tag({ children, color = 'slate' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    red:    'bg-rose-50 text-rose-700 border-rose-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${colors[color]}`}>
      {children}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SystemInfoPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-northstar-600" /> System Rules & Behaviour
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          How the system works — automated jobs, triggers, restrictions, and maintenance reminders.
        </p>
      </div>

      {/* Cron jobs */}
      <Section icon={Clock} title="Automated Jobs (Cron)" color="text-northstar-500">
        <Row
          label="RSS article refresh"
          value="Fridays at 7am"
          note="Fetches new articles from all active publication feeds. Updates 'last published' dates and sets the stale flag on journalists with no articles in 30+ days."
        />
        <Row
          label="Publication health check"
          value="Weekly (Mondays)"
          note="Checks whether each publication's RSS feed URL is reachable. Marks feeds as active / failed / unreachable."
        />
        <Row
          label="AI publication suggestions"
          value="Weekly (Mondays)"
          note="Claude suggests new publications to track based on the current list. Suggestions appear in Publications admin for human review — nothing is added automatically."
        />
      </Section>

      {/* Auto-triggers */}
      <Section icon={Zap} title="Automatic Triggers" color="text-amber-500">
        <Row
          label="Journalist accepted from RSS"
          value="→ Claude scores immediately"
          note="When you accept a journalist suggestion, Claude Opus 4.8 runs in the background to assign scores across 6 dimensions, set the beat, and write the pitch angle and system notes."
        />
        <Row
          label="Journalist added manually"
          value="→ Claude scores automatically"
          note="Fires ~1 second after saving. Only runs if no manual scores were entered. Same scoring process as RSS-accepted journalists."
        />
        <Row
          label="'Find Profiles' detects follower count"
          value="→ Claude re-scores automatically"
          note="If a follower count is parsed from Google search snippets (e.g. '3K followers' in a LinkedIn result), the Audience Reach score is recalculated in the background. Fires 2 seconds after the profile search completes."
        />
        <Row
          label="Outreach logged"
          value="→ Outreach status auto-updates"
          note="Every time an outreach log entry is saved, the journalist's status is synced to reflect the latest activity (e.g. logging a pitch sets status to 'Pitched')."
        />
      </Section>

      {/* Outreach status flow */}
      <Section icon={RefreshCw} title="Outreach Status Flow" color="text-blue-500">
        <p className="text-xs text-slate-500 mb-3">Status changes are manual except where noted. The flow represents the intended progression.</p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {[
            ['Not Started', 'slate'],
            ['Researching', 'blue'],
            ['Ready to Pitch', 'violet'],
            ['Pitched', 'amber'],
            ['Responded', 'green'],
            ['No Response', 'red'],
            ['Covered', 'green'],
            ['Declined', 'red'],
          ].map(([label, color]) => (
            <Tag key={label} color={color as string}>{label}</Tag>
          ))}
        </div>
        <Row label="Not Started" value="Default status for all new journalists" />
        <Row
          label="Researching"
          value="Set manually when actively evaluating"
          note="SerpAPI searches do NOT automatically set this. It's a deliberate human signal."
        />
        <Row label="Ready to Pitch" value="Set manually when you've decided to pitch and the draft is ready" />
        <Row label="Pitched" value="Auto-set when an outreach log entry of type 'Pitch' is saved" />
        <Row label="Responded" value="Auto-set when a response is logged" />
        <Row label="No Response" value="Set manually after a reasonable waiting period" />
        <Row label="Covered / Declined" value="Set manually after outcome is confirmed" />
      </Section>

      {/* Scoring */}
      <Section icon={Star} title="Scoring System" color="text-yellow-500">
        <Row label="Total score" value="Out of 100 — sum of 6 dimensions" />
        <Row label="AI Relevance" value="0–25 pts · How closely their beat matches AI/ML/LLM topics" />
        <Row label="Startup Relevance" value="0–20 pts · Coverage of startups, funding rounds, founders" />
        <Row label="North Star Fit" value="0–20 pts · Likelihood they'd cover an AI enterprise startup like ours" />
        <Row label="Publication Authority" value="0–15 pts · Reach and prestige of their outlet" />
        <Row label="Audience Reach" value="0–10 pts · Estimated readership and social following" />
        <Row label="Contactability" value="0–10 pts · Whether verified contact info is available" />
        <Row
          label="When scores run"
          value="On accept, on manual add, and when follower count is detected"
          note="Scores don't update automatically when you edit a journalist's fields. Run 'Find Profiles' to trigger a re-score with fresh follower data."
        />
      </Section>

      {/* Dashboard alerts */}
      <Section icon={Bell} title="Dashboard Alert Conditions" color="text-rose-500">
        <Row
          label="Overdue follow-ups"
          value="Status is 'Pitched' or 'Responded' and next follow-up date has passed"
          note="Check the journalist's Outreach tab and log your next action."
        />
        <Row
          label="Stale journalists"
          value="No new articles in 30+ days (staleFlag = 1)"
          note="Set by the Friday RSS cron. Check if the journalist has changed beats, gone quiet, or left the publication."
        />
        <Row
          label="Needs re-search"
          value="'Find Profiles' hasn't been run in 90+ days"
          note="Social profiles and follower counts can change. Re-running refreshes the data freshness strip and may trigger a re-score."
        />
        <Row
          label="Unreachable publications"
          value="RSS feed returning 404, 403, or timeout"
          note="Click 'Sync Feeds' in Publications admin or fix the feed URL manually."
        />
      </Section>

      {/* API usage */}
      <Section icon={Users} title="API Usage & Limits" color="text-teal-500">
        <Row
          label="SerpAPI"
          value="Pay-per-search · current balance shown next to 'Find Profiles'"
          note="Used for: LinkedIn/MuckRack/Twitter URL discovery, follower count detection from snippets, profile photos. Free trial = 100 searches total (does not refill)."
        />
        <Row
          label="Apollo"
          value="Credit balance shown next to 'Find emails' button"
          note="Used for: email enrichment per journalist. Each lookup costs 1 export credit. Rate-limited to 1 request per 1.2 seconds in bulk mode."
        />
        <Row
          label="Anthropic Claude"
          value="Pay-per-token · no hard cap"
          note="Used for: journalist scoring, campaign draft generation, publication suggestions, press coverage text parsing. Model: Claude Opus 4.8."
        />
      </Section>

      {/* Restrictions */}
      <Section icon={ShieldAlert} title="Restrictions (Non-Negotiable)" color="text-red-500">
        <Row
          label="No automated outreach"
          value="All emails must be reviewed and sent manually"
          note="The system generates drafts and marks campaigns as sent, but never sends email autonomously."
        />
        <Row
          label="No web scraping"
          value="Only public professional contact info via Apollo API or manual entry"
          note="The email finder reads publication author pages via HTTP — this is standard page fetching, not scraping. Sites that block it (Cloudflare) are handled gracefully."
        />
        <Row
          label="No guessed emails"
          value="Never construct email addresses from name + domain patterns"
          note="All emails must come from Apollo enrichment, the publication's own contact page, or manual entry."
        />
        <Row
          label="Human approval required"
          value="All AI/RSS suggestions (journalists, publications) require explicit accept/reject"
          note="Nothing is added to the main database automatically from discovery jobs."
        />
      </Section>
    </div>
  );
}
