import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, Organization } from '../types';
import { login as loginRequest, signup as signupRequest, acceptInvite as acceptInviteRequest, setToken, clearToken, getToken } from '../api';

const USER_KEY = 'ns_auth_user';
const ORG_KEY = 'ns_auth_org';

interface AuthContextValue {
  user: AuthUser | null;
  org: Organization | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {
    orgName: string;
    email: string;
    password: string;
    name: string;
    companyDescription?: string;
    targetVerticals?: string[];
  }) => Promise<void>;
  acceptInvite: (data: { token: string; name: string; password: string }) => Promise<void>;
  logout: () => void;
}

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStored<AuthUser>(USER_KEY));
  const [org, setOrg] = useState<Organization | null>(() => readStored<Organization>(ORG_KEY));

  function persist(authUser: AuthUser, authOrg: Organization, token: string) {
    setToken(token);
    localStorage.setItem(USER_KEY, JSON.stringify(authUser));
    localStorage.setItem(ORG_KEY, JSON.stringify(authOrg));
    setUser(authUser);
    setOrg(authOrg);
  }

  async function login(email: string, password: string) {
    const res = await loginRequest(email, password);
    persist(res.data.user as AuthUser, res.data.org as Organization, res.data.token);
  }

  async function signup(data: Parameters<AuthContextValue['signup']>[0]) {
    const res = await signupRequest(data);
    persist(res.data.user as AuthUser, res.data.org as Organization, res.data.token);
  }

  async function acceptInvite(data: Parameters<AuthContextValue['acceptInvite']>[0]) {
    const res = await acceptInviteRequest(data);
    persist(res.data.user as AuthUser, res.data.org as Organization, res.data.token);
  }

  function logout() {
    clearToken();
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ORG_KEY);
    setUser(null);
    setOrg(null);
  }

  useEffect(() => {
    window.addEventListener('ns:logout', logout);
    return () => window.removeEventListener('ns:logout', logout);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, org, isAuthenticated: !!user && !!getToken(), login, signup, acceptInvite, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
