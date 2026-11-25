import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetup } from '../context/SetupContext';
import { useAuth } from '../context/AuthContext';
import { apiError } from '../lib/errors';

export default function LoginPage() {
  const { login, demoLogin } = useAuth();
  const { status } = useSetup();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(apiError(err, 'Could not sign in. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {status.brand.logoUrl && <img src={status.brand.logoUrl} alt="" className="h-10 mx-auto mb-3" />}
          <h1 className="text-xl font-bold text-white">{status.brand.appName}</h1>
          <p className="text-slate-400 text-sm mt-1">{status.brand.companyName ? (status.demo ? `Demo company: ${status.brand.companyName}` : `Sign in to ${status.brand.companyName}`) : 'Welcome back.'}</p>
        </div>

        {status.demo && (
          <div className="bg-white rounded-2xl shadow-2xl p-8 mb-4 text-center">
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full inline-block px-2.5 py-0.5 mb-3">Demo data — fictional</p>
            <p className="text-sm text-slate-600 mb-4">
              Explore a made-up company, journalists and outlets in your own private copy. Change anything you like: no one else sees it, and it is deleted after a day. Live AI runs are rate-limited.
            </p>
            <button
              onClick={async () => { setLoading(true); try { await demoLogin(); navigate('/dashboard'); } catch (err) { setError(apiError(err, 'The demo is still waking up. Try again in a moment.')); } finally { setLoading(false); } }}
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Opening…' : 'Enter the demo'}
            </button>
            {error && <p className="text-red-600 text-xs mt-3">{error}</p>}
          </div>
        )}

        {!status.demo && <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="login-email">Email</label>
              <input id="login-email"
                type="email"
                autoFocus
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="jane@acme.com"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="login-password">Password</label>
              <input id="login-password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </div>}
      </div>
    </div>
  );
}
