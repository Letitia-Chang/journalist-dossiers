import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { journalists as api, publications as pubApi, scoringDimensions as dimApi } from '../api';
import type { Publication, ScoringDimension } from '../types';

const empty = {
  name: '', publicationId: '' as number | '', email: '', twitter: '', linkedin: '', bio: '',
  beats: '', photoUrl: '',
};

export default function JournalistForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({ ...empty });
  const [scores, setScores] = useState<Record<number, number>>({});
  const [dimensions, setDimensions] = useState<ScoringDimension[]>([]);
  const [pubList, setPubList] = useState<Publication[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    pubApi.list().then(r => setPubList(r.data.filter((p: Publication) => p.active)));
    dimApi.list().then(r => setDimensions(r.data));
  }, []);

  useEffect(() => {
    if (isEdit && id) {
      api.get(Number(id)).then(r => {
        const j = r.data;
        setForm({
          name: j.name,
          publicationId: j.publication_id ?? '',
          email: j.email ?? '',
          twitter: j.twitter ?? '',
          linkedin: j.linkedin ?? '',
          bio: j.bio ?? '',
          beats: (j.beats ?? []).join(', '),
          photoUrl: j.photo_url ?? '',
        });
        const scoreMap: Record<number, number> = {};
        for (const s of j.scores ?? []) scoreMap[s.dimensionId] = s.score;
        setScores(scoreMap);
      });
    }
  }, [id, isEdit]);

  const set = (k: keyof typeof empty, v: any) => setForm(f => ({ ...f, [k]: v }));

  const totalScore = dimensions.reduce((sum, d) => sum + (scores[d.id] ?? 0), 0);

  const handleSubmit = async () => {
    if (!form.name.trim()) return alert('Name is required');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        publicationId: form.publicationId === '' ? null : Number(form.publicationId),
        email: form.email,
        twitter: form.twitter,
        linkedin: form.linkedin,
        bio: form.bio,
        beats: form.beats.split(',').map(b => b.trim()).filter(Boolean),
        photoUrl: form.photoUrl,
        scores: dimensions.map(d => ({ dimensionId: d.id, score: scores[d.id] ?? 0 })),
      };
      if (isEdit && id) {
        await api.update(Number(id), payload);
        navigate(`/journalists/${id}`);
      } else {
        const res = await api.create(payload);
        navigate(`/journalists/${res.data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Link to={isEdit ? `/journalists/${id}` : '/journalists'} className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-5">
        <ChevronLeft className="w-3.5 h-3.5" /> {isEdit ? 'Back to journalist' : 'Back to journalists'}
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">{isEdit ? 'Edit Journalist' : 'Add Journalist'}</h1>
        <div className="text-sm text-slate-500">Score: <strong className="text-northstar-600">{totalScore}</strong></div>
      </div>

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
          </div>
          <div>
            <label className="form-label">Publication</label>
            <select className="form-select" value={form.publicationId} onChange={e => set('publicationId', e.target.value ? Number(e.target.value) : '')}>
              <option value="">— None —</option>
              {pubList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">Email</label>
            <input className="form-input" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Twitter/X</label>
            <input className="form-input" value={form.twitter} onChange={e => set('twitter', e.target.value)} placeholder="@handle" />
          </div>
          <div>
            <label className="form-label">LinkedIn</label>
            <input className="form-input" value={form.linkedin} onChange={e => set('linkedin', e.target.value)} placeholder="URL" />
          </div>
        </div>

        <div>
          <label className="form-label">Beats <span className="text-slate-400 font-normal">(comma-separated)</span></label>
          <input className="form-input" value={form.beats} onChange={e => set('beats', e.target.value)} placeholder="AI, climate tech, enterprise SaaS" />
        </div>

        <div>
          <label className="form-label">Bio / notes</label>
          <textarea className="form-input" rows={3} value={form.bio} onChange={e => set('bio', e.target.value)} placeholder="Background, beat focus, anything useful for pitching" />
        </div>

        <div>
          <label className="form-label">Photo URL</label>
          <input className="form-input" value={form.photoUrl} onChange={e => set('photoUrl', e.target.value)} placeholder="https://..." />
        </div>

        {/* ── Scoring ── */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <label className="form-label mb-0">Scores</label>
            <span className="text-xs font-mono text-slate-500">{totalScore} total</span>
          </div>
          {dimensions.length === 0 ? (
            <p className="text-xs text-slate-400">
              No scoring dimensions defined yet. <Link to="/admin/scoring-dimensions" className="text-northstar-600 hover:underline">Set them up first</Link>.
            </p>
          ) : (
            <div className="space-y-3">
              {dimensions.map(d => (
                <div key={d.id} className="flex items-center gap-3">
                  <div className="w-40 shrink-0">
                    <div className="text-sm font-medium text-slate-800">{d.name}</div>
                    <div className="text-xs text-slate-400">out of {d.weight}</div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={d.weight}
                    value={scores[d.id] ?? 0}
                    onChange={e => setScores(s => ({ ...s, [d.id]: Number(e.target.value) }))}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0}
                    max={d.weight}
                    value={scores[d.id] ?? 0}
                    onChange={e => setScores(s => ({ ...s, [d.id]: Math.min(d.weight, Math.max(0, Number(e.target.value))) }))}
                    className="form-input w-16 text-center"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Journalist'}
          </button>
          <Link to={isEdit ? `/journalists/${id}` : '/journalists'} className="btn-secondary">Cancel</Link>
        </div>
      </div>
    </div>
  );
}
