import React from 'react';
import { User } from 'firebase/auth';
import {
  Activity,
  HardDrive,
  ExternalLink,
  LogOut,
  ShieldCheck,
  Menu,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface TopGlobalHeaderProps {
  user: User | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  isAdminModeActive?: boolean;
  onToggleAdminViewMode?: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  onRefreshPublicData?: () => Promise<void> | void;
  isRefreshingPublicData?: boolean;
  refreshProgress?: number;
}

export const TopGlobalHeader: React.FC<TopGlobalHeaderProps> = ({
  user,
  isAuthenticated,
  isLoggingIn,
  onLogin,
  onLogout,
  isAdminModeActive = false,
  onToggleAdminViewMode,
  onToggleSidebar,
  isSidebarCollapsed = false,
  onRefreshPublicData,
  isRefreshingPublicData = false,
  refreshProgress = 0,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full bg-slate-950/90 backdrop-blur-xl border-b border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] px-3 sm:px-5 py-2.5 transition-colors">
      <div className="flex items-center justify-between gap-3 max-w-[1920px] mx-auto">
        {/* Left Section: Sidebar Toggle & Quick Identity Emblem */}
        <div className="flex items-center gap-2.5 shrink-0">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
              className="p-1.5 rounded-xl text-slate-400 hover:text-cyan-300 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/40 transition-all cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center font-black text-xs shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-400/30">
              <Activity className="w-4 h-4 text-cyan-100" />
            </div>
            <div className="hidden md:block">
              <div className="text-[11px] font-black tracking-wider text-cyan-400 flex items-center gap-1.5 font-mono">
                <span>PEA-Submarine Cable</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="text-[11px] font-bold text-slate-300 leading-tight tracking-wide">
                Khanom – Samui Grid
              </div>
            </div>
          </div>
        </div>

        {/* Center Section: Global Header Title (Strictly Top Center) */}
        <div className="text-center px-2 flex-1 min-w-0">
          <h1 className="text-xs sm:text-sm md:text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-cyan-100 to-slate-200 tracking-tight leading-tight truncate">
            Koh Samui DTS &amp; Power Monitoring Dashboard
          </h1>
          <p className="text-[10px] sm:text-[11px] font-medium text-cyan-400/80 leading-tight truncate font-mono">
            115 kV Submarine Cable Transmission Corridor (CK1 – CK4)
          </p>
        </div>

        {/* Right Section: Compact Auth, Data Refresh & New Tab Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Public Data Refresh Button with 0-100% Progress Tracking */}
          {onRefreshPublicData && (
            <button
              id="header-refresh-data-btn"
              type="button"
              onClick={onRefreshPublicData}
              disabled={isRefreshingPublicData}
              title="Automatically read and load latest data from shared Google Drive target folders (Daily Peak Temp, 4-Circuit Power, and Section Daily Profile)"
              className="relative overflow-hidden inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-w-[125px] sm:min-w-[145px] text-xs font-bold font-mono text-emerald-100 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 active:from-emerald-700 active:to-cyan-700 disabled:opacity-90 rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.3)] border border-emerald-400/40 transition-all cursor-pointer"
            >
              {/* Inner progress fill tracking 0 - 100% */}
              {isRefreshingPublicData && (
                <div
                  className="absolute inset-y-0 left-0 bg-white/20 border-r border-emerald-200/50 transition-all duration-300 ease-out pointer-events-none"
                  style={{ width: `${Math.min(100, Math.max(0, refreshProgress))}%` }}
                />
              )}
              <RefreshCw
                className={`relative z-10 w-3.5 h-3.5 text-emerald-200 shrink-0 ${
                  isRefreshingPublicData ? 'animate-spin' : ''
                }`}
              />
              <span className="relative z-10 hidden sm:inline">
                {isRefreshingPublicData ? `REFRESHING ${Math.round(refreshProgress)}%` : 'REFRESH DATA'}
              </span>
              <span className="relative z-10 sm:hidden">
                {isRefreshingPublicData ? `${Math.round(refreshProgress)}%` : 'REFRESH'}
              </span>
            </button>
          )}

          {/* Authenticated Admin Controls */}
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              {/* Admin Suite / Public Preview Toggle for Authenticated Admin */}
              {onToggleAdminViewMode && (
                <button
                  type="button"
                  onClick={onToggleAdminViewMode}
                  className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer border ${
                    isAdminModeActive
                      ? 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)] hover:bg-cyan-900/50'
                      : 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)] hover:bg-emerald-900/50'
                  }`}
                  title="Switch between Admin Suite (Pages 1-7) and Public View (Pages 2.1-2.4)"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{isAdminModeActive ? 'ENGINEERING SUITE' : 'PUBLIC TELEMETRY'}</span>
                </button>
              )}

              {/* Admin Profile Chip */}
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-xl">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Admin'}
                    className="w-5 h-5 rounded-full ring-1 ring-cyan-500/50 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                    {(user?.displayName || user?.email || 'A')[0].toUpperCase()}
                  </div>
                )}
                <span className="text-[11px] font-semibold text-slate-200 max-w-[100px] truncate hidden sm:inline-block">
                  {user?.displayName || 'Admin'}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-500/30 uppercase">
                  OPS ADMIN
                </span>
              </div>

              {/* Logout Button */}
              <button
                type="button"
                onClick={onLogout}
                title="Sign out from Admin Session"
                className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Reduced Size Compact Login Button with Neon Cyan/Blue Gradient */
            <button
              id="header-login-btn"
              type="button"
              onClick={onLogin}
              disabled={isLoggingIn}
              title="Sign in with authorized Google Account to access Internal Suite (Pages 1–7)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold font-mono text-cyan-100 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 active:from-cyan-700 active:to-blue-700 disabled:opacity-50 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.3)] border border-cyan-400/40 transition-all cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5 text-cyan-200" />
              <span>{isLoggingIn ? 'AUTHENTICATING...' : 'ADMIN ACCESS'}</span>
            </button>
          )}

          {/* Reduced Size Open in New Tab Button */}
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            title="Open application in a fresh new browser tab"
            className="p-1.5 rounded-xl text-slate-400 hover:text-cyan-300 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/40 transition-all cursor-pointer flex items-center justify-center shadow-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
};
