import { useEffect, useState } from 'react';
import { UserPlus, Trash2, Copy, Check, X, Users as UsersIcon } from 'lucide-react';
import { team as api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { TeamMember, Invite } from '../types';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export default function TeamPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.members().then(r => setMembers(r.data));
    if (isOwner) api.invites().then(r => setInvites(r.data));
  };

  useEffect(() => { load(); }, [isOwner]);

  const copyLink = (id: string, link: string) => {
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setError('');
    setSending(true);
    try {
      const res = await api.createInvite(inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteRole('member');
      setInvites(prev => [res.data, ...prev]);
      copyLink(res.data.id, res.data.link);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to send invite');
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (id: string) => {
    await api.revokeInvite(id);
    setInvites(prev => prev.filter(i => i.id !== id));
  };

  const handleRoleChange = async (id: string, role: string) => {
    setError('');
    try {
      const res = await api.updateMemberRole(id, role);
      setMembers(prev => prev.map(m => (m.id === id ? res.data : m)));
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to update role');
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this person from the organization?')) return;
    setError('');
    try {
      await api.removeMember(id);
      setMembers(prev => prev.filter(m => m.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to remove member');
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <UsersIcon className="w-5 h-5 text-northstar-500" /> Team
        </h1>
        <p className="text-slate-500 mt-1 text-sm max-w-xl">
          Manage who has access to this workspace. Owners can invite people and manage roles.
        </p>
      </div>

      {error && (
        <p className="mb-4 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="card divide-y divide-slate-100 mb-6">
        {members.map(m => (
          <div key={m.id} className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900 text-sm">{m.name}</div>
              <div className="text-xs text-slate-500">{m.email}</div>
            </div>
            {isOwner ? (
              <select
                className="form-input py-1 text-xs w-28"
                value={m.role}
                onChange={e => handleRoleChange(m.id, e.target.value)}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            ) : (
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">
                {ROLE_LABEL[m.role]}
              </span>
            )}
            {isOwner && (
              <button
                onClick={() => handleRemove(m.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Remove from organization"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <>
          <div className="card p-5 mb-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4" /> Invite someone
            </h2>
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-7">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="jane@acme.com"
                />
              </div>
              <div className="col-span-3">
                <label className="form-label">Role</label>
                <select className="form-input" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <div className="col-span-2">
                <button
                  className="btn-primary py-2 text-sm w-full"
                  onClick={handleInvite}
                  disabled={sending || !inviteEmail.trim()}
                >
                  {sending ? 'Sending…' : 'Invite'}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              This generates a one-time invite link — there's no email sending set up yet, so share the link with them directly (Slack, email, etc.).
            </p>
          </div>

          {invites.length > 0 && (
            <div className="card divide-y divide-slate-100">
              <div className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Pending invites
              </div>
              {invites.map(inv => (
                <div key={inv.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 text-sm">{inv.email}</div>
                    <div className="text-xs text-slate-500">
                      {ROLE_LABEL[inv.role]} · expires {new Date(inv.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(inv.id, inv.link)}
                    className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1"
                  >
                    {copiedId === inv.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedId === inv.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => handleRevoke(inv.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Revoke invite"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
