import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, FileDown, Settings, Rss, Megaphone, Wand2, Activity, Newspaper, BookOpen, LogOut, Target, UserCog, Building2 } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useSetup } from './context/SetupContext';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import CompanySettingsPage from './pages/CompanySettingsPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import TeamPage from './pages/TeamPage';
import Dashboard from './pages/Dashboard';
import JournalistsList from './pages/JournalistsList';
import JournalistDetail from './pages/JournalistDetail';
import JournalistForm from './pages/JournalistForm';
import ExportPage from './pages/ExportPage';
import AdminPublications from './pages/AdminPublications';
import ScoringDimensions from './pages/ScoringDimensions';
import AdminJournalistSuggestions from './pages/AdminJournalistSuggestions';
import CampaignList from './pages/CampaignList';
import CampaignDetail from './pages/CampaignDetail';
import CampaignStyles from './pages/CampaignStyles';
import ActivityFeed from './pages/ActivityFeed';
import PublicationDetail from './pages/PublicationDetail';
import CoveragePage from './pages/CoveragePage';
import SystemInfoPage from './pages/SystemInfoPage';
import { suggestions as suggestApi, journalistSuggestions as jSuggestApi } from './api';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/journalists', label: 'Journalists', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/activity', label: 'Activity Feed', icon: Activity },
  { to: '/coverage', label: 'Press Coverage', icon: Newspaper },
];

const adminItems = [
  { to: '/settings/company', label: 'Company Profile', icon: Building2 },
  { to: '/admin/scoring-dimensions', label: 'Scoring Dimensions', icon: Target },
  { to: '/admin/publications', label: 'Publications', icon: Settings },
  { to: '/admin/journalist-suggestions', label: 'RSS Suggestions', icon: Rss },
  { to: '/campaigns/styles', label: 'House Style', icon: Wand2 },
  { to: '/export', label: 'Export Data', icon: FileDown },
  { to: '/team', label: 'Team', icon: UserCog },
  { to: '/system', label: 'System Info', icon: BookOpen },
];

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

export default function App() {
  const { user, isAuthenticated, logout } = useAuth();
  const { status, ready, attempts, gaveUp, retry } = useSetup();
  const [suggestionCount, setSuggestionCount] = useState(0);
  const [jSuggestionCount, setJSuggestionCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCounts = () => {
      suggestApi.count().then(r => setSuggestionCount(r.data.count)).catch(() => {});
      jSuggestApi.count().then(r => setJSuggestionCount(r.data.count)).catch(() => {});
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 60_000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  if (!ready) {
    // Attempts > 0 means the API didn't answer: a sleeping free-tier host takes up to a minute to wake.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
        <div className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-brand-600 animate-spin" />
        <p className="text-slate-700 font-medium">{attempts > 0 ? 'Waking up the server…' : 'Loading…'}</p>
        {attempts > 0 && (
          <p className="text-slate-400 text-sm max-w-sm">
            The demo runs on a free host that sleeps when idle, so the first visit can take up to a minute. Retrying automatically (attempt {attempts}).
          </p>
        )}
      </div>
    );
  }

  if (gaveUp) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
        <p className="text-slate-700 font-medium">Can't reach the server.</p>
        <p className="text-slate-400 text-sm max-w-sm">It didn't respond after several tries. Check that the API is running, then try again.</p>
        <button className="btn-secondary" onClick={retry}>Try again</button>
      </div>
    );
  }

  // First run: no account exists yet → walk through setup.
  if (!isAuthenticated && status.needsAdmin) {
    return (
      <Routes>
        <Route path="*" element={<SetupPage />} />
      </Routes>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  // Signed in but the company profile hasn't been filled in yet.
  if (status.needsProfile) {
    return <SetupPage />;
  }

  return (
    <div className="flex bg-slate-50" style={{ margin: 0, minHeight: '100vh', width: '100%' }}>
      <aside className="w-60 bg-slate-900 text-white flex flex-col shrink-0 fixed inset-y-0 left-0 z-10">
        <div className="p-5 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0">
              {status.brand.logoUrl && <img src={status.brand.logoUrl} alt="" className="h-7 mb-2" />}
              <div className="font-bold text-sm leading-tight truncate">{status.brand.appName}</div>
              <div className="text-slate-400 text-xs mt-0.5 truncate">{status.brand.companyName}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/journalists/new' ? false : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-2 pt-3 border-t border-slate-700">
          <div className="text-slate-400 text-xs px-3 pb-1 uppercase tracking-wider">Admin</div>
          {adminItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
              {label === 'Publications' && suggestionCount > 0 && (
                <span className="ml-auto bg-amber-400 text-amber-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {suggestionCount}
                </span>
              )}
              {label === 'RSS Suggestions' && jSuggestionCount > 0 && (
                <span className="ml-auto bg-emerald-400 text-emerald-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {jSuggestionCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
        {/* Current user */}
        <div className="p-3 border-t border-slate-700">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user ? initials(user.name) : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{user?.name}</div>
              <div className="text-xs text-slate-400 truncate capitalize">{user?.role}</div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-3 flex items-center justify-between">
          <span className="text-slate-500 text-xs">MVP v1.0 · PostgreSQL</span>
          <button
            onClick={logout}
            title="Log out"
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-60 overflow-auto min-h-screen">
        {status.demo && (
          <div className="sticky top-0 z-20 bg-amber-100 border-b border-amber-200 text-amber-900 text-xs text-center py-1.5 px-4">
            <strong>Demo data — fictional.</strong> Every company, journalist and outlet here is made up. Live AI is rate-limited; Gmail and web discovery are disabled.
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/journalists" element={<JournalistsList />} />
          <Route path="/journalists/new" element={<JournalistForm />} />
          <Route path="/journalists/:id" element={<JournalistDetail />} />
          <Route path="/journalists/:id/edit" element={<JournalistForm />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/campaigns" element={<CampaignList />} />
          <Route path="/campaigns/styles" element={<CampaignStyles />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/activity" element={<ActivityFeed />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="/admin/publications/:id" element={<PublicationDetail />} />
          <Route path="/admin/publications" element={<AdminPublications />} />
          <Route path="/admin/scoring-dimensions" element={<ScoringDimensions />} />
          <Route path="/admin/journalist-suggestions" element={<AdminJournalistSuggestions />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/settings/company" element={<CompanySettingsPage />} />
          <Route path="/system" element={<SystemInfoPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
