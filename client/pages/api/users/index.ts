import type { NextApiRequest, NextApiResponse } from 'next';
import { readStore, writeStore, StoredUser } from '@/lib/localStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, pin, dep_id } = req.body as {
    username: string;
    pin: string;
    dep_id?: number | null;
  };

  if (!username || !pin) return res.status(400).json({ detail: 'username and pin are required' });

  const store = readStore();

  if (store.users.find(u => u.username === username)) {
    return res.status(409).json({ detail: 'Username already exists' });
  }

  const dep = dep_id != null ? store.departments.find(d => d.depId === dep_id) : null;

  const newUser: StoredUser = {
    userId: store.nextUserId,
    username,
    pin,
    depId: dep?.depId ?? null,
    depName: dep?.depName ?? null,
    isDeleted: false,
    deletedAt: null,
  };

  store.users.push(newUser);
  store.nextUserId += 1;
  writeStore(store);

  res.status(201).json(newUser);
}
