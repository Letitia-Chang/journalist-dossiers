import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Users, ExternalLink, Mail } from 'lucide-react';
import { publications as pubApi } from '../api';
import type { Publication } from '../types';
import StatusBadge from '../components/StatusBadge';
import TierBadge from '../components/TierBadge';

interface PubJournalist {
  id: number;
  name: string;
  email: string;
  beats: string[];
  total_score: number;
  is_favorite: boolean;
  outreach_status: string;
}

const STATUS_ORDER: Record<string, number> = {
  'Covered': 0, 'Responded': 1, 'Pitched': 2,
  'Ready to Pitch': 3, 'No Response': 4, 'Declined': 5, 'Not Started': 6,
};

export default function PublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [pub, setPub] = useState<Publication | null>(null);
  const [journalists, setJournalists] = useState<PubJournalist[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'score' | 'status'>('score');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      pubApi.get(Number(id)),
      pubApi.getJournalists(Number(id)),
    ]).then(([p, j]) => {
      setPub(p.data);
      setJournalists(j.data);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!pub) return <div className="p-8 text-slate-400">Publication not found.</div>;

  const sorted = [...journalists].sort((a, b) => {
    if (sort === 'score') return b.total_score - a.total_score;
    return (STATUS_ORDER[a.outreach_status] ?? 9) - (STATUS_ORDER[b.outreach_status] ?? 9);
  });

  const responded = journalists.filter(j => ['Responded', 'Covered'].includes(j.outreach_status)).length;
  const covered = journalists.filter(j => j.outreach_status === 'Covered').length;
  const withEmail = journalists.filter(j => j.email).length;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link to="/admin/publications" className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-5">
        <ArrowLeft className="w-3.5 h-3.5" /> All publications
      </Link>

      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TierBadge tier={pub.tier === 'A' ? 1 : pub.tier === 'B' ? 2 : 3} />
              <span className="text-xs text-slate-400">{pub.tier === 'A' ? 'Tier A — Major' : pub.tier === 'B' ? 'Tier B — Business' : 'Tier C — Regional/Niche'}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{pub.name}</h1>
            {pub.focus && <p className="text-slate-500 text-sm mt-1">{pub.focus}</p>}
            {pub.url && (
              <a href={pub.url} target="_blank" rel="noreferrer"
                className="text-sm text-northstar-600 hover:underline flex items-center gap-1 mt-2">
                <ExternalLink className="w-3.5 h-3.5" /> {pub.url}
              </a>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-northstar-600">{journalists.length}</div>
            <div className="text-xs text-slate-400">journalists tracked</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-slate-100">
          {[
            { label: 'Responded', value: responded, color: 'text-emerald-700' },
            { label: 'Covered us', value: covered, color: 'text-indigo-700' },
            { label: 'Have email', value: withEmail, color: 'text-slate-700' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {journalists.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-8 h-8 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">No journalists tracked for {pub.name} yet.</div>
          <Link to="/journalists/new" className="text-sm text-northstar-600 hover:underline mt-2 inline-block">
            Add one →
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span className="text-slate-400">Sort by</span>
            {(['score', 'status'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  sort === s ? 'bg-northstar-100 text-northstar-700 font-medium' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {s === 'score' ? 'Score' : 'Relationship'}
              </button>
            ))}
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Journalist</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map(j => (
                  <tr key={j.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3">
                      <Link to={`/journalists/${j.id}`} className="group-hover:text-northstar-700">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          {j.is_favorite ? <span className="text-amber-400 text-xs">★</span> : null}
                          {j.name}
                        </div>
                        {j.beats.length > 0 && <div className="text-xs text-slate-400 mt-0.5">{j.beats.join(', ')}</div>}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.outreach_status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {j.email && (
                          <a href={`mailto:${j.email}`} onClick={e => e.stopPropagation()}
                            className="text-slate-300 hover:text-northstar-500 transition-colors" title={j.email}>
                            <Mail className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <span className={`font-bold tabular-nums ${
                          j.total_score >= 80 ? 'text-northstar-600' :
                          j.total_score >= 60 ? 'text-emerald-600' :
                          j.total_score >= 40 ? 'text-amber-600' : 'text-slate-400'
                        }`}>
                          {j.total_score}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
