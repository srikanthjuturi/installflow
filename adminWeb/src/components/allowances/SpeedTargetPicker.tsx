import { Package } from "lucide-react";
import { CategoryTreeSkeleton } from "@/components/masters/CategoryTree";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PickNode } from "./pickTree";

export interface PickedTarget {
  kind: "node" | "model";
  id: string;
  name: string;
}

/**
 * The speed-rule target picker: categories and products as nested lists, a
 * **Choose** button on each.
 *
 * ## Why not `masters/CategoryTree`
 *
 * Its rows print technician counts and both prices, and its model chips carry
 * the vendor and a spec tooltip. The franchise catalogue (Task 11 W16) is
 * price-free and count-free BY DESIGN, so reusing it would mean faking those
 * numbers or forking its row components. This reuses its skeleton, its nesting
 * pattern and its card bands, and stays small.
 *
 * `isTaken(kind, id)` is asked per chosen technician type: Television may have
 * a rule for Freelancers and still be free for Employees. A taken target says
 * *Already has a rule* in place of Choose — the add form refuses the duplicate
 * anyway (the PUT is an upsert and would silently overwrite it).
 */
export function SpeedTargetPicker({
  nodes,
  isLoading,
  error,
  onRetry,
  isTaken,
  onChoose,
}: {
  nodes: PickNode[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  isTaken: (kind: "node" | "model", id: string) => boolean;
  onChoose: (target: PickedTarget) => void;
}) {
  if (error) {
    return (
      <ErrorState
        title="Couldn't load categories"
        error={error}
        onRetry={onRetry}
      />
    );
  }
  if (isLoading || !nodes) {
    return <CategoryTreeSkeleton categories={2} subcategories={2} />;
  }
  if (nodes.length === 0) {
    return <EmptyState icon={Package} title="No categories yet" />;
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="Categories and products">
      {nodes.map((node) => (
        <NodeRow
          key={node.id}
          node={node}
          isTaken={isTaken}
          onChoose={onChoose}
        />
      ))}
    </ul>
  );
}

function Choice({
  label,
  taken,
  onChoose,
}: {
  label: string;
  taken: boolean;
  onChoose: () => void;
}) {
  // A word in place of the button, never a greyed one: "disabled" explains
  // nothing, and colour alone is not a signal.
  return taken ? (
    <span className="shrink-0 text-xs font-medium text-ink-3">
      Already has a rule
    </span>
  ) : (
    <Button type="button" variant="outline" size="xs" onClick={onChoose}>
      Choose
      <span className="sr-only"> {label}</span>
    </Button>
  );
}

function NodeRow({
  node,
  isTaken,
  onChoose,
}: {
  node: PickNode;
  isTaken: (kind: "node" | "model", id: string) => boolean;
  onChoose: (target: PickedTarget) => void;
}) {
  return (
    <li>
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-md px-3 py-2",
          // Nesting is by padding, and static classes: one per depth the tree
          // may reach (MAX_NODE_DEPTH is 5).
          DEPTH_PAD[Math.min(node.depth, DEPTH_PAD.length - 1)],
          node.isActive ? "bg-surface-2" : "bg-surface-2 opacity-60"
        )}
      >
        <span className="min-w-0 text-[13px] font-semibold">
          {node.name}
          {!node.isActive ? (
            <span className="ml-2 text-xs font-normal text-ink-3">Paused</span>
          ) : null}
        </span>
        <Choice
          label={node.name}
          taken={isTaken("node", node.id)}
          onChoose={() => onChoose({ kind: "node", id: node.id, name: node.name })}
        />
      </div>

      {node.models.length > 0 ? (
        <ul
          className={cn("mt-1 flex flex-col gap-1", MODEL_PAD[Math.min(node.depth, MODEL_PAD.length - 1)])}
          aria-label={`Products in ${node.name}`}
        >
          {node.models.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line-2 px-3 py-1.5"
            >
              <span className="min-w-0 truncate text-[13px]">
                {m.name}
                <span className="ml-2 text-xs text-ink-3">{m.brandName}</span>
              </span>
              <Choice
                label={m.name}
                taken={isTaken("model", m.id)}
                onChoose={() =>
                  onChoose({ kind: "model", id: m.id, name: m.name })
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      {node.children.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1" aria-label={`Sub-categories in ${node.name}`}>
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              isTaken={isTaken}
              onChoose={onChoose}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One literal per depth — an interpolated `ml-${n}` would never be generated. */
const DEPTH_PAD = ["ml-0", "ml-3", "ml-6", "ml-9", "ml-12", "ml-14"] as const;
const MODEL_PAD = ["ml-3", "ml-6", "ml-9", "ml-12", "ml-14", "ml-16"] as const;
