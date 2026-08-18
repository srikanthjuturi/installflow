/**
 * What is left of the masters mock now that vendors are real.
 *
 * The vendor list used to live here as full records — intake channel, API
 * credentials, lifetime ticket volume — and backed the Vendors screen. That
 * screen now reads `/vendors`, so all that remains is the names, for the one
 * consumer that still needs a list and cannot have the real one.
 */

/**
 * Vendor names for the mocked manual ticket-entry form.
 *
 * Deliberately NOT `useVendorOptions()`. The real endpoint is National Head and
 * above, while `jobs.create` reaches down to Area Manager — so binding this
 * select to it would 403 the very people who key tickets in. It becomes real
 * when the jobs slice lands and a ticket carries a vendor id rather than a
 * name typed into a string field.
 */
export const VENDOR_NAMES = [
  "Videocon",
  "Kelvinator",
  "Sansui",
  "Electrolux",
  "Onida",
] as const;

/** Not in the requirement doc's required-field list, but the prototype
 *  collects it — flagged as an open question. */
export const REQUEST_TYPES = [
  "Installation",
  "Demo",
  "Installation + Demo",
] as const;
