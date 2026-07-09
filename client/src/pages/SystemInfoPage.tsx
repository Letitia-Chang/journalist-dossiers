import { Clock, Zap, ShieldAlert, Bell, RefreshCw, Users, Star, BookOpen, UserCog } from 'lucide-react';

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
          How the system works — discovery jobs, triggers, restrictions, and maintenance reminders.
        </p>
      </div>

      {/* Discovery & automation jobs */}
      <Section icon={Clock} title="Discovery & Automation Jobs" color="text-northstar-500">
        <p className="text-xs text-slate-500 mb-3">
          Nothing here runs on a schedule — there is no cron in this app. Every job below is kicked off by clicking a button, and each responds immediately with a status message while the work continues in the background.
        </p>
        <Row
          label="RSS scan — all publications"
          value="Manual · RSS Suggestions page"
          note="Scans every active feed for bylines, adds new candidates to journalist suggestions. POST /api/journalist-suggestions/scan-all."
        />
        <Row
          label="RSS scan / staff-page scan — one publication"
          value="Manual · Publication detail page"
          note="Scans a single publication's feeds or staff/about page for journalists. POST /api/journalist-suggestions/scan/:id or /staff-scan/:id."
        />
        <Row
          label="Sync Feeds"
          value="Manual · Publications admin"
          note="Discovers RSS feeds for all publications, then verifies every feed URL in one step. POST /api/publications/sync-feeds."
        />
        <Row
          label="Publication health check"
          value="Manual · Publications admin"
          note="Checks whether each publication's URL is reachable and updates its health status. POST /api/publications/check-feeds."
        />
        <Row
          label="AI publication suggestions"
          value="Manual · Publications admin"
          note="Claude suggests new publications based on the org's company description and target verticals. Pending review — nothing is added automatically. POST /api/suggestions/run-now."
        />
        <Row
          label="Blog/publication search & OPML import"
          value="Manual · Publications admin"
          note="Searches Feedly/Substack/Medium for new publications, or imports an OPML feed list. POST /api/publications/discover and /import-opml."
        />
      </Section>

      {/* Auto-triggers */}
      <Section icon={Zap} title="Automatic Triggers" color="text-amber-500">
        <p className="text-xs text-slate-500 mb-3">
          These aren't scheduled either — they fire in direct response to a specific action you take, not on a timer.
        </p>
        <Row
          label="Journalist suggestion accepted"
          value="→ AI scores in the background, if dimensions exist"
          note="If the org has defined at least one scoring dimension, Claude Opus 4.8 scores the new journalist against them using the org's company description and target verticals. If no dimensions are defined yet, scoring is silently skipped."
        />
        <Row
          label="Publication suggestion accepted"
          value="→ Feed discovery kicks off"
          note="Creates the publication, then automatically starts discovering its RSS feeds."
        />
        <Row
          label="Outreach logged"
          value="→ Journalist's status updates instantly"
          note="A journalist's outreach status is always just whatever 'Resulting status' was picked on their most recent outreach log entry — there's no separate sync step to reconcile."
        />
        <Row
          label="Invite accepted"
          value="→ User account created"
          note="Accepting an invite link creates the user under the inviting org with the role the owner assigned, and logs them in immediately."
        />
      </Section>

      {/* Outreach status flow */}
      <Section icon={RefreshCw} title="Outreach Status Flow" color="text-blue-500">
        <p className="text-xs text-slate-500 mb-3">
          Every status here is set manually by picking a "Resulting status" when logging any outreach entry (type: pitch, follow-up, response, or note). There's no automatic promotion between them.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {[
            ['Not Started', 'slate'],
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
        <Row label="Not Started" value="Default when a journalist has no outreach log entries yet" />
        <Row label="Ready to Pitch, Pitched, Responded, No Response, Covered, Declined" value="Chosen manually every time you log an outreach entry" note="Whatever you pick becomes the journalist's status immediately — it's read live from the most recent log row, not stored separately." />
      </Section>

      {/* Scoring */}
      <Section icon={Star} title="Scoring System" color="text-yellow-500">
        <p className="text-xs text-slate-500 mb-3">
          Scoring dimensions are fully configurable per organization — there is no fixed set of dimensions or point values. Manage them on the Scoring Dimensions admin page.
        </p>
        <Row label="Dimensions" value="Each org defines its own name, description, and point weight per dimension" note="The admin UI shows a running total and nudges you to make weights sum to 100 (so scores read as a percentage), but this isn't enforced — you can save any total." />
        <Row label="Total score" value="Sum of a journalist's saved score on each dimension" />
        <Row
          label="When AI scoring runs"
          value="On accepting a suggestion (if dimensions exist), or on demand via 'Score with AI'"
          note="Claude Opus 4.8 scores using the org's company description, target verticals, and the journalist's beats/bio. Scores don't change when you just edit a journalist's fields — re-run 'Score with AI' to refresh them."
        />
        <Row label="Manual entry" value="Scores can always be entered or overridden by hand per dimension" />
      </Section>

      {/* Team & roles */}
      <Section icon={UserCog} title="Team & Roles" color="text-indigo-500">
        <Row label="Owner" value="Full access, plus team management and Gmail connection" note="Only the owner can invite/remove teammates, change roles, and connect or disconnect the org's Gmail integration." />
        <Row label="Admin" value="Can manage publications, scoring dimensions, and discovery jobs" note="Same edit access as owner everywhere except team management and Gmail." />
        <Row label="Member" value="Read access; cannot edit publications, scoring dimensions, or run discovery jobs" />
        <Row label="Invites" value="Owner generates a shareable link, valid 7 days" note="No email is sent automatically — the owner shares the invite link themselves. Accepting it creates the account." />
      </Section>

      {/* Dashboard alerts */}
      <Section icon={Bell} title="Dashboard Alert Conditions" color="text-rose-500">
        <Row
          label="Overdue follow-ups"
          value="Status is 'Pitched' and no newer log entry has been made in a while"
          note="Check the journalist's Outreach History and log your next action."
        />
        <Row
          label="Unreachable publications"
          value="Health check marked the publication's URL as unreachable"
          note="Run 'Sync Feeds' or the health check in Publications admin, or fix the URL manually."
        />
        <Row
          label="Pending suggestions"
          value="Unreviewed journalist or publication suggestions"
          note="Shown as badge counts next to Publications and RSS Suggestions in the sidebar — nothing is added to the database until you accept or reject each one."
        />
      </Section>

      {/* API usage */}
      <Section icon={Users} title="API Usage & Limits" color="text-teal-500">
        <Row
          label="Anthropic Claude"
          value="Pay-per-token · no hard cap"
          note="Used for: journalist scoring (per-org dimensions), campaign draft generation, publication suggestions. Model: Claude Opus 4.8."
        />
        <Row
          label="Google (Gmail API)"
          value="Free within normal usage quotas"
          note="Used for: per-org OAuth connection to create Gmail drafts from campaign copy. Scope is gmail.compose only — this app cannot send mail through it."
        />
      </Section>

      {/* Restrictions */}
      <Section icon={ShieldAlert} title="Restrictions (Non-Negotiable)" color="text-red-500">
        <Row
          label="No automated outreach"
          value="Emails are never sent by the system"
          note="Campaign drafts can be pushed into Gmail as drafts (gmail.compose scope), but every send is a manual action taken by a human in their own inbox."
        />
        <Row
          label="No web scraping, no third-party enrichment"
          value="Contact info is entered manually or discovered via RSS/staff-page scans"
          note="There is no Apollo, SerpAPI, or other contact-enrichment integration in this app — that was explicitly ruled out and isn't planned."
        />
        <Row
          label="No guessed emails"
          value="Never construct email addresses from name + domain patterns"
          note="Emails must come from a publication's own public pages or manual entry."
        />
        <Row
          label="Human approval required"
          value="All AI/RSS suggestions (journalists, publications) require explicit accept/reject"
          note="Nothing is added to the database automatically from a discovery job — a human reviews every candidate first."
        />
      </Section>
    </div>
  );
}
