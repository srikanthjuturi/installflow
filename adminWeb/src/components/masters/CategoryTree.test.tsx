import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductModel, ProductNode } from "@/types/product";
import { CategoryTree } from "./CategoryTree";

/**
 * Task 13 §5.6 — **Spare parts** is its own grant (`parts.catalogue`), offered
 * on a category's row menu and a product chip's menu independently of
 * `masters.edit`. Presentation only: the server enforces it.
 */

const model = {
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
} as unknown as ProductModel;

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

const tree: ProductNode[] = [
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
        models: [model],
      }),
    ],
  }),
];

function open(label: RegExp) {
  fireEvent.click(screen.getAllByRole("button", { name: label })[0]);
}

describe("CategoryTree — spare parts", () => {
  afterEach(cleanup);

  it("offers a category's Spare parts item to a parts.catalogue holder without masters.edit", () => {
    const onAction = vi.fn();
    render(
      <CategoryTree nodes={tree} canEdit={false} canEditParts onAction={onAction} />
    );
    open(/Category actions for Television/);
    // Only that item — no Edit, no Remove.
    expect(screen.queryByText("Edit category")).toBeNull();
    expect(screen.queryByText("Remove category")).toBeNull();
    fireEvent.click(screen.getByText("Spare parts"));
    expect(onAction).toHaveBeenCalledWith({
      kind: "node-parts",
      node: expect.objectContaining({ id: "n2" }),
    });
  });

  it("puts Spare parts among the rest for a holder of both, before Remove", () => {
    render(<CategoryTree nodes={tree} canEdit canEditParts onAction={vi.fn()} />);
    open(/Category actions for Television/);
    const labels = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent);
    expect(labels).toContain("Edit category");
    expect(labels.indexOf("Spare parts")).toBe(labels.indexOf("Remove category") - 1);
  });

  it("offers no Spare parts item at all without parts.catalogue (acceptance 25)", () => {
    render(<CategoryTree nodes={tree} canEdit onAction={vi.fn()} />);
    open(/Category actions for Television/);
    expect(screen.queryByText("Spare parts")).toBeNull();
  });

  it("turns a product chip into a menu with Spare parts for a parts-only holder", () => {
    const onAction = vi.fn();
    render(
      <CategoryTree nodes={tree} canEdit={false} canEditParts onAction={onAction} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Sunview 43/ }));
    expect(screen.queryByText("Edit product")).toBeNull();
    fireEvent.click(screen.getByText("Spare parts"));
    expect(onAction).toHaveBeenCalledWith({
      kind: "model-parts",
      node: expect.objectContaining({ id: "n2" }),
      model: expect.objectContaining({ id: "m1" }),
    });
  });

  it("keeps a plain chip when the viewer holds neither grant", () => {
    render(<CategoryTree nodes={tree} canEdit={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Sunview 43/ })).toBeNull();
  });
});
