import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Edit2, Trash2, ChevronLeft, AtSign, Link2, Copy, Check, Sparkles, Plus, MessageSquare } from 'lucide-react';
import { journalists as jApi, publications as pubApi, scoringDimensions as dimApi, outreach as oApi } from '../api';
import type { Journalist, Publication, ScoringDimension, OutreachLog } from '../types';
import { OUTREACH_TYPES, OUTREACH_STATUSES } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function JournalistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [journalist, setJournalist] = useState<Journalist | null>(null);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [dimensions, setDimensions] = useState<ScoringDimension[]>([]);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoringError, setScoringError] = useState('');
  const [aiReasoning, setAiReasoning] = useState('');
  const [outreachLogs, setOutreachLogs] = useState<OutreachLog[]>([]);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logForm, setLogForm] = useState({ type: OUTREACH_TYPES[0] as string, status: OUTREACH_STATUSES[0] as string, notes: '' });
  const [logging, setLogging] = useState(false);

  const loadJournalist = () => {
    if (!id) return;
    jApi.get(Number(id)).then(r => {
      setJournalist(r.data);
      if (r.data.publication_id) pubApi.get(r.data.publication_id).then(pr => setPublication(pr.data));
    });
  };

  const loadOutreach = () => {
    if (!id) return;
    oApi.byJournalist(Number(id)).then(r => setOutreachLogs(r.data));
  };

  useEffect(() => {
    loadJournalist();
    loadOutreach();
    dimApi.list().then(r => setDimensions(r.data));
  }, [id]);

  const handleLogOutreach = async () => {
    setLogging(true);
    try {
      await oApi.create({ journalistId: Number(id), ...logForm });
      setShowLogForm(false);
      setLogForm({ type: OUTREACH_TYPES[0], status: OUTREACH_STATUSES[0], notes: '' });
      loadOutreach();
      loadJournalist();
    } finally {
      setLogging(false);
    }
  };

  const handleDeleteLog = async (logId: number) => {
    if (!confirm('Delete this log entry?')) return;
    await oApi.delete(logId);
    loadOutreach();
    loadJournalist();
  };

  const handleScoreWithAI = async () => {
    setScoring(true);
    setScoringError('');
    setAiReasoning('');
    try {
      const res = await jApi.scoreWithAI(Number(id));
      setAiReasoning(res.data.reasoning);
      loadJournalist();
    } catch (err: any) {
      setScoringError(err.response?.data?.error ?? 'AI scoring failed.');
    } finally {
      setScoring(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this journalist? This cannot be undone.')) return;
    await jApi.delete(Number(id));
    navigate('/journalists');
  };

  const handleCopyEmail = () => {
    if (!journalist?.email) return;
    navigator.clipboard.writeText(journalist.email).then(() => {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    });
  };

  if (!journalist) return <div className="p-8 text-slate-400">Loading...</div>;

  const scoreByDimension = new Map(journalist.scores.map(s => [s.dimensionId, s.score]));

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/journalists" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> Back to journalists
      </Link>

      {/* Header */}
      <div className="card p-6 mb-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            {journalist.photo_url ? (
              <img
                src={journalist.photo_url}
                alt={journalist.name}
                className="w-16 h-16 rounded-full object-cover border border-slate-200 shadow-sm"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-northstar-100 flex items-center justify-center text-northstar-600 text-xl font-bold border border-slate-200">
                {journalist.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{journalist.name}</h1>
              <StatusBadge status={journalist.outreach_status} />
              <span className="ml-auto text-lg font-bold text-northstar-600 shrink-0">{journalist.total_score}</span>
            </div>
            {publication && (
              <div className="text-slate-600 mt-0.5 text-sm">{publication.name}</div>
            )}
            {journalist.beats.length > 0 && (
              <div className="text-sm text-slate-500 mt-0.5">Beats: {journalist.beats.join(', ')}</div>
            )}
          </div>

          <div className="flex gap-2 shrink-0">
            <Link to={`/journalists/${id}/edit`} className="btn-secondary"><Edit2 className="w-4 h-4" /> Edit</Link>
            <button onClick={handleDelete} className="btn-danger"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {journalist.email && (
            <button onClick={handleCopyEmail} className="btn-secondary text-xs" title="Click to copy email address">
              {copiedEmail ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copiedEmail ? 'Copied!' : journalist.email}
            </button>
          )}
          {journalist.twitter && (
            <a href={journalist.twitter} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <AtSign className="w-3 h-3" /> Twitter/X
            </a>
          )}
          {journalist.linkedin && (
            <a href={journalist.linkedin} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <Link2 className="w-3 h-3" /> LinkedIn
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">Score Breakdown</h3>
            {dimensions.length > 0 && (
              <button
                onClick={handleScoreWithAI}
                disabled={scoring}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs font-medium ring-1 ring-violet-200 disabled:opacity-50 transition-colors"
              >
                <Sparkles className={`w-3.5 h-3.5 ${scoring ? 'animate-pulse' : ''}`} />
                {scoring ? 'Scoring…' : 'Score with AI'}
              </button>
            )}
          </div>
          {scoringError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{scoringError}</p>
          )}
          {aiReasoning && (
            <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 mb-3">{aiReasoning}</p>
          )}
          {dimensions.length === 0 ? (
            <p className="text-sm text-slate-400">
              No scoring dimensions defined yet. <Link to="/admin/scoring-dimensions" className="text-northstar-600 hover:underline">Set them up</Link>.
            </p>
          ) : (
            <div className="space-y-3">
              {dimensions.map(d => {
                const value = scoreByDimension.get(d.id) ?? 0;
                return (
                  <div key={d.id}>
                    <div className="flex justify-between text-sm mb-0.5">
                      <span className="text-slate-700 font-medium">{d.name}</span>
                      <span className="font-semibold text-slate-900">{value} / {d.weight}</span>
                    </div>
                    {d.description && <p className="text-xs text-slate-400 mb-1">{d.description}</p>}
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className="bg-northstar-500 h-2 rounded-full transition-all"
                        style={{ width: d.weight > 0 ? `${(value / d.weight) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-700">Total Score</span>
            <span className="text-xl font-bold text-northstar-600">{journalist.total_score}</span>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-2">Bio / Notes</h3>
          {journalist.bio ? (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{journalist.bio}</p>
          ) : (
            <p className="text-sm text-slate-400">No bio added yet. <Link to={`/journalists/${id}/edit`} className="text-northstar-600 hover:underline">Add one</Link>.</p>
          )}
        </div>
      </div>

      {/* Outreach */}
      <div className="card p-5 mt-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900">Outreach History</h3>
          <button
            onClick={() => setShowLogForm(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-northstar-50 text-northstar-700 hover:bg-northstar-100 text-xs font-medium ring-1 ring-northstar-200 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Log Outreach
          </button>
        </div>

        {showLogForm && (
          <div className="mb-4 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Type</label>
                <select className="form-select" value={logForm.type} onChange={e => setLogForm(f => ({ ...f, type: e.target.value }))}>
                  {OUTREACH_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Resulting status</label>
                <select className="form-select" value={logForm.status} onChange={e => setLogForm(f => ({ ...f, status: e.target.value }))}>
                  {OUTREACH_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={2} value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} placeholder="What happened, what's next..." />
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-primary py-1.5 text-sm" onClick={handleLogOutreach} disabled={logging}>
                {logging ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-secondary py-1.5 text-sm" onClick={() => setShowLogForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {outreachLogs.length === 0 ? (
          <div className="text-center text-slate-400 py-6">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 text-slate-300" />
            No outreach logged yet.
          </div>
        ) : (
          <div className="space-y-2">
            {outreachLogs.map(o => (
              <div key={o.id} className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-600 capitalize">{o.type.replace('_', ' ')}</span>
                    <StatusBadge status={o.status} />
                    <span className="text-xs text-slate-400">{new Date(o.logged_at).toLocaleDateString()}</span>
                    {o.logged_by_name && <span className="text-xs text-slate-400">· {o.logged_by_name}</span>}
                  </div>
                  {o.notes && <p className="text-sm text-slate-600 mt-1">{o.notes}</p>}
                </div>
                <button onClick={() => handleDeleteLog(o.id)} className="p-1 rounded text-slate-300 hover:text-red-500 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
