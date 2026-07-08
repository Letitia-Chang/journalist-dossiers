import { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical, Sparkles } from 'lucide-react';
import { scoringDimensions as api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { ScoringDimension } from '../types';

const empty = { name: '', description: '', weight: 0 };

export default function ScoringDimensions() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const [dimensions, setDimensions] = useState<ScoringDimension[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = () => api.list().then(r => setDimensions(r.data));

  useEffect(() => { load(); }, []);

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);

  const set = (k: keyof typeof empty, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.create({ ...form, displayOrder: dimensions.length });
      setForm({ ...empty });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (d: ScoringDimension) => {
    setEditingId(d.id);
    setForm({ name: d.name, description: d.description, weight: d.weight });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...empty });
  };

  const handleUpdate = async () => {
    if (editingId === null) return;
    setSaving(true);
    try {
      await api.update(editingId, form);
      setEditingId(null);
      setForm({ ...empty });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this scoring dimension? Existing journalist scores for it will be removed.')) return;
    await api.delete(id);
    await load();
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-northstar-500" /> Scoring Dimensions
        </h1>
        <p className="text-slate-500 mt-1 text-sm max-w-xl">
          Define the axes Claude uses to score journalists — e.g. "Climate Relevance" or
          "Enterprise Fit". Each journalist's total score is the sum of their scores across
          these dimensions.
        </p>
      </div>

      <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm border ${
        totalWeight === 100
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        Total weight: <strong>{totalWeight}</strong> / 100
        {totalWeight !== 100 && ' — weights should sum to 100 for scores to read as a percentage.'}
      </div>

      <div className="card divide-y divide-slate-100 mb-6">
        {dimensions.length === 0 && (
          <p className="p-6 text-center text-slate-400 text-sm">
            {canEdit ? 'No scoring dimensions yet. Add your first one below.' : 'No scoring dimensions yet.'}
          </p>
        )}
        {dimensions.map(d => (
          <div key={d.id} className="p-4">
            {editingId === d.id ? (
              <DimensionForm form={form} set={set} saving={saving} onSave={handleUpdate} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-start gap-3">
                <GripVertical className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 text-sm">{d.name}</span>
                    <span className="text-xs bg-northstar-50 text-northstar-700 border border-northstar-100 px-1.5 py-0.5 rounded-full font-medium">
                      {d.weight} pts
                    </span>
                  </div>
                  {d.description && <p className="text-xs text-slate-500 mt-1">{d.description}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(d)} className="btn-secondary py-1 px-2.5 text-xs">Edit</button>
                    <button
                      onClick={() => handleDelete(d.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {editingId === null && canEdit && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add dimension
          </h2>
          <DimensionForm form={form} set={set} saving={saving} onSave={handleAdd} onCancel={() => setForm({ ...empty })} />
        </div>
      )}
    </div>
  );
}

function DimensionForm({ form, set, saving, onSave, onCancel }: {
  form: typeof empty;
  set: (k: keyof typeof empty, v: any) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 items-end">
      <div className="col-span-3">
        <label className="form-label">Name *</label>
        <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Climate Relevance" autoFocus />
      </div>
      <div className="col-span-6">
        <label className="form-label">Description</label>
        <input className="form-input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Used in the AI scoring prompt" />
      </div>
      <div className="col-span-3">
        <label className="form-label">Weight (points)</label>
        <input
          type="number"
          min={0}
          max={100}
          className="form-input"
          value={form.weight}
          onChange={e => set('weight', Number(e.target.value))}
        />
      </div>
      <div className="col-span-12 flex items-center gap-2 pt-1">
        <button className="btn-primary py-1.5 text-sm" onClick={onSave} disabled={saving || !form.name.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary py-1.5 text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
