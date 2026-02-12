import { useState, useMemo, useEffect } from 'react';
import { Search, Filter, Plus, LayoutGrid, Table as TableIcon, BarChart3, Edit2, Trash2, User, Settings, Calendar } from 'lucide-react';
import { Card as CardType, ListType, RemarkType, UserWorkStatus, AppUser } from '@/types';
import KanbanList from './KanbanList';
import CardModal from './CardModal';
import { differenceInDays, differenceInWeeks, differenceInMonths, parseISO, format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from 'date-fns';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';

interface Props {
  cards: CardType[];
  setCards: (cards: CardType[]) => void;
  userRole: 'admin' | 'user';
  userName: string;
  onAdminSettings?: () => void;
}

type ViewMode = 'kanban' | 'table' | 'gantt';
type DateFilter = 'all' | 'day' | 'week' | 'month';
type RemarkFilter = 'all' | 'Active' | 'Pending' | 'Inactive' | 'Terminated' | 'Approved';

export default function KanbanBoard({ cards, setCards, userRole, userName, onAdminSettings }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [dateFilter, setDateFilter] = useState<DateFilter>('day');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [specificDate, setSpecificDate] = useState<string>('');
  
  // New filter states
  const [userFilter, setUserFilter] = useState<string>('all');
  const [workStatusFilter, setWorkStatusFilter] = useState<string>('all');
  const [remarkTypeFilter, setRemarkTypeFilter] = useState<RemarkFilter>('all');
  const [users, setUsers] = useState<AppUser[]>([]);

  const lists: ListType[] = ['Quotation', 'Submittal', 'Review', 'LPO'];

  // Load users from localStorage
  useEffect(() => {
    const appDataStr = localStorage.getItem('appData');
    if (appDataStr) {
      try {
        const appData = JSON.parse(appDataStr);
        setUsers(appData.users || []);
      } catch (error) {
        console.error('Error loading users:', error);
      }
    }
  }, []);

  const filterCardsByDate = (cards: CardType[]) => {
    // If specific date is selected, filter by that date
    if (specificDate) {
      const selectedDate = parseISO(specificDate);
      return cards.filter(card => {
        const cardDate = parseISO(card.date);
        
        // Terminated/Approved cards: only show on their creation date, not future days
        if (card.terminated || card.approved) {
          return format(cardDate, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
        }
        
        return format(cardDate, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
      });
    }

    if (dateFilter === 'all') return cards;

    const now = new Date();
    return cards.filter(card => {
      const cardDate = parseISO(card.date);
      
      // Terminated/Approved cards: only show on their creation date when filtering by today
      if (card.terminated || card.approved) {
        // Only show if the card date matches today or the date filter period
        switch (dateFilter) {
          case 'day':
            return differenceInDays(now, cardDate) <= 1;
          case 'week':
            return differenceInWeeks(now, cardDate) <= 1;
          case 'month':
            return differenceInMonths(now, cardDate) <= 1;
          default:
            return true;
        }
      }

      // Regular cards follow normal date filtering
      switch (dateFilter) {
        case 'day':
          return differenceInDays(now, cardDate) <= 1;
        case 'week':
          return differenceInWeeks(now, cardDate) <= 1;
        case 'month':
          return differenceInMonths(now, cardDate) <= 1;
        default:
          return true;
      }
    });
  };

  const filteredCards = useMemo(() => {
    let filtered = cards;

    // Filter by user assignment (regular users only see their assigned cards)
    if (userRole === 'user') {
      // Users see cards from when assigned until reassigned or terminated/approved
      filtered = filtered.filter(card => {
        // Must be assigned to this user
        if (card.assignedTo !== userName) return false;
        
        // Show the card regardless of date/remarks if assigned and active
        return true;
      });
      
      // Apply date filtering for terminated/approved cards only
      const now = new Date();
      filtered = filtered.filter(card => {
        // If terminated or approved, only show on the same day (don't carry forward)
        if (card.terminated || card.approved) {
          const cardDate = parseISO(card.date);
          // Show only if within today (or current date filter)
          if (dateFilter === 'day') {
            return differenceInDays(now, cardDate) <= 1;
          } else if (specificDate) {
            return format(cardDate, 'yyyy-MM-dd') === format(parseISO(specificDate), 'yyyy-MM-dd');
          }
          // For other filters, show if within the date range
          return format(cardDate, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
        }
        // Active cards (not terminated/approved) always show
        return true;
      });
    } else {
      // Admin filtering - apply date filter
      filtered = filterCardsByDate(filtered);
    }

    // Apply user filter (admin only)
    if (userRole === 'admin' && userFilter !== 'all') {
      if (userFilter === 'unassigned') {
        filtered = filtered.filter(card => !card.assignedTo);
      } else {
        filtered = filtered.filter(card => card.assignedTo === userFilter);
      }
    }

    // Apply work status filter
    if (workStatusFilter !== 'all') {
      filtered = filtered.filter(card => card.userWorkStatus === workStatusFilter);
    }

    // Apply remark type filter
    if (remarkTypeFilter !== 'all') {
      if (remarkTypeFilter === 'Terminated') {
        filtered = filtered.filter(card => card.terminated);
      } else if (remarkTypeFilter === 'Approved') {
        filtered = filtered.filter(card => card.approved);
      } else {
        // For Active/Pending/Inactive, exclude terminated and approved cards
        filtered = filtered.filter(card => {
          // Exclude terminated or approved cards
          if (card.terminated || card.approved) return false;
          
          const latestRemark = card.remarks.length > 0 ? card.remarks[card.remarks.length - 1] : null;
          return latestRemark?.type === remarkTypeFilter;
        });
      }
    }

    if (quoteSearch) {
      filtered = filtered.filter(card =>
        card.quoteNumber.toLowerCase().includes(quoteSearch.toLowerCase())
      );
    }

    return filtered;
  }, [cards, quoteSearch, dateFilter, specificDate, userRole, userName, userFilter, workStatusFilter, remarkTypeFilter]);

  const handleUpdateCard = (updatedCard: CardType) => {
    const updatedCards = cards.map(card =>
      card.id === updatedCard.id ? updatedCard : card
    );
    setCards(updatedCards);
    setSelectedCard(updatedCard);
  };

  const handleDeleteCard = (cardId: string) => {
    const updatedCards = cards.filter(card => card.id !== cardId);
    setCards(updatedCards);
    setSelectedCard(null);
  };

  const handleAddCard = (list: ListType) => {
    const newCard: CardType = {
      id: Date.now().toString(),
      quoteNumber: `NEW/${new Date().getFullYear()}/${Math.floor(Math.random() * 10000)}`,
      date: new Date().toISOString().split('T')[0],
      salesPerson: '',
      subject: '',
      projectLocation: '',
      list: list,
      remarks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCards([...cards, newCard]);
    setSelectedCard(newCard);
  };

  const handleApproveCard = (cardId: string) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, approved: true } : card
    );
    setCards(updatedCards);
  };

  const handleTerminateCard = (cardId: string) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, terminated: true } : card
    );
    setCards(updatedCards);
  };

  const handleUnterminateCard = (cardId: string) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, terminated: false } : card
    );
    setCards(updatedCards);
  };

  const handleAssignUser = (cardId: string, userName: string | undefined) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, assignedTo: userName, userWorkStatus: 'Assigned' as UserWorkStatus } : card
    );
    setCards(updatedCards);
  };

  const handleUpdateWorkStatus = (cardId: string, status: UserWorkStatus) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, userWorkStatus: status } : card
    );
    setCards(updatedCards);
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;

    // Card dropped outside any list
    if (!destination) return;

    // Card dropped in the same position
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    const sourceList = source.droppableId as ListType;
    const destList = destination.droppableId as ListType;
    const cardId = draggableId;

    // Find the card being moved
    const movedCard = cards.find(card => card.id === cardId);
    if (!movedCard) return;

    // Update card with new list and timestamp
    const updatedCard = {
      ...movedCard,
      list: destList,
      updatedAt: new Date().toISOString(),
    };

    const updatedCards = cards.map(card =>
      card.id === cardId ? updatedCard : card
    );

    setCards(updatedCards);

    // Update selected card if it's the one being moved
    if (selectedCard?.id === cardId) {
      setSelectedCard(updatedCard);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <LayoutGrid className="w-4 h-4" />
                <span className="font-medium">{lists.length} lists</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <span>{filteredCards.length} cards</span>
              </div>
              <div className="text-sm text-gray-500">
                <span className="font-semibold text-pink-600">{userName}{userRole === 'admin' ? '/admin' : ''}</span>
              </div>
              <div className="text-sm text-gray-500">
                <span className="mr-1">🕐</span>
                Updated just now
              </div>
            </div>

            {/* Search Cards Box and Date Filter Buttons */}
            <div className="flex items-center gap-3">
              <div className="w-96 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search Cards"
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                />
              </div>

              {/* Calendar Date Picker */}
              <div className="relative flex items-center gap-2">
                <input
                  type="date"
                  value={specificDate}
                  onChange={(e) => {
                    setSpecificDate(e.target.value);
                    if (e.target.value) {
                      setDateFilter('all'); // Reset date filter when specific date is selected
                    }
                  }}
                  className="absolute opacity-0 pointer-events-none"
                  id="calendar-date-picker"
                />
                <button
                  onClick={() => (document.getElementById('calendar-date-picker') as HTMLInputElement | null)?.showPicker?.()}
                  className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                    specificDate ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={specificDate ? `Filtered by: ${specificDate}` : 'Filter by date'}
                >
                  <Calendar className="w-4 h-4" />
                </button>
                {specificDate && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpecificDate('');
                    }}
                    className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Date Filter Buttons */}
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setDateFilter('all')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'all'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  All Time
                </button>
                <button
                  onClick={() => setDateFilter('day')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'day'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Day
                </button>
                <button
                  onClick={() => setDateFilter('week')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'week'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Week
                </button>
                <button
                  onClick={() => setDateFilter('month')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'month'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Month
                </button>
              </div>

              {/* Admin Settings Button */}
              {userRole === 'admin' && onAdminSettings && (
                <button
                  onClick={onAdminSettings}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Admin Settings"
                >
                  <Settings className="w-5 h-5 text-gray-600" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {/* View Mode Buttons */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('kanban')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'kanban'
                    ? 'bg-pink-500 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span>Kanban</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'table'
                    ? 'bg-pink-500 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <TableIcon className="w-4 h-4" />
                <span>Table</span>
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'gantt'
                    ? 'bg-pink-500 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Gantt</span>
              </button>
            </div>

            {/* Filter Controls */}
            <div className="flex items-center gap-2">
              {/* User Filter (Admin only) */}
              {userRole === 'admin' && (
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                  <option value="all">All Users</option>
                  <option value="unassigned">Unassigned</option>
                  {users.map(user => (
                    <option key={user.name} value={user.name}>{user.name}</option>
                  ))}
                </select>
              )}

              {/* Work Status Filter */}
              <select
                value={workStatusFilter}
                onChange={(e) => setWorkStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="all">All Status</option>
                <option value="Assigned">Assigned</option>
                <option value="Working">Working</option>
                <option value="Completed">Completed</option>
              </select>

              {/* Remark Type Filter */}
              <select
                value={remarkTypeFilter}
                onChange={(e) => setRemarkTypeFilter(e.target.value as RemarkFilter)}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="all">All</option>
                <option value="Active">Active</option>
                <option value="Pending">Pending</option>
                <option value="Inactive">Inactive</option>
                <option value="Terminated">Terminated</option>
                <option value="Approved">Approved</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-3">
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 h-full min-w-max">
              {lists.map(list => (
                <KanbanList
                  key={list}
                  list={list}
                  cards={filteredCards.filter(card => card.list === list)}
                  onCardClick={setSelectedCard}
                  onAddCard={() => handleAddCard(list)}
                  onDeleteCard={handleDeleteCard}
                  onApproveCard={handleApproveCard}
                  onTerminateCard={handleTerminateCard}
                  onUnterminateCard={handleUnterminateCard}
                  onAssignUser={handleAssignUser}
                  onUpdateWorkStatus={handleUpdateWorkStatus}
                  userRole={userRole}
                />
              ))}
            </div>
          </DragDropContext>
        </div>
      )}

      {viewMode === 'table' && (
        <div className="flex-1 overflow-auto p-6 bg-gray-50">
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search cards..."
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
              <div className="mt-3 text-sm text-gray-500">
                Showing {filteredCards.filter(card => 
                  cardSearch ? card.quoteNumber.toLowerCase().includes(cardSearch.toLowerCase()) : true
                ).length} of {filteredCards.length} cards
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">List</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Labels</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        Assignees
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredCards
                    .filter(card => cardSearch ? card.quoteNumber.toLowerCase().includes(cardSearch.toLowerCase()) : true)
                    .map(card => {
                      const latestRemark = card.remarks.length > 0 ? card.remarks[card.remarks.length - 1] : null;
                      const remarkType = latestRemark?.type;
                      
                      return (
                        <tr key={card.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedCard(card)}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {card.quoteNumber}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            <div className="max-w-xs truncate">
                              {latestRemark ? `Remarks : ${latestRemark.description}` : 'Remarks :'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-3 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                              {card.list}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {remarkType && (
                              <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                                remarkType === 'Active' ? 'bg-red-100 text-red-800' :
                                remarkType === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {remarkType}
                              </span>
                            )}
                            {!remarkType && <span className="text-gray-400">-</span>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {latestRemark?.tags && latestRemark.tags.length > 0 ? (
                              <div className="flex gap-1">
                                {latestRemark.tags.slice(0, 2).map((tag, i) => (
                                  <span key={i} className="px-2 py-1 text-xs bg-gray-100 rounded">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {card.date ? (
                              <div className="flex items-center gap-1 text-red-500">
                                <span className="text-red-400">⏰</span>
                                {format(parseISO(card.date), 'MMM d, yyyy')}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {latestRemark?.createdBy ? (
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-white text-xs font-medium">
                                  {latestRemark.createdBy.charAt(0).toUpperCase()}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCard(card);
                                }}
                                className="text-gray-400 hover:text-pink-600"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {userRole === 'admin' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('Are you sure you want to delete this card?')) {
                                      handleDeleteCard(card.id);
                                    }
                                  }}
                                  className="text-gray-400 hover:text-red-600"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'gantt' && (
        <div className="flex-1 overflow-auto p-6 bg-gray-50">
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="text-sm text-gray-500">
                Showing {filteredCards.filter(card => card.date).length} tasks with due dates across {lists.length} lists
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  ←
                </button>
                <div className="text-sm font-medium">
                  {format(startOfWeek(currentWeek), 'MMM d')} - {format(endOfWeek(currentWeek), 'MMM d, yyyy')}
                </div>
                <button
                  onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  →
                </button>
                <button
                  onClick={() => setCurrentWeek(new Date())}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                >
                  <span>📅</span>
                  Today
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                {/* Header with dates */}
                <div className="flex border-b border-gray-200 bg-gray-50">
                  <div className="w-48 flex-shrink-0 px-4 py-3"></div>
                  {eachDayOfInterval({
                    start: startOfWeek(currentWeek),
                    end: endOfWeek(currentWeek)
                  }).map((day, i) => (
                    <div key={i} className="flex-1 min-w-[120px] px-2 py-3 text-center border-l border-gray-200">
                      <div className="text-xs text-gray-500">{format(day, 'EEE')}</div>
                      <div className="text-sm font-medium text-gray-900">{format(day, 'd')}</div>
                    </div>
                  ))}
                </div>
                
                {/* Tasks by list */}
                {lists.map(list => {
                  const listCards = filteredCards.filter(card => card.list === list && card.date);
                  
                  return (
                    <div key={list} className="border-b border-gray-100">
                      <div className="flex items-center py-3 bg-white hover:bg-gray-50">
                        <div className="w-48 flex-shrink-0 px-4">
                          <div className="font-medium text-gray-900">{list}</div>
                          <div className="text-xs text-gray-500">{listCards.length} tasks</div>
                        </div>
                        <div className="flex-1 relative h-16">
                          {listCards.map(card => {
                            const cardDate = parseISO(card.date);
                            const weekStart = startOfWeek(currentWeek);
                            const weekEnd = endOfWeek(currentWeek);
                            
                            if (cardDate >= weekStart && cardDate <= weekEnd) {
                              const daysDiff = differenceInDays(cardDate, weekStart);
                              const leftPosition = (daysDiff / 7) * 100;
                              const latestRemark = card.remarks.length > 0 ? card.remarks[card.remarks.length - 1] : null;
                              const remarkType = latestRemark?.type;
                              
                              return (
                                <div
                                  key={card.id}
                                  className={`absolute top-2 h-10 px-3 py-1 rounded-lg text-xs text-white font-medium cursor-pointer hover:shadow-lg transition-all ${
                                    remarkType === 'Active' ? 'bg-red-500' :
                                    remarkType === 'Pending' ? 'bg-yellow-500' :
                                    remarkType === 'Inactive' ? 'bg-blue-500' :
                                    'bg-gray-400'
                                  }`}
                                  style={{
                                    left: `${leftPosition}%`,
                                    width: '15%',
                                    minWidth: '100px'
                                  }}
                                  onClick={() => setSelectedCard(card)}
                                >
                                  <div className="truncate">{card.quoteNumber}</div>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCard && (
        <CardModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
          userRole={userRole}
          userName={userName}
        />
      )}
    </div>
  );
}
