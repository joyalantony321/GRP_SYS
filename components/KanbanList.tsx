import { useState, useMemo, useEffect } from 'react';
import { Plus, MoreHorizontal, Filter } from 'lucide-react';
import { Card as CardType, ListType, RemarkType, UserWorkStatus, Department } from '@/types';
import KanbanCard from './KanbanCard';
import { Droppable } from '@hello-pangea/dnd';

interface Props {
  list: ListType;
  cards: CardType[];
  onCardClick: (card: CardType) => void;
  onAddCard: () => void;
  onDeleteCard: (cardId: string) => void;
  onApproveCard?: (cardId: string) => void;
  onTerminateCard?: (cardId: string) => void;
  onUnterminateCard?: (cardId: string) => void;
  onCompleteCard?: (cardId: string) => void;
  onUpdateCard?: (card: CardType) => void;
  onAssignUser?: (cardId: string, userName: string | undefined) => void;
  onUpdateWorkStatus?: (cardId: string, status: UserWorkStatus) => void;
  userRole: 'admin' | 'user';
  userDepartment?: Department | '';
}

export default function KanbanList({
  list,
  cards,
  onCardClick,
  onAddCard,
  onDeleteCard,
  onApproveCard,
  onTerminateCard,
  onUnterminateCard,
  onCompleteCard,
  onUpdateCard,
  onAssignUser,
  onUpdateWorkStatus,
  userRole,
  userDepartment,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<RemarkType | 'all'>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [userFilter, setUserFilter] = useState<string>('all');
  const [workStatusFilter, setWorkStatusFilter] = useState<UserWorkStatus | 'all'>('all');
  const [users, setUsers] = useState<string[]>([]);

  useEffect(() => {
    if (userRole === 'admin') {
      const appData = localStorage.getItem('appData');
      if (appData) {
        const parsedData = JSON.parse(appData);
        if (parsedData.users) {
          setUsers(parsedData.users.map((u: any) => u.name));
        }
      }
    }
  }, [userRole]);

  const filteredCards = useMemo(() => {
    return cards.filter(card => {
      // Status filter
      if (statusFilter !== 'all') {
        const listRemarks = card.remarks.filter(r => r.list === list);
        if (listRemarks.length === 0) return false;
        const latestRemark = listRemarks[listRemarks.length - 1];
        if (latestRemark.type !== statusFilter) return false;
      }

      // User filter (admin only)
      if (userRole === 'admin' && userFilter !== 'all') {
        if (card.assignedTo !== userFilter) return false;
      }

      // Work status filter
      if (workStatusFilter !== 'all') {
        if (card.userWorkStatus !== workStatusFilter) return false;
      }

      return true;
    });
  }, [cards, statusFilter, userFilter, workStatusFilter, list, userRole]);

  const getStatusBadgeColor = (status: RemarkType | 'all') => {
    switch (status) {
      case 'Active':
        return 'bg-red-500';
      case 'Pending':
        return 'bg-yellow-500';
      case 'Inactive':
        return 'bg-blue-500';
      default:
        return 'bg-pink-500';
    }
  };

  const statusCounts = useMemo(() => {
    const counts = { all: cards.length, Active: 0, Pending: 0, Inactive: 0 };
    cards.forEach(card => {
      const listRemarks = card.remarks.filter(r => r.list === list);
      if (listRemarks.length > 0) {
        const latestRemark = listRemarks[listRemarks.length - 1];
        counts[latestRemark.type]++;
      }
    });
    return counts;
  }, [cards, list]);

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className={`flex items-center justify-between ${userRole === 'admin' ? 'mb-3' : ''}`}>
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-6 bg-gray-400 rounded-full"></div>
            <h3 className="font-semibold text-gray-900 text-base">{list}</h3>
            <span className="text-sm text-gray-500 font-medium">{filteredCards.length}</span>
            {userRole === 'user' && (
              <select
                value={workStatusFilter}
                onChange={(e) => setWorkStatusFilter(e.target.value as UserWorkStatus | 'all')}
                className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="all">All Status</option>
                <option value="Assigned">Assigned</option>
                <option value="Working">Working</option>
                <option value="Completed">Completed</option>
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Filter className="w-4 h-4 text-gray-500" />
              </button>

              {showFilterMenu && (
                <div className="absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  {[
                    { value: 'all', label: 'All', count: statusCounts.all },
                    { value: 'Active', label: 'Active', count: statusCounts.Active },
                    { value: 'Pending', label: 'Pending', count: statusCounts.Inactive },
                    { value: 'Inactive', label: 'Inactive', count: statusCounts.Inactive },
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setStatusFilter(option.value as RemarkType | 'all');
                        setShowFilterMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${
                        statusFilter === option.value ? 'bg-pink-50 text-pink-600' : 'text-gray-700'
                      }`}
                    >
                      <span>{option.label}</span>
                      <span className="text-xs text-gray-400">{option.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <MoreHorizontal className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Filter dropdowns for admin */}
        {userRole === 'admin' && (
          <div className="flex items-center gap-2">
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-500"
            >
              <option value="all">All Users</option>
              {users.map(user => (
                <option key={user} value={user}>{user}</option>
              ))}
            </select>
            <select
              value={workStatusFilter}
              onChange={(e) => setWorkStatusFilter(e.target.value as UserWorkStatus | 'all')}
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-500"
            >
              <option value="all">All Status</option>
              <option value="Assigned">Assigned</option>
              <option value="Working">Working</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        )}
      </div>

      <Droppable droppableId={list}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide ${
              snapshot.isDraggingOver ? 'bg-pink-50/50' : ''
            }`}
          >
            {filteredCards.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-xl py-16 text-center">
                <p className="text-sm text-gray-400">No cards yet</p>
              </div>
            ) : (
              filteredCards.map((card, index) => (
                <KanbanCard
                  key={card.id}
                  card={card}
                  index={index}
                  onClick={() => onCardClick(card)}
                  onDelete={() => onDeleteCard(card.id)}
                  onApprove={onApproveCard}
                  onTerminate={onTerminateCard}
                  onUnterminate={onUnterminateCard}
                  onComplete={onCompleteCard}
                  onUpdateCard={onUpdateCard}
                  onAssignUser={onAssignUser}
                  onUpdateWorkStatus={onUpdateWorkStatus}
                  userRole={userRole}
                  userDepartment={userDepartment}
                  currentList={list}
                />
              ))
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {userRole === 'admin' && (
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={onAddCard}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 hover:border-gray-300"
          >
            <Plus className="w-4 h-4" />
            <span>Add Card</span>
          </button>
        </div>
      )}
    </div>
  );
}
