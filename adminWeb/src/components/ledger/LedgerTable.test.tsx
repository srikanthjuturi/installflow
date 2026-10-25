import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@/types";
import { LedgerTable } from "./LedgerTable";
import { PoolSummary } from "./PoolSummary";

const entry = (o: Partial<LedgerEntry>): LedgerEntry => ({
  id: "e1",
  at: "2026-10-15T05:30:00Z",
  kind: "penalty",
  amountPaise: 15000,
  technicianId: "t1",
  technicianName: "Ravi Kumar",
  ticketId: "k1",
  ticketCode: "RGT-INST-0412",
  reason: "reason",
  reversed: false,
  franchiseeId: "f1",
  technicianType: "freelancer",
  ...o,
});

function renderTable(entries: LedgerEntry[]) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LedgerTable
          entries={entries}
          meta={{
            page: 1,
            limit: 20,
            totalRecords: entries.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          }}
          params={{}}
          onParams={vi.fn()}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          fetchNextPage={vi.fn()}
          readAt={Date.parse("2026-10-15T06:00:00Z")}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("LedgerTable — the speed kinds and the unknown", () => {
  afterEach(cleanup);

  it("a speed reward reads Speed reward, −₹200 (acceptance 1)", () => {
    renderTable([entry({ kind: "speed_reward", amountPaise: 20000 })]);
    expect(screen.getByText("Speed reward")).toBeInTheDocument();
    expect(screen.getByText("−₹200")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("a speed penalty reads Speed penalty, +₹150, and (reversed) once given back (acceptance 2)", () => {
    renderTable([
      entry({ kind: "speed_penalty", amountPaise: 15000, reversed: true }),
    ]);
    expect(screen.getByText("Speed penalty")).toBeInTheDocument();
    expect(screen.getByText("+₹150")).toBeInTheDocument();
    expect(screen.getByText("(reversed)")).toBeInTheDocument();
  });

  it("an unknown kind prints itself, on the neutral chip, with an unsigned amount (acceptance 3)", () => {
    renderTable([entry({ kind: "teleport", amountPaise: 15000 })]);
    const chip = screen.getByText("teleport");
    expect(chip.className).toContain("bg-surface-3");
    expect(screen.getByText("₹150")).toBeInTheDocument();
    expect(screen.queryByText("+₹150")).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

describe("PoolSummary — the speed breakdown", () => {
  afterEach(cleanup);

  const pool = {
    balancePaise: 20000,
    penaltiesCollectedPaise: 50000,
    cancellations: 2,
    bonusesPaidPaise: 30000,
    pickups: 1,
    franchiseeId: "f1",
    franchiseeName: "SkyFix",
  };

  it("adds the incl. lines only when the breakdown is non-zero", () => {
    const { rerender } = render(
      <PoolSummary pool={pool} isLoading={false} error={null} onRetry={vi.fn()} />
    );
    expect(screen.queryByText(/speed penalties/)).toBeNull();
    expect(screen.queryByText(/speed rewards/)).toBeNull();

    rerender(
      <PoolSummary
        pool={{
          ...pool,
          speedPenaltyPaise: 15000,
          speedPenalties: 1,
          speedRewardPaise: 20000,
          speedRewards: 1,
        }}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText("incl. ₹150 speed penalties")).toBeInTheDocument();
    expect(screen.getByText("incl. ₹200 speed rewards")).toBeInTheDocument();
    // The sentence is unchanged: the fold keeps collected − bonuses = balance.
    expect(screen.getByText("Current pool balance", { selector: "span" })).toBeInTheDocument();
  });

  it("zero breakdowns draw nothing", () => {
    render(
      <PoolSummary
        pool={{ ...pool, speedPenaltyPaise: 0, speedRewardPaise: 0 }}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByText(/incl\./)).toBeNull();
  });
});
