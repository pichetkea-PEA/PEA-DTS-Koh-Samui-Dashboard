import React from 'react';
import {
  MapPin,
  TrendingUp,
  Box,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Database,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { OrgDatabaseConfig } from '../services/orgDatabaseStorage';

export type PublicDashboardTab = 'heatmap' | 'dailycurve' | 'powertemp3d' | 'yearly' | 'datasetting';

interface PublicSidebarProps {
  activeTab: PublicDashboardTab;
  onTabChange: (tab: PublicDashboardTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  dbConfig: OrgDatabaseConfig;
}

export const PublicSidebar: React.FC<PublicSidebarProps> = ({
  activeTab,
  onTabChange,
  isCollapsed,
  onToggleCollapse,
  dbConfig,
}) => {
  const tabs = [
    {
      id: 'heatmap' as PublicDashboardTab,
      num: '2.1',
      title: 'Daily Max Heat Map',
      subtitle: 'GIS Submarine Corridor & Heat Zones',
      shortTitle: 'Heat Map',
      icon: MapPin,
      accentColor: 'text-rose-400',
      activeBg: 'bg-rose-950/40 text-rose-300 border-rose-500/40',
      activeIndicator: 'bg-rose-400',
    },
    {
      id: 'dailycurve' as PublicDashboardTab,
      num: '2.2',
      title: 'Daily Temperature Curve',
      subtitle: 'Hourly Fiber & Conductor Thermal Trend',
      shortTitle: 'Temp Curve',
      icon: TrendingUp,
      accentColor: 'text-cyan-400',
      activeBg: 'bg-cyan-950/40 text-cyan-300 border-cyan-500/40',
      activeIndicator: 'bg-cyan-400',
    },
    {
      id: 'powertemp3d' as PublicDashboardTab,
      num: '2.3',
      title: '3D Conductor Temp vs Power',
      subtitle: 'Interactive 3D Flow & Heat POV Angle',
      shortTitle: '3D Power/Heat',
      icon: Box,
      accentColor: 'text-amber-400',
      activeBg: 'bg-amber-950/40 text-amber-300 border-amber-500/40',
      activeIndicator: 'bg-amber-400',
    },
    {
      id: 'yearly' as PublicDashboardTab,
      num: '2.4',
      title: 'Yearly Comparison',
      subtitle: 'Peak MW Demand Growth (Samui/Pha Ngan/Tao)',
      shortTitle: 'Yearly Growth',
      icon: CalendarRange,
      accentColor: 'text-emerald-400',
      activeBg: 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40',
      activeIndicator: 'bg-emerald-400',
    },
    {
      id: 'datasetting' as PublicDashboardTab,
      num: 'DATA',
      title: 'Data Setting',
      subtitle: '4-Sector Shared Drive Panels (2.1 - 2.4)',
      shortTitle: 'Data Setting',
      icon: Database,
      accentColor: 'text-violet-400',
      activeBg: 'bg-violet-950/40 text-violet-300 border-violet-500/40',
      activeIndicator: 'bg-violet-400',
    },
  ];

  return (
    <aside
      className={`relative shrink-0 transition-all duration-300 ease-in-out border-r border-cyan-500/20 bg-slate-950/95 backdrop-blur-xl flex flex-col z-20 ${
        isCollapsed ? 'w-18' : 'w-64'
      }`}
    >
      {/* Sidebar Header & Toggle */}
      <div className="p-3 border-b border-cyan-500/20 flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-mono font-black uppercase tracking-widest text-cyan-400/80">
              TELEMETRY FEEDS
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Minimize sidebar (YouTube style)'}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-900 border border-transparent hover:border-cyan-500/30 transition-colors cursor-pointer ${
            isCollapsed ? 'mx-auto' : ''
          }`}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav List */}
      <nav className="flex-1 p-2 space-y-1.5 overflow-y-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              title={`${tab.num} ${tab.title} — ${tab.subtitle}`}
              className={`w-full group relative rounded-xl transition-all cursor-pointer flex ${
                isCollapsed
                  ? 'flex-col items-center justify-center py-3 px-1 text-center'
                  : 'flex-row items-center px-3 py-2.5 text-left gap-3'
              } ${
                isActive
                  ? 'bg-cyan-950/60 text-cyan-200 border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.18)] font-bold'
                  : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-200 border border-transparent hover:border-slate-800'
              }`}
            >
              {/* Active Left Indicator Pill when expanded */}
              {isActive && !isCollapsed && (
                <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-md bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              )}

              {/* Icon Container */}
              <div
                className={`p-2 rounded-lg transition-transform shrink-0 ${
                  isActive
                    ? 'bg-cyan-900/50 shadow-inner text-cyan-300 border border-cyan-400/30'
                    : 'bg-slate-900 text-slate-400 group-hover:bg-slate-800 group-hover:text-cyan-300 border border-slate-800'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-300 drop-shadow-[0_0_6px_rgba(6,182,212,0.6)]' : ''}`} />
              </div>

              {/* Label */}
              {isCollapsed ? (
                <div className="mt-1">
                  <span className="text-[10px] font-semibold block leading-tight text-slate-300 truncate max-w-14">
                    {tab.shortTitle}
                  </span>
                  <span className="text-[9px] font-mono text-cyan-400/70">{tab.num}</span>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs truncate ${isActive ? 'text-cyan-100 font-bold' : 'text-slate-300 font-medium'}`}>
                      {tab.title}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-slate-900 text-cyan-400 border border-cyan-500/20 font-medium">
                      {tab.num}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-0.5 font-normal">
                    {tab.subtitle}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Database Status Chip at Bottom */}
      <div className="p-2 border-t border-cyan-500/20">
        {isCollapsed ? (
          <div
            title={
              dbConfig.hasDatabase
                ? `Database Active: ${dbConfig.databaseFileName || 'Permanent Target'} (${dbConfig.totalDates} dates)`
                : 'No Database Loaded. Contact Admin.'
            }
            className="flex justify-center p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400"
          >
            {dbConfig.hasDatabase ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400" />
            )}
          </div>
        ) : (
          <div
            className={`p-2.5 rounded-xl border text-[11px] leading-tight font-mono ${
              dbConfig.hasDatabase
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
                : 'bg-amber-950/40 border-amber-500/40 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.12)]'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold mb-1">
              {dbConfig.hasDatabase ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="tracking-wide uppercase text-[10px]">DB SYNCHRONIZED</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="tracking-wide uppercase text-[10px]">NO TELEMETRY DB</span>
                </>
              )}
            </div>
            <div className="text-[10px] text-slate-400 font-sans truncate">
              {dbConfig.hasDatabase
                ? `${dbConfig.databaseFileName || 'Permanent Target'} · ${dbConfig.totalDates} Dates`
                : 'Awaiting Admin permanent DB configuration'}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
