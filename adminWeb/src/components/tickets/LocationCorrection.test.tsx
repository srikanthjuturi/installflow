import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicketDetail } from "@/types/ticket";

vi.mock("@/hooks/useTickets", () => ({
  useCorrectTicketLocation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { LocationStrip } from "./LocationCorrection";

const ticket = (o: Partial<TicketDetail> = {}) =>
  ({
    status: "New",
    latitude: null,
    longitude: null,
    locationSource: null,
    locationSetAt: null,
    technicianName: null,
    ...o,
  }) as TicketDetail;

afterEach(cleanup);

describe("LocationStrip", () => {
  it("says there is no point and that the pincode centre is used", () => {
    render(<LocationStrip ticket={ticket()} canCorrect />);
    expect(screen.getByText(/pincode's centre/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set location" })).toBeTruthy();
  });

  it("names who set the point", () => {
    render(
      <LocationStrip
        ticket={ticket({
          latitude: 17.4,
          longitude: 78.4,
          locationSource: "customer",
        })}
        canCorrect
      />
    );
    expect(screen.getByText(/Set by the customer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Correct location" })).toBeTruthy();
  });

  it("offers no correction to somebody who cannot make one", () => {
    render(<LocationStrip ticket={ticket()} canCorrect={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers no correction on a finished ticket", () => {
    render(<LocationStrip ticket={ticket({ status: "Closed" })} canCorrect />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
