import { useState, useEffect } from 'react';
import { Edit2, Trash2, Clock, User, CheckCircle, XCircle, FileText } from 'lucide-react';
import { Card, ListType, RemarkType, AppUser, UserWorkStatus, Department, ChannelType, getDepartmentsForList } from '@/types';
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
  const [isExpanded, setIsExpanded] = useState(false); // Both admin and user cards start collapsed

  // Compute departments and users available for assignment
  const cardChannel = card.channel as ChannelType | undefined;
  const assignableDepts = cardChannel ? getDepartmentsForList(cardChannel, currentList) : [];
  const assignableUsers = assignDeptFilter
    ? users.filter(u => u.department === assignDeptFilter)
    : users;

  const isDeliveryInstallation = userRole !== 'admin' && userDepartment === 'Delivery & Installation';

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

  const getCardColor = () => {
    // Highest-priority overrides
    if (card.completedAt) return 'bg-green-50 border-l-4 border-l-green-500';
    if (card.terminated)  return 'bg-gray-200 border-l-4 border-l-gray-500';

    const isQuotationChannel = ['Quotation', 'Submittal', 'Review', 'LPO'].includes(currentList);
    const isWOChannel = ['Work Order', 'Accounts', 'Delivery', 'Installation'].includes(currentList);

    // ── Quotation channel: approved = green, remark-type based otherwise ──
    if (isQuotationChannel) {
      if (card.approved) return 'bg-green-100 border-l-4 border-l-green-500';
      const listRemarks = card.remarks.filter(r => r.list === currentList);
      const latestRemark = listRemarks[listRemarks.length - 1];
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
      // Came from Quotation channel (LPO approved → cloned) → light orange
      if (card.approved) return 'bg-orange-50 border-l-4 border-l-orange-400';
      // Created directly in Work Order channel → light purple
      return 'bg-purple-50 border-l-4 border-l-purple-400';
    }

    return 'bg-white';
  };

  const isWOList = ['Work Order', 'Accounts', 'Delivery', 'Installation'].includes(currentList);

  const getStatusBadge = () => {
    // Work Order channel cards don't use remark-status badges
    if (isWOList) return null;

    const listRemarks = card.remarks.filter(r => r.list === currentList);
    if (listRemarks.length === 0) return null;

    const latestRemark = listRemarks[listRemarks.length - 1];

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
    const listRemarks = card.remarks.filter(r => r.list === currentList);
    if (listRemarks.length === 0) return null;
    return listRemarks[listRemarks.length - 1];
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
    return format(new Date(timestamp), 'dd/MM/yyyy, HH:mm:ss');
  };

  const hasRemarks = card.remarks.filter(r => r.list === currentList).length > 0;
  const latestListRemark = getLatestListRemark();

  const handleCardClick = (e: React.MouseEvent) => {
    // Toggle expansion state for both admin and user
    setIsExpanded(!isExpanded);
  };

  const cardColorClasses = getCardColor();
  const bgClass = ''; // bg is always part of cardColorClasses

  return (
    <Draggable draggableId={card.id} index={index} isDragDisabled={userRole !== 'admin'}>
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
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {userRole === 'admin' && card.assignedTo && (
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                {card.assignedTo}
              </span>
            )}
            {card.userWorkStatus && (
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
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {getStatusBadge()}
        {userRole === 'admin' && onAssignUser && (
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
              value={card.assignedTo || ''}
              onChange={(e) => {
                e.stopPropagation();
                onAssignUser(card.id, e.target.value || undefined);
              }}
              onClick={(e) => e.stopPropagation()}
              className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-xs font-medium outline-none cursor-pointer hover:bg-purple-100 max-w-full"
            >
              <option value="">Unassigned</option>
              {assignableUsers.map(user => (
                <option key={user.name} value={user.name}>{user.name}</option>
              ))}
            </select>
            {card.assignedTo && card.userWorkStatus && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getWorkStatusColor(card.userWorkStatus)}`}>
                {card.userWorkStatus}
              </span>
            )}
          </>
        )}
        {userRole === 'user' && onUpdateWorkStatus && (
          // Lock status display only for terminated cards, or approved Quotation-channel cards
          (card.terminated || (card.approved && !isWOList)) ? (
            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getWorkStatusColor(card.userWorkStatus)}`}>
              {card.userWorkStatus || 'Assigned'}
            </span>
          ) : (
            <select
              value={card.userWorkStatus || 'Assigned'}
              onChange={(e) => {
                e.stopPropagation();
                onUpdateWorkStatus(card.id, e.target.value as UserWorkStatus);
              }}
              onClick={(e) => e.stopPropagation()}
              className={`px-2 py-0.5 rounded text-xs font-medium border outline-none cursor-pointer ${getWorkStatusColor(card.userWorkStatus)}`}
            >
              <option value="Assigned">Assigned</option>
              <option value="Working">Working</option>
              <option value="Completed">Completed</option>
            </select>
          )
        )}
      </div>

      {latestListRemark ? (
        <div className="space-y-2 text-xs text-gray-600">
          <div className="text-gray-700 leading-relaxed">
            {latestListRemark.description}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-2">
            <User className="w-3 h-3" />
            <span>by {latestListRemark.createdBy}</span>
            <span className="text-gray-400">•</span>
            <span>{formatRemarkTimestamp(latestListRemark.createdAt)}</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic">
          No remarks for this list yet
        </div>
      )}

      {card.purchaseOrderDocName && (card.purchaseOrderDocData || card.purchaseOrderDocUrl) && !isDeliveryInstallation && (
        <div className="mt-3">
          <a
            href={docUrl(card.purchaseOrderDocData || card.purchaseOrderDocUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-amber-700 hover:text-amber-900"
          >
            📄 Purchase Order ({card.purchaseOrderDocName})
          </a>
        </div>
      )}

      {card.quotationDocName && (card.quotationDocData || card.quotationDocUrl) && !isDeliveryInstallation && (
        <div className="mt-1">
          <a
            href={docUrl(card.quotationDocData || card.quotationDocUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-purple-700 hover:text-purple-900"
          >
            📄 Quotation ({card.quotationDocName})
          </a>
        </div>
      )}

      {/* Completion doc for Installation list */}
      {currentList === 'Installation' && (
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

      {/* Admin Action Buttons */}
      {userRole === 'admin' && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2 flex-wrap">
          {currentList === 'LPO' && !card.approved && onApprove && (
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
          {card.approved && currentList === 'LPO' && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded text-xs font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Approved
            </span>
          )}
          {/* Completed button — Installation list only, requires completion doc */}
          {currentList === 'Installation' && !card.completedAt && onComplete && (
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
          {currentList === 'Installation' && card.completedAt && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded text-xs font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Completed
            </span>
          )}
          {latestListRemark?.type === 'Inactive' && !card.terminated && onTerminate && (
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
          {card.terminated && latestListRemark?.type === 'Inactive' && onUnterminate && (
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
        </>
      )}
        </div>
      )}
    </Draggable>
  );
}
