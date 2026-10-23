import React, { useState, useEffect, useRef } from 'react';
import { Lock, ShieldAlert, KeyRound, X, Eye, EyeOff, Clock } from 'lucide-react';

const STORAGE_KEY_DATA_SETTING_LOCK = 'dts_public_data_setting_lock_state_v1';
const MAX_CHANCES = 9;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const REQUIRED_PASSWORD = '025905465';

interface LockState {
  failedAttempts: number;
  lockUntil: number | null;
}

export function getDataSettingLockState(): LockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATA_SETTING_LOCK);
    if (raw) {
      const parsed = JSON.parse(raw);
      const failedAttempts = typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0;
      const lockUntil = typeof parsed.lockUntil === 'number' ? parsed.lockUntil : null;
      if (lockUntil && Date.now() >= lockUntil) {
        // Lockout period has expired; reset state
        const resetState: LockState = { failedAttempts: 0, lockUntil: null };
        localStorage.setItem(STORAGE_KEY_DATA_SETTING_LOCK, JSON.stringify(resetState));
        return resetState;
      }
      return { failedAttempts, lockUntil };
    }
  } catch {
    // ignore storage errors
  }
  return { failedAttempts: 0, lockUntil: null };
}

function saveDataSettingLockState(state: LockState): void {
  try {
    localStorage.setItem(STORAGE_KEY_DATA_SETTING_LOCK, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

interface DataSettingPasswordModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

export const DataSettingPasswordModal: React.FC<DataSettingPasswordModalProps> = ({
  isOpen,
  onSuccess,
  onCancel,
}) => {
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>(() => getDataSettingLockState());
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setErrorMsg(null);
      const current = getDataSettingLockState();
      setLockState(current);
      if (current.lockUntil && current.lockUntil > Date.now()) {
        setRemainingMs(current.lockUntil - Date.now());
      } else {
        setRemainingMs(0);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 50);
      }
    }
  }, [isOpen]);

  // Countdown timer when locked for 30 minutes
  useEffect(() => {
    if (!isOpen || !lockState.lockUntil) return;

    const updateTimer = () => {
      const now = Date.now();
      if (lockState.lockUntil && lockState.lockUntil > now) {
        setRemainingMs(lockState.lockUntil - now);
      } else {
        const resetState: LockState = { failedAttempts: 0, lockUntil: null };
        saveDataSettingLockState(resetState);
        setLockState(resetState);
        setRemainingMs(0);
        setErrorMsg(null);
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [isOpen, lockState.lockUntil]);

  if (!isOpen) return null;

  const isLocked = Boolean(lockState.lockUntil && remainingMs > 0);
  const chancesRemaining = Math.max(0, MAX_CHANCES - lockState.failedAttempts);

  const formatCountdown = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const current = getDataSettingLockState();
    if (current.lockUntil && current.lockUntil > Date.now()) {
      setLockState(current);
      setRemainingMs(current.lockUntil - Date.now());
      return;
    }

    if (password.trim() === REQUIRED_PASSWORD) {
      const resetState: LockState = { failedAttempts: 0, lockUntil: null };
      saveDataSettingLockState(resetState);
      setLockState(resetState);
      setPassword('');
      setErrorMsg(null);
      onSuccess();
      return;
    }

    const nextFailed = current.failedAttempts + 1;
    if (nextFailed >= MAX_CHANCES) {
      const lockUntil = Date.now() + LOCKOUT_DURATION_MS;
      const lockedState: LockState = { failedAttempts: nextFailed, lockUntil };
      saveDataSettingLockState(lockedState);
      setLockState(lockedState);
      setRemainingMs(LOCKOUT_DURATION_MS);
      setPassword('');
      setErrorMsg(
        'Incorrect password entered more than 9 chances. Data Setting is now locked for 30 minutes.'
      );
    } else {
      const updatedState: LockState = { failedAttempts: nextFailed, lockUntil: null };
      saveDataSettingLockState(updatedState);
      setLockState(updatedState);
      setPassword('');
      const left = MAX_CHANCES - nextFailed;
      setErrorMsg(
        `Incorrect password. You have ${left} ${left === 1 ? 'chance' : 'chances'} remaining.`
      );
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border-2 border-violet-500/40 rounded-2xl p-6 shadow-[0_0_50px_rgba(139,92,246,0.25)] space-y-5 relative">
        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
              isLocked
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                : 'bg-violet-500/15 border-violet-500/40 text-violet-400'
            }`}
          >
            {isLocked ? <Lock className="w-6 h-6" /> : <KeyRound className="w-6 h-6" />}
          </div>
          <div>
            <span
              className={`text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${
                isLocked
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-violet-500/20 text-violet-300 border-violet-500/40'
              }`}
            >
              {isLocked ? 'SECURITY LOCKOUT ACTIVE' : 'PROTECTED CONFIGURATION'}
            </span>
            <h3 className="text-base font-bold text-white mt-1">
              Data Setting Authentication
            </h3>
          </div>
        </div>

        {isLocked ? (
          <div className="bg-rose-950/50 border border-rose-500/40 rounded-xl p-4 space-y-3 text-center">
            <ShieldAlert className="w-8 h-8 text-rose-400 mx-auto" />
            <div className="text-xs font-mono font-bold text-rose-200">
              Data Setting is locked for 30 minutes due to exceeding 9 incorrect password attempts.
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-950 border border-rose-500/40 text-rose-300 font-mono text-sm font-black">
              <Clock className="w-4 h-4 text-rose-400 animate-pulse" />
              <span>Unlock in: {formatCountdown(remainingMs)}</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <label htmlFor="data-setting-password" className="text-slate-300 font-bold">
                  Enter Password
                </label>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                    chancesRemaining <= 3
                      ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Chances left: {chancesRemaining} / {MAX_CHANCES}
                </span>
              </div>

              <div className="relative">
                <input
                  id="data-setting-password"
                  ref={inputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="off"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-violet-400 rounded-xl px-3.5 py-2.5 pr-10 text-sm font-mono text-white placeholder-slate-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs font-mono flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!password.trim()}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400 text-slate-950 font-mono text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                Unlock Data Setting
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
