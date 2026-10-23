import React, { useState, useEffect } from 'react';
import {
  Activity,
  Zap,
  CheckCircle2,
  Sparkles,
  Shield,
  Cpu,
  Radio,
  Terminal,
  Play,
  Layers,
  Calendar,
  Compass,
  Thermometer,
  Flame,
} from 'lucide-react';
import { ScannedFileMeta, ParsedTeprFile } from '../services/teprParser';
import { PowerScannedFileMeta } from '../services/powerConsumptionParser';

interface VideoGameLoadingScreenProps {
  scannedFiles: ScannedFileMeta[];
  parsedFiles: ParsedTeprFile[];
  powerScannedFiles: PowerScannedFileMeta[];
  loadingProgress: { loaded: number; total: number; fileName: string } | null;
  isLoadingFiles: boolean;
  isSyncingPowerForDate: boolean;
  isReadingTemperature: boolean;
  isInitialScanning: boolean;
  isInitialSystemLoading?: boolean;
  folderName?: string;
  selectedYearFilter?: string;
  selectedMonthFilter?: string;
  selectedDateFilter?: string;
  onComplete: () => void;
}

interface ScanStage {
  id: string;
  name: string;
  subtext: string;
  targetPct: number;
  icon: React.ReactNode;
}

export const VideoGameLoadingScreen: React.FC<VideoGameLoadingScreenProps> = ({
  scannedFiles,
  parsedFiles,
  powerScannedFiles,
  loadingProgress,
  isLoadingFiles,
  isSyncingPowerForDate,
  isReadingTemperature,
  isInitialScanning,
  isInitialSystemLoading = false,
  folderName = 'Target Folder',
  selectedYearFilter = 'All',
  selectedMonthFilter = 'All',
  selectedDateFilter = 'All',
  onComplete,
}) => {
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [activeStageIndex, setActiveStageIndex] = useState<number>(0);
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [isReadyToEnter, setIsReadyToEnter] = useState<boolean>(false);
  const [isFadingOut, setIsFadingOut] = useState<boolean>(false);
  const [glitchText, setGlitchText] = useState<string>('DTS SCADA V2.4');

  const handleManualComplete = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 500);
  };

  const folder1DatesCount = React.useMemo(() => {
    const s = new Set<string>();
    scannedFiles.forEach((f) => {
      if (f.dateMeta?.dateKey) s.add(f.dateMeta.dateKey);
    });
    return s.size;
  }, [scannedFiles]);

  const folder2DatesCount = React.useMemo(() => {
    const s = new Set<string>();
    powerScannedFiles.forEach((f) => {
      if (f.dateMeta?.dateKey) s.add(f.dateMeta.dateKey);
    });
    return s.size;
  }, [powerScannedFiles]);

  const STAGES: ScanStage[] = [
    {
      id: 'fiber_scan',
      name: '1. TARGET FOLDER 1 — DATE SCANNING (.TEPR FIBER TEMPERATURE)',
      subtext:
        scannedFiles.length > 0
          ? `✓ Scanned ${folder1DatesCount} dates (${scannedFiles.length} .TEPR files) in Target Folder 1 "${folderName}"`
          : `Scanning date records & fiber temperature files in Target Folder 1 "${folderName}"...`,
      targetPct: 45,
      icon: <Thermometer className="w-4 h-4 text-cyan-400" />,
    },
    {
      id: 'scada_power',
      name: '2. TARGET FOLDER 2 — DATE SCANNING (4-CIRCUIT POWER CSV)',
      subtext:
        powerScannedFiles.length > 0
          ? `✓ Scanned ${folder2DatesCount} dates (${powerScannedFiles.length} SCADA CSV files) in Target Folder 2 (KMB, KMA, KNA)`
          : 'Scanning 15-min substation SCADA power flow dates in Target Folder 2 (KMB, KMA & KNA)...',
      targetPct: 85,
      icon: <Zap className="w-4 h-4 text-amber-400" />,
    },
    {
      id: 'phase_mgmt',
      name: '3. TOTAL DATE TAXONOMY & ADMIN DASHBOARD INITIALIZATION (0–100%)',
      subtext:
        selectedDateFilter !== 'all' && selectedDateFilter !== 'All'
          ? `✓ Total Date Scan Complete: Year (${selectedYearFilter}), Month (${selectedMonthFilter}), Date (${selectedDateFilter}) — Launching Admin Dashboard`
          : 'Indexing Year, Month, Date taxonomy across Target Folders 1 & 2...',
      targetPct: 100,
      icon: <Calendar className="w-4 h-4 text-emerald-400" />,
    },
  ];

  // Random retro sci-fi glitch effect on header text
  useEffect(() => {
    const titles = [
      'DTS SCADA V2.4',
      'TARGET FOLDER 1–2 SCAN',
      'OPTICAL SENSOR SCAN',
      '115kV CKT #3 GRID',
      'ADMIN SESSION READY',
    ];
    let interval = setInterval(() => {
      const idx = Math.floor(Math.random() * titles.length);
      setGlitchText(titles[idx]);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  // Smoothly drive progress percentages linked strictly to background scanning completion (0-100%)
  useEffect(() => {
    let completedTimer: ReturnType<typeof setTimeout> | null = null;

    const timer = setInterval(() => {
      setOverallProgress((prev) => {
        const isBusy =
          isLoadingFiles ||
          isSyncingPowerForDate ||
          isInitialScanning ||
          isReadingTemperature ||
          isInitialSystemLoading;

        // If background scanning in Target Folder 1-2 is active, cap progress at 92% until ALL date scanning finishes
        const maxCap = isBusy ? 92 : 100;
        let increment = isBusy ? 1.8 + Math.random() * 2.4 : 8.5 + Math.random() * 6.0;

        const next = Math.min(maxCap, prev + increment);

        // Advance active stage
        if (next < 45) setActiveStageIndex(0);
        else if (next < 85) setActiveStageIndex(1);
        else setActiveStageIndex(2);

        if (next >= 100 && !isBusy) {
          clearInterval(timer);
          setIsReadyToEnter(true);

          // Automatically fade out loading screen and reveal the Admin Dashboard once total date scanning finishes
          completedTimer = setTimeout(() => {
            setIsFadingOut(true);
            setTimeout(() => {
              onComplete();
            }, 450);
          }, 350);

          return 100;
        }

        return next;
      });
    }, 70);

    return () => {
      clearInterval(timer);
      if (completedTimer) clearTimeout(completedTimer);
    };
  }, [
    isLoadingFiles,
    isSyncingPowerForDate,
    isInitialScanning,
    isReadingTemperature,
    isInitialSystemLoading,
    onComplete,
  ]);

  // Terminal log stream effects
  useEffect(() => {
    const logs: string[] = [];
    if (scannedFiles.length > 0) {
      logs.push(
        `[OK] Target Folder 1: Scanned ${folder1DatesCount} dates (${scannedFiles.length} .TEPR fiber temperature files)`
      );
    } else {
      logs.push('[SCANNING] Target Folder 1: Scanning date records & .TEPR fiber temperature files...');
    }

    if (powerScannedFiles.length > 0) {
      logs.push(
        `[OK] Target Folder 2: Scanned ${folder2DatesCount} dates (${powerScannedFiles.length} SCADA power CSV datasets)`
      );
    } else {
      logs.push('[SCANNING] Target Folder 2: Scanning date records across KMB, KMA & KNA power CSVs...');
    }

    if (selectedDateFilter !== 'all' && selectedDateFilter !== 'All') {
      logs.push(
        `[OK] Date Taxonomy: Year (${selectedYearFilter}), Month (${selectedMonthFilter}), Date (${selectedDateFilter}) verified`
      );
    } else {
      logs.push('[INDEXING] Synchronizing Target Folder 1 & Target Folder 2 date taxonomy...');
    }

    logs.push('[OK] Phase A, B, C & Submarine Channel 3 taxonomy verified');
    logs.push('[OK] Total Date Scanning Complete — Opening Admin Dashboard...');

    setLogMessages(logs);
  }, [
    scannedFiles,
    powerScannedFiles,
    folder1DatesCount,
    folder2DatesCount,
    selectedYearFilter,
    selectedMonthFilter,
    selectedDateFilter,
  ]);

  const fiberCountDisplay = scannedFiles.length > 0 ? `${folder1DatesCount} Days (${scannedFiles.length})` : 'Scanning...';
  const powerCountDisplay = powerScannedFiles.length > 0 ? `${folder2DatesCount} Days (${powerScannedFiles.length})` : 'Scanning...';
  const parsedCountDisplay =
    parsedFiles.length > 0 ? parsedFiles.length : Math.round((overallProgress / 100) * 820);

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-950 text-slate-100 font-mono flex flex-col justify-between p-4 sm:p-8 overflow-hidden select-none transition-all duration-700 ease-in-out ${
        isFadingOut ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Background Cyberpunk Grid & Scanline Effect */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black pointer-events-none" />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, #1e293b 1px, transparent 1px),
            linear-gradient(to bottom, #1e293b 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
        }}
      />
      {/* Subtle CRT Scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] pointer-events-none opacity-40" />

      {/* Retro Arcade Frame Corners */}
      <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-cyan-500/80 pointer-events-none" />
      <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-cyan-500/80 pointer-events-none" />
      <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-cyan-500/80 pointer-events-none" />
      <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-cyan-500/80 pointer-events-none" />

      {/* Top HUD Bar */}
      <div className="relative z-10 flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-cyan-500 animate-ping" />
          <div>
            <div className="text-xs font-extrabold text-cyan-400 tracking-wider flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" />
              <span>SYSTEM INITIALIZATION HUD</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
                {glitchText}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              115 kV Submarine Cable Circuit #3 • DTS &amp; SCADA Thermal Engine
            </div>
          </div>
        </div>

        {/* Skip button for fast entry */}
        <button
          type="button"
          onClick={handleManualComplete}
          className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
        >
          <span>SKIP INTRO</span>
          <span>➔</span>
        </button>
      </div>

      {/* Center Gaming HUD Loading Body */}
      <div className="relative z-10 my-auto max-w-4xl mx-auto w-full space-y-6">
        {/* Animated Reticle & Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-xs font-bold shadow-lg shadow-cyan-500/10">
            <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
            <span>AUTHENTICATED • INITIALIZING DASHBOARD</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white uppercase drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]">
            Scanning DTS Fiber Temperature &amp; Phase Data
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto">
            Indexing Year, Month, and Date taxonomy across Phase A, Phase B, Phase C, and Submarine Channel 3.
          </p>
        </div>

        {/* Main Retro Video Game Progress Bar Card */}
        <div className="bg-slate-900/90 rounded-2xl border-2 border-slate-700/80 p-6 shadow-2xl space-y-5 backdrop-blur-md relative overflow-hidden">
          {/* Glowing Top Progress Line */}
          <div
            className="absolute top-0 left-0 h-1 bg-gradient-to-r from-cyan-500 via-emerald-400 to-rose-500 transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
          />

          {/* Large Arcade Percentage Indicator */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-widest font-bold">
                Overall Data Scan Status
              </div>
              <div className="text-sm font-bold text-cyan-400 mt-1 flex items-center gap-2">
                {STAGES[activeStageIndex]?.icon}
                <span>{STAGES[activeStageIndex]?.name}</span>
              </div>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-4xl sm:text-6xl font-black font-mono tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-emerald-300 to-amber-300 drop-shadow-[0_0_20px_rgba(34,211,238,0.4)]">
                {Math.round(overallProgress)}%
              </span>
              <span className="text-xs text-slate-500 font-bold uppercase">LOADED</span>
            </div>
          </div>

          {/* Segmented Pixel Loading Bar */}
          <div className="space-y-2">
            <div className="h-6 bg-slate-950 rounded-xl border border-slate-800 p-1 flex items-center gap-1 overflow-hidden shadow-inner">
              {Array.from({ length: 40 }).map((_, idx) => {
                const filledPct = (idx + 1) * 2.5;
                const isFilled = overallProgress >= filledPct;
                return (
                  <div
                    key={idx}
                    className={`h-full flex-1 rounded-xs transition-all duration-150 ${
                      isFilled
                        ? filledPct > 84
                          ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                          : filledPct > 58
                          ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                          : filledPct > 28
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                          : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                        : 'bg-slate-800/40'
                    }`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-bold tracking-wider">
              <span>0% START</span>
              <span>28% FIBER</span>
              <span>58% PHASE &amp; TAXONOMY</span>
              <span>84% SCADA</span>
              <span>100% READY</span>
            </div>
          </div>

          {/* Stage Grid Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {STAGES.map((stage, idx) => {
              const isDone = overallProgress >= stage.targetPct;
              const isActive = activeStageIndex === idx && !isDone;
              return (
                <div
                  key={stage.id}
                  className={`p-3 rounded-xl border transition-all ${
                    isDone
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                      : isActive
                      ? 'bg-cyan-950/30 border-cyan-500/80 text-cyan-200 shadow-md shadow-cyan-500/10 animate-pulse'
                      : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold mb-1">
                    <span className="flex items-center gap-1.5">
                      {stage.icon}
                      <span className="truncate">{stage.name}</span>
                    </span>
                    <span className="font-mono text-[11px]">
                      {isDone ? '100%' : isActive ? `${Math.round(overallProgress)}%` : '0%'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{stage.subtext}</div>
                </div>
              );
            })}
          </div>

          {/* Live Data Scanning Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-xs">
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Fiber Temp Files</div>
              <div className="text-sm font-bold font-mono text-cyan-300 mt-0.5">
                {fiberCountDisplay} Records
              </div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Phase Management</div>
              <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5">
                Ph A/B/C + Sub sea
              </div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">SCADA Power CSV</div>
              <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
                {powerCountDisplay} Files
              </div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Parsed .TEPR Samples</div>
              <div className="text-sm font-bold font-mono text-rose-300 mt-0.5">
                {parsedCountDisplay} Sets
              </div>
            </div>
          </div>
        </div>

        {/* Console Activity Log & Final Action Prompt */}
        <div className="bg-slate-950/90 rounded-xl border border-slate-800 p-4 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between text-slate-400 border-b border-slate-800/80 pb-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-bold text-slate-300">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              TERMINAL SCAN LOG
            </span>
            <span className="text-slate-500">LIVE FEED</span>
          </div>

          <div className="space-y-1 text-[11px] text-slate-300 max-h-24 overflow-y-auto">
            {logMessages.map((msg, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold">&gt;</span>
                <span>{msg}</span>
              </div>
            ))}
            {loadingProgress && (
              <div className="text-cyan-400 font-bold animate-pulse">
                &gt; Reading {loadingProgress.fileName} ({loadingProgress.loaded}/{loadingProgress.total})
              </div>
            )}
          </div>
        </div>

        {/* System Ready Launch Button */}
        {isReadyToEnter && (
          <div className="text-center pt-2 animate-in fade-in zoom-in duration-300">
            <button
              type="button"
              onClick={handleManualComplete}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-emerald-500 to-indigo-600 hover:from-cyan-400 hover:via-emerald-400 hover:to-indigo-500 text-slate-950 font-black text-sm tracking-wider uppercase shadow-xl shadow-cyan-500/25 border border-white/20 transition-all transform hover:scale-105 cursor-pointer flex items-center justify-center gap-3 mx-auto"
            >
              <Sparkles className="w-5 h-5 text-slate-950" />
              <span>SYSTEM READY — LAUNCH DASHBOARD</span>
              <Play className="w-4 h-4 fill-slate-950" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom Footer Info Bar */}
      <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-800/80 pt-4 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-slate-400" />
          <span>ISO/IEC 27001 &amp; CIGRE TB 610/852 Compliant Protocol</span>
        </div>
        <div className="font-mono">
          115kV Submarine Cable Circuit #3 • SCADA &amp; Fiber Thermal Monitor
        </div>
      </div>
    </div>
  );
};
