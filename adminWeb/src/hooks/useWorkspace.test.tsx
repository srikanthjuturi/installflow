import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { listTechnicians } from "@/services/technicians";
import { WorkspaceProvider, useWorkspace } from "./useWorkspace";
import { FRANCHISE_WORKSPACE } from "@/services/workspace";

/**
 * Task 09 §6 — the adapter's safety property: NO provider IS the staff
 * console (`AppShell` mounts none), so every staff screen keeps today's
 * behaviour with zero changes; and the portal shell hands the twins over.
 */
function wrapper({ children }: { children?: React.ReactNode }) {
  return (
    <WorkspaceProvider value={FRANCHISE_WORKSPACE}>{children}</WorkspaceProvider>
  );
}

describe("useWorkspace", () => {
  it("is the ops workspace when no provider is mounted", () => {
    const { result } = renderHook(() => useWorkspace());
    expect(result.current.workspace).toBe("ops");
    // ...and its api record is the staff services, not wrappers of them.
    expect(result.current.api.technicians.list).toBe(listTechnicians);
  });

  it("is the franchise workspace inside the portal's provider", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.workspace).toBe("franchise");
    // The portal's pool rides a different door, and it is the one that owns
    // the Reverse button (§4.3) — ops' record carries none.
    expect(result.current.api.ledger.reverse).not.toBeNull();
    expect(result.current.paths.technicians).toBe("/franchise/technicians");
  });
});