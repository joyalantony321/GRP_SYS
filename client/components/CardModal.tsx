import { useState, useEffect } from 'react';
import { X, Edit2, Save, Trash2, Plus, Check, FileText } from 'lucide-react';
import { Card, ListType, Remark, RemarkType, Department, ChannelType, CHANNEL_LISTS, CHANNEL_DEPARTMENTS, getPermittedLists } from '@/types';
import WorkOrderFormModal from './WorkOrderFormModal';
import OrderConfirmationModal from './OrderConfirmationModal';
import { uploadDocument, deleteDocument, docUrl } from '@/lib/api';

interface Props {
  card: Card;
  onClose: () => void;
  onUpdate: (card: Card) => void;
  onDelete: (cardId: string) => void;
  userRole: 'admin' | 'user';
  userName: string;
  userDepartment?: Department | '';
  channel: ChannelType;
  /** True when the modal is opened for a brand-new card — starts in edit mode. */
  isNew?: boolean;
}

export default function CardModal({ card, onClose, onUpdate, onDelete, userRole, userName, userDepartment, channel, isNew }: Props) {
  // Admin sees all lists; regular users only see their permitted lists
  const lists = getPermittedLists(channel, userRole, userDepartment);
  const channelDepts = CHANNEL_DEPARTMENTS[channel];
  // New cards open directly in edit mode; existing cards open in view mode.
  const [isEditing, setIsEditing] = useState(isNew ?? false);
  const [editedCard, setEditedCard] = useState(card);
  const [showAddRemark, setShowAddRemark] = useState(false);
  const [selectedLists, setSelectedLists] = useState<ListType[]>([card.list]);
  const [remarkType, setRemarkType] = useState<RemarkType>('Active');
  const [remarkTags, setRemarkTags] = useState('');
  const [remarkDescription, setRemarkDescription] = useState('');
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(null);
  const [editRemarkData, setEditRemarkData] = useState<Partial<Remark>>({});
  const [visibleDepartments, setVisibleDepartments] = useState<Department[]>(channelDepts);
  const [showWOForm, setShowWOForm] = useState(false);
  const [showOCForm, setShowOCForm] = useState(false);
  const [docUploading, setDocUploading] = useState<Record<string, boolean>>({});
  const [quotationFallbackRemarks, setQuotationFallbackRemarks] = useState<Remark[]>([]);

  const quotationHistoryLists: ListType[] = ['Quotation', 'Submittal', 'Review', 'LPO'];
  const workOrderHistoryLists = lists.filter(l => !quotationHistoryLists.includes(l));
  const selectableRemarkLists = channel === 'Work Order' ? workOrderHistoryLists : lists;
  const isReadOnlyQuotationHistoryList = (list: ListType) => channel === 'Work Order' && quotationHistoryLists.includes(list);

  useEffect(() => {
    setEditedCard(card);
  }, [card]);

  useEffect(() => {
    let alive = true;

    const loadFallbackQuotationRemarks = async () => {
      if (channel !== 'Work Order') {
        if (alive) setQuotationFallbackRemarks([]);
        return;
      }

      const hasLocalQuotationHistory = (card.remarks ?? []).some(r => quotationHistoryLists.includes(r.list));
      if (hasLocalQuotationHistory || !card.quoteNumber?.trim()) {
        if (alive) setQuotationFallbackRemarks([]);
        return;
      }

      try {
        const { fetchCards } = await import('@/lib/api');
        const quotationCards = await fetchCards('Quotation');
        const sameQuote = quotationCards.find(q => (q.quoteNumber || '').trim() === card.quoteNumber.trim());
        const fallbackRemarks = (sameQuote?.remarks ?? []).filter(r => quotationHistoryLists.includes(r.list));
        if (alive) setQuotationFallbackRemarks(fallbackRemarks);
      } catch {
        if (alive) setQuotationFallbackRemarks([]);
      }
    };

    loadFallbackQuotationRemarks();
    return () => {
      alive = false;
    };
  }, [channel, card.id, card.quoteNumber, card.remarks]);

  const remarksForDisplay = (() => {
    if (channel !== 'Work Order' || quotationFallbackRemarks.length === 0) return editedCard.remarks;
    const merged = [...editedCard.remarks];
    const seen = new Set(merged.map(r => `${r.list}|${r.description}|${r.createdAt}`));
    for (const r of quotationFallbackRemarks) {
      const k = `${r.list}|${r.description}|${r.createdAt}`;
      if (!seen.has(k)) {
        merged.push(r);
        seen.add(k);
      }
    }
    return merged;
  })();

  const isDeliveryInstallation = userRole !== 'admin' && userDepartment === 'Delivery & Installation';
  const isPaymentViewer = channel === 'Work Order' && (userRole === 'admin' || userDepartment === 'Accounts');
  const modalPaymentPercent = Math.max(0, Math.min(100, Number(editedCard.paymentPercent ?? card.paymentPercent ?? 0)));
  const modalPaymentHue = Math.round((modalPaymentPercent / 100) * 120);
  const modalPaymentColor = `hsl(${modalPaymentHue} 78% 40%)`;
  const modalPaymentTrack = `conic-gradient(${modalPaymentColor} ${modalPaymentPercent * 3.6}deg, #e5e7eb ${modalPaymentPercent * 3.6}deg)`;

  const _performedBy = (): number | undefined => {
    const v = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
    return v ? Number(v) : undefined;
  };

  /** Upload a doc file to the server and update the card with the real URL. */
  const handlePODocUpload = async (file: File) => {
    setDocUploading(p => ({ ...p, po: true }));
    try {
      const { fileName, url } = await uploadDocument(card.id, 'po', file, _performedBy());
      const updated: Card = { ...card, purchaseOrderDocName: fileName, purchaseOrderDocUrl: url, purchaseOrderDocData: undefined, updatedAt: new Date().toISOString() };
      onUpdate(updated);
      setEditedCard(updated);
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setDocUploading(p => ({ ...p, po: false }));
    }
  };

  /** Upload a quotation doc file to the server and update the card with the real URL. */
  const handleQtnDocUpload = async (file: File) => {
    setDocUploading(p => ({ ...p, qtn: true }));
    try {
      const { fileName, url } = await uploadDocument(card.id, 'qtn', file, _performedBy());
      const updated: Card = { ...card, quotationDocName: fileName, quotationDocUrl: url, quotationDocData: undefined, updatedAt: new Date().toISOString() };
      onUpdate(updated);
      setEditedCard(updated);
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setDocUploading(p => ({ ...p, qtn: false }));
    }
  };

  const handleDeleteDoc = async (docType: 'po' | 'qtn' | 'completion') => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      await deleteDocument(card.id, docType, _performedBy());
    } catch { /* ignore — clear locally regardless */ }
    const cleared: Partial<Card> =
      docType === 'po'
        ? { purchaseOrderDocName: undefined, purchaseOrderDocUrl: undefined, purchaseOrderDocData: undefined }
        : docType === 'qtn'
        ? { quotationDocName: undefined, quotationDocUrl: undefined, quotationDocData: undefined }
        : { completionDocName: undefined, completionDocUrl: undefined, completionDocData: undefined };
    const updated: Card = { ...card, ...cleared, updatedAt: new Date().toISOString() };
    onUpdate(updated);
    setEditedCard(updated);
  };

  const handleSave = () => {
    onUpdate({ ...editedCard, updatedAt: new Date().toISOString() });
    setIsEditing(false);
  };

  const handleCloseModal = () => {
    onClose();
  };

  const handleAddRemark = () => {
    const newRemarks = selectedLists.map(list => ({
      id: `${Date.now()}-${list}`,
      list,
      type: remarkType,
      tags: remarkTags.split(',').map(tag => tag.trim()).filter(Boolean),
      description: remarkDescription,
      createdBy: userName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      visibleDepartments: visibleDepartments.length === channelDepts.length ? undefined : visibleDepartments,
    }));

    const updatedCard = {
      ...editedCard,
      remarks: [...editedCard.remarks, ...newRemarks],
      updatedAt: new Date().toISOString(),
    };

    onUpdate(updatedCard);
    setEditedCard(updatedCard);
    setShowAddRemark(false);
    setSelectedLists([selectableRemarkLists[0] ?? editedCard.list]);
    setRemarkType('Active');
    setRemarkTags('');
    setRemarkDescription('');
    setVisibleDepartments(channelDepts);
  };

  const handleUpdateRemark = (remarkId: string) => {
    const updatedRemarks = editedCard.remarks.map(remark =>
      remark.id === remarkId
        ? { ...remark, ...editRemarkData, updatedAt: new Date().toISOString() }
        : remark
    );

    const updatedCard = {
      ...editedCard,
      remarks: updatedRemarks,
      updatedAt: new Date().toISOString(),
    };

    onUpdate(updatedCard);
    setEditedCard(updatedCard);

    setEditingRemarkId(null);
    setEditRemarkData({});
  };

  const handleDeleteRemark = (remarkId: string) => {
    if (confirm('Are you sure you want to delete this remark?')) {
      const updatedRemarks = editedCard.remarks.filter(remark => remark.id !== remarkId);
      const updatedCard = {
        ...editedCard,
        remarks: updatedRemarks,
        updatedAt: new Date().toISOString(),
      };
      onUpdate(updatedCard);
      setEditedCard(updatedCard);
    }
  };

  const toggleListSelection = (list: ListType) => {
    setSelectedLists(prev =>
      prev.includes(list) ? prev.filter(l => l !== list) : [...prev, list]
    );
  };

  const getRemarkColor = (type: RemarkType) => {
    switch (type) {
      case 'Active':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'Pending':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'Inactive':
        return 'bg-blue-50 border-blue-200 text-blue-800';
    }
  };

  const getTypeBadgeColor = (type: RemarkType) => {
    switch (type) {
      case 'Active':
        return 'bg-red-500 text-white';
      case 'Pending':
        return 'bg-yellow-500 text-white';
      case 'Inactive':
        return 'bg-blue-500 text-white';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">Card Details</h2>
          <button
            onClick={handleCloseModal}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">

              {/* ── Light header strip ── */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${channel === 'Work Order' ? 'bg-purple-50 border-purple-100' : 'bg-pink-50 border-pink-100'}`}>
                <div className="flex items-center gap-2">
                  <FileText className={`w-3.5 h-3.5 ${channel === 'Work Order' ? 'text-purple-400' : 'text-pink-400'}`} />
                  <h3 className={`text-xs font-bold uppercase tracking-widest ${channel === 'Work Order' ? 'text-purple-700' : 'text-pink-700'}`}>
                    {channel === 'Work Order' ? 'Work Order Information' : 'Quote Information'}
                  </h3>
                </div>
                {userRole === 'admin' && !isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors font-medium border ${channel === 'Work Order' ? 'bg-white border-purple-200 text-purple-600 hover:bg-purple-50' : 'bg-white border-pink-200 text-pink-600 hover:bg-pink-50'}`}
                  >
                    <Edit2 className="w-3 h-3" />
                    Edit
                  </button>
                )}
                {isEditing && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors font-medium border ${channel === 'Work Order' ? 'bg-white border-purple-200 text-purple-600 hover:bg-purple-50' : 'bg-white border-pink-200 text-pink-600 hover:bg-pink-50'}`}
                    >
                      <Save className="w-3 h-3" />
                      Save
                    </button>
                    <button
                      onClick={() => { setIsEditing(false); setEditedCard(card); }}
                      className="px-2.5 py-1 text-xs bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* ── Primary identifier(s) ── */}
              <div className="px-4 pt-3 pb-2.5 bg-white border-b border-gray-100">
                {isEditing ? (
                  <div className={`grid gap-3 ${channel === 'Work Order' ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    {channel === 'Work Order' && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Company Code</label>
                          <select
                            value={editedCard.companyCode || 'GRP'}
                            onChange={(e) => setEditedCard({ ...editedCard, companyCode: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                          >
                            <option value="GRP">GRP</option>
                            <option value="GRPPT">GRPPT</option>
                            <option value="CLX">CLX</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Work Order No</label>
                          <input
                            type="text"
                            value={editedCard.workOrderNumber || ''}
                            onChange={(e) => setEditedCard({ ...editedCard, workOrderNumber: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="e.g. 001"
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Quote No</label>
                      <input
                        type="text"
                        value={editedCard.quoteNumber}
                        onChange={(e) => setEditedCard({ ...editedCard, quoteNumber: e.target.value })}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 ${channel === 'Work Order' ? 'focus:ring-purple-500' : 'focus:ring-pink-500'}`}
                        placeholder="e.g. QUO/2026/001"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-gray-800 leading-tight truncate">
                        {channel === 'Work Order'
                          ? `${card.companyCode || 'GRP'}/${card.workOrderNumber || '0000'}`
                          : card.quoteNumber}
                      </p>
                      {channel === 'Work Order' && card.quoteNumber && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Ref: <span className="font-medium text-gray-500">{card.quoteNumber}</span>
                        </p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-md border ${channel === 'Work Order' ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-pink-50 border-pink-200 text-pink-600'}`}>
                      {card.list}
                    </span>
                  </div>
                )}
              </div>

              {/* ── Meta strip: Date · Sales Person (+ List in edit) ── */}
              <div className={`px-4 border-b border-gray-100 ${isEditing ? 'py-3 bg-white' : 'py-2 bg-gray-50'}`}>
                {isEditing ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Date</label>
                      <input
                        type="date"
                        value={editedCard.date}
                        onChange={(e) => setEditedCard({ ...editedCard, date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Sales Person</label>
                      <input
                        type="text"
                        value={editedCard.salesPerson}
                        onChange={(e) => setEditedCard({ ...editedCard, salesPerson: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Customer Name</label>
                      <input
                        type="text"
                        value={editedCard.customerName || ''}
                        onChange={(e) => setEditedCard({ ...editedCard, customerName: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Customer Company Name</label>
                      <input
                        type="text"
                        value={editedCard.customerCompanyName || ''}
                        onChange={(e) => setEditedCard({ ...editedCard, customerCompanyName: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">List</label>
                      <select
                        value={editedCard.list}
                        onChange={(e) => setEditedCard({ ...editedCard, list: e.target.value as ListType })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      >
                        {lists.map(list => (
                          <option key={list} value={list}>{list}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Date</span>
                      <span className="text-gray-700 font-medium">{card.date}</span>
                    </div>
                    <span className="text-gray-300 select-none">·</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 text-xs font-semibold uppercase tracking-wide">By</span>
                      <span className="text-gray-700 font-medium">{card.salesPerson}</span>
                    </div>
                    <span className="text-gray-300 select-none">·</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Customer</span>
                      <span className="text-gray-700 font-medium">{card.customerName || '-'}</span>
                    </div>
                    <span className="text-gray-300 select-none">·</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Company</span>
                      <span className="text-gray-700 font-medium">{card.customerCompanyName || '-'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Subject & Project Location ── */}
              <div className="px-4 py-3 bg-white border-b border-gray-100 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Subject</p>
                  {isEditing ? (
                    <textarea
                      value={editedCard.subject}
                      onChange={(e) => setEditedCard({ ...editedCard, subject: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-800 leading-snug">{card.subject}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Project Location</p>
                  {isEditing ? (
                    <textarea
                      value={editedCard.projectLocation}
                      onChange={(e) => setEditedCard({ ...editedCard, projectLocation: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-sm text-gray-600 leading-snug">{card.projectLocation}</p>
                  )}
                </div>

                {isPaymentViewer && (
                  <div className="pt-1">
                    <div className="inline-flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
                      <div className="relative w-12 h-12 rounded-full" style={{ background: modalPaymentTrack }}>
                        <div className="absolute inset-[4px] rounded-full bg-white flex items-center justify-center">
                          <span className="text-[11px] font-semibold text-gray-700">{modalPaymentPercent}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-700">Payment Received</p>
                        <p className="text-[11px] text-gray-400">Visible to Accounts and Admin</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Documents ── */}
              {((channel === 'Quotation' && editedCard.list === 'LPO') || channel === 'Work Order') && (
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Documents</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                    {/* ── Purchase Order Document (hidden for Delivery & Installation) ── */}
                    {!isDeliveryInstallation && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <label className="block text-sm font-medium text-gray-700">Purchase Order Document</label>
                        {channel === 'Quotation' && <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required for approval</span>}
                      </div>
                      {docUploading.po && <p className="text-xs text-amber-600 animate-pulse">Uploading…</p>}
                      {(card.purchaseOrderDocName && (card.purchaseOrderDocData || card.purchaseOrderDocUrl)) ? (
                        <div className="relative group/doc">
                          <a
                            href={docUrl(card.purchaseOrderDocData || card.purchaseOrderDocUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 w-full px-4 py-3 bg-amber-50 border-2 border-amber-300 hover:bg-amber-100 hover:border-amber-400 rounded-xl transition-all"
                          >
                            <div className="flex-shrink-0 w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center">
                              <FileText className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0 pr-8">
                              <p className="text-sm font-semibold text-amber-900 truncate">{card.purchaseOrderDocName}</p>
                              <p className="text-xs text-amber-600">Click to open</p>
                            </div>
                          </a>
                          {userRole === 'admin' && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteDoc('po'); }}
                              title="Delete document"
                              className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors shadow"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic px-1">No PO document attached.</p>
                      )}
                      {!docUploading.po && isEditing && userRole === 'admin' && (
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx"
                          className="mt-2 w-full text-sm text-gray-700"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePODocUpload(file);
                          }}
                        />
                      )}
                      {!card.purchaseOrderDocName && userRole === 'user' && ((channel === 'Quotation' && card.list === 'LPO') || channel === 'Work Order') && (
                        <label className="mt-2 flex items-center gap-2 cursor-pointer text-sm text-amber-700 hover:text-amber-900 font-medium">
                          <FileText className="w-4 h-4" />
                          <span>Upload PO Document</span>
                          <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePODocUpload(file);
                          }} />
                        </label>
                      )}
                    </div>
                    )}

                    {/* ── Quotation Document (hidden for Delivery & Installation) ── */}
                    {!isDeliveryInstallation && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <label className="block text-sm font-medium text-gray-700">Quotation Document</label>
                        {channel === 'Quotation'
                          ? <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Required for approval</span>
                          : <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Optional</span>}
                      </div>
                      {docUploading.qtn && <p className="text-xs text-purple-600 animate-pulse">Uploading…</p>}
                      {(card.quotationDocName && (card.quotationDocData || card.quotationDocUrl)) ? (
                        <div className="relative group/doc">
                          <a
                            href={docUrl(card.quotationDocData || card.quotationDocUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 w-full px-4 py-3 bg-purple-50 border-2 border-purple-300 hover:bg-purple-100 hover:border-purple-400 rounded-xl transition-all"
                          >
                            <div className="flex-shrink-0 w-9 h-9 bg-purple-500 rounded-lg flex items-center justify-center">
                              <FileText className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0 pr-8">
                              <p className="text-sm font-semibold text-purple-900 truncate">{card.quotationDocName}</p>
                              <p className="text-xs text-purple-600">Click to open</p>
                            </div>
                          </a>
                          {userRole === 'admin' && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteDoc('qtn'); }}
                              title="Delete document"
                              className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors shadow"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic px-1">No Quotation document attached.</p>
                      )}
                      {!docUploading.qtn && isEditing && userRole === 'admin' && (
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx"
                          className="mt-2 w-full text-sm text-gray-700"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleQtnDocUpload(file);
                          }}
                        />
                      )}
                      {!card.quotationDocName && userRole === 'user' && ((channel === 'Quotation' && card.list === 'LPO') || channel === 'Work Order') && (
                        <label className="mt-2 flex items-center gap-2 cursor-pointer text-sm text-purple-700 hover:text-purple-900 font-medium">
                          <FileText className="w-4 h-4" />
                          <span>Upload Quotation Document</span>
                          <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleQtnDocUpload(file);
                          }} />
                        </label>
                      )}
                    </div>
                    )}

                    {/* ── Completion Document (Installation only) ── */}
                    {channel === 'Work Order' && editedCard.list === 'Installation' && (
                      <div className="col-span-1 md:col-span-2">
                        <div className="flex items-center gap-2 mb-2">
                          <label className="block text-sm font-medium text-gray-700">Completion Document</label>
                          {card.completedAt
                            ? <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">✓ Completed</span>
                            : <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Required for completion</span>}
                        </div>
                        {docUploading.completion && <p className="text-xs text-emerald-600 animate-pulse">Uploading…</p>}
                        {(editedCard.completionDocName && (editedCard.completionDocData || editedCard.completionDocUrl)) ? (
                          <div className="relative group/doc">
                            <a
                              href={docUrl(editedCard.completionDocData || editedCard.completionDocUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 w-full px-4 py-3 bg-emerald-50 border-2 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400 rounded-xl transition-all"
                            >
                              <div className="flex-shrink-0 w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center">
                                <FileText className="w-4 h-4 text-white" />
                              </div>
                              <div className="flex-1 min-w-0 pr-8">
                                <p className="text-sm font-semibold text-emerald-900 truncate">{editedCard.completionDocName}</p>
                                <p className="text-xs text-emerald-600">Click to open</p>
                              </div>
                            </a>
                            {userRole === 'admin' && (
                              <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteDoc('completion'); }}
                                title="Delete document"
                                className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors shadow"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 italic px-1">No Completion document attached.</p>
                        )}
                        {!docUploading.completion && isEditing && !card.completedAt && (
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            className="mt-2 w-full text-sm text-gray-700"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setDocUploading(p => ({ ...p, completion: true }));
                              try {
                                const { fileName, url } = await uploadDocument(card.id, 'completion', file, _performedBy());
                                const updated: Card = { ...card, completionDocName: fileName, completionDocUrl: url, completionDocData: undefined, updatedAt: new Date().toISOString() };
                                onUpdate(updated);
                                setEditedCard(updated);
                              } catch (err) {
                                alert(`Upload failed: ${(err as Error).message}`);
                              } finally {
                                setDocUploading(p => ({ ...p, completion: false }));
                              }
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Work Order / Order Confirmation action tiles ── */}
              {channel === 'Work Order' && (
                <div className="px-4 py-3 bg-white">
                  <div className={`grid gap-2 ${!isDeliveryInstallation ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {/* WO Details tile */}
                    <div className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border ${card.workOrderDetails ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="text-xs">
                        {card.workOrderDetails
                          ? <span className="flex items-center gap-1 text-green-600 font-semibold"><Check className="w-3 h-3" /> Filled</span>
                          : <span className="text-gray-400">Not filled</span>}
                      </div>
                      <button
                        onClick={() => setShowWOForm(true)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold rounded-md transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        WO Details
                      </button>
                    </div>
                    {/* Order Confirmation tile — hidden for D&I */}
                    {!isDeliveryInstallation && (
                      <div className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border ${card.orderConfirmationDetails ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="text-xs">
                          {card.orderConfirmationDetails
                            ? <span className="flex items-center gap-1 text-blue-600 font-semibold"><Check className="w-3 h-3" /> Confirmed</span>
                            : <span className="text-gray-400">Not confirmed</span>}
                        </div>
                        <button
                          onClick={() => setShowOCForm(true)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold rounded-md transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          Order Confirmation
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Remarks</h3>
                <button
                  onClick={() => setShowAddRemark(!showAddRemark)}
                  className="flex items-center gap-2 px-4 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Remark
                </button>
              </div>

              {showAddRemark && (
                <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-lg p-6 mb-6 border border-pink-200">
                  <h4 className="font-semibold text-gray-800 mb-4">New Remark</h4>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Lists (Check to add remark to multiple lists)
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      {selectableRemarkLists.map(list => (
                        <label
                          key={list}
                          className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            selectedLists.includes(list)
                              ? 'border-pink-500 bg-pink-50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedLists.includes(list)}
                            onChange={() => toggleListSelection(list)}
                            className="w-4 h-4 text-pink-500 rounded focus:ring-pink-500"
                          />
                          <span className="text-sm font-medium">{list}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Department Visibility */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Visible to Departments
                      <span className="ml-2 text-xs text-gray-400 font-normal">(Default: all departments in channel)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {channelDepts.map(dept => (
                        <label
                          key={dept}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm ${
                            visibleDepartments.includes(dept)
                              ? 'border-purple-500 bg-purple-50 text-purple-800'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={visibleDepartments.includes(dept)}
                            onChange={() =>
                              setVisibleDepartments(prev =>
                                prev.includes(dept)
                                  ? prev.filter(d => d !== dept)
                                  : [...prev, dept]
                              )
                            }
                            className="w-3.5 h-3.5 text-purple-500 rounded focus:ring-purple-500"
                          />
                          <span className="font-medium">{dept}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {channel !== 'Work Order' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Type
                        </label>
                        <select
                          value={remarkType}
                          onChange={(e) => setRemarkType(e.target.value as RemarkType)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                        >
                          <option value="Active">Active</option>
                          <option value="Pending">Pending</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </div>
                    )}
                    <div className={channel === 'Work Order' ? 'col-span-2' : ''}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tags (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={remarkTags}
                        onChange={(e) => setRemarkTags(e.target.value)}
                        placeholder="urgent, follow-up, approved"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={remarkDescription}
                      onChange={(e) => setRemarkDescription(e.target.value)}
                      rows={3}
                      placeholder="Enter remark description..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleAddRemark}
                      disabled={!remarkDescription || selectedLists.length === 0}
                      className="px-4 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      Add Remark
                    </button>
                    <button
                      onClick={() => {
                        setShowAddRemark(false);
                        setRemarkType('Active');
                        setRemarkTags('');
                        setRemarkDescription('');
                        setSelectedLists([selectableRemarkLists[0] ?? card.list]);
                        setVisibleDepartments(channelDepts);
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {channel === 'Work Order' && (
                <div className="space-y-2 mb-4">
                  <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold tracking-wide">
                    QUOTATION HISTORY (Read Only)
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold tracking-wide">
                    WORK ORDER HISTORY
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {(channel === 'Work Order' ? [...quotationHistoryLists, ...workOrderHistoryLists] : lists).map(list => {
                  const allListRemarks = remarksForDisplay.filter(r => r.list === list);

                  // Filter remarks by department visibility for non-admin users
                  const listRemarks = userRole === 'admin'
                    ? allListRemarks
                    : allListRemarks.filter(r =>
                        !r.visibleDepartments ||
                        (userDepartment ? r.visibleDepartments.includes(userDepartment as Department) : false)
                      );

                  return (
                    <div key={list} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                        <h4 className="font-semibold text-gray-700">
                          {list}
                          {isReadOnlyQuotationHistoryList(list) && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                              Read Only
                            </span>
                          )}
                        </h4>
                        <span className="text-sm text-gray-500">
                          {userRole === 'admin' && allListRemarks.length !== listRemarks.length
                            ? `${listRemarks.length} visible / ${allListRemarks.length} total`
                            : `${listRemarks.length} remark${listRemarks.length !== 1 ? 's' : ''}`
                          }
                        </span>
                      </div>

                      {listRemarks.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-sm">
                          No remarks yet
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200">
                          {listRemarks.map(remark => (
                            <div
                              key={remark.id}
                              className={`p-4 ${getRemarkColor(remark.type)}`}
                            >
                              {editingRemarkId === remark.id ? (
                                <div className="space-y-3">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium mb-1">
                                        Type
                                      </label>
                                      <select
                                        value={editRemarkData.type || remark.type}
                                        onChange={(e) =>
                                          setEditRemarkData({
                                            ...editRemarkData,
                                            type: e.target.value as RemarkType,
                                          })
                                        }
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                      >
                                        <option value="Active">Active</option>
                                        <option value="Pending">Pending</option>
                                        <option value="Inactive">Inactive</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium mb-1">
                                        Tags
                                      </label>
                                      <input
                                        type="text"
                                        value={
                                          editRemarkData.tags?.join(', ') ||
                                          remark.tags.join(', ')
                                        }
                                        onChange={(e) =>
                                          setEditRemarkData({
                                            ...editRemarkData,
                                            tags: e.target.value
                                              .split(',')
                                              .map(t => t.trim()),
                                          })
                                        }
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium mb-1">
                                      Description
                                    </label>
                                    <textarea
                                      value={
                                        editRemarkData.description || remark.description
                                      }
                                      onChange={(e) =>
                                        setEditRemarkData({
                                          ...editRemarkData,
                                          description: e.target.value,
                                        })
                                      }
                                      rows={2}
                                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleUpdateRemark(remark.id)}
                                      className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingRemarkId(null);
                                        setEditRemarkData({});
                                      }}
                                      className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={`px-2 py-1 rounded text-xs font-semibold ${getTypeBadgeColor(
                                          remark.type
                                        )}`}
                                      >
                                        {remark.type}
                                      </span>
                                      <span className="text-xs text-gray-600">
                                        by {remark.createdBy}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {new Date(remark.createdAt).toLocaleString()}
                                      </span>
                                      {remark.visibleDepartments && remark.visibleDepartments.length > 0 && (
                                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                          👁 {remark.visibleDepartments.join(', ')}
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex gap-1">
                                      {(userRole === 'admin' ||
                                        (userRole === 'user' &&
                                          remark.createdBy === 'user')) &&
                                        userRole === 'admin' &&
                                        !isReadOnlyQuotationHistoryList(remark.list) && (
                                          <>
                                            <button
                                              onClick={() => {
                                                setEditingRemarkId(remark.id);
                                                setEditRemarkData(remark);
                                              }}
                                              className="p-1 hover:bg-white rounded transition-colors"
                                            >
                                              <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteRemark(remark.id)}
                                              className="p-1 hover:bg-white rounded transition-colors"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </>
                                        )}
                                    </div>
                                  </div>

                                  {remark.tags.length > 0 && (
                                    <div className="flex gap-1 mb-2 flex-wrap">
                                      {remark.tags.map((tag, idx) => (
                                        <span
                                          key={idx}
                                          className="px-2 py-0.5 bg-white bg-opacity-70 rounded-full text-xs"
                                        >
                                          #{tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  <p className="text-sm">{remark.description}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {userRole === 'admin' && (
          <div className="border-t border-gray-200 p-6 bg-gray-50">
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete this card?')) {
                  onDelete(card.id);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Card
            </button>
          </div>
        )}
      </div>

      {showWOForm && (
        <WorkOrderFormModal
          workOrderNumber={card.workOrderNumber || '0000'}
          companyCode={card.companyCode || 'GRP'}
          salesPerson={card.salesPerson}
          quoteNumber={card.quoteNumber}
          existing={card.workOrderDetails}
          canEdit={userRole === 'admin'}
          onSave={(data) => {
            onUpdate({ ...card, workOrderDetails: data, updatedAt: new Date().toISOString() });
            setShowWOForm(false);
          }}
          onClose={() => setShowWOForm(false)}
        />
      )}

      {showOCForm && (
        <OrderConfirmationModal
          workOrder={`${card.companyCode || 'GRP'}/${card.workOrderNumber || '0000'}`}
          existing={card.orderConfirmationDetails}
          canEdit={userRole === 'admin'}
          onSave={(data) => {
            onUpdate({ ...card, orderConfirmationDetails: data, updatedAt: new Date().toISOString() });
            setShowOCForm(false);
          }}
          onClose={() => setShowOCForm(false)}
        />
      )}
    </div>
  );
}
