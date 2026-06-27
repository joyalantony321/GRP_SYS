import fs from 'fs';
import path from 'path';

import type { ScCard } from '@/components/ScheduleBoard';

export type ScheduleStore = Record<string, ScCard[]>;

const DATA_FILE = path.join(process.cwd(), 'data', 'schedule-data.json');

const DEFAULT_STORE: ScheduleStore = {
  'pending-delivery': [],
  'pending-installation': [],
};

const normalizeStore = (raw: unknown): ScheduleStore => {
  const normalized: ScheduleStore = {
    'pending-delivery': [],
    'pending-installation': [],
  };

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
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore(store), null, 2), 'utf-8');
}
