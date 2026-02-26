import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Filter, Plus, LayoutGrid, Table as TableIcon, BarChart3, Edit2, Trash2, User, Settings, Calendar, FileText, ClipboardList, ChevronDown, Check } from 'lucide-react';
import { Card as CardType, ListType, RemarkType, UserWorkStatus, AppUser, ChannelType, Department, CHANNEL_LISTS, CHANNEL_DEPARTMENTS, getPermittedLists } from '@/types';
import KanbanList from './KanbanList';
import CardModal from './CardModal';
import { differenceInDays, differenceInWeeks, differenceInMonths, parseISO, format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, addDays, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';

interface Props {
  cards: CardType[];
  setCards: (cards: CardType[]) => void;
  userRole: 'admin' | 'user';
  userName: string;
  userDepartment?: Department | '';
  activeChannel: ChannelType;
  accessibleChannels: ChannelType[];
  onChannelSwitch: (channel: ChannelType) => void;
  onCreateInChannel: (channel: ChannelType, card: CardType) => void;
  onAdminSettings?: () => void;
}

type ViewMode = 'kanban' | 'table' | 'gantt';
type DateFilter = 'all' | 'day' | 'week' | 'month';
type RemarkFilter = 'all' | 'Active' | 'Pending' | 'Inactive' | 'Terminated' | 'Approved' | 'Exported' | 'Created' | 'WO_Completed';

export default function KanbanBoard({ cards, setCards, userRole, userName, userDepartment, activeChannel, accessibleChannels, onChannelSwitch, onCreateInChannel, onAdminSettings }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [dateFilter, setDateFilter] = useState<DateFilter>('day');
  const [showDateDropdown, setShowDateDropdown] = useState<'day' | 'week' | 'month' | null>(null);
  // Day filter
  const [dayDate, setDayDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  // Week filter
  const [weekEndDate, setWeekEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [weekRangeDays, setWeekRangeDays] = useState<number>(7);
  // Month filter
  const [monthFilterYear, setMonthFilterYear] = useState<number>(new Date().getFullYear());
  const [monthFilterMonth, setMonthFilterMonth] = useState<number>(new Date().getMonth());
  const [quoteSearch, setQuoteSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const dateFilterRef = useRef<HTMLDivElement>(null);

  // Pre-create dialog for WO channel / Work Order list (Technical dept only)
  const [woPreCreate, setWOPreCreate] = useState<{
    list: ListType;
    poFile: { name: string; data: string; url: string } | null;
    qtnFile: { name: string; data: string; url: string } | null;
  } | null>(null);
  
  // New filter states
  const [userFilter, setUserFilter] = useState<string>('all');
  const [workStatusFilter, setWorkStatusFilter] = useState<string>('all');
  const [remarkTypeFilter, setRemarkTypeFilter] = useState<RemarkFilter>('all');
  const [users, setUsers] = useState<AppUser[]>([]);

  // Admin sees all lists; regular users only see their permitted lists
  const lists: ListType[] = getPermittedLists(activeChannel, userRole, userDepartment);

  // Reset remark filter when switching channels (they have different filter options)
  useEffect(() => {
    setRemarkTypeFilter('all');
  }, [activeChannel]);

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

  // Close channel dropdown and date dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(e.target as Node)) {
        setShowChannelDropdown(false);
      }
      if (dateFilterRef.current && !dateFilterRef.current.contains(e.target as Node)) {
        setShowDateDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filterCardsByDate = (cards: CardType[]) => {
    if (dateFilter === 'all') return cards;

    if (dateFilter === 'day') {
      const dayStr = dayDate || format(new Date(), 'yyyy-MM-dd');
      return cards.filter(card => format(parseISO(card.date), 'yyyy-MM-dd') === dayStr);
    }

    if (dateFilter === 'week') {
      const endD   = weekEndDate ? parseISO(weekEndDate) : new Date();
      const startD = subDays(endD, weekRangeDays - 1);
      const startMs = startOfDay(startD).getTime();
      const endMs   = endOfDay(endD).getTime();
      return cards.filter(card => {
        const cardDateMs = parseISO(card.date).getTime();
        if (cardDateMs > endMs) return false; // started after range
        // If card has ended, it must have ended after range start
        const endedMs = card.completedAt
          ? new Date(card.completedAt).getTime()
          : card.terminated
            ? new Date(card.updatedAt).getTime()
            : null;
        if (endedMs !== null && endedMs < startMs) return false;
        return true;
      });
    }

    if (dateFilter === 'month') {
      const selMonth  = new Date(monthFilterYear, monthFilterMonth, 1);
      const monthStart = startOfMonth(selMonth).getTime();
      const monthEnd   = endOfMonth(selMonth).getTime();
      return cards.filter(card => {
        const cardDateMs = parseISO(card.date).getTime();
        if (cardDateMs > monthEnd) return false; // card starts after the month
        const endedMs = card.completedAt
          ? new Date(card.completedAt).getTime()
          : card.terminated
            ? new Date(card.updatedAt).getTime()
            : null;
        if (endedMs !== null && endedMs < monthStart) return false; // ended before month
        return true;
      });
    }

    return cards;
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
      
      // Apply date filtering for terminated/approved/completed cards only
      const now = new Date();
      filtered = filtered.filter(card => {
        // Completed cards: only show on the completion day, never carry to next day
        if (card.completedAt) {
          const completedDate = parseISO(card.completedAt);
          return differenceInDays(now, completedDate) <= 0;
        }
        // If terminated or approved, only show on the same day (don't carry forward)
        if (card.terminated || card.approved) {
          const cardDate = parseISO(card.date);
          if (dateFilter === 'day') {
            return differenceInDays(now, cardDate) <= 1;
          } else if (dateFilter === 'day' && dayDate) {
            return format(cardDate, 'yyyy-MM-dd') === dayDate;
          }
          return format(cardDate, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
        }
        // Active cards always show
        return true;
      });
    } else {
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
      if (activeChannel === 'Work Order') {
        // WO channel: filter by card origin / completion status
        if (remarkTypeFilter === 'Exported') {
          // Cards exported from Quotation channel (LPO approved → cloned)
          filtered = filtered.filter(card => card.approved && !card.completedAt && !card.terminated);
        } else if (remarkTypeFilter === 'Created') {
          // Cards created directly in Work Order channel
          filtered = filtered.filter(card => !card.approved && !card.completedAt && !card.terminated);
        } else if (remarkTypeFilter === 'WO_Completed') {
          filtered = filtered.filter(card => !!card.completedAt);
        }
      } else {
        // Quotation channel: original remark-type based filtering
        if (remarkTypeFilter === 'Terminated') {
          filtered = filtered.filter(card => card.terminated);
        } else if (remarkTypeFilter === 'Approved') {
          filtered = filtered.filter(card => card.approved);
        } else {
          // For Active/Pending/Inactive, exclude terminated and approved cards
          filtered = filtered.filter(card => {
            if (card.terminated || card.approved) return false;
            const latestRemark = card.remarks.length > 0 ? card.remarks[card.remarks.length - 1] : null;
            return latestRemark?.type === remarkTypeFilter;
          });
        }
      }
    }

    if (quoteSearch) {
      filtered = filtered.filter(card =>
        card.quoteNumber.toLowerCase().includes(quoteSearch.toLowerCase())
      );
    }

    return filtered;
  }, [cards, quoteSearch, dateFilter, dayDate, weekEndDate, weekRangeDays, monthFilterYear, monthFilterMonth, userRole, userName, userFilter, workStatusFilter, remarkTypeFilter]);

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
    // ALL Work Order channel cards require PO doc before creation
    if (activeChannel === 'Work Order') {
      setWOPreCreate({ list, poFile: null, qtnFile: null });
      return;
    }
    const _now = new Date().toISOString();
    const newCard: CardType = {
      id: Date.now().toString(),
      quoteNumber: activeChannel === 'Work Order'
        ? ''
        : `NEW/${new Date().getFullYear()}/${Math.floor(Math.random() * 10000)}`,
      workOrderNumber: activeChannel === 'Work Order' ? '0000' : undefined,
      date: new Date().toISOString().split('T')[0],
      salesPerson: '',
      subject: '',
      projectLocation: '',
      list: list,
      channel: activeChannel,
      companyCode: activeChannel === 'Work Order' ? 'GRP' : undefined,
      remarks: [],
      listHistory: [{ list, enteredAt: _now }],
      createdAt: _now,
      updatedAt: _now,
    };
    setCards([...cards, newCard]);
    setSelectedCard(newCard);
  };

  const handleWOPreCreateConfirm = () => {
    if (!woPreCreate?.poFile) return;
    const _woNow = new Date().toISOString();
    const newCard: CardType = {
      id: Date.now().toString(),
      quoteNumber: '',
      workOrderNumber: '0000',
      date: new Date().toISOString().split('T')[0],
      salesPerson: '',
      subject: '',
      projectLocation: '',
      list: woPreCreate.list,
      channel: 'Work Order',
      companyCode: 'GRP',
      purchaseOrderDocName: woPreCreate.poFile.name,
      purchaseOrderDocData: woPreCreate.poFile.data,
      purchaseOrderDocUrl: woPreCreate.poFile.url,
      quotationDocName: woPreCreate.qtnFile?.name,
      quotationDocData: woPreCreate.qtnFile?.data,
      quotationDocUrl: woPreCreate.qtnFile?.url,
      remarks: [],
      listHistory: [{ list: woPreCreate.list, enteredAt: _woNow }],
      createdAt: _woNow,
      updatedAt: _woNow,
    };
    setCards([...cards, newCard]);
    setSelectedCard(newCard);
    setWOPreCreate(null);
  };

  const handleApproveCard = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    // Require PO doc for LPO approvals
    if (card.list === 'LPO' && activeChannel === 'Quotation') {
      if (!card.purchaseOrderDocData) {
        alert('Upload the Purchase Order document before approving this LPO card.');
        return;
      }
      if (!card.quotationDocData) {
        alert('Upload the Quotation document before approving this LPO card.');
        return;
      }
    }

    const updatedCards = cards.map(c =>
      c.id === cardId ? { ...c, approved: true, updatedAt: new Date().toISOString() } : c
    );
    setCards(updatedCards);

    // When LPO approved, create a Work Order card with default code/number and carry PO doc
    if (card.list === 'LPO' && activeChannel === 'Quotation' && onCreateInChannel) {
      // Extract company code from the first segment of quoteNumber (e.g. "CLX/2602/MM/4185" → "CLX")
      const knownCodes = ['GRP', 'GRPPT', 'CLX'];
      const firstSegment = (card.quoteNumber || '').split('/')[0].toUpperCase();
      const companyCode = knownCodes.includes(firstSegment) ? firstSegment : (card.companyCode || 'GRP');
      const clone: CardType = {
        ...card,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        channel: 'Work Order',
        list: 'Work Order',
        approved: true,
        terminated: false,
        workOrderNumber: '0000',
        companyCode,
        // Clear assignment — cards must be re-assigned when entering Work Order channel
        assignedTo: undefined,
        userWorkStatus: undefined,
        // Clear remarks to avoid list-name mismatch; carry PO doc data in-memory
        remarks: [],
        listHistory: [{ list: 'Work Order' as ListType, enteredAt: new Date().toISOString() }],
        // purchaseOrderDocData kept from spread — available in-memory this session
        // (addCardToChannel strips it before writing to localStorage)
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onCreateInChannel('Work Order', clone);
    }
  };

  const handleTerminateCard = (cardId: string) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, terminated: true } : card
    );
    setCards(updatedCards);
  };

  const handleCompleteCard = (cardId: string) => {
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : card
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

    // Update card with new list and timestamp; append to listHistory
    const moveTime = new Date().toISOString();
    const updatedCard = {
      ...movedCard,
      list: destList,
      updatedAt: moveTime,
      listHistory: [
        ...(movedCard.listHistory ?? [{ list: movedCard.list, enteredAt: movedCard.createdAt }]),
        { list: destList, enteredAt: moveTime },
      ],
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
              {userDepartment && (
                <div className="text-sm text-gray-500">
                  <span className="mr-1">🏢</span>
                  <span className="font-medium text-purple-700">{userDepartment}</span>
                </div>
              )}
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

              {/* Date Filter Buttons with inline dropdown pickers */}
              <div className="relative flex items-center gap-1 bg-gray-100 rounded-lg p-1" ref={dateFilterRef}>
                <button
                  onClick={() => { setDateFilter('all'); setShowDateDropdown(null); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >All Time</button>

                <button
                  onClick={() => { setDateFilter('day'); setShowDateDropdown(showDateDropdown === 'day' ? null : 'day'); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'day' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Day {dateFilter === 'day' && <span className="ml-1 text-pink-500">{dayDate}</span>}
                </button>

                <button
                  onClick={() => { setDateFilter('week'); setShowDateDropdown(showDateDropdown === 'week' ? null : 'week'); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Week {dateFilter === 'week' && <span className="ml-1 text-pink-500">{weekRangeDays}d</span>}
                </button>

                <button
                  onClick={() => { setDateFilter('month'); setShowDateDropdown(showDateDropdown === 'month' ? null : 'month'); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    dateFilter === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Month {dateFilter === 'month' && <span className="ml-1 text-pink-500">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthFilterMonth]} {monthFilterYear}</span>}
                </button>

                {/* Day picker dropdown */}
                {showDateDropdown === 'day' && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-4 w-64">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Select Day</p>
                    <input
                      type="date"
                      value={dayDate}
                      onChange={e => setDayDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                    <button
                      onClick={() => setDayDate(format(new Date(), 'yyyy-MM-dd'))}
                      className="mt-2 text-xs text-pink-600 hover:text-pink-800 font-medium"
                    >↩ Today</button>
                  </div>
                )}

                {/* Week picker dropdown */}
                {showDateDropdown === 'week' && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-4 w-72">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Week Range</p>
                    <label className="block text-xs text-gray-500 mb-1">End date</label>
                    <input
                      type="date"
                      value={weekEndDate}
                      onChange={e => setWeekEndDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 mb-3"
                    />
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-gray-500 whitespace-nowrap">Days back</label>
                      <input
                        type="number" min={1} max={90}
                        value={weekRangeDays}
                        onChange={e => setWeekRangeDays(Math.max(1, Math.min(90, Number(e.target.value))))}
                        className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    {weekEndDate && (
                      <p className="mt-2 text-xs text-gray-400">
                        {format(subDays(parseISO(weekEndDate), weekRangeDays - 1), 'MMM d')} – {format(parseISO(weekEndDate), 'MMM d, yyyy')}
                      </p>
                    )}
                    <button
                      onClick={() => { setWeekEndDate(format(new Date(), 'yyyy-MM-dd')); setWeekRangeDays(7); }}
                      className="mt-2 text-xs text-pink-600 hover:text-pink-800 font-medium"
                    >↩ Last 7 days</button>
                  </div>
                )}

                {/* Month picker dropdown */}
                {showDateDropdown === 'month' && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-4 w-56">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Select Month</p>
                    <div className="flex items-center gap-2">
                      <select
                        value={monthFilterMonth}
                        onChange={e => setMonthFilterMonth(Number(e.target.value))}
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      >
                        {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                          <option key={i} value={i}>{m}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={monthFilterYear}
                        onChange={e => setMonthFilterYear(Number(e.target.value))}
                        className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <button
                      onClick={() => { setMonthFilterMonth(new Date().getMonth()); setMonthFilterYear(new Date().getFullYear()); }}
                      className="mt-2 text-xs text-pink-600 hover:text-pink-800 font-medium"
                    >↩ This month</button>
                  </div>
                )}
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
            {/* Top right row: Channel Switcher + View Mode Buttons */}
            <div className="flex items-center gap-3">
              {/* Channel Switcher */}
              <div className="relative" ref={channelDropdownRef}>
                <button
                  onClick={() => setShowChannelDropdown(prev => !prev)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors shadow-sm"
                >
                  {activeChannel === 'Quotation'
                    ? <FileText className="w-4 h-4 text-blue-200" />
                    : <ClipboardList className="w-4 h-4 text-orange-200" />}
                  <span>{activeChannel}</span>
                  <ChevronDown className="w-4 h-4 opacity-70" />
                </button>

                {showChannelDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search channels..."
                          className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                          readOnly
                        />
                      </div>
                    </div>
                    {(['Quotation', 'Work Order'] as ChannelType[]).map(ch => {
                      const accessible = accessibleChannels.includes(ch);
                      return (
                        <button
                          key={ch}
                          disabled={!accessible}
                          onClick={() => { if (accessible) { onChannelSwitch(ch); setShowChannelDropdown(false); } }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                            activeChannel === ch ? 'bg-gray-50' : 'hover:bg-gray-50'
                          } ${!accessible ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            ch === 'Quotation' ? 'bg-blue-100' : 'bg-orange-100'
                          }`}>
                            {ch === 'Quotation'
                              ? <FileText className="w-4 h-4 text-blue-600" />
                              : <ClipboardList className="w-4 h-4 text-orange-500" />}
                          </span>
                          <span className={`flex-1 text-left font-medium ${activeChannel === ch ? 'text-gray-900' : 'text-gray-700'}`}>
                            {ch}
                          </span>
                          {activeChannel === ch && <Check className="w-4 h-4 text-green-500 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

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

              {/* Remark / Status Filter */}
              <select
                value={remarkTypeFilter}
                onChange={(e) => setRemarkTypeFilter(e.target.value as RemarkFilter)}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                {activeChannel === 'Work Order' ? (
                  <>
                    <option value="all">All</option>
                    <option value="Exported">Exported (from Quotation)</option>
                    <option value="Created">Created</option>
                    <option value="WO_Completed">Completed</option>
                  </>
                ) : (
                  <>
                    <option value="all">All</option>
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Terminated">Terminated</option>
                    <option value="Approved">Approved</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-3">
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-3 h-full w-full">
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
                  onCompleteCard={handleCompleteCard}
                  onUpdateCard={handleUpdateCard}
                  onAssignUser={handleAssignUser}
                  onUpdateWorkStatus={handleUpdateWorkStatus}
                  userRole={userRole}
                  userDepartment={userDepartment}
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

      {viewMode === 'gantt' && (() => {
        // ── colour map ─────────────────────────────────────────────────────
        const LIST_COLOR: Record<string, string> = {
          'Quotation':    '#2563eb',  // vivid blue
          'Submittal':    '#06b6d4',  // cyan
          'Review':       '#eab308',  // yellow
          'LPO':          '#f97316',  // orange
          'Work Order':   '#7c3aed',  // deep violet
          'Accounts':     '#0d9488',  // teal
          'Delivery':     '#ef4444',  // red
          'Installation': '#16a34a',  // forest green
        };
        const LIST_BG: Record<string, string> = {
          'Quotation':    'bg-blue-100 text-blue-700',
          'Submittal':    'bg-indigo-100 text-indigo-700',
          'Review':       'bg-violet-100 text-violet-700',
          'LPO':          'bg-orange-100 text-orange-700',
          'Work Order':   'bg-purple-100 text-purple-700',
          'Accounts':     'bg-teal-100 text-teal-700',
          'Delivery':     'bg-amber-100 text-amber-700',
          'Installation': 'bg-green-100 text-green-700',
        };

        // ── time window: 4 days ending on currentWeek (today by default) ──
        const rangeEnd   = endOfDay(currentWeek).getTime() + 1;     // ms (exclusive)
        const rangeStart = startOfDay(subDays(currentWeek, 4)).getTime(); // 5 days back
        const viewStart  = rangeStart;
        const viewEnd    = rangeEnd;
        const viewDur    = viewEnd - viewStart;
        const days       = eachDayOfInterval({ start: new Date(viewStart), end: new Date(viewEnd - 1) });
        const now        = Date.now();

        // ── work-hours config: 7am – 7pm = 12h per day ──────────────────────
        const WORK_START_H = 7;   // 7:00 AM
        const WORK_END_H   = 19;  // 7:00 PM
        const WORK_HOURS   = WORK_END_H - WORK_START_H; // 12
        const TOTAL_WORK_MS = days.length * WORK_HOURS * 3_600_000;

        // Convert real timestamp → work-time-only position (off-hours collapsed)
        const toWorkPos = (ms: number): number => {
          let pos = 0;
          for (let i = 0; i < days.length; i++) {
            const ws = startOfDay(days[i]).getTime() + WORK_START_H * 3_600_000;
            const we = startOfDay(days[i]).getTime() + WORK_END_H   * 3_600_000;
            if (ms <= ws) return pos;              // before this day's work start
            if (ms <= we) return pos + (ms - ws); // within work hours
            pos += WORK_HOURS * 3_600_000;         // past end of day → full day consumed
          }
          return pos;
        };

        // helper: clamp+pct  (uses work-time coordinates)
        const toPct = (ms: number) =>
          Math.max(0, Math.min(100, (toWorkPos(ms) / TOTAL_WORK_MS) * 100));

        // ── build segments per card ────────────────────────────────────────
        type Seg = { list: string; start: number; end: number };
        const buildSegments = (card: CardType): Seg[] => {
          const history = card.listHistory && card.listHistory.length > 0
            ? card.listHistory
            : [{ list: card.list, enteredAt: card.createdAt }];

          const segs: Seg[] = history.map((h, i) => ({
            list:  h.list,
            start: new Date(h.enteredAt).getTime(),
            end:   i + 1 < history.length
                     ? new Date(history[i + 1].enteredAt).getTime()
                     : card.completedAt
                       ? new Date(card.completedAt).getTime()
                       : now,
          }));
          return segs.filter(s => s.end > viewStart && s.start < viewEnd);
        };

        const visibleCards = filteredCards.filter(card => {
          const segs = buildSegments(card);
          return segs.length > 0;
        });

        const formatHours = (ms: number) => {
          const h = ms / 3600000;
          return h < 1 ? `${Math.round(ms / 60000)}m` : `${h.toFixed(1)}h`;
        };

        return (
          <div className="flex-1 overflow-auto p-6 bg-gray-50">
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              {/* ── toolbar ── */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-wrap gap-3">
                <div className="flex flex-wrap gap-3">
                  {lists.map(list => (
                    <span key={list} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: LIST_COLOR[list] ?? '#9ca3af' }} />
                      {list}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setCurrentWeek(subDays(currentWeek, 5))} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">←</button>
                  <div className="text-sm font-medium whitespace-nowrap">
                    {format(new Date(viewStart), 'MMM d')} – {format(new Date(viewEnd - 1), 'MMM d, yyyy')}
                  </div>
                  <button onClick={() => setCurrentWeek(addDays(currentWeek, 5))} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">→</button>
                  <button
                    onClick={() => setCurrentWeek(new Date())}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                  >
                    <span>📅</span> Today
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div style={{ minWidth: '700px' }}>
                  {/* ── date header ── */}
                  <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
                    <div className="w-40 flex-shrink-0 px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Card</div>
                    <div className="w-24 flex-shrink-0 px-2 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">List</div>
                    <div className="flex-1 relative">
                      <div className="flex">
                        {days.map((day, i) => {
                          const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                          return (
                            <div key={i} className={`flex-1 text-center py-2 border-l border-gray-200 ${isToday ? 'bg-blue-50' : ''}`}>
                              <div className="text-xs text-gray-400">{format(day, 'EEE')}</div>
                              <div className={`text-sm font-semibold ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>{format(day, 'd')}</div>
                            </div>
                          );
                        })}
                      </div>
                      {/* 2-hour tick marks in header — every 2h within work window */}
                      {days.map((day, di) =>
                        [2, 4, 6, 8, 10].map(th => {
                          // th = hours after WORK_START_H  →  absolute clock = WORK_START_H + th
                          const pct = ((di * WORK_HOURS + th) / (days.length * WORK_HOURS)) * 100;
                          return (
                            <div key={`hd-${di}-${th}`}
                                 className="absolute bottom-0 w-px bg-gray-400"
                                 style={{ left: `${pct}%`, height: '6px' }} />
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* ── card rows ── */}
                  {visibleCards.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 text-sm">No cards active in this period.</div>
                  ) : visibleCards.map(card => {
                    const label = card.channel === 'Work Order'
                      ? `${card.companyCode || 'GRP'}/${card.workOrderNumber || '0000'}`
                      : card.quoteNumber;
                    const segs   = buildSegments(card);
                    const badgeCls = LIST_BG[card.list] ?? 'bg-gray-100 text-gray-600';

                    // today line pct (once per row)
                    const todayPct = now >= viewStart && now < viewEnd ? toPct(now) : null;

                    return (
                      <div key={card.id} className="flex items-center border-b border-gray-100 hover:bg-gray-50 transition-colors group">
                        {/* label */}
                        <div className="w-40 flex-shrink-0 px-3 py-2 cursor-pointer" onClick={() => setSelectedCard(card)}>
                          <div className="text-xs font-semibold text-gray-800 truncate group-hover:text-purple-700">{label}</div>
                          <div className="text-[10px] text-gray-400 truncate">{card.subject || card.projectLocation || ''}</div>
                        </div>
                        {/* list badge */}
                        <div className="w-24 flex-shrink-0 px-2 py-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium truncate max-w-full ${badgeCls}`}>
                            {card.list}
                          </span>
                        </div>
                        {/* timeline strip */}
                        <div className="flex-1 relative h-10">
                          {/* day dividers */}
                          {days.map((_, i) => i > 0 && (
                            <div key={i} className="absolute top-0 bottom-0 w-px bg-gray-200"
                                 style={{ left: `${(i / days.length) * 100}%` }} />
                          ))}
                          {/* 2-hour sub-dividers within work window */}
                          {days.map((day, di) =>
                            [2, 4, 6, 8, 10].map(th => {
                              const pct = ((di * WORK_HOURS + th) / (days.length * WORK_HOURS)) * 100;
                              return (
                                <div key={`tick-${di}-${th}`}
                                     className="absolute top-0 bottom-0 w-px"
                                     style={{ left: `${pct}%`, backgroundColor: 'rgba(156, 163, 175, 0.25)' }} />
                              );
                            })
                          )}
                          {/* today line */}
                          {todayPct !== null && (
                            <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 opacity-70 z-10"
                                 style={{ left: `${todayPct}%` }} />
                          )}
                          {/* segments */}
                          {segs.map((seg, si) => {
                            const clampedStart = Math.max(seg.start, viewStart);
                            const clampedEnd   = Math.min(seg.end,   viewEnd);
                            const leftPct  = toPct(clampedStart);
                            const rightPct = toPct(clampedEnd);
                            const widthPct = rightPct - leftPct;
                            if (widthPct <= 0) return null;
                            const color    = LIST_COLOR[seg.list] ?? '#9ca3af';
                            const durationMs = seg.end - seg.start;
                            const isLast   = si === segs.length - 1 && !card.completedAt;
                            const roundLeft  = si === 0 || segs[si - 1].end <= viewStart;
                            const roundRight = !isLast || card.completedAt != null;
                            const borderRadius = `${roundLeft ? '4px' : '0'} ${roundRight ? '4px' : '0'} ${roundRight ? '4px' : '0'} ${roundLeft ? '4px' : '0'}`;
                            return (
                              <div
                                key={si}
                                className="absolute top-1.5 h-7 cursor-pointer hover:brightness-110 transition-all z-10 flex items-center justify-center overflow-hidden"
                                style={{
                                  left:            `${leftPct}%`,
                                  width:           `${Math.max(widthPct, 0.4)}%`,
                                  backgroundColor: color,
                                  borderRadius,
                                  // pulse animation for the currently-active (last) segment
                                  outline: isLast ? `2px solid ${color}` : 'none',
                                  outlineOffset: isLast ? '2px' : '0',
                                }}
                                title={`${seg.list}\nFrom: ${format(new Date(seg.start), 'dd MMM HH:mm')}\nDuration: ${formatHours(durationMs)}`}
                                onClick={() => setSelectedCard(card)}
                              >
                                {widthPct > 5 && (
                                  <span className="text-white text-[10px] font-semibold truncate px-1 select-none">
                                    {widthPct > 12 ? label : seg.list.charAt(0)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedCard && (
        <CardModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
          userRole={userRole}
          userName={userName}
          userDepartment={userDepartment}
          channel={activeChannel}
        />
      )}

      {/* Pre-create dialog: WO card must have PO doc before being created */}
      {woPreCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-600 to-orange-400 rounded-t-2xl">
              <div>
                <h2 className="text-base font-bold text-white">New Work Order Card</h2>
                <p className="text-orange-100 text-xs mt-0.5">Upload required documents to continue</p>
              </div>
              <button onClick={() => setWOPreCreate(null)} className="p-1.5 rounded-lg hover:bg-orange-500 transition-colors">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* PO Document — required */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-800">Purchase Order Document</span>
                  <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
                </div>
                {woPreCreate.poFile ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-orange-50 border border-orange-200 rounded-lg">
                    <FileText className="w-4 h-4 text-orange-600 flex-shrink-0" />
                    <span className="text-sm text-orange-800 font-medium truncate flex-1">{woPreCreate.poFile.name}</span>
                    <button onClick={() => setWOPreCreate(p => p ? { ...p, poFile: null } : null)} className="text-xs text-red-500 hover:text-red-700 flex-shrink-0">Remove</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 w-full px-3 py-2.5 border-2 border-dashed border-orange-300 hover:border-orange-400 rounded-lg cursor-pointer transition-colors bg-orange-50">
                    <Plus className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-orange-600">Click to upload PDF / Word</span>
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        const data = evt.target?.result as string;
                        const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                        const url = `/po-docs/wo-${Date.now()}${ext}`;
                        setWOPreCreate(p => p ? { ...p, poFile: { name: file.name, data, url } } : null);
                      };
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                )}
              </div>

              {/* Quotation Document — optional */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-800">Quotation Document</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Optional</span>
                </div>
                {woPreCreate.qtnFile ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-purple-50 border border-purple-200 rounded-lg">
                    <FileText className="w-4 h-4 text-purple-600 flex-shrink-0" />
                    <span className="text-sm text-purple-800 font-medium truncate flex-1">{woPreCreate.qtnFile.name}</span>
                    <button onClick={() => setWOPreCreate(p => p ? { ...p, qtnFile: null } : null)} className="text-xs text-red-500 hover:text-red-700 flex-shrink-0">Remove</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 w-full px-3 py-2.5 border-2 border-dashed border-gray-300 hover:border-purple-400 rounded-lg cursor-pointer transition-colors bg-gray-50">
                    <Plus className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">Click to upload PDF / Word</span>
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        const data = evt.target?.result as string;
                        const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                        const url = `/qtn-docs/wo-${Date.now()}${ext}`;
                        setWOPreCreate(p => p ? { ...p, qtnFile: { name: file.name, data, url } } : null);
                      };
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setWOPreCreate(null)} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                disabled={!woPreCreate.poFile}
                onClick={handleWOPreCreateConfirm}
                className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  woPreCreate.poFile
                    ? 'bg-orange-500 hover:bg-orange-600 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Create Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
