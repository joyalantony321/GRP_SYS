import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Filter, Plus, LayoutGrid, Table as TableIcon, BarChart3, Edit2, Trash2, User, Settings, Calendar, FileText, ClipboardList, ChevronDown, Check, X, CheckCircle, CalendarRange } from 'lucide-react';
import { Card as CardType, ListType, RemarkType, UserWorkStatus, AppUser, ChannelType, Department, CHANNEL_LISTS, CHANNEL_DEPARTMENTS, WORK_ORDER_LISTS, getPermittedLists, normalizeListType } from '@/types';
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
  onCreateInChannel: (channel: ChannelType, card: CardType) => Promise<CardType>;
  onAdminSettings?: () => void;
}

type ViewMode = 'kanban' | 'table' | 'gantt';
type DateFilter = 'all' | 'day' | 'week' | 'month';
type RemarkFilter = 'all' | 'Active' | 'Pending' | 'Inactive' | 'Terminated' | 'Approved' | 'Exported' | 'Created' | 'WO_Completed';

// ─── Card Visibility Helpers ──────────────────────────────────────────────────
// These helpers enforce the Day-filter visibility rules for both the Admin and
// regular users. No separate logic per role — both always see the same cards.
//
// Week / Month / All-Time filters do NOT call these helpers, so completed cards
// remain visible as historical records in those views.

/**
 * Returns the calendar date (yyyy-MM-dd) when a Quotation card was finally
 * resolved (Approved or Terminated). Reads assignmentHistory first for an
 * accurate timestamp, then falls back to updatedAt.
 */
function getQuotationCompletionDate(card: CardType): string | null {
  if (!card.approved && !card.terminated) return null;
  const targetAction: 'Approved' | 'Terminated' = card.approved ? 'Approved' : 'Terminated';
  const history = card.assignmentHistory ?? [];
  const entry = [...history].reverse().find(h => h.action === targetAction);
  const ts = entry?.assignedAt ?? card.updatedAt;
  if (!ts) return null;
  try { return format(parseISO(ts), 'yyyy-MM-dd'); } catch { return null; }
}

/**
 * Returns the calendar date (yyyy-MM-dd) when a Work Order card was
 * schedule-completed.
 *
 * Completion is defined as:
 *   - Delivery Only  : scheduleStage === 'Delivery completed'
 *   - Delivery + Inst: scheduleStage === 'Installation completed'
 *   - Legacy list    : completedAt is set
 *
 * Uses updatedAt as the proxy date for schedule-stage completions since the
 * ScheduleBoard syncs the stage change together with updatedAt.
 */
function getWorkOrderCompletionDate(card: CardType): string | null {
  if (card.completedAt) {
    try { return format(parseISO(card.completedAt), 'yyyy-MM-dd'); } catch { return null; }
  }
  if (
    card.scheduleStage === 'Delivery completed' ||
    card.scheduleStage === 'Installation completed'
  ) {
    try { return format(parseISO(card.updatedAt), 'yyyy-MM-dd'); } catch { return null; }
  }
  return null;
}

/**
 * Returns true when a card should be shown in the Day (Today) filter for the
 * given calendar day string (yyyy-MM-dd).
 *
 * Rules (identical for Admin and regular users):
 *   Quotation  – hide if approved/terminated AND completion date < dayStr
 *   Work Order – hide if delivery/installation completed AND completion date < dayStr
 *   Other      – always visible
 */
function isCardVisibleOnDay(
  card: CardType,
  channel: ChannelType,
  dayStr: string,
): boolean {
  if (channel === 'Quotation') {
    const completionDate = getQuotationCompletionDate(card);
    if (completionDate !== null && completionDate < dayStr) return false;
  } else if (channel === 'Work Order') {
    const completionDate = getWorkOrderCompletionDate(card);
    if (completionDate !== null && completionDate < dayStr) return false;
  }
  return true;
}

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
  const [selectedCardIsNew, setSelectedCardIsNew] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [showApprovedCardsModal, setShowApprovedCardsModal] = useState(false);
  const [pendingScheduleChoice, setPendingScheduleChoice] = useState<{
    srcId: string;
    dstId: string;
    cardId: string;
    dstIdx: number;
  } | null>(null);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const dateFilterRef = useRef<HTMLDivElement>(null);

  // Pre-create dialog for WO channel / Work Order list (Technical dept only)
  const [woPreCreate, setWOPreCreate] = useState<{
    list: ListType;
    scheduleType?: 'Delivery' | 'Installation';
    woNumber: string;
    companyCode: string;
    poFile: { name: string; raw: File } | null;
    qtnFile: { name: string; raw: File } | null;
  } | null>(null);

  // LPO approval: pending confirmation with WO number
  const [lpoApprovalPending, setLpoApprovalPending] = useState<{
    cardId: string;
    woNumber: string;
    companyCode: string;
    assigneeName: string;
  } | null>(null);

  // Quotation revision: pending confirmation with revision number
  const [revisionPending, setRevisionPending] = useState<{
    cardId: string;
    revisionNumber: string;
  } | null>(null);
  
  // New filter states
  const [userFilter, setUserFilter] = useState<string>('all');
  const [workStatusFilter, setWorkStatusFilter] = useState<string>('all');
  const [remarkTypeFilter, setRemarkTypeFilter] = useState<RemarkFilter>('all');
  const [users, setUsers] = useState<AppUser[]>([]);

  // Admin sees all lists; regular users see their permitted lists PLUS any list
  // that currently contains a card assigned to them (so sent cards are always visible).
  const lists: ListType[] = useMemo(() => {
    const permitted = getPermittedLists(activeChannel, userRole, userDepartment);
    if (userRole !== 'user') return permitted;
    const channelLists = CHANNEL_LISTS[activeChannel];
    const listsWithAssigned = channelLists.filter(l =>
      cards.some(c => normalizeListType(c.list) === l && c.assignedTo === userName)
    );
    const merged = permitted.concat(listsWithAssigned.filter(l => !permitted.includes(l)));
    return channelLists.filter(l => merged.includes(l));
  }, [activeChannel, userRole, userDepartment, userName, cards]);

  const getCardActivityTime = (card: CardType) =>
    Date.parse(card.updatedAt || card.createdAt || '') || 0;

  const sortCardsByLatestActivity = (inputCards: CardType[]) => {
    const cardCode = (card: CardType) => card.workOrderNumber || card.quoteNumber || card.id;
    return [...inputCards].sort((left, right) => {
      const timeDiff = getCardActivityTime(right) - getCardActivityTime(left);
      if (timeDiff !== 0) return timeDiff;
      return cardCode(right).localeCompare(cardCode(left));
    });
  };

  const renderKanbanList = (list: ListType, className?: string) => (
    <KanbanList
      key={list}
      list={list}
      cards={list === 'Schedule'
        ? sortScheduleCards(filteredCards.filter(card => normalizeListType(card.list) === list))
        : sortCardsByLatestActivity(filteredCards.filter(card => normalizeListType(card.list) === list))}
      onCardClick={openExistingCard}
      onDeleteCard={handleDeleteCard}
      onApproveCard={handleApproveCard}
      onTerminateCard={handleTerminateCard}
      onUnterminateCard={handleUnterminateCard}
      onCompleteCard={handleCompleteCard}
      onReviseCard={activeChannel === 'Quotation' ? handleReviseCard : undefined}
      onUpdateCard={handleUpdateCard}
      onAssignUser={handleAssignUser}
      onUpdateWorkStatus={handleUpdateWorkStatus}
      onSwitchScheduleType={activeChannel === 'Work Order' ? handleSwitchScheduleType : undefined}
      userRole={userRole}
      userDepartment={userDepartment}
      className={className}
    />
  );

  const sortScheduleCards = (inputCards: CardType[]) => {
    return sortCardsByLatestActivity(inputCards);
  };

  // Reset remark filter when switching channels (they have different filter options)
  useEffect(() => {
    setRemarkTypeFilter('all');
  }, [activeChannel]);

  const workOrderAssignableUsers = useMemo(() => {
    return users.filter(u => !!u.department && CHANNEL_DEPARTMENTS['Work Order'].includes(u.department));
  }, [users]);

  // Load users from API
  useEffect(() => {
    import('@/lib/api').then(({ getAppData }) => {
      getAppData()
        .then(data => {
          setUsers(data.users.map(u => ({
            name:       u.username,
            pin:        u.pin,
            department: (u.depName as Department) ?? undefined,
          })));
        })
        .catch(err => console.error('Error loading users:', err));
    });
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
      // Include every card that existed on or before the selected day.
      // Cards completed/approved/terminated before that day are hidden by
      // the isCardVisibleOnDay rule that runs immediately after this filter.
      return cards.filter(card => format(parseISO(card.date), 'yyyy-MM-dd') <= dayStr);
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

  const appendActionHistory = (card: CardType, action: 'Approved' | 'Terminated' | 'Revised' | 'Redo', actedAt: string): CardType['assignmentHistory'] => {
    const history = card.assignmentHistory ?? [];
    return [...history, {
      assignedTo: card.assignedTo ?? '',
      assignedAt: actedAt,
      assignedBy: userName,
      action,
    }];
  };

  const cardMatchesSearch = (card: CardType, term: string): boolean => {
    const q = term.trim().toLowerCase();
    if (!q) return true;

    const fields = [
      card.quoteNumber,
      card.workOrderNumber,
      card.customerName,
      card.customerCompanyName,
      card.projectLocation,
      card.salesPerson,
      card.date,
    ];

    return fields.some(v => (v ?? '').toString().toLowerCase().includes(q));
  };

  const filteredCards = useMemo(() => {
    let filtered = cards;

    // ── 1. Assignment filter (non-admin only) ──────────────────────────────
    // Users only see cards currently assigned to them, or cards they created
    // that have never been forwarded to anyone else.
    if (userRole === 'user') {
      filtered = filtered.filter(card => {
        // Work Order -> Schedule list is visible to all department users.
        if (activeChannel === 'Work Order' && normalizeListType(card.list) === 'Schedule') {
          return true;
        }
        if (card.assignedTo === userName) return true;
        // Only show an unassigned card to the user if it was self-created AND
        // has never been assigned to a different person.
        if (!card.assignedTo) {
          const history = card.assignmentHistory ?? [];
          const wasForwardedToOther = history.some(h => h.assignedTo && h.assignedTo !== userName);
          const selfCreated = history.some(h => h.assignedBy === userName && h.assignedTo === userName);
          if (selfCreated && !wasForwardedToOther) return true;
        }
        return false;
      });
    }

    // ── 2. Date range filter (all users) ───────────────────────────────────
    filtered = filterCardsByDate(filtered);

    // ── 3. Day-filter visibility rules — applied equally to Admin and User ─
    // Only the Day ("Today") filter hides completed/approved/terminated cards
    // whose completion date has already passed.
    // Week / Month / All-Time filters never hide completed cards so that
    // historical records remain accessible.
    if (dateFilter === 'day') {
      const dayStr = dayDate || format(new Date(), 'yyyy-MM-dd');
      filtered = filtered.filter(card => isCardVisibleOnDay(card, activeChannel, dayStr));
    }

    // ── 4. Admin user filter ───────────────────────────────────────────────
    if (userRole === 'admin' && userFilter !== 'all') {
      if (userFilter === 'unassigned') {
        filtered = filtered.filter(card => !card.assignedTo);
      } else {
        filtered = filtered.filter(card => card.assignedTo === userFilter);
      }
    }

    // ── 5. Work status filter ──────────────────────────────────────────────
    if (workStatusFilter !== 'all') {
      filtered = filtered.filter(card => card.userWorkStatus === workStatusFilter);
    }

    // ── 6. Remark type filter ──────────────────────────────────────────────
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

    // ── 7. Search ──────────────────────────────────────────────────────────
    if (quoteSearch) {
      filtered = filtered.filter(card => cardMatchesSearch(card, quoteSearch));
    }

    return filtered;
  }, [cards, quoteSearch, dateFilter, dayDate, weekEndDate, weekRangeDays, monthFilterYear, monthFilterMonth, userRole, userName, userFilter, workStatusFilter, remarkTypeFilter, activeChannel]);

  const approvedQuotationCards = useMemo(() => {
    if (activeChannel !== 'Quotation') return [] as CardType[];
    let approved = filterCardsByDate(cards).filter(card => card.approved);
    if (userRole === 'user') {
      approved = approved.filter(card => {
        if (card.assignedTo === userName) return true;
        if (!card.assignedTo) {
          const history = card.assignmentHistory ?? [];
          const wasForwardedToOther = history.some(h => h.assignedTo && h.assignedTo !== userName);
          const selfCreated = history.some(h => h.assignedBy === userName && h.assignedTo === userName);
          return selfCreated && !wasForwardedToOther;
        }
        return false;
      });
    }
    return approved.sort((a, b) => {
      const aMs = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const bMs = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return bMs - aMs;
    });
  }, [activeChannel, cards, dateFilter, dayDate, weekEndDate, weekRangeDays, monthFilterYear, monthFilterMonth, userRole, userName]);

  const handleUpdateCard = (updatedCard: CardType) => {
    const now = new Date().toISOString();
    const normalizedCard: CardType = {
      ...updatedCard,
      updatedAt: updatedCard.updatedAt || now,
    };
    const updatedCards = cards.map(card =>
      card.id === normalizedCard.id ? normalizedCard : card
    );
    setCards(updatedCards);
    setSelectedCard(normalizedCard);
  };

  const handleDeleteCard = (cardId: string) => {
    const updatedCards = cards.filter(card => card.id !== cardId);
    setCards(updatedCards);
    setSelectedCard(null);
    setSelectedCardIsNew(false);
  };

  /** Open a card that was JUST created — modal starts in edit mode. */
  const openNewCard = (card: CardType) => { setSelectedCard(card); setSelectedCardIsNew(true); };
  /** Open an existing card — modal starts in view mode. */
  const openExistingCard = (card: CardType) => { setSelectedCard(card); setSelectedCardIsNew(false); };

  const handleAddCard = async (list: ListType) => {
    // ALL Work Order channel cards require PO doc before creation
    if (activeChannel === 'Work Order') {
      setWOPreCreate({
        list,
        scheduleType: list === 'Schedule' ? 'Delivery' : undefined,
        woNumber: '',
        companyCode: 'GRP',
        poFile: null,
        qtnFile: null,
      });
      return;
    }
    const _now = new Date().toISOString();
    const newCard: CardType = {
      id: Date.now().toString(),
      quoteNumber: `NEW/${new Date().getFullYear()}/${Math.floor(Math.random() * 10000)}`,
      workOrderNumber: undefined,
      customerName: '',
      customerCompanyName: '',
      date: new Date().toISOString().split('T')[0],
      salesPerson: '',
      subject: '',
      projectLocation: '',
      list: list,
      channel: activeChannel,
      companyCode: undefined,
      remarks: [],
      listHistory: [{ list, enteredAt: _now }],
      // Non-admin users are automatically assigned to their own card so it
      // immediately appears in their filtered view.
      assignedTo: userRole !== 'admin' ? userName : undefined,
      userWorkStatus: userRole !== 'admin' ? 'Assigned' : undefined,
      assignmentHistory: userRole !== 'admin'
        ? [{ assignedTo: userName, assignedAt: _now, assignedBy: userName }]
        : [],
      createdAt: _now,
      updatedAt: _now,
    };
    // Persist to DB first — file uploads & WebSocket broadcasts require the card to exist.
    try {
      const created = await onCreateInChannel(activeChannel, newCard);
      openNewCard(created);
    } catch {
      // Fallback: add locally if API is unavailable
      setCards([...cards, newCard]);
      openNewCard(newCard);
    }
  };

  const handleGlobalAddCard = () => {
    if (lists.length === 0) return;
    handleAddCard(lists[0]);
  };

  const handleWOPreCreateConfirm = async () => {
    if (!woPreCreate?.poFile || !woPreCreate.woNumber.trim()) return;
    const _woNow = new Date().toISOString();
    const uid = localStorage.getItem('userId');
    const performedBy = uid ? Number(uid) : undefined;
    const scheduleType: 'Delivery' | 'Installation' | undefined =
      woPreCreate.list === 'Schedule' ? woPreCreate.scheduleType : undefined;
    if (woPreCreate.list === 'Schedule' && !scheduleType) return;
    const scheduleStage = woPreCreate.list === 'Schedule'
      ? (scheduleType === 'Installation' ? 'Pending installation' : 'Pending delivery')
      : undefined;
    const newCard: CardType = {
      id: Date.now().toString(),
      quoteNumber: '',
      workOrderNumber: woPreCreate.woNumber.trim(),
      customerName: '',
      customerCompanyName: '',
      date: new Date().toISOString().split('T')[0],
      salesPerson: '',
      subject: '',
      projectLocation: '',
      list: woPreCreate.list,
      scheduleType,
      scheduleStage,
      channel: 'Work Order',
      companyCode: woPreCreate.companyCode || 'GRP',
      remarks: [],
      listHistory: [{ list: woPreCreate.list, enteredAt: _woNow }],
      // Non-admin users are automatically assigned to their own card.
      assignedTo: userRole !== 'admin' ? userName : undefined,
      userWorkStatus: userRole !== 'admin' ? 'Assigned' : undefined,
      assignmentHistory: userRole !== 'admin'
        ? [{ assignedTo: userName, assignedAt: _woNow, assignedBy: userName }]
        : [],
      createdAt: _woNow,
      updatedAt: _woNow,
    };
    setWOPreCreate(null);

    // Create card in DB first so we can upload files against its ID
    let created: CardType;
    try {
      created = await onCreateInChannel('Work Order', newCard);
    } catch {
      return; // onCreateInChannel already updates state on failure
    }

    // Upload documents after card exists in DB
    const { uploadDocument } = await import('@/lib/api');
    let poDocName: string | undefined;
    let poDocUrl: string | undefined;
    let qtnDocName: string | undefined;
    let qtnDocUrl: string | undefined;

    if (woPreCreate.poFile) {
      try {
        const res = await uploadDocument(created.id, 'po', woPreCreate.poFile.raw, performedBy);
        poDocName = res.fileName;
        poDocUrl = res.url;
      } catch (err) {
        alert(`PO doc upload failed: ${(err as Error).message}`);
      }
    }
    if (woPreCreate.qtnFile) {
      try {
        const res = await uploadDocument(created.id, 'qtn', woPreCreate.qtnFile.raw, performedBy);
        qtnDocName = res.fileName;
        qtnDocUrl = res.url;
      } catch { /* optional doc — non-fatal */ }
    }

    if (poDocName) {
      const withDocs: CardType = {
        ...created,
        purchaseOrderDocName: poDocName,
        purchaseOrderDocUrl: poDocUrl,
        quotationDocName: qtnDocName,
        quotationDocUrl: qtnDocUrl,
        updatedAt: new Date().toISOString(),
      };
      // Open in edit mode so the user can fill in card details right away.
      openNewCard(withDocs);
    } else {
      openNewCard(created);
    }
  };

  const handleApproveCard = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    // Require PO doc for LPO approvals
    if (card.list === 'LPO' && activeChannel === 'Quotation') {
      if (!card.purchaseOrderDocData && !card.purchaseOrderDocUrl) {
        alert('Upload the Purchase Order document before approving this LPO card.');
        return;
      }
      if (!card.quotationDocData && !card.quotationDocUrl) {
        alert('Upload the Quotation document before approving this LPO card.');
        return;
      }
      // Show WO number dialog before approving
      const knownCodes = ['GRP', 'GRPPT', 'CLX'];
      const firstSegment = (card.quoteNumber || '').split('/')[0].toUpperCase();
      const companyCode = knownCodes.includes(firstSegment) ? firstSegment : (card.companyCode || 'GRP');
      setLpoApprovalPending({ cardId, woNumber: '', companyCode, assigneeName: '' });
      return;
    }

    _doApprove(cardId, undefined, undefined, undefined);
  };

  const _doApprove = (cardId: string, woNumber: string | undefined, companyCode: string | undefined, assigneeName: string | undefined) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const actionedAt = new Date().toISOString();

    const updatedCards = cards.map(c =>
      c.id === cardId ? { ...c, approved: true, assignmentHistory: appendActionHistory(c, 'Approved', actionedAt), updatedAt: actionedAt } : c
    );
    setCards(updatedCards);

    // When LPO approved, create a Work Order card
    if (card.list === 'LPO' && activeChannel === 'Quotation' && onCreateInChannel) {
      const resolvedCode = companyCode ?? (() => {
        const knownCodes = ['GRP', 'GRPPT', 'CLX'];
        const firstSegment = (card.quoteNumber || '').split('/')[0].toUpperCase();
        return knownCodes.includes(firstSegment) ? firstSegment : (card.companyCode || 'GRP');
      })();
      const now = new Date().toISOString();
      const cloneSeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const clone: CardType = {
        ...card,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        channel: 'Work Order',
        list: 'Work Order',
        approved: true,
        terminated: false,
        workOrderNumber: woNumber ?? '0000',
        companyCode: resolvedCode,
        assignedTo: assigneeName,
        userWorkStatus: assigneeName ? 'Assigned' : undefined,
        // Preserve quotation remarks as immutable history in the WO card.
        remarks: (card.remarks ?? []).map((r, idx) => ({
          ...r,
          id: `${cloneSeed}-${idx}-${r.list}`,
        })),
        assignmentHistory: assigneeName
          ? [...(card.assignmentHistory ?? []), { assignedTo: assigneeName, assignedAt: now, assignedBy: userName }]
          : (card.assignmentHistory ?? []),
        listHistory: [{ list: 'Work Order' as ListType, enteredAt: now }],
        createdAt: now,
        updatedAt: now,
      };
      onCreateInChannel('Work Order', clone);
    }
  };

  const handleTerminateCard = (cardId: string) => {
    const actionedAt = new Date().toISOString();
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, terminated: true, assignmentHistory: appendActionHistory(card, 'Terminated', actionedAt), updatedAt: actionedAt } : card
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
    const actionedAt = new Date().toISOString();
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, terminated: false, assignmentHistory: appendActionHistory(card, 'Redo', actionedAt), updatedAt: actionedAt } : card
    );
    setCards(updatedCards);
  };

  const handleReviseCard = (cardId: string) => {
    setRevisionPending({ cardId, revisionNumber: '' });
  };

  const _doRevise = (cardId: string, revNum: number) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    // Strip any existing /R{n} suffix so we don't do GRP/001/R1/R2
    const baseQuote = card.quoteNumber.replace(/\/R\d+$/, '');
    const newQuoteNumber = `${baseQuote}/R${revNum}`;
    const now = new Date().toISOString();
    const revisedHistory = appendActionHistory(card, 'Revised', now);
    const revisedCard: CardType = {
      ...card,
      quoteNumber: newQuoteNumber,
      revisionNumber: revNum,
      approved: false,
      terminated: false,
      assignmentHistory: revisedHistory,
      updatedAt: now,
    };
    setCards(cards.map(c => c.id === cardId ? revisedCard : c));
    if (selectedCard?.id === cardId) {
      setSelectedCard(revisedCard);
    }
  };

  const handleSwitchScheduleType = (cardId: string) => {
    const now = new Date().toISOString();
    const updatedCards = cards.map(card => {
      if (card.id !== cardId) return card;
      const next = card.scheduleType === 'Delivery' ? 'Installation' : 'Delivery';
      return { ...card, scheduleType: next as import('@/types').ScheduleType, updatedAt: now };
    });
    setCards(updatedCards);
  };

  const handleAssignUser = (cardId: string, assigneeName: string | undefined) => {
    const now = new Date().toISOString();
    const updatedCards = cards.map(card => {
      if (card.id !== cardId) return card;
      const history = card.assignmentHistory ?? [];
      const last = history[history.length - 1];
      const sameAsCurrent = (card.assignedTo ?? '') === (assigneeName ?? '');
      const sameAsLast = !!assigneeName && !!last && last.assignedTo === assigneeName && last.assignedBy === userName;
      return {
        ...card,
        assignedTo: assigneeName,
        userWorkStatus: assigneeName ? ('Assigned' as UserWorkStatus) : undefined,
        assignmentHistory: (assigneeName && !sameAsCurrent && !sameAsLast)
          ? [...history, { assignedTo: assigneeName, assignedAt: now, assignedBy: userName }]
          : history,
        updatedAt: now,
      };
    });
    setCards(updatedCards);
  };

  const handleUpdateWorkStatus = (cardId: string, status: UserWorkStatus) => {
    const now = new Date().toISOString();
    const updatedCards = cards.map(card =>
      card.id === cardId ? { ...card, userWorkStatus: status, updatedAt: now } : card
    );
    setCards(updatedCards);
  };

  const applyCardMove = (cardId: string, destList: ListType, scheduleType?: 'Delivery' | 'Installation') => {
    const movedCard = cards.find(card => card.id === cardId);
    if (!movedCard) return;

    const moveTime = new Date().toISOString();
    const nextScheduleType = scheduleType ?? movedCard.scheduleType;
    const nextScheduleStage = destList === 'Schedule'
      ? (nextScheduleType === 'Installation' ? 'Pending installation' : 'Pending delivery')
      : movedCard.scheduleStage;
    const updatedCard = {
      ...movedCard,
      list: destList,
      scheduleType: nextScheduleType,
      scheduleStage: nextScheduleStage,
      updatedAt: moveTime,
      listHistory: [
        ...(movedCard.listHistory ?? [{ list: movedCard.list, enteredAt: movedCard.createdAt }]),
        { list: destList, enteredAt: moveTime },
      ],
    };

    const updatedCards = cards.map(card => card.id === cardId ? updatedCard : card);
    setCards(updatedCards);

    if (selectedCard?.id === cardId) {
      setSelectedCard(updatedCard);
    }
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

    if (destList === 'Schedule' && sourceList !== 'Schedule') {
      setPendingScheduleChoice({ srcId: sourceList, dstId: destList, cardId, dstIdx: destination.index });
      return;
    }

    applyCardMove(cardId, destList, movedCard.scheduleType);
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
                <span className="font-semibold text-pink-600">{userName}</span>
              </div>
              {userRole !== 'admin' && userDepartment && (
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
                  placeholder="Search quote, WO, customer, location, sales, date"
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
                    {(['Quotation', 'Work Order', 'Schedule'] as ChannelType[]).map(ch => {
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
                            ch === 'Quotation' ? 'bg-blue-100' : ch === 'Work Order' ? 'bg-orange-100' : 'bg-purple-100'
                          }`}>
                            {ch === 'Quotation'
                              ? <FileText className="w-4 h-4 text-blue-600" />
                              : ch === 'Work Order'
                              ? <ClipboardList className="w-4 h-4 text-orange-500" />
                              : <CalendarRange className="w-4 h-4 text-purple-600" />}
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

              <button
                onClick={handleGlobalAddCard}
                disabled={lists.length === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                  lists.length > 0
                    ? 'bg-pink-500 text-white hover:bg-pink-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>Add Card</span>
              </button>

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
              {activeChannel === 'Quotation' && (
                <button
                  onClick={() => setShowApprovedCardsModal(true)}
                  className="px-3 py-1.5 text-xs font-medium bg-green-50 border border-green-200 text-green-700 rounded-lg hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-400"
                >
                  Approved Cards
                </button>
              )}
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
            {activeChannel === 'Work Order' ? (
              <div className="grid h-full min-w-[1080px] grid-cols-1 gap-3 md:grid-cols-2 xl:min-w-0 xl:grid-cols-4 auto-rows-fr">
                {lists.includes('Work Order') ? renderKanbanList('Work Order', 'h-full min-h-0') : <div />}
                {lists.includes('Approval') ? renderKanbanList('Approval', 'h-full min-h-0') : <div />}
                {lists.includes('Payments') ? renderKanbanList('Payments', 'h-full min-h-0') : <div />}
                {lists.includes('Schedule') ? renderKanbanList('Schedule', 'h-full min-h-0 border-2 border-violet-200 bg-violet-50/30 shadow-[0_0_0_2px_rgba(139,92,246,0.12)]') : <div />}
              </div>
            ) : (
              <div className="flex gap-3 h-full w-full">
                {lists.map(list => renderKanbanList(list, 'h-full min-h-0'))}
              </div>
            )}
          </DragDropContext>
        </div>
      )}

      {showApprovedCardsModal && activeChannel === 'Quotation' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-green-600 to-emerald-500 text-white">
              <div>
                <h3 className="text-lg font-semibold">Approved Quotation Cards</h3>
                <p className="text-xs text-green-50 mt-0.5">Filtered by current {dateFilter} selection</p>
              </div>
              <button
                onClick={() => setShowApprovedCardsModal(false)}
                className="p-2 rounded-lg hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-4 bg-gray-50">
              {approvedQuotationCards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-400">
                  No approved cards for the selected {dateFilter} filter.
                </div>
              ) : (
                <div className="space-y-3">
                  {approvedQuotationCards.map(card => (
                    <button
                      key={card.id}
                      onClick={() => {
                        setShowApprovedCardsModal(false);
                        openExistingCard(card);
                      }}
                      className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-green-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                            <p className="text-sm font-semibold text-gray-800 truncate">{card.quoteNumber}</p>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 truncate">{card.subject || 'No subject'}</p>
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400 flex-wrap">
                            <span>{card.list}</span>
                            <span>•</span>
                            <span>{card.date}</span>
                            {card.assignedTo && (
                              <>
                                <span>•</span>
                                <span>Assigned to {card.assignedTo}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="px-2 py-1 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">Approved</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
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
                  placeholder="Search quote, WO, customer, location, sales, date"
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
              <div className="mt-3 text-sm text-gray-500">
                Showing {filteredCards.filter(card => 
                  cardMatchesSearch(card, cardSearch)
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
                    .filter(card => cardMatchesSearch(card, cardSearch))
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
          'Approval':     '#0d9488',  // teal
          'Payments':     '#0891b2',  // sky
          'Schedule':     '#f59e0b',  // amber
          'Delivery':     '#ef4444',  // legacy red
          'Installation': '#16a34a',  // legacy green
        };
        const LIST_BG: Record<string, string> = {
          'Quotation':    'bg-blue-100 text-blue-700',
          'Submittal':    'bg-indigo-100 text-indigo-700',
          'Review':       'bg-violet-100 text-violet-700',
          'LPO':          'bg-orange-100 text-orange-700',
          'Work Order':   'bg-purple-100 text-purple-700',
          'Approval':     'bg-teal-100 text-teal-700',
          'Payments':     'bg-sky-100 text-sky-700',
          'Schedule':     'bg-amber-100 text-amber-700',
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

        // helper: simple linear position across the full view window
        const toPct = (ms: number) =>
          Math.max(0, Math.min(100, ((ms - viewStart) / viewDur) * 100));

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

        // Gantt always uses ALL channel cards regardless of date/search filters
        // so cards created outside the current date-filter window still appear.
        const visibleCards = cards.filter(card => {
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
                      {/* noon tick marks in header */}
                      {days.map((day, di) => {
                        const pct = ((di + 0.5) / days.length) * 100;
                        return (
                          <div key={`hd-${di}`}
                               className="absolute bottom-0 w-px bg-gray-400"
                               style={{ left: `${pct}%`, height: '6px' }} />
                        );
                      })}
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
                          {/* noon sub-dividers */}
                          {days.map((_day, di) => {
                            const pct = ((di + 0.5) / days.length) * 100;
                            return (
                              <div key={`tick-${di}`}
                                   className="absolute top-0 bottom-0 w-px"
                                   style={{ left: `${pct}%`, backgroundColor: 'rgba(156, 163, 175, 0.25)' }} />
                            );
                          })}
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
          isNew={selectedCardIsNew}
          onClose={() => { setSelectedCard(null); setSelectedCardIsNew(false); }}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
          userRole={userRole}
          userName={userName}
          userDepartment={userDepartment}
          channel={activeChannel}
        />
      )}

      {pendingScheduleChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">Choose Schedule Type</h3>
              <p className="text-sm text-gray-500 mt-1">Pick how this card should appear in Schedule.</p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => { applyCardMove(pendingScheduleChoice.cardId, 'Schedule', 'Delivery'); setPendingScheduleChoice(null); }}
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-left hover:bg-amber-100 transition-colors"
              >
                <div className="text-sm font-semibold text-amber-800">Delivery</div>
                <div className="text-xs text-amber-700 mt-1">Pending delivery</div>
              </button>
              <button
                onClick={() => { applyCardMove(pendingScheduleChoice.cardId, 'Schedule', 'Installation'); setPendingScheduleChoice(null); }}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-left hover:bg-emerald-100 transition-colors"
              >
                <div className="text-sm font-semibold text-emerald-800">Installation</div>
                <div className="text-xs text-emerald-700 mt-1">Pending installation</div>
              </button>
            </div>
            <div className="px-4 pb-4 flex justify-end">
              <button
                onClick={() => setPendingScheduleChoice(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quotation Revision — enter Revision Number */}
      {revisionPending && (() => {
        const card = cards.find(c => c.id === revisionPending.cardId);
        const baseQuote = card ? card.quoteNumber.replace(/\/R\d+$/, '') : '';
        const preview = revisionPending.revisionNumber.trim()
          ? `${baseQuote}/R${revisionPending.revisionNumber.trim()}`
          : '';
        return (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-t-2xl">
                <div>
                  <h2 className="text-base font-bold text-white">Revise Quotation</h2>
                  <p className="text-indigo-100 text-xs mt-0.5">Enter a revision number to update this card in place</p>
                </div>
                <button onClick={() => setRevisionPending(null)} className="p-1.5 rounded-lg hover:bg-indigo-500 transition-colors">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="px-6 py-5">
                {card && (
                  <p className="text-xs text-gray-500 mb-3">
                    Original: <span className="font-semibold text-gray-700">{baseQuote}</span>
                  </p>
                )}
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Revision Number</span>
                  <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
                </div>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 1"
                  value={revisionPending.revisionNumber}
                  onChange={(e) => setRevisionPending(p => p ? { ...p, revisionNumber: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-2"
                  autoFocus
                  onKeyDown={(e) => {
                    const n = parseInt(revisionPending.revisionNumber.trim(), 10);
                    if (e.key === 'Enter' && !isNaN(n) && n >= 1) {
                      setRevisionPending(null);
                      _doRevise(revisionPending.cardId, n);
                    }
                  }}
                />
                {preview && (
                  <p className="text-xs text-indigo-600 font-medium">New quote number: <span className="font-bold">{preview}</span></p>
                )}
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                <button onClick={() => setRevisionPending(null)} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                <button
                  disabled={(() => { const n = parseInt(revisionPending.revisionNumber.trim(), 10); return isNaN(n) || n < 1; })()}
                  onClick={() => {
                    const n = parseInt(revisionPending.revisionNumber.trim(), 10);
                    if (isNaN(n) || n < 1) return;
                    setRevisionPending(null);
                    _doRevise(revisionPending.cardId, n);
                  }}
                  className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                    (() => { const n = parseInt(revisionPending.revisionNumber.trim(), 10); return !isNaN(n) && n >= 1; })()
                      ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Apply Revision
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* LPO Approval — enter Work Order Number */}
      {lpoApprovalPending && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-600 to-green-500 rounded-t-2xl">
              <div>
                <h2 className="text-base font-bold text-white">Approve LPO</h2>
                <p className="text-green-100 text-xs mt-0.5">Enter a Work Order number to proceed</p>
              </div>
              <button onClick={() => setLpoApprovalPending(null)} className="p-1.5 rounded-lg hover:bg-green-500 transition-colors">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">Work Order Number</span>
                <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-l-lg text-sm font-medium text-gray-600 flex-shrink-0">
                  {lpoApprovalPending.companyCode} /
                </span>
                <input
                  type="text"
                  placeholder="e.g. 4185"
                  value={lpoApprovalPending.woNumber}
                  onChange={(e) => setLpoApprovalPending(p => p ? { ...p, woNumber: e.target.value } : null)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  autoFocus
                  onKeyDown={(e) => {
                    const validAssignee = workOrderAssignableUsers.some(u => u.name === lpoApprovalPending.assigneeName);
                    if (e.key === 'Enter' && lpoApprovalPending.woNumber.trim() && validAssignee) {
                      const { cardId, woNumber, companyCode } = lpoApprovalPending;
                      setLpoApprovalPending(null);
                      _doApprove(cardId, woNumber.trim(), companyCode, lpoApprovalPending.assigneeName);
                    }
                  }}
                />
              </div>
              {lpoApprovalPending.woNumber.trim() && (
                <p className="text-xs text-green-600 font-medium">Work Order will be: {lpoApprovalPending.companyCode}/{lpoApprovalPending.woNumber.trim()}</p>
              )}

              <div className="mt-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Assign To</span>
                  <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
                </div>
                <input
                  type="text"
                  list="lpo-assignable-users"
                  placeholder="Search user..."
                  value={lpoApprovalPending.assigneeName}
                  onChange={(e) => setLpoApprovalPending(p => p ? { ...p, assigneeName: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
                <datalist id="lpo-assignable-users">
                  {workOrderAssignableUsers.map(u => (
                    <option key={u.name} value={u.name} label={`${u.name} — ${u.department || 'No Department'}`} />
                  ))}
                </datalist>
                {workOrderAssignableUsers.some(u => u.name === lpoApprovalPending.assigneeName) && (
                  <p className="mt-1 text-xs text-gray-500">
                    Department: {workOrderAssignableUsers.find(u => u.name === lpoApprovalPending.assigneeName)?.department}
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setLpoApprovalPending(null)} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                disabled={!lpoApprovalPending.woNumber.trim() || !workOrderAssignableUsers.some(u => u.name === lpoApprovalPending.assigneeName)}
                onClick={() => {
                  const { cardId, woNumber, companyCode, assigneeName } = lpoApprovalPending;
                  setLpoApprovalPending(null);
                  _doApprove(cardId, woNumber.trim(), companyCode, assigneeName);
                }}
                className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  (lpoApprovalPending.woNumber.trim() && workOrderAssignableUsers.some(u => u.name === lpoApprovalPending.assigneeName))
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Approve &amp; Create Work Order
              </button>
            </div>
          </div>
        </div>
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
              {/* Stage — required */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-800">Stage</span>
                  <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
                </div>
                <select
                  value={woPreCreate.list}
                  onChange={(e) => {
                    const nextList = e.target.value as ListType;
                    setWOPreCreate(p => p ? {
                      ...p,
                      list: nextList,
                      scheduleType: nextList === 'Schedule' ? (p.scheduleType ?? 'Delivery') : undefined,
                    } : null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  {WORK_ORDER_LISTS.map(stage => {
                    const isAccessible = userRole === 'admin' || lists.includes(stage);
                    return (
                      <option key={stage} value={stage} disabled={!isAccessible}>
                        {stage}{isAccessible ? '' : ' (No Access)'}
                      </option>
                    );
                  })}
                </select>
              </div>

              {woPreCreate.list === 'Schedule' && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-800">Schedule Type</span>
                    <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setWOPreCreate(p => p ? { ...p, scheduleType: 'Delivery' } : null)}
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                        woPreCreate.scheduleType === 'Delivery'
                          ? 'border-amber-300 bg-amber-50 text-amber-800'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Delivery pending
                    </button>
                    <button
                      type="button"
                      onClick={() => setWOPreCreate(p => p ? { ...p, scheduleType: 'Installation' } : null)}
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                        woPreCreate.scheduleType === 'Installation'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Installation pending
                    </button>
                  </div>
                </div>
              )}

              {/* Work Order Number — required */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-800">Work Order Number</span>
                  <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
                </div>
                <div className="flex items-center gap-0">
                  <select
                    value={woPreCreate.companyCode}
                    onChange={(e) => setWOPreCreate(p => p ? { ...p, companyCode: e.target.value } : null)}
                    className="px-2 py-2 bg-gray-100 border border-gray-300 border-r-0 rounded-l-lg text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 flex-shrink-0"
                  >
                    <option value="GRP">GRP</option>
                    <option value="GRPPT">GRPPT</option>
                    <option value="CLX">CLX</option>
                  </select>
                  <span className="px-2 py-2 bg-gray-100 border-t border-b border-gray-300 text-sm text-gray-500 flex-shrink-0">/</span>
                  <input
                    type="text"
                    placeholder="e.g. 4185"
                    value={woPreCreate.woNumber}
                    onChange={(e) => setWOPreCreate(p => p ? { ...p, woNumber: e.target.value } : null)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    autoFocus
                  />
                </div>
                {woPreCreate.woNumber.trim() && (
                  <p className="mt-1 text-xs text-orange-600 font-medium">Card will be shown as: {woPreCreate.companyCode}/{woPreCreate.woNumber.trim()}</p>
                )}
              </div>

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
                      setWOPreCreate(p => p ? { ...p, poFile: { name: file.name, raw: file } } : null);
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
                      setWOPreCreate(p => p ? { ...p, qtnFile: { name: file.name, raw: file } } : null);
                    }} />
                  </label>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setWOPreCreate(null)} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                disabled={!woPreCreate.poFile || !woPreCreate.woNumber.trim() || (woPreCreate.list === 'Schedule' && !woPreCreate.scheduleType)}
                onClick={handleWOPreCreateConfirm}
                className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  woPreCreate.poFile && woPreCreate.woNumber.trim() && (woPreCreate.list !== 'Schedule' || !!woPreCreate.scheduleType)
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
