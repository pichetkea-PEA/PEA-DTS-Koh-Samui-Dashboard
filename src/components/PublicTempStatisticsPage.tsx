import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Thermometer,
  Flame,
  Calendar,
  CalendarRange,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
  Sparkles,
  Award,
  Layers,
  Filter,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  Database,
  CheckCircle2,
  X,
  Eye,
} from 'lucide-react';
import {
  OrgDatabaseConfig,
  Panel3StatisticsSummary,
  PANEL3_SECTION_PHASE_SLOTS,
  SectionPhaseSlotMeta,
  getPanel3StatisticsSummary,
  ensurePanel3StatisticsSummaryLoaded,
  subscribeToOrgDatabase,
  getPanel3SourceInfo,
} from '../services/orgDatabaseStorage';
import { CABLE_SECTIONS, THERMAL_ZONES_6, ThermalZoneKey } from '../data/cableCircuitStructure';

export type GlobalStatFilterMode =
  | 'year_to_year'
  | 'same_month_across_years'
  | 'monthly_same_year'
  | 'custom_range';

const MONTH_NAMES: Record<string, string> = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
};

interface LocalTempChartFilterState {
  selectedSections: string[]; // '1.1'..'1.6', '2.1'..'2.13'
  selectedLandPhases: Array<'A' | 'B' | 'C'>; // applies to land cable 1.1..1.6
  selectedThresholds: ThermalZoneKey[]; // 6 threshold ranges (light switch style)
}

interface PeriodBucket {
  id: string;
  label: string;
  shortLabel: string;
  dates: string[];
}

interface PublicTempStatisticsPageProps {
  dbConfig: OrgDatabaseConfig;
}

const ALL_SECTION_IDS = CABLE_SECTIONS.map((s) => s.sectionId);
const LAND_SECTION_IDS = CABLE_SECTIONS.filter((s) => s.category === 'land').map((s) => s.sectionId);
const SUBMARINE_SECTION_IDS = CABLE_SECTIONS.filter((s) => s.category === 'submarine').map((s) => s.sectionId);
const SPECIAL_SECTION_IDS = CABLE_SECTIONS.filter((s) => s.sectionType === 'special').map((s) => s.sectionId);
const ALL_THRESHOLD_KEYS: ThermalZoneKey[] = ['cool', 'normal', 'monitoring', 'alert', 'danger', 'critical'];

const IndividualTempBarChartCard: React.FC<{
  chartType: 'tf' | 'tc';
  title: string;
  subtitle: string;
  unitLabel: string;
  statsSummary: Panel3StatisticsSummary | null;
  globalMode: GlobalStatFilterMode;
  periodBuckets: PeriodBucket[];
  activeDates: string[];
  fallbackPrevPeriod: PeriodBucket | null;
  isThreeComparisonMode: boolean;
  initialThresholds: ThermalZoneKey[];
}> = ({
  chartType,
  title,
  subtitle,
  statsSummary,
  globalMode,
  periodBuckets,
  activeDates,
  fallbackPrevPeriod,
  isThreeComparisonMode,
  initialThresholds,
}) => {
  const [localFilter, setLocalFilter] = useState<LocalTempChartFilterState>({
    selectedSections: [...ALL_SECTION_IDS],
    selectedLandPhases: ['A', 'B', 'C'],
    selectedThresholds: initialThresholds,
  });

  const [isSectionDropdownOpen, setIsSectionDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const [showHighestCallout, setShowHighestCallout] = useState<boolean>(true);
  const [isLocalFilterMinimized, setIsLocalFilterMinimized] = useState<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsSectionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter X-axis slots based on local section + phase filters
  const visibleSlots = useMemo<SectionPhaseSlotMeta[]>(() => {
    const secSet = new Set(localFilter.selectedSections);
    const phaseSet = new Set(localFilter.selectedLandPhases);
    return PANEL3_SECTION_PHASE_SLOTS.filter((slot) => {
      if (!secSet.has(slot.sectionId)) return false;
      if (slot.category === 'land') {
        return phaseSet.has(slot.phaseCode as 'A' | 'B' | 'C');
      }
      // Submarine cable needs no A/B/C phase selection
      return true;
    });
  }, [localFilter.selectedSections, localFilter.selectedLandPhases]);

  const activeZoneIndices = useMemo(() => {
    const keySet = new Set(localFilter.selectedThresholds);
    return THERMAL_ZONES_6.map((z, idx) => (keySet.has(z.key) ? idx : -1)).filter((idx) => idx >= 0);
  }, [localFilter.selectedThresholds]);

  // Pre-calculate percentage and hour bar data for each visible slot
  // Each threshold range is normalized to a percentage (%) of all recorded hours across all 6 ranges in that period
  // so 30-day months (720 hrs) and 31-day months (744 hrs) both sum to 100.0%.
  const slotChartData = useMemo(() => {
    if (!statsSummary || !statsSummary.byDate) return [];

    return visibleSlots.map((slot) => {
      const byZoneCounts = [0, 0, 0, 0, 0, 0];
      for (const d of activeDates) {
        const dayEntry = statsSummary.byDate[d];
        if (!dayEntry) continue;
        const arr = chartType === 'tf' ? dayEntry.tf?.[slot.index] : dayEntry.tc?.[slot.index];
        if (!arr) continue;
        for (let z = 0; z < 6; z++) {
          byZoneCounts[z] += arr[z] || 0;
        }
      }

      const totalAllZonesHours =
        byZoneCounts[0] +
        byZoneCounts[1] +
        byZoneCounts[2] +
        byZoneCounts[3] +
        byZoneCounts[4] +
        byZoneCounts[5];

      const byZonePcts = byZoneCounts.map((c) =>
        totalAllZonesHours > 0 ? Number(((c / totalAllZonesHours) * 100).toFixed(2)) : 0
      );

      let selectedTotal = 0;
      let dominantZoneIdx = activeZoneIndices[0] ?? 1;
      let maxZoneCount = -1;
      for (const zIdx of activeZoneIndices) {
        const c = byZoneCounts[zIdx] || 0;
        selectedTotal += c;
        if (c >= maxZoneCount) {
          maxZoneCount = c;
          dominantZoneIdx = zIdx;
        }
      }

      const selectedTotalPct =
        totalAllZonesHours > 0 ? Number(((selectedTotal / totalAllZonesHours) * 100).toFixed(2)) : 0;

      // Fallback previous period calculation (for single-bar comparison mode & first period bar in multi-bar mode)
      const fallbackPrevZones = [0, 0, 0, 0, 0, 0];
      if (fallbackPrevPeriod) {
        for (const d of fallbackPrevPeriod.dates) {
          const dayEntry = statsSummary.byDate[d];
          if (!dayEntry) continue;
          const arr = chartType === 'tf' ? dayEntry.tf?.[slot.index] : dayEntry.tc?.[slot.index];
          if (!arr) continue;
          for (let z = 0; z < 6; z++) {
            fallbackPrevZones[z] += arr[z] || 0;
          }
        }
      }
      const fallbackPrevAllZonesHours =
        fallbackPrevZones[0] +
        fallbackPrevZones[1] +
        fallbackPrevZones[2] +
        fallbackPrevZones[3] +
        fallbackPrevZones[4] +
        fallbackPrevZones[5];
      let fallbackPrevSelectedHours = 0;
      for (const zIdx of activeZoneIndices) {
        fallbackPrevSelectedHours += fallbackPrevZones[zIdx] || 0;
      }
      const hasSingleBarDelta = Boolean(fallbackPrevPeriod && fallbackPrevAllZonesHours > 0);
      const fallbackPrevPct = hasSingleBarDelta
        ? Number(((fallbackPrevSelectedHours / fallbackPrevAllZonesHours) * 100).toFixed(2))
        : 0;
      const singleBarDeltaPct = hasSingleBarDelta
        ? Number((selectedTotalPct - fallbackPrevPct).toFixed(2))
        : 0;

      // Period breakdown for comparison modes (Year-to-Year, Same Month Across Years, Monthly Comparison)
      const rawPeriodCounts = periodBuckets.map((pb) => {
        let count = 0;
        const pbAllZones = [0, 0, 0, 0, 0, 0];
        const pbZones = [0, 0, 0, 0, 0, 0];
        let pbDominantZoneIdx = activeZoneIndices[0] ?? 1;
        let pbMaxZoneCount = -1;
        for (const d of pb.dates) {
          const dayEntry = statsSummary.byDate[d];
          if (!dayEntry) continue;
          const arr = chartType === 'tf' ? dayEntry.tf?.[slot.index] : dayEntry.tc?.[slot.index];
          if (!arr) continue;
          for (let z = 0; z < 6; z++) {
            pbAllZones[z] += arr[z] || 0;
          }
          for (const zIdx of activeZoneIndices) {
            const val = arr[zIdx] || 0;
            count += val;
            pbZones[zIdx] += val;
          }
        }
        const pbTotalAllZonesHours =
          pbAllZones[0] +
          pbAllZones[1] +
          pbAllZones[2] +
          pbAllZones[3] +
          pbAllZones[4] +
          pbAllZones[5];

        const pbZonePcts = pbZones.map((c) =>
          pbTotalAllZonesHours > 0 ? Number(((c / pbTotalAllZonesHours) * 100).toFixed(2)) : 0
        );
        const pct =
          pbTotalAllZonesHours > 0 ? Number(((count / pbTotalAllZonesHours) * 100).toFixed(2)) : 0;

        for (const zIdx of activeZoneIndices) {
          if (pbZones[zIdx] >= pbMaxZoneCount) {
            pbMaxZoneCount = pbZones[zIdx];
            pbDominantZoneIdx = zIdx;
          }
        }
        return {
          periodId: pb.id,
          label: pb.label,
          shortLabel: pb.shortLabel,
          count,
          totalAllZonesHours: pbTotalAllZonesHours,
          pct,
          pbZones,
          pbZonePcts,
          pbDominantZoneIdx,
        };
      });

      const periodCounts = rawPeriodCounts.map((pc, pIdx) => {
        const prevCount = pIdx > 0 ? rawPeriodCounts[pIdx - 1].count : null;
        const prevPct =
          pIdx > 0
            ? rawPeriodCounts[pIdx - 1].pct
            : hasSingleBarDelta
              ? fallbackPrevPct
              : null;
        const deltaFromPrev = prevCount !== null ? pc.count - prevCount : null;
        const deltaPctFromPrev =
          prevPct !== null ? Number((pc.pct - prevPct).toFixed(2)) : 0;
        const hasDelta = pIdx > 0 || hasSingleBarDelta;
        return {
          ...pc,
          deltaFromPrev,
          deltaPctFromPrev,
          hasDelta,
        };
      });

      const maxPeriodCount =
        periodCounts.length > 0 ? Math.max(...periodCounts.map((p) => p.count), 0) : selectedTotal;
      const maxPeriodPct =
        periodCounts.length > 0 ? Math.max(...periodCounts.map((p) => p.pct), 0) : selectedTotalPct;
      const lastPeriodPct = periodCounts.length >= 2 ? periodCounts[periodCounts.length - 1].pct : selectedTotalPct;
      const prevPeriodPct = periodCounts.length >= 2 ? periodCounts[periodCounts.length - 2].pct : fallbackPrevPct;
      const deltaPctVsPrev =
        periodCounts.length >= 2
          ? Number((lastPeriodPct - prevPeriodPct).toFixed(2))
          : singleBarDeltaPct;

      return {
        slot,
        byZoneCounts,
        byZonePcts,
        totalAllZonesHours,
        selectedTotal,
        selectedTotalPct,
        maxPeriodCount,
        maxPeriodPct,
        dominantZoneIdx,
        periodCounts,
        deltaPctVsPrev,
        hasSingleBarDelta,
        singleBarDeltaPct,
      };
    });
  }, [statsSummary, visibleSlots, activeDates, activeZoneIndices, chartType, periodBuckets, fallbackPrevPeriod]);

  const isComparisonMode = isThreeComparisonMode && periodBuckets.length > 1;

  // Identify highest percentage and max Y-axis percentage scale (0% to maxBarPct%)
  const { maxBarPct, highestSlotKeys, totalHitsAcrossChart, totalPossibleHoursAcrossChart } = useMemo(() => {
    let rawMaxPct = 0;
    let grandTotal = 0;
    let grandPossible = 0;
    for (const item of slotChartData) {
      grandTotal += item.selectedTotal;
      grandPossible += item.totalAllZonesHours;
      if (isComparisonMode) {
        for (const pc of item.periodCounts) {
          if (pc.pct > rawMaxPct) {
            rawMaxPct = pc.pct;
          }
        }
      } else {
        if (item.selectedTotalPct > rawMaxPct) {
          rawMaxPct = item.selectedTotalPct;
        }
      }
    }
    const highestKeys = new Set<string>();
    if (rawMaxPct > 0) {
      for (const item of slotChartData) {
        if (isComparisonMode) {
          for (const pc of item.periodCounts) {
            if (pc.pct === rawMaxPct) {
              highestKeys.add(item.slot.key);
            }
          }
        } else if (item.selectedTotalPct === rawMaxPct) {
          highestKeys.add(item.slot.key);
        }
      }
    }
    const yAxisMaxPct =
      rawMaxPct > 80
        ? 100
        : rawMaxPct > 0
          ? Math.min(100, Math.max(10, Math.ceil(rawMaxPct / 10) * 10))
          : 100;
    return {
      maxBarPct: yAxisMaxPct,
      highestSlotKeys: highestKeys,
      totalHitsAcrossChart: grandTotal,
      totalPossibleHoursAcrossChart: grandPossible,
    };
  }, [slotChartData, isComparisonMode]);

  const highestSlotItem = useMemo(() => {
    if (slotChartData.length === 0) return null;
    return slotChartData.find((item) => highestSlotKeys.has(item.slot.key)) || slotChartData[0] || null;
  }, [slotChartData, highestSlotKeys]);

  const inspectedSlotItem = useMemo(() => {
    if (hoveredSlotKey) {
      return slotChartData.find((item) => item.slot.key === hoveredSlotKey) || highestSlotItem;
    }
    return highestSlotItem;
  }, [hoveredSlotKey, slotChartData, highestSlotItem]);

  const toggleSection = (secId: string) => {
    setLocalFilter((prev) => {
      const exists = prev.selectedSections.includes(secId);
      const next = exists
        ? prev.selectedSections.filter((id) => id !== secId)
        : [...prev.selectedSections, secId];
      return {
        ...prev,
        selectedSections: next.length > 0 ? next : [secId],
      };
    });
  };

  const toggleLandPhase = (ph: 'A' | 'B' | 'C') => {
    setLocalFilter((prev) => {
      const exists = prev.selectedLandPhases.includes(ph);
      const next = exists
        ? prev.selectedLandPhases.filter((p) => p !== ph)
        : [...prev.selectedLandPhases, ph];
      return {
        ...prev,
        selectedLandPhases: next.length > 0 ? next : [ph],
      };
    });
  };

  const toggleThresholdSwitch = (zoneKey: ThermalZoneKey) => {
    setLocalFilter((prev) => {
      const exists = prev.selectedThresholds.includes(zoneKey);
      const next = exists
        ? prev.selectedThresholds.filter((k) => k !== zoneKey)
        : [...prev.selectedThresholds, zoneKey];
      return {
        ...prev,
        selectedThresholds: next.length > 0 ? next : [zoneKey],
      };
    });
  };

  const isSingleThresholdSelected = localFilter.selectedThresholds.length === 1;
  const primaryThresholdInfo =
    THERMAL_ZONES_6.find((z) => z.key === localFilter.selectedThresholds[0]) || THERMAL_ZONES_6[1];

  return (
    <div className="rounded-2xl border border-cyan-500/25 bg-[#090f1d]/95 shadow-[0_0_35px_rgba(6,182,212,0.08)] overflow-hidden">
      {/* Top Card Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-slate-800/90 bg-gradient-to-r from-slate-950 via-slate-900/95 to-cyan-950/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-inner ${
              chartType === 'tf'
                ? 'bg-cyan-950/80 border-cyan-500/40 text-cyan-300'
                : 'bg-amber-950/80 border-amber-500/40 text-amber-300'
            }`}
          >
            {chartType === 'tf' ? <Thermometer className="w-5 h-5" /> : <Flame className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-extrabold text-white tracking-wide uppercase">
                {title}
              </h3>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                  chartType === 'tf'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}
              >
                {chartType === 'tf' ? 'HOURLY MAX FIBER (Tf)' : 'HOURLY EST. CONDUCTOR (Tc,60287)'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Summary KPI Badges */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono">
            <span className="text-slate-400 mr-1.5">Active Threshold Share:</span>
            <span className="text-cyan-300 font-bold">
              {totalPossibleHoursAcrossChart > 0
                ? ((totalHitsAcrossChart / totalPossibleHoursAcrossChart) * 100).toFixed(2)
                : '0.00'}
              %
            </span>
            <span className="text-slate-500 ml-1">
              ({totalHitsAcrossChart.toLocaleString()} / {totalPossibleHoursAcrossChart.toLocaleString()} hrs)
            </span>
          </div>
          {highestSlotItem && (
            <div
              className="px-3 py-1.5 rounded-xl border text-xs font-mono flex items-center gap-1.5 shadow-[0_0_15px_rgba(250,204,21,0.2)]"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                borderColor: 'rgba(250, 204, 21, 0.45)',
              }}
            >
              <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-amber-200 font-semibold">Peak Share Section:</span>
              <span className="text-white font-extrabold">
                Sec {highestSlotItem.slot.shortLabel} (
                {isComparisonMode
                  ? `${highestSlotItem.maxPeriodPct.toFixed(1)}% peak / ${highestSlotItem.selectedTotalPct.toFixed(1)}% avg`
                  : `${highestSlotItem.selectedTotalPct.toFixed(1)}%`}
                )
              </span>
            </div>
          )}
        </div>
      </div>

      {/* LOCAL FILTER BAR (Independent per chart: 1. Section Dropdown, 2. Land Phase A/B/C, 3. 6-Range Light Switches) */}
      <div className="px-4 sm:px-6 py-3 bg-slate-950/80 border-b border-slate-800/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-cyan-300">
              Local Chart Filters (Independent to this chart):
            </span>
            {isLocalFilterMinimized && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                <span className="px-2 py-0.5 rounded bg-slate-900 text-cyan-200 border border-slate-700">
                  Sections: {localFilter.selectedSections.length}/{ALL_SECTION_IDS.length}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-900 text-cyan-200 border border-slate-700">
                  Phases: {localFilter.selectedLandPhases.join(', ')}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-900 text-amber-200 border border-slate-700">
                  Thresholds: {localFilter.selectedThresholds.length}/6 ON
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setLocalFilter({
                  selectedSections: [...ALL_SECTION_IDS],
                  selectedLandPhases: ['A', 'B', 'C'],
                  selectedThresholds: [...ALL_THRESHOLD_KEYS],
                })
              }
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[11px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3 h-3 text-cyan-400" />
              <span>Reset Local Filters</span>
            </button>

            <button
              type="button"
              onClick={() => setIsLocalFilterMinimized((prev) => !prev)}
              className="px-2.5 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 border border-cyan-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              title={isLocalFilterMinimized ? 'Expand Local Filters' : 'Minimize Local Filters'}
            >
              {isLocalFilterMinimized ? (
                <>
                  <Maximize2 className="w-3 h-3 text-cyan-300" />
                  <span>Show Filter</span>
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-300" />
                </>
              ) : (
                <>
                  <Minimize2 className="w-3 h-3 text-cyan-300" />
                  <span>Minimize Filter</span>
                  <ChevronUp className="w-3.5 h-3.5 text-cyan-300" />
                </>
              )}
            </button>
          </div>
        </div>

        {!isLocalFilterMinimized && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
          {/* 1. Section Multi-Select Dropdown */}
          <div className="lg:col-span-4 relative" ref={dropdownRef}>
            <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
              1. Section Filter (Multi-Select Land &amp; Submarine):
            </div>
            <button
              type="button"
              onClick={() => setIsSectionDropdownOpen((prev) => !prev)}
              className="w-full px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800/90 border border-slate-700/90 text-xs text-slate-100 flex items-center justify-between gap-2 cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2 truncate">
                <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="font-semibold truncate">
                  {localFilter.selectedSections.length === ALL_SECTION_IDS.length
                    ? 'All 19 Sections Selected (1.1–1.6 & 2.1–2.13)'
                    : `${localFilter.selectedSections.length} of 19 Sections Selected (${localFilter.selectedSections
                        .slice(0, 5)
                        .join(', ')}${localFilter.selectedSections.length > 5 ? '...' : ''})`}
                </span>
              </span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition-transform ${
                  isSectionDropdownOpen ? 'rotate-180 text-cyan-300' : ''
                }`}
              />
            </button>

            {isSectionDropdownOpen && (
              <div className="absolute left-0 right-0 mt-1.5 z-40 rounded-xl bg-slate-950 border border-cyan-500/40 shadow-2xl p-3 space-y-2.5 max-h-80 overflow-y-auto">
                {/* Quick Group Presets */}
                <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-800">
                  <button
                    type="button"
                    onClick={() =>
                      setLocalFilter((prev) => ({ ...prev, selectedSections: [...ALL_SECTION_IDS] }))
                    }
                    className="px-2 py-1 rounded-md bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-500/30 text-[10px] font-mono cursor-pointer"
                  >
                    All 19 Sections
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLocalFilter((prev) => ({ ...prev, selectedSections: [...LAND_SECTION_IDS] }))
                    }
                    className="px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-mono cursor-pointer"
                  >
                    Land Only (1.1–1.6)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLocalFilter((prev) => ({ ...prev, selectedSections: [...SUBMARINE_SECTION_IDS] }))
                    }
                    className="px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-mono cursor-pointer"
                  >
                    Submarine Only (2.1–2.13)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLocalFilter((prev) => ({ ...prev, selectedSections: [...SPECIAL_SECTION_IDS] }))
                    }
                    className="px-2 py-1 rounded-md bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 border border-amber-500/30 text-[10px] font-mono cursor-pointer"
                  >
                    Joints &amp; Hotspots
                  </button>
                </div>

                {/* Individual Section Checkboxes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {CABLE_SECTIONS.map((sec) => {
                    const checked = localFilter.selectedSections.includes(sec.sectionId);
                    return (
                      <button
                        key={sec.sectionId}
                        type="button"
                        onClick={() => toggleSection(sec.sectionId)}
                        className={`px-2.5 py-1.5 rounded-lg text-left text-[11px] flex items-center gap-2 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-cyan-950/50 text-cyan-200 border border-cyan-500/30 font-semibold'
                            : 'text-slate-400 hover:bg-slate-900 border border-transparent'
                        }`}
                      >
                        {checked ? (
                          <CheckSquare className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        )}
                        <span className="font-mono font-bold text-white">{sec.sectionId}</span>
                        <span className="truncate text-slate-300">{sec.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 2. Land Cable Phase Filter (Phase A, B, C; Submarine automatically included) */}
          <div className="lg:col-span-3">
            <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
              2. Land Cable Phase (Submarine Auto):
            </div>
            <div className="flex items-center gap-1.5">
              {(['A', 'B', 'C'] as const).map((ph) => {
                const active = localFilter.selectedLandPhases.includes(ph);
                return (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => toggleLandPhase(ph)}
                    className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      active
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                        : 'bg-slate-900/90 text-slate-500 border-slate-800 hover:text-slate-300'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        active ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]' : 'bg-slate-700'
                      }`}
                    />
                    <span>Phase {ph}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setLocalFilter((prev) => ({
                    ...prev,
                    selectedLandPhases: ['A', 'B', 'C'],
                  }))
                }
                className="py-2 px-2.5 rounded-xl text-[11px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
                title="Select All 3 Land Phases"
              >
                All
              </button>
            </div>
          </div>

          {/* 3. Quick Threshold Switch Presets */}
          <div className="lg:col-span-5">
            <div className="text-[10px] font-mono uppercase text-slate-400 mb-1 flex items-center justify-between">
              <span>3. Threshold Range Quick Presets:</span>
              <span className="text-cyan-400">
                {localFilter.selectedThresholds.length} of 6 Ranges Switched ON
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setLocalFilter((prev) => ({
                    ...prev,
                    selectedThresholds: [...ALL_THRESHOLD_KEYS],
                  }))
                }
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-semibold border cursor-pointer transition-all ${
                  localFilter.selectedThresholds.length === 6
                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                All 6 Ranges
              </button>
              <button
                type="button"
                onClick={() =>
                  setLocalFilter((prev) => ({
                    ...prev,
                    selectedThresholds: ['monitoring', 'alert', 'danger', 'critical'],
                  }))
                }
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-semibold border cursor-pointer transition-all ${
                  localFilter.selectedThresholds.length === 4 &&
                  localFilter.selectedThresholds.includes('monitoring') &&
                  !localFilter.selectedThresholds.includes('normal')
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                Elevated Only (≥ 45°C)
              </button>
              <button
                type="button"
                onClick={() =>
                  setLocalFilter((prev) => ({
                    ...prev,
                    selectedThresholds: ['alert', 'danger', 'critical'],
                  }))
                }
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-semibold border cursor-pointer transition-all ${
                  localFilter.selectedThresholds.length === 3 &&
                  localFilter.selectedThresholds.includes('alert') &&
                  !localFilter.selectedThresholds.includes('monitoring')
                    ? 'bg-orange-500/20 text-orange-200 border-orange-400/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                Alert / Danger / Critical (≥ 55°C)
              </button>
              <button
                type="button"
                onClick={() =>
                  setLocalFilter((prev) => ({
                    ...prev,
                    selectedThresholds: ['critical'],
                  }))
                }
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-semibold border cursor-pointer transition-all ${
                  localFilter.selectedThresholds.length === 1 &&
                  localFilter.selectedThresholds[0] === 'critical'
                    ? 'bg-rose-900/50 text-rose-200 border-rose-500/60'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                Critical Only (&gt; 70°C)
              </button>
            </div>
          </div>
        </div>

        {/* 6 Thermal Threshold Range Light-Switch Buttons */}
        <div className="pt-1">
          <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5">
            Thermal Threshold Range Light Switches (Click to toggle single or multiple threshold ranges):
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {THERMAL_ZONES_6.map((zone) => {
              const isOn = localFilter.selectedThresholds.includes(zone.key);
              return (
                <button
                  key={zone.key}
                  type="button"
                  onClick={() => toggleThresholdSwitch(zone.key)}
                  className={`group relative rounded-xl p-2.5 border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    isOn
                      ? 'bg-slate-900/95 text-white shadow-lg'
                      : 'bg-slate-950/60 text-slate-500 border-slate-800/80 opacity-60 hover:opacity-90'
                  }`}
                  style={
                    isOn
                      ? {
                          borderColor: zone.hexColor,
                          boxShadow: `0 0 16px ${zone.hexColor}33, inset 0 0 12px ${zone.hexColor}18`,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between gap-1.5 w-full">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 transition-transform group-hover:scale-110"
                        style={{
                          backgroundColor: isOn ? zone.hexColor : '#334155',
                          boxShadow: isOn ? `0 0 8px ${zone.hexColor}` : 'none',
                        }}
                      />
                      <span className="text-xs font-extrabold tracking-tight">{zone.shortLabel}</span>
                    </span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                        isOn
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-900 text-slate-500 border border-slate-800'
                      }`}
                    >
                      {isOn ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono">
                    <span style={{ color: isOn ? zone.hexColor : '#64748b' }} className="font-bold">
                      {zone.rangeText}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
          </>
        )}
      </div>

      {/* Movable / Non-Overlay Highest Record & Hovered Section Callout Bar */}
      <div className="px-4 sm:px-6 pt-3.5">
        {showHighestCallout && inspectedSlotItem ? (
          <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/35 via-slate-900/95 to-slate-900/95 p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/50 text-amber-200 text-xs font-mono font-bold">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  {hoveredSlotKey && hoveredSlotKey !== highestSlotItem?.slot.key
                    ? 'INSPECTED SECTION SHARE'
                    : 'DOMINANT SECTION SHARE'}
                </span>
              </div>
              <div className="text-xs font-mono">
                <span className="text-slate-400">Section:</span>{' '}
                <span className="text-white font-extrabold">
                  {inspectedSlotItem.slot.shortLabel} ({inspectedSlotItem.slot.sectionName} ·{' '}
                  {inspectedSlotItem.slot.phaseLabel})
                </span>
              </div>
              <div className="text-xs font-mono">
                <span className="text-slate-400">{isComparisonMode ? 'Peak Period / Share:' : 'Threshold Share:'}</span>{' '}
                <span className="text-amber-300 font-extrabold text-sm">
                  {isComparisonMode
                    ? `${inspectedSlotItem.maxPeriodPct.toFixed(1)}% peak (${inspectedSlotItem.selectedTotalPct.toFixed(1)}% combined · ${inspectedSlotItem.selectedTotal.toLocaleString()} hrs)`
                    : `${inspectedSlotItem.selectedTotalPct.toFixed(1)}% (${inspectedSlotItem.selectedTotal.toLocaleString()} / ${inspectedSlotItem.totalAllZonesHours.toLocaleString()} hrs)`}
                </span>
              </div>
              {isComparisonMode && inspectedSlotItem.periodCounts.length >= 2 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
                  <span className="text-slate-400">Comparison Bars:</span>
                  {inspectedSlotItem.periodCounts.map((pc, pIdx) => (
                    <span
                      key={pc.periodId}
                      className="px-2 py-0.5 rounded bg-slate-950/90 border border-slate-800 text-slate-200 flex items-center gap-1"
                    >
                      <span>{pc.shortLabel}:</span>
                      <strong className="text-cyan-300">{pc.pct.toFixed(1)}%</strong>
                      {(pIdx > 0 || pc.hasDelta) && (
                        <span
                          className={`text-[10px] font-bold ml-0.5 ${
                            pc.deltaPctFromPrev > 0
                              ? 'text-rose-400'
                              : pc.deltaPctFromPrev < 0
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                          }`}
                        >
                          ({pc.deltaPctFromPrev > 0 ? `▲+${pc.deltaPctFromPrev.toFixed(1)}%` : pc.deltaPctFromPrev < 0 ? `▼${pc.deltaPctFromPrev.toFixed(1)}%` : '=0.0%'})
                        </span>
                      )}
                    </span>
                  ))}
                  <span
                    className={`px-2 py-0.5 rounded font-bold flex items-center gap-1 ${
                      inspectedSlotItem.deltaPctVsPrev > 0
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : inspectedSlotItem.deltaPctVsPrev < 0
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {inspectedSlotItem.deltaPctVsPrev > 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : inspectedSlotItem.deltaPctVsPrev < 0 ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : (
                      <Minus className="w-3 h-3" />
                    )}
                    {inspectedSlotItem.deltaPctVsPrev > 0
                      ? `Increase +${inspectedSlotItem.deltaPctVsPrev.toFixed(1)}%`
                      : inspectedSlotItem.deltaPctVsPrev < 0
                        ? `Decrease ${inspectedSlotItem.deltaPctVsPrev.toFixed(1)}%`
                        : 'No Change (0.0%)'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Breakdown pills for active threshold ranges (in %) */}
              <div className="flex flex-wrap items-center gap-1.5">
                {activeZoneIndices.map((zIdx) => {
                  const z = THERMAL_ZONES_6[zIdx];
                  const pctVal = inspectedSlotItem.byZonePcts[zIdx] || 0;
                  const hrsVal = inspectedSlotItem.byZoneCounts[zIdx] || 0;
                  return (
                    <span
                      key={z.key}
                      className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
                      style={{
                        backgroundColor: `${z.hexColor}20`,
                        borderColor: `${z.hexColor}66`,
                        color: '#f8fafc',
                      }}
                    >
                      {z.shortLabel}: {pctVal.toFixed(1)}% ({hrsVal.toLocaleString()}h)
                    </span>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setShowHighestCallout(false)}
                className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700 cursor-pointer"
                title="Close callout card"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          !showHighestCallout && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowHighestCallout(true)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-[11px] font-mono flex items-center gap-1.5 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Show Section Share Callout Card</span>
              </button>
            </div>
          )
        )}
      </div>

      {/* BAR CHART VISUALIZATION CANVAS (PERCENTAGE OF TOTAL RECORDED HOURS 0% – 100%) */}
      <div className="p-4 sm:p-6">
        {slotChartData.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-slate-400 font-mono text-xs border border-dashed border-slate-800 rounded-xl">
            No sections or phases selected. Use the Local Filter above to select sections.
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div
              className="relative min-w-[920px] pt-4 pb-4 px-3 rounded-xl bg-[#060b16] border border-slate-800/90"
              style={{
                minWidth: `${Math.max(
                  920,
                  slotChartData.length *
                    (isComparisonMode ? Math.max(82, periodBuckets.length * 36) : 46) +
                    80
                )}px`,
              }}
            >
              {/* Inside-Chart Legend Bar (Thermal Threshold Ranges, Active Comparison Periods & Trend Indicator Key) */}
              <div className="mb-14 flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800/90 text-[10px] font-mono">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-slate-400 uppercase font-bold">Thresholds (% of Recorded Hours):</span>
                  {activeZoneIndices.map((zIdx) => {
                    const z = THERMAL_ZONES_6[zIdx];
                    return (
                      <span key={z.key} className="inline-flex items-center gap-1.5 text-slate-200 font-semibold">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: z.hexColor }}
                        />
                        <span>
                          {z.shortLabel} ({z.rangeText})
                        </span>
                      </span>
                    );
                  })}

                  {isComparisonMode && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l border-slate-700/80">
                      <span className="text-cyan-300 font-bold uppercase">Periods:</span>
                      {periodBuckets.map((pb, pIdx) => (
                        <span
                          key={pb.id}
                          className="px-1.5 py-0.5 rounded bg-slate-950 border border-cyan-500/30 text-slate-200"
                        >
                          Bar {pIdx + 1}: <strong className="text-cyan-300">{pb.shortLabel}</strong> ({pb.dates.length}d)
                        </span>
                      ))}
                    </div>
                  )}

                  {!isComparisonMode && isThreeComparisonMode && periodBuckets.length === 1 && fallbackPrevPeriod && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l border-slate-700/80">
                      <span className="text-cyan-300 font-bold uppercase">Comparison:</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-cyan-500/30 text-slate-200">
                        <strong className="text-cyan-300">{periodBuckets[0].shortLabel}</strong> vs{' '}
                        <strong className="text-slate-300">{fallbackPrevPeriod.shortLabel}</strong>
                      </span>
                    </div>
                  )}
                </div>

                {isThreeComparisonMode && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-slate-400 font-bold uppercase">
                      Trend Indicator (
                      {globalMode === 'year_to_year'
                        ? 'Year-to-Year'
                        : globalMode === 'same_month_across_years'
                          ? 'Same Month Across Years'
                          : 'Monthly Comparison'}
                      ):
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">
                      ▲ +X.X% Increase
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                      ▼ -X.X% Decrease
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                      = 0.0% No Change
                    </span>
                  </div>
                )}
              </div>

              {/* Unified Section Columns Area: Each Section Column contains BOTH its h-72 Bar Plot Track AND its X-Axis Labels */}
              <div className="relative pl-12 pr-2">
                {/* Horizontal Y-Axis Percentage Reference Grid Lines (0%, 25%, 50%, 75%, 100% of maxBarPct) */}
                <div className="absolute top-0 left-12 right-2 h-72 pointer-events-none z-0">
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const tickPct = (maxBarPct * frac).toFixed(0);
                    return (
                      <div
                        key={frac}
                        className="absolute left-0 right-0 border-t border-dashed border-slate-800/80"
                        style={{ bottom: `${frac * 100}%` }}
                      >
                        <span className="absolute -left-12 -top-2 w-10 text-right text-[10px] font-mono text-slate-400">
                          {tickPct}%
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Unified Flex Row where each Section Column wraps both its h-72 Bar Plot and its X-Axis Label */}
                <div className="relative z-10 flex items-stretch gap-2 sm:gap-2.5 border-l border-slate-700/80">
                  {slotChartData.map((item, idx) => {
                    const prevSlot = idx > 0 ? slotChartData[idx - 1].slot : null;
                    const showCategoryDivider =
                      prevSlot && prevSlot.category === 'land' && item.slot.category === 'submarine';

                    if (isComparisonMode) {
                      return (
                        <React.Fragment key={item.slot.key}>
                          {showCategoryDivider && (
                            <div className="w-0.5 bg-cyan-500/40 mx-1 relative shrink-0">
                              <span className="absolute -top-11 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[9px] font-mono whitespace-nowrap">
                                LAND | SUBMARINE
                              </span>
                            </div>
                          )}

                          <div
                            onMouseEnter={() => setHoveredSlotKey(item.slot.key)}
                            onMouseLeave={() => setHoveredSlotKey(null)}
                            className={`flex-1 flex flex-col cursor-pointer rounded-t-xl transition-colors ${
                              hoveredSlotKey === item.slot.key
                                ? 'bg-cyan-950/25 ring-1 ring-cyan-500/30'
                                : 'hover:bg-slate-900/40'
                            }`}
                            style={{
                              minWidth: `${Math.max(72, item.periodCounts.length * 34)}px`,
                            }}
                          >
                            {/* TOP: h-72 Bar Plot Area for this Section */}
                            <div
                              className="h-72 grid items-end gap-1 sm:gap-1.5 px-1 border-b border-slate-700/80"
                              style={{
                                gridTemplateColumns: `repeat(${Math.max(1, item.periodCounts.length)}, minmax(0, 1fr))`,
                              }}
                            >
                              {item.periodCounts.map((pb, pIdx) => {
                                const barHeightPct =
                                  maxBarPct > 0
                                    ? Math.max(pb.pct > 0 ? 3 : 0, (pb.pct / maxBarPct) * 100)
                                    : 0;
                                const pbDominantZone =
                                  THERMAL_ZONES_6[pb.pbDominantZoneIdx] || primaryThresholdInfo;
                                const barHexColor = isSingleThresholdSelected
                                  ? primaryThresholdInfo.hexColor
                                  : pbDominantZone.hexColor;

                                return (
                                  <div
                                    key={pb.periodId}
                                    className="w-full h-full relative flex items-end justify-center group"
                                  >
                                    <div
                                      className="w-full max-w-[40px] rounded-t-md transition-all duration-300 relative flex flex-col-reverse border-t border-x border-white/15 group-hover:brightness-125"
                                      style={{
                                        height: `${barHeightPct}%`,
                                        backgroundColor:
                                          pb.pct > 0 ? `${barHexColor}33` : 'rgba(30,41,59,0.35)',
                                        boxShadow:
                                          pb.pct > 0
                                            ? `0 0 8px ${barHexColor}44`
                                            : 'none',
                                      }}
                                    >
                                      {/* Trend Indicator directly above Percentage at top of bar */}
                                      <div
                                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex flex-col items-center pointer-events-none"
                                        style={{ zIndex: 20 }}
                                      >
                                        {(pIdx > 0 || pb.hasDelta) && (
                                          <span
                                            className={`mb-0.5 px-1 py-0.2 rounded text-[8px] font-mono font-extrabold leading-tight whitespace-nowrap border ${
                                              pb.deltaPctFromPrev > 0
                                                ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                                                : pb.deltaPctFromPrev < 0
                                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                                  : 'bg-slate-900/90 text-slate-400 border-slate-700/70'
                                            }`}
                                          >
                                            {pb.deltaPctFromPrev > 0
                                              ? `▲+${pb.deltaPctFromPrev.toFixed(1)}%`
                                              : pb.deltaPctFromPrev < 0
                                                ? `▼${pb.deltaPctFromPrev.toFixed(1)}%`
                                                : '=0.0%'}
                                          </span>
                                        )}
                                        <span
                                          className={`text-[9px] font-mono leading-none whitespace-nowrap ${
                                            pb.pct > 0 ? 'text-slate-100 font-bold' : 'text-slate-600'
                                          }`}
                                        >
                                          {pb.pct.toFixed(1)}%
                                        </span>
                                      </div>

                                      {/* Stacked Thermal Threshold Segments inside the Bar (showing % of recorded hours) */}
                                      <div className="w-full h-full rounded-t-md overflow-hidden flex flex-col-reverse">
                                        {activeZoneIndices.map((zIdx) => {
                                          const zCount = pb.pbZones[zIdx] || 0;
                                          const zPct = pb.pbZonePcts[zIdx] || 0;
                                          if (zCount <= 0 || pb.count <= 0) return null;
                                          const segPct = (zCount / pb.count) * 100;
                                          const zInfo = THERMAL_ZONES_6[zIdx];
                                          return (
                                            <div
                                              key={zInfo.key}
                                              style={{
                                                height: `${segPct}%`,
                                                backgroundColor: zInfo.hexColor,
                                              }}
                                              className="w-full min-h-[14px] flex items-center justify-center overflow-hidden border-b border-black/15 last:border-b-0 transition-all"
                                              title={`${zInfo.name} (${zInfo.rangeText}): ${zPct.toFixed(2)}% (${zCount.toLocaleString()} / ${pb.totalAllZonesHours.toLocaleString()} hrs)`}
                                            >
                                              <span className="text-[8px] sm:text-[9px] font-mono font-extrabold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] bg-slate-950/30 px-0.5 py-0.2 rounded leading-none whitespace-nowrap select-none">
                                                {zPct.toFixed(1)}%
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* BOTTOM: X-Axis Period Sub-Labels & Section/Phase Label inside the exact same Section Column */}
                            <div className="pt-1.5 flex flex-col items-center text-center">
                              <div
                                className="w-full grid gap-1 sm:gap-1.5 px-1 pb-1 mb-1 border-b border-slate-800/80"
                                style={{
                                  gridTemplateColumns: `repeat(${Math.max(1, item.periodCounts.length)}, minmax(0, 1fr))`,
                                }}
                              >
                                {item.periodCounts.map((pb) => (
                                  <span
                                    key={pb.periodId}
                                    className="w-full text-center text-[8px] font-mono font-bold text-cyan-200/90 leading-none truncate"
                                    title={pb.label}
                                  >
                                    {pb.shortLabel}
                                  </span>
                                ))}
                              </div>
                              <span
                                className={`text-[10px] font-mono leading-tight ${
                                  item.slot.category === 'land'
                                    ? 'text-cyan-300 font-semibold'
                                    : 'text-emerald-300 font-semibold'
                                }`}
                              >
                                {item.slot.sectionId}
                              </span>
                              <span className="text-[9px] font-mono text-slate-400 leading-tight">
                                {item.slot.category === 'land' ? `(${item.slot.phaseCode})` : 'SM'}
                              </span>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    }

                    // Single-bar mode (Custom Date Range or single period selected)
                    const heightPct =
                      maxBarPct > 0
                        ? Math.max(
                            item.selectedTotalPct > 0 ? 3 : 0,
                            (item.selectedTotalPct / maxBarPct) * 100
                          )
                        : 0;
                    const dominantZone = THERMAL_ZONES_6[item.dominantZoneIdx] || primaryThresholdInfo;
                    const barHexColor = isSingleThresholdSelected
                      ? primaryThresholdInfo.hexColor
                      : dominantZone.hexColor;

                    return (
                      <React.Fragment key={item.slot.key}>
                        {showCategoryDivider && (
                          <div className="w-0.5 bg-cyan-500/40 mx-1 relative shrink-0">
                            <span className="absolute -top-11 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[9px] font-mono whitespace-nowrap">
                              LAND | SUBMARINE
                            </span>
                          </div>
                        )}

                        <div
                          onMouseEnter={() => setHoveredSlotKey(item.slot.key)}
                          onMouseLeave={() => setHoveredSlotKey(null)}
                          className="flex-1 min-w-[34px] flex flex-col cursor-pointer group"
                        >
                          {/* TOP: h-72 Bar Plot Area */}
                          <div className="h-72 w-full relative flex items-end justify-center border-b border-slate-700/80 px-0.5">
                            <div
                              className="w-full max-w-[36px] rounded-t-md transition-all duration-300 relative group-hover:brightness-125"
                              style={{
                                height: `${heightPct}%`,
                                backgroundColor:
                                  item.selectedTotalPct > 0 ? `${barHexColor}33` : 'rgba(30,41,59,0.3)',
                                boxShadow:
                                  item.selectedTotalPct > 0
                                    ? `0 0 10px ${barHexColor}44`
                                    : 'none',
                              }}
                            >
                              {/* Trend Indicator (in 3 Comparison Modes) + Percentage at top of bar */}
                              <div
                                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex flex-col items-center pointer-events-none"
                                style={{ zIndex: 20 }}
                              >
                                {isThreeComparisonMode && (
                                  <span
                                    className={`mb-0.5 px-1 py-0.2 rounded text-[8px] font-mono font-extrabold leading-tight whitespace-nowrap border ${
                                      item.singleBarDeltaPct > 0
                                        ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                                        : item.singleBarDeltaPct < 0
                                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                          : 'bg-slate-900/90 text-slate-400 border-slate-700/70'
                                    }`}
                                  >
                                    {item.singleBarDeltaPct > 0
                                      ? `▲+${item.singleBarDeltaPct.toFixed(1)}%`
                                      : item.singleBarDeltaPct < 0
                                        ? `▼${item.singleBarDeltaPct.toFixed(1)}%`
                                        : '=0.0%'}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] font-mono leading-none whitespace-nowrap ${
                                    item.selectedTotalPct > 0 ? 'text-slate-100 font-bold' : 'text-slate-600'
                                  }`}
                                >
                                  {item.selectedTotalPct.toFixed(1)}%
                                </span>
                              </div>

                              <div className="w-full h-full rounded-t-md overflow-hidden flex flex-col-reverse">
                                {activeZoneIndices.map((zIdx) => {
                                  const zCount = item.byZoneCounts[zIdx] || 0;
                                  const zPct = item.byZonePcts[zIdx] || 0;
                                  if (zCount <= 0 || item.selectedTotal <= 0) return null;
                                  const segPct = (zCount / item.selectedTotal) * 100;
                                  const zInfo = THERMAL_ZONES_6[zIdx];
                                  return (
                                    <div
                                      key={zInfo.key}
                                      style={{
                                        height: `${segPct}%`,
                                        backgroundColor: zInfo.hexColor,
                                      }}
                                      className="w-full min-h-[14px] flex items-center justify-center overflow-hidden border-b border-black/15 last:border-b-0 transition-all"
                                      title={`${zInfo.name} (${zInfo.rangeText}): ${zPct.toFixed(2)}% (${zCount.toLocaleString()} / ${item.totalAllZonesHours.toLocaleString()} hrs)`}
                                    >
                                      <span className="text-[8px] sm:text-[9px] font-mono font-extrabold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] bg-slate-950/30 px-0.5 py-0.2 rounded leading-none whitespace-nowrap select-none">
                                        {zPct.toFixed(1)}%
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* BOTTOM: X-Axis Section & Phase Label */}
                          <div className="pt-1.5 flex flex-col items-center text-center">
                            <span
                              className={`text-[10px] font-mono leading-tight ${
                                item.slot.category === 'land'
                                  ? 'text-cyan-300 font-semibold'
                                  : 'text-emerald-300 font-semibold'
                              }`}
                            >
                              {item.slot.sectionId}
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 leading-tight">
                              {item.slot.category === 'land' ? `(${item.slot.phaseCode})` : 'SM'}
                            </span>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const PublicTempStatisticsPage: React.FC<PublicTempStatisticsPageProps> = ({ dbConfig }) => {
  const [statsSummary, setStatsSummary] = useState<Panel3StatisticsSummary | null>(() =>
    getPanel3StatisticsSummary()
  );
  const [p3Info, setP3Info] = useState(() => getPanel3SourceInfo());

  useEffect(() => {
    let mounted = true;
    ensurePanel3StatisticsSummaryLoaded(false).then((loaded) => {
      if (mounted && loaded) {
        setStatsSummary(loaded);
        setP3Info(getPanel3SourceInfo());
      }
    });
    const unsub = subscribeToOrgDatabase(() => {
      if (!mounted) return;
      setStatsSummary(getPanel3StatisticsSummary());
      setP3Info(getPanel3SourceInfo());
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [dbConfig]);

  const allDates = useMemo(() => {
    return statsSummary?.dates || [];
  }, [statsSummary]);

  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    for (const d of allDates) {
      if (d && d.length >= 4) yrs.add(d.slice(0, 4));
    }
    return Array.from(yrs).sort();
  }, [allDates]);

  const availableMonths = useMemo(() => {
    const mos = new Set<string>();
    for (const d of allDates) {
      if (d && d.length >= 7) mos.add(d.slice(5, 7));
    }
    return Array.from(mos).sort();
  }, [allDates]);

  // Global Filter State (Affects BOTH Chart 1 & Chart 2)
  const [globalMode, setGlobalMode] = useState<GlobalStatFilterMode>('year_to_year');
  const [isGlobalFilterMinimized, setIsGlobalFilterMinimized] = useState<boolean>(false);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedMonthAcrossYears, setSelectedMonthAcrossYears] = useState<string>('09');
  const [selectedSingleYearForMonths, setSelectedSingleYearForMonths] = useState<string>('2026');
  const [selectedMonthsInYear, setSelectedMonthsInYear] = useState<string[]>([]);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Initialize filter defaults once dates are available
  useEffect(() => {
    if (availableYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears([...availableYears]);
      setSelectedSingleYearForMonths(availableYears[availableYears.length - 1]);
    }
    if (allDates.length > 0 && (!customStartDate || !customEndDate)) {
      setCustomStartDate(allDates[0]);
      setCustomEndDate(allDates[allDates.length - 1]);
    }
  }, [availableYears, allDates]);

  const monthsForSelectedYear = useMemo(() => {
    const mos = new Set<string>();
    for (const d of allDates) {
      if (d.startsWith(`${selectedSingleYearForMonths}-`)) {
        mos.add(d.slice(5, 7));
      }
    }
    return Array.from(mos).sort();
  }, [allDates, selectedSingleYearForMonths]);

  useEffect(() => {
    if (monthsForSelectedYear.length > 0) {
      setSelectedMonthsInYear([...monthsForSelectedYear]);
    }
  }, [selectedSingleYearForMonths, monthsForSelectedYear]);

  // Compute activeDates and periodBuckets from the Global Filter
  const { activeDates, periodBuckets } = useMemo(() => {
    if (allDates.length === 0) {
      return { activeDates: [] as string[], periodBuckets: [] as PeriodBucket[] };
    }

    if (globalMode === 'year_to_year') {
      const yrSet = new Set(selectedYears.length > 0 ? selectedYears : availableYears);
      const filtered = allDates.filter((d) => yrSet.has(d.slice(0, 4)));
      const buckets: PeriodBucket[] = Array.from(yrSet)
        .sort()
        .map((yr) => ({
          id: yr,
          label: `Year ${yr}`,
          shortLabel: yr,
          dates: filtered.filter((d) => d.startsWith(`${yr}-`)),
        }));
      return { activeDates: filtered, periodBuckets: buckets };
    }

    if (globalMode === 'same_month_across_years') {
      const yrSet = new Set(selectedYears.length > 0 ? selectedYears : availableYears);
      const mo = selectedMonthAcrossYears || '09';
      const filtered = allDates.filter((d) => yrSet.has(d.slice(0, 4)) && d.slice(5, 7) === mo);
      const buckets: PeriodBucket[] = Array.from(yrSet)
        .sort()
        .map((yr) => ({
          id: `${yr}-${mo}`,
          label: `${MONTH_NAMES[mo] || mo} ${yr}`,
          shortLabel: `${MONTH_NAMES[mo] || mo} '${yr.slice(2)}`,
          dates: filtered.filter((d) => d.startsWith(`${yr}-${mo}`)),
        }))
        .filter((b) => b.dates.length > 0);
      return { activeDates: filtered, periodBuckets: buckets };
    }

    if (globalMode === 'monthly_same_year') {
      const yr = selectedSingleYearForMonths || availableYears[availableYears.length - 1] || '2026';
      const moSet = new Set(selectedMonthsInYear.length > 0 ? selectedMonthsInYear : monthsForSelectedYear);
      const filtered = allDates.filter((d) => d.startsWith(`${yr}-`) && moSet.has(d.slice(5, 7)));
      const buckets: PeriodBucket[] = Array.from(moSet)
        .sort()
        .map((mo) => ({
          id: `${yr}-${mo}`,
          label: `${MONTH_NAMES[mo] || mo} ${yr}`,
          shortLabel: `${MONTH_NAMES[mo] || mo}`,
          dates: filtered.filter((d) => d.startsWith(`${yr}-${mo}`)),
        }))
        .filter((b) => b.dates.length > 0);
      return { activeDates: filtered, periodBuckets: buckets };
    }

    // custom_range
    const start = customStartDate || allDates[0];
    const end = customEndDate || allDates[allDates.length - 1];
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    const filtered = allDates.filter((d) => d >= lo && d <= hi);
    return {
      activeDates: filtered,
      periodBuckets: [
        {
          id: 'custom',
          label: `${lo} to ${hi}`,
          shortLabel: 'Custom Range',
          dates: filtered,
        },
      ],
    };
  }, [
    allDates,
    globalMode,
    selectedYears,
    availableYears,
    selectedMonthAcrossYears,
    selectedSingleYearForMonths,
    selectedMonthsInYear,
    monthsForSelectedYear,
    customStartDate,
    customEndDate,
  ]);

  const isThreeComparisonMode =
    globalMode === 'year_to_year' ||
    globalMode === 'same_month_across_years' ||
    globalMode === 'monthly_same_year';

  // Resolve the immediately preceding reference period before periodBuckets[0] from allDates
  // so that in all 3 comparison modes (whether 1 period or multiple periods are selected),
  // every bar has a reference comparison period for the trend indicator above the percentage.
  const fallbackPrevPeriod = useMemo<PeriodBucket | null>(() => {
    if (!isThreeComparisonMode || periodBuckets.length === 0 || allDates.length === 0) {
      return null;
    }
    const targetBucket = periodBuckets[0];
    const allYearMonths = Array.from(
      new Set(allDates.filter((d) => d && d.length >= 7).map((d) => d.slice(0, 7)))
    ).sort();

    if (globalMode === 'year_to_year') {
      const yrIdx = availableYears.indexOf(targetBucket.id);
      if (yrIdx > 0) {
        const prevYr = availableYears[yrIdx - 1];
        const dates = allDates.filter((d) => d.startsWith(`${prevYr}-`));
        if (dates.length > 0) {
          return { id: prevYr, label: `Year ${prevYr}`, shortLabel: prevYr, dates };
        }
      }
      return null;
    }

    if (globalMode === 'same_month_across_years') {
      const mo = selectedMonthAcrossYears || targetBucket.id.slice(5, 7);
      const targetYr = targetBucket.id.slice(0, 4);
      const yearsWithMonth = availableYears.filter((yr) =>
        allDates.some((d) => d.startsWith(`${yr}-${mo}`))
      );
      const yrIdx = yearsWithMonth.indexOf(targetYr);
      if (yrIdx > 0) {
        const prevYr = yearsWithMonth[yrIdx - 1];
        const dates = allDates.filter((d) => d.startsWith(`${prevYr}-${mo}`));
        if (dates.length > 0) {
          return {
            id: `${prevYr}-${mo}`,
            label: `${MONTH_NAMES[mo] || mo} ${prevYr}`,
            shortLabel: `${MONTH_NAMES[mo] || mo} '${prevYr.slice(2)}`,
            dates,
          };
        }
      }
      const ymIdx = allYearMonths.indexOf(targetBucket.id);
      if (ymIdx > 0) {
        const prevYm = allYearMonths[ymIdx - 1];
        const prevMo = prevYm.slice(5, 7);
        const prevYr = prevYm.slice(0, 4);
        const dates = allDates.filter((d) => d.startsWith(prevYm));
        if (dates.length > 0) {
          return {
            id: prevYm,
            label: `${MONTH_NAMES[prevMo] || prevMo} ${prevYr}`,
            shortLabel: `${MONTH_NAMES[prevMo] || prevMo} '${prevYr.slice(2)}`,
            dates,
          };
        }
      }
      return null;
    }

    if (globalMode === 'monthly_same_year') {
      const ymIdx = allYearMonths.indexOf(targetBucket.id);
      if (ymIdx > 0) {
        const prevYm = allYearMonths[ymIdx - 1];
        const prevMo = prevYm.slice(5, 7);
        const prevYr = prevYm.slice(0, 4);
        const dates = allDates.filter((d) => d.startsWith(prevYm));
        if (dates.length > 0) {
          return {
            id: prevYm,
            label: `${MONTH_NAMES[prevMo] || prevMo} ${prevYr}`,
            shortLabel: `${MONTH_NAMES[prevMo] || prevMo} '${prevYr.slice(2)}`,
            dates,
          };
        }
      }
      return null;
    }

    return null;
  }, [
    isThreeComparisonMode,
    periodBuckets,
    allDates,
    globalMode,
    availableYears,
    selectedMonthAcrossYears,
  ]);

  const toggleGlobalYear = (yr: string) => {
    setSelectedYears((prev) => {
      const exists = prev.includes(yr);
      const next = exists ? prev.filter((y) => y !== yr) : [...prev, yr].sort();
      return next.length > 0 ? next : [yr];
    });
  };

  const toggleMonthInYear = (mo: string) => {
    setSelectedMonthsInYear((prev) => {
      const exists = prev.includes(mo);
      const next = exists ? prev.filter((m) => m !== mo) : [...prev, mo].sort();
      return next.length > 0 ? next : [mo];
    });
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Page 2.5 Header Banner */}
      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/40 p-4 sm:p-5 shadow-[0_0_30px_rgba(6,182,212,0.1)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-[0_0_18px_rgba(6,182,212,0.3)]">
            <Thermometer className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono font-bold">
                PUBLIC DASHBOARD 2.5
              </span>
              <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight uppercase">
                Statistics Records of Temperature (6 Thermal Threshold Ranges)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Hourly peak Fiber Temperature (<span className="text-cyan-300 font-mono">Tf</span>) &amp; IEC 60287
              Estimated Conductor Temperature (<span className="text-amber-300 font-mono">Tc</span>) percentage share (%)
              from Section Daily Profile Database (Sector 2.3 Panel 3)
            </p>
          </div>
        </div>

        {/* Source Database Badge */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/90 border border-emerald-500/30 text-xs font-mono">
          <Database className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <div className="text-[10px] text-emerald-300 font-bold uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Backdoor Pre-Calculated Feed Active</span>
            </div>
            <div className="text-[11px] text-slate-300 truncate max-w-[320px]">
              {p3Info?.name || 'DTS_Section_Daily_Profile_19Sheets.xlsx'} ({allDates.length} Dates)
            </div>
          </div>
        </div>
      </div>

      {/* GLOBAL FILTER BAR (Affects BOTH Charts on Page 2.5) */}
      <div className="rounded-2xl border border-cyan-500/25 bg-slate-950/90 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-cyan-300">
              Global Comparison Filter (Synchronized Across Both Temperature Charts):
            </span>
            {isGlobalFilterMinimized && (
              <span className="px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-200 border border-cyan-500/30 text-[10px] font-mono font-bold">
                Mode:{' '}
                {globalMode === 'year_to_year'
                  ? 'Year-to-Year'
                  : globalMode === 'same_month_across_years'
                    ? 'Same Month Across Years'
                    : globalMode === 'monthly_same_year'
                      ? 'Monthly Comparison (Same Year)'
                      : 'Custom Date Range'}{' '}
                ({periodBuckets.map((b) => b.shortLabel).join(', ')})
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs font-mono text-slate-400">
              Active Window:{' '}
              <span className="text-white font-bold">{activeDates.length.toLocaleString()}</span> Days (
              <span className="text-cyan-300 font-bold">{(activeDates.length * 24).toLocaleString()}</span> Hourly
              Intervals/Section · Normalized to 100%)
            </div>
            <button
              type="button"
              onClick={() => setIsGlobalFilterMinimized((prev) => !prev)}
              className="px-2.5 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 border border-cyan-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              title={isGlobalFilterMinimized ? 'Expand Global Filter' : 'Minimize Global Filter'}
            >
              {isGlobalFilterMinimized ? (
                <>
                  <Maximize2 className="w-3 h-3 text-cyan-300" />
                  <span>Show Global Filter</span>
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-300" />
                </>
              ) : (
                <>
                  <Minimize2 className="w-3 h-3 text-cyan-300" />
                  <span>Minimize Global Filter</span>
                  <ChevronUp className="w-3.5 h-3.5 text-cyan-300" />
                </>
              )}
            </button>
          </div>
        </div>

        {!isGlobalFilterMinimized && (
          <>
            {/* 4 Global Filter Mode Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            {
              id: 'year_to_year' as GlobalStatFilterMode,
              title: 'Year-to-Year',
              subtitle: 'Compare thermal % share across years',
            },
            {
              id: 'same_month_across_years' as GlobalStatFilterMode,
              title: 'Same Month Across Years',
              subtitle: 'Compare a target month % across years',
            },
            {
              id: 'monthly_same_year' as GlobalStatFilterMode,
              title: 'Monthly Comparison (Same Year)',
              subtitle: 'Compare normalized monthly % (30d vs 31d)',
            },
            {
              id: 'custom_range' as GlobalStatFilterMode,
              title: 'Custom Date Range',
              subtitle: 'Specific Start Date to End Date window',
            },
          ].map((btn) => {
            const active = globalMode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => setGlobalMode(btn.id)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-cyan-950/70 border-cyan-400 text-white shadow-[0_0_18px_rgba(6,182,212,0.22)]'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wide">{btn.title}</span>
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      active ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-slate-700'
                    }`}
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">{btn.subtitle}</p>
              </button>
            );
          })}
        </div>

        {/* Contextual Sub-Controls for the Selected Global Filter Mode */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
          {globalMode === 'year_to_year' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-slate-400 mr-1">Select Years:</span>
              {availableYears.map((yr) => {
                const active = selectedYears.includes(yr);
                return (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => toggleGlobalYear(yr)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold border cursor-pointer transition-all ${
                      active
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                        : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                    }`}
                  >
                    Year {yr}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedYears([...availableYears])}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
              >
                All Years
              </button>
            </div>
          )}

          {globalMode === 'same_month_across_years' && (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-mono text-slate-400 mr-1">Target Month:</span>
                {availableMonths.map((mo) => {
                  const active = selectedMonthAcrossYears === mo;
                  return (
                    <button
                      key={mo}
                      type="button"
                      onClick={() => setSelectedMonthAcrossYears(mo)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border cursor-pointer transition-all ${
                        active
                          ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {mo} ({MONTH_NAMES[mo]})
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-mono text-slate-400 mr-1">Years:</span>
                {availableYears.map((yr) => {
                  const active = selectedYears.includes(yr);
                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => toggleGlobalYear(yr)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                        active
                          ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {yr}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {globalMode === 'monthly_same_year' && (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-slate-400">Select Year:</span>
                {availableYears.map((yr) => {
                  const active = selectedSingleYearForMonths === yr;
                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => setSelectedSingleYearForMonths(yr)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                        active
                          ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      {yr}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-mono text-slate-400">Months in {selectedSingleYearForMonths}:</span>
                {monthsForSelectedYear.map((mo) => {
                  const active = selectedMonthsInYear.includes(mo);
                  return (
                    <button
                      key={mo}
                      type="button"
                      onClick={() => toggleMonthInYear(mo)}
                      className={`px-2 py-1 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                        active
                          ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {MONTH_NAMES[mo] || mo}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSelectedMonthsInYear([...monthsForSelectedYear])}
                  className="px-2 py-1 rounded-lg text-[11px] font-mono bg-slate-900 text-slate-300 border border-slate-700 cursor-pointer"
                >
                  All Months
                </button>
              </div>
            </div>
          )}

          {globalMode === 'custom_range' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-mono text-slate-300">Start Date:</span>
                <input
                  type="date"
                  value={customStartDate}
                  min={allDates[0] || ''}
                  max={customEndDate || allDates[allDates.length - 1] || ''}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                />
              </div>
              <span className="text-slate-500 font-mono">to</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-300">End Date:</span>
                <input
                  type="date"
                  value={customEndDate}
                  min={customStartDate || allDates[0] || ''}
                  max={allDates[allDates.length - 1] || ''}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (allDates.length > 0) {
                    setCustomStartDate(allDates[0]);
                    setCustomEndDate(allDates[allDates.length - 1]);
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 text-xs font-mono cursor-pointer"
              >
                Full Dataset Range
              </button>
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {/* CHART 1: FIBER TEMPERATURE (Tf) STATISTICS BAR CHART */}
      <IndividualTempBarChartCard
        chartType="tf"
        title="Chart 1: Hourly Peak Fiber Optic Temperature (Tf) — Threshold Range Percentage (%)"
        subtitle="Percentage (%) of all recorded hours where hourly peak fiber optic temperature (Tf) falls into each thermal threshold range across Land (Phase A, B, C) & Submarine sections"
        unitLabel="%"
        statsSummary={statsSummary}
        globalMode={globalMode}
        periodBuckets={periodBuckets}
        activeDates={activeDates}
        fallbackPrevPeriod={fallbackPrevPeriod}
        isThreeComparisonMode={isThreeComparisonMode}
        initialThresholds={['monitoring', 'alert', 'danger', 'critical']}
      />

      {/* CHART 2: ESTIMATED CONDUCTOR TEMPERATURE (Tc) STATISTICS BAR CHART */}
      <IndividualTempBarChartCard
        chartType="tc"
        title="Chart 2: Hourly Estimated Conductor Temperature (Tc,60287) — Threshold Range Percentage (%)"
        subtitle="Percentage (%) of all recorded hours where hourly IEC 60287 estimated conductor temperature (Tc) falls into each thermal threshold range across Land (Phase A, B, C) & Submarine sections"
        unitLabel="%"
        statsSummary={statsSummary}
        globalMode={globalMode}
        periodBuckets={periodBuckets}
        activeDates={activeDates}
        fallbackPrevPeriod={fallbackPrevPeriod}
        isThreeComparisonMode={isThreeComparisonMode}
        initialThresholds={['monitoring', 'alert', 'danger', 'critical']}
      />
    </div>
  );
};
