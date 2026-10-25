import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalogue, SparePart } from "@/types/parts";
import type { ProductModel, ProductNode } from "@/types/product";

const getCatalogue = vi.fn();
const addPart = vi.fn();
const updatePart = vi.fn();
const removePart = vi.fn();
vi.mock("@/services/parts", () => ({
  getCatalogue: (...a: unknown[]) => getCatalogue(...a),
  addPart: (...a: unknown[]) => addPart(...a),
  updatePart: (...a: unknown[]) => updatePart(...a),
  removePart: (...a: unknown[]) => removePart(...a),
}));

import { SparePartsDialog } from "./SparePartsDialog";

const part = (o: Partial<SparePart>): SparePart => ({
  id: "p1",
  name: "Wall bracket",
  isActive: true,
  ownerKind: "node",
  ownerId: "n1",
  ownerName: "Television",
  ...o,
});

const catalogue = (o: Partial<Catalogue> = {}): Catalogue => ({
  owner: {
    kind: "model",
    id: "m1",
    name: "Sunview 43",
    path: ["Electronics", "Television"],
  },
  own: [],
  inherited: [],
  ...o,
});

const node = { id: "n1", name: "Television" } as ProductNode;
const model = { id: "m1", name: "Sunview 43" } as ProductModel;

function renderDialog(kind: "node" | "model" = "model") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SparePartsDialog
        open
        onOpenChange={vi.fn()}
        owner={kind === "model" ? { kind, node, model } : { kind, node }}
      />
    </QueryClientProvider>
  );
}

describe("SparePartsDialog", () => {
  beforeEach(() => {
    getCatalogue.mockReset();
    addPart.mockReset();
    updatePart.mockReset();
    removePart.mockReset();
  });
  afterEach(cleanup);

  it("shows skeletons while loading, then the empty state", async () => {
    getCatalogue.mockResolvedValue(catalogue());
    renderDialog();
    expect(document.querySelector("[aria-busy]")).not.toBeNull();
    expect(await screen.findByText("No parts added here yet.")).toBeInTheDocument();
    expect(
      screen.getByText("This product offers these on top of its categories' parts.")
    ).toBeInTheDocument();
  });

  it("words a category's dialog with the node's name", async () => {
    getCatalogue.mockResolvedValue(catalogue());
    renderDialog("node");
    expect(
      await screen.findByText(
        "Every product under Television offers these, plus anything added further down."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Spare parts · Television")).toBeInTheDocument();
  });

  it("says so, with Retry, when the list cannot be read", async () => {
    getCatalogue.mockRejectedValueOnce(new Error("down"));
    renderDialog();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("lists inherited parts under 'From {owner}', nearest level first", async () => {
    getCatalogue.mockResolvedValue(
      catalogue({
        inherited: [
          part({ id: "a", name: "Remote", ownerName: "Electronics" }),
          part({ id: "b", name: "Wall bracket", ownerName: "Television" }),
        ],
      })
    );
    renderDialog();
    const headings = await screen.findAllByText(/^From (Electronics|Television)$/);
    expect(headings.map((h) => h.textContent)).toEqual([
      "From Television",
      "From Electronics",
    ]);
  });

  it("refuses a duplicate in any case, client-side, without calling the server", async () => {
    getCatalogue.mockResolvedValue(
      catalogue({ own: [part({ id: "o1", name: "Door gasket", ownerKind: "model" })] })
    );
    renderDialog();
    const input = await screen.findByLabelText("Part name");
    fireEvent.change(input, { target: { value: "DOOR  gasket" } });
    fireEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByText("That part is already on this list")).toBeInTheDocument();
    expect(addPart).not.toHaveBeenCalled();
  });

  it("adds a part on Enter", async () => {
    getCatalogue.mockResolvedValue(catalogue());
    addPart.mockResolvedValue(part({ id: "new", name: "Remote" }));
    renderDialog();
    const input = await screen.findByLabelText("Part name");
    fireEvent.change(input, { target: { value: " Remote " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addPart).toHaveBeenCalledTimes(1));
    expect(addPart.mock.calls[0][1]).toBe("Remote");
  });

  it("marks an inherited name hidden by an inactive own row, and offers Show here on that row", async () => {
    getCatalogue.mockResolvedValue(
      catalogue({
        own: [part({ id: "o1", name: "Wall bracket", isActive: false, ownerKind: "model" })],
        inherited: [part({ id: "i1", name: "Wall bracket" })],
      })
    );
    renderDialog();
    expect(await screen.findByText("hidden here")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show here" }));
    await waitFor(() => expect(updatePart).toHaveBeenCalledWith("o1", { isActive: true }));
  });

  it("'Hide here' on an inherited chip adds an own row, THEN switches it off", async () => {
    getCatalogue.mockResolvedValue(
      catalogue({ inherited: [part({ id: "i1", name: "Wall bracket" })] })
    );
    addPart.mockResolvedValue(part({ id: "o9", name: "Wall bracket", ownerKind: "model" }));
    updatePart.mockResolvedValue(part({ id: "o9", isActive: false }));
    renderDialog();
    const chip = (await screen.findByText("Wall bracket")).closest("li")!;
    fireEvent.click(within(chip).getByRole("button", { name: "Hide here" }));
    await waitFor(() => expect(updatePart).toHaveBeenCalledWith("o9", { isActive: false }));
    expect(addPart.mock.invocationCallOrder[0]).toBeLessThan(
      updatePart.mock.invocationCallOrder[0]
    );
  });

  it("renames on Enter and abandons on Escape without saving", async () => {
    getCatalogue.mockResolvedValue(
      catalogue({ own: [part({ id: "o1", name: "Door gasket", ownerKind: "model" })] })
    );
    updatePart.mockResolvedValue(part({ id: "o1", name: "Door seal" }));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Rename Door gasket" }));

    let input = screen.getByLabelText("Part name, was Door gasket");
    fireEvent.change(input, { target: { value: "Throwaway" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(updatePart).not.toHaveBeenCalled();
    expect(screen.getByText("Door gasket")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename Door gasket" }));
    input = screen.getByLabelText("Part name, was Door gasket");
    fireEvent.change(input, { target: { value: "Door seal" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(updatePart).toHaveBeenCalledWith("o1", { name: "Door seal" })
    );
  });

  it("confirms before removing", async () => {
    getCatalogue.mockResolvedValue(
      catalogue({ own: [part({ id: "o1", name: "Door gasket", ownerKind: "model" })] })
    );
    removePart.mockResolvedValue(null);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Door gasket" }));
    expect(removePart).not.toHaveBeenCalled();
    expect(await screen.findByText("Remove Door gasket?")).toBeInTheDocument();
    expect(
      screen.getByText("Technicians stop seeing it. Requests that already name it keep it.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove part" }));
    await waitFor(() => expect(removePart).toHaveBeenCalledWith("o1"));
  });
});
