import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CalendarRange, ClipboardList, FileText, Search, Plus, X, Check, ChevronDown,
  Trash2, Maximize2, Truck, Wrench, DollarSign, Settings,
} from 'lucide-react';
import { Card as WorkOrderCard, ChannelType, ListType } from '@/types';
import { fetchCards, updateCard, uploadDocument, generateAccountsPaymentReport, getAppData } from '@/lib/api';
import CardModal from './CardModal';
import {
  ScCard, ScStore, SchedulePhase,
  EMPTY_STORE, normalizeStore, mergeScheduleWithWorkOrder,
  getScheduleStage, normalizeWoCode, dateKey, pColor, pBg, pBorder,
  ARCHIVE_COMPLETED,
} from './ScheduleBoard';

/* Reuses the Work Order Channel's card-open/create behavior (CardModal) and
 * the Schedule Channel's own data (schedule-data.json + merge logic) instead
 * of introducing a parallel scheduling system. */

const CHEQUE_STATUS_OPTIONS = ['PDC', 'CDC'];
const SCHEDULE_TYPE_OPTIONS: NonNullable<WorkOrderCard['scheduleType']>[] = ['Delivery', 'Installation', 'Delivery & Installation'];

function paymentPercentOf(card: WorkOrderCard): number {
  const raw = card.paymentStatusText;
  if (raw) {
    const m = raw.match(/-?\d+(\.\d+)?/);
    if (m) return Math.max(0, Math.min(100, parseFloat(m[0])));
  }
  return card.paymentPercent ?? 0;
}

function paymentDisplay(card: WorkOrderCard): string {
  return card.paymentStatusText && card.paymentStatusText.trim() ? card.paymentStatusText : `${card.paymentPercent ?? 0}%`;
}

type Props = {
  userName: string;
  userDepartment?: string;
  userRole: 'admin' | 'user';
  onChannelSwitch?: (ch: ChannelType) => void;
  accessibleChannels?: ChannelType[];
  onCreateInChannel: (channel: ChannelType, card: WorkOrderCard) => Promise<WorkOrderCard>;
  onAdminSettings?: () => void;
};

function tanksCount(card: WorkOrderCard): number {
  return card.tankDetails && card.tankDetails.length > 0 ? card.tankDetails.length : 1;
}

function scheduleTypeBadge(type?: WorkOrderCard['scheduleType']) {
  const label = type || 'Delivery';
  const cls = label === 'Installation'
    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : label === 'Delivery & Installation'
      ? 'bg-violet-50 text-violet-700 border-violet-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

export default function AccountsTechnicalBoard({
  userName, userDepartment, userRole, onChannelSwitch, accessibleChannels = [], onCreateInChannel, onAdminSettings,
}: Props) {
  const [referenceDate] = useState<string>(dateKey());
  const [workOrderCards, setWorkOrderCards] = useState<WorkOrderCard[]>([]);
  const [store, setStore] = useState<ScStore>(EMPTY_STORE);
  const [hiddenPayments, setHiddenPayments] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<{ card: WorkOrderCard; isNew: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<'schedule' | 'payment' | null>(null);
  const [woSearch, setWoSearch] = useState('');
  const [showChDrop, setShowChDrop] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [userDeptMap, setUserDeptMap] = useState<Record<string, string>>({});
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [paymentRange, setPaymentRange] = useState<[number, number]>([0, 100]);
  const [showScheduleFilter, setShowScheduleFilter] = useState(false);
  const [showPaymentFilter, setShowPaymentFilter] = useState(false);
  const chDropRef = useRef<HTMLDivElement>(null);

  const canEdit = userRole === 'admin' || userDepartment === 'Accounts & Technical' || userDepartment === 'Delivery & Installation';

  useEffect(() => {
    getAppData().then(data => {
      const map: Record<string, string> = {};
      data.users.forEach(u => { if (u.depName) map[u.username] = u.depName; });
      setUserDeptMap(map);
    }).catch(() => {});
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [wo, scheduleRes] = await Promise.all([fetchCards('Work Order'), fetch('/api/schedule/data')]);
      const body = await scheduleRes.json().catch(() => ({}));
      const raw = (body?.store ?? {}) as Record<string, unknown>;
      const hiddenRaw = raw['accounts-payments-hidden'];
      const hidden = new Set<string>(Array.isArray(hiddenRaw) ? hiddenRaw.map(String) : []);
      const merged = mergeScheduleWithWorkOrder(normalizeStore(raw), wo, referenceDate);
      setWorkOrderCards(wo);
      setStore(merged);
      setHiddenPayments(hidden);
    } catch {
      // keep previous state on transient failures
    } finally {
      setLoaded(true);
    }
  }, [referenceDate]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    const timer = setInterval(() => { void loadAll(); }, 4000);
    return () => clearInterval(timer);
  }, [loadAll]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (chDropRef.current && !chDropRef.current.contains(e.target as Node)) setShowChDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /** Work orders currently represented in the Schedule Channel — the same
   * single source of truth used by ScheduleBoard's own merge logic. */
  const scheduleRelevantIds = useMemo(() => {
    const ids = new Set<string>();
    Object.entries(store).forEach(([listId, cards]) => {
      if (listId === ARCHIVE_COMPLETED) return;
      cards.forEach(c => { if (c.sourceCardId) ids.add(String(c.sourceCardId)); });
    });
    return ids;
  }, [store]);

  const relevantWoCards = useMemo(
    () => workOrderCards.filter(c => scheduleRelevantIds.has(String(c.id))),
    [workOrderCards, scheduleRelevantIds]
  );

  const scCardsForWo = useCallback((id: string): ScCard[] => {
    const out: ScCard[] = [];
    Object.entries(store).forEach(([listId, cards]) => {
      if (listId === ARCHIVE_COMPLETED) return;
      cards.forEach(c => { if (String(c.sourceCardId) === String(id)) out.push(c); });
    });
    return out;
  }, [store]);

  const scheduleStatusFor = useCallback((card: WorkOrderCard): string => {
    const cards = scCardsForWo(card.id);
    if (cards.length === 0) return 'Not scheduled';
    const labels = Array.from(new Set(cards.map(sc => getScheduleStage(sc, sc.listId))));
    return labels.join(' & ');
  }, [scCardsForWo]);

  const pendingInfoFor = useCallback((id: string, phase: SchedulePhase): { date: string; remarks: string } => {
    const listId = phase === 'delivery' ? 'pending-delivery' : 'pending-installation';
    const cards = (store[listId] ?? []).filter(c => String(c.sourceCardId) === String(id));
    if (cards.length === 0) return { date: '', remarks: '' };
    const c = cards[0];
    const tank = (c.tanks ?? [])[0];
    const date = tank?.scheduledDate || c.confirmedDate || '';
    const remarks = c.sectionRemarks || tank?.remarks || '';
    return { date, remarks };
  }, [store]);

  const woQuery = woSearch.trim().toLowerCase();
  const departmentOf = useCallback((card: WorkOrderCard): string => (card.assignedTo && userDeptMap[card.assignedTo]) || '', [userDeptMap]);

  const matchesSearch = useCallback((c: WorkOrderCard) => {
    if (!woQuery) return true;
    const del = pendingInfoFor(c.id, 'delivery');
    const inst = pendingInfoFor(c.id, 'installation');
    const brand = c.workOrderDetails?.brand?.includes('COLEX') ? 'COLEX' : c.workOrderDetails?.brand?.includes('PIPECO') ? 'PIPECO' : '';
    const haystack = [
      normalizeWoCode(c.workOrderNumber), paymentDisplay(c), c.customerName, c.customerCompanyName,
      brand, c.projectLocation, c.scheduleType, scheduleStatusFor(c), c.chequeStatus,
      del.date, del.remarks, inst.date, inst.remarks, c.salesPerson, c.accountsRemarks,
      c.assignedTo, departmentOf(c), String(tanksCount(c)),
    ];
    return haystack.some(v => (v ?? '').toString().toLowerCase().includes(woQuery));
  }, [woQuery, pendingInfoFor, scheduleStatusFor, departmentOf]);

  const scheduleStatusOptions = useMemo(
    () => Array.from(new Set(relevantWoCards.map(c => scheduleStatusFor(c)))).sort(),
    [relevantWoCards, scheduleStatusFor]
  );

  const matchesScheduleFilters = useCallback((c: WorkOrderCard) => {
    if (typeFilter.size > 0 && !typeFilter.has(c.scheduleType || 'Delivery')) return false;
    if (statusFilter.size > 0 && !statusFilter.has(scheduleStatusFor(c))) return false;
    return true;
  }, [typeFilter, statusFilter, scheduleStatusFor]);

  const matchesPaymentRange = useCallback((c: WorkOrderCard) => {
    const p = paymentPercentOf(c);
    return p >= paymentRange[0] && p <= paymentRange[1];
  }, [paymentRange]);

  const scheduleRows = useMemo(
    () => relevantWoCards.filter(matchesSearch).filter(matchesScheduleFilters)
      .sort((a, b) => normalizeWoCode(a.workOrderNumber).localeCompare(normalizeWoCode(b.workOrderNumber))),
    [relevantWoCards, matchesSearch, matchesScheduleFilters]
  );

  const paymentRows = useMemo(
    () => relevantWoCards.filter(matchesSearch).filter(matchesPaymentRange).filter(c => !hiddenPayments.has(String(c.id)))
      .sort((a, b) => normalizeWoCode(a.workOrderNumber).localeCompare(normalizeWoCode(b.workOrderNumber))),
    [relevantWoCards, matchesSearch, matchesPaymentRange, hiddenPayments]
  );

  const clearScheduleFilters = () => { setTypeFilter(new Set()); setStatusFilter(new Set()); };
  const clearPaymentRange = () => setPaymentRange([0, 100]);

  const persistHiddenPayments = useCallback(async (next: Set<string>) => {
    setHiddenPayments(next);
    try {
      await fetch('/api/schedule/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: { 'accounts-payments-hidden': Array.from(next) as unknown as ScCard[] } }),
      });
    } catch {
      // keep UI responsive even if persistence fails temporarily
    }
  }, []);

  /** Removes every Schedule Channel entry for this Work Order (all lists,
   * including archive) and stops the periodic Work Order → Schedule merge
   * from recreating it, so it fully disappears from Schedule Channel. */
  const deleteScheduleForCard = useCallback(async (card: WorkOrderCard) => {
    if (!window.confirm(`Remove WO ${normalizeWoCode(card.workOrderNumber)} from the Schedule Channel entirely?`)) return;
    try {
      const res = await fetch('/api/schedule/data');
      const body = await res.json().catch(() => ({}));
      const raw = (body?.store ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      Object.entries(raw).forEach(([key, arr]) => {
        if (Array.isArray(arr)) {
          next[key] = arr.filter((c: Record<string, unknown>) => String(c.sourceCardId ?? c.id) !== String(card.id));
        }
      });
      await fetch('/api/schedule/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: next }),
      });
      const uid = localStorage.getItem('userId');
      const updated: WorkOrderCard = { ...card, list: 'Payments', scheduleType: undefined, scheduleStage: undefined, updatedAt: new Date().toISOString() };
      await updateCard(updated, uid ? Number(uid) : undefined);
    } catch (err) {
      alert(`Failed to remove from schedule: ${(err as Error).message}`);
    } finally {
      void loadAll();
    }
  }, [loadAll]);

  const deletePaymentForCard = useCallback((card: WorkOrderCard) => {
    if (!window.confirm(`Remove WO ${normalizeWoCode(card.workOrderNumber)} from the Payment list and its export?`)) return;
    const next = new Set(hiddenPayments);
    next.add(String(card.id));
    void persistHiddenPayments(next);
  }, [hiddenPayments, persistHiddenPayments]);

  const saveCardField = useCallback(async (card: WorkOrderCard, patch: Partial<WorkOrderCard>) => {
    const updated: WorkOrderCard = { ...card, ...patch, updatedAt: new Date().toISOString() };
    setWorkOrderCards(prev => prev.map(c => c.id === updated.id ? updated : c));
    try {
      const uid = localStorage.getItem('userId');
      await updateCard(updated, uid ? Number(uid) : undefined);
    } catch {
      // optimistic update stays; next poll reconciles with server state
    }
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const payload = await generateAccountsPaymentReport(referenceDate);
      const missing = payload.reports?.missing_templates;
      alert(missing ? `Export failed: missing template ${missing}` : `Payment report exported for ${payload.date}`);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
    } finally {
      setIsExporting(false);
    }
  }, [referenceDate]);

  /* ─── Add Card (reuses the Work Order Channel's pre-create requirements) ─ */
  const [preCreate, setPreCreate] = useState<{
    woNumber: string; companyCode: string; scheduleType: 'Delivery' | 'Installation' | 'Delivery & Installation';
    poFile: File | null; qtnFile: File | null;
  } | null>(null);

  const openAddCard = () => {
    setPreCreate({ woNumber: '', companyCode: 'GRP', scheduleType: 'Delivery', poFile: null, qtnFile: null });
    setAddOpen(true);
  };

  const confirmAddCard = async () => {
    if (!preCreate || !preCreate.poFile || !/^\d{4}$/.test(preCreate.woNumber)) return;
    const now = new Date().toISOString();
    const scheduleStage = preCreate.scheduleType === 'Installation' ? 'Pending installation' : 'Pending delivery';
    const newCard: WorkOrderCard = {
      id: Date.now().toString(),
      quoteNumber: '',
      workOrderNumber: preCreate.woNumber.trim(),
      customerName: '', customerCompanyName: '',
      date: now.split('T')[0],
      salesPerson: '', subject: '', projectLocation: '',
      list: 'Schedule' as ListType,
      scheduleType: preCreate.scheduleType,
      scheduleStage: scheduleStage as WorkOrderCard['scheduleStage'],
      channel: 'Work Order',
      companyCode: preCreate.companyCode || 'GRP',
      remarks: [],
      listHistory: [{ list: 'Schedule' as ListType, enteredAt: now }],
      assignedTo: userRole !== 'admin' ? userName : undefined,
      userWorkStatus: userRole !== 'admin' ? 'Assigned' : undefined,
      assignmentHistory: userRole !== 'admin' ? [{ assignedTo: userName, assignedAt: now, assignedBy: userName }] : [],
      createdAt: now, updatedAt: now,
    };

    let created: WorkOrderCard;
    try {
      created = await onCreateInChannel('Work Order', newCard);
    } catch (err) {
      alert(`Work Order creation failed: ${(err as Error).message}`);
      return;
    }

    const uidRaw = localStorage.getItem('userId');
    const performedBy = uidRaw ? Number(uidRaw) : undefined;
    let poDocName: string | undefined; let poDocUrl: string | undefined;
    let qtnDocName: string | undefined; let qtnDocUrl: string | undefined;
    try {
      const res = await uploadDocument(created.id, 'po', preCreate.poFile, performedBy);
      poDocName = res.fileName; poDocUrl = res.url;
    } catch (err) {
      alert(`PO doc upload failed: ${(err as Error).message}`);
    }
    if (preCreate.qtnFile) {
      try {
        const res = await uploadDocument(created.id, 'qtn', preCreate.qtnFile, performedBy);
        qtnDocName = res.fileName; qtnDocUrl = res.url;
      } catch { /* optional — non-fatal */ }
    }

    const withDocs: WorkOrderCard = { ...created, purchaseOrderDocName: poDocName, purchaseOrderDocUrl: poDocUrl, quotationDocName: qtnDocName, quotationDocUrl: qtnDocUrl };
    setWorkOrderCards(prev => [...prev, withDocs]);
    setAddOpen(false);
    setPreCreate(null);
    setSelected({ card: withDocs, isNew: true });
    void loadAll();
  };

  const renderScheduleTable = (rows: WorkOrderCard[], fullscreen: boolean) => (
    <table className="min-w-full text-xs text-left">
      <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-gray-500 uppercase text-[10px] tracking-wide">
        <tr>
          <th className={`px-2.5 py-2 font-semibold whitespace-nowrap ${fullscreen ? 'sticky left-0 z-20 bg-gray-50 shadow-[2px_0_4px_rgba(0,0,0,0.06)]' : ''}`}>WO No</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Payment</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Type</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Schedule Status</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Customer</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Brand</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Location</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Tanks/Materials</th>
          {fullscreen && <th className="px-2.5 py-2 font-semibold whitespace-nowrap">User</th>}
          {fullscreen && <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Department</th>}
          {fullscreen && canEdit && <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-300 italic">No work orders</td></tr>
        )}
        {rows.map(card => (
          <tr key={card.id} className="border-b border-gray-100 odd:bg-white even:bg-gray-50/50 hover:bg-purple-50/40 cursor-pointer"
            onClick={() => setSelected({ card, isNew: false })}>
            <td className={`px-2.5 py-2 font-bold text-slate-800 whitespace-nowrap ${fullscreen ? 'sticky left-0 z-10 bg-inherit shadow-[2px_0_4px_rgba(0,0,0,0.06)]' : ''}`}>
              #{normalizeWoCode(card.workOrderNumber)}
            </td>
            <td className="px-2.5 py-2 whitespace-nowrap">
              <span className="inline-flex items-center justify-center font-bold text-[10px] px-1.5 py-0.5 rounded-md"
                style={{ color: pColor(paymentPercentOf(card)), backgroundColor: pBg(paymentPercentOf(card)), border: `1px solid ${pBorder(paymentPercentOf(card))}` }}>
                {paymentDisplay(card)}
              </span>
            </td>
            <td className="px-2.5 py-2 whitespace-nowrap">{scheduleTypeBadge(card.scheduleType)}</td>
            <td className="px-2.5 py-2 text-indigo-700 font-medium whitespace-nowrap">{scheduleStatusFor(card)}</td>
            <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.customerCompanyName || card.customerName || '-'}</td>
            <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.workOrderDetails?.brand?.includes('COLEX') ? 'COLEX' : card.workOrderDetails?.brand?.includes('PIPECO') ? 'PIPECO' : '-'}</td>
            <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.projectLocation || '-'}</td>
            <td className="px-2.5 py-2 text-center font-semibold text-gray-700">{tanksCount(card)}</td>
            {fullscreen && <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.assignedTo || '-'}</td>}
            {fullscreen && <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{departmentOf(card) || '-'}</td>}
            {fullscreen && canEdit && (
              <td className="px-2.5 py-2 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                <button title="Remove from Schedule Channel" onClick={() => void deleteScheduleForCard(card)}
                  className="p-1 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderPaymentTable = (rows: WorkOrderCard[], fullscreen: boolean) => (
    <table className="min-w-full text-xs text-left">
      <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-gray-500 uppercase text-[10px] tracking-wide">
        <tr>
          <th className={`px-2.5 py-2 font-semibold whitespace-nowrap ${fullscreen ? 'sticky left-0 z-20 bg-gray-50 shadow-[2px_0_4px_rgba(0,0,0,0.06)]' : ''}`}>WO No</th>
          {!fullscreen && <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Payment</th>}
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Customer</th>
          {!fullscreen && <><th className="px-2.5 py-2 font-semibold whitespace-nowrap">Brand</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Location</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Tanks/Materials</th>
          <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Cheque Status</th></>}
          {fullscreen && <>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Del. Date</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Del. Remarks</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Insta.</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Insta. Remarks</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Pay. Status</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Cheque Status</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Sales Person</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Remarks</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">User</th>
            <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Department</th>
          </>}
          {canEdit && <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={12} className="px-3 py-6 text-center text-gray-300 italic">No work orders</td></tr>
        )}
        {rows.map(card => {
          const del = pendingInfoFor(card.id, 'delivery');
          const inst = pendingInfoFor(card.id, 'installation');
          return (
            <tr key={card.id} className="border-b border-gray-100 odd:bg-white even:bg-gray-50/50 hover:bg-teal-50/40">
              <td className={`px-2.5 py-2 font-bold text-slate-800 whitespace-nowrap cursor-pointer ${fullscreen ? 'sticky left-0 z-10 bg-inherit shadow-[2px_0_4px_rgba(0,0,0,0.06)]' : ''}`}
                onClick={() => setSelected({ card, isNew: false })}>
                #{normalizeWoCode(card.workOrderNumber)}
              </td>
              {!fullscreen && (
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center font-bold text-[10px] px-1.5 py-0.5 rounded-md"
                    style={{ color: pColor(paymentPercentOf(card)), backgroundColor: pBg(paymentPercentOf(card)), border: `1px solid ${pBorder(paymentPercentOf(card))}` }}>
                    {paymentDisplay(card)}
                  </span>
                </td>
              )}
              <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap cursor-pointer" onClick={() => setSelected({ card, isNew: false })}>
                {card.customerCompanyName || card.customerName || '-'}
              </td>
              {!fullscreen && (
                <>
                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.workOrderDetails?.brand?.includes('COLEX') ? 'COLEX' : card.workOrderDetails?.brand?.includes('PIPECO') ? 'PIPECO' : '-'}</td>
                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.projectLocation || '-'}</td>
                  <td className="px-2.5 py-2 text-center font-semibold text-gray-700">{tanksCount(card)}</td>
                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.chequeStatus || 'NULL'}</td>
                </>
              )}
              {fullscreen && (
                <>
                  <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{del.date || '-'}</td>
                  <td className="px-2.5 py-2 text-gray-700 max-w-[180px] whitespace-normal break-words">{del.remarks || '-'}</td>
                  <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{inst.date || '-'}</td>
                  <td className="px-2.5 py-2 text-gray-700 max-w-[180px] whitespace-normal break-words">{inst.remarks || '-'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <input type="text" defaultValue={card.paymentStatusText ?? `${card.paymentPercent ?? 0}%`}
                      disabled={!canEdit}
                      onBlur={e => void saveCardField(card, { paymentStatusText: e.target.value, paymentPercent: (() => { const m = e.target.value.match(/-?\d+(\.\d+)?/); return m ? Math.max(0, Math.min(100, Math.round(parseFloat(m[0])))) : card.paymentPercent; })() })}
                      placeholder="e.g. 50% or Partially Paid"
                      className="w-28 px-1.5 py-0.5 border border-gray-200 rounded-md text-[11px] font-semibold disabled:bg-transparent"
                      style={{ color: pColor(paymentPercentOf(card)) }} />
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <select disabled={!canEdit} value={card.chequeStatus || ''}
                      onChange={e => void saveCardField(card, { chequeStatus: e.target.value || undefined })}
                      className="px-1.5 py-0.5 border border-gray-200 rounded-md text-[11px] disabled:bg-transparent">
                      <option value="">NULL</option>
                      {CHEQUE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.salesPerson || '-'}</td>
                  <td className="px-2.5 py-2 text-gray-700 max-w-[220px]">
                    <textarea defaultValue={card.accountsRemarks || ''} disabled={!canEdit} rows={2}
                      onBlur={e => void saveCardField(card, { accountsRemarks: e.target.value })}
                      placeholder="Remarks"
                      className="w-52 px-1 py-0.5 border border-gray-200 rounded text-[11px] whitespace-normal break-normal resize-y disabled:bg-transparent disabled:border-transparent" />
                  </td>
                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{card.assignedTo || '-'}</td>
                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">{departmentOf(card) || '-'}</td>
                </>
              )}
              {canEdit && (
                <td className="px-2.5 py-2 text-center whitespace-nowrap">
                  <button title="Remove from Payment list" onClick={() => deletePaymentForCard(card)}
                    className="p-1 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Accounts &amp; Technical</h1>
          <p className="text-xs text-gray-400 mt-0.5">{relevantWoCards.length} linked work order{relevantWoCards.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={woSearch} onChange={e => setWoSearch(e.target.value)} placeholder="Search WO / Customer"
              className="w-56 pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          {canEdit && (
            <button onClick={openAddCard}
              className="flex items-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700">
              <Plus className="w-4 h-4" /> Add Card
            </button>
          )}
          <button onClick={() => { void handleExport(); }} disabled={isExporting}
            className={`px-3 py-2 rounded-lg text-sm font-semibold border ${isExporting ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'}`}>
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          {userRole === 'admin' && onAdminSettings && (
            <button onClick={onAdminSettings} title="Admin Settings"
              className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              <Settings className="w-4 h-4" />
            </button>
          )}
          {userRole === 'admin' && (
          <div className="relative" ref={chDropRef}>
            <button onClick={() => setShowChDrop(p => !p)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 shadow-sm transition-colors">
              <CalendarRange className="w-4 h-4 text-purple-200" />
              <span>Accounts &amp; Technical</span>
              <ChevronDown className="w-4 h-4 opacity-70" />
            </button>
            {showChDrop && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                {(['Quotation', 'Work Order', 'Schedule', 'Accounts & Technical'] as ChannelType[]).map(ch => {
                  const ok = ch === 'Schedule' || ch === 'Accounts & Technical' || accessibleChannels.includes(ch);
                  return (
                    <button key={ch} disabled={!ok}
                      onClick={() => { if (ok && onChannelSwitch) { onChannelSwitch(ch); setShowChDrop(false); } }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50 ${!ok ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ch === 'Quotation' ? 'bg-blue-100' : ch === 'Work Order' ? 'bg-orange-100' : ch === 'Schedule' ? 'bg-purple-100' : 'bg-teal-100'}`}>
                        {ch === 'Quotation' ? <FileText className="w-4 h-4 text-blue-600" /> : ch === 'Work Order' ? <ClipboardList className="w-4 h-4 text-orange-500" /> : ch === 'Schedule' ? <CalendarRange className="w-4 h-4 text-purple-600" /> : <DollarSign className="w-4 h-4 text-teal-600" />}
                      </span>
                      <span className={`flex-1 text-left font-medium ${ch === 'Accounts & Technical' ? 'text-gray-900' : 'text-gray-700'}`}>{ch}</span>
                      {ch === 'Accounts & Technical' && <Check className="w-4 h-4 text-green-500 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 p-4 overflow-hidden">
        <div className="flex flex-col min-h-0 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-amber-50/60">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-700">
              <Truck className="w-4 h-4" /> Schedule
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[10px] font-bold bg-white/80">{scheduleRows.length}</span>
            </span>
            <div className="flex items-center gap-1.5 relative">
              <button onClick={() => setShowScheduleFilter(p => !p)}
                className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${typeFilter.size || statusFilter.size ? 'bg-amber-600 text-white border-amber-600' : 'bg-white/80 border-white/60 text-gray-500 hover:text-amber-700'}`}>
                Filter{typeFilter.size + statusFilter.size > 0 ? ` (${typeFilter.size + statusFilter.size})` : ''}
              </button>
              {showScheduleFilter && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-3 text-xs" onClick={e => e.stopPropagation()}>
                  <div className="mb-2">
                    <div className="font-bold text-gray-600 mb-1">Type</div>
                    {SCHEDULE_TYPE_OPTIONS.map(t => (
                      <label key={t} className="flex items-center gap-2 py-0.5 cursor-pointer">
                        <input type="checkbox" checked={typeFilter.has(t)} onChange={() => setTypeFilter(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; })} />
                        {t}
                      </label>
                    ))}
                  </div>
                  <div className="mb-2 max-h-40 overflow-y-auto">
                    <div className="font-bold text-gray-600 mb-1">Schedule Status</div>
                    {scheduleStatusOptions.map(s => (
                      <label key={s} className="flex items-center gap-2 py-0.5 cursor-pointer">
                        <input type="checkbox" checked={statusFilter.has(s)} onChange={() => setStatusFilter(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; })} />
                        {s}
                      </label>
                    ))}
                  </div>
                  <button onClick={clearScheduleFilters} className="text-teal-600 font-semibold hover:underline">Clear filters</button>
                </div>
              )}
              <button onClick={() => setExpanded('schedule')} title="Expand to fullscreen"
                className="p-1 rounded-md bg-white/80 border border-white/60 text-gray-400 hover:text-purple-600 hover:border-purple-300">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-hide">
            {renderScheduleTable(scheduleRows, false)}
          </div>
        </div>

        <div className="flex flex-col min-h-0 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-teal-50/60">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-teal-700">
              <DollarSign className="w-4 h-4" /> Payment
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[10px] font-bold bg-white/80">{paymentRows.length}</span>
            </span>
            <div className="flex items-center gap-1.5 relative">
              <button onClick={() => setShowPaymentFilter(p => !p)}
                className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${paymentRange[0] > 0 || paymentRange[1] < 100 ? 'bg-teal-600 text-white border-teal-600' : 'bg-white/80 border-white/60 text-gray-500 hover:text-teal-700'}`}>
                {paymentRange[0]}%–{paymentRange[1]}%
              </button>
              {showPaymentFilter && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-3 text-xs" onClick={e => e.stopPropagation()}>
                  <div className="font-bold text-gray-600 mb-2">Payment Range: {paymentRange[0]}% – {paymentRange[1]}%</div>
                  <div className="flex flex-col gap-2 mb-2">
                    <label className="flex items-center gap-2">
                      Min
                      <input type="range" min={0} max={100} step={5} value={paymentRange[0]}
                        onChange={e => setPaymentRange(([, max]) => [Math.min(Number(e.target.value), max), max])}
                        className="flex-1" />
                    </label>
                    <label className="flex items-center gap-2">
                      Max
                      <input type="range" min={0} max={100} step={5} value={paymentRange[1]}
                        onChange={e => setPaymentRange(([min]) => [min, Math.max(Number(e.target.value), min)])}
                        className="flex-1" />
                    </label>
                  </div>
                  <button onClick={clearPaymentRange} className="text-teal-600 font-semibold hover:underline">Clear range</button>
                </div>
              )}
              <button onClick={() => setExpanded('payment')} title="Expand to fullscreen"
                className="p-1 rounded-md bg-white/80 border border-white/60 text-gray-400 hover:text-purple-600 hover:border-purple-300">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-hide">
            {renderPaymentTable(paymentRows, false)}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setExpanded(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full h-full max-w-none flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between px-5 py-3 text-white flex-shrink-0 ${expanded === 'schedule' ? 'bg-gradient-to-r from-amber-600 to-amber-500' : 'bg-gradient-to-r from-teal-600 to-teal-500'}`}>
              <h2 className="text-base font-bold">{expanded === 'schedule' ? 'Schedule' : 'Payment'}</h2>
              <button onClick={() => setExpanded(null)} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto scrollbar-hide">
              {expanded === 'schedule' ? renderScheduleTable(scheduleRows, true) : renderPaymentTable(paymentRows, true)}
            </div>
          </div>
        </div>
      )}

      {addOpen && preCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Add Work Order</h2>
              <button onClick={() => { setAddOpen(false); setPreCreate(null); }} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="px-6 py-4 flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WO Number <span className="text-red-500">*</span> (4 digits)</label>
                <input maxLength={4} value={preCreate.woNumber}
                  onChange={e => setPreCreate(p => p && ({ ...p, woNumber: e.target.value.replace(/\D/g, '') }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Type</label>
                <select value={preCreate.scheduleType}
                  onChange={e => setPreCreate(p => p && ({ ...p, scheduleType: e.target.value as typeof p.scheduleType }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="Delivery">Delivery</option>
                  <option value="Installation">Installation</option>
                  <option value="Delivery & Installation">Delivery &amp; Installation</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PO Document <span className="text-red-500">*</span></label>
                <input type="file" onChange={e => setPreCreate(p => p && ({ ...p, poFile: e.target.files?.[0] ?? null }))}
                  className="w-full text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Document (optional)</label>
                <input type="file" onChange={e => setPreCreate(p => p && ({ ...p, qtnFile: e.target.files?.[0] ?? null }))}
                  className="w-full text-sm" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button onClick={() => { setAddOpen(false); setPreCreate(null); }} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => void confirmAddCard()} disabled={!preCreate.poFile || !/^\d{4}$/.test(preCreate.woNumber)}
                className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed">
                Create &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <CardModal
          card={selected.card}
          isNew={selected.isNew}
          onClose={() => setSelected(null)}
          onUpdate={(updated) => {
            setWorkOrderCards(prev => prev.map(c => c.id === updated.id ? updated : c));
            setSelected({ card: updated, isNew: false });
            const uid = localStorage.getItem('userId');
            void updateCard(updated, uid ? Number(uid) : undefined).then(() => void loadAll());
          }}
          onDelete={() => {
            setSelected(null);
            void loadAll();
          }}
          userRole={userRole}
          userName={userName}
          userDepartment={userDepartment as never}
          channel="Work Order"
        />
      )}
    </div>
  );
}
