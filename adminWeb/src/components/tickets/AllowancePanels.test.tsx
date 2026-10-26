import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicketSpeed, TicketTravel } from "@/types/allowances";
import type { TicketDetail } from "@/types/ticket";
import { SpeedPanel, TravelPanel } from "./AllowancePanels";
import { ForceCloseForm } from "./ForceCloseForm";

const travel: TicketTravel = {
  technicianId: "t1",
  acceptedAt: "2026-10-15T05:30:00Z",
  technicianType: "freelancer",
  baseSource: "pincode",
  customerSource: "ticket",
  straightKm: 21.6,
  roadFactorPct: 130,
  km: 28.1,
  freeKm: 20,
  stepKm: 2,
  paisePerStep: 1000,
  maxPaisePerJob: 30000,
  amountPaise: 4000,
  reason: null,
  creditedPaise: null,
  forceCloseDefaultPaise: 4000,
  forceCloseMaxPaise: 30000,
};

const speed: TicketSpeed = {
  matchedOn: "node",
  matchedName: "Television",
  rewardWithinHours: 12,
  penaltyAfterHours: 24,
  rewardPaise: 20000,
  penaltyPaise: 15000,
  clockStartedAt: "2026-10-16T10:00:00Z",
  acceptedAt: "2026-10-14T11:00:00Z",
  slotStart: "2026-10-16T10:00:00Z",
  completedAt: "2026-10-16T19:24:00Z",
  elapsedHours: 9.4,
  partWaitHours: null,
  workingHours: 9.4,
  outcome: "reward",
  ledgerEntryId: "e1",
  paidPaise: 20000,
  capped: false,
  reversed: false,
};

const ticket = (o: Partial<TicketDetail>): TicketDetail =>
  ({
    status: "Closed",
    technicianName: "Ravi Kumar",
    travel: null,
    speed: null,
    ...o,
  }) as TicketDetail;

describe("TravelPanel", () => {
  afterEach(cleanup);

  it("renders nothing when the server sent no travel block", () => {
    const { container } = render(<TravelPanel ticket={ticket({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("prints the frozen figures and what an open job will pay", () => {
    render(
      <TravelPanel ticket={ticket({ status: "Awaiting Customer", travel })} />
    );
    expect(screen.getByText("Travel allowance")).toBeInTheDocument();
    expect(screen.getByText(/Frozen when Ravi Kumar accepted/)).toBeInTheDocument();
    expect(
      screen.getByText("28.1 km by road (21.6 km straight × 130 %)")
    ).toBeInTheDocument();
    expect(screen.getByText("Base · pincode centre")).toBeInTheDocument();
    expect(screen.getByText("Customer's address pin")).toBeInTheDocument();
    expect(
      screen.getByText("20 km free, then ₹10 per 2 km, up to ₹300")
    ).toBeInTheDocument();
    expect(screen.getByText("Paid when the customer confirms")).toBeInTheDocument();
  });

  it("says Paid once the ledger row exists", () => {
    render(<TravelPanel ticket={ticket({ travel: { ...travel, creditedPaise: 4000 } })} />);
    expect(screen.getByText("Paid ₹40")).toBeInTheDocument();
  });

  it("says no base location in words and shows 0 km", () => {
    render(
      <TravelPanel
        ticket={ticket({
          travel: {
            ...travel,
            reason: "no_base_location",
            baseSource: null,
            km: 0,
            straightKm: 0,
            amountPaise: 0,
          },
        })}
      />
    );
    expect(
      screen.getByText("No base location when accepted — nothing to pay.")
    ).toBeInTheDocument();
    expect(screen.getByText("0 km")).toBeInTheDocument();
    expect(screen.getByText("Not paid")).toBeInTheDocument();
  });
});

describe("SpeedPanel", () => {
  afterEach(cleanup);

  it("renders nothing when no rule was frozen", () => {
    const { container } = render(<SpeedPanel ticket={ticket({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("prints the rule, the time taken and the outcome", () => {
    render(<SpeedPanel ticket={ticket({ speed })} />);
    expect(screen.getByText("Speed allowance")).toBeInTheDocument();
    expect(screen.getByText("Category: Television")).toBeInTheDocument();
    expect(screen.getByText("Within 12 h · ₹200")).toBeInTheDocument();
    expect(screen.getByText("After 24 h · −₹150")).toBeInTheDocument();
    expect(screen.getByText("9 h 24 m")).toBeInTheDocument();
    expect(screen.getByText("Rewarded ₹200")).toBeInTheDocument();
    expect(screen.getByText(/\(start of the slot\)/)).toBeInTheDocument();
  });

  it("reads Not paid — force-closed for a force-closure", () => {
    render(
      <SpeedPanel
        ticket={ticket({
          status: "Force-Closed",
          speed: { ...speed, outcome: "force_closed", paidPaise: null },
        })}
      />
    );
    expect(screen.getByText("Not paid — force-closed")).toBeInTheDocument();
  });

  it("excludes the part wait and flags a capped, reversed penalty", () => {
    render(
      <SpeedPanel
        ticket={ticket({
          speed: {
            ...speed,
            outcome: "penalty",
            paidPaise: 5000,
            partWaitHours: 2.1,
            capped: true,
            reversed: true,
          },
        })}
      />
    );
    expect(
      screen.getByText("9 h 24 m, excluding 2 h 6 m waiting for parts")
    ).toBeInTheDocument();
    expect(screen.getByText("Penalised −₹50")).toBeInTheDocument();
    expect(screen.getByText("capped by the monthly limit")).toBeInTheDocument();
    expect(screen.getByText("reversed")).toBeInTheDocument();
  });
});

describe("ForceCloseForm — the travel allowance field", () => {
  afterEach(cleanup);

  function renderForm(
    travelProp: Parameters<typeof ForceCloseForm>[0]["travel"],
    onSubmit = vi.fn()
  ) {
    return render(
      <MemoryRouter>
        <ForceCloseForm
          ticketId="t-1"
          onSubmit={onSubmit}
          isSubmitting={false}
          technician={{ name: "Ravi Kumar", payoutPaise: 50000 }}
          technicianType="freelancer"
          vendor={{ name: "Crestline", pricePaise: 120000 }}
          travel={travelProp}
        />
      </MemoryRouter>
    );
  }

  it("is pre-filled with the frozen default and says how it was worked out", () => {
    renderForm({ defaultPaise: 4000, maxPaise: 30000, km: 28.1, technicianName: "Ravi Kumar" });
    expect(screen.getByLabelText("Travel allowance (₹)")).toHaveValue("40");
    expect(
      screen.getByText(/Worked out as ₹40 when Ravi Kumar accepted \(28.1 km\)\. At most ₹300\./)
    ).toBeInTheDocument();
  });

  it("is not drawn without a travel block, or with a ₹0 ceiling", () => {
    const { unmount } = renderForm(null);
    expect(screen.queryByLabelText("Travel allowance (₹)")).toBeNull();
    unmount();
    renderForm({ defaultPaise: 0, maxPaise: 0, km: 5, technicianName: "Ravi Kumar" });
    expect(screen.queryByLabelText("Travel allowance (₹)")).toBeNull();
  });

  it("blocks submit and names the ceiling when it is exceeded by ₹1", async () => {
    const onSubmit = vi.fn();
    renderForm(
      { defaultPaise: 4000, maxPaise: 30000, km: 28.1, technicianName: "Ravi Kumar" },
      onSubmit
    );
    fireEvent.change(screen.getByLabelText("Travel allowance (₹)"), {
      target: { value: "301" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Force-close ticket/ }));
    expect(await screen.findByText("At most ₹300")).toBeInTheDocument();
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });
});
