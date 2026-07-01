import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from './types';
import api from './api';

const STORAGE_KEY = 'ns_current_user';

interface UserContextValue {
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
}

const UserContext = createContext<UserContextValue>({
  currentUser: null,
  setCurrentUser: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const setCurrentUser = (u: User | null) => {
    setCurrentUserState(u);
    if (u) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      // Attach to every outgoing request so the backend knows who is acting
      (api as any).defaults.headers['x-user-name'] = u.name;
      (api as any).defaults.headers['x-user-title'] = u.title;
    } else {
      localStorage.removeItem(STORAGE_KEY);
      delete (api as any).defaults.headers['x-user-name'];
      delete (api as any).defaults.headers['x-user-title'];
    }
  };

  // Re-apply headers on mount (restoring from localStorage)
  useEffect(() => {
    if (currentUser) {
      (api as any).defaults.headers['x-user-name'] = currentUser.name;
      (api as any).defaults.headers['x-user-title'] = currentUser.title;
    }
  }, []);

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
