import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Filter, X } from 'lucide-react';
import { outreach as oApi } from '../api';
import { OUTREACH_STATUSES } from '../types';
import type { OutreachLog } from '../types';
import StatusBadge from '../components/StatusBadge';

interface ActivityLog extends OutreachLog {
  journalist_name: string;
  publication_name: string | null;
}

function groupByDate(logs: ActivityLog[]): { label: string; logs: ActivityLog[] }[] {
  const groups: Record<string, ActivityLog[]> = {};
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];

  for (const log of logs) {
    const d = log.logged_at?.split('T')[0] || 'Unknown';
    let label: string;
    if (d === today) label = 'Today';
    else if (d === yesterday) label = 'Yesterday';
    else if (d >= weekAgo) label = 'This week';
    else {
      const [year, month] = d.split('-');
      label = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(log);
  }

  return Object.entries(groups).map(([label, logs]) => ({ label, logs }));
}

export default function ActivityFeed() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [pubFilter, setPubFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    oApi.activity().then(r => setLogs(r.data)).finally(() => setLoading(false));
  }, []);

  const publications = Array.from(new Set(logs.map(l => l.publication_name).filter((p): p is string => !!p))).sort();

  const filtered = logs.filter(l => {
    if (pubFilter && l.publication_name !== pubFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    const d = l.logged_at?.split('T')[0];
    if (fromFilter && d < fromFilter) return false;
    if (toFilter && d > toFilter) return false;
    return true;
  });

  const hasFilters = pubFilter || statusFilter || fromFilter || toFilter;
  const clearFilters = () => { setPubFilter(''); setStatusFilter(''); setFromFilter(''); setToFilter(''); };

  const grouped = groupByDate(filtered);

  const pitchedCount = logs.filter(l => l.status === 'Pitched').length;
  const respondedCount = logs.filter(l => l.status === 'Responded').length;
  const coveredCount = logs.filter(l => l.status === 'Covered').length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-northstar-600" /> Activity Feed
        </h1>
        <p className="text-slate-500 mt-1 text-sm">All outreach across every journalist, newest first.</p>
      </div>

      {logs.length > 0 && (
        <div className="flex items-center gap-4 mb-5 text-sm">
          <span className="text-slate-500"><strong className="text-slate-800">{logs.length}</strong> interactions</span>
          {pitchedCount > 0 && <span className="text-slate-500"><strong className="text-blue-700">{pitchedCount}</strong> pitched</span>}
          {respondedCount > 0 && <span className="text-slate-500"><strong className="text-emerald-700">{respondedCount}</strong> responses</span>}
          {coveredCount > 0 && <span className="text-slate-500"><strong className="text-indigo-700">{coveredCount}</strong> covered</span>}
        </div>
      )}

      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-slate-400 shrink-0" />

        <select className="form-select text-sm flex-1 min-w-36" value={pubFilter} onChange={e => setPubFilter(e.target.value)}>
          <option value="">All publications</option>
          {publications.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <select className="form-select text-sm flex-1 min-w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {OUTREACH_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <input type="date" className="form-input text-sm" value={fromFilter} onChange={e => setFromFilter(e.target.value)} title="From date" />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" className="form-input text-sm" value={toFilter} onChange={e => setToFilter(e.target.value)} title="To date" />
        </div>

        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <Activity className="w-8 h-8 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">
            {hasFilters ? 'No activity matches your filters.' : 'No outreach logged yet.'}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ label, logs: group }) => (
            <div key={label}>
              <div className="flex items-center gap-3 mb-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
                <div className="flex-1 h-px bg-slate-100" />
                <div className="text-xs text-slate-400">{group.length}</div>
              </div>

              <div className="space-y-2">
                {group.map(log => (
                  <Link
                    key={log.id}
                    to={`/journalists/${log.journalist_id}`}
                    className="card p-4 flex items-start gap-4 hover:border-northstar-300 hover:shadow-sm transition-all group"
                  >
                    <div className="w-20 shrink-0 text-xs text-slate-400 pt-0.5 tabular-nums">
                      {log.logged_at?.split('T')[0] || '—'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 group-hover:text-northstar-700 text-sm">
                          {log.journalist_name}
                        </span>
                        {log.publication_name && <span className="text-xs text-slate-400">{log.publication_name}</span>}
                        <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded capitalize">
                          {log.type.replace('_', ' ')}
                        </span>
                      </div>
                      {log.notes && (
                        <div className="text-sm text-slate-500 mt-0.5 truncate">{log.notes}</div>
                      )}
                      {log.logged_by_name && (
                        <div className="text-xs text-slate-400 mt-1">logged by {log.logged_by_name}</div>
                      )}
                    </div>

                    <div className="shrink-0">
                      <StatusBadge status={log.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
