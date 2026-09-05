import { ChoiceCards } from "@/components/shared/ChoiceCards";
import { LOCATION_CHECK, type LocationCheck } from "./vendorSchema";

interface LocationCheckFieldProps {
  value: LocationCheck;
  onChange: (value: LocationCheck) => void;
  error?: string;
  errorId?: string;
}

/**
 * On / Off for whether a technician's live site photo is location-gated on this
 * vendor's jobs.
 *
 * Not the same question as `AddressSearchField`, though they sit near each
 * other: that one decides WHICH rule applies — coordinates reach a ticket only
 * from a picked search result, so a vendor without the search falls back to
 * comparing pincodes — while this one decides whether either rule is enforced
 * at all.
 */
export function LocationCheckField({
  value,
  onChange,
  error,
  errorId,
}: LocationCheckFieldProps) {
  return (
    <ChoiceCards
      legend="Location check"
      options={LOCATION_CHECK}
      value={value}
      onChange={onChange}
      description="When on, the technician's live site photo must be taken at the customer's address. When off, the photo is still geo-tagged and stored, but it is never refused — for sites where a phone cannot get a fix at all."
      error={error}
      errorId={errorId}
    />
  );
}
