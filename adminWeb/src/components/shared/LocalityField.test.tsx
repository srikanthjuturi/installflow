import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostOffice } from "@/types/geo";

const geo = vi.hoisted(() => ({
  offices: [] as PostOffice[],
  officesCalls: [] as Array<[string, boolean | undefined]>,
}));

vi.mock("@/hooks/useGeo", () => ({
  usePincodeLookup: (code: string) => ({
    isPending: false,
    isError: false,
    data: /^\d{6}$/.test(code)
      ? {
          code,
          stateName: "Telangana",
          regionName: "South",
          districts: ["Hyderabad"],
        }
      : undefined,
  }),
  useInfinitePincodes: () => ({
    rows: [],
    total: 0,
    isFetching: false,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
  }),
  usePostOffices: (code: string, enabled?: boolean) => {
    geo.officesCalls.push([code, enabled]);
    return { data: enabled ? geo.offices : undefined, isFetching: false };
  },
}));

vi.mock("./useAddressAutocomplete", () => ({
  useAddressAutocomplete: () => ({
    available: false,
    options: [],
    loading: false,
    search: () => undefined,
    resolve: async () => null,
  }),
}));

import { AddressFields, type AddressValue } from "./AddressFields";

const office = (
  id: number,
  name: string,
  delivers = true,
  officeType: PostOffice["officeType"] = "PO"
): PostOffice => ({ id, name, officeType, delivers });

const BASE: AddressValue = {
  address: "1 Main Road",
  addressLine2: "",
  city: "Hyderabad",
  state: "Telangana",
  pincode: "500001",
};

function Harness({
  withLocality = true,
  initialLocality = "",
}: {
  withLocality?: boolean;
  initialLocality?: string;
}) {
  const [value, setValue] = useState<AddressValue>(BASE);
  const [locality, setLocality] = useState(initialLocality);
  return (
    <div>
      <AddressFields
        idPrefix="t"
        value={value}
        onChange={setValue}
        localityField={
          withLocality ? { value: locality, onChange: setLocality } : undefined
        }
      />
      <button onClick={() => setValue({ ...value, pincode: "500002" })}>
        change pincode
      </button>
      <output data-testid="locality">{locality}</output>
    </div>
  );
}

function renderIt(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  geo.officesCalls = [];
  geo.offices = [
    office(1, "Hyderabad", true, "HO"),
    office(2, "Moazzampura"),
    office(3, "Putlibowli", false),
  ];
});
afterEach(cleanup);

describe("AddressFields — Local area (Epic 7)", () => {
  it("is absent when the opt-in prop is not passed", () => {
    renderIt({ withLocality: false });
    expect(screen.queryByLabelText("Local area")).toBeNull();
    // ...and nothing was asked for either.
    expect(geo.officesCalls.every(([, enabled]) => enabled === false)).toBe(
      true
    );
  });

  it("lists the suggestions in the order given, marking non-delivering ones", () => {
    renderIt();
    fireEvent.focus(screen.getByLabelText("Local area"));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Hyderabad",
      "Moazzampura",
      "Putlibowli(no delivery)",
    ]);
  });

  it("fills the box when a suggestion is chosen", () => {
    renderIt();
    fireEvent.focus(screen.getByLabelText("Local area"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Moazzampura" }));
    expect(screen.getByTestId("locality").textContent).toBe("Moazzampura");
  });

  it("lets a typed value that is not in the list through", () => {
    renderIt();
    const box = screen.getByLabelText("Local area");
    fireEvent.change(box, { target: { value: "Some new colony" } });
    expect(screen.getByTestId("locality").textContent).toBe("Some new colony");
    // Nothing matches, so no list is drawn — it is just a text box.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears the value when the pincode changes", () => {
    renderIt({ initialLocality: "Moazzampura" });
    expect(screen.getByTestId("locality").textContent).toBe("Moazzampura");
    fireEvent.click(screen.getByText("change pincode"));
    expect(screen.getByTestId("locality").textContent).toBe("");
  });

  it("shows the hint when the directory has nothing for the pincode", () => {
    geo.offices = [];
    renderIt();
    expect(screen.getByText("Type your area")).toBeTruthy();
  });
});
