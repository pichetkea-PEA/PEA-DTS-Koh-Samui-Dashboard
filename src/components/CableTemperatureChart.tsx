import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceDot,
  ReferenceLine,
} from 'recharts';
import { 
  ParsedTeprFile, 
  DiscretePositionPeakMetric,
  buildDiscretePositionPeaks,
  TARGET_LOCATIONS_STANDARD,
  TARGET_LOCATIONS_SUBMARINE,
  getCablePhaseFromChannel
} from '../services/teprParser';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import {
  Activity,
  Thermometer,
  Clock,
  Flame,
  ShieldAlert,
  Sparkles,
  Layers,
  Zap,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';

interface CableTemperatureChartProps {
  parsedFiles: ParsedTeprFile[];
  activeFileId: string | null;
  onSelectFile: (fileId: string) => void;
  selectedLocation: number | null;
  onSelectLocation: (loc: number) => void;
  activePhaseFilter?: string;
  onPhaseFilterChange?: (phase: string) => void;
  activeDateFilter?: string;
  activeHourFilter?: string;
  onHourFilterChange?: (hour: string) => void;
  onReadTemperature?: () => void;
  isReadingTemperature?: boolean;
  dailyPowerSummary?: DailyPowerSummary | null;
}

export const CableTemperatureChart: React.FC<CableTemperatureChartProps> = ({
  parsedFiles,
  activeFileId,
  onSelectFile,
  selectedLocation,
  onSelectLocation,
  activePhaseFilter = 'all',
  onPhaseFilterChange,
  activeDateFilter = 'all',
  activeHourFilter = 'all',
  onHourFilterChange,
  onReadTemperature,
  isReadingTemperature = false,
  dailyPowerSummary = null,
}) => {
  const [viewMode, setViewMode] = useState<'delta' | 'absolute'>('absolute');
  const [showPhaseComparison, setShowPhaseComparison] = useState(false);
  const [showConductorEstimation, setShowConductorEstimation] = useState(true);
  const [internalHourFilter, setInternalHourFilter] = useState<string>('all');

  // Effective hour filter (supports controlled via props or internal state)
  const currentHourFilter = activeHourFilter !== undefined ? activeHourFilter : internalHourFilter;
  const handleHourChange = (newHour: string) => {
    setInternalHourFilter(newHour);
    if (onHourFilterChange) {
      onHourFilterChange(newHour);
    }
  };

  // Use the parsed files read from Page 1 ("Folder & Asset") for the selected date
  const effectiveParsedFiles = useMemo(() => {
    if (!activeDateFilter || activeDateFilter === 'all') return parsedFiles;
    const matched = parsedFiles.filter((f) => {
      const dKey = f.dateMeta?.dateKey || '';
      return dKey === activeDateFilter;
    });
    return matched.length > 0 ? matched : parsedFiles;
  }, [parsedFiles, activeDateFilter]);

  // Requirement 4: Cable Phase detection automatically from read files in focus area
  const availablePhases = useMemo(() => {
    const phases = new Set<string>();
    effectiveParsedFiles.forEach((f) => {
      if (f.cablePhase && f.cablePhase !== 'Unassigned') {
        phases.add(f.cablePhase);
      }
    });
    return Array.from(phases);
  }, [effectiveParsedFiles]);

  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {
      'Phase A': 0,
      'Phase B': 0,
      'Phase C': 0,
      'Submarine Cable': 0,
      'Unassigned': 0,
    };
    effectiveParsedFiles.forEach((f) => {
      const p = f.cablePhase || 'Unassigned';
      counts[p] = (counts[p] || 0) + 1;
    });
    return counts;
  }, [effectiveParsedFiles]);

  // Hourly counts across read focus files (00..23) for active phase
  const hourCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0');
      counts[key] = 0;
    }
    effectiveParsedFiles.forEach((f) => {
      if (activePhaseFilter !== 'all' && f.cablePhase !== activePhaseFilter) return;
      const hKey = f.dateMeta?.hourKey || (f.dateMeta?.hour !== undefined ? String(f.dateMeta.hour).padStart(2, '0') : '');
      if (hKey && counts[hKey] !== undefined) {
        counts[hKey] += 1;
      }
    });
    return counts;
  }, [effectiveParsedFiles, activePhaseFilter]);

  // Compute discrete position peaks strictly for the designated points (38 Land vs 81 Submarine)
  // Evaluates maximum temperature value + Equations #1-#15 Conductor Temp (Tc,f & Tc,l)
  const discretePeaks: DiscretePositionPeakMetric[] = useMemo(() => {
    return buildDiscretePositionPeaks(effectiveParsedFiles, activePhaseFilter, currentHourFilter, dailyPowerSummary);
  }, [effectiveParsedFiles, activePhaseFilter, currentHourFilter, dailyPowerSummary]);

  const isSubmarine = 
    activePhaseFilter === 'Submarine Cable' || 
    (activePhaseFilter === 'all' && effectiveParsedFiles.length > 0 && effectiveParsedFiles.every((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3));

  // Determine overall asset peak across all discrete positions
  const overallPeak = useMemo(() => {
    if (discretePeaks.length === 0) return null;
    let max = discretePeaks[0];
    for (const p of discretePeaks) {
      if (p.maxDeltaTemp > max.maxDeltaTemp) {
        max = p;
      }
    }
    return max;
  }, [discretePeaks]);

  // Maximum estimated conductor temperature (IEC 60287) across all points
  const conductorPeakStats = useMemo(() => {
    let maxTc60287: number | null = null;
    let maxTcPoint: DiscretePositionPeakMetric | null = null;

    for (const p of discretePeaks) {
      const val = p.tc60287 ?? p.tcMax;
      if (val !== null && val !== undefined && (maxTc60287 === null || val > maxTc60287)) {
        maxTc60287 = val;
        maxTcPoint = p;
      }
    }
    return { maxTc60287, maxTcPoint };
  }, [discretePeaks]);

  // Format data points specifically for X-Y Chart (Both Reading Fiber Optic Temp Tf and Calculated Conductor Temp Tc,60287)
  const chartData = useMemo(() => {
    return discretePeaks.map((item) => {
      const calcTc = item.tc60287 ?? item.tcMax ?? item.maxAbsoluteTemp;
      const calcDeltaTc = Number((calcTc - item.fiberReferenceTemp).toFixed(4));
      const tempRiseAboveFiber = Number((calcTc - item.maxAbsoluteTemp).toFixed(4));

      const point: any = {
        location: item.location,
        locationLabel: `${item.location.toFixed(2)}m`,
        pos: item.pos,
        kp: item.kp,
        sectionId: item.sectionId,
        sectionName: item.sectionName,
        sectionType: item.sectionType,
        tag: item.tag,
        peakDelta: item.maxDeltaTemp,
        peakAbsolute: item.maxAbsoluteTemp,
        tc60287: calcTc,
        tcDelta: calcDeltaTc,
        tempRiseAboveFiber,
        calculatedPlotVal: viewMode === 'delta' ? calcDeltaTc : calcTc,
        equationName: item.equationName,
        hasPowerData: true,
        pCkt3MW: item.pCkt3MW,
        matchedPowerTime: item.matchedPowerTime,
        powerStatusText: item.powerStatusText,
        peakTimestamp: item.peakTimestamp,
        peakFormattedTime: item.peakFormattedDateTime,
        peakFileName: item.peakFileName,
        peakFileId: item.peakFileId,
        cablePhase: item.cablePhase,
        baseline: item.fiberReferenceTemp,
      };

      // Multi-phase peaks for cross-phase comparison on Land Cable (38 points)
      if (item.phasePeaks) {
        if (item.phasePeaks.phaseA) {
          point.phaseA_val = viewMode === 'delta' ? item.phasePeaks.phaseA.maxDelta : item.phasePeaks.phaseA.maxAbs;
          point.phaseA_tc60287 = item.phasePeaks.phaseA.tc60287;
          point.phaseA_time = item.phasePeaks.phaseA.peakTime;
          point.phaseA_file = item.phasePeaks.phaseA.fileName;
        }
        if (item.phasePeaks.phaseB) {
          point.phaseB_val = viewMode === 'delta' ? item.phasePeaks.phaseB.maxDelta : item.phasePeaks.phaseB.maxAbs;
          point.phaseB_tc60287 = item.phasePeaks.phaseB.tc60287;
          point.phaseB_time = item.phasePeaks.phaseB.peakTime;
          point.phaseB_file = item.phasePeaks.phaseB.fileName;
        }
        if (item.phasePeaks.phaseC) {
          point.phaseC_val = viewMode === 'delta' ? item.phasePeaks.phaseC.maxDelta : item.phasePeaks.phaseC.maxAbs;
          point.phaseC_tc60287 = item.phasePeaks.phaseC.tc60287;
          point.phaseC_time = item.phasePeaks.phaseC.peakTime;
          point.phaseC_file = item.phasePeaks.phaseC.fileName;
        }
        if (item.phasePeaks.submarine) {
          point.sub_val = viewMode === 'delta' ? item.phasePeaks.submarine.maxDelta : item.phasePeaks.submarine.maxAbs;
          point.sub_tc60287 = item.phasePeaks.submarine.tc60287;
          point.sub_time = item.phasePeaks.submarine.peakTime;
          point.sub_file = item.phasePeaks.submarine.fileName;
        }
      }

      // Primary plotted Reading Fiber Optic Temperature value
      point.primaryVal = viewMode === 'delta' ? item.maxDeltaTemp : item.maxAbsoluteTemp;

      return point;
    });
  }, [discretePeaks, viewMode]);

  // Selected or Peak point for instant side-by-side Reading vs Calculated display
  const activePointMetric = useMemo(() => {
    if (chartData.length === 0) return null;
    if (selectedLocation !== null) {
      const found = chartData.find((d) => Math.abs(d.location - selectedLocation) < 0.05);
      if (found) return found;
    }
    return chartData.reduce((best, curr) => (curr.peakAbsolute > best.peakAbsolute ? curr : best), chartData[0]);
  }, [chartData, selectedLocation]);

  const startPos = discretePeaks[0]?.location || (isSubmarine ? 2691.75 : 2020.94);
  const endPos = discretePeaks[discretePeaks.length - 1]?.location || (isSubmarine ? 55225.87 : 3464.56);
  const totalSpan = Math.max(1, endPos - startPos);

  // Distance Zoom & Horizontal Scroll Bar State
  const [zoomStartM, setZoomStartM] = useState<number>(startPos);
  const [zoomEndM, setZoomEndM] = useState<number>(endPos);
  const [canvasZoomFactor, setCanvasZoomFactor] = useState<number>(1);

  // Sync zoom range when switching between Land (2020.94m–3464.56m) and Submarine (2691.75m–55225.87m)
  useEffect(() => {
    setZoomStartM(startPos);
    setZoomEndM(endPos);
    setCanvasZoomFactor(1);
  }, [isSubmarine, startPos, endPos]);

  const effectiveZoomStart = Math.max(startPos, Math.min(zoomStartM, endPos - 10));
  const effectiveZoomEnd = Math.min(endPos, Math.max(zoomEndM, effectiveZoomStart + 10));
  const currentWindowSpan = Math.max(10, effectiveZoomEnd - effectiveZoomStart);
  const isZoomed = effectiveZoomStart > startPos + 1 || effectiveZoomEnd < endPos - 1;
  const zoomRatio = Number((totalSpan / currentWindowSpan).toFixed(1));

  // Filter chart data to the zoomed distance period (keep 1 neighbor point on each side if available for continuous lines)
  const visibleChartData = useMemo(() => {
    if (!isZoomed) return chartData;
    const inside = chartData.filter(
      (d) => d.location >= effectiveZoomStart - 0.5 && d.location <= effectiveZoomEnd + 0.5
    );
    if (inside.length >= 2) return inside;
    // If the zoomed range is between sparse points, find closest 2 points
    let closestIdx = 0;
    let minDiff = Infinity;
    const center = (effectiveZoomStart + effectiveZoomEnd) / 2;
    chartData.forEach((d, idx) => {
      const diff = Math.abs(d.location - center);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    const startIdx = Math.max(0, closestIdx - 1);
    const endIdx = Math.min(chartData.length - 1, closestIdx + 1);
    return chartData.slice(startIdx, endIdx + 1);
  }, [chartData, isZoomed, effectiveZoomStart, effectiveZoomEnd]);

  const visibleTicks = useMemo(() => {
    const baseTicks = isSubmarine ? TARGET_LOCATIONS_SUBMARINE : TARGET_LOCATIONS_STANDARD;
    if (!isZoomed) return baseTicks;
    return baseTicks.filter((t) => t >= effectiveZoomStart - 0.5 && t <= effectiveZoomEnd + 0.5);
  }, [isSubmarine, isZoomed, effectiveZoomStart, effectiveZoomEnd]);

  // Zoom In / Out around current window center (or selectedLocation if inside window)
  const applyZoomFactor = (targetRatio: number) => {
    if (targetRatio <= 1) {
      setZoomStartM(startPos);
      setZoomEndM(endPos);
      return;
    }
    const minSpan = isSubmarine ? 150 : 80;
    const newSpan = Math.max(minSpan, Math.min(totalSpan, totalSpan / targetRatio));
    const anchor =
      selectedLocation !== null &&
      selectedLocation >= effectiveZoomStart &&
      selectedLocation <= effectiveZoomEnd
        ? selectedLocation
        : (effectiveZoomStart + effectiveZoomEnd) / 2;
    let nextStart = anchor - newSpan / 2;
    let nextEnd = anchor + newSpan / 2;
    if (nextStart < startPos) {
      nextStart = startPos;
      nextEnd = Math.min(endPos, startPos + newSpan);
    }
    if (nextEnd > endPos) {
      nextEnd = endPos;
      nextStart = Math.max(startPos, endPos - newSpan);
    }
    setZoomStartM(Number(nextStart.toFixed(2)));
    setZoomEndM(Number(nextEnd.toFixed(2)));
  };

  // Horizontal Scroll / Pan handler (0% to 100% of available pan range)
  const maxPanStart = Math.max(startPos, endPos - currentWindowSpan);
  const handleHorizontalScrollPosition = (newStart: number) => {
    const clampedStart = Math.max(startPos, Math.min(maxPanStart, newStart));
    const clampedEnd = Math.min(endPos, clampedStart + currentWindowSpan);
    setZoomStartM(Number(clampedStart.toFixed(2)));
    setZoomEndM(Number(clampedEnd.toFixed(2)));
  };

  const handleStepPan = (direction: 'left' | 'right') => {
    const step = Math.max(20, currentWindowSpan * 0.25);
    const delta = direction === 'left' ? -step : step;
    handleHorizontalScrollPosition(effectiveZoomStart + delta);
  };

  // Interesting distance presets for quick zoom into tight joint/crossing clusters
  const distancePresets = useMemo(() => {
    if (isSubmarine) {
      return [
        { label: 'Full Route (2.69–55.23 km)', start: startPos, end: endPos },
        { label: 'Zone 2.1–2.3: Bottleneck & PWA (2,691–2,860 m)', start: 2691.75, end: 2860.0 },
        { label: 'Zone 2.5–2.6: Nexans Joint 1–2 (35,500–37,300 m)', start: 35500.0, end: 37300.0 },
        { label: 'Zone 2.8–2.9: Furukawa Joint 1–2 (50,600–52,450 m)', start: 50600.0, end: 52450.0 },
        { label: 'Zone 2.11–2.13: 33kV Crossing & TJ2 (54,300–55,226 m)', start: 54300.0, end: 55225.87 },
      ];
    }
    return [
      { label: 'Full Land Route (2,021–3,465 m)', start: startPos, end: endPos },
      { label: 'Sec 1.1–1.2: LS1 & Joint JP1 (2,020–2,520 m)', start: 2020.94, end: 2520.0 },
      { label: 'Sec 1.3–1.4: LS2 & Joint JP2 (2,500–3,015 m)', start: 2500.0, end: 3015.0 },
      { label: 'Sec 1.5–1.6: LS3 & Transition TJ1 (3,000–3,465 m)', start: 3000.0, end: 3464.56 },
    ];
  }, [isSubmarine, startPos, endPos]);

  // Empty state check strictly after all hooks have been executed
  if (effectiveParsedFiles.length === 0 || discretePeaks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner">
          <Thermometer className="w-6 h-6 text-blue-600" />
        </div>
        <div className="space-y-1">
          <div className="text-base font-bold text-slate-800">
            {activeDateFilter !== 'all' ? `Temperature Profile for Date ${activeDateFilter}` : 'Temperature Profile Ready for Reading'}
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {activeDateFilter !== 'all' ? (
              <>No temperature trace readings loaded for date <strong className="text-blue-700 font-mono">{activeDateFilter}</strong> yet. Click below to read and plot the temperature points for this date setting.</>
            ) : (
              <>Select your target <strong>Year</strong>, <strong>Month</strong>, and <strong>Date</strong> in the filters above, then click <strong>"Reading Temperature"</strong> to load and plot the discrete position temperature peaks.</>
            )}
          </p>
        </div>
        {onReadTemperature && (
          <div className="pt-2">
            <button
              id="chart-read-temp-btn"
              type="button"
              onClick={() => onReadTemperature?.()}
              disabled={isReadingTemperature}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-md shadow-blue-500/20 cursor-pointer transition-all"
            >
              <Thermometer className="w-4 h-4" />
              <span>{isReadingTemperature ? 'Reading Temperature...' : (activeDateFilter !== 'all' ? `Read Temperature for ${activeDateFilter}` : 'Reading Temperature for Focus Area')}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // Custom hover tooltip detailing Reading Fiber Optic Temperature (Tf) and Estimated Conductor Temperature (Tc,60287)
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;

      return (
        <div className="bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-xl shadow-2xl text-xs space-y-2.5 border border-slate-700 font-sans min-w-[300px] max-w-[360px]">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-amber-300 font-mono text-sm">
                  {data.location.toFixed(2)} m
                </span>
                {data.pos && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[10px] font-bold">
                    {data.pos}
                  </span>
                )}
              </div>
              {data.sectionName && (
                <div className="text-[11px] text-slate-300 font-medium truncate max-w-[230px] mt-0.5">
                  Sec {data.sectionId}: {data.sectionName} {data.kp ? `(KP ${data.kp})` : ''}
                </div>
              )}
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
              data.sectionType === 'special'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}>
              {data.sectionType === 'special' ? 'Special Hotspot' : (isSubmarine ? 'Subsea Normal' : 'Land Normal')}
            </span>
          </div>

          {/* Fiber Optic Temperature Metrics */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex justify-between items-center text-white font-semibold">
              <span>Reading Fiber Optic Temp ($T_f$):</span>
              <span className="font-mono font-bold text-sky-400 text-xs">
                {data.peakAbsolute.toFixed(2)} °C
              </span>
            </div>

            <div className="flex justify-between items-center text-slate-300 text-[11px]">
              <span>Fiber Changed Temp (Max ΔT):</span>
              <span className="font-mono font-bold text-amber-400">
                {data.peakDelta >= 0 ? `+${data.peakDelta.toFixed(2)}` : data.peakDelta.toFixed(2)} °C (Ref {data.baseline.toFixed(1)}°C)
              </span>
            </div>
          </div>

          {/* Conductor Temperature Calculation (IEC 60287 Method) */}
          <div className="pt-2 border-t border-slate-800 space-y-1.5 bg-slate-950/80 p-2.5 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                Calculated Conductor Temp (IEC 60287)
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                1h Max Power ({data.matchedPowerTime || 'Peak Hour'})
              </span>
            </div>

            <div className="flex justify-between items-center text-rose-300">
              <span>Calculated Value ($T_{'{'}c,60287{'}'}$, IEC Estimation):</span>
              <span className="font-mono font-extrabold text-rose-400 text-xs">
                {Number(data.tc60287 ?? data.peakAbsolute).toFixed(2)} °C
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-300 text-[11px]">
              <span>Conductor Rise Above Fiber ($T_c - T_f$):</span>
              <span className="font-mono font-bold text-emerald-400">
                +{Number(data.tempRiseAboveFiber ?? 0).toFixed(2)} °C
              </span>
            </div>
            <div className="pt-1 border-t border-slate-800/80 text-[10px] text-slate-400 font-mono flex justify-between items-center">
              <span>Max 1h Power $P$ (115kV Ckt#3):</span>
              <strong className="text-white">{Number(data.pCkt3MW ?? 0).toFixed(2)} MW</strong>
            </div>
          </div>

          {/* Timestamp of Peak Event */}
          <div className="pt-1.5 border-t border-slate-800 space-y-0.5 text-[11px]">
            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-1 text-sky-300 font-semibold">
                <Clock className="w-3 h-3" /> Peak Time:
              </span>
              <span className="font-mono font-bold text-white">{data.peakFormattedTime || 'Unknown'}</span>
            </div>
            {data.peakFileName && (
              <div className="text-[10px] text-slate-400 truncate font-mono">
                File: {data.peakFileName}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            <span>Reading Fiber Optic Temperature ($T_f$) & Calculated Conductor Temperature ($T_{'{'}c,60287{'}'}$)</span>
          </div>
          <div className="text-sm font-bold text-slate-900 mt-0.5 flex flex-wrap items-center gap-2">
            <span>
              {isSubmarine ? 'Submarine Cable Route (Zones 2.1–2.13)' : 'Land Cable Route (Sections 1.1–1.6)'} ({effectiveZoomStart.toFixed(2)}m – {effectiveZoomEnd.toFixed(2)}m)
            </span>
            <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              {visibleChartData.length} / {discretePeaks.length} Sampling Points
            </span>
            {isZoomed && (
              <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 font-mono">
                Zoomed {zoomRatio}x ({currentWindowSpan.toFixed(0)}m window)
              </span>
            )}
            {activeDateFilter && activeDateFilter !== 'all' && (
              <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                Page 1 Date: {activeDateFilter}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Plots both the <strong>Reading Fiber Optic Temperature ($T_f$)</strong> read from <code>.TEPR</code> files on Page 1 and the <strong>Calculated Conductor Temperature ($T_{'{'}c,60287{'}'}$)</strong> from IEC Estimation.
          </p>
        </div>

        {/* View Mode Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowConductorEstimation(!showConductorEstimation)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors flex items-center gap-1.5 cursor-pointer ${
              showConductorEstimation
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{showConductorEstimation ? 'Calculated Value (Tc,60287) Shown' : 'Show Calculated Value (Tc,60287)'}</span>
          </button>

          {!isSubmarine && (
            <button
              type="button"
              onClick={() => setShowPhaseComparison(!showPhaseComparison)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors flex items-center gap-1.5 cursor-pointer ${
                showPhaseComparison
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{showPhaseComparison ? '3-Phase Overlaid' : 'Single Curve'}</span>
            </button>
          )}

          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('absolute')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'absolute'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Reading $T_f$ &amp; Calculated $T_{'{'}c,60287{'}'}$ (°C)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('delta')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'delta'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Changed Temp (ΔT)
            </button>
          </div>
        </div>
      </div>

      {/* Requirement 4 & Hourly Filter: Cable Phase and 24-Hour Dropdown */}
      {availablePhases.length > 0 && (
        <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-700 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>Select Cable Phase & Hourly Window</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">
                  {availablePhases.length} Phase{availablePhases.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Filter by cable phase and select an hourly period (24 Hours) to view maximum temperature results.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Segmented Phase Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPhaseFilterChange?.('all')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                  activePhaseFilter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>All Phases</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded ${activePhaseFilter === 'all' ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                  {effectiveParsedFiles.length}
                </span>
              </button>

              {availablePhases.includes('Phase A') && (
                <button
                  type="button"
                  onClick={() => onPhaseFilterChange?.('Phase A')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                    activePhaseFilter === 'Phase A'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                      : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>Phase A (CH 0)</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded ${activePhaseFilter === 'Phase A' ? 'bg-rose-700 text-white' : 'bg-rose-100 text-rose-800'}`}>
                    {phaseCounts['Phase A']}
                  </span>
                </button>
              )}

              {availablePhases.includes('Phase B') && (
                <button
                  type="button"
                  onClick={() => onPhaseFilterChange?.('Phase B')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                    activePhaseFilter === 'Phase B'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Phase B (CH 1)</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded ${activePhaseFilter === 'Phase B' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'}`}>
                    {phaseCounts['Phase B']}
                  </span>
                </button>
              )}

              {availablePhases.includes('Phase C') && (
                <button
                  type="button"
                  onClick={() => onPhaseFilterChange?.('Phase C')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                    activePhaseFilter === 'Phase C'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Phase C (CH 2)</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded ${activePhaseFilter === 'Phase C' ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-800'}`}>
                    {phaseCounts['Phase C']}
                  </span>
                </button>
              )}

              {availablePhases.includes('Submarine Cable') && (
                <button
                  type="button"
                  onClick={() => onPhaseFilterChange?.('Submarine Cable')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                    activePhaseFilter === 'Submarine Cable'
                      ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                      : 'bg-white text-teal-700 border-teal-200 hover:bg-teal-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-teal-500" />
                  <span>Submarine Cable (CH 3)</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded ${activePhaseFilter === 'Submarine Cable' ? 'bg-teal-700 text-white' : 'bg-teal-100 text-teal-800'}`}>
                    {phaseCounts['Submarine Cable']}
                  </span>
                </button>
              )}
            </div>

            {/* Divider */}
            <div className="hidden sm:block h-6 w-[1px] bg-slate-200" />

            {/* 24-Hours Hourly Dropdown List Next to Phase Filter */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-200/90 rounded-lg px-2.5 py-1 shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <div className="flex flex-col">
                <label htmlFor="hourly-filter-select" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
                  Hourly Peak (24h)
                </label>
                <select
                  id="hourly-filter-select"
                  value={currentHourFilter}
                  onChange={(e) => handleHourChange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer py-0.5 pr-1"
                >
                  <option value="all">All 24 Hours (Full Day Max)</option>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const hKey = String(h).padStart(2, '0');
                    const count = hourCounts[hKey] || 0;
                    return (
                      <option key={hKey} value={hKey}>
                        Hour {hKey}:00 - {hKey}:59 ({count} file{count !== 1 ? 's' : ''})
                      </option>
                    );
                  })}
                </select>
              </div>
              {currentHourFilter !== 'all' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  Hour {currentHourFilter} Max
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reading Fiber Optic Temperature (Tf) & Calculated Conductor Temperature (Tc,60287) Summary Ribbon */}
      {overallPeak && (
        <div className="p-3.5 bg-gradient-to-r from-blue-500/10 via-amber-500/10 to-rose-500/10 border border-blue-200/80 rounded-xl space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Thermometer className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
                  <span>{currentHourFilter !== 'all' ? `Hour ${currentHourFilter} Peak:` : (activeDateFilter !== 'all' ? `Date ${activeDateFilter} Peak:` : 'Asset Peak (24h):')}</span>
                  <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-200 font-mono font-extrabold text-xs">
                    Reading Fiber Temp $T_f$ = {overallPeak.maxAbsoluteTemp.toFixed(2)} °C ({overallPeak.maxDeltaTemp >= 0 ? `+${overallPeak.maxDeltaTemp.toFixed(2)}` : overallPeak.maxDeltaTemp.toFixed(2)} °C ΔT)
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-200 font-mono font-extrabold text-xs">
                    Calculated Conductor Temp $T_{'{'}c,60287{'}'}$ = {(conductorPeakStats.maxTc60287 ?? overallPeak.tc60287 ?? overallPeak.maxAbsoluteTemp).toFixed(2)} °C (IEC Estimation)
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">
                  Peak Reading at <strong>{overallPeak.location.toFixed(2)}m</strong> ({overallPeak.tag})
                  {conductorPeakStats.maxTcPoint && (
                    <span className="ml-2 text-rose-700 font-semibold">
                      • Peak Calculated Value at <strong>{conductorPeakStats.maxTcPoint.pos}</strong> ({conductorPeakStats.maxTcPoint.location.toFixed(2)}m, Sec {conductorPeakStats.maxTcPoint.sectionId})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-white/90 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px]">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>Reading Time: <strong className="text-slate-900 font-mono">{overallPeak.peakFormattedDateTime}</strong></span>
            </div>
          </div>

          {/* Side-by-Side Reading Temperature vs Calculated Value Cards for Selected / Active Sampling Point */}
          {activePointMetric && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* Card 1: Reading Fiber Optic Temperature (Tf) */}
              <div className="bg-white/95 border border-sky-200 rounded-xl p-3 flex items-center justify-between gap-3 shadow-2xs">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                    <span>1. Reading Fiber Optic Temperature ($T_f$)</span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    Point <strong>{activePointMetric.pos || `${activePointMetric.location.toFixed(2)}m`}</strong> (DOF {activePointMetric.location.toFixed(2)}m · Sec {activePointMetric.sectionId})
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-base font-extrabold text-blue-700">
                    {activePointMetric.peakAbsolute.toFixed(2)} °C
                  </div>
                  <div className="text-[10px] text-slate-500">
                    ΔT: {activePointMetric.peakDelta >= 0 ? `+${activePointMetric.peakDelta.toFixed(2)}` : activePointMetric.peakDelta.toFixed(2)} °C (Ref {activePointMetric.baseline.toFixed(1)}°C)
                  </div>
                </div>
              </div>

              {/* Card 2: Calculated Conductor Temperature (Tc,60287) */}
              <div className="bg-white/95 border border-rose-200 rounded-xl p-3 flex items-center justify-between gap-3 shadow-2xs">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-600 inline-block" />
                    <span>2. Calculated Conductor Value ($T_{'{'}c,60287{'}'}$)</span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    <strong>IEC Estimation</strong> · Power $P$: <strong>{Number(activePointMetric.pCkt3MW ?? 0).toFixed(2)} MW</strong>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-base font-extrabold text-rose-600">
                    {Number(activePointMetric.tc60287).toFixed(2)} °C
                  </div>
                  <div className="text-[10px] text-emerald-700 font-bold">
                    +{Number(activePointMetric.tempRiseAboveFiber ?? 0).toFixed(2)} °C above $T_f$
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recharts Chart View with Horizontal Scroll Container */}
      <div className="w-full overflow-x-auto custom-scrollbar pb-2">
        <div
          className="h-96 pt-2 transition-all duration-150"
          style={{
            width: canvasZoomFactor > 1 ? `${canvasZoomFactor * 100}%` : '100%',
            minWidth: '100%',
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={visibleChartData}
              margin={{ top: 15, right: 30, left: 10, bottom: 25 }}
              onClick={(e: any) => {
                if (e && e.activePayload && e.activePayload[0]) {
                  const loc = e.activePayload[0].payload.location;
                  onSelectLocation(loc);
                  const fileId = e.activePayload[0].payload.peakFileId;
                  if (fileId) onSelectFile(fileId);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />

              <XAxis
                dataKey="location"
                type="number"
                domain={[effectiveZoomStart, effectiveZoomEnd]}
                allowDataOverflow
                ticks={visibleTicks.length > 0 ? visibleTicks : undefined}
                tickFormatter={(val) => `${Number(val).toFixed(0)}m`}
                stroke="#94a3b8"
                fontSize={10}
                tickLine={{ stroke: '#cbd5e1' }}
                label={{
                  value: `Cable Distance in Optical Fiber DOF (m) [${visibleChartData.length} of ${discretePeaks.length} Designated Sampling Points · ${effectiveZoomStart.toFixed(1)}m – ${effectiveZoomEnd.toFixed(1)}m]`,
                  position: 'insideBottom',
                  offset: -15,
                  fontSize: 11,
                  fill: '#64748b',
                  fontWeight: 600,
                }}
              />

              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickLine={{ stroke: '#cbd5e1' }}
                domain={['auto', 'auto']}
                label={{
                  value: viewMode === 'delta' ? 'Temperature Change ΔT (°C) [Reading & Calculated]' : 'Temperature (°C) [Reading Tf & Calculated Tc,60287]',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 5,
                  fontSize: 11,
                  fill: '#64748b',
                  fontWeight: 600,
                }}
              />

              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', fontWeight: 600 }} />

              {/* 6-Zone Temperature Reference Lines */}
              {viewMode === 'absolute' && (
                <>
                  <ReferenceLine
                    y={70}
                    stroke="#991b1b"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Critical >70°C',
                      position: 'insideTopRight',
                      fill: '#991b1b',
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={60}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Danger 60°C',
                      position: 'insideTopRight',
                      fill: '#ef4444',
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={55}
                    stroke="#f97316"
                    strokeDasharray="3 3"
                    label={{
                      value: 'Alert 55°C',
                      position: 'insideTopRight',
                      fill: '#f97316',
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={45}
                    stroke="#eab308"
                    strokeDasharray="3 3"
                    label={{
                      value: 'Monitoring 45°C',
                      position: 'insideTopRight',
                      fill: '#eab308',
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={35}
                    stroke="#10b981"
                    strokeDasharray="3 3"
                    label={{
                      value: 'Normal 35°C',
                      position: 'insideTopRight',
                      fill: '#10b981',
                      fontSize: 10,
                    }}
                  />
                </>
              )}

              {/* Selected Location Reference Dot */}
              {selectedLocation &&
                selectedLocation >= effectiveZoomStart &&
                selectedLocation <= effectiveZoomEnd && (
                  <ReferenceDot
                    x={selectedLocation}
                    y={
                      chartData.find((d) => Math.abs(d.location - selectedLocation) < 0.01)?.primaryVal || 0
                    }
                    r={7}
                    fill="#3b82f6"
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                )}

              {/* Multi-Phase Comparison Lines for Land Cable */}
              {!isSubmarine && showPhaseComparison ? (
                <>
                  <Line
                    type="monotone"
                    dataKey="phaseA_val"
                    name="Phase A Reading Fiber Temp Tf (CH 0)"
                    stroke="#dc2626"
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: '#dc2626', strokeWidth: 1.5, stroke: '#ffffff' }}
                    activeDot={{ r: 6, fill: '#b91c1c' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="phaseB_val"
                    name="Phase B Reading Fiber Temp Tf (CH 1)"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={{ r: 3.5, fill: '#d97706', strokeWidth: 1.5, stroke: '#ffffff' }}
                    activeDot={{ r: 6, fill: '#b45309' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="phaseC_val"
                    name="Phase C Reading Fiber Temp Tf (CH 2)"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3.5, fill: '#2563eb', strokeWidth: 1.5, stroke: '#ffffff' }}
                    activeDot={{ r: 6, fill: '#1d4ed8' }}
                  />
                </>
              ) : (
                <Line
                  type="monotone"
                  dataKey="primaryVal"
                  name={
                    viewMode === 'delta'
                      ? 'Reading Fiber Optic ΔT (°C)'
                      : `Reading Fiber Optic Temp Tf (${isSubmarine ? 'Submarine CH 3' : activePhaseFilter === 'all' ? 'Peak Phase' : activePhaseFilter})`
                  }
                  stroke={isSubmarine ? '#0284c7' : '#2563eb'}
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: isSubmarine ? '#0284c7' : '#2563eb', strokeWidth: 1.5, stroke: '#ffffff' }}
                  activeDot={{ r: 6, fill: '#1d4ed8' }}
                />
              )}

              {/* Calculated Conductor Temperature Line (Tc,60287) plotted alongside Reading Fiber Optic Temperature */}
              {showConductorEstimation && (
                <Line
                  type="monotone"
                  dataKey="calculatedPlotVal"
                  name={
                    viewMode === 'delta'
                      ? 'Calculated Conductor ΔTc,60287 (IEC Estimation)'
                      : 'Calculated Conductor Temp Tc,60287 (IEC Estimation)'
                  }
                  stroke="#e11d48"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#e11d48', strokeWidth: 1.5, stroke: '#ffffff' }}
                  activeDot={{ r: 7, fill: '#be123c' }}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Horizontal Distance Zoom & Scroll Bar Control Panel */}
      <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600/10 text-blue-700 flex items-center justify-center">
              <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <span>Horizontal Distance Zoom &amp; Scroll Bar</span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                  {effectiveZoomStart.toFixed(1)}m – {effectiveZoomEnd.toFixed(1)}m ({zoomRatio}x)
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Zoom into any interesting distance period (joints, crossings, hotspots) and scroll horizontally along the cable route.
              </p>
            </div>
          </div>

          {/* Quick Zoom Ratio & Canvas Width Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyZoomFactor(Math.min(40, zoomRatio * 1.8))}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 cursor-pointer shadow-2xs"
              title="Zoom in distance window"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Zoom In</span>
            </button>
            <button
              type="button"
              onClick={() => applyZoomFactor(Math.max(1, zoomRatio / 1.8))}
              disabled={!isZoomed}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 border border-slate-200 flex items-center gap-1 cursor-pointer"
              title="Zoom out distance window"
            >
              <ZoomOut className="w-3.5 h-3.5" />
              <span>Zoom Out</span>
            </button>
            {[1, 2, 5, 10, 25].map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => applyZoomFactor(ratio)}
                className={`px-2 py-1 text-[11px] font-mono font-bold rounded-lg border transition-colors cursor-pointer ${
                  Math.abs(zoomRatio - ratio) < 0.4
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {ratio}x
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setZoomStartM(startPos);
                setZoomEndM(endPos);
                setCanvasZoomFactor(1);
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Full</span>
            </button>
          </div>
        </div>

        {/* Interactive Horizontal Scroll Bar Track */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleStepPan('left')}
              disabled={effectiveZoomStart <= startPos + 0.5}
              className="p-1.5 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 text-slate-700 cursor-pointer shrink-0"
              title="Scroll Left along distance"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Visual Scroll Bar Track + Range Slider */}
            <div className="relative flex-1 bg-slate-200/90 h-7 rounded-lg border border-slate-300/80 overflow-hidden flex items-center px-2">
              {/* Highlighted active distance window thumb */}
              <div
                className="absolute top-0.5 bottom-0.5 bg-blue-600/25 border-2 border-blue-600 rounded-md pointer-events-none transition-all duration-75"
                style={{
                  left: `${Math.max(0, Math.min(100, ((effectiveZoomStart - startPos) / totalSpan) * 100))}%`,
                  width: `${Math.max(3, Math.min(100, (currentWindowSpan / totalSpan) * 100))}%`,
                }}
              />
              <input
                type="range"
                min={startPos}
                max={Math.max(startPos + 1, maxPanStart)}
                step={isSubmarine ? 10 : 1}
                value={effectiveZoomStart}
                onChange={(e) => handleHorizontalScrollPosition(parseFloat(e.target.value))}
                disabled={!isZoomed}
                aria-label="Horizontal distance scroll bar"
                className="w-full accent-blue-600 cursor-pointer relative z-10 disabled:opacity-50"
              />
            </div>

            <button
              type="button"
              onClick={() => handleStepPan('right')}
              disabled={effectiveZoomEnd >= endPos - 0.5}
              className="p-1.5 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 text-slate-700 cursor-pointer shrink-0"
              title="Scroll Right along distance"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Fine Start / End Distance Sliders & Numeric Inputs + Wide Scrollable Canvas Option */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-1 items-center text-[11px]">
            <div className="md:col-span-4 flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="font-semibold text-slate-600 whitespace-nowrap">Start (m):</span>
              <input
                type="range"
                min={startPos}
                max={Math.max(startPos, effectiveZoomEnd - 20)}
                step={isSubmarine ? 10 : 1}
                value={effectiveZoomStart}
                onChange={(e) => setZoomStartM(parseFloat(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
              <input
                type="number"
                min={startPos}
                max={effectiveZoomEnd - 10}
                step={10}
                value={Math.round(effectiveZoomStart)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) setZoomStartM(Math.max(startPos, Math.min(val, effectiveZoomEnd - 10)));
                }}
                className="w-20 font-mono font-bold text-blue-700 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-right"
              />
            </div>

            <div className="md:col-span-4 flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="font-semibold text-slate-600 whitespace-nowrap">End (m):</span>
              <input
                type="range"
                min={Math.min(endPos, effectiveZoomStart + 20)}
                max={endPos}
                step={isSubmarine ? 10 : 1}
                value={effectiveZoomEnd}
                onChange={(e) => setZoomEndM(parseFloat(e.target.value))}
                className="w-full accent-rose-600 cursor-pointer"
              />
              <input
                type="number"
                min={effectiveZoomStart + 10}
                max={endPos}
                step={10}
                value={Math.round(effectiveZoomEnd)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) setZoomEndM(Math.min(endPos, Math.max(val, effectiveZoomStart + 10)));
                }}
                className="w-20 font-mono font-bold text-rose-700 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-right"
              />
            </div>

            <div className="md:col-span-4 flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="font-semibold text-slate-600 whitespace-nowrap">Wide Scrollbar:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 4, 6].map((wFactor) => (
                  <button
                    key={wFactor}
                    type="button"
                    onClick={() => setCanvasZoomFactor(wFactor)}
                    className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] cursor-pointer transition-colors ${
                      canvasZoomFactor === wFactor
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {wFactor * 100}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Jump Buttons for Interesting Distance Periods (Hotspots, Subsea Joints, Crossings) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
              Quick Focus Distance Periods:
            </span>
            {distancePresets.map((preset) => {
              const isPresetActive =
                Math.abs(effectiveZoomStart - preset.start) < 15 &&
                Math.abs(effectiveZoomEnd - preset.end) < 15;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setZoomStartM(preset.start);
                    setZoomEndM(preset.end);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                    isPresetActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Discrete Positions Legend / Footnote */}
      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-2 bg-slate-900 text-white px-3 py-1.5 rounded-xl text-[11px]">
            <span className="font-bold text-cyan-400 uppercase tracking-wider">6-Zone Criteria:</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
              <span>Cool &lt;35°C</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#10b981]" />
              <span>Normal 35–45°C</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#eab308]" />
              <span>Monitoring 45–55°C</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#f97316]" />
              <span>Alert 55–60°C</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
              <span>Danger 60–70°C</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#991b1b]" />
              <span>Critical &gt;70°C</span>
            </span>
          </div>

          {!isSubmarine && (
            <div className="flex flex-wrap items-center gap-2.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80">
              <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Land Cable Phase Legend:</span>
              <span className="flex items-center gap-1 text-slate-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626] inline-block" />
                <span>Phase A (CH 0)</span>
              </span>
              <span className="flex items-center gap-1 text-slate-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-[#d97706] inline-block" />
                <span>Phase B (CH 1)</span>
              </span>
              <span className="flex items-center gap-1 text-slate-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563eb] inline-block" />
                <span>Phase C (CH 2)</span>
              </span>
            </div>
          )}
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
            <span><strong>$T_f$:</strong> Reading Temperature from Fiber Optic</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" />
            <span><strong>$T_{'{'}c,60287{'}'}$:</strong> Estimated Conductor Temperature (IEC 60287 Method)</span>
          </span>
        </div>
        <div className="font-mono text-[11px] text-slate-400">
          DOF Range: {startPos.toFixed(2)}m (Start) → {endPos.toFixed(2)}m (End)
        </div>
      </div>
    </div>
  );
};
