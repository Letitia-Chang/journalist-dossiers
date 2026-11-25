import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, Sparkles, Send, RefreshCw, Trash2, Plus, Search, Save, Mail, Check } from 'lucide-react';
import { campaigns as cApi, journalists as jApi } from '../api';
import type { Campaign, CampaignJournalist, Journalist } from '../types';
import { campaignTypeLabel } from '../lib/campaignTypes';
import { apiError } from '../lib/errors';
import Modal from '../components/Modal';

const DRAFT_STATUS_STYLE: Record<string, string> = {
  not_started: 'bg-slate-100 text-slate-500',
  ready: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-700',
  drafting: 'bg-violet-50 text-violet-700',
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
  const [regenerating, setRegenerating] = useState<Set<number>>(new Set());
  const [regenInstructions, setRegenInstructions] = useState<Record<number, string>>({});
  const [editedDrafts, setEditedDrafts] = useState<Record<number, { subject: string; body: string }>>({});
  const [creatingGmailDrafts, setCreatingGmailDrafts] = useState(false);
  const [demoPreviews, setDemoPreviews] = useState<{ journalist_name: string; to: string; subject: string; body: string }[] | null>(null);
  const [gmailDraftsResult, setGmailDraftsResult] = useState<{ created: number; skippedNoEmail: number; failed?: number; expired?: boolean } | { message: string } | { error: string } | null>(null);

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

  // Drafts are written in the background: keep refreshing while any is in progress.
  const isDrafting = campaignJournalists.some(cj => cj.status === 'drafting');
  useEffect(() => {
    if (!isDrafting || !id) return;
    const timer = setInterval(() => { cApi.getJournalists(Number(id)).then(r => setCampaignJournalists(r.data)).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [isDrafting, id]);

  const clearEdits = (journalistId: number) => setEditedDrafts(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => Number(k) !== journalistId)));

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
    setGmailDraftsResult(null);
    try {
      const res = await cApi.generateDrafts(Number(id));
      setGmailDraftsResult({ message: res.data.message });
      loadCampaignJournalists(); // rows now read "drafting", which keeps the list refreshing
    } catch (err) {
      setGmailDraftsResult({ error: apiError(err, 'Could not generate drafts.') });
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateGmailDrafts = async () => {
    setCreatingGmailDrafts(true);
    setGmailDraftsResult(null);
    try {
      const res = await cApi.createGmailDrafts(Number(id));
      if (res.data.demo) {
        // Gmail is disabled in the public demo: show what would be created instead.
        setDemoPreviews(res.data.previews);
      } else {
        setGmailDraftsResult(res.data);
        loadCampaignJournalists();
      }
    } catch (err) {
      setGmailDraftsResult({ error: apiError(err, 'Failed to create Gmail drafts.') });
    } finally {
      setCreatingGmailDrafts(false);
    }
  };

  const handleRegenerate = async (journalistId: number, hasUnsaved: boolean) => {
    if (hasUnsaved && !confirm('Replace the text you haven’t saved with an AI draft?')) return;
    setRegenerating(prev => new Set(prev).add(journalistId));
    try {
      setGmailDraftsResult(null);
      await cApi.regenerateDraft(Number(id), journalistId, regenInstructions[journalistId] ?? '');
      clearEdits(journalistId); // show the new text, not what was typed over the old one
      loadCampaignJournalists();
    } catch (err) {
      loadCampaignJournalists();
      setGmailDraftsResult({ error: apiError(err, 'Could not regenerate the draft.') });
    } finally {
      setRegenerating(prev => new Set([...prev].filter(x => x !== journalistId)));
    }
  };

  const handleSaveDraft = async (cj: CampaignJournalist) => {
    const edited = editedDrafts[cj.journalist_id];
    if (!edited) return;
    await cApi.updateDraft(Number(id), cj.journalist_id, { draftSubject: edited.subject, draftBody: edited.body });
    clearEdits(cj.journalist_id);
    loadCampaignJournalists();
  };

  const handleSend = async (cj: CampaignJournalist) => {
    if (!confirm('Mark this pitch as sent? This logs a "Pitched" outreach entry for the journalist.')) return;
    if (editedDrafts[cj.journalist_id]) await handleSaveDraft(cj); // what gets recorded is what's on screen
    await cApi.markSent(Number(id), cj.journalist_id);
    loadCampaignJournalists();
  };

  if (!campaign) return <div className="p-8 text-slate-400">Loading...</div>;

  const notStartedCount = campaignJournalists.filter(cj => ['not_started', 'failed'].includes(cj.status) && !cj.draft_subject.trim() && !cj.draft_body.trim()).length;
  const draftableCount = campaignJournalists.filter(cj => cj.draft_subject.trim() && cj.draft_body.trim() && !cj.gmail_draft_id && !['sent', 'drafting'].includes(cj.status)).length;

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> Back to campaigns
      </Link>

      {/* Header */}
      <div className="card p-6 mb-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {campaignTypeLabel(campaign.campaign_type)}
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{campaign.status}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
          </div>
        </div>

        <div className="mt-4">
          <label className="form-label" htmlFor="campaign-detail-brief">Brief</label>
          <textarea id="campaign-detail-brief" className="form-input" rows={3} value={briefDraft} onChange={e => setBriefDraft(e.target.value)} />
          {briefDraft !== campaign.brief && (
            <button className="btn-primary py-1.5 text-sm mt-2" onClick={handleSaveBrief} disabled={savingBrief}>
              {savingBrief ? 'Saving…' : 'Save Brief'}
            </button>
          )}
        </div>
      </div>

      {/* Journalists */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold text-slate-900">Journalists ({campaignJournalists.length})</h2>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm" onClick={() => setShowPicker(v => !v)}>
            <Plus className="w-3.5 h-3.5" /> Add Journalist
          </button>
          {notStartedCount > 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-sm font-medium ring-1 ring-violet-200 disabled:opacity-50 transition-colors"
              onClick={handleGenerateDrafts}
              disabled={generating || isDrafting}
            >
              <Sparkles className={`w-3.5 h-3.5 ${generating ? 'animate-pulse' : ''}`} />
              {generating ? 'Starting…' : isDrafting ? 'Writing…' : `Generate Drafts (${notStartedCount})`}
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
          'error' in gmailDraftsResult || ('failed' in gmailDraftsResult && gmailDraftsResult.failed) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <span>
            {'error' in gmailDraftsResult
              ? gmailDraftsResult.error
              : 'message' in gmailDraftsResult
              ? gmailDraftsResult.message
              : `Created ${gmailDraftsResult.created} Gmail draft${gmailDraftsResult.created === 1 ? '' : 's'}${gmailDraftsResult.skippedNoEmail ? ` — ${gmailDraftsResult.skippedNoEmail} skipped (no email on file)` : ''}${gmailDraftsResult.failed ? ` — ${gmailDraftsResult.failed} failed, ${gmailDraftsResult.expired ? 'because the connection expired: reconnect it under House Style' : 'so try again'}` : ''}.`}
          </span>
          <button onClick={() => setGmailDraftsResult(null)} aria-label="Dismiss" className="text-current opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {showPicker && (
        <div className="card p-4 mb-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="form-input pl-9" aria-label="Search journalists" placeholder="Search journalists..." value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
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
            const busy = regenerating.has(cj.journalist_id);
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
                    {cj.status !== 'sent' && <button onClick={() => handleRemove(cj.journalist_id)} className="p-1 rounded text-slate-300 hover:text-red-500" title="Remove" aria-label={`Remove ${cj.journalist_name}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>}
                  </div>
                </div>

                {cj.status === 'drafting' && !busy ? (
                  <p className="text-xs text-slate-400 italic">Writing a draft…</p>
                ) : (
                  <div className="space-y-2">
                    <input
                      className="form-input text-sm font-medium"
                      aria-label={`Subject for ${cj.journalist_name}`}
                      placeholder="Subject: write your own, or generate a draft"
                      value={subject}
                      readOnly={cj.status === 'sent' || busy}
                      onChange={e => setEditedDrafts(prev => ({ ...prev, [cj.journalist_id]: { subject: e.target.value, body } }))}
                    />
                    <textarea
                      className="form-input text-sm"
                      rows={cj.draft_body || body ? 5 : 2}
                      aria-label={`Pitch for ${cj.journalist_name}`}
                      placeholder="Your pitch"
                      value={body}
                      readOnly={cj.status === 'sent' || busy}
                      onChange={e => setEditedDrafts(prev => ({ ...prev, [cj.journalist_id]: { subject, body: e.target.value } }))}
                    />
                    {cj.status !== 'sent' && <div className="flex items-center gap-2 flex-wrap">
                      {hasEdits && !busy && (
                        <button className="btn-secondary py-1 text-xs" onClick={() => handleSaveDraft(cj)}>
                          <Save className="w-3 h-3" /> Save edits
                        </button>
                      )}
                      <input
                        className="form-input text-xs flex-1 min-w-32"
                        aria-label={`Instructions for ${cj.journalist_name}`}
                        placeholder="Instructions for the AI (optional)"
                        value={regenInstructions[cj.journalist_id] ?? ''}
                        onChange={e => setRegenInstructions(prev => ({ ...prev, [cj.journalist_id]: e.target.value }))}
                      />
                      <button
                        className="btn-secondary py-1 text-xs"
                        onClick={() => handleRegenerate(cj.journalist_id, !!hasEdits)}
                        disabled={busy}
                      >
                        <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
                        {busy ? 'Writing…' : cj.draft_body ? 'Regenerate' : 'Draft with AI'}
                      </button>
                      {subject.trim() && body.trim() && !busy && (
                        <button className="btn-primary py-1 text-xs" onClick={() => handleSend(cj)}>
                          <Send className="w-3 h-3" /> Mark Sent
                        </button>
                      )}
                    </div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {demoPreviews && (
        <Modal label="Gmail drafts preview" onClose={() => setDemoPreviews(null)} className="max-w-2xl max-h-[85vh]">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Mail className="w-4 h-4" /> Gmail drafts preview</h2>
              <p className="text-sm text-slate-500 mt-1">
                Gmail is turned off in this demo. When you self-host and connect a Google account, this button creates
                these {demoPreviews.length} drafts in your Gmail Drafts folder for you to review and send. Nothing is ever sent automatically.
              </p>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {demoPreviews.map(p => (
                <div key={p.to} className="border border-slate-200 rounded-lg p-3">
                  <div className="text-xs text-slate-400">To: {p.journalist_name} &lt;{p.to}&gt;</div>
                  <div className="text-sm font-medium text-slate-900 mt-0.5">{p.subject}</div>
                  <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans mt-2">{p.body}</pre>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 text-right">
              <button className="btn-primary" onClick={() => setDemoPreviews(null)}>Close</button>
            </div>
        </Modal>
      )}
    </div>
  );
}
