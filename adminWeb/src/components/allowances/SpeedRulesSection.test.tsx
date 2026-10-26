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
import type { SpeedCatalogue, SpeedRule } from "@/types/allowances";

const listSpeedRules = vi.fn();
const saveSpeedRule = vi.fn();
const deleteSpeedRule = vi.fn();
const getSpeedCatalogue = vi.fn();
vi.mock("@/services/allowances", () => ({
  listSpeedRules: (...a: unknown[]) => listSpeedRules(...a),
  saveSpeedRule: (...a: unknown[]) => saveSpeedRule(...a),
  deleteSpeedRule: (...a: unknown[]) => deleteSpeedRule(...a),
  getSpeedCatalogue: (...a: unknown[]) => getSpeedCatalogue(...a),
}));

import { SpeedRulesSection } from "./SpeedRulesSection";

const CATALOGUE: SpeedCatalogue = {
  nodes: [
    { id: "el", parentId: null, name: "Electronics", depth: 0, isLeaf: false, isActive: true },
    { id: "tv", parentId: "el", name: "Television", depth: 1, isLeaf: true, isActive: true },
  ],
  models: [{ id: "m1", nodeId: "tv", name: 'Sunview 43"', brandName: "Sunview" }],
};

const RULE: SpeedRule = {
  id: "r1",
  technicianType: "freelancer",
  targetKind: "node",
  targetId: "tv",
  targetName: "Television",
  targetPath: ["Electronics", "Television"],
  targetActive: true,
  rewardWithinHours: 12,
  penaltyAfterHours: 24,
  rewardPaise: 20000,
  penaltyPaise: 15000,
  overridesRuleId: null,
  overridesName: null,
  overriddenBy: 0,
  updatedAt: "2026-10-15T05:30:00Z",
};

function renderSection(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SpeedRulesSection scope={{ kind: "franchise" }} readOnly={readOnly} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SpeedRulesSection", () => {
  beforeEach(() => {
    listSpeedRules.mockResolvedValue([]);
    getSpeedCatalogue.mockResolvedValue(CATALOGUE);
    saveSpeedRule.mockResolvedValue(RULE);
    deleteSpeedRule.mockResolvedValue({ deleted: true });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("an empty matrix is an empty state with the way to add", async () => {
    renderSection();
    expect(await screen.findByText("No speed rules yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add rule/ })).toBeInTheDocument();
  });

  it("read-only draws the rows but no Add and no actions", async () => {
    listSpeedRules.mockResolvedValue([RULE]);
    renderSection(true);
    expect(await screen.findByText("Electronics › Television")).toBeInTheDocument();
    expect(screen.getByText("Within 12 h · ₹200")).toBeInTheDocument();
    expect(screen.getByText("After 24 h · −₹150")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add rule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });

  it("a failed read shows the error state with Retry", async () => {
    listSpeedRules.mockRejectedValue(new Error("boom"));
    renderSection();
    expect(await screen.findByText("Couldn't load the speed rules")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("adds a rule: picks Television from the franchise catalogue and saves paise", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Add rule/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose category or product" })
    );

    // The franchise door: the price-free catalogue, never /masters/nodes.
    await waitFor(() => expect(getSpeedCatalogue).toHaveBeenCalled());
    const picker = await screen.findByRole("dialog", {
      name: "Choose what this rule applies to",
    });
    fireEvent.click(
      await within(picker).findByRole("button", { name: /Chooses*Television/ })
    );

    const dialog = await screen.findByRole("dialog", { name: "Add speed rule" });
    await within(dialog).findByText("Television");
    fireEvent.change(within(dialog).getByLabelText("Reward if finished within (hours)"), {
      target: { value: "12" },
    });
    fireEvent.change(within(dialog).getByLabelText("Reward (₹)"), {
      target: { value: "200" },
    });
    fireEvent.change(within(dialog).getByLabelText("Penalty if finished after (hours)"), {
      target: { value: "24" },
    });
    fireEvent.change(within(dialog).getByLabelText("Penalty (₹)"), {
      target: { value: "150" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(saveSpeedRule).toHaveBeenCalledTimes(1));
    expect(saveSpeedRule.mock.calls[0]).toEqual([
      { kind: "franchise" },
      {
        technicianType: "freelancer",
        nodeId: "tv",
        modelId: null,
        rewardWithinHours: 12,
        penaltyAfterHours: 24,
        rewardPaise: 20000,
        penaltyPaise: 15000,
      },
    ]);
  });

  it("says Already has a rule for a taken target, per chosen type", async () => {
    listSpeedRules.mockResolvedValue([RULE]);
    renderSection();
    await screen.findByText("Electronics › Television");
    fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose category or product" })
    );
    const picker = await screen.findByRole("dialog", {
      name: "Choose what this rule applies to",
    });
    // Freelancer is the default type, and Television already has its rule.
    expect(await within(picker).findByText("Already has a rule")).toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: /Chooses*Television/ })).toBeNull();
    // The product beneath it is still free.
    expect(
      within(picker).getByRole("button", { name: /Chooses*Sunview 43"/ })
    ).toBeInTheDocument();
  });

  it("removing confirms first, naming the row, and closes only on success", async () => {
    listSpeedRules.mockResolvedValue([RULE]);
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Actions for the Electronics › Television rule (Freelancer)",
      })
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove rule" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Remove the rule for Electronics › Television (Freelancers)?",
    });
    expect(deleteSpeedRule).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove rule" }));
    await waitFor(() => expect(deleteSpeedRule).toHaveBeenCalledWith({ kind: "franchise" }, "r1"));
  });
});
