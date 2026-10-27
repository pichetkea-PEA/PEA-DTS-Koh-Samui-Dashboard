import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  Calendar,
  CalendarRange,
  Award,
  Sparkles,
  Filter,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  Database,
  CheckCircle2,
  ShieldAlert,
  Info,
  X,
  Eye,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import {
  OrgDatabaseConfig,
  Panel3StatisticsSummary,
  POWER_CIRCUITS_META,
  POWER_OPERATING_RANGES_4,
  PowerCircuitKey,
  PowerOperateConditionKey,
  getPanel3StatisticsSummary,
  ensurePanel3StatisticsSummaryLoaded,
  subscribeToOrgDatabase,
  getPanel3SourceInfo,
} from '../services/orgDatabaseStorage';
import { GlobalStatFilterMode } from './PublicTempStatisticsPage';

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

interface PeriodBucket {
  id: string;
  label: string;
  shortLabel: string;
  dates: string[];
}

interface PublicPowerStatisticsPageProps {
  dbConfig: OrgDatabaseConfig;
}

const ALL_CIRCUIT_KEYS: PowerCircuitKey[] = ['ckt3', 'ckt2', 'nkt33', 'oil33'];
const ALL_RANGE_KEYS: PowerOperateConditionKey[] = ['normal', 'emergency', 'critical', 'overload'];

export const PublicPowerStatisticsPage: React.FC<PublicPowerStatisticsPageProps> = ({ dbConfig }) => {
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

  const allDates = useMemo(() => statsSummary?.dates || [], [statsSummary]);

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

  // Global Filter State (4 Mode Buttons)
  const [globalMode, setGlobalMode] = useState<GlobalStatFilterMode>('year_to_year');
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedMonthAcrossYears, setSelectedMonthAcrossYears] = useState<string>('09');
  const [selectedSingleYearForMonths, setSelectedSingleYearForMonths] = useState<string>('2026');
  const [selectedMonthsInYear, setSelectedMonthsInYear] = useState<string[]>([]);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Local Built-in Chart Filters (4 filters for each circuit + operating range toggles + record basis)
  const [selectedCircuits, setSelectedCircuits] = useState<PowerCircuitKey[]>([...ALL_CIRCUIT_KEYS]);
  const [selectedOperateRanges, setSelectedOperateRanges] = useState<PowerOperateConditionKey[]>([
    ...ALL_RANGE_KEYS,
  ]);
  const [countingBasis, setCountingBasis] = useState<'all_records' | 'unique_hours'>('all_records');
  const [showCriteriaTable, setShowCriteriaTable] = useState<boolean>(true);
  const [showHighestCallout, setShowHighestCallout] = useState<boolean>(true);
  const [hoveredBarId, setHoveredBarId] = useState<string | null>(null);
  const [isGlobalFilterMinimized, setIsGlobalFilterMinimized] = useState<boolean>(false);
  const [isLocalFilterMinimized, setIsLocalFilterMinimized] = useState<boolean>(false);

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
        }))
        .filter((b) => b.dates.length > 0);
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
          shortLabel: 'Selected Range',
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

  const isComparisonMode =
    globalMode !== 'custom_range' && periodBuckets.length > 1;

  // Build data for each visible circuit and each visible operating range
  const visibleCircuitsMeta = useMemo(() => {
    const cSet = new Set(selectedCircuits);
    return POWER_CIRCUITS_META.filter((c) => cSet.has(c.key));
  }, [selectedCircuits]);

  const visibleRangesMeta = useMemo(() => {
    const rSet = new Set(selectedOperateRanges);
    return POWER_OPERATING_RANGES_4.filter((r) => rSet.has(r.key));
  }, [selectedOperateRanges]);

  const circuitChartGroups = useMemo(() => {
    if (!statsSummary || !statsSummary.byDate) return [];

    return visibleCircuitsMeta.map((circuit) => {
      const rangeItems = visibleRangesMeta.map((range) => {
        // Total across all active dates
        let totalCount = 0;
        for (const d of activeDates) {
          const dayEntry = statsSummary.byDate[d];
          if (!dayEntry) continue;
          const matrix = countingBasis === 'all_records' ? dayEntry.pwrAll : dayEntry.pwrHr;
          totalCount += matrix?.[circuit.index]?.[range.index] || 0;
        }

        // Breakdown per period bucket (for comparison bars standing next to each other)
        const periodBars = periodBuckets.map((pb, pIdx) => {
          let pCount = 0;
          for (const d of pb.dates) {
            const dayEntry = statsSummary.byDate[d];
            if (!dayEntry) continue;
            const matrix = countingBasis === 'all_records' ? dayEntry.pwrAll : dayEntry.pwrHr;
            pCount += matrix?.[circuit.index]?.[range.index] || 0;
          }
          return {
            barId: `${circuit.key}_${range.key}_${pb.id}`,
            periodId: pb.id,
            periodLabel: pb.label,
            periodShortLabel: pb.shortLabel,
            periodIndex: pIdx,
            count: pCount,
            deltaFromPrev: 0,
            pctFromPrev: 0,
          };
        });

        for (let i = 1; i < periodBars.length; i++) {
          const prev = periodBars[i - 1].count;
          const curr = periodBars[i].count;
          periodBars[i].deltaFromPrev = curr - prev;
          periodBars[i].pctFromPrev = prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;
        }

        const netDelta =
          periodBars.length >= 2
            ? periodBars[periodBars.length - 1].count - periodBars[periodBars.length - 2].count
            : 0;

        return {
          circuit,
          range,
          groupId: `${circuit.key}_${range.key}`,
          mwCriteriaText: circuit.rangeLabels[range.key],
          totalCount,
          periodBars,
          netDelta,
        };
      });

      return {
        circuit,
        rangeItems,
      };
    });
  }, [statsSummary, visibleCircuitsMeta, visibleRangesMeta, activeDates, periodBuckets, countingBasis]);

  // Identify highest value bar across the entire chart for glowing highlight
  const { maxBarValue, highestBarIds, highestBarDetail } = useMemo(() => {
    let maxVal = 0;
    for (const cg of circuitChartGroups) {
      for (const ri of cg.rangeItems) {
        if (isComparisonMode) {
          for (const pb of ri.periodBars) {
            if (pb.count > maxVal) maxVal = pb.count;
          }
        } else {
          if (ri.totalCount > maxVal) maxVal = ri.totalCount;
        }
      }
    }

    const ids = new Set<string>();
    let firstHighest: {
      barId: string;
      circuitLabel: string;
      substation: string;
      rangeLabel: string;
      rangeColor: string;
      mwCriteria: string;
      periodLabel: string;
      count: number;
      delta: number;
    } | null = null;

    if (maxVal > 0) {
      for (const cg of circuitChartGroups) {
        for (const ri of cg.rangeItems) {
          if (isComparisonMode) {
            for (const pb of ri.periodBars) {
              if (pb.count === maxVal) {
                ids.add(pb.barId);
                if (!firstHighest) {
                  firstHighest = {
                    barId: pb.barId,
                    circuitLabel: cg.circuit.label,
                    substation: cg.circuit.substation,
                    rangeLabel: ri.range.label,
                    rangeColor: ri.range.hexColor,
                    mwCriteria: ri.mwCriteriaText,
                    periodLabel: pb.periodLabel,
                    count: pb.count,
                    delta: pb.deltaFromPrev,
                  };
                }
              }
            }
          } else {
            if (ri.totalCount === maxVal) {
              ids.add(ri.groupId);
              if (!firstHighest) {
                firstHighest = {
                  barId: ri.groupId,
                  circuitLabel: cg.circuit.label,
                  substation: cg.circuit.substation,
                  rangeLabel: ri.range.label,
                  rangeColor: ri.range.hexColor,
                  mwCriteria: ri.mwCriteriaText,
                  periodLabel: periodBuckets[0]?.label || 'Selected Range',
                  count: ri.totalCount,
                  delta: ri.netDelta,
                };
              }
            }
          }
        }
      }
    }

    return {
      maxBarValue: maxVal,
      highestBarIds: ids,
      highestBarDetail: firstHighest,
    };
  }, [circuitChartGroups, isComparisonMode, periodBuckets]);

  const toggleCircuitFilter = (cKey: PowerCircuitKey) => {
    setSelectedCircuits((prev) => {
      const exists = prev.includes(cKey);
      const next = exists ? prev.filter((k) => k !== cKey) : [...prev, cKey];
      return next.length > 0 ? next : [cKey];
    });
  };

  const toggleOperateRange = (rKey: PowerOperateConditionKey) => {
    setSelectedOperateRanges((prev) => {
      const exists = prev.includes(rKey);
      const next = exists ? prev.filter((k) => k !== rKey) : [...prev, rKey];
      return next.length > 0 ? next : [rKey];
    });
  };

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
      {/* Page 2.6 Header Banner */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/35 p-4 sm:p-5 shadow-[0_0_30px_rgba(245,158,11,0.1)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.3)]">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold">
                PUBLIC DASHBOARD 2.6
              </span>
              <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight uppercase">
                Statistics Records of Power Consumption (4 Submarine Circuits × 4 Operating Ranges)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Hourly power flow counter during fiber optic temperature recording from Section Daily Profile Database
              (Sector 2.3 Panel 3) categorized into Normal, Emergency, Critical &amp; Overload conditions
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

      {/* 4 OPERATING CONDITION CRITERIA REFERENCE MATRIX (Collapsible) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/90 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-slate-200">
              4-Circuit Power Operating Condition Range Criteria (MW Thresholds &amp; Bar Color Key)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowCriteriaTable((prev) => !prev)}
            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-[11px] font-mono cursor-pointer"
          >
            {showCriteriaTable ? 'Hide Criteria Table' : 'Show Criteria Table'}
          </button>
        </div>

        {showCriteriaTable && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {POWER_OPERATING_RANGES_4.map((range) => (
              <div
                key={range.key}
                className="rounded-xl p-3 border bg-slate-900/75 space-y-2"
                style={{
                  borderColor: `${range.hexColor}66`,
                  boxShadow: `inset 0 0 18px ${range.hexColor}14`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-sm shrink-0"
                      style={{
                        backgroundColor: range.hexColor,
                        boxShadow: `0 0 10px ${range.hexColor}`,
                      }}
                    />
                    <span className="text-xs font-extrabold text-white uppercase">{range.label}</span>
                  </div>
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded font-bold"
                    style={{
                      backgroundColor: `${range.hexColor}25`,
                      color: '#f8fafc',
                      border: `1px solid ${range.hexColor}66`,
                    }}
                  >
                    {range.shortLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">{range.subtitle}</p>
                <div className="space-y-1 pt-1 border-t border-slate-800/80 text-[11px] font-mono">
                  {POWER_CIRCUITS_META.map((c, idx) => (
                    <div key={c.key} className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400">
                        {idx + 1}) {c.label}:
                      </span>
                      <span className="font-bold text-white">{c.rangeLabels[range.key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GLOBAL FILTER BAR (4 Mode Buttons) */}
      <div className="rounded-2xl border border-cyan-500/25 bg-slate-950/90 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-cyan-300">
              Global Data Range Filter (Year-to-Year, Same Month Across Years, Monthly Comparison, Custom Range):
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
              Active Dates: <span className="text-white font-bold">{activeDates.length.toLocaleString()}</span> Days
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            {
              id: 'year_to_year' as GlobalStatFilterMode,
              title: 'Year-to-Year',
              subtitle: 'Side-by-side yearly bars & Δ indicator',
            },
            {
              id: 'same_month_across_years' as GlobalStatFilterMode,
              title: 'Same Month Across Years',
              subtitle: 'Compare target month across years',
            },
            {
              id: 'monthly_same_year' as GlobalStatFilterMode,
              title: 'Monthly Comparison (Same Year)',
              subtitle: 'Compare months inside a selected year',
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

        {/* Contextual Sub-Controls for Global Mode */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
          {globalMode === 'year_to_year' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-slate-400 mr-1">Compare Years:</span>
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
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                        active
                          ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
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

      {/* MAIN POWER OPERATING CONDITION BAR CHART CARD */}
      <div className="rounded-2xl border border-amber-500/30 bg-[#090f1d]/95 shadow-[0_0_35px_rgba(245,158,11,0.08)] overflow-hidden">
        {/* Card Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800/90 bg-gradient-to-r from-slate-950 via-slate-900/95 to-amber-950/30 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
              4-Circuit Power Operating Condition Statistics Bar Chart
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Horizontal Axis: 4 Submarine Circuits (4 Operating Range Bars per Circuit) · Vertical Axis: Number of
              Records Hitting Operating Range
            </p>
          </div>

          {/* Record Counting Basis Toggle */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setCountingBasis('all_records')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold cursor-pointer transition-all ${
                countingBasis === 'all_records'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Counts every hourly section-phase record in Panel 3 (744 records/day)"
            >
              All Section-Hour Records
            </button>
            <button
              type="button"
              onClick={() => setCountingBasis('unique_hours')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold cursor-pointer transition-all ${
                countingBasis === 'unique_hours'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Counts unique hourly intervals per day (24 hours/day)"
            >
              Unique Hourly Intervals (24h/day)
            </button>
          </div>
        </div>

        {/* LOCAL BUILT-IN CHART FILTER BAR (4 Filters for Each Circuit + Operating Condition Switches) */}
        <div className="px-4 sm:px-6 py-3 bg-slate-950/80 border-b border-slate-800/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-amber-300">
                Built-In Local Chart Filters (4 Submarine Circuits &amp; Operating Condition Filter):
              </span>
              {isLocalFilterMinimized && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-amber-200 border border-slate-700">
                    Circuits: {selectedCircuits.length}/4
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-cyan-200 border border-slate-700">
                    Conditions: {selectedOperateRanges.length}/4 ON
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedCircuits([...ALL_CIRCUIT_KEYS]);
                  setSelectedOperateRanges([...ALL_RANGE_KEYS]);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-mono flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3 text-amber-400" />
                <span>Reset Local Filter</span>
              </button>

              <button
                type="button"
                onClick={() => setIsLocalFilterMinimized((prev) => !prev)}
                className="px-2.5 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/70 text-amber-200 border border-amber-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                title={isLocalFilterMinimized ? 'Expand Local Filter' : 'Minimize Local Filter'}
              >
                {isLocalFilterMinimized ? (
                  <>
                    <Maximize2 className="w-3 h-3 text-amber-300" />
                    <span>Show Filter</span>
                    <ChevronDown className="w-3.5 h-3.5 text-amber-300" />
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3 h-3 text-amber-300" />
                    <span>Minimize Filter</span>
                    <ChevronUp className="w-3.5 h-3.5 text-amber-300" />
                  </>
                )}
              </button>
            </div>
          </div>

          {!isLocalFilterMinimized && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            {/* 4 Built-in Circuit Filters */}
            <div className="lg:col-span-7">
              <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5">
                4 Submarine Cable Circuit Filters (Click to toggle individual circuits):
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {POWER_CIRCUITS_META.map((c) => {
                  const active = selectedCircuits.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggleCircuitFilter(c.key)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        active
                          ? 'bg-amber-950/40 border-amber-400/70 text-white shadow-[0_0_14px_rgba(245,158,11,0.2)]'
                          : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-extrabold font-mono">{c.label}</span>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            active ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]' : 'bg-slate-700'
                          }`}
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">{c.substation}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4 Operating Condition Range Switches */}
            <div className="lg:col-span-5">
              <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5 flex items-center justify-between">
                <span>Operating Condition Range Filter:</span>
                <button
                  type="button"
                  onClick={() => setSelectedOperateRanges(['emergency', 'critical', 'overload'])}
                  className="text-amber-300 hover:underline cursor-pointer"
                >
                  Focus High Demand (Emergency+)
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {POWER_OPERATING_RANGES_4.map((r) => {
                  const active = selectedOperateRanges.includes(r.key);
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => toggleOperateRange(r.key)}
                      className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                        active ? 'bg-slate-900 text-white' : 'bg-slate-950/60 text-slate-500 border-slate-800 opacity-60'
                      }`}
                      style={
                        active
                          ? {
                              borderColor: r.hexColor,
                              boxShadow: `0 0 12px ${r.hexColor}33`,
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: active ? r.hexColor : '#334155' }}
                        />
                        <span className="text-[11px] font-extrabold truncate">{r.shortLabel}</span>
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                        {active ? 'ON' : 'OFF'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Highest Record Callout Card (Non-Overlay) */}
        <div className="px-4 sm:px-6 pt-3.5">
          {showHighestCallout && highestBarDetail ? (
            <div className="rounded-xl border border-amber-500/45 bg-gradient-to-r from-amber-950/40 via-slate-900/95 to-slate-900/95 p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/50 text-amber-200 text-xs font-mono font-bold">
                  <Award className="w-4 h-4 text-amber-400" />
                  <span>HIGHEST RECORD BAR</span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-slate-400">Circuit:</span>{' '}
                  <span className="text-white font-extrabold">{highestBarDetail.circuitLabel}</span>
                </div>
                <div className="text-xs font-mono flex items-center gap-1.5">
                  <span className="text-slate-400">Condition:</span>
                  <span
                    className="px-2 py-0.5 rounded font-bold text-white"
                    style={{ backgroundColor: `${highestBarDetail.rangeColor}44`, border: `1px solid ${highestBarDetail.rangeColor}` }}
                  >
                    {highestBarDetail.rangeLabel} ({highestBarDetail.mwCriteria})
                  </span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-slate-400">Period:</span>{' '}
                  <span className="text-cyan-300 font-bold">{highestBarDetail.periodLabel}</span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-slate-400">Highest Count:</span>{' '}
                  <span className="text-amber-300 font-extrabold text-sm">
                    {highestBarDetail.count.toLocaleString()} records
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHighestCallout(false)}
                className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
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
                  <span>Show Highest Record Callout</span>
                </button>
              </div>
            )
          )}
        </div>

        {/* BAR CHART VISUALIZATION CANVAS */}
        <div className="p-4 sm:p-6">
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[900px] pt-20 pb-4 px-4 rounded-xl bg-[#060b16] border border-slate-800/90">
              {/* Chart Plot Area (Pure 0% to 100% Bar Height Track) */}
              <div className="relative h-72 flex items-end justify-around gap-4 border-b border-l border-slate-700/80 pl-12 pr-4">
                {/* Horizontal Y-Axis Reference Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const tickVal = Math.round(maxBarValue * frac);
                  return (
                    <div
                      key={frac}
                      className="absolute left-12 right-4 border-t border-dashed border-slate-800/80 pointer-events-none"
                      style={{ bottom: `${frac * 100}%` }}
                    >
                      <span className="absolute -left-12 -top-2 w-10 text-right text-[10px] font-mono text-slate-400">
                        {tickVal.toLocaleString()}
                      </span>
                    </div>
                  );
                })}

                {/* 4 Circuit Clusters on Horizontal X-Axis */}
                {circuitChartGroups.map((cg) => (
                  <div
                    key={cg.circuit.key}
                    className="flex-1 h-full flex items-end justify-center px-2 border-r last:border-r-0 border-slate-800/60"
                  >
                    {/* Inside each circuit: 4 Operating Range Sub-Groups */}
                    <div className="w-full h-full flex items-end justify-around gap-2 sm:gap-3">
                      {cg.rangeItems.map((ri) => {
                        if (!isComparisonMode) {
                          // Single Bar per Operating Range (Custom Date Range or 1 Period Selected)
                          const isHighest = highestBarIds.has(ri.groupId) && ri.totalCount > 0;
                          const heightPct =
                            maxBarValue > 0
                              ? Math.max(ri.totalCount > 0 ? 2 : 1, (ri.totalCount / maxBarValue) * 100)
                              : 1;

                          return (
                            <div
                              key={ri.groupId}
                              onMouseEnter={() => setHoveredBarId(ri.groupId)}
                              onMouseLeave={() => setHoveredBarId(null)}
                              className="flex-1 h-full relative flex items-end justify-center group cursor-pointer"
                            >
                              {/* Bar Column (Exact % of h-72 plot area) */}
                              <div
                                className={`w-full max-w-[44px] rounded-t-lg transition-all duration-300 relative ${
                                  isHighest ? 'ring-2 ring-amber-300' : 'group-hover:brightness-125'
                                }`}
                                style={{
                                  height: `${heightPct}%`,
                                  backgroundColor: ri.range.hexColor,
                                  boxShadow: isHighest
                                    ? `0 0 26px ${ri.range.hexColor}, 0 0 14px rgba(251, 191, 36, 0.9)`
                                    : ri.totalCount > 0
                                      ? `0 0 12px ${ri.range.hexColor}66`
                                      : 'none',
                                  opacity: ri.totalCount > 0 ? 1 : 0.25,
                                }}
                              >
                                {/* Amount at top of bar + Highest Record Badge */}
                                <div
                                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 flex flex-col items-center pointer-events-none"
                                  style={{ zIndex: isHighest ? 25 : 15 }}
                                >
                                  {isHighest && (
                                    <span className="mb-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-extrabold uppercase bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(251,191,36,0.95)] animate-pulse whitespace-nowrap">
                                      ★ HIGHEST
                                    </span>
                                  )}
                                  <span
                                    className={`text-[11px] font-mono leading-none whitespace-nowrap ${
                                      isHighest
                                        ? 'text-amber-300 font-extrabold text-xs drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]'
                                        : ri.totalCount > 0
                                          ? 'text-white font-bold'
                                          : 'text-slate-500'
                                    }`}
                                  >
                                    {ri.totalCount.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // COMPARISON MODE: Extra bars standing next to each other for each operating range + Increase/Decrease delta indicator
                        return (
                          <div
                            key={ri.groupId}
                            className="flex-1 h-full relative flex items-end justify-center px-1"
                          >
                            {/* Increase / Decrease Change Indicator Banner above the 100% Y-axis line */}
                            {ri.periodBars.length >= 2 && (
                              <div
                                className={`absolute -top-16 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold flex items-center gap-0.5 whitespace-nowrap border pointer-events-none ${
                                  ri.netDelta > 0
                                    ? 'bg-rose-950/90 text-rose-300 border-rose-500/50'
                                    : ri.netDelta < 0
                                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
                                      : 'bg-slate-900 text-slate-400 border-slate-700'
                                }`}
                                title={`Change from ${ri.periodBars[ri.periodBars.length - 2].periodShortLabel} to ${
                                  ri.periodBars[ri.periodBars.length - 1].periodShortLabel
                                }: ${ri.netDelta > 0 ? '+' : ''}${ri.netDelta.toLocaleString()}`}
                              >
                                {ri.netDelta > 0 ? (
                                  <>
                                    <TrendingUp className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                                    <span>+{ri.netDelta.toLocaleString()}</span>
                                  </>
                                ) : ri.netDelta < 0 ? (
                                  <>
                                    <TrendingDown className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                    <span>{ri.netDelta.toLocaleString()}</span>
                                  </>
                                ) : (
                                  <span>0 Δ</span>
                                )}
                              </div>
                            )}

                            {/* Extra comparison bars standing next to each other (Full 100% Plot Height Track) */}
                            <div className="w-full h-full flex items-end justify-center gap-1">
                              {ri.periodBars.map((pb, pIdx) => {
                                const isHighest = highestBarIds.has(pb.barId) && pb.count > 0;
                                const heightPct =
                                  maxBarValue > 0
                                    ? Math.max(pb.count > 0 ? 2 : 1, (pb.count / maxBarValue) * 100)
                                    : 1;
                                const opacityFactor =
                                  ri.periodBars.length > 1
                                    ? 0.65 + (pIdx / (ri.periodBars.length - 1)) * 0.35
                                    : 1;

                                return (
                                  <div
                                    key={pb.barId}
                                    onMouseEnter={() => setHoveredBarId(pb.barId)}
                                    onMouseLeave={() => setHoveredBarId(null)}
                                    className="flex-1 min-w-[16px] max-w-[32px] h-full relative flex items-end justify-center group cursor-pointer"
                                  >
                                    {/* Bar Column (Exact % of h-72 plot area) */}
                                    <div
                                      className={`w-full rounded-t-md transition-all duration-300 relative ${
                                        isHighest ? 'ring-2 ring-amber-300' : 'group-hover:brightness-125'
                                      }`}
                                      style={{
                                        height: `${heightPct}%`,
                                        backgroundColor: ri.range.hexColor,
                                        opacity: pb.count > 0 ? opacityFactor : 0.2,
                                        boxShadow: isHighest
                                          ? `0 0 24px ${ri.range.hexColor}, 0 0 12px rgba(251, 191, 36, 0.9)`
                                          : pb.count > 0
                                            ? `0 0 10px ${ri.range.hexColor}55`
                                            : 'none',
                                      }}
                                    >
                                      {/* Amount at top of each bar (Positioned above top edge of bar) */}
                                      <div
                                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex flex-col items-center pointer-events-none"
                                        style={{ zIndex: isHighest ? 25 : 15 }}
                                      >
                                        {isHighest && (
                                          <span className="mb-0.5 px-1 py-0.2 rounded bg-amber-400 text-slate-950 text-[8px] font-mono font-extrabold shadow-[0_0_12px_rgba(251,191,36,0.95)] animate-pulse whitespace-nowrap">
                                            ★ MAX
                                          </span>
                                        )}
                                        <span
                                          className={`text-[9px] font-mono leading-none whitespace-nowrap ${
                                            isHighest
                                              ? 'text-amber-300 font-extrabold text-[11px] drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]'
                                              : pb.count > 0
                                                ? 'text-slate-100 font-bold'
                                                : 'text-slate-600'
                                          }`}
                                        >
                                          {pb.count.toLocaleString()}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* X-Axis Labels: Period Sub-Labels, Operating Ranges & Circuit Titles */}
              <div className="flex items-start justify-around gap-4 pl-12 pr-4 pt-1.5">
                {circuitChartGroups.map((cg) => (
                  <div
                    key={cg.circuit.key}
                    className="flex-1 flex flex-col items-center px-2"
                  >
                    {/* Operating Condition Sub-Labels under each circuit */}
                    <div className="w-full flex items-start justify-around gap-2 pb-2 border-b border-slate-800/80">
                      {cg.rangeItems.map((ri) => (
                        <div key={ri.groupId} className="flex-1 flex flex-col items-center text-center">
                          {isComparisonMode && (
                            <div className="w-full flex items-center justify-center gap-1 px-1 pb-1 mb-1 border-b border-slate-800/60">
                              {ri.periodBars.map((pb) => (
                                <span
                                  key={pb.barId}
                                  className="flex-1 min-w-[16px] max-w-[32px] text-[8px] font-mono font-bold text-cyan-200/90 truncate"
                                >
                                  {pb.periodShortLabel}
                                </span>
                              ))}
                            </div>
                          )}
                          <span
                            className="text-[10px] font-mono font-extrabold"
                            style={{ color: ri.range.hexColor }}
                          >
                            {ri.range.shortLabel}
                          </span>
                          <span className="text-[9px] font-mono text-slate-500">
                            {ri.mwCriteriaText}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Circuit Main X-Axis Title */}
                    <div className="mt-2 text-center">
                      <div className="text-xs sm:text-sm font-extrabold font-mono text-white tracking-wide">
                        {cg.circuit.label}
                      </div>
                      <div className="text-[10px] text-slate-400">{cg.circuit.substation}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
