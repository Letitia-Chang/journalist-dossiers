import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, FileDown, Settings, Rss, Megaphone, Wand2, Activity, Newspaper, BookOpen, ChevronDown, AlertTriangle } from 'lucide-react';
import { useUser } from './UserContext';
import { users as usersApi } from './api';
import type { User } from './types';
import Dashboard from './pages/Dashboard';
import JournalistsList from './pages/JournalistsList';
import JournalistDetail from './pages/JournalistDetail';
import JournalistForm from './pages/JournalistForm';
import ExportPage from './pages/ExportPage';
import AdminPublications from './pages/AdminPublications';
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
  { to: '/admin/publications', label: 'Publications', icon: Settings },
  { to: '/admin/journalist-suggestions', label: 'RSS Suggestions', icon: Rss },
  { to: '/campaigns/styles', label: 'House Style', icon: Wand2 },
  { to: '/export', label: 'Export Data', icon: FileDown },
  { to: '/system', label: 'System Info', icon: BookOpen },
];

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

export default function App() {
  const [suggestionCount, setSuggestionCount] = useState(0);
  const [jSuggestionCount, setJSuggestionCount] = useState(0);
  const [userList, setUserList] = useState<User[]>([]);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const { currentUser, setCurrentUser } = useUser();

  useEffect(() => {
    const fetchCounts = () => {
      suggestApi.count().then(r => setSuggestionCount(r.data.count)).catch(() => {});
      jSuggestApi.count().then(r => setJSuggestionCount(r.data.count)).catch(() => {});
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    usersApi.list().then(r => setUserList(r.data)).catch(() => {});
  }, []);

  return (
    <div className="flex bg-slate-50" style={{ margin: 0, minHeight: '100vh', width: '100%' }}>
      <aside className="w-60 bg-northstar-900 text-white flex flex-col shrink-0 fixed inset-y-0 left-0 z-10">
        <div className="p-5 border-b border-northstar-700">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="font-bold text-sm leading-tight">North Star AI Labs</div>
              <div className="text-northstar-300 text-xs mt-0.5">Media Dossiers</div>
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
                    ? 'bg-northstar-600 text-white'
                    : 'text-northstar-200 hover:bg-northstar-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-2 pt-3 border-t border-northstar-700">
          <div className="text-northstar-400 text-xs px-3 pb-1 uppercase tracking-wider">Admin</div>
          {adminItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-northstar-600 text-white'
                    : 'text-northstar-200 hover:bg-northstar-800 hover:text-white'
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
        {/* User selector */}
        <div className="p-3 border-t border-northstar-700">
          {currentUser ? (
            <button
              onClick={() => setShowUserPicker(true)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-northstar-800 transition-colors text-left group"
            >
              <div className="w-7 h-7 rounded-full bg-northstar-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {initials(currentUser.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">{currentUser.name}</div>
                <div className="text-xs text-northstar-400 truncate">{currentUser.title}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-northstar-400 shrink-0 group-hover:text-white transition-colors" />
            </button>
          ) : (
            <button
              onClick={() => setShowUserPicker(true)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-300 font-medium">Who are you? Select name</span>
            </button>
          )}
        </div>

        <div className="px-4 pb-3 text-northstar-500 text-xs">
          MVP v1.0 · PostgreSQL
        </div>
      </aside>

      {/* User picker modal */}
      {showUserPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80">
            <h2 className="font-bold text-slate-900 text-base mb-1">Who are you?</h2>
            <p className="text-xs text-slate-500 mb-4">
              Select your name so drafts and outreach logs are attributed correctly.
            </p>
            <div className="space-y-2">
              {userList.map(u => (
                <button
                  key={u.id}
                  onClick={() => { setCurrentUser(u); setShowUserPicker(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                    currentUser?.id === u.id
                      ? 'border-northstar-400 bg-northstar-50'
                      : 'border-slate-200 hover:border-northstar-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-northstar-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {initials(u.name)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.title}</div>
                  </div>
                  {currentUser?.id === u.id && (
                    <span className="ml-auto text-xs font-medium text-northstar-600">current</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowUserPicker(false)}
              className="mt-4 w-full text-xs text-slate-400 hover:text-slate-600 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 ml-60 overflow-auto min-h-screen">
        {!currentUser && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>No user selected — outreach logs and drafts won't be attributed to anyone.</span>
            <button
              onClick={() => setShowUserPicker(true)}
              className="ml-2 font-medium underline hover:text-amber-900"
            >
              Select your name →
            </button>
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
          <Route path="/admin/journalist-suggestions" element={<AdminJournalistSuggestions />} />
          <Route path="/system" element={<SystemInfoPage />} />
        </Routes>
      </main>
    </div>
  );
}
