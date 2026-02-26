/**
 * GRP_SYS — Frontend API service
 * All communication with the FastAPI backend goes through here.
 */

import { Card, ChannelType, ListType, UserWorkStatus } from '@/types';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

/** Module-level departments cache, populated by getAppData(). */
let _depsCache: ApiDepartment[] = [];

function depIdsToNames(ids: number[] | null | undefined): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  const names = ids.map(id => _depsCache.find(d => d.depId === id)?.depName).filter(Boolean) as string[];
  return names.length ? names : undefined;
}

function depNamesToIds(names: string[] | undefined): number[] | null {
  if (!names || names.length === 0) return null;
  const ids = names.map(n => _depsCache.find(d => d.depName === n)?.depId).filter((id): id is number => id !== undefined);
  return ids.length ? ids : null;
}

// ── Generic fetch wrapper ─────────────────────────────────────────────────

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${err}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types mirroring backend responses ────────────────────────────────────

export interface ApiUser {
  userId: number;
  username: string;
  pin: string;
  depId: number | null;
  depName: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface ApiDepartment {
  depId: number;
  depName: string;
}

export interface AppDataResponse {
  adminPin: string;
  users: ApiUser[];
  deletedUsers: ApiUser[];
  departments: ApiDepartment[];
}

// ── User / Auth ───────────────────────────────────────────────────────────

export const getAppData = async (): Promise<AppDataResponse> => {
  const data = await req<AppDataResponse>('/users/app-data');
  _depsCache = data.departments;
  return data;
};

export const createUser = (username: string, pin: string, dep_id?: number): Promise<ApiUser> =>
  req<ApiUser>('/users/', {
    method: 'POST',
    body: JSON.stringify({ username, pin, dep_id: dep_id ?? null }),
  });

export const updateUser = (userId: number, data: { pin?: string; dep_id?: number }): Promise<ApiUser> =>
  req<ApiUser>(`/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const softDeleteUser = (userId: number): Promise<{ detail: string }> =>
  req(`/users/${userId}`, { method: 'DELETE' });

export const restoreUser = (userId: number): Promise<ApiUser> =>
  req<ApiUser>(`/users/${userId}/restore`, { method: 'POST' });

export const permanentlyDeleteUser = (userId: number): Promise<void> =>
  req<void>(`/users/${userId}/permanent`, { method: 'DELETE' });

export const updateAdminPin = (pin: string): Promise<{ detail: string }> =>
  req(`/users/settings/admin-pin`, {
    method: 'PUT',
    body: JSON.stringify({ pin }),
  });

// ── Cards ─────────────────────────────────────────────────────────────────

/** Map backend card response → frontend Card type */
export function mapCard(c: Record<string, unknown>): Card {
  return {
    id:                    c.id as string,
    quoteNumber:           (c.quoteNumber as string) ?? '',
    revisionNumber:        (c.revisionNumber as number) ?? undefined,
    workOrderNumber:       (c.workOrderNumber as string) ?? undefined,
    companyCode:           (c.companyCode as string) ?? undefined,
    date:                  c.date as string,
    salesPerson:           (c.salesPerson as string) ?? '',
    subject:               (c.subject as string) ?? '',
    projectLocation:       (c.projectLocation as string) ?? '',
    list:                  (c.listName as ListType) ?? (c.list as ListType),
    channel:               (c.channelName as ChannelType) ?? (c.channel as ChannelType),
    approved:              (c.approved as boolean) ?? false,
    terminated:            (c.terminated as boolean) ?? false,
    assignedTo:            (c.assignedToUsername as string) ?? (c.assignedTo as string) ?? undefined,
    userWorkStatus:        (c.userWorkStatus as UserWorkStatus) ?? undefined,
    completedAt:           (c.completedAt as string) ?? undefined,
    purchaseOrderDocName:  (c.purchaseOrderDocName as string) ?? undefined,
    purchaseOrderDocUrl:   (c.purchaseOrderDocUrl as string) ?? undefined,
    quotationDocName:      (c.quotationDocName as string) ?? undefined,
    quotationDocUrl:       (c.quotationDocUrl as string) ?? undefined,
    completionDocName:     (c.completionDocName as string) ?? undefined,
    completionDocUrl:      (c.completionDocUrl as string) ?? undefined,
    createdAt:             (c.createdAt as string) ?? '',
    updatedAt:             (c.updatedAt as string) ?? '',
    remarks: ((c.remarks as Record<string, unknown>[]) ?? []).map(r => ({
      id:                  r.id as string,
      list:                (r.listName as ListType) ?? (r.list as ListType),
      type:                r.type as 'Active' | 'Pending' | 'Inactive',
      tags:                (r.tags as string[]) ?? [],
      description:         (r.description as string) ?? '',
      createdBy:           (r.createdByUsername as string) ?? (r.createdBy as string) ?? '',
      createdAt:           (r.createdAt as string) ?? '',
      updatedAt:           (r.updatedAt as string) ?? '',
      visibleDepartments:  depIdsToNames(r.visibleDepIds as number[] | null) as import('@/types').Department[] | undefined,
    })),
    listHistory: ((c.listHistory as Record<string, unknown>[]) ?? []).map(h => ({
      list:      (h.listName as ListType) ?? (h.list as ListType),
      enteredAt: (h.enteredAt as string) ?? '',
    })),
  };
}

/** Build the CardIn body the backend expects */
function toCardIn(card: Card, performedBy?: number) {
  return {
    id:                     card.id,
    quote_number:           card.quoteNumber,
    revision_number:        card.revisionNumber ?? null,
    work_order_number:      card.workOrderNumber ?? null,
    company_code:           card.companyCode ?? null,
    date:                   card.date,
    sales_person:           card.salesPerson,
    subject:                card.subject,
    project_location:       card.projectLocation,
    list_name:              card.list,
    channel_name:           card.channel ?? 'Quotation',
    approved:               card.approved ?? false,
    terminated:             card.terminated ?? false,
    assigned_to_username:   card.assignedTo ?? null,
    user_work_status:       card.userWorkStatus ?? null,
    completed_at:           card.completedAt ?? null,
    purchase_order_doc_name: card.purchaseOrderDocName ?? null,
    purchase_order_doc_url:  card.purchaseOrderDocUrl ?? null,
    quotation_doc_name:     card.quotationDocName ?? null,
    quotation_doc_url:      card.quotationDocUrl ?? null,
    completion_doc_name:    card.completionDocName ?? null,
    completion_doc_url:     card.completionDocUrl ?? null,
    remarks: (card.remarks ?? []).map(r => ({
      id:                   r.id,
      list_name:            r.list,
      type:                 r.type,
      tags:                 r.tags ?? [],
      description:          r.description,
      created_by_username:  r.createdBy ?? null,
      visible_dep_ids:      depNamesToIds(r.visibleDepartments as string[] | undefined),
    })),
    list_history: (card.listHistory ?? []).map(h => ({
      list_name: h.list,
      entered_at: h.enteredAt ?? null,
    })),
    ...(performedBy !== undefined ? { performed_by: performedBy } : {}),
  };
}

export const fetchCards = async (channelName: string): Promise<Card[]> => {
  const data = await req<Record<string, unknown>[]>(`/cards/${encodeURIComponent(channelName)}`);
  return data.map(mapCard);
};

export const createCard = async (card: Card, performedBy?: number): Promise<Card> => {
  const data = await req<Record<string, unknown>>('/cards/', {
    method: 'POST',
    body: JSON.stringify(toCardIn(card, performedBy)),
  });
  return mapCard(data);
};

export const updateCard = async (card: Card, performedBy?: number): Promise<Card> => {
  const data = await req<Record<string, unknown>>(`/cards/${card.id}`, {
    method: 'PUT',
    body: JSON.stringify(toCardIn(card, performedBy)),
  });
  return mapCard(data);
};

export const deleteCard = async (cardId: string, performedBy?: number): Promise<void> => {
  const qs = performedBy !== undefined ? `?performed_by=${performedBy}` : '';
  await req<void>(`/cards/${cardId}${qs}`, { method: 'DELETE' });
};

/**
 * Build an absolute URL for a stored document path.
 * Paths like /files/serve/po/abc.pdf are relative to the API server (port 8001).
 * data: URLs and full http URLs are returned unchanged.
 */
export const docUrl = (path: string | null | undefined): string | undefined => {
  if (!path) return undefined;
  if (path.startsWith('data:') || path.startsWith('http')) return path;
  return `${BASE}${path}`;
};

/** Upload a document file for a card. Returns { fileName, url } with the real serve URL. */
export const uploadDocument = async (
  cardId: string,
  docType: 'po' | 'qtn' | 'completion',
  file: File,
  performedBy?: number,
): Promise<{ fileName: string; url: string }> => {
  const qs = performedBy !== undefined ? `?performed_by=${performedBy}` : '';
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/files/upload/${encodeURIComponent(cardId)}/${docType}${qs}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<{ fileName: string; url: string }>;
};

/** Delete an uploaded document from a card. */
export const deleteDocument = async (
  cardId: string,
  docType: 'po' | 'qtn' | 'completion',
  performedBy?: number,
): Promise<void> => {
  const qs = performedBy !== undefined ? `?performed_by=${performedBy}` : '';
  await req<{ ok: boolean }>(`/files/${encodeURIComponent(cardId)}/${docType}${qs}`, { method: 'DELETE' });
};

// ── WebSocket helper ──────────────────────────────────────────────────────

export function connectWebSocket(
  onMessage: (event: Record<string, unknown>) => void,
  onClose?: () => void,
): WebSocket {
  const wsBase = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8001/ws');
  const ws = new WebSocket(wsBase);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  ws.onclose = onClose ?? (() => {});
  return ws;
}
