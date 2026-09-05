import { ChoiceCards } from "@/components/shared/ChoiceCards";
import { CATEGORY_STATUSES, type CategoryStatus } from "./categorySchema";

interface StatusFieldProps {
  value: CategoryStatus;
  onChange: (value: CategoryStatus) => void;
  /** What a Paused row stops doing — different at each level of the tree. */
  description: string;
  error?: string;
  errorId?: string;
}

/**
 * Active / Paused, shared by all three product-master forms and the vendor one.
 *
 * A thin wrapper over `shared/ChoiceCards` since the third two-card boolean
 * landed. It stays its own component rather than becoming a call site, because
 * it is typed to `CategoryStatus` — that is what stops a form putting a vendor's
 * On/Off where a status goes.
 */
export function StatusField({
  value,
  onChange,
  description,
  error,
  errorId,
}: StatusFieldProps) {
  return (
    <ChoiceCards
      legend="Status"
      options={CATEGORY_STATUSES}
      value={value}
      onChange={onChange}
      description={description}
      error={error}
      errorId={errorId}
    />
  );
}
