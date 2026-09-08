import * as React from "react";
import {
  Check,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  useAddSerials,
  useDeleteSerial,
  useModelSerials,
  useUpdateSerial,
} from "@/hooks/useProductMaster";
import { downloadSerialTemplate } from "@/services/productMaster";
import { MAX_SERIAL_LENGTH, MAX_SERIALS_PER_REQUEST } from "@/types/product";
import { SerialImportDialog } from "./SerialImportDialog";
import type { ProductModelSerial } from "@/types/product";

const PAGE_SIZE = 25;

/**
 * The serial numbers a product model covers — the master data ticket intake
 * validates a vendor's typed serial against.
 *
 * ## Zero serials is a STATE, and the panel says so
 *
 * `POST /tickets` refuses a serial only when the model has at least one loaded.
 * That is what let the check ship against a live catalogue with no backfill,
 * but it means an empty model is silently unguarded — so the empty state says
 * that in words rather than reading as "nothing here yet".
 *
 * ## Two ways in, because the requirement has two
 *
 * A paste box for a handful, and a spreadsheet import for a stock list. The
 * import is the geography importer's flow exactly: dry run, then commit.
 */
export function ModelSerialsPanel({
  modelId,
  modelName,
  portal = false,
}: {
  modelId: string;
  modelName: string;
  /**
   * Rendered on a VENDOR's own product page.
   *
   * The only difference it makes is WHICH endpoints the writes go to — the
   * `/masters/portal/*` twins, which the server pins to the caller's own
   * models. A vendor has the same four actions staff do: add, import, correct,
   * remove.
   *
   * It was read-plus-add here at first, because removing the last serial turns
   * intake checking off for that model and so lets a vendor lift its own gate.
   * That was raised and the call was made to hand it over; what survives is the
   * WARNING in `ConfirmDialog` when the last one is about to go, and an inline
   * edit so correcting a typo never has to go through a delete at all.
   */
  portal?: boolean;
}) {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [pendingDelete, setPendingDelete] =
    React.useState<ProductModelSerial | null>(null);

  // Debounced so a search does not fire per keystroke against a table that may
  // hold tens of thousands of rows.
  React.useEffect(() => {
    const id = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  const query = useModelSerials(modelId, {
    page,
    limit: PAGE_SIZE,
    search: term || undefined,
  });
  const removeSerial = useDeleteSerial(modelId, portal);
  const renameSerial = useUpdateSerial(modelId, portal);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const rows = query.data?.rows ?? [];
  const total = query.data?.pagination.totalRecords ?? 0;
  const pages = query.data?.pagination.totalPages ?? 1;
  // The unfiltered count. While a search is active `total` is the match count,
  // which must never be read as "this model is unguarded".
  const searching = term.length > 0;

  function commitRename(serialId: string) {
    const value = draft.trim();
    if (!value) return;
    renameSerial.mutate(
      { serialId, serial: value },
      { onSuccess: () => setEditing(null) }
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-ink">Serial numbers</p>
          <p className="text-[12px] text-ink-3">
            {searching
              ? `${total.toLocaleString()} matching`
              : total > 0
                ? `${total.toLocaleString()} on this model — intake checks against them`
                : "None yet — ticket intake does not check this model"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding((v) => !v)}
          >
            <Plus data-icon="inline-start" />
            Add manually
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImporting(true)}
          >
            <FileSpreadsheet data-icon="inline-start" />
            Import spreadsheet
          </Button>
        </div>
      </div>

      {adding ? (
        <AddSerialsForm
          modelId={modelId}
          portal={portal}
          onDone={() => {
            setAdding(false);
            setPage(1);
          }}
        />
      ) : null}

      {total > 0 || searching ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a serial number"
            aria-label="Find a serial number"
            className="pl-8"
          />
        </div>
      ) : null}

      {query.isPending ? (
        <div className="grid gap-1.5" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load the serial numbers"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : rows.length === 0 ? (
        searching ? (
          <EmptyState
            icon={Search}
            title="No match"
            description={`Nothing on ${modelName} matches "${term}".`}
          />
        ) : (
          <EmptyState
            icon={FileSpreadsheet}
            title="No serial numbers yet"
            /* Second person on the portal, third on the ops screen — the
               sentence describes the reader in one case and somebody else in
               the other, and "a vendor can raise…" reads as a stranger's
               problem to the vendor it is actually about. */
            description={
              portal
                ? "Until you load at least one, a ticket for this product is " +
                  "accepted with any serial number — nothing checks it."
                : "Ticket intake does not check this model until at least one " +
                  "is loaded — a vendor can raise a ticket quoting any serial."
            }
            action={
              <Button type="button" onClick={() => setImporting(true)}>
                <FileSpreadsheet data-icon="inline-start" />
                Import spreadsheet
              </Button>
            }
          />
        )
      ) : (
        <>
          <ul className="scroll-slim max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.map((row) =>
              editing === row.id ? (
                <li key={row.id} className="flex items-center gap-1.5 px-3 py-1.5">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter saves, Escape abandons. Both stop here — this
                      // sits inside the product form, and a bare Enter would
                      // otherwise submit that.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(row.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                      }
                    }}
                    autoFocus
                    maxLength={MAX_SERIAL_LENGTH}
                    aria-label={`Serial number, was ${row.serial}`}
                    className="h-8 font-mono text-[13px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Save"
                    disabled={renameSerial.isPending || !draft.trim()}
                    onClick={() => commitRename(row.id)}
                  >
                    {renameSerial.isPending ? (
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
                    onClick={() => setEditing(null)}
                  >
                    <X className="size-3.5 text-ink-3" />
                  </Button>
                </li>
              ) : (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <span className="font-mono text-[13px] text-ink">
                    {row.serial}
                  </span>
                  <span className="flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${row.serial}`}
                      onClick={() => {
                        setEditing(row.id);
                        setDraft(row.serial);
                      }}
                    >
                      <Pencil className="size-3.5 text-ink-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${row.serial}`}
                      onClick={() => setPendingDelete(row)}
                    >
                      <Trash2 className="size-3.5 text-ink-3" />
                    </Button>
                  </span>
                </li>
              )
            )}
          </ul>

          {pages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-ink-3">
                Page {page} of {pages}
              </p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pages || query.isFetching}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <button
        type="button"
        onClick={() => {
          void downloadSerialTemplate().catch(() =>
            toast.add({ title: "Couldn't download the template" })
          );
        }}
        className="inline-flex w-fit items-center gap-1.5 text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        <Download className="size-3.5" aria-hidden />
        Download the spreadsheet template
      </button>

      <SerialImportDialog
        open={importing}
        onOpenChange={setImporting}
        modelId={modelId}
        modelName={modelName}
        portal={portal}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Remove this serial number?"
        /* The last one is a different question from any other one, and the
           warning is what remains of the argument against letting a vendor
           delete at all: this is the click that turns the check off. Second
           person on the portal, because there it is the reader's own gate. */
        description={
          total === 1
            ? `${pendingDelete?.serial} is the last one on ${modelName}. ` +
              (portal
                ? "Removing it turns the intake check off for this product — " +
                  "a ticket will then be accepted with any serial number."
                : "Removing it turns off the intake check for this model — a " +
                  "vendor will be able to raise a ticket quoting any serial.")
            : `${pendingDelete?.serial} will no longer be accepted at ticket intake for ${modelName}.`
        }
        confirmLabel="Remove"
        isPending={removeSerial.isPending}
        onConfirm={() => {
          const row = pendingDelete;
          if (!row) return;
          removeSerial.mutate(row.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast.add({ title: "Serial number removed" });
            },
          });
        }}
      />
    </div>
  );
}

/**
 * The manual half. A textarea rather than a single input, because the natural
 * way somebody adds twenty serials is to paste a column out of a spreadsheet —
 * the server trims, drops blanks and de-duplicates, so a paste with a trailing
 * newline is not an error the user has to see.
 */
function AddSerialsForm({
  modelId,
  portal,
  onDone,
}: {
  modelId: string;
  portal: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = React.useState("");
  const addSerials = useAddSerials(modelId, portal);

  // Split on newlines AND commas: both are how a pasted column arrives,
  // depending on which application it was copied from.
  const parsed = React.useMemo(
    () =>
      Array.from(
        new Set(
          value
            .split(/[\n,;\t]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s)
        )
      ),
    [value]
  );
  const tooMany = parsed.length > MAX_SERIALS_PER_REQUEST;

  return (
    <div className="grid gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        autoFocus
        placeholder={"One per line, or paste a column\nSN-000001\nSN-000002"}
        aria-label="Serial numbers to add"
        className="font-mono text-[13px]"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={`text-[12px] ${tooMany ? "text-danger" : "text-ink-3"}`}
          role={tooMany ? "alert" : undefined}
        >
          {tooMany
            ? `${parsed.length.toLocaleString()} is over the ${MAX_SERIALS_PER_REQUEST} limit — use the spreadsheet import.`
            : `${parsed.length} serial${parsed.length === 1 ? "" : "s"} ready`}
        </p>
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={parsed.length === 0 || tooMany || addSerials.isPending}
            onClick={() =>
              addSerials.mutate(parsed, {
                onSuccess: (result) => {
                  toast.add({
                    title: result.added
                      ? `${result.added} serial number${result.added === 1 ? "" : "s"} added`
                      : "Nothing to add",
                    description: result.duplicates
                      ? `${result.duplicates} already on this model.`
                      : undefined,
                  });
                  setValue("");
                  onDone();
                },
              })
            }
          >
            {addSerials.isPending ? <Spinner data-icon="inline-start" /> : null}
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
