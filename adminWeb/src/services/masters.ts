import { mockResponse } from "./client";
import { CATEGORIES, VENDORS } from "./mocks/masters";
import type { Category, Vendor } from "@/types";

export function listVendors(): Promise<Vendor[]> {
  return mockResponse(() => VENDORS);
}

export function listCategories(): Promise<Category[]> {
  return mockResponse(() => CATEGORIES);
}
