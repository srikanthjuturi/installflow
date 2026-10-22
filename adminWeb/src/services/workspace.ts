/**
 * The workspace adapter — Task 09 §5.2, and the third-shell plan's whole
 * centre of gravity.
 *
 * The staff technician list, redemption queue and penalty pool are the
 * franchise portal's too: same components, same hooks, different endpoint
 * twins, different link targets, different feature keys. This module is where
 * those three differences live, so a reused screen reads them from one object
 * instead of forking pages (rejected: eleven copies of every bug) or
 * threading a `isPortal` boolean four props deep (rejected: the components
 * would re-render on a fact they only half care about).
 *
 * Every record is a CONSTANT. Nothing here reads the session or the router —
 * `hooks/useWorkspace` hands the right one to whoever asks.
 */

import type { ListParams, Page } from "@/types/api";
import type { LedgerEntry } from "@/types";
import type {
  Technician,
  TechnicianInvite,
  TechnicianRow,
  UpiChange,
  AppLinkOutcome,
  CreatedTechnician,
  CreateTechnicianInput,
  InviteTechnicianInput,
  UpdateTechnicianInput,
} from "@/types/technician";
import type { Redemption, RedemptionDetail } from "@/types/redemption";
import { WORKSPACE_FEATURES, WORKSPACE_PATHS, type Workspace, type WorkspaceFeatures, type WorkspacePaths } from "@/lib/surface";
import type { LedgerPool } from "./ledger";
import * as staffTechnicians from "./technicians";
import * as staffRedemptions from "./redemptions";
import * as staffLedger from "./ledger";
import * as franchise from "./franchise";

/**
 * The calls a reused screen makes, per workspace. The signatures are the
 * staff twins' on purpose — both backends answer the same shapes — so a hook
 * is `api.technicians.list(params)` on either side of the wall. The ONE
 * asymmetry is `ledger.reverse`: ops reverses a penalty from the ticket page
 * (never the pool screen, owner ruling), so its record carries `null` and the
 * pool table's column is gone there rather than a button that 403s.
 */
export interface WorkspaceApi {
  technicians: {
    list(params: ListParams): Promise<Page<TechnicianRow>>;
    get(id: string): Promise<Technician>;
    create(input: CreateTechnicianInput): Promise<CreatedTechnician>;
    update(input: UpdateTechnicianInput): Promise<Technician>;
    remove(id: string): Promise<null>;
    invite(input: InviteTechnicianInput): Promise<TechnicianInvite>;
    resendInvite(id: string): Promise<TechnicianInvite>;
    cancelInvite(id: string): Promise<null>;
    sendAppLink(id: string): Promise<AppLinkOutcome>;
    getUpiChange(id: string): Promise<UpiChange | null>;
    approveUpiChange(id: string): Promise<UpiChange>;
    rejectUpiChange(input: { id: string; reason: string }): Promise<UpiChange>;
  };
  redemptions: {
    list(params: ListParams): Promise<Page<Redemption>>;
    count(): Promise<number>;
    /**
     * Optional `franchiseeId` — the staff payer reading a non-home pool must
     * name it on the detail read too (§5.10), since the route answers in the
     * pool the id names. The portal never passes one.
     */
    detail(
      id: string,
      franchiseeId?: string | null
    ): Promise<RedemptionDetail>;
    claim(input: {
      id: string;
      proof: { blobName: string; fileName?: string };
      utr?: string;
    }): Promise<RedemptionDetail>;
    decline(input: { id: string; reason: string }): Promise<RedemptionDetail>;
  };
  ledger: {
    /**
     * Optional `franchiseeId` — Task 09 §5.10's staff selector is the only
     * caller that ever passes one; the portal never does (`require_franchise_
     * principal` pins its own, and an id the client could name would be a
     * tenancy hole, not a picker).
     */
    pool(params?: { franchiseeId?: string | null }): Promise<LedgerPool>;
    entries(params: ListParams): Promise<Page<LedgerEntry>>;
    reverse: ((input: {
      id: string;
      reason: string;
    }) => Promise<LedgerEntry>) | null;
  };
  /**
   * One employee's monthly statement CSV (§5.6 in the portal, §5.10 on the
   * staff profile) — both callers fetch the SAME artifact through the
   * workspace, so a single hook (`useStatementDownload`) serves both. The
   * blob only; the caller names the file, because the server's
   * `Content-Disposition` is not CORS-exposed.
   *
   * Who may download differs per backend, and neither is guessed here: the
   * staff one is home/NH-and-above only, the portal one rides the caller's
   * own franchisee, so the card's gate and `/auth/me` own the visibility.
   */
  statements: {
    download(input: {
      technicianId: string;
      month: string;
    }): Promise<Blob>;
  };
}

export type { Workspace, WorkspaceFeatures, WorkspacePaths };

export interface WorkspaceAdapter {
  workspace: Workspace;
  paths: WorkspacePaths;
  features: WorkspaceFeatures;
  api: WorkspaceApi;
}

/** The staff console. The functions are the existing services, re-exposed. */
export const OPS_WORKSPACE: WorkspaceAdapter = {
  workspace: "ops",
  paths: WORKSPACE_PATHS.ops,
  features: WORKSPACE_FEATURES.ops,
  api: {
    technicians: {
      list: staffTechnicians.listTechnicians,
      get: staffTechnicians.getTechnician,
      create: staffTechnicians.createTechnician,
      update: staffTechnicians.updateTechnician,
      remove: staffTechnicians.deleteTechnician,
      invite: staffTechnicians.inviteTechnician,
      resendInvite: staffTechnicians.resendInvite,
      cancelInvite: staffTechnicians.cancelInvite,
      sendAppLink: staffTechnicians.sendAppLink,
      getUpiChange: staffTechnicians.getUpiChange,
      approveUpiChange: staffTechnicians.approveUpiChange,
      rejectUpiChange: staffTechnicians.rejectUpiChange,
    },
    redemptions: {
      list: staffRedemptions.listRedemptions,
      count: staffRedemptions.redemptionsToPayCount,
      detail: staffRedemptions.getRedemption,
      claim: staffRedemptions.claimRedemption,
      decline: staffRedemptions.declineRedemption,
    },
    ledger: {
      pool: staffLedger.getLedgerPool,
      entries: staffLedger.listLedgerEntries,
      reverse: null,
    },
    statements: {
      // Wrapped, not re-exposed: both endpoint twins spell their arguments
      // `technicianId, month` (mirroring the URL), and this interface makes
      // them one object for the hook that names the file.
      download: (input) =>
        staffLedger.getLedgerStatement(input.technicianId, input.month),
    },
  },
};

/**
 * The franchise portal — same shape, `/franchise/*` doors. Nothing here sends
 * a franchisee id: `require_franchise_principal` pins every call to the
 * principal's own, and a client able to name another franchisee's queue would
 * be a tenancy hole, not an adapter.
 */
export const FRANCHISE_WORKSPACE: WorkspaceAdapter = {
  workspace: "franchise",
  paths: WORKSPACE_PATHS.franchise,
  features: WORKSPACE_FEATURES.franchise,
  api: {
    technicians: {
      list: franchise.listTechnicians,
      get: franchise.getTechnician,
      create: franchise.createTechnician,
      update: franchise.updateTechnician,
      remove: franchise.deleteTechnician,
      invite: franchise.inviteTechnician,
      resendInvite: franchise.resendInvite,
      cancelInvite: franchise.cancelInvite,
      sendAppLink: franchise.sendAppLink,
      getUpiChange: franchise.getUpiChange,
      approveUpiChange: franchise.approveUpiChange,
      rejectUpiChange: franchise.rejectUpiChange,
    },
    redemptions: {
      list: franchise.listRedemptions,
      count: franchise.redemptionsToPayCount,
      detail: franchise.getRedemption,
      claim: franchise.claimRedemption,
      decline: franchise.declineRedemption,
    },
    ledger: {
      pool: franchise.getLedgerPool,
      entries: franchise.listLedgerEntries,
      reverse: franchise.reverseLedgerEntry,
    },
    statements: {
      download: (input) =>
        franchise.getStatement(input.technicianId, input.month),
    },
  },
};