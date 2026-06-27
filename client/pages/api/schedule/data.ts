import type { NextApiRequest, NextApiResponse } from 'next';

import { readScheduleStore, writeScheduleStore, type ScheduleStore } from '@/lib/scheduleStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const store = readScheduleStore();
    return res.status(200).json({ store });
  }

  if (req.method === 'PUT') {
    const body = req.body as { store?: unknown };
    writeScheduleStore((body?.store ?? {}) as ScheduleStore);
    const store = readScheduleStore();
    return res.status(200).json({ ok: true, store });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).end();
}
