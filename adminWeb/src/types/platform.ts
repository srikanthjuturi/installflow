import type { Recharge, RechargeDetail } from "./credits";

/**
 * The platform's own rules — see `api/app/models/credits.py`.
 *
 * Credits are rupees one for one. Free credits apply to companies created from
 * now on; the per-ticket charge and the minus limit to every company from its
 * next ticket. The UPI ID is where every recharge is paid; with none set, no
 * company can recharge.
 */
export interface PlatformSettings {
  freeCredits: number;
  ticketCredits: number;
  minusCreditLimit: number;
  minRechargeRupees: number;
  upiId: string | null;
  upiName: string | null;
  updatedAt: string | null;
}

export type PlatformSettingsInput = Omit<PlatformSettings, "updatedAt">;

/** A recharge in the superadmin's queue — which company it is from. */
export interface PlatformRecharge extends Recharge {
  companyId: string;
  companyName: string;
  companyCode: string;
}

/** Another recharge carrying the same UTR. */
export interface UtrMatch {
  id: string;
  code: string;
  companyName: string;
  state: Recharge["state"];
}

export interface PlatformRechargeDetail extends RechargeDetail {
  companyId: string;
  companyName: string;
  companyCode: string;
  /** What the company has now, to read a confirmation against. */
  companyBalance: number;
  /**
   * Every other claimed recharge with this UTR, any company. One payment is one
   * UTR: a match is a resubmission after a rejection, or the same money twice.
   */
  utrAlsoOn: UtrMatch[];
}
