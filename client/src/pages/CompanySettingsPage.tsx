import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { company as companyApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { useSetup } from '../context/SetupContext';
import CompanyProfileForm, { cleanProfile } from '../components/CompanyProfileForm';
import type { CompanyProfile } from '../types';
import { apiError, apiFields } from '../lib/errors';

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const { refresh } = useSetup();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { companyApi.get().then(r => setProfile(r.data.profile)); }, []);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await companyApi.save(cleanProfile(profile));
      setProfile(res.data.profile);
      await refresh();
      setMessage({ kind: 'ok', text: 'Saved. New scores and drafts will use this profile.' });
    } catch (err) {
      setErrors(apiFields(err));
      setMessage({ kind: 'error', text: apiError(err, 'Could not save the profile.') });
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <div className="p-8 text-slate-400">Loading…</div>;

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-brand-600" /> Company Profile
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          The single source of truth for fit scoring, pitch drafts and publication suggestions.
          {!canEdit && ' Only owners and admins can edit it.'}
        </p>
      </div>

      <CompanyProfileForm value={profile} onChange={setProfile} errors={errors} readOnly={!canEdit} />

      {message && (
        <p className={`mt-4 text-sm rounded-lg px-3 py-2 border ${message.kind === 'ok'
          ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200'}`}>
          {message.text}
        </p>
      )}
      {canEdit && (
        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={handleSave} disabled={saving || !profile.name.trim()}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      )}
    </div>
  );
}
