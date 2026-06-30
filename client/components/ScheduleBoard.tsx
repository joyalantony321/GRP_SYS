import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  format, addDays, parseISO, isToday, isSunday,
  differenceInCalendarDays, startOfDay, isBefore,
} from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  X, Plus, ChevronLeft, ChevronRight, Truck, Wrench, Users,
  CheckCircle, MessageSquare, AlertTriangle, Zap, CalendarRange,
  ChevronDown, Check, FileText, ClipboardList, Search,
  TrendingUp, Clock, ArrowUp,
} from 'lucide-react';
import { Card as WorkOrderCard, ChannelType, ScheduleStage } from '@/types';
import { fetchCards, updateCard } from '@/lib/api';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ScRemarkMedia {
  id: string;
  kind: 'image' | 'video';
  name: string;
  dataUrl: string;
}

interface ScRemark {
  id: string;
  text: string;
  author: string;
  at: string;
  media?: ScRemarkMedia[];
}

interface ScDelayPeriod {
  startDate: string;
  endDate?: string;
}

export interface ScCard {
  id: string; woCode: string; listId: string; workers: string[];
  sourceCardId?: string;
  scheduleType?: 'Delivery' | 'Installation';
  isEmergency: boolean; paymentPercent: number; isConfirmed: boolean;
  confirmedDate?: string; remarks: ScRemark[]; createdAt: string;
  brand?: string; productType?: string;
  customer?: string; location?: string; tankSize?: string;
  contactPerson?: string; phone?: string; salesPerson?: string;
  installationStatus?: string;
  completedDate?: string;
  delayPeriods?: ScDelayPeriod[];
  returnedFromDate?: string;
}
type ScStore = Record<string, ScCard[]>;

const EMPTY_STORE: ScStore = {
  'pending-delivery': [],
  'pending-installation': [],
};

const GANTT_VISIBLE_DAYS = 9;
const GANTT_TOTAL_DAYS = 16;
const GANTT_MIN_DAY_WIDTH = 36;
const GANTT_MAX_DAY_WIDTH = 160;
const BRAND_OPTIONS = ['COLEX', 'PIPPECO'] as const;

const normalizeBrand = (brand?: string): string | undefined => {
  if (!brand) return undefined;
  const upper = brand.toUpperCase();
  if (upper.includes('COLEX')) return 'COLEX';
  if (upper.includes('PIPECO') || upper.includes('PIPPECO')) return 'PIPPECO';
  return brand;
};

const deriveProductType = (card: WorkOrderCard): string | undefined => {
  const details = card.workOrderDetails;
  if (!details) return card.subject || undefined;
  if (details.typeInsulated && details.typeNonInsulated) return 'Insulated / Non-Insulated';
  if (details.typeInsulated) return 'Insulated';
  if (details.typeNonInsulated) return 'Non-Insulated';
  return card.subject || details.jobDescription || undefined;
};

const dateKey = (date = new Date()) => format(date, 'yyyy-MM-dd');

const isCardDelayedOnDate = (card: ScCard, day: string) => {
  const target = startOfDay(parseISO(day)).getTime();
  return (card.delayPeriods ?? []).some(period => {
    const start = startOfDay(parseISO(period.startDate)).getTime();
    const end = period.endDate
      ? startOfDay(parseISO(period.endDate)).getTime()
      : Number.POSITIVE_INFINITY;
    return target >= start && target <= end;
  });
};

const isCardCurrentlyDelayed = (card: ScCard) => Boolean((card.delayPeriods ?? []).some(period => !period.endDate));

const flattenCards = (store: ScStore): ScCard[] => Object.values(store).flat();

const getScheduleStage = (card: ScCard, listId: string): ScheduleStage => {
  if (listId === 'pending-delivery') return 'Pending delivery';
  if (listId === 'pending-installation') return 'Pending installation';

  const dayLabel = listId.replace(/^(delivery|installation)-/, '');
  const isDelivery = listId.startsWith('delivery-') || (card.scheduleType ?? 'Delivery') === 'Delivery';
  const isInstallation = listId.startsWith('installation-') || (card.scheduleType ?? 'Delivery') === 'Installation';

  if (isDelivery) {
    return card.isConfirmed ? 'Delivery completed' : 'Delivery scheduled';
  }

  if (isInstallation) {
    if (card.completedDate) return 'Installation completed';
    if (!card.isConfirmed) return 'Installation scheduled';
    return card.confirmedDate && card.confirmedDate === dayLabel ? 'Installation started' : 'Installation in progress';
  }

  return card.scheduleType === 'Installation' ? 'Pending installation' : 'Pending delivery';
};

const sortScheduleGroup = (cards: ScCard[]) => {
  const entryTime = (card: ScCard) => Date.parse(card.returnedFromDate || card.confirmedDate || card.createdAt || '') || 0;
  return [...cards].sort((left, right) => {
    if (left.isEmergency !== right.isEmergency) return left.isEmergency ? -1 : 1;
    const timeDiff = entryTime(left) - entryTime(right);
    if (timeDiff !== 0) return timeDiff;
    return left.woCode.localeCompare(right.woCode);
  });
};

const inferScheduleTypeFromWorkOrder = (card: WorkOrderCard): 'Delivery' | 'Installation' => {
  if (card.scheduleType === 'Installation' || card.list === 'Installation') return 'Installation';
  if (card.scheduleType === 'Delivery' || card.list === 'Delivery') return 'Delivery';
  const stage = (card.scheduleStage ?? '').toLowerCase();
  if (stage.includes('installation')) return 'Installation';
  return 'Delivery';
};

const hasExplicitScheduleMetadata = (card: WorkOrderCard): boolean => {
  if (card.scheduleType === 'Delivery' || card.scheduleType === 'Installation') return true;
  const stage = (card.scheduleStage ?? '').toLowerCase();
  return stage.includes('delivery') || stage.includes('installation');
};

const toScheduleCard = (card: WorkOrderCard): ScCard => {
  const scheduleType = inferScheduleTypeFromWorkOrder(card);
  const woCode = (card.workOrderNumber || card.quoteNumber || '').split('/').pop() || String(card.id);
  const details = card.workOrderDetails;
  return {
    id: `wo-${card.id}`,
    sourceCardId: card.id,
    woCode,
    scheduleType,
    listId: scheduleType === 'Installation' ? 'pending-installation' : 'pending-delivery',
    workers: [],
    isEmergency: false,
    paymentPercent: typeof card.paymentPercent === 'number' ? card.paymentPercent : 0,
    isConfirmed: false,
    remarks: [],
    createdAt: card.createdAt || new Date().toISOString(),
    customer: card.customerName || card.customerCompanyName || undefined,
    location: card.projectLocation || undefined,
    salesPerson: card.salesPerson || undefined,
    brand: normalizeBrand(details?.brand),
    productType: deriveProductType(card),
  };
};

const mergeScheduleWithWorkOrder = (store: ScStore, woCards: WorkOrderCard[]): ScStore => {
  const next: ScStore = JSON.parse(JSON.stringify(store));
  const flat = flattenCards(next);

  const relevant = woCards.filter(c => c.list === 'Schedule' || c.list === 'Delivery' || c.list === 'Installation');
  const relevantIds = new Set(relevant.map(c => String(c.id)));

  // Remove schedule cards that are linked to WO cards no longer in Delivery/Installation
  Object.keys(next).forEach(listId => {
    next[listId] = (next[listId] ?? []).filter(sc => !sc.sourceCardId || relevantIds.has(String(sc.sourceCardId)));
  });

  relevant.forEach(wo => {
    const existing = flat.find(sc => String(sc.sourceCardId) === String(wo.id));
    const explicitSchedule = hasExplicitScheduleMetadata(wo);
    const inferredType = inferScheduleTypeFromWorkOrder(wo);
    const targetPending = inferredType === 'Installation' ? 'pending-installation' : 'pending-delivery';
    if (existing) {
      // Keep current schedule placement, but refresh mirrored core fields
      existing.paymentPercent = typeof wo.paymentPercent === 'number' ? wo.paymentPercent : existing.paymentPercent;
      existing.customer = wo.customerName || wo.customerCompanyName || existing.customer;
      existing.location = wo.projectLocation || existing.location;
      existing.salesPerson = wo.salesPerson || existing.salesPerson;
      existing.brand = normalizeBrand(wo.workOrderDetails?.brand) || existing.brand;
      existing.productType = deriveProductType(wo) || existing.productType;
      if (explicitSchedule) {
        // Work Order has explicit type — enforce it
        existing.scheduleType = inferredType;
        if (existing.listId.startsWith('pending-') && existing.listId !== targetPending) {
          const fromList = existing.listId;
          next[fromList] = (next[fromList] ?? []).filter(sc => sc.id !== existing.id);
          const moved = { ...existing, scheduleType: inferredType, listId: targetPending };
          if (!next[targetPending]) next[targetPending] = [];
          next[targetPending] = [moved, ...next[targetPending]];
        }
      } else {
        // Work Order has no explicit type — preserve whatever type/list the Schedule card already has
        // (the user may have set it via the WO pending-choice dialog but the DB hasn't been polled yet)
      }
      return;
    }

    // For cards parked in Work Order->Schedule without an explicit schedule classification,
    // do not auto-create a Schedule channel shadow card.
    if (wo.list === 'Schedule' && !explicitSchedule) {
      return;
    }

    const fresh = toScheduleCard(wo);
    if (!next[fresh.listId]) next[fresh.listId] = [];
    next[fresh.listId] = [fresh, ...next[fresh.listId]];
  });

  return next;
};

const normalizeStore = (raw: unknown): ScStore => {
  const normalized: ScStore = {
    'pending-delivery': [],
    'pending-installation': [],
  };
  if (!raw || typeof raw !== 'object') return normalized;
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      normalized[key] = value as ScCard[];
    }
  });
  return normalized;
};

/* ─── Colour system ──────────────────────────────────────────────────────── */

/** 4-tier payment colour: red 0%, yellow 1-49%, blue 50-99%, green 100% */
const pColor = (p: number) => p === 0 ? '#ef4444' : p < 50 ? '#eab308' : p < 100 ? '#3b82f6' : '#22c55e';
const pBorder = (p: number) => p === 0 ? '#dc2626' : p < 50 ? '#ca8a04' : p < 100 ? '#2563eb' : '#16a34a';
const pBg    = (p: number) => p === 0 ? '#fef2f2' : p < 50 ? '#fefce8' : p < 100 ? '#eff6ff' : '#f0fdf4';

/** Dot rules:
 * - Delivery/Installation columns: green only when confirmed (started/delivered)
 * - Pending columns: red only when returned from schedule
 */
const dateDot = (card: ScCard) => (card.isConfirmed ? '#22c55e' : '');
const pendDot = (card: ScCard) => (card.returnedFromDate ? '#ef4444' : '');

/* ─── CardChip – used in BOTH date columns AND pending ───────────────────── */

function CardChip({
  card, listId, index, isPending, onOpen,
}: { card: ScCard; listId: string; index: number; isPending?: boolean; onOpen: () => void }) {
  const dot = isPending ? pendDot(card) : dateDot(card);
  const showDot = Boolean(dot);
  const chipBg = pBg(card.paymentPercent);
  const meta = [card.customer, card.location].filter(Boolean).join(' · ');
  const statusText = (listId.startsWith('installation-') || listId === 'pending-installation')
    ? card.installationStatus
    : undefined;
  const compact = !isPending;
  return (
    <Draggable draggableId={card.id} index={index}>
      {(prov, snap) => (
        <div
          ref={prov.innerRef}
          {...prov.draggableProps}
          {...prov.dragHandleProps}
          onClick={e => { e.stopPropagation(); onOpen(); }}
          className={`flex items-center rounded-md border cursor-grab select-none transition-all mb-0.5 min-w-0
            ${compact ? 'gap-1 px-1.5 py-0.5' : 'gap-1.5 px-2 py-1'}
            ${card.isEmergency ? 'ring-1 ring-red-300' : ''}
            ${snap.isDragging ? 'shadow-lg opacity-80' : 'hover:shadow-sm'}`}
          style={{
            ...(prov.draggableProps.style as React.CSSProperties),
            backgroundColor: chipBg,
            borderColor: card.isEmergency ? '#ef4444' : '#9ca3af',
          }}
        >
          {showDot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />}
          <span className={`${compact ? 'text-xs' : 'text-[13px]'} font-semibold text-gray-800 flex-shrink-0`}>{card.woCode}</span>
          {isPending && meta && <span className="text-[10px] text-gray-600 truncate min-w-0">{meta}</span>}
          {statusText && <span className="text-[10px] text-indigo-600 truncate min-w-0">{statusText}</span>}
          {card.isEmergency && <ArrowUp className="w-3 h-3 text-red-500 flex-shrink-0 ml-auto" />}
          {isPending && card.returnedFromDate && <span className="text-xs text-red-400 ml-auto">↩</span>}
        </div>
      )}
    </Draggable>
  );
}

/* ─── Add Card Modal ─────────────────────────────────────────────────────── */

function AddCardModal({ type, onClose, onAdd }: { type: 'delivery'|'installation'; onClose: ()=>void; onAdd: (c:ScCard)=>void }) {
  const [wo, setWo] = useState(''); const [customer, setCustomer] = useState('');
  const [brand, setBrand] = useState(''); const [productType, setProductType] = useState('');
  const [tankSize, setTankSize] = useState(''); const [location, setLocation] = useState('');
  const [contact, setContact] = useState(''); const [phone, setPhone] = useState('');
  const [sales, setSales] = useState(''); const [emergency, setEmergency] = useState(false);
  const [installationStatus, setInstallationStatus] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (!wo.trim()) { setErr('WO Number is required'); return; }
    if (!/^\d{4}$/.test(wo)) { setErr('Must be exactly 4 digits'); return; }
    onAdd({ id:`${type[0]}${Date.now()}`, woCode:wo, listId:`pending-${type}`, workers:[], isEmergency:emergency, paymentPercent:0, isConfirmed:false, remarks:[], createdAt:new Date().toISOString(), customer:customer||undefined, brand:brand||undefined, productType:productType||undefined, location:location||undefined, tankSize:tankSize||undefined, contactPerson:contact||undefined, phone:phone||undefined, salesPerson:sales||undefined, installationStatus:type==='installation' ? (installationStatus.trim() || undefined) : undefined });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {type==='delivery' ? <Truck className="w-5 h-5 text-amber-500"/> : <Wrench className="w-5 h-5 text-indigo-500"/>}
            <h2 className="text-base font-semibold text-gray-900">Add {type==='delivery'?'Delivery':'Installation'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500"/></button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">WO Number <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">(4 digits)</span></label>
            <input maxLength={4} value={wo} onChange={e=>{setWo(e.target.value.replace(/\D/g,''));setErr('');}} placeholder="e.g. 5487"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${err?'border-red-400':'border-gray-300'}`}/>
            {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
            <input value={customer} onChange={e=>setCustomer(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              <select value={brand} onChange={e=>setBrand(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white">
                <option value="">Select brand</option>
                {BRAND_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <input value={productType} onChange={e=>setProductType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Tank Size</label>
              <input value={tankSize} onChange={e=>setTankSize(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input value={location} onChange={e=>setLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
              <input value={contact} onChange={e=>setContact(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input value={phone} onChange={e=>setPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Sales Person</label>
            <input value={sales} onChange={e=>setSales(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          {type==='installation' && (
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Installation Current Status</label>
              <input value={installationStatus} onChange={e=>setInstallationStatus(e.target.value)} placeholder="Write current installation status"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/></div>
          )}
          <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${emergency?'border-red-200 bg-red-50':'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`w-4 h-4 ${emergency?'text-red-500':'text-gray-400'}`}/>
              <span className={`text-sm font-semibold ${emergency?'text-red-700':'text-gray-700'}`}>Emergency {emergency?'(ON)':'(OFF)'}</span>
            </div>
            <button onClick={()=>setEmergency(p=>!p)} className={`relative w-10 h-6 rounded-full transition-colors ${emergency?'bg-red-500':'bg-gray-300'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${emergency?'left-5':'left-1'}`}/>
            </button>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700">Add Card</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Workers Modal ──────────────────────────────────────────────────────── */

function WorkersModal({ destId, onConfirm, onCancel }: { destId:string; onConfirm:(w:string[])=>void; onCancel:()=>void }) {
  const [input, setInput] = useState(''); const [workers, setWorkers] = useState<string[]>([]);
  const addW = () => { if(input.trim()&&!workers.includes(input.trim())){setWorkers(p=>[...p,input.trim()]);setInput('');} };
  const dk = destId.replace(/^(delivery|installation)-/,''); const date = parseISO(dk);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3"><Users className="w-5 h-5 text-teal-600"/>
            <div><h2 className="text-base font-semibold text-gray-900">Assign Workers</h2>
              <p className="text-xs text-gray-500">{format(date,'EEEE, MMMM d, yyyy')}{isSunday(date)&&' ⚠ SUNDAY'}</p></div></div>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500"/></button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4">
          <p className="text-sm text-gray-500">Workers are optional.</p>
          <div className="flex gap-2">
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addW()} placeholder="Worker name"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"/>
            <button onClick={addW} className="px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"><Plus className="w-4 h-4"/></button>
          </div>
          {workers.length>0&&<div className="flex flex-wrap gap-2">{workers.map(w=>(
            <span key={w} className="flex items-center gap-1.5 px-3 py-1 bg-teal-50 border border-teal-200 rounded-full text-sm text-teal-700">
              {w}<button onClick={()=>setWorkers(p=>p.filter(x=>x!==w))} className="text-teal-400 hover:text-teal-700">×</button>
            </span>))}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={()=>onConfirm(workers)} className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700">Schedule →</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Card Detail Modal ──────────────────────────────────────────────────── */

function CardDetailModal({ card, listId, onClose, onSave }: { card:ScCard; listId:string; onClose:()=>void; onSave:(c:ScCard,lid:string)=>void }) {
  const [ec, setEc] = useState<ScCard>({...card, remarks:[...card.remarks]});
  const [remarkText, setRemarkText] = useState('');
  const [remarkAuthor, setRemarkAuthor] = useState('');
  const [remarkMedia, setRemarkMedia] = useState<ScRemarkMedia[]>([]);
  const [workerInput, setWorkerInput] = useState('');

  const isDateList = listId.startsWith('delivery-') || listId.startsWith('installation-');
  const isDel = listId.startsWith('delivery-');
  const isInstallationCard = listId.startsWith('installation-') || listId === 'pending-installation';
  const isDelayedNow = isCardCurrentlyDelayed(ec);
  const dk = isDateList ? listId.replace(/^(delivery|installation)-/, '') : null;
  const isTodayCol = dk ? isToday(parseISO(dk)) : false;
  const stageText = getScheduleStage(ec, listId);

  const addWorker = () => {
    const w = workerInput.trim();
    if (!w) return;
    setEc(p => ({ ...p, workers: p.workers.includes(w) ? p.workers : [...p.workers, w] }));
    setWorkerInput('');
  };
  const addMedia = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const kind: 'image'|'video' = file.type.startsWith('video/') ? 'video' : 'image';
      setRemarkMedia(prev => [...prev, { id: String(Date.now()) + Math.random().toString(16).slice(2), kind, name: file.name, dataUrl }]);
    };
    reader.readAsDataURL(file);
  };
  const addRemark = () => {
    if (!remarkText.trim() && remarkMedia.length === 0) return;
    const r: ScRemark = { id: String(Date.now()), text: remarkText.trim(), author: remarkAuthor.trim() || 'Unknown', at: new Date().toISOString(), media: remarkMedia.length ? remarkMedia : undefined };
    setEc(p => ({ ...p, remarks: [...p.remarks, r] }));
    setRemarkText(''); setRemarkAuthor(''); setRemarkMedia([]);
  };

  // Stage pill colour
  const stagePillCls = stageText.toLowerCase().includes('complet') ? 'bg-green-100 text-green-700 border-green-200'
    : stageText.toLowerCase().includes('pending') ? 'bg-amber-100 text-amber-700 border-amber-200'
    : stageText.toLowerCase().includes('scheduled') ? 'bg-blue-100 text-blue-700 border-blue-200'
    : stageText.toLowerCase().includes('started') || stageText.toLowerCase().includes('progress') ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';

  const infoFields = [
    { label: 'Tank Size',      value: ec.tankSize    || '—' },
    { label: 'Brand',          value: ec.brand       || '—' },
    { label: 'Type',           value: ec.productType || '—' },
    { label: 'Contact Person', value: ec.contactPerson || '—' },
    { label: 'Phone',          value: ec.phone       || '—' },
    { label: 'Sales Person',   value: ec.salesPerson || '—' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden" style={{ maxWidth: '780px', maxHeight: '90vh' }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm text-white shrink-0 ${ec.isEmergency ? 'bg-red-500' : 'bg-purple-600'}`}>
              {ec.woCode}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 truncate leading-tight">
                {ec.customer || '—'}
              </h2>
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {ec.location || '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-4 shrink-0">
            <button
              onClick={() => setEc(p => ({ ...p, isEmergency: !p.isEmergency }))}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${ec.isEmergency ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {ec.isEmergency ? 'Emergency ON' : 'Emergency'}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">

          {/* Info grid — 3 columns */}
          <div className="grid grid-cols-3 gap-2.5">
            {infoFields.map(f => (
              <div key={f.label} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{f.label}</div>
                <div className="text-sm font-semibold text-gray-800 truncate">{f.value}</div>
              </div>
            ))}
          </div>

          {/* Payment + Workers — side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* Payment card */}
            <div className="rounded-xl border border-gray-200 px-4 py-3" style={{ backgroundColor: pBg(ec.paymentPercent) }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Payment Received</span>
                <span className="text-base font-bold" style={{ color: pColor(ec.paymentPercent) }}>{ec.paymentPercent}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={ec.paymentPercent}
                onChange={e => setEc(p => ({ ...p, paymentPercent: Number(e.target.value) }))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: pColor(ec.paymentPercent) }}
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                <span>0%🔴</span><span>50%🔵</span><span>100%🟢</span>
              </div>
            </div>

            {/* Workers card */}
            <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-teal-700">Workers</span>
                <span className="text-[10px] font-semibold text-teal-500 bg-teal-100 px-1.5 py-0.5 rounded-full">{ec.workers.length} assigned</span>
              </div>
              <div className="flex gap-1.5 mb-2">
                <input
                  value={workerInput}
                  onChange={e => setWorkerInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addWorker()}
                  placeholder="Add worker"
                  className="flex-1 min-w-0 px-2.5 py-1.5 border border-teal-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                />
                <button onClick={addWorker} className="px-2.5 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 shrink-0">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {ec.workers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                  {ec.workers.map(w => (
                    <span key={w} className="flex items-center gap-1 px-2 py-0.5 bg-white border border-teal-200 rounded-full text-xs text-teal-700">
                      {w}
                      <button onClick={() => setEc(p => ({ ...p, workers: p.workers.filter(x => x !== w) }))} className="text-teal-400 hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Installation status + delay (installation cards only) */}
          {isInstallationCard && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <label className="block text-xs font-semibold text-indigo-700 mb-1.5">Installation Status</label>
                <input
                  value={ec.installationStatus || ''}
                  onChange={e => setEc(p => ({ ...p, installationStatus: e.target.value || undefined }))}
                  placeholder="Current installation status"
                  className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-0.5">Delay State</div>
                  <div className={`text-xs font-bold ${isDelayedNow ? 'text-red-600' : 'text-green-600'}`}>
                    {isDelayedNow ? '⚠ Delayed' : '✓ On Track'}
                  </div>
                </div>
                <button
                  onClick={() => setEc(prev => {
                    const today = dateKey();
                    if (isCardCurrentlyDelayed(prev)) {
                      const periods = [...(prev.delayPeriods ?? [])];
                      for (let i = periods.length - 1; i >= 0; i -= 1) {
                        if (!periods[i].endDate) { periods[i] = { ...periods[i], endDate: today }; break; }
                      }
                      return { ...prev, delayPeriods: periods };
                    }
                    return { ...prev, delayPeriods: [...(prev.delayPeriods ?? []), { startDate: today }] };
                  })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${isDelayedNow ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {isDelayedNow ? 'Set On Track' : 'Mark Delayed'}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {isDateList && isTodayCol && !ec.isConfirmed && (
            <button
              onClick={() => setEc(p => ({ ...p, isConfirmed: true, confirmedDate: format(new Date(), 'yyyy-MM-dd') }))}
              className={`w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 ${isDel ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              <CheckCircle className="w-4 h-4" />{isDel ? '✓ Mark Delivered' : '▶ Start Installation'}
            </button>
          )}
          {isDateList && ec.isConfirmed && (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-700">{isDel ? 'Delivered' : 'Started'} on {ec.confirmedDate}</span>
            </div>
          )}
          {!isDel && ec.isConfirmed && !ec.completedDate && (
            <button
              onClick={() => setEc(p => ({ ...p, completedDate: dateKey() }))}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <CheckCircle className="w-4 h-4" /> Mark Installation Completed
            </button>
          )}
          {!isDel && ec.completedDate && (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
              <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-sm font-semibold text-blue-700">Completed on {ec.completedDate}</span>
            </div>
          )}

          {/* Remarks — chat bubble style */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Remarks</span>
              {ec.remarks.length > 0 && (
                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-semibold">{ec.remarks.length}</span>
              )}
            </div>

            {/* Existing remarks */}
            <div className="flex flex-col gap-3 mb-4 max-h-52 overflow-y-auto pr-1">
              {ec.remarks.length === 0 ? (
                <p className="text-xs text-gray-400 italic text-center py-2">No remarks yet.</p>
              ) : ec.remarks.map(r => (
                <div key={r.id} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-700 shrink-0 mt-0.5">
                    {(r.author || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-800">{r.author}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{format(parseISO(r.at), 'dd MMM yy, HH:mm')}</span>
                    </div>
                    {r.text && <p className="text-sm text-gray-700 leading-relaxed">{r.text}</p>}
                    {r.media && r.media.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {r.media.map(m => m.kind === 'image' ? (
                          <img key={m.id} src={m.dataUrl} alt={m.name} className="w-full h-24 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <video key={m.id} src={m.dataUrl} controls className="w-full h-24 rounded-lg border border-gray-200" />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* New remark composer */}
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0 mt-0.5">
                {remarkAuthor ? remarkAuthor.charAt(0).toUpperCase() : '+'}
              </div>
              <div className="flex-1 min-w-0 border border-gray-200 rounded-2xl rounded-tl-sm bg-white overflow-hidden focus-within:ring-2 focus-within:ring-purple-400 focus-within:border-purple-300">
                <input
                  value={remarkAuthor}
                  onChange={e => setRemarkAuthor(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 pt-2.5 pb-1 text-xs font-semibold text-gray-700 placeholder-gray-400 focus:outline-none border-b border-gray-100"
                />
                <textarea
                  value={remarkText}
                  onChange={e => setRemarkText(e.target.value)}
                  placeholder="Write a remark…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none placeholder-gray-400"
                />
                <div className="flex items-center justify-between px-3 pb-2.5 pt-1 border-t border-gray-100 gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-purple-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    {remarkMedia.length > 0 ? `${remarkMedia.length} file(s)` : 'Attach'}
                    <input type="file" accept="image/*,video/*" multiple className="hidden"
                      onChange={e => { const files = Array.from(e.target.files ?? []); files.forEach(addMedia); e.currentTarget.value = ''; }} />
                  </label>
                  {remarkMedia.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {remarkMedia.map(m => (
                        <span key={m.id} className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-50 border border-purple-200 rounded-full text-[10px] text-purple-700">
                          {m.name.length > 12 ? m.name.slice(0, 12) + '…' : m.name}
                          <button onClick={() => setRemarkMedia(prev => prev.filter(x => x.id !== m.id))} className="text-purple-400 hover:text-red-500">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={addRemark}
                    className="ml-auto px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 shrink-0"
                  >
                    Post
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => { onSave(ec, listId); onClose(); }}
            className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main ScheduleBoard ─────────────────────────────────────────────────── */

interface Props {
  userName: string; userDepartment?: string; userRole: 'admin'|'user';
  onChannelSwitch?: (ch: ChannelType) => void; accessibleChannels?: ChannelType[];
}

const NUM_COLS = 8;

export default function ScheduleBoard({ userName, userDepartment, userRole, onChannelSwitch, accessibleChannels=[] }: Props) {
  const [store, setStore]           = useState<ScStore>(EMPTY_STORE);
  const [delOff,  setDelOff]        = useState(-2);
  const [instOff, setInstOff]       = useState(-2);
  const [ganttDW, setGanttDW]       = useState(72);
  const [addCardType, setAddCardType] = useState<'delivery'|'installation'|null>(null);
  const [selected, setSelected]     = useState<{card:ScCard;listId:string}|null>(null);
  const [pendingDrop, setPendingDrop] = useState<{srcId:string;dstId:string;cardId:string;dstIdx:number}|null>(null);
  const [showChDrop, setShowChDrop] = useState(false);
  const [pendFilter, setPendFilter] = useState<'all'|'delivery'|'installation'>('all');
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [woSearch, setWoSearch] = useState('');
  const [workOrderCards, setWorkOrderCards] = useState<WorkOrderCard[]>([]);

  const ganttRef   = useRef<HTMLDivElement>(null);
  const delRef     = useRef<HTMLDivElement>(null);
  const instRef    = useRef<HTMLDivElement>(null);
  const chDropRef  = useRef<HTMLDivElement>(null);
  const ganttAutoFitRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workOrderCardsRef = useRef<WorkOrderCard[]>([]);
  const syncedSignatureRef = useRef<Record<string, string>>({});

  const getSyncSignature = (sc: ScCard) => {
    // scheduleType intentionally excluded — Work Order is the authority for type;
    // we only sync stage/payment/confirmation status back.
    return [
      sc.listId,
      sc.paymentPercent,
      sc.isConfirmed ? '1' : '0',
      sc.confirmedDate ?? '',
      sc.completedDate ?? '',
      sc.returnedFromDate ?? '',
      sc.installationStatus ?? '',
    ].join('|');
  };

  useEffect(() => {
    workOrderCardsRef.current = workOrderCards;
  }, [workOrderCards]);

  const syncScheduleCardToWorkOrder = useCallback(async (sc: ScCard) => {
    if (!sc.sourceCardId) return;
    let src = workOrderCardsRef.current.find(c => String(c.id) === String(sc.sourceCardId));
    if (!src) {
      try {
        const latest = await fetchCards('Work Order');
        setWorkOrderCards(latest);
        workOrderCardsRef.current = latest;
        src = latest.find(c => String(c.id) === String(sc.sourceCardId));
      } catch {
        return;
      }
    }
    if (!src) return;
    const scheduleStage = getScheduleStage(sc, sc.listId);
    const srcStage = src.scheduleStage;
    const srcPayment = typeof src.paymentPercent === 'number' ? src.paymentPercent : 0;
    if (srcPayment === sc.paymentPercent && srcStage === scheduleStage) {
      return;
    }
    // IMPORTANT: Do NOT sync scheduleType back to Work Order.
    // Work Order is the authority for scheduleType; Schedule channel only reports stage.
    const updated: WorkOrderCard = {
      ...src,
      paymentPercent: sc.paymentPercent,
      scheduleStage,
      updatedAt: new Date().toISOString(),
    };
    try {
      const uid = localStorage.getItem('userId');
      const saved = await updateCard(updated, uid ? Number(uid) : undefined);
      setWorkOrderCards(prev => {
        const next = prev.map(c => String(c.id) === String(saved.id) ? saved : c);
        workOrderCardsRef.current = next;
        return next;
      });
    } catch {
      // Keep schedule responsive even when backend update fails temporarily.
    }
  }, []);

  const refreshFromWorkOrder = useCallback(async () => {
    try {
      const wo = await fetchCards('Work Order');
      setWorkOrderCards(wo);
      setStore(prev => mergeScheduleWithWorkOrder(prev, wo));
    } catch {
      // Ignore intermittent fetch failures during polling.
    }
  }, []);

  /* load schedule store and merge with Work Order Delivery/Installation cards */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [scheduleRes, woCards] = await Promise.all([
          fetch('/api/schedule/data'),
          fetchCards('Work Order'),
        ]);
        if (!scheduleRes.ok) throw new Error(`Failed to load schedule data (${scheduleRes.status})`);
        const body = await scheduleRes.json() as { store?: unknown };
        const merged = mergeScheduleWithWorkOrder(normalizeStore(body.store), woCards);
        if (active) {
          setWorkOrderCards(woCards);
          setStore(merged);
        }
      } catch {
        if (active) setStore(EMPTY_STORE);
      } finally {
        if (active) setScheduleLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Keep Schedule linked with Work Order Delivery/Installation in near real-time.
  useEffect(() => {
    const timer = setInterval(() => { void refreshFromWorkOrder(); }, 4000);
    return () => clearInterval(timer);
  }, [refreshFromWorkOrder]);

  /* persist schedule changes to JSON file (debounced) */
  useEffect(() => {
    if (!scheduleLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void fetch('/api/schedule/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store }),
      }).catch(() => {
        // Keep UX responsive even if file write fails temporarily.
      });
    }, 250);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [store, scheduleLoaded]);

  /* close dropdown on outside click */
  useEffect(()=>{
    const h=(e:MouseEvent)=>{ if(chDropRef.current&&!chDropRef.current.contains(e.target as Node))setShowChDrop(false); };
    document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h);
  },[]);

  /* auto-return unconfirmed past cards to pending */
  useEffect(()=>{
    if (!scheduleLoaded) return;
    const today=startOfDay(new Date());
    setStore(prev=>{
      const next:ScStore=JSON.parse(JSON.stringify(prev)); let dirty=false;
      Object.keys(next).forEach(lid=>{
        const isD=lid.startsWith('delivery-'); const isI=lid.startsWith('installation-');
        if(!isD&&!isI)return;
        const dk=lid.replace(/^(delivery|installation)-/,'');
        if(!isBefore(startOfDay(parseISO(dk)),today))return;
        const unconf=next[lid].filter(c=>!c.isConfirmed); if(!unconf.length)return;
        const pKey=isD?'pending-delivery':'pending-installation';
        if(!next[pKey])next[pKey]=[];
        unconf.forEach(card=>{
          if(!next[pKey].some(c=>c.woCode===card.woCode&&c.returnedFromDate===dk)){
            next[pKey]=[{...card,id:`${card.id}-ret`,listId:pKey,returnedFromDate:dk,isConfirmed:false},...next[pKey]];
            dirty=true;
          }});
        next[lid]=next[lid].filter(c=>c.isConfirmed); dirty=true;
      }); return dirty?next:prev;
    });
  },[scheduleLoaded]);

  // Keep Work Order Schedule cards in sync for Schedule-side changes only.
  useEffect(() => {
    if (!scheduleLoaded) return;
    const linkedCards = flattenCards(store).filter(sc => !!sc.sourceCardId);
    if (linkedCards.length === 0) return;

    linkedCards.forEach(sc => {
      const key = String(sc.sourceCardId);
      const sig = getSyncSignature(sc);
      if (syncedSignatureRef.current[key] === sig) return;
      syncedSignatureRef.current[key] = sig;
      void syncScheduleCardToWorkOrder(sc);
    });

    const activeIds = new Set(linkedCards.map(sc => String(sc.sourceCardId)));
    Object.keys(syncedSignatureRef.current).forEach(key => {
      if (!activeIds.has(key)) delete syncedSignatureRef.current[key];
    });
  }, [store, scheduleLoaded, syncScheduleCardToWorkOrder]);

  /* horizontal wheel for date grids only */
  useEffect(()=>{
    const el=delRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{ e.preventDefault(); const d=e.deltaX!==0?e.deltaX:e.deltaY; setDelOff(p=>p+(d>0?1:-1)); };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);
  useEffect(()=>{
    const el=instRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{ e.preventDefault(); const d=e.deltaX!==0?e.deltaX:e.deltaY; setInstOff(p=>p+(d>0?1:-1)); };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);
  /* gantt: show 9 days by default; native horizontal scroll pans timeline; Ctrl+scroll zooms day width */
  useEffect(() => {
    const fitDays = () => {
      if (!ganttAutoFitRef.current || !ganttRef.current) return;
      const labelWidth = 56;
      const available = Math.max(360, ganttRef.current.clientWidth - labelWidth);
      const fitted = Math.floor(available / GANTT_VISIBLE_DAYS);
      setGanttDW(Math.max(GANTT_MIN_DAY_WIDTH, Math.min(GANTT_MAX_DAY_WIDTH, fitted)));
    };
    fitDays();
    window.addEventListener('resize', fitDays);
    return () => window.removeEventListener('resize', fitDays);
  }, []);

  useEffect(()=>{
    const el=ganttRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{
      if(e.ctrlKey){
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        ganttAutoFitRef.current = false;
        setGanttDW(p=>Math.max(GANTT_MIN_DAY_WIDTH, Math.min(GANTT_MAX_DAY_WIDTH, p + (delta < 0 ? 6 : -6))));
      }
    };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);

  /* DnD helpers */
  const performMove=useCallback((srcId:string,dstId:string,cardId:string,dstIdx:number,workers?:string[])=>{
    let movedForSync: ScCard | null = null;
    setStore(prev=>{
      const next={...prev}; const srcList=[...(next[srcId]??[])]; const card=srcList.find(c=>c.id===cardId);
      if(!card)return prev;
      next[srcId]=srcList.filter(c=>c.id!==cardId);
      const moved = {...card,listId:dstId,workers:workers??card.workers};
      movedForSync = moved;
      const dstList=[...(next[dstId]??[])]; dstList.splice(dstIdx,0,moved);
      next[dstId]=dstList; return next;
    });
    if (movedForSync) void syncScheduleCardToWorkOrder(movedForSync);
  },[syncScheduleCardToWorkOrder]);

  const onDragEnd=useCallback((result:DropResult)=>{
    const{destination,source,draggableId}=result;
    if(!destination)return;
    const{droppableId:srcId,index:srcIdx}=source; const{droppableId:dstId,index:dstIdx}=destination;
    if(srcId===dstId&&srcIdx===dstIdx)return;
    const srcDP=srcId==='pending-delivery'; const srcIP=srcId==='pending-installation';
    const srcDD=srcId.startsWith('delivery-'); const srcID=srcId.startsWith('installation-');
    const dstDD=dstId.startsWith('delivery-'); const dstID=dstId.startsWith('installation-');
    if((srcDP||srcDD)&&dstID){alert('⛔ Delivery cards can only go to Delivery columns.');return;}
    if((srcIP||srcID)&&dstDD){alert('⛔ Installation cards can only go to Installation columns.');return;}
    if((srcDP&&dstDD)||(srcIP&&dstID)){
      const dk=dstId.replace(/^(delivery|installation)-/,'');
      const today=startOfDay(new Date());
      const dstDay=startOfDay(parseISO(dk));
      if(isBefore(dstDay,today)){
        alert('⛔ Cannot move pending cards to past dates. Choose today or a future date.');
        return;
      }
    }
    if(dstDD||dstID){
      const dk=dstId.replace(/^(delivery|installation)-/,'');
      if(isSunday(parseISO(dk))&&!window.confirm(`⚠️ ${format(parseISO(dk),'EEEE, MMM d')} is Sunday.\nContinue?`))return;
    }
    if((srcDP&&dstDD)||(srcIP&&dstID)){setPendingDrop({srcId,dstId,cardId:draggableId,dstIdx});return;}
    performMove(srcId,dstId,draggableId,dstIdx);
  },[performMove]);

  const getCards=(lid:string)=>store[lid]??[];
  const woQuery = woSearch.trim().toLowerCase();
  const matchesWo = useCallback((card: ScCard)=>{
    if(!woQuery) return true;
    return card.woCode.toLowerCase().includes(woQuery);
  }, [woQuery]);

  /* ── Stats ─────────────────────────────────────────────────────────────── */

  const totalDel   = Object.keys(store).filter(k=>k.startsWith('delivery-')).reduce((n,k)=>n+(store[k]?.length??0),0);
  const totalInst  = Object.keys(store).filter(k=>k.startsWith('installation-')).reduce((n,k)=>n+(store[k]?.length??0),0);
  const inProgress = Object.keys(store).filter(k=>k.startsWith('installation-')).reduce((n,k)=>n+(store[k]?.length??0),0);
  const totalPend  = getCards('pending-delivery').length+getCards('pending-installation').length;

  const stats=[
    {Icon:Truck,    bg:'bg-blue-50',    ic:'text-blue-500',    label:'Total Deliveries',    val:totalDel,   trend:'+8.5% vs last week', up:true },
    {Icon:Wrench,   bg:'bg-violet-50',  ic:'text-violet-500',  label:'Total Installations', val:totalInst,  trend:'+6.3% vs last week', up:true },
    {Icon:TrendingUp,bg:'bg-emerald-50',ic:'text-emerald-500', label:'In Progress',         val:inProgress, trend:'+2 vs last week',    up:true },
    {Icon:Clock,    bg:'bg-amber-50',   ic:'text-amber-500',   label:'Pending Tasks',       val:totalPend,  trend:'-1 vs last week',    up:false},
  ];

  /* ── Date Grid ─────────────────────────────────────────────────────────── */

  const renderDateGrid=(cat:'delivery'|'installation')=>{
    const off=cat==='delivery'?delOff:instOff; const setOff=cat==='delivery'?setDelOff:setInstOff;
    const ref=cat==='delivery'?delRef:instRef; const prefix=cat==='delivery'?'delivery-':'installation-';
    const Icon=cat==='delivery'?Truck:Wrench;
    const dates=Array.from({length:NUM_COLS},(_,i)=>addDays(new Date(),off+i));
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cat==='delivery'?'bg-amber-100':'bg-indigo-100'}`}>
              <Icon className={`w-4 h-4 ${cat==='delivery'?'text-amber-600':'text-indigo-600'}`}/>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{cat==='delivery'?'Delivery':'Installation'}</h3>
              <p className="text-xs text-gray-400">{format(dates[0],'MMM d')} – {format(dates[dates.length-1],'MMM d')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setOff(p=>p-1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronLeft className="w-3.5 h-3.5 text-gray-500"/></button>
            <button onClick={()=>setOff(p=>p+1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronRight className="w-3.5 h-3.5 text-gray-500"/></button>
            <span className="text-xs font-medium text-purple-600 cursor-pointer hover:underline ml-1">View all</span>
          </div>
        </div>
        {/* date column headers */}
        <div ref={ref} className="flex flex-1 min-h-0 overflow-hidden">
          {dates.map(date=>{
            const dk=format(date,'yyyy-MM-dd'); const lid=`${prefix}${dk}`;
            const isTod=isToday(date); const isSun=isSunday(date); const cards=getCards(lid).filter(matchesWo);
            return (
              <div key={dk} className={`flex-1 min-w-0 flex flex-col border-r border-gray-100 last:border-r-0 ${isTod?'bg-blue-50/40':''}`}>
                {/* day header */}
                <div className={`flex flex-col items-center py-1.5 border-b border-gray-100 flex-shrink-0 ${isTod?'bg-blue-500':isSun?'bg-gray-100':''}`}>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${isTod?'text-white':isSun?'text-red-400':'text-gray-400'}`}>
                    {format(date,'EEE')}
                  </span>
                  <span className={`text-sm font-bold mt-0.5 ${isTod?'text-white':isSun?'text-red-400':'text-gray-700'}`}>
                    {format(date,'d')}
                  </span>
                  {isSun&&<span className="text-xs text-red-400 font-semibold leading-none">OFF</span>}
                </div>
                <Droppable droppableId={lid} isDropDisabled={isSun}>
                  {(prov,snap)=>(
                    <div ref={prov.innerRef} {...prov.droppableProps}
                      className={`flex-1 overflow-y-auto p-1 ${snap.isDraggingOver?(isSun?'bg-red-50':'bg-blue-50'):''}`}>
                      {cards.map((c,i)=><CardChip key={c.id} card={c} listId={lid} index={i} onOpen={()=>setSelected({card:c,listId:lid})}/>)}
                      {prov.placeholder}
                      {isSun&&cards.length===0&&<p className="text-xs text-gray-300 text-center mt-2">Sunday – Off</p>}
                    </div>)}
                </Droppable>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ── Gantt (Installation only, max today, vertical scroll) ────────────── */

  const renderGantt=()=>{
    type GRow={card:ScCard;dk:string};
    const today0=startOfDay(new Date());
    const rows:GRow[]=[];
    Object.keys(store).forEach(lid=>{
      if(!lid.startsWith('installation-'))return;
      const dk=lid.replace(/^installation-/,'');
      const d=startOfDay(parseISO(dk));
      if(isBefore(today0, d)) return; // Do not render future dates in "In Progress up to today"
      (store[lid]??[]).forEach(card=>{
        if(!card.isConfirmed) return;
        if(!matchesWo(card)) return;
        rows.push({card,dk});
      });
    });
    rows.sort((a,b)=>a.dk.localeCompare(b.dk));
    // Left-to-right timeline: today at far left, older past dates to the right.
    const ganttDates=Array.from({length:GANTT_TOTAL_DAYS},(_,i)=>addDays(new Date(),-i));
    const LABEL_W=56;
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-purple-600"/>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">In Progress</h3>
              <p className="text-xs text-gray-400">Up to today</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block border-2 border-gray-800"/>On Track</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block border-2 border-red-700"/>Delayed</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={()=>ganttRef.current?.scrollBy({ left: -ganttDW, behavior: 'smooth' })} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-3.5 h-3.5 text-gray-500"/></button>
              <button onClick={()=>ganttRef.current?.scrollBy({ left: ganttDW, behavior: 'smooth' })} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-3.5 h-3.5 text-gray-500"/></button>
            </div>
            
          </div>
        </div>
        <div ref={ganttRef} className="flex-1 overflow-auto min-h-0">
          <div style={{minWidth:LABEL_W+ganttDates.length*ganttDW}}>
            {/* date header */}
            <div className="flex sticky top-0 z-10 bg-white border-b border-gray-200">
              <div style={{width:LABEL_W,flexShrink:0}} className="text-xs font-semibold text-gray-400 px-3 py-2 border-r border-gray-100 bg-gray-50">ID</div>
              {ganttDates.map(date=>{
                const isTod=isToday(date); const isSun=isSunday(date);
                return (
                  <div key={format(date,'yyyy-MM-dd')} style={{width:ganttDW,flexShrink:0}}
                    className={`text-center py-1 border-r border-gray-100 ${isTod?'bg-blue-500':isSun?'bg-gray-100':''}`}>
                    <div className={`text-xs font-semibold uppercase ${isTod?'text-white':isSun?'text-gray-400':'text-gray-500'}`}>{format(date,'EEE')}</div>
                    <div className={`text-xs font-bold ${isTod?'text-white':isSun?'text-gray-400':'text-gray-600'}`}>{format(date,'MMM/d').toLowerCase()}</div>
                    {isTod&&<div className="text-xs text-blue-200 font-semibold">TODAY</div>}
                  </div>);
              })}
            </div>
            {rows.length===0&&<div className="py-8 text-center text-sm text-gray-400">No installation work orders scheduled</div>}
            {rows.map(({card,dk})=>{
              const startDate=startOfDay(parseISO(card.confirmedDate || dk));
              const endAnchor = card.completedDate ? startOfDay(parseISO(card.completedDate)) : today0;
              // 0 means today (left-most), increasing values move right into the past.
              const dayOff=differenceInCalendarDays(today0,endAnchor);
              const leftPx=dayOff*ganttDW;
              const maxRight=ganttDates.length*ganttDW;
              const clampedLeft=Math.max(0,leftPx);
              const isCompleted = Boolean(card.completedDate);
              const progressedDays=Math.max(1, differenceInCalendarDays(endAnchor,startDate)+1);
              const rawWidth=progressedDays*ganttDW;
              const clampedWidth=Math.max(0,Math.min(rawWidth,maxRight-clampedLeft));
              const outerBorder=card.isEmergency?'#dc2626':'#4b5563';
              const isEmRow=card.isEmergency;
              const segmentDays = Array.from({ length: progressedDays }, (_, idx) => {
                const segmentDate = format(addDays(endAnchor, -idx), 'yyyy-MM-dd');
                return {
                  key: `${card.id}-${segmentDate}`,
                  color: isCardDelayedOnDate(card, segmentDate) ? '#ef4444' : '#22c55e',
                };
              });
              return (
                <div key={card.id} className="flex items-center border-b border-gray-50 h-9">
                  <div style={{width:LABEL_W,flexShrink:0}}
                    className={`flex items-center px-3 border-r border-gray-100 h-full text-sm font-bold ${isEmRow?'text-red-600':'text-gray-700'}`}>
                    {card.woCode}
                  </div>
                  <div className="flex-1 relative h-full overflow-hidden">
                    {/* sunday shading */}
                    {ganttDates.map((d,di)=>isSunday(d)?(
                      <div key={di} style={{position:'absolute',left:di*ganttDW,width:ganttDW,top:0,bottom:0}} className="bg-gray-50 pointer-events-none"/>):null)}
                    {/* today line */}
                    {(()=>{const t=0;return t>=0&&t<ganttDates.length?(
                      <div style={{position:'absolute',left:t*ganttDW+ganttDW/2,top:0,bottom:0,width:2}} className="bg-blue-400 opacity-60 pointer-events-none"/>):null;})()}
                    {/* bar */}
                    {clampedWidth>0&&clampedLeft<maxRight&&(
                      <div
                        onClick={()=>setSelected({card,listId:`installation-${dk}`})}
                        style={{
                          position:'absolute',
                          left:clampedLeft+2,
                          width:Math.max(12,clampedWidth-4),
                          height:21,
                          top:'50%',
                          transform:'translateY(-50%)',
                          border:`2px solid ${outerBorder}`,
                          borderRadius:8,
                          backgroundColor:'white',
                          cursor:'pointer',
                          boxSizing:'border-box',
                          display:'flex',
                          alignItems:'center',
                          padding:'0 4px',
                          gap:2,
                          overflow:'hidden',
                        }}
                      >
                        {segmentDays.map((segment, idx) => (
                          <div
                            key={segment.key}
                            style={{
                              flex: 1,
                              minWidth: Math.max(10, ganttDW - 10),
                              height: 13,
                              borderRadius: idx === 0 ? '4px 0 0 4px' : idx === segmentDays.length - 1 ? '0 4px 4px 0' : 0,
                              backgroundColor: segment.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: idx === 0 ? 'flex-start' : 'center',
                              paddingLeft: idx === 0 ? 6 : 0,
                              overflow: 'hidden',
                            }}
                          >
                            {idx === 0 && (
                              <span style={{color:'white',fontSize:10,fontWeight:700,letterSpacing:'0.02em',textShadow:'0 1px 2px rgba(0,0,0,0.3)',whiteSpace:'nowrap'}}>
                                {card.woCode} · {progressedDays}d
                              </span>
                            )}
                          </div>
                        ))}
                      </div>)}
                  </div>
                </div>);
            })}
          </div>
        </div>
      </div>
    );
  };

  /* ── Pending ─────────────────────────────────────────────────────────── */

  const renderPending=()=>{
    const delCards=sortScheduleGroup(getCards('pending-delivery').filter(matchesWo));
    const instCards=sortScheduleGroup(getCards('pending-installation').filter(matchesWo));
    const cols=[
      {lid:'pending-delivery',   label:'Delivery',     count:delCards.length,   Icon:Truck,  cards:delCards,  cat:'delivery'  as const},
      {lid:'pending-installation',label:'Installation', count:instCards.length,  Icon:Wrench, cards:instCards, cat:'installation' as const},
    ].filter(c=>pendFilter==='all'||c.cat===pendFilter);
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center"><Clock className="w-4 h-4 text-amber-600"/></span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Pending</h3>
              <p className="text-xs text-gray-400">{totalPend} cards</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Sourced from Work Order</span>
            <div className="relative">
              <select value={pendFilter} onChange={e=>setPendFilter(e.target.value as typeof pendFilter)}
                className="text-xs font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 appearance-none pr-6 cursor-pointer">
                <option value="all">All Types</option>
                <option value="delivery">Delivery</option>
                <option value="installation">Installation</option>
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"/>
            </div>
          </div>
        </div>
        {/* two columns */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {cols.map(({lid,label,count,Icon,cards,cat},ci)=>(
            <div key={lid} className={`flex-1 flex flex-col min-h-0 ${ci<cols.length-1?'border-r border-gray-100':''}`}>
              {/* sub-header */}
              <div className="px-2.5 py-1 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <Icon className={`w-3.5 h-3.5 ${cat==='delivery'?'text-amber-500':'text-indigo-500'}`}/>
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                  <span className="text-xs text-gray-400">({count})</span>
                </div>
                <span className="text-xs text-gray-400">Auto</span>
              </div>
              <Droppable droppableId={lid}>
                {(prov,snap)=>(
                  <div ref={prov.innerRef} {...prov.droppableProps}
                    className={`flex-1 overflow-y-auto p-1 ${snap.isDraggingOver?'bg-orange-50':''}`}>
                    {cards.map((c,i)=><CardChip key={c.id} card={c} listId={lid} index={i} isPending onOpen={()=>setSelected({card:c,listId:lid})}/>)}
                    {prov.placeholder}
                    {!cards.length&&<p className="text-xs text-gray-300 text-center py-4 italic">No pending {label.toLowerCase()}</p>}
                  </div>)}
              </Droppable>
            </div>
          ))}
          {pendFilter!=='all'&&cols.length===1&&(
            <div className="flex-1 flex items-center justify-center text-xs text-gray-400 italic border-l border-gray-100">
              {pendFilter==='delivery'?'Installation hidden':'Delivery hidden'} — change filter
            </div>)}
        </div>
      </div>
    );
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* ── Top header ── */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{format(new Date(),'EEEE, MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input value={woSearch} onChange={e=>setWoSearch(e.target.value)} placeholder="Search WO (e.g. 7654)"
              className="w-56 pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/>
          </div>
          {/* channel switcher */}
          <div className="relative" ref={chDropRef}>
            <button onClick={()=>setShowChDrop(p=>!p)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 shadow-sm transition-colors">
              <CalendarRange className="w-4 h-4 text-purple-200"/>
              <span>Schedule</span>
              <ChevronDown className="w-4 h-4 opacity-70"/>
            </button>
            {showChDrop&&(
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100">
                  <div className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"/>
                    <input type="text" placeholder="Search channels…" readOnly className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none"/></div>
                </div>
                {(['Quotation','Work Order','Schedule'] as ChannelType[]).map(ch=>{
                  const ok=ch==='Schedule'||accessibleChannels.includes(ch);
                  return (
                    <button key={ch} disabled={!ok}
                      onClick={()=>{if(ok&&onChannelSwitch){onChannelSwitch(ch);setShowChDrop(false);}}}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50 ${!ok?'opacity-40 cursor-not-allowed':'cursor-pointer'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ch==='Quotation'?'bg-blue-100':ch==='Work Order'?'bg-orange-100':'bg-purple-100'}`}>
                        {ch==='Quotation'?<FileText className="w-4 h-4 text-blue-600"/>:ch==='Work Order'?<ClipboardList className="w-4 h-4 text-orange-500"/>:<CalendarRange className="w-4 h-4 text-purple-600"/>}
                      </span>
                      <span className={`flex-1 text-left font-medium ${ch==='Schedule'?'text-gray-900':'text-gray-700'}`}>{ch}</span>
                      {ch==='Schedule'&&<Check className="w-4 h-4 text-green-500 flex-shrink-0"/>}
                    </button>);})}
              </div>)}
        </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="px-4 py-2 grid grid-cols-4 gap-2 flex-shrink-0">
        {stats.map(({Icon,bg,ic,label,val,trend,up})=>(
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2 flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${ic}`}/>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 font-medium truncate">{label}</p>
              <p className="text-xl font-bold text-gray-900 leading-tight">{val}</p>
              <p className={`text-xs font-medium ${up?'text-emerald-500':'text-red-500'} flex items-center gap-0.5`}>
                <span>{up?'↑':'↓'}</span><span>{trend}</span>
              </p>
            </div>
          </div>))}
      </div>

      {/* ── 4-quadrant layout ── */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2 px-4 pb-3 min-h-0 overflow-hidden">
          {renderDateGrid('delivery')}
          {renderDateGrid('installation')}
          {renderGantt()}
          {renderPending()}
        </div>
      </DragDropContext>

      {/* Modals */}
      {addCardType&&<AddCardModal type={addCardType} onClose={()=>setAddCardType(null)} onAdd={c=>setStore(prev=>({...prev,[c.listId]:[...(prev[c.listId]??[]),c]}))}/>}
      {selected&&<CardDetailModal card={selected.card} listId={selected.listId} onClose={()=>setSelected(null)} onSave={(u,lid)=>{
        setStore(prev=>({...prev,[lid]:(prev[lid]??[]).map(c=>c.id===u.id?u:c)}));
        void syncScheduleCardToWorkOrder(u);
      }}/>} 
      {pendingDrop&&(
        <WorkersModal destId={pendingDrop.dstId}
          onConfirm={w=>{performMove(pendingDrop.srcId,pendingDrop.dstId,pendingDrop.cardId,pendingDrop.dstIdx,w);setPendingDrop(null);}}
          onCancel={()=>setPendingDrop(null)}/>)}
    </div>
  );
}
