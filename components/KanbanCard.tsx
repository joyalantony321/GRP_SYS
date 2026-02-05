import { useState, useEffect } from 'react';
import { Edit2, Trash2, Clock, User, CheckCircle, XCircle } from 'lucide-react';
import { Card, ListType, RemarkType, AppUser, UserWorkStatus } from '@/types';
import { formatDistanceToNow, format } from 'date-fns';
import { Draggable } from '@hello-pangea/dnd';

interface Props {
  card: Card;
  index: number;
  onClick: () => void;
  onDelete: () => void;
  onApprove?: (cardId: string) => void;
  onTerminate?: (cardId: string) => void;
  onUnterminate?: (cardId: string) => void;
  onAssignUser?: (cardId: string, userName: string | undefined) => void;
  onUpdateWorkStatus?: (cardId: string, status: UserWorkStatus) => void;
  userRole: 'admin' | 'user';
  currentList: ListType;
}

export default function KanbanCard({ card, index, onClick, onDelete, onApprove, onTerminate, onUnterminate, onAssignUser, onUpdateWorkStatus, userRole, currentList }: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);

  const loadUsers = () => {
    const appDataStr = localStorage.getItem('appData');
    if (appDataStr) {
      try {
        const appData = JSON.parse(appDataStr);
        setUsers(appData.users || []);
      } catch (error) {
        console.error('Error loading users:', error);
      }
    }
  };

  useEffect(() => {
    loadUsers();
    
    // Listen for storage changes to update users list when admin panel modifies it
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'appData') {
        loadUsers();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const getCardColor = () => {
    const listRemarks = card.remarks.filter(r => r.list === currentList);
    if (listRemarks.length === 0) return '';

    const latestRemark = listRemarks[listRemarks.length - 1];

    // PERMANENT: Maximum brightness for card backgrounds - DO NOT CHANGE
    switch (latestRemark.type) {
      case 'Active':
        return 'border-l-4 border-l-red-600 bg-red-400'; // Maximum bright red
      case 'Pending':
        return 'border-l-4 border-l-yellow-500 bg-yellow-100';
      case 'Inactive':
        return 'border-l-4 border-l-blue-600 bg-blue-400'; // Maximum bright blue
      default:
        return '';
    }
  };

  const getStatusBadge = () => {
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

  return (
    <Draggable draggableId={card.id} index={index} isDragDisabled={userRole !== 'admin'}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={`bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all cursor-pointer ${
            snapshot.isDragging ? 'shadow-2xl scale-105 rotate-2' : ''
          } ${getCardColor()}`}
        >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 text-sm mb-2">
            {card.quoteNumber}
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            {userRole === 'admin' && onAssignUser && (
              <>
                <select
                  value={card.assignedTo || ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    onAssignUser(card.id, e.target.value || undefined);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium border-none outline-none cursor-pointer hover:bg-purple-200"
                >
                  <option value="">Unassigned</option>
                  {users.map(user => (
                    <option key={user.name} value={user.name}>
                      {user.name}
                    </option>
                  ))}
                </select>
                {card.assignedTo && card.userWorkStatus && (
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getWorkStatusColor(card.userWorkStatus)}`}>
                    {card.userWorkStatus}
                  </span>
                )}
              </>
            )}
            {userRole === 'user' && onUpdateWorkStatus && (
              <select
                value={card.userWorkStatus || 'Assigned'}
                onChange={(e) => {
                  e.stopPropagation();
                  onUpdateWorkStatus(card.id, e.target.value as UserWorkStatus);
                }}
                onClick={(e) => e.stopPropagation()}
                className={`px-2 py-1 rounded-full text-xs font-medium border-none outline-none cursor-pointer ${getWorkStatusColor(card.userWorkStatus)}`}
              >
                <option value="Assigned">Assigned</option>
                <option value="Working">Working</option>
                <option value="Completed">Completed</option>
              </select>
            )}
          </div>
        </div>
        {userRole === 'admin' && (
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5 text-gray-500" />
            </button>
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
          </div>
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

      {/* Admin Action Buttons */}
      {userRole === 'admin' && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
          {currentList === 'LPO' && !card.approved && onApprove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApprove(card.id);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium transition-colors"
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
        </div>
      )}
        </div>
      )}
    </Draggable>
  );
}
