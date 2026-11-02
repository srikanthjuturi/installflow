import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveLocation } from "@/types/liveLocation";

const state: {
  data: LiveLocation | null | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: null, isLoading: false, isError: false };
const hook = vi.fn();

vi.mock("@/hooks/useLiveLocation", () => ({
  useTicketLiveLocation: (...a: unknown[]) => {
    hook(...a);
    return { ...state, refetch: vi.fn(), isFetching: false };
  },
}));

// Leaflet needs a real layout engine.
vi.mock("@/components/geo/LiveMap", () => ({
  default: ({
    pins,
    customer,
  }: {
    pins: unknown[];
    customer?: unknown;
  }) => (
    <div data-testid="map">
      {pins.length} pin{customer ? " + customer" : ""}
    </div>
  ),
}));

import { TechnicianLiveCard } from "./TechnicianLiveCard";

const point: LiveLocation = {
  ticketId: "t1",
  ticketCode: "TKT-1",
  status: "In Progress",
  technicianId: "u1",
  technicianName: "Ravi Kumar",
  latitude: 17,
  longitude: 78,
  accuracyM: 30,
  recordedAt: "2026-10-30T10:00:00Z",
  receivedAt: "2026-10-30T10:00:01Z",
  ageSeconds: 12,
  stale: false,
  customerLatitude: null,
  customerLongitude: null,
  city: null,
  pincode: null,
  companyId: "c1",
};

afterEach(() => {
  cleanup();
  hook.mockClear();
  Object.assign(state, { data: null, isLoading: false, isError: false });
});

describe("TechnicianLiveCard", () => {
  it.each(["New", "Closed", "Cancelled", "Escalated", "Force-Closed"])(
    "renders nothing, and asks for nothing, on a %s ticket",
    (status) => {
      const { container } = render(
        <TechnicianLiveCard ticketId="t1" status={status} />
      );
      expect(container).toBeEmptyDOMElement();
      expect(hook).not.toHaveBeenCalled();
    }
  );

  it.each(["Assigned", "In Progress", "Awaiting Part"])(
    "shows the card on a %s ticket",
    (status) => {
      render(<TechnicianLiveCard ticketId="t1" status={status} />);
      expect(screen.getByText("Live location")).toBeInTheDocument();
    }
  );

  it("says why there is nothing when the answer is null", () => {
    render(<TechnicianLiveCard ticketId="t1" status="Assigned" />);
    expect(
      screen.getByText(/Location isn't available — the job isn't active/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("offers a retry on error", () => {
    state.isError = true;
    render(<TechnicianLiveCard ticketId="t1" status="Assigned" />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows the name, the age and the map for a fresh point", async () => {
    state.data = point;
    render(<TechnicianLiveCard ticketId="t1" status="In Progress" />);
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText(/Updated 12 s ago/)).toBeInTheDocument();
    expect(await screen.findByTestId("map")).toHaveTextContent("1 pin");
    expect(screen.queryByText(/from the customer/)).toBeNull();
  });

  it("labels the straight-line distance when the job has a pick", async () => {
    state.data = {
      ...point,
      customerLatitude: 18,
      customerLongitude: 78,
    };
    render(<TechnicianLiveCard ticketId="t1" status="In Progress" />);
    expect(screen.getByText(/111 km from the customer/)).toBeInTheDocument();
    expect(await screen.findByTestId("map")).toHaveTextContent("+ customer");
  });

  it("words a stale point as not reporting, never as current", () => {
    state.data = { ...point, stale: true, ageSeconds: 600 };
    render(<TechnicianLiveCard ticketId="t1" status="In Progress" />);
    expect(
      screen.getByText("Last seen 10 min ago — their phone is not reporting")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Updated/)).toBeNull();
  });
});
