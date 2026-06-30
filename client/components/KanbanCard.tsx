import { useState, useEffect } from 'react';
import { Edit2, Trash2, Clock, User, CheckCircle, XCircle, FileText, Send } from 'lucide-react';
import { Card, ListType, RemarkType, AppUser, UserWorkStatus, Department, ChannelType, DEPARTMENTS, isWorkOrderList, normalizeListType } from '@/types';
import { formatDistanceToNow, format } from 'date-fns';
import { Draggable } from '@hello-pangea/dnd';
import { docUrl, getAppData } from '@/lib/api';

interface Props {
  card: Card;
  index: number;
  onClick: () => void;
  onDelete: () => void;
  onApprove?: (cardId: string) => void;
  onTerminate?: (cardId: string) => void;
  onUnterminate?: (cardId: string) => void;
  onComplete?: (cardId: string) => void;
  onRevise?: (cardId: string) => void;
  onUpdateCard?: (card: Card) => void;
  onAssignUser?: (cardId: string, userName: string | undefined) => void;
  onUpdateWorkStatus?: (cardId: string, status: UserWorkStatus) => void;
  userRole: 'admin' | 'user';
  userDepartment?: Department | '';
  currentList: ListType;
}

export default function KanbanCard({ card, index, onClick, onDelete, onApprove, onTerminate, onUnterminate, onComplete, onRevise, onUpdateCard, onAssignUser, onUpdateWorkStatus, userRole, userDepartment, currentList }: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [assignDeptFilter, setAssignDeptFilter] = useState<Department | ''>('');
  const [pendingAssignee, setPendingAssignee] = useState<string>(card.assignedTo || '');
  const [isExpanded, setIsExpanded] = useState(false); // Both admin and user cards start collapsed
  const [editingPayment, setEditingPayment] = useState(false);
  const [paymentInput, setPaymentInput] = useState<string>(String(card.paymentPercent ?? 0));

  // All departments are always assignable — any user can send to any dept
  const assignableDepts: Department[] = DEPARTMENTS;
  const assignableUsers = assignDeptFilter
    ? users.filter(u => u.department === assignDeptFilter)
    : users;

  const loadUsers = () => {
    getAppData().then(data => {
      const mapped: AppUser[] = data.users.map(u => ({
        name:       u.username,
        pin:        u.pin,
        department: (u.depName as Department) ?? undefined,
      }));
      setUsers(mapped);
    }).catch(err => console.error('Error loading users:', err));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setPendingAssignee(card.assignedTo || '');
  }, [card.assignedTo]);

  useEffect(() => {
    setPaymentInput(String(card.paymentPercent ?? 0));
  }, [card.paymentPercent]);

  const isWorkOrderCard = card.channel === 'Work Order';
  const canViewPayment = isWorkOrderCard && (userRole === 'admin' || userDepartment === 'Accounts');
  const canAdjustPayment = isWorkOrderCard && userRole === 'user' && userDepartment === 'Accounts';
  const paymentPercent = Math.max(0, Math.min(100, Number(card.paymentPercent ?? 0)));
  const paymentHue = Math.round((paymentPercent / 100) * 120); // red(0) -> green(120)
  const paymentColor = `hsl(${paymentHue} 78% 40%)`;
  const paymentTrack = `conic-gradient(${paymentColor} ${paymentPercent * 3.6}deg, #e5e7eb ${paymentPercent * 3.6}deg)`;
  const normalizedCurrentList = normalizeListType(currentList);
  const isScheduledWorkOrderCard = isWorkOrderCard && normalizedCurrentList === 'Schedule';
  const scheduleStageLabel = isScheduledWorkOrderCard
    ? (card.scheduleStage ?? (card.scheduleType === 'Installation' ? 'Pending installation' : 'Pending delivery'))
    : '';

  const toEpoch = (value?: string) => {
    const ms = Date.parse(value ?? '');
    return Number.isNaN(ms) ? 0 : ms;
  };

  const getLatestRemarkForList = (remarks: Card['remarks'], list: ListType) => {
    const listRemarks = remarks.filter(r => normalizeListType(r.list) === list);
    if (listRemarks.length === 0) return null;

    return listRemarks.reduce((latest, current) => {
      const currentCreated = toEpoch(current.createdAt);
      const latestCreated = toEpoch(latest.createdAt);
      if (currentCreated !== latestCreated) {
        return currentCreated > latestCreated ? current : latest;
      }

      const currentUpdated = toEpoch(current.updatedAt);
      const latestUpdated = toEpoch(latest.updatedAt);
      if (currentUpdated !== latestUpdated) {
        return currentUpdated > latestUpdated ? current : latest;
      }

      // Deterministic tie-breaker: prefer later array entry (newer append order).
      return current;
    });
  };

  const getLatestRemarkOverall = (remarks: Card['remarks']) => {
    if (remarks.length === 0) return null;
    return remarks.reduce((latest, current) => {
      const currentCreated = toEpoch(current.createdAt);
      const latestCreated = toEpoch(latest.createdAt);
      if (currentCreated !== latestCreated) {
        return currentCreated > latestCreated ? current : latest;
      }

      const currentUpdated = toEpoch(current.updatedAt);
      const latestUpdated = toEpoch(latest.updatedAt);
      if (currentUpdated !== latestUpdated) {
        return currentUpdated > latestUpdated ? current : latest;
      }

      return current;
    });
  };

  const handleSavePayment = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onUpdateCard) return;
    const parsed = Number(paymentInput);
    const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
    onUpdateCard({ ...card, paymentPercent: clamped, updatedAt: new Date().toISOString() });
    setPaymentInput(String(clamped));
    setEditingPayment(false);
  };

  const getCardColor = () => {
    // Highest-priority overrides
    if (card.completedAt) return 'bg-green-50 border-l-4 border-l-green-500';
    if (card.terminated)  return 'bg-gray-200 border-l-4 border-l-gray-500';

    const isQuotationChannel = ['Quotation', 'Submittal', 'Review', 'LPO'].includes(normalizedCurrentList);
    const isWOChannel = isWorkOrderList(normalizedCurrentList);

    // ── Quotation channel: approved = green, remark-type based otherwise ──
    if (isQuotationChannel) {
      if (card.approved) return 'bg-green-100 border-l-4 border-l-green-500';
      const latestRemark = getLatestRemarkForList(card.remarks, normalizedCurrentList);
      if (!latestRemark) return 'bg-white';
      switch (latestRemark.type) {
        case 'Active':   return 'border-l-4 border-l-red-500 bg-red-100';
        case 'Pending':  return 'border-l-4 border-l-yellow-500 bg-yellow-50';
        case 'Inactive': return 'border-l-4 border-l-blue-500 bg-blue-100';
        default:         return 'bg-white';
      }
    }

    // ── Work Order channel ──
    if (isWOChannel) {
      // Schedule-type colour coding (Delivery = amber, Installation = teal)
      if (card.scheduleType === 'Delivery') return 'bg-amber-50 border-l-4 border-l-amber-500';
      if (card.scheduleType === 'Installation') return 'bg-teal-50 border-l-4 border-l-teal-500';
      // Came from Quotation channel (LPO approved → cloned) → light orange
      if (card.approved) return 'bg-orange-50 border-l-4 border-l-orange-400';
      // Created directly in Work Order channel → light purple
      return 'bg-purple-50 border-l-4 border-l-purple-400';
    }

    return 'bg-white';
  };

  const isWOList = isWorkOrderList(normalizedCurrentList);

  const getStatusBadge = () => {
    // Work Order channel cards don't use remark-status badges
    if (isWOList) return null;

    const latestRemark = getLatestRemarkForList(card.remarks, normalizedCurrentList);
    if (!latestRemark) return null;

    const colors = {
      Active: 'bg-red-500 text-white',
      Pending: 'bg-yellow-500 text-white',
      Inactive: 'bg-blue-500 text-white',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[latestRemark.type]}`}>
        {latestRemark.type}
      </span>
    );
  };

  const getLatestListRemark = () => {
    return getLatestRemarkForList(card.remarks, normalizedCurrentList);
  };

  const getWorkStatusColor = (status?: UserWorkStatus) => {
    switch (status) {
      case 'Assigned':
        return 'bg-blue-100 text-blue-700';
      case 'Working':
        return 'bg-orange-100 text-orange-700';
      case 'Completed':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-blue-100 text-blue-700';
    }
  };

  const formatRemarkTimestamp = (timestamp: string) => {
    const ms = toEpoch(timestamp);
    if (ms === 0) return timestamp || 'Unknown time';
    return format(new Date(ms), 'dd/MM/yyyy, HH:mm:ss');
  };

  const latestListRemark = getLatestListRemark();
  const latestPreviewRemark = getLatestRemarkOverall(card.remarks);
  const assignmentTrail = (card.assignmentHistory ?? []).filter((entry, idx, arr) => {
    if (idx === 0) return true;
    const prev = arr[idx - 1];
    return !(prev.assignedTo === entry.assignedTo && prev.assignedBy === entry.assignedBy && prev.assignedAt === entry.assignedAt);
  });
  const lastSentBy = assignmentTrail.length > 0 ? (assignmentTrail[assignmentTrail.length - 1].assignedBy || assignmentTrail[assignmentTrail.length - 1].assignedTo) : undefined;

  const handleCardClick = (e: React.MouseEvent) => {
    // Toggle expansion state for both admin and user
    setIsExpanded(!isExpanded);
  };

  const cardColorClasses = getCardColor();
  const bgClass = ''; // bg is always part of cardColorClasses

  return (
    <Draggable draggableId={card.id} index={index} isDragDisabled={false}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={handleCardClick}
          className={`${cardColorClasses} ${bgClass} rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden ${
            snapshot.isDragging ? 'shadow-2xl scale-105 rotate-2' : ''
          } ${isExpanded ? 'p-4' : 'p-2'}`}
        >
      {/* Condensed View (Collapsed) */}
      {!isExpanded ? (
        <div className="flex items-center justify-between gap-2 min-h-0 py-1">
          <div className="font-semibold text-gray-800 text-xs truncate flex-shrink">
            {card.channel === 'Work Order'
              ? `${card.companyCode || 'GRP'}/${card.workOrderNumber || '0000'}`
              : card.quoteNumber}
            {card.revisionNumber != null && (
              <span className="ml-1 px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">R{card.revisionNumber}</span>
            )}
            {isScheduledWorkOrderCard && card.scheduleType && (
              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${card.scheduleType === 'Delivery' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {card.scheduleType}
              </span>
            )}
            {isScheduledWorkOrderCard && scheduleStageLabel && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">
                {scheduleStageLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canViewPayment && (
              <span
                className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white"
                style={{ backgroundColor: paymentColor }}
                title="Payment received"
              >
                {paymentPercent}%
              </span>
            )}
            {userRole === 'admin' && card.assignedTo && !isScheduledWorkOrderCard && (
              <div className="flex flex-col items-end leading-tight">
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                  {card.assignedTo}
                </span>
                {lastSentBy && (
                  <span className="mt-0.5 text-[9px] text-gray-400">
                    by {lastSentBy}
                  </span>
                )}
              </div>
            )}
            {card.userWorkStatus && !isScheduledWorkOrderCard && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${getWorkStatusColor(card.userWorkStatus)}`}>
                {card.userWorkStatus}
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Full/Expanded View */
        <>
      <div className="flex items-start justify-between mb-2">
        <div className="font-semibold text-gray-800 text-sm truncate flex-1 min-w-0">
          {card.channel === 'Work Order'
            ? `${card.companyCode || 'GRP'}/${card.workOrderNumber || '0000'}`
            : card.quoteNumber}
          {card.revisionNumber != null && (
            <span className="ml-1.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">R{card.revisionNumber}</span>
          )}
          {isScheduledWorkOrderCard && card.scheduleType && (
            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs font-bold ${card.scheduleType === 'Delivery' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {card.scheduleType}
            </span>
          )}
          {isScheduledWorkOrderCard && scheduleStageLabel && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-700">
              {scheduleStageLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick(); // Opens the modal
            }}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 text-gray-500" />
          </button>
          {userRole === 'admin' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this card?')) {
                  onDelete();
                }
              }}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Assignment / status controls row */}
      {!isScheduledWorkOrderCard && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {getStatusBadge()}
          {onAssignUser && !isScheduledWorkOrderCard && (
          <>
            {assignableDepts.length > 0 && (
              <select
                value={assignDeptFilter}
                onChange={(e) => { e.stopPropagation(); setAssignDeptFilter(e.target.value as Department | ''); }}
                onClick={(e) => e.stopPropagation()}
                className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs font-medium outline-none cursor-pointer hover:bg-blue-100 max-w-full"
              >
                <option value="">All Depts</option>
                {assignableDepts.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            )}
            <select
              value={pendingAssignee}
              onChange={(e) => { e.stopPropagation(); setPendingAssignee(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-xs font-medium outline-none cursor-pointer hover:bg-purple-100 max-w-full"
            >
              <option value="">Unassigned</option>
              {assignableUsers.map(user => (
                <option key={user.name} value={user.name}>{user.name}</option>
              ))}
            </select>
            {/* Send button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssignUser(card.id, pendingAssignee || undefined);
                setPendingAssignee('');
                setAssignDeptFilter('');
              }}
              className="p-1 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition-colors flex-shrink-0"
              title="Send card to selected user"
            >
              <Send className="w-3 h-3" />
            </button>
            {userRole === 'admin' && card.assignedTo && (
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                {card.assignedTo}
              </span>
            )}
            {card.assignedTo && card.userWorkStatus && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getWorkStatusColor(card.userWorkStatus)}`}>
                {card.userWorkStatus}
              </span>
            )}
            {lastSentBy && (
              <span className="text-[10px] text-gray-400 ml-1">
                sent by {lastSentBy}
              </span>
            )}
          </>
          )}
          {userRole === 'user' && onUpdateWorkStatus && !isScheduledWorkOrderCard && (
          // Lock status display only for terminated cards, or approved Quotation-channel cards
          (card.terminated || (card.approved && !isWOList)) ? (
            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getWorkStatusColor(card.userWorkStatus)}`}>
              {card.userWorkStatus || 'Assigned'}
            </span>
          ) : (
            /* Sliding pill toggle: Assigned | Working */
            <div
              className="flex items-center bg-gray-100 rounded-full text-xs border border-gray-200 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => { e.stopPropagation(); onUpdateWorkStatus(card.id, 'Assigned'); }}
                className={`px-2.5 py-0.5 rounded-full font-medium transition-all ${
                  (card.userWorkStatus || 'Assigned') !== 'Working'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Assigned
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onUpdateWorkStatus(card.id, 'Working'); }}
                className={`px-2.5 py-0.5 rounded-full font-medium transition-all ${
                  card.userWorkStatus === 'Working'
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Working
              </button>
            </div>
          )
        )}
        </div>
      )}

      {canViewPayment && (
        <div className="mb-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="relative w-8 h-8 rounded-full" style={{ background: paymentTrack }}>
            <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center">
              <span className="text-[9px] font-semibold text-gray-700">{paymentPercent}</span>
            </div>
          </div>
          <span className="text-[11px] text-gray-600 font-medium">Payment Received</span>

          {canAdjustPayment && onUpdateCard && !editingPayment && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingPayment(true); }}
              className="ml-1 px-2 py-0.5 text-[10px] font-semibold rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              title="Adjust payment percent"
            >
              Adjust %
            </button>
          )}

          {canAdjustPayment && onUpdateCard && editingPayment && (
            <>
              <input
                type="number"
                min={0}
                max={100}
                value={paymentInput}
                onChange={(e) => setPaymentInput(e.target.value)}
                className="w-16 px-2 py-0.5 text-[11px] border border-gray-300 rounded"
              />
              <button
                onClick={handleSavePayment}
                className="px-2 py-0.5 text-[10px] font-semibold rounded border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Save
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingPayment(false); setPaymentInput(String(paymentPercent)); }}
                className="px-2 py-0.5 text-[10px] font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {latestPreviewRemark ? (
        <div className="space-y-2 text-xs text-gray-600">
          <div className="text-gray-700 leading-relaxed">
            {latestPreviewRemark.description}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-2">
            <User className="w-3 h-3" />
            <span>by {latestPreviewRemark.createdBy}</span>
            <span className="text-gray-400">•</span>
            <span>{formatRemarkTimestamp(latestPreviewRemark.createdAt)}</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic">
          No remarks for this list yet
        </div>
      )}

      {/* Completion doc for Installation list */}
      {normalizedCurrentList === 'Installation' && (
        <div className="mt-2">
          {card.completionDocName && (card.completionDocData || card.completionDocUrl) ? (
            <a
              href={docUrl(card.completionDocData || card.completionDocUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
            >
              ✅ Completion Doc ({card.completionDocName})
            </a>
          ) : userRole === 'admin' && !card.completedAt ? (
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-emerald-700 transition-colors">
              <FileText className="w-3.5 h-3.5" />
              <span>Upload Completion Doc</span>
              <input
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onClick={(e) => e.stopPropagation()}
                onChange={async (e) => {
                  e.stopPropagation();
                  const file = e.target.files?.[0];
                  if (!file || !onUpdateCard) return;
                  try {
                    const uid = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
                    const perf = uid ? Number(uid) : undefined;
                    const { fileName, url } = await import('@/lib/api').then(m => m.uploadDocument(card.id, 'completion', file, perf));
                    onUpdateCard({ ...card, completionDocName: fileName, completionDocUrl: url, completionDocData: undefined, updatedAt: new Date().toISOString() });
                  } catch (err) {
                    alert(`Upload failed: ${(err as Error).message}`);
                  }
                }}
              />
            </label>
          ) : null}
        </div>
      )}

      {/* Card Action Buttons */}
      {(userRole === 'admin' || card.channel === 'Quotation') && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2 flex-wrap">
          {card.channel === 'Quotation' && currentList === 'LPO' && !card.approved && onApprove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApprove(card.id);
              }}
              disabled={!card.purchaseOrderDocData && !card.purchaseOrderDocUrl}
              title={(!card.purchaseOrderDocData && !card.purchaseOrderDocUrl) ? 'Upload purchase order document first' : 'Approve card'}
              className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                (card.purchaseOrderDocData || card.purchaseOrderDocUrl)
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-gray-300 text-gray-600 cursor-not-allowed'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Approve
            </button>
          )}
          {card.channel === 'Quotation' && card.approved && currentList === 'LPO' && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded text-xs font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Approved
            </span>
          )}
          {/* Completed button — Installation list only, requires completion doc */}
          {normalizedCurrentList === 'Installation' && !card.completedAt && onComplete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onComplete(card.id);
              }}
              disabled={!card.completionDocData && !card.completionDocUrl}
              title={(!card.completionDocData && !card.completionDocUrl) ? 'Upload completion document first' : 'Mark as completed'}
              className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                (card.completionDocData || card.completionDocUrl)
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Mark Completed
            </button>
          )}
          {normalizedCurrentList === 'Installation' && card.completedAt && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded text-xs font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Completed
            </span>
          )}
          {card.channel === 'Quotation' && latestListRemark?.type === 'Inactive' && !card.terminated && onTerminate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTerminate(card.id);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs font-medium transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              Terminate
            </button>
          )}
          {card.channel === 'Quotation' && card.terminated && latestListRemark?.type === 'Inactive' && onUnterminate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnterminate(card.id);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              Redo
            </button>
          )}
          {/* Revise button — Quotation channel, any list, not approved, not terminated */}
          {card.channel === 'Quotation' && !card.approved && !card.terminated && onRevise && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRevise(card.id);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-xs font-medium transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Revise
            </button>
          )}
        </div>
      )}

      {/* Admin Assignment Timeline */}
      {userRole === 'admin' && (assignmentTrail.length > 0) && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Assignment Trail</p>
          <div className="relative pl-3 space-y-1.5 before:absolute before:left-[5px] before:top-0 before:bottom-0 before:w-px before:bg-gray-200">
            <div className="flex items-center gap-2">
              <div className="absolute left-0 w-2.5 h-2.5 bg-gray-300 rounded-full border-2 border-white"></div>
              <span className="text-[10px] text-gray-400 ml-1">Created · {format(new Date(card.createdAt), 'dd/MM/yy HH:mm')}</span>
            </div>
            {assignmentTrail.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="absolute left-0 w-2.5 h-2.5 bg-indigo-400 rounded-full border-2 border-white"></div>
                <span className="text-[10px] text-gray-600 ml-1">
                  {h.action ? (
                    <>
                      <span className="font-semibold text-indigo-700">{h.action}</span>
                      {h.assignedBy && <span className="text-gray-400"> by {h.assignedBy}</span>}
                      {h.assignedTo && <span className="text-gray-400"> · on {h.assignedTo}</span>}
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-indigo-700">{h.assignedTo}</span>
                      {h.assignedBy && <span className="text-gray-400"> ← {h.assignedBy}</span>}
                    </>
                  )}
                  <span className="text-gray-400"> · {format(new Date(h.assignedAt), 'dd/MM/yy HH:mm')}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}
        </div>
      )}
    </Draggable>
  );
}
