import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getInvite } from '../api';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<{ email: string; role: string; orgName: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    getInvite(token)
      .then(r => setInvite(r.data))
      .catch(err => setLoadError(err.response?.data?.error ?? 'This invite is invalid or has expired'));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    setLoading(true);
    try {
      await acceptInvite({ token, name, password });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to accept invite. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-white">Join the team</h1>
          {invite && (
            <p className="text-slate-400 text-sm mt-1">
              You've been invited to join <strong className="text-slate-200">{invite.orgName}</strong> as {invite.role}.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {loadError ? (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>
          ) : !invite ? (
            <p className="text-slate-400 text-sm text-center py-4">Checking invite…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Email</label>
                <input
                  type="email"
                  disabled
                  value={invite.email}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Your name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
              >
                {loading ? 'Joining…' : 'Join workspace'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
