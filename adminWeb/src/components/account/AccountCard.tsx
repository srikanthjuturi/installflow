import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ROLE_LABEL, roleFromApi } from "@/store/session";
import type { AuthUser } from "@/types/api";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
}

/**
 * An ISO instant as a person reads it. A malformed or missing timestamp shows
 * the em dash the console uses everywhere for "nothing to report" rather than
 * the browser's "Invalid Date".
 */
function formatInstant(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";

  return at.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface AccountCardProps {
  /** The account exactly as the API returned it. */
  user: AuthUser;
  onSignOut: () => void;
}

/**
 * Identity, not authorization. Role and scope are shown because they explain
 * what this console is showing you — the server decides what you may do.
 */
export function AccountCard({ user, onSignOut }: AccountCardProps) {
  const { name, email } = user;
  // The wire carries a number; this is the only vocabulary the screens speak.
  const role = roleFromApi(user.role);

  const facts: Array<[string, string]> = [
    ["Work email", email],
    ["Role", role],
    // ⚠ Derived from the role, not served. `AuthUser` has no region or area
    // field, so the console cannot state the actual scope of this account.
    ["Scope", ROLE_LABEL[role]],
    ["Last login", formatInstant(user.lastLoginAt)],
    ["Sign-ins", String(user.loginCount)],
  ];

  return (
    // An identity column, not a work surface — the paragraph below would be
    // unreadable stretched across a wide monitor.
    <Card className="max-w-3xl [--card-spacing:--spacing(5.5)]">
      <CardContent>
        <div className="flex items-center gap-4">
          {/* Decorative — the name is right beside it. */}
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-full bg-status-assigned-bg text-lg font-semibold text-brand-400"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold">{name}</h2>
            <p className="truncate text-xs text-ink-3">{ROLE_LABEL[role]}</p>
          </div>
        </div>

        <dl className="mt-4.5 divide-y divide-line-2 overflow-hidden rounded-md border border-line-2">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 px-3.5 py-2.75"
            >
              <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
              <dd className="truncate text-xs font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs text-ink-3">
          Access is granted by your role on the server. The NH · RSH · ASM tabs
          in the header change what this console shows, not what you may do. Ask
          your National Head to change a role or scope.
        </p>

        <Separator className="my-4.5" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-2">Signs you out of this browser.</p>
          <Button variant="destructive" onClick={onSignOut}>
            <LogOut data-icon="inline-start" />
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
