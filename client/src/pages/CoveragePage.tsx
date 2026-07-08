import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Plus, Trash2, Pencil, ExternalLink } from 'lucide-react';
import { coverage as covApi, journalists as jApi, campaigns as campApi } from '../api';
import type { CoverageItem, Journalist, Campaign } from '../types';

const empty = { title: '', url: '', notes: '', publishedAt: '', journalistId: '' as number | '', campaignId: '' as number | '' };

export default function CoveragePage() {
  const [items, setItems] = useState<CoverageItem[]>([]);
  const [journalists, setJournalists] = useState<Journalist[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = () => covApi.list().then((r: any) => setItems(r.data)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    jApi.list().then(r => setJournalists(r.data));
    campApi.list().then(r => setCampaigns(r.data));
  }, []);

  const set = (k: keyof typeof empty, v: any) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (item: CoverageItem) => {
    setEditingId(item.id);
    setForm({
      title: item.title, url: item.url, notes: item.notes,
      publishedAt: item.published_at?.split('T')[0] ?? '',
      journalistId: item.journalist_id ?? '', campaignId: item.campaign_id ?? '',
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditingId(null); setForm({ ...empty }); };

  const handleSave = async () => {
    if (!form.title.trim()) return alert('Title is required');
    setSaving(true);
    try {
      const payload = {
        title: form.title, url: form.url, notes: form.notes,
        publishedAt: form.publishedAt || null,
        journalistId: form.journalistId === '' ? null : Number(form.journalistId),
        campaignId: form.campaignId === '' ? null : Number(form.campaignId),
      };
      if (editingId) await covApi.update(editingId, payload);
      else await covApi.create(payload);
      cancelForm();
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this coverage item?')) return;
    await covApi.delete(id);
    load();
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-northstar-600" /> Press Coverage
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Articles written about your company.</p>
        </div>
        <button className="btn-primary" onClick={() => { cancelForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Add Coverage
        </button>
      </div>

      {showForm && (
        <div className="card p-5 mb-6 border-northstar-200 bg-northstar-50">
          <h3 className="font-semibold text-slate-900 mb-4">{editingId ? 'Edit Coverage' : 'New Coverage'}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Article headline" autoFocus />
            </div>
            <div>
              <label className="form-label">URL</label>
              <input className="form-input" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className="form-label">Published date</label>
              <input type="date" className="form-input" value={form.publishedAt} onChange={e => set('publishedAt', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Journalist</label>
              <select className="form-select" value={form.journalistId} onChange={e => set('journalistId', e.target.value ? Number(e.target.value) : '')}>
                <option value="">— None —</option>
                {journalists.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Campaign</label>
              <select className="form-select" value={form.campaignId} onChange={e => set('campaignId', e.target.value ? Number(e.target.value) : '')}>
                <option value="">— None —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={cancelForm}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <Newspaper className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">No coverage logged yet</div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="card p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-northstar-700 flex items-center gap-1">
                      {item.title} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="font-semibold text-slate-900">{item.title}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                  {item.published_at && <span>{item.published_at.split('T')[0]}</span>}
                  {item.journalist_id && (
                    <Link to={`/journalists/${item.journalist_id}`} className="text-northstar-600 hover:underline">
                      {item.journalist_name}
                    </Link>
                  )}
                  {item.campaign_id && (
                    <Link to={`/campaigns/${item.campaign_id}`} className="text-slate-400 hover:underline">
                      via {item.campaign_name}
                    </Link>
                  )}
                </div>
                {item.notes && <p className="text-sm text-slate-600 mt-2">{item.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => startEdit(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
