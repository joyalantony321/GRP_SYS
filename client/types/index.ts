export type RemarkType = 'Active' | 'Pending' | 'Inactive';

export type ListType =
  | 'Quotation' | 'Submittal' | 'Review' | 'LPO'
  | 'Purchase Order' | 'Work Order' | 'Accounts' | 'Delivery' | 'Installation';

export type UserWorkStatus = 'Assigned' | 'Working' | 'Completed';

export type ChannelType = 'Quotation' | 'Work Order' | 'Schedule';

export type Department = 'Quotation' | 'Technical' | 'Accounts' | 'Delivery & Installation';

export const DEPARTMENTS: Department[] = ['Quotation', 'Technical', 'Accounts', 'Delivery & Installation'];

export const CHANNEL_LISTS: Record<ChannelType, ListType[]> = {
  'Quotation': ['Quotation', 'Submittal', 'Review', 'LPO'],
  'Work Order': ['Work Order', 'Accounts', 'Delivery', 'Installation'],
  'Schedule': [],
};

export const CHANNEL_DEPARTMENTS: Record<ChannelType, Department[]> = {
  'Quotation': ['Quotation', 'Technical'],
  'Work Order': ['Accounts', 'Technical', 'Delivery & Installation'],
  'Schedule': ['Quotation', 'Technical', 'Accounts', 'Delivery & Installation'],
};

// Per-department list permissions per channel.
// Admin always sees all lists. undefined = no access to that channel.
export const DEPARTMENT_LISTS: Record<Department, Partial<Record<ChannelType, ListType[]>>> = {
  'Quotation': {
    'Quotation': ['Quotation', 'Submittal', 'Review', 'LPO'],
  },
  'Technical': {
    'Quotation': ['Submittal', 'Review', 'LPO'],
    'Work Order': ['Work Order', 'Accounts', 'Delivery', 'Installation'],
  },
  'Accounts': {
    'Work Order': ['Accounts', 'Delivery', 'Installation'],
  },
  'Delivery & Installation': {
    'Work Order': ['Work Order', 'Delivery', 'Installation'],
  },
};

/** Returns the lists a user may see in a given channel. Admin always gets all lists. */
export function getPermittedLists(
  channel: ChannelType,
  userRole: 'admin' | 'user',
  userDepartment?: Department | ''
): ListType[] {
  if (userRole === 'admin') return CHANNEL_LISTS[channel];
  if (!userDepartment) return [];
  return DEPARTMENT_LISTS[userDepartment as Department]?.[channel] ?? [];
}

export interface Remark {
  id: string;
  list: ListType;
  type: RemarkType;
  tags: string[];
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  visibleDepartments?: Department[];
}

export interface Card {
  id: string;
  quoteNumber: string;
  revisionNumber?: number;
  workOrderNumber?: string;
  companyCode?: string;
  purchaseOrderDocName?: string;
  purchaseOrderDocData?: string;
  purchaseOrderDocUrl?: string;
  quotationDocName?: string;
  quotationDocData?: string;
  quotationDocUrl?: string;
  completionDocName?: string;
  completionDocData?: string;
  completionDocUrl?: string;
  completedAt?: string;
  date: string;
  salesPerson: string;
  subject: string;
  projectLocation: string;
  list: ListType;
  channel?: ChannelType;
  remarks: Remark[];
  createdAt: string;
  updatedAt: string;
  approved?: boolean;
  terminated?: boolean;
  assignedTo?: string;
  userWorkStatus?: UserWorkStatus;
  paymentPercent?: number;
  listHistory?: { list: ListType; enteredAt: string }[];
  assignmentHistory?: { assignedTo: string; assignedAt: string; assignedBy?: string; action?: 'Sent' | 'Approved' | 'Terminated' | 'Revised' | 'Redo' }[];
  workOrderDetails?: WorkOrderFormData;
  orderConfirmationDetails?: OrderConfirmationFormData;
}

export interface WorkOrderItem {
  slNo: number;
  itemDescription: string;
  qty: string;
  remarks: string;
}

export interface WorkOrderFormData {
  woDate: string;
  customerId?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  brand: 'PIPECO TANKS' | 'COLEX TANKS';
  // Company Details
  companyName: string;
  companyContactName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  // Delivery Details
  deliveryDate: string;
  deliveryLocation: string;
  deliveryContactName: string;
  deliveryContactNumber: string;
  installationCompletionDate: string;
  // Checkboxes
  typeInsulated: boolean;
  typeNonInsulated: boolean;
  skidHollow: boolean;
  skidIBeam: boolean;
  indicatorTube: boolean;
  indicatorScale: boolean;
  ladderInternal: boolean;
  ladderExternal: boolean;
  supportInternal: boolean;
  supportExternal: boolean;
  supply: boolean;
  installation: boolean;
  testingCommissioning: boolean;
  maintenance: boolean;
  // Job
  jobDescription: string;
  items: WorkOrderItem[];
}

export const defaultWorkOrderForm = (woNumber: string, salesPerson: string): WorkOrderFormData => ({
  woDate: new Date().toISOString().split('T')[0],
  customerId: '',
  invoiceNo: '',
  invoiceDate: '',
  brand: 'PIPECO TANKS',
  companyName: '',
  companyContactName: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  deliveryDate: '',
  deliveryLocation: '',
  deliveryContactName: '',
  deliveryContactNumber: '',
  installationCompletionDate: '',
  typeInsulated: false,
  typeNonInsulated: false,
  skidHollow: false,
  skidIBeam: false,
  indicatorTube: false,
  indicatorScale: false,
  ladderInternal: false,
  ladderExternal: false,
  supportInternal: false,
  supportExternal: false,
  supply: false,
  installation: false,
  testingCommissioning: false,
  maintenance: false,
  jobDescription: '',
  items: [{ slNo: 1, itemDescription: '', qty: '', remarks: '' }],
});

export interface OrderConfirmationFormData {
  // Header
  lpoNo?: string;
  qtnNo?: string;
  date?: string;
  // LPO term confirmations
  tankBrandSizeTypeValue: 'yes' | 'no' | '';
  paymentTermsConfirmed: 'yes' | 'no' | '';
  otherTermsCondition: 'yes' | 'no' | '';
  penaltyConditionsNote: string;
  // Payment Terms
  advancePercent: string;
  advanceCDC: boolean;
  advancePDC: boolean;
  paymentCollectionFromSite: boolean;
  paymentCollectionFromOffice: boolean;
  deliveryPercent: string;
  deliveryCDC: boolean;
  deliveryPDC: boolean;
  deliveryBefore: boolean;
  deliveryAfter: boolean;
  securityChequeRequired: 'yes' | 'no' | '';
  whenRecollect: string;
  workInProgressPercent: string;
  completionAmount: string;
  completionCDC: boolean;
  completionPDC: boolean;
  testingCommissioningAmount: string;
  testingCommissioningCDC: boolean;
  testingCommissioningPDC: boolean;
  retentionAmount: string;
  retentionCDC: boolean;
  retentionPDC: boolean;
  otherCommittedTerms: string;
  // Accounts Contact
  accountsName: string;
  accountsEmail: string;
  accountsTelMob: string;
  // Document Handovering
  invoiceSubmissionOffice: boolean;
  invoiceSubmissionSite: boolean;
  warrantyManualSubmissionTime: string;
  // Project Contact
  projectName: string;
  projectEmail: string;
  projectTelMob: string;
  // Signatories
  salesExecutiveName: string;
  managerName: string;
}

export const defaultOrderConfirmationForm = (): OrderConfirmationFormData => ({
  lpoNo: '',
  qtnNo: '',
  date: new Date().toISOString().split('T')[0],
  tankBrandSizeTypeValue: '',
  paymentTermsConfirmed: '',
  otherTermsCondition: '',
  penaltyConditionsNote: '',
  advancePercent: '',
  advanceCDC: false,
  advancePDC: false,
  paymentCollectionFromSite: false,
  paymentCollectionFromOffice: false,
  deliveryPercent: '',
  deliveryCDC: false,
  deliveryPDC: false,
  deliveryBefore: false,
  deliveryAfter: false,
  securityChequeRequired: '',
  whenRecollect: '',
  workInProgressPercent: '',
  completionAmount: '',
  completionCDC: false,
  completionPDC: false,
  testingCommissioningAmount: '',
  testingCommissioningCDC: false,
  testingCommissioningPDC: false,
  retentionAmount: '',
  retentionCDC: false,
  retentionPDC: false,
  otherCommittedTerms: '',
  accountsName: '',
  accountsEmail: '',
  accountsTelMob: '',
  invoiceSubmissionOffice: false,
  invoiceSubmissionSite: false,
  warrantyManualSubmissionTime: '',
  projectName: '',
  projectEmail: '',
  projectTelMob: '',
  salesExecutiveName: '',
  managerName: '',
});

export interface KanbanData {
  cards: Card[];
}

export interface User {
  role: 'admin' | 'user';
}

export interface AppUser {
  name: string;
  pin: string;
  department?: Department;
  workOrderNumber?: string;
  companyCode?: string;
  purchaseOrderDocName?: string;
  purchaseOrderDocData?: string;
  deletedAt?: string;
}

export interface AppData {
  adminPin: string;
  users: AppUser[];
  deletedUsers?: AppUser[];
}

/** Returns the departments that can access a specific list within a channel. */
export function getDepartmentsForList(channel: ChannelType, list: ListType): Department[] {
  return DEPARTMENTS.filter(dept => {
    const deptLists = DEPARTMENT_LISTS[dept as Department]?.[channel];
    return deptLists ? deptLists.includes(list) : false;
  });
}
