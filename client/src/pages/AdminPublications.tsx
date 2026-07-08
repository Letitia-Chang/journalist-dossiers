import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, ExternalLink, Check, X,
  Sparkles, RefreshCw, History, ChevronUp, ChevronDown,
  Globe, ChevronRight, Rss, AlertCircle, HelpCircle,
  BookOpen, Search, TriangleAlert, Layers, Zap, Users, Upload,
} from 'lucide-react';
import { publications as pubApi, suggestions as suggestApi, journalistSuggestions as jSuggestApi, healthCheck as healthApi } from '../api';
import { useAuth } from '../context/AuthContext';
import type { Publication, PublicationSuggestion, PublicationFeed } from '../types';

const TIER_CONFIG = {
  A: {
    label: 'Major & National',
    pill: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    description: 'Large-audience outlets where your space is a primary editorial beat.',
  },
  B: {
    label: 'Business / Mid-Tier',
    pill: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    description: 'Business publications with a dedicated desk relevant to you.',
  },
  C: {
    label: 'Regional & Niche',
    pill: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    description: 'Regional outlets, newsletters, and emerging vertical publications.',
  },
} as const;

type Tier = keyof typeof TIER_CONFIG;

const TierPill = ({ tier, showLabel = false }: { tier: Tier; showLabel?: boolean }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TIER_CONFIG[tier].pill}`}>
    {tier}{showLabel && <span className="font-normal opacity-70">· {TIER_CONFIG[tier].label}</span>}
  </span>
);

const RSS_STATUS = {
  active:   { label: 'Active',   cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',  icon: Rss },
  inactive: { label: 'Failed',   cls: 'bg-red-50 text-red-600 ring-red-200',              icon: AlertCircle },
  none:     { label: 'No RSS',   cls: 'bg-slate-100 text-slate-400 ring-slate-200',       icon: X },
  unknown:  { label: 'Unknown',  cls: 'bg-amber-50 text-amber-600 ring-amber-200',        icon: HelpCircle },
};

function parseRssNote(note: string): { analysis: string; action: string } | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note);
    if (parsed.analysis || parsed.action) return parsed;
  } catch { /* plain text note */ }
  return null;
}

function RssStatusBadge({ status, note }: { status: string; note?: string }) {
  const s = RSS_STATUS[status as keyof typeof RSS_STATUS] ?? RSS_STATUS.unknown;
  const Icon = s.icon;
  const structured = note ? parseRssNote(note) : null;
  const hasNote = !!(structured || note);

  const badge = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 whitespace-nowrap ${s.cls} ${hasNote ? 'cursor-help' : ''}`}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
  if (!hasNote) return badge;
  return (
    <span className="relative group/rss inline-flex">
      {badge}
      <span className="absolute bottom-full left-0 z-50 hidden group-hover/rss:flex w-80 flex-col pb-2">
        <span className="rounded-xl bg-slate-900 shadow-xl overflow-hidden">
          {structured ? (
            <>
              <div className="px-3 pt-3 pb-2 border-b border-slate-700/60">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Analysis</p>
                <p className="text-xs text-slate-100 leading-relaxed select-text">{structured.analysis}</p>
              </div>
              <div className="px-3 pt-2 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-1">Next Step</p>
                <p className="text-xs text-slate-100 leading-relaxed select-text">{structured.action}</p>
              </div>
            </>
          ) : (
            <p className="px-3 py-2 text-xs text-slate-100 leading-relaxed select-text">{note}</p>
          )}
        </span>
        <span className="ml-3 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-900" />
      </span>
    </span>
  );
}

const empty = { name: '', url: '', tier: 'B' as Tier, focus: '', notes: '', rssUrl: '' };

export default function AdminPublications() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const [pubs, setPubs]             = useState<Publication[]>([]);
  const [suggestions, setSuggestions] = useState<PublicationSuggestion[]>([]);
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [form, setForm]             = useState({ ...empty });
  const [saving, setSaving]         = useState(false);
  const [runningJob, setRunningJob] = useState(false);
  const [sortCol, setSortCol]       = useState<'name' | 'tier' | 'active'>('tier');
  const [sortAsc, setSortAsc]       = useState(true);
  const [filterTier, setFilterTier] = useState<string>('');
  const [showTierGuide, setShowTierGuide] = useState(false);
  const [showHistory, setShowHistory]     = useState(false);
  const [history, setHistory]       = useState<PublicationSuggestion[]>([]);
  const [acceptingId, setAcceptingId]   = useState<number | null>(null);
  const [rejectingId, setRejectingId]   = useState<number | null>(null);
  const [staffScanningId, setStaffScanningId]   = useState<number | null>(null);
  const [discoveringFeedsId, setDiscoveringFeedsId] = useState<number | null>(null);
  const [feedsDiscoveryResult, setFeedsDiscoveryResult] = useState<{ pubName: string } | null>(null);
  const [expandedFeedsPubId, setExpandedFeedsPubId] = useState<number | null>(null);
  const [pubFeeds, setPubFeeds] = useState<Record<number, PublicationFeed[]>>({});
  const [manualFeedUrl, setManualFeedUrl] = useState('');
  const [manualFeedLabel, setManualFeedLabel] = useState('');
  const [addingFeed, setAddingFeed] = useState(false);
  const [staffScanResult, setStaffScanResult] = useState<{ pubName: string; added: number; pageScanned: string | null; error?: string } | null>(null);
  const [jSuggestionCount, setJSuggestionCount] = useState(0);
  const [healthWarnings, setHealthWarnings] = useState<{ unreachable: any[]; inactiveFeeds: any[] }>({ unreachable: [], inactiveFeeds: [] });
  const [syncingFeeds, setSyncingFeeds] = useState(false);
  const [syncFeedsMsg, setSyncFeedsMsg] = useState('');

  const [showDiscover, setShowDiscover]     = useState(false);
  const [discoverQuery, setDiscoverQuery]   = useState('');
  const [discovering, setDiscovering]       = useState(false);
  const [discoverResults, setDiscoverResults] = useState<any[]>([]);
  const [discoverError, setDiscoverError]   = useState('');
  const [addingDiscover, setAddingDiscover] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [importingOpml, setImportingOpml] = useState(false);
  const [opmlResult, setOpmlResult] = useState<{ added?: number; feedsAdded?: number; skipped?: number; error?: string } | null>(null);

  const loadPubs        = () => pubApi.list().then(r => setPubs(r.data));
  const loadSuggestions = () => suggestApi.list().then(r => setSuggestions(r.data));
  const loadJCount      = () => jSuggestApi.count().then(r => setJSuggestionCount(r.data.count)).catch(() => {});
  const loadHealth      = () => healthApi.summary().then(r => setHealthWarnings(r.data)).catch(() => {});

  useEffect(() => { loadPubs(); loadSuggestions(); loadJCount(); loadHealth(); }, []);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (p: Publication) => {
    setEditingId(p.id);
    setForm({ name: p.name, url: p.url, tier: p.tier, focus: p.focus, notes: p.notes || '', rssUrl: p.rss_url || '' });
    setShowAdd(false);
  };
  const cancelEdit = () => { setEditingId(null); setForm({ ...empty }); };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Name is required');
    setSaving(true);
    try {
      if (editingId) {
        await pubApi.update(editingId, form);
        setEditingId(null);
      } else {
        await pubApi.create(form);
        setShowAdd(false);
      }
      setForm({ ...empty });
      loadPubs();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this publication? Journalists linked to it will keep their existing record.')) return;
    await pubApi.delete(id);
    loadPubs();
  };

  const toggleActive = async (p: Publication) => {
    await pubApi.update(p.id, { active: !p.active });
    loadPubs();
  };

  const handleAccept = async (s: PublicationSuggestion) => {
    setAcceptingId(s.id);
    await suggestApi.accept(s.id);
    await Promise.all([loadPubs(), loadSuggestions()]);
    setAcceptingId(null);
  };

  const handleReject = async (s: PublicationSuggestion) => {
    setRejectingId(s.id);
    await suggestApi.reject(s.id);
    await loadSuggestions();
    setRejectingId(null);
  };

  const handleStaffScan = async (p: Publication) => {
    if (!p.url) return alert('No homepage URL set for this publication.');
    setStaffScanningId(p.id);
    setStaffScanResult(null);
    try {
      const res = await jSuggestApi.staffScan(p.id);
      setStaffScanResult({ pubName: p.name, added: res.data.added, pageScanned: res.data.pageScanned, error: res.data.error });
      await loadJCount();
    } finally {
      setStaffScanningId(null);
    }
  };

  const handleDiscoverFeeds = async (p: Publication) => {
    setDiscoveringFeedsId(p.id);
    setFeedsDiscoveryResult(null);
    await pubApi.discoverFeeds(p.id);
    setTimeout(async () => {
      const [feedRes] = await Promise.all([pubApi.getFeeds(p.id), loadPubs()]);
      setPubFeeds(prev => ({ ...prev, [p.id]: feedRes.data }));
      setFeedsDiscoveryResult({ pubName: p.name });
      setExpandedFeedsPubId(p.id);
      setDiscoveringFeedsId(null);
    }, 20000);
  };

  const loadFeeds = async (pubId: number) => {
    const res = await pubApi.getFeeds(pubId);
    setPubFeeds(prev => ({ ...prev, [pubId]: res.data }));
  };

  const handleDeleteFeed = async (pubId: number, feedId: number) => {
    await pubApi.deleteFeed(pubId, feedId);
    await Promise.all([loadFeeds(pubId), loadPubs()]);
  };

  const handleAddFeedManually = async (pubId: number) => {
    if (!manualFeedUrl.trim()) return;
    setAddingFeed(true);
    try {
      await pubApi.addFeed(pubId, manualFeedUrl.trim(), manualFeedLabel.trim() || 'Category');
      setManualFeedUrl('');
      setManualFeedLabel('');
      await Promise.all([loadFeeds(pubId), loadPubs()]);
    } finally {
      setAddingFeed(false);
    }
  };

  const handleDiscover = async () => {
    if (!discoverQuery.trim()) return;
    setDiscovering(true);
    setDiscoverError('');
    setDiscoverResults([]);
    try {
      const res = await pubApi.discover(discoverQuery.trim());
      setDiscoverResults(res.data);
      if (res.data.length === 0) setDiscoverError('No new results found. Try a different search term.');
    } catch (err: any) {
      setDiscoverError(err.response?.data?.error || 'Discovery failed. Check server logs.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleAddDiscovered = async (item: any) => {
    setAddingDiscover(item.url);
    try {
      await pubApi.create({
        name: item.name,
        url: item.url,
        tier: item.suggestedTier,
        focus: item.focus || item.description || '',
        rssUrl: item.feedUrl,
      });
      setDiscoverResults(prev => prev.filter(r => r.url !== item.url));
      loadPubs();
    } finally {
      setAddingDiscover(null);
    }
  };

  const handleImportOpml = async (file: File) => {
    setImportingOpml(true);
    setOpmlResult(null);
    try {
      const text = await file.text();
      const res = await pubApi.importOpml(text);
      setOpmlResult({ ...res.data });
      loadPubs();
    } catch (err: any) {
      setOpmlResult({ error: err.response?.data?.error || 'Import failed. Check that this is a valid OPML file.' });
    } finally {
      setImportingOpml(false);
    }
  };

  const toggleFeedsPanel = async (pubId: number) => {
    if (expandedFeedsPubId === pubId) {
      setExpandedFeedsPubId(null);
      return;
    }
    if (!pubFeeds[pubId]) await loadFeeds(pubId);
    setExpandedFeedsPubId(pubId);
  };

  const handleRunNow = async () => {
    setRunningJob(true);
    await suggestApi.runNow();
    setTimeout(async () => { await loadSuggestions(); setRunningJob(false); }, 8000);
  };

  const handleSyncFeeds = async () => {
    setSyncingFeeds(true);
    setSyncFeedsMsg('');
    try {
      const res = await pubApi.syncFeeds();
      setSyncFeedsMsg(res.data.message);
      setTimeout(async () => { await loadPubs(); await loadHealth(); setSyncingFeeds(false); }, 60_000);
    } catch {
      setSyncFeedsMsg('Feed sync failed. Check server logs.');
      setSyncingFeeds(false);
    }
  };

  const loadHistory = async () => {
    const r = await suggestApi.history();
    setHistory(r.data);
    setShowHistory(true);
  };

  const sortedPubs = [...pubs]
    .filter(p => !filterTier || p.tier === filterTier)
    .sort((a, b) => {
      let va: any = a[sortCol], vb: any = b[sortCol];
      if (sortCol === 'tier') { va = ['A', 'B', 'C'].indexOf(a.tier); vb = ['A', 'B', 'C'].indexOf(b.tier); }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  };

  const SortBtn = ({ col, children }: { col: typeof sortCol; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(col)}
      className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:text-slate-800 transition-colors">
      {children}
      {sortCol === col
        ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
        : <ChevronDown className="w-3 h-3 opacity-25" />}
    </button>
  );

  const counts = { A: pubs.filter(p => p.tier === 'A').length, B: pubs.filter(p => p.tier === 'B').length, C: pubs.filter(p => p.tier === 'C').length };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8">

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Publications</h1>
            <p className="text-slate-400 text-sm mt-0.5">Track which outlets to source journalists from.</p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <button onClick={handleRunNow} disabled={runningJob}
                title="AI Suggest — Claude picks new publications relevant to your company and adds them to suggestions"
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all">
                <Sparkles className={`w-4 h-4 ${runningJob ? 'animate-pulse text-indigo-500' : ''}`} />
              </button>
              <button onClick={handleSyncFeeds} disabled={syncingFeeds}
                title="Sync Feeds — discovers RSS feeds for all publications, then verifies every feed URL. May take several minutes."
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-all">
                <RefreshCw className={`w-4 h-4 ${syncingFeeds ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => { setShowDiscover(v => !v); setDiscoverResults([]); setDiscoverError(''); }}
                title="Search for publications by keyword across Feedly, Substack, and Medium"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                  showDiscover ? 'bg-northstar-50 border-northstar-300 text-northstar-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                Discover
              </button>
              <label
                title="Import publications and feeds from an OPML file exported from Feedly, Inoreader, etc."
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:border-slate-300 hover:text-slate-900 transition-all cursor-pointer">
                {importingOpml ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Import OPML
                <input
                  type="file"
                  accept=".opml,.xml,text/xml,text/x-opml"
                  className="hidden"
                  disabled={importingOpml}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleImportOpml(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                onClick={() => { setShowAdd(v => !v); setEditingId(null); setForm({ ...empty }); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          )}
        </div>

        {opmlResult && (
          <div className={`mb-6 px-4 py-3 rounded-lg text-sm border flex items-center justify-between ${
            opmlResult.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <span>
              {opmlResult.error
                ? opmlResult.error
                : `Imported ${opmlResult.added} publication${opmlResult.added === 1 ? '' : 's'} and ${opmlResult.feedsAdded} feed${opmlResult.feedsAdded === 1 ? '' : 's'}${opmlResult.skipped ? ` — ${opmlResult.skipped} already tracked` : ''}.`}
            </span>
            <button onClick={() => setOpmlResult(null)} className="text-current opacity-60 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {showDiscover && (
          <div className="mb-6 card p-5 border-northstar-200 bg-northstar-50/30">
            <h3 className="font-semibold text-slate-900 mb-1">Discover blogs & newsletters</h3>
            <p className="text-slate-500 text-sm mb-4">
              Search across Feedly, Substack and Medium for publications covering your topics. Already-tracked publications are filtered out automatically.
            </p>
            <div className="flex gap-2 mb-4">
              <input
                className="form-input flex-1"
                placeholder="e.g. AI startup machine learning"
                value={discoverQuery}
                onChange={e => setDiscoverQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDiscover()}
              />
              <button
                onClick={handleDiscover}
                disabled={discovering || !discoverQuery.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-northstar-600 text-white text-sm font-medium hover:bg-northstar-700 disabled:opacity-50 transition-colors"
              >
                {discovering ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Searching…</> : <><Search className="w-3.5 h-3.5" /> Search</>}
              </button>
            </div>

            {discoverError && <p className="text-sm text-rose-600 mb-3">{discoverError}</p>}

            {discoverResults.length > 0 && (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {discoverResults.map(item => (
                  <div key={item.url} className="bg-white rounded-lg border border-slate-200 px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-medium text-slate-900 text-sm truncate">{item.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          item.source === 'feedly' ? 'bg-emerald-50 text-emerald-700' :
                          item.source === 'substack' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'
                        }`}>{item.source}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          item.suggestedTier === 'A' ? 'bg-indigo-50 text-indigo-700' :
                          item.suggestedTier === 'B' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'
                        }`}>Tier {item.suggestedTier}</span>
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-northstar-600 truncate block">{item.url}</a>
                      {item.description && <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.description}</p>}
                    </div>
                    <button
                      onClick={() => handleAddDiscovered(item)}
                      disabled={addingDiscover === item.url}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-northstar-50 text-northstar-700 border border-northstar-200 text-xs font-medium hover:bg-northstar-100 disabled:opacity-50 transition-colors"
                    >
                      {addingDiscover === item.url ? 'Adding…' : '+ Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="mb-6 bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowSuggestions(v => !v)}
              className="w-full flex items-center gap-3 px-5 py-3.5 border-b border-amber-100 bg-amber-50/60 hover:bg-amber-50 transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold text-slate-800">
                  {suggestions.length} new suggestion{suggestions.length !== 1 ? 's' : ''} from AI Discovery
                </span>
                <span className="text-xs text-slate-400 ml-2">Review and accept or reject each one</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${showSuggestions ? '' : '-rotate-90'}`} />
            </button>
            {showSuggestions && <div className="divide-y divide-slate-50">
              {suggestions.map(s => {
                const tier = (s.tier || 'B') as Tier;
                return (
                  <div key={s.id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-slate-900">{s.name}</span>
                        <TierPill tier={tier} showLabel />
                      </div>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors mb-1.5">
                          <Globe className="w-3 h-3" />
                          {s.url.replace(/^https?:\/\//, '')}
                          <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                        </a>
                      )}
                      {s.focus && <p className="text-xs text-slate-500 mb-1">{s.focus}</p>}
                      {s.rationale && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 inline-block border border-amber-100">
                          {s.rationale}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        <button onClick={() => handleAccept(s)} disabled={acceptingId === s.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium border border-emerald-200 transition-colors">
                          <Check className="w-3.5 h-3.5" />
                          {acceptingId === s.id ? 'Adding…' : 'Accept'}
                        </button>
                        <button onClick={() => handleReject(s)} disabled={rejectingId === s.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-xs font-medium border border-slate-200 transition-colors">
                          <X className="w-3.5 h-3.5" />
                          {rejectingId === s.id ? 'Rejecting…' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}
          </div>
        )}

        {syncFeedsMsg && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 shrink-0 ${syncingFeeds ? 'animate-spin' : ''}`} />
            {syncFeedsMsg}
            <button onClick={() => setSyncFeedsMsg('')} className="ml-auto text-emerald-500 hover:text-emerald-700"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {(healthWarnings.unreachable.length > 0 || healthWarnings.inactiveFeeds.length > 0) && (
          <div className="mb-6 bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-amber-100 bg-amber-50/60">
              <TriangleAlert className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-slate-800">Data health warnings</span>
              <button onClick={() => setHealthWarnings({ unreachable: [], inactiveFeeds: [] })}
                className="ml-auto text-slate-300 hover:text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3 flex flex-wrap gap-3 text-xs">
              {healthWarnings.unreachable.map(p => (
                <span key={p.id} className="bg-red-50 text-red-700 ring-1 ring-red-200 px-2.5 py-1 rounded-full">
                  ⚠️ {p.name} unreachable
                </span>
              ))}
              {healthWarnings.inactiveFeeds.map(p => (
                <span key={p.id} className="bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2.5 py-1 rounded-full">
                  📡 {p.name} RSS inactive
                </span>
              ))}
            </div>
          </div>
        )}

        {staffScanResult && (
          <div className={`mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
            staffScanResult.error ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <BookOpen className="w-4 h-4 shrink-0" />
            {staffScanResult.error
              ? <span>Staff scan of <strong>{staffScanResult.pubName}</strong>: {staffScanResult.error}</span>
              : <span>Staff scan of <strong>{staffScanResult.pubName}</strong>: found {staffScanResult.added} new journalist{staffScanResult.added !== 1 ? 's' : ''} from {staffScanResult.pageScanned}</span>
            }
            <button onClick={() => setStaffScanResult(null)} className="ml-auto opacity-50 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {feedsDiscoveryResult && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border bg-violet-50 border-violet-200 text-sm text-violet-800">
            <Layers className="w-4 h-4 shrink-0" />
            <span>Feed discovery for <strong>{feedsDiscoveryResult.pubName}</strong> finished — click "Feeds" on the row to review.</span>
            <button onClick={() => setFeedsDiscoveryResult(null)} className="ml-auto opacity-50 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {showAdd && (
          <div className="mb-6 bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">New Publication</h2>
            <PublicationForm form={form} set={set} saving={saving} onSave={handleSave}
              onCancel={() => { setShowAdd(false); setForm({ ...empty }); }} />
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              {(['', 'A', 'B', 'C'] as const).map(t => (
                <button key={t} onClick={() => setFilterTier(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filterTier === t ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                  }`}>
                  {t === '' ? `All · ${pubs.length}` : `Tier ${t} · ${counts[t as Tier]}`}
                </button>
              ))}
            </div>

            <button onClick={() => setShowTierGuide(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-600 ml-1 transition-colors">
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showTierGuide ? 'rotate-90' : ''}`} />
              {showTierGuide ? 'Hide tier guide' : 'Tier guide'}
            </button>

            {jSuggestionCount > 0 && (
              <Link to="/admin/journalist-suggestions"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors">
                <Rss className="w-3 h-3" />
                {jSuggestionCount} new journalist{jSuggestionCount !== 1 ? 's' : ''} found
              </Link>
            )}
            <button onClick={loadHistory}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
              <History className="w-3.5 h-3.5" /> History
            </button>
          </div>

          {showTierGuide && (
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
              {(['A', 'B', 'C'] as Tier[]).map(t => (
                <div key={t} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TierPill tier={t} />
                    <span className="text-xs font-semibold text-slate-700">{TIER_CONFIG[t].label}</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{TIER_CONFIG[t].description}</p>
                </div>
              ))}
            </div>
          )}

          {editingId !== null && (
            <div className="px-5 py-4 border-b border-indigo-100 bg-indigo-50/30">
              <p className="text-xs font-semibold text-indigo-700 mb-3">Editing publication</p>
              <PublicationForm form={form} set={set} saving={saving} onSave={handleSave} onCancel={cancelEdit} />
            </div>
          )}

          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-5 py-3 text-left"><SortBtn col="name">Name</SortBtn></th>
                <th className="px-4 py-3 text-left w-16"><SortBtn col="tier">Tier</SortBtn></th>
                <th className="px-4 py-3 text-left">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Focus</span>
                </th>
                <th className="px-4 py-3 text-left w-32">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Rss className="w-3 h-3" /> Feeds
                  </span>
                </th>
                <th className="px-4 py-3 text-center w-16"><SortBtn col="active">Active</SortBtn></th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {sortedPubs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-sm">No publications found.</td>
                </tr>
              )}
              {sortedPubs.map(p => {
                const feeds = pubFeeds[p.id] || [];
                return (<Fragment key={p.id}>
                <tr
                  className={`border-b border-slate-50 last:border-0 group transition-colors ${
                    editingId === p.id ? 'bg-indigo-50/40' :
                    !p.active ? 'opacity-40 hover:opacity-60' : 'hover:bg-slate-50/70'
                  }`}>
                  <td className="px-5 py-3.5">
                    <Link to={`/admin/publications/${p.id}`}
                      className="font-medium text-slate-800 hover:text-northstar-600 transition-colors text-sm">
                      {p.name}
                    </Link>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-slate-400 hover:text-indigo-500 transition-colors mt-0.5 block">
                        {p.url.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                    {p.health_status === 'unreachable' && (
                      <span className="text-xs text-red-500 mt-0.5 flex items-center gap-1"><TriangleAlert className="w-3 h-3" /> unreachable</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5"><TierPill tier={p.tier as Tier} /></td>
                  <td className="px-4 py-3.5 text-xs text-slate-500 max-w-[200px]">
                    <span className="truncate block" title={p.focus}>{p.focus || <span className="text-slate-300">—</span>}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <RssStatusBadge status={p.rss_status || 'unknown'} note={p.rss_status_note || undefined} />
                      {discoveringFeedsId === p.id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-violet-600 animate-pulse">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Discovering…
                        </span>
                      ) : (
                        <button onClick={() => toggleFeedsPanel(p.id)}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors"
                          title="View / manage feeds">
                          <Layers className="w-3 h-3" />
                          <ChevronRight className={`w-3 h-3 transition-transform ${expandedFeedsPubId === p.id ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <button onClick={() => canEdit && toggleActive(p)}
                      disabled={!canEdit}
                      title={!canEdit ? (p.active ? 'Active' : 'Inactive') : p.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                      className={`w-8 h-5 rounded-full transition-colors relative mx-auto block ${p.active ? 'bg-emerald-400' : 'bg-slate-200'} ${!canEdit ? 'cursor-default' : ''}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${p.active ? 'left-3.5' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link to={`/admin/publications/${p.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-northstar-600 hover:bg-northstar-50 transition-colors" title="View journalists">
                        <Users className="w-3.5 h-3.5" />
                      </Link>
                      {canEdit && (
                        <>
                          <button onClick={() => startEdit(p)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(p.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedFeedsPubId === p.id && (
                  <tr key={`feeds-${p.id}`} className="bg-slate-50/80 border-b border-slate-100">
                    <td colSpan={6} className="px-8 py-4">
                      <div className="flex items-start gap-6">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-3">
                            <Layers className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs font-semibold text-slate-600">RSS Feeds — {p.name}</span>
                            <span className="text-xs text-slate-400">{feeds.length} feed{feeds.length !== 1 ? 's' : ''}</span>
                          </div>
                          {feeds.length === 0
                            ? <p className="text-xs text-slate-400 italic mb-3">No feeds yet. Auto-discover or add one manually below.</p>
                            : <div className="space-y-1.5 mb-3">
                                {feeds.map(f => (
                                  <div key={f.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white border border-slate-100">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      f.rss_status === 'active' ? 'bg-emerald-400' : f.rss_status === 'inactive' ? 'bg-red-400' : 'bg-slate-300'
                                    }`} />
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                                      f.feed_type === 'main' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-600'
                                    }`}>
                                      {f.feed_type === 'main' ? 'Main' : 'Category'}
                                    </span>
                                    <span className="text-xs font-medium text-slate-700 shrink-0 min-w-[100px]">{f.feed_label}</span>
                                    <a href={f.feed_url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-slate-400 hover:text-indigo-600 truncate transition-colors flex items-center gap-1 min-w-0">
                                      {f.feed_url.replace(/^https?:\/\//, '')}
                                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                    </a>
                                    {canEdit && (
                                      <button onClick={() => handleDeleteFeed(p.id, f.id)}
                                        className="ml-auto p-1 text-slate-300 hover:text-red-500 rounded transition-colors shrink-0" title="Remove feed">
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                          }
                          {canEdit && (
                            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                              <input
                                type="url"
                                placeholder="https://techcrunch.com/category/artificial-intelligence/feed/"
                                value={manualFeedUrl}
                                onChange={e => setManualFeedUrl(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddFeedManually(p.id)}
                                className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder:text-slate-300"
                              />
                              <input
                                type="text"
                                placeholder="Label"
                                value={manualFeedLabel}
                                onChange={e => setManualFeedLabel(e.target.value)}
                                className="w-28 text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder:text-slate-300"
                              />
                              <button
                                onClick={() => handleAddFeedManually(p.id)}
                                disabled={addingFeed || !manualFeedUrl.trim()}
                                className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium ring-1 ring-indigo-200 transition-colors disabled:opacity-40"
                              >
                                {addingFeed ? 'Adding…' : '+ Add feed'}
                              </button>
                            </div>
                          )}
                        </div>

                        {canEdit && (
                          <div className="flex flex-col gap-2 shrink-0 pt-5">
                            {p.url && (
                              <>
                                <button
                                  onClick={() => handleDiscoverFeeds(p)}
                                  disabled={discoveringFeedsId === p.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs font-medium ring-1 ring-violet-200 transition-colors"
                                >
                                  <Zap className={`w-3.5 h-3.5 ${discoveringFeedsId === p.id ? 'animate-pulse' : ''}`} />
                                  {discoveringFeedsId === p.id ? 'Discovering… (~20s)' : 'Auto-discover feeds'}
                                </button>
                                <button
                                  onClick={() => handleStaffScan(p)}
                                  disabled={staffScanningId === p.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium ring-1 ring-indigo-200 transition-colors"
                                >
                                  <BookOpen className={`w-3.5 h-3.5 ${staffScanningId === p.id ? 'animate-pulse' : ''}`} />
                                  {staffScanningId === p.id ? 'Scanning staff page…' : 'Scan staff page'}
                                </button>
                              </>
                            )}
                            <p className="text-xs text-slate-400 max-w-[150px] leading-relaxed">These scans find journalists automatically — review suggestions before they're added.</p>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>);
              })}
            </tbody>
          </table>
          </div>
        </div>

        {showHistory && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => setShowHistory(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[65vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">Suggestion History</h2>
                <button onClick={() => setShowHistory(false)}
                  className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                {history.length === 0
                  ? <p className="p-8 text-center text-slate-400 text-sm">No history yet.</p>
                  : <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Publication</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Decision</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-5 py-3 text-slate-800 font-medium">{h.name}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                h.status === 'accepted' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-600 ring-1 ring-red-200'
                              }`}>
                                {h.status === 'accepted' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                {h.status}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-slate-400 text-xs">{h.created_at?.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function PublicationForm({ form, set, saving, onSave, onCancel }: {
  form: typeof empty; set: (k: string, v: any) => void;
  saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 items-end">
      <div className="col-span-2">
        <label className="form-label">Name *</label>
        <input className="form-input" value={form.name}
          onChange={e => set('name', e.target.value)} placeholder="e.g. TechCrunch" autoFocus />
      </div>
      <div className="col-span-2">
        <label className="form-label">Homepage URL</label>
        <input className="form-input" value={form.url}
          onChange={e => set('url', e.target.value)} placeholder="https://..." />
      </div>
      <div className="col-span-2">
        <label className="form-label flex items-center gap-1">
          <Rss className="w-3 h-3 text-emerald-500" /> RSS Feed URL
        </label>
        <input className="form-input" value={form.rssUrl}
          onChange={e => set('rssUrl', e.target.value)} placeholder="https://.../feed/" />
      </div>
      <div className="col-span-2">
        <label className="form-label">Tier</label>
        <select className="form-select" value={form.tier} onChange={e => set('tier', e.target.value)}>
          <option value="A">A — Major & National</option>
          <option value="B">B — Business / Mid-tier</option>
          <option value="C">C — Regional & Niche</option>
        </select>
      </div>
      <div className="col-span-2">
        <label className="form-label">Focus</label>
        <input className="form-input" value={form.focus}
          onChange={e => set('focus', e.target.value)} placeholder="AI funding, startups…" />
      </div>
      <div className="col-span-2">
        <label className="form-label">Notes</label>
        <input className="form-input" value={form.notes}
          onChange={e => set('notes', e.target.value)} placeholder="Internal notes…" />
      </div>
      <div className="col-span-12 flex items-center gap-2 pt-1">
        <button className="btn-primary py-1.5 text-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary py-1.5 text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
