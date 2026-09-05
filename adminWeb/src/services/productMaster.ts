/**
 * Product master transport — live FastAPI, not the mock client.
 *
 * Every write returns the affected ROOT branch with its whole subtree, so the
 * console re-renders from one authoritative response instead of patching a
 * local tree and hoping it matches what the server did. That matters more now
 * that a change at any depth can move an inherited icon, an inherited parameter
 * or a technician count several levels below it.
 *
 * `/categories` and `/subcategories` were two halves of the same idea and are
 * now one `/nodes`. A node's level is its `depth`, not which URL created it.
 */

import type {
  CreateModelInput,
  CreateNodeInput,
  ProductNode,
  UpdateModelInput,
  UpdateNodeInput,
} from "@/types/product";
import { apiDelete, apiGet, apiPost, apiPut } from "./http";

/**
 * The catalogue, whole or narrowed to one brand. Roots, nested downward.
 *
 * `vendorId` returns only that vendor's models and only the branches that still
 * hold any — ticket intake picks the vendor first, so its category and model
 * pickers must not offer a path that dead-ends.
 */
export function listNodeTree(
  includeInactive = false,
  vendorId?: string
): Promise<ProductNode[]> {
  const query = new URLSearchParams();
  if (includeInactive) query.set("includeInactive", "true");
  if (vendorId) query.set("vendorId", vendorId);
  const qs = query.toString();
  return apiGet<ProductNode[]>(`/masters/nodes${qs ? `?${qs}` : ""}`);
}

/* --------------------------------------------------------------- categories */

export function createNode(input: CreateNodeInput): Promise<ProductNode> {
  return apiPost<ProductNode>("/masters/nodes", input);
}

export function updateNode({
  id,
  ...body
}: UpdateNodeInput): Promise<ProductNode> {
  return apiPut<ProductNode>(`/masters/nodes/${id}`, body);
}

export function deleteNode(id: string): Promise<null> {
  return apiDelete<null>(`/masters/nodes/${id}`);
}

/* ------------------------------------------------------------------ models */

export function createModel({
  nodeId,
  ...body
}: CreateModelInput): Promise<ProductNode> {
  return apiPost<ProductNode>(`/masters/nodes/${nodeId}/models`, body);
}

export function updateModel({
  id,
  ...body
}: UpdateModelInput): Promise<ProductNode> {
  return apiPut<ProductNode>(`/masters/models/${id}`, body);
}

export function deleteModel(id: string): Promise<null> {
  return apiDelete<null>(`/masters/models/${id}`);
}
