import type { NextApiRequest, NextApiResponse } from 'next';
import { readStore, writeStore } from '@/lib/localStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = parseInt(req.query.id as string, 10);
  if (isNaN(userId)) return res.status(400).json({ detail: 'Invalid id' });

  const store = readStore();

  if (req.method === 'PUT') {
    const { pin, dep_id } = req.body as { pin?: string; dep_id?: number | null };

    const idx = store.users.findIndex(u => u.userId === userId);
    if (idx === -1) return res.status(404).json({ detail: 'User not found' });

    if (pin) store.users[idx].pin = pin;
    if (dep_id !== undefined) {
      const dep = dep_id != null ? store.departments.find(d => d.depId === dep_id) : null;
      store.users[idx].depId = dep?.depId ?? null;
      store.users[idx].depName = dep?.depName ?? null;
    }

    writeStore(store);
    return res.status(200).json(store.users[idx]);
  }

  if (req.method === 'DELETE') {
    // Soft delete
    const idx = store.users.findIndex(u => u.userId === userId);
    if (idx === -1) return res.status(404).json({ detail: 'User not found' });

    const user = store.users[idx];
    user.isDeleted = true;
    user.deletedAt = new Date().toISOString();
    store.deletedUsers.push(user);
    store.users.splice(idx, 1);

    writeStore(store);
    return res.status(200).json({ detail: 'User soft-deleted' });
  }

  res.status(405).end();
}
