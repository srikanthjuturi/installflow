import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role } from "@/types";

/**
 * Client state only. Tickets, technicians, escalations and the ledger are
 * server state and live in TanStack Query — never here.
 */
interface SessionState {
  signedIn: boolean;
  name: string;
  email: string;
  /** The scope being viewed. Server-side guards are the real authority;
   *  this only drives presentation. */
  role: Role;
  /** Mobile drawer — transient, never persisted. */
  sidebarOpen: boolean;
  /** Desktop rail collapsed to icons. Persisted: it is a workspace preference,
   *  and having it reset on every reload would be worse than not having it. */
  sidebarCollapsed: boolean;
  signIn: (email: string) => void;
  signOut: () => void;
  setRole: (role: Role) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      signedIn: false,
      name: "Ravi Sharma",
      email: "ravi.sharma@installflow.in",
      role: "ASM",
      sidebarOpen: false,
      sidebarCollapsed: false,
      signIn: (email) => set({ signedIn: true, email }),
      signOut: () => set({ signedIn: false }),
      setRole: (role) => set({ role }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "installflow.session",
      partialize: (s) => ({
        signedIn: s.signedIn,
        email: s.email,
        name: s.name,
        role: s.role,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);

export const ROLE_LABEL: Record<Role, string> = {
  NH: "National Head",
  RSH: "Regional Service Head · West",
  ASM: "Area Service Manager · Pune",
  "Ops Staff": "Ops Staff · Pune",
};
