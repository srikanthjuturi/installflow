import * as React from "react";
import type { CategoryToCreate } from "@/types/ticket";

/**
 * The categories an import would create — the confirmation the whole preview
 * exists for.
 *
 * **One line per chain, not an indented tree.** Each is the full path joined
 * with `›`, the separator `SubmissionSummary` and `ApprovalTable` already use
 * for a node path, so this needs no new visual idea and no indentation logic.
 *
 * The design is in the two weights: the part that ALREADY EXISTS is muted, and
 * the new levels are in full ink. That answers "what is new" and "where does it
 * hang" in one glance, and it stays readable when several chains share a new
 * prefix — which an indented tree does not, because the same new node then
 * appears under two roots or has to be merged.
 *
 * Capped, with the rest behind a disclosure, exactly as `GeoImportDialog` caps
 * its corrections list: sixty chains in a dialog is a wall.
 */
const SHOWN = 8;

export function NewCategoryTree({
  categories,
}: {
  categories: CategoryToCreate[];
}) {
  if (categories.length === 0) return null;
  const head = categories.slice(0, SHOWN);
  const rest = categories.slice(SHOWN);

  return (
    <div className="grid gap-1.5">
      <ul className="grid gap-1">
        {head.map((c) => (
          <ChainLine key={c.path} category={c} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-ink-3 hover:text-ink-2">
            {rest.length} more
          </summary>
          <ul className="mt-1 grid gap-1">
            {rest.map((c) => (
              <ChainLine key={c.path} category={c} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ChainLine({ category }: { category: CategoryToCreate }) {
  // `newSegments` names the levels that do not exist; everything else in the
  // path is already there. Matching by name rather than position because the
  // server sends only the names, and a chain cannot repeat a name under one
  // parent anyway — sibling names are unique.
  const isNew = new Set(category.newSegments);
  const segments = category.path.split(" › ");

  return (
    <li className="text-[12px] leading-5">
      {segments.map((segment, i) => (
        <React.Fragment key={`${segment}-${i}`}>
          {i > 0 ? <span className="px-1 text-ink-3">›</span> : null}
          <span
            className={
              isNew.has(segment) ? "font-medium text-ink" : "text-ink-3"
            }
          >
            {segment}
          </span>
        </React.Fragment>
      ))}
      {category.markedLeaf ? (
        <span className="ml-1.5 text-[11px] text-ink-3">
          — will be marked as the last sub-category
        </span>
      ) : null}
    </li>
  );
}
