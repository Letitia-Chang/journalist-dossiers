import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { articles as api } from '../api';
import type { Article } from '../types';
import { apiError } from '../lib/errors';

const empty = { title: '', url: '', publishedAt: '' };

/** A journalist's recorded articles: what AI scoring reads the titles of, and the only links it may cite. */
export default function ArticlesCard({ journalistId }: { journalistId: number }) {
  const [list, setList] = useState<Article[] | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    api.byJournalist(journalistId).then(r => { if (current) setList(r.data); });
    return () => { current = false; };
  }, [journalistId]);

  const reload = () => api.byJournalist(journalistId).then(r => setList(r.data));
  const open = (a?: Article) => {
    setError('');
    setEditing(a ? a.id : 'new');
    setForm(a ? { title: a.title, url: a.url, publishedAt: a.published_at?.slice(0, 10) ?? '' } : empty);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { title: form.title, url: form.url, publishedAt: form.publishedAt };
      if (editing === 'new') await api.create({ journalistId, ...body });
      else if (editing !== null) await api.update(editing, body);
      setEditing(null);
      await reload();
    } catch (err) {
      setError(apiError(err, 'Could not save this article.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Article) => {
    if (!confirm(`Remove "${a.title}"?`)) return;
    await api.delete(a.id);
    await reload();
  };

  return (
    <div className="card p-5 mt-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-slate-900">Articles</h3>
        <button onClick={() => open()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 text-xs font-medium ring-1 ring-brand-200 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Article
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">AI scoring reads these titles and can only cite these links.</p>

      {editing !== null && (
        <form onSubmit={save} className="mb-4 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
          <div>
            <label className="form-label" htmlFor="article-title">Title</label>
            <input id="article-title" className="form-input" required maxLength={300} autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="form-label" htmlFor="article-url">Link</label>
              <input id="article-url" className="form-input" maxLength={2000} placeholder="https://..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="article-date">Date</label>
              <input id="article-date" type="date" className="form-input" value={form.publishedAt} onChange={e => setForm(f => ({ ...f, publishedAt: e.target.value }))} />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" className="btn-primary py-1.5 text-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {list === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-400">No articles recorded, so AI scores can only go on the beat, outlet and bio. Add a few for better scores.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {list.map(a => (
            <li key={a.id} className="py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {a.url
                  ? <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-slate-800 hover:text-brand-700 break-words">{a.title} <ExternalLink className="inline w-3 h-3 text-slate-300" /></a>
                  : <span className="text-sm text-slate-800 break-words">{a.title}</span>}
                {a.published_at && <div className="text-xs text-slate-400 mt-0.5">{new Date(a.published_at).toLocaleDateString(undefined, { timeZone: 'UTC' })}</div>}
              </div>
              <button onClick={() => open(a)} aria-label={`Edit ${a.title}`} className="p-1 rounded text-slate-300 hover:text-brand-600 shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => remove(a)} aria-label={`Remove ${a.title}`} className="p-1 rounded text-slate-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
