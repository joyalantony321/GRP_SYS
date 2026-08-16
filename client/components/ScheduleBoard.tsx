import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  format, addDays, parseISO, isToday, isSunday,
  differenceInCalendarDays, startOfDay, isBefore,
} from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  X, Plus, ChevronLeft, ChevronRight, Truck, Wrench, Users,
  CheckCircle, MessageSquare, AlertTriangle, Zap, CalendarRange,
  ChevronDown, Check, FileText, ClipboardList, Search,
  TrendingUp, Clock, ArrowUp, Maximize2, RotateCcw, MapPin, Activity, Inbox,
} from 'lucide-react';
import { Card as WorkOrderCard, ChannelType, ScheduleStage, TankDetail } from '@/types';
import { fetchCards, updateCard, fetchPendingReportDetails, generateDailyReports, PendingReportDetailsResponse, PendingReportRow } from '@/lib/api';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ScRemarkMedia {
  id: string;
  kind: 'image' | 'video';
  name: string;
  dataUrl: string;
}

interface ScRemark {
  id: string;
  text: string;
  author: string;
  at: string;
  media?: ScRemarkMedia[];
}

interface ScDelayPeriod {
  startDate: string;
  endDate?: string;
}

type SchedulePhase = 'delivery' | 'installation';

interface ScTankProgress {
  tankDetailId: string;
  label: string;
  tankSize: string;
  qty: string;
  itemDescription: string;
  tankType: '' | 'INS' | 'NON-INS';
  remarks: string;
  // "Delivery Status" / "Installation Status" dropdown values.
  deliveryStatus: 'Not scheduled' | 'Scheduled' | 'Partial delivery' | 'Fully delivered';
  installationStatus: 'Not scheduled' | 'Scheduled' | 'Partial Installed' | 'Fully Installed';
  deliveryStatusText?: string;
  installationStatusText?: string;
  workers: string[];
  // "Del. Date" / "Inst. Start" — editable, auto-stamped to today whenever the
  // status moves away from "Not scheduled"; can still be edited manually after.
  scheduledDate?: string;
  completionDate?: string;
}

export interface ScCard {
  id: string; woCode: string; listId: string; workers: string[];
  updatedAt?: string;
  sourceCardId?: string;
  phase?: SchedulePhase;
  tankDetailId?: string;
  tankLabel?: string;
  scheduleType?: 'Delivery' | 'Installation' | 'Delivery & Installation';
  isEmergency: boolean; paymentPercent: number; isConfirmed: boolean;
  confirmedDate?: string; remarks: ScRemark[]; createdAt: string;
  brand?: string; productType?: string;
  customer?: string; location?: string; tankSize?: string;
  deliveryPerson?: string;
  sectionRemarks?: string;
  tanks?: ScTankProgress[];
  contactPerson?: string; phone?: string; salesPerson?: string;
  deliveryStatus?: string;
  installationStatus?: string;
  completedDate?: string;
  delayPeriods?: ScDelayPeriod[];
  returnedFromDate?: string;
}
type ScStore = Record<string, ScCard[]>;

const EMPTY_STORE: ScStore = {
  'pending-delivery': [],
  'status-delivery': [],
  'planning-delivery': [],
  'pending-installation': [],
  'status-installation': [],
  'planning-installation': [],
  'archive-completed': [],
};

const DELIVERY_PENDING = 'pending-delivery';
const DELIVERY_STATUS = 'status-delivery';
const DELIVERY_PLANNING = 'planning-delivery';
const INSTALLATION_PENDING = 'pending-installation';
const INSTALLATION_STATUS = 'status-installation';
const INSTALLATION_PLANNING = 'planning-installation';
const ARCHIVE_COMPLETED = 'archive-completed';
const isDeliveryListId = (listId: string) => listId.endsWith('-delivery');
const isInstallationListId = (listId: string) => listId.endsWith('-installation');
const isArchiveListId = (listId: string) => listId === ARCHIVE_COMPLETED;
const getPhaseForListId = (listId: string): SchedulePhase => (isInstallationListId(listId) ? 'installation' : 'delivery');
const getPendingListForPhase = (phase: SchedulePhase) => phase === 'delivery' ? DELIVERY_PENDING : INSTALLATION_PENDING;
const getStatusListForPhase = (phase: SchedulePhase) => phase === 'delivery' ? DELIVERY_STATUS : INSTALLATION_STATUS;
const getPlanningListForPhase = (phase: SchedulePhase) => phase === 'delivery' ? DELIVERY_PLANNING : INSTALLATION_PLANNING;

const toTankProgress = (card: WorkOrderCard, existingById: Record<string, ScTankProgress> = {}): ScTankProgress[] => {
  const woTanks = card.tankDetails ?? [];
  if (woTanks.length === 0) {
    const id = 'base';
    const existing = existingById[id];
    return [{
      tankDetailId: id,
      label: 'T1',
      tankSize: deriveTankSize(card) || '',
      qty: existing?.qty ?? '1',
      itemDescription: '',
      tankType: '',
      remarks: existing?.remarks ?? '',
      deliveryStatus: existing?.deliveryStatus ?? 'Not scheduled',
      installationStatus: existing?.installationStatus ?? 'Not scheduled',
      workers: existing?.workers ?? [],
      scheduledDate: existing?.scheduledDate,
      completionDate: existing?.completionDate,
    }];
  }
  return woTanks.map((tank, index) => {
    const id = tank.id || `tank-${index + 1}`;
    const existing = existingById[id];
    return {
      tankDetailId: id,
      label: tank.label || `T${index + 1}`,
      tankSize: tank.itemDescription || '',
      qty: tank.qty || '1',
      itemDescription: '',
      tankType: tank.tankType || '',
      remarks: existing?.remarks ?? (tank.remarks || ''),
      deliveryStatus: existing?.deliveryStatus ?? 'Not scheduled',
      installationStatus: existing?.installationStatus ?? 'Not scheduled',
      workers: existing?.workers ?? [],
      scheduledDate: existing?.scheduledDate,
      completionDate: existing?.completionDate,
    };
  });
};

const GANTT_VISIBLE_DAYS = 9;
const GANTT_TOTAL_DAYS = 16;
const GANTT_MIN_DAY_WIDTH = 36;
const GANTT_MAX_DAY_WIDTH = 160;
const NUM_COLS = 9;
const INSTALLATION_COLS = 9;
const BRAND_OPTIONS = ['COLEX', 'PIPECO'] as const;

const normalizeBrand = (brand?: string): string | undefined => {
  if (!brand) return undefined;
  const upper = brand.toUpperCase();
  if (upper.includes('COLEX')) return 'COLEX';
  if (upper.includes('PIPECO') || upper.includes('PIPECO')) return 'PIPECO';
  return brand;
};

const deriveProductType = (card: WorkOrderCard): string | undefined => {
  const details = card.workOrderDetails;
  if (!details) return card.subject || undefined;
  if (details.typeInsulated && details.typeNonInsulated) return 'Insulated / Non-Insulated';
  if (details.typeInsulated) return 'Insulated';
  if (details.typeNonInsulated) return 'Non-Insulated';
  return card.subject || details.jobDescription || undefined;
};

const deriveTankSize = (card: WorkOrderCard): string | undefined => {
  if ((card.tankDetails ?? []).length > 0) return undefined;
  const details = card.workOrderDetails;
  if (!details) return undefined;
  const firstItem = details.items?.find(item => item.itemDescription?.trim());
  return firstItem?.itemDescription?.trim() || undefined;
};

const makeScheduleCardId = (cardId: string, phase: SchedulePhase) => `wo-${cardId}-${phase}`;

const deriveContactPerson = (card: WorkOrderCard): string | undefined => {
  const details = card.workOrderDetails;
  if (!details) return undefined;
  return details.deliveryContactName?.trim() || details.companyContactName?.trim() || undefined;
};

const derivePhoneNumber = (card: WorkOrderCard): string | undefined => {
  const details = card.workOrderDetails;
  if (!details) return undefined;
  return details.deliveryContactNumber?.trim() || details.companyPhone?.trim() || undefined;
};

const dateKey = (date = new Date()) => format(date, 'yyyy-MM-dd');

const normalizeWoCode = (value?: string): string => (value ?? '').trim().replace(/^WO-/i, '');

const deriveWoCode = (card: WorkOrderCard): string =>
  normalizeWoCode((card.workOrderNumber || card.quoteNumber || '').split('/').pop() || String(card.id));

const isCardDelayedOnDate = (card: ScCard, day: string) => {
  const target = startOfDay(parseISO(day)).getTime();
  return (card.delayPeriods ?? []).some(period => {
    const start = startOfDay(parseISO(period.startDate)).getTime();
    const end = period.endDate
      ? startOfDay(parseISO(period.endDate)).getTime()
      : Number.POSITIVE_INFINITY;
    return target >= start && target <= end;
  });
};

const isCardCurrentlyDelayed = (card: ScCard) => Boolean((card.delayPeriods ?? []).some(period => !period.endDate));

/** Builds the compact day-by-day progress strip (green = in progress, red = pending/delayed)
 * for a card's hover mini-gantt, matching the original full-timeline gantt's coloring rule. */
const getCardGanttDays = (card: ScCard, maxDays = 14) => {
  const startDate = startOfDay(parseISO(card.confirmedDate || card.createdAt || dateKey()));
  const endAnchor = card.completedDate ? startOfDay(parseISO(card.completedDate)) : startOfDay(new Date());
  const progressedDays = Math.max(1, differenceInCalendarDays(endAnchor, startDate) + 1);
  const shown = Math.min(progressedDays, maxDays);
  return Array.from({ length: shown }, (_, idx) => {
    const segmentDate = format(addDays(endAnchor, -(shown - 1 - idx)), 'yyyy-MM-dd');
    return {
      key: `${card.id}-${segmentDate}`,
      date: segmentDate,
      color: isCardDelayedOnDate(card, segmentDate) ? '#ef4444' : '#22c55e',
    };
  });
};

const flattenCards = (store: ScStore): ScCard[] => Object.values(store).flat();

/** Pending must always hold the full, permanent set of cards for a phase.
 * While a card is actively being worked on in Planning/Status, Pending shows
 * a live duplicate of it (kept up to date on every render) so it never goes
 * missing; Status/Planning are cleared out at the next daily reset while
 * Pending's own copy (upserted at that point) persists. */
const mirrorPendingWithSources = (store: ScStore, phase: SchedulePhase): ScCard[] => {
  const pendingId = getPendingListForPhase(phase);
  const statusId = getStatusListForPhase(phase);
  const planningId = getPlanningListForPhase(phase);
  const byIdentity = new Map<string, ScCard>();
  (store[pendingId] ?? []).forEach(card => byIdentity.set(getCardIdentity(card), card));
  [...(store[statusId] ?? []), ...(store[planningId] ?? [])].forEach(card => {
    // Keep the card's true listId (status-*/planning-*) so callers can tell
    // a mirrored duplicate apart from a genuine pending-only entry.
    byIdentity.set(getCardIdentity(card), card);
  });
  return Array.from(byIdentity.values());
};

/**
 * Best-effort reconstruction of "what the schedule looked like on a given
 * past/future date" for the read-only date search feature. We don't keep a
 * full per-day audit log, so this approximates by:
 *  - Excluding cards that didn't exist yet (createdAt after the search date).
 *  - Excluding archived (fully completed) cards that were already completed
 *    and removed on/before the search date.
 *  - Placing archived cards that were still incomplete on the search date
 *    back into their phase's STATUS column (their last known active stage).
 *  - Otherwise showing currently-active cards in their current list.
 */
const buildHistoricalStore = (base: ScStore, searchDay: string): ScStore => {
  const day = startOfDay(parseISO(searchDay)).getTime();
  const next: ScStore = {};
  Object.keys(base).forEach(listId => {
    if (!isArchiveListId(listId)) next[listId] = [];
  });
  next[ARCHIVE_COMPLETED] = [];

  const activeByIdentity = new Map<string, { card: ScCard; listId: string }>();
  Object.entries(base).forEach(([listId, cards]) => {
    if (isArchiveListId(listId)) return;
    (cards ?? []).forEach(card => activeByIdentity.set(getCardIdentity(card), { card, listId }));
  });

  const existedByDay = (card: ScCard) => {
    const createdTime = Date.parse(card.createdAt || '');
    if (Number.isNaN(createdTime)) return true;
    return startOfDay(createdTime).getTime() <= day;
  };

  const seen = new Set<string>();
  (base[ARCHIVE_COMPLETED] ?? []).forEach(card => {
    const identity = getCardIdentity(card);
    seen.add(identity);
    if (!existedByDay(card)) return;
    const completedTime = Date.parse(card.completedDate || card.confirmedDate || card.updatedAt || '');
    if (!Number.isNaN(completedTime) && startOfDay(completedTime).getTime() <= day) return;
    const phase = card.phase ?? 'delivery';
    const statusListId = phase === 'installation' ? 'status-installation' : 'status-delivery';
    if (!next[statusListId]) next[statusListId] = [];
    next[statusListId].push(card);
  });

  activeByIdentity.forEach(({ card, listId }, identity) => {
    if (seen.has(identity)) return;
    if (!existedByDay(card)) return;
    if (!next[listId]) next[listId] = [];
    next[listId].push(card);
  });

  return next;
};

const getCardIdentity = (card: ScCard) => `${card.sourceCardId ?? card.id}:${card.phase ?? getPhaseForListId(card.listId)}`;

const collectCardByIdentity = (store: ScStore): Record<string, ScCard> => {
  const result: Record<string, ScCard> = {};
  flattenCards(store).forEach(card => {
    result[getCardIdentity(card)] = card;
  });
  return result;
};

const isCardCompleteForPhase = (card: ScCard, phase: SchedulePhase): boolean => {
  const tanks = card.tanks ?? [];
  if (tanks.length === 0) {
    if (phase === 'delivery') return card.deliveryStatus === 'Fully delivered' || card.deliveryStatus === 'Completed';
    return card.installationStatus === 'Fully Installed' || card.installationStatus === 'Completed' || !!card.completedDate;
  }
  if (phase === 'delivery') return tanks.every(t => t.deliveryStatus === 'Fully delivered');
  return tanks.every(t => t.installationStatus === 'Fully Installed');
};

const getTanksLeftForPhase = (card: ScCard, phase: SchedulePhase): number => {
  const tanks = card.tanks ?? [];
  if (tanks.length === 0) return isCardCompleteForPhase(card, phase) ? 0 : 1;
  if (phase === 'delivery') return tanks.filter(t => t.deliveryStatus !== 'Fully delivered').length;
  return tanks.filter(t => t.installationStatus !== 'Fully Installed').length;
};

const getPhaseStatusLabel = (card: ScCard, phase: SchedulePhase): string => {
  const tanks = card.tanks ?? [];
  if (tanks.length === 0) {
    if (phase === 'delivery') return card.deliveryStatus || 'Not scheduled';
    return card.installationStatus || 'Not scheduled';
  }
  const completed = getTanksLeftForPhase(card, phase) === 0;
  if (completed) return phase === 'delivery' ? 'Fully delivered' : 'Fully Installed';
  if (phase === 'delivery') {
    return tanks.some(t => t.deliveryStatus === 'Partial delivery' || t.deliveryStatus === 'Scheduled' || t.deliveryStatus === 'Fully delivered')
      ? 'Partial delivery'
      : 'Not scheduled';
  }
  return tanks.some(t => t.installationStatus === 'Partial Installed' || t.installationStatus === 'Scheduled' || t.installationStatus === 'Fully Installed')
    ? 'Partial Installed'
    : 'Not scheduled';
};

const getScheduleStage = (card: ScCard, listId: string): ScheduleStage => {
  const phase = getPhaseForListId(listId);
  const isPending = listId.startsWith('pending-');
  const isPlanning = listId.startsWith('planning-');
  const isStatus = listId.startsWith('status-');
  if (phase === 'delivery') {
    if (isPending || isPlanning) return 'Pending delivery';
    if (isStatus && isCardCompleteForPhase(card, 'delivery')) return 'Delivery completed';
    return 'Delivery scheduled';
  }
  if (isPending || isPlanning) return 'Pending installation';
  if (isStatus && isCardCompleteForPhase(card, 'installation')) return 'Installation completed';
  if (isStatus && card.isConfirmed) return 'Installation in progress';
  return 'Installation scheduled';
};

const sortScheduleGroup = (cards: ScCard[]) => {
  const entryTime = (card: ScCard) => Date.parse(card.returnedFromDate || card.confirmedDate || card.createdAt || '') || 0;
  return [...cards].sort((left, right) => {
    if (left.isEmergency !== right.isEmergency) return left.isEmergency ? -1 : 1;
    const timeDiff = entryTime(left) - entryTime(right);
    if (timeDiff !== 0) return timeDiff;
    return normalizeWoCode(left.woCode).localeCompare(normalizeWoCode(right.woCode));
  });
};

const inferScheduleTypeFromWorkOrder = (card: WorkOrderCard): 'Delivery' | 'Installation' | 'Delivery & Installation' => {
  if (card.scheduleType === 'Delivery & Installation') return 'Delivery & Installation';
  if (card.scheduleType === 'Installation' || card.list === 'Installation') return 'Installation';
  if (card.scheduleType === 'Delivery' || card.list === 'Delivery') return 'Delivery';
  const stage = (card.scheduleStage ?? '').toLowerCase();
  if (stage.includes('installation')) return 'Installation';
  return 'Delivery';
};

const hasExplicitScheduleMetadata = (card: WorkOrderCard): boolean => {
  if (card.scheduleType === 'Delivery' || card.scheduleType === 'Installation' || card.scheduleType === 'Delivery & Installation') return true;
  const stage = (card.scheduleStage ?? '').toLowerCase();
  return stage.includes('delivery') || stage.includes('installation');
};

const toScheduleCards = (card: WorkOrderCard): ScCard[] => {
  const scheduleType = inferScheduleTypeFromWorkOrder(card);
  const baseWoCode = deriveWoCode(card);
  const details = card.workOrderDetails;
  const tanks = toTankProgress(card);
  const phases: SchedulePhase[] = scheduleType === 'Delivery & Installation' ? ['delivery', 'installation'] : [scheduleType === 'Installation' ? 'installation' : 'delivery'];
  return phases.map(phase => ({
    id: makeScheduleCardId(String(card.id), phase),
    sourceCardId: card.id,
    phase,
    woCode: baseWoCode,
    scheduleType,
    listId: getPendingListForPhase(phase),
    workers: [],
    isEmergency: false,
    paymentPercent: typeof card.paymentPercent === 'number' ? card.paymentPercent : 0,
    isConfirmed: false,
    remarks: [],
    createdAt: card.createdAt || new Date().toISOString(),
    customer: card.customerName || card.customerCompanyName || undefined,
    location: card.projectLocation || undefined,
    tankSize: tanks.map(t => t.tankSize).filter(Boolean).join(', ') || deriveTankSize(card),
    tanks,
    contactPerson: deriveContactPerson(card),
    phone: derivePhoneNumber(card),
    salesPerson: card.salesPerson || undefined,
    brand: normalizeBrand(details?.brand),
    productType: deriveProductType(card),
  }));
};

const mergeScheduleWithWorkOrder = (store: ScStore, woCards: WorkOrderCard[], referenceDay: string = dateKey()): ScStore => {
  const next: ScStore = JSON.parse(JSON.stringify(store));
  if (!next[ARCHIVE_COMPLETED]) next[ARCHIVE_COMPLETED] = [];

  const byIdentity: Record<string, ScCard> = {};
  Object.entries(next).forEach(([listId, cards]) => {
    if (isArchiveListId(listId)) return;
    (cards ?? []).forEach(card => {
      byIdentity[getCardIdentity(card)] = card;
    });
  });

  const archivedByIdentity: Record<string, ScCard> = {};
  (next[ARCHIVE_COMPLETED] ?? []).forEach(card => {
    archivedByIdentity[getCardIdentity(card)] = card;
  });

  const todayRef = startOfDay(parseISO(referenceDay));
  const relevant = woCards.filter(card => {
    if (!hasExplicitScheduleMetadata(card) && card.list !== 'Schedule' && card.list !== 'Delivery' && card.list !== 'Installation') return false;
    const payment = typeof card.paymentPercent === 'number' ? card.paymentPercent : 0;
    if (payment < 100) return true;
    if (!card.completedAt) return true;
    const completed = new Date(card.completedAt);
    if (Number.isNaN(completed.getTime())) return true;
    return startOfDay(completed).getTime() >= todayRef.getTime();
  });

  const relevantIds = new Set(relevant.map(c => String(c.id)));

  // Remove schedule cards that are linked to WO cards no longer in Delivery/Installation
  Object.keys(next).forEach(listId => {
    if (isArchiveListId(listId)) return;
    next[listId] = (next[listId] ?? []).filter(sc => !sc.sourceCardId || relevantIds.has(String(sc.sourceCardId)));
  });

  relevant.forEach(wo => {
    const inferredType = inferScheduleTypeFromWorkOrder(wo);
    const freshCards = toScheduleCards(wo);
    const freshIdentities = new Set(freshCards.map(getCardIdentity));

    Object.keys(next).forEach(listId => {
      if (isArchiveListId(listId)) return;
      next[listId] = (next[listId] ?? []).filter(sc => {
        if (String(sc.sourceCardId) !== String(wo.id)) return true;
        return freshIdentities.has(getCardIdentity(sc));
      });
    });

    freshCards.forEach(fresh => {
      const identity = getCardIdentity(fresh);
      const existing = byIdentity[identity];
      const archived = archivedByIdentity[identity];

      if (!existing && archived) {
        const archivedAt = Date.parse(archived.updatedAt || archived.completedDate || archived.confirmedDate || archived.createdAt || '');
        const woUpdatedAt = Date.parse(wo.updatedAt || wo.createdAt || '');
        if (!Number.isNaN(archivedAt) && (Number.isNaN(woUpdatedAt) || woUpdatedAt <= archivedAt)) {
          return;
        }
      }

      if (existing) {
        existing.woCode = fresh.woCode;
        existing.scheduleType = fresh.scheduleType;
        existing.phase = fresh.phase;
        existing.paymentPercent = typeof wo.paymentPercent === 'number' ? wo.paymentPercent : 0;
        existing.customer = wo.customerName || wo.customerCompanyName || undefined;
        existing.location = wo.projectLocation || undefined;
        existing.tankSize = fresh.tankSize;
        const existingTankById = Object.fromEntries((existing.tanks ?? []).map(t => [t.tankDetailId, t]));
        existing.tanks = toTankProgress(wo, existingTankById);
        existing.contactPerson = deriveContactPerson(wo);
        existing.phone = derivePhoneNumber(wo);
        existing.salesPerson = wo.salesPerson || undefined;
        existing.brand = normalizeBrand(wo.workOrderDetails?.brand);
        existing.productType = deriveProductType(wo);
        if (!existing.listId || (!existing.listId.startsWith('pending-') && !existing.listId.startsWith('status-') && !existing.listId.startsWith('planning-'))) {
          existing.listId = getPendingListForPhase(existing.phase ?? getPhaseForListId(fresh.listId));
        }
        return;
      }

      const seeded = archived
        ? {
            ...fresh,
            workers: archived.workers?.length ? archived.workers : fresh.workers,
            sectionRemarks: fresh.sectionRemarks || archived.sectionRemarks,
            tanks: (fresh.tanks ?? []).map(t => {
              const archivedTank = (archived.tanks ?? []).find(at => at.tankDetailId === t.tankDetailId);
              return {
                ...t,
                workers: t.workers?.length ? t.workers : (archivedTank?.workers ?? []),
              };
            }),
          }
        : fresh;

      if (!next[seeded.listId]) next[seeded.listId] = [];
      next[seeded.listId] = [seeded, ...next[seeded.listId]];
    });
  });

  return next;
};

const normalizeStore = (raw: unknown): ScStore => {
  const normalized: ScStore = {
    'pending-delivery': [],
    'status-delivery': [],
    'planning-delivery': [],
    'pending-installation': [],
    'status-installation': [],
    'planning-installation': [],
    [ARCHIVE_COMPLETED]: [],
  };
  if (!raw || typeof raw !== 'object') return normalized;
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      const mappedKey =
        key === 'pending-delivery' || key === 'pending-installation' || key === 'status-delivery' || key === 'status-installation' || key === 'planning-delivery' || key === 'planning-installation' || key === ARCHIVE_COMPLETED
          ? key
          : key.startsWith('delivery-')
            ? 'status-delivery'
            : key.startsWith('installation-')
              ? 'status-installation'
              : key;
      if (!normalized[mappedKey]) normalized[mappedKey] = [];
      normalized[mappedKey] = [...normalized[mappedKey], ...(value as ScCard[]).map(card => ({
        ...card,
        woCode: normalizeWoCode(card.woCode),
        phase: card.phase ?? (mappedKey === ARCHIVE_COMPLETED ? card.phase : getPhaseForListId(mappedKey)),
      }))];
    }
  });
  return normalized;
};

/* ─── Colour system ──────────────────────────────────────────────────────── */

/** 4-tier payment colour: red 0%, yellow 1-49%, blue 50-99%, green 100% */
const pColor = (p: number) => p === 0 ? '#ef4444' : p < 50 ? '#eab308' : p < 100 ? '#3b82f6' : '#22c55e';
const pBorder = (p: number) => p === 0 ? '#dc2626' : p < 50 ? '#ca8a04' : p < 100 ? '#2563eb' : '#16a34a';
const pBg    = (p: number) => p === 0 ? '#fef2f2' : p < 50 ? '#fefce8' : p < 100 ? '#eff6ff' : '#f0fdf4';

/** Distinct colour per tank status value: gray = not started/not delivered,
 * amber = partially delivered/installed, green = completed. */
const tankStatusColorClass = (s: string) => {
  if (s === 'Fully delivered' || s === 'Fully Installed' || s === 'Completed') return 'bg-emerald-100 border-emerald-300 text-emerald-700';
  if (s === 'Partial delivery' || s === 'Partial Installed' || s === 'Scheduled') return 'bg-amber-100 border-amber-300 text-amber-700';
  return 'bg-gray-100 border-gray-300 text-gray-600';
};

/** Dot rules:
 * - Delivery/Installation columns: green only when confirmed (started/delivered)
 * - Pending columns: red only when returned from schedule
 */
const dateDot = (card: ScCard) => (card.isConfirmed ? '#22c55e' : '');
const pendDot = (card: ScCard) => (card.returnedFromDate ? '#ef4444' : '');

type MatrixColumn = {
  key: 'wo' | 'payment' | 'customer' | 'brand' | 'location' | 'tanks' | 'status' | 'owner' | 'delPerson' | 'remarks' | 'tankBreakdown';
  label: string;
};

const getMatrixTemplateColumns = (columns: MatrixColumn[]) => {
  const widths: Record<MatrixColumn['key'], string> = {
    wo: '0.7fr',
    payment: '0.5fr',
    customer: '1fr',
    brand: '0.65fr',
    location: '0.85fr',
    tanks: '0.55fr',
    status: '0.95fr',
    owner: '0.95fr',
    delPerson: '0.85fr',
    remarks: '1.1fr',
    tankBreakdown: '0.7fr',
  };
  // minmax(0, ...) lets each grid track shrink below its content's natural
  // (max-content) width — plain "Nfr" tracks default to an "auto" minimum,
  // which ignores the fr weighting and forces the row to overflow/wrap onto a
  // second visual line once combined content exceeds the card's width.
  return columns.map(c => `minmax(0, ${widths[c.key]})`).join(' ');
};

/** Landing-page card columns (before expanding): WO No, Payment, Customer,
 * Brand, Location, Tanks/Materials. */
const getMatrixColumns = (_listId: string, phase: SchedulePhase): MatrixColumn[] => {
  const cols: MatrixColumn[] = [
    { key: 'wo', label: 'WO No' },
    { key: 'payment', label: 'Payment' },
    { key: 'customer', label: 'Customer' },
    { key: 'brand', label: 'Brand' },
    { key: 'location', label: 'Location' },
  ];
  cols.push({ key: 'tankBreakdown', label: 'Tanks/Materials' });
  return cols;
};

const getTankRemarksSummary = (card: ScCard) => {
  const tanks = card.tanks ?? [];
  if (tanks.length === 0) return '';
  const lines = tanks
    .map(t => {
      const parts = [t.itemDescription, t.remarks].filter(Boolean);
      if (parts.length === 0) return '';
      return `${t.label}: ${parts.join(' | ')}`;
    })
    .filter(Boolean);
  return lines.join(' ; ');
};

const getMatrixCellValue = (card: ScCard, listId: string, phase: SchedulePhase, key: MatrixColumn['key']): string => {
  const isPending = listId.startsWith('pending-');
  const tanksLeft = String(getTanksLeftForPhase(card, phase));
  const status = isPending ? getPhaseStatusLabel(card, phase) : '-';
  const owner = phase === 'delivery'
    ? (card.deliveryPerson || '-')
    : ((card.workers ?? []).join(', ') || '-');
  const remarks = card.sectionRemarks || getTankRemarksSummary(card) || '-';
  switch (key) {
    case 'wo':
      return normalizeWoCode(card.woCode);
    case 'payment':
      return `${card.paymentPercent ?? 0}%`;
    case 'delPerson':
      return card.deliveryPerson || '-';
    case 'brand':
      return card.brand || '-';
    case 'tanks':
      return tanksLeft;
    case 'owner':
      return owner;
    case 'customer':
      return card.customer || '-';
    case 'location':
      return card.location || '-';
    case 'status':
      return status;
    case 'remarks':
      return remarks;
    case 'tankBreakdown':
      return '';
    default:
      return '-';
  }
};

/* ─── CardChip – used in BOTH date columns AND pending ───────────────────── */

function CardChip({
  card, listId, index, isPending, onOpen, isDragDisabled, dragKey,
}: {
  card: ScCard;
  listId: string;
  index: number;
  isPending?: boolean;
  onOpen: () => void;
  isDragDisabled?: boolean;
  dragKey?: string;
}) {
  const [tipPos, setTipPos] = useState<{x:number;y:number}|null>(null);
  const woCode = normalizeWoCode(card.woCode);
  const dot = isPending ? pendDot(card) : dateDot(card);
  const showDot = Boolean(dot);
  const phase = getPhaseForListId(listId);
  const columns = getMatrixColumns(listId, phase);
  const gridTemplateColumns = getMatrixTemplateColumns(columns);
  const statusText = getPhaseStatusLabel(card, phase);
  const payPct = card.paymentPercent ?? 0;

  return (
    <Draggable draggableId={dragKey ?? card.id} index={index} isDragDisabled={isDragDisabled}>
      {(prov, snap) => {
        // The card is unmounted/repositioned by the DnD library mid-drag, so
        // onMouseLeave never fires on drop — clear the stuck tooltip here instead.
        if (snap.isDragging && tipPos) setTipPos(null);
        return (
        <>
          <div
            ref={prov.innerRef}
            {...prov.draggableProps}
            {...prov.dragHandleProps}
            onClick={e => { e.stopPropagation(); onOpen(); }}
            onMouseEnter={e => { if(!snap.isDragging) setTipPos({x:e.clientX,y:e.clientY}); }}
            onMouseMove={e => { if(!snap.isDragging) setTipPos({x:e.clientX,y:e.clientY}); }}
            onMouseLeave={() => setTipPos(null)}
            className={`group relative rounded-lg bg-white border cursor-grab select-none transition-all mb-1 min-w-0 pl-2.5 pr-2 py-1.5
              ${card.isEmergency ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200 hover:border-gray-300'}
              ${snap.isDragging ? 'shadow-lg opacity-90 rotate-[0.5deg]' : 'hover:shadow-[0_2px_10px_rgba(15,23,42,0.06)] hover:-translate-y-px'}`}
            style={{
              ...(prov.draggableProps.style as React.CSSProperties),
              borderLeft: `3px solid ${card.isEmergency ? '#ef4444' : pColor(payPct)}`,
            }}
          >
            <div className="grid gap-1.5 min-w-0 items-center" style={{ gridTemplateColumns }}>
              {columns.map(col => {
                const value = getMatrixCellValue(card, listId, phase, col.key);
                const isWo = col.key === 'wo';
                const isTankBreakdown = col.key === 'tankBreakdown';
                if (isTankBreakdown) {
                  const tankCount = (card.tanks ?? []).length || 1;
                  return (
                    <div key={col.key} className="text-[11px] leading-4 text-gray-700 min-w-0 text-center font-semibold">
                      {tankCount}
                    </div>
                  );
                }
                return (
                  <div key={col.key} className="text-[10px] leading-4 text-gray-600 truncate min-w-0">
                    {isWo ? (
                      <span className="inline-flex items-center gap-1">
                        {showDot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />}
                        <span className="font-bold text-slate-800 truncate">#{value}</span>
                        {card.isEmergency && (
                          <span className="inline-flex items-center gap-0.5 flex-shrink-0 text-[8px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" />URGENT
                          </span>
                        )}
                      </span>
                    ) : col.key === 'payment' ? (
                      <span
                        className="inline-flex items-center justify-center font-bold text-[9px] px-1.5 py-0.5 rounded-md whitespace-nowrap"
                        style={{ color: pColor(payPct), backgroundColor: pBg(payPct), border: `1px solid ${pBorder(payPct)}` }}
                      >
                        {value}
                      </span>
                    ) : col.key === 'brand' ? (
                      value === '-' ? <span className="text-gray-300">-</span> : (
                        <span className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wide text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                          {value}
                        </span>
                      )
                    ) : col.key === 'location' ? (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <MapPin className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
                        <span className="truncate">{value}</span>
                      </span>
                    ) : (
                      value
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {tipPos && (
            <div style={{position:'fixed',left:tipPos.x+12,top:tipPos.y+16,zIndex:9999,backgroundColor:'white',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 10px',fontSize:11,color:'#374151',boxShadow:'0 4px 12px rgba(0,0,0,0.12)',pointerEvents:'none',minWidth:180}}>
              <div style={{fontWeight:700,fontSize:12,color:'#111827',marginBottom:3,whiteSpace:'nowrap'}}>WO: {woCode}</div>
              {card.brand && <div style={{marginBottom:1,whiteSpace:'nowrap'}}>Brand: <b>{card.brand}</b></div>}
              {card.tankSize && <div style={{marginBottom:1,whiteSpace:'nowrap'}}>Tank Size: <b>{card.tankSize}</b></div>}
              {(card.tanks ?? []).length > 0 && <div style={{marginBottom:1,whiteSpace:'nowrap'}}>Tanks: <b>{(card.tanks ?? []).length}</b></div>}
              {card.customer && <div style={{marginBottom:1,whiteSpace:'nowrap'}}>Customer: {card.customer}</div>}
              {card.location && <div style={{marginBottom:1,whiteSpace:'nowrap'}}>Location: {card.location}</div>}
              {statusText && <div style={{color:'#4f46e5',marginBottom:1,whiteSpace:'nowrap'}}>{statusText}</div>}
              <div style={{color:pColor(payPct),fontWeight:700,marginTop:2,whiteSpace:'nowrap'}}>Payment: {payPct}%</div>
              {phase === 'installation' && (
                <div style={{marginTop:5,paddingTop:5,borderTop:'1px solid #f3f4f6'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:0.3,marginBottom:3}}>Progress</div>
                  <div style={{display:'flex',gap:2}}>
                    {getCardGanttDays(card).map(seg => (
                      <span key={seg.key} title={seg.date} style={{width:9,height:14,borderRadius:2,backgroundColor:seg.color,flexShrink:0}} />
                    ))}
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:3,fontSize:9,color:'#6b7280'}}>
                    <span><span style={{display:'inline-block',width:7,height:7,borderRadius:2,backgroundColor:'#22c55e',marginRight:3}} />In progress</span>
                    <span><span style={{display:'inline-block',width:7,height:7,borderRadius:2,backgroundColor:'#ef4444',marginRight:3}} />Pending</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      );}}
    </Draggable>
  );
}

function MatrixColumnHeader({ listId, phase, count, onExpand }: { listId: string; phase: SchedulePhase; count: number; onExpand?: () => void }) {
  const columns = getMatrixColumns(listId, phase);
  const gridTemplateColumns = getMatrixTemplateColumns(columns);
  const kind = getListKind(listId);
  const meta = LIST_KIND_META[kind];
  const KindIcon = meta.icon;
  return (
    <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className={`flex items-center justify-between gap-1.5 px-2 pt-1.5 pb-1 ${meta.bg}`}>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${meta.accent}`}>
          <KindIcon className="w-3 h-3" />
          {meta.label}
          <span className={`ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-white/80 ${meta.accent}`}>{count}</span>
        </span>
        {onExpand && (
          <button
            onClick={onExpand}
            title="Expand to fullscreen"
            className="p-0.5 rounded-md bg-white/80 border border-white/60 text-gray-400 hover:text-purple-600 hover:border-purple-300 shadow-sm transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="grid gap-1.5 px-2 py-1.5 items-start border-t border-gray-100 bg-gray-50/60" style={{ gridTemplateColumns }}>
        {columns.map(col => (
          <div key={col.key} className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-[1.1] break-normal">{col.label}</div>
        ))}
      </div>
    </div>
  );
}

const MATRIX_LIST_TITLES: Record<string, string> = {
  'pending-delivery': 'Pending Delivery',
  'status-delivery': 'Delivery Status',
  'planning-delivery': 'Planning Delivery',
  'pending-installation': 'Pending Installation',
  'status-installation': 'Installation Status',
  'planning-installation': 'Planning Installation',
};

type ListKind = 'pending' | 'status' | 'planning';
const getListKind = (listId: string): ListKind =>
  listId.startsWith('pending-') ? 'pending' : listId.startsWith('status-') ? 'status' : 'planning';
const LIST_KIND_META: Record<ListKind, { label: string; icon: typeof Clock; accent: string; bg: string }> = {
  pending:  { label: 'Pending',      icon: Clock,        accent: 'text-amber-600',  bg: 'bg-amber-50/70' },
  status:   { label: 'In Progress',  icon: Activity,     accent: 'text-blue-600',   bg: 'bg-blue-50/70' },
  planning: { label: 'Planning',     icon: CalendarRange, accent: 'text-violet-600', bg: 'bg-violet-50/70' },
};

const DELIVERY_STATUS_OPTIONS: ScTankProgress['deliveryStatus'][] = ['Not scheduled', 'Scheduled', 'Partial delivery', 'Fully delivered'];
const INSTALLATION_STATUS_OPTIONS: ScTankProgress['installationStatus'][] = ['Not scheduled', 'Scheduled', 'Partial Installed', 'Fully Installed'];

const getRowTanks = (card: ScCard): ScTankProgress[] => (card.tanks?.length ? card.tanks : [{
  tankDetailId: 'base',
  label: 'T1',
  tankSize: card.tankSize || '-',
  qty: '1',
  itemDescription: '',
  tankType: '' as ScTankProgress['tankType'],
  remarks: card.sectionRemarks || '',
  deliveryStatus: (card.deliveryStatus as ScTankProgress['deliveryStatus']) || 'Not scheduled',
  installationStatus: (card.installationStatus as ScTankProgress['installationStatus']) || 'Not scheduled',
  workers: card.workers ?? [],
  scheduledDate: card.confirmedDate,
  completionDate: undefined,
}]);

/* ─── Fullscreen expand modal for the 6 schedule matrix boxes ─────────────── */
/* Cells are edited directly inline here — this is the only place schedule
 * tank/work-order rows can be edited from the matrix boxes; opening a
 * separate "card details" modal from these tables has been removed. */
function MatrixFullscreenModal({ listId, phase, cards, referenceDate, canEdit, onUpdateCard, onDeleteCard, onClose }: {
  listId: string; phase: SchedulePhase; cards: ScCard[]; referenceDate: string; canEdit: boolean;
  onUpdateCard: (card: ScCard) => void; onDeleteCard: (card: ScCard) => void; onClose: () => void;
}) {
  const isDelivery = phase === 'delivery';
  const isPending = listId.startsWith('pending-');
  const title = MATRIX_LIST_TITLES[listId] || listId;
  const colCount = (isDelivery ? 13 : 14) + (isPending ? 1 : 0);
  // Auto-grow editable text inputs to fit their content (min width in ch units)
  // so Remarks/Workers are never clipped; the table itself scrolls horizontally.
  const fitWidth = (value: string, min = 10) => ({ width: `${Math.max(min, value.length + 2)}ch` });

  const setTank = (card: ScCard, tankDetailId: string, updater: (tank: ScTankProgress) => ScTankProgress) => {
    const tanks = getRowTanks(card).map(t => t.tankDetailId === tankDetailId ? updater(t) : t);
    onUpdateCard({ ...card, tanks });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full h-full max-w-none flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-3 text-white flex-shrink-0 ${isDelivery ? 'bg-gradient-to-r from-amber-600 to-amber-500' : 'bg-gradient-to-r from-indigo-600 to-indigo-500'}`}>
          <div>
            <h2 className="text-base font-bold">{title}</h2>
            <p className="text-xs opacity-80">
              {cards.length} work order{cards.length !== 1 ? 's' : ''}
              {canEdit ? ` · edit ${isDelivery ? 'Del. Date, Delivery Status and Remarks' : 'Inst. Start, Installation Status, Workers and Remarks'} directly in the table` : ' · read-only'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <table className="border-collapse text-xs table-auto">
            <thead className="sticky top-0 z-10">
              {/* Column order mirrors the source Delivery/Installation Pending|Planning|Status CSV exports.
                  Columns size to their widest cell content (table-auto) instead of stretching to fill the modal. */}
              <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wide">
                <th className="sticky left-0 z-20 border border-gray-200 bg-gray-100 px-2 py-2 text-left whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.08)]">WO No</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Payment</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Customer</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Brand</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Location</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">TANK SIZE/MATERIAL</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Qty</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Type</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">{isDelivery ? 'Del. Date' : 'Inst. Start'}</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">{isDelivery ? 'Delivery Status' : 'Installation Status'}</th>
                {!isDelivery && <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Workers</th>}
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Contact Person</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Phone Number</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Sales Person</th>
                <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Remarks</th>
                {isPending && <th className="border border-gray-200 px-2 py-2 text-left whitespace-nowrap">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {cards.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="border border-gray-200 px-2 py-6 text-center text-gray-300 italic">No cards</td>
                </tr>
              )}
              {cards.map((card, cardIdx) => {
                const tanks = getRowTanks(card);
                const rowBg = cardIdx % 2 === 0 ? 'bg-white' : (card.isEmergency ? 'bg-red-50' : 'bg-slate-50');
                return tanks.map((t, i) => {
                  const phaseStatus = isDelivery ? t.deliveryStatus : t.installationStatus;
                  const statusOptions = isDelivery ? DELIVERY_STATUS_OPTIONS : INSTALLATION_STATUS_OPTIONS;
                  const qtyText = t.qty || '1';
                  const workersText = (t.workers?.length ? t.workers : (card.workers ?? [])).join(', ');
                  return (
                    <tr key={`${card.id}-${t.tankDetailId}`} className={`${rowBg} ${card.isEmergency ? 'ring-1 ring-inset ring-red-300' : ''}`}>
                      {i === 0 && (
                        <>
                          <td rowSpan={tanks.length} className={`sticky left-0 z-10 border border-gray-200 px-2 py-2 align-top font-semibold text-gray-800 whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.06)] ${rowBg}`}>
                            {card.isEmergency && <AlertTriangle className="inline w-3 h-3 text-red-500 mr-1" />}
                            {normalizeWoCode(card.woCode)}
                          </td>
                          <td rowSpan={tanks.length} className="border border-gray-200 px-2 py-2 align-top font-semibold whitespace-nowrap" style={{ color: pColor(card.paymentPercent ?? 0) }}>
                            {card.paymentPercent ?? 0}%
                          </td>
                          <td rowSpan={tanks.length} className="border border-gray-200 px-2 py-2 align-top text-gray-700 whitespace-nowrap">{card.customer || '-'}</td>
                          <td rowSpan={tanks.length} className="border border-gray-200 px-2 py-2 align-top text-gray-700 whitespace-nowrap">{card.brand || '-'}</td>
                          <td rowSpan={tanks.length} className="border border-gray-200 px-2 py-2 align-top text-gray-700 whitespace-nowrap">{card.location || '-'}</td>
                        </>
                      )}
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">{t.tankSize || '-'}</td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">{qtyText}</td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">{t.tankType || '-'}</td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-500 whitespace-nowrap">
                        <input
                          type="date"
                          value={t.scheduledDate || ''}
                          disabled={!canEdit}
                          onChange={e => setTank(card, t.tankDetailId, prev => ({ ...prev, scheduledDate: e.target.value || undefined }))}
                          className="px-1 py-0.5 border border-gray-200 rounded text-[11px] disabled:bg-transparent disabled:border-transparent"
                        />
                      </td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">
                        <select
                          value={phaseStatus}
                          disabled={!canEdit}
                          onChange={e => {
                            const newStatus = e.target.value as ScTankProgress['deliveryStatus'] & ScTankProgress['installationStatus'];
                            setTank(card, t.tankDetailId, prev => ({
                              ...prev,
                              deliveryStatus: isDelivery ? (newStatus as ScTankProgress['deliveryStatus']) : prev.deliveryStatus,
                              installationStatus: !isDelivery ? (newStatus as ScTankProgress['installationStatus']) : prev.installationStatus,
                              scheduledDate: newStatus === 'Not scheduled' ? undefined : referenceDate,
                            }));
                          }}
                          className={`px-1.5 py-0.5 border rounded-md text-[11px] font-semibold ${tankStatusColorClass(phaseStatus)} disabled:opacity-70`}
                        >
                          {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </td>
                      {!isDelivery && (
                        <td className="border border-gray-200 px-2 py-2 text-gray-700">
                          <input
                            type="text"
                            defaultValue={workersText}
                            disabled={!canEdit}
                            onBlur={e => {
                              const workers = e.target.value.split(',').map(w => w.trim()).filter(Boolean);
                              setTank(card, t.tankDetailId, prev => ({ ...prev, workers }));
                            }}
                            placeholder="Comma-separated names"
                            style={fitWidth(workersText, 16)}
                            className="px-1 py-0.5 border border-gray-200 rounded text-[11px] disabled:bg-transparent disabled:border-transparent"
                          />
                        </td>
                      )}
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">{card.contactPerson || '-'}</td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">{card.phone || '-'}</td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 whitespace-nowrap">{card.salesPerson || '-'}</td>
                      <td className="border border-gray-200 px-2 py-2 text-gray-700 max-w-[220px]">
                        <textarea
                          defaultValue={t.remarks || ''}
                          disabled={!canEdit}
                          onBlur={e => setTank(card, t.tankDetailId, prev => ({ ...prev, remarks: e.target.value }))}
                          placeholder="Remarks"
                          rows={2}
                          className="w-52 px-1 py-0.5 border border-gray-200 rounded text-[11px] whitespace-normal break-normal resize-y disabled:bg-transparent disabled:border-transparent"
                        />
                      </td>
                      {isPending && i === 0 && (
                        <td rowSpan={tanks.length} className="border border-gray-200 px-2 py-2 align-top text-center whitespace-nowrap">
                          {canEdit && (
                            <button
                              title="Remove from schedule (moves the Work Order to Payments)"
                              onClick={() => onDeleteCard(card)}
                              className="p-1 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── GanttBarChip – spanning gantt bar with hover tooltip ────────────────── */

function GanttBarChip({
  card, progressedDays, segments, leftPct, widthPct, rowIdx, onOpen,
}: {
  card: ScCard; progressedDays: number;
  segments: Array<{key:string;color:string;flex:number}>;
  leftPct: number; widthPct: number; rowIdx: number;
  onOpen: () => void;
}) {
  const [tipPos, setTipPos] = useState<{x:number;y:number}|null>(null);
  const payPct = card.paymentPercent ?? 0;
  const woCode = normalizeWoCode(card.woCode);
  const outerBorder = card.isEmergency ? '#dc2626' : '#4b5563';
  return (
    <>
      <div
        onClick={onOpen}
        onMouseEnter={e => setTipPos({x:e.clientX,y:e.clientY})}
        onMouseMove={e => setTipPos({x:e.clientX,y:e.clientY})}
        onMouseLeave={() => setTipPos(null)}
        style={{
          position:'absolute',
          left:`${leftPct}%`,
          width:`${widthPct}%`,
          top:rowIdx*26+4,
          height:21,
          backgroundColor:'white',
          border:`2px solid ${outerBorder}`,
          borderRadius:8,
          display:'flex',alignItems:'center',
          padding:0,cursor:'pointer',overflow:'hidden',
          boxSizing:'border-box',
        }}
      >
        <div style={{flex:1,height:13,borderRadius:5,display:'flex',overflow:'hidden'}}>
          {segments.map((seg,idx)=>(
            <div key={seg.key} style={{flex:seg.flex,height:'100%',borderRadius:idx===0?'4px 0 0 4px':idx===segments.length-1?'0 4px 4px 0':0,backgroundColor:seg.color,display:'flex',alignItems:'center',overflow:'hidden',paddingLeft:idx===0?4:0}}>
            </div>
          ))}
        </div>
        <div
          style={{
            position:'absolute',
            inset:0,
            display:'flex',
            alignItems:'center',
            paddingLeft:10,
            paddingRight:8,
            pointerEvents:'none',
            overflow:'hidden',
          }}
        >
          <span style={{color:'white',fontSize:10,fontWeight:700,letterSpacing:'0.02em',textShadow:'0 1px 2px rgba(0,0,0,0.35)',whiteSpace:'nowrap'}}>
            {woCode} · {progressedDays}d · {payPct}%
          </span>
        </div>
      </div>
      {tipPos && (
        <div style={{position:'fixed',left:tipPos.x+12,top:tipPos.y+16,zIndex:9999,backgroundColor:'white',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 10px',fontSize:11,color:'#374151',boxShadow:'0 4px 12px rgba(0,0,0,0.12)',pointerEvents:'none',whiteSpace:'nowrap',minWidth:140}}>
          <div style={{fontWeight:700,fontSize:12,color:'#111827',marginBottom:3}}>WO: {woCode}</div>
          {card.brand && <div style={{marginBottom:1}}>Brand: <b>{card.brand}</b></div>}
          {card.tankSize && <div style={{marginBottom:1}}>Tank: <b>{card.tankSize}</b></div>}
          {card.location && <div style={{marginBottom:1}}>Location: {card.location}</div>}
          {card.installationStatus && <div style={{color:'#4f46e5',marginBottom:1}}>{card.installationStatus}</div>}
          <div style={{color:pColor(payPct),fontWeight:700,marginTop:2}}>Payment: {payPct}%</div>
        </div>
      )}
    </>
  );
}

/* ─── Add Card Modal ─────────────────────────────────────────────────────── */

function AddCardModal({ type, onClose, onAdd }: { type: 'delivery'|'installation'; onClose: ()=>void; onAdd: (c:ScCard)=>void }) {
  const [wo, setWo] = useState(''); const [customer, setCustomer] = useState('');
  const [brand, setBrand] = useState(''); const [productType, setProductType] = useState('');
  const [tankSize, setTankSize] = useState(''); const [location, setLocation] = useState('');
  const [contact, setContact] = useState(''); const [phone, setPhone] = useState('');
  const [sales, setSales] = useState(''); const [emergency, setEmergency] = useState(false);
  const [installationStatus, setInstallationStatus] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (!wo.trim()) { setErr('WO Number is required'); return; }
    if (!/^\d{4}$/.test(wo)) { setErr('Must be exactly 4 digits'); return; }
    onAdd({ id:`${type[0]}${Date.now()}`, woCode:normalizeWoCode(wo), listId:`pending-${type}`, workers:[], isEmergency:emergency, paymentPercent:0, isConfirmed:false, remarks:[], createdAt:new Date().toISOString(), customer:customer||undefined, brand:brand||undefined, productType:productType||undefined, location:location||undefined, tankSize:tankSize||undefined, contactPerson:contact||undefined, phone:phone||undefined, salesPerson:sales||undefined, deliveryStatus:type==='delivery' ? (deliveryStatus.trim() || undefined) : undefined, installationStatus:type==='installation' ? (installationStatus.trim() || undefined) : undefined });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {type==='delivery' ? <Truck className="w-5 h-5 text-amber-500"/> : <Wrench className="w-5 h-5 text-indigo-500"/>}
            <h2 className="text-base font-semibold text-gray-900">Add {type==='delivery'?'Delivery':'Installation'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500"/></button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">WO Number <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">(4 digits)</span></label>
            <input maxLength={4} value={wo} onChange={e=>{setWo(e.target.value.replace(/\D/g,''));setErr('');}} placeholder="e.g. 5487"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${err?'border-red-400':'border-gray-300'}`}/>
            {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
            <input value={customer} onChange={e=>setCustomer(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              <select value={brand} onChange={e=>setBrand(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white">
                <option value="">Select brand</option>
                {BRAND_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <input value={productType} onChange={e=>setProductType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Tank Size</label>
              <input value={tankSize} onChange={e=>setTankSize(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input value={location} onChange={e=>setLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
              <input value={contact} onChange={e=>setContact(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input value={phone} onChange={e=>setPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Sales Person</label>
            <input value={sales} onChange={e=>setSales(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          {type==='delivery' && (
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Delivery Current Status</label>
              <input value={deliveryStatus} onChange={e=>setDeliveryStatus(e.target.value)} placeholder="Write current delivery status"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          )}
          {type==='installation' && (
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Installation Current Status</label>
              <input value={installationStatus} onChange={e=>setInstallationStatus(e.target.value)} placeholder="Write current installation status"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          )}
          <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${emergency?'border-red-200 bg-red-50':'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`w-4 h-4 ${emergency?'text-red-500':'text-gray-400'}`}/>
              <span className={`text-sm font-semibold ${emergency?'text-red-700':'text-gray-700'}`}>Emergency {emergency?'(ON)':'(OFF)'}</span>
            </div>
            <button onClick={()=>setEmergency(p=>!p)} className={`relative w-10 h-6 rounded-full transition-colors ${emergency?'bg-red-500':'bg-gray-300'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${emergency?'left-5':'left-1'}`}/>
            </button>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700">Add Card</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Workers Modal ──────────────────────────────────────────────────────── */

function WorkersModal({ destId, onConfirm, onCancel }: { destId:string; onConfirm:(w:string[])=>void; onCancel:()=>void }) {
  const [input, setInput] = useState(''); const [workers, setWorkers] = useState<string[]>([]);
  const addW = () => { if(input.trim()&&!workers.includes(input.trim())){setWorkers(p=>[...p,input.trim()]);setInput('');} };
  const dk = destId.replace(/^(delivery|installation)-/,''); const date = parseISO(dk);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3"><Users className="w-5 h-5 text-teal-600"/>
            <div><h2 className="text-base font-semibold text-gray-900">Assign Workers</h2>
              <p className="text-xs text-gray-500">{format(date,'EEEE, MMMM d, yyyy')}{isSunday(date)&&' ⚠ SUNDAY'}</p></div></div>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500"/></button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4">
          <p className="text-sm text-gray-500">Workers are optional.</p>
          <div className="flex gap-2">
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addW()} placeholder="Worker name"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"/>
            <button onClick={addW} className="px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"><Plus className="w-4 h-4"/></button>
          </div>
          {workers.length>0&&<div className="flex flex-wrap gap-2">{workers.map(w=>(
            <span key={w} className="flex items-center gap-1.5 px-3 py-1 bg-teal-50 border border-teal-200 rounded-full text-sm text-teal-700">
              {w}<button onClick={()=>setWorkers(p=>p.filter(x=>x!==w))} className="text-teal-400 hover:text-teal-700">×</button>
            </span>))}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={()=>onConfirm(workers)} className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700">Schedule →</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Card Detail Modal ──────────────────────────────────────────────────── */

function CardDetailModal({ card, listId, onClose, onSave, canEdit, referenceDate }: { card:ScCard; listId:string; onClose:()=>void; onSave:(c:ScCard,lid:string)=>void; canEdit: boolean; referenceDate: string }) {
  const [ec, setEc] = useState<ScCard>({...card, remarks:[...card.remarks]});
  const [remarkText, setRemarkText] = useState('');
  const [remarkAuthor, setRemarkAuthor] = useState('');
  const [remarkMedia, setRemarkMedia] = useState<ScRemarkMedia[]>([]);
  const [workerInput, setWorkerInput] = useState('');
  const [targetListId, setTargetListId] = useState(listId);

  const isDateList = listId.startsWith('delivery-') || listId.startsWith('installation-');
  const isDel = listId.startsWith('delivery-');
  const currentPhase: SchedulePhase = getPhaseForListId(listId);
  const isInstallationCard = listId.startsWith('installation-') || listId === 'pending-installation';
  const isDelayedNow = isCardCurrentlyDelayed(ec);
  const dk = isDateList ? listId.replace(/^(delivery|installation)-/, '') : null;
  const isTodayCol = dk ? isToday(parseISO(dk)) : false;
  const stageText = getScheduleStage(ec, listId);
  const isReadOnly = !canEdit;
  const currentListPrefix = targetListId.startsWith('installation-') || targetListId === 'pending-installation' ? 'installation' : 'delivery';
  const targetDateValue = targetListId.startsWith('delivery-') || targetListId.startsWith('installation-')
    ? targetListId.replace(/^(delivery|installation)-/, '')
    : referenceDate;

  const addWorker = () => {
    const w = workerInput.trim();
    if (!w) return;
    setEc(p => ({ ...p, workers: p.workers.includes(w) ? p.workers : [...p.workers, w] }));
    setWorkerInput('');
  };
  const addMedia = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const kind: 'image'|'video' = file.type.startsWith('video/') ? 'video' : 'image';
      setRemarkMedia(prev => [...prev, { id: String(Date.now()) + Math.random().toString(16).slice(2), kind, name: file.name, dataUrl }]);
    };
    reader.readAsDataURL(file);
  };
  const addRemark = () => {
    if (!remarkText.trim() && remarkMedia.length === 0) return;
    const r: ScRemark = { id: String(Date.now()), text: remarkText.trim(), author: remarkAuthor.trim() || 'Unknown', at: new Date().toISOString(), media: remarkMedia.length ? remarkMedia : undefined };
    setEc(p => ({ ...p, remarks: [...p.remarks, r] }));
    setRemarkText(''); setRemarkAuthor(''); setRemarkMedia([]);
  };

  useEffect(() => {
    setTargetListId(listId);
  }, [listId, card.id]);

  useEffect(() => {
    setEc({ ...card, remarks: [...card.remarks] });
  }, [card]);

  // Stage pill colour
  const stagePillCls = stageText.toLowerCase().includes('complet') ? 'bg-green-100 text-green-700 border-green-200'
    : stageText.toLowerCase().includes('pending') ? 'bg-amber-100 text-amber-700 border-amber-200'
    : stageText.toLowerCase().includes('scheduled') ? 'bg-blue-100 text-blue-700 border-blue-200'
    : stageText.toLowerCase().includes('started') || stageText.toLowerCase().includes('progress') ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';

  const infoFields = [
    { label: 'Tank Size/Material', value: ec.tankSize    || '—' },
    { label: 'Brand',          value: ec.brand       || '—' },
    { label: 'Type',           value: ec.productType || '—' },
    { label: 'Contact Person', value: ec.contactPerson || '—' },
    { label: 'Phone',          value: ec.phone       || '—' },
    { label: 'Sales Person',   value: ec.salesPerson || '—' },
  ];

  const getEditableTanks = (cardState: ScCard): ScTankProgress[] => {
    if ((cardState.tanks ?? []).length > 0) return cardState.tanks ?? [];
    return [{
      tankDetailId: 'base',
      label: 'T1',
      tankSize: cardState.tankSize || '-',
      qty: '1',
      itemDescription: '',
      tankType: '',
      remarks: '',
      deliveryStatus: (cardState.deliveryStatus as ScTankProgress['deliveryStatus']) || 'Not scheduled',
      installationStatus: (cardState.installationStatus as ScTankProgress['installationStatus']) || 'Not scheduled',
      workers: cardState.workers ?? [],
      completionDate: cardState.completedDate || cardState.confirmedDate,
    }];
  };

  const updateTank = (tankDetailId: string, updater: (tank: ScTankProgress) => ScTankProgress) => {
    setEc(prev => {
      const source = getEditableTanks(prev);
      const tanks = source.map(t => t.tankDetailId === tankDetailId ? updater(t) : t);
      return { ...prev, tanks };
    });
  };

  const editableTanks = getEditableTanks(ec);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden" style={{ maxWidth: '780px', maxHeight: '90vh' }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm text-white shrink-0 ${ec.isEmergency ? 'bg-red-500' : 'bg-purple-600'}`}>
              {normalizeWoCode(ec.woCode)}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 truncate leading-tight">
                {ec.customer || '—'}
              </h2>
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {ec.location || '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-4 shrink-0">
            <button
              disabled={isReadOnly}
              onClick={() => setEc(p => ({ ...p, isEmergency: !p.isEmergency }))}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${ec.isEmergency ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'} ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {ec.isEmergency ? 'Emergency ON' : 'Emergency'}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">

          {/* Info grid — 3 columns */}
          <div className="grid grid-cols-3 gap-2.5">
            {infoFields.map(f => (
              <div key={f.label} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{f.label}</div>
                <div className="text-sm font-semibold text-gray-800 truncate">{f.value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700">Tank-Level Progress</span>
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">{editableTanks.length} tanks</span>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {editableTanks.map(tank => (
                <div key={tank.tankDetailId} className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-bold text-gray-800 whitespace-nowrap">{tank.label} • {tank.tankSize || '-'}</span>
                    <span className="h-4 w-px bg-gray-200 flex-shrink-0" />
                    <span className="truncate text-gray-600"><span className="text-gray-400">Qty:</span> {tank.qty || '1'}</span>
                    <span className="truncate text-gray-600"><span className="text-gray-400">Type:</span> {tank.tankType || '-'}</span>
                  </div>
                  <div className="text-xs text-gray-600 break-words">
                    <span className="text-gray-400">Remarks:</span> {tank.remarks || '-'}
                  </div>
                  {currentPhase === 'installation' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Installation Status</span>
                      <input
                        type="text"
                        value={tank.installationStatusText || ''}
                        disabled={isReadOnly}
                        onChange={e => {
                          const text = e.target.value;
                          updateTank(tank.tankDetailId, prev => ({ ...prev, installationStatusText: text }));
                        }}
                        placeholder="Write installation status"
                        className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded-md text-xs bg-white text-gray-700"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">
                      {currentPhase === 'delivery' ? 'Delivery Status' : 'Inst. Start'}
                    </span>
                    {currentPhase === 'delivery' ? (
                      <select
                        value={tank.deliveryStatus}
                        disabled={isReadOnly}
                        onChange={e => {
                          const newStatus = e.target.value as ScTankProgress['deliveryStatus'];
                          updateTank(tank.tankDetailId, prev => ({
                            ...prev,
                            deliveryStatus: newStatus,
                            // Stamp today's date whenever the tank progresses past "Not
                            // scheduled"; once Fully delivered, the date is frozen and never changes again.
                            completionDate: prev.deliveryStatus === 'Fully delivered'
                              ? prev.completionDate
                              : (newStatus === 'Not scheduled' ? prev.completionDate : referenceDate),
                          }));
                        }}
                        className={`flex-shrink-0 px-2 py-1 border rounded-md text-xs font-semibold ${tankStatusColorClass(tank.deliveryStatus)}`}
                      >
                        {DELIVERY_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <select
                        value={tank.installationStatus}
                        disabled={isReadOnly}
                        onChange={e => {
                          const newStatus = e.target.value as ScTankProgress['installationStatus'];
                          updateTank(tank.tankDetailId, prev => ({
                            ...prev,
                            installationStatus: newStatus,
                            // Stamp today's date whenever the tank progresses past "Not
                            // scheduled"; once Fully Installed, the date is frozen and never changes again.
                            completionDate: prev.installationStatus === 'Fully Installed'
                              ? prev.completionDate
                              : (newStatus === 'Not scheduled' ? prev.completionDate : referenceDate),
                          }));
                        }}
                        className={`flex-shrink-0 px-2 py-1 border rounded-md text-xs font-semibold ${tankStatusColorClass(tank.installationStatus)}`}
                      >
                        {INSTALLATION_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    )}
                    <span className="text-[10px] text-gray-400 whitespace-nowrap ml-auto">
                      {currentPhase === 'delivery' ? 'Del. Date:' : 'Inst. Date:'} {tank.completionDate || '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment + Workers — side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* Payment card */}
            <div className="rounded-xl border border-gray-200 px-4 py-3" style={{ backgroundColor: pBg(ec.paymentPercent) }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Payment Received</span>
                <span className="text-base font-bold" style={{ color: pColor(ec.paymentPercent) }}>{ec.paymentPercent}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={ec.paymentPercent}
                disabled={isReadOnly}
                onChange={e => setEc(p => ({ ...p, paymentPercent: Number(e.target.value) }))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: pColor(ec.paymentPercent) }}
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                <span>0%🔴</span><span>50%🔵</span><span>100%🟢</span>
              </div>
            </div>

            {/* Workers card */}
            <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-teal-700">Workers</span>
                <span className="text-[10px] font-semibold text-teal-500 bg-teal-100 px-1.5 py-0.5 rounded-full">{ec.workers.length} assigned</span>
              </div>
              <div className="flex gap-1.5 mb-2">
                <input
                  value={workerInput}
                  disabled={isReadOnly}
                  onChange={e => setWorkerInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addWorker()}
                  placeholder="Add worker"
                  className="flex-1 min-w-0 px-2.5 py-1.5 border border-teal-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                />
                <button disabled={isReadOnly} onClick={addWorker} className={`px-2.5 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 shrink-0 ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {ec.workers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                  {ec.workers.map(w => (
                    <span key={w} className="flex items-center gap-1 px-2 py-0.5 bg-white border border-teal-200 rounded-full text-xs text-teal-700">
                      {w}
                      {!isReadOnly && (
                        <button onClick={() => setEc(p => ({ ...p, workers: p.workers.filter(x => x !== w) }))} className="text-teal-400 hover:text-red-500 ml-0.5">×</button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Delay state (installation cards only) — per-tank status/remarks now live in Tank-Level Progress above */}
          {isInstallationCard && (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-0.5">Delay State</div>
                <div className={`text-xs font-bold ${isDelayedNow ? 'text-red-600' : 'text-green-600'}`}>
                  {isDelayedNow ? '⚠ Delayed' : '✓ On Track'}
                </div>
              </div>
              <button
                disabled={isReadOnly}
                onClick={() => setEc(prev => {
                  const today = referenceDate;
                  if (isCardCurrentlyDelayed(prev)) {
                    const periods = [...(prev.delayPeriods ?? [])];
                    for (let i = periods.length - 1; i >= 0; i -= 1) {
                      if (!periods[i].endDate) { periods[i] = { ...periods[i], endDate: today }; break; }
                    }
                    return { ...prev, delayPeriods: periods };
                  }
                  return { ...prev, delayPeriods: [...(prev.delayPeriods ?? []), { startDate: today }] };
                })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${isDelayedNow ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isDelayedNow ? 'Set On Track' : 'Mark Delayed'}
              </button>
            </div>
          )}

          {canEdit && isDateList && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Scheduled Date</label>
                <input
                  type="date"
                  value={targetDateValue}
                  min={referenceDate}
                  onChange={e => {
                    const next = e.target.value;
                    if (!next) return;
                    setTargetListId(`${currentListPrefix}-${next}`);
                  }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
              {!isDel && (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Start Date</label>
                    <input
                      type="date"
                      value={ec.confirmedDate || targetDateValue}
                      onChange={e => setEc(p => ({ ...p, confirmedDate: e.target.value || undefined }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">End Date</label>
                    <input
                      type="date"
                      value={ec.completedDate || ''}
                      min={ec.confirmedDate || targetDateValue}
                      onChange={e => setEc(p => ({ ...p, completedDate: e.target.value || undefined }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {canEdit && isDateList && (
            <button
              onClick={() => {
                const pendingId = isDel ? 'pending-delivery' : 'pending-installation';
                const moved = { ...ec, isConfirmed: false, completedDate: undefined };
                setEc(moved);
                setTargetListId(pendingId);
                onSave(moved, pendingId);
                onClose();
              }}
              className="w-full py-2 rounded-xl text-xs font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Move Back To Pending
            </button>
          )}

          {/* Action buttons */}
          {canEdit && isDateList && isTodayCol && !ec.isConfirmed && (
            isDel ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  onClick={() => {
                    setEc(p => ({ ...p, isConfirmed: true, confirmedDate: referenceDate }));
                    setTargetListId(listId);
                  }}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4" />✓ Mark Delivered
                </button>
                <button
                  onClick={() => {
                    const moved: ScCard = {
                      ...ec,
                      // Move as a fresh pending-installation card (not scheduled/started)
                      isConfirmed: false,
                      confirmedDate: undefined,
                      scheduleType: 'Installation',
                      completedDate: undefined,
                    };
                    setEc(moved);
                    setTargetListId('pending-installation');
                    onSave(moved, 'pending-installation');
                    onClose();
                  }}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700"
                >
                  <CheckCircle className="w-4 h-4" />Mark Delivered & send to Installation
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEc(p => ({ ...p, isConfirmed: true, confirmedDate: referenceDate }))}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                <CheckCircle className="w-4 h-4" />▶ Start Installation
              </button>
            )
          )}
          {isDateList && ec.isConfirmed && (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-700">{isDel ? 'Delivered' : 'Started'} on {ec.confirmedDate}</span>
            </div>
          )}
          {canEdit && !isDel && ec.isConfirmed && !ec.completedDate && (
            <button
              onClick={() => setEc(p => ({ ...p, completedDate: referenceDate }))}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <CheckCircle className="w-4 h-4" /> Mark Installation Completed
            </button>
          )}
          {!isDel && ec.completedDate && (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
              <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-sm font-semibold text-blue-700">Completed on {ec.completedDate}</span>
            </div>
          )}

          {/* Remarks — chat bubble style */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Remarks</span>
              {ec.remarks.length > 0 && (
                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-semibold">{ec.remarks.length}</span>
              )}
            </div>

            {/* Existing remarks */}
            <div className="flex flex-col gap-3 mb-4 max-h-52 overflow-y-auto pr-1">
              {ec.remarks.length === 0 ? (
                <p className="text-xs text-gray-400 italic text-center py-2">No remarks yet.</p>
              ) : ec.remarks.map(r => (
                <div key={r.id} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-700 shrink-0 mt-0.5">
                    {(r.author || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-800">{r.author}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{format(parseISO(r.at), 'dd MMM yy, HH:mm')}</span>
                    </div>
                    {r.text && <p className="text-sm text-gray-700 leading-relaxed">{r.text}</p>}
                    {r.media && r.media.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {r.media.map(m => m.kind === 'image' ? (
                          <img key={m.id} src={m.dataUrl} alt={m.name} className="w-full h-24 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <video key={m.id} src={m.dataUrl} controls className="w-full h-24 rounded-lg border border-gray-200" />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* New remark composer */}
            {canEdit && (
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0 mt-0.5">
                  {remarkAuthor ? remarkAuthor.charAt(0).toUpperCase() : '+'}
                </div>
                <div className="flex-1 min-w-0 border border-gray-200 rounded-2xl rounded-tl-sm bg-white overflow-hidden focus-within:ring-2 focus-within:ring-purple-400 focus-within:border-purple-300">
                  <input
                    value={remarkAuthor}
                    onChange={e => setRemarkAuthor(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3 pt-2.5 pb-1 text-xs font-semibold text-gray-700 placeholder-gray-400 focus:outline-none border-b border-gray-100"
                  />
                  <textarea
                    value={remarkText}
                    onChange={e => setRemarkText(e.target.value)}
                    placeholder="Write a remark…"
                    rows={2}
                    className="w-full px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none placeholder-gray-400"
                  />
                  <div className="flex items-center justify-between px-3 pb-2.5 pt-1 border-t border-gray-100 gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-purple-600 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 10-5.656-5.656L5.757 10.76a6 6 0 108.486 8.486L20 13" />
                      </svg>
                      Attach
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={e => {
                          const files = Array.from(e.target.files || []);
                          files.forEach(addMedia);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <button onClick={addRemark} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700">
                      Add Remark
                    </button>
                  </div>
                  {remarkMedia.length > 0 && (
                    <div className="px-3 pb-2.5 grid grid-cols-3 gap-2 border-t border-gray-100">
                      {remarkMedia.map(m => (
                        <div key={m.id} className="text-[10px] text-gray-500 truncate">{m.name}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2.5 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          {!isReadOnly && (
            <button
              onClick={() => {
                onSave(ec, targetListId);
                onClose();
              }}
              className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700"
            >
              Save Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Props = {
  userName: string;
  userDepartment?: string;
  userRole?: string;
  onChannelSwitch?: (ch: ChannelType) => void;
  accessibleChannels?: ChannelType[];
};

export default function ScheduleBoard({ userName, userDepartment, userRole, onChannelSwitch, accessibleChannels=[] }: Props) {
  const [store, setStore]           = useState<ScStore>(EMPTY_STORE);
  const [referenceDate] = useState<string>(dateKey());
  const [searchDate, setSearchDate] = useState<string>('');
  const [delOff,  setDelOff]        = useState(-2);
  const [instOff, setInstOff]       = useState(-5);
  const [ganttDW, setGanttDW]       = useState(72);
  const [addCardType, setAddCardType] = useState<'delivery'|'installation'|null>(null);
  const [selected, setSelected]     = useState<{card:ScCard;listId:string}|null>(null);
  const [expandedList, setExpandedList] = useState<{listId:string; phase:SchedulePhase}|null>(null);
  const [pendingDrop, setPendingDrop] = useState<{srcId:string;dstId:string;cardId:string;dstIdx:number}|null>(null);
  const [showChDrop, setShowChDrop] = useState(false);
  const [pendFilter, setPendFilter] = useState<'all'|'delivery'|'installation'>('all');
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [woSearch, setWoSearch] = useState('');
  const [workOrderCards, setWorkOrderCards] = useState<WorkOrderCard[]>([]);
  const [isPendingFullscreen, setIsPendingFullscreen] = useState(false);
  const [pendingDetails, setPendingDetails] = useState<PendingReportDetailsResponse | null>(null);
  const [pendingDetailsLoading, setPendingDetailsLoading] = useState(false);
  const [pendingDetailsError, setPendingDetailsError] = useState('');
  const [isGeneratingReports, setIsGeneratingReports] = useState(false);

  const canEditSchedule = (userRole === 'admin' || userDepartment === 'Delivery & Installation') && !searchDate;

  const ganttRef   = useRef<HTMLDivElement>(null);
  const delRef     = useRef<HTMLDivElement>(null);
  const instRef    = useRef<HTMLDivElement>(null);
  const chDropRef  = useRef<HTMLDivElement>(null);
  const ganttAutoFitRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workOrderCardsRef = useRef<WorkOrderCard[]>([]);
  const syncedSignatureRef = useRef<Record<string, string>>({});
  const delDragRef = useRef<{ startX: number; startOff: number } | null>(null);
  const instDragRef = useRef<{ startX: number; startOff: number } | null>(null);

  const getSyncSignature = (sc: ScCard) => {
    const tankSig = (sc.tanks ?? [])
      .map(t => [
        t.tankDetailId,
        t.deliveryStatus,
        t.installationStatus,
        (t.workers ?? []).join(','),
        t.completionDate ?? '',
      ].join(':'))
      .join('|');
    // scheduleType intentionally excluded — Work Order is the authority for type;
    // we only sync stage/payment/confirmation status back.
    return [
      sc.listId,
      sc.paymentPercent,
      sc.isConfirmed ? '1' : '0',
      sc.confirmedDate ?? '',
      sc.completedDate ?? '',
      sc.returnedFromDate ?? '',
      sc.deliveryStatus ?? '',
      sc.installationStatus ?? '',
      tankSig,
    ].join('|');
  };

  const startDateDrag = useCallback((kind: 'delivery' | 'installation', e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-rfd-draggable-id]')) return;
    e.preventDefault();
    const dragState = { startX: e.clientX, startOff: kind === 'delivery' ? delOff : instOff };
    if (kind === 'delivery') delDragRef.current = dragState;
    else instDragRef.current = dragState;
    document.body.style.userSelect = 'none';
  }, [delOff, instOff]);

  useEffect(() => {
    workOrderCardsRef.current = workOrderCards;
  }, [workOrderCards]);

  const syncScheduleCardToWorkOrder = useCallback(async (sc: ScCard, forcedScheduleType?: 'Delivery' | 'Installation') => {
    if (!sc.sourceCardId) return;
    let src = workOrderCardsRef.current.find(c => String(c.id) === String(sc.sourceCardId));
    if (!src) {
      try {
        const latest = await fetchCards('Work Order');
        setWorkOrderCards(latest);
        workOrderCardsRef.current = latest;
        src = latest.find(c => String(c.id) === String(sc.sourceCardId));
      } catch {
        return;
      }
    }
    if (!src) return;
    const hasMultipleTankSchedules = (src.tankDetails?.length ?? 0) > 1;
    const scheduleStage = getScheduleStage(sc, sc.listId);
    const srcStage = src.scheduleStage;
    const srcPayment = typeof src.paymentPercent === 'number' ? src.paymentPercent : 0;
    const nextScheduleType = forcedScheduleType ?? src.scheduleType;
    if (hasMultipleTankSchedules) {
      if (srcPayment === sc.paymentPercent) return;
      const paymentOnlyUpdate: WorkOrderCard = {
        ...src,
        paymentPercent: sc.paymentPercent,
        updatedAt: new Date().toISOString(),
      };
      workOrderCardsRef.current = workOrderCardsRef.current.map(c =>
        String(c.id) === String(paymentOnlyUpdate.id) ? paymentOnlyUpdate : c
      );
      setWorkOrderCards(prev => prev.map(c => String(c.id) === String(paymentOnlyUpdate.id) ? paymentOnlyUpdate : c));
      try {
        const uid = localStorage.getItem('userId');
        const saved = await updateCard(paymentOnlyUpdate, uid ? Number(uid) : undefined);
        setWorkOrderCards(prev => {
          const next = prev.map(c => String(c.id) === String(saved.id) ? saved : c);
          workOrderCardsRef.current = next;
          return next;
        });
      } catch {
        // Keep schedule responsive even when backend update fails temporarily.
      }
      return;
    }
    // Determine whether completedAt needs to be stamped before hitting the
    // stable-guard return.  This covers both new transitions AND pre-existing
    // completed cards (e.g. GRP/1983) that were completed before completedAt
    // tracking was introduced.
    const terminalStages: ReadonlyArray<string> = ['Delivery completed', 'Installation completed'];
    const nowTerminal = terminalStages.includes(scheduleStage);
    const needsCompletedAt = nowTerminal && !src.completedAt;
    if (srcPayment === sc.paymentPercent && srcStage === scheduleStage && src.scheduleType === nextScheduleType) {
      // If the card is terminal but completedAt hasn't been stamped yet, we
      // must proceed past this guard so the update writes completedAt once.
      // After that, subsequent stable polls hit this return as normal.
      if (!needsCompletedAt) return;
    }
    // Stamp completedAt for any terminal card that doesn't have it yet.
    const newCompletedAt: string | undefined =
      needsCompletedAt ? new Date().toISOString() : src.completedAt;
    // Normally WO is the authority for scheduleType, but explicit list-based moves
    // (e.g. delivered -> pending-installation) must persist type to prevent bounce-back on poll.
    const updated: WorkOrderCard = {
      ...src,
      paymentPercent: sc.paymentPercent,
      scheduleType: nextScheduleType,
      scheduleStage,
      completedAt: newCompletedAt,
      updatedAt: new Date().toISOString(),
    };
    // Optimistically update workOrderCardsRef BEFORE the async PUT so that any
    // mergeScheduleWithWorkOrder call happening during the in-flight request
    // already sees the new scheduleType and does not bounce the card back.
    workOrderCardsRef.current = workOrderCardsRef.current.map(c =>
      String(c.id) === String(updated.id) ? updated : c
    );
    setWorkOrderCards(prev => prev.map(c => String(c.id) === String(updated.id) ? updated : c));
    try {
      const uid = localStorage.getItem('userId');
      const saved = await updateCard(updated, uid ? Number(uid) : undefined);
      setWorkOrderCards(prev => {
        const next = prev.map(c => String(c.id) === String(saved.id) ? saved : c);
        workOrderCardsRef.current = next;
        return next;
      });
    } catch {
      // Keep schedule responsive even when backend update fails temporarily.
    }
  }, []);

  /* Moves the linked Work Order card into the Payments list when a schedule
   * card is deleted from the schedule channel, so it shows up there with its
   * current % payment. `stamp` is shared with the archive timestamp written
   * by deleteScheduleCard so the bounce-back guard in mergeScheduleWithWorkOrder
   * reliably keeps it archived. */
  const completeWorkOrderForScheduleCard = useCallback(async (sc: ScCard, stamp: string) => {
    if (!sc.sourceCardId) return;
    let src = workOrderCardsRef.current.find(c => String(c.id) === String(sc.sourceCardId));
    if (!src) {
      try {
        const latest = await fetchCards('Work Order');
        setWorkOrderCards(latest);
        workOrderCardsRef.current = latest;
        src = latest.find(c => String(c.id) === String(sc.sourceCardId));
      } catch {
        return;
      }
    }
    if (!src) return;
    const phase = sc.phase ?? getPhaseForListId(sc.listId);
    const updated: WorkOrderCard = {
      ...src,
      list: 'Payments',
      userWorkStatus: 'Completed',
      scheduleStage: phase === 'installation' ? 'Installation completed' : 'Delivery completed',
      completedAt: src.completedAt || stamp,
      updatedAt: stamp,
    };
    workOrderCardsRef.current = workOrderCardsRef.current.map(c => String(c.id) === String(updated.id) ? updated : c);
    setWorkOrderCards(prev => prev.map(c => String(c.id) === String(updated.id) ? updated : c));
    try {
      const uid = localStorage.getItem('userId');
      const saved = await updateCard(updated, uid ? Number(uid) : undefined);
      setWorkOrderCards(prev => {
        const next = prev.map(c => String(c.id) === String(saved.id) ? saved : c);
        workOrderCardsRef.current = next;
        return next;
      });
    } catch {
      // Keep schedule responsive even when backend update fails temporarily.
    }
  }, []);

  const refreshFromWorkOrder = useCallback(async () => {
    try {
      const wo = await fetchCards('Work Order');
      setWorkOrderCards(wo);
      setStore(prev => mergeScheduleWithWorkOrder(prev, wo, referenceDate));
    } catch {
      // Ignore intermittent fetch failures during polling.
    }
  }, [referenceDate]);

  /* load schedule store and merge with Work Order Delivery/Installation cards */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [scheduleRes, woCards] = await Promise.all([
          fetch('/api/schedule/data'),
          fetchCards('Work Order'),
        ]);
        if (!scheduleRes.ok) throw new Error(`Failed to load schedule data (${scheduleRes.status})`);
        const body = await scheduleRes.json() as { store?: unknown };
        const merged = mergeScheduleWithWorkOrder(normalizeStore(body.store), woCards, referenceDate);
        if (active) {
          setWorkOrderCards(woCards);
          setStore(merged);
        }
      } catch {
        if (active) setStore(EMPTY_STORE);
      } finally {
        if (active) setScheduleLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [referenceDate]);

  // Keep Schedule linked with Work Order Delivery/Installation in near real-time.
  useEffect(() => {
    const timer = setInterval(() => { void refreshFromWorkOrder(); }, 4000);
    return () => clearInterval(timer);
  }, [refreshFromWorkOrder]);

  /* persist schedule changes to JSON file (debounced) */
  useEffect(() => {
    if (!scheduleLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void fetch('/api/schedule/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store }),
      }).catch(() => {
        // Keep UX responsive even if file write fails temporarily.
      });
    }, 250);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [store, scheduleLoaded]);

  /* close dropdown on outside click */
  useEffect(()=>{
    const h=(e:MouseEvent)=>{ if(chDropRef.current&&!chDropRef.current.contains(e.target as Node))setShowChDrop(false); };
    document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h);
  },[]);

  /* Manual reset button (placed next to Search by Date) clears Status and
   * Planning for both phases without touching Pending or any card's values —
   * the automatic daily carry-forward/archive reset has been removed. */
  const resetStatusAndPlanning = useCallback(() => {
    if (!window.confirm('Clear all cards from the Status and Planning tables (Delivery + Installation)? Pending will not be affected.')) return;
    setStore(prev => {
      const next: ScStore = { ...prev };
      [DELIVERY_STATUS, DELIVERY_PLANNING, INSTALLATION_STATUS, INSTALLATION_PLANNING].forEach(listId => {
        next[listId] = [];
      });
      return next;
    });
  }, []);

  // Keep Work Order Schedule cards in sync for Schedule-side changes only.
  useEffect(() => {
    if (!scheduleLoaded) return;
    const linkedCards = flattenCards(store).filter(sc => !!sc.sourceCardId);
    if (linkedCards.length === 0) return;

    linkedCards.forEach(sc => {
      const key = String(sc.sourceCardId);
      const sig = getSyncSignature(sc);
      if (syncedSignatureRef.current[key] === sig) return;
      syncedSignatureRef.current[key] = sig;
      void syncScheduleCardToWorkOrder(sc);
    });

    const activeIds = new Set(linkedCards.map(sc => String(sc.sourceCardId)));
    Object.keys(syncedSignatureRef.current).forEach(key => {
      if (!activeIds.has(key)) delete syncedSignatureRef.current[key];
    });
  }, [store, scheduleLoaded, syncScheduleCardToWorkOrder]);

  /* horizontal wheel for date grids only */
  useEffect(()=>{
    const el=delRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{
      // Keep default vertical scroll. Use Shift+wheel for date navigation.
      if(!e.shiftKey) return;
      e.preventDefault();
      const d=e.deltaX!==0?e.deltaX:e.deltaY;
      setDelOff(p=>p+(d>0?1:-1));
    };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);
  useEffect(()=>{
    const el=instRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{
      // Keep default vertical scroll. Use Shift+wheel for date navigation.
      if(!e.shiftKey) return;
      e.preventDefault();
      const d=e.deltaX!==0?e.deltaX:e.deltaY;
      setInstOff(p=>p+(d>0?1:-1));
    };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);

  useEffect(() => {
    const DRAG_STEP_PX = 64;
    const onMove = (e: MouseEvent) => {
      if (delDragRef.current) {
        const steps = Math.trunc((delDragRef.current.startX - e.clientX) / DRAG_STEP_PX);
        setDelOff(delDragRef.current.startOff + steps);
      }
      if (instDragRef.current) {
        const steps = Math.trunc((instDragRef.current.startX - e.clientX) / DRAG_STEP_PX);
        setInstOff(instDragRef.current.startOff + steps);
      }
    };
    const onUp = () => {
      delDragRef.current = null;
      instDragRef.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
  }, []);

  /* gantt: show 9 days by default; native horizontal scroll pans timeline; Ctrl+scroll zooms day width */
  useEffect(() => {
    const fitDays = () => {
      if (!ganttAutoFitRef.current || !ganttRef.current) return;
      const labelWidth = 56;
      const available = Math.max(360, ganttRef.current.clientWidth - labelWidth);
      const fitted = Math.floor(available / GANTT_VISIBLE_DAYS);
      setGanttDW(Math.max(GANTT_MIN_DAY_WIDTH, Math.min(GANTT_MAX_DAY_WIDTH, fitted)));
    };
    fitDays();
    window.addEventListener('resize', fitDays);
    return () => window.removeEventListener('resize', fitDays);
  }, []);

  useEffect(()=>{
    const el=ganttRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{
      if(e.ctrlKey){
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        ganttAutoFitRef.current = false;
        setGanttDW(p=>Math.max(GANTT_MIN_DAY_WIDTH, Math.min(GANTT_MAX_DAY_WIDTH, p + (delta < 0 ? 6 : -6))));
      }
    };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);

  /* DnD helpers */
  const performMove=useCallback((srcId:string,dstId:string,cardId:string,dstIdx:number,workers?:string[])=>{
    let movedForSync: ScCard | null = null;
    setStore(prev=>{
      const next={...prev}; const srcList=[...(next[srcId]??[])]; const card=srcList.find(c=>c.id===cardId);
      if(!card)return prev;
      Object.keys(next).forEach(listId => {
        next[listId] = (next[listId] ?? []).filter(c => c.id !== card.id);
      });

      const movedPhase = getPhaseForListId(dstId);
      const movedToPlanning = dstId === getPlanningListForPhase(movedPhase);
      const movedToStatus = dstId === getStatusListForPhase(movedPhase);
      const movedDate = movedToPlanning || movedToStatus ? referenceDate : undefined;
      const updateTankForDestination = (tank: ScTankProgress): ScTankProgress => {
        if (movedToPlanning) {
          return movedPhase === 'delivery'
            ? { ...tank, deliveryStatus: 'Scheduled', scheduledDate: referenceDate }
            : { ...tank, installationStatus: 'Scheduled', scheduledDate: referenceDate };
        }
        if (movedToStatus) return { ...tank, scheduledDate: referenceDate };
        return tank;
      };

      const movedCards = [{
        ...card,
        listId: dstId,
        workers: workers ?? card.workers,
        tanks: (card.tanks ?? []).map(updateTankForDestination),
        // Entering Planning or Status stamps the work-order schedule date.
        ...(movedDate ? { confirmedDate: movedDate } : {}),
        ...(movedToPlanning && movedPhase === 'delivery' ? { deliveryStatus: 'Scheduled' } : {}),
        ...(movedToPlanning && movedPhase === 'installation' ? { installationStatus: 'Scheduled' } : {}),
      }];

      movedForSync = movedCards[0] ?? null;
      const dstList=[...(next[dstId]??[])];
      dstList.splice(dstIdx,0,...movedCards);
      next[dstId]=dstList; return next;
    });
    if (movedForSync) void syncScheduleCardToWorkOrder(movedForSync);
  },[referenceDate, syncScheduleCardToWorkOrder]);

  const onDragEnd=useCallback((result:DropResult)=>{
    if (!canEditSchedule) return;
    const{destination,source,draggableId}=result;
    if(!destination)return;
    const{droppableId:srcId,index:srcIdx}=source; const{droppableId:dstId,index:dstIdx}=destination;
    if(srcId===dstId&&srcIdx===dstIdx)return;
    if(getPhaseForListId(srcId)!==getPhaseForListId(dstId)){
      alert('⛔ Delivery and Installation cards cannot be mixed.');
      return;
    }
    performMove(srcId,dstId,draggableId,dstIdx);
  },[performMove, canEditSchedule]);

  const displayStore = useMemo(
    () => (searchDate ? buildHistoricalStore(store, searchDate) : store),
    [store, searchDate]
  );
  const getCards=(lid:string)=>{
    // Live view: Pending always mirrors the latest Status/Planning cards too,
    // so it holds the full permanent set (with duplicates) for the phase.
    if (!searchDate && (lid === DELIVERY_PENDING || lid === INSTALLATION_PENDING)) {
      return mirrorPendingWithSources(displayStore, getPhaseForListId(lid));
    }
    return displayStore[lid]??[];
  };
  const woQuery = woSearch.trim().toLowerCase();
  const matchesWo = useCallback((card: ScCard)=>{
    if(!woQuery) return true;
    return normalizeWoCode(card.woCode).toLowerCase().includes(woQuery);
  }, [woQuery]);

  /* Updates a single card's fields (used by inline cell edits in the expanded
   * matrix table) wherever it currently lives, without moving lists. */
  const updateScheduleCardFields = useCallback((updated: ScCard) => {
    setStore(prev => {
      const next: ScStore = { ...prev };
      let found = false;
      Object.keys(next).forEach(key => {
        if (isArchiveListId(key)) return;
        next[key] = (next[key] ?? []).map(card => {
          if (card.id !== updated.id) return card;
          found = true;
          return { ...updated, listId: card.listId };
        });
      });
      return found ? next : prev;
    });
  }, []);

  /* Removes a schedule card entirely from live view (archives it so it still
   * appears when searching past dates) and moves the linked Work Order card
   * to the Payments list, showing its current % payment there. */
  const deleteScheduleCard = useCallback((card: ScCard) => {
    if (!window.confirm(`Remove WO ${normalizeWoCode(card.woCode)} from the schedule? It will move to the Payments list in Work Order.`)) return;
    const stamp = new Date().toISOString();
    setStore(prev => {
      const next: ScStore = { ...prev };
      Object.keys(next).forEach(key => {
        if (isArchiveListId(key)) return;
        next[key] = (next[key] ?? []).filter(c => c.id !== card.id);
      });
      const archived: ScCard = {
        ...card,
        listId: ARCHIVE_COMPLETED,
        completedDate: card.completedDate || referenceDate,
        updatedAt: stamp,
      };
      const archive = [...(next[ARCHIVE_COMPLETED] ?? [])];
      const idx = archive.findIndex(c => getCardIdentity(c) === getCardIdentity(card));
      if (idx >= 0) archive[idx] = archived; else archive.unshift(archived);
      next[ARCHIVE_COMPLETED] = archive;
      return next;
    });
    void completeWorkOrderForScheduleCard(card, stamp);
  }, [referenceDate, completeWorkOrderForScheduleCard]);

  const upsertScheduleCard = useCallback((nextCard: ScCard, listId: string) => {
    setStore(prev => {
      const next: ScStore = { ...prev };
      Object.keys(next).forEach(key => {
        next[key] = (next[key] ?? []).filter(card => card.id !== nextCard.id);
      });
      next[listId] = [{ ...nextCard, listId }, ...(next[listId] ?? [])];
      return next;
    });
    void syncScheduleCardToWorkOrder({ ...nextCard, listId });
  }, [syncScheduleCardToWorkOrder]);

  const renderDragClone = (provided: any, snapshot: any, rubric: any) => {
    const listId = rubric.source.droppableId as string;
    const card = getCards(listId)[rubric.source.index];
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        className="rounded-lg border-2 px-3 py-1.5 bg-white shadow-xl"
        style={{ ...provided.draggableProps.style, borderColor: '#7c3aed' }}
      >
        <span className="text-xs font-bold text-purple-700">{normalizeWoCode(card?.woCode || '')}</span>
      </div>
    );
  };

  const renderMatrixSection = (listId: string, phase: SchedulePhase) => {
    const cards = sortScheduleGroup(getCards(listId).filter(matchesWo));
    return (
      <div className="flex flex-col min-h-0 border-r border-b border-gray-200 last:border-r-0 bg-white">
        <MatrixColumnHeader listId={listId} phase={phase} count={cards.length} onExpand={() => setExpandedList({ listId, phase })} />
        <Droppable droppableId={listId} direction="vertical" renderClone={renderDragClone}>
          {(prov, snap)=>(
            <div ref={prov.innerRef} {...prov.droppableProps} className={`flex-1 overflow-y-auto scrollbar-hide p-1.5 space-y-0.5 transition-colors ${snap.isDraggingOver?'bg-purple-50/70':''}`}>
              {cards.length === 0 && !snap.isDraggingOver && (
                <div className="flex flex-col items-center justify-center gap-1 py-6 text-gray-300 select-none">
                  <Inbox className="w-5 h-5" />
                  <p className="text-[10px] font-medium">No work orders</p>
                </div>
              )}
              {cards.map((c,i)=>{
                const isMirrored = (listId === DELIVERY_PENDING || listId === INSTALLATION_PENDING) && c.listId !== listId;
                return (
                  <CardChip
                    key={c.id}
                    card={c}
                    listId={listId}
                    index={i}
                    isPending
                    isDragDisabled={!canEditSchedule || isMirrored}
                    dragKey={isMirrored ? `mirror-${c.id}` : c.id}
                    onOpen={()=>setExpandedList({listId, phase})}
                  />
                );
              })}
              {prov.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    );
  };

  const renderScheduleMatrix = () => (
    <div className="flex-1 min-h-0 border border-gray-200 bg-white overflow-hidden rounded-2xl shadow-sm">
      <div className="grid h-full" style={{ gridTemplateColumns: '26px 1fr 1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
        <div className="border-r border-b border-gray-200 flex items-center justify-center bg-amber-50/80 min-h-0">
          <span className="inline-flex items-center gap-1 rotate-[-90deg] whitespace-nowrap">
            <Truck className="w-3 h-3 text-amber-600" />
            <span className="text-[9px] font-semibold tracking-[0.08em] text-amber-700">DELIVERY</span>
          </span>
        </div>
        {renderMatrixSection(DELIVERY_PENDING, 'delivery')}
        {renderMatrixSection(DELIVERY_STATUS, 'delivery')}
        {renderMatrixSection(DELIVERY_PLANNING, 'delivery')}

        <div className="border-r border-gray-200 flex items-center justify-center bg-indigo-50/80 min-h-0">
          <span className="inline-flex items-center gap-1 rotate-[-90deg] whitespace-nowrap">
            <Wrench className="w-3 h-3 text-indigo-600" />
            <span className="text-[9px] font-semibold tracking-[0.08em] text-indigo-700">INSTALLATION</span>
          </span>
        </div>
        {renderMatrixSection(INSTALLATION_PENDING, 'installation')}
        {renderMatrixSection(INSTALLATION_STATUS, 'installation')}
        {renderMatrixSection(INSTALLATION_PLANNING, 'installation')}
      </div>
    </div>
  );

  /* ── Stats ─────────────────────────────────────────────────────────────── */

  const totalDel   = Object.keys(store).filter(k=>k.endsWith('-delivery')).reduce((n,k)=>n+(store[k]?.length??0),0);
  const totalInst  = Object.keys(store).filter(k=>k.endsWith('-installation')).reduce((n,k)=>n+(store[k]?.length??0),0);
  const inProgress = getCards(INSTALLATION_STATUS).length;
  const totalPend  = getCards(DELIVERY_PENDING).length+getCards(INSTALLATION_PENDING).length;

  const stats=[
    {Icon:Truck,    bg:'bg-blue-50',    ic:'text-blue-500',    label:'Total Deliveries',    val:totalDel,   trend:'+8.5% vs last week', up:true },
    {Icon:Wrench,   bg:'bg-violet-50',  ic:'text-violet-500',  label:'Total Installations', val:totalInst,  trend:'+6.3% vs last week', up:true },
    {Icon:TrendingUp,bg:'bg-emerald-50',ic:'text-emerald-500', label:'In Progress',         val:inProgress, trend:'+2 vs last week',    up:true },
    {Icon:Clock,    bg:'bg-amber-50',   ic:'text-amber-500',   label:'Pending Tasks',       val:totalPend,  trend:'-1 vs last week',    up:false},
  ];

  const loadPendingDetails = useCallback(async () => {
    setPendingDetailsLoading(true);
    setPendingDetailsError('');
    try {
      const reportDate = referenceDate;
      const payload = await fetchPendingReportDetails(reportDate);
      setPendingDetails(payload);
    } catch (err) {
      setPendingDetailsError((err as Error)?.message || 'Unable to load pending report details.');
      setPendingDetails(null);
    } finally {
      setPendingDetailsLoading(false);
    }
  }, [referenceDate]);

  const openPendingFullscreen = useCallback(() => {
    setIsPendingFullscreen(true);
    void loadPendingDetails();
  }, [loadPendingDetails]);

  const handleGenerateReports = useCallback(async () => {
    setIsGeneratingReports(true);
    try {
      const payload = await generateDailyReports(referenceDate);
      const generatedCount = Object.keys(payload.reports ?? {}).filter(k => k !== 'missing_templates').length;
      const missing = payload.reports?.missing_templates;
      alert(missing
        ? `Generated ${generatedCount} report(s). Missing templates: ${missing}`
        : `Generated ${generatedCount} report(s) for ${payload.date}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate reports';
      alert(`Report generation failed: ${msg}`);
    } finally {
      setIsGeneratingReports(false);
    }
  }, [referenceDate]);

  const renderPendingDetailsTable = (columns: string[], rows: PendingReportRow[], emptyText: string) => (
    <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-100 bg-white">
      <table className="min-w-full text-xs text-left">
        <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
          <tr>
            {columns.map(col => (
              <th key={col} className="px-2.5 py-2 font-semibold text-gray-700 whitespace-nowrap">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row['Work Order No.'] || row['W.O.NO.'] || row['WO'] || idx}-${idx}`} className="border-b border-gray-100 odd:bg-white even:bg-gray-50/50">
              {columns.map(col => (
                <td key={`${idx}-${col}`} className="px-2.5 py-1.5 align-top text-gray-700 whitespace-nowrap">{row[col] || '—'}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-3 py-5 text-center text-gray-400 italic">{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  /* ── Date Grid ─────────────────────────────────────────────────────────── */

  const renderDateGrid=(cat:'delivery'|'installation')=>{
    const off=cat==='delivery'?delOff:instOff; const setOff=cat==='delivery'?setDelOff:setInstOff;
    const ref=cat==='delivery'?delRef:instRef; const prefix=cat==='delivery'?'delivery-':'installation-';
    const Icon=cat==='delivery'?Truck:Wrench;
    const baseDate = parseISO(referenceDate);
    const dates=Array.from({length:NUM_COLS},(_,i)=>addDays(baseDate,off+i));
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cat==='delivery'?'bg-amber-100':'bg-indigo-100'}`}>
              <Icon className={`w-4 h-4 ${cat==='delivery'?'text-amber-600':'text-indigo-600'}`}/>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{cat==='delivery'?'Delivery':'Installation'}</h3>
              <p className="text-xs text-gray-400">{format(dates[0],'MMM d')} – {format(dates[dates.length-1],'MMM d')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setOff(p=>p-1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronLeft className="w-3.5 h-3.5 text-gray-500"/></button>
            <button onClick={()=>setOff(p=>p+1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronRight className="w-3.5 h-3.5 text-gray-500"/></button>
            <span className="text-xs font-medium text-purple-600 cursor-pointer hover:underline ml-1">View all</span>
          </div>
        </div>
        {/* date column headers */}
        <div ref={ref} className="flex flex-1 min-h-0 overflow-hidden" onMouseDown={e => startDateDrag(cat, e)}>
          {dates.map(date=>{
            const dk=format(date,'yyyy-MM-dd'); const lid=`${prefix}${dk}`;
            const isTod=isToday(date); const isSun=isSunday(date); const cards=sortScheduleGroup(getCards(lid).filter(matchesWo));
            return (
              <div key={dk} className={`flex-1 min-w-0 flex flex-col border-r border-gray-100 last:border-r-0 ${isTod?'bg-blue-50/40':''}`}>
                {/* day header */}
                <div
                  onMouseDown={e => startDateDrag(cat, e)}
                  className={`flex flex-col items-center py-1.5 border-b border-gray-100 flex-shrink-0 cursor-ew-resize ${isTod?'bg-blue-500':isSun?'bg-gray-100':''}`}
                >
                  <span className={`text-xs font-semibold uppercase tracking-wider ${isTod?'text-white':isSun?'text-red-400':'text-gray-400'}`}>
                    {format(date,'EEE')}
                  </span>
                  <span className={`text-sm font-bold mt-0.5 ${isTod?'text-white':isSun?'text-red-400':'text-gray-700'}`}>
                    {format(date,'d')}
                  </span>
                  {isSun&&<span className="text-xs text-red-400 font-semibold leading-none">OFF</span>}
                </div>
                <Droppable droppableId={lid} isDropDisabled={isSun} direction="vertical">
                  {(prov,snap)=>(
                    <div ref={prov.innerRef} {...prov.droppableProps}
                      className={`flex-1 overflow-y-auto scrollbar-hide p-1 pb-36 ${snap.isDraggingOver?(isSun?'bg-red-50':'bg-blue-50'):''}`}>
                      {cards.map((c,i)=><CardChip key={c.id} card={c} listId={lid} index={i} isDragDisabled={!canEditSchedule} onOpen={()=>setSelected({card:c,listId:lid})}/>)}
                      {prov.placeholder}
                      {isSun&&cards.length===0&&<p className="text-xs text-gray-300 text-center mt-2">Sunday – Off</p>}
                    </div>)}
                </Droppable>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ── Gantt (Installation only, max today, vertical scroll) ────────────── */

  const renderGantt=()=>{
    type GRow={card:ScCard;dk:string};
    const today0=startOfDay(parseISO(referenceDate));
    const rows:GRow[]=[];
    Object.keys(store).forEach(lid=>{
      if(!lid.startsWith('installation-'))return;
      const dk=lid.replace(/^installation-/,'');
      const d=startOfDay(parseISO(dk));
      if(isBefore(today0, d)) return; // Do not render future dates in "In Progress up to today"
      (store[lid]??[]).forEach(card=>{
        if(!card.isConfirmed) return;
        if(!matchesWo(card)) return;
        rows.push({card,dk});
      });
    });
    rows.sort((a,b)=>a.dk.localeCompare(b.dk));
    // Left-to-right timeline: today at far left, older past dates to the right.
    const ganttDates=Array.from({length:GANTT_TOTAL_DAYS},(_,i)=>addDays(parseISO(referenceDate),-i));
    const LABEL_W=56;
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-purple-600"/>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">In Progress</h3>
              <p className="text-xs text-gray-400">Up to today</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block border-2 border-gray-800"/>On Track</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block border-2 border-red-700"/>Delayed</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={()=>ganttRef.current?.scrollBy({ left: -ganttDW, behavior: 'smooth' })} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-3.5 h-3.5 text-gray-500"/></button>
              <button onClick={()=>ganttRef.current?.scrollBy({ left: ganttDW, behavior: 'smooth' })} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-3.5 h-3.5 text-gray-500"/></button>
            </div>
            
          </div>
        </div>
        <div ref={ganttRef} className="flex-1 overflow-auto min-h-0">
          <div style={{minWidth:LABEL_W+ganttDates.length*ganttDW}}>
            {/* date header */}
            <div className="flex sticky top-0 z-10 bg-white border-b border-gray-200">
              <div style={{width:LABEL_W,flexShrink:0}} className="text-xs font-semibold text-gray-400 px-3 py-2 border-r border-gray-100 bg-gray-50">ID</div>
              {ganttDates.map(date=>{
                const isTod=isToday(date); const isSun=isSunday(date);
                return (
                  <div key={format(date,'yyyy-MM-dd')} style={{width:ganttDW,flexShrink:0}}
                    className={`text-center py-1 border-r border-gray-100 ${isTod?'bg-blue-500':isSun?'bg-gray-100':''}`}>
                    <div className={`text-xs font-semibold uppercase ${isTod?'text-white':isSun?'text-gray-400':'text-gray-500'}`}>{format(date,'EEE')}</div>
                    <div className={`text-xs font-bold ${isTod?'text-white':isSun?'text-gray-400':'text-gray-600'}`}>{format(date,'MMM/d').toLowerCase()}</div>
                    {isTod&&<div className="text-xs text-blue-200 font-semibold">TODAY</div>}
                  </div>);
              })}
            </div>
            {rows.length===0&&<div className="py-8 text-center text-sm text-gray-400">No installation work orders scheduled</div>}
            {rows.map(({card,dk})=>{
              const startDate=startOfDay(parseISO(card.confirmedDate || dk));
              const endAnchor = card.completedDate ? startOfDay(parseISO(card.completedDate)) : today0;
              // 0 means today (left-most), increasing values move right into the past.
              const dayOff=differenceInCalendarDays(today0,endAnchor);
              const leftPx=dayOff*ganttDW;
              const maxRight=ganttDates.length*ganttDW;
              const clampedLeft=Math.max(0,leftPx);
              const isCompleted = Boolean(card.completedDate);
              const progressedDays=Math.max(1, differenceInCalendarDays(endAnchor,startDate)+1);
              const rawWidth=progressedDays*ganttDW;
              const clampedWidth=Math.max(0,Math.min(rawWidth,maxRight-clampedLeft));
              const outerBorder=card.isEmergency?'#dc2626':'#4b5563';
              const isEmRow=card.isEmergency;
              const segmentDays = Array.from({ length: progressedDays }, (_, idx) => {
                const segmentDate = format(addDays(endAnchor, -idx), 'yyyy-MM-dd');
                return {
                  key: `${card.id}-${segmentDate}`,
                  color: isCardDelayedOnDate(card, segmentDate) ? '#ef4444' : '#22c55e',
                };
              });
              return (
                <div key={card.id} className="flex items-center border-b border-gray-50 h-9">
                  <div style={{width:LABEL_W,flexShrink:0}}
                    className={`flex items-center px-3 border-r border-gray-100 h-full text-sm font-bold ${isEmRow?'text-red-600':'text-gray-700'}`}>
                    {normalizeWoCode(card.woCode)}
                  </div>
                  <div className="flex-1 relative h-full overflow-hidden">
                    {/* sunday shading */}
                    {ganttDates.map((d,di)=>isSunday(d)?(
                      <div key={di} style={{position:'absolute',left:di*ganttDW,width:ganttDW,top:0,bottom:0}} className="bg-gray-50 pointer-events-none"/>):null)}
                    {/* today line */}
                    {(()=>{const t=0;return t>=0&&t<ganttDates.length?(
                      <div style={{position:'absolute',left:t*ganttDW+ganttDW/2,top:0,bottom:0,width:2}} className="bg-blue-400 opacity-60 pointer-events-none"/>):null;})()}
                    {/* bar */}
                    {clampedWidth>0&&clampedLeft<maxRight&&(
                      <div
                        onClick={()=>setSelected({card,listId:`installation-${dk}`})}
                        style={{
                          position:'absolute',
                          left:clampedLeft,
                          width:Math.max(12,clampedWidth),
                          height:21,
                          top:'50%',
                          transform:'translateY(-50%)',
                          border:`2px solid ${outerBorder}`,
                          borderRadius:8,
                          backgroundColor:'white',
                          cursor:'pointer',
                          boxSizing:'border-box',
                          display:'flex',
                          alignItems:'center',
                          padding:0,
                          gap:0,
                          overflow:'hidden',
                        }}
                      >
                        {segmentDays.map((segment, idx) => (
                          <div
                            key={segment.key}
                            style={{
                              flex: 1,
                              height: 13,
                              borderRadius: idx === 0 ? '4px 0 0 4px' : idx === segmentDays.length - 1 ? '0 4px 4px 0' : 0,
                              backgroundColor: segment.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: idx === 0 ? 'flex-start' : 'center',
                              paddingLeft: idx === 0 ? 6 : 0,
                              overflow: 'hidden',
                            }}
                          >
                            {idx === 0 && (
                              <span style={{color:'white',fontSize:10,fontWeight:700,letterSpacing:'0.02em',textShadow:'0 1px 2px rgba(0,0,0,0.3)',whiteSpace:'nowrap'}}>
                                {normalizeWoCode(card.woCode)} · {progressedDays}d
                              </span>
                            )}
                          </div>
                        ))}
                      </div>)}
                  </div>
                </div>);
            })}
          </div>
        </div>
      </div>
    );
  };

  /* ── Combined Installation (date grid + gantt in one panel) ──────────── */

  const renderCombinedInstallation=()=>{
    const prefix='installation-';
    const baseDate = parseISO(referenceDate);
    const dates=Array.from({length:INSTALLATION_COLS},(_,i)=>addDays(baseDate,instOff+i));
    const today0 = startOfDay(baseDate);
    // Past-day columns are narrower than today/future columns in installation only.
    const dayWeights = dates.map(d => isBefore(startOfDay(d), today0) ? 0.78 : 1);
    const totalWeight = dayWeights.reduce((sum, w) => sum + w, 0);
    const leftPctFor = (idx: number) => (dayWeights.slice(0, idx).reduce((s, w) => s + w, 0) / totalWeight) * 100;
    const widthPctForRange = (startIdx: number, endIdx: number) => (dayWeights.slice(startIdx, endIdx + 1).reduce((s, w) => s + w, 0) / totalWeight) * 100;

    return (
      <div className="row-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden min-h-0">

        {/* ── Installation header (date nav + gantt legend merged) ── */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-100">
              <Wrench className="w-4 h-4 text-indigo-600"/>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Installation</h3>
              <p className="text-xs text-gray-400">{format(dates[0],'MMM d')} – {format(dates[dates.length-1],'MMM d')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block border-2 border-gray-800"/>On Track</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block border-2 border-red-700"/>Delayed</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={()=>setInstOff(p=>p-1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronLeft className="w-3.5 h-3.5 text-gray-500"/></button>
              <button onClick={()=>setInstOff(p=>p+1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronRight className="w-3.5 h-3.5 text-gray-500"/></button>
            </div>
          </div>
        </div>

        {/* ── Installation: day headers → gantt bars → droppable cards ── */}
        <div ref={instRef} className="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-hide" style={{flex:'1 1 0',minHeight:0}} onMouseDown={e => startDateDrag('installation', e)}>

          {/* Row 1 – Day column headers */}
          <div
            onMouseDown={e => startDateDrag('installation', e)}
            className="sticky top-0 z-20 bg-white flex flex-shrink-0 border-b border-gray-100 cursor-ew-resize"
          >
            {dates.map((date, idx)=>{
              const dk=format(date,'yyyy-MM-dd');
              const isTod=isToday(date); const isSun=isSunday(date);
              return (
                <div key={dk} style={{ flex: `${dayWeights[idx]} 1 0%` }} className={`min-w-0 flex flex-col items-center py-1.5 border-r border-gray-100 last:border-r-0 ${isTod?'bg-blue-500':isSun?'bg-gray-100':''}`}>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${isTod?'text-white':isSun?'text-red-400':'text-gray-400'}`}>{format(date,'EEE')}</span>
                  <span className={`text-sm font-bold mt-0.5 ${isTod?'text-white':isSun?'text-red-400':'text-gray-700'}`}>{format(date,'d')}</span>
                  {isSun&&<span className="text-xs text-red-400 font-semibold leading-none">OFF</span>}
                </div>
              );
            })}
          </div>

          {/* Row 2 – Chip columns (emergency-first unconfirmed cards, natural height) */}
          <div className="flex flex-shrink-0 overflow-hidden">
            {dates.map((date, idx)=>{
              const dk=format(date,'yyyy-MM-dd'); const lid=`${prefix}${dk}`;
              const isTod=isToday(date); const isSun=isSunday(date);
              const chips=sortScheduleGroup(getCards(lid).filter(c=>matchesWo(c)&&!c.isConfirmed));
              return (
                <div key={dk} style={{ flex: `${dayWeights[idx]} 1 0%` }} className={`min-w-0 flex flex-col border-r border-gray-100 last:border-r-0 ${isTod?'bg-blue-50/40':''}`}>
                  <Droppable droppableId={lid} isDropDisabled={isSun} direction="vertical">
                    {(prov,snap)=>(
                      <div ref={prov.innerRef} {...prov.droppableProps}
                        className={`overflow-y-auto scrollbar-hide p-1 min-h-[36px] ${snap.isDraggingOver?(isSun?'bg-red-50':'bg-blue-50'):''}`}>
                        {chips.map((c,i)=><CardChip key={c.id} card={c} listId={lid} index={i} isDragDisabled={!canEditSchedule} onOpen={()=>setSelected({card:c,listId:lid})}/>)}
                        {prov.placeholder}
                        {isSun&&chips.length===0&&<p className="text-xs text-gray-300 text-center mt-2">Sunday – Off</p>}
                      </div>)}
                  </Droppable>
                </div>
              );
            })}
          </div>

          {/* Row 3 – Spanning gantt bars (confirmed/in-progress, absolute positioned) */}
          {(()=>{
            const todayDk=referenceDate;
            const confirmed:Array<{card:ScCard;bDk:string}>=[];
            Object.keys(store).forEach(lid=>{
              if(!lid.startsWith('installation-'))return;
              const sDk=lid.replace(/^installation-/,'');
              const d=startOfDay(parseISO(sDk));
              if(isBefore(today0,d))return;
              (store[lid]??[]).forEach(card=>{
                if(!card.isConfirmed||!matchesWo(card))return;
                confirmed.push({card,bDk:sDk});
              });
            });
            confirmed.sort((a,b)=>{
              const prio=(card:ScCard,dk:string)=>{
                const startedToday=card.confirmedDate===todayDk||(!card.confirmedDate&&dk===todayDk);
                const delayed=isCardCurrentlyDelayed(card);
                if(card.isEmergency&&startedToday)return 0;
                if(card.isEmergency&&!startedToday)return 1;
                if(!card.isEmergency&&!delayed)return 2;
                return 3;
              };
              const diff=prio(a.card,a.bDk)-prio(b.card,b.bDk);
              return diff!==0?diff:a.bDk.localeCompare(b.bDk);
            });
            if(confirmed.length===0)return null;
            // Pre-count only rows that will actually render (clipped to visible date window)
            const visibleRowCount = confirmed.filter(({card,bDk})=>{
              const startDate=startOfDay(parseISO(card.confirmedDate||bDk));
              const endAnchor=card.completedDate?startOfDay(parseISO(card.completedDate)):today0;
              const startDk=format(startDate,'yyyy-MM-dd');
              const endDk=format(endAnchor,'yyyy-MM-dd');
              let sc=dates.findIndex(d=>format(d,'yyyy-MM-dd')===startDk);
              let ec=dates.findIndex(d=>format(d,'yyyy-MM-dd')===endDk);
              if(sc===-1){const f=format(dates[0],'yyyy-MM-dd');sc=startDk<f?0:INSTALLATION_COLS;}
              if(ec===-1){const l=format(dates[dates.length-1],'yyyy-MM-dd');ec=endDk>l?INSTALLATION_COLS-1:-1;}
              return !(sc>=INSTALLATION_COLS||ec<0||sc>ec);
            }).length;
            if(visibleRowCount===0)return null;
            let visibleRowIdx = 0;
            return (
              <div className="relative flex-shrink-0" style={{height:visibleRowCount*26+4}}>
                <div className="absolute inset-0 pointer-events-none">
                  {dates.slice(1).map((d, idx) => (
                    <div
                      key={`partition-${format(d, 'yyyy-MM-dd')}`}
                      style={{
                        position: 'absolute',
                        left: `${leftPctFor(idx + 1)}%`,
                        top: 0,
                        bottom: 0,
                        width: 1,
                        backgroundColor: '#e5e7eb',
                        opacity: 0.95,
                      }}
                    />
                  ))}
                </div>
                {confirmed.map(({card,bDk},rowIdx)=>{
                  const startDate=startOfDay(parseISO(card.confirmedDate||bDk));
                  const endAnchor=card.completedDate?startOfDay(parseISO(card.completedDate)):today0;
                  const progressedDays=Math.max(1,differenceInCalendarDays(endAnchor,startDate)+1);
                  const startDk=format(startDate,'yyyy-MM-dd');
                  const endDk=format(endAnchor,'yyyy-MM-dd');
                  let startCol=dates.findIndex(d=>format(d,'yyyy-MM-dd')===startDk);
                  let endCol=dates.findIndex(d=>format(d,'yyyy-MM-dd')===endDk);
                  if(startCol===-1){const f=format(dates[0],'yyyy-MM-dd');startCol=startDk<f?0:INSTALLATION_COLS;}
                  if(endCol===-1){const l=format(dates[dates.length-1],'yyyy-MM-dd');endCol=endDk>l?INSTALLATION_COLS-1:-1;}
                  if(startCol>=INSTALLATION_COLS||endCol<0||startCol>endCol)return null;
                  const currentRowIdx = visibleRowIdx;
                  visibleRowIdx += 1;
                  const leftPct=leftPctFor(startCol);
                  const widthPct=widthPctForRange(startCol, endCol);
                  const visibleDates = dates.slice(startCol, endCol + 1);
                  const segments = visibleDates.map((segDateObj, idx) => {
                    const segDate = format(segDateObj, 'yyyy-MM-dd');
                    return {
                      key: `${card.id}-${segDate}`,
                      color: isCardDelayedOnDate(card, segDate) ? '#ef4444' : '#22c55e',
                      flex: dayWeights[startCol + idx],
                    };
                  });
                  return (
                    <GanttBarChip
                      key={card.id}
                      card={card}
                      progressedDays={progressedDays}
                      segments={segments}
                      leftPct={leftPct}
                      widthPct={widthPct}
                      rowIdx={currentRowIdx}
                      onOpen={()=>setSelected({card,listId:`installation-${bDk}`})}
                    />
                  );
                })}
              </div>
            );
          })()}

          {/* Spacer – fills remaining vertical space below chips+gantt */}
          <div className="h-36 flex-shrink-0" />
        </div>
      </div>
    );
  };

  /* ── Pending ─────────────────────────────────────────────────────────── */

  const renderPending=()=>{
    const delCards=sortScheduleGroup(getCards('pending-delivery').filter(matchesWo));
    const instCards=sortScheduleGroup(getCards('pending-installation').filter(matchesWo));
    const cols=[
      {lid:'pending-delivery',   label:'Delivery',     count:delCards.length,   Icon:Truck,  cards:delCards,  cat:'delivery'  as const},
      {lid:'pending-installation',label:'Installation', count:instCards.length,  Icon:Wrench, cards:instCards, cat:'installation' as const},
    ].filter(c=>pendFilter==='all'||c.cat===pendFilter);
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center"><Clock className="w-4 h-4 text-amber-600"/></span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Pending</h3>
              <p className="text-xs text-gray-400">{totalPend} cards</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Sourced from Work Order</span>
            <div className="relative">
              <select value={pendFilter} onChange={e=>setPendFilter(e.target.value as typeof pendFilter)}
                className="text-xs font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 appearance-none pr-6 cursor-pointer">
                <option value="all">All Types</option>
                <option value="delivery">Delivery</option>
                <option value="installation">Installation</option>
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"/>
            </div>
            <button
              onClick={openPendingFullscreen}
              className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-base hover:bg-gray-50 transition-colors"
              title="Open pending in full screen"
              aria-label="Open pending in full screen"
            >
              🖥️
            </button>
          </div>
        </div>
        {/* two columns */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {cols.map(({lid,label,count,Icon,cards,cat},ci)=>(
            <div key={lid} className={`flex-1 flex flex-col min-h-0 ${ci<cols.length-1?'border-r border-gray-100':''}`}>
              {/* sub-header */}
              <div className="px-2.5 py-1 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <Icon className={`w-3.5 h-3.5 ${cat==='delivery'?'text-amber-500':'text-indigo-500'}`}/>
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                  <span className="text-xs text-gray-400">({count})</span>
                </div>
                <span className="text-xs text-gray-400">Auto</span>
              </div>
              <Droppable droppableId={lid} direction="vertical">
                {(prov,snap)=>(
                  <div ref={prov.innerRef} {...prov.droppableProps}
                    className={`flex-1 overflow-y-auto scrollbar-hide p-1 pb-36 ${snap.isDraggingOver?'bg-orange-50':''}`}>
                    {cards.map((c,i)=><CardChip key={c.id} card={c} listId={lid} index={i} isPending isDragDisabled={!canEditSchedule} onOpen={()=>setSelected({card:c,listId:lid})}/>)}
                    {prov.placeholder}
                    {!cards.length&&<p className="text-xs text-gray-300 text-center py-4 italic">No pending {label.toLowerCase()}</p>}
                  </div>)}
              </Droppable>
            </div>
          ))}
          {pendFilter!=='all'&&cols.length===1&&(
            <div className="flex-1 flex items-center justify-center text-xs text-gray-400 italic border-l border-gray-100">
              {pendFilter==='delivery'?'Installation hidden':'Delivery hidden'} — change filter
            </div>)}
        </div>
      </div>
    );
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* ── Top header ── */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{format(parseISO(referenceDate),'EEEE, MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={resetStatusAndPlanning}
            disabled={!canEditSchedule}
            title="Clear all cards from Status and Planning (Delivery + Installation) without changing Pending"
            className={`p-2 rounded-lg border ${!canEditSchedule ? 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-500 border-gray-200 hover:text-red-600 hover:border-red-300'}`}
          >
            <RotateCcw className="w-3.5 h-3.5"/>
          </button>
          <div className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-lg bg-white ${searchDate ? 'border-purple-300 ring-1 ring-purple-200' : 'border-gray-200'}`}>
            <Search className="w-3.5 h-3.5 text-gray-400"/>
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">Search by Date</span>
            <input
              type="date"
              value={searchDate}
              onChange={e => setSearchDate(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            {searchDate && (
              <button
                onClick={() => setSearchDate('')}
                title="Back to live view"
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5"/>
              </button>
            )}
          </div>
          <button
            onClick={() => { void handleGenerateReports(); }}
            disabled={isGeneratingReports || !canEditSchedule}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border ${isGeneratingReports || !canEditSchedule ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'}`}
            title={canEditSchedule ? 'Generate all 7 schedule reports' : 'Only Admin and Delivery & Installation can generate reports'}
          >
            {isGeneratingReports ? 'Generating...' : 'Generate 7 Reports'}
          </button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input value={woSearch} onChange={e=>setWoSearch(e.target.value)} placeholder="Search WO (e.g. 7654)"
              className="w-56 pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/>
          </div>
          {/* channel switcher */}
          <div className="relative" ref={chDropRef}>
            <button onClick={()=>setShowChDrop(p=>!p)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 shadow-sm transition-colors">
              <CalendarRange className="w-4 h-4 text-purple-200"/>
              <span>Schedule</span>
              <ChevronDown className="w-4 h-4 opacity-70"/>
            </button>
            {showChDrop&&(
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100">
                  <div className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"/>
                    <input type="text" placeholder="Search channels…" readOnly className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none"/></div>
                </div>
                {(['Quotation','Work Order','Schedule'] as ChannelType[]).map(ch=>{
                  const ok=ch==='Schedule'||accessibleChannels.includes(ch);
                  return (
                    <button key={ch} disabled={!ok}
                      onClick={()=>{if(ok&&onChannelSwitch){onChannelSwitch(ch);setShowChDrop(false);}}}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50 ${!ok?'opacity-40 cursor-not-allowed':'cursor-pointer'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ch==='Quotation'?'bg-blue-100':ch==='Work Order'?'bg-orange-100':'bg-purple-100'}`}>
                        {ch==='Quotation'?<FileText className="w-4 h-4 text-blue-600"/>:ch==='Work Order'?<ClipboardList className="w-4 h-4 text-orange-500"/>:<CalendarRange className="w-4 h-4 text-purple-600"/>}
                      </span>
                      <span className={`flex-1 text-left font-medium ${ch==='Schedule'?'text-gray-900':'text-gray-700'}`}>{ch}</span>
                      {ch==='Schedule'&&<Check className="w-4 h-4 text-green-500 flex-shrink-0"/>}
                    </button>);})}
              </div>)}
        </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="px-4 py-2 grid grid-cols-4 gap-2 flex-shrink-0">
        {stats.map(({Icon,bg,ic,label,val,trend,up})=>(
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2 flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${ic}`}/>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 font-medium truncate">{label}</p>
              <p className="text-xl font-bold text-gray-900 leading-tight">{val}</p>
              <p className={`text-xs font-medium ${up?'text-emerald-500':'text-red-500'} flex items-center gap-0.5`}>
                <span>{up?'↑':'↓'}</span><span>{trend}</span>
              </p>
            </div>
          </div>))}
      </div>

      {/* ── 2x3 Schedule Matrix ── */}
      {searchDate && (
        <div className="mx-4 mb-2 flex-shrink-0 flex items-center justify-between gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5">
          <span className="text-xs font-medium text-purple-700">
            Viewing historical status as of {format(parseISO(searchDate),'EEEE, MMMM d, yyyy')} (read-only)
          </span>
          <button onClick={() => setSearchDate('')} className="text-xs font-semibold text-purple-700 hover:text-purple-900 underline">
            Back to live view
          </button>
        </div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 flex flex-col px-4 pb-3 min-h-0 overflow-hidden">
          {renderScheduleMatrix()}
        </div>
      </DragDropContext>

      {/* Modals */}
      {addCardType&&<AddCardModal type={addCardType} onClose={()=>setAddCardType(null)} onAdd={c=>setStore(prev=>({...prev,[c.listId]:[...(prev[c.listId]??[]),c]}))}/>}
      {expandedList && (
        <MatrixFullscreenModal
          listId={expandedList.listId}
          phase={expandedList.phase}
          cards={sortScheduleGroup(getCards(expandedList.listId).filter(matchesWo))}
          referenceDate={referenceDate}
          canEdit={canEditSchedule && !searchDate}
          onUpdateCard={updateScheduleCardFields}
          onDeleteCard={deleteScheduleCard}
          onClose={() => setExpandedList(null)}
        />
      )}
      {selected&&<CardDetailModal card={selected.card} listId={selected.listId} canEdit={canEditSchedule && !searchDate} referenceDate={referenceDate} onClose={()=>setSelected(null)} onSave={(u,lid)=>{
        setStore(prev => {
          const sourceList = selected.listId;
          const next: ScStore = { ...prev };
          next[sourceList] = (next[sourceList] ?? []).filter(c => c.id !== u.id);
          const destination = next[lid] ?? [];
          if (destination.some(c => c.id === u.id)) {
            next[lid] = destination.map(c => c.id === u.id ? { ...u, listId: lid } : c);
          } else {
            next[lid] = [{ ...u, listId: lid }, ...destination];
          }
          return next;
        });
        const forcedType: 'Delivery' | 'Installation' | undefined =
          u.scheduleType === 'Delivery & Installation'
            ? undefined
            : (getPhaseForListId(lid) === 'installation' ? 'Installation' : 'Delivery');
        void syncScheduleCardToWorkOrder({ ...u, listId: lid }, forcedType);
      }}/>} 
      {pendingDrop&&(
        <WorkersModal destId={pendingDrop.dstId}
          onConfirm={w=>{performMove(pendingDrop.srcId,pendingDrop.dstId,pendingDrop.cardId,pendingDrop.dstIdx,w);setPendingDrop(null);}}
          onCancel={()=>setPendingDrop(null)}/>)}

      {isPendingFullscreen && (
        <div className="fixed inset-0 z-50 bg-black/60 p-3 sm:p-5">
          <div className="h-full w-full bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Pending Full Screen</h3>
                <p className="text-xs text-gray-500">
                  Delivery Pending details (left) and Installation Pending details (right)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { void loadPendingDetails(); }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  Refresh
                </button>
                <button onClick={() => setIsPendingFullscreen(false)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
              <section className="min-h-0 flex flex-col p-3 border-b lg:border-b-0 lg:border-r border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-amber-700">Delivery Pending</h4>
                  <span className="text-xs text-gray-500">{pendingDetails?.delivery.rows.length ?? 0} rows</span>
                </div>
                {pendingDetailsLoading ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-gray-500">Loading delivery details...</div>
                ) : pendingDetailsError ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-red-600 text-center px-6">{pendingDetailsError}</div>
                ) : (
                  renderPendingDetailsTable(
                    pendingDetails?.delivery.columns ?? [],
                    pendingDetails?.delivery.rows ?? [],
                    'No delivery pending rows for this date.'
                  )
                )}
              </section>

              <section className="min-h-0 flex flex-col p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-indigo-700">Installation Pending</h4>
                  <span className="text-xs text-gray-500">{pendingDetails?.installation.rows.length ?? 0} rows</span>
                </div>
                {pendingDetailsLoading ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-gray-500">Loading installation details...</div>
                ) : pendingDetailsError ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-red-600 text-center px-6">{pendingDetailsError}</div>
                ) : (
                  renderPendingDetailsTable(
                    pendingDetails?.installation.columns ?? [],
                    pendingDetails?.installation.rows ?? [],
                    'No installation pending rows for this date.'
                  )
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
