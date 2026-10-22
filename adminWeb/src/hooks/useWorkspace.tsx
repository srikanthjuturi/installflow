/* eslint-disable react-refresh/only-export-components */
/**
 * Which workspace the reused money screens run in — Task 09 §5.2.
 *
 * A CONTEXT, because the answer is a property of the SHELL the screen is
 * mounted under, not of the session alone: `AppShell` (staff) and
 * `FranchiseShell` (portal) both render the same technician table, and the
 * two differ by what they provide here — the same pattern the theme provider
 * beside it uses, with the same eslint-disable for the same reason.
 *
 * The default is `OPS_WORKSPACE`, and that is the point of the shape:
 * **`AppShell` mounts no provider at all.** Every staff screen keeps its
 * today's behaviour with zero changes, and the only shell that knows the
 * portal exists is the shell that serves it. A staff screen reaching this
 * hook without any provider is not an error to throw on — it is the staff
 * console, by construction.
 */
import * as React from "react";
import { OPS_WORKSPACE, type WorkspaceAdapter } from "@/services/workspace";

/**
 * Exported for `useWorkspace.test.tsx` alone — screens reach the hook, never
 * the context by hand; a component reading the context directly would skip the
 * OPS_WORKSPACE default and break exactly the safety property §5.2 promises.
 */
export const WorkspaceContext = React.createContext<
  WorkspaceAdapter | undefined
>(undefined);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceAdapter;
  children: React.ReactNode;
}) {
  const memo = React.useMemo(() => value, [value]);
  return (
    <WorkspaceContext.Provider value={memo}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * The workspace the current shell runs in. Reads paths, features and api
 * functions from one record — three call sites reading `paths.technician(id)`
 * and its neighbours stay in step by construction, and a hook can never
 * branch on "am I the portal" (rules of hooks) when the answer is a value
 * the shell handed in.
 */
export function useWorkspace(): WorkspaceAdapter {
  return React.useContext(WorkspaceContext) ?? OPS_WORKSPACE;
}