import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  useAddPart,
  useCatalogue,
  useRemovePart,
  useUpdatePart,
} from "@/hooks/useParts";
import { cn } from "@/lib/utils";
import type { Catalogue, SparePart } from "@/types/parts";
import type { ProductModel, ProductNode } from "@/types/product";
import { PART_NAME_MAX, validatePartName } from "./partSchemas";

/** Which row of the product master is being edited. */
export type PartsOwner =
  | { kind: "node"; node: ProductNode }
  | { kind: "model"; node: ProductNode; model: ProductModel };

/**
 * The spare-parts catalogue of one category or one product — Task 13 §5.6.
 * `parts.catalogue` (company Admin / National Head).
 *
 * **Its own dialog, not a section of `NodeFormDialog` / `ModelFormDialog`.**
 * `ModelFormDialog` is 1,337 lines; parts are written row by row (like
 * `ModelSerialsPanel`), not saved once with a form; they are a different
 * permission; and the inherited list must be shown read-only from ancestors,
 * which neither form knows.
 *
 * Mounted by the page only while open, so the drafts start clear.
 *
 * Writes are row-level and immediate; the editor re-reads the whole
 * `["parts","catalogue"]` prefix after each (a category's change moves every
 * descendant's inherited list). **Hide here** is how a product switches off a
 * name it inherits: it adds an own row of that name and marks it inactive — an
 * inactive own row hides the inherited name (Task 12 D11).
 */
export function SparePartsDialog({
  owner,
  open,
  onOpenChange,
}: {
  owner: PartsOwner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isModel = owner.kind === "model";
  const name = isModel ? owner.model.name : owner.node.name;
  const ref = {
    kind: owner.kind,
    id: isModel ? owner.model.id : owner.node.id,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Spare parts · {name}</DialogTitle>
          <DialogDescription>
            {isModel
              ? "This product offers these on top of its categories' parts."
              : `Every product under ${name} offers these, plus anything added further down.`}
          </DialogDescription>
        </DialogHeader>
        <PartsEditor owner={ref} />
      </DialogContent>
    </Dialog>
  );
}

/** Groups the inherited rows by the level they come from, nearest level first. */
function inheritedGroups(catalogue: Catalogue) {
  const groups = new Map<string, SparePart[]>();
  for (const part of catalogue.inherited) {
    const list = groups.get(part.ownerName);
    if (list) list.push(part);
    else groups.set(part.ownerName, [part]);
  }
  // `owner.path` is the categories above the owner, root first, so the nearest
  // is the LAST. A level not in the path (it should never happen) sorts last.
  const rank = (ownerName: string) => {
    const i = catalogue.owner.path.lastIndexOf(ownerName);
    return i === -1 ? -1 : i;
  };
  return [...groups.entries()].sort((a, b) => rank(b[0]) - rank(a[0]));
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function PartsEditor({ owner }: { owner: { kind: "node" | "model"; id: string } }) {
  const { data, isPending, isError, error, refetch } = useCatalogue(owner);
  const add = useAddPart(owner);
  const update = useUpdatePart();
  const remove = useRemovePart();

  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SparePart | null>(null);
  // Which inherited name is mid-"Hide here" (two sequential calls).
  const [hiding, setHiding] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="grid gap-2" aria-busy>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load the parts list"
        error={error}
        onRetry={() => refetch()}
      />
    );
  }

  const own = data.own;
  // Inherited names this owner has switched off with an inactive own row.
  const hiddenHere = new Set(own.filter((p) => !p.isActive).map((p) => key(p.name)));
  const groups = inheritedGroups(data);

  function submitNew() {
    const problem = validatePartName(newName, own);
    if (problem) {
      setNewError(problem);
      return;
    }
    setNewError(null);
    add.mutate(newName.trim().replace(/\s+/g, " "), {
      onSuccess: () => setNewName(""),
    });
  }

  function commitRename(part: SparePart) {
    const problem = validatePartName(draft, own, part.id);
    if (problem) {
      setRenameError(problem);
      return;
    }
    update.mutate(
      { id: part.id, name: draft.trim().replace(/\s+/g, " ") },
      {
        onSuccess: () => {
          setEditing(null);
          setRenameError(null);
        },
      }
    );
  }

  /** "Hide here" on an inherited name: add an own row, then switch it off. */
  async function hideInherited(part: SparePart) {
    setHiding(part.name);
    try {
      const created = await add.mutateAsync(part.name);
      await update.mutateAsync({ id: created.id, isActive: false });
    } catch {
      // Reported by the global mutation handler; the refetch shows the truth
      // (an active own row, if only the first call landed).
    } finally {
      setHiding(null);
    }
  }

  const busy = add.isPending || update.isPending || remove.isPending;

  return (
    <div className="grid gap-5">
      {groups.length > 0 ? (
        <section className="grid gap-3" aria-label="From above">
          <h3 className="text-[13px] font-semibold text-ink">From above</h3>
          {groups.map(([ownerName, parts]) => (
            <div key={ownerName} className="grid gap-1.5">
              <p className="text-xs text-ink-3">From {ownerName}</p>
              <ul className="flex flex-wrap gap-1.5">
                {parts.map((part) => {
                  const hidden = hiddenHere.has(key(part.name));
                  return (
                    <li
                      key={part.id}
                      className="flex items-center gap-1.5 rounded-md bg-surface-3 py-1 pr-1 pl-2 text-xs font-medium text-ink-2"
                    >
                      <span className={cn(hidden && "line-through")}>
                        {part.name}
                      </span>
                      {hidden ? (
                        <span className="text-[11px] font-normal text-ink-3">
                          hidden here
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={busy || hiding !== null}
                          onClick={() => void hideInherited(part)}
                        >
                          {hiding === part.name ? <Spinner /> : null}
                          Hide here
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="grid gap-2" aria-label="Added here">
        <h3 className="text-[13px] font-semibold text-ink">Added here</h3>
        {own.length === 0 ? (
          <p className="text-xs text-ink-3">No parts added here yet.</p>
        ) : (
          <ul className="scroll-slim max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {own.map((part) =>
              editing === part.id ? (
                <li key={part.id} className="grid gap-1 px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setRenameError(null);
                      }}
                      onKeyDown={(e) => {
                        // Enter saves, Escape abandons. Both stop here — this
                        // sits inside a dialog over the product page, and a
                        // bare Enter or Escape must not reach what is behind.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(part);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(null);
                          setRenameError(null);
                        }
                      }}
                      autoFocus
                      maxLength={PART_NAME_MAX}
                      aria-label={`Part name, was ${part.name}`}
                      aria-invalid={renameError ? true : undefined}
                      className="h-8 text-[13px]"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Save"
                      disabled={update.isPending || !draft.trim()}
                      onClick={() => commitRename(part)}
                    >
                      {update.isPending ? (
                        <Spinner />
                      ) : (
                        <Check className="size-3.5 text-ok" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Cancel"
                      onClick={() => {
                        setEditing(null);
                        setRenameError(null);
                      }}
                    >
                      <X className="size-3.5 text-ink-3" />
                    </Button>
                  </div>
                  {renameError ? (
                    <p role="alert" className="text-xs text-danger">
                      {renameError}
                    </p>
                  ) : null}
                </li>
              ) : (
                <li
                  key={part.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                >
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span
                      className={cn(
                        "wrap-anywhere text-ink",
                        !part.isActive && "text-ink-3 line-through"
                      )}
                    >
                      {part.name}
                    </span>
                    {!part.isActive ? (
                      <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">
                        Hidden
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${part.name}`}
                      title="Rename"
                      onClick={() => {
                        setEditing(part.id);
                        setDraft(part.name);
                        setRenameError(null);
                      }}
                    >
                      <Pencil className="size-3.5 text-ink-3" />
                    </Button>
                    {/* Reversible in one click — no confirm. Hiding only means
                        technicians stop seeing the part. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        update.mutate({ id: part.id, isActive: !part.isActive })
                      }
                    >
                      {part.isActive ? "Hide here" : "Show here"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${part.name}`}
                      title="Remove"
                      onClick={() => setRemoving(part)}
                    >
                      <Trash2 className="size-3.5 text-ink-3" />
                    </Button>
                  </span>
                </li>
              )
            )}
          </ul>
        )}

        {/* Not a <form>: this sits inside a dialog that may itself be opened
            from a page with one, and a bare Enter must add a part, not submit
            anything else. */}
        <div className="flex items-start gap-2">
          <div className="grid flex-1 gap-1">
            <Input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNew();
                }
              }}
              maxLength={PART_NAME_MAX}
              placeholder="Part name, e.g. Wall bracket"
              aria-label="Part name"
              aria-invalid={newError ? true : undefined}
              aria-describedby={newError ? "add-part-error" : undefined}
              disabled={add.isPending}
            />
            {newError ? (
              <p id="add-part-error" role="alert" className="text-xs text-danger">
                {newError}
              </p>
            ) : null}
          </div>
          <Button type="button" disabled={busy} onClick={submitNew}>
            {add.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Plus data-icon="inline-start" aria-hidden />
            )}
            Add part
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this part"}?`}
        description="Technicians stop seeing it. Requests that already name it keep it."
        confirmLabel="Remove part"
        isPending={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast.add({ title: `${removing.name} removed` });
              setRemoving(null);
            },
          })
        }
      />
    </div>
  );
}
