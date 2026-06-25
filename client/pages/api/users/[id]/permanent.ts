import type { NextApiRequest, NextApiResponse } from 'next';
import { readStore, writeStore } from '@/lib/localStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).end();

  const userId = parseInt(req.query.id as string, 10);
  if (isNaN(userId)) return res.status(400).json({ detail: 'Invalid id' });

  const store = readStore();
  const idx = store.deletedUsers.findIndex(u => u.userId === userId);
  if (idx === -1) return res.status(404).json({ detail: 'Deleted user not found' });

  store.deletedUsers.splice(idx, 1);
  writeStore(store);

  res.status(204).end();
}
