import * as React from "react";

import { loadPlacesLibrary, MAPS_ENABLED } from "@/lib/googleMaps";
import { partsFromPlace, type AddressParts } from "@/lib/placeAddress";
import type { ComboboxOption } from "@/components/ui/combobox";

/**
 * Google Places autocomplete, as the two things a field actually needs: a list
 * of options to render, and a way to turn the chosen one into address parts.
 *
 * Everything Google-shaped stops here. `AddressFields` never sees a
 * `PlacePrediction`, a session token or a field mask — which is what lets the
 * whole integration be swapped later without touching a form.
 *
 * Debouncing is NOT here: it lives inside `Combobox`, so every async consumer
 * of that control behaves the same way (see `multi-select.tsx`, which owns the
 * same decision for the multi-value case).
 */

/**
 * Below this, predictions are noise — "ab" matches half of India, and each
 * request is billed. Three is where a street name starts to mean something.
 */
const MIN_QUERY = 3;

/*
 * ⚠ Reverse geocoding is deliberately NOT done here, and it is worth saying why
 * so nobody adds it back casually.
 *
 * A road or a neighbourhood ("Brigade Road", "Banjara Hills Road No. 12")
 * carries no postal code — Google has none, because an area that size spans
 * several. Its coordinates do sit inside exactly one, so
 * `new google.maps.Geocoder().geocode({ location })` looks like the obvious
 * way to fill the rest.
 *
 * It was tried, and it broke the feature. The Geocoding API is a SEPARATE API
 * from Maps JavaScript and Places, and it is not enabled on our key. When it is
 * not enabled the call does not reject — it logs `ApiNotActivatedMapError` and
 * never settles — and, worse, that error puts the whole Maps SDK into a state
 * where `PlacePrediction.toPlace()` returns `undefined` for every subsequent
 * pick. Measured: the first address resolved, and the next five silently did
 * nothing at all.
 *
 * If the Geocoding API is ever enabled on the key, this can come back — behind
 * a timeout and a "stop asking after one refusal" flag, because the failure
 * mode above is not something to re-enter blind.
 */

export interface AddressAutocomplete {
  /** False when there is no key, or the SDK could not load. Render manual entry. */
  available: boolean;
  options: ComboboxOption[];
  loading: boolean;
  search: (query: string) => void;
  /** Turn a chosen option's value (a place id) into address parts. */
  resolve: (placeId: string) => Promise<AddressParts | null>;
}

export function useAddressAutocomplete(): AddressAutocomplete {
  const [available, setAvailable] = React.useState(MAPS_ENABLED);
  const [options, setOptions] = React.useState<ComboboxOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  /** Predictions by place id — `toPlace()` only exists on the prediction. */
  const predictions = React.useRef(
    new Map<string, google.maps.places.PlacePrediction>()
  );
  /**
   * One session token spans every keystroke up to a selection, and Google bills
   * the session once instead of per request. `fetchFields` ends it, so it is
   * cleared there and the next keystroke mints a fresh one.
   */
  const token = React.useRef<google.maps.places.AutocompleteSessionToken | null>(
    null
  );
  /**
   * Responses can land out of order — a short query is often slower than the
   * longer one typed after it. Only the newest request may write state, or the
   * list flicks back to results for text no longer in the box.
   */
  const seq = React.useRef(0);

  // Warm the SDK as soon as a form with an address on it opens, so the first
  // search does not pay for the script as well as the query.
  React.useEffect(() => {
    if (!MAPS_ENABLED) return;
    let live = true;
    loadPlacesLibrary().catch((error: unknown) => {
      // Said once, not per keystroke — the promise is memoised. Worth saying at
      // all: from the outside a missing search box is indistinguishable from a
      // feature nobody built, and this names the reason (bad key, blocked
      // referrer, offline).
      console.warn("Address autocomplete unavailable:", error);
      if (live) setAvailable(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const search = React.useCallback((query: string) => {
    const trimmed = query.trim();
    const mine = ++seq.current;

    if (trimmed.length < MIN_QUERY) {
      setOptions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        const places = await loadPlacesLibrary();
        token.current ??= new places.AutocompleteSessionToken();

        const { suggestions } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: trimmed,
            sessionToken: token.current,
            // India only. Every customer, vendor and company on this system is
            // here, and an unrestricted search offers Springfield, Illinois to
            // somebody typing a Bengaluru street.
            includedRegionCodes: ["in"],
            language: "en",
          });

        if (mine !== seq.current) return;

        const found = new Map<string, google.maps.places.PlacePrediction>();
        const next: ComboboxOption[] = [];
        for (const suggestion of suggestions) {
          const prediction = suggestion.placePrediction;
          if (!prediction) continue;
          found.set(prediction.placeId, prediction);
          next.push({
            value: prediction.placeId,
            label: prediction.mainText?.text ?? prediction.text.text,
            hint: prediction.secondaryText?.text,
          });
        }
        predictions.current = found;
        setOptions(next);
      } catch {
        // A failed load is permanent for this page; a failed query is not, but
        // neither is worth a toast while somebody is typing. Both surface as an
        // empty list, and the fields below stay usable either way.
        if (mine !== seq.current) return;
        setOptions([]);
        if (!window.google?.maps) setAvailable(false);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    })();
  }, []);

  const resolve = React.useCallback(
    async (placeId: string): Promise<AddressParts | null> => {
      const prediction = predictions.current.get(placeId);
      if (!prediction) return null;
      const place = prediction.toPlace();
      // A prediction from a session that has already been spent hands back
      // nothing rather than throwing.
      if (!place) return null;
      // The session ends with `fetchFields`. Released BEFORE the await, not in
      // a `finally` after it: a search that starts while the details are still
      // in flight would otherwise reuse the spent token, and every prediction
      // it returned would then fail to convert.
      token.current = null;
      try {
        await place.fetchFields({
          // `location` is on the SAME call and the same billed session — it is
          // a Places field, not the Geocoding API. That distinction is the
          // whole reason this is safe: see the warning above for what calling
          // Geocoding did to the SDK. Nothing new has to be enabled on the key.
          //
          // It is what lets the proof photo be verified by DISTANCE from the
          // customer's address instead of by pincode equality, so an address
          // picked here is worth materially more than one typed by hand.
          fields: [
            "formattedAddress",
            "addressComponents",
            "displayName",
            "location",
          ],
        });
        return partsFromPlace(place);
      } catch {
        return null;
      }
    },
    []
  );

  return { available, options, loading, search, resolve };
}
