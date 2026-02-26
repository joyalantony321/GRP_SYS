import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import KanbanBoard from '@/components/KanbanBoard';
import AdminPanel from '@/components/AdminPanel';
import { Card, ChannelType, Department, CHANNEL_DEPARTMENTS } from '@/types';
import kanbanDataJson from '@/data/kanban-data.json';

export default function Kanban() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'admin' | 'user' | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userDepartment, setUserDepartment] = useState<Department | ''>('');
  const [activeChannel, setActiveChannel] = useState<ChannelType>('Quotation');
  const [cardsByChannel, setCardsByChannel] = useState<Record<ChannelType, Card[]>>({
    'Quotation': [],
    'Work Order': [],
  });
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  /** Reads a single channel's cards out of localStorage (strips nothing — doc data is already stripped on write). */
  const loadChannelFromStorage = (channel: ChannelType, fallback: Card[]): Card[] => {
    const key = `kanbanCards_${channel}`;
    const legacy = channel === 'Quotation' ? localStorage.getItem('kanbanCards') : null;
    const stored = localStorage.getItem(key) || legacy;
    if (stored) {
      try { return JSON.parse(stored); } catch { /* fall through */ }
    }
    return fallback;
  };

  useEffect(() => {
    const role = localStorage.getItem('userRole') as 'admin' | 'user' | null;
    const name = localStorage.getItem('userName') || '';
    const dept = (localStorage.getItem('userDepartment') || '') as Department | '';
    if (!role) {
      router.push('/');
    } else {
      setUserRole(role);
      setUserName(name);
      setUserDepartment(dept);

      const quotationCards = loadChannelFromStorage('Quotation', kanbanDataJson.cards as Card[]);
      const workOrderCards = loadChannelFromStorage('Work Order', []);
      setCardsByChannel({ 'Quotation': quotationCards, 'Work Order': workOrderCards });

      // Determine default channel based on department
      if (role === 'user' && dept) {
        const canQuotation = CHANNEL_DEPARTMENTS['Quotation'].includes(dept as Department);
        const canWorkOrder = CHANNEL_DEPARTMENTS['Work Order'].includes(dept as Department);
        if (!canQuotation && canWorkOrder) {
          setActiveChannel('Work Order');
        }
      }
    }
  }, [router]);

  // Re-sync cards from localStorage whenever another tab/session writes to the kanban keys.
  // This makes assignment changes from the admin session visible to the user session immediately.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === 'kanbanCards_Quotation' || e.key === 'kanbanCards') {
        setCardsByChannel(prev => ({
          ...prev,
          'Quotation': loadChannelFromStorage('Quotation', prev['Quotation']),
        }));
      }
      if (e.key === 'kanbanCards_Work Order') {
        setCardsByChannel(prev => ({
          ...prev,
          'Work Order': loadChannelFromStorage('Work Order', prev['Work Order']),
        }));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const saveCards = (channel: ChannelType, updatedCards: Card[]) => {
    setCardsByChannel(prev => ({ ...prev, [channel]: updatedCards }));
    const cleaned = updatedCards.map(({ purchaseOrderDocData, quotationDocData, completionDocData, ...rest }) => rest);
    localStorage.setItem(`kanbanCards_${channel}`, JSON.stringify(cleaned));
    // Keep legacy key in sync for Quotation
    if (channel === 'Quotation') {
      localStorage.setItem('kanbanCards', JSON.stringify(cleaned));
    }
  };

  const addCardToChannel = (channel: ChannelType, card: Card) => {
    setCardsByChannel(prev => {
      const nextChannelCards = [...(prev[channel] || []), card];
      const next = { ...prev, [channel]: nextChannelCards };
      const cleaned = nextChannelCards.map(({ purchaseOrderDocData, quotationDocData, completionDocData, ...rest }) => rest);
      localStorage.setItem(`kanbanCards_${channel}`, JSON.stringify(cleaned));
      if (channel === 'Quotation') {
        localStorage.setItem('kanbanCards', JSON.stringify(cleaned));
      }
      return next;
    });
  };

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
        setCards={(updated) => saveCards(activeChannel, updated)}
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
