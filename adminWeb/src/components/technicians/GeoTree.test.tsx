import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverageTree } from "@/types/geo";

const getCoverageTree = vi.fn();
const getDistrictPincodes = vi.fn();
const expandCoverage = vi.fn();
vi.mock("@/services/geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/geo")>()),
  getCoverageTree: (...a: unknown[]) => getCoverageTree(...a),
  getDistrictPincodes: (...a: unknown[]) => getDistrictPincodes(...a),
  expandCoverage: (...a: unknown[]) => expandCoverage(...a),
}));

import { GeoTree } from "./GeoTree";
import { MAX_COVERAGE_PINCODES } from "./geoTreeMath";

const A = ["500001", "500002", "500003"];
const B = ["500010", "500011"];

/** Counts follow the selection, the way the server answers. */
function treeFor(selected: string[]): CoverageTree {
  const a = selected.filter((c) => A.includes(c)).length;
  const b = selected.filter((c) => B.includes(c)).length;
  return {
    regionId: "r-1",
    states: [
      {
        id: "s-1",
        name: "Telangana",
        pincodeCount: 5,
        selectedCount: a + b,
        districts: [
          { id: "d-a", name: "Hyderabad", pincodeCount: 3, selectedCount: a },
          { id: "d-b", name: "Medchal", pincodeCount: 2, selectedCount: b },
        ],
      },
    ],
  };
}

function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <GeoTree regionId="r-1" value={value} onChange={setValue} />
      <output data-testid="value">{value.join(",")}</output>
    </>
  );
}

function mount(initial: string[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness initial={initial} />
    </QueryClientProvider>
  );
}

const value = () => screen.getByTestId("value").textContent;

beforeEach(() => {
  getCoverageTree.mockImplementation(({ selected }: { selected: string[] }) =>
    Promise.resolve(treeFor(selected))
  );
  getDistrictPincodes.mockImplementation((id: string) =>
    Promise.resolve(id === "d-a" ? A : B)
  );
  expandCoverage.mockImplementation(
    ({
      stateIds,
      districtIds,
    }: {
      stateIds: string[];
      districtIds: string[];
    }) => {
      const pincodes = stateIds.length
        ? [...A, ...B]
        : districtIds[0] === "d-a"
          ? A
          : B;
      return Promise.resolve({ pincodes, count: pincodes.length });
    }
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GeoTree", () => {
  it("shows a loading state, then the states", async () => {
    mount();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    expect(await screen.findByRole("tree")).toBeInTheDocument();
    expect(screen.getByText("Telangana")).toBeInTheDocument();
  });

  it("opens with a saved coverage ticked and half-ticked", async () => {
    mount([...A, "500010"]);
    const state = await screen.findByRole("treeitem", { name: /Telangana/ });
    expect(state).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(screen.getByRole("button", { name: "Expand Telangana" }));
    expect(screen.getByRole("checkbox", { name: "Hyderabad" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("checkbox", { name: "Medchal" })).toHaveAttribute(
      "aria-checked",
      "mixed"
    );
    expect(
      screen.getByText("4 pincodes selected (max 500)")
    ).toBeInTheDocument();
  });

  it("ticking a district adds its codes, un-ticking removes them", async () => {
    mount(["999999"]);
    await screen.findByRole("tree");
    fireEvent.click(screen.getByRole("button", { name: "Expand Telangana" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hyderabad" }));
    await waitFor(() => expect(value()).toBe("999999," + A.join(",")));
    expect(expandCoverage).toHaveBeenCalledWith({
      stateIds: [],
      districtIds: ["d-a"],
    });
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Hyderabad" })).toHaveAttribute(
        "aria-checked",
        "true"
      )
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Hyderabad" }));
    await waitFor(() => expect(value()).toBe("999999"));
  });

  it("ticks a single pincode from a lazily opened district", async () => {
    mount();
    await screen.findByRole("tree");
    fireEvent.click(screen.getByRole("button", { name: "Expand Telangana" }));
    expect(getDistrictPincodes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Expand Medchal" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "500011" }));
    expect(value()).toBe("500011");
    expect(getDistrictPincodes).toHaveBeenCalledTimes(1);
  });

  it("refuses past the cap with a message and leaves the selection", async () => {
    const full = Array.from({ length: MAX_COVERAGE_PINCODES }, (_, i) =>
      String(100000 + i)
    );
    mount(full);
    await screen.findByRole("tree");
    fireEvent.click(screen.getByRole("checkbox", { name: "Telangana" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("up to 500");
    expect(value()).toBe(full.join(","));
  });

  it("shows the server's message when expanding is refused", async () => {
    expandCoverage.mockRejectedValueOnce(new Error("That is 6,000 pincodes."));
    mount(["500001"]);
    await screen.findByRole("tree");
    fireEvent.click(screen.getByRole("checkbox", { name: "Telangana" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is 6,000 pincodes."
    );
    expect(value()).toBe("500001");
  });

  it("removes one code from its chip and clears all", async () => {
    mount(["500001", "500002"]);
    await screen.findByRole("tree");
    fireEvent.click(screen.getByRole("button", { name: "Remove 500001" }));
    expect(value()).toBe("500002");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(value()).toBe("");
  });

  it("filters by name and says when nothing matches", async () => {
    mount();
    await screen.findByRole("tree");
    const box = screen.getByRole("searchbox", {
      name: "Search a state or district",
    });
    fireEvent.change(box, { target: { value: "medchal" } });
    expect(screen.getByRole("checkbox", { name: "Medchal" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Hyderabad" })).toBeNull();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(
      screen.getByText("No state or district matches that")
    ).toBeInTheDocument();
  });

  it("says so when the region has nothing to pick", async () => {
    getCoverageTree.mockResolvedValue({ regionId: "r-1", states: [] });
    mount();
    expect(
      await screen.findByText("Nothing to pick in this region")
    ).toBeInTheDocument();
  });

  it("shows an error with a retry", async () => {
    getCoverageTree.mockRejectedValueOnce(new Error("boom"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("tree")).toBeInTheDocument();
  });
});
