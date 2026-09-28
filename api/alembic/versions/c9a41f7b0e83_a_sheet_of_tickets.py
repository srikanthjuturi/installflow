"""A sheet of tickets: resolve a category chain in one call, and remember a reference

Two things the bulk ticket importer needs, and neither can live in the service.

## `resolve_category_chains` — the first function this schema has ever carried

The importer reads a comma-separated Category column — `Electronics, Television,
Android TV, OLED` — and has to resolve every level of it, creating what is
missing, for up to 500 rows. Done in Python that is one probe per level per
distinct chain, each a round trip; done here the whole file is one call.

Three things about the body are load-bearing, and each one is a trap somebody
will otherwise re-introduce:

* **The `'00000000-…'::uuid` sentinel is written INLINE, twice, never as a
  plpgsql `CONSTANT`.** `uq_product_nodes_parent_name_lower` is an index on the
  EXPRESSION `COALESCE(parent_id, '000…'::uuid)`, and matching an expression
  index needs the planner to see that expression. A literal always matches. A
  plpgsql variable reaches the query as a parameter, and then it depends on the
  plan: a custom plan substitutes the value and matches, a GENERIC plan — which
  Postgres may switch to after the fifth execution, exactly when a session has
  been importing for a while — leaves `$1` unfolded and cannot. On the `INSERT`
  that is a loud "no unique or exclusion constraint matching the inference
  specification"; on the `SELECT` it is silent, and the probe degrades to a scan
  of every node in the database. Measured on a 40-row dev tree the planner
  prefers a seq scan either way, so this cannot be caught by eye: force it with
  `SET enable_seqscan = off` and confirm
  `Index Scan using uq_product_nodes_parent_name_lower` with all three
  expressions in the `Index Cond`.

* **`ON CONFLICT … DO NOTHING` returns no row**, so a lost race re-SELECTs what
  the winner wrote. That is correct only under READ COMMITTED, where each
  statement takes a fresh snapshot — which is what `app/core/database.py` runs.
  Anyone setting an `isolation_level` on that engine has to revisit this.

* **`depth` and `ancestor_ids` are computed exactly as `masters.service`
  `create_node` computes them**, by induction from the parent. That module's
  docstring calls itself the only writer of those two columns; this is now the
  second, and the three CHECKs (`depth`, `depth_matches_ancestors`, `no_cycle`)
  are what catch it if the two ever disagree. `models/product.py` warns that a
  wrongly-built `ancestor_ids` breaks technician eligibility SILENTLY — jobs
  simply stop being offered — so that is not a theoretical guard.

It returns per-segment rows carrying a `conflict` code rather than raising. A
raise would abort the importer's transaction and take the good rows with it, and
"rejected rows never block the file" is the whole contract of this importer
family (`geo.import_geography`, `masters.import_serials`).

It is **additive**, with one deliberate exception. It never renames, re-parents,
un-pauses or un-deletes anything. It will tick `is_leaf` on an existing node that
has no children, because that is the one edit the sheet genuinely asserts ("this
is where products go") and refusing it would strand a vendor who cannot edit a
node staff created. That edit is reported as `marked_leaf` so the console names
it before anybody confirms — never silent.

⚠ `sort_order` is left at its default of 0, where `create_node` computes
`max + 1` among siblings. Doing that per segment needs a correlated aggregate
and a lock to be race-free, for a column that only decides display order.
Imported categories therefore sort first among their siblings until somebody
reorders them.

`SECURITY INVOKER` (spelled out, not merely defaulted) and a pinned
`search_path`. `p_company_id` is always the principal's, never a request value,
and every statement in the body filters on it — including the child count and
the UPDATE. `audit_tenancy` reads models and DDL and cannot see inside a plpgsql
body, so the composite self FK `fk_product_nodes_company_parent` is the
structural backstop: the function writes THROUGH the table, so a node under
another company's parent is impossible rather than merely unchecked.

## `tickets.external_ref` — what makes a re-upload safe

The importer's whole flow asks somebody to upload the same file twice: rows
naming an unpriced product are rejected, a National Head prices it, and the file
goes in again. Without a handle, the rows that succeeded the first time succeed
again — and `charge_ticket` bills credits for every duplicate. Nothing already on
the table could catch it: `serial_number` is deliberately NOT unique, because a
service call on a unit installed months ago repeats it.

So a nullable `external_ref` carrying the vendor's own job or order number, with
a partial unique per vendor. A row whose reference is already present is SKIPPED
and reported, not rejected, which turns the second upload into a documented
no-op. Same shape as `uq_credit_recharges_credited_utr` ("one UTR buys credits
once"), and the handle the `API` intake channel will need when it lands.

Partial on `deleted_at IS NULL` (hard rule 6) and on `external_ref IS NOT NULL`,
so every existing ticket and every Manual one is untouched — NULLs are distinct
in a unique index anyway, but saying it keeps the index small. Hand-written via
`op.execute` because it is both partial and functional, so `--autogenerate` will
want to drop it on every run: delete that drop (hard rule 8).

Nullable with no backfill and no default, so the running API — which knows
nothing of this column — keeps inserting tickets unchanged. That is what lets
production be migrated BEFORE the new code is published, in that order, as
`api/AGENTS.md` → Environments requires.

Downgrade drops the function, the index and the column, and touches no other
data. That is the `a7c93f5e2b18` lesson: its downgrade was reversible DDL that
deleted the entire product tree through a cascade nobody had re-read.

Revision ID: c9a41f7b0e83
Revises: 70cdde973bb1
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9a41f7b0e83"
down_revision: Union[str, Sequence[str], None] = "70cdde973bb1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Frozen here, on purpose. A migration must replay exactly what it replayed the
#: day it ran, so it never imports SQL from application code. A change to this
#: function is a NEW migration issuing `CREATE OR REPLACE`, whose downgrade
#: restores this text verbatim.
RESOLVE_CATEGORY_CHAINS = """
CREATE OR REPLACE FUNCTION resolve_category_chains(
    p_company_id uuid,
    p_chains     jsonb,
    p_actor      uuid,
    p_dry_run    boolean
)
RETURNS TABLE (
    chain_ix     int,
    segment_ix   int,
    resolved_id  uuid,
    segment_name text,
    node_depth   smallint,
    action       text,
    conflict     text
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
    -- core.product_tree.MAX_NODE_DEPTH and product_nodes.name's String(64).
    c_max_depth CONSTANT int := 5;
    c_max_name  CONSTANT int := 64;

    v_ci        int;
    v_chain     jsonb;
    v_n         int;
    v_si        int;
    v_seg       text;
    v_last      boolean;
    v_virtual   boolean;

    v_parent      uuid;
    v_pdepth      int;
    v_pancestors  uuid[];
    v_pleaf       boolean;

    v_depth       int;
    v_ancestors   uuid[];
    v_children    int;

    v_id        uuid;
    v_fdepth    int;
    v_fanc      uuid[];
    v_fleaf     boolean;
    v_factive   boolean;
BEGIN
    FOR v_ci, v_chain IN
        SELECT (t.ord - 1)::int, t.val
          FROM jsonb_array_elements(p_chains) WITH ORDINALITY AS t(val, ord)
    LOOP
        chain_ix     := v_ci;
        segment_ix   := 0;
        resolved_id  := NULL;
        segment_name := NULL;
        node_depth   := NULL;
        action       := NULL;
        conflict     := NULL;

        v_n          := jsonb_array_length(v_chain);
        v_parent     := NULL;
        v_pdepth     := -1;
        v_pancestors := '{}'::uuid[];
        v_pleaf      := false;
        v_virtual    := false;

        IF v_n = 0 THEN
            conflict := 'NAME_EMPTY';
            RETURN NEXT;
            CONTINUE;
        END IF;

        IF v_n > c_max_depth + 1 THEN
            conflict := 'TOO_MANY_SEGMENTS';
            RETURN NEXT;
            CONTINUE;
        END IF;

        FOR v_si IN 0 .. v_n - 1 LOOP
            v_seg  := btrim(coalesce(v_chain ->> v_si, ''));
            v_last := (v_si = v_n - 1);

            segment_ix   := v_si;
            segment_name := v_seg;
            resolved_id  := NULL;
            node_depth   := NULL;
            action       := NULL;
            conflict     := NULL;

            -- Shape first: everything answerable without touching a row.
            IF v_seg = '' THEN
                conflict := 'NAME_EMPTY'; RETURN NEXT; EXIT;
            END IF;
            IF char_length(v_seg) > c_max_name THEN
                conflict := 'NAME_TOO_LONG'; RETURN NEXT; EXIT;
            END IF;
            -- A leaf holds products, not more levels. The sentence
            -- masters.service.create_node raises, caught one level earlier.
            IF v_pleaf THEN
                conflict := 'PARENT_IS_LEAF'; RETURN NEXT; EXIT;
            END IF;
            IF v_pdepth + 1 > c_max_depth THEN
                conflict := 'TOO_DEEP'; RETURN NEXT; EXIT;
            END IF;
            -- `leaf_below_root`: a top-level category can never hold products.
            IF v_last AND v_si = 0 THEN
                conflict := 'LEAF_AT_ROOT'; RETURN NEXT; EXIT;
            END IF;

            v_depth     := v_pdepth + 1;
            v_ancestors := CASE WHEN v_parent IS NULL
                                THEN '{}'::uuid[]
                                ELSE v_pancestors || v_parent END;

            -- Once a dry run has passed its first miss, nothing below can
            -- exist either: a node cannot hang off a parent that does not.
            -- So it stops querying and reports the rest as new.
            IF v_virtual THEN
                action     := 'would_create';
                node_depth := v_depth::smallint;
                RETURN NEXT;
                v_pdepth := v_depth; v_pancestors := v_ancestors; v_pleaf := v_last;
                CONTINUE;
            END IF;

            -- INLINE sentinel. See the migration docstring: a variable here
            -- turns this probe into a sequential scan, silently.
            SELECT n.id, n.depth, n.ancestor_ids, n.is_leaf, n.is_active
              INTO v_id, v_fdepth, v_fanc, v_fleaf, v_factive
              FROM product_nodes n
             WHERE n.company_id = p_company_id
               AND n.deleted_at IS NULL
               AND COALESCE(n.parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
                   = COALESCE(v_parent, '00000000-0000-0000-0000-000000000000'::uuid)
               AND lower(n.name) = lower(v_seg)
             LIMIT 1;

            IF NOT FOUND THEN
                IF p_dry_run THEN
                    v_virtual  := true;
                    action     := 'would_create';
                    node_depth := v_depth::smallint;
                    RETURN NEXT;
                    v_pdepth := v_depth; v_pancestors := v_ancestors; v_pleaf := v_last;
                    CONTINUE;
                END IF;

                INSERT INTO product_nodes
                    (company_id, parent_id, name, depth, ancestor_ids,
                     is_leaf, created_by)
                VALUES
                    (p_company_id, v_parent, v_seg, v_depth::smallint, v_ancestors,
                     v_last, p_actor)
                ON CONFLICT (company_id,
                             COALESCE(parent_id,
                                      '00000000-0000-0000-0000-000000000000'::uuid),
                             lower(name))
                     WHERE deleted_at IS NULL
                DO NOTHING
                RETURNING id, depth, ancestor_ids, is_leaf, is_active
                     INTO v_id, v_fdepth, v_fanc, v_fleaf, v_factive;

                IF NOT FOUND THEN
                    -- Another importer created this segment between the probe
                    -- and the insert. Read what they wrote and carry on; a
                    -- fresh snapshot under READ COMMITTED sees their commit.
                    SELECT n.id, n.depth, n.ancestor_ids, n.is_leaf, n.is_active
                      INTO v_id, v_fdepth, v_fanc, v_fleaf, v_factive
                      FROM product_nodes n
                     WHERE n.company_id = p_company_id
                       AND n.deleted_at IS NULL
                       AND COALESCE(n.parent_id,
                                    '00000000-0000-0000-0000-000000000000'::uuid)
                           = COALESCE(v_parent,
                                      '00000000-0000-0000-0000-000000000000'::uuid)
                       AND lower(n.name) = lower(v_seg)
                     LIMIT 1;

                    IF v_id IS NULL THEN
                        -- They rolled back after all. Vanishingly rare, and
                        -- reported rather than guessed at: the row is rejected
                        -- and the file can simply be uploaded again.
                        conflict := 'RACE_LOST'; RETURN NEXT; EXIT;
                    END IF;
                    action := 'found';
                ELSE
                    action := 'created';
                END IF;
            ELSE
                action := 'found';
            END IF;

            -- Intake refuses a paused path, so the importer says so here
            -- rather than letting every row fail further down for no reason.
            IF NOT v_factive THEN
                conflict    := 'INACTIVE';
                resolved_id := v_id;
                node_depth  := v_fdepth::smallint;
                RETURN NEXT; EXIT;
            END IF;

            IF v_last AND NOT v_fleaf THEN
                SELECT count(*)
                  INTO v_children
                  FROM product_nodes c
                 WHERE c.company_id = p_company_id
                   AND c.parent_id = v_id
                   AND c.deleted_at IS NULL;

                IF v_children > 0 THEN
                    conflict    := 'HAS_CHILDREN';
                    resolved_id := v_id;
                    node_depth  := v_fdepth::smallint;
                    RETURN NEXT; EXIT;
                ELSIF p_dry_run THEN
                    action := 'would_mark_leaf';
                ELSE
                    -- `updated_at` is set explicitly: the model's `onupdate` is
                    -- SQLAlchemy-side and does not fire for SQL issued here.
                    UPDATE product_nodes
                       SET is_leaf    = true,
                           updated_by = p_actor,
                           updated_at = now()
                     WHERE id = v_id
                       AND company_id = p_company_id;
                    v_fleaf := true;
                    action  := 'marked_leaf';
                END IF;
            END IF;

            resolved_id := v_id;
            node_depth  := v_fdepth::smallint;
            RETURN NEXT;

            v_parent     := v_id;
            v_pdepth     := v_fdepth;
            v_pancestors := v_fanc;
            v_pleaf      := v_fleaf;
        END LOOP;
    END LOOP;
END;
$fn$;
"""

DROP_RESOLVE_CATEGORY_CHAINS = (
    # The full argument list, so a later overload cannot make the name
    # ambiguous and leave the drop silently matching nothing.
    "DROP FUNCTION IF EXISTS "
    "resolve_category_chains(uuid, jsonb, uuid, boolean)"
)


def upgrade() -> None:
    # `sa.text()`, not `sa.DDL()`: DDL does %-substitution and this body must
    # pass through untouched. `:=` and `::` are safe with `text()` — its
    # bind-parameter regex needs a word character after the colon — so the one
    # thing this SQL must never contain is a bare `:word`.
    op.execute(sa.text(RESOLVE_CATEGORY_CHAINS))

    op.add_column(
        "tickets",
        sa.Column("external_ref", sa.String(length=64), nullable=True),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_tickets_vendor_external_ref ON tickets "
        "(company_id, vendor_id, lower(external_ref)) "
        "WHERE external_ref IS NOT NULL AND deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_tickets_vendor_external_ref")
    op.drop_column("tickets", "external_ref")
    op.execute(DROP_RESOLVE_CATEGORY_CHAINS)
