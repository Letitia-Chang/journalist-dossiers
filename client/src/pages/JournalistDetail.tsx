import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Edit2, Trash2, ExternalLink, AtSign, Link2, Globe, FileText,
  MessageSquare, ChevronLeft, Plus, Target, TrendingUp,
  Clock, Send, CheckCircle2, XCircle, AlertCircle, Camera, Copy, Check,
} from 'lucide-react';
import { journalists as jApi, articles as aApi, outreach as oApi, enrichment as enrichApi } from '../api';
import { daysAgo } from '../utils';
import { useRef } from 'react';
import type { Journalist, Article, OutreachLog } from '../types';
import StatusBadge from '../components/StatusBadge';
import ArticleForm from '../components/ArticleForm';
import OutreachForm from '../components/OutreachForm';

export default function JournalistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [journalist, setJournalist] = useState<Journalist | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [outreach, setOutreach] = useState<OutreachLog[]>([]);
  const [tab, setTab] = useState<'overview' | 'articles' | 'outreach' | 'notes'>('overview');
  const [adminNotesText, setAdminNotesText] = useState('');
  const [pitchAngleText, setPitchAngleText] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [showArticleForm, setShowArticleForm] = useState(false);
  const [showOutreachForm, setShowOutreachForm] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [editingOutreach, setEditingOutreach] = useState<OutreachLog | null>(null);
  const [findingProfiles, setFindingProfiles] = useState(false);
  const [profileResult, setProfileResult] = useState<{ linkedinUrl?: string; muckrackUrl?: string; twitterUrl?: string; contactUrl?: string; error?: string } | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const reader = new FileReader();
    reader.onload = async ev => {
      const dataUrl = ev.target?.result as string;
      try {
        await jApi.uploadPhoto(Number(id), dataUrl);
        loadData();
      } catch { /* ignore */ } finally {
        setUploadingPhoto(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const loadData = () => {
    if (!id) return;
    jApi.get(Number(id)).then(r => {
      setJournalist(r.data);
      setAdminNotesText(r.data.adminNotes || '');
      setPitchAngleText(r.data.bestPitchAngle || '');
    });
    aApi.byJournalist(Number(id)).then(r => setArticles(r.data));
    oApi.byJournalist(Number(id)).then(r => setOutreach(r.data));
  };

  useEffect(() => { loadData(); }, [id]);

  const handleDelete = async () => {
    if (!confirm('Delete this journalist? This cannot be undone.')) return;
    await jApi.delete(Number(id));
    navigate('/journalists');
  };

  const handleFindProfiles = async () => {
    setFindingProfiles(true);
    setProfileResult(null);
    try {
      const r = await enrichApi.findProfiles(Number(id));
      setProfileResult(r.data);
      if (r.data.saved) loadData();
    } catch (err: any) {
      setProfileResult({ error: err.response?.data?.error || 'Profile search failed.' });
    } finally {
      setFindingProfiles(false);
    }
  };

  const handleCopyEmail = () => {
    if (!journalist?.email) return;
    navigator.clipboard.writeText(journalist.email).then(() => {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    });
  };

  const handleSaveNotes = async () => {
    if (!journalist) return;
    setNotesSaving(true);
    await jApi.update(journalist.id, { adminNotes: adminNotesText, bestPitchAngle: pitchAngleText });
    setNotesSaving(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  if (!journalist) return <div className="p-8 text-slate-400">Loading...</div>;

  // ── Relationship stats derived from outreach logs ──────────────────────
  const pitchesSent = outreach.filter(o =>
    ['Sent', 'No Response', 'Pitched'].includes(o.status)
  ).length;
  const hasResponded = outreach.some(o =>
    ['Responded', 'Meeting Scheduled', 'Covered', 'In Conversation'].includes(o.status)
  );
  const hasCovered = outreach.some(o => o.status === 'Covered');
  const hasDeclined = outreach.some(o => ['Not a Fit', 'Declined'].includes(o.status));

  const daysSinceContact = (() => {
    if (!journalist.lastContactedDate) return null;
    const diff = Math.floor(
      (Date.now() - new Date(journalist.lastContactedDate).getTime()) / 86_400_000
    );
    return diff;
  })();

  const lastLog = outreach[0]; // already sorted desc by server

  const scoreItems = [
    { label: 'AI Relevance', value: journalist.aiRelevanceScore, max: 25, desc: 'How closely their beat matches AI, ML, and LLM topics' },
    { label: 'Startup Relevance', value: journalist.startupRelevanceScore, max: 20, desc: 'Whether they cover startups, funding rounds, and founders' },
    { label: 'North Star Fit', value: journalist.northStarFitScore, max: 20, desc: 'Likelihood they would cover an AI enterprise startup like ours' },
    { label: 'Publication Authority', value: journalist.publicationAuthorityScore, max: 15, desc: 'Reach and credibility of their publication' },
    { label: 'Audience Reach', value: journalist.audienceReachScore, max: 10, desc: 'Estimated readership and social following' },
    { label: 'Contactability', value: journalist.contactabilityScore, max: 10, desc: 'Whether we have verified contact info for this journalist' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Back */}
      <Link to="/journalists" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> Back to journalists
      </Link>

      {/* Header */}
      <div className="card p-6 mb-5">
        {/* Top row: avatar + name block + actions */}
        <div className="flex items-start gap-4">
          {/* Avatar with upload overlay */}
          <div className="relative shrink-0 group">
            {journalist.photoUrl ? (
              <img
                src={journalist.photoUrl}
                alt={journalist.name}
                className="w-16 h-16 rounded-full object-cover border border-slate-200 shadow-sm"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-northstar-100 flex items-center justify-center text-northstar-600 text-xl font-bold border border-slate-200">
                {journalist.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </div>
            )}
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              title="Upload photo"
            >
              <Camera className="w-5 h-5 text-white" />
            </button>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{journalist.name}</h1>
              <StatusBadge status={journalist.outreachStatus} />
              <span className="ml-auto text-lg font-bold text-northstar-600 shrink-0">{journalist.totalScore} <span className="text-xs font-normal text-slate-400">/ 100</span></span>
            </div>
            <div className="text-slate-600 mt-0.5 text-sm">
              {journalist.roleTitle && <span>{journalist.roleTitle} · </span>}
              <span>{journalist.publication}</span>
            </div>
            {journalist.beat && <div className="text-sm text-slate-500 mt-0.5">Beat: {journalist.beat}</div>}
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              {journalist.location && <span>{journalist.location}</span>}
              {journalist.lastArticleDate && (() => {
                const days = Math.floor((Date.now() - new Date(journalist.lastArticleDate).getTime()) / 86_400_000);
                const color = days > 90 ? 'text-rose-500' : days > 30 ? 'text-amber-500' : 'text-slate-400';
                return (
                  <span className={color} title={days > 90 ? 'No articles in 90+ days — may have left or changed beats' : days > 30 ? 'No articles in 30+ days' : ''}>
                    {journalist.location ? '· ' : ''}last published {daysAgo(journalist.lastArticleDate)}
                  </span>
                );
              })()}
            </div>
          </div>

          {/* Edit / Delete */}
          <div className="flex gap-2 shrink-0">
            <Link to={`/journalists/${id}/edit`} className="btn-secondary"><Edit2 className="w-4 h-4" /> Edit</Link>
            <button onClick={handleDelete} className="btn-danger"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Contact links */}
        <div className="flex flex-wrap gap-2 mt-4">
          {journalist.email && (
            <button onClick={handleCopyEmail} className="btn-secondary text-xs" title="Click to copy email address">
              {copiedEmail ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copiedEmail ? 'Copied!' : journalist.email}
            </button>
          )}
          {journalist.twitterUrl && (
            <a href={journalist.twitterUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <AtSign className="w-3 h-3" /> Twitter/X
            </a>
          )}
          {journalist.linkedinUrl && (
            <a href={journalist.linkedinUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <Link2 className="w-3 h-3" /> LinkedIn
            </a>
          )}
          {journalist.muckRackUrl && (
            <a href={journalist.muckRackUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <ExternalLink className="w-3 h-3" /> MuckRack
            </a>
          )}
          {journalist.personalWebsite && (
            <a href={journalist.personalWebsite} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <Globe className="w-3 h-3" /> Website
            </a>
          )}
          {journalist.contactUrl && (
            <a href={journalist.contactUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <ExternalLink className="w-3 h-3" /> Contact Page
            </a>
          )}
          <button
            onClick={handleFindProfiles}
            disabled={findingProfiles}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
              journalist.serpSearchedAt && !journalist.linkedinUrl && !journalist.muckRackUrl
                ? 'border-amber-200 text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'border-dashed border-slate-300 text-slate-500 hover:border-teal-400 hover:text-teal-600 hover:bg-teal-50'
            }`}
            title={journalist.serpSearchedAt ? `Last searched ${new Date(journalist.serpSearchedAt).toLocaleDateString()}` : 'Search Google for LinkedIn, MuckRack, Twitter profiles'}
          >
            <Link2 className="w-3 h-3" />
            {findingProfiles ? 'Searching…' : journalist.serpSearchedAt && !journalist.linkedinUrl && !journalist.muckRackUrl ? 'No profiles found — try again' : journalist.serpSearchedAt ? 'Refresh profiles' : 'Find profiles via SerpAPI'}
          </button>
        </div>

        {/* Data freshness strip */}
        {journalist.serpSearchedAt && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>Last searched {new Date(journalist.serpSearchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {journalist.linkedinUrl   && <span className="text-teal-600">✓ LinkedIn</span>}
            {journalist.muckRackUrl   && <span className="text-teal-600">✓ MuckRack</span>}
            {journalist.twitterUrl    && <span className="text-teal-600">✓ Twitter/X</span>}
            {journalist.email         && <span className="text-teal-600">✓ Email</span>}
            {journalist.followerCount && <span className="text-teal-600">✓ Follower count</span>}
            {!journalist.email        && <span className="text-amber-500">⚠ Email — add manually</span>}
            {!journalist.linkedinUrl  && !journalist.muckRackUrl && <span className="text-amber-500">⚠ No profiles found</span>}
            {journalist.socialFollowing && !journalist.followerCount && <span className="text-slate-400">· Social following: manual</span>}
          </div>
        )}

        {/* SerpAPI result feedback */}
        {profileResult && (
          <div className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
            profileResult.error
              ? 'bg-rose-50 border border-rose-200 text-rose-700'
              : 'bg-teal-50 border border-teal-200 text-teal-800'
          }`}>
            {profileResult.error ? (
              <><XCircle className="w-3.5 h-3.5 shrink-0" /> {profileResult.error}</>
            ) : (
              <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {(profileResult as any).saved
                  ? `Found and saved: ${[profileResult.linkedinUrl && 'LinkedIn', profileResult.muckrackUrl && 'MuckRack', profileResult.twitterUrl && 'Twitter', profileResult.contactUrl && 'Contact page'].filter(Boolean).join(', ')}`
                  : 'No new profiles found via Google search.'}
              </>
            )}
          </div>
        )}

        {/* Relationship summary strip */}
        {outreach.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 pt-4 border-t border-slate-100 text-sm">
            {pitchesSent > 0 && (
              <span className="flex items-center gap-1 text-slate-600">
                <Send className="w-3.5 h-3.5 text-slate-400" />
                <strong>{pitchesSent}</strong> pitch{pitchesSent !== 1 ? 'es' : ''} sent
              </span>
            )}
            {daysSinceContact !== null && (
              <span className="flex items-center gap-1 text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                last contact <strong>{daysSinceContact === 0 ? 'today' : `${daysSinceContact}d ago`}</strong>
              </span>
            )}
            {hasCovered && (
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> has covered us
              </span>
            )}
            {!hasCovered && hasResponded && (
              <span className="flex items-center gap-1 text-blue-600 font-medium">
                <TrendingUp className="w-3.5 h-3.5" /> has responded
              </span>
            )}
            {hasDeclined && (
              <span className="flex items-center gap-1 text-rose-500 font-medium">
                <XCircle className="w-3.5 h-3.5" /> declined
              </span>
            )}
            {!hasResponded && !hasDeclined && pitchesSent > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertCircle className="w-3.5 h-3.5" /> no reply yet
              </span>
            )}
            {lastLog && (
              <span className="text-slate-400 text-xs">
                · last: {lastLog.status}{lastLog.channel ? ` via ${lastLog.channel}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-5 gap-0">
        {(['overview', 'articles', 'outreach', 'notes'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t ? 'border-northstar-600 text-northstar-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'articles' ? `Articles (${articles.length})` : t === 'outreach' ? `Outreach (${outreach.length})` : t === 'notes' ? 'Admin Notes' : t}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Score Breakdown</h3>
            <div className="space-y-3">
              {scoreItems.map(s => (
                <div key={s.label}>
                  <div className="flex justify-between text-sm mb-0.5">
                    <span className="text-slate-700 font-medium">{s.label}</span>
                    <span className="font-semibold text-slate-900">{s.value} / {s.max}</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-1">{s.desc}</p>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-northstar-500 h-2 rounded-full transition-all"
                      style={{ width: `${(s.value / s.max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
              <span className="text-sm font-medium text-slate-700">Total Score</span>
              <span className="text-xl font-bold text-northstar-600">{journalist.totalScore} / 100</span>
            </div>
          </div>

          <div className="space-y-4">
            {journalist.bestPitchAngle && (
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-northstar-500" /> Best Pitch Angle
                </h3>
                <p className="text-sm text-slate-600">{journalist.bestPitchAngle}</p>
              </div>
            )}
            {journalist.adminNotes && (
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900 mb-2">Admin Notes</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{journalist.adminNotes}</p>
              </div>
            )}
            <div className="card p-5">
              <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-northstar-500" /> Relationship
              </h3>
              {outreach.length === 0 ? (
                <p className="text-sm text-slate-400">No outreach logged yet.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Total interactions</span>
                    <span className="font-semibold text-slate-800">{outreach.length}</span>
                  </div>
                  {pitchesSent > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Pitches sent</span>
                      <span className="font-semibold text-slate-800">{pitchesSent}</span>
                    </div>
                  )}
                  {journalist.lastContactedDate && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Last contacted</span>
                      <span className={`font-medium ${daysSinceContact !== null && daysSinceContact > 60 ? 'text-rose-500' : daysSinceContact !== null && daysSinceContact > 30 ? 'text-amber-600' : 'text-slate-700'}`}>
                        {journalist.lastContactedDate}
                        {daysSinceContact !== null && (
                          <span className="text-slate-400 font-normal ml-1">({daysSinceContact}d ago)</span>
                        )}
                      </span>
                    </div>
                  )}
                  {journalist.nextFollowUpDate && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Follow-up due</span>
                      <span className="text-amber-600 font-medium">{journalist.nextFollowUpDate}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2 mt-1">
                    {hasCovered && <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✅ Has covered us</span>}
                    {!hasCovered && hasResponded && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">💬 Has responded</span>}
                    {hasDeclined && <span className="text-xs bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full font-medium">❌ Declined</span>}
                    {!hasResponded && !hasDeclined && pitchesSent > 0 && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">⏳ No reply yet</span>}
                    {outreach.length === 0 && <span className="text-xs bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">🆕 Never contacted</span>}
                  </div>
                </div>
              )}
              {journalist.publicationType && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-sm">
                  <span className="text-slate-500">Publication type</span>
                  <span className="text-slate-700">{journalist.publicationType}</span>
                </div>
              )}
            </div>

            {/* Outreach context card — only shown when at least one field is filled */}
            {(journalist.socialFollowing || journalist.followerCount || journalist.topicsToAvoid || journalist.bestTimeToReach ||
              ((() => { try { return JSON.parse(journalist.preferredContact || '[]'); } catch { return []; } })().length > 0)) && (
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-northstar-500" /> Outreach Context
                </h3>
                <div className="space-y-2 text-sm">
                  {(journalist.socialFollowing || journalist.followerCount) && (
                    <div className="flex justify-between items-start gap-4">
                      <span className="text-slate-500 shrink-0">Social following</span>
                      <span className="text-slate-700 text-right">
                        {journalist.socialFollowing || `~${journalist.followerCount! >= 1_000_000 ? `${(journalist.followerCount! / 1_000_000).toFixed(1)}M` : journalist.followerCount! >= 1_000 ? `${(journalist.followerCount! / 1_000).toFixed(1)}K` : journalist.followerCount} detected`}
                      </span>
                    </div>
                  )}
                  {(() => {
                    try {
                      const methods: string[] = JSON.parse(journalist.preferredContact || '[]');
                      const labels: Record<string, string> = { email: 'Email', twitter_dm: 'Twitter/X DM', linkedin_dm: 'LinkedIn DM', contact_form: 'Contact Form', newsletter: 'Newsletter Reply', other: 'Other' };
                      if (methods.length === 0) return null;
                      return (
                        <div className="flex justify-between items-start gap-4">
                          <span className="text-slate-500 shrink-0">Preferred contact</span>
                          <div className="flex flex-wrap gap-1 justify-end">
                            {methods.map(m => (
                              <span key={m} className="text-xs bg-northstar-50 text-northstar-700 px-2 py-0.5 rounded-full font-medium">{labels[m] || m}</span>
                            ))}
                          </div>
                        </div>
                      );
                    } catch { return null; }
                  })()}
                  {journalist.topicsToAvoid && (
                    <div className="flex justify-between items-start gap-4">
                      <span className="text-slate-500 shrink-0">Topics to avoid</span>
                      <span className="text-slate-700 text-right">{journalist.topicsToAvoid}</span>
                    </div>
                  )}
                  {journalist.bestTimeToReach && (
                    <div className="flex justify-between items-start gap-4">
                      <span className="text-slate-500 shrink-0">Best time to reach</span>
                      <span className="text-slate-700 text-right">{journalist.bestTimeToReach}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Articles tab */}
      {tab === 'articles' && (
        <div>
          <div className="flex justify-end mb-4">
            <button className="btn-primary" onClick={() => { setEditingArticle(null); setShowArticleForm(true); }}>
              <Plus className="w-4 h-4" /> Add Article
            </button>
          </div>
          {showArticleForm && (
            <ArticleForm
              journalistId={Number(id)}
              article={editingArticle}
              onSave={() => { setShowArticleForm(false); setEditingArticle(null); loadData(); }}
              onCancel={() => { setShowArticleForm(false); setEditingArticle(null); }}
            />
          )}
          {articles.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">
              <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              No articles added yet.
            </div>
          ) : (
            <div className="space-y-3">
              {articles.map(a => (
                <div key={a.id} className="card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-2">
                        <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:text-northstar-600 flex items-center gap-1">
                          {a.title} {a.url && <ExternalLink className="w-3 h-3 shrink-0" />}
                        </a>
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500 mt-1">
                        {a.publishDate && <span>{a.publishDate}</span>}
                        {a.topic && <span>· {a.topic}</span>}
                        {a.storyType && <span>· {a.storyType}</span>}
                      </div>
                      {a.summary && <p className="text-sm text-slate-600 mt-2">{a.summary}</p>}
                      {a.relevanceToNorthStar && (
                        <p className="text-xs text-northstar-600 mt-1 bg-northstar-50 rounded px-2 py-1">
                          <strong>Relevance:</strong> {a.relevanceToNorthStar}
                        </p>
                      )}
                      {a.usefulAngle && (
                        <p className="text-xs text-green-700 mt-1 bg-green-50 rounded px-2 py-1">
                          <strong>Angle:</strong> {a.usefulAngle}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => { setEditingArticle(a); setShowArticleForm(true); }}>
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button className="btn-danger text-xs px-2 py-1" onClick={async () => {
                        if (confirm('Delete article?')) { await aApi.delete(a.id); loadData(); }
                      }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Outreach tab */}
      {tab === 'outreach' && (
        <div>
          <div className="flex justify-end mb-4">
            <button className="btn-primary" onClick={() => { setEditingOutreach(null); setShowOutreachForm(true); }}>
              <Plus className="w-4 h-4" /> Log Outreach
            </button>
          </div>
          {showOutreachForm && (
            <OutreachForm
              journalistId={Number(id)}
              log={editingOutreach}
              onSave={() => { setShowOutreachForm(false); setEditingOutreach(null); loadData(); }}
              onCancel={() => { setShowOutreachForm(false); setEditingOutreach(null); }}
            />
          )}
          {outreach.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              No outreach logged yet.
            </div>
          ) : (
            <div className="space-y-3">
              {outreach.map(o => (
                <div key={o.id} className="card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900">{o.subjectLine || o.messageType}</span>
                        <StatusBadge status={o.status} />
                        {o.channel && <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{o.channel}</span>}
                        {o.date && <span className="text-xs text-slate-400">{o.date}</span>}
                      </div>
                      {o.messageBody && (
                        <p className="text-sm text-slate-600 mt-2 bg-slate-50 rounded p-2 whitespace-pre-wrap">{o.messageBody}</p>
                      )}
                      {o.response && (
                        <p className="text-sm text-green-700 mt-2 bg-green-50 rounded p-2">
                          <strong>Response:</strong> {o.response}
                        </p>
                      )}
                      {o.nextStep && (
                        <p className="text-xs text-amber-700 mt-1">
                          <strong>Next step:</strong> {o.nextStep}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => { setEditingOutreach(o); setShowOutreachForm(true); }}>
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button className="btn-danger text-xs px-2 py-1" onClick={async () => {
                        if (confirm('Delete log?')) { await oApi.delete(o.id); loadData(); }
                      }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin Notes tab */}
      {tab === 'notes' && (
        <div className="space-y-5 max-w-2xl">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-1">Best Pitch Angle</h3>
            <p className="text-xs text-slate-400 mb-3">Auto-filled by Claude when accepted from RSS — edit freely.</p>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-northstar-300 resize-none"
              rows={3}
              value={pitchAngleText}
              onChange={e => setPitchAngleText(e.target.value)}
              placeholder="e.g. Angle around AI infrastructure for mid-market — she covers cost/efficiency stories heavily"
            />
          </div>
          {journalist.notes && (
            <div className="card p-5 bg-slate-50">
              <h3 className="font-semibold text-slate-700 mb-1 flex items-center gap-2">
                System Notes
                <span className="text-xs font-normal text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded">auto-generated · read only</span>
              </h3>
              <p className="text-sm text-slate-500 whitespace-pre-wrap select-text">{journalist.notes}</p>
            </div>
          )}
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-1">Admin Notes</h3>
            <p className="text-xs text-slate-400 mb-3">Your own notes — context, preferences, past conversations, anything useful for outreach.</p>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-northstar-300 resize-none"
              rows={8}
              value={adminNotesText}
              onChange={e => setAdminNotesText(e.target.value)}
              placeholder="Add your own notes here..."
            />
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={handleSaveNotes} disabled={notesSaving}>
              {notesSaving ? 'Saving…' : 'Save Notes'}
            </button>
            {notesSaved && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

