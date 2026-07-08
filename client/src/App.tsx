import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, FileDown, Settings, Rss, Megaphone, Wand2, Activity, Newspaper, BookOpen, LogOut, Target, UserCog } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
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
  const { user, org, isAuthenticated, logout } = useAuth();
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

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <div className="flex bg-slate-50" style={{ margin: 0, minHeight: '100vh', width: '100%' }}>
      <aside className="w-60 bg-slate-900 text-white flex flex-col shrink-0 fixed inset-y-0 left-0 z-10">
        <div className="p-5 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0">
              <div className="font-bold text-sm leading-tight truncate">{org?.name}</div>
              <div className="text-slate-400 text-xs mt-0.5">Media Dossiers</div>
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
          <Route path="/system" element={<SystemInfoPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
