import { useEffect } from "react";

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
 */
export function PageMeta({ title, description }: PageMetaProps) {
  useEffect(() => {
    document.title = `Reliance GreenTech · ${title}`;

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
  }, [title, description]);

  return null;
}
