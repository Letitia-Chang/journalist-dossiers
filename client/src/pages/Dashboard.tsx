import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, TrendingUp, Megaphone, Sparkles, Send, Newspaper, Activity } from 'lucide-react';
import { dashboard as dashApi } from '../api';
import type { DashboardData } from '../types';
import StatusBadge from '../components/StatusBadge';

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="card p-5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${color}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => { dashApi.get().then((r: any) => setData(r.data)); }, []);

  if (!data) return <div className="p-8 text-slate-400">Loading...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard icon={Users} label="Journalists" value={data.totalJournalists} color="bg-northstar-50 text-northstar-600" />
        <StatCard icon={TrendingUp} label="Avg. Score" value={data.avgScore} color="bg-violet-50 text-violet-600" />
        <StatCard icon={Megaphone} label="Active Campaigns" value={data.activeCampaigns} color="bg-blue-50 text-blue-600" />
        <StatCard icon={Sparkles} label="Drafts Ready" value={data.draftsReady} color="bg-amber-50 text-amber-600" />
        <StatCard icon={Send} label="Sent This Week" value={data.sentThisWeek} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent outreach */}
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-northstar-500" /> Recent Outreach
          </h2>
          {data.recentOutreach.length === 0 ? (
            <p className="text-slate-400 text-sm">No outreach logged yet.</p>
          ) : (
            <div className="space-y-1">
              {data.recentOutreach.map(o => (
                <Link key={o.id} to={`/journalists/${o.journalist_id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{o.journalist_name}</div>
                    <div className="text-xs text-slate-500 capitalize">{o.type.replace('_', ' ')}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          )}
          <Link to="/activity" className="text-xs text-northstar-600 hover:underline mt-3 inline-block">View full activity feed →</Link>
        </div>

        {/* Warm contacts */}
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-northstar-500" /> Warm Contacts
          </h2>
          {data.warmContacts.length === 0 ? (
            <p className="text-slate-400 text-sm">No responses or coverage yet.</p>
          ) : (
            <div className="space-y-1">
              {data.warmContacts.map(j => (
                <Link key={j.id} to={`/journalists/${j.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div className="font-medium text-sm text-slate-900">{j.name}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-500">{j.total_score}</span>
                    <StatusBadge status={j.outreach_status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent campaigns */}
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-northstar-500" /> Recent Campaigns
          </h2>
          {data.recentCampaigns.length === 0 ? (
            <p className="text-slate-400 text-sm">No campaigns yet. <Link to="/campaigns" className="text-northstar-600 hover:underline">Create one</Link>.</p>
          ) : (
            <div className="space-y-1">
              {data.recentCampaigns.map(c => (
                <Link key={c.id} to={`/campaigns/${c.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.journalist_count} journalists · {c.sent_count} sent</div>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{c.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent coverage */}
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-northstar-500" /> Recent Coverage
          </h2>
          {data.recentCoverage.length === 0 ? (
            <p className="text-slate-400 text-sm">No coverage logged yet. <Link to="/coverage" className="text-northstar-600 hover:underline">Add some</Link>.</p>
          ) : (
            <div className="space-y-1">
              {data.recentCoverage.map(c => (
                <a key={c.id} href={c.url || undefined} target={c.url ? '_blank' : undefined} rel="noreferrer"
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div className="font-medium text-sm text-slate-900 truncate">{c.title}</div>
                  {c.published_at && <span className="text-xs text-slate-400 shrink-0 ml-2">{c.published_at.split('T')[0]}</span>}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
