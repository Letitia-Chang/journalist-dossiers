import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSetup } from '../context/SetupContext';
import { company as companyApi } from '../api';
import CompanyProfileForm, { cleanProfile } from '../components/CompanyProfileForm';
import type { CompanyProfile } from '../types';
import { apiError, apiFields } from '../lib/errors';

const inputClass =
  'w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent';

/** Step 1 (first run only): create the owner account. */
function AccountStep() {
  const { signup } = useAuth();
  const { status } = useSetup();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup({ name, email, password });
    } catch (err) {
      setError(apiError(err, 'Could not create the account. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-white">Welcome to {status.brand.appName}</h1>
          <p className="text-slate-400 text-sm mt-1">Step 1 of 2 — create the owner account.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="setup-your-name">Your name</label>
              <input id="setup-your-name" className={inputClass} required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="setup-email">Email</label>
              <input id="setup-email" className={inputClass} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="setup-password">Password</label>
              <input id="setup-password" className={inputClass} type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            {error && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Creating…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Step 2: describe the company. Scoring, pitches and suggestions all read from it. */
function ProfileStep() {
  const { refresh } = useSetup();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    companyApi.get().then(r => setProfile(r.data.exists ? r.data.profile : { ...r.data.profile, name: '' }));
  }, []);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      await companyApi.save(cleanProfile(profile));
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setErrors(apiFields(err));
      setMessage(apiError(err, 'Could not save the profile.'));
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Step 2 of 2</p>
        <h1 className="text-2xl font-bold text-slate-900">Tell us about your company</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          Only the company name is required. The more you add, the better the fit scores and pitch drafts. You can edit all of this later under Company Profile.
        </p>

        <CompanyProfileForm value={profile} onChange={setProfile} errors={errors} />

        {message && <p className="mt-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{message}</p>}
        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={handleSave} disabled={saving || !profile.name.trim()}>
            {saving ? 'Saving…' : 'Save and open the app'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <ProfileStep /> : <AccountStep />;
}
