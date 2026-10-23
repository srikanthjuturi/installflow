import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listNodeTree } from "@/services/productMaster";
import {
  getTechnicianOptions,
} from "@/services/franchise";
import { WorkspaceProvider } from "./useWorkspace";
import { FRANCHISE_WORKSPACE } from "@/services/workspace";
import { useCertifiableSubcategories } from "./useTechnicians";

/**
 * The certification pick list runs under BOTH shells (Task 09 §5.3), and the
 * two answers come from two different endpoints — one of them (`/masters/nodes`,
 * `masters.view`) a franchise principal is deliberately NOT granted. These
 * tests pin the two gates, because the failure mode of an ungated staff query
 * in the portal is not an error state — it is a 403 toast on every dialog open.
 */

vi.mock("@/services/productMaster", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listNodeTree: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/franchise", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTechnicianOptions: vi.fn().mockResolvedValue({
    regions: [{ id: "r-1", name: "South" }],
    subcategories: [
      {
        id: "s-1",
        name: "Television",
        rootId: "root-1",
        rootName: "Electronics",
        pathLabel: "Television",
      },
    ],
  }),
}));

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function render(options: { franchise?: boolean } = {}) {
  const queryClient = client();
  return renderHook(() => useCertifiableSubcategories(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {options.franchise ? (
          <WorkspaceProvider value={FRANCHISE_WORKSPACE}>
            {children}
          </WorkspaceProvider>
        ) : (
          children
        )}
      </QueryClientProvider>
    ),
  });
}

/** Each test mounts a fresh service mock, so call counts are its own. */
afterEach(() => {
  vi.clearAllMocks();
});

describe("useCertifiableSubcategories", () => {
  it("ops reads the staff tree, never the portal's options endpoint", async () => {
    const { result } = render();
    await waitFor(() => expect(listNodeTree).toHaveBeenCalled());
    // The portal's door stays shut in the staff console — a fetch it holds no
    // feature for would just be a 403 in the other direction.
    expect(getTechnicianOptions).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toEqual([]);
  });

  it("the franchise portal reads its own options endpoint, never the staff tree", async () => {
    const { result } = render({ franchise: true });
    await waitFor(() => expect(getTechnicianOptions).toHaveBeenCalled());
    // The regression this pins: `masters.view` is deliberately not granted to
    // a franchisee admin, so the staff read of `/masters/nodes` must never
    // even be issued here — gating it is the whole fix.
    expect(listNodeTree).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toHaveLength(1);
    expect(result.current.options[0]).toMatchObject({
      id: "s-1",
      name: "Television",
      rootName: "Electronics",
    });
  });
});