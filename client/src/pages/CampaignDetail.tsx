import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, Sparkles, Send, RefreshCw, Trash2, Plus, Search, Save, Mail, Check } from 'lucide-react';
import { campaigns as cApi, journalists as jApi } from '../api';
import type { Campaign, CampaignJournalist, CampaignType, Journalist } from '../types';

const TYPE_LABELS: Record<CampaignType, string> = {
  cold_intro: 'Cold Introduction', event: 'Event Coverage',
  hackathon: 'Hackathon', founder_promo: 'Founder Spotlight',
};

const DRAFT_STATUS_STYLE: Record<string, string> = {
  not_started: 'bg-slate-100 text-slate-500',
  ready: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
};

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignJournalists, setCampaignJournalists] = useState<CampaignJournalist[]>([]);
  const [allJournalists, setAllJournalists] = useState<Journalist[]>([]);
  const [briefDraft, setBriefDraft] = useState('');
  const [savingBrief, setSavingBrief] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [regenInstructions, setRegenInstructions] = useState<Record<number, string>>({});
  const [editedDrafts, setEditedDrafts] = useState<Record<number, { subject: string; body: string }>>({});
  const [creatingGmailDrafts, setCreatingGmailDrafts] = useState(false);
  const [gmailDraftsResult, setGmailDraftsResult] = useState<{ created: number; skippedNoEmail: number } | { error: string } | null>(null);

  const loadCampaign = () => {
    if (!id) return;
    cApi.get(Number(id)).then(r => { setCampaign(r.data); setBriefDraft(r.data.brief); });
  };
  const loadCampaignJournalists = () => {
    if (!id) return;
    cApi.getJournalists(Number(id)).then(r => setCampaignJournalists(r.data));
  };

  useEffect(() => {
    loadCampaign();
    loadCampaignJournalists();
    jApi.list().then(r => setAllJournalists(r.data));
  }, [id]);

  const addedIds = new Set(campaignJournalists.map(cj => cj.journalist_id));
  const pickerResults = allJournalists
    .filter(j => !addedIds.has(j.id))
    .filter(j => !pickerSearch || j.name.toLowerCase().includes(pickerSearch.toLowerCase()));

  const handleAddJournalist = async (journalistId: number) => {
    await cApi.addJournalists(Number(id), [journalistId]);
    loadCampaignJournalists();
  };

  const handleRemove = async (journalistId: number) => {
    await cApi.removeJournalist(Number(id), journalistId);
    setCampaignJournalists(prev => prev.filter(cj => cj.journalist_id !== journalistId));
  };

  const handleSaveBrief = async () => {
    setSavingBrief(true);
    try {
      await cApi.update(Number(id), { brief: briefDraft });
      loadCampaign();
    } finally {
      setSavingBrief(false);
    }
  };

  const handleGenerateDrafts = async () => {
    setGenerating(true);
    try {
      await cApi.generateDrafts(Number(id));
      // Drafts generate async server-side; poll a few times.
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        loadCampaignJournalists();
        if (attempts >= 6) clearInterval(interval);
      }, 5000);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateGmailDrafts = async () => {
    setCreatingGmailDrafts(true);
    setGmailDraftsResult(null);
    try {
      const res = await cApi.createGmailDrafts(Number(id));
      setGmailDraftsResult(res.data);
      loadCampaignJournalists();
    } catch (err: any) {
      setGmailDraftsResult({ error: err.response?.data?.error ?? 'Failed to create Gmail drafts.' });
    } finally {
      setCreatingGmailDrafts(false);
    }
  };

  const handleRegenerate = async (journalistId: number) => {
    setRegeneratingId(journalistId);
    try {
      await cApi.regenerateDraft(Number(id), journalistId, regenInstructions[journalistId] ?? '');
      loadCampaignJournalists();
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleSaveDraft = async (cj: CampaignJournalist) => {
    const edited = editedDrafts[cj.journalist_id];
    if (!edited) return;
    await cApi.updateDraft(Number(id), cj.journalist_id, { draftSubject: edited.subject, draftBody: edited.body });
    loadCampaignJournalists();
  };

  const handleSend = async (journalistId: number) => {
    if (!confirm('Mark this pitch as sent? This logs a "Pitched" outreach entry for the journalist.')) return;
    await cApi.markSent(Number(id), journalistId, campaign?.campaign_type ?? '');
    loadCampaignJournalists();
  };

  if (!campaign) return <div className="p-8 text-slate-400">Loading...</div>;

  const notStartedCount = campaignJournalists.filter(cj => cj.status === 'not_started').length;
  const draftableCount = campaignJournalists.filter(cj => cj.draft_subject && !cj.gmail_draft_id).length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> Back to campaigns
      </Link>

      {/* Header */}
      <div className="card p-6 mb-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {TYPE_LABELS[campaign.campaign_type as CampaignType] ?? campaign.campaign_type}
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{campaign.status}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
          </div>
        </div>

        <div className="mt-4">
          <label className="form-label">Brief</label>
          <textarea className="form-input" rows={3} value={briefDraft} onChange={e => setBriefDraft(e.target.value)} />
          {briefDraft !== campaign.brief && (
            <button className="btn-primary py-1.5 text-sm mt-2" onClick={handleSaveBrief} disabled={savingBrief}>
              {savingBrief ? 'Saving…' : 'Save Brief'}
            </button>
          )}
        </div>
      </div>

      {/* Journalists */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900">Journalists ({campaignJournalists.length})</h2>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm" onClick={() => setShowPicker(v => !v)}>
            <Plus className="w-3.5 h-3.5" /> Add Journalist
          </button>
          {notStartedCount > 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-sm font-medium ring-1 ring-violet-200 disabled:opacity-50 transition-colors"
              onClick={handleGenerateDrafts}
              disabled={generating}
            >
              <Sparkles className={`w-3.5 h-3.5 ${generating ? 'animate-pulse' : ''}`} />
              {generating ? 'Starting…' : `Generate Drafts (${notStartedCount})`}
            </button>
          )}
          {draftableCount > 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-sm font-medium ring-1 ring-indigo-200 disabled:opacity-50 transition-colors"
              onClick={handleCreateGmailDrafts}
              disabled={creatingGmailDrafts}
            >
              <Mail className={`w-3.5 h-3.5 ${creatingGmailDrafts ? 'animate-pulse' : ''}`} />
              {creatingGmailDrafts ? 'Creating…' : `Create Gmail Drafts (${draftableCount})`}
            </button>
          )}
        </div>
      </div>

      {gmailDraftsResult && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm border flex items-center justify-between ${
          'error' in gmailDraftsResult ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <span>
            {'error' in gmailDraftsResult
              ? gmailDraftsResult.error
              : `Created ${gmailDraftsResult.created} Gmail draft${gmailDraftsResult.created === 1 ? '' : 's'}${gmailDraftsResult.skippedNoEmail ? ` — ${gmailDraftsResult.skippedNoEmail} skipped (no email on file)` : ''}.`}
          </span>
          <button onClick={() => setGmailDraftsResult(null)} className="text-current opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {showPicker && (
        <div className="card p-4 mb-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="form-input pl-9" placeholder="Search journalists..." value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {pickerResults.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No matching journalists.</p>
            ) : (
              pickerResults.map(j => (
                <button
                  key={j.id}
                  onClick={() => handleAddJournalist(j.id)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 text-left"
                >
                  <span className="text-sm text-slate-800">{j.name}</span>
                  <Plus className="w-3.5 h-3.5 text-slate-400" />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {campaignJournalists.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">No journalists added yet.</div>
      ) : (
        <div className="space-y-3">
          {campaignJournalists.map(cj => {
            const edited = editedDrafts[cj.journalist_id];
            const subject = edited?.subject ?? cj.draft_subject;
            const body = edited?.body ?? cj.draft_body;
            const hasEdits = edited && (edited.subject !== cj.draft_subject || edited.body !== cj.draft_body);
            return (
              <div key={cj.id} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-medium text-slate-900 text-sm">{cj.journalist_name}</div>
                    <div className="text-xs text-slate-400">{cj.publication_name ?? '—'}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cj.gmail_draft_id && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700" title="A draft exists in the connected Gmail account">
                        <Check className="w-3 h-3" /> Draft in Gmail
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DRAFT_STATUS_STYLE[cj.status] ?? DRAFT_STATUS_STYLE.not_started}`}>
                      {cj.status.replace('_', ' ')}
                    </span>
                    <button onClick={() => handleRemove(cj.journalist_id)} className="p-1 rounded text-slate-300 hover:text-red-500" title="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {cj.status === 'not_started' ? (
                  <p className="text-xs text-slate-400 italic">No draft yet — use "Generate Drafts" above.</p>
                ) : (
                  <div className="space-y-2">
                    <input
                      className="form-input text-sm font-medium"
                      value={subject}
                      onChange={e => setEditedDrafts(prev => ({ ...prev, [cj.journalist_id]: { subject: e.target.value, body } }))}
                    />
                    <textarea
                      className="form-input text-sm"
                      rows={5}
                      value={body}
                      onChange={e => setEditedDrafts(prev => ({ ...prev, [cj.journalist_id]: { subject, body: e.target.value } }))}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      {hasEdits && (
                        <button className="btn-secondary py-1 text-xs" onClick={() => handleSaveDraft(cj)}>
                          <Save className="w-3 h-3" /> Save edits
                        </button>
                      )}
                      <input
                        className="form-input text-xs flex-1 min-w-32"
                        placeholder="Regeneration instructions (optional)"
                        value={regenInstructions[cj.journalist_id] ?? ''}
                        onChange={e => setRegenInstructions(prev => ({ ...prev, [cj.journalist_id]: e.target.value }))}
                      />
                      <button
                        className="btn-secondary py-1 text-xs"
                        onClick={() => handleRegenerate(cj.journalist_id)}
                        disabled={regeneratingId === cj.journalist_id}
                      >
                        <RefreshCw className={`w-3 h-3 ${regeneratingId === cj.journalist_id ? 'animate-spin' : ''}`} />
                        {regeneratingId === cj.journalist_id ? 'Regenerating…' : 'Regenerate'}
                      </button>
                      {cj.status !== 'sent' && (
                        <button className="btn-primary py-1 text-xs" onClick={() => handleSend(cj.journalist_id)}>
                          <Send className="w-3 h-3" /> Mark Sent
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
