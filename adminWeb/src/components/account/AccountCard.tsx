import { Check, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AvatarPicker } from "@/components/shared/AvatarPicker";
import { useUpdateMyPhoto } from "@/hooks/useAuth";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";
import type { BackendMembership, BackendUser } from "@/types/api";

interface AccountCardProps {
  user: BackendUser;
  memberships: BackendMembership[];
  activeCompanyId: string | null;
  onSignOut: () => void;
}

/**
 * Identity, not authorization. Role and company are shown because they explain
 * what this console is showing you — the server decides what you may do. The
 * photo is the one thing here the user owns: cropped, uploaded to blob storage
 * and saved with `PATCH /auth/me`.
 */
export function AccountCard({
  user,
  memberships,
  activeCompanyId,
  onSignOut,
}: AccountCardProps) {
  const name = user.fullName ?? user.email;
  // Fall back to the sole company if the active id is absent (e.g. an older
  // session) — a member always has an active company.
  const effectiveActiveId =
    activeCompanyId ?? memberships[0]?.companyId ?? null;
  const activeCompany =
    memberships.find((m) => m.companyId === effectiveActiveId)?.companyName ??
    "—";

  // A mirror of the server's value, so the disc is drawn before `me` returns.
  // The picker uploads the crop; this only persists the URL it hands back.
  const avatarUrl = useSession((s) => s.avatarUrl);
  const updatePhoto = useUpdateMyPhoto();

  const facts: Array<[string, string]> = [
    ["Email", user.email],
    ["Phone", user.phone ?? "—"],
    ["Role", user.roleLabel],
    ["Active company", activeCompany],
  ];

  return (
    <Card className="max-w-3xl [--card-spacing:--spacing(5.5)]">
      <CardContent>
        <div className="flex items-center gap-4">
          <AvatarPicker
            name={name}
            value={avatarUrl}
            onChange={(url) => updatePhoto.mutate(url)}
            avatarClassName="size-14 text-lg"
          />
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold">{name}</h2>
            <p className="truncate text-xs text-ink-3">{user.roleLabel}</p>
            {avatarUrl ? (
              <button
                type="button"
                onClick={() => updatePhoto.mutate(null)}
                disabled={updatePhoto.isPending}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-3" aria-hidden />
                Remove photo
              </button>
            ) : null}
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

        {memberships.length > 0 ? (
          <div className="mt-4.5">
            <p className="mb-2 text-xs font-medium text-ink-3">
              {memberships.length > 1
                ? "Your companies — switch from the header."
                : "Your company"}
            </p>
            <ul className="divide-y divide-line-2 overflow-hidden rounded-md border border-line-2">
              {memberships.map((m) => (
                <li
                  key={m.companyId}
                  className="flex items-center justify-between gap-4 px-3.5 py-2.75"
                >
                  <span className="truncate text-xs font-medium">
                    {m.companyName}
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold",
                      m.companyId === effectiveActiveId
                        ? "text-brand-500"
                        : "text-ink-3"
                    )}
                  >
                    {m.companyId === effectiveActiveId ? (
                      <>
                        <Check className="size-3" aria-hidden />
                        Active
                      </>
                    ) : (
                      m.companySlug
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-ink-3">
          Access is granted by your role on the server. Ask an administrator to
          change your role or company access.
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
