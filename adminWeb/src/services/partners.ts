/**
 * Partner invites, against the live backend.
 *
 * Sending is the server's job — it talks to WhatsApp and records the outcome on
 * the invite, so a refused message comes back as a `failed` row with a reason
 * rather than an error the screen has to interpret.
 */

import { apiDelete, apiGetPage, apiPost } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  CreateInviteInput,
  PartnerInvite,
  PartnerType,
} from "@/types/partner";

export function listInvites(
  partnerType: PartnerType,
  params: ListParams = {}
): Promise<Page<PartnerInvite>> {
  return apiGetPage<PartnerInvite>("/partners/invites", {
    ...params,
    filters: { ...(params.filters ?? {}), partnerType },
  });
}

export function createInvite(input: CreateInviteInput): Promise<PartnerInvite> {
  return apiPost<PartnerInvite>("/partners/invites", input);
}

export function resendInvite(id: string): Promise<PartnerInvite> {
  return apiPost<PartnerInvite>(`/partners/invites/${id}/resend`);
}

export function cancelInvite(id: string): Promise<null> {
  return apiDelete<null>(`/partners/invites/${id}`);
}
