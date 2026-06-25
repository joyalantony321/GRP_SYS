import type { NextApiRequest, NextApiResponse } from 'next';
import { readStore, writeStore } from '@/lib/localStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') return res.status(405).end();

  const { pin } = req.body as { pin: string };
  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ detail: 'PIN must be exactly 4 digits' });
  }

  const store = readStore();
  store.adminPin = pin;
  writeStore(store);

  res.status(200).json({ detail: 'Admin PIN updated' });
}
