import type { NextApiRequest, NextApiResponse } from 'next';

import { readScheduleStore, writeScheduleStore, type ScheduleStore } from '@/lib/scheduleStore';

export const config = {
  api: {
    bodyParser: {
      // Schedule remarks can include image/video attachments encoded as data URLs.
      sizeLimit: '25mb',
    },
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const store = readScheduleStore();
    return res.status(200).json({ store });
  }

  if (req.method === 'PUT') {
    const body = req.body as { store?: unknown };
    try {
      writeScheduleStore((body?.store ?? {}) as ScheduleStore);
      const store = readScheduleStore();
      return res.status(200).json({ ok: true, store });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save schedule data';
      return res.status(500).json({ ok: false, detail: message });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).end();
}
