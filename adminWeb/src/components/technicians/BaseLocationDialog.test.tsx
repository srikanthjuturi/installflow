import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/client";

const setBaseLocation = vi.fn();
vi.mock("@/services/technicians", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/technicians")>()),
  setBaseLocation: (...a: unknown[]) => setBaseLocation(...a),
}));

const lookupPincode = vi.fn();
vi.mock("@/services/geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/geo")>()),
  lookupPincode: (...a: unknown[]) => lookupPincode(...a),
}));

// Leaflet needs a real layout engine. The stub exposes the two ways a user
// reaches `onPick` and the failure callback, which is all the dialog sees.
vi.mock("@/components/geo/BaseLocationMap", () => ({
  default: ({
    value,
    onPick,
    onTilesFailed,
  }: {
    value: { lat: number; lng: number } | null;
    onPick: (p: { lat: number; lng: number }) => void;
    onTilesFailed: () => void;
  }) => (
    <div data-testid="map">
      <span data-testid="pin">
        {value ? `${value.lat},${value.lng}` : "none"}
      </span>
      <button
        type="button"
        onClick={() => onPick({ lat: 17.4401234, lng: 78.3489012 })}
      >
        stub: click the map
      </button>
      <button type="button" onClick={onTilesFailed}>
        stub: tiles fail
      </button>
    </div>
  ),
}));

import { BaseLocationDialog } from "./BaseLocationDialog";

type Base = Parameters<typeof BaseLocationDialog>[0]["technician"]["baseLocation"];

function renderDialog(baseLocation: Base = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BaseLocationDialog
          open
          onOpenChange={vi.fn()}
          technician={{ id: "t-1", name: "Ravi Kumar", baseLocation }}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const save = () => screen.getByRole("button", { name: "Save base location" });
const lat = () => screen.getByLabelText("Latitude");
const lng = () => screen.getByLabelText("Longitude");

describe("BaseLocationDialog", () => {
  beforeEach(() => {
    setBaseLocation.mockResolvedValue({});
    lookupPincode.mockResolvedValue({
      code: "500049",
      latitude: 17.44,
      longitude: 78.35,
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens on the technician's name and the always-visible coordinate boxes", async () => {
    renderDialog();
    expect(
      await screen.findByRole("dialog", { name: "Base location · Ravi Kumar" })
    ).toBeInTheDocument();
    expect(lat()).toBeInTheDocument();
    expect(lng()).toBeInTheDocument();
    expect(await screen.findByTestId("map")).toBeInTheDocument();
  });

  it("Use centre moves the pin to the pincode's point and saves { pincode } only", async () => {
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Pincode"), {
      target: { value: "500049" },
    });
    const useCentre = screen.getByRole("button", { name: "Use centre" });
    await waitFor(() => expect(useCentre).toBeEnabled());
    fireEvent.click(useCentre);
    expect(await screen.findByTestId("pin")).toHaveTextContent("17.44,78.35");
    fireEvent.click(save());
    await waitFor(() => expect(setBaseLocation).toHaveBeenCalledTimes(1));
    expect(setBaseLocation).toHaveBeenCalledWith({
      id: "t-1",
      body: { pincode: "500049" },
    });
  });

  it("says Saved as the pincode's centre when the row has no point", async () => {
    lookupPincode.mockResolvedValue({
      code: "500049",
      latitude: null,
      longitude: null,
    });
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Pincode"), {
      target: { value: "500049" },
    });
    const useCentre = screen.getByRole("button", { name: "Use centre" });
    await waitFor(() => expect(useCentre).toBeEnabled());
    fireEvent.click(useCentre);
    expect(
      await screen.findByText("Saved as the pincode's centre.")
    ).toBeInTheDocument();
  });

  it("says so when we do not service the pincode", async () => {
    lookupPincode.mockResolvedValue(null);
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Pincode"), {
      target: { value: "999999" },
    });
    expect(
      await screen.findByText("We don't service that pincode.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use centre" })).toBeDisabled();
  });

  it("a failed lookup says so and never blocks the save", async () => {
    lookupPincode.mockRejectedValue(new Error("down"));
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Pincode"), {
      target: { value: "500049" },
    });
    // `usePincodeLookup` retries once (1 s) before it gives up.
    expect(
      await screen.findByText("Couldn't check that pincode.", {}, { timeout: 4000 })
    ).toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() => expect(setBaseLocation).toHaveBeenCalled());
    expect(setBaseLocation.mock.calls[0][0].body).toEqual({
      pincode: "500049",
    });
  });

  it("a map click saves the rounded point as source map", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("stub: click the map"));
    expect(lat()).toHaveValue("17.44012");
    fireEvent.click(save());
    await waitFor(() => expect(setBaseLocation).toHaveBeenCalled());
    expect(setBaseLocation.mock.calls[0][0]).toEqual({
      id: "t-1",
      body: { latitude: 17.44012, longitude: 78.3489, source: "map" },
    });
  });

  it("typed coordinates save as source manual, rounded to 5 dp", async () => {
    renderDialog();
    await screen.findByTestId("map");
    fireEvent.change(lat(), { target: { value: "17.4401234" } });
    fireEvent.change(lng(), { target: { value: "78.3489012" } });
    fireEvent.click(save());
    await waitFor(() => expect(setBaseLocation).toHaveBeenCalled());
    expect(setBaseLocation.mock.calls[0][0].body).toEqual({
      latitude: 17.44012,
      longitude: 78.3489,
      source: "manual",
    });
  });

  it("refuses a point outside India on the field without sending it", async () => {
    renderDialog();
    await screen.findByTestId("map");
    fireEvent.change(lat(), { target: { value: "51.5" } });
    fireEvent.change(lng(), { target: { value: "-0.12" } });
    fireEvent.click(save());
    expect(
      await screen.findByText("That point is outside India.")
    ).toBeInTheDocument();
    expect(setBaseLocation).not.toHaveBeenCalled();
  });

  it("lands the server's PINCODE_OUTSIDE_FRANCHISEE sentence under the pincode", async () => {
    setBaseLocation.mockRejectedValue(
      new ApiError(
        "500049 is outside your pincodes.",
        422,
        [],
        "PINCODE_OUTSIDE_FRANCHISEE"
      )
    );
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Pincode"), {
      target: { value: "500049" },
    });
    fireEvent.click(save());
    expect(
      await screen.findByText("500049 is outside your pincodes.")
    ).toBeInTheDocument();
  });

  it("lands BASE_OUTSIDE_INDIA on the coordinates", async () => {
    setBaseLocation.mockRejectedValue(
      new ApiError(
        "That location is outside India.",
        400,
        [],
        "BASE_OUTSIDE_INDIA"
      )
    );
    renderDialog();
    fireEvent.click(await screen.findByText("stub: click the map"));
    fireEvent.click(save());
    const field = lat().closest("[data-slot='field']") as HTMLElement;
    expect(
      await within(field).findByText("That location is outside India.")
    ).toBeInTheDocument();
  });

  it("when the tiles fail the notice appears and the boxes still save", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("stub: tiles fail"));
    expect(
      await screen.findByText(
        "The map couldn't load. Type the coordinates instead."
      )
    ).toBeInTheDocument();
    fireEvent.change(lat(), { target: { value: "17.44" } });
    fireEvent.change(lng(), { target: { value: "78.35" } });
    fireEvent.click(save());
    await waitFor(() => expect(setBaseLocation).toHaveBeenCalled());
  });

  it("opens on the technician's current point", async () => {
    renderDialog({
      latitude: 17.44012,
      longitude: 78.3489,
      pincode: null,
      source: "gps",
      setAt: "2026-10-15T05:30:00Z",
      setBySelf: true,
      setByName: "Ravi Kumar",
      setByRole: "Technician",
    });
    expect(await screen.findByTestId("pin")).toHaveTextContent(
      "17.44012,78.3489"
    );
    expect(lat()).toHaveValue("17.44012");
  });
});
