export type RemarkType = 'Active' | 'Pending' | 'Inactive';

export type ListType = 'Quotation' | 'Submittal' | 'Review' | 'LPO';

export type UserWorkStatus = 'Assigned' | 'Working' | 'Completed';

export interface Remark {
  id: string;
  list: ListType;
  type: RemarkType;
  tags: string[];
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  quoteNumber: string;
  date: string;
  salesPerson: string;
  subject: string;
  projectLocation: string;
  list: ListType;
  remarks: Remark[];
  createdAt: string;
  updatedAt: string;
  approved?: boolean;
  terminated?: boolean;
  assignedTo?: string;
  userWorkStatus?: UserWorkStatus;
}

export interface KanbanData {
  cards: Card[];
}

export interface User {
  role: 'admin' | 'user';
}

export interface AppUser {
  name: string;
  pin: string;
}

export interface AppData {
  adminPin: string;
  users: AppUser[];
}
