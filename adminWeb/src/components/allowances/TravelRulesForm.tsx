import { useMemo } from "react";
import {
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Route } from "lucide-react";
import { ErrorState } from "@/components/shared/states";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useSaveTravelRules, useTravelRules } from "@/hooks/useAllowances";
import type { AllowanceScope } from "@/types/allowances";
import { TravelPreview } from "./TravelPreviewCard";
import {
  previewRule,
  toTravelBody,
  toTravelValues,
  travelSchema,
  TRAVEL_TYPES,
  type TravelRuleValues,
  type TravelValues,
} from "./travelSchema";

/** §5.10 PROPOSED — one card per technician type, freelancers first. */
const CARD_COPY: Record<
  (typeof TRAVEL_TYPES)[number],
  { title: string; description: string }
> = {
  freelancer: {
    title: "Freelancers",
    description:
      "Paid on each job a freelancer completes, measured one way from their base to the customer.",
  },
  employee: {
    title: "Employees",
    description:
      "Paid on each job an employee completes, on top of salary, through their monthly statement.",
  },
};

type RuleField = keyof TravelRuleValues;

/**
 * The travel rules for one franchisee — both technician types, one Save (the
 * PUT takes both). `readOnly` disables every box and draws no Save: a Regional
 * Head with `settings.view`, and the Allowances card on a non-home franchisee.
 *
 * `useWatch`, never `watch()` — the React Compiler is on and `watch()` returns
 * a new value each render.
 */
export function TravelRulesForm({
  scope,
  readOnly,
}: {
  scope: AllowanceScope;
  readOnly: boolean;
}) {
  const query = useTravelRules(scope);

  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't load the travel rules"
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (query.isLoading || !query.data) {
    return (
      <div className="grid gap-3.5 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  return (
    <TravelRulesFields scope={scope} readOnly={readOnly} rules={query.data} />
  );
}

function TravelRulesFields({
  scope,
  readOnly,
  rules,
}: {
  scope: AllowanceScope;
  readOnly: boolean;
  rules: NonNullable<ReturnType<typeof useTravelRules>["data"]>;
}) {
  const save = useSaveTravelRules(scope);
  // `values` re-syncs the form when the server's copy changes (after a save);
  // react-query keeps the reference stable between identical reads.
  const values = useMemo(() => toTravelValues(rules), [rules]);
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TravelValues>({
    resolver: zodResolver(travelSchema),
    values,
  });

  const onSubmit = async (v: TravelValues) => {
    try {
      await save.mutateAsync(toTravelBody(v));
      toast.add({ title: "Travel rules saved" });
    } catch {
      /* The global handler has toasted it; what was typed stays. */
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-3.5 lg:grid-cols-2">
        {TRAVEL_TYPES.map((type) => (
          <TravelCard
            key={type}
            type={type}
            control={control}
            register={register}
            errors={errors}
            readOnly={readOnly}
          />
        ))}
      </div>

      <p className="mt-3.5 text-xs text-ink-3">
        Changes apply to jobs accepted from now on. Jobs already accepted keep
        the allowance they were given.
      </p>

      {readOnly ? null : (
        <div className="mt-3.5 flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Route data-icon="inline-start" aria-hidden />
            )}
            Save travel rules
          </Button>
        </div>
      )}
    </form>
  );
}

function TravelCard({
  type,
  control,
  register,
  errors,
  readOnly,
}: {
  type: (typeof TRAVEL_TYPES)[number];
  control: Control<TravelValues>;
  register: UseFormRegister<TravelValues>;
  errors: FieldErrors<TravelValues>;
  readOnly: boolean;
}) {
  const copy = CARD_COPY[type];
  const typed = useWatch({ control, name: type });
  const rule = previewRule(typed);
  const err = (field: RuleField) => errors[type]?.[field]?.message;
  const off = rule !== null && rule.paisePerStep === 0;

  const box = (
    field: RuleField,
    label: string,
    hint?: string,
    inputMode: "numeric" | "decimal" = "numeric"
  ) => {
    const id = `travel-${type}-${field}`;
    const error = err(field);
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          inputMode={inputMode}
          disabled={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...register(`${type}.${field}`)}
        />
        {error ? (
          <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
            {error}
          </FieldDescription>
        ) : hint ? (
          <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
        ) : null}
      </Field>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">{copy.title}</CardTitle>
        <CardDescription className="text-xs">{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {box("freeKm", "Free distance (km)", "Nothing is paid up to this distance.")}
          {box("stepKm", "Pay for every (km)", "Part of a step is not paid.")}
          {box("perStep", "Amount per step (₹)")}
          {box(
            "roadFactorPct",
            "Road factor (%)",
            "Straight-line distance × this = road distance. 130 % suits most cities."
          )}
          {box("maxPerJob", "Most per job (₹)")}
        </FieldGrid>

        {/* Off is a state, said in words: a ₹0 rate is "off", not "broken". */}
        {off ? (
          <p className="rounded-md bg-surface-3 px-3 py-2 text-xs font-medium text-ink-2">
            Off — set an amount per step to switch it on.
          </p>
        ) : null}

        <TravelPreview id={`travel-${type}`} rule={rule} />
      </CardContent>
    </Card>
  );
}
