import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Lock, ChevronDown, Building2 } from 'lucide-react';
import { getAppData, ApiUser } from '@/lib/api';
import { AppUser, Department, DEPARTMENTS } from '@/types';

export default function Login() {
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  /** Parallel list kept in sync with `users`; stores the full API response for lookup at login. */
  const [apiUsers, setApiUsers] = useState<ApiUser[]>([]);
  const [adminPin, setAdminPin] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<Department | ''>('');
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [pinInput, setPinInput] = useState<string[]>(['', '', '', '']);
  const [pinError, setPinError] = useState('');
  const [showAdminPinScreen, setShowAdminPinScreen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAppData()
      .then(data => {
        setAdminPin(data.adminPin);
        setApiUsers(data.users);
        // Map backend ApiUser → frontend AppUser
        const mapped: AppUser[] = data.users.map(u => ({
          name:       u.username,
          pin:        u.pin,
          department: (u.depName as Department) ?? undefined,
        }));
        setUsers(mapped);
      })
      .catch(err => console.error('Failed to load app data:', err))
      .finally(() => setLoading(false));
  }, []);

  const filteredUsers = selectedDepartment
    ? users.filter(u => u.department === selectedDepartment)
    : users;

  const handleAdminClick = () => {
    setIsAdmin(true);
    setShowAdminPinScreen(true);
    setPinInput(['', '', '', '']);
    setPinError('');
  };

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) return; // Only allow single digit
    if (value && !/^\d$/.test(value)) return; // Only allow numbers

    const newPin = [...pinInput];
    newPin[index] = value;
    setPinInput(newPin);

    // Auto-focus next input
    if (value && index < 3) {
      const nextInput = document.getElementById(`pin-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinInput[index] && index > 0) {
      const prevInput = document.getElementById(`pin-${index - 1}`);
      prevInput?.focus();
    }
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  const handleLogin = () => {
    const enteredPin = pinInput.join('');
    
    if (!selectedUser && !isAdmin) {
      setPinError('Please select a user');
      return;
    }

    if (enteredPin.length !== 4) {
      setPinError('Please enter complete 4-digit PIN');
      return;
    }

    if (isAdmin) {
      if (enteredPin === adminPin) {
        localStorage.setItem('userRole', 'admin');
        localStorage.setItem('userName', 'Admin');
        localStorage.setItem('userDepartment', '');
        localStorage.removeItem('userId');
        router.push('/kanban');
      } else {
        setPinError('Invalid Admin PIN');
        setPinInput(['', '', '', '']);
        document.getElementById('pin-0')?.focus();
      }
    } else {
      const user = users.find(u => u.name === selectedUser);
      const apiUser = apiUsers.find(u => u.username === selectedUser);
      if (user && apiUser && enteredPin === user.pin) {
        localStorage.setItem('userRole', 'user');
        localStorage.setItem('userName', user.name);
        localStorage.setItem('userDepartment', user.department || '');
        localStorage.setItem('userId', String(apiUser.userId));
        router.push('/kanban');
      } else {
        setPinError('Invalid PIN');
        setPinInput(['', '', '', '']);
        document.getElementById('pin-0')?.focus();
      }
    }
  };

  const handleBack = () => {
    setShowAdminPinScreen(false);
    setIsAdmin(false);
    setPinInput(['', '', '', '']);
    setPinError('');
  };

  // Admin PIN Screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    );
  }

  if (showAdminPinScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-4">
              <Lock className="w-8 h-8 text-gray-600" />
            </div>
            <h1 className="text-xl font-semibold text-gray-800 mb-1">Secure Login</h1>
            <p className="text-sm text-gray-500">Enter Admin 4-digit PIN</p>
          </div>

          {/* PIN Input Dots */}
          <div className="flex justify-center gap-3 mb-6">
            {pinInput.map((digit, index) => (
              <input
                key={index}
                id={`pin-${index}`}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                autoFocus={index === 0}
                className="w-16 h-16 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl focus:border-pink-500 focus:outline-none transition-colors"
                style={{ 
                  WebkitTextSecurity: 'disc',
                  textSecurity: 'disc'
                } as React.CSSProperties}
              />
            ))}
          </div>

          {/* User Info */}
          {selectedUser && (
            <div className="mb-4 p-3 bg-pink-50 rounded-xl text-center">
              <p className="text-sm text-gray-600">Logging in as</p>
              <p className="font-semibold text-gray-800">{selectedUser}</p>
            </div>
          )}

          {/* Error Message */}
          {pinError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-600 text-center">{pinError}</p>
            </div>
          )}

          {/* Login Button */}
          <div className="flex justify-center">
            <button
              onClick={handleLogin}
              className="px-16 bg-gradient-to-r from-pink-500 to-pink-600 text-white py-2.5 rounded-xl font-semibold hover:shadow-lg transition-all duration-200"
            >
              Login
            </button>
          </div>

          {/* Back Button */}
          <button
            onClick={handleBack}
            className="w-full mt-3 text-gray-500 hover:text-gray-700 text-sm py-2 transition-colors"
          >
            ← Back to user selection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50 p-4">
      <div className="relative bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-4">
            <Lock className="w-8 h-8 text-gray-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-1">Secure Login</h1>
          <p className="text-sm text-gray-500">Select a user and enter your 4-digit PIN</p>
        </div>

        {/* Department Dropdown */}
        <div className="mb-4">
          <div className="relative">
            <select
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value as Department | '');
                setSelectedUser('');
                setPinError('');
              }}
              className="w-full px-4 py-3 text-sm bg-gray-50 border-2 border-gray-200 rounded-xl appearance-none cursor-pointer focus:outline-none focus:border-pink-400 transition-colors text-gray-700"
            >
              <option value="">All Departments</option>
              {DEPARTMENTS.map((dep) => (
                <option key={dep} value={dep}>{dep}</option>
              ))}
            </select>
            <Building2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* User Dropdown */}
        <div className="mb-6">
          <div className="relative">
            <select
              value={selectedUser}
              onChange={(e) => {
                setSelectedUser(e.target.value);
                setPinError('');
              }}
              className="w-full px-4 py-3 text-sm bg-gray-50 border-2 border-gray-200 rounded-xl appearance-none cursor-pointer focus:outline-none focus:border-pink-400 transition-colors text-gray-700"
            >
              <option value="">Select User</option>
              {filteredUsers.map((user, index) => (
                <option key={index} value={user.name}>
                  {user.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* PIN Input */}
        <div className="flex justify-center gap-3 mb-6">
          {pinInput.map((digit, index) => (
            <div
              key={index}
              className={`w-16 h-16 flex items-center justify-center rounded-xl border-2 transition-all ${
                digit
                  ? 'bg-gray-800 border-gray-800'
                  : index === pinInput.findIndex(p => p === '')
                  ? 'bg-pink-50 border-pink-300'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <input
                id={`pin-${index}`}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                autoFocus={index === 0}
                className="w-full h-full bg-transparent text-center text-2xl font-bold focus:outline-none caret-transparent"
                style={{ 
                  WebkitTextSecurity: 'disc',
                  textSecurity: 'disc',
                  color: digit ? 'white' : 'transparent'
                } as React.CSSProperties}
              />
            </div>
          ))}
        </div>

        {/* Error Message */}
        {pinError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-600 text-center">{pinError}</p>
          </div>
        )}

        {/* Login Button */}
        <div className="flex justify-center">
          <button
            onClick={handleLogin}
            className="px-16 bg-gradient-to-r from-pink-500 to-pink-600 text-white py-2.5 rounded-xl font-semibold hover:shadow-lg transition-all duration-200"
          >
            Login
          </button>
        </div>

        {/* Divider */}
        <div className="my-6 border-t border-gray-200"></div>

        {/* Admin access text */}
        <div className="text-center">
          <p className="text-xs text-gray-400">
            Admin access requires authorized PIN
          </p>
        </div>

        {/* Admin Link - Centered below text */}
        <div className="text-center mt-2">
          <button
            onClick={handleAdminClick}
            className="text-gray-400 hover:text-pink-600 transition-colors text-sm font-medium"
          >
            Admin
          </button>
        </div>
      </div>
    </div>
  );
}
