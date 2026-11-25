import { Clock, Zap, ShieldCheck, RefreshCw, Star, BookOpen, UserCog, Cpu } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';

function Section({ icon: Icon, title, color, children }: { icon: ElementType; title: string; color: string; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6 mb-5">
      <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2 text-base">
        <Icon className={`w-4 h-4 ${color}`} /> {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sm:flex gap-4 py-2.5 border-b border-slate-100 last:border-0 text-sm">
      <div className="sm:w-52 shrink-0 font-medium text-slate-700">{label}</div>
      <div className="flex-1 text-slate-600">{children}</div>
    </div>
  );
}

export default function SystemInfoPage() {
  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-brand-600" /> How it works
        </h1>
        <p className="text-slate-500 mt-1 text-sm">What the app does on its own, what it never does, and who can do what.</p>
      </div>

      <Section icon={ShieldCheck} title="What it never does" color="text-emerald-600">
        <Row label="Send email">It only creates drafts in Gmail (the gmail.compose permission). A person reviews and sends each one.</Row>
        <Row label="Add people by itself">Every discovered journalist or publication waits for someone to accept or reject it.</Row>
        <Row label="Guess addresses">Emails are typed in or copied from a publication's own page. No enrichment service is used.</Row>
        <Row label="Hide who is crawling">Every request to a publisher says who is asking. Pages are only read when robots.txt allows it; RSS feeds and "is the site up" checks don't consult it.</Row>
      </Section>

      <Section icon={Star} title="Fit scores" color="text-yellow-500">
        <Row label="What they are">AI estimates to help you prioritize, not facts. A total is the sum of the scores on your own dimensions.</Row>
        <Row label="What the model sees">Your company profile, and the journalist's beat, bio and the titles of their recorded articles. It does not read the articles themselves.</Row>
        <Row label="Sources">A score can cite recorded articles. Any cited link that isn't in that journalist's list is removed. Check that a source supports the point: the explanation itself is the model's own words.</Row>
        <Row label="When they run">When you click "Score with AI", and once when you accept a discovered journalist. Editing a journalist doesn't rescore them.</Row>
        <Row label="By hand">You can set any score up to its maximum. Changing one removes the AI's explanation for it.</Row>
      </Section>

      <Section icon={RefreshCw} title="Outreach" color="text-blue-500">
        <Row label="Status">A journalist's status is whatever the latest outreach entry says. With no entries it is "Not Started".</Row>
        <Row label="Sent pitches">Marking a pitch sent logs it once and locks its text. It goes if you delete the campaign or the journalist; the outreach log stays with the journalist.</Row>
      </Section>

      <Section icon={Clock} title="Started by a person" color="text-brand-500">
        <p className="text-sm text-slate-500 mb-2">There is no scheduler. These run when an owner or admin clicks the button.</p>
        <Row label="Find journalists">Scan RSS feeds for bylines, or a publication's staff page for names.</Row>
        <Row label="Find publications">Search blogs and newsletters, import an OPML list, or ask Claude for suggestions.</Row>
        <Row label="Feeds and health">Find and check RSS feeds, and check that publication sites respond.</Row>
      </Section>

      <Section icon={Zap} title="Follows from something you did" color="text-amber-500">
        <Row label="Accept a journalist">They are scored in the background.</Row>
        <Row label="Accept a publication">Its RSS feeds are looked up in the background.</Row>
      </Section>

      <Section icon={UserCog} title="Roles" color="text-indigo-500">
        <Row label="Member">Works with journalists, campaigns, outreach and coverage, including editing and deleting them.</Row>
        <Row label="Admin">Also manages publications, discovery, scoring dimensions, house style and the company profile.</Row>
        <Row label="Owner">Also manages the team and the Gmail connection. Changes to roles take effect at once.</Row>
        <Row label="Invites">The owner shares a link that works once and expires after 7 days.</Row>
      </Section>

      <Section icon={Cpu} title="Outside services" color="text-teal-500">
        <Row label="Claude (Anthropic)">Scoring, pitch drafts and suggestions. Billed per use to the account that runs this app.</Row>
        <Row label="Gmail (Google)">Optional, for creating drafts.</Row>
      </Section>
    </div>
  );
}
