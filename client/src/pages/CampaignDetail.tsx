import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Users, Sparkles, Download, Check, X,
  ChevronDown, ChevronUp, Copy, Send, RefreshCw, Search, Mail,
  Wand2, AlertCircle, Star, Newspaper,
} from 'lucide-react';
import { campaigns as cApi, journalists as jApi, coverage as covApi, auth as authApi } from '../api';
import type { Campaign, CampaignJournalist, Journalist, CampaignType, CoverageItem } from '../types';

const TYPE_LABELS: Record<CampaignType, string> = {
  cold_intro: 'Cold Introduction', event: 'Event Coverage',
  hackathon: 'Hackathon', founder_promo: 'Founder Spotlight',
};

const DRAFT_STATUS_STYLE: Record<string, string> = {
  pending:  'bg-slate-100 text-slate-500',
  ready:    'bg-blue-50 text-blue-700',
  approved: 'bg-emerald-50 text-emerald-700',
  sent:     'bg-emerald-100 text-emerald-800',
  skipped:  'bg-slate-100 text-slate-400',
  failed:   'bg-rose-50 text-rose-700',
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  'Not Started': '🆕 Never contacted',
  'Researching':  '🆕 Never contacted',
  'Ready to Pitch': '🆕 Never contacted',
  'Pitched':      '📤 Pitched — no reply yet',
  'Responded':    '💬 Has responded before',
  'In Conversation': '🤝 In conversation',
  'Covered':      '✅ Has covered us',
  'Not a Fit':    '❌ Declined',
  'On Hold':      '⏸ On hold',
};

type Tab = 'journalists' | 'drafts' | 'pack' | 'coverage';

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignJournalists, setCampaignJournalists] = useState<CampaignJournalist[]>([]);
  const [allJournalists, setAllJournalists] = useState<Journalist[]>([]);
  const [tab, setTab] = useState<Tab>('journalists');
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');
  const [expandedDraft, setExpandedDraft] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<Record<number, { subject: string; body: string }>>({});
  const [copying, setCopying] = useState<number | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [suggestError, setSuggestError] = useState('');
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [regenInstructions, setRegenInstructions] = useState<Record<number, string>>({});
  const [showAssets, setShowAssets] = useState(false);
  const [assetsDraft, setAssetsDraft] = useState({ pressKitUrl: '', photoFolderUrl: '', demoUrl: '', boilerplate: '' });
  const [savingAssets, setSavingAssets] = useState(false);
  const [campaignCoverage, setCampaignCoverage] = useState<CoverageItem[]>([]);
  const [allCoverage, setAllCoverage] = useState<CoverageItem[]>([]);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkingCoverage, setLinkingCoverage] = useState(false);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [creatingGmailDrafts, setCreatingGmailDrafts] = useState(false);
  const [gmailDraftResults, setGmailDraftResults] = useState<{ name: string; email: string; success: boolean; error?: string }[] | null>(null);

  const loadCoverage = useCallback(async () => {
    const [linked, all] = await Promise.all([
      cApi.getCoverage(Number(id)),
      covApi.list(),
    ]);
    setCampaignCoverage(linked.data);
    setAllCoverage(all.data);
  }, [id]);

  const loadCampaign = useCallback(async () => {
    const [c, cj] = await Promise.all([
      cApi.get(Number(id)),
      cApi.getJournalists(Number(id)),
    ]);
    setCampaign(c.data);
    setCampaignJournalists(cj.data);
    setAssetsDraft({
      pressKitUrl: c.data.pressKitUrl || '',
      photoFolderUrl: c.data.photoFolderUrl || '',
      demoUrl: c.data.demoUrl || '',
      boilerplate: c.data.boilerplate || '',
    });
  }, [id]);

  useEffect(() => {
    loadCampaign();
    loadCoverage();
    jApi.list({ sortBy: 'totalScore' }).then(r => setAllJournalists(r.data));
    authApi.gmailStatus().then(r => setGmailConnected(r.data.connected)).catch(() => setGmailConnected(false));
  }, [loadCampaign, loadCoverage]);

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    setPolling(false);
    setElapsedSecs(0);
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return; // already polling
    setPolling(true);
    setElapsedSecs(0);
    timerIntervalRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    pollIntervalRef.current = setInterval(() => {
      cApi.getJournalists(Number(id)).then(r => {
        setCampaignJournalists(r.data);
        const stillPending = r.data.some((cj: CampaignJournalist) => cj.draftStatus === 'pending');
        if (!stillPending) stopPolling();
      });
    }, 3000);
  }, [id, stopPolling]);

  if (!campaign) return <div className="p-8 text-slate-400">Loading…</div>;

  const addedIds = new Set(campaignJournalists.map(cj => cj.journalistId));

  const filteredAll = allJournalists.filter(j => {
    if (addedIds.has(j.id)) return false;
    if (j.outreachStatus === 'Not a Fit') return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return j.name.toLowerCase().includes(s) ||
           j.publication.toLowerCase().includes(s) ||
           (j.beat || '').toLowerCase().includes(s);
  });

  const pendingCount = campaignJournalists.filter(cj => cj.draftStatus === 'pending').length;
  const approvedCount = campaignJournalists.filter(cj => cj.draftStatus === 'approved').length;
  const sentCount    = campaignJournalists.filter(cj => cj.draftStatus === 'sent').length;
  const draftsToReview = campaignJournalists.filter(cj => cj.draftStatus === 'ready' || cj.draftStatus === 'approved' || cj.draftStatus === 'failed');

  const handleAdd = async (journalistId: number) => {
    await cApi.addJournalists(Number(id), [journalistId]);
    // Update suggestions state to reflect the addition
    setSuggestions(prev => prev ? prev.map(s => s.id === journalistId ? { ...s, alreadyInCampaign: true } : s) : null);
    loadCampaign();
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestError('');
    setSuggestions(null);
    try {
      const res = await cApi.suggestJournalists(Number(id));
      setSuggestions(res.data.suggestions);
    } catch (err: any) {
      setSuggestError(err.response?.data?.error || 'Suggestion failed. Check server logs.');
    } finally {
      setSuggesting(false);
    }
  };

  const handleRemoveFromCampaign = async (journalistId: number) => {
    await cApi.removeJournalist(Number(id), journalistId);
    loadCampaign();
  };

  const handleGenerateDrafts = async () => {
    setGenerating(true);
    setGenerateMsg('');
    try {
      const res = await cApi.generateDrafts(Number(id));
      setGenerateMsg(res.data.message);
      if (res.data.count > 0) {
        setTab('drafts');
        startPolling();
      }
    } catch (err: any) {
      setGenerateMsg(err.response?.data?.error || 'Generation failed. Check server logs.');
    } finally {
      setGenerating(false);
    }
  };

  const getDraftEdit = (cj: CampaignJournalist) =>
    editingDraft[cj.journalistId] ?? { subject: cj.draftSubject, body: cj.draftBody };

  const setDraftEdit = (journalistId: number, field: 'subject' | 'body', value: string) => {
    setEditingDraft(prev => ({
      ...prev,
      [journalistId]: { ...(prev[journalistId] ?? { subject: '', body: '' }), [field]: value },
    }));
  };

  const handleSaveDraft = async (cj: CampaignJournalist, status?: string) => {
    const edit = getDraftEdit(cj);
    await cApi.updateDraft(Number(id), cj.journalistId, {
      draftSubject: edit.subject,
      draftBody: edit.body,
      draftStatus: status ?? (cj.draftStatus === 'ready' ? 'approved' : cj.draftStatus),
    });
    loadCampaign();
  };

  const handleRemove = async (cj: CampaignJournalist) => {
    await cApi.updateDraft(Number(id), cj.journalistId, { draftStatus: 'skipped' });
    loadCampaign();
  };

  const handleRegenerate = async (cj: CampaignJournalist) => {
    setRegenerating(cj.journalistId);
    const instructions = regenInstructions[cj.journalistId] || '';
    try {
      await cApi.regenerateDraft(Number(id), cj.journalistId, instructions);
      setRegenInstructions(prev => ({ ...prev, [cj.journalistId]: '' }));
      startPolling();
    } finally {
      setRegenerating(null);
    }
  };


  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopying(id);
    setTimeout(() => setCopying(null), 1500);
  };

  const handleExportCSV = () => {
    const approved = campaignJournalists.filter(
      cj => cj.draftStatus === 'approved'
    );
    const rows = [
      ['Name', 'Email', 'Publication', 'Subject', 'Body'],
      ...approved.map(cj => [
        cj.name, cj.email || '', cj.publication,
        `"${(cj.draftSubject || '').replace(/"/g, '""')}"`,
        `"${(cj.draftBody || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`,
      ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${campaign.name.replace(/\s+/g, '-')}-emails.csv`;
    a.click();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/campaigns" className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> All campaigns
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-northstar-100 text-northstar-700">
                {TYPE_LABELS[campaign.type]}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
            {campaign.brief && (
              <p className="text-slate-500 mt-1 text-sm max-w-2xl">{campaign.brief}</p>
            )}

            {/* Campaign Assets */}
            <div className="mt-3">
              <button
                onClick={() => setShowAssets(v => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showAssets ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Campaign Assets
                {(campaign.pressKitUrl || campaign.photoFolderUrl || campaign.demoUrl || campaign.boilerplate) && (
                  <span className="ml-1 bg-emerald-100 text-emerald-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">filled</span>
                )}
              </button>
              {showAssets && (
                <div className="mt-3 p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3 max-w-2xl">
                  <p className="text-xs text-slate-500">Links and boilerplate injected into every draft for this campaign. Journalists won't see these unless Claude includes them naturally.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="form-label">Press kit URL</label>
                      <input className="form-input text-sm" placeholder="https://drive.google.com/…" value={assetsDraft.pressKitUrl} onChange={e => setAssetsDraft(a => ({ ...a, pressKitUrl: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Photo folder URL</label>
                      <input className="form-input text-sm" placeholder="https://drive.google.com/…" value={assetsDraft.photoFolderUrl} onChange={e => setAssetsDraft(a => ({ ...a, photoFolderUrl: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Demo / product URL</label>
                      <input className="form-input text-sm" placeholder="https://…" value={assetsDraft.demoUrl} onChange={e => setAssetsDraft(a => ({ ...a, demoUrl: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Company boilerplate <span className="text-slate-400 font-normal">(standard "About" paragraph)</span></label>
                    <textarea className="form-textarea text-sm" rows={3} placeholder="North Star AI Labs is an AI startup lab inside ATDC in Atlanta, Georgia…" value={assetsDraft.boilerplate} onChange={e => setAssetsDraft(a => ({ ...a, boilerplate: e.target.value }))} />
                  </div>
                  <button
                    onClick={async () => {
                      setSavingAssets(true);
                      await cApi.update(Number(id), assetsDraft);
                      await loadCampaign();
                      setSavingAssets(false);
                    }}
                    disabled={savingAssets}
                    className="btn-primary text-sm"
                  >
                    {savingAssets ? 'Saving…' : 'Save assets'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {approvedCount > 0 && (
              <button onClick={handleExportCSV} className="flex items-center gap-1.5 btn-secondary text-sm">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            {pendingCount > 0 && (
              <button
                onClick={handleGenerateDrafts}
                disabled={generating}
                className="flex items-center gap-1.5 btn-primary text-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {generating ? 'Generating…' : `Generate ${pendingCount} draft${pendingCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 mt-4 text-sm">
          <span className="text-slate-500"><strong className="text-slate-800">{campaignJournalists.length}</strong> journalists</span>
          <span className="text-slate-500"><strong className="text-blue-700">{draftsToReview.length}</strong> ready to review</span>
          <span className="text-slate-500"><strong className="text-emerald-700">{approvedCount}</strong> approved</span>
          <span className="text-slate-500"><strong className="text-emerald-700">{sentCount}</strong> sent</span>
          {polling && (
            <span className="text-indigo-500 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Generating drafts… ({elapsedSecs}s)
            </span>
          )}
        </div>

        {generateMsg && (
          <div className="mt-3 px-4 py-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm">
            ✨ {generateMsg}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {(['journalists', 'drafts', 'pack', 'coverage'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-northstar-500 text-northstar-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'journalists' ? (
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Journalists ({campaignJournalists.length})</span>
            ) : t === 'drafts' ? (
              <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Review Drafts ({draftsToReview.length})</span>
            ) : t === 'pack' ? (
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email Pack
                {approvedCount > 0 && (
                  <span className="ml-1 bg-emerald-100 text-emerald-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{approvedCount}</span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Newspaper className="w-3.5 h-3.5" /> Coverage
                {campaignCoverage.length > 0 && (
                  <span className="ml-1 bg-blue-100 text-blue-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{campaignCoverage.length}</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: Journalist picker ────────────────────────────────────────── */}
      {tab === 'journalists' && (
        <div className="space-y-6">
          {/* Already added */}
          {campaignJournalists.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                In this campaign
              </div>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {campaignJournalists.map(cj => (
                      <tr key={cj.journalistId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{cj.name}</div>
                          <div className="text-xs text-slate-400">{cj.publication} · {cj.beat}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {RELATIONSHIP_LABEL[cj.outreachStatus] || cj.outreachStatus}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DRAFT_STATUS_STYLE[cj.draftStatus]}`}>
                            {cj.draftStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {cj.draftStatus !== 'sent' && (
                            <button
                              onClick={() => handleRemoveFromCampaign(cj.journalistId)}
                              className="text-slate-300 hover:text-rose-500 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AI Suggest section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {suggestions ? 'AI Suggestions' : 'Add journalists'}
              </div>
              <button
                onClick={handleSuggest}
                disabled={suggesting}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-medium transition-colors disabled:opacity-50"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {suggesting ? 'Analysing…' : suggestions ? 'Re-run suggestions' : 'Suggest with AI'}
              </button>
            </div>

            {suggestError && (
              <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 mb-3">
                <AlertCircle className="w-4 h-4 shrink-0" /> {suggestError}
              </div>
            )}

            {suggesting && (
              <div className="card p-8 text-center text-slate-400 text-sm">
                <Wand2 className="w-6 h-6 mx-auto mb-2 text-violet-300 animate-pulse" />
                Claude is reviewing your journalist roster against the campaign brief…
              </div>
            )}

            {suggestions && !suggesting && (() => {
              const recommended = suggestions.filter(s => s.recommended && !s.alreadyInCampaign);
              const others = suggestions.filter(s => !s.recommended && !s.alreadyInCampaign);
              const alreadyAdded = suggestions.filter(s => s.alreadyInCampaign);

              const SuggestionRow = ({ s, highlight }: { s: any; highlight: boolean }) => (
                <tr key={s.id} className={`hover:bg-slate-50 ${highlight ? 'bg-violet-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                      {s.name}
                      {s.hasWrittenAboutNorthStar && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                          <Newspaper className="w-2.5 h-2.5" /> Covered us
                        </span>
                      )}
                      {(s.outreachStatus === 'Responded' || s.outreachStatus === 'In Conversation') && (
                        <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                          Warm
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{s.publication} · {s.beat}</div>
                    {s.reasons?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {s.reasons.map((r: string, i: number) => (
                          <span key={i} className="text-xs text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">{r}</span>
                        ))}
                      </div>
                    )}
                    {s.warning && (
                      <div className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {s.warning}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {RELATIONSHIP_LABEL[s.outreachStatus] || s.outreachStatus}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      s.priority === 'high' ? 'bg-violet-100 text-violet-700' :
                      s.priority === 'medium' ? 'bg-slate-100 text-slate-600' :
                      'bg-slate-50 text-slate-400'
                    }`}>
                      {s.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.alreadyInCampaign ? (
                      <span className="text-xs text-slate-300">Added</span>
                    ) : (
                      <button
                        onClick={() => handleAdd(s.id)}
                        className="text-xs px-2.5 py-1 rounded bg-northstar-50 text-northstar-700 border border-northstar-200 hover:bg-northstar-100 font-medium transition-colors"
                      >
                        + Add
                      </button>
                    )}
                  </td>
                </tr>
              );

              return (
                <div className="space-y-4">
                  {recommended.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Star className="w-3.5 h-3.5 text-violet-500" />
                        <span className="text-xs font-semibold text-violet-700 uppercase tracking-wider">Recommended</span>
                      </div>
                      <div className="card overflow-hidden border-violet-200">
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-slate-100">
                            {recommended.map(s => <SuggestionRow key={s.id} s={s} highlight={true} />)}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {others.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Other journalists</div>
                      <div className="card overflow-hidden">
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-slate-100">
                            {others.map(s => <SuggestionRow key={s.id} s={s} highlight={false} />)}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {alreadyAdded.length > 0 && (
                    <div className="text-xs text-slate-400 px-1">
                      {alreadyAdded.length} journalist{alreadyAdded.length !== 1 ? 's' : ''} already in this campaign ({alreadyAdded.map(s => s.name).join(', ')})
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Fallback: plain list when no suggestions run yet */}
            {!suggestions && !suggesting && (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    className="form-input pl-9"
                    placeholder="Search by name, publication or beat…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                {filteredAll.length === 0 ? (
                  <div className="card p-6 text-center text-slate-400 text-sm">
                    {search ? 'No matching journalists.' : 'All journalists are already in this campaign.'}
                  </div>
                ) : (
                  <div className="card overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-100">
                        {filteredAll.slice(0, 50).map(j => (
                          <tr key={j.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900 flex items-center gap-1.5">
                                {j.name}
                                {j.isFavorite ? <span className="text-amber-400 text-xs">★</span> : null}
                              </div>
                              <div className="text-xs text-slate-400">{j.publication} · {j.beat}</div>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {RELATIONSHIP_LABEL[j.outreachStatus] || j.outreachStatus}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs font-mono text-slate-500">{j.totalScore}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleAdd(j.id)}
                                className="text-xs px-2.5 py-1 rounded bg-northstar-50 text-northstar-700 border border-northstar-200 hover:bg-northstar-100 font-medium transition-colors"
                              >
                                + Add
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Draft review ─────────────────────────────────────────────── */}
      {tab === 'drafts' && (
        <div>
          {draftsToReview.length === 0 ? (
            <div className="card p-10 text-center">
              <Sparkles className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              <div className="text-slate-500 font-medium">No drafts yet</div>
              <div className="text-slate-400 text-sm mt-1">
                Add journalists, then click <strong>"Generate drafts"</strong> to have Claude write personalised emails.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {draftsToReview.map(cj => {
                const edit = getDraftEdit(cj);
                const isExpanded = expandedDraft === cj.journalistId;
                const isSent = cj.draftStatus === 'sent';

                return (
                  <div
                    key={cj.journalistId}
                    className={`card border ${
                      cj.draftStatus === 'approved' ? 'border-emerald-200 bg-emerald-50/30' :
                      cj.draftStatus === 'sent'     ? 'border-indigo-200 bg-indigo-50/20 opacity-70' :
                      cj.draftStatus === 'failed'   ? 'border-rose-200 bg-rose-50/30' :
                      'border-slate-200'
                    }`}
                  >
                    {/* Collapsed header */}
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer"
                      onClick={() => setExpandedDraft(isExpanded ? null : cj.journalistId)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{cj.name}</span>
                          <span className="text-xs text-slate-400">{cj.publication}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DRAFT_STATUS_STYLE[cj.draftStatus]}`}>
                            {cj.draftStatus}
                          </span>
                        </div>
                        {!isExpanded && cj.draftSubject && (
                          <div className="text-sm text-slate-500 mt-0.5 truncate">{cj.draftSubject}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isSent && (
                          <button
                            onClick={e => { e.stopPropagation(); handleRemove(cj); }}
                            className="text-xs px-2 py-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                          >
                            Remove
                          </button>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-slate-400" />
                          : <ChevronDown className="w-4 h-4 text-slate-400" />
                        }
                      </div>
                    </div>

                    {/* Expanded draft editor */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 p-4 space-y-3">
                        {cj.draftStatus === 'failed' ? (
                          <div className="text-sm text-rose-600 bg-rose-50 rounded p-3">
                            Draft generation failed for this journalist. Check the server logs, or write the email manually below.
                          </div>
                        ) : null}

                        {/* Relationship context */}
                        <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2 border border-slate-100">
                          {RELATIONSHIP_LABEL[cj.outreachStatus] || cj.outreachStatus}
                          {cj.email && <span className="ml-3 text-slate-400">📧 {cj.email}</span>}
                        </div>

                        {/* Subject */}
                        <div>
                          <label className="form-label flex items-center justify-between">
                            Subject line
                            <button
                              onClick={() => handleCopy(edit.subject, cj.journalistId * 10)}
                              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                            >
                              {copying === cj.journalistId * 10 ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              copy
                            </button>
                          </label>
                          <input
                            className="form-input"
                            value={edit.subject}
                            onChange={e => setDraftEdit(cj.journalistId, 'subject', e.target.value)}
                            disabled={isSent}
                          />
                        </div>

                        {/* Body */}
                        <div>
                          <label className="form-label flex items-center justify-between">
                            Email body
                            <button
                              onClick={() => handleCopy(edit.body, cj.journalistId * 10 + 1)}
                              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                            >
                              {copying === cj.journalistId * 10 + 1 ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              copy
                            </button>
                          </label>
                          <textarea
                            className="form-textarea font-mono text-sm"
                            rows={10}
                            value={edit.body}
                            onChange={e => setDraftEdit(cj.journalistId, 'body', e.target.value)}
                            disabled={isSent}
                          />
                        </div>

                        {!isSent && (
                          <>
                            {/* Regenerate with instructions */}
                            <div className="flex gap-2 pt-1 border-t border-slate-100">
                              <input
                                className="form-input text-sm flex-1"
                                placeholder="Regenerate with instructions… e.g. 'make it shorter' or 'focus on the hardware angle'"
                                value={regenInstructions[cj.journalistId] || ''}
                                onChange={e => setRegenInstructions(prev => ({ ...prev, [cj.journalistId]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') handleRegenerate(cj); }}
                              />
                              <button
                                onClick={() => handleRegenerate(cj)}
                                disabled={regenerating === cj.journalistId}
                                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-medium transition-colors disabled:opacity-50 shrink-0"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${regenerating === cj.journalistId ? 'animate-spin' : ''}`} />
                                {regenerating === cj.journalistId ? 'Regenerating…' : 'Regenerate'}
                              </button>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSaveDraft(cj)}
                                className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium transition-colors"
                              >
                                Save edits
                              </button>
                              <button
                                onClick={() => handleSaveDraft(cj, 'approved')}
                                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" /> Approve — add to Email Pack
                              </button>
                            </div>
                          </>
                        )}
                        {isSent && (
                          <div className="text-xs text-indigo-600 bg-indigo-50 rounded px-3 py-2">
                            ✓ Logged as sent — this draft is locked.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Email Pack ───────────────────────────────────────────────── */}
      {tab === 'pack' && (() => {
        const approved = campaignJournalists.filter(
          cj => cj.draftStatus === 'approved'
        );

        const buildPackText = () =>
          approved.map((cj, i) =>
            [
              `── Email ${i + 1} of ${approved.length} ──────────────────────`,
              `To:      ${cj.name}${cj.email ? ` <${cj.email}>` : ' (no email on file)'}`,
              `Pub:     ${cj.publication}`,
              `Subject: ${cj.draftSubject || '(no subject)'}`,
              ``,
              cj.draftBody || '(no body)',
              ``,
            ].join('\n')
          ).join('\n');

        const handleCopyAll = async () => {
          await navigator.clipboard.writeText(buildPackText());
          setCopiedAll(true);
          setTimeout(() => setCopiedAll(false), 2000);
        };

        return (
          <div>
            {approved.length === 0 ? (
              <div className="card p-10 text-center">
                <Mail className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                <div className="text-slate-500 font-medium">No approved drafts yet</div>
                <div className="text-slate-400 text-sm mt-1">
                  Approve drafts in the <strong>Review Drafts</strong> tab to see them here.
                </div>
              </div>
            ) : (
              <>
                {/* Pack header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-slate-500">
                    <strong className="text-slate-800">{approved.length}</strong> approved draft{approved.length !== 1 ? 's' : ''} ready to send
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 btn-secondary text-sm"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                    {gmailConnected === false ? (
                      <button
                        onClick={() => {
                          authApi.connectGmail();
                          setTimeout(() => authApi.gmailStatus().then(r => setGmailConnected(r.data.connected)), 5000);
                        }}
                        className="flex items-center gap-1.5 btn-secondary text-sm text-slate-500"
                        title="Connect Gmail to create drafts"
                      >
                        <Mail className="w-3.5 h-3.5" /> Connect Gmail
                      </button>
                    ) : gmailConnected === true ? (
                      <button
                        disabled={creatingGmailDrafts}
                        onClick={async () => {
                          setCreatingGmailDrafts(true);
                          setGmailDraftResults(null);
                          try {
                            const r = await cApi.createGmailDrafts(Number(id));
                            setGmailDraftResults(r.data.results);
                          } catch (err: any) {
                            alert(err.response?.data?.error || err.message);
                          } finally {
                            setCreatingGmailDrafts(false);
                          }
                        }}
                        className="flex items-center gap-1.5 btn-secondary text-sm text-emerald-700"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {creatingGmailDrafts ? 'Creating drafts…' : `Save to Gmail Drafts`}
                      </button>
                    ) : null}
                    <button
                      onClick={handleCopyAll}
                      className="flex items-center gap-1.5 btn-primary text-sm"
                    >
                      {copiedAll
                        ? <><Check className="w-3.5 h-3.5" /> Copied!</>
                        : <><Copy className="w-3.5 h-3.5" /> Copy all {approved.length} emails</>
                      }
                    </button>
                  </div>
                </div>

                {/* Gmail draft results */}
                {gmailDraftResults && (
                  <div className="mb-4 px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 text-sm space-y-1">
                    <div className="font-semibold text-slate-700 mb-2">Gmail drafts created</div>
                    {gmailDraftResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {r.success
                          ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          : <X className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        }
                        <span className={r.success ? 'text-slate-700' : 'text-rose-600'}>
                          {r.name}{r.error ? ` — ${r.error}` : ''}
                        </span>
                      </div>
                    ))}
                    <div className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200">
                      Open Gmail → Drafts to review and send each email manually.
                    </div>
                  </div>
                )}

                {/* Usage tip */}
                <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-sm">
                  <strong>How to use:</strong> Copy all → paste into a doc or notes app. Each block has the recipient, subject, and body ready to copy individually into Gmail. Or use the CSV export with Gmail's multi-send / mail merge tool.
                </div>

                {/* Individual draft cards */}
                <div className="space-y-4">
                  {approved.map((cj, i) => {
                    const copyId = cj.journalistId * 100;
                    return (
                      <div key={cj.journalistId} className="card border border-slate-200 overflow-hidden">
                        {/* Card header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                            <div>
                              <span className="font-semibold text-slate-900 text-sm">{cj.name}</span>
                              <span className="text-slate-400 text-xs ml-2">{cj.publication}</span>
                            </div>
                            {cj.email
                              ? <span className="text-xs text-slate-500 bg-white border border-slate-200 rounded px-2 py-0.5">{cj.email}</span>
                              : <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">⚠ no email on file</span>
                            }
                          </div>
                          <button
                            onClick={() => handleCopy(
                              `To: ${cj.name}${cj.email ? ` <${cj.email}>` : ''}\nSubject: ${cj.draftSubject}\n\n${cj.draftBody}`,
                              copyId
                            )}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            {copying === copyId
                              ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</>
                              : <><Copy className="w-3 h-3" /> Copy</>
                            }
                          </button>
                        </div>

                        {/* Subject */}
                        <div className="px-4 pt-3 pb-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">Subject</span>
                            <span className="text-sm font-medium text-slate-900">{cj.draftSubject || <span className="text-slate-400 italic">no subject</span>}</span>
                          </div>
                        </div>

                        {/* Body */}
                        <div className="px-4 pt-2 pb-3">
                          <div className="flex gap-2">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0 pt-0.5">Body</span>
                            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans flex-1 bg-slate-50 rounded p-3 border border-slate-100 leading-relaxed">
                              {cj.draftBody || <span className="text-slate-400 italic">no body</span>}
                            </pre>
                          </div>
                        </div>

                        {/* Mark sent footer */}
                        <div className="px-4 pb-3 flex justify-end">
                          <button
                            disabled={sending === cj.journalistId}
                            onClick={async () => {
                              setSending(cj.journalistId);
                              try {
                                await cApi.markSent(Number(id), cj.journalistId, campaign?.type || 'cold_intro');
                                await loadCampaign();
                              } finally {
                                setSending(null);
                              }
                            }}
                            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-200 rounded px-3 py-1.5 transition-colors"
                          >
                            <Send className="w-3 h-3" />
                            {sending === cj.journalistId ? 'Logging…' : 'Mark as sent'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── TAB: Coverage ────────────────────────────────────────────────── */}
      {tab === 'coverage' && (
        <div className="space-y-6">
          {/* Linked articles */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-700">
                Articles linked to this campaign ({campaignCoverage.length})
              </div>
            </div>
            {campaignCoverage.length === 0 ? (
              <div className="card p-8 text-center text-slate-400">
                <Newspaper className="w-7 h-7 mx-auto mb-2 text-slate-200" />
                <div className="text-sm">No coverage linked yet</div>
                <div className="text-xs mt-1">Link articles from your press coverage log below</div>
              </div>
            ) : (
              <div className="card divide-y divide-slate-100 overflow-hidden">
                {campaignCoverage.map(c => (
                  <div key={c.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-northstar-700 hover:underline truncate">
                            {c.title}
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-slate-800">{c.title}</span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          c.sentiment === 'positive' ? 'bg-emerald-50 text-emerald-700' :
                          c.sentiment === 'negative' ? 'bg-rose-50 text-rose-700' :
                          c.sentiment === 'mixed' ? 'bg-amber-50 text-amber-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>{c.sentiment}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {c.publication}{c.publishDate ? ` · ${c.publishDate}` : ''}{c.journalistName ? ` · ${c.journalistName}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await cApi.unlinkCoverage(Number(id), c.id);
                        await loadCoverage();
                      }}
                      className="text-slate-300 hover:text-rose-500 transition-colors shrink-0 mt-0.5"
                      title="Unlink from campaign"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Link existing coverage */}
          <div>
            <div className="text-sm font-semibold text-slate-700 mb-3">Link from press coverage log</div>
            <input
              type="text"
              placeholder="Search articles by title or publication…"
              value={linkSearch}
              onChange={e => setLinkSearch(e.target.value)}
              className="input-field w-full mb-3"
            />
            {(() => {
              const linkedIds = new Set(campaignCoverage.map(c => c.id));
              const filtered = allCoverage.filter(c =>
                !linkedIds.has(c.id) &&
                (linkSearch === '' ||
                  c.title.toLowerCase().includes(linkSearch.toLowerCase()) ||
                  c.publication.toLowerCase().includes(linkSearch.toLowerCase()))
              );
              if (filtered.length === 0) return (
                <div className="text-sm text-slate-400 text-center py-6">
                  {linkSearch ? 'No matching articles' : 'All coverage is already linked'}
                </div>
              );
              return (
                <div className="card divide-y divide-slate-100 overflow-hidden">
                  {filtered.slice(0, 20).map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{c.title}</div>
                        <div className="text-xs text-slate-500">
                          {c.publication}{c.publishDate ? ` · ${c.publishDate}` : ''}
                        </div>
                      </div>
                      <button
                        disabled={linkingCoverage}
                        onClick={async () => {
                          setLinkingCoverage(true);
                          await cApi.linkCoverage(Number(id), c.id);
                          await loadCoverage();
                          setLinkingCoverage(false);
                        }}
                        className="btn-secondary text-xs shrink-0"
                      >
                        + Link
                      </button>
                    </div>
                  ))}
                  {filtered.length > 20 && (
                    <div className="px-4 py-2 text-xs text-slate-400">
                      {filtered.length - 20} more — refine search to narrow results
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
