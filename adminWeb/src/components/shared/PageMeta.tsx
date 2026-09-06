import { useEffect } from "react";

import { useBrand } from "@/hooks/useBrand";

interface PageMetaProps {
  title: string;
  description?: string;
}

/**
 * Per-route document head.
 *
 * This is an internal console behind auth, so every route is `noindex,nofollow`
 * — but unique titles still matter: they name the browser tab and every entry
 * in back-button history.
 *
 * The tab is prefixed with the ACTIVE COMPANY, not a fixed product name. Two
 * companies open in two tabs is an ordinary day here, and identical titles
 * would make them indistinguishable in the tab strip and in history. Signed
 * out — and for a superadmin, who belongs to no company — it falls back to the
 * platform name through `useBrand`.
 */
export function PageMeta({ title, description }: PageMetaProps) {
  const brand = useBrand();
  const brandName = brand.name;

  useEffect(() => {
    document.title = `${brandName} · ${title}`;

    const set = (name: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(
        `meta[name="${name}"]`
      );
      if (!el) {
        el = document.createElement("meta");
        el.name = name;
        document.head.appendChild(el);
      }
      el.content = content;
    };

    set("robots", "noindex, nofollow");
    if (description) set("description", description);

    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = window.location.origin + window.location.pathname;
  }, [brandName, title, description]);

  return null;
}
