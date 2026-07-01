import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { journalists as api, publications as pubApi } from '../api';
import type { Publication } from '../types';

const STATUSES = ['Not Started', 'Researching', 'Ready to Pitch', 'Pitched', 'Responded', 'In Conversation', 'Covered', 'Not a Fit', 'On Hold'];

const STATUS_DESCRIPTIONS: Record<string, string> = {
  'Not Started':     'Added to the list — no outreach decision made yet.',
  'Researching':     'Actively reading their work to decide if they\'re worth pitching.',
  'Ready to Pitch':  'Research done, decided to reach out — draft ready to send.',
  'Pitched':         'First outreach email sent, awaiting reply.',
  'Responded':       'They replied — positive, neutral, or asking for more info.',
  'In Conversation': 'Ongoing back-and-forth; relationship actively developing.',
  'Covered':         'They published an article about North Star AI Labs.',
  'Not a Fit':       'Decided not to pitch, or they declined.',
  'On Hold':         'Paused — waiting on timing, news cycle, or internal decision.',
};
const PUB_TYPES = ['National', 'Regional', 'Trade', 'Blog', 'Newsletter', 'Podcast', 'Wire', 'Other'];

const CONTACT_METHODS = [
  { value: 'email',        label: 'Email' },
  { value: 'twitter_dm',  label: 'Twitter/X DM' },
  { value: 'linkedin_dm', label: 'LinkedIn DM' },
  { value: 'contact_form',label: 'Contact Form' },
  { value: 'newsletter',  label: 'Newsletter Reply' },
  { value: 'other',       label: 'Other' },
];

const empty = {
  name: '', publication: '', roleTitle: '', beat: '', location: '', publicationType: '',
  aiRelevanceScore: 0, startupRelevanceScore: 0, northStarFitScore: 0,
  publicationAuthorityScore: 0, audienceReachScore: 0, contactabilityScore: 0,
  email: '', contactUrl: '', linkedinUrl: '', twitterUrl: '', personalWebsite: '', muckRackUrl: '',
  bestPitchAngle: '', notes: '', adminNotes: '', outreachStatus: 'Not Started',
  lastContactedDate: '', nextFollowUpDate: '',
  socialFollowing: '', preferredContact: '[]', topicsToAvoid: '', bestTimeToReach: '',
  coveredCompetitor: 0,
};

function calcTotal(form: typeof empty) {
  return Math.min(form.aiRelevanceScore, 25) +
    Math.min(form.startupRelevanceScore, 20) +
    Math.min(form.northStarFitScore, 20) +
    Math.min(form.publicationAuthorityScore, 15) +
    Math.min(form.audienceReachScore, 10) +
    Math.min(form.contactabilityScore, 10);
}

function calcTier(total: number) {
  return total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;
}

export default function JournalistForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [form, setForm] = useState<any>({ ...empty });
  const [saving, setSaving] = useState(false);
  const [loadedSocialFollowing, setLoadedSocialFollowing] = useState('');
  const [pubList, setPubList] = useState<Publication[]>([]);
  const [pubSearch, setPubSearch] = useState('');
  const [showPubDropdown, setShowPubDropdown] = useState(false);

  useEffect(() => {
    pubApi.list().then(r => setPubList(r.data.filter((p: Publication) => p.active)));
  }, []);

  useEffect(() => {
    if (isEdit && id) {
      api.get(Number(id)).then(r => {
        setForm(r.data);
        setLoadedSocialFollowing(r.data.socialFollowing || '');
        setPubSearch(r.data.publication || '');
      });
    }
  }, [id, isEdit]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const isAutoDetectedFollowing = loadedSocialFollowing.includes('(from search snippets)');

  const total = calcTotal(form);
  const tier = calcTier(total);

  const handleSubmit = async () => {
    if (!form.name) return alert('Name is required');
    setSaving(true);
    try {
      if (isEdit) {
        await api.update(Number(id), form);
        navigate(`/journalists/${id}`);
      } else {
        const res = await api.create(form);
        navigate(`/journalists/${res.data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to={isEdit ? `/journalists/${id}` : '/journalists'} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> {isEdit ? 'Back to journalist' : 'Back to list'}
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{isEdit ? 'Edit Journalist' : 'Add Journalist'}</h1>
        <div className="flex items-center gap-2">
          <div className="text-sm text-slate-500">Score:</div>
          <div className="text-2xl font-bold text-northstar-600">{total}</div>
          <div className="text-sm text-slate-400">/ 100</div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <Section title="Basic Information">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="relative">
              <label className="form-label">Publication</label>
              <input
                className="form-input"
                value={pubSearch}
                onChange={e => {
                  setPubSearch(e.target.value);
                  set('publication', e.target.value);
                  setShowPubDropdown(true);
                }}
                onFocus={() => setShowPubDropdown(true)}
                onBlur={() => setTimeout(() => setShowPubDropdown(false), 150)}
                placeholder="Search or type a publication..."
              />
              {showPubDropdown && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {pubList
                    .filter(p => p.name.toLowerCase().includes(pubSearch.toLowerCase()) || pubSearch === '')
                    .map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-northstar-50 flex items-center justify-between group"
                        onMouseDown={() => {
                          set('publication', p.name);
                          setPubSearch(p.name);
                          setShowPubDropdown(false);
                        }}
                      >
                        <span className="text-sm text-slate-900">{p.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          p.tier === 'A' ? 'bg-northstar-100 text-northstar-700' :
                          p.tier === 'B' ? 'bg-blue-50 text-blue-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>Tier {p.tier}</span>
                      </button>
                    ))}
                  {pubList.filter(p => p.name.toLowerCase().includes(pubSearch.toLowerCase()) || pubSearch === '').length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-400">No match — value will be saved as typed</div>
                  )}
                </div>
              )}
              {form.publication && pubList.find(p => p.name === form.publication)?.url && (
                <a
                  href={pubList.find(p => p.name === form.publication)!.url}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-northstar-500 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" /> Visit site
                </a>
              )}
            </div>
            <div>
              <label className="form-label">Role / Title</label>
              <input className="form-input" value={form.roleTitle} onChange={e => set('roleTitle', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Beat</label>
              <input className="form-input" value={form.beat} onChange={e => set('beat', e.target.value)} placeholder="AI, Startups, Tech, Education..." />
            </div>
            <div>
              <label className="form-label">Location</label>
              <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Publication Type</label>
              <select className="form-select" value={form.publicationType} onChange={e => set('publicationType', e.target.value)}>
                <option value="">Select...</option>
                {PUB_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </Section>

        {/* Contact */}
        <Section title="Contact Information">
          <p className="text-xs text-slate-500 mb-3">Only add publicly available professional contact info.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Contact Page URL</label>
              <input className="form-input" value={form.contactUrl} onChange={e => set('contactUrl', e.target.value)} placeholder="https://" />
            </div>
            <div>
              <label className="form-label">LinkedIn URL</label>
              <input className="form-input" value={form.linkedinUrl} onChange={e => set('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div>
              <label className="form-label">Twitter/X URL</label>
              <input className="form-input" value={form.twitterUrl} onChange={e => set('twitterUrl', e.target.value)} placeholder="https://x.com/..." />
            </div>
            <div>
              <label className="form-label">Personal Website</label>
              <input className="form-input" value={form.personalWebsite} onChange={e => set('personalWebsite', e.target.value)} placeholder="https://" />
            </div>
            <div>
              <label className="form-label">MuckRack URL</label>
              <input className="form-input" value={form.muckRackUrl} onChange={e => set('muckRackUrl', e.target.value)} placeholder="https://muckrack.com/..." />
            </div>
          </div>
        </Section>

        {/* Outreach Context — moved above Outreach & Notes */}
        <Section title="Outreach Context">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Social Following</label>
                {isAutoDetectedFollowing && (
                  <span className="text-xs text-teal-600 font-medium">auto-detected via SerpAPI</span>
                )}
              </div>
              <input
                className="form-input"
                value={form.socialFollowing}
                onChange={e => set('socialFollowing', e.target.value)}
                placeholder="e.g. ~25K Twitter, 3K LinkedIn, 50K newsletter"
              />
              <p className="text-xs text-slate-400 mt-1">Used to calibrate the Audience Reach score when re-scoring with Claude.</p>
            </div>

            <div>
              <label className="form-label mb-2 block">Preferred Contact Method</label>
              <div className="flex flex-wrap gap-2">
                {CONTACT_METHODS.map(m => {
                  const selected: string[] = (() => { try { return JSON.parse(form.preferredContact); } catch { return []; } })();
                  const isOn = selected.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => {
                        const next = isOn ? selected.filter(v => v !== m.value) : [...selected, m.value];
                        set('preferredContact', JSON.stringify(next));
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        isOn
                          ? 'bg-northstar-600 text-white border-northstar-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-northstar-400'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="form-label">Topics to Avoid</label>
              <input
                className="form-input"
                value={form.topicsToAvoid}
                onChange={e => set('topicsToAvoid', e.target.value)}
                placeholder="e.g. doesn't cover enterprise B2B, avoids funding announcements"
              />
            </div>

            <div>
              <label className="form-label">Best Time to Reach</label>
              <input
                className="form-input"
                value={form.bestTimeToReach}
                onChange={e => set('bestTimeToReach', e.target.value)}
                placeholder="e.g. Tuesday mornings, avoids Fridays"
              />
            </div>

          </div>
        </Section>

        {/* Outreach */}
        <Section title="Outreach & Notes">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Outreach Status</label>
              <select className="form-select" value={form.outreachStatus} onChange={e => set('outreachStatus', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {STATUS_DESCRIPTIONS[form.outreachStatus] && (
                <p className="text-xs text-slate-400 mt-1">{STATUS_DESCRIPTIONS[form.outreachStatus]}</p>
              )}
            </div>
            <div>
              <label className="form-label">Last Contacted Date</label>
              <input className="form-input" type="date" value={form.lastContactedDate} onChange={e => set('lastContactedDate', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Next Follow-up Date</label>
              <input className="form-input" type="date" value={form.nextFollowUpDate} onChange={e => set('nextFollowUpDate', e.target.value)} />
            </div>
          </div>
          <div className="mt-4">
            <label className="form-label">Best Pitch Angle</label>
            <textarea className="form-textarea" rows={3} value={form.bestPitchAngle} onChange={e => set('bestPitchAngle', e.target.value)}
              placeholder="What story would resonate with this journalist? Why does North Star AI Labs fit their beat?" />
          </div>
          {form.notes && (
            <div className="mt-3">
              <label className="form-label flex items-center gap-2">
                System Notes
                <span className="text-xs font-normal text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">auto-generated · read only</span>
              </label>
              <div className="form-input bg-slate-50 text-slate-500 text-sm whitespace-pre-wrap cursor-default select-text min-h-[60px]">
                {form.notes}
              </div>
            </div>
          )}
          <div className="mt-3">
            <label className="form-label">Admin Notes</label>
            <textarea className="form-textarea" rows={3} value={form.adminNotes} onChange={e => set('adminNotes', e.target.value)}
              placeholder="Your own notes about this journalist — context, preferences, past conversations, etc." />
          </div>
        </Section>
      </div>

      <div className="flex items-center gap-3 mt-8">
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Journalist'}
        </button>
        <Link to={isEdit ? `/journalists/${id}` : '/journalists'} className="btn-secondary">Cancel</Link>
        <div className="ml-auto text-sm text-slate-500">Score: <strong className="text-northstar-600">{total}/100</strong></div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-slate-900 mb-4 pb-3 border-b border-slate-100">{title}</h2>
      {children}
    </div>
  );
}

