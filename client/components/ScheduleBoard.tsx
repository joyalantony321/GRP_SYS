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
import { ChannelType } from '@/types';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ScRemark { id: string; text: string; author: string; at: string; }

export interface ScCard {
  id: string; woCode: string; listId: string; workers: string[];
  isEmergency: boolean; paymentPercent: number; isConfirmed: boolean;
  confirmedDate?: string; remarks: ScRemark[]; createdAt: string;
  customer?: string; location?: string; tankSize?: string;
  contactPerson?: string; phone?: string; salesPerson?: string;
  returnedFromDate?: string;
}
type ScStore = Record<string, ScCard[]>;

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

/* ─── Seed data ──────────────────────────────────────────────────────────── */

const D = (off: number) => format(addDays(new Date(), off), 'yyyy-MM-dd');
const now = new Date().toISOString();

const SEED: ScStore = {
  'pending-delivery': [
    { id:'pd1', woCode:'3291', listId:'pending-delivery', workers:[], isEmergency:false, paymentPercent:0,  isConfirmed:false, remarks:[], createdAt:now, customer:'ALFA SERVICES', location:'DUBAI' },
    { id:'pd2', woCode:'2793', listId:'pending-delivery', workers:[], isEmergency:false, paymentPercent:50, isConfirmed:false, remarks:[], createdAt:now, customer:'KINNARPS PROJECTS', location:'DUBAI', tankSize:'30X4.5X2.5', contactPerson:'AMARAVATHI', phone:'055331929', salesPerson:'ANOOP' },
    { id:'pd3', woCode:'2794', listId:'pending-delivery', workers:[], isEmergency:true,  paymentPercent:25, isConfirmed:false, remarks:[], createdAt:now, customer:'EO', location:'DUBAI', contactPerson:'ANIL', phone:'0552237734' },
    { id:'pd4', woCode:'1653', listId:'pending-delivery', workers:[], isEmergency:false, paymentPercent:45, isConfirmed:false, remarks:[], createdAt:now, customer:'GOLDEN STAR FIBER', location:'WH', tankSize:'1.5X1.5X1.5' },
    { id:'pd5', woCode:'1587', listId:'pending-delivery', workers:[], isEmergency:false, paymentPercent:0,  isConfirmed:false, remarks:[{id:'r1',text:'PANELS DELIVERED, NEED RETURN PANEL',author:'ANEESH',at:now}], createdAt:now, customer:'BARIQ AL MAS', location:'WH' },
  ],
  'pending-installation': [
    { id:'pi1', woCode:'1001', listId:'pending-installation', workers:[], isEmergency:true,  paymentPercent:0,  isConfirmed:false, remarks:[], createdAt:now, customer:'SOLARO INS', location:'DUBAI' },
    { id:'pi2', woCode:'7788', listId:'pending-installation', workers:[], isEmergency:true,  paymentPercent:0,  isConfirmed:false, remarks:[], createdAt:now, customer:'URGENT INS', location:'ABU DHABI' },
    { id:'pi3', woCode:'1576', listId:'pending-installation', workers:[], isEmergency:false, paymentPercent:30, isConfirmed:false, remarks:[], createdAt:now, customer:'VANGURD', location:'DUBAI' },
    { id:'pi4', woCode:'1381', listId:'pending-installation', workers:[], isEmergency:true,  paymentPercent:0,  isConfirmed:false, remarks:[{id:'r2',text:'FLANGE CONFIRMED',author:'MAHMOOD',at:now}], createdAt:now, customer:'VISION TOBACO', location:'FUJIRA', contactPerson:'MAHMOOD', phone:'0557911096' },
    { id:'pi5', woCode:'1832', listId:'pending-installation', workers:[], isEmergency:false, paymentPercent:100,isConfirmed:false, remarks:[], createdAt:now, customer:'RIVOLI', location:'SHARJAH' },
    { id:'pi6', woCode:'1863', listId:'pending-installation', workers:[], isEmergency:false, paymentPercent:40, isConfirmed:false, remarks:[], createdAt:now, customer:'EVACUSAFE (LADIES CLUB)', location:'DUBAI' },
  ],
  [`delivery-${D(-4)}`]: [{ id:'d-4a', woCode:'1604', listId:`delivery-${D(-4)}`, workers:['Yazan'], isEmergency:false, paymentPercent:100,isConfirmed:true, confirmedDate:D(-4), remarks:[], createdAt:now, customer:'SOLARO', location:'DUBAI' }],
  [`delivery-${D(-3)}`]: [{ id:'d-3a', woCode:'1684', listId:`delivery-${D(-3)}`, workers:['Ali'],   isEmergency:false, paymentPercent:100,isConfirmed:true, confirmedDate:D(-3), remarks:[], createdAt:now, customer:'KINNARPS', location:'WH' }],
  [`delivery-${D(-2)}`]: [{ id:'d-2a', woCode:'9856', listId:`delivery-${D(-2)}`, workers:['Rafiq'], isEmergency:false, paymentPercent:75, isConfirmed:true, confirmedDate:D(-2), remarks:[], createdAt:now, customer:'ALI SHARAF', location:'WH' },
                          { id:'d-2b', woCode:'0498', listId:`delivery-${D(-2)}`, workers:[],         isEmergency:false, paymentPercent:40, isConfirmed:false, remarks:[], createdAt:now, customer:'ALFA SERVICES', location:'DUBAI' }],
  [`delivery-${D(-1)}`]: [{ id:'d-1a', woCode:'0214', listId:`delivery-${D(-1)}`, workers:['Aneesh'],isEmergency:false, paymentPercent:60, isConfirmed:true, confirmedDate:D(-1), remarks:[], createdAt:now, customer:'BARIQ AL MAS', location:'WH' },
                          { id:'d-1b', woCode:'0345', listId:`delivery-${D(-1)}`, workers:[],         isEmergency:false, paymentPercent:30, isConfirmed:false, remarks:[], createdAt:now, customer:'EO', location:'DUBAI' }],
  [`delivery-${D(0)}`]:  [{ id:'d0a',  woCode:'7654', listId:`delivery-${D(0)}`,  workers:['Ahmed'],  isEmergency:false, paymentPercent:20, isConfirmed:false, remarks:[], createdAt:now, customer:'SAMPLE CO', location:'SHARJAH' },
                          { id:'d0b',  woCode:'8818', listId:`delivery-${D(0)}`,  workers:[],         isEmergency:true,  paymentPercent:0,  isConfirmed:false, remarks:[], createdAt:now, customer:'URGENT CLIENT', location:'DUBAI' }],
  [`delivery-${D(1)}`]:  [{ id:'d1a',  woCode:'2198', listId:`delivery-${D(1)}`,  workers:[],         isEmergency:false, paymentPercent:10, isConfirmed:false, remarks:[], createdAt:now, customer:'BETA CORP', location:'ABU DHABI' }],
  [`delivery-${D(2)}`]:  [{ id:'d2a',  woCode:'4412', listId:`delivery-${D(2)}`,  workers:[],         isEmergency:false, paymentPercent:5,  isConfirmed:false, remarks:[], createdAt:now, customer:'GAMMA LTD', location:'FUJIRA' }],
  [`installation-${D(-6)}`]: [{ id:'i-6a', woCode:'5611', listId:`installation-${D(-6)}`, workers:['Anoop','Rafiq'], isEmergency:false, paymentPercent:80, isConfirmed:true, confirmedDate:D(-6), remarks:[], createdAt:now, customer:'FALCON', location:'DUBAI' }],
  [`installation-${D(-3)}`]: [{ id:'i-3a', woCode:'6622', listId:`installation-${D(-3)}`, workers:['Mohamed','Mahmood'], isEmergency:false, paymentPercent:100,isConfirmed:true, confirmedDate:D(-3), remarks:[], createdAt:now, customer:'EVACUSAFE', location:'DUBAI' }],
  [`installation-${D(-2)}`]: [{ id:'i-2a', woCode:'7780', listId:`installation-${D(-2)}`, workers:['Anoop'],  isEmergency:false, paymentPercent:55, isConfirmed:false, remarks:[], createdAt:now, customer:'SAMPLE INS', location:'SHARJAH' },
                               { id:'i-2b', woCode:'1000', listId:`installation-${D(-2)}`, workers:['Ali'],    isEmergency:false, paymentPercent:25, isConfirmed:false, remarks:[], createdAt:now, customer:'RIVOLI INS', location:'DUBAI' }],
  [`installation-${D(-1)}`]: [{ id:'i-1a', woCode:'0160', listId:`installation-${D(-1)}`, workers:['Rafiq'],  isEmergency:false, paymentPercent:60, isConfirmed:false, remarks:[], createdAt:now, customer:'KINNARPS INS', location:'WH' },
                               { id:'i-1b', woCode:'0330', listId:`installation-${D(-1)}`, workers:[],        isEmergency:false, paymentPercent:30, isConfirmed:false, remarks:[], createdAt:now, customer:'SOLARO INS', location:'DUBAI' }],
  [`installation-${D(0)}`]:  [{ id:'i0a',  woCode:'3344', listId:`installation-${D(0)}`,  workers:['Rafiq','Ahmed'], isEmergency:false, paymentPercent:35, isConfirmed:false, remarks:[], createdAt:now, customer:'KINNARPS INS', location:'WH' },
                               { id:'i0b',  woCode:'5656', listId:`installation-${D(0)}`,  workers:[],        isEmergency:false, paymentPercent:0,  isConfirmed:false, remarks:[], createdAt:now, customer:'GOLDEN INS', location:'FUJIRA' }],
  [`installation-${D(1)}`]:  [{ id:'i1a',  woCode:'8877', listId:`installation-${D(1)}`,  workers:['Mahmood'], isEmergency:false, paymentPercent:10, isConfirmed:false, remarks:[], createdAt:now, customer:'VISION INS', location:'DUBAI' }],
  [`installation-${D(2)}`]:  [{ id:'i2a',  woCode:'7788', listId:`installation-${D(2)}`,  workers:[],          isEmergency:true,  paymentPercent:0,  isConfirmed:false, remarks:[], createdAt:now, customer:'URGENT INS', location:'ABU DHABI' }],
};

/* ─── CardChip – used in BOTH date columns AND pending ───────────────────── */

function CardChip({
  card, listId, index, isPending, onOpen,
}: { card: ScCard; listId: string; index: number; isPending?: boolean; onOpen: () => void }) {
  const dot = isPending ? pendDot(card) : dateDot(card);
  const showDot = Boolean(dot);
  const chipBg = pBg(card.paymentPercent);
  const meta = [card.customer, card.location].filter(Boolean).join(' · ');
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
  const [tankSize, setTankSize] = useState(''); const [location, setLocation] = useState('');
  const [contact, setContact] = useState(''); const [phone, setPhone] = useState('');
  const [sales, setSales] = useState(''); const [emergency, setEmergency] = useState(false);
  const [err, setErr] = useState('');
  const submit = () => {
    if (!wo.trim()) { setErr('WO Number is required'); return; }
    if (!/^\d{4}$/.test(wo)) { setErr('Must be exactly 4 digits'); return; }
    onAdd({ id:`${type[0]}${Date.now()}`, woCode:wo, listId:`pending-${type}`, workers:[], isEmergency:emergency, paymentPercent:0, isConfirmed:false, remarks:[], createdAt:new Date().toISOString(), customer:customer||undefined, location:location||undefined, tankSize:tankSize||undefined, contactPerson:contact||undefined, phone:phone||undefined, salesPerson:sales||undefined });
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
  const [remarkText, setRemarkText] = useState(''); const [remarkAuthor, setRemarkAuthor] = useState('');
  const isDateList = listId.startsWith('delivery-')||listId.startsWith('installation-');
  const isDel = listId.startsWith('delivery-');
  const dk = isDateList ? listId.replace(/^(delivery|installation)-/,'') : null;
  const isTodayCol = dk ? isToday(parseISO(dk)) : false;
  const addRemark = () => {
    if(!remarkText.trim())return;
    const r:ScRemark={id:String(Date.now()),text:remarkText.trim(),author:remarkAuthor.trim()||'Unknown',at:new Date().toISOString()};
    setEc(p=>({...p,remarks:[...p.remarks,r]})); setRemarkText(''); setRemarkAuthor('');
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{maxHeight:'88vh'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white ${ec.isEmergency?'bg-red-500':'bg-purple-600'}`}>{ec.woCode}</div>
            <div><h2 className="text-base font-semibold text-gray-900">{ec.customer||`WO-${ec.woCode}`}</h2>
              {ec.location&&<p className="text-sm text-gray-500">{ec.location}{ec.tankSize?` · ${ec.tankSize}`:''}</p>}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500"/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {(ec.contactPerson||ec.phone||ec.salesPerson||ec.workers.length>0)&&(
            <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
              {ec.contactPerson&&<div><div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Contact</div><div className="text-sm font-semibold text-gray-800 mt-0.5">{ec.contactPerson}</div></div>}
              {ec.phone&&<div><div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Phone</div><div className="text-sm font-semibold text-gray-800 mt-0.5">{ec.phone}</div></div>}
              {ec.salesPerson&&<div><div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sales</div><div className="text-sm font-semibold text-gray-800 mt-0.5">{ec.salesPerson}</div></div>}
              {ec.workers.length>0&&<div><div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Workers</div><div className="text-sm text-gray-800 mt-0.5">{ec.workers.join(', ')}</div></div>}
            </div>)}
          <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${ec.isEmergency?'border-red-200 bg-red-50':'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-3"><AlertTriangle className={`w-4 h-4 ${ec.isEmergency?'text-red-500':'text-gray-400'}`}/>
              <span className={`text-sm font-semibold ${ec.isEmergency?'text-red-700':'text-gray-700'}`}>Emergency {ec.isEmergency?'(ON)':'(OFF)'}</span></div>
            <button onClick={()=>setEc(p=>({...p,isEmergency:!p.isEmergency}))} className={`relative w-10 h-6 rounded-full transition-colors ${ec.isEmergency?'bg-red-500':'bg-gray-300'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ec.isEmergency?'left-5':'left-1'}`}/></button>
          </div>
          <div className="p-4 rounded-xl border border-gray-200" style={{backgroundColor:pBg(ec.paymentPercent)}}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-700">Payment Received</span>
              <span className="text-lg font-bold" style={{color:pColor(ec.paymentPercent)}}>{ec.paymentPercent}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={ec.paymentPercent}
              onChange={e=>setEc(p=>({...p,paymentPercent:Number(e.target.value)}))} className="w-full" style={{accentColor:pColor(ec.paymentPercent)}}/>
            <div className="flex justify-between text-xs text-gray-400 mt-1"><span>0% 🔴</span><span>1-49% 🟡</span><span>50-99% 🔵</span><span>100% 🟢</span></div>
          </div>
          {isDateList&&isTodayCol&&!ec.isConfirmed&&(
            <button onClick={()=>setEc(p=>({...p,isConfirmed:true,confirmedDate:format(new Date(),'yyyy-MM-dd')}))}
              className={`w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 ${isDel?'bg-green-600 hover:bg-green-700':'bg-indigo-600 hover:bg-indigo-700'}`}>
              <CheckCircle className="w-4 h-4"/>{isDel?'✓ Mark Delivered':'▶ Start Installation'}</button>)}
          {isDateList&&ec.isConfirmed&&(
            <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle className="w-4 h-4 text-green-600"/>
              <span className="text-sm font-semibold text-green-700">{isDel?'Delivered':'Started'} on {ec.confirmedDate}</span></div>)}
          <div>
            <div className="flex items-center gap-2 mb-3"><MessageSquare className="w-4 h-4 text-gray-400"/>
              <span className="text-sm font-semibold text-gray-700">Remarks ({ec.remarks.length})</span></div>
            <div className="flex flex-col gap-2 mb-3 max-h-40 overflow-y-auto">
              {ec.remarks.length===0&&<p className="text-sm text-gray-400 italic">No remarks yet.</p>}
              {ec.remarks.map(r=>(
                <div key={r.id} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <p className="text-sm text-gray-800">{r.text}</p>
                  <p className="text-xs text-gray-400 mt-1">— {r.author} · {format(parseISO(r.at),'dd/MM/yy HH:mm')}</p>
                </div>))}
            </div>
            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
              <input value={remarkAuthor} onChange={e=>setRemarkAuthor(e.target.value)} placeholder="Your name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"/>
              <div className="flex gap-2">
                <textarea value={remarkText} onChange={e=>setRemarkText(e.target.value)} placeholder="Write a remark…" rows={2}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"/>
                <button onClick={addRemark} className="px-3 self-stretch bg-purple-600 text-white rounded-lg hover:bg-purple-700"><Plus className="w-4 h-4"/></button>
              </div>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={()=>{onSave(ec,listId);onClose();}} className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700">Save Changes</button>
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
const GANTT_DAYS = 40;

export default function ScheduleBoard({ userName, userDepartment, userRole, onChannelSwitch, accessibleChannels=[] }: Props) {
  const [store, setStore]           = useState<ScStore>(()=>JSON.parse(JSON.stringify(SEED)));
  const [delOff,  setDelOff]        = useState(-2);
  const [instOff, setInstOff]       = useState(-2);
  // Number of days shown before today in gantt; rightmost date remains today.
  const [ganttPastDays, setGanttPastDays] = useState(GANTT_DAYS - 1);
  const [ganttDW, setGanttDW]       = useState(48);
  const [addCardType, setAddCardType] = useState<'delivery'|'installation'|null>(null);
  const [selected, setSelected]     = useState<{card:ScCard;listId:string}|null>(null);
  const [pendingDrop, setPendingDrop] = useState<{srcId:string;dstId:string;cardId:string;dstIdx:number}|null>(null);
  const [showChDrop, setShowChDrop] = useState(false);
  const [pendFilter, setPendFilter] = useState<'all'|'delivery'|'installation'>('all');

  const ganttRef   = useRef<HTMLDivElement>(null);
  const delRef     = useRef<HTMLDivElement>(null);
  const instRef    = useRef<HTMLDivElement>(null);
  const chDropRef  = useRef<HTMLDivElement>(null);

  /* close dropdown on outside click */
  useEffect(()=>{
    const h=(e:MouseEvent)=>{ if(chDropRef.current&&!chDropRef.current.contains(e.target as Node))setShowChDrop(false); };
    document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h);
  },[]);

  /* auto-return unconfirmed past cards to pending */
  useEffect(()=>{
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
  },[]);

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
  /* gantt: Ctrl+scroll = zoom, no other wheel interception → natural vertical scroll */
  useEffect(()=>{
    const el=ganttRef.current; if(!el)return;
    const h=(e:WheelEvent)=>{
      if(e.ctrlKey){
        e.preventDefault();
        // Keep current viewport anchor while zooming.
        const prevLeft = el.scrollLeft;
        setGanttDW(p=>Math.max(24,Math.min(160,p+(e.deltaY<0?6:-6))));
        requestAnimationFrame(()=>{
          el.scrollLeft = Math.max(0, prevLeft);
        });
        return;
      }
      // Shift/trackpad horizontal scroll navigates timeline dates to access past data quickly
      const horizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if(horizontalIntent){
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        // Increase/decrease visible past range while keeping today fixed at right edge.
        if (delta > 0) {
          setGanttPastDays(p=>Math.min(120, p+1));
          requestAnimationFrame(()=>{
            const g = ganttRef.current;
            if (g) g.scrollLeft = g.scrollWidth;
          });
        } else {
          setGanttPastDays(p=>Math.max(7, p-1));
        }
      }
    };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);

  /* DnD helpers */
  const performMove=useCallback((srcId:string,dstId:string,cardId:string,dstIdx:number,workers?:string[])=>{
    setStore(prev=>{
      const next={...prev}; const srcList=[...(next[srcId]??[])]; const card=srcList.find(c=>c.id===cardId);
      if(!card)return prev;
      next[srcId]=srcList.filter(c=>c.id!==cardId);
      const dstList=[...(next[dstId]??[])]; dstList.splice(dstIdx,0,{...card,listId:dstId,workers:workers??card.workers});
      next[dstId]=dstList; return next;
    });
  },[]);

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
    if(dstDD||dstID){
      const dk=dstId.replace(/^(delivery|installation)-/,'');
      if(isSunday(parseISO(dk))&&!window.confirm(`⚠️ ${format(parseISO(dk),'EEEE, MMM d')} is Sunday.\nContinue?`))return;
    }
    if((srcDP&&dstDD)||(srcIP&&dstID)){setPendingDrop({srcId,dstId,cardId:draggableId,dstIdx});return;}
    performMove(srcId,dstId,draggableId,dstIdx);
  },[performMove]);

  const getCards=(lid:string)=>store[lid]??[];

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
            const isTod=isToday(date); const isSun=isSunday(date); const cards=getCards(lid);
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
      (store[lid]??[]).forEach(card=>rows.push({card,dk}));
    });
    rows.sort((a,b)=>a.dk.localeCompare(b.dk));
    // Left-to-right timeline: today at far left, older past dates to the right.
    const ganttDates=Array.from({length:ganttPastDays+1},(_,i)=>addDays(new Date(),-i));
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
              <button onClick={()=>{
                setGanttPastDays(p=>Math.min(120, p+1));
                requestAnimationFrame(()=>{
                  const g = ganttRef.current;
                  if (g) g.scrollLeft = g.scrollWidth;
                });
              }} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-3.5 h-3.5 text-gray-500"/></button>
              <button onClick={()=>setGanttPastDays(p=>Math.max(7, p-1))} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-3.5 h-3.5 text-gray-500"/></button>
            </div>
            <span className="text-xs text-gray-400">Shift+scroll timeline · Ctrl+scroll zoom</span>
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
              const startDate=startOfDay(parseISO(dk));
              const dur=4;
              // 0 means today (left-most), increasing values move right into the past.
              const dayOff=differenceInCalendarDays(today0,startDate);
              const leftPx=dayOff*ganttDW;
              const maxRight=ganttDates.length*ganttDW;
              const clampedLeft=Math.max(0,leftPx);
              // Gantt uses only 2 colours: green = on track, red = delayed
              const plannedEnd=startOfDay(addDays(startDate,dur-1));
              const isDelayed=isBefore(plannedEnd,today0)&&!card.isConfirmed;
              const progressedDays=Math.max(1, Math.min(dur, differenceInCalendarDays(today0,startDate)+1));
              const rawWidth=progressedDays*ganttDW;
              const clampedWidth=Math.max(0,Math.min(rawWidth,maxRight-clampedLeft));
              const barFill=isDelayed?'#ef4444':'#22c55e';
              // Detached outer boundary: red if emergency, dark if not
              const outerBorder=card.isEmergency?'#dc2626':'#6b7280';
              const isEmRow=card.isEmergency;
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
                    {/* bar — outer boundary (detached) + inner fill */}
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
                          border:`2.5px solid ${outerBorder}`,
                          borderRadius:7,
                          padding:3,          /* gap between outer border and inner fill */
                          backgroundColor:'white',
                          cursor:'pointer',
                          boxSizing:'border-box',
                        }}
                      >
                        {/* inner fill */}
                        <div style={{
                          width:'100%', height:'100%',
                          backgroundColor:barFill,
                          borderRadius:4,
                          display:'flex', alignItems:'center', justifyContent:'space-between',
                          padding:'0 6px',
                          overflow:'hidden',
                        }}>
                          {/* subtle top-edge highlight */}
                          <div style={{position:'absolute',inset:3,top:3,background:'linear-gradient(180deg,rgba(255,255,255,0.22) 0%,transparent 55%)',borderRadius:4,pointerEvents:'none'}}/>
                          <span style={{color:'white',fontSize:9,fontWeight:700,letterSpacing:'0.03em',
                            textShadow:'0 1px 3px rgba(0,0,0,0.35)',whiteSpace:'nowrap',zIndex:1}}>
                            {card.woCode} · {progressedDays}d
                          </span>
                        </div>
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
    const delCards=getCards('pending-delivery');
    const instCards=getCards('pending-installation');
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
            <button onClick={()=>setAddCardType('delivery')} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors"><Plus className="w-3 h-3"/>Add</button>
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
                <button onClick={()=>setAddCardType(cat)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-600 transition-colors font-medium"><Plus className="w-3 h-3"/>Add</button>
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
      {selected&&<CardDetailModal card={selected.card} listId={selected.listId} onClose={()=>setSelected(null)} onSave={(u,lid)=>setStore(prev=>({...prev,[lid]:(prev[lid]??[]).map(c=>c.id===u.id?u:c)}))}/>}
      {pendingDrop&&(
        <WorkersModal destId={pendingDrop.dstId}
          onConfirm={w=>{performMove(pendingDrop.srcId,pendingDrop.dstId,pendingDrop.cardId,pendingDrop.dstIdx,w);setPendingDrop(null);}}
          onCancel={()=>setPendingDrop(null)}/>)}
    </div>
  );
}
