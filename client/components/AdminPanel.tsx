import { useState, useEffect } from 'react';
import { UserPlus, X, Users, Settings, Edit2, Key, Building2, Trash2 } from 'lucide-react';
import {
  getAppData,
  createUser as apiCreateUser,
  updateUser as apiUpdateUser,
  softDeleteUser as apiSoftDelete,
  restoreUser as apiRestore,
  permanentlyDeleteUser as apiPermDelete,
  ApiUser,
  ApiDepartment,
} from '@/lib/api';
import { AppUser, Department, DEPARTMENTS } from '@/types';

interface AdminPanelProps {
  onClose: () => void;
}

/** Convert an ApiUser to the legacy AppUser shape used by the render layer. */
function toAppUser(u: ApiUser): AppUser {
  return { name: u.username, pin: u.pin, department: (u.depName as Department) ?? undefined, deletedAt: u.deletedAt ?? undefined };
}

export default function AdminPanel({ onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [deletedUsers, setDeletedUsers] = useState<AppUser[]>([]);
  /** Map from username → userId (int) for API calls. */
  const [userIdMap, setUserIdMap] = useState<Record<string, number>>({});
  /** Available departments from API. */
  const [departments, setDepartments] = useState<ApiDepartment[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserDepartment, setNewUserDepartment] = useState<Department | ''>('');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPin, setEditPin] = useState('');
  const [editDepartment, setEditDepartment] = useState<Department | ''>('');
  const [saving, setSaving] = useState(false);

  const generateRandomPin = () => Math.floor(1000 + Math.random() * 9000).toString();

  useEffect(() => {
    getAppData().then(data => {
      setDepartments(data.departments);
      const idMap: Record<string, number> = {};
      data.users.forEach(u => { idMap[u.username] = u.userId; });
      data.deletedUsers.forEach(u => { idMap[u.username] = u.userId; });
      setUserIdMap(idMap);
      setUsers(data.users.map(toAppUser));
      setDeletedUsers(data.deletedUsers.map(toAppUser));
    }).catch(console.error);
  }, []);

  const depIdForName = (depName: string): number | undefined => {
    const dep = departments.find(d => d.depName === depName);
    return dep?.depId;
  };

  const handleAddUser = async () => {
    if (!newUserName.trim() || users.find(u => u.name === newUserName.trim())) return;
    const pin = newUserPin || generateRandomPin();
    const dep_id = newUserDepartment ? depIdForName(newUserDepartment) : undefined;
    setSaving(true);
    try {
      const created = await apiCreateUser(newUserName.trim(), pin, dep_id);
      setUserIdMap(prev => ({ ...prev, [created.username]: created.userId }));
      setUsers(prev => [...prev, toAppUser(created)]);
      setNewUserName('');
      setNewUserPin('');
      setNewUserDepartment('');
      setIsAddingUser(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handleRemoveUser = async (userName: string) => {
    const uid = userIdMap[userName];
    if (!uid) return;
    setSaving(true);
    try {
      await apiSoftDelete(uid);
      const removed = users.find(u => u.name === userName);
      setUsers(prev => prev.filter(u => u.name !== userName));
      if (removed) setDeletedUsers(prev => [...prev, { ...removed, deletedAt: new Date().toISOString() }]);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handleRestoreUser = async (userName: string) => {
    const uid = userIdMap[userName];
    if (!uid) return;
    setSaving(true);
    try {
      const restored = await apiRestore(uid);
      setDeletedUsers(prev => prev.filter(u => u.name !== userName));
      setUsers(prev => [...prev, toAppUser(restored)]);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handlePermanentlyDeleteUser = async (userName: string) => {
    if (!confirm(`Permanently delete ${userName}? This cannot be undone.`)) return;
    const uid = userIdMap[userName];
    if (!uid) return;
    setSaving(true);
    try {
      await apiPermDelete(uid);
      setDeletedUsers(prev => prev.filter(u => u.name !== userName));
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handleEditPin = (userName: string) => {
    setEditingUser(userName);
    const user = users.find(u => u.name === userName);
    setEditPin(user?.pin || '');
    setEditDepartment(user?.department || '');
  };

  const handleSavePin = async (userName: string) => {
    if (editPin && /^\d{4}$/.test(editPin)) {
      const uid = userIdMap[userName];
      if (!uid) return;
      const dep_id = editDepartment ? depIdForName(editDepartment) : undefined;
      setSaving(true);
      try {
        const updated = await apiUpdateUser(uid, { pin: editPin, dep_id });
        setUsers(prev => prev.map(u => u.name === userName ? toAppUser(updated) : u));
        setEditingUser(null);
        setEditPin('');
        setEditDepartment('');
      } catch (err) { console.error(err); }
      finally { setSaving(false); }
    }
  };

  const handleCancelEdit = () => {
    setEditingUser(null);
    setEditPin('');
    setEditDepartment('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="bg-gradient-to-r from-pink-600 to-purple-600 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6" />
            <h2 className="text-2xl font-bold">Admin Panel</h2>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-700" />
                <h3 className="text-lg font-semibold text-gray-800">Manage Users</h3>
              </div>
              <button
                onClick={() => setIsAddingUser(!isAddingUser)}
                className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                Add User
              </button>
            </div>

            {isAddingUser && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Enter user name"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    autoFocus
                  />
                  <div className="relative">
                    <select
                      value={newUserDepartment}
                      onChange={(e) => setNewUserDepartment(e.target.value as Department | '')}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 appearance-none bg-white"
                    >
                      <option value="">Select Department</option>
                      {DEPARTMENTS.map(dep => (
                        <option key={dep} value={dep}>{dep}</option>
                      ))}
                    </select>
                    <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newUserPin}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d{0,4}$/.test(val)) {
                          setNewUserPin(val);
                        }
                      }}
                      placeholder="4-digit PIN (auto-generated if empty)"
                      maxLength={4}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                    <button
                      onClick={() => setNewUserPin(generateRandomPin())}
                      className="px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                      title="Generate random PIN"
                    >
                      <Key className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddUser}
                      className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setIsAddingUser(false);
                        setNewUserName('');
                        setNewUserPin('');
                        setNewUserDepartment('');
                      }}
                      className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {users.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No users added yet. Click "Add User" to get started.
                </div>
              ) : (
                users.map((user, index) => (
                  <div
                    key={index}
                    className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center">
                          <Users className="w-5 h-5 text-pink-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{user.name}</span>
                            {user.department && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                <Building2 className="w-3 h-3" />
                                {user.department}
                              </span>
                            )}
                          </div>
                          {editingUser === user.name ? (
                            <div className="space-y-2 mt-2">
                              <div className="relative">
                                <select
                                  value={editDepartment}
                                  onChange={(e) => setEditDepartment(e.target.value as Department | '')}
                                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-pink-500 appearance-none bg-white"
                                >
                                  <option value="">No Department</option>
                                  {DEPARTMENTS.map(dep => (
                                    <option key={dep} value={dep}>{dep}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editPin}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '' || /^\d{0,4}$/.test(val)) {
                                      setEditPin(val);
                                    }
                                  }}
                                  placeholder="Enter 4-digit PIN"
                                  maxLength={4}
                                  className="px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-pink-500"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSavePin(user.name)}
                                  className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="px-3 py-1 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-500">PIN: {user.pin}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {editingUser !== user.name && (
                          <button
                            onClick={() => handleEditPin(user.name)}
                            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg p-2 transition-colors"
                            title="Edit PIN"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveUser(user.name)}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg p-2 transition-colors"
                          title="Remove user"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Deleted Users Section */}
          {deletedUsers.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <Trash2 className="w-4 h-4 text-red-500" />
                <h3 className="text-base font-semibold text-gray-700">Deleted Users</h3>
                <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded-full">{deletedUsers.length}</span>
              </div>
              <div className="space-y-2">
                {deletedUsers.map((user, index) => (
                  <div key={index} className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between opacity-70">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-red-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-600 line-through text-sm">{user.name}</span>
                          {user.department && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded-full">
                              <Building2 className="w-3 h-3" />
                              {user.department}
                            </span>
                          )}
                        </div>
                        {user.deletedAt && (
                          <span className="text-xs text-gray-400">
                            Deleted {new Date(user.deletedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRestoreUser(user.name)}
                        className="px-3 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                        title="Restore user"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => handlePermanentlyDeleteUser(user.name)}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-lg transition-colors"
                        title="Permanently delete"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 mb-2">Information</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Users added here will appear in the Welcome Back page</li>
              <li>• Only admins can manage users</li>
              <li>• Deleted users can be restored from the Deleted Users section</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
