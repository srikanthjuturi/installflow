import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * The rail's collapse control.
 *
 * Its own file rather than a private helper of `Sidebar`, because the vendor
 * portal has a rail too and importing it from there would drag the whole ops
 * navigation table — fourteen items an external party has no business
 * downloading — into the portal's chunk.
 */
export function SidebarCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
    >
      <Icon className="size-4.5" strokeWidth={1.8} aria-hidden />
    </button>
  );
}
