import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export type User = { id: number; email: string; name: string; calorie_goal: number };
type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  setUser: (u: User) => void;
};

const AuthContext = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("salamat:logout", onLogout);
    return () => window.removeEventListener("salamat:logout", onLogout);
  }, []);

  const finish = (r: { token: string; user: User }) => {
    setToken(r.token);
    setUser(r.user);
  };
  const login = useCallback(async (email: string, password: string) => finish(await api("/api/auth/login", { body: { email, password } })), []);
  const register = useCallback(
    async (email: string, password: string, name: string) => finish(await api("/api/auth/register", { body: { email, password, name } })),
    [],
  );
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>{children}</AuthContext.Provider>;
}
