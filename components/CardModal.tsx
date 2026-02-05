import { useState } from 'react';
import { X, Edit2, Save, Trash2, Plus, Check } from 'lucide-react';
import { Card, ListType, Remark, RemarkType } from '@/types';

interface Props {
  card: Card;
  onClose: () => void;
  onUpdate: (card: Card) => void;
  onDelete: (cardId: string) => void;
  userRole: 'admin' | 'user';
  userName: string;
}

const lists: ListType[] = ['Quotation', 'Submittal', 'Review', 'LPO'];

export default function CardModal({ card, onClose, onUpdate, onDelete, userRole, userName }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCard, setEditedCard] = useState(card);
  const [showAddRemark, setShowAddRemark] = useState(false);
  const [selectedLists, setSelectedLists] = useState<ListType[]>([card.list]);
  const [remarkType, setRemarkType] = useState<RemarkType>('Active');
  const [remarkTags, setRemarkTags] = useState('');
  const [remarkDescription, setRemarkDescription] = useState('');
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(null);
  const [editRemarkData, setEditRemarkData] = useState<Partial<Remark>>({});

  const handleSave = () => {
    onUpdate({ ...editedCard, updatedAt: new Date().toISOString() });
    setIsEditing(false);
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
    }));

    const updatedCard = {
      ...card,
      remarks: [...card.remarks, ...newRemarks],
      updatedAt: new Date().toISOString(),
    };

    onUpdate(updatedCard);
    setShowAddRemark(false);
    setSelectedLists([card.list]);
    setRemarkType('Active');
    setRemarkTags('');
    setRemarkDescription('');
  };

  const handleUpdateRemark = (remarkId: string) => {
    const updatedRemarks = card.remarks.map(remark =>
      remark.id === remarkId
        ? { ...remark, ...editRemarkData, updatedAt: new Date().toISOString() }
        : remark
    );

    onUpdate({
      ...card,
      remarks: updatedRemarks,
      updatedAt: new Date().toISOString(),
    });

    setEditingRemarkId(null);
    setEditRemarkData({});
  };

  const handleDeleteRemark = (remarkId: string) => {
    if (confirm('Are you sure you want to delete this remark?')) {
      const updatedRemarks = card.remarks.filter(remark => remark.id !== remarkId);
      onUpdate({
        ...card,
        remarks: updatedRemarks,
        updatedAt: new Date().toISOString(),
      });
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
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div className="bg-gray-50 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Quote Information</h3>
                {userRole === 'admin' && !isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                )}
                {isEditing && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditedCard(card);
                      }}
                      className="px-3 py-1.5 text-sm bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quote No
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedCard.quoteNumber}
                      onChange={(e) =>
                        setEditedCard({ ...editedCard, quoteNumber: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-gray-900 font-semibold">{card.quoteNumber}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  {isEditing ? (
                    <input
                      type="date"
                      value={editedCard.date}
                      onChange={(e) => setEditedCard({ ...editedCard, date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-gray-900">{card.date}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sales Person
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedCard.salesPerson}
                      onChange={(e) =>
                        setEditedCard({ ...editedCard, salesPerson: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-gray-900">{card.salesPerson}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">List</label>
                  {isEditing ? (
                    <select
                      value={editedCard.list}
                      onChange={(e) =>
                        setEditedCard({ ...editedCard, list: e.target.value as ListType })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    >
                      {lists.map(list => (
                        <option key={list} value={list}>
                          {list}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-gray-900">{card.list}</p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  {isEditing ? (
                    <textarea
                      value={editedCard.subject}
                      onChange={(e) => setEditedCard({ ...editedCard, subject: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-gray-900">{card.subject}</p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Project Location
                  </label>
                  {isEditing ? (
                    <textarea
                      value={editedCard.projectLocation}
                      onChange={(e) =>
                        setEditedCard({ ...editedCard, projectLocation: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  ) : (
                    <p className="text-gray-900">{card.projectLocation}</p>
                  )}
                </div>
              </div>
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
                      {lists.map(list => (
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

                  <div className="grid grid-cols-2 gap-4 mb-4">
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

                    <div>
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
                        setSelectedLists([card.list]);
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {lists.map(list => {
                  const listRemarks = card.remarks.filter(r => r.list === list);

                  return (
                    <div key={list} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                        <h4 className="font-semibold text-gray-700">{list}</h4>
                        <span className="text-sm text-gray-500">
                          {listRemarks.length} remark{listRemarks.length !== 1 ? 's' : ''}
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
                                    <div className="flex items-center gap-2">
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
                                    </div>

                                    <div className="flex gap-1">
                                      {(userRole === 'admin' ||
                                        (userRole === 'user' &&
                                          remark.createdBy === 'user')) &&
                                        userRole === 'admin' && (
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
    </div>
  );
}
