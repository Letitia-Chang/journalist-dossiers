import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Plus, Trash2, Calendar, Users, Archive, ArchiveRestore } from 'lucide-react';
import { campaigns as api } from '../api';
import type { Campaign } from '../types';
import { CAMPAIGN_TYPES, campaignTypeBadge, campaignTypeLabel } from '../lib/campaignTypes';

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600',
  active:    'bg-emerald-50 text-emerald-700',
  completed: 'bg-indigo-50 text-indigo-700',
  archived:  'bg-slate-100 text-slate-400',
};

export default function CampaignList() {
  const [list, setList] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'product_launch', brief: '' });
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = () => api.list().then(r => setList(r.data)).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.brief.trim()) return;
    setSaving(true);
    try {
      await api.create({ name: form.name, brief: form.brief, campaignType: form.type });
    } finally {
      setSaving(false);
    }
    setShowForm(false);
    setForm({ name: '', type: 'product_launch', brief: '' });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this campaign and all its drafts?')) return;
    await api.delete(id);
    load();
  };

  const handleArchive = async (id: number) => {
    await api.update(id, { status: 'archived' });
    load();
  };

  const handleUnarchive = async (id: number) => {
    await api.update(id, { status: 'completed' });
    load();
  };

  const active = list.filter(c => c.status !== 'archived');
  const archived = list.filter(c => c.status === 'archived');
  const displayed = showArchived ? archived : active;

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-brand-600" />
            Outreach Campaigns
          </h1>
          <p className="text-slate-500 mt-1">
            {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archived.length > 0 && (
            <button
              className="flex items-center gap-1.5 btn-secondary text-sm"
              onClick={() => setShowArchived(v => !v)}
            >
              {showArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              {showArchived ? 'Show active' : `Archived (${archived.length})`}
            </button>
          )}
          {!showArchived && (
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(v => !v)}>
              <Plus className="w-4 h-4" /> New Campaign
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card p-5 mb-6 border-brand-200 bg-brand-50">
          <h3 className="font-semibold text-slate-900 mb-4">New Campaign</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-1">
              <label className="form-label" htmlFor="campaign-list-campaign-name">Campaign name</label>
              <input id="campaign-list-campaign-name"
                className="form-input"
                placeholder="e.g. Version 2 launch"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-1">
              <label className="form-label" htmlFor="campaign-list-type">Type</label>
              <select id="campaign-list-type"
                className="form-select"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                {Object.entries(CAMPAIGN_TYPES).map(([v, t]) => (
                  <option key={v} value={v}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="form-label" htmlFor="campaign-list-brief">
                Brief
                <span className="text-slate-400 font-normal ml-1">
                  — what are you pitching? Claude uses this to write each email.
                </span>
              </label>
              <textarea id="campaign-list-brief"
                className="form-textarea"
                rows={4}
                placeholder={CAMPAIGN_TYPES[form.type]?.brief}
                value={form.brief}
                onChange={e => setForm(f => ({ ...f, brief: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={saving || !form.name.trim() || !form.brief.trim()}
            >
              {saving ? 'Creating…' : 'Create Campaign'}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Campaign list */}
      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : displayed.length === 0 ? (
        <div className="card p-12 text-center">
          <Megaphone className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          {showArchived ? (
            <div className="text-slate-500 font-medium">No archived campaigns</div>
          ) : (
            <>
              <div className="text-slate-500 font-medium">No campaigns yet</div>
              <div className="text-slate-400 text-sm mt-1">Create one to start drafting personalized outreach with Claude.</div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(c => (
            <Link
              key={c.id}
              to={`/campaigns/${c.id}`}
              className={`card p-5 flex items-center gap-5 hover:border-brand-300 hover:shadow-sm transition-all group ${c.status === 'archived' ? 'opacity-60' : ''}`}
            >
              {/* Type + name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${campaignTypeBadge(c.campaign_type)}`}>
                    {campaignTypeLabel(c.campaign_type)}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {c.status}
                  </span>
                </div>
                <div className="font-semibold text-slate-900 group-hover:text-brand-700 truncate">
                  {c.name}
                </div>
                {c.brief && (
                  <div className="text-sm text-slate-400 mt-0.5 truncate">{c.brief}</div>
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 shrink-0">
                <div className="text-center">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Users className="w-3.5 h-3.5" />
                    <span className="text-sm font-semibold text-slate-700">{c.journalist_count ?? 0}</span>
                  </div>
                  <div className="text-xs text-slate-400">journalists</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-emerald-600">{c.sent_count ?? 0}</div>
                  <div className="text-xs text-slate-400">sent</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <Calendar className="w-3 h-3" />
                  {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 lg:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {c.status !== 'archived' ? (
                  <button
                    className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    title="Archive campaign"
                    onClick={e => { e.preventDefault(); handleArchive(c.id); }}
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    title="Unarchive campaign"
                    onClick={e => { e.preventDefault(); handleUnarchive(c.id); }}
                  >
                    <ArchiveRestore className="w-4 h-4" />
                  </button>
                )}
                <button
                  className="p-1.5 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                  title="Delete campaign"
                  onClick={e => { e.preventDefault(); handleDelete(c.id); }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
