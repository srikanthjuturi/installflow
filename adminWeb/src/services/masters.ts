import {
  ApiError,
  matches,
  mockPage,
  mockResponse,
  notFound,
  sortRows,
} from "./client";
import { CATEGORIES, VENDORS } from "./mocks/masters";
import type { ListParams, Page } from "@/types/api";
import type { Category, Vendor } from "@/types";

/**
 * Sortable columns, and the value each one compares on.
 *
 * `since` is a four-digit year held as a string — compared as a number so
 * 2024 never sorts before 2021 on a string collation.
 */
const VENDOR_SORT = {
  name: (v: Vendor) => v.name,
  channel: (v: Vendor) => v.channel,
  tickets: (v: Vendor) => v.tickets,
  since: (v: Vendor) =>
    Number.isNaN(Number(v.since)) ? null : Number(v.since),
  status: (v: Vendor) => v.status,
};

/**
 * Vendors, server-paged.
 *
 * Search, filters, sort and the slice all happen here, standing in for the
 * backend — which is why no component filters or slices rows itself. With no
 * `sortBy` the seeded order is preserved, so the list opens exactly as the
 * approved prototype shows it.
 */
export function listVendors(params: ListParams = {}): Promise<Page<Vendor>> {
  return mockPage(() => {
    const { channel, status } = params.filters ?? {};

    const rows = VENDORS.filter(
      (v) =>
        matches(v, ["name"], params.search) &&
        (!channel || v.channel === channel) &&
        (!status || v.status === status)
    );

    return sortRows(rows, params.sortBy, params.sortDir, VENDOR_SORT);
  }, params);
}

export function listCategories(): Promise<Category[]> {
  return mockResponse(() => CATEGORIES);
}

/** The em dash the table already renders for a vendor with no credentials. */
const NO_KEY = "—";

/**
 * Credentials belong to the API channel and nowhere else.
 *
 * The real key is issued and held server-side; what the console receives is
 * the same masked form the seeded vendors carry. Nothing here — and nothing
 * in the forms above it — ever holds a full secret.
 */
function issueMaskedKey(name: string): string {
  const prefix =
    name
      .replace(/[^a-z]/gi, "")
      .slice(0, 2)
      .toLowerCase() || "vn";
  return `${prefix}_live_••••…•••`;
}

function nameTaken(name: string, exceptId?: string): boolean {
  const needle = name.toLowerCase();
  return VENDORS.some(
    (v) => v.name.toLowerCase() === needle && v.id !== exceptId
  );
}

export interface CreateVendorInput {
  name: string;
  channel: Vendor["channel"];
  status: Vendor["status"];
}

/**
 * Onboarding a vendor records how its tickets arrive (§4 — API, Excel or
 * Manual) and whether it is taking new ones. Lifetime volume starts at zero
 * and is counted from tickets, never typed in.
 */
export function createVendor(input: CreateVendorInput): Promise<Vendor> {
  return mockResponse(() => {
    const name = input.name.trim();
    if (nameTaken(name)) {
      throw new ApiError(`${name} is already onboarded`, 409);
    }

    const vendor: Vendor = {
      id: `VN-${String(VENDORS.length + 1).padStart(2, "0")}`,
      name,
      channel: input.channel,
      status: input.status,
      tickets: 0,
      key: input.channel === "API" ? issueMaskedKey(name) : NO_KEY,
      since: String(new Date().getFullYear()),
    };
    VENDORS.push(vendor);
    return vendor;
  });
}

export interface UpdateVendorInput {
  id: string;
  channel: Vendor["channel"];
  status: Vendor["status"];
}

/**
 * The two things ops change after onboarding: how tickets arrive, and whether
 * the vendor is taking them. The name is identity and the key is never
 * user-supplied, so neither is accepted here — moving on to the API channel
 * issues a key, moving off it revokes one.
 */
export function updateVendor(input: UpdateVendorInput): Promise<Vendor> {
  return mockResponse(() => {
    const vendor = VENDORS.find((v) => v.id === input.id);
    if (!vendor) notFound("Vendor", input.id);

    if (vendor.channel !== input.channel) {
      vendor.channel = input.channel;
      vendor.key =
        input.channel === "API" ? issueMaskedKey(vendor.name) : NO_KEY;
    }
    vendor.status = input.status;
    return vendor;
  });
}

export interface CreateCategoryInput {
  name: string;
  models: string[];
  active: boolean;
}

/**
 * A category is meaningless without at least one product model, so the list
 * is required. The certified-technician count is derived from technician
 * records — a brand-new category has nobody certified on it yet.
 */
export function createCategory(input: CreateCategoryInput): Promise<Category> {
  return mockResponse(() => {
    const name = input.name.trim();
    if (CATEGORIES.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new ApiError(`${name} already exists`, 409);
    }

    const models = input.models.map((m) => m.trim()).filter(Boolean);
    if (models.length === 0) {
      throw new ApiError("A category needs at least one product model", 422);
    }

    const category: Category = { name, models, techs: 0, active: input.active };
    CATEGORIES.push(category);
    return category;
  });
}
