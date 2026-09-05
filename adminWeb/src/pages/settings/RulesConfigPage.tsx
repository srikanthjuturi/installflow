import { useState } from "react";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { NodeRulesForm } from "@/components/settings/NodeRulesForm";
import { RulesForm } from "@/components/settings/RulesForm";
import { toNodeDraft } from "@/components/settings/nodeRulesSchema";
import { toDraft } from "@/components/settings/rulesSchema";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useNodeOptions } from "@/hooks/useProductMaster";
import type { NodeOption } from "@/types/product";
import {
  useNodeRules,
  useRulesConfig,
  useSaveNodeRules,
  useSaveRulesConfig,
} from "@/hooks/useSettings";

/** The scope selector's value for "the whole company". */
const COMPANY = "company";

/** `Electronics › Television` — the root, then the path below it. */
const nodeLabel = (option: NodeOption) =>
  `${option.rootName}${option.pathLabel ? ` › ${option.pathLabel}` : ""}`;

/**
 * Rules configuration, for the company or for one product category.
 *
 * ## Why a scope selector rather than a rules button in the tree
 *
 * Every rule here is now overridable per catalogue node, inheriting downward.
 * That could have been a dialog off Categories & products — but then the
 * company baseline and its overrides would live on two screens, and the only
 * way to see what a category actually resolves to would be to remember what the
 * other screen said. One screen, one picker: the numbers you are changing and
 * the numbers they are inheriting from are the same six cards.
 *
 * `?node=<id>` is how the tree deep-links in, so the badge on a category lands
 * you on its own rules rather than on the company's.
 */
export default function RulesConfigPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get("node") ?? COMPANY;
  const nodeId = scope === COMPANY ? null : scope;

  const { data: rules, isLoading, isError, error, refetch } = useRulesConfig();
  const save = useSaveRulesConfig();

  const { options } = useNodeOptions();
  const nodeRules = useNodeRules(nodeId);
  const saveNode = useSaveNodeRules(nodeId ?? "");

  /**
   * The category the tree deep-linked in on, captured ONCE.
   *
   * Two things follow from freezing it. Switching scope on this page does not
   * make the way out disappear — and it does not silently re-point Back at a
   * category you never came from. Arriving from the sidebar captures null, so
   * no back button appears where there is nothing to go back to.
   */
  const [cameFrom] = useState(() => searchParams.get("node"));

  /**
   * What the trigger reads.
   *
   * The deep link arrives before the catalogue does, so there is a moment where
   * `options` cannot name the node. `nodeRules.data.path` is fetched for this
   * node alone and lands first — falling through to it means the trigger goes
   * straight from "Loading…" to the breadcrumb, and never shows the id.
   */
  const scopeLabel =
    scope === COMPANY
      ? "Company default"
      : (() => {
          const option = options.find((o) => o.id === scope);
          if (option) return nodeLabel(option);
          const path = nodeRules.data?.path;
          return path?.length ? path.join(" › ") : "Loading…";
        })();

  const setScope = (next: string | null) => {
    // Replace rather than push: flipping between scopes is a view change, not a
    // step somebody wants to walk back through with the Back button.
    setSearchParams(!next || next === COMPANY ? {} : { node: next }, {
      replace: true,
    });
  };

  return (
    <>
      <PageMeta
        title="Rules configuration"
        description="Cancellation penalties, the AI confidence threshold, and the timing rules that drive escalation and closure — for the company, or for one product category."
      />

      {/* Only when the tree sent you here. `?focus=` is the catalogue's own
          scroll-to-and-highlight, so this lands on the category you left rather
          than at the top of a tree you then have to re-walk. */}
      {cameFrom ? (
        <LinkButton
          variant="ghost"
          size="sm"
          className="mb-3.5 -ml-2"
          to={`/categories?focus=${cameFrom}`}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to Categories &amp; models
        </LinkButton>
      ) : null}

      <Field className="mb-3.5 max-w-100">
        <FieldLabel htmlFor="rules-scope">These rules apply to</FieldLabel>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger id="rules-scope">
            {/* Base UI renders the raw VALUE unless given a render function —
                which put a bare UUID in the trigger. The same expression the
                items use, so the two cannot drift. */}
            <SelectValue>{() => scopeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={COMPANY}>Company default</SelectItem>
            {options.length ? (
              <SelectGroup>
                <SelectLabel>Product categories</SelectLabel>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {nodeLabel(option)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
        <FieldDescription>
          A category inherits everything it does not set, from the category above
          it and then from the company. The deepest setting wins.
        </FieldDescription>
      </Field>

      {nodeId ? (
        nodeRules.isError ? (
          <ErrorState
            title="Couldn't load this category's rules"
            error={nodeRules.error}
            onRetry={() => nodeRules.refetch()}
          />
        ) : nodeRules.isLoading || !nodeRules.data ? (
          <RulesSkeleton />
        ) : (
          <>
            {saveNode.isError ? (
              <p
                role="alert"
                className="mb-3.5 rounded-md bg-danger-bg px-4 py-3 text-xs text-danger"
              >
                {saveNode.error instanceof Error
                  ? saveNode.error.message
                  : "Something went wrong. Try again."}
              </p>
            ) : null}

            {/* Keyed on the served values so a successful save re-seeds the
                form's defaults — and so switching category re-seeds them at
                all, which a stable key would not. */}
            <NodeRulesForm
              key={JSON.stringify(nodeRules.data)}
              config={nodeRules.data}
              isSaving={saveNode.isPending}
              onSubmit={(values) =>
                saveNode.mutate(toNodeDraft(values), {
                  onSuccess: () =>
                    toast.add({
                      title: `Rules saved for ${nodeRules.data.path.at(-1)}`,
                      description:
                        "Tickets raised in this category from now on carry these numbers.",
                    }),
                })
              }
              onReset={() =>
                saveNode.mutate(null, {
                  onSuccess: () =>
                    toast.add({
                      title: `${nodeRules.data.path.at(-1)} now inherits everything`,
                    }),
                })
              }
            />
          </>
        )
      ) : isError ? (
        <ErrorState
          title="Couldn't load the rules configuration"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <RulesSkeleton />
      ) : !rules ? (
        // Barely reachable: the API creates this company's row on first read
        // if the migration's backfill somehow missed it, so a 200 always
        // carries rules. Kept for the case where it answers otherwise.
        <EmptyState
          icon={SlidersHorizontal}
          title="No rules configured"
          description="Penalty bands, bonus bands, the AI threshold and the timing rules will appear here once they are set."
        />
      ) : (
        <>
          {save.isError ? (
            <p
              role="alert"
              className="mb-3.5 rounded-md bg-danger-bg px-4 py-3 text-xs text-danger"
            >
              {save.error instanceof Error
                ? save.error.message
                : "Something went wrong. Try again."}
            </p>
          ) : null}

          {/* Keyed on the served values so a successful save re-seeds the
              form's defaults — otherwise Reset would revert to whatever loaded
              on first mount, not to what is now saved. */}
          <RulesForm
            key={JSON.stringify(rules)}
            rules={rules}
            isSaving={save.isPending}
            onSubmit={(values) =>
              save.mutate(toDraft(values), {
                onSuccess: () =>
                  toast.add({
                    title: "Rules configuration saved",
                    // It said "Applied for this session" while Save wrote to a
                    // JavaScript object that died with the tab. It writes to
                    // `company_rules` now, and the sweeps read it on their next
                    // tick — so the copy says what actually happens.
                    description:
                      "In effect for this company from the next sweep.",
                  }),
              })
            }
          />
        </>
      )}
    </>
  );
}

function RulesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-64 rounded-lg" />
      ))}
    </div>
  );
}
