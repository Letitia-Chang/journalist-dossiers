import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, SortDesc, Star, Circle, Copy, Check, Trash2, LayoutList, Columns } from 'lucide-react';

import { journalists as api, publications as pubApi, outreach as oApi } from '../api';
import type { Journalist, Publication } from '../types';
import { OUTREACH_STATUSES } from '../types';
import StatusBadge from '../components/StatusBadge';

const PIPELINE_COLS = ['Not Started', ...OUTREACH_STATUSES];

function PipelineCard({ journalist, onDragStart }: { journalist: Journalist; onDragStart: (e: React.DragEvent, j: Journalist) => void }) {
  return (
    <Link
      to={`/journalists/${journalist.id}`}
      draggable
      onDragStart={e => onDragStart(e, journalist)}
      className="block bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:shadow-md hover:border-northstar-300 transition-all cursor-grab active:cursor-grabbing group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-900 text-sm truncate group-hover:text-northstar-700">{journalist.name}</p>
        {journalist.is_favorite && <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />}
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <div className="flex-1 bg-slate-100 rounded-full h-1">
          <div className="bg-northstar-400 h-1 rounded-full" style={{ width: `${Math.min(100, journalist.total_score)}%` }} />
        </div>
        <span className="text-xs font-mono text-slate-500">{journalist.total_score}</span>
      </div>
    </Link>
  );
}

function PipelineColumn({ status, journalists, onDragStart, onDrop, onDragOver }: {
  status: string; journalists: Journalist[];
  onDragStart: (e: React.DragEvent, j: Journalist) => void;
  onDrop: (e: React.DragEvent, status: string) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`flex flex-col min-w-[220px] w-[220px] rounded-xl border-2 bg-slate-50 border-slate-200 ${over ? 'ring-2 ring-northstar-400 ring-offset-1' : ''} transition-all`}
      onDragOver={e => { onDragOver(e); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { setOver(false); onDrop(e, status); }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200">
        <span className="text-xs font-semibold text-slate-700 flex-1 truncate">{status}</span>
        <span className="text-xs font-mono text-slate-400">{journalists.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        {journalists.map(j => <PipelineCard key={j.id} journalist={j} onDragStart={onDragStart} />)}
        {journalists.length === 0 && <p className="text-xs text-slate-400 text-center py-6 italic">Drop here</p>}
      </div>
    </div>
  );
}

export default function JournalistsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState<Journalist[]>([]);
  const [pubsById, setPubsById] = useState<Record<number, Publication>>({});
  const [loading, setLoading] = useState(true);
  const [copiedEmail, setCopiedEmail] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'pipeline'>('list');
  const dragJournalist = useRef<Journalist | null>(null);

  const search = searchParams.get('search') || '';
  const favOnly = searchParams.get('favOnly') === '1';
  const sortBy = searchParams.get('sortBy') || 'total_score';

  const copyEmail = (e: React.MouseEvent, j: Journalist) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(j.email).then(() => {
      setCopiedEmail(j.id);
      setTimeout(() => setCopiedEmail(null), 2000);
    });
  };

  const handleToggleFavorite = async (e: React.MouseEvent, j: Journalist) => {
    e.preventDefault();
    e.stopPropagation();
    const updated = await api.update(j.id, { isFavorite: !j.is_favorite });
    setList(prev => prev.map(x => x.id === j.id ? { ...x, is_favorite: updated.data.is_favorite } : x));
  };

  const handleDelete = async (e: React.MouseEvent, j: Journalist) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete ${j.name}?`)) return;
    await api.delete(j.id);
    setList(prev => prev.filter(x => x.id !== j.id));
  };

  const update = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    value ? p.set(key, value) : p.delete(key);
    setSearchParams(p);
  };

  const reload = () => api.list().then(r => setList(r.data));

  const handleDragStart = (e: React.DragEvent, j: Journalist) => {
    dragJournalist.current = j;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const j = dragJournalist.current;
    dragJournalist.current = null;
    if (!j || j.outreach_status === newStatus || newStatus === 'Not Started') return;
    // Optimistic update
    setList(prev => prev.map(x => x.id === j.id ? { ...x, outreach_status: newStatus } : x));
    try {
      await oApi.create({ journalistId: j.id, type: 'note', status: newStatus, notes: `Moved to ${newStatus}` });
    } catch {
      setList(prev => prev.map(x => x.id === j.id ? { ...x, outreach_status: j.outreach_status } : x));
    }
  };

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    pubApi.list().then(r => {
      const map: Record<number, Publication> = {};
      for (const p of r.data as Publication[]) map[p.id] = p;
      setPubsById(map);
    });
  }, []);

  const filtered = list
    .filter(j => !favOnly || j.is_favorite)
    .filter(j => {
      if (!search) return true;
      const q = search.toLowerCase();
      const pubName = j.publication_id ? pubsById[j.publication_id]?.name ?? '' : '';
      return j.name.toLowerCase().includes(q)
        || pubName.toLowerCase().includes(q)
        || j.beats.some(b => b.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'created_at') return b.created_at.localeCompare(a.created_at);
      return b.total_score - a.total_score;
    });

  const pipelineSource = favOnly ? list.filter(j => j.is_favorite) : list;
  const grouped = Object.fromEntries(PIPELINE_COLS.map(s => [s, pipelineSource.filter(j => j.outreach_status === s)]));

  return (
    <div className={`p-8 ${view === 'pipeline' ? 'max-w-none' : 'max-w-6xl'} mx-auto`}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Journalists</h1>
          <p className="text-slate-500 mt-1">
            {filtered.length} journalist{filtered.length !== 1 ? 's' : ''}
            {favOnly && <span className="ml-2 text-amber-600 font-medium">★ Favourites</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'list' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutList className="w-4 h-4" /> List
            </button>
            <button
              onClick={() => setView('pipeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'pipeline' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Columns className="w-4 h-4" /> Pipeline
            </button>
          </div>
          <Link to="/journalists/new" className="btn-primary">+ Add Journalist</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="form-input pl-9"
            placeholder="Search name, publication, beat..."
            value={search}
            onChange={e => update('search', e.target.value)}
          />
        </div>
        <button
          onClick={() => update('favOnly', favOnly ? '' : '1')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
            favOnly
              ? 'bg-amber-50 border-amber-300 text-amber-700'
              : 'bg-white border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${favOnly ? 'fill-amber-500 text-amber-500' : ''}`} />
          Favourites
        </button>
        {view === 'list' && (
          <select className="form-select w-auto" value={sortBy} onChange={e => update('sortBy', e.target.value)}>
            <option value="total_score">Sort: Score</option>
            <option value="name">Sort: Name</option>
            <option value="created_at">Sort: Added</option>
          </select>
        )}
      </div>

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              {favOnly
                ? <span>No favourites yet — click the ★ on any journalist to add them.</span>
                : <span>No journalists found. <Link to="/journalists/new" className="text-northstar-600 hover:underline">Add one.</Link></span>
              }
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="w-8 px-3 py-3"></th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Publication</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Beats</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 flex items-center gap-1">
                    <SortDesc className="w-3 h-3" /> Score
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(j => (
                  <tr key={j.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-3 py-3 w-8">
                      <button
                        onClick={e => handleToggleFavorite(e, j)}
                        className="text-slate-300 hover:text-amber-400 transition-colors"
                        title={j.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
                      >
                        <Star className={`w-4 h-4 ${j.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{j.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {j.publication_id ? pubsById[j.publication_id]?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{j.beats.join(', ')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5">
                          <div className="bg-northstar-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, j.total_score)}%` }} />
                        </div>
                        <span className="font-mono text-xs font-medium text-slate-700">{j.total_score}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={j.outreach_status} /></td>
                    <td className="px-4 py-3">
                      {j.email ? (
                        <button
                          onClick={e => copyEmail(e, j)}
                          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 group/copy"
                          title="Click to copy email"
                        >
                          {copiedEmail === j.id
                            ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            : <Copy className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                          <span className="truncate max-w-[160px]">
                            {copiedEmail === j.id ? 'Copied!' : j.email}
                          </span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                          <Circle className="w-3.5 h-3.5 shrink-0" />
                          No email
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={e => handleDelete(e, j)}
                          className="p-1 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <Link to={`/journalists/${j.id}`} className="text-northstar-600 hover:text-northstar-800 flex items-center">
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── PIPELINE VIEW ── */}
      {view === 'pipeline' && (
        <div>
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading...</div>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-3">Drag cards between columns to log a status update</p>
              <div className="flex gap-3 overflow-x-auto pb-4">
                {PIPELINE_COLS.map(status => (
                  <PipelineColumn
                    key={status}
                    status={status}
                    journalists={grouped[status] ?? []}
                    onDragStart={handleDragStart}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
