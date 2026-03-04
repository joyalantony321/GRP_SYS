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
    orderConfirmationDetails: (() => {
      const oc = c.orderConfirmationDetails as Record<string, unknown> | null | undefined;
      if (!oc) return undefined;
      return {
        lpoNo:                          (oc.lpoNo as string) ?? '',
        qtnNo:                          (oc.qtnNo as string) ?? '',
        date:                           (oc.date as string) ?? '',
        tankBrandSizeTypeValue:         (oc.tankBrandSizeTypeValue as 'yes' | 'no' | '') ?? '',
        paymentTermsConfirmed:          (oc.paymentTermsConfirmed as 'yes' | 'no' | '') ?? '',
        otherTermsCondition:            (oc.otherTermsCondition as 'yes' | 'no' | '') ?? '',
        penaltyConditionsNote:          (oc.penaltyConditionsNote as string) ?? '',
        advancePercent:                 (oc.advancePercent as string) ?? '',
        advanceCDC:                     (oc.advanceCDC as boolean) ?? false,
        advancePDC:                     (oc.advancePDC as boolean) ?? false,
        paymentCollectionFromSite:      (oc.paymentCollectionFromSite as boolean) ?? false,
        paymentCollectionFromOffice:    (oc.paymentCollectionFromOffice as boolean) ?? false,
        deliveryPercent:                (oc.deliveryPercent as string) ?? '',
        deliveryCDC:                    (oc.deliveryCDC as boolean) ?? false,
        deliveryPDC:                    (oc.deliveryPDC as boolean) ?? false,
        deliveryBefore:                 (oc.deliveryBefore as boolean) ?? false,
        deliveryAfter:                  (oc.deliveryAfter as boolean) ?? false,
        securityChequeRequired:         (oc.securityChequeRequired as 'yes' | 'no' | '') ?? '',
        whenRecollect:                  (oc.whenRecollect as string) ?? '',
        workInProgressPercent:          (oc.workInProgressPercent as string) ?? '',
        completionAmount:               (oc.completionAmount as string) ?? '',
        completionCDC:                  (oc.completionCDC as boolean) ?? false,
        completionPDC:                  (oc.completionPDC as boolean) ?? false,
        testingCommissioningAmount:     (oc.testingCommissioningAmount as string) ?? '',
        testingCommissioningCDC:        (oc.testingCommissioningCDC as boolean) ?? false,
        testingCommissioningPDC:        (oc.testingCommissioningPDC as boolean) ?? false,
        retentionAmount:                (oc.retentionAmount as string) ?? '',
        retentionCDC:                   (oc.retentionCDC as boolean) ?? false,
        retentionPDC:                   (oc.retentionPDC as boolean) ?? false,
        otherCommittedTerms:            (oc.otherCommittedTerms as string) ?? '',
        accountsName:                   (oc.accountsName as string) ?? '',
        accountsEmail:                  (oc.accountsEmail as string) ?? '',
        accountsTelMob:                 (oc.accountsTelMob as string) ?? '',
        invoiceSubmissionOffice:        (oc.invoiceSubmissionOffice as boolean) ?? false,
        invoiceSubmissionSite:          (oc.invoiceSubmissionSite as boolean) ?? false,
        warrantyManualSubmissionTime:   (oc.warrantyManualSubmissionTime as string) ?? '',
        projectName:                    (oc.projectName as string) ?? '',
        projectEmail:                   (oc.projectEmail as string) ?? '',
        projectTelMob:                  (oc.projectTelMob as string) ?? '',
        salesExecutiveName:             (oc.salesExecutiveName as string) ?? '',
        managerName:                    (oc.managerName as string) ?? '',
      };
    })(),
    workOrderDetails: (c.workOrderDetails as Card['workOrderDetails']) ?? undefined,
  };
}

/** Build the CardIn body the backend expects */
function toCardIn(card: Card, performedBy?: number) {
  const oc = card.orderConfirmationDetails;
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
    order_confirmation_details: oc ? {
      lpo_no:                          oc.lpoNo ?? null,
      qtn_no:                          oc.qtnNo ?? null,
      date:                            oc.date ?? null,
      tank_brand_size_type_value:      oc.tankBrandSizeTypeValue || null,
      payment_terms_confirmed:         oc.paymentTermsConfirmed || null,
      other_terms_condition:           oc.otherTermsCondition || null,
      penalty_conditions_note:         oc.penaltyConditionsNote || null,
      advance_percent:                 oc.advancePercent || null,
      advance_cdc:                     oc.advanceCDC,
      advance_pdc:                     oc.advancePDC,
      payment_collection_from_site:    oc.paymentCollectionFromSite,
      payment_collection_from_office:  oc.paymentCollectionFromOffice,
      delivery_percent:                oc.deliveryPercent || null,
      delivery_cdc:                    oc.deliveryCDC,
      delivery_pdc:                    oc.deliveryPDC,
      delivery_before:                 oc.deliveryBefore,
      delivery_after:                  oc.deliveryAfter,
      security_cheque_required:        oc.securityChequeRequired || null,
      when_recollect:                  oc.whenRecollect || null,
      work_in_progress_percent:        oc.workInProgressPercent || null,
      completion_amount:               oc.completionAmount || null,
      completion_cdc:                  oc.completionCDC,
      completion_pdc:                  oc.completionPDC,
      testing_commissioning_amount:    oc.testingCommissioningAmount || null,
      testing_commissioning_cdc:       oc.testingCommissioningCDC,
      testing_commissioning_pdc:       oc.testingCommissioningPDC,
      retention_amount:                oc.retentionAmount || null,
      retention_cdc:                   oc.retentionCDC,
      retention_pdc:                   oc.retentionPDC,
      other_committed_terms:           oc.otherCommittedTerms || null,
      accounts_name:                   oc.accountsName || null,
      accounts_email:                  oc.accountsEmail || null,
      accounts_tel_mob:                oc.accountsTelMob || null,
      invoice_submission_office:       oc.invoiceSubmissionOffice,
      invoice_submission_site:         oc.invoiceSubmissionSite,
      warranty_manual_submission_time: oc.warrantyManualSubmissionTime || null,
      project_name:                    oc.projectName || null,
      project_email:                   oc.projectEmail || null,
      project_tel_mob:                 oc.projectTelMob || null,
      sales_executive_name:            oc.salesExecutiveName || null,
      manager_name:                    oc.managerName || null,
    } : null,
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
