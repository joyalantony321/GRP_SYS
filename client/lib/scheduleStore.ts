import fs from 'fs';
import path from 'path';

import type { ScCard } from '@/components/ScheduleBoard';

export type ScheduleStore = Record<string, ScCard[]>;

const DATA_FILE = path.join(process.cwd(), 'data', 'schedule-data.json');

const CANONICAL_KEYS = [
  'pending-delivery',
  'planning-delivery',
  'status-delivery',
  'pending-installation',
  'planning-installation',
  'status-installation',
  'archive-completed',
] as const;

const DEFAULT_STORE: ScheduleStore = {
  'pending-delivery': [],
  'planning-delivery': [],
  'status-delivery': [],
  'pending-installation': [],
  'planning-installation': [],
  'status-installation': [],
  'archive-completed': [],
};

const normalizeStore = (raw: unknown): ScheduleStore => {
  const normalized: ScheduleStore = {};
  CANONICAL_KEYS.forEach((k) => {
    normalized[k] = [];
  });

  if (!raw || typeof raw !== 'object') return normalized;

  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      normalized[key] = value as ScCard[];
    }
  });

  return normalized;
};

export function readScheduleStore(): ScheduleStore {
  if (!fs.existsSync(DATA_FILE)) {
    writeScheduleStore(DEFAULT_STORE);
    return DEFAULT_STORE;
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return normalizeStore(JSON.parse(raw));
}

export function writeScheduleStore(store: ScheduleStore): void {
  const base = fs.existsSync(DATA_FILE)
    ? normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')))
    : normalizeStore(DEFAULT_STORE);

  const merged: ScheduleStore = { ...base };
  if (store && typeof store === 'object') {
    Object.entries(store as Record<string, unknown>).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        merged[key] = value as ScCard[];
      }
    });
  }

  const guardPhaseBuckets = (
    pendingKey: 'pending-delivery' | 'pending-installation',
    planningKey: 'planning-delivery' | 'planning-installation',
    statusKey: 'status-delivery' | 'status-installation',
  ) => {
    const basePlanning = base[planningKey] ?? [];
    const baseStatus = base[statusKey] ?? [];
    const basePending = base[pendingKey] ?? [];
    const mergedPlanning = merged[planningKey] ?? [];
    const mergedStatus = merged[statusKey] ?? [];
    const mergedPending = merged[pendingKey] ?? [];

    const baseSideBuckets = basePlanning.length + baseStatus.length;
    const mergedSideBuckets = mergedPlanning.length + mergedStatus.length;
    const pendingAbsorbedAll = mergedPending.length >= basePending.length + baseSideBuckets;

    // Guard against stale clients that collapse planning/status cards into pending.
    if (baseSideBuckets > 0 && mergedSideBuckets === 0 && pendingAbsorbedAll) {
      merged[pendingKey] = basePending;
      merged[planningKey] = basePlanning;
      merged[statusKey] = baseStatus;
    }
  };

  guardPhaseBuckets('pending-delivery', 'planning-delivery', 'status-delivery');
  guardPhaseBuckets('pending-installation', 'planning-installation', 'status-installation');

  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore(merged), null, 2), 'utf-8');
}
