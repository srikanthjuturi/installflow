import { ChoiceCards } from "@/components/shared/ChoiceCards";
import { ADDRESS_SEARCH, type AddressSearch } from "./vendorSchema";

interface AddressSearchFieldProps {
  value: AddressSearch;
  onChange: (value: AddressSearch) => void;
  error?: string;
  errorId?: string;
}

/**
 * On / Off for the vendor portal's Google address search.
 *
 * A thin wrapper over `shared/ChoiceCards`, typed to its own union — see the
 * note there on why each boolean keeps a wrapper rather than passing raw
 * strings at the call site.
 */
export function AddressSearchField({
  value,
  onChange,
  error,
  errorId,
}: AddressSearchFieldProps) {
  return (
    <ChoiceCards
      legend="Address search"
      options={ADDRESS_SEARCH}
      value={value}
      onChange={onChange}
      description="When on, this vendor's portal offers a Google address search on the ticket form. When off, they type the address in by hand."
      error={error}
      errorId={errorId}
    />
  );
}
