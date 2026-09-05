/**
 * A grid of form fields — what `<FieldGroup className="grid …">` used to be.
 *
 * ## Why this exists
 *
 * `FieldGroup` carries `@container/field-group`, i.e. `container-type:
 * inline-size`. Making the query container and the grid the SAME element stops
 * Chrome re-running that element's layout when a sibling is inserted next to
 * it. The grid keeps zero tracks and every control inside collapses to height
 * 0 — present in the DOM, `offsetParent` null, invisible, with no error
 * anywhere and nothing in the console.
 *
 * It is not theoretical. Ticket intake hit it the moment a category was picked:
 * choosing one inserts the next dropdown and the billing line, and the whole
 * Vendor & product row vanished. Measured rather than guessed — touching any
 * style property on the container, or resizing the window by one pixel,
 * restored it instantly.
 *
 * So this is a plain div. `components/ui` is generated and must never be
 * hand-edited, which is why the fix is a separate component rather than a
 * change to `FieldGroup` itself.
 *
 * ## Why a component rather than a comment at each call site
 *
 * There are twenty of them. One place to hold the reason beats twenty copies of
 * it, and a future `<FieldGroup className="grid …">` is now the odd one out
 * rather than the house style.
 *
 * ## Why it keeps `data-slot="field-group"` but not the class
 *
 * The two are separate concerns, and only one of them is the bug.
 *
 *   * The CLASS is what makes the element a query container — and a container
 *     wrapped around the grid is not enough either. That was tried:
 *     `<FieldGroup><div class="grid">` reproduced the collapse on the intake
 *     form exactly. Only a grid with no container above it inside the section
 *     survives, so no container is what this renders.
 *   * The ATTRIBUTE is only read by an enclosing group's
 *     `*:data-[slot=field-group]:gap-4`. Dropping it would change spacing
 *     wherever these nest, so it stays.
 *
 * The cost is that `Field orientation="responsive"` — which queries
 * `@md/field-group` — will not respond inside a `FieldGrid`. Nothing in `src/`
 * uses that variant, and a grid is already deciding the columns. If one is ever
 * needed, put it in a real `FieldGroup` beside the grid, not in it.
 */
export function FieldGrid({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div data-slot="field-group" className={className} {...props}>
      {children}
    </div>
  );
}
