import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import KanbanBoard from '@/components/KanbanBoard';
import AdminPanel from '@/components/AdminPanel';
import { Card } from '@/types';
import kanbanDataJson from '@/data/kanban-data.json';
import { Settings } from 'lucide-react';

export default function Kanban() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'admin' | 'user' | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [cards, setCards] = useState<Card[]>([]);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem('userRole') as 'admin' | 'user' | null;
    const name = localStorage.getItem('userName') || '';
    if (!role) {
      router.push('/');
    } else {
      setUserRole(role);
      setUserName(name);
      
      // Load cards from localStorage or use default
      const storedCards = localStorage.getItem('kanbanCards');
      if (storedCards) {
        try {
          setCards(JSON.parse(storedCards));
        } catch (error) {
          console.error('Error loading cards:', error);
          setCards(kanbanDataJson.cards as Card[]);
        }
      } else {
        setCards(kanbanDataJson.cards as Card[]);
      }
    }
  }, [router]);

  const saveCards = (updatedCards: Card[]) => {
    setCards(updatedCards);
    // Persist cards to localStorage
    localStorage.setItem('kanbanCards', JSON.stringify(updatedCards));
  };

  if (!userRole) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <KanbanBoard
        cards={cards}
        setCards={saveCards}
        userRole={userRole}
        userName={userName}
        onAdminSettings={userRole === 'admin' ? () => setShowAdminPanel(true) : undefined}
      />

      {/* Admin Panel Modal */}
      {showAdminPanel && (
        <AdminPanel onClose={() => setShowAdminPanel(false)} />
      )}
    </div>
  );
}
