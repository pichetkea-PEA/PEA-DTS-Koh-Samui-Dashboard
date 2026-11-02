import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  Calendar,
  CalendarRange,
  Award,
  Filter,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Database,
  CheckCircle2,
  ShieldAlert,
  X,
  Eye,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
  ExternalLink,
  Activity,
  GitCompare,
  Clock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import {
  OrgDatabaseConfig,
  POWER_CIRCUITS_META,
  POWER_OPERATING_RANGES_4,
  PowerCircuitKey,
  PowerOperateConditionKey,
  PowerCircuitMeta,
  Page26OpCondDataset,
  Page26LoadCurveDataset,
  getPage26OpCondDataset,
  getPage26LoadCurveDataset,
  ensurePage26DatasetsLoaded,
  subscribeToOrgDatabase,
} from '../services/orgDatabaseStorage';
import {
  BUNDLED_PAGE26_OP_COND,
  BUNDLED_PAGE26_LOAD_CURVE,
} from '../data/page26BundledData';
import { GlobalStatFilterMode } from './PublicTempStatisticsPage';

export const SHARED_FOLDER_1_OP_COND_URL =
  'https://drive.google.com/drive/folders/1xGm5ZH9mkNQhTAuXmmBCsCnORL0un4nE?usp=sharing';
export const SHARED_FOLDER_2_LOAD_CURVE_URL =
  'https://drive.google.com/drive/folders/1OCCulyWoTU5hnRltkH9J7ZcsNdXDbCeo?usp=sharing';

const HALF_HOUR_SLOTS: string[] = Array.from({ length: 48 }, (_, idx) => {
  const startTotalMin = idx * 30;
  const endTotalMin = (idx + 1) * 30;
  const sh = String(Math.floor(startTotalMin / 60)).padStart(2, '0');
  const sm = String(startTotalMin % 60).padStart(2, '0');
  const eh = String(Math.floor(endTotalMin / 60)).padStart(2, '0');
  const em = String(endTotalMin % 60).padStart(2, '0');
  return `${sh}:${sm}-${eh}:${em}`;
});

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

function classifyCircuitCondition(circuit: PowerCircuitMeta, mw: number): {
  key: PowerOperateConditionKey;
  label: string;
  color: string;
} {
  if (mw > circuit.thresholds.criticalMax) {
    return { key: 'overload', label: 'Overload Condition', color: '#991b1b' };
  }
  if (mw >= circuit.thresholds.emergencyMax) {
    return { key: 'critical', label: 'Critical Condition', color: '#ef4444' };
  }
  if (mw >= circuit.thresholds.normalMax) {
    return { key: 'emergency', label: 'Emergency Condition', color: '#eab308' };
  }
  return { key: 'normal', label: 'Normal Condition', color: '#3b82f6' };
}

export const PublicPowerStatisticsPage: React.FC<PublicPowerStatisticsPageProps> = () => {
  const [opCondData, setOpCondData] = useState<Page26OpCondDataset>(() => {
    const storeOp = getPage26OpCondDataset();
    return storeOp?.dates?.length ? storeOp : BUNDLED_PAGE26_OP_COND;
  });
  const [loadCurveData, setLoadCurveData] = useState<Page26LoadCurveDataset>(() => {
    const storeLc = getPage26LoadCurveDataset();
    return storeLc?.dates?.length ? storeLc : BUNDLED_PAGE26_LOAD_CURVE;
  });
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);

  // Automatically stay synchronized with the global opening database loader & background sync
  useEffect(() => {
    let mounted = true;

    const syncFromStore = () => {
      if (!mounted) return;
      const latestOp = getPage26OpCondDataset();
      const latestLc = getPage26LoadCurveDataset();
      if (latestOp?.dates?.length) setOpCondData(latestOp);
      if (latestLc?.dates?.length) setLoadCurveData(latestLc);
      setIsLoadingData(false);
    };

    syncFromStore();

    ensurePage26DatasetsLoaded(false)
      .then(({ opCond, loadCurve }) => {
        if (!mounted) return;
        if (opCond?.dates?.length) setOpCondData(opCond);
        if (loadCurve?.dates?.length) setLoadCurveData(loadCurve);
        setIsLoadingData(false);
      })
      .catch(() => {
        if (mounted) setIsLoadingData(false);
      });

    const unsubscribe = subscribeToOrgDatabase(() => {
      syncFromStore();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // ============================================================================
  // CHART 1: "OPERATION CONDITION DATABASE" STATE & GLOBAL FILTER
  // ============================================================================
  const allDatesChart1 = useMemo(() => opCondData?.dates || [], [opCondData]);

  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    for (const d of allDatesChart1) {
      if (d && d.length >= 4) yrs.add(d.slice(0, 4));
    }
    return Array.from(yrs).sort();
  }, [allDatesChart1]);

  const availableMonths = useMemo(() => {
    const mos = new Set<string>();
    for (const d of allDatesChart1) {
      if (d && d.length >= 7) mos.add(d.slice(5, 7));
    }
    return Array.from(mos).sort();
  }, [allDatesChart1]);

  // Global Filter State (Applies to Chart 1: Operation Condition Database)
  const [globalMode, setGlobalMode] = useState<GlobalStatFilterMode>('year_to_year');
  const [selectedYears, setSelectedYears] = useState<string[]>(() => {
    const yrs = new Set<string>();
    for (const d of BUNDLED_PAGE26_OP_COND.dates || []) {
      if (d && d.length >= 4) yrs.add(d.slice(0, 4));
    }
    return Array.from(yrs).sort();
  });
  const [selectedMonthAcrossYears, setSelectedMonthAcrossYears] = useState<string>('09');
  const [selectedSingleYearForMonths, setSelectedSingleYearForMonths] = useState<string>('2026');
  const [selectedMonthsInYear, setSelectedMonthsInYear] = useState<string[]>([]);
  const [customStartDate, setCustomStartDate] = useState<string>(
    () => BUNDLED_PAGE26_OP_COND.dates[0] || '2021-11-28'
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    () => BUNDLED_PAGE26_OP_COND.dates[BUNDLED_PAGE26_OP_COND.dates.length - 1] || '2026-10-26'
  );

  // Local Built-in Chart 1 Filters
  const [selectedCircuits, setSelectedCircuits] = useState<PowerCircuitKey[]>([...ALL_CIRCUIT_KEYS]);
  const [selectedOperateRanges, setSelectedOperateRanges] = useState<PowerOperateConditionKey[]>([
    ...ALL_RANGE_KEYS,
  ]);
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
    if (allDatesChart1.length > 0 && (!customStartDate || !customEndDate)) {
      setCustomStartDate(allDatesChart1[0]);
      setCustomEndDate(allDatesChart1[allDatesChart1.length - 1]);
    }
  }, [availableYears, allDatesChart1, selectedYears.length, customStartDate, customEndDate]);

  const monthsForSelectedYear = useMemo(() => {
    const mos = new Set<string>();
    for (const d of allDatesChart1) {
      if (d.startsWith(`${selectedSingleYearForMonths}-`)) {
        mos.add(d.slice(5, 7));
      }
    }
    return Array.from(mos).sort();
  }, [allDatesChart1, selectedSingleYearForMonths]);

  useEffect(() => {
    if (monthsForSelectedYear.length > 0) {
      setSelectedMonthsInYear([...monthsForSelectedYear]);
    }
  }, [selectedSingleYearForMonths, monthsForSelectedYear]);

  // Compute activeDates and periodBuckets from the Global Filter for Chart 1
  const { activeDates, periodBuckets } = useMemo(() => {
    if (allDatesChart1.length === 0) {
      return { activeDates: [] as string[], periodBuckets: [] as PeriodBucket[] };
    }

    if (globalMode === 'year_to_year') {
      const yrSet = new Set(selectedYears.length > 0 ? selectedYears : availableYears);
      const filtered = allDatesChart1.filter((d) => yrSet.has(d.slice(0, 4)));
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
      const filtered = allDatesChart1.filter((d) => yrSet.has(d.slice(0, 4)) && d.slice(5, 7) === mo);
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
      const filtered = allDatesChart1.filter((d) => d.startsWith(`${yr}-`) && moSet.has(d.slice(5, 7)));
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
    const start = customStartDate || allDatesChart1[0];
    const end = customEndDate || allDatesChart1[allDatesChart1.length - 1];
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    const filtered = allDatesChart1.filter((d) => d >= lo && d <= hi);
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
    allDatesChart1,
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

  const isComparisonMode = globalMode !== 'custom_range' && periodBuckets.length > 1;

  const visibleCircuitsMeta = useMemo(() => {
    const cSet = new Set(selectedCircuits);
    return POWER_CIRCUITS_META.filter((c) => cSet.has(c.key));
  }, [selectedCircuits]);

  const visibleRangesMeta = useMemo(() => {
    const rSet = new Set(selectedOperateRanges);
    return POWER_OPERATING_RANGES_4.filter((r) => rSet.has(r.key));
  }, [selectedOperateRanges]);

  // Calculate percentage of each operation condition (4 conditions for each circuit)
  // relative to all operation time in the selected Global Filter period / period bucket
  const circuitChartGroups = useMemo(() => {
    if (!opCondData || !opCondData.byDate) return [];

    return visibleCircuitsMeta.map((circuit) => {
      // First compute total operation minutes across ALL 4 conditions for this circuit over activeDates
      const totalCircuitAllCondMinutes = [0, 0, 0, 0];
      for (const d of activeDates) {
        const dayMat = opCondData.byDate[d];
        if (!dayMat || !dayMat[circuit.index]) continue;
        for (let rIdx = 0; rIdx < 4; rIdx++) {
          totalCircuitAllCondMinutes[rIdx] += dayMat[circuit.index][rIdx] || 0;
        }
      }
      const grandTotalCircuitMinutes =
        totalCircuitAllCondMinutes[0] +
        totalCircuitAllCondMinutes[1] +
        totalCircuitAllCondMinutes[2] +
        totalCircuitAllCondMinutes[3];

      // Also pre-calculate total operation minutes across ALL 4 conditions per periodBucket for this circuit
      const bucketTotalCircuitMinutes = periodBuckets.map((pb) => {
        let sumMin = 0;
        for (const d of pb.dates) {
          const dayMat = opCondData.byDate[d];
          if (!dayMat || !dayMat[circuit.index]) continue;
          sumMin +=
            (dayMat[circuit.index][0] || 0) +
            (dayMat[circuit.index][1] || 0) +
            (dayMat[circuit.index][2] || 0) +
            (dayMat[circuit.index][3] || 0);
        }
        return sumMin;
      });

      const rangeItems = visibleRangesMeta.map((range) => {
        const totalMinutes = totalCircuitAllCondMinutes[range.index] || 0;
        const totalPct =
          grandTotalCircuitMinutes > 0
            ? Number(((totalMinutes / grandTotalCircuitMinutes) * 100).toFixed(2))
            : 0;

        const periodBars = periodBuckets.map((pb, pIdx) => {
          let pMinutes = 0;
          for (const d of pb.dates) {
            const dayMat = opCondData.byDate[d];
            if (!dayMat || !dayMat[circuit.index]) continue;
            pMinutes += dayMat[circuit.index][range.index] || 0;
          }
          const pbTotalMin = bucketTotalCircuitMinutes[pIdx] || 0;
          const pPct = pbTotalMin > 0 ? Number(((pMinutes / pbTotalMin) * 100).toFixed(2)) : 0;

          return {
            barId: `${circuit.key}_${range.key}_${pb.id}`,
            periodId: pb.id,
            periodLabel: pb.label,
            periodShortLabel: pb.shortLabel,
            periodIndex: pIdx,
            pct: pPct,
            minutes: pMinutes,
            totalOperationMinutes: pbTotalMin,
            deltaPctFromPrev: 0,
            deltaMinFromPrev: 0,
          };
        });

        for (let i = 1; i < periodBars.length; i++) {
          const prev = periodBars[i - 1];
          const curr = periodBars[i];
          curr.deltaPctFromPrev = Number((curr.pct - prev.pct).toFixed(2));
          curr.deltaMinFromPrev = curr.minutes - prev.minutes;
        }

        const netDeltaPct =
          periodBars.length >= 2
            ? Number(
                (
                  periodBars[periodBars.length - 1].pct -
                  periodBars[periodBars.length - 2].pct
                ).toFixed(2)
              )
            : 0;

        return {
          circuit,
          range,
          groupId: `${circuit.key}_${range.key}`,
          mwCriteriaText: circuit.rangeLabels[range.key],
          totalPct,
          totalMinutes,
          grandTotalCircuitMinutes,
          periodBars,
          netDeltaPct,
        };
      });

      return {
        circuit,
        grandTotalCircuitMinutes,
        rangeItems,
      };
    });
  }, [opCondData, visibleCircuitsMeta, visibleRangesMeta, activeDates, periodBuckets]);

  // Identify highest percentage bar across Chart 1
  const { maxBarPct, highestBarIds, highestBarDetail } = useMemo(() => {
    let maxVal = 0;
    for (const cg of circuitChartGroups) {
      for (const ri of cg.rangeItems) {
        if (isComparisonMode) {
          for (const pb of ri.periodBars) {
            if (pb.pct > maxVal) maxVal = pb.pct;
          }
        } else {
          if (ri.totalPct > maxVal) maxVal = ri.totalPct;
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
      pct: number;
      minutes: number;
      totalOperationMinutes: number;
    } | null = null;

    if (maxVal > 0) {
      for (const cg of circuitChartGroups) {
        for (const ri of cg.rangeItems) {
          if (isComparisonMode) {
            for (const pb of ri.periodBars) {
              if (pb.pct === maxVal) {
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
                    pct: pb.pct,
                    minutes: pb.minutes,
                    totalOperationMinutes: pb.totalOperationMinutes,
                  };
                }
              }
            }
          } else {
            if (ri.totalPct === maxVal) {
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
                  pct: ri.totalPct,
                  minutes: ri.totalMinutes,
                  totalOperationMinutes: ri.grandTotalCircuitMinutes,
                };
              }
            }
          }
        }
      }
    }

    return {
      maxBarPct: Math.max(maxVal, 100),
      highestBarIds: ids,
      highestBarDetail: firstHighest,
    };
  }, [circuitChartGroups, isComparisonMode, periodBuckets]);

  // ============================================================================
  // CHART 2: "30-MIN LOAD CURVE" INDEPENDENT FILTER & DATA (SHARED FOLDER 2)
  // ============================================================================
  const allDatesChart2 = useMemo(() => loadCurveData?.dates || [], [loadCurveData]);
  const [chart2Mode, setChart2Mode] = useState<'single' | 'dual'>('single');
  const [chart2Date1, setChart2Date1] = useState<string>(
    () => BUNDLED_PAGE26_LOAD_CURVE.dates[BUNDLED_PAGE26_LOAD_CURVE.dates.length - 1] || '2026-10-26'
  );
  const [chart2Date2, setChart2Date2] = useState<string>(
    () => BUNDLED_PAGE26_LOAD_CURVE.dates[Math.max(0, BUNDLED_PAGE26_LOAD_CURVE.dates.length - 2)] || '2026-10-25'
  );
  const [chart2CircuitKey, setChart2CircuitKey] = useState<PowerCircuitKey>('ckt3');
  const [isChart2FilterMinimized, setIsChart2FilterMinimized] = useState<boolean>(false);

  // Initialize Chart 2 default dates (latest date & previous date)
  useEffect(() => {
    if (allDatesChart2.length > 0) {
      if (!chart2Date1 || !allDatesChart2.includes(chart2Date1)) {
        setChart2Date1(allDatesChart2[allDatesChart2.length - 1]);
      }
      if (!chart2Date2 || !allDatesChart2.includes(chart2Date2)) {
        const prevIdx = Math.max(0, allDatesChart2.length - 2);
        setChart2Date2(allDatesChart2[prevIdx]);
      }
    }
  }, [allDatesChart2, chart2Date1, chart2Date2]);

  const selectedChart2Circuit = useMemo(
    () => POWER_CIRCUITS_META.find((c) => c.key === chart2CircuitKey) || POWER_CIRCUITS_META[0],
    [chart2CircuitKey]
  );

  // Build 48 half-hour points for Chart 2
  const { chart2Series, chart2Stats, chart2YMax } = useMemo(() => {
    const slots = loadCurveData?.slots?.length === 48 ? loadCurveData.slots : HALF_HOUR_SLOTS;
    const cIdx = selectedChart2Circuit.index;
    const day1Matrix = (chart2Date1 && loadCurveData?.byDate?.[chart2Date1]) || [];
    const day2Matrix = (chart2Date2 && loadCurveData?.byDate?.[chart2Date2]) || [];

    let max1 = 0;
    let max1Slot = slots[0];
    let min1 = Infinity;
    let sum1 = 0;
    let count1 = 0;

    let max2 = 0;
    let max2Slot = slots[0];
    let min2 = Infinity;
    let sum2 = 0;
    let count2 = 0;

    const series = slots.map((slot, idx) => {
      const v1 = Number(day1Matrix[idx]?.[cIdx] ?? 0);
      const v2 = Number(day2Matrix[idx]?.[cIdx] ?? 0);

      if (v1 > max1) {
        max1 = v1;
        max1Slot = slot;
      }
      if (v1 > 0 && v1 < min1) min1 = v1;
      if (v1 > 0) {
        sum1 += v1;
        count1++;
      }

      if (v2 > max2) {
        max2 = v2;
        max2Slot = slot;
      }
      if (v2 > 0 && v2 < min2) min2 = v2;
      if (v2 > 0) {
        sum2 += v2;
        count2++;
      }

      const cond1 = classifyCircuitCondition(selectedChart2Circuit, v1);
      const cond2 = classifyCircuitCondition(selectedChart2Circuit, v2);

      return {
        slotIndex: idx,
        slot,
        shortTick: slot.slice(0, 5), // e.g. '00:00', '00:30'
        date1MW: Number(v1.toFixed(2)),
        date2MW: Number(v2.toFixed(2)),
        deltaMW: Number((v1 - v2).toFixed(2)),
        cond1Label: cond1.label,
        cond1Color: cond1.color,
        cond2Label: cond2.label,
        cond2Color: cond2.color,
      };
    });

    // Ensure Y-axis top clearly shows all 4 operating condition zones (including Overload zone above criticalMax)
    const { criticalMax } = selectedChart2Circuit.thresholds;
    const peakDataMW = chart2Mode === 'dual' ? Math.max(max1, max2) : max1;
    const rawTop = Math.max(criticalMax * 1.18, peakDataMW * 1.1);
    const yMax =
      criticalMax > 40 ? Math.ceil(rawTop / 5) * 5 : Number((Math.ceil(rawTop * 2) / 2).toFixed(1));

    return {
      chart2Series: series,
      chart2YMax: yMax,
      chart2Stats: {
        max1: Number(max1.toFixed(2)),
        max1Slot,
        min1: min1 === Infinity ? 0 : Number(min1.toFixed(2)),
        avg1: count1 > 0 ? Number((sum1 / count1).toFixed(2)) : 0,
        cond1Peak: classifyCircuitCondition(selectedChart2Circuit, max1),
        max2: Number(max2.toFixed(2)),
        max2Slot,
        min2: min2 === Infinity ? 0 : Number(min2.toFixed(2)),
        avg2: count2 > 0 ? Number((sum2 / count2).toFixed(2)) : 0,
        cond2Peak: classifyCircuitCondition(selectedChart2Circuit, max2),
      },
    };
  }, [loadCurveData, selectedChart2Circuit, chart2Date1, chart2Date2, chart2Mode]);

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
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page 2.6 Header Banner + 2 Shared Google Drive Data Sources */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/35 p-4 sm:p-5 shadow-[0_0_30px_rgba(245,158,11,0.1)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
                  Statistics Records of Power Consumption (Operation Condition % &amp; 30-Min Load Curve)
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Dual-Database Analytics powered by Shared Google Drive Folder 1 (Operation Condition Database) &amp;
                Shared Google Drive Folder 2 (30-Min Load Curve Database)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Backdoor Pre-Calculated Feed Active</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-300 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-amber-400" />
              <span>{(opCondData?.totalDates || allDatesChart1.length).toLocaleString()} Recorded Days</span>
            </div>
          </div>
        </div>

        {/* Active 2 Shared Google Drive Folder Data Sources */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
          {/* Shared Folder 1 Badge */}
          <div className="rounded-xl bg-slate-900/90 border border-cyan-500/30 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Database className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-cyan-300 uppercase">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Chart 1 Source · Operation Condition Database (4 Sheets)</span>
                </div>
                <div className="text-xs font-mono text-white truncate mt-0.5">
                  {opCondData?.fileName || 'Power_Operating_Condition_Database_Updated_2025-07-31_to_2026-10-26.xlsx'}
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  {opCondData?.totalDates || allDatesChart1.length} Dates ({opCondData?.dateRange?.firstDate || '2021-11-28'} to{' '}
                  {opCondData?.dateRange?.latestDate || '2026-10-26'})
                </div>
              </div>
            </div>
            <a
              href={SHARED_FOLDER_1_OP_COND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
            >
              <span>Drive Folder 1</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Shared Folder 2 Badge */}
          <div className="rounded-xl bg-slate-900/90 border border-amber-500/30 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-amber-300 uppercase">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Chart 2 Source · 30-Min Load Curve Database (48 Half-Hour Intervals/Day)</span>
                </div>
                <div className="text-xs font-mono text-white truncate mt-0.5">
                  {loadCurveData?.fileName || 'Hourly_Load_Curve_Database_Updated_2025-07-04_to_2026-10-26.xlsx'}
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  {loadCurveData?.totalDates || allDatesChart2.length} Dates ({loadCurveData?.dateRange?.firstDate || '2021-11-28'} to{' '}
                  {loadCurveData?.dateRange?.latestDate || '2026-10-26'})
                </div>
              </div>
            </div>
            <a
              href={SHARED_FOLDER_2_LOAD_CURVE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
            >
              <span>Drive Folder 2</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>

      {/* 4 OPERATING CONDITION CRITERIA REFERENCE MATRIX (Collapsible) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/90 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-slate-200">
              4-Circuit Power Operating Condition Range Criteria (MW Thresholds &amp; Zone Color Key)
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

      {/* GLOBAL FILTER BAR (Applies to Chart 1: Operation Condition Database) */}
      <div className="rounded-2xl border border-cyan-500/25 bg-slate-950/90 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-cyan-300">
              Global Data Range Filter for Chart 1 (Year-to-Year, Same Month Across Years, Monthly Comparison, Custom Range):
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
                  subtitle: 'Side-by-side yearly % bars & Δ indicator',
                },
                {
                  id: 'same_month_across_years' as GlobalStatFilterMode,
                  title: 'Same Month Across Years',
                  subtitle: 'Compare target month % across years',
                },
                {
                  id: 'monthly_same_year' as GlobalStatFilterMode,
                  title: 'Monthly Comparison (Same Year)',
                  subtitle: 'Compare monthly % inside a selected year',
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
                      min={allDatesChart1[0] || ''}
                      max={customEndDate || allDatesChart1[allDatesChart1.length - 1] || ''}
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
                      min={customStartDate || allDatesChart1[0] || ''}
                      max={allDatesChart1[allDatesChart1.length - 1] || ''}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (allDatesChart1.length > 0) {
                        setCustomStartDate(allDatesChart1[0]);
                        setCustomEndDate(allDatesChart1[allDatesChart1.length - 1]);
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

      {/* ============================================================================
          CHART 1: "OPERATION CONDITION DATABASE" (PERCENTAGE OF ALL OPERATION TIME)
         ============================================================================ */}
      <div className="rounded-2xl border border-amber-500/30 bg-[#090f1d]/95 shadow-[0_0_35px_rgba(245,158,11,0.08)] overflow-hidden">
        {/* Card Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800/90 bg-gradient-to-r from-slate-950 via-slate-900/95 to-amber-950/30 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-bold">
                CHART 1 · SHARED FOLDER 1
              </span>
              <h3 className="text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
                Operation Condition Database — Percentage of All Operation Time (%)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Horizontal Axis: 4 Submarine Circuits (4 Operating Conditions per Circuit) · Vertical Axis: Percentage of
              Each Operation Condition Relative to All Operation Time (0% – 100%) linked to Global Filter
            </p>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-300">
            Formula: <span className="text-white font-bold">(Condition Minutes ÷ Total Operation Minutes) × 100%</span>
          </div>
        </div>

        {/* LOCAL BUILT-IN CHART 1 FILTER BAR */}
        <div className="px-4 sm:px-6 py-3 bg-slate-950/80 border-b border-slate-800/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-amber-300">
                Chart 1 Local Filters (4 Submarine Circuits &amp; 4 Operating Conditions):
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
                  <span>Operating Condition Filter:</span>
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
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-950/60 text-slate-500 border-slate-800 opacity-60'
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
                        <div className="text-[9px] font-mono text-slate-400 mt-0.5">{active ? 'ON' : 'OFF'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Highest Percentage Callout Card */}
        <div className="px-4 sm:px-6 pt-3.5">
          {showHighestCallout && highestBarDetail ? (
            <div className="rounded-xl border border-amber-500/45 bg-gradient-to-r from-amber-950/40 via-slate-900/95 to-slate-900/95 p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/50 text-amber-200 text-xs font-mono font-bold">
                  <Award className="w-4 h-4 text-amber-400" />
                  <span>DOMINANT OPERATING CONDITION</span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-slate-400">Circuit:</span>{' '}
                  <span className="text-white font-extrabold">{highestBarDetail.circuitLabel}</span>
                </div>
                <div className="text-xs font-mono flex items-center gap-1.5">
                  <span className="text-slate-400">Condition:</span>
                  <span
                    className="px-2 py-0.5 rounded font-bold text-white"
                    style={{
                      backgroundColor: `${highestBarDetail.rangeColor}44`,
                      border: `1px solid ${highestBarDetail.rangeColor}`,
                    }}
                  >
                    {highestBarDetail.rangeLabel} ({highestBarDetail.mwCriteria})
                  </span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-slate-400">Period:</span>{' '}
                  <span className="text-cyan-300 font-bold">{highestBarDetail.periodLabel}</span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-slate-400">Operation Share:</span>{' '}
                  <span className="text-amber-300 font-extrabold text-sm">
                    {highestBarDetail.pct.toFixed(2)}%
                  </span>{' '}
                  <span className="text-slate-400">
                    ({highestBarDetail.minutes.toLocaleString()} /{' '}
                    {highestBarDetail.totalOperationMinutes.toLocaleString()} min)
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
                  <span>Show Dominant Condition Callout</span>
                </button>
              </div>
            )
          )}
        </div>

        {/* BAR CHART 1 VISUALIZATION CANVAS (0% to 100% of Operation Time) */}
        <div className="p-4 sm:p-6 space-y-4">
          {isLoadingData ? (
            <div className="h-72 flex items-center justify-center text-slate-400 font-mono text-sm">
              Loading Operation Condition Database from Shared Folder 1...
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="min-w-[920px] pt-20 pb-4 px-4 rounded-xl bg-[#060b16] border border-slate-800/90">
                {/* Chart Plot Area (0% to 100% Bar Height Track) */}
                <div className="relative h-72 flex items-end justify-around gap-4 border-b border-l border-slate-700/80 pl-14 pr-4">
                  {/* Horizontal Y-Axis Reference Grid Lines (0%, 25%, 50%, 75%, 100%) */}
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const tickPct = (maxBarPct * frac).toFixed(0);
                    return (
                      <div
                        key={frac}
                        className="absolute left-14 right-4 border-t border-dashed border-slate-800/80 pointer-events-none"
                        style={{ bottom: `${frac * 100}%` }}
                      >
                        <span className="absolute -left-14 -top-2 w-12 text-right text-[10px] font-mono text-slate-400">
                          {tickPct}%
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
                            const isHighest = highestBarIds.has(ri.groupId) && ri.totalPct > 0;
                            const heightPct =
                              maxBarPct > 0
                                ? Math.max(ri.totalPct > 0 ? 3 : 1, (ri.totalPct / maxBarPct) * 100)
                                : 1;

                            return (
                              <div
                                key={ri.groupId}
                                onMouseEnter={() => setHoveredBarId(ri.groupId)}
                                onMouseLeave={() => setHoveredBarId(null)}
                                className="flex-1 h-full relative flex items-end justify-center group cursor-pointer"
                                title={`${cg.circuit.label} · ${ri.range.label}: ${ri.totalPct.toFixed(2)}% (${ri.totalMinutes.toLocaleString()} min / ${ri.grandTotalCircuitMinutes.toLocaleString()} min)`}
                              >
                                <div
                                  className={`w-full max-w-[46px] rounded-t-lg transition-all duration-300 relative flex items-center justify-center ${
                                    isHighest ? 'ring-2 ring-amber-300' : 'group-hover:brightness-125'
                                  }`}
                                  style={{
                                    height: `${heightPct}%`,
                                    backgroundColor: ri.range.hexColor,
                                    boxShadow: isHighest
                                      ? `0 0 26px ${ri.range.hexColor}, 0 0 14px rgba(251, 191, 36, 0.9)`
                                      : ri.totalPct > 0
                                        ? `0 0 12px ${ri.range.hexColor}66`
                                        : 'none',
                                    opacity: ri.totalPct > 0 ? 1 : 0.25,
                                  }}
                                >
                                  {/* Percentage at top of bar */}
                                  <div
                                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 flex flex-col items-center pointer-events-none"
                                    style={{ zIndex: isHighest ? 25 : 15 }}
                                  >
                                    {isHighest && (
                                      <span className="mb-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-extrabold uppercase bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(251,191,36,0.95)] whitespace-nowrap">
                                        ★ {ri.totalPct.toFixed(2)}%
                                      </span>
                                    )}
                                    <span
                                      className={`text-[11px] font-mono leading-none whitespace-nowrap ${
                                        isHighest
                                          ? 'text-amber-300 font-extrabold text-xs'
                                          : ri.totalPct > 0
                                            ? 'text-white font-bold'
                                            : 'text-slate-500'
                                      }`}
                                    >
                                      {ri.totalPct.toFixed(2)}%
                                    </span>
                                    <span className="text-[9px] font-mono text-slate-400 whitespace-nowrap mt-0.5">
                                      ({(ri.totalMinutes / 60).toFixed(1)}h)
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // COMPARISON MODE: Side-by-side period bars for each operating condition
                          return (
                            <div
                              key={ri.groupId}
                              className="flex-1 h-full relative flex items-end justify-center px-1"
                            >
                              {/* Delta % Change Indicator Banner above the 100% Y-axis line */}
                              {ri.periodBars.length >= 2 && (
                                <div
                                  className={`absolute -top-16 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold flex items-center gap-0.5 whitespace-nowrap border pointer-events-none ${
                                    ri.netDeltaPct > 0
                                      ? 'bg-rose-950/90 text-rose-300 border-rose-500/50'
                                      : ri.netDeltaPct < 0
                                        ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
                                        : 'bg-slate-900 text-slate-400 border-slate-700'
                                  }`}
                                >
                                  {ri.netDeltaPct > 0 ? (
                                    <>
                                      <TrendingUp className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                                      <span>+{ri.netDeltaPct.toFixed(2)}%</span>
                                    </>
                                  ) : ri.netDeltaPct < 0 ? (
                                    <>
                                      <TrendingDown className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                      <span>{ri.netDeltaPct.toFixed(2)}%</span>
                                    </>
                                  ) : (
                                    <span>0.00% Δ</span>
                                  )}
                                </div>
                              )}

                              <div className="w-full h-full flex items-end justify-center gap-1">
                                {ri.periodBars.map((pb, pIdx) => {
                                  const isHighest = highestBarIds.has(pb.barId) && pb.pct > 0;
                                  const heightPct =
                                    maxBarPct > 0
                                      ? Math.max(pb.pct > 0 ? 3 : 1, (pb.pct / maxBarPct) * 100)
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
                                      className="flex-1 min-w-[18px] max-w-[34px] h-full relative flex items-end justify-center group cursor-pointer"
                                      title={`${cg.circuit.label} · ${ri.range.label} (${pb.periodLabel}): ${pb.pct.toFixed(2)}% (${pb.minutes.toLocaleString()} min / ${pb.totalOperationMinutes.toLocaleString()} min)`}
                                    >
                                      <div
                                        className={`w-full rounded-t-md transition-all duration-300 relative ${
                                          isHighest ? 'ring-2 ring-amber-300' : 'group-hover:brightness-125'
                                        }`}
                                        style={{
                                          height: `${heightPct}%`,
                                          backgroundColor: ri.range.hexColor,
                                          opacity: pb.pct > 0 ? opacityFactor : 0.2,
                                          boxShadow: isHighest
                                            ? `0 0 24px ${ri.range.hexColor}, 0 0 12px rgba(251, 191, 36, 0.9)`
                                            : pb.pct > 0
                                              ? `0 0 10px ${ri.range.hexColor}55`
                                              : 'none',
                                        }}
                                      >
                                        <div
                                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex flex-col items-center pointer-events-none"
                                          style={{ zIndex: isHighest ? 25 : 15 }}
                                        >
                                          {isHighest && (
                                            <span className="mb-0.5 px-1 py-0.2 rounded bg-amber-400 text-slate-950 text-[8px] font-mono font-extrabold shadow-[0_0_12px_rgba(251,191,36,0.95)] whitespace-nowrap">
                                              ★ MAX
                                            </span>
                                          )}
                                          <span
                                            className={`text-[9px] font-mono leading-none whitespace-nowrap ${
                                              isHighest
                                                ? 'text-amber-300 font-extrabold text-[10px]'
                                                : pb.pct > 0
                                                  ? 'text-slate-100 font-bold'
                                                  : 'text-slate-600'
                                            }`}
                                          >
                                            {pb.pct.toFixed(1)}%
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
                <div className="flex items-start justify-around gap-4 pl-14 pr-4 pt-1.5">
                  {circuitChartGroups.map((cg) => (
                    <div key={cg.circuit.key} className="flex-1 flex flex-col items-center px-2">
                      {/* Operating Condition Sub-Labels under each circuit */}
                      <div className="w-full flex items-start justify-around gap-2 pb-2 border-b border-slate-800/80">
                        {cg.rangeItems.map((ri) => (
                          <div key={ri.groupId} className="flex-1 flex flex-col items-center text-center">
                            {isComparisonMode && (
                              <div className="w-full flex items-center justify-center gap-1 px-1 pb-1 mb-1 border-b border-slate-800/60">
                                {ri.periodBars.map((pb) => (
                                  <span
                                    key={pb.barId}
                                    className="flex-1 min-w-[18px] max-w-[34px] text-[8px] font-mono font-bold text-cyan-200/90 truncate"
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
                            <span className="text-[9px] font-mono text-slate-500">{ri.mwCriteriaText}</span>
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
          )}

          {/* Summary Percentage & Operation Minutes Breakdown Cards for All 4 Circuits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {circuitChartGroups.map((cg) => (
              <div
                key={cg.circuit.key}
                className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <div>
                    <div className="text-xs font-mono font-extrabold text-white">{cg.circuit.label}</div>
                    <div className="text-[10px] text-slate-400">{cg.circuit.substation}</div>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300 font-bold">
                    {(cg.grandTotalCircuitMinutes / 60).toFixed(0)} hrs total
                  </span>
                </div>
                <div className="space-y-1 text-[11px] font-mono">
                  {cg.rangeItems.map((ri) => (
                    <div key={ri.groupId} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-300">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: ri.range.hexColor }}
                        />
                        <span>{ri.range.shortLabel}:</span>
                      </span>
                      <span className="font-bold text-white">
                        {ri.totalPct.toFixed(2)}%{' '}
                        <span className="text-[10px] text-slate-400 font-normal">
                          ({ri.totalMinutes.toLocaleString()}m)
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============================================================================
          CHART 2: "30-MIN LOAD CURVE" (SHARED FOLDER 2, INDEPENDENT SINGLE / DUAL DATE FILTER)
         ============================================================================ */}
      <div className="rounded-2xl border border-cyan-500/35 bg-[#090f1d]/95 shadow-[0_0_35px_rgba(6,182,212,0.1)] overflow-hidden">
        {/* Chart 2 Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800/90 bg-gradient-to-r from-slate-950 via-slate-900/95 to-cyan-950/35 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono font-bold">
                CHART 2 · SHARED FOLDER 2 (INDEPENDENT FILTER)
              </span>
              <h3 className="text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
                30-Min Load Curve (Daily Half-Hour Gap &amp; 4 Operation Condition Background Zones)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Horizontal Axis: 48 Half-Hour Intervals (00:00–00:30 to 23:30–24:00) · Background Categorized into 4
              Operation Condition Color-Filled Zones with MW Boundary Lines · Independent Single / Dual Date Filter
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsChart2FilterMinimized((prev) => !prev)}
            className="px-2.5 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 border border-cyan-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            {isChart2FilterMinimized ? (
              <>
                <Maximize2 className="w-3 h-3 text-cyan-300" />
                <span>Show Chart 2 Filter</span>
                <ChevronDown className="w-3.5 h-3.5 text-cyan-300" />
              </>
            ) : (
              <>
                <Minimize2 className="w-3 h-3 text-cyan-300" />
                <span>Minimize Chart 2 Filter</span>
                <ChevronUp className="w-3.5 h-3.5 text-cyan-300" />
              </>
            )}
          </button>
        </div>

        {/* Independent Filter Bar for Chart 2 (Not related to Global Filter) */}
        {!isChart2FilterMinimized && (
          <div className="px-4 sm:px-6 py-4 bg-slate-950/85 border-b border-slate-800/80 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              {/* Single Date vs Dual Date Comparison Toggle */}
              <div className="lg:col-span-4 space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-cyan-300 font-bold flex items-center gap-1.5">
                  <GitCompare className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Chart 2 Date Mode (Independent from Global Filter):</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setChart2Mode('single')}
                    className={`px-3 py-2 rounded-xl border text-xs font-mono font-bold cursor-pointer transition-all ${
                      chart2Mode === 'single'
                        ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Single Date
                  </button>
                  <button
                    type="button"
                    onClick={() => setChart2Mode('dual')}
                    className={`px-3 py-2 rounded-xl border text-xs font-mono font-bold cursor-pointer transition-all ${
                      chart2Mode === 'dual'
                        ? 'bg-amber-500/20 border-amber-400 text-white shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Dual Date Comparison
                  </button>
                </div>
              </div>

              {/* Date Pickers (Date 1 & Optional Date 2) */}
              <div className="lg:col-span-4 space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                  {chart2Mode === 'single'
                    ? 'Select Target Date (484 Recorded Dates):'
                    : 'Select Primary Date A & Comparison Date B:'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-slate-900 border border-cyan-500/40 rounded-xl px-2.5 py-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                    <span className="text-[11px] font-mono text-cyan-200 font-bold">
                      {chart2Mode === 'dual' ? 'Date A:' : 'Date:'}
                    </span>
                    <select
                      value={chart2Date1}
                      onChange={(e) => setChart2Date1(e.target.value)}
                      className="bg-transparent text-xs font-mono text-white font-bold focus:outline-none cursor-pointer"
                    >
                      {allDatesChart2.map((d) => (
                        <option key={d} value={d} className="bg-slate-900 text-white">
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  {chart2Mode === 'dual' && (
                    <div className="flex items-center gap-1.5 bg-slate-900 border border-amber-500/40 rounded-xl px-2.5 py-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                      <span className="text-[11px] font-mono text-amber-200 font-bold">Date B:</span>
                      <select
                        value={chart2Date2}
                        onChange={(e) => setChart2Date2(e.target.value)}
                        className="bg-transparent text-xs font-mono text-white font-bold focus:outline-none cursor-pointer"
                      >
                        {allDatesChart2.map((d) => (
                          <option key={d} value={d} className="bg-slate-900 text-white">
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Circuit Selector (Determines the 4 Operation Condition Background Zones & Boundary Thresholds) */}
              <div className="lg:col-span-4 space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                  Select Submarine Circuit (Sets 4 Background Condition Zones):
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {POWER_CIRCUITS_META.map((c) => {
                    const active = chart2CircuitKey === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setChart2CircuitKey(c.key)}
                        className={`p-2 rounded-xl border text-left cursor-pointer transition-all ${
                          active
                            ? 'bg-cyan-950/60 border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                            : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="text-[11px] font-mono font-extrabold truncate">{c.label}</div>
                        <div className="text-[9px] font-mono text-slate-400 truncate">
                          N&lt;{c.thresholds.normalMax}MW
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 4 Operation Condition Background Zone Legend & Boundary Thresholds for Selected Circuit */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2 text-slate-300">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-bold text-white">{selectedChart2Circuit.label}</span>
                <span className="text-slate-400">({selectedChart2Circuit.substation}) Background Zones:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {POWER_OPERATING_RANGES_4.map((r) => (
                  <span
                    key={r.key}
                    className="px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-[11px]"
                    style={{
                      backgroundColor: `${r.hexColor}22`,
                      border: `1px solid ${r.hexColor}88`,
                      color: '#f8fafc',
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: r.hexColor }}
                    />
                    <span className="font-bold">{r.shortLabel}:</span>
                    <span>{selectedChart2Circuit.rangeLabels[r.key]}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chart 2 KPI Summary Strip */}
        <div className="px-4 sm:px-6 pt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-3">
            <div className="text-[10px] font-mono uppercase text-cyan-300 font-bold">
              {chart2Mode === 'dual' ? `Date A (${chart2Date1}) Peak Load` : `Selected Date (${chart2Date1}) Peak Load`}
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-mono font-extrabold text-white">
                {chart2Stats.max1.toFixed(2)} MW
              </span>
              <span className="text-xs font-mono text-cyan-300">@ {chart2Stats.max1Slot}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400">Peak Zone:</span>
              <span
                className="px-1.5 py-0.5 rounded font-bold text-white"
                style={{ backgroundColor: `${chart2Stats.cond1Peak.color}55`, border: `1px solid ${chart2Stats.cond1Peak.color}` }}
              >
                {chart2Stats.cond1Peak.label}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">
              {chart2Mode === 'dual' ? `Date A (${chart2Date1}) Daily Avg / Min` : `Daily Mean & Minimum Load`}
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-mono font-extrabold text-emerald-300">
                Avg: {chart2Stats.avg1.toFixed(2)} MW
              </span>
              <span className="text-xs font-mono text-slate-300">Min: {chart2Stats.min1.toFixed(2)} MW</span>
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-400">
              48 Half-Hour Intervals (00:00–24:00)
            </div>
          </div>

          {chart2Mode === 'dual' ? (
            <>
              <div className="rounded-xl border border-amber-500/30 bg-slate-900/80 p-3">
                <div className="text-[10px] font-mono uppercase text-amber-300 font-bold">
                  Date B ({chart2Date2}) Peak Load
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-lg font-mono font-extrabold text-amber-300">
                    {chart2Stats.max2.toFixed(2)} MW
                  </span>
                  <span className="text-xs font-mono text-amber-200">@ {chart2Stats.max2Slot}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">Peak Zone:</span>
                  <span
                    className="px-1.5 py-0.5 rounded font-bold text-white"
                    style={{ backgroundColor: `${chart2Stats.cond2Peak.color}55`, border: `1px solid ${chart2Stats.cond2Peak.color}` }}
                  >
                    {chart2Stats.cond2Peak.label}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                  Dual Date Peak Difference (Date A vs Date B)
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span
                    className={`text-lg font-mono font-extrabold ${
                      chart2Stats.max1 - chart2Stats.max2 >= 0 ? 'text-rose-300' : 'text-emerald-300'
                    }`}
                  >
                    {chart2Stats.max1 - chart2Stats.max2 >= 0 ? '+' : ''}
                    {(chart2Stats.max1 - chart2Stats.max2).toFixed(2)} MW
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    Avg Δ: {chart2Stats.avg1 - chart2Stats.avg2 >= 0 ? '+' : ''}
                    {(chart2Stats.avg1 - chart2Stats.avg2).toFixed(2)} MW
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-400">
                  Comparing {chart2Date1} vs {chart2Date2}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                  Normal / Emergency Boundary
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-lg font-mono font-extrabold text-yellow-300">
                    {selectedChart2Circuit.thresholds.normalMax} MW
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Margin: {(selectedChart2Circuit.thresholds.normalMax - chart2Stats.max1).toFixed(2)} MW
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-400">
                  Emergency: {selectedChart2Circuit.rangeLabels.emergency}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                  Critical / Overload Boundary
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-lg font-mono font-extrabold text-rose-400">
                    {selectedChart2Circuit.thresholds.criticalMax} MW
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Critical: ≥{selectedChart2Circuit.thresholds.emergencyMax} MW
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-400">
                  Overload: {selectedChart2Circuit.rangeLabels.overload}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 30-MIN LOAD CURVE RECHARTS CANVAS WITH 4 OPERATION CONDITION COLOR-FILLED ZONES & BOUNDARIES */}
        <div className="p-4 sm:p-6">
          <div className="rounded-xl bg-[#060b16] border border-slate-800/90 p-4">
            <div className="h-[430px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chart2Series}
                  margin={{ top: 20, right: 36, left: 10, bottom: 30 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />

                  {/* 4 Color-Filled Background Operation Condition Zones */}
                  {/* Zone 1: Normal Condition (0 to normalMax) */}
                  <ReferenceArea
                    y1={0}
                    y2={selectedChart2Circuit.thresholds.normalMax}
                    fill="#3b82f6"
                    fillOpacity={0.16}
                    ifOverflow="extendDomain"
                  />
                  {/* Zone 2: Emergency Condition (normalMax to emergencyMax) */}
                  <ReferenceArea
                    y1={selectedChart2Circuit.thresholds.normalMax}
                    y2={selectedChart2Circuit.thresholds.emergencyMax}
                    fill="#eab308"
                    fillOpacity={0.22}
                    ifOverflow="extendDomain"
                  />
                  {/* Zone 3: Critical Condition (emergencyMax to criticalMax) */}
                  <ReferenceArea
                    y1={selectedChart2Circuit.thresholds.emergencyMax}
                    y2={selectedChart2Circuit.thresholds.criticalMax}
                    fill="#ef4444"
                    fillOpacity={0.24}
                    ifOverflow="extendDomain"
                  />
                  {/* Zone 4: Overload Condition (criticalMax to chart2YMax) */}
                  <ReferenceArea
                    y1={selectedChart2Circuit.thresholds.criticalMax}
                    y2={chart2YMax}
                    fill="#991b1b"
                    fillOpacity={0.32}
                    ifOverflow="extendDomain"
                  />

                  {/* Horizontal Boundary Lines Between Each Condition Zone */}
                  <ReferenceLine
                    y={selectedChart2Circuit.thresholds.normalMax}
                    stroke="#eab308"
                    strokeWidth={1.75}
                    strokeDasharray="6 4"
                    label={{
                      value: `Emergency Boundary (${selectedChart2Circuit.thresholds.normalMax} MW)`,
                      position: 'insideBottomRight',
                      fill: '#fde047',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />
                  <ReferenceLine
                    y={selectedChart2Circuit.thresholds.emergencyMax}
                    stroke="#ef4444"
                    strokeWidth={1.75}
                    strokeDasharray="6 4"
                    label={{
                      value: `Critical Boundary (${selectedChart2Circuit.thresholds.emergencyMax} MW)`,
                      position: 'insideBottomRight',
                      fill: '#fca5a5',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />
                  <ReferenceLine
                    y={selectedChart2Circuit.thresholds.criticalMax}
                    stroke="#dc2626"
                    strokeWidth={2}
                    label={{
                      value: `Overload Boundary (${selectedChart2Circuit.thresholds.criticalMax} MW)`,
                      position: 'insideTopRight',
                      fill: '#fecaca',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />

                  <XAxis
                    dataKey="slot"
                    stroke="#94a3b8"
                    tick={{ fill: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' }}
                    angle={-35}
                    textAnchor="end"
                    interval={1}
                    height={55}
                  />
                  <YAxis
                    domain={[0, chart2YMax]}
                    stroke="#94a3b8"
                    tick={{ fill: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' }}
                    unit=" MW"
                    width={72}
                  />

                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0]?.payload;
                      if (!pt) return null;
                      return (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/95 p-3 shadow-2xl text-xs font-mono space-y-2 min-w-[250px]">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                            <span className="text-cyan-300 font-extrabold">Half-Hour Slot: {pt.slot}</span>
                            <span className="text-slate-400">{selectedChart2Circuit.label}</span>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-cyan-200 font-bold">
                                {chart2Mode === 'dual' ? `Date A (${chart2Date1}):` : `Date (${chart2Date1}):`}
                              </span>
                              <span className="text-white font-extrabold">{pt.date1MW.toFixed(2)} MW</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">Condition Zone:</span>
                              <span
                                className="px-1.5 py-0.5 rounded font-bold text-white"
                                style={{ backgroundColor: `${pt.cond1Color}66`, border: `1px solid ${pt.cond1Color}` }}
                              >
                                {pt.cond1Label}
                              </span>
                            </div>
                          </div>

                          {chart2Mode === 'dual' && (
                            <div className="space-y-1 pt-1.5 border-t border-slate-800">
                              <div className="flex items-center justify-between">
                                <span className="text-amber-200 font-bold">Date B ({chart2Date2}):</span>
                                <span className="text-amber-300 font-extrabold">{pt.date2MW.toFixed(2)} MW</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-400">Condition Zone:</span>
                                <span
                                  className="px-1.5 py-0.5 rounded font-bold text-white"
                                  style={{ backgroundColor: `${pt.cond2Color}66`, border: `1px solid ${pt.cond2Color}` }}
                                >
                                  {pt.cond2Label}
                                </span>
                              </div>
                              <div className="flex items-center justify-between pt-1 text-[11px]">
                                <span className="text-slate-400">Difference (A − B):</span>
                                <span
                                  className={`font-extrabold ${
                                    pt.deltaMW >= 0 ? 'text-rose-300' : 'text-emerald-300'
                                  }`}
                                >
                                  {pt.deltaMW >= 0 ? '+' : ''}
                                  {pt.deltaMW.toFixed(2)} MW
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />

                  {/* Primary Date A Load Curve */}
                  <Area
                    type="monotone"
                    dataKey="date1MW"
                    fill="#22d3ee"
                    fillOpacity={0.12}
                    stroke="none"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="date1MW"
                    name={`Date ${chart2Date1}`}
                    stroke="#22d3ee"
                    strokeWidth={2.75}
                    dot={{ r: 2.5, fill: '#22d3ee', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#ffffff', stroke: '#06b6d4', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />

                  {/* Secondary Date B Load Curve (When Dual Date Comparison Mode is Active) */}
                  {chart2Mode === 'dual' && (
                    <Line
                      type="monotone"
                      dataKey="date2MW"
                      name={`Date ${chart2Date2}`}
                      stroke="#fbbf24"
                      strokeWidth={2.5}
                      strokeDasharray="5 3"
                      dot={{ r: 2.5, fill: '#fbbf24', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#ffffff', stroke: '#f59e0b', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
