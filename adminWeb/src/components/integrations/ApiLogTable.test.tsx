import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiLogEntry } from "@/types/integration";
import { ApiLogTable } from "./ApiLogTable";

/**
 * The call log: a refused call is readable, a 30-day-old row says its details
 * were removed (rather than looking empty), and the page-level note explains
 * that an unrecognised Client ID is not listed.
 */

const entry = (o: Partial<ApiLogEntry> = {}): ApiLogEntry => ({
  id: "l1",
  occurredAt: "2026-11-05T05:30:00Z",
  vendorName: "ABC Technologies",
  clientId: "abc_technologies_001",
  endpoint: "create_ticket",
  httpStatus: 400,
  outcomeCode: "UNKNOWN_SKU",
  reference: "CRM-88421",
  checkOnly: false,
  repeat: false,
  ticketId: null,
  summary: { sku: "WP-100", pincode: "500081" },
  ...o,
});

const meta = (n: number) => ({
  page: 1,
  limit: 20,
  totalRecords: n,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
});

function renderTable(rows: ApiLogEntry[]) {
  return render(
    <ApiLogTable
      rows={rows}
      meta={meta(rows.length)}
      params={{ page: 1, limit: 20 }}
      onParams={vi.fn()}
      isLoading={false}
      isFetching={false}
      error={null}
      onRetry={vi.fn()}
      vendors={[{ value: "v1", label: "ABC Technologies" }]}
      credentials={[{ value: "c1", label: "ABC Technologies · abc_technologies_001" }]}
    />
  );
}

describe("ApiLogTable", () => {
  afterEach(cleanup);

  it("shows the call, its result and the reason it failed", () => {
    renderTable([entry()]);
    expect(screen.getByText("Create ticket")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN_SKU")).toBeInTheDocument();
    expect(screen.getByText("CRM-88421")).toBeInTheDocument();
    expect(screen.getByText("abc_technologies_001")).toBeInTheDocument();
  });

  it("marks a check-only call and a repeat", () => {
    renderTable([
      entry({ id: "a", checkOnly: true, httpStatus: 200, outcomeCode: null }),
      entry({ id: "b", repeat: true, httpStatus: 200, outcomeCode: null }),
    ]);
    expect(screen.getByText("Check only")).toBeInTheDocument();
    expect(screen.getByText("Repeat")).toBeInTheDocument();
  });

  it("lets the request summary be opened when there is one", () => {
    renderTable([entry()]);
    fireEvent.click(screen.getByText("View details"));
    expect(screen.getByText(/"sku": "WP-100"/)).toBeInTheDocument();
  });

  it("says details were removed after 30 days when the summary is null", () => {
    renderTable([entry({ summary: null })]);
    expect(screen.getByText("Details removed after 30 days")).toBeInTheDocument();
    expect(screen.queryByText("View details")).toBeNull();
  });

  it("shows the empty state when nothing has called yet", () => {
    renderTable([]);
    expect(screen.getByText("No API calls yet")).toBeInTheDocument();
  });
});

const services = vi.hoisted(() => ({
  listApiLogs: vi.fn(),
  listApiCredentials: vi.fn(),
  listVendorOptions: vi.fn(),
}));
vi.mock("@/services/apiCredentials", () => ({
  listApiLogs: services.listApiLogs,
  listApiCredentials: services.listApiCredentials,
}));
vi.mock("@/services/vendors", async (original) => ({
  ...(await original<typeof import("@/services/vendors")>()),
  listVendorOptions: services.listVendorOptions,
}));

import ApiLogsPage from "@/pages/integrations/ApiLogsPage";

describe("ApiLogsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("tells the reader that unrecognised Client IDs are not listed", async () => {
    services.listApiLogs.mockResolvedValue({
      rows: [entry()],
      pagination: {
        page: 1,
        limit: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    services.listApiCredentials.mockResolvedValue([]);
    services.listVendorOptions.mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ApiLogsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(
      await screen.findByText(/Calls made with an unrecognised Client ID are not listed/)
    ).toBeInTheDocument();
    expect(await screen.findByText("CRM-88421")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("UNKNOWN_SKU")).toBeInTheDocument();
  });
});
