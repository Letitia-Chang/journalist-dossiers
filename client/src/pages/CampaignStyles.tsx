import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, Check, Sparkles, Mail, Unplug } from 'lucide-react';
import { campaignStyles as api, auth as authApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { CAMPAIGN_TYPES, campaignTypeLabel } from '../lib/campaignTypes';
import { apiError } from '../lib/errors';

interface StyleRow {
  campaign_type: string;
  instructions: string;
  updated_at: string;
}

export default function CampaignStyles() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const isOwner = user?.role === 'owner';
  const [styles, setStyles] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null; demo?: boolean } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadGmailStatus = () => authApi.gmailStatus().then(r => setGmailStatus(r.data)).catch(() => {});

  useEffect(() => {
    api.list().then(r => {
      const s: Record<string, string> = {};
      const d: Record<string, string> = {};
      for (const row of r.data as StyleRow[]) {
        s[row.campaign_type] = row.instructions;
        d[row.campaign_type] = row.updated_at;
      }
      setStyles(s);
      setSavedAt(d);
    });
    loadGmailStatus();
  }, []);

  // Popups can't message back reliably across origins, so just refresh
  // status when the user returns focus to this tab after the popup closes.
  useEffect(() => {
    window.addEventListener('focus', loadGmailStatus);
    return () => window.removeEventListener('focus', loadGmailStatus);
  }, []);

  const handleDisconnectGmail = async () => {
    if (!confirm('Disconnect Gmail? Campaigns will no longer be able to create drafts until reconnected.')) return;
    setDisconnecting(true);
    try {
      await authApi.disconnectGmail();
      await loadGmailStatus();
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSave = async (type: string) => {
    setSaving(type);
    try {
      await api.update(type, styles[type] ?? '');
    } catch (err) {
      alert(apiError(err, 'Could not save these instructions.'));
      return;
    } finally {
      setSaving(null);
    }
    setJustSaved(type);
    setSavedAt(prev => ({ ...prev, [type]: new Date().toISOString() }));
    setTimeout(() => setJustSaved(null), 2000);
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <Link to="/campaigns" className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-5">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns
      </Link>

      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-500" /> House Style
        </h1>
        <p className="text-slate-500 mt-1 text-sm max-w-xl">
          Standing instructions Claude follows when drafting emails for each campaign type.
          Write anything you'd normally edit in by hand — sign-off name, mandatory disclaimers,
          tone rules, things to always or never say.
        </p>
      </div>

      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-1.5">
          <Mail className="w-4 h-4" /> Gmail Connection
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Connect a Gmail account so "Create Gmail Drafts" on a campaign can create real drafts your team can review and send.
        </p>
        {gmailStatus === null ? (
          <p className="text-xs text-slate-400">Checking connection…</p>
        ) : gmailStatus.demo ? (
          <p className="text-xs text-slate-500">Disabled in the demo. When you self-host, connect a Google account here and "Create Gmail Drafts" will put pitches in your Drafts folder.</p>
        ) : gmailStatus.connected ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Check className="w-3 h-3" /> Connected as {gmailStatus.email}
            </span>
            {isOwner && (
              <button className="btn-secondary py-1 px-2.5 text-xs" onClick={handleDisconnectGmail} disabled={disconnecting}>
                <Unplug className="w-3 h-3" /> {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        ) : isOwner ? (
          <button className="btn-primary py-1.5 text-sm" onClick={() => authApi.connectGmail().catch(err => alert(apiError(err, 'Could not start the Gmail connection.')))}>
            <Mail className="w-3.5 h-3.5" /> Connect Gmail
          </button>
        ) : (
          <p className="text-xs text-slate-400">Not connected — ask an organization owner to connect Gmail.</p>
        )}
      </div>

      <div className="space-y-6">
        {/* Retired types keep their saved instructions, so so show any that were saved. */}
        {[...new Set([...Object.keys(CAMPAIGN_TYPES), ...Object.keys(savedAt)])].map(type => {
          const label = campaignTypeLabel(type);
          const meta = CAMPAIGN_TYPES[type];
          const isSaving = saving === type;
          const isSaved = justSaved === type;
          const lastSaved = savedAt[type];
          const hasContent = (styles[type] ?? '').trim().length > 0;

          return (
            <div key={type} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{label}</h2>
                  {hasContent && (
                    <span className="text-xs bg-brand-50 text-brand-600 border border-brand-100 px-2 py-0.5 rounded-full font-medium">
                      active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {lastSaved && (
                    <span className="text-xs text-slate-400">
                      saved {new Date(lastSaved).toLocaleDateString()}
                    </span>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => handleSave(type)}
                      disabled={isSaving}
                      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                        isSaved
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-brand-600 text-white hover:bg-brand-700'
                      }`}
                    >
                      {isSaved
                        ? <><Check className="w-3.5 h-3.5" /> Saved</>
                        : <><Save className="w-3.5 h-3.5" /> {isSaving ? 'Saving…' : 'Save'}</>
                      }
                    </button>
                  )}
                </div>
              </div>

              <textarea
                className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none font-mono leading-relaxed disabled:bg-slate-50 disabled:text-slate-500 ${meta?.border ?? 'border-slate-200'}`}
                rows={6}
                value={styles[type] ?? ''}
                onChange={e => setStyles(prev => ({ ...prev, [type]: e.target.value }))}
                aria-label={`House style for ${label}`}
                placeholder={meta?.style}
                disabled={!canEdit}
              />

              <p className="text-xs text-slate-400 mt-2">
                These instructions are added to the prompt for every <strong>{label}</strong> pitch. They apply from the next draft on; existing drafts stay as they are.
              </p>
            </div>
          );
        })}
      </div>

      {/* Tip */}
      <div className="mt-6 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-sm">
        <strong>Tip:</strong> The more specific you are, the better. Instead of "be professional", write
        "avoid emojis, don't use exclamation marks, and never start a sentence with 'Exciting'."
        Claude follows literal instructions much better than style adjectives.
      </div>
    </div>
  );
}
