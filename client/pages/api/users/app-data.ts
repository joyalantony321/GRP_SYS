import type { NextApiRequest, NextApiResponse } from 'next';
import { readStore } from '@/lib/localStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const store = readStore();
  res.status(200).json({
    adminPin: store.adminPin,
    users: store.users,
    deletedUsers: store.deletedUsers,
    departments: store.departments,
  });
}
