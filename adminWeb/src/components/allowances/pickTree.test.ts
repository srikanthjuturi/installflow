import { describe, expect, it } from "vitest";
import type { SpeedCatalogue } from "@/types/allowances";
import type { ProductModel, ProductNode } from "@/types/product";
import { fromProductTree, fromSpeedCatalogue } from "./pickTree";

const node = (
  id: string,
  name: string,
  parentId: string | null,
  depth: number,
  o: Partial<SpeedCatalogue["nodes"][number]> = {}
) => ({ id, name, parentId, depth, isLeaf: false, isActive: true, ...o });

describe("fromSpeedCatalogue", () => {
  const catalogue: SpeedCatalogue = {
    nodes: [
      // Deliberately out of order: children before parents, names unsorted.
      node("oled", "OLED", "tv", 2, { isLeaf: true }),
      node("tv", "Television", "el", 1),
      node("ac", "Air conditioner", "el", 1, { isLeaf: true, isActive: false }),
      node("el", "Electronics", null, 0),
      node("hm", "Appliances", null, 0),
    ],
    models: [
      { id: "m2", nodeId: "oled", name: "Zeta 55", brandName: "Zeta" },
      { id: "m1", nodeId: "oled", name: 'Alpha 43"', brandName: "Alpha" },
    ],
  };

  it("nests by parentId at any depth", () => {
    const tree = fromSpeedCatalogue(catalogue);
    const electronics = tree.find((n) => n.id === "el")!;
    const tv = electronics.children.find((n) => n.id === "tv")!;
    expect(tv.children.map((n) => n.id)).toEqual(["oled"]);
    expect(tv.children[0].depth).toBe(2);
  });

  it("sorts siblings, roots and models by name", () => {
    const tree = fromSpeedCatalogue(catalogue);
    expect(tree.map((n) => n.name)).toEqual(["Appliances", "Electronics"]);
    const electronics = tree[1];
    expect(electronics.children.map((n) => n.name)).toEqual([
      "Air conditioner",
      "Television",
    ]);
    const oled = electronics.children[1].children[0];
    expect(oled.models.map((m) => m.name)).toEqual(['Alpha 43"', "Zeta 55"]);
  });

  it("attaches models to their node and carries the brand", () => {
    const oled = fromSpeedCatalogue(catalogue)[1].children[1].children[0];
    expect(oled.models[0]).toEqual({
      id: "m1",
      name: 'Alpha 43"',
      brandName: "Alpha",
    });
  });

  it("keeps an inactive node, flagged", () => {
    const ac = fromSpeedCatalogue(catalogue)[1].children[0];
    expect(ac.isActive).toBe(false);
    expect(ac.isLeaf).toBe(true);
  });

  it("an orphan becomes a root rather than vanishing", () => {
    const tree = fromSpeedCatalogue({
      nodes: [node("x", "Lost", "does-not-exist", 3)],
      models: [],
    });
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });

  it("a model on a missing node is dropped, not thrown", () => {
    const tree = fromSpeedCatalogue({
      nodes: [node("a", "A", null, 0)],
      models: [{ id: "m", nodeId: "nope", name: "M", brandName: "B" }],
    });
    expect(tree[0].models).toEqual([]);
  });

  it("an empty catalogue is an empty tree", () => {
    expect(fromSpeedCatalogue({ nodes: [], models: [] })).toEqual([]);
  });
});

describe("fromProductTree", () => {
  const model = (id: string, name: string, approvalStatus: string) =>
    ({
      id,
      name,
      brandName: "Sunview",
      approvalStatus,
    }) as unknown as ProductModel;

  const leaf = {
    id: "tv",
    parentId: "el",
    name: "Television",
    depth: 1,
    isLeaf: true,
    isActive: true,
    children: [],
    models: [
      model("m2", "Zed", "approved"),
      model("m1", "Able", "approved"),
      model("m3", "Pending one", "pending"),
    ],
  } as unknown as ProductNode;

  const root = {
    id: "el",
    parentId: null,
    name: "Electronics",
    depth: 0,
    isLeaf: false,
    isActive: true,
    children: [leaf],
    models: [],
  } as unknown as ProductNode;

  it("maps a two-level tree with its models", () => {
    const tree = fromProductTree([root]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Electronics");
    expect(tree[0].children[0].id).toBe("tv");
    expect(tree[0].children[0].isLeaf).toBe(true);
  });

  it("offers only approved models, sorted by name, without prices", () => {
    const models = fromProductTree([root])[0].children[0].models;
    expect(models.map((m) => m.name)).toEqual(["Able", "Zed"]);
    expect(Object.keys(models[0]).sort()).toEqual(["brandName", "id", "name"]);
  });
});
