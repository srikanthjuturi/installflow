import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TravelRules } from "@/types/allowances";

const getTravelRules = vi.fn();
const saveTravelRules = vi.fn();
vi.mock("@/services/allowances", () => ({
  getTravelRules: (...a: unknown[]) => getTravelRules(...a),
  saveTravelRules: (...a: unknown[]) => saveTravelRules(...a),
}));

import { TravelRulesForm } from "./TravelRulesForm";

const SERVER: TravelRules = {
  freelancer: {
    freeKm: 20,
    stepKm: 2,
    paisePerStep: 1000,
    roadFactorPct: 130,
    maxPaisePerJob: 30000,
  },
  employee: {
    freeKm: 30,
    stepKm: 1,
    paisePerStep: 0,
    roadFactorPct: 130,
    maxPaisePerJob: 0,
  },
};

function renderForm(readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TravelRulesForm scope={{ kind: "franchise" }} readOnly={readOnly} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TravelRulesForm", () => {
  beforeEach(() => {
    getTravelRules.mockResolvedValue(SERVER);
    saveTravelRules.mockResolvedValue(SERVER);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("draws two cards, freelancers first, from the server's rules", async () => {
    renderForm();
    expect(await screen.findByText("Freelancers")).toBeInTheDocument();
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(
      (document.getElementById("travel-freelancer-freeKm") as HTMLInputElement).value
    ).toBe("20");
    expect(
      (document.getElementById("travel-freelancer-perStep") as HTMLInputElement).value
    ).toBe("10");
    expect(
      (document.getElementById("travel-employee-freeKm") as HTMLInputElement).value
    ).toBe("30");
  });

  it("the worked example reads Pays ₹40 for 21.6 km, before anything is saved", async () => {
    renderForm();
    expect(await screen.findByText("Pays ₹40")).toBeInTheDocument();
    expect(
      screen.getAllByText("21.6 km × 130 % = 28.1 km by road").length
    ).toBe(2); // one per card
    expect(saveTravelRules).not.toHaveBeenCalled();
  });

  it("an employee card with a ₹0 rate says it is off", async () => {
    renderForm();
    expect(
      await screen.findByText("Off — set an amount per step to switch it on.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pays nothing — the allowance is off")
    ).toBeInTheDocument();
  });

  it("a rate with a ₹0 maximum shows the server's sentence and sends nothing", async () => {
    renderForm();
    const max = (await screen.findAllByLabelText("Most per job (₹)"))[0];
    fireEvent.change(max, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save travel rules" }));
    expect(
      await screen.findByText(
        "Set a maximum per job — with a ₹0 maximum the allowance is always ₹0."
      )
    ).toBeInTheDocument();
    expect(saveTravelRules).not.toHaveBeenCalled();
  });

  it.each([
    ["Road factor (%)", "99", "Between 100 % and 300 %"],
    ["Road factor (%)", "301", "Between 100 % and 300 %"],
    ["Pay for every (km)", "0", "Between 1 and 50 km"],
    ["Pay for every (km)", "51", "Between 1 and 50 km"],
  ])("refuses %s = %s on the field", async (label, value, message) => {
    renderForm();
    const box = (await screen.findAllByLabelText(label))[0];
    fireEvent.change(box, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save travel rules" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(saveTravelRules).not.toHaveBeenCalled();
  });

  it("saves both types, in paise, without a franchisee", async () => {
    renderForm();
    await screen.findByText("Freelancers");
    fireEvent.click(screen.getByRole("button", { name: "Save travel rules" }));
    await waitFor(() => expect(saveTravelRules).toHaveBeenCalledTimes(1));
    const [scope, body] = saveTravelRules.mock.calls[0];
    expect(scope).toEqual({ kind: "franchise" });
    expect(body).toEqual(SERVER);
    expect(JSON.stringify(body)).not.toMatch(/franchisee/i);
  });

  it("read-only: every box disabled and no Save", async () => {
    renderForm(true);
    await screen.findByText("Freelancers");
    expect(screen.queryByRole("button", { name: "Save travel rules" })).toBeNull();
    for (const id of [
      "travel-freelancer-freeKm",
      "travel-freelancer-perStep",
      "travel-employee-maxPerJob",
    ]) {
      expect(document.getElementById(id)).toBeDisabled();
    }
  });

  it("a failed read shows the error state with Retry, not an empty form", async () => {
    getTravelRules.mockRejectedValue(new Error("boom"));
    renderForm();
    expect(await screen.findByText("Couldn't load the travel rules")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});
