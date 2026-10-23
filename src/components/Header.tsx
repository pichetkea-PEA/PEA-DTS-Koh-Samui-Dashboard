import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  Activity,
  Sparkles,
  LogOut,
  HardDrive,
  Zap,
  MapPin,
  FolderCog,
  ExternalLink,
  Menu,
  ChevronLeft,
  Calendar,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ShieldAlert,
  Layers,
} from 'lucide-react';

export type AppPageTab =
  | 'management'
  | 'heatmap'
  | 'profile'
  | 'power'
  | 'analyzing'
  | 'risk'
  | 'yearly';

interface HeaderProps {
  user: User | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  activeTab: AppPageTab;
  onTabChange: (tab: AppPageTab) => void;
  referenceDateKey?: string;
  hasPowerForDate?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  needsAuth,
  isLoggingIn,
  onLogin,
  onLogout,
  activeTab,
  onTabChange,
  referenceDateKey,
  hasPowerForDate,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAuthenticated = !!user && !needsAuth;

  // Only show the left side panel after the login process is completed
  if (!isAuthenticated) {
    return null;
  }

  const navItems: Array<{
    id: AppPageTab;
    num: string;
    label: string;
    shortLabel: string;
    subtitle: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    {
      id: 'management',
      num: '1',
      label: 'Folder & Asset',
      shortLabel: 'Folder',
      subtitle: '.TEPR & 4-Circuit Folders',
      icon: FolderCog,
    },
    {
      id: 'heatmap',
      num: '2',
      label: 'Satellite Heat Map',
      shortLabel: 'Heat Map',
      subtitle: '53.5 km GPS Route & T4',
      icon: MapPin,
    },
    {
      id: 'profile',
      num: '3',
      label: 'Profile & Matrix',
      shortLabel: 'Profile',
      subtitle: '19-Section Matrix & AI',
      icon: Activity,
    },
    {
      id: 'power',
      num: '4',
      label: 'Power (4 Circuits)',
      shortLabel: '4 Circuits',
      subtitle: 'KMB, KMA & KNA SCADA',
      icon: Zap,
    },
    {
      id: 'analyzing',
      num: '5',
      label: 'Analyzing Page',
      shortLabel: 'Analyzing',
      subtitle: 'Section Trends & Prediction',
      icon: TrendingUp,
    },
    {
      id: 'risk',
      num: '6',
      label: 'Risk Management',
      shortLabel: 'Risk Mgmt',
      subtitle: 'Thermal Risk & IEC Standards',
      icon: ShieldAlert,
    },
    {
      id: 'yearly',
      num: '7',
      label: 'Yearly comparison',
      shortLabel: 'Yearly',
      subtitle: 'Multi-Year Visual Charts',
      icon: Layers,
    },
  ];

  const getTabAgent = () => {
    switch (activeTab) {
      case 'management':
        return 'DTS & Folder Setup';
      case 'heatmap':
        return 'GIS Thermal Agent';
      case 'profile':
        return 'DTS Analyst';
      case 'power':
        return 'SCADA 4-Ckt Agent';
      case 'analyzing':
        return 'Predictive Trend Agent';
      case 'risk':
        return 'IEC Risk Consultant';
      case 'yearly':
        return 'Multi-Year Comparator';
    }
  };

  return (
    <>
      {/* Mobile Floating Menu Button (only on small screens when drawer is closed) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2.5 rounded-xl bg-slate-900/90 text-white shadow-lg border border-slate-700 flex items-center gap-2 cursor-pointer"
        title="Open Navigation Panel"
      >
        <Menu className="w-4 h-4" />
        <span className="text-xs font-bold">Menu</span>
      </button>

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* YouTube-Style Left Side Panel */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 lg:z-30 h-screen bg-white border-r border-slate-200/90 flex flex-col justify-between transition-all duration-200 shrink-0 select-none shadow-sm ${
          isCollapsed ? 'lg:w-[76px] w-64' : 'w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Top Section: YouTube-Style Hamburger + Brand Logo */}
        <div className="flex flex-col flex-1 min-h-0">
          <div
            className={`h-16 px-3.5 border-b border-slate-100 flex items-center ${
              isCollapsed ? ' lg:justify-center justify-between' : 'justify-between'
            } gap-2 shrink-0`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    setMobileOpen(false);
                  } else {
                    setIsCollapsed(!isCollapsed);
                  }
                }}
                className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
                title={isCollapsed ? 'Expand side panel' : 'Collapse side panel (YouTube style)'}
              >
                <Menu className="w-5 h-5" />
              </button>

              {(!isCollapsed || mobileOpen) && (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs shrink-0">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-slate-900 tracking-tight truncate">
                      115kV Cable Ckt #3
                    </div>
                    <div className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1 truncate">
                      <Sparkles className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                      <span className="truncate">{getTabAgent()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {mobileOpen && (
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Navigation Links (YouTube Style Vertical Menu) */}
          <div className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1.5 custom-scrollbar">
            {isAuthenticated ? (
              <>
                {!isCollapsed && (
                  <div className="px-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Pages & Workspace
                  </div>
                )}

                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onTabChange(item.id);
                        setMobileOpen(false);
                      }}
                      title={`${item.num}. ${item.label} — ${item.subtitle}`}
                      className={`w-full rounded-xl transition-all cursor-pointer flex ${
                        isCollapsed
                          ? 'lg:flex-col lg:items-center lg:justify-center lg:py-2.5 lg:px-1 flex-row items-center px-3 py-2.5 gap-3'
                          : 'items-center px-3 py-2.5 gap-3 text-left'
                      } ${
                        isActive
                          ? 'bg-blue-50/90 text-blue-700 font-bold border border-blue-200/80 shadow-2xs'
                          : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 border border-transparent'
                      }`}
                    >
                      <div
                        className={`p-2 rounded-lg shrink-0 ${
                          isActive
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>

                      {isCollapsed ? (
                        <span className="text-[10px] font-bold tracking-tight truncate max-w-full">
                          {item.num}. {item.shortLabel}
                        </span>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold truncate flex items-center gap-1.5">
                            <span className="font-mono text-[11px] opacity-75">{item.num}.</span>
                            <span className="truncate">{item.label}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-normal truncate">
                            {item.subtitle}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Expanded Sidebar: Date Reference & 4-Circuit Mapping Quick Guide */}
                {!isCollapsed && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5 px-1">
                    {/* Active Date Reference Box (Isolated on Page 7) */}
                    {activeTab === 'yearly' ? (
                      <div className="p-2.5 rounded-xl bg-indigo-50/90 border border-indigo-200/80 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3 text-indigo-600" />
                            <span>Page 7 Isolated Mode</span>
                          </span>
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <div className="font-mono text-xs font-bold text-slate-900">
                          1-Year Calendar Frame
                        </div>
                        <div className="text-[10px] text-slate-600 leading-tight">
                          Isolated Filter • Plots Uploaded CSV/XLSX or URL Data Only
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-blue-600" />
                            <span>Date Reference</span>
                          </span>
                          {hasPowerForDate ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                          )}
                        </div>
                        <div className="font-mono text-xs font-bold text-slate-900">
                          {referenceDateKey && referenceDateKey !== 'all'
                            ? referenceDateKey
                            : 'All Loaded Dates'}
                        </div>
                        <div className="text-[10px] text-slate-500 leading-tight">
                          {hasPowerForDate
                            ? 'Linked: .TEPR Fiber Temp ↔ 4-Circuit Power CSVs'
                            : 'Select date in Page 1 to link .TEPR & Power'}
                        </div>
                      </div>
                    )}

                    {/* 4-Circuit Folder & Column Specification Summary */}
                    <div className="p-2.5 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-1.5 text-[10px]">
                      <div className="font-extrabold uppercase tracking-wider text-indigo-800 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-indigo-600" />
                        <span>4-Circuit CSV Mapping</span>
                      </div>
                      <div className="space-y-1 text-slate-600 font-mono text-[9.5px]">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-violet-800">1. 115kV #3:</span>
                          <span>KMB · Col G (03YB01) -→+</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-blue-800">2. 115kV #2:</span>
                          <span>KMA · Col I (04YB01) -→+</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-emerald-800">3. 33kV NKT:</span>
                          <span>KNA · Col N (07WB01) (+)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-amber-800">4. 33kV Oil:</span>
                          <span>KNA · Col P (10WB01) (+)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              !isCollapsed && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 space-y-2">
                  <div className="font-bold text-slate-900">Welcome to DTS & SCADA</div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Connect your Google Drive or load the Demo Dataset to inspect Page 1–4.
                  </p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Bottom Section: User Account, Connect Drive & Open in New Tab */}
        <div className="p-2.5 border-t border-slate-200/80 bg-slate-50/60 space-y-2 shrink-0">
          {/* Open in New Tab */}
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            title="Open web application in a new browser tab"
            className={`w-full flex items-center ${
              isCollapsed ? 'lg:justify-center px-2 py-2' : 'justify-center gap-2 px-3 py-2'
            } text-xs font-semibold text-slate-700 hover:text-blue-700 bg-white hover:bg-blue-50 border border-slate-200/90 hover:border-blue-200 rounded-xl transition-all shadow-2xs cursor-pointer`}
          >
            <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            {!isCollapsed && <span>Open in New Tab</span>}
          </a>

          {/* User Profile or Connect Button */}
          {user ? (
            <div
              className={`flex items-center ${
                isCollapsed ? 'lg:flex-col lg:gap-1.5 justify-between' : 'justify-between gap-2'
              } bg-white border border-slate-200/80 p-2 rounded-xl`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    className="w-7 h-7 rounded-full ring-1 ring-slate-200 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                {!isCollapsed && (
                  <div className="min-w-0 text-left">
                    <div className="text-xs font-semibold text-slate-800 truncate">
                      {user.displayName || 'Connected User'}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
                  </div>
                )}
              </div>

              <button
                id="header-logout-btn"
                type="button"
                onClick={onLogout}
                title="Disconnect Google Account"
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              id="header-login-btn"
              type="button"
              onClick={onLogin}
              disabled={isLoggingIn}
              title="Connect Google Drive"
              className={`w-full flex items-center ${
                isCollapsed ? 'lg:justify-center px-2 py-2.5' : 'justify-center gap-2 px-3 py-2.5'
              } text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 rounded-xl shadow-sm shadow-blue-600/20 transition-all cursor-pointer`}
            >
              <HardDrive className="w-4 h-4 shrink-0" />
              {!isCollapsed && (
                <span>{isLoggingIn ? 'Connecting...' : 'Connect Google Drive'}</span>
              )}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
