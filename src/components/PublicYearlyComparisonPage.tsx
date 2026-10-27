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
  ReferenceDot,
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
  Pin,
  Eye,
  EyeOff,
  X,
  Move,
  RotateCcw,
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

export type ComparisonMode = 'year_to_year' | 'same_month' | 'continuous' | 'custom_range';
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

  // Compute all available dates across both datasets for Custom Range bounds
  const allAvailableDates = useMemo(() => {
    const dateSet = new Set<string>();
    allRecords.forEach((r) => {
      if (r.date && r.date.length >= 10) dateSet.add(r.date.slice(0, 10));
    });
    circuitDailyPeaks.forEach((p) => {
      if (p.date && p.date.length >= 10) dateSet.add(p.date.slice(0, 10));
    });
    return Array.from(dateSet).sort();
  }, [allRecords, circuitDailyPeaks]);

  const tempAvailableDates = useMemo(() => {
    const dateSet = new Set<string>();
    allRecords.forEach((r) => {
      if (r.date && r.date.length >= 10) dateSet.add(r.date.slice(0, 10));
    });
    return Array.from(dateSet).sort();
  }, [allRecords]);

  const minAvailableDate = allAvailableDates.length > 0 ? allAvailableDates[0] : '';
  const maxAvailableDate =
    allAvailableDates.length > 0 ? allAvailableDates[allAvailableDates.length - 1] : '';

  const hasAnyDataSource =
    allRecords.length > 0 || (dbConfig.hasDatabase && dbConfig.totalRecords > 0) || circuitDailyPeaks.length > 0;

  // Filters State
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('year_to_year');
  const [selectedMonth, setSelectedMonth] = useState<string>('03'); // Default March
  const [selectedSectionId, setSelectedSectionId] = useState<string>('2.3');
  const [selectedPhase, setSelectedPhase] = useState<string>(''); // For land cable sections
  const [selectedYear, setSelectedYear] = useState<string>('ALL'); // Default to ALL so full 400+ days timeline is visible immediately
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [activeChartTab, setActiveChartTab] = useState<'both' | 'temp' | 'power'>('both');
  const [selectedPowerCircuit, setSelectedPowerCircuit] = useState<PowerCircuitFilter>('combination');
  const [isTempPeakCardOpen, setIsTempPeakCardOpen] = useState<boolean>(true);
  const [isPowerPeakCardOpen, setIsPowerPeakCardOpen] = useState<boolean>(true);
  const [tempCardOffset, setTempCardOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [powerCardOffset, setPowerCardOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // Initialize Custom Range Start & End dates automatically when dataset dates load
  useEffect(() => {
    const sourceDates = tempAvailableDates.length > 0 ? tempAvailableDates : allAvailableDates;
    if (sourceDates.length === 0) return;
    const latestDate = sourceDates[sourceDates.length - 1];
    const defaultStartIdx = Math.max(0, sourceDates.length - 60);
    const defaultStartDate = sourceDates[defaultStartIdx];

    setCustomStartDate((prev) => (prev && prev >= minAvailableDate && prev <= maxAvailableDate ? prev : defaultStartDate));
    setCustomEndDate((prev) => (prev && prev >= minAvailableDate && prev <= maxAvailableDate ? prev : latestDate));
  }, [tempAvailableDates, allAvailableDates, minAvailableDate, maxAvailableDate]);

  const effectiveStartDate = useMemo(() => {
    const start = customStartDate || minAvailableDate;
    const end = customEndDate || maxAvailableDate;
    return start && end && start > end ? end : start;
  }, [customStartDate, customEndDate, minAvailableDate, maxAvailableDate]);

  const effectiveEndDate = useMemo(() => {
    const start = customStartDate || minAvailableDate;
    const end = customEndDate || maxAvailableDate;
    return start && end && start > end ? start : end;
  }, [customStartDate, customEndDate, minAvailableDate, maxAvailableDate]);

  const isChronologicalMode = comparisonMode === 'continuous' || comparisonMode === 'custom_range';

  // Reset card offsets when range mode or filters change so card always starts in clean non-overlapping position
  useEffect(() => {
    setTempCardOffset({ dx: 0, dy: 0 });
  }, [comparisonMode, selectedMonth, selectedYear, effectiveStartDate, effectiveEndDate, selectedSectionId, selectedPhase]);

  useEffect(() => {
    setPowerCardOffset({ dx: 0, dy: 0 });
  }, [comparisonMode, selectedMonth, selectedYear, effectiveStartDate, effectiveEndDate, selectedPowerCircuit]);

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
  // Mode 4: Custom Range (Start Date to End Date)
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

    // Continuous timeline OR Custom Range mode
    return Array.from(recordByDate.values())
      .filter((r) => {
        if (comparisonMode === 'custom_range') {
          if (effectiveStartDate && r.date < effectiveStartDate) return false;
          if (effectiveEndDate && r.date > effectiveEndDate) return false;
          return true;
        }
        return selectedYear === 'ALL' ? true : r.date.startsWith(selectedYear);
      })
      .map((r) => {
        const tfVal = resolveRecordMaxFiberTemp(r);
        const tcVal = resolveRecordMaxConductorTemp(r);
        const zone = getThermalZoneInfo(tcVal > 0 ? tcVal : tfVal);
        const currYr = r.date.slice(0, 4);
        const mmdd = r.date.slice(5);
        const yrIdx = availableYears.indexOf(currYr);

        let prev_tfMax: number | null = null;
        let prev_tcMax: number | null = null;
        let prevYear = '';
        if (yrIdx > 0) {
          for (let i = yrIdx - 1; i >= 0; i--) {
            const prevRec = recordByDate.get(`${availableYears[i]}-${mmdd}`);
            if (prevRec) {
              const pTf = resolveRecordMaxFiberTemp(prevRec);
              const pTc = resolveRecordMaxConductorTemp(prevRec);
              if (pTf > 0) {
                prev_tfMax = Number(pTf.toFixed(2));
                prev_tcMax = pTc > 0 ? Number(pTc.toFixed(2)) : null;
                prevYear = availableYears[i];
                break;
              }
            }
          }
        }

        return {
          date: r.date,
          monthDay: mmdd,
          year: currYr,
          tfMax: Number(tfVal.toFixed(2)),
          tfMin: r.tfMin,
          tfMean: r.tfMean,
          tcMax: Number(tcVal.toFixed(2)),
          prev_tfMax,
          prev_tcMax,
          prevYear,
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
    effectiveStartDate,
    effectiveEndDate,
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

    const powerPeakByDate = new Map<string, CircuitDailyPeakPower>();
    circuitDailyPeaks.forEach((cp) => {
      powerPeakByDate.set(cp.date, cp);
    });

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
          const p = powerPeakByDate.get(targetDate);
          if (p) {
            row[`Total_${yr}`] = p.totalIslandMaxMW > 0 ? Number(p.totalIslandMaxMW.toFixed(2)) : null;
            row[`Ckt3_${yr}`] = p.ckt3MaxMW > 0 ? Number(p.ckt3MaxMW.toFixed(2)) : null;
            row[`Ckt2_${yr}`] = p.ckt2MaxMW > 0 ? Number(p.ckt2MaxMW.toFixed(2)) : null;
            row[`Nkt_${yr}`] = p.nkt33MaxMW > 0 ? Number(p.nkt33MaxMW.toFixed(2)) : null;
            row[`Oil_${yr}`] = p.oil33MaxMW > 0 ? Number(p.oil33MaxMW.toFixed(2)) : null;
            row[`PeakTime_${yr}`] = p.peakTime || '';
            row[`FileSource_${yr}`] = p.fileSource || '';
            row[`Ckt3AtPeak_${yr}`] = p.ckt3AtPeakMW;
            row[`Ckt2AtPeak_${yr}`] = p.ckt2AtPeakMW;
            row[`NktAtPeak_${yr}`] = p.nkt33AtPeakMW;
            row[`OilAtPeak_${yr}`] = p.oil33AtPeakMW;
            row[`Ckt3Time_${yr}`] = p.ckt3PeakTime || '';
            row[`Ckt2Time_${yr}`] = p.ckt2PeakTime || '';
            row[`NktTime_${yr}`] = p.nkt33PeakTime || '';
            row[`OilTime_${yr}`] = p.oil33PeakTime || '';
            row[`WorstCaseSum_${yr}`] = Number(
              (p.ckt3MaxMW + p.ckt2MaxMW + p.nkt33MaxMW + p.oil33MaxMW).toFixed(2)
            );
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
          const p = powerPeakByDate.get(targetDate);
          if (p) {
            row[`Total_${yr}`] = p.totalIslandMaxMW > 0 ? Number(p.totalIslandMaxMW.toFixed(2)) : null;
            row[`Ckt3_${yr}`] = p.ckt3MaxMW > 0 ? Number(p.ckt3MaxMW.toFixed(2)) : null;
            row[`Ckt2_${yr}`] = p.ckt2MaxMW > 0 ? Number(p.ckt2MaxMW.toFixed(2)) : null;
            row[`Nkt_${yr}`] = p.nkt33MaxMW > 0 ? Number(p.nkt33MaxMW.toFixed(2)) : null;
            row[`Oil_${yr}`] = p.oil33MaxMW > 0 ? Number(p.oil33MaxMW.toFixed(2)) : null;
            row[`PeakTime_${yr}`] = p.peakTime || '';
            row[`FileSource_${yr}`] = p.fileSource || '';
            row[`Ckt3AtPeak_${yr}`] = p.ckt3AtPeakMW;
            row[`Ckt2AtPeak_${yr}`] = p.ckt2AtPeakMW;
            row[`NktAtPeak_${yr}`] = p.nkt33AtPeakMW;
            row[`OilAtPeak_${yr}`] = p.oil33AtPeakMW;
            row[`Ckt3Time_${yr}`] = p.ckt3PeakTime || '';
            row[`Ckt2Time_${yr}`] = p.ckt2PeakTime || '';
            row[`NktTime_${yr}`] = p.nkt33PeakTime || '';
            row[`OilTime_${yr}`] = p.oil33PeakTime || '';
            row[`WorstCaseSum_${yr}`] = Number(
              (p.ckt3MaxMW + p.ckt2MaxMW + p.nkt33MaxMW + p.oil33MaxMW).toFixed(2)
            );
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

    // Continuous timeline OR Custom Range mode
    return circuitDailyPeaks
      .filter((p) => {
        if (comparisonMode === 'custom_range') {
          if (effectiveStartDate && p.date < effectiveStartDate) return false;
          if (effectiveEndDate && p.date > effectiveEndDate) return false;
          return true;
        }
        return selectedYear === 'ALL' ? true : p.year === selectedYear;
      })
      .map((p) => {
        const yrIdx = availableYears.indexOf(p.year);
        let prev_totalIslandMW: number | null = null;
        let prev_ckt3MW: number | null = null;
        let prev_ckt2MW: number | null = null;
        let prev_nkt33MW: number | null = null;
        let prev_oil33MW: number | null = null;
        let prevYear = '';

        if (yrIdx > 0) {
          for (let i = yrIdx - 1; i >= 0; i--) {
            const prevP = powerPeakByDate.get(`${availableYears[i]}-${p.monthDay}`);
            if (prevP && prevP.totalIslandMaxMW > 0) {
              prev_totalIslandMW = Number(prevP.totalIslandMaxMW.toFixed(2));
              prev_ckt3MW = prevP.ckt3MaxMW > 0 ? Number(prevP.ckt3MaxMW.toFixed(2)) : null;
              prev_ckt2MW = prevP.ckt2MaxMW > 0 ? Number(prevP.ckt2MaxMW.toFixed(2)) : null;
              prev_nkt33MW = prevP.nkt33MaxMW > 0 ? Number(prevP.nkt33MaxMW.toFixed(2)) : null;
              prev_oil33MW = prevP.oil33MaxMW > 0 ? Number(prevP.oil33MaxMW.toFixed(2)) : null;
              prevYear = availableYears[i];
              break;
            }
          }
        }

        return {
          date: p.date,
          monthDay: p.monthDay,
          year: p.year,
          totalIslandMW: Number(p.totalIslandMaxMW.toFixed(2)),
          ckt3MW: Number(p.ckt3MaxMW.toFixed(2)),
          ckt2MW: Number(p.ckt2MaxMW.toFixed(2)),
          nkt33MW: Number(p.nkt33MaxMW.toFixed(2)),
          oil33MW: Number(p.oil33MaxMW.toFixed(2)),
          peakTime: p.peakTime || '',
          fileSource: p.fileSource || '',
          ckt3AtPeakMW: p.ckt3AtPeakMW,
          ckt2AtPeakMW: p.ckt2AtPeakMW,
          nkt33AtPeakMW: p.nkt33AtPeakMW,
          oil33AtPeakMW: p.oil33AtPeakMW,
          ckt3PeakTime: p.ckt3PeakTime || '',
          ckt2PeakTime: p.ckt2PeakTime || '',
          nkt33PeakTime: p.nkt33PeakTime || '',
          oil33PeakTime: p.oil33PeakTime || '',
          worstCaseSumMW: Number(
            (p.ckt3MaxMW + p.ckt2MaxMW + p.nkt33MaxMW + p.oil33MaxMW).toFixed(2)
          ),
          prev_totalIslandMW,
          prev_ckt3MW,
          prev_ckt2MW,
          prev_nkt33MW,
          prev_oil33MW,
          prevYear,
          fiberMaxTempC: p.fiberMaxTempC,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [
    circuitDailyPeaks,
    selectedYear,
    effectiveStartDate,
    effectiveEndDate,
    isPhaseSelectedIfRequired,
    comparisonMode,
    selectedMonth,
    availableYears,
  ]);

  // Dynamic Y-Axis domain for Chart 1 (Fiber Temperature) — optimized to actual data range, never pinned at 85°C
  const chart1YDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    chart1TempData.forEach((row: Record<string, any>) => {
      if (isChronologicalMode) {
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
  }, [chart1TempData, isChronologicalMode, availableYears]);

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
      if (isChronologicalMode) {
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
  }, [chart2PowerData, isChronologicalMode, availableYears, selectedPowerCircuit]);

  // Render marker on multi-year charts to identify Increase (▲) or Decrease (▼) from previous year
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

  // Render YoY comparison marker (▲ / ▼ / ●) on Continuous & Custom Range chronological curves
  const renderChronologicalComparisonMarker = (dataKey: string, strokeColor: string) => {
    return (props: any) => {
      const { cx, cy, payload } = props;
      if (cx === undefined || cy === undefined || !payload) return null;
      const currVal = payload[dataKey];
      if (typeof currVal !== 'number' || Number.isNaN(currVal)) return null;

      const prevVal = payload[`prev_${dataKey}`];
      if (typeof prevVal !== 'number' || Number.isNaN(prevVal)) {
        return (
          <circle
            key={`cdot-${dataKey}-${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r={2.8}
            fill={strokeColor}
            stroke="#0f172a"
            strokeWidth={1.1}
          />
        );
      }

      const diff = currVal - prevVal;
      if (diff > 0.05) {
        return (
          <polygon
            key={`cinc-${dataKey}-${cx}-${cy}`}
            points={`${cx},${cy - 5.5} ${cx - 4.8},${cy + 3.8} ${cx + 4.8},${cy + 3.8}`}
            fill="#10b981"
            stroke="#ffffff"
            strokeWidth={1.2}
          />
        );
      }
      if (diff < -0.05) {
        return (
          <polygon
            key={`cdec-${dataKey}-${cx}-${cy}`}
            points={`${cx},${cy + 5.5} ${cx - 4.8},${cy - 3.8} ${cx + 4.8},${cy - 3.8}`}
            fill="#f43f5e"
            stroke="#ffffff"
            strokeWidth={1.2}
          />
        );
      }
      return (
        <circle
          key={`ceq-${dataKey}-${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r={3}
          fill="#94a3b8"
          stroke="#ffffff"
          strokeWidth={1.1}
        />
      );
    };
  };

  // Shared helper to compute YoY delta badge for a given row, prefix, year, value, and unit
  const buildYoYDeltaBadge = (
    rowObj: Record<string, any>,
    pfx: string,
    yr: string,
    val: number,
    unit: '°C' | 'MW'
  ): React.ReactNode => {
    const yrIdx = availableYears.indexOf(yr);
    if (yrIdx <= 0) return null;
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
    if (prevVal === null) return null;
    const diff = val - prevVal;
    const sign = diff > 0 ? '+' : '';
    const decimals = unit === 'MW' ? 2 : 1;
    if (diff > 0.05) {
      return (
        <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold whitespace-nowrap">
          ▲ {sign}{diff.toFixed(decimals)} {unit} vs {prevYr}
        </span>
      );
    }
    if (diff < -0.05) {
      return (
        <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/40 text-[10px] font-bold whitespace-nowrap">
          ▼ {diff.toFixed(decimals)} {unit} vs {prevYr}
        </span>
      );
    }
    return (
      <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 text-[10px] whitespace-nowrap">
        ● 0.0 {unit} vs {prevYr}
      </span>
    );
  };

  // Shared helper to compute YoY delta badge on chronological (Continuous / Custom Range) rows
  const buildChronologicalDeltaBadge = (
    rowObj: Record<string, any>,
    key: string,
    val: number,
    unit: '°C' | 'MW'
  ): React.ReactNode => {
    const prevVal = rowObj?.[`prev_${key}`];
    const prevYr = rowObj?.prevYear;
    if (typeof prevVal !== 'number' || Number.isNaN(prevVal) || !prevYr) return null;
    const diff = val - prevVal;
    const sign = diff > 0 ? '+' : '';
    const decimals = unit === 'MW' ? 2 : 1;
    if (diff > 0.05) {
      return (
        <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold whitespace-nowrap">
          ▲ {sign}{diff.toFixed(decimals)} {unit} vs {prevYr}
        </span>
      );
    }
    if (diff < -0.05) {
      return (
        <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/40 text-[10px] font-bold whitespace-nowrap">
          ▼ {diff.toFixed(decimals)} {unit} vs {prevYr}
        </span>
      );
    }
    return (
      <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 text-[10px] whitespace-nowrap">
        ● 0.0 {unit} vs {prevYr}
      </span>
    );
  };

  // Build hover-identical tooltip details for a Chart 1 (Fiber Temp) row
  const buildChart1TooltipItems = (rowObj: Record<string, any>) => {
    const items: Array<{
      name: string;
      value: number;
      unit: '°C';
      color: string;
      dataKey: string;
      deltaBadge: React.ReactNode;
      peakTime?: string;
      subDetail?: string;
    }> = [];

    if (!rowObj) return items;

    if (!isChronologicalMode) {
      availableYears.forEach((yr, idx) => {
        const col = getYearColor(yr, idx);
        const tfVal = rowObj[`Tf_${yr}`];
        if (typeof tfVal === 'number' && !Number.isNaN(tfVal)) {
          items.push({
            name: `Year ${yr} Tf (°C)`,
            value: tfVal,
            unit: '°C',
            color: col,
            dataKey: `Tf_${yr}`,
            deltaBadge: buildYoYDeltaBadge(rowObj, 'Tf', yr, tfVal, '°C'),
          });
        }
        const tcVal = rowObj[`Tc_${yr}`];
        if (typeof tcVal === 'number' && !Number.isNaN(tcVal) && tcVal > 0) {
          items.push({
            name: `Year ${yr} Tc (°C)`,
            value: tcVal,
            unit: '°C',
            color: col,
            dataKey: `Tc_${yr}`,
            deltaBadge: buildYoYDeltaBadge(rowObj, 'Tc', yr, tcVal, '°C'),
          });
        }
      });
    } else {
      if (typeof rowObj.tfMax === 'number' && !Number.isNaN(rowObj.tfMax) && rowObj.tfMax > 0) {
        items.push({
          name: 'Daily Peak Fiber Temp (Tf, °C)',
          value: rowObj.tfMax,
          unit: '°C',
          color: '#38bdf8',
          dataKey: 'tfMax',
          deltaBadge: buildChronologicalDeltaBadge(rowObj, 'tfMax', rowObj.tfMax, '°C'),
        });
      }
      if (typeof rowObj.tcMax === 'number' && !Number.isNaN(rowObj.tcMax) && rowObj.tcMax > 0) {
        items.push({
          name: 'Est Conductor Temp (Tc, °C)',
          value: rowObj.tcMax,
          unit: '°C',
          color: '#f59e0b',
          dataKey: 'tcMax',
          deltaBadge: buildChronologicalDeltaBadge(rowObj, 'tcMax', rowObj.tcMax, '°C'),
        });
      }
    }
    return items;
  };

  // Build hover-identical tooltip details for a Chart 2 (Power Records) row (supports 16-column A-P schema)
  const buildChart2TooltipItems = (rowObj: Record<string, any>) => {
    const items: Array<{
      name: string;
      value: number;
      unit: 'MW';
      color: string;
      dataKey: string;
      deltaBadge: React.ReactNode;
      peakTime?: string;
      subDetail?: string;
    }> = [];

    if (!rowObj) return items;

    if (!isChronologicalMode) {
      availableYears.forEach((yr, idx) => {
        const col = getYearColor(yr, idx);
        const islandPeakTime = rowObj[`PeakTime_${yr}`] || '';
        const c3At = rowObj[`Ckt3AtPeak_${yr}`];
        const c2At = rowObj[`Ckt2AtPeak_${yr}`];
        const nktAt = rowObj[`NktAtPeak_${yr}`];
        const oilAt = rowObj[`OilAtPeak_${yr}`];
        const worstCase = rowObj[`WorstCaseSum_${yr}`];

        const pushIfValid = (
          pfx: string,
          seriesName: string,
          seriesColor: string,
          peakTimeStr?: string,
          subDetailStr?: string
        ) => {
          const val = rowObj[`${pfx}_${yr}`];
          if (typeof val === 'number' && !Number.isNaN(val)) {
            items.push({
              name: seriesName,
              value: val,
              unit: 'MW',
              color: seriesColor,
              dataKey: `${pfx}_${yr}`,
              deltaBadge: buildYoYDeltaBadge(rowObj, pfx, yr, val, 'MW'),
              peakTime: peakTimeStr || undefined,
              subDetail: subDetailStr || undefined,
            });
          }
        };

        const totalSubDetail =
          c3At !== undefined
            ? `At ${islandPeakTime || 'Peak'}: Ckt3 ${Number(c3At).toFixed(2)} + Ckt2 ${Number(c2At || 0).toFixed(2)} + NKT ${Number(nktAt || 0).toFixed(2)} + Oil ${Number(oilAt || 0).toFixed(2)} MW${
                worstCase ? ` | Worst-Case (Col I–L): ${Number(worstCase).toFixed(2)} MW` : ''
              }`
            : undefined;

        if (selectedPowerCircuit === 'combination') {
          pushIfValid('Total', `Year ${yr} Combination Total (MW)`, col, islandPeakTime, totalSubDetail);
        } else if (selectedPowerCircuit === 'ckt3') {
          pushIfValid(
            'Ckt3',
            `Year ${yr} 115kV Ckt #3 (MW)`,
            col,
            rowObj[`Ckt3Time_${yr}`],
            c3At !== undefined ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(c3At).toFixed(2)} MW` : undefined
          );
        } else if (selectedPowerCircuit === 'ckt2') {
          pushIfValid(
            'Ckt2',
            `Year ${yr} 115kV Ckt #2 (MW)`,
            col,
            rowObj[`Ckt2Time_${yr}`],
            c2At !== undefined ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(c2At).toFixed(2)} MW` : undefined
          );
        } else if (selectedPowerCircuit === 'nkt33') {
          pushIfValid(
            'Nkt',
            `Year ${yr} 33kV NKT (MW)`,
            col,
            rowObj[`NktTime_${yr}`],
            nktAt !== undefined ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(nktAt).toFixed(2)} MW` : undefined
          );
        } else if (selectedPowerCircuit === 'oil33') {
          pushIfValid(
            'Oil',
            `Year ${yr} 33kV Oil (MW)`,
            col,
            rowObj[`OilTime_${yr}`],
            oilAt !== undefined ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(oilAt).toFixed(2)} MW` : undefined
          );
        } else {
          // all_four
          pushIfValid('Total', `Yr ${yr} Total MW`, col, islandPeakTime, totalSubDetail);
          pushIfValid('Ckt3', `Yr ${yr} Ckt #3`, '#f59e0b', rowObj[`Ckt3Time_${yr}`]);
          pushIfValid('Ckt2', `Yr ${yr} Ckt #2`, '#38bdf8', rowObj[`Ckt2Time_${yr}`]);
          pushIfValid('Nkt', `Yr ${yr} 33kV NKT`, '#6366f1', rowObj[`NktTime_${yr}`]);
          pushIfValid('Oil', `Yr ${yr} 33kV Oil`, '#eab308', rowObj[`OilTime_${yr}`]);
        }
      });
    } else {
      const islandPeakTime = rowObj.peakTime || '';
      const c3At = rowObj.ckt3AtPeakMW;
      const c2At = rowObj.ckt2AtPeakMW;
      const nktAt = rowObj.nkt33AtPeakMW;
      const oilAt = rowObj.oil33AtPeakMW;
      const worstCase = rowObj.worstCaseSumMW;

      const pushContIfValid = (
        key: string,
        seriesName: string,
        seriesColor: string,
        peakTimeStr?: string,
        subDetailStr?: string
      ) => {
        const val = rowObj[key];
        if (typeof val === 'number' && !Number.isNaN(val) && val > 0) {
          items.push({
            name: seriesName,
            value: val,
            unit: 'MW',
            color: seriesColor,
            dataKey: key,
            deltaBadge: buildChronologicalDeltaBadge(rowObj, key, val, 'MW'),
            peakTime: peakTimeStr || undefined,
            subDetail: subDetailStr || undefined,
          });
        }
      };

      const totalSubDetail =
        c3At !== undefined
          ? `At ${islandPeakTime || 'Peak'}: Ckt3 ${Number(c3At).toFixed(2)} + Ckt2 ${Number(c2At || 0).toFixed(2)} + NKT ${Number(nktAt || 0).toFixed(2)} + Oil ${Number(oilAt || 0).toFixed(2)} MW${
              worstCase ? ` | Worst-Case (Col I–L): ${Number(worstCase).toFixed(2)} MW` : ''
            }`
          : undefined;

      if (selectedPowerCircuit === 'combination' || selectedPowerCircuit === 'all_four') {
        pushContIfValid(
          'totalIslandMW',
          'Combination of 4 Circuits (Total Island MW)',
          '#a855f7',
          islandPeakTime,
          totalSubDetail
        );
      }
      if (selectedPowerCircuit === 'ckt3' || selectedPowerCircuit === 'all_four') {
        pushContIfValid(
          'ckt3MW',
          '115kV Circuit #3 Peak (MW)',
          '#f59e0b',
          rowObj.ckt3PeakTime,
          selectedPowerCircuit === 'ckt3' && c3At !== undefined
            ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(c3At).toFixed(2)} MW`
            : undefined
        );
      }
      if (selectedPowerCircuit === 'ckt2' || selectedPowerCircuit === 'all_four') {
        pushContIfValid(
          'ckt2MW',
          '115kV Circuit #2 Peak (MW)',
          '#38bdf8',
          rowObj.ckt2PeakTime,
          selectedPowerCircuit === 'ckt2' && c2At !== undefined
            ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(c2At).toFixed(2)} MW`
            : undefined
        );
      }
      if (selectedPowerCircuit === 'nkt33' || selectedPowerCircuit === 'all_four') {
        pushContIfValid(
          'nkt33MW',
          '33kV NKT Submarine Peak (MW)',
          '#6366f1',
          rowObj.nkt33PeakTime,
          selectedPowerCircuit === 'nkt33' && nktAt !== undefined
            ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(nktAt).toFixed(2)} MW`
            : undefined
        );
      }
      if (selectedPowerCircuit === 'oil33' || selectedPowerCircuit === 'all_four') {
        pushContIfValid(
          'oil33MW',
          '33kV Oil-Filled Submarine Peak (MW)',
          '#eab308',
          rowObj.oil33PeakTime,
          selectedPowerCircuit === 'oil33' && oilAt !== undefined
            ? `At Island Peak (${islandPeakTime || 'Peak'}): ${Number(oilAt).toFixed(2)} MW`
            : undefined
        );
      }
    }

    return items;
  };

  // Compute the highest-value point across the active range for Chart 1 (Fiber Temp)
  const chart1PeakPoint = useMemo(() => {
    const xKey = !isChronologicalMode ? 'monthDay' : 'date';
    let bestVal = -Infinity;
    let bestRow: Record<string, any> | null = null;
    let bestRowIdx = -1;
    let bestColor = '#38bdf8';
    let bestDataKey = '';

    chart1TempData.forEach((row: Record<string, any>, idx: number) => {
      if (!isChronologicalMode) {
        // Prioritize primary solid Fiber Temp (Tf) curve with markers; if Tc is present on the chart, check Tf first so pointer pins directly onto the solid curve marker
        availableYears.forEach((yr, yrIdx) => {
          const col = getYearColor(yr, yrIdx);
          const tf = row[`Tf_${yr}`];
          if (typeof tf === 'number' && !Number.isNaN(tf) && tf > bestVal) {
            bestVal = tf;
            bestRow = row;
            bestRowIdx = idx;
            bestColor = col;
            bestDataKey = `Tf_${yr}`;
          }
        });
      } else {
        const tf = row.tfMax;
        if (typeof tf === 'number' && !Number.isNaN(tf) && tf > bestVal) {
          bestVal = tf;
          bestRow = row;
          bestRowIdx = idx;
          bestColor = '#38bdf8';
          bestDataKey = 'tfMax';
        }
      }
    });

    if (!bestRow || bestVal === -Infinity) return null;
    const xValue = String((bestRow as Record<string, any>)[xKey] || '');
    const items = buildChart1TooltipItems(bestRow);

    return {
      xValue,
      yValue: bestVal,
      row: bestRow,
      rowIndex: bestRowIdx,
      totalRows: chart1TempData.length,
      peakColor: bestColor,
      peakDataKey: bestDataKey,
      unit: '°C' as const,
      items,
    };
  }, [chart1TempData, isChronologicalMode, availableYears]);

  // Compute the highest-value point across the active range for Chart 2 (Power Records)
  const chart2PeakPoint = useMemo(() => {
    const xKey = !isChronologicalMode ? 'monthDay' : 'date';
    let bestVal = -Infinity;
    let bestRow: Record<string, any> | null = null;
    let bestRowIdx = -1;
    let bestColor = '#c084fc';
    let bestDataKey = '';

    chart2PowerData.forEach((row: Record<string, any>, idx: number) => {
      const rowItems = buildChart2TooltipItems(row);
      rowItems.forEach((it) => {
        if (typeof it.value === 'number' && !Number.isNaN(it.value) && it.value > bestVal) {
          bestVal = it.value;
          bestRow = row;
          bestRowIdx = idx;
          bestColor = it.color;
          bestDataKey = it.dataKey;
        }
      });
    });

    if (!bestRow || bestVal === -Infinity) return null;
    const xValue = String((bestRow as Record<string, any>)[xKey] || '');
    const items = buildChart2TooltipItems(bestRow);

    return {
      xValue,
      yValue: bestVal,
      row: bestRow,
      rowIndex: bestRowIdx,
      totalRows: chart2PowerData.length,
      peakColor: bestColor,
      peakDataKey: bestDataKey,
      unit: 'MW' as const,
      items,
    };
  }, [chart2PowerData, isChronologicalMode, availableYears, selectedPowerCircuit]);

  // Dedicated top band height above the chart grid so the Peak Callout Card never overlays the plotted curves by default
  const tempTopBandHeight = useMemo(() => {
    if (!chart1PeakPoint) return 24;
    if (!isTempPeakCardOpen) return 44;
    return Math.max(108, Math.min(168, 56 + chart1PeakPoint.items.length * 23));
  }, [chart1PeakPoint, isTempPeakCardOpen]);

  const powerTopBandHeight = useMemo(() => {
    if (!chart2PeakPoint) return 24;
    if (!isPowerPeakCardOpen) return 44;
    const subDetailCount = chart2PeakPoint.items.filter((it) => Boolean(it.subDetail)).length;
    return Math.max(116, Math.min(210, 58 + chart2PeakPoint.items.length * 23 + subDetailCount * 18));
  }, [chart2PeakPoint, isPowerPeakCardOpen]);

  // Built-in moveable Peak Callout Card renderer (positioned in non-overlapping top band by default, draggable anywhere)
  const renderInChartPeakCallout = (
    peak: {
      xValue: string;
      yValue: number;
      rowIndex: number;
      totalRows: number;
      peakColor: string;
      peakDataKey: string;
      unit: '°C' | 'MW';
      items: Array<{
        name: string;
        value: number;
        unit: '°C' | 'MW';
        color: string;
        dataKey: string;
        deltaBadge: React.ReactNode;
        peakTime?: string;
        subDetail?: string;
      }>;
    },
    isOpen: boolean,
    setIsOpen: (open: boolean) => void,
    offset: { dx: number; dy: number },
    setOffset: React.Dispatch<React.SetStateAction<{ dx: number; dy: number }>>,
    themeVariant: 'cyan' | 'emerald'
  ) => {
    const handleMouseDragStart = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startDx = offset.dx;
      const startDy = offset.dy;

      const onMouseMove = (moveEvent: MouseEvent) => {
        setOffset({
          dx: startDx + (moveEvent.clientX - startX),
          dy: startDy + (moveEvent.clientY - startY),
        });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const handleTouchDragStart = (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation();
      const startX = e.touches[0].clientX;
      const startY = e.touches[0].clientY;
      const startDx = offset.dx;
      const startDy = offset.dy;

      const onTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.touches.length !== 1) return;
        setOffset({
          dx: startDx + (moveEvent.touches[0].clientX - startX),
          dy: startDy + (moveEvent.touches[0].clientY - startY),
        });
      };

      const onTouchEnd = () => {
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      };

      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onTouchEnd);
    };

    return (props: any) => {
      const { cx, cy } = props;
      if (typeof cx !== 'number' || typeof cy !== 'number' || Number.isNaN(cx) || Number.isNaN(cy)) {
        return null;
      }

      const accentStroke = themeVariant === 'cyan' ? '#22d3ee' : '#34d399';
      const borderClass =
        themeVariant === 'cyan' ? 'border-cyan-500/60' : 'border-emerald-500/60';
      const headerTextClass =
        themeVariant === 'cyan' ? 'text-cyan-300' : 'text-emerald-300';
      const badgeBgClass =
        themeVariant === 'cyan'
          ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40'
          : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40';

      // Default position is inside the dedicated non-overlapping top band (y = 4) directly above (cx, cy),
      // so the card NEVER overlays the plotted curves unless the user drags it elsewhere.
      const hasSubDetails = peak.items.some((it) => Boolean(it.subDetail));
      const subDetailCount = peak.items.filter((it) => Boolean(it.subDetail)).length;
      const cardWidth = hasSubDetails ? 390 : 335;
      const estCardHeight = Math.min(290, 52 + peak.items.length * 22 + subDetailCount * 18);
      const baseCardX = Math.max(66, Math.min(cx - cardWidth / 2, 855 - cardWidth));
      const baseCardY = 4;

      const cardX = Math.max(10, baseCardX + offset.dx);
      const cardY = Math.max(2, baseCardY + offset.dy);
      const isMoved = offset.dx !== 0 || offset.dy !== 0;

      // 4-edge smart connector from the card boundary to the highest point (cx, cy)
      const clampedX = Math.max(cardX + 14, Math.min(cx, cardX + cardWidth - 14));
      const clampedY = Math.max(cardY + 14, Math.min(cy, cardY + estCardHeight - 14));
      let connectX = clampedX;
      let connectY = cardY + estCardHeight;

      if (cardY + estCardHeight <= cy) {
        connectX = clampedX;
        connectY = cardY + estCardHeight;
      } else if (cardY >= cy) {
        connectX = clampedX;
        connectY = cardY;
      } else if (cardX + cardWidth <= cx) {
        connectX = cardX + cardWidth;
        connectY = clampedY;
      } else {
        connectX = cardX;
        connectY = clampedY;
      }

      // Arrowhead near (cx, cy) pointing directly at the peak point
      const dx = connectX - cx;
      const dy = connectY - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / len;
      const uy = dy / len;
      const tipX = cx + ux * 8;
      const tipY = cy + uy * 8;
      const baseX = cx + ux * 15;
      const baseY = cy + uy * 15;
      const perpX = -uy * 4;
      const perpY = ux * 4;

      // Closed mini-pill coordinates (also in the non-overlapping top band above cy)
      const closedWidth = 225;
      const baseClosedX = Math.max(66, Math.min(cx - closedWidth / 2, 855 - closedWidth));
      const closedX = Math.max(10, baseClosedX + offset.dx);
      const closedY = Math.max(4, 6 + offset.dy);

      return (
        <g key={`peak-callout-${peak.xValue}-${peak.yValue}`}>
          {/* Outer glowing ring at the highest value point */}
          <circle
            cx={cx}
            cy={cy}
            r={10.5}
            fill={peak.peakColor}
            fillOpacity={0.22}
            stroke={accentStroke}
            strokeWidth={1.6}
            strokeDasharray="3 2"
          />
          {/* Inner crisp ring around the curve marker */}
          <circle
            cx={cx}
            cy={cy}
            r={6}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.8}
          />

          {isOpen ? (
            <>
              {/* Leader line from highest point to the moveable card */}
              <line
                x1={tipX}
                y1={tipY}
                x2={connectX}
                y2={connectY}
                stroke="#020617"
                strokeWidth={3.5}
                strokeLinecap="round"
              />
              <line
                x1={tipX}
                y1={tipY}
                x2={connectX}
                y2={connectY}
                stroke={accentStroke}
                strokeWidth={1.8}
                strokeDasharray="3 2"
                strokeLinecap="round"
              />
              {/* Pointer arrowhead pointing directly at the highest point */}
              <polygon
                points={`${tipX},${tipY} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`}
                fill={accentStroke}
                stroke="#020617"
                strokeWidth={0.8}
              />

              {/* Moveable Card positioned above the curves by default with Drag Handle, Reset, and Close buttons */}
              <foreignObject
                x={cardX}
                y={cardY}
                width={cardWidth}
                height={Math.max(180, estCardHeight + 30)}
                style={{ overflow: 'visible', pointerEvents: 'auto' }}
              >
                <div
                  onMouseDown={handleMouseDragStart}
                  onTouchStart={handleTouchDragStart}
                  onClick={(e) => e.stopPropagation()}
                  title="Drag to move this card anywhere"
                  className={`bg-slate-950/95 backdrop-blur-md border ${borderClass} rounded-xl p-2.5 text-[11px] font-mono shadow-[0_8px_30px_rgba(0,0,0,0.75)] space-y-1.5 cursor-grab active:cursor-grabbing select-none`}
                  style={{ width: `${cardWidth}px`, pointerEvents: 'auto' }}
                >
                  {/* Card Header: Drag Handle + Highest Value Badge + Date/Day + Reset & Close Buttons */}
                  <div className="flex items-center justify-between gap-1.5 border-b border-slate-800 pb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="p-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 shrink-0"
                        title="Drag card to move"
                      >
                        <Move className="w-3 h-3" />
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-extrabold uppercase tracking-wider shrink-0 ${badgeBgClass}`}
                      >
                        ★ Peak
                      </span>
                      <span className={`font-bold truncate ${headerTextClass}`}>
                        Date / Day: {peak.xValue}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isMoved && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOffset({ dx: 0, dy: 0 });
                          }}
                          title="Reset card to default non-overlapping position"
                          className="px-1.5 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-700 text-[9px] font-bold transition-colors cursor-pointer flex items-center gap-0.5"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>Reset</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOpen(false);
                        }}
                        title="Close highest value card"
                        className="px-1.5 py-0.5 rounded-md bg-slate-900 hover:bg-rose-950/80 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-0.5"
                      >
                        <X className="w-3 h-3" />
                        <span>Close</span>
                      </button>
                    </div>
                  </div>

                  {/* Same details that appear on mouse hover for this point */}
                  <div className="space-y-1">
                    {peak.items.map((it, idx) => {
                      const isMaxSeries = it.dataKey === peak.peakDataKey;
                      return (
                        <div
                          key={idx}
                          className={`rounded px-1 py-0.5 ${
                            isMaxSeries ? 'bg-slate-900/90 ring-1 ring-white/15' : ''
                          }`}
                          style={{ color: it.color }}
                        >
                          <div className="flex justify-between items-center gap-1.5">
                            <span className="truncate" title={it.name}>
                              {isMaxSeries ? '★ ' : ''}
                              {it.name}:
                            </span>
                            <div className="flex items-center shrink-0">
                              <span className="font-bold">
                                {it.unit === 'MW' ? Number(it.value).toFixed(2) : it.value} {it.unit}
                              </span>
                              {it.peakTime && (
                                <span className="ml-1 px-1 py-0.2 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[9px]">
                                  @{it.peakTime}
                                </span>
                              )}
                              {it.deltaBadge}
                            </div>
                          </div>
                          {it.subDetail && (
                            <div className="text-[9px] text-slate-400 font-normal pl-2 pt-0.5 leading-tight">
                              {it.subDetail}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </foreignObject>
            </>
          ) : (
            /* Compact Re-Open Pill in the non-overlapping top band with pointer line when closed */
            <>
              <line
                x1={cx}
                y1={cy - 7}
                x2={closedX + closedWidth / 2}
                y2={closedY + 26}
                stroke={accentStroke}
                strokeWidth={1.3}
                strokeDasharray="2 2"
              />
              <foreignObject
                x={closedX}
                y={closedY}
                width={closedWidth}
                height={34}
                style={{ overflow: 'visible', pointerEvents: 'auto' }}
              >
                <div
                  onMouseDown={handleMouseDragStart}
                  onTouchStart={handleTouchDragStart}
                  className={`px-2.5 py-1 rounded-lg bg-slate-950/95 border ${borderClass} text-[10px] font-mono font-bold ${headerTextClass} shadow-lg flex items-center justify-between gap-1.5 whitespace-nowrap cursor-grab active:cursor-grabbing select-none`}
                  style={{ pointerEvents: 'auto' }}
                >
                  <span className="flex items-center gap-1">
                    <Move className="w-2.5 h-2.5 text-slate-400" />
                    <span>★ Peak: {peak.yValue} {peak.unit} ({peak.xValue})</span>
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(true);
                    }}
                    className="px-1.5 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-[9px] cursor-pointer"
                  >
                    Open
                  </button>
                </div>
              </foreignObject>
            </>
          )}
        </g>
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
          <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
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
            <button
              type="button"
              onClick={() => setComparisonMode('custom_range')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                comparisonMode === 'custom_range'
                  ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40 font-bold shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Custom Range
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

          {/* Custom Range Start and End Date Selector */}
          {comparisonMode === 'custom_range' && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.12)]">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] text-amber-300 font-mono font-bold">START:</span>
                <input
                  type="date"
                  value={customStartDate}
                  min={minAvailableDate || undefined}
                  max={maxAvailableDate || undefined}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="text-xs font-mono font-bold text-amber-200 bg-slate-900/90 px-2 py-0.5 rounded-lg border border-amber-500/30 outline-none focus:border-amber-400 cursor-pointer [color-scheme:dark]"
                />
              </div>
              <span className="text-slate-600 font-mono text-xs">→</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-amber-300 font-mono font-bold">END:</span>
                <input
                  type="date"
                  value={customEndDate}
                  min={minAvailableDate || undefined}
                  max={maxAvailableDate || undefined}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="text-xs font-mono font-bold text-amber-200 bg-slate-900/90 px-2 py-0.5 rounded-lg border border-amber-500/30 outline-none focus:border-amber-400 cursor-pointer [color-scheme:dark]"
                />
              </div>
              {minAvailableDate && maxAvailableDate && (
                <button
                  type="button"
                  onClick={() => {
                    const sourceDates = tempAvailableDates.length > 0 ? tempAvailableDates : allAvailableDates;
                    setCustomStartDate(sourceDates[0] || minAvailableDate);
                    setCustomEndDate(sourceDates[sourceDates.length - 1] || maxAvailableDate);
                  }}
                  title="Expand to full available date range"
                  className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-[10px] font-mono font-bold text-slate-300 hover:text-amber-300 border border-slate-700 transition-colors cursor-pointer"
                >
                  Full Range
                </button>
              )}
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
                      : comparisonMode === 'custom_range'
                      ? `Custom Range (${effectiveStartDate || 'Start'} to ${effectiveEndDate || 'End'}) daily measured fiber & conductor temperatures`
                      : 'Chronological timeline of daily measured fiber temperatures'}
                    {isLand && selectedPhase ? ` • [${selectedPhase}]` : ''}
                  </p>
                </div>

                {/* Built-in Peak Card Open/Close Toggle */}
                {chart1PeakPoint && (
                  <button
                    type="button"
                    onClick={() => setIsTempPeakCardOpen((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isTempPeakCardOpen
                        ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                    }`}
                    title="Open or close the built-in highest value card inside the Fiber Temp chart"
                  >
                    {isTempPeakCardOpen ? (
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>
                      Highest Value Card ({chart1PeakPoint.yValue} °C on {chart1PeakPoint.xValue}):{' '}
                      {isTempPeakCardOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                  </button>
                )}
              </div>

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

              <div className="overflow-x-auto w-full pb-2">
                <div
                  style={{
                    minWidth: `${Math.max(900, chart1TempData.length * 16)}px`,
                    height: `${355 + tempTopBandHeight}px`,
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      key={`temp-chart-${selectedSectionId}-${selectedPhase}-${comparisonMode}-${selectedMonth}-${selectedYear}-${effectiveStartDate}-${effectiveEndDate}`}
                      data={chart1TempData}
                      margin={{ top: tempTopBandHeight, right: 30, left: 10, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                      <XAxis
                        dataKey={!isChronologicalMode ? 'monthDay' : 'date'}
                        stroke="#64748b"
                        tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                        interval={
                          comparisonMode === 'same_month'
                            ? 2
                            : comparisonMode === 'year_to_year'
                            ? 14
                            : Math.max(0, Math.floor(chart1TempData.length / 12))
                        }
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
                                if (!isChronologicalMode && dataKey.includes('_') && typeof p.value === 'number') {
                                  const [pfx, yr] = dataKey.split('_');
                                  deltaBadge = buildYoYDeltaBadge(rowObj, pfx, yr, p.value, '°C');
                                } else if (isChronologicalMode && typeof p.value === 'number') {
                                  deltaBadge = buildChronologicalDeltaBadge(rowObj, dataKey, p.value, '°C');
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
                      {!isChronologicalMode ? (
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
                            dot={renderChronologicalComparisonMarker('tfMax', '#38bdf8')}
                            activeDot={{ r: 6 }}
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

                      {chart1PeakPoint && (
                        <ReferenceDot
                          x={chart1PeakPoint.xValue}
                          y={chart1PeakPoint.yValue}
                          r={6}
                          ifOverflow="extendDomain"
                          shape={renderInChartPeakCallout(
                            chart1PeakPoint,
                            isTempPeakCardOpen,
                            setIsTempPeakCardOpen,
                            tempCardOffset,
                            setTempCardOffset,
                            'cyan'
                          )}
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
                      : comparisonMode === 'custom_range'
                      ? `Custom Range (${effectiveStartDate || 'Start'} to ${effectiveEndDate || 'End'}) peak MW load across monitored circuits`
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

                {/* Built-in Peak Card Open/Close Toggle for Power Records */}
                {chart2PeakPoint && (
                  <button
                    type="button"
                    onClick={() => setIsPowerPeakCardOpen((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isPowerPeakCardOpen
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                    }`}
                    title="Open or close the built-in highest value card inside the Power Records chart"
                  >
                    {isPowerPeakCardOpen ? (
                      <Eye className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>
                      Highest Value Card ({chart2PeakPoint.yValue} MW on {chart2PeakPoint.xValue}):{' '}
                      {isPowerPeakCardOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                  </button>
                )}
              </div>

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

              <div className="overflow-x-auto w-full pb-2">
                <div
                  style={{
                    minWidth: `${Math.max(900, chart2PowerData.length * 16)}px`,
                    height: `${355 + powerTopBandHeight}px`,
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      key={`power-chart-${comparisonMode}-${selectedMonth}-${selectedYear}-${effectiveStartDate}-${effectiveEndDate}-${selectedPowerCircuit}`}
                      data={chart2PowerData}
                      margin={{ top: powerTopBandHeight, right: 30, left: 10, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                      <XAxis
                        dataKey={!isChronologicalMode ? 'monthDay' : 'date'}
                        stroke="#64748b"
                        tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                        interval={
                          comparisonMode === 'same_month'
                            ? 2
                            : comparisonMode === 'year_to_year'
                            ? 14
                            : Math.max(0, Math.floor(chart2PowerData.length / 12))
                        }
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
                          const hoverItems = buildChart2TooltipItems(rowObj);
                          return (
                            <div className="bg-slate-950/95 border border-emerald-500/40 rounded-xl p-3 text-xs font-mono shadow-2xl space-y-1.5 min-w-[290px]">
                              <div className="font-bold text-emerald-300 border-b border-slate-800 pb-1">
                                Date / Day: {label}
                              </div>
                              {hoverItems.map((it, idx) => (
                                <div key={idx} className="space-y-0.5" style={{ color: it.color }}>
                                  <div className="flex justify-between items-center gap-2">
                                    <span>{it.name}:</span>
                                    <div className="flex items-center">
                                      <span className="font-bold">
                                        {Number(it.value).toFixed(2)} {it.unit}
                                      </span>
                                      {it.peakTime && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[10px]">
                                          @{it.peakTime}
                                        </span>
                                      )}
                                      {it.deltaBadge}
                                    </div>
                                  </div>
                                  {it.subDetail && (
                                    <div className="text-[10px] text-slate-400 font-normal pl-2 leading-tight">
                                      {it.subDetail}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 10, fontFamily: 'monospace', fontSize: 11 }}
                      />

                      {!isChronologicalMode ? (
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
                              <Line
                                type="monotone"
                                dataKey={`Nkt_${yr}`}
                                name={`Yr ${yr} 33kV NKT`}
                                stroke="#6366f1"
                                strokeWidth={1.5}
                                strokeDasharray="2 2"
                                dot={renderPowerComparisonMarker('Nkt', idx, '#6366f1')}
                                connectNulls
                              />
                              <Line
                                type="monotone"
                                dataKey={`Oil_${yr}`}
                                name={`Yr ${yr} 33kV Oil`}
                                stroke="#eab308"
                                strokeWidth={1.5}
                                strokeDasharray="2 2"
                                dot={renderPowerComparisonMarker('Oil', idx, '#eab308')}
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
                              dot={renderChronologicalComparisonMarker('totalIslandMW', '#a855f7')}
                              activeDot={{ r: 6 }}
                            />
                          )}
                          {(selectedPowerCircuit === 'ckt3' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="ckt3MW"
                              name="115kV Circuit #3 Peak (MW)"
                              stroke="#f59e0b"
                              strokeWidth={2.6}
                              dot={
                                selectedPowerCircuit === 'ckt3'
                                  ? renderChronologicalComparisonMarker('ckt3MW', '#f59e0b')
                                  : false
                              }
                              activeDot={{ r: 6 }}
                            />
                          )}
                          {(selectedPowerCircuit === 'ckt2' || selectedPowerCircuit === 'all_four') && (
                            <Line
                              type="monotone"
                              dataKey="ckt2MW"
                              name="115kV Circuit #2 Peak (MW)"
                              stroke="#38bdf8"
                              strokeWidth={2.6}
                              dot={
                                selectedPowerCircuit === 'ckt2'
                                  ? renderChronologicalComparisonMarker('ckt2MW', '#38bdf8')
                                  : false
                              }
                              activeDot={{ r: 6 }}
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
                              dot={
                                selectedPowerCircuit === 'nkt33'
                                  ? renderChronologicalComparisonMarker('nkt33MW', '#6366f1')
                                  : false
                              }
                              activeDot={{ r: 6 }}
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
                              dot={
                                selectedPowerCircuit === 'oil33'
                                  ? renderChronologicalComparisonMarker('oil33MW', '#eab308')
                                  : false
                              }
                              activeDot={{ r: 6 }}
                            />
                          )}
                        </>
                      )}

                      {chart2PeakPoint && (
                        <ReferenceDot
                          x={chart2PeakPoint.xValue}
                          y={chart2PeakPoint.yValue}
                          r={6}
                          ifOverflow="extendDomain"
                          shape={renderInChartPeakCallout(
                            chart2PeakPoint,
                            isPowerPeakCardOpen,
                            setIsPowerPeakCardOpen,
                            powerCardOffset,
                            setPowerCardOffset,
                            'emerald'
                          )}
                        />
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
