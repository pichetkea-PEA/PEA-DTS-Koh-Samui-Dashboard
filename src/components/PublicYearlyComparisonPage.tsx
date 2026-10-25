import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  CalendarRange,
  Layers,
  Thermometer,
  Zap,
  TrendingUp,
  SlidersHorizontal,
  Info,
  Building,
  CheckCircle2,
  AlertCircle,
  Radio,
  Calendar,
  Filter,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  getThermalZoneInfo,
} from '../data/cableCircuitStructure';
import {
  OrgDatabaseConfig,
  getOrgCircuitDailyPeaks,
  getAllOrgRecords,
  CircuitDailyPeakPower,
  subscribeOrgDatabase,
} from '../services/orgDatabaseStorage';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import { NoDatabaseEmptyState } from './NoDatabaseEmptyState';

export interface PublicYearlyComparisonPageProps {
  dbConfig: OrgDatabaseConfig;
  onAdminLoginClick: () => void;
  isAdminLoggedIn: boolean;
  onGoToFolderAsset: () => void;
  powerSummariesByDate?: Map<string, DailyPowerSummary>;
}

export type ComparisonMode = 'year_to_year' | 'same_month' | 'continuous';
export type PowerCircuitFilter = 'combination' | 'ckt3' | 'ckt2' | 'nkt33' | 'oil33' | 'all_four';

const MONTH_NAMES = [
  { num: '01', name: 'Jan' },
  { num: '02', name: 'Feb' },
  { num: '03', name: 'Mar' },
  { num: '04', name: 'Apr' },
  { num: '05', name: 'May' },
  { num: '06', name: 'Jun' },
  { num: '07', name: 'Jul' },
  { num: '08', name: 'Aug' },
  { num: '09', name: 'Sep' },
  { num: '10', name: 'Oct' },
  { num: '11', name: 'Nov' },
  { num: '12', name: 'Dec' },
];

// Curve colors strictly excluding green and red so Increase (▲) and Decrease (▼) indicators stand out clearly
const YEAR_COLORS: Record<string, string> = {
  '2023': '#38bdf8', // Sky Cyan
  '2024': '#60a5fa', // Royal Blue
  '2025': '#f59e0b', // Amber Gold
  '2026': '#c084fc', // Bright Violet / Purple
  '2027': '#f97316', // Vibrant Orange
  '2028': '#818cf8', // Indigo
};

function getYearColor(year: string, index: number): string {
  if (YEAR_COLORS[year]) return YEAR_COLORS[year];
  const palette = ['#38bdf8', '#f59e0b', '#c084fc', '#60a5fa', '#f97316', '#eab308'];
  return palette[index % palette.length];
}

export const PublicYearlyComparisonPage: React.FC<PublicYearlyComparisonPageProps> = ({
  dbConfig,
  onAdminLoginClick,
  isAdminLoggedIn,
  onGoToFolderAsset,
  powerSummariesByDate,
}) => {
  const [dbVersion, setDbVersion] = useState<number>(0);

  useEffect(() => {
    const unsub = subscribeOrgDatabase(() => {
      setDbVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  // Panel 1 Data Source: Daily peak temperature database (Feeds Fiber Temperature Comparison)
  const allRecords = useMemo(() => {
    return getAllOrgRecords();
  }, [dbConfig, dbVersion]);

  // Panel 2 Data Source: Daily maximum power consumption database (Feeds 4-Circuit Power Comparison)
  const circuitDailyPeaks = useMemo(() => {
    const orgPeaks = getOrgCircuitDailyPeaks();
    return orgPeaks && orgPeaks.length > 0 ? orgPeaks : [];
  }, [dbConfig, dbVersion]);

  // Determine available years across both Panel 1 (Fiber Temp) and Panel 2 (Power Records)
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    if (dbConfig && dbConfig.availableYears) {
      dbConfig.availableYears.forEach((y) => years.add(y));
    }
    allRecords.forEach((r) => {
      const yr = r.date.slice(0, 4);
      if (yr.length === 4) years.add(yr);
    });
    circuitDailyPeaks.forEach((p) => {
      if (p.year) years.add(p.year);
    });
    return Array.from(years).sort();
  }, [dbConfig, allRecords, circuitDailyPeaks]);

  const hasAnyDataSource =
    allRecords.length > 0 || (dbConfig.hasDatabase && dbConfig.totalRecords > 0) || circuitDailyPeaks.length > 0;

  // Filters State
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('year_to_year');
  const [selectedMonth, setSelectedMonth] = useState<string>('03'); // Default March
  const [selectedSectionId, setSelectedSectionId] = useState<string>('2.3');
  const [selectedPhase, setSelectedPhase] = useState<string>(''); // For land cable sections
  const [selectedYear, setSelectedYear] = useState<string>('ALL'); // Default to ALL so full 400+ days timeline is visible immediately
  const [activeChartTab, setActiveChartTab] = useState<'both' | 'temp' | 'power'>('both');
  const [selectedPowerCircuit, setSelectedPowerCircuit] = useState<PowerCircuitFilter>('combination');

  const activeSection = useMemo(() => {
    return (
      CIRCUIT_3_SECTIONS.find((s) => s.sectionId === selectedSectionId) ||
      CIRCUIT_3_SECTIONS[0]
    );
  }, [selectedSectionId]);

  const isLand = activeSection.category === 'land' || selectedSectionId.startsWith('1.');

  // Land cable requires phase selection before charts appear (bypassed for Circuit Peak MW power tab)
  const isPhaseSelectedIfRequired = activeChartTab === 'power' || !isLand || (isLand && Boolean(selectedPhase));

  const handleSectionChange = (newSecId: string) => {
    setSelectedSectionId(newSecId);
    const newSec = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === newSecId);
    const newIsLand = newSec?.category === 'land' || newSecId.startsWith('1.');
    if (newIsLand) {
      setSelectedPhase(''); // Reset phase so user has to select cable phase first
    } else {
      setSelectedPhase('');
    }
  };

  // -------------------------------------------------------------------------
  // FILTERED DATASETS BASED ON COMPARISON MODE
  // Mode 1: Year-to-Year (12-Month Window)
  // Mode 2: Same Month Across Different Years
  // Mode 3: Continuous Timeline
  // -------------------------------------------------------------------------

  // Helper to extract strict Land Cable phase code ('A' | 'B' | 'C') without matching the 'a' inside the word "Phase"
  const extractLandPhaseCode = (ph?: string): 'A' | 'B' | 'C' | '' => {
    if (!ph) return '';
    const cleaned = ph.replace(/phase/gi, '').trim().toUpperCase();
    if (cleaned === 'A' || cleaned.startsWith('A')) return 'A';
    if (cleaned === 'B' || cleaned.startsWith('B')) return 'B';
    if (cleaned === 'C' || cleaned.startsWith('C')) return 'C';
    return '';
  };

  // Resolve daily maximum Fiber Temperature (column "Max_Fiber_Temp_C" / max across all DOFs in daily record)
  const resolveRecordMaxFiberTemp = (rec: any): number => {
    const colTf = typeof rec?.tfMax === 'number' && !Number.isNaN(rec.tfMax) ? rec.tfMax : 0;
    if (isLand && rec?.dofTfMax && typeof rec.dofTfMax === 'object') {
      const dofVals = Object.values(rec.dofTfMax)
        .map((v) => Number(v))
        .filter((v) => !Number.isNaN(v) && v > 0);
      if (dofVals.length > 0) {
        const maxDofTf = Math.max(...dofVals);
        return colTf > 0 ? Math.max(colTf, maxDofTf) : maxDofTf;
      }
    }
    return colTf;
  };

  // Resolve daily maximum Estimated Conductor Temperature (column "IEC_Est_Max_Conductor_C" / max across all DOFs in daily record)
  const resolveRecordMaxConductorTemp = (rec: any): number => {
    const colTc = typeof rec?.tcMax === 'number' && !Number.isNaN(rec.tcMax) ? rec.tcMax : 0;
    if (isLand && rec?.dofTcMax && typeof rec.dofTcMax === 'object') {
      const dofVals = Object.values(rec.dofTcMax)
        .map((v) => Number(v))
        .filter((v) => !Number.isNaN(v) && v > 0);
      if (dofVals.length > 0) {
        const maxDofTc = Math.max(...dofVals);
        return colTc > 0 ? Math.max(colTc, maxDofTc) : maxDofTc;
      }
    }
    return colTc;
  };

  // 1. Chart 1: Fiber Temperature Comparison Data
  const chart1TempData = useMemo(() => {
    if (!isPhaseSelectedIfRequired) return [];

    const targetPhaseCode = isLand ? extractLandPhaseCode(selectedPhase) : '';

    // Filter by Section and Phase
    const baseRecords = allRecords.filter((r) => {
      if (r.sectionId !== selectedSectionId) return false;
      if (isLand) {
        if (!targetPhaseCode) return false;
        const recordPhaseCode = extractLandPhaseCode(r.phase);
        if (recordPhaseCode !== targetPhaseCode) return false;
      }
      return true;
    });

    // Index baseRecords by date for O(1) lookup for the active section & phase
    const recordByDate = new Map<string, any>();
    baseRecords.forEach((r) => {
      const existing = recordByDate.get(r.date);
      if (!existing || resolveRecordMaxFiberTemp(r) > resolveRecordMaxFiberTemp(existing)) {
        recordByDate.set(r.date, r);
      }
    });

    if (comparisonMode === 'year_to_year') {
      // Year-to-Year Comparison using Daily Peak (Day of Year MM-DD)
      const mmddSet = new Set<string>();
      baseRecords.forEach((r) => {
        if (r.date.length >= 10) mmddSet.add(r.date.slice(5));
      });
      const sortedMmdd = Array.from(mmddSet).sort();

      return sortedMmdd.map((mmdd) => {
        const row: Record<string, any> = {
          monthDay: mmdd,
        };
        availableYears.forEach((yr) => {
          const targetDate = `${yr}-${mmdd}`;
          const rec = recordByDate.get(targetDate);
          if (rec) {
            const tfVal = resolveRecordMaxFiberTemp(rec);
            const tcVal = resolveRecordMaxConductorTemp(rec);
            row[`Tf_${yr}`] = tfVal > 0 ? Number(tfVal.toFixed(2)) : null;
            row[`Tc_${yr}`] = tcVal > 0 ? Number(tcVal.toFixed(2)) : null;
          } else {
            row[`Tf_${yr}`] = null;
            row[`Tc_${yr}`] = null;
          }
        });
        return row;
      });
    }

    if (comparisonMode === 'same_month') {
      // Same Month Across Years: Filter by chosen month (e.g. '03')
      const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
      return days.map((day) => {
        const row: Record<string, any> = {
          day: `Day ${day}`,
          monthDay: `${selectedMonth}-${day}`,
        };

        availableYears.forEach((yr) => {
          const targetDate = `${yr}-${selectedMonth}-${day}`;
          const rec = recordByDate.get(targetDate);
          if (rec) {
            const tfVal = resolveRecordMaxFiberTemp(rec);
            const tcVal = resolveRecordMaxConductorTemp(rec);
            row[`Tf_${yr}`] = tfVal > 0 ? Number(tfVal.toFixed(2)) : null;
            row[`Tc_${yr}`] = tcVal > 0 ? Number(tcVal.toFixed(2)) : null;
          } else {
            row[`Tf_${yr}`] = null;
            row[`Tc_${yr}`] = null;
          }
        });

        return row;
      });
    }

    // Continuous timeline mode
    return Array.from(recordByDate.values())
      .filter((r) => (selectedYear === 'ALL' ? true : r.date.startsWith(selectedYear)))
      .map((r) => {
        const tfVal = resolveRecordMaxFiberTemp(r);
        const tcVal = resolveRecordMaxConductorTemp(r);
        const zone = getThermalZoneInfo(tcVal > 0 ? tcVal : tfVal);
        return {
          date: r.date,
          monthDay: r.date.slice(5),
          year: r.date.slice(0, 4),
          tfMax: Number(tfVal.toFixed(2)),
          tfMin: r.tfMin,
          tfMean: r.tfMean,
          tcMax: Number(tcVal.toFixed(2)),
          zone: zone.shortLabel,
          zoneColor: zone.color,
          phase: r.phase,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [
    allRecords,
    selectedSectionId,
    selectedYear,
    isLand,
    selectedPhase,
    isPhaseSelectedIfRequired,
    comparisonMode,
    selectedMonth,
    availableYears,
  ]);

  // 2. Chart 2: Circuit Peak MW Comparison Data
  const chart2PowerData = useMemo(() => {
    if (!isPhaseSelectedIfRequired) return [];

    if (comparisonMode === 'year_to_year') {
      const mmddSet = new Set<string>();
      circuitDailyPeaks.forEach((p) => {
        if (p.date.length >= 10) mmddSet.add(p.date.slice(5));
      });
      const sortedMmdd = Array.from(mmddSet).sort();

      return sortedMmdd.map((mmdd) => {
        const row: Record<string, any> = {
          monthDay: mmdd,
        };
        availableYears.forEach((yr) => {
          const targetDate = `${yr}-${mmdd}`;
          const p = circuitDailyPeaks.find((cp) => cp.date === targetDate);
          if (p) {
            row[`Total_${yr}`] = p.totalIslandMaxMW > 0 ? Number(p.totalIslandMaxMW.toFixed(1)) : null;
            row[`Ckt3_${yr}`] = p.ckt3MaxMW > 0 ? Number(p.ckt3MaxMW.toFixed(1)) : null;
            row[`Ckt2_${yr}`] = p.ckt2MaxMW > 0 ? Number(p.ckt2MaxMW.toFixed(1)) : null;
            row[`Nkt_${yr}`] = p.nkt33MaxMW > 0 ? Number(p.nkt33MaxMW.toFixed(1)) : null;
            row[`Oil_${yr}`] = p.oil33MaxMW > 0 ? Number(p.oil33MaxMW.toFixed(1)) : null;
          } else {
            row[`Total_${yr}`] = null;
            row[`Ckt3_${yr}`] = null;
            row[`Ckt2_${yr}`] = null;
            row[`Nkt_${yr}`] = null;
            row[`Oil_${yr}`] = null;
          }
        });
        return row;
      });
    }

    if (comparisonMode === 'same_month') {
      const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
      return days.map((day) => {
        const row: Record<string, any> = {
          day: `Day ${day}`,
          monthDay: `${selectedMonth}-${day}`,
        };

        availableYears.forEach((yr) => {
          const targetDate = `${yr}-${selectedMonth}-${day}`;
          const p = circuitDailyPeaks.find((cp) => cp.date === targetDate);
          if (p) {
            row[`Total_${yr}`] = p.totalIslandMaxMW > 0 ? Number(p.totalIslandMaxMW.toFixed(1)) : null;
            row[`Ckt3_${yr}`] = p.ckt3MaxMW > 0 ? Number(p.ckt3MaxMW.toFixed(1)) : null;
            row[`Ckt2_${yr}`] = p.ckt2MaxMW > 0 ? Number(p.ckt2MaxMW.toFixed(1)) : null;
            row[`Nkt_${yr}`] = p.nkt33MaxMW > 0 ? Number(p.nkt33MaxMW.toFixed(1)) : null;
            row[`Oil_${yr}`] = p.oil33MaxMW > 0 ? Number(p.oil33MaxMW.toFixed(1)) : null;
          } else {
            row[`Total_${yr}`] = null;
            row[`Ckt3_${yr}`] = null;
            row[`Ckt2_${yr}`] = null;
            row[`Nkt_${yr}`] = null;
            row[`Oil_${yr}`] = null;
          }
        });

        return row;
      });
    }

    // Continuous timeline mode
    return circuitDailyPeaks
      .filter((p) => (selectedYear === 'ALL' ? true : p.year === selectedYear))
      .map((p) => ({
        date: p.date,
        monthDay: p.monthDay,
        year: p.year,
        totalIslandMW: p.totalIslandMaxMW,
        ckt3MW: p.ckt3MaxMW,
        ckt2MW: p.ckt2MaxMW,
        nkt33MW: p.nkt33MaxMW,
        oil33MW: p.oil33MaxMW,
        fiberMaxTempC: p.fiberMaxTempC,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [
    circuitDailyPeaks,
    selectedYear,
    isPhaseSelectedIfRequired,
    comparisonMode,
    selectedMonth,
    availableYears,
  ]);

  // Dynamic Y-Axis domain for Chart 1 (Fiber Temperature) — optimized to actual data range, never pinned at 85°C
  const chart1YDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    chart1TempData.forEach((row: Record<string, any>) => {
      if (comparisonMode === 'continuous') {
        if (typeof row.tfMax === 'number' && row.tfMax > 0) vals.push(row.tfMax);
        if (typeof row.tcMax === 'number' && row.tcMax > 0) vals.push(row.tcMax);
      } else {
        availableYears.forEach((yr) => {
          const tf = row[`Tf_${yr}`];
          const tc = row[`Tc_${yr}`];
          if (typeof tf === 'number' && tf > 0) vals.push(tf);
          if (typeof tc === 'number' && tc > 0) vals.push(tc);
        });
      }
    });
    if (vals.length === 0) return [20, 50];
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const span = Math.max(4, maxVal - minVal);
    const padBottom = Math.max(1.5, span * 0.15);
    const padTop = Math.max(2, span * 0.18);
    const step = span <= 12 ? 2 : 5;
    const lower = Math.max(0, Math.floor((minVal - padBottom) / step) * step);
    const upper = Math.max(lower + step * 3, Math.ceil((maxVal + padTop) / step) * step);
    return [lower, upper];
  }, [chart1TempData, comparisonMode, availableYears]);

  // Dynamic Y-Axis domain for Chart 2 (Power Record) — optimized to actual active circuit data magnitude
  const chart2YDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    const prefixes =
      selectedPowerCircuit === 'combination'
        ? ['Total']
        : selectedPowerCircuit === 'ckt3'
        ? ['Ckt3']
        : selectedPowerCircuit === 'ckt2'
        ? ['Ckt2']
        : selectedPowerCircuit === 'nkt33'
        ? ['Nkt']
        : selectedPowerCircuit === 'oil33'
        ? ['Oil']
        : ['Total', 'Ckt3', 'Ckt2', 'Nkt', 'Oil'];

    const contKeys =
      selectedPowerCircuit === 'combination'
        ? ['totalIslandMW']
        : selectedPowerCircuit === 'ckt3'
        ? ['ckt3MW']
        : selectedPowerCircuit === 'ckt2'
        ? ['ckt2MW']
        : selectedPowerCircuit === 'nkt33'
        ? ['nkt33MW']
        : selectedPowerCircuit === 'oil33'
        ? ['oil33MW']
        : ['totalIslandMW', 'ckt3MW', 'ckt2MW', 'nkt33MW', 'oil33MW'];

    chart2PowerData.forEach((row: Record<string, any>) => {
      if (comparisonMode === 'continuous') {
        contKeys.forEach((k) => {
          const v = row[k];
          if (typeof v === 'number' && v > 0) vals.push(v);
        });
      } else {
        availableYears.forEach((yr) => {
          prefixes.forEach((pfx) => {
            const v = row[`${pfx}_${yr}`];
            if (typeof v === 'number' && v > 0) vals.push(v);
          });
        });
      }
    });

    if (vals.length === 0) return [0, 100];
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const span = Math.max(2, maxVal - minVal);
    const step = maxVal <= 20 ? 1 : span <= 15 ? 2 : 5;
    const padBottom = Math.max(step, span * 0.15);
    const padTop = Math.max(step, span * 0.18);
    const lower = Math.max(0, Math.floor((minVal - padBottom) / step) * step);
    const upper = Math.max(lower + step * 3, Math.ceil((maxVal + padTop) / step) * step);
    return [lower, upper];
  }, [chart2PowerData, comparisonMode, availableYears, selectedPowerCircuit]);

  // Render marker on Power Record chart to identify Increase (▲) or Decrease (▼) from previous year
  const renderPowerComparisonMarker = (prefix: string, yrIndex: number, strokeColor: string) => {
    const currYr = availableYears[yrIndex];
    return (props: any) => {
      const { cx, cy, payload } = props;
      if (cx === undefined || cy === undefined || !payload) return null;
      const currVal = payload[`${prefix}_${currYr}`];
      if (typeof currVal !== 'number' || Number.isNaN(currVal)) return null;

      // Find previous available year value for the same day/month
      let prevVal: number | null = null;
      for (let i = yrIndex - 1; i >= 0; i--) {
        const candidate = payload[`${prefix}_${availableYears[i]}`];
        if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
          prevVal = candidate;
          break;
        }
      }

      // Base year (or no prior year record on this date): render compact circle marker
      if (yrIndex === 0 || prevVal === null) {
        return (
          <circle
            key={`dot-${prefix}-${currYr}-${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r={3}
            fill={strokeColor}
            stroke="#0f172a"
            strokeWidth={1.2}
          />
        );
      }

      const diff = currVal - prevVal;
      if (diff > 0.05) {
        // Increase from previous year -> Upward triangle (▲)
        return (
          <polygon
            key={`inc-${prefix}-${currYr}-${cx}-${cy}`}
            points={`${cx},${cy - 6} ${cx - 5.2},${cy + 4.2} ${cx + 5.2},${cy + 4.2}`}
            fill="#10b981"
            stroke="#ffffff"
            strokeWidth={1.3}
          />
        );
      }
      if (diff < -0.05) {
        // Decrease from previous year -> Downward triangle (▼)
        return (
          <polygon
            key={`dec-${prefix}-${currYr}-${cx}-${cy}`}
            points={`${cx},${cy + 6} ${cx - 5.2},${cy - 4.2} ${cx + 5.2},${cy - 4.2}`}
            fill="#f43f5e"
            stroke="#ffffff"
            strokeWidth={1.3}
          />
        );
      }

      // Unchanged vs previous year
      return (
        <circle
          key={`eq-${prefix}-${currYr}-${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r={3.2}
          fill="#94a3b8"
          stroke="#ffffff"
          strokeWidth={1.2}
        />
      );
    };
  };

  if (!hasAnyDataSource) {
    return (
      <NoDatabaseEmptyState
        pageNumber="2.4"
        pageTitle="Yearly Comparison & Future Demand Growth"
        onAdminLoginClick={onAdminLoginClick}
        isAdminLoggedIn={isAdminLoggedIn}
        onGoToFolderAsset={onGoToFolderAsset}
      />
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Top Filter and Context Bar */}
      <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(168,85,247,0.25)]">
              <CalendarRange className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-black text-slate-100 font-mono tracking-tight leading-tight">
                [2.4] YEARLY COMPARISON &amp; DEMAND GROWTH
              </h2>
              <p className="text-[11px] text-emerald-400/80 font-mono">
                Long-Term Optical Fiber Trends &amp; Submarine Circuit Peak MW Demands
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          {/* 1. Comparison Mode Filter (Item 2.4 Requirement) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => setComparisonMode('year_to_year')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                comparisonMode === 'year_to_year'
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Year-to-Year (12-Mo)
            </button>
            <button
              type="button"
              onClick={() => setComparisonMode('same_month')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                comparisonMode === 'same_month'
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-bold shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Same Month Across Years
            </button>
            <button
              type="button"
              onClick={() => setComparisonMode('continuous')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                comparisonMode === 'continuous'
                  ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40 font-bold shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Continuous Timeline
            </button>
          </div>

          {/* Month Selector for Same Month Comparison Mode */}
          {comparisonMode === 'same_month' && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-cyan-500/40">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs text-cyan-300 font-mono font-bold">MONTH:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-xs font-mono font-bold text-cyan-200 bg-transparent border-none outline-none cursor-pointer"
              >
                {MONTH_NAMES.map((m) => (
                  <option key={m.num} value={m.num} className="bg-slate-900 text-slate-200">
                    {m.name} (Month {m.num})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Continuous Year Filter */}
          {comparisonMode === 'continuous' && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-400 font-mono">YEAR:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="text-xs font-mono font-bold text-emerald-300 bg-transparent border-none outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900 text-slate-200">
                  All Available Years
                </option>
                {availableYears.map((yr) => (
                  <option key={yr} value={yr} className="bg-slate-900 text-slate-200">
                    Year {yr}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Section Selector (Removed when Circuit Peak MW power tab is active) */}
          {activeChartTab !== 'power' && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs text-slate-400 font-mono">SEC:</span>
              <select
                value={selectedSectionId}
                onChange={(e) => handleSectionChange(e.target.value)}
                className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer max-w-[210px] truncate"
              >
                <optgroup label="Land Cable Sections (6)" className="bg-slate-900 text-slate-400">
                  {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land').map((sec) => (
                    <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                      Sec {sec.sectionId}: {sec.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Submarine Cable Zones (13)" className="bg-slate-900 text-slate-400">
                  {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine').map((sec) => (
                    <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                      Zone {sec.sectionId}: {sec.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* PHASE FILTER: Conditionally visible ONLY when a land cable section is selected and not in power tab */}
          {activeChartTab !== 'power' && isLand && (
            <div
              className={`flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border transition-all ${
                !selectedPhase
                  ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse'
                  : 'border-amber-500/50'
              }`}
            >
              <span className="text-xs text-amber-400 font-mono font-bold flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                PHASE:
              </span>
              <select
                value={selectedPhase}
                onChange={(e) => setSelectedPhase(e.target.value)}
                className="text-xs font-mono font-bold text-amber-300 bg-transparent border-none outline-none cursor-pointer"
              >
                <option value="" className="bg-slate-900 text-amber-400 font-bold">
                  ⚡ Select Cable Phase...
                </option>
                <option value="Phase A" className="bg-slate-900 text-slate-200">
                  Phase A
                </option>
                <option value="Phase B" className="bg-slate-900 text-slate-200">
                  Phase B
                </option>
                <option value="Phase C" className="bg-slate-900 text-slate-200">
                  Phase C
                </option>
              </select>
            </div>
          )}

          {/* View Tab Selector */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveChartTab('both')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeChartTab === 'both'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Both Telemetry
            </button>
            <button
              type="button"
              onClick={() => setActiveChartTab('temp')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeChartTab === 'temp'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.3)] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Fiber Temp
            </button>
            <button
              type="button"
              onClick={() => setActiveChartTab('power')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeChartTab === 'power'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Power Records
            </button>
          </div>
        </div>
      </div>

      {/* LAND CABLE PHASE SELECTION GATE:
          If a land cable section is selected and no phase is chosen yet,
          show this directive and block both charts until user selects a phase. */}
      {isLand && !selectedPhase ? (
        <div className="bg-slate-900/90 backdrop-blur-xl p-8 sm:p-12 rounded-3xl border-2 border-dashed border-amber-500/40 shadow-[0_0_35px_rgba(245,158,11,0.1)] text-center space-y-5 animate-in fade-in duration-300">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto shadow-[0_0_25px_rgba(245,158,11,0.25)]">
            <Zap className="w-8 h-8 animate-bounce text-amber-400" />
          </div>

          <div className="space-y-2">
            <h3 className="text-base sm:text-lg font-black font-mono text-slate-100 tracking-tight">
              CABLE PHASE SELECTION REQUIRED FOR SEC {activeSection.sectionId} ({activeSection.name})
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto font-sans leading-relaxed">
              Section {activeSection.sectionId} is a 3-Phase Single-Core Land Cable. To inspect long-term telemetry trends and coincident circuit peak MW demands, please select a specific cable phase below.
            </p>
          </div>

          {/* Interactive Phase Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {(['Phase A', 'Phase B', 'Phase C'] as const).map((phaseOption) => (
              <button
                key={phaseOption}
                type="button"
                onClick={() => setSelectedPhase(phaseOption)}
                className="group px-6 py-3 rounded-2xl text-xs font-mono font-bold bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 hover:border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all cursor-pointer flex items-center gap-2 transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)] group-hover:scale-125 transition-transform" />
                <span>Select {phaseOption}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Charts View Area (Renders only after phase is selected for land cable, or directly for submarine) */
        <div className="space-y-6">
          {/* Chart 1: Optical Fiber & Conductor Temperature Comparison */}
          {(activeChartTab === 'both' || activeChartTab === 'temp') && (
            <div className="bg-slate-900/90 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-cyan-500/20 shadow-[0_0_35px_rgba(6,182,212,0.08)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-500/30">
                      <Thermometer className="w-4 h-4" />
                    </span>
                    <h3 className="text-sm font-extrabold text-white font-mono">
                      FIBER TEMPERATURE TRENDS &amp; YEARLY COMPARISON — SEC {activeSection.sectionId} ({activeSection.name})
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {comparisonMode === 'year_to_year'
                      ? '12-Month Window comparison of Peak Fiber Temperature across available years'
                      : comparisonMode === 'same_month'
                      ? `Comparison for Month ${selectedMonth} (${MONTH_NAMES.find((m) => m.num === selectedMonth)?.name}) across available years`
                      : 'Chronological timeline of daily measured fiber temperatures'}
                    {isLand && selectedPhase ? ` • [${selectedPhase}]` : ''}
                  </p>
                </div>
              </div>

              {comparisonMode !== 'continuous' && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-[11px] font-mono">
                  <span className="text-slate-400 font-semibold">
                    YEAR-OVER-YEAR CHANGE MARKERS (COMPARED TO PREVIOUS YEAR):
                  </span>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold">
                      <span className="text-sm leading-none">▲</span> Increase vs Previous Year
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-rose-400 font-bold">
                      <span className="text-sm leading-none">▼</span> Decrease vs Previous Year
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <span className="text-xs leading-none">●</span> Base Year / No Change
                    </span>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto w-full pb-2">
                <div style={{ minWidth: `${Math.max(900, chart1TempData.length * 16)}px` }} className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      key={`temp-chart-${selectedSectionId}-${selectedPhase}-${comparisonMode}-${selectedMonth}-${selectedYear}`}
                      data={chart1TempData}
                      margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                      <XAxis
                        dataKey={
                          comparisonMode === 'year_to_year' || comparisonMode === 'same_month'
                            ? 'monthDay'
                            : 'date'
                        }
                        stroke="#64748b"
                        tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                        interval={comparisonMode === 'same_month' ? 2 : comparisonMode === 'year_to_year' ? 14 : 10}
                      />
                      <YAxis
                        stroke="#38bdf8"
                        domain={chart1YDomain}
                        allowDataOverflow={false}
                        tick={{ fill: '#38bdf8', fontSize: 11, fontFamily: 'monospace' }}
                        label={{
                          value: 'Temperature (°C)',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#38bdf8',
                          fontSize: 12,
                          fontFamily: 'monospace',
                          fontWeight: 'bold',
                        }}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const rowObj = payload[0]?.payload || {};
                          return (
                            <div className="bg-slate-950/95 border border-cyan-500/40 rounded-xl p-3 text-xs font-mono shadow-2xl space-y-1.5 min-w-[260px]">
                              <div className="font-bold text-cyan-300 border-b border-slate-800 pb-1">
                                Date / Day: {label}
                              </div>
                              {payload.map((p, idx) => {
                                const dataKey = String(p.dataKey || '');
                                let deltaBadge: React.ReactNode = null;
                                if (comparisonMode !== 'continuous' && dataKey.includes('_')) {
                                  const [pfx, yr] = dataKey.split('_');
                                  const yrIdx = availableYears.indexOf(yr);
                                  if (yrIdx > 0 && typeof p.value === 'number') {
                                    let prevVal: number | null = null;
                                    let prevYr = '';
                                    for (let i = yrIdx - 1; i >= 0; i--) {
                                      const cand = rowObj[`${pfx}_${availableYears[i]}`];
                                      if (typeof cand === 'number' && !Number.isNaN(cand)) {
                                        prevVal = cand;
                                        prevYr = availableYears[i];
                                        break;
                                      }
                                    }
                                    if (prevVal !== null) {
                                      const diff = p.value - prevVal;
                                      const sign = diff > 0 ? '+' : '';
                                      if (diff > 0.05) {
                                        deltaBadge = (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                                            ▲ {sign}{diff.toFixed(1)} °C vs {prevYr}
                                          </span>
                                        );
                                      } else if (diff < -0.05) {
                                        deltaBadge = (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/40 text-[10px] font-bold">
                                            ▼ {diff.toFixed(1)} °C vs {prevYr}
                                          </span>
                                        );
                                      } else {
                                        deltaBadge = (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 text-[10px]">
                                            ● 0.0 °C vs {prevYr}
                                          </span>
                                        );
                                      }
                                    }
                                  }
                                }
                                return (
                                  <div key={idx} className="flex justify-between items-center gap-2" style={{ color: p.color }}>
                                    <span>{p.name}:</span>
                                    <div className="flex items-center">
                                      <span className="font-bold">
                                        {p.value !== null && p.value !== undefined ? `${p.value} °C` : 'N/A'}
                                      </span>
                                      {deltaBadge}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 10, fontFamily: 'monospace', fontSize: 11 }}
                      />

                      {/* Dynamic Year lines for Fiber Temp (Tf) and Conductor Temp (Tc) — non-green & non-red colors with ▲/▼ markers */}
                      {comparisonMode !== 'continuous' ? (
                        availableYears.map((yr, idx) => {
                          const col = getYearColor(yr, idx);
                          return (
                            <React.Fragment key={yr}>
                              <Line
                                type="monotone"
                                dataKey={`Tf_${yr}`}
                                name={`Year ${yr} Tf (°C)`}
                                stroke={col}
                                strokeWidth={2.5}
                                dot={renderPowerComparisonMarker('Tf', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                              <Line
                                type="monotone"
                                dataKey={`Tc_${yr}`}
                                name={`Year ${yr} Tc (°C)`}
                                stroke={col}
                                strokeWidth={1.8}
                                strokeDasharray="3 3"
                                dot={false}
                                connectNulls
                              />
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <>
                          <Line
                            type="monotone"
                            dataKey="tfMax"
                            name="Daily Peak Fiber Temp (Tf, °C)"
                            stroke="#38bdf8"
                            strokeWidth={2.5}
                            dot={{ r: 2 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="tcMax"
                            name="Est Conductor Temp (Tc, °C)"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                          />
                        </>
                      )}

                      {chart1YDomain[1] >= 65 && (
                        <ReferenceLine
                          y={65}
                          stroke="#f59e0b"
                          strokeDasharray="3 3"
                          label={{ value: '65°C Alert', fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Chart 2: Circuit Peak MW Demands Comparison (LineChart with Total Power Curve) */}
          {(activeChartTab === 'both' || activeChartTab === 'power') && (
            <div className="bg-slate-900/90 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-emerald-500/20 shadow-[0_0_35px_rgba(16,185,129,0.08)] space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                      <Zap className="w-4 h-4" />
                    </span>
                    <h3 className="text-sm font-extrabold text-white font-mono">
                      DAILY MAXIMUM POWER RECORD (4 CIRCUITS)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {comparisonMode === 'year_to_year'
                      ? 'Year-to-Year daily peak comparison across available years'
                      : comparisonMode === 'same_month'
                      ? `Circuit peak demands comparison for Month ${selectedMonth} (${MONTH_NAMES.find((m) => m.num === selectedMonth)?.name}) across years`
                      : 'Continuous chronological peak MW load across monitored circuits'}
                  </p>
                </div>

                {/* Built-in Circuit Filter Selector */}
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-emerald-500/30 text-xs font-mono shadow-sm">
                  <span className="text-[10px] text-emerald-400 font-bold px-2 uppercase tracking-wider flex items-center gap-1">
                    <Filter className="w-3 h-3" />
                    CIRCUIT:
                  </span>
                  {[
                    { id: 'combination', label: 'Combination of 4 Circuits (Total Island MW)', short: 'Combination (Total MW)', color: 'text-emerald-300' },
                    { id: 'ckt3', label: '115kV Circuit #3 (KMB)', short: '115kV Ckt #3', color: 'text-rose-300' },
                    { id: 'ckt2', label: '115kV Circuit #2 (KMA)', short: '115kV Ckt #2', color: 'text-blue-300' },
                    { id: 'nkt33', label: '33kV NKT Submarine (KNA)', short: '33kV NKT', color: 'text-emerald-300' },
                    { id: 'oil33', label: '33kV Oil-Filled Submarine (KNA)', short: '33kV Oil', color: 'text-amber-300' },
                    { id: 'all_four', label: 'All 4 Circuits (Separated)', short: 'All 4 Circuits', color: 'text-cyan-300' },
                  ].map((cf) => {
                    const isActive = selectedPowerCircuit === cf.id;
                    return (
                      <button
                        key={cf.id}
                        type="button"
                        onClick={() => setSelectedPowerCircuit(cf.id as PowerCircuitFilter)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                          isActive
                            ? 'bg-emerald-950 text-emerald-200 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                        }`}
                        title={cf.label}
                      >
                        {cf.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              {comparisonMode !== 'continuous' && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-[11px] font-mono">
                  <span className="text-slate-400 font-semibold">
                    YEAR-OVER-YEAR CHANGE MARKERS (COMPARED TO PREVIOUS YEAR):
                  </span>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold">
                      <span className="text-sm leading-none">▲</span> Increase vs Previous Year
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-rose-400 font-bold">
                      <span className="text-sm leading-none">▼</span> Decrease vs Previous Year
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <span className="text-xs leading-none">●</span> Base Year / No Change
                    </span>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto w-full pb-2">
                <div style={{ minWidth: `${Math.max(900, chart2PowerData.length * 16)}px` }} className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chart2PowerData}
                      margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                      <XAxis
                        dataKey={
                          comparisonMode === 'year_to_year' || comparisonMode === 'same_month'
                            ? 'monthDay'
                            : 'date'
                        }
                        stroke="#64748b"
                        tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                        interval={comparisonMode === 'same_month' ? 2 : comparisonMode === 'year_to_year' ? 14 : 10}
                      />
                      <YAxis
                        stroke="#a855f7"
                        domain={chart2YDomain}
                        allowDataOverflow={false}
                        tick={{ fill: '#c084fc', fontSize: 11, fontFamily: 'monospace' }}
                        label={{
                          value: 'Power Demand (MW)',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#c084fc',
                          fontSize: 12,
                          fontFamily: 'monospace',
                          fontWeight: 'bold',
                        }}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const rowObj = payload[0]?.payload || {};
                          return (
                            <div className="bg-slate-950/95 border border-emerald-500/40 rounded-xl p-3 text-xs font-mono shadow-2xl space-y-1.5 min-w-[260px]">
                              <div className="font-bold text-emerald-300 border-b border-slate-800 pb-1">
                                Date / Day: {label}
                              </div>
                              {payload.map((p, idx) => {
                                const dataKey = String(p.dataKey || '');
                                let deltaBadge: React.ReactNode = null;
                                if (comparisonMode !== 'continuous' && dataKey.includes('_')) {
                                  const [pfx, yr] = dataKey.split('_');
                                  const yrIdx = availableYears.indexOf(yr);
                                  if (yrIdx > 0 && typeof p.value === 'number') {
                                    let prevVal: number | null = null;
                                    let prevYr = '';
                                    for (let i = yrIdx - 1; i >= 0; i--) {
                                      const cand = rowObj[`${pfx}_${availableYears[i]}`];
                                      if (typeof cand === 'number' && !Number.isNaN(cand)) {
                                        prevVal = cand;
                                        prevYr = availableYears[i];
                                        break;
                                      }
                                    }
                                    if (prevVal !== null) {
                                      const diff = p.value - prevVal;
                                      const sign = diff > 0 ? '+' : '';
                                      if (diff > 0.05) {
                                        deltaBadge = (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                                            ▲ {sign}{diff.toFixed(1)} MW vs {prevYr}
                                          </span>
                                        );
                                      } else if (diff < -0.05) {
                                        deltaBadge = (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/40 text-[10px] font-bold">
                                            ▼ {diff.toFixed(1)} MW vs {prevYr}
                                          </span>
                                        );
                                      } else {
                                        deltaBadge = (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 text-[10px]">
                                            ● 0.0 MW vs {prevYr}
                                          </span>
                                        );
                                      }
                                    }
                                  }
                                }
                                return (
                                  <div key={idx} className="flex justify-between items-center gap-2" style={{ color: p.color }}>
                                    <span>{p.name}:</span>
                                    <div className="flex items-center">
                                      <span className="font-bold">
                                        {p.value !== null && p.value !== undefined ? `${p.value} MW` : 'N/A'}
                                      </span>
                                      {deltaBadge}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 10, fontFamily: 'monospace', fontSize: 11 }}
                      />

                      {comparisonMode !== 'continuous' ? (
                        availableYears.map((yr, idx) => {
                          const col = getYearColor(yr, idx);
                          if (selectedPowerCircuit === 'combination') {
                            return (
                              <Line
                                key={yr}
                                type="monotone"
                                dataKey={`Total_${yr}`}
                                name={`Year ${yr} Combination Total (MW)`}
                                stroke={col}
                                strokeWidth={2.6}
                                dot={renderPowerComparisonMarker('Total', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                            );
                          }
                          if (selectedPowerCircuit === 'ckt3') {
                            return (
                              <Line
                                key={yr}
                                type="monotone"
                                dataKey={`Ckt3_${yr}`}
                                name={`Year ${yr} 115kV Ckt #3 (MW)`}
                                stroke={col}
                                strokeWidth={2.6}
                                dot={renderPowerComparisonMarker('Ckt3', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                            );
                          }
                          if (selectedPowerCircuit === 'ckt2') {
                            return (
                              <Line
                                key={yr}
                                type="monotone"
                                dataKey={`Ckt2_${yr}`}
                                name={`Year ${yr} 115kV Ckt #2 (MW)`}
                                stroke={col}
                                strokeWidth={2.6}
                                dot={renderPowerComparisonMarker('Ckt2', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                            );
                          }
                          if (selectedPowerCircuit === 'nkt33') {
                            return (
                              <Line
                                key={yr}
                                type="monotone"
                                dataKey={`Nkt_${yr}`}
                                name={`Year ${yr} 33kV NKT (MW)`}
                                stroke={col}
                                strokeWidth={2.4}
                                dot={renderPowerComparisonMarker('Nkt', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                            );
                          }
                          if (selectedPowerCircuit === 'oil33') {
                            return (
                              <Line
                                key={yr}
                                type="monotone"
                                dataKey={`Oil_${yr}`}
                                name={`Year ${yr} 33kV Oil (MW)`}
                                stroke={col}
                                strokeWidth={2.4}
                                dot={renderPowerComparisonMarker('Oil', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                            );
                          }
                          // all_four
                          return (
                            <React.Fragment key={yr}>
                              <Line
                                type="monotone"
                                dataKey={`Total_${yr}`}
                                name={`Yr ${yr} Total MW`}
                                stroke={col}
                                strokeWidth={2.2}
                                dot={renderPowerComparisonMarker('Total', idx, col)}
                                activeDot={{ r: 6 }}
                                connectNulls
                              />
                              <Line
                                type="monotone"
                                dataKey={`Ckt3_${yr}`}
                                name={`Yr ${yr} Ckt #3`}
                                stroke="#f59e0b"
                                strokeWidth={1.6}
                                strokeDasharray="3 3"
                                dot={renderPowerComparisonMarker('Ckt3', idx, '#f59e0b')}
                                connectNulls
                              />
                              <Line
                                type="monotone"
                                dataKey={`Ckt2_${yr}`}
                                name={`Yr ${yr} Ckt #2`}
                                stroke="#38bdf8"
                                strokeWidth={1.6}
                                strokeDasharray="3 3"
                                dot={renderPowerComparisonMarker('Ckt2', idx, '#38bdf8')}
                                connectNulls
                              />
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <>
                          {(selectedPowerCircuit === 'combination' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="totalIslandMW"
                              name="Combination of 4 Circuits (Total Island MW)"
                              stroke="#a855f7"
                              strokeWidth={3}
                              dot={{ r: 2 }}
                            />
                          )}
                          {(selectedPowerCircuit === 'ckt3' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="ckt3MW"
                              name="115kV Circuit #3 Peak (MW)"
                              stroke="#f59e0b"
                              strokeWidth={2.6}
                              dot={selectedPowerCircuit === 'ckt3' ? { r: 2 } : false}
                            />
                          )}
                          {(selectedPowerCircuit === 'ckt2' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="ckt2MW"
                              name="115kV Circuit #2 Peak (MW)"
                              stroke="#38bdf8"
                              strokeWidth={2.6}
                              dot={selectedPowerCircuit === 'ckt2' ? { r: 2 } : false}
                            />
                          )}
                          {(selectedPowerCircuit === 'nkt33' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="nkt33MW"
                              name="33kV NKT Submarine Peak (MW)"
                              stroke="#6366f1"
                              strokeWidth={2.2}
                              strokeDasharray={selectedPowerCircuit === 'all_four' ? '3 3' : undefined}
                              dot={selectedPowerCircuit === 'nkt33' ? { r: 2 } : false}
                            />
                          )}
                          {(selectedPowerCircuit === 'oil33' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="oil33MW"
                              name="33kV Oil-Filled Submarine Peak (MW)"
                              stroke="#eab308"
                              strokeWidth={2.2}
                              strokeDasharray={selectedPowerCircuit === 'all_four' ? '3 3' : undefined}
                              dot={selectedPowerCircuit === 'oil33' ? { r: 2 } : false}
                            />
                          )}
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
