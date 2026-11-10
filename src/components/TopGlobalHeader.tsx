import React from 'react';
import { User } from 'firebase/auth';
import {
  Activity,
  HardDrive,
  ExternalLink,
  LogOut,
  Menu,
  Layers,
  RefreshCw,
  Smartphone,
  Monitor,
  Database,
  CheckCircle2,
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
  refreshStatusText?: string;
  viewDeviceMode?: 'desktop' | 'mobile';
  onChangeViewDeviceMode?: (mode: 'desktop' | 'mobile') => void;
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
  refreshStatusText = '',
  viewDeviceMode = 'desktop',
  onChangeViewDeviceMode,
}) => {
  const isMobileView = viewDeviceMode === 'mobile';
  const clampedPct = Math.min(100, Math.max(0, Math.round(refreshProgress)));
  const currentFolderStep =
    clampedPct < 20
      ? '1/5'
      : clampedPct < 42
        ? '2/5'
        : clampedPct < 64
          ? '3/5'
          : clampedPct < 84
            ? '4/5'
            : '5/5';

  return (
    <header className="sticky top-0 z-30 w-full bg-slate-950/90 backdrop-blur-xl border-b border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] px-3 sm:px-5 py-2.5 transition-colors">
      <div
        className={`max-w-[1920px] mx-auto ${
          isMobileView
            ? 'flex flex-col gap-2'
            : 'flex flex-wrap sm:flex-nowrap items-center justify-between gap-3'
        }`}
      >
        <div
          className={`flex items-center justify-between gap-2 ${
            isMobileView ? 'w-full' : 'contents'
          }`}
        >
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
              <div className={isMobileView ? 'block' : 'hidden md:block'}>
                <div className="text-[11px] font-black tracking-wider text-cyan-400 flex items-center gap-1.5 font-mono">
                  <span>PEA-Submarine Cable</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="text-[10px] font-bold text-slate-300 leading-tight tracking-wide">
                  Khanom – Samui Grid
                </div>
              </div>
            </div>
          </div>

          {/* Center Section: Global Header Title (Strictly Top Center on Desktop, Full Row below on Mobile) */}
          {!isMobileView && (
            <div className="text-center px-2 flex-1 min-w-0">
              <h1 className="text-xs sm:text-sm md:text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-cyan-100 to-slate-200 tracking-tight leading-tight truncate">
                Koh Samui DTS &amp; Power Monitoring Dashboard
              </h1>
              <p className="text-[10px] sm:text-[11px] font-medium text-cyan-400/80 leading-tight truncate font-mono">
                115 kV Submarine Cable Transmission Corridor (CK1 – CK4)
              </p>
            </div>
          )}

          {/* Right Section: Mobile/Desktop View Selector, Data Refresh, Auth & New Tab Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
            {/* Mobile View / Desktop View Selector Button (Top Right) */}
            {onChangeViewDeviceMode && (
              <div
                className="inline-flex items-center bg-slate-900/95 p-0.5 rounded-xl border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.15)] font-mono text-[11px]"
                title="Switch display arrangement between Desktop View and Mobile View"
              >
                <button
                  type="button"
                  onClick={() => onChangeViewDeviceMode('desktop')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    viewDeviceMode === 'desktop'
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Desktop View arrangement"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Desktop</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeViewDeviceMode('mobile')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    viewDeviceMode === 'mobile'
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Mobile View arrangement"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Mobile</span>
                </button>
              </div>
            )}

            {/* Enhanced 5-Folder Public Data Refresh Button with 0-100% Progress & Folder Step Badge */}
            {onRefreshPublicData && (
              <button
                id="header-refresh-data-btn"
                type="button"
                onClick={onRefreshPublicData}
                disabled={isRefreshingPublicData}
                title="Scan all 5 Shared Google Drive folders and automatically load any newer version or newly uploaded database file"
                className={`relative overflow-hidden inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 ${
                  isMobileView ? 'min-w-[104px]' : 'min-w-[135px] sm:min-w-[175px]'
                } text-xs font-bold font-mono text-emerald-100 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 active:from-emerald-700 active:to-cyan-700 disabled:opacity-95 rounded-xl shadow-[0_0_18px_rgba(16,185,129,0.35)] border border-emerald-400/50 transition-all cursor-pointer`}
              >
                {/* SVG progress fill tracking 0 - 100% */}
                {isRefreshingPublicData && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={clampedPct}
                      height="100"
                      className="fill-white/25 transition-all duration-200 ease-out"
                    />
                  </svg>
                )}
                <RefreshCw
                  className={`relative z-10 w-3.5 h-3.5 text-emerald-100 shrink-0 ${
                    isRefreshingPublicData ? 'animate-spin' : ''
                  }`}
                />
                {!isMobileView ? (
                  <>
                    <span className="relative z-10 hidden sm:inline">
                      {isRefreshingPublicData
                        ? `SYNCING ${currentFolderStep} · ${clampedPct}%`
                        : 'REFRESH 5 DB FOLDERS'}
                    </span>
                    <span className="relative z-10 sm:hidden">
                      {isRefreshingPublicData ? `${currentFolderStep} ${clampedPct}%` : 'REFRESH DB'}
                    </span>
                  </>
                ) : (
                  <span className="relative z-10 text-[11px]">
                    {isRefreshingPublicData ? `${currentFolderStep} · ${clampedPct}%` : 'REFRESH 5 DB'}
                  </span>
                )}
              </button>
            )}

            {/* Authenticated Admin Controls */}
            {isAuthenticated ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Admin Suite / Public Preview Toggle for Authenticated Admin */}
                {onToggleAdminViewMode && (
                  <button
                    type="button"
                    onClick={onToggleAdminViewMode}
                    className={`${
                      isMobileView ? 'inline-flex px-2 py-1 text-[10px]' : 'hidden sm:inline-flex px-2.5 py-1.5 text-xs'
                    } items-center gap-1.5 rounded-xl font-bold font-mono transition-all cursor-pointer border ${
                      isAdminModeActive
                        ? 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)] hover:bg-cyan-900/50'
                        : 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)] hover:bg-emerald-900/50'
                    }`}
                    title="Switch between Admin Suite (Pages 1-9) and Public View"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{isAdminModeActive ? 'ENGINEERING SUITE' : 'PUBLIC TELEMETRY'}</span>
                  </button>
                )}

                {/* Admin Profile Chip */}
                <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2 py-1 rounded-xl">
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
                  {!isMobileView && (
                    <span className="text-[11px] font-semibold text-slate-200 max-w-[100px] truncate hidden sm:inline-block">
                      {user?.displayName || 'Admin'}
                    </span>
                  )}
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
                title="Sign in with authorized Google Account to access Internal Suite (Pages 1–9)"
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold font-mono text-cyan-100 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 active:from-cyan-700 active:to-blue-700 disabled:opacity-50 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.3)] border border-cyan-400/40 transition-all cursor-pointer"
              >
                <HardDrive className="w-3.5 h-3.5 text-cyan-200" />
                <span>{isLoggingIn ? 'AUTH...' : isMobileView ? 'ADMIN' : 'ADMIN ACCESS'}</span>
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

        {/* Mobile View Title Banner */}
        {isMobileView && (
          <div className="text-center pt-1.5 border-t border-slate-800/80">
            <h1 className="text-xs font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-cyan-100 to-slate-200 tracking-tight leading-tight">
              Koh Samui DTS &amp; Power Monitoring Dashboard
            </h1>
            <p className="text-[10px] font-medium text-cyan-400/80 leading-tight font-mono mt-0.5">
              115 kV Submarine Cable Transmission Corridor (CK1 – CK4)
            </p>
          </div>
        )}
      </div>

      {/* Live 5-Folder Database Update Progress Strip (Appears while refreshing public databases) */}
      {isRefreshingPublicData && (
        <div className="max-w-[1920px] mx-auto mt-2 pt-2 border-t border-emerald-500/30 animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono mb-1.5">
            <div className="flex items-center gap-2 text-emerald-300 font-bold">
              <Database className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
              <span>
                5-SHARED-FOLDER AUTO-VERSION CHECK &amp; SYNC ({currentFolderStep}):
              </span>
              <span className="text-cyan-200 font-semibold truncate max-w-xl">
                {refreshStatusText || 'Scanning 5 shared Google Drive folders for newer file versions...'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold tabular-nums">
                {clampedPct}% COMPLETE
              </span>
            </div>
          </div>

          {/* 5-Folder Segmented Progress Bar */}
          <div className="grid grid-cols-5 gap-1.5">
            {[
              { id: 1, label: 'Folder 1: Peak Temp', threshold: 20 },
              { id: 2, label: 'Folder 2: 4-Ckt Power', threshold: 40 },
              { id: 3, label: 'Folder 3: 24-Hr Profile', threshold: 60 },
              { id: 4, label: 'Folder 4: Op Condition', threshold: 80 },
              { id: 5, label: 'Folder 5: Load Curve', threshold: 100 },
            ].map((step) => {
              const prevThreshold = step.threshold - 20;
              const segPct =
                clampedPct >= step.threshold
                  ? 100
                  : clampedPct <= prevThreshold
                    ? 0
                    : Math.round(((clampedPct - prevThreshold) / 20) * 100);
              return (
                <div key={step.id} className="bg-slate-900/90 border border-slate-800 rounded-lg p-1.5">
                  <div className="flex items-center justify-between text-[9px] font-mono text-slate-300 mb-1">
                    <span className="truncate">{step.label}</span>
                    <span className="text-emerald-400 font-bold flex items-center gap-0.5 shrink-0">
                      {segPct >= 100 && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />}
                      {segPct}%
                    </span>
                  </div>
                  <svg
                    className="h-1 w-full rounded-full overflow-hidden bg-slate-800"
                    viewBox="0 0 100 4"
                    preserveAspectRatio="none"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={segPct}
                      height="4"
                      className="fill-emerald-400 transition-all duration-150"
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
};
