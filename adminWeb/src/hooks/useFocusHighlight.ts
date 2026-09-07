import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { masterNodeId } from "@/components/masters/nodeIds";

/** How long the ring stays before it fades out of the way. */
const HOLD_MS = 2400;

/**
 * `?focus=<id>` — scroll a row of the product tree into view and ring it.
 *
 * Nothing in the master has a detail route; it is one page with the whole tree
 * already expanded on it. So a global-search hit, or a notification about one
 * product, points at a node id, and the page's job is to put that row in front
 * of you rather than leave you scanning a hundred chips for the one you asked
 * for.
 *
 * Written straight to the DOM rather than held in state: this is a one-off
 * visual cue with no meaning afterwards, and a re-render that dropped it would
 * be a highlight that flickered off mid-look.
 *
 * `loaded` gates it because the element does not exist before the tree has
 * data — passing a query's `isSuccess` or `!!data?.length` is the intended use.
 *
 * ## Why this is a hook at TWO consumers
 *
 * The component-tier rule says promote on the third, and this deliberately goes
 * early. That rule is about MARKUP — two components that happen to look alike
 * are usually a coincidence. This is a behaviour with a timer and a cleanup
 * path, and a duplicated `clearTimeout` is where a leak lives rather than where
 * a coincidence does.
 */
export function useFocusHighlight(loaded: boolean) {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");

  useEffect(() => {
    if (!focusId || !loaded) return;
    const node = document.getElementById(masterNodeId(focusId));
    if (!node) return;

    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const ring = ["ring-2", "ring-brand-500", "rounded-md"];
    node.classList.add(...ring);
    const timer = window.setTimeout(() => node.classList.remove(...ring), HOLD_MS);
    return () => {
      window.clearTimeout(timer);
      node.classList.remove(...ring);
    };
  }, [focusId, loaded]);
}
