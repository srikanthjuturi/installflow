import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductModel, ProductNode } from "@/types/product";
import { CategoryTree } from "./CategoryTree";
import { modelSchema } from "./categorySchema";

/**
 * The vendor's SKU on a product — optional, trimmed, at most 64, and drawn as
 * the plain words "No SKU" when a product has none, never as a blank.
 */

const valid = {
  name: "Sunview 43",
  vendorId: "v1",
  brandId: "b1",
  sku: "",
  serviceTypes: ["Installation + Demo"],
  capacity: "",
  warrantyMonths: "",
  imageUrls: [],
  notes: "",
  parameters: [],
  status: "Active",
  technicianPayoutPaise: "100",
  vendorPricePaise: "200",
};

describe("model form — SKU rule", () => {
  it("treats a blank SKU as fine", () => {
    expect(modelSchema(true).safeParse(valid).success).toBe(true);
  });

  it("trims a SKU before it is checked or kept", () => {
    const parsed = modelSchema(true).safeParse({ ...valid, sku: "  WP-100  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sku).toBe("WP-100");
  });

  it("accepts exactly 64 characters and refuses 65", () => {
    expect(modelSchema(true).safeParse({ ...valid, sku: "A".repeat(64) }).success).toBe(
      true
    );
    const tooLong = modelSchema(true).safeParse({ ...valid, sku: "A".repeat(65) });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0].path).toEqual(["sku"]);
      expect(tooLong.error.issues[0].message).toMatch(/64/);
    }
  });

  it("applies to a vendor's own form too", () => {
    expect(modelSchema(false).safeParse({ ...valid, sku: "A".repeat(65) }).success).toBe(
      false
    );
  });
});

const model = (o: Partial<ProductModel>) =>
  ({
    id: "m1",
    nodeId: "n2",
    name: "Sunview 43",
    brandName: "Sunview",
    vendorName: "Crestline",
    imageUrls: [],
    serviceTypes: [],
    parameters: [],
    isActive: true,
    approvalStatus: "approved",
    serialCount: 0,
    capacity: null,
    warrantyMonths: null,
    technicianPayoutPaise: null,
    vendorPricePaise: null,
    rejectionReason: null,
    sku: null,
    ...o,
  }) as unknown as ProductModel;

const node = (o: Partial<ProductNode>): ProductNode =>
  ({
    parentId: null,
    depth: 0,
    path: [],
    iconKey: "tv",
    ownIconKey: null,
    isLeaf: false,
    parameters: [],
    isActive: true,
    sortOrder: 0,
    technicianCount: 0,
    hasRuleOverrides: false,
    children: [],
    models: [],
    ...o,
  }) as unknown as ProductNode;

describe("product list — SKU", () => {
  afterEach(cleanup);

  it("shows the SKU when there is one and 'No SKU' when there is not", () => {
    const tree = [
      node({
        id: "n1",
        name: "Electronics",
        children: [
          node({
            id: "n2",
            parentId: "n1",
            name: "Television",
            depth: 1,
            isLeaf: true,
            models: [
              model({ id: "m1", name: "Sunview 43", sku: "TV-43" }),
              model({ id: "m2", name: "Sunview 55", sku: null }),
            ],
          }),
        ],
      }),
    ];
    render(<CategoryTree nodes={tree} canEdit={false} onAction={vi.fn()} />);
    expect(screen.getByText("TV-43")).toBeInTheDocument();
    expect(screen.getAllByText("No SKU")).toHaveLength(1);
  });
});
