import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import KanbanBoard from '@/components/KanbanBoard';
import AdminPanel from '@/components/AdminPanel';
import { Card, ChannelType, Department, CHANNEL_DEPARTMENTS } from '@/types';
import {
  fetchCards,
  createCard,
  updateCard,
  deleteCard,
  connectWebSocket,
} from '@/lib/api';

function upsertCardById(list: Card[], incoming: Card): Card[] {
  const incomingId = String(incoming.id);
  const next = list.filter(c => String(c.id) !== incomingId);
  const idx = list.findIndex(c => String(c.id) === incomingId);
  if (idx < 0) return [...next, incoming];
  next.splice(idx, 0, incoming);
  return next;
}

function dedupeCardsById(list: Card[]): Card[] {
  const map = new Map<string, Card>();
  list.forEach(c => map.set(String(c.id), c));
  return Array.from(map.values());
}

export default function Kanban() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'admin' | 'user' | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userDepartment, setUserDepartment] = useState<Department | ''>('');
  const [userId, setUserId] = useState<number | undefined>(undefined);
  const [activeChannel, setActiveChannel] = useState<ChannelType>('Quotation');
  const [cardsByChannel, setCardsByChannel] = useState<Record<ChannelType, Card[]>>({
    'Quotation': [],
    'Work Order': [],
  });
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Load cards for a channel from the API and store in state. */
  const loadChannel = useCallback(async (channel: ChannelType) => {
    try {
      const cards = await fetchCards(channel);
      setCardsByChannel(prev => ({ ...prev, [channel]: dedupeCardsById(cards) }));
    } catch (err) {
      console.error(`Failed to load cards for ${channel}:`, err);
    }
  }, []);

  useEffect(() => {
    const role = localStorage.getItem('userRole') as 'admin' | 'user' | null;
    const name = localStorage.getItem('userName') || '';
    const dept = (localStorage.getItem('userDepartment') || '') as Department | '';
    const uid = localStorage.getItem('userId');
    if (!role) {
      router.push('/');
      return;
    }
    setUserRole(role);
    setUserName(name);
    setUserDepartment(dept);
    if (uid) setUserId(Number(uid));

    // Load both channels from API
    loadChannel('Quotation');
    loadChannel('Work Order');

    // Determine default channel based on department
    if (role === 'user' && dept) {
      const canQuotation = CHANNEL_DEPARTMENTS['Quotation'].includes(dept as Department);
      const canWorkOrder = CHANNEL_DEPARTMENTS['Work Order'].includes(dept as Department);
      if (!canQuotation && canWorkOrder) {
        setActiveChannel('Work Order');
      }
    }
  }, [router, loadChannel]);

  // WebSocket — apply card events in real-time with auto-reconnect
  useEffect(() => {
    let destroyed = false;

    function connect(delay = 0) {
      wsRetryRef.current = setTimeout(() => {
        if (destroyed) return;
        const ws = connectWebSocket(
          (event) => {
            const evtType  = event.event as string | undefined;
            const channel  = (event.channelName ?? event.channel) as ChannelType | undefined;
            const cardData = event.card as Record<string, unknown> | undefined;

            if (evtType === 'card_deleted') {
              const deletedId = event.cardId as string;
              setCardsByChannel(prev => {
                const next = {} as Record<ChannelType, Card[]>;
                (Object.keys(prev) as ChannelType[]).forEach(ch => {
                  next[ch] = prev[ch].filter(c => c.id !== deletedId);
                });
                return next;
              });
              return;
            }

            // Doc uploaded — update the specific card's doc fields in place
            if (evtType === 'doc_uploaded' && channel) {
              const cardId   = event.cardId as string;
              const docType  = event.docType as string;
              const fileName = event.fileName as string;
              const url      = event.url as string;
              setCardsByChannel(prev => {
                const list = prev[channel] ?? [];
                return {
                  ...prev,
                  [channel]: list.map(c => {
                    if (c.id !== cardId) return c;
                    if (docType === 'po')   return { ...c, purchaseOrderDocName: fileName, purchaseOrderDocUrl: url };
                    if (docType === 'qtn')  return { ...c, quotationDocName: fileName,     quotationDocUrl:     url };
                    return { ...c, completionDocName: fileName, completionDocUrl: url };
                  }),
                };
              });
              return;
            }

            // Doc deleted — clear the specific card's doc fields
            if (evtType === 'doc_deleted' && channel) {
              const cardId  = event.cardId as string;
              const docType = event.docType as string;
              setCardsByChannel(prev => {
                const list = prev[channel] ?? [];
                return {
                  ...prev,
                  [channel]: list.map(c => {
                    if (c.id !== cardId) return c;
                    if (docType === 'po')   return { ...c, purchaseOrderDocName: undefined, purchaseOrderDocUrl: undefined };
                    if (docType === 'qtn')  return { ...c, quotationDocName: undefined,     quotationDocUrl:     undefined };
                    return { ...c, completionDocName: undefined, completionDocUrl: undefined };
                  }),
                };
              });
              return;
            }

            if (cardData && (evtType === 'card_updated' || evtType === 'card_created')) {
              // Import mapCard lazily to avoid circular dep issues
              import('@/lib/api').then(({ mapCard }) => {
                const updated = mapCard(cardData);
                const ch = channel ?? updated.channel;
                if (!ch) return;
                setCardsByChannel(prev => {
                  const list = prev[ch] ?? [];
                  const nextList = upsertCardById(list, updated);
                  return { ...prev, [ch]: nextList };
                });
              });
              return;
            }

            // Fallback: reload affected channel
            if (channel === 'Quotation' || channel === 'Work Order') {
              loadChannel(channel);
            } else {
              loadChannel('Quotation');
              loadChannel('Work Order');
            }
          },
          () => {
            // On close: reconnect after 3 s
            if (!destroyed) connect(3000);
          },
        );
        wsRef.current = ws;
      }, delay);
    }

    connect();
    return () => {
      destroyed = true;
      if (wsRetryRef.current) clearTimeout(wsRetryRef.current);
      wsRef.current?.close();
    };
  }, [loadChannel]);

  const addCardToChannel = useCallback(async (channel: ChannelType, card: Card): Promise<Card> => {
    try {
      const uid = userId ?? (localStorage.getItem('userId') ? Number(localStorage.getItem('userId')) : undefined);
      const created = await createCard({ ...card, channel }, uid);
      setCardsByChannel(prev => ({
        ...prev,
        [channel]: upsertCardById(prev[channel] ?? [], created),
      }));
      return created;
    } catch (err) {
      console.error('Failed to create card:', err);
      // Optimistic fallback — return the original card so callers have an id
      const fallback = { ...card, channel };
      setCardsByChannel(prev => ({
        ...prev,
        [channel]: upsertCardById(prev[channel] ?? [], fallback),
      }));
      return fallback;
    }
  }, [userId]);

  const handleChannelSwitch = (channel: ChannelType) => {
    setActiveChannel(channel);
  };

  // Determine which channels are accessible to the current user
  const accessibleChannels: ChannelType[] = userRole === 'admin'
    ? ['Quotation', 'Work Order']
    : (['Quotation', 'Work Order'] as ChannelType[]).filter(ch =>
        userDepartment ? CHANNEL_DEPARTMENTS[ch].includes(userDepartment as Department) : false
      );

  if (!userRole) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <KanbanBoard
        cards={cardsByChannel[activeChannel]}
        setCards={(updated) => {
          const prev = dedupeCardsById(cardsByChannel[activeChannel]);
          const nextUpdated = dedupeCardsById(updated);
          // Optimistic state update
          setCardsByChannel(p => ({ ...p, [activeChannel]: nextUpdated }));
          // Detect deletes
          const prevIds = new Set(prev.map(c => c.id));
          const newIds  = new Set(nextUpdated.map(c => c.id));
          prev.forEach(c => {
            if (!newIds.has(c.id)) {
              const uid = localStorage.getItem('userId');
              deleteCard(c.id, uid ? Number(uid) : undefined).catch(console.error);
            }
          });
          // Detect updates (cards present in both lists that changed)
          nextUpdated.forEach(c => {
            if (prevIds.has(c.id)) {
              const old = prev.find(p => p.id === c.id);
              if (JSON.stringify(old) !== JSON.stringify(c)) {
                const uid = localStorage.getItem('userId');
                updateCard(c, uid ? Number(uid) : undefined).catch(console.error);
              }
            }
          });
        }}
        userRole={userRole}
        userName={userName}
        userDepartment={userDepartment}
        activeChannel={activeChannel}
        accessibleChannels={accessibleChannels}
        onChannelSwitch={handleChannelSwitch}
        onCreateInChannel={addCardToChannel}
        onAdminSettings={userRole === 'admin' ? () => setShowAdminPanel(true) : undefined}
      />

      {/* Admin Panel Modal */}
      {showAdminPanel && (
        <AdminPanel onClose={() => setShowAdminPanel(false)} />
      )}
    </div>
  );
}
