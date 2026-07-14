import React, { createContext, useContext } from "react";

// No-account mode: the app runs without authentication. A single static local
// profile is provided so screens that reference the current user keep working.
export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
  is_admin?: boolean;
};

const LOCAL_USER: User = {
  user_id: "local_user",
  email: "",
  name: "Profesional",
  picture: "",
  provider: "local",
  is_admin: true,
};

type AuthState = { user: User };

const AuthContext = createContext<AuthState>({ user: LOCAL_USER });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <AuthContext.Provider value={{ user: LOCAL_USER }}>{children}</AuthContext.Provider>;
}
