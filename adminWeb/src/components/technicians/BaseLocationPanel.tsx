import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/utils/datetime";
import type { Technician } from "@/types/technician";
import {
  describeBase,
  formatLatLng,
  setByLine,
} from "./baseLocation";
import { BaseChip } from "./BaseChip";
import { BaseLocationDialog } from "./BaseLocationDialog";

/**
 * Where this technician's travel allowance is measured from (Task 13 §5.5).
 *
 * Sits under the onboarding card on the profile, on both surfaces. What it can
 * SHOW depends on who is looking, and the server decides:
 *
 *   - someone who can manage the technician gets `baseLocation` in full —
 *     coordinates, pincode, who set it — and the button;
 *   - anyone else who can see the technician (an Area Manager on a non-home
 *     franchisee's technician) gets only the list fields, so the chip and the
 *     "when" show and the coordinates do not (W13).
 *
 * R9 (owner ruling 2026-10-15): a self-set base is SHOWN — chip and "set by"
 * line — never hidden, and there is no approval and no cooldown. The admin
 * corrects it here at any time.
 *
 * `canEdit` is the page's own gate (`features.editTechnician && tech.canManage`),
 * which already says the right thing on both surfaces; hiding the button is
 * presentation, the server refuses the write regardless (hard rule 8).
 */
export function BaseLocationPanel({
  tech,
  canEdit,
}: {
  tech: Technician;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const base = tech.baseLocation ?? null;
  const source = base?.source ?? tech.baseSource;
  const setAt = base?.setAt ?? tech.baseSetAt;

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
              Base location
            </h3>
            <p className="mt-1 text-xs text-ink-3">
              Where travel allowance is measured from.
            </p>
          </div>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
            >
              <MapPin data-icon="inline-start" aria-hidden />
              {source ? "Change" : "Set base location"}
            </Button>
          ) : null}
        </div>

        {source ? (
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">
                {describeBase({ source, pincode: base?.pincode ?? null })}
              </span>
              <BaseChip source={source} />
            </div>
            {/* Coordinates only for a caller the server trusted with them. */}
            {base ? (
              <span className="font-mono text-xs text-ink-2">
                {formatLatLng(base.latitude, base.longitude)}
              </span>
            ) : null}
            {setAt ? (
              <span className="text-xs text-ink-3">
                {setByLine(
                  base ?? { setBySelf: tech.baseSetBySelf },
                  formatDateTime(setAt)
                )}
              </span>
            ) : null}
          </div>
        ) : (
          // A word, not a tint alone: the colour says "look", the sentence says what.
          <p className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-xs font-medium text-warn">
            Not set — jobs this technician accepts pay no travel allowance.
          </p>
        )}
      </CardContent>

      {canEdit ? (
        <BaseLocationDialog
          open={open}
          onOpenChange={setOpen}
          technician={{ id: tech.id, name: tech.name, baseLocation: base }}
        />
      ) : null}
    </Card>
  );
}
