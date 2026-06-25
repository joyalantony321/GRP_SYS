/**
 * Server-side only helper for reading and writing the local JSON data store.
 * Do NOT import this in client-side code.
 */
import fs from 'fs';
import path from 'path';

export interface StoredUser {
  userId: number;
  username: string;
  pin: string;
  depId: number | null;
  depName: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface StoredDepartment {
  depId: number;
  depName: string;
}

export interface AppStore {
  adminPin: string;
  nextUserId: number;
  departments: StoredDepartment[];
  users: StoredUser[];
  deletedUsers: StoredUser[];
}

const DATA_FILE = path.join(process.cwd(), 'data', 'app-data.json');

export function readStore(): AppStore {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw) as AppStore;
}

export function writeStore(store: AppStore): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}
