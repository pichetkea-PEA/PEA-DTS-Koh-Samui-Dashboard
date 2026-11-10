import React, { useState, useEffect, useRef } from 'react';
import {
  Zap,
  Thermometer,
  CheckCircle2,
  Database,
  Layers,
  ArrowRight,
  Radio,
  Clock,
  Loader2,
  Activity,
  FileSpreadsheet,
} from 'lucide-react';
import {
  getPanel1SourceInfo,
  getPanel2SourceInfo,
  getPanel3SourceInfo,
  getPanel4SourceInfo,
  getPanel5SourceInfo,
} from '../services/orgDatabaseStorage';

export interface PublicElectricalLoadingScreenProps {
  syncProgress: number; // 0..100 reported by syncAllPublicSharedTargetFolders across all 5 Shared Drive folders
  syncStatusText: string;
  isSyncComplete: boolean;
  onComplete: () => void;
}

export const PublicElectricalLoadingScreen: React.FC<PublicElectricalLoadingScreenProps> = ({
  syncProgress,
  syncStatusText,
  isSyncComplete,
  onComplete,
}) => {
  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [isFadingOut, setIsFadingOut] = useState<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());
  const hasTriggeredCompleteRef = useRef<boolean>(false);

  const p1Info = getPanel1SourceInfo();
  const p2Info = getPanel2SourceInfo();
  const p3Info = getPanel3SourceInfo();
  const p4Info = getPanel4SourceInfo();
  const p5Info = getPanel5SourceInfo();

  const triggerCompleteTransition = () => {
    if (hasTriggeredCompleteRef.current) return;
    hasTriggeredCompleteRef.current = true;
    setIsFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 420);
  };

  // Drive smooth 0 -> 100% electrical charging curve and elapsed clock in a single 100ms timer
  useEffect(() => {
    let finishTimeout: ReturnType<typeof setTimeout> | null = null;

    const timer = setInterval(() => {
      const elapsedMs = Date.now() - startTimeRef.current;
      setElapsedSec(elapsedMs / 1000);

      setDisplayProgress((prev) => {
        const canComplete = isSyncComplete || syncProgress >= 100 || elapsedMs >= 3800;

        if (prev >= 100 && canComplete) {
          clearInterval(timer);
          return 100;
        }

        const targetFromSync = canComplete
          ? 100
          : Math.min(96, Math.max(syncProgress, prev + 2.2));

        const gap = Math.max(0, targetFromSync - prev);
        const step = canComplete
          ? Math.max(9.5, gap * 0.55)
          : Math.max(1.8, Math.min(7.5, gap * 0.42 + 1.2));

        const next = Math.min(targetFromSync, prev + step);

        if (next >= 99.5 && canComplete) {
          clearInterval(timer);
          finishTimeout = setTimeout(() => {
            triggerCompleteTransition();
          }, 220);
          return 100;
        }

        return next;
      });
    }, 100);

    return () => {
      clearInterval(timer);
      if (finishTimeout) clearTimeout(finishTimeout);
    };
  }, [syncProgress, isSyncComplete]);

  const roundedPct = Math.min(100, Math.max(0, Math.round(displayProgress)));
  const energizedCells = Math.round((roundedPct / 100) * 25);

  // Per-folder charging progress (0..100% each, smoothly sequential across Folder 1 -> Folder 5)
  const folder1Pct =
    roundedPct >= 100
      ? 100
      : Math.min(100, Math.max(0, Math.round((displayProgress / 20) * 100)));
  const folder2Pct =
    roundedPct >= 100
      ? 100
      : displayProgress <= 20
        ? 0
        : Math.min(100, Math.max(0, Math.round(((displayProgress - 20) / 20) * 100)));
  const folder3Pct =
    roundedPct >= 100
      ? 100
      : displayProgress <= 40
        ? 0
        : Math.min(100, Math.max(0, Math.round(((displayProgress - 40) / 20) * 100)));
  const folder4Pct =
    roundedPct >= 100
      ? 100
      : displayProgress <= 60
        ? 0
        : Math.min(100, Math.max(0, Math.round(((displayProgress - 60) / 20) * 100)));
  const folder5Pct =
    roundedPct >= 100
      ? 100
      : displayProgress <= 80
        ? 0
        : Math.min(100, Math.max(0, Math.round(((displayProgress - 80) / 20) * 100)));

  // Calculate clear Estimated Time Remaining (seconds) so user always knows how long to wait
  const totalEstimatedDurationSec = 2.6;
  const remainingFraction = Math.max(0, (100 - displayProgress) / 100);
  const estRemainingSec =
    roundedPct >= 100
      ? 0
      : Math.max(0.1, Number((remainingFraction * totalEstimatedDurationSec).toFixed(1)));

  const activeFolderStep =
    roundedPct >= 100
      ? 'ALL 5 SHARED FOLDERS VERIFIED & SYNCHRONIZED (5 / 5)'
      : syncProgress < 10
        ? 'AUTO-SCANNING 5 SHARED GOOGLE DRIVE FOLDERS FOR NEWER FILES / VERSIONS'
        : folder1Pct < 100
          ? 'FOLDER 1 OF 5 · CHECKING & LOADING DAILY PEAK TEMP DB'
          : folder2Pct < 100
            ? 'FOLDER 2 OF 5 · CHECKING & LOADING 4-CIRCUIT POWER DB'
            : folder3Pct < 100
              ? 'FOLDER 3 OF 5 · CHECKING & LOADING 24-HR SECTION PROFILE DB'
              : folder4Pct < 100
                ? 'FOLDER 4 OF 5 · CHECKING & LOADING OPERATION CONDITION DB (2.6 CHART 1)'
                : 'FOLDER 5 OF 5 · CHECKING & LOADING 30-MIN LOAD CURVE DB (2.6 CHART 2)';

  const dynamicStatusHeadline =
    roundedPct >= 100
      ? 'All 5 Shared Google Drive Telemetry Folders Verified & Auto-Selected (100%)'
      : syncStatusText
        ? syncStatusText
        : folder1Pct < 100
          ? 'Checking Shared Folder 1/5: Daily Peak Fiber & Conductor Temp (19 Sections)...'
          : folder2Pct < 100
            ? 'Checking Shared Folder 2/5: 4-Circuit Submarine Power Load (115kV & 33kV)...'
            : folder3Pct < 100
              ? 'Checking Shared Folder 3/5: 24-Hour Section Daily Profile & Ckt #3 MW...'
              : folder4Pct < 100
                ? 'Checking Shared Folder 4/5: Operation Condition Database (4 Sheets)...'
                : 'Checking Shared Folder 5/5: 30-Min Load Curve Database (48 Half-Hr Slots)...';

  const radius = 86;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (roundedPct / 100) * circumference;

  return (
    <div
      className={`fixed inset-0 z-50 bg-[#050912] text-slate-100 flex flex-col justify-between p-4 sm:p-6 overflow-y-auto select-none transition-all duration-500 ease-out ${
        isFadingOut ? 'opacity-0 scale-[1.02] pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Subtle High-Voltage Grid & Radial Energy Field */}
      <div className="fixed inset-0 pointer-events-none opacity-25 bg-[radial-gradient(circle_at_50%_38%,rgba(6,182,212,0.22)_0%,rgba(59,130,246,0.08)_38%,transparent_72%)]" />

      {/* Top System Telemetry Bar */}
      <div className="relative z-10 w-full max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)]">
            <Zap className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-cyan-400 font-semibold">
              115 kV Khanom – Koh Samui Submarine Cable System
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Public Telemetry Grid · 5-Shared-Folder Auto-Version Check &amp; Charging Sequence
            </h1>
          </div>
        </div>
        <div className="px-3 py-1 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Auto-Selects Newest File Version Across All 5 Shared Folders</span>
        </div>
      </div>

      {/* Center Focal Anchor: High-Voltage Electrical Charging Reactor + 0-100% Capacitor Bank */}
      <div className="relative z-10 my-auto py-4 w-full max-w-6xl mx-auto flex flex-col items-center">
        {/* Circular High-Voltage Capacitor Core */}
        <div className="relative w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center">
          {/* Outer Rotating Energy Ring */}
          <div className="absolute inset-0 rounded-full border border-dashed border-cyan-500/30 animate-[spin_14s_linear_infinite]" />
          <div className="absolute inset-3 rounded-full border border-amber-500/20 animate-[spin_9s_linear_infinite_reverse]" />

          {/* SVG Progress Ring & Electric Arcs */}
          <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 210 210">
            <defs>
              <linearGradient id="hvChargeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="55%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
              <filter id="hvGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Background Track */}
            <circle
              cx="105"
              cy="105"
              r={radius}
              stroke="rgba(30, 41, 59, 0.85)"
              strokeWidth="10"
              fill="rgba(9, 14, 26, 0.85)"
            />

            {/* Tick Marks Around Ring */}
            {Array.from({ length: 36 }).map((_, idx) => {
              const angle = (idx * 10 * Math.PI) / 180;
              const x1 = 105 + (radius - 13) * Math.cos(angle);
              const y1 = 105 + (radius - 13) * Math.sin(angle);
              const x2 = 105 + (radius - 8) * Math.cos(angle);
              const y2 = 105 + (radius - 8) * Math.sin(angle);
              const active = (idx / 36) * 100 <= roundedPct;
              return (
                <line
                  key={idx}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={active ? '#22d3ee' : '#1e293b'}
                  strokeWidth={idx % 3 === 0 ? '2' : '1'}
                />
              );
            })}

            {/* Energized Arc */}
            <circle
              cx="105"
              cy="105"
              r={radius}
              stroke="url(#hvChargeGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              filter="url(#hvGlow)"
              className="transition-all duration-75 ease-out"
            />
          </svg>

          {/* Center Digital Readout */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <div className="flex items-center gap-1 text-amber-400 mb-1">
              <Zap className="w-5 h-5 fill-amber-400/30 animate-bounce" />
              <span className="text-[11px] font-mono uppercase tracking-widest font-bold text-cyan-300">
                {roundedPct >= 100 ? 'GRID SYNCHRONIZED' : 'ENERGIZING'}
              </span>
            </div>
            <div className="text-4xl sm:text-5xl font-black font-mono tabular-nums tracking-tight text-white drop-shadow-[0_0_18px_rgba(6,182,212,0.45)]">
              {roundedPct}
              <span className="text-2xl text-cyan-400">%</span>
            </div>
            <div className="mt-1.5 text-[11px] font-mono tabular-nums text-cyan-300/90 font-semibold">
              {roundedPct >= 100 ? 'Complete · Launching' : `Est. ~${estRemainingSec.toFixed(1)}s left`}
            </div>
          </div>
        </div>

        {/* Live Operation Status Headline + Estimated Wait Countdown */}
        <div className="mt-4 text-center space-y-2 max-w-3xl">
          <div className="flex items-center justify-center gap-2 text-xs sm:text-sm font-mono text-cyan-300 font-semibold">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
            <span>{dynamicStatusHeadline}</span>
          </div>

          {/* Explicit Wait-Time & Step Progress Indicator */}
          <div className="inline-flex flex-wrap items-center justify-center gap-3 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] font-mono tabular-nums text-slate-300">
            <span className="text-cyan-400 font-bold">{activeFolderStep}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              {roundedPct >= 100
                ? 'EST. WAIT: 0.0s (COMPLETE)'
                : `EST. TIME REMAINING: ~${estRemainingSec.toFixed(1)}s`}
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">ELAPSED: {elapsedSec.toFixed(1)}s</span>
          </div>

          <p className="text-xs text-slate-400">
            Automatically scanning all 5 shared Google Drive folders and selecting the newest database file version for Heat Map (2.1), Daily Curve (2.2), 3D Surface (2.3), Yearly Comparison (2.4), Temp Stats (2.5), and Power Statistics (2.6)
          </p>
        </div>

        {/* 25-Cell Segmented High-Voltage Capacitor Charging Bar */}
        <div className="w-full max-w-4xl mt-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-[0_0_30px_rgba(6,182,212,0.08)]">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums mb-2">
            <span className="text-slate-400 font-semibold">
              5-SHARED-FOLDER CAPACITOR BANK SYNCHRONIZATION
            </span>
            <span className="text-cyan-300 font-bold">
              {roundedPct}% ({energizedCells}/25 CELLS ENERGIZED)
            </span>
          </div>
          <div className="grid grid-cols-[repeat(25,minmax(0,1fr))] gap-1 h-3.5">
            {Array.from({ length: 25 }).map((_, i) => {
              const isLit = i < energizedCells;
              const isHigh = i >= 17;
              const isMid = i >= 9 && i < 17;
              return (
                <div
                  key={i}
                  className={`rounded-sm transition-all duration-150 ${
                    isLit
                      ? isHigh
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.65)]'
                        : isMid
                          ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.55)]'
                          : 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.55)]'
                      : 'bg-slate-800/70'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* 5 Shared Folder Conduits (Folder 1 to Folder 5) */}
        <div className="w-full max-w-6xl mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Conduit 1: Shared Folder 1 */}
          <div
            className={`rounded-2xl p-3.5 border transition-all flex flex-col justify-between ${
              folder1Pct >= 100
                ? 'bg-slate-900/90 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                : folder1Pct > 0
                  ? 'bg-slate-900/90 border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                  : 'bg-slate-900/50 border-slate-800/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-slate-200">
                    01. FOLDER 1
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {folder1Pct >= 100 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                  )}
                  <span className="text-[11px] font-mono tabular-nums font-bold text-cyan-300">
                    {folder1Pct}%
                  </span>
                </div>
              </div>
              <div className="text-xs font-bold text-white mb-1 leading-snug">
                Daily Peak Fiber &amp; Conductor Temp
              </div>
              <div className="text-[10px] text-cyan-300/90 font-mono truncate mb-1" title={p1Info.name}>
                <FileSpreadsheet className="w-3 h-3 inline mr-1 text-cyan-400" />
                {p1Info.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums mb-2.5">
                {p1Info.totalDates} Dates · Feeds [2.1] &amp; [2.4]
              </div>
            </div>
            <svg className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800" viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect x="0" y="0" width={folder1Pct} height="6" className="fill-cyan-400 transition-all duration-150" />
            </svg>
          </div>

          {/* Conduit 2: Shared Folder 2 */}
          <div
            className={`rounded-2xl p-3.5 border transition-all flex flex-col justify-between ${
              folder2Pct >= 100
                ? 'bg-slate-900/90 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                : folder2Pct > 0
                  ? 'bg-slate-900/90 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                  : 'bg-slate-900/50 border-slate-800/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-slate-200">
                    02. FOLDER 2
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {folder2Pct >= 100 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : folder2Pct > 0 ? (
                    <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                  ) : null}
                  <span className="text-[11px] font-mono tabular-nums font-bold text-emerald-300">
                    {folder2Pct}%
                  </span>
                </div>
              </div>
              <div className="text-xs font-bold text-white mb-1 leading-snug">
                4-Circuit Daily Max Power DB
              </div>
              <div className="text-[10px] text-emerald-300/90 font-mono truncate mb-1" title={p2Info.name}>
                <FileSpreadsheet className="w-3 h-3 inline mr-1 text-emerald-400" />
                {p2Info.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums mb-2.5">
                {p2Info.totalDates} Dates · Feeds [2.4]
              </div>
            </div>
            <svg className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800" viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect x="0" y="0" width={folder2Pct} height="6" className="fill-emerald-400 transition-all duration-150" />
            </svg>
          </div>

          {/* Conduit 3: Shared Folder 3 */}
          <div
            className={`rounded-2xl p-3.5 border transition-all flex flex-col justify-between ${
              folder3Pct >= 100
                ? 'bg-slate-900/90 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                : folder3Pct > 0
                  ? 'bg-slate-900/90 border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                  : 'bg-slate-900/50 border-slate-800/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-slate-200">
                    03. FOLDER 3
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {folder3Pct >= 100 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : folder3Pct > 0 ? (
                    <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                  ) : null}
                  <span className="text-[11px] font-mono tabular-nums font-bold text-purple-300">
                    {folder3Pct}%
                  </span>
                </div>
              </div>
              <div className="text-xs font-bold text-white mb-1 leading-snug">
                24-Hour Section Daily Profile DB
              </div>
              <div className="text-[10px] text-purple-300/90 font-mono truncate mb-1" title={p3Info.name}>
                <FileSpreadsheet className="w-3 h-3 inline mr-1 text-purple-400" />
                {p3Info.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums mb-2.5">
                {p3Info.totalDates} Dates · Feeds [2.2], [2.3] &amp; [2.5]
              </div>
            </div>
            <svg className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800" viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect x="0" y="0" width={folder3Pct} height="6" className="fill-purple-400 transition-all duration-150" />
            </svg>
          </div>

          {/* Conduit 4: Shared Folder 4 (Page 2.6 Chart 1) */}
          <div
            className={`rounded-2xl p-3.5 border transition-all flex flex-col justify-between ${
              folder4Pct >= 100
                ? 'bg-slate-900/90 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                : folder4Pct > 0
                  ? 'bg-slate-900/90 border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.1)]'
                  : 'bg-slate-900/50 border-slate-800/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-slate-200">
                    04. FOLDER 4
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {folder4Pct >= 100 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : folder4Pct > 0 ? (
                    <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  ) : null}
                  <span className="text-[11px] font-mono tabular-nums font-bold text-amber-300">
                    {folder4Pct}%
                  </span>
                </div>
              </div>
              <div className="text-xs font-bold text-white mb-1 leading-snug">
                Operation Condition DB (4 Sheets)
              </div>
              <div className="text-[10px] text-amber-300/90 font-mono truncate mb-1" title={p4Info.name}>
                <FileSpreadsheet className="w-3 h-3 inline mr-1 text-amber-400" />
                {p4Info.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums mb-2.5">
                {p4Info.totalDates} Dates · Feeds [2.6] Chart 1
              </div>
            </div>
            <svg className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800" viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect x="0" y="0" width={folder4Pct} height="6" className="fill-amber-400 transition-all duration-150" />
            </svg>
          </div>

          {/* Conduit 5: Shared Folder 5 (Page 2.6 Chart 2) */}
          <div
            className={`rounded-2xl p-3.5 border transition-all flex flex-col justify-between ${
              folder5Pct >= 100
                ? 'bg-slate-900/90 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                : folder5Pct > 0
                  ? 'bg-slate-900/90 border-sky-500/40 shadow-[0_0_20px_rgba(14,165,233,0.1)]'
                  : 'bg-slate-900/50 border-slate-800/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-slate-200">
                    05. FOLDER 5
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {folder5Pct >= 100 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : folder5Pct > 0 ? (
                    <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                  ) : null}
                  <span className="text-[11px] font-mono tabular-nums font-bold text-sky-300">
                    {folder5Pct}%
                  </span>
                </div>
              </div>
              <div className="text-xs font-bold text-white mb-1 leading-snug">
                30-Min Load Curve DB (48 Slots)
              </div>
              <div className="text-[10px] text-sky-300/90 font-mono truncate mb-1" title={p5Info.name}>
                <FileSpreadsheet className="w-3 h-3 inline mr-1 text-sky-400" />
                {p5Info.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums mb-2.5">
                {p5Info.totalDates} Dates · Feeds [2.6] Chart 2
              </div>
            </div>
            <svg className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800" viewBox="0 0 100 6" preserveAspectRatio="none">
              <rect x="0" y="0" width={folder5Pct} height="6" className="fill-sky-400 transition-all duration-150" />
            </svg>
          </div>
        </div>
      </div>

      {/* Bottom Action & Range Footer */}
      <div className="relative z-10 w-full max-w-6xl mx-auto pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
          <Database className="w-4 h-4 text-cyan-400" />
          <span>
            ACTIVE TELEMETRY WINDOW: {p3Info.dateRange.firstDate || '2025-07-01'} TO{' '}
            {p4Info.dateRange.latestDate || p3Info.dateRange.latestDate || '2026-10-26'}
          </span>
          {roundedPct >= 100 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> All 5 Shared Folders Ready
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={triggerCompleteTransition}
          className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(6,182,212,0.35)]"
        >
          <span>{roundedPct >= 100 ? 'Enter Dashboard' : 'Skip to Dashboard'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
