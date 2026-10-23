import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from 'recharts';
import {
  ShieldAlert,
  AlertTriangle,
  Sparkles,
  Printer,
  Zap,
  Wrench,
  Layers,
  Activity,
  ArrowRight,
  Calendar,
  Clock,
  Loader2,
  Plane,
  Users,
  Sun,
  Sliders,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  CableSectionInfo,
  ConductorEquationName,
  evaluateSectionConductorTemp,
  THERMAL_ZONE_CRITERIA,
  getThermalZoneInfo,
  ThermalZoneInfo,
} from '../data/cableCircuitStructure';
import { ParsedTeprFile, ScannedFileMeta } from '../services/teprParser';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import { getMasterSectionPeak } from '../services/masterSectionSummary';
import {
  runSystemRiskAiReport,
  exportEngineeringReportToPdf,
} from '../services/agentApi';

interface RiskManagementPageProps {
  parsedFiles: ParsedTeprFile[];
  allParsedFiles?: ParsedTeprFile[];
  scannedFiles?: ScannedFileMeta[];
  powerSummariesByDate: Map<string, DailyPowerSummary>;
  activeDateFilter?: string;
  onNavigateToSectionAnalysis?: (sectionId: string) => void;
  showNotification: (type: 'success' | 'error', message: string) => void;
}

export interface PhasePeakDetail {
  phaseCode: 'A' | 'B' | 'C' | 'SM';
  phaseLabel: string;
  channel: number;
  maxTf: number | null;
  maxTc: number | null;
  posCode: string;
  dof: number;
  fileName: string;
  dateTimeStr: string;
}

interface ScenarioFactors {
  flightGrowthPct: number; // Flights to USM (Koh Samui) & Ferry Transfers
  touristGrowthPct: number; // Tourists to Samui, Pha Ngan (Full Moon), Koh Tao
  populationGrowthPct: number; // Annualized local & commercial growth
  ambientTempDeltaC: number; // Weather / Soil / Seabed temperature anomaly (°C)
  ckt3LoadSharePct: number; // 115kV Ckt #3 share of 115kV backbone (%)
  includeFullMoonPeak: boolean;
}

interface AppliedScenarioConfig {
  horizonDays: number; // 0 = Turn Off (Actual Recorded Only), 7, 14, 30
  presetId: string;
  presetName: string;
  factors: ScenarioFactors;
}

const PRESET_SCENARIOS: Array<{
  id: string;
  name: string;
  badge: string;
  factors: ScenarioFactors;
}> = [
  {
    id: 'baseline',
    name: 'Baseline Growth Trend',
    badge: 'Standard',
    factors: {
      flightGrowthPct: 10,
      touristGrowthPct: 12,
      populationGrowthPct: 3.5,
      ambientTempDeltaC: 0.8,
      ckt3LoadSharePct: 50,
      includeFullMoonPeak: true,
    },
  },
  {
    id: 'high_tourism',
    name: 'Peak Island Tourism & Full Moon Surge',
    badge: 'Samui / Pha Ngan / Tao',
    factors: {
      flightGrowthPct: 28,
      touristGrowthPct: 35,
      populationGrowthPct: 5.0,
      ambientTempDeltaC: 1.8,
      ckt3LoadSharePct: 54,
      includeFullMoonPeak: true,
    },
  },
  {
    id: 'heatwave',
    name: 'El Niño Summer Heatwave + High Load',
    badge: 'Thermal Stress',
    factors: {
      flightGrowthPct: 22,
      touristGrowthPct: 25,
      populationGrowthPct: 4.2,
      ambientTempDeltaC: 3.2,
      ckt3LoadSharePct: 56,
      includeFullMoonPeak: true,
    },
  },
  {
    id: 'contingency',
    name: 'Ckt #2 Derating / N-1 Load Shift',
    badge: 'Grid Contingency',
    factors: {
      flightGrowthPct: 15,
      touristGrowthPct: 18,
      populationGrowthPct: 4.0,
      ambientTempDeltaC: 1.5,
      ckt3LoadSharePct: 68,
      includeFullMoonPeak: true,
    },
  },
];

interface SectionRiskAssessment {
  sectionId: string;
  name: string;
  subtitle: string;
  category: 'land' | 'submarine';
  sectionType: 'normal' | 'special';
  equationName: ConductorEquationName;
  startDof: number;
  endDof: number;
  lengthMeters: number;
  hasRealTeprData: boolean;
  currentTfMax: number;
  currentTfMin: number;
  currentTfAvg: number;
  currentTcMax: number;
  deltaTcMinusTf: number;
  governingTfMax: number;
  governingTcMax: number;
  identifiedPhase: string; // e.g., 'Phase A (CH 0)' | 'Phase B (CH 1)' | 'Phase C (CH 2)' | 'Submarine (CH 3)'
  identifiedPhaseShort: string; // e.g., 'Phase A (CH 0)' | 'Phase B (CH 1)' | 'Phase C (CH 2)' | 'Phase SM (CH 3)'
  identifiedChannel: number; // 0 | 1 | 2 | 3
  peakPosCode: string; // e.g., 'TJ1-Point 6'
  peakDof: number; // e.g., 3464.56
  peakFileName: string; // e.g., 'Temp_Jan011646_413011.tepr'
  phaseBreakdown: PhasePeakDetail[];
  tcRecordDateTime: string;
  tcRecordDateKey: string;
  peakPowerCkt3MW: number;
  peakPowerCkt2MW: number;
  peakPower33NktMW: number;
  peakPower33OilMW: number;
  peakPowerTotalIslandMW: number;
  projectedTfMax: number;
  projected30dTcMax: number;
  projectedPowerCkt3MW: number;
  projectedPowerTotalMW: number;
  heatingRatePerWeek: number;
  marginToAlert55: number;
  marginToDanger60: number;
  marginToCritical70: number;
  currentZone: ThermalZoneInfo;
  projectedZone: ThermalZoneInfo;
  governingZone: ThermalZoneInfo;
  sriScore: number; // 0 - 100 Composite Risk Score
  likelihoodLevel: 1 | 2 | 3 | 4 | 5;
  consequenceLevel: 1 | 2 | 3 | 4 | 5;
  rootCauseCategory: string;
  standardReference: string;
  shortTermAction: string;
  mediumLongTermAction: string;
}

function getSectionDofBounds(sectionId: string): { startDof: number; endDof: number } {
  const pts = CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === sectionId);
  if (pts.length === 0) return { startDof: 2020.94, endDof: 3464.56 };
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    if (p.dof < min) min = p.dof;
    if (p.dof > max) max = p.dof;
  }
  return { startDof: min, endDof: max };
}

function getSectionLoadSensitivity(sec: CableSectionInfo): number {
  if (sec.sectionType === 'special') {
    if (sec.name.includes('TJ1') || sec.name.includes('TJ2')) return 0.15;
    if (sec.name.includes('XPWA') || sec.name.includes('Pipeline')) return 0.16;
    if (sec.name.includes('Crossing') || sec.name.includes('X33kV')) return 0.14;
    if (sec.name.includes('JP1') || sec.name.includes('JP2')) return 0.13;
    if (sec.name.includes('NX') || sec.name.includes('FR')) return 0.08;
    return 0.12;
  }
  return sec.category === 'land' ? 0.11 : 0.06;
}

function resolveSynchronizedPowerAtTimestamp(
  summary: DailyPowerSummary | undefined,
  timeStr: string | undefined,
  fallbackMetrics: {
    pCkt3MW: number;
    pCkt2MW: number;
    p33NktMW: number;
    p33OilMW: number;
    pTotalIslandMW: number;
  }
): {
  pCkt3MW: number;
  pCkt2MW: number;
  p33NktMW: number;
  p33OilMW: number;
  pTotalIslandMW: number;
} {
  if (!summary) return fallbackMetrics;

  if (timeStr && summary.dataPoints && summary.dataPoints.length > 0) {
    const m = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const targetMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      let bestSlot = summary.dataPoints[0];
      let bestDiff = Infinity;
      for (const slot of summary.dataPoints) {
        const slotMin =
          typeof slot.timeMinutes === 'number'
            ? slot.timeMinutes
            : (() => {
                const sm = slot.time?.match(/(\d{1,2}):(\d{2})/);
                return sm ? parseInt(sm[1], 10) * 60 + parseInt(sm[2], 10) : Infinity;
              })();
        const diff = Math.abs(slotMin - targetMin);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSlot = slot;
        }
      }
      if (bestSlot && bestDiff <= 60) {
        const pCkt3MW = Number(
          (bestSlot.kmbCircuit3 ?? summary.metrics?.circuit_115kv_3?.peakMW ?? fallbackMetrics.pCkt3MW).toFixed(2)
        );
        const pCkt2MW = Number(
          (bestSlot.kmaCircuit2 ?? summary.metrics?.circuit_115kv_2?.peakMW ?? fallbackMetrics.pCkt2MW).toFixed(2)
        );
        const p33NktMW = Number(
          (bestSlot.knaNkt ?? summary.metrics?.circuit_33kv_nkt?.peakMW ?? fallbackMetrics.p33NktMW).toFixed(2)
        );
        const p33OilMW = Number(
          (bestSlot.knaOilFilled ?? summary.metrics?.circuit_33kv_oil?.peakMW ?? fallbackMetrics.p33OilMW).toFixed(2)
        );
        const pTotalIslandMW = Number(
          (bestSlot.totalPower ?? pCkt3MW + pCkt2MW + p33NktMW + p33OilMW).toFixed(2)
        );
        return { pCkt3MW, pCkt2MW, p33NktMW, p33OilMW, pTotalIslandMW };
      }
    }
  }

  const pCkt3MW = Number((summary.metrics?.circuit_115kv_3?.peakMW ?? fallbackMetrics.pCkt3MW).toFixed(2));
  const pCkt2MW = Number((summary.metrics?.circuit_115kv_2?.peakMW ?? fallbackMetrics.pCkt2MW).toFixed(2));
  const p33NktMW = Number((summary.metrics?.circuit_33kv_nkt?.peakMW ?? fallbackMetrics.p33NktMW).toFixed(2));
  const p33OilMW = Number((summary.metrics?.circuit_33kv_oil?.peakMW ?? fallbackMetrics.p33OilMW).toFixed(2));
  const pTotalIslandMW = Number((summary.metrics?.total?.peakMW ?? pCkt3MW + pCkt2MW + p33NktMW + p33OilMW).toFixed(2));
  return { pCkt3MW, pCkt2MW, p33NktMW, p33OilMW, pTotalIslandMW };
}

function getBottleneckEngineeringGuidance(sec: CableSectionInfo): {
  rootCauseCategory: string;
  standardReference: string;
  shortTermAction: string;
  mediumLongTermAction: string;
  consequenceLevel: 1 | 2 | 3 | 4 | 5;
} {
  if (sec.sectionId === '2.3' || sec.name.includes('XPWA')) {
    return {
      rootCauseCategory:
        'Deep Trench / Concrete Duct Thermal Bottleneck (High T4 at Water Pipeline XPWA Crossing)',
      standardReference: 'IEC 60287-2-1 Clause 2.2.7 & IEEE Std 835 (Duct Bank T4)',
      shortTermAction:
        'Shift 6–8 MW from 115kV Ckt #3 (KMB) to 115kV Ckt #2 (KMA) during 18:30–22:30 peak when Tc approaches 55°C Alert Zone.',
      mediumLongTermAction:
        'Inject bentonite / low-resistivity thermal grout into conduit annulus at XPWA crossing and verify soil moisture retention to prevent dry-out (>50°C).',
      consequenceLevel: 5,
    };
  }
  if (sec.sectionId === '1.6' || sec.sectionId === '2.13' || sec.name.includes('TJ1') || sec.name.includes('TJ2')) {
    return {
      rootCauseCategory:
        'Land–Sea Transition Vault (TJ1/TJ2) Insulation & Armour Loss Concentration',
      standardReference: 'CIGRE TB 852 & CIGRE TB 610 (Transition Joint Thermal Design)',
      shortTermAction:
        'Inspect TJ1/TJ2 joint bay ventilation & ground bonding currents; apply IEC 60853-2 cyclic rating cap during daytime solar heating.',
      mediumLongTermAction:
        'Install forced/passive heat-pipe ventilation or backfill joint pit with Fluidized Thermal Backfill (FTB, ρ ≤ 0.6 K·m/W).',
      consequenceLevel: 5,
    };
  }
  if (sec.sectionId === '2.11' || sec.name.includes('33kV Crossing') || sec.name.includes('X33kV')) {
    return {
      rootCauseCategory:
        'Mutual Electromagnetic & Thermal Cross-Heating with 33kV Distribution Circuits',
      standardReference: 'IEC 60287-2-1 (Mutual Heating Δθm) & IEEE Std 835',
      shortTermAction:
        'Coordinate KNA 33kV NKT & 33kV Oil circuit dispatch so peak 33kV loading does not coincide with 115kV Ckt #3 peak.',
      mediumLongTermAction:
        'Insert high-conductivity thermal barrier or increase vertical separation fill with engineered thermal sand.',
      consequenceLevel: 4,
    };
  }
  if (sec.sectionId === '1.2' || sec.sectionId === '1.4' || sec.name.includes('JP1') || sec.name.includes('JP2')) {
    return {
      rootCauseCategory:
        'Conduit Air-Gap Thermal Resistance (T4,duct) & Joint Pit JP1/JP2 Localized Heating',
      standardReference: 'IEC 60287-2-1 & IEC 60853-2 (Conduit Cyclic Rating)',
      shortTermAction:
        'Balance 115kV Ckt #2 and Ckt #3 to 50:50 load ratio and monitor DTS gradient across Joint Pits JP1/JP2.',
      mediumLongTermAction:
        'Seal duct ends against silt ingress and replace native backfill over JP1/JP2 with certified thermal backfill.',
      consequenceLevel: 4,
    };
  }
  if (sec.category === 'land') {
    return {
      rootCauseCategory:
        'Soil Moisture Migration & Ambient Solar Heating Along Land Route',
      standardReference: 'IEC 60287-1-1 Clause 1.4.2 (Two-Zone Soil Drying Model)',
      shortTermAction:
        'Maintain conductor temperature below 55°C Alert threshold to prevent critical soil moisture migration.',
      mediumLongTermAction:
        'Periodic right-of-way (ROW) inspection for surface paving, deep-rooted vegetation, or soil cover changes.',
      consequenceLevel: 3,
    };
  }
  // Submarine
  return {
    rootCauseCategory:
      'Subsea Burial Depth / Subsea Joint (NX/FR) Sediment Blanket Monitoring',
    standardReference: 'CIGRE TB 496 / TB 610 & IEEE Std 1120 (Submarine Cable Burial)',
    shortTermAction:
      'Continuous DTS monitoring across Subsea Joints (NX1, FR1, FR2, NX2) for any sudden ΔT step indicative of excess silt burial.',
    mediumLongTermAction:
      'Annual ROV / multibeam bathymetric survey to verify seabed burial depth (target 1.0–1.5 m) and check for free-spans or sand waves.',
    consequenceLevel: 4,
  };
}

export const RiskManagementPage: React.FC<RiskManagementPageProps> = ({
  parsedFiles,
  allParsedFiles,
  scannedFiles,
  powerSummariesByDate,
  activeDateFilter,
  onNavigateToSectionAnalysis,
  showNotification,
}) => {
  const [filterCategory, setFilterCategory] = useState<'ALL' | 'land' | 'submarine'>('ALL');
  const [selectedCardSectionId, setSelectedCardSectionId] = useState<string>('');
  const [aiRiskReport, setAiRiskReport] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiProcessedAt, setAiProcessedAt] = useState<string>('');

  // Staged Multi-Factor Future Forecast & 4 Scenario Simulation state (User selects before clicking "Risk Analyzing")
  const [pendingHorizonDays, setPendingHorizonDays] = useState<number>(0); // 0 = Turn Off (Actual Recorded Only)
  const [pendingPresetId, setPendingPresetId] = useState<string>('baseline');
  const [pendingScenarioFactors, setPendingScenarioFactors] = useState<ScenarioFactors>({
    ...PRESET_SCENARIOS[0].factors,
  });

  // Applied Scenario Config committed when user clicks "Risk Analyzing"
  const [appliedScenarioConfig, setAppliedScenarioConfig] = useState<AppliedScenarioConfig>({
    horizonDays: 0,
    presetId: 'baseline',
    presetName: PRESET_SCENARIOS[0].name,
    factors: { ...PRESET_SCENARIOS[0].factors },
  });

  const handleSelectPreset = (presetId: string) => {
    const found = PRESET_SCENARIOS.find((p) => p.id === presetId);
    if (found) {
      setPendingPresetId(found.id);
      setPendingScenarioFactors({ ...found.factors });
    }
  };

  const sourceFiles = useMemo(() => {
    return allParsedFiles && allParsedFiles.length > 0 ? allParsedFiles : parsedFiles;
  }, [allParsedFiles, parsedFiles]);

  // Active Day Power Summary Metrics
  const powerMetrics = useMemo(() => {
    let summary: DailyPowerSummary | undefined;
    if (activeDateFilter && powerSummariesByDate.has(activeDateFilter)) {
      summary = powerSummariesByDate.get(activeDateFilter);
    } else if (powerSummariesByDate.size > 0) {
      const keys = Array.from(powerSummariesByDate.keys()).sort();
      summary = powerSummariesByDate.get(keys[keys.length - 1]);
    }

    const pCkt3MW = Number(
      (summary?.metrics?.circuit_115kv_3?.peakMW || 35.8).toFixed(2)
    );
    const pCkt2MW = Number(
      (summary?.metrics?.circuit_115kv_2?.peakMW || 34.48).toFixed(2)
    );
    const p33NktMW = Number(
      (summary?.metrics?.circuit_33kv_nkt?.peakMW || 9.91).toFixed(2)
    );
    const p33OilMW = Number(
      (summary?.metrics?.circuit_33kv_oil?.peakMW || 8.31).toFixed(2)
    );
    const pTotalIslandMW = Number(
      (
        summary?.metrics?.total?.peakMW ||
        pCkt3MW + pCkt2MW + p33NktMW + p33OilMW
      ).toFixed(2)
    );

    return {
      dateKey: summary?.dateKey || activeDateFilter || 'Current Assessment',
      pCkt3MW,
      pCkt2MW,
      p33NktMW,
      p33OilMW,
      pTotalIslandMW,
    };
  }, [powerSummariesByDate, activeDateFilter]);

  // Distinct available dates extracted across all scanned TEPR records, folder metadata, and SCADA power summaries
  const allAvailableDates = useMemo(() => {
    const datesSet = new Set<string>();

    scannedFiles?.forEach((f) => {
      if (f.dateMeta?.dateKey && f.dateMeta.dateKey.match(/^\d{4}-\d{2}-\d{2}$/)) {
        datesSet.add(f.dateMeta.dateKey);
      }
    });

    sourceFiles.forEach((f) => {
      if (f.dateMeta?.dateKey && f.dateMeta.dateKey.match(/^\d{4}-\d{2}-\d{2}$/)) {
        datesSet.add(f.dateMeta.dateKey);
      }
    });

    powerSummariesByDate.forEach((_, key) => {
      if (key && key.match(/^\d{4}-\d{2}-\d{2}$/)) {
        datesSet.add(key);
      }
    });

    const sorted = Array.from(datesSet).sort();
    if (sorted.length === 0) {
      const fallback = activeDateFilter && activeDateFilter !== 'all' ? activeDateFilter : '2026-01-01';
      return [fallback];
    }
    return sorted;
  }, [scannedFiles, sourceFiles, powerSummariesByDate, activeDateFilter]);

  // Default Start Date synchronized with Page 1's focused activeDateFilter
  const defaultStartDate = useMemo(() => {
    if (activeDateFilter && activeDateFilter !== 'all' && allAvailableDates.includes(activeDateFilter)) {
      return activeDateFilter;
    }
    return allAvailableDates[0] || '2026-01-01';
  }, [activeDateFilter, allAvailableDates]);

  // Adjustable Assessment Period State (Start Date & End Date)
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedDateRange, setAppliedDateRange] = useState<{ start: string; end: string } | null>(null);

  const activeStartDate = customStartDate || defaultStartDate;

  // Generate sequence of up to 30 calendar days [activeStartDate → activeStartDate + 30 days]
  const generate30DaySequence = (startStr: string): string[] => {
    const dates: string[] = [];
    if (!startStr || !startStr.match(/^\d{4}-\d{2}-\d{2}$/)) return [startStr || '2026-01-01'];
    const parts = startStr.split('-');
    const baseYear = Number(parts[0]);
    const baseMonth = Number(parts[1]) - 1;
    const baseDay = Number(parts[2]);

    for (let i = 0; i <= 30; i++) {
      const d = new Date(Date.UTC(baseYear, baseMonth, baseDay + i));
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  };

  // Allowed End Dates restricted to max +30 days sequence starting from activeStartDate
  const allowedEndDates = useMemo(() => {
    const sequence30d = generate30DaySequence(activeStartDate);
    const combinedSet = new Set<string>([...sequence30d]);

    const max30dStr = sequence30d[sequence30d.length - 1];
    allAvailableDates.forEach((d) => {
      if (d >= activeStartDate && d <= max30dStr) {
        combinedSet.add(d);
      }
    });

    return Array.from(combinedSet).sort();
  }, [activeStartDate, allAvailableDates]);

  const activeEndDate = useMemo(() => {
    if (customEndDate && allowedEndDates.includes(customEndDate)) {
      return customEndDate;
    }
    if (activeDateFilter && activeDateFilter !== 'all' && !customEndDate) {
      return activeStartDate;
    }
    return allowedEndDates[allowedEndDates.length - 1];
  }, [customEndDate, allowedEndDates, activeDateFilter, activeStartDate]);

  useEffect(() => {
    if (!customStartDate) {
      setCustomStartDate(defaultStartDate);
    }
  }, [defaultStartDate, customStartDate]);

  useEffect(() => {
    if (!appliedDateRange && activeStartDate && activeEndDate) {
      setAppliedDateRange({ start: activeStartDate, end: activeEndDate });
    }
  }, [activeStartDate, activeEndDate, appliedDateRange]);

  const effectiveStartDate = appliedDateRange?.start || activeStartDate;
  const effectiveEndDate = appliedDateRange?.end || activeEndDate;

  // Check if user has modified date range or scenario parameters that are waiting for "Risk Analyzing" click
  const hasPendingChanges = useMemo(() => {
    if (activeStartDate !== effectiveStartDate || activeEndDate !== effectiveEndDate) return true;
    if (pendingHorizonDays !== appliedScenarioConfig.horizonDays) return true;
    if (pendingPresetId !== appliedScenarioConfig.presetId) return true;
    const f1 = pendingScenarioFactors;
    const f2 = appliedScenarioConfig.factors;
    return (
      f1.flightGrowthPct !== f2.flightGrowthPct ||
      f1.touristGrowthPct !== f2.touristGrowthPct ||
      f1.populationGrowthPct !== f2.populationGrowthPct ||
      f1.ambientTempDeltaC !== f2.ambientTempDeltaC ||
      f1.ckt3LoadSharePct !== f2.ckt3LoadSharePct ||
      f1.includeFullMoonPeak !== f2.includeFullMoonPeak
    );
  }, [
    activeStartDate,
    activeEndDate,
    effectiveStartDate,
    effectiveEndDate,
    pendingHorizonDays,
    pendingPresetId,
    pendingScenarioFactors,
    appliedScenarioConfig,
  ]);

  // Risk Analyzing Popup Modal State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [analysisStage, setAnalysisStage] = useState<string>('');

  const handleStartRiskAnalyzing = () => {
    const sDate = activeStartDate;
    const eDate = activeEndDate;
    const nextHorizon = pendingHorizonDays;
    const nextPresetId = pendingPresetId;
    const matchedPreset = PRESET_SCENARIOS.find((p) => p.id === nextPresetId);
    const nextPresetName = matchedPreset ? matchedPreset.name : 'Custom Multi-Factor Scenario';
    const nextFactors = { ...pendingScenarioFactors };

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStage(`Scanning discrete DOF positions & Channel/Phase headers (${sDate} to ${eDate})...`);

    let current = 0;
    const interval = setInterval(() => {
      current += 10;
      if (current <= 25) {
        setAnalysisStage(`Reading TEPR fiber temperature (Tf) at discrete DOFs & identifying Phase (CH 0/1/2/3)...`);
      } else if (current <= 50) {
        setAnalysisStage(`Synchronizing 4-Circuit SCADA power flow at peak Tf timestamp...`);
      } else if (current <= 75) {
        setAnalysisStage(
          nextHorizon > 0
            ? `Applying ${nextPresetName} (+${nextHorizon}d Forecast) & Core Conductor Estimation...`
            : `Calculating Core Conductor Temperature (Tc) from Actual Recorded Fiber Temp (Tf)...`
        );
      } else if (current < 100) {
        setAnalysisStage(`Computing System Risk Index (SRI) & thermal margins...`);
      } else {
        setAnalysisStage(`Risk Analysis Complete!`);
      }

      setAnalysisProgress(Math.min(current, 100));

      if (current >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setAppliedDateRange({ start: sDate, end: eDate });
          setAppliedScenarioConfig({
            horizonDays: nextHorizon,
            presetId: nextPresetId,
            presetName: nextPresetName,
            factors: nextFactors,
          });
          setIsAnalyzing(false);
          showNotification(
            'success',
            nextHorizon > 0
              ? `Risk Analysis completed for ${sDate} to ${eDate} with +${nextHorizon}d ${nextPresetName}!`
              : `Risk Analysis completed for ${sDate} to ${eDate} (Actual Recorded Data)!`
          );
        }, 500);
      }
    }, 120);
  };

  // Overall Risk Assessment Date Period Summary
  const assessmentDatePeriod = useMemo(() => {
    const matchingDays = allAvailableDates.filter(
      (d) => d >= effectiveStartDate && d <= effectiveEndDate
    );
    return {
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      displayRange: `Assessment Period: From ${effectiveStartDate} To ${effectiveEndDate}`,
      shortRange: `From ${effectiveStartDate} To ${effectiveEndDate}`,
      totalDays: matchingDays.length > 0 ? matchingDays.length : 1,
    };
  }, [effectiveStartDate, effectiveEndDate, allAvailableDates]);

  // Source files filtered specifically by the chosen Risk Assessment Date Period
  const periodFilteredFiles = useMemo(() => {
    const filtered = sourceFiles.filter((f) => {
      const dateKey = f.dateMeta?.dateKey;
      if (!dateKey) return true;
      return dateKey >= effectiveStartDate && dateKey <= effectiveEndDate;
    });
    return filtered.length > 0 ? filtered : sourceFiles;
  }, [sourceFiles, effectiveStartDate, effectiveEndDate]);

  // Evaluate All 19 Sections (CIRCUIT_3_SECTIONS) using STRICT Discrete DOF Sampling Points,
  // Channel-to-Phase Identification (CH 0 = Phase A, CH 1 = Phase B, CH 2 = Phase C, CH 3 = Submarine),
  // Core Conductor Temperature Estimation, and Applied Multi-Factor Scenario Simulation
  const sectionRisks = useMemo<SectionRiskAssessment[]>(() => {
    const candidateDates = allAvailableDates.filter(
      (d) => d >= effectiveStartDate && d <= effectiveEndDate
    );
    const datesToCheck = candidateDates.length > 0 ? candidateDates : [effectiveStartDate];

    const { horizonDays, factors } = appliedScenarioConfig;

    return CIRCUIT_3_SECTIONS.map((sec) => {
      const bounds = getSectionDofBounds(sec.sectionId);
      const sectionPoints = CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === sec.sectionId);
      const isSubmarineSec = sec.category === 'submarine';

      // Track per-phase peak details: A (CH 0), B (CH 1), C (CH 2) for land; SM (CH 3) for submarine
      const phasePhases: Array<{ code: 'A' | 'B' | 'C' | 'SM'; label: string; channel: number }> = isSubmarineSec
        ? [{ code: 'SM', label: 'Submarine (CH 3)', channel: 3 }]
        : [
            { code: 'A', label: 'Phase A (CH 0)', channel: 0 },
            { code: 'B', label: 'Phase B (CH 1)', channel: 1 },
            { code: 'C', label: 'Phase C (CH 2)', channel: 2 },
          ];

      const phaseMap = new Map<'A' | 'B' | 'C' | 'SM', PhasePeakDetail>();
      for (const ph of phasePhases) {
        const defaultPt = sectionPoints.find((p) => (isSubmarineSec ? true : p.phase === ph.code)) || sectionPoints[0];
        phaseMap.set(ph.code, {
          phaseCode: ph.code,
          phaseLabel: ph.label,
          channel: ph.channel,
          maxTf: null,
          maxTc: null,
          posCode: defaultPt?.pos || `${sec.sectionId}`,
          dof: defaultPt?.dof || bounds.startDof,
          fileName: '',
          dateTimeStr: '',
        });
      }

      let measuredMaxTf: number | null = null;
      let measuredMinTf: number | null = null;
      let sumTf = 0;
      let countTf = 0;

      let winningPhaseCode: 'A' | 'B' | 'C' | 'SM' = isSubmarineSec ? 'SM' : 'A';
      let winningPhaseLabel = isSubmarineSec ? 'Submarine (CH 3)' : 'Phase A (CH 0)';
      let winningChannel = isSubmarineSec ? 3 : 0;
      let winningPosCode = sectionPoints[0]?.pos || sec.sectionId;
      let winningDof = sectionPoints[0]?.dof || bounds.startDof;
      let winningFileName = '';
      let winningDateKey = '';
      let winningTimeKey = '';
      let winningDisplayDateTime = '';

      // 1. Scan loaded ParsedTeprFiles strictly at discrete sampling points in CIRCUIT_3_SAMPLING_POINTS
      for (const file of periodFilteredFiles) {
        const rawCh = file.channel ?? file.header?.channel;
        const filePhaseCode: 'A' | 'B' | 'C' | 'SM' | null =
          rawCh === 3 || file.cablePhase === 'Submarine Cable'
            ? 'SM'
            : rawCh === 0 || file.cablePhase === 'Phase A'
            ? 'A'
            : rawCh === 1 || file.cablePhase === 'Phase B'
            ? 'B'
            : rawCh === 2 || file.cablePhase === 'Phase C'
            ? 'C'
            : null;

        if (!filePhaseCode) continue;
        if (isSubmarineSec && filePhaseCode !== 'SM') continue;
        if (!isSubmarineSec && filePhaseCode === 'SM') continue;

        const fileChannel =
          filePhaseCode === 'SM' ? 3 : filePhaseCode === 'A' ? 0 : filePhaseCode === 'B' ? 1 : 2;
        const filePhaseLabel =
          filePhaseCode === 'SM'
            ? 'Submarine (CH 3)'
            : `Phase ${filePhaseCode} (CH ${fileChannel})`;

        const fileDateKey =
          file.dateMeta?.dateKey ||
          file.dateMeta?.dateTimeStr?.slice(0, 10) ||
          effectiveStartDate;
        const fileTimeKey =
          file.dateMeta?.timeKey ||
          file.dateMeta?.dateTimeStr?.slice(11, 16) ||
          '';
        const fileDateTime =
          file.dateMeta?.displayDateTime ||
          file.dateMeta?.dateTimeStr ||
          (fileDateKey && fileTimeKey ? `${fileDateKey} ${fileTimeKey}` : fileDateKey);

        const pts = file.dataPoints || [];

        for (const sp of sectionPoints) {
          if (!isSubmarineSec && sp.phase !== filePhaseCode) continue;

          // Match the exact row at sp.dof from dataPoints first so no linear interpolation across skipped points can occur
          let tempAtDof: number | null = null;
          if (pts.length > 0) {
            let bestDiff = Infinity;
            for (let i = 0; i < pts.length; i++) {
              const d = Math.abs(pts[i].position - sp.dof);
              if (d < bestDiff && d <= 0.6) {
                if (pts[i].absoluteTemp >= -50 && pts[i].absoluteTemp <= 500) {
                  bestDiff = d;
                  tempAtDof = pts[i].absoluteTemp;
                }
              }
              if (pts[i].position > sp.dof + 2.0) break;
            }
          }
          if (tempAtDof === null) {
            const tlvMatch = file.targetLocationValues?.find(
              (tlv) =>
                Math.abs(tlv.location - sp.dof) <= 0.15 &&
                Math.abs((tlv.closestDataPoint?.position ?? tlv.location) - sp.dof) <= 0.6
            );
            if (tlvMatch && tlvMatch.absoluteTemp >= -50 && tlvMatch.absoluteTemp <= 500) {
              tempAtDof = tlvMatch.absoluteTemp;
            }
          }

          if (tempAtDof !== null) {
            sumTf += tempAtDof;
            countTf++;
            if (measuredMinTf === null || tempAtDof < measuredMinTf) {
              measuredMinTf = tempAtDof;
            }
            if (measuredMaxTf === null || tempAtDof > measuredMaxTf) {
              measuredMaxTf = tempAtDof;
              winningPhaseCode = filePhaseCode;
              winningPhaseLabel = filePhaseLabel;
              winningChannel = fileChannel;
              winningPosCode = sp.pos;
              winningDof = sp.dof;
              winningFileName = file.fileName;
              winningDateKey = fileDateKey;
              winningTimeKey = fileTimeKey;
              winningDisplayDateTime = fileDateTime;
            }

            const phDetail = phaseMap.get(filePhaseCode);
            if (phDetail && (phDetail.maxTf === null || tempAtDof > phDetail.maxTf)) {
              phDetail.maxTf = Number(tempAtDof.toFixed(2));
              phDetail.posCode = sp.pos;
              phDetail.dof = sp.dof;
              phDetail.fileName = file.fileName;
              phDetail.dateTimeStr = fileDateTime;
            }
          }
        }
      }

      // 2. Also check MasterSectionSummaryStore for any compiled dates in [effectiveStartDate, effectiveEndDate]
      for (const dKey of datesToCheck) {
        for (const ph of phasePhases) {
          const masterRec = getMasterSectionPeak(sec.sectionId, dKey, ph.code);
          if (masterRec && masterRec.maxTf >= -50 && masterRec.maxTf <= 500) {
            const phDetail = phaseMap.get(ph.code);
            const recTimeStr = masterRec.maxTimestamp || masterRec.peakTime || '';
            const recDateTime = recTimeStr ? `${dKey} ${recTimeStr}` : dKey;
            const matchedPt =
              typeof masterRec.maxTfDof === 'number'
                ? sectionPoints.find((p) => Math.abs(p.dof - masterRec.maxTfDof!) <= 0.6)
                : undefined;

            if (phDetail && (phDetail.maxTf === null || masterRec.maxTf > phDetail.maxTf)) {
              phDetail.maxTf = Number(masterRec.maxTf.toFixed(2));
              phDetail.posCode = matchedPt?.pos || phDetail.posCode;
              phDetail.dof = masterRec.maxTfDof ?? phDetail.dof;
              phDetail.fileName = masterRec.maxFileName || masterRec.sourceFile || phDetail.fileName;
              phDetail.dateTimeStr = recDateTime;
            }

            if (measuredMaxTf === null || masterRec.maxTf > measuredMaxTf) {
              measuredMaxTf = masterRec.maxTf;
              if (measuredMinTf === null || masterRec.minTf < measuredMinTf) {
                measuredMinTf = masterRec.minTf;
              }
              sumTf += masterRec.meanTf;
              countTf++;
              winningPhaseCode = ph.code;
              winningPhaseLabel = ph.label;
              winningChannel = ph.channel;
              winningPosCode = matchedPt?.pos || winningPosCode;
              winningDof = masterRec.maxTfDof ?? winningDof;
              winningFileName = masterRec.maxFileName || masterRec.sourceFile || winningFileName;
              winningDateKey = dKey;
              winningTimeKey = recTimeStr;
              winningDisplayDateTime = recDateTime;
            }
          }
        }
      }

      const hasRealTeprData = measuredMaxTf !== null;

      const tcRecordDateKey =
        winningDateKey ||
        (activeDateFilter && activeDateFilter !== 'all' ? activeDateFilter : powerMetrics.dateKey);

      const tcRecordDateTime =
        winningDisplayDateTime ||
        (winningDateKey && winningTimeKey ? `${winningDateKey} at ${winningTimeKey}` : null) ||
        `${tcRecordDateKey} (Peak Load Window)`;

      const datePowerSummary =
        powerSummariesByDate.get(tcRecordDateKey) || powerSummariesByDate.get(powerMetrics.dateKey);

      const syncPower = resolveSynchronizedPowerAtTimestamp(
        datePowerSummary,
        winningTimeKey || winningDisplayDateTime,
        powerMetrics
      );

      const peakPowerCkt3MW = syncPower.pCkt3MW;
      const peakPowerCkt2MW = syncPower.pCkt2MW;
      const peakPower33NktMW = syncPower.p33NktMW;
      const peakPower33OilMW = syncPower.p33OilMW;
      const peakPowerTotalIslandMW = syncPower.pTotalIslandMW;

      // Fallback baseline only if no TEPR files have been loaded for this section yet
      const baseTfByType =
        sec.sectionId === '2.3' || sec.name.includes('XPWA')
          ? 34.8
          : sec.name.includes('TJ1') || sec.name.includes('TJ2')
          ? 34.2
          : sec.name.includes('Crossing')
          ? 33.6
          : sec.name.includes('JP1') || sec.name.includes('JP2')
          ? 33.4
          : sec.category === 'land'
          ? 32.5
          : 29.8;

      const currentTfMax = Number(
        (measuredMaxTf !== null ? measuredMaxTf : baseTfByType).toFixed(2)
      );
      const currentTfMin = Number(
        (measuredMinTf !== null ? measuredMinTf : Math.max(25.0, currentTfMax - 1.8)).toFixed(2)
      );
      const currentTfAvg = Number(
        (countTf > 0 ? sumTf / countTf : (currentTfMax + currentTfMin) / 2).toFixed(2)
      );

      // Core Conductor Temperature Estimation
      const currentEst = evaluateSectionConductorTemp(
        sec,
        currentTfMax,
        peakPowerCkt3MW,
        peakPowerCkt2MW,
        peakPower33NktMW,
        peakPower33OilMW
      );
      const currentTcMax = Number((currentEst.tc60287 ?? currentTfMax).toFixed(2));
      const deltaTcMinusTf = Number((currentTcMax - currentTfMax).toFixed(2));

      // Compute per-phase Tc
      const phaseBreakdown: PhasePeakDetail[] = Array.from(phaseMap.values()).map((ph) => {
        if (ph.maxTf === null) return ph;
        const est = evaluateSectionConductorTemp(
          sec,
          ph.maxTf,
          peakPowerCkt3MW,
          peakPowerCkt2MW,
          peakPower33NktMW,
          peakPower33OilMW
        );
        return {
          ...ph,
          maxTc: Number((est.tc60287 ?? ph.maxTf).toFixed(2)),
        };
      });

      // Multi-Factor Future Forecast & 4 Scenario Simulation Model (Matches Page 5 physics model)
      let projectedTfMax = currentTfMax;
      let projected30dTcMax = currentTcMax;
      let projectedPowerCkt3MW = peakPowerCkt3MW;
      let projectedPowerTotalMW = peakPowerTotalIslandMW;

      if (horizonDays > 0) {
        const alphaFlight = 0.22;
        const betaTourist = 0.34;
        const gammaPop = 0.25;
        const deltaTempCoeff = 0.032;

        const totalGrowthRatio =
          (alphaFlight * (factors.flightGrowthPct / 100) +
            betaTourist * (factors.touristGrowthPct / 100) +
            gammaPop * (factors.populationGrowthPct / 100)) *
            (horizonDays / 90) +
          deltaTempCoeff * factors.ambientTempDeltaC;

        const fullMoonSpike = factors.includeFullMoonPeak ? 0.045 : 0;
        const demandMultiplier = Math.max(0.75, 1 + totalGrowthRatio + fullMoonSpike);

        projectedPowerTotalMW = Number((peakPowerTotalIslandMW * demandMultiplier).toFixed(2));
        const p33Total = projectedPowerTotalMW * 0.21;
        const fc33NktMW = Number((p33Total * 0.55).toFixed(2));
        const fc33OilMW = Number((p33Total * 0.45).toFixed(2));

        const p115Backbone = projectedPowerTotalMW - p33Total;
        const ckt3Share = factors.ckt3LoadSharePct / 100;
        projectedPowerCkt3MW = Number((p115Backbone * ckt3Share).toFixed(2));
        const fcCkt2MW = Number((p115Backbone * (1 - ckt3Share)).toFixed(2));

        const loadSensitivity = getSectionLoadSensitivity(sec);
        const ambientShift = factors.ambientTempDeltaC;
        const loadInducedTfRise = loadSensitivity * (projectedPowerCkt3MW - peakPowerCkt3MW) * 1.15;

        projectedTfMax = Number((currentTfMax + ambientShift + loadInducedTfRise).toFixed(2));

        const projectedEst = evaluateSectionConductorTemp(
          sec,
          projectedTfMax,
          projectedPowerCkt3MW,
          fcCkt2MW,
          fc33NktMW,
          fc33OilMW
        );
        projected30dTcMax = Number((projectedEst.tc60287 ?? projectedTfMax).toFixed(2));
      }

      const heatingRatePerWeek =
        horizonDays > 0
          ? Number(((projected30dTcMax - currentTcMax) / (horizonDays / 7)).toFixed(2))
          : 0;

      // Governing values for Risk Assessment (Actual when Horizon = 0, Projected when Horizon > 0)
      const governingTfMax = horizonDays > 0 ? projectedTfMax : currentTfMax;
      const governingTcMax = horizonDays > 0 ? projected30dTcMax : currentTcMax;

      const marginToAlert55 = Number((55 - governingTcMax).toFixed(2));
      const marginToDanger60 = Number((60 - governingTcMax).toFixed(2));
      const marginToCritical70 = Number((70 - governingTcMax).toFixed(2));

      const currentZone = getThermalZoneInfo(currentTcMax);
      const projectedZone = getThermalZoneInfo(projected30dTcMax);
      const governingZone = getThermalZoneInfo(governingTcMax);

      const tempScore = Math.min(100, Math.max(0, ((governingTcMax - 28) / 42) * 100));
      const deltaScore = Math.min(100, Math.max(0, ((governingTcMax - governingTfMax) / 8.0) * 100));
      const installBonus =
        sec.sectionId === '2.3' || sec.name.includes('TJ1') || sec.name.includes('TJ2')
          ? 85
          : sec.sectionType === 'special'
          ? 72
          : sec.category === 'land'
          ? 50
          : 38;

      const sriScore = Math.round(0.6 * tempScore + 0.2 * deltaScore + 0.2 * installBonus);

      const likelihoodLevel: 1 | 2 | 3 | 4 | 5 =
        governingTcMax > 70
          ? 5
          : governingTcMax >= 60
          ? 4
          : governingTcMax >= 55
          ? 4
          : governingTcMax >= 45
          ? 3
          : governingTcMax >= 35
          ? 2
          : 1;

      const guidance = getBottleneckEngineeringGuidance(sec);

      return {
        sectionId: sec.sectionId,
        name: sec.name,
        subtitle: sec.subtitle,
        category: sec.category,
        sectionType: sec.sectionType,
        equationName: sec.equationName,
        startDof: bounds.startDof,
        endDof: bounds.endDof,
        lengthMeters: sec.lengthMeters,
        hasRealTeprData,
        currentTfMax,
        currentTfMin,
        currentTfAvg,
        currentTcMax,
        deltaTcMinusTf,
        governingTfMax,
        governingTcMax,
        identifiedPhase: winningPhaseLabel,
        identifiedPhaseShort:
          winningPhaseCode === 'SM' ? 'Phase SM (CH 3)' : `Phase ${winningPhaseCode} (CH ${winningChannel})`,
        identifiedChannel: winningChannel,
        peakPosCode: winningPosCode,
        peakDof: winningDof,
        peakFileName: winningFileName || (hasRealTeprData ? 'Master Summary Record' : 'Pending TEPR Scan'),
        phaseBreakdown,
        tcRecordDateTime,
        tcRecordDateKey,
        peakPowerCkt3MW,
        peakPowerCkt2MW,
        peakPower33NktMW,
        peakPower33OilMW,
        peakPowerTotalIslandMW,
        projectedTfMax,
        projected30dTcMax,
        projectedPowerCkt3MW,
        projectedPowerTotalMW,
        heatingRatePerWeek,
        marginToAlert55,
        marginToDanger60,
        marginToCritical70,
        currentZone,
        projectedZone,
        governingZone,
        sriScore,
        likelihoodLevel,
        consequenceLevel: guidance.consequenceLevel,
        rootCauseCategory: guidance.rootCauseCategory,
        standardReference: guidance.standardReference,
        shortTermAction: guidance.shortTermAction,
        mediumLongTermAction: guidance.mediumLongTermAction,
      };
    });
  }, [
    periodFilteredFiles,
    allAvailableDates,
    effectiveStartDate,
    effectiveEndDate,
    powerMetrics,
    powerSummariesByDate,
    activeDateFilter,
    appliedScenarioConfig,
  ]);

  const rankedRisks = useMemo(() => {
    return [...sectionRisks]
      .filter((r) => filterCategory === 'ALL' || r.category === filterCategory)
      .sort((a, b) => b.governingTcMax - a.governingTcMax || b.sriScore - a.sriScore);
  }, [sectionRisks, filterCategory]);

  const activeSelectedCardRisk = useMemo(() => {
    if (rankedRisks.length === 0) return null;
    if (selectedCardSectionId) {
      const found = rankedRisks.find((r) => r.sectionId === selectedCardSectionId);
      if (found) return found;
    }
    return rankedRisks[0];
  }, [rankedRisks, selectedCardSectionId]);

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {
      critical: 0,
      danger: 0,
      alert: 0,
      monitoring: 0,
      normal: 0,
      cool: 0,
    };
    for (const r of sectionRisks) {
      counts[r.governingZone.key] = (counts[r.governingZone.key] || 0) + 1;
    }
    return counts;
  }, [sectionRisks]);

  const handleGenerateAiRiskReport = async () => {
    setIsGeneratingAi(true);
    try {
      const res = await runSystemRiskAiReport({
        referenceDate: powerMetrics.dateKey,
        zoneDistribution: zoneCounts,
        criticalSections: rankedRisks.slice(0, 6),
        allSectionRisks: rankedRisks.map((r) => ({
          sectionId: r.sectionId,
          name: r.name,
          category: r.category,
          sectionType: r.sectionType,
          currentTcMax: r.currentTcMax,
          projected30dTcMax: r.projected30dTcMax,
          projectedZone: r.governingZone.name,
          sriScore: r.sriScore,
          rootCauseCategory: r.rootCauseCategory,
          standardReference: r.standardReference,
        })),
        powerSummaryMetrics: powerMetrics,
        scenarioFactors: {
          demandStressPct: appliedScenarioConfig.factors.touristGrowthPct,
          ambientStressC: appliedScenarioConfig.factors.ambientTempDeltaC,
        },
      });
      setAiRiskReport(res.report);
      setAiProcessedAt(res.processedAt);
      showNotification('success', 'Generated AI System Risk & Standards Mitigation Report');
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to generate AI system risk report');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleExportRiskPdf = () => {
    try {
      const topBottlenecksMd = rankedRisks
        .slice(0, 5)
        .map(
          (r, i) =>
            `### ${i + 1}. Section ${r.sectionId}: ${r.name} (${r.category.toUpperCase()} — ${r.subtitle})
- **Identified Cable Phase & Position:** **${r.identifiedPhase}** at **${r.peakPosCode} (DOF ${r.peakDof.toFixed(2)} m)** | File: \`${r.peakFileName}\` (${r.tcRecordDateTime})
- **Fiber & Core Conductor Temp:** Actual Fiber Temp ($T_f$) = **${r.currentTfMax.toFixed(2)} °C** → Estimated Core Conductor ($T_c$) = **${r.currentTcMax.toFixed(2)} °C**${
              appliedScenarioConfig.horizonDays > 0
                ? ` | Forecast (+${appliedScenarioConfig.horizonDays}d) $T_c$ = **${r.projected30dTcMax.toFixed(2)} °C**`
                : ''
            } (${r.governingZone.name}) | Composite Risk Score: **${r.sriScore}/100**
- **Root Cause:** ${r.rootCauseCategory}
- **Governing Standard:** ${r.standardReference}
- **Immediate Action (Short-Term):** ${r.shortTermAction}
- **Civil / Thermal Remediation (Medium/Long-Term):** ${r.mediumLongTermAction}`
        )
        .join('\n\n');

      const fallbackMd = `# 115 kV Circuit #3 Submarine & Land Cable — System Thermal Risk & Mitigation Report

## 1. Executive System Risk Summary & 6-Zone Distribution
- **Reference Date Period:** ${assessmentDatePeriod.startDate} to ${assessmentDatePeriod.endDate}
- **Applied Scenario & Horizon:** ${
        appliedScenarioConfig.horizonDays > 0
          ? `${appliedScenarioConfig.presetName} (+${appliedScenarioConfig.horizonDays} Days Forecast)`
          : 'Actual Recorded Data Only (Forecast Turned Off)'
      }
- **4-Circuit Power Loading:** 115kV Ckt #3 (KMB): **${powerMetrics.pCkt3MW} MW** | 115kV Ckt #2 (KMA): **${powerMetrics.pCkt2MW} MW** | 33kV NKT: **${powerMetrics.p33NktMW} MW** | 33kV Oil: **${powerMetrics.p33OilMW} MW** (Total Island Peak: **${powerMetrics.pTotalIslandMW} MW**)
- **6-Zone Distribution Across 19 Sections:**
  - **Critical Zone (>70°C Dark Red):** ${zoneCounts.critical} sections
  - **Danger Zone (60–70°C Light Red):** ${zoneCounts.danger} sections
  - **Alert Zone (55–60°C Orange):** ${zoneCounts.alert} sections
  - **Monitoring Zone (45–55°C Yellow):** ${zoneCounts.monitoring} sections
  - **Normal Zone (35–45°C Green):** ${zoneCounts.normal} sections
  - **Cool Zone (<35°C Light Blue):** ${zoneCounts.cool} sections

## 2. Top Critical & High-Risk Thermal Bottleneck Zones
${topBottlenecksMd}`;

      exportEngineeringReportToPdf({
        title: '115 kV Submarine & Land Cable System — Thermal Risk Management Report',
        subtitle: 'Grounded in Actual DTS Fiber Temperature (Tf), Core Conductor Estimation (Tc) & Multi-Factor Scenario Analysis',
        metadataRows: [
          { label: 'Assessment Period', value: `${assessmentDatePeriod.startDate} to ${assessmentDatePeriod.endDate}` },
          {
            label: 'Applied Scenario',
            value:
              appliedScenarioConfig.horizonDays > 0
                ? `${appliedScenarioConfig.presetName} (+${appliedScenarioConfig.horizonDays}d)`
                : 'Actual Recorded Data Only',
          },
          {
            label: 'Highest Peak Section & Phase',
            value: `Sec ${rankedRisks[0]?.sectionId} • ${rankedRisks[0]?.identifiedPhase} (Tf ${rankedRisks[0]?.currentTfMax.toFixed(2)}°C → Tc ${rankedRisks[0]?.governingTcMax.toFixed(2)}°C)`,
          },
          {
            label: 'Critical / Danger / Alert Sections',
            value: `${zoneCounts.critical} Critical | ${zoneCounts.danger} Danger | ${zoneCounts.alert} Alert`,
          },
          {
            label: '115kV Backbone Load (KMB / KMA)',
            value: `Ckt #3: ${powerMetrics.pCkt3MW} MW | Ckt #2: ${powerMetrics.pCkt2MW} MW`,
          },
          {
            label: '33kV Interconnect (NKT / Oil)',
            value: `NKT: ${powerMetrics.p33NktMW} MW | Oil: ${powerMetrics.p33OilMW} MW`,
          },
        ],
        summaryTableHeaders: [
          'Rank',
          'Section ID & Name',
          'Identified Phase & DOF',
          'Actual Fiber Tf',
          'Conductor Tc',
          '6-Zone Status',
          'SRI Score',
          'Source TEPR & Timestamp',
        ],
        summaryTableRows: rankedRisks.map((r, idx) => [
          `#${idx + 1}`,
          `Sec ${r.sectionId}: ${r.name}`,
          `${r.identifiedPhase} @ ${r.peakPosCode} (${r.peakDof.toFixed(2)}m)`,
          `${r.currentTfMax.toFixed(2)} °C`,
          `${r.governingTcMax.toFixed(2)} °C`,
          `${r.governingZone.shortLabel} (${r.governingZone.rangeText})`,
          `${r.sriScore}/100`,
          `${r.peakFileName} (${r.tcRecordDateTime})`,
        ]),
        markdownContent: aiRiskReport || fallbackMd,
        fileNameBase: 'Submarine_Cable_Risk_Management_Report',
      });
      showNotification('success', 'Risk Management Report PDF generated and downloaded to your device!');
    } catch (err: any) {
      showNotification('error', `Failed to export PDF: ${err?.message || 'Unknown error'}`);
    }
  };

  // Custom High-Contrast Tooltip for 19-Section Bar Chart
  const Custom19SectionTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: SectionRiskAssessment = payload[0]?.payload;
      if (!data) return null;
      return (
        <div className="bg-slate-900/95 text-white p-3.5 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-1.5 font-sans min-w-[280px] backdrop-blur-md">
          <div className="font-bold border-b border-slate-700 pb-1.5 flex items-center justify-between gap-2 text-slate-200">
            <span>Sec {data.sectionId}: {data.name}</span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0"
              style={{
                backgroundColor: `${data.governingZone?.color || '#3b82f6'}30`,
                color: data.governingZone?.color || '#3b82f6',
              }}
            >
              {data.governingZone?.shortLabel || 'Zone'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 text-slate-200 pt-0.5">
            <span className="text-slate-300">Identified Cable Phase:</span>
            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-mono text-[11px] font-bold">
              {data.identifiedPhase}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 text-slate-200">
            <span className="text-slate-300">Discrete DOF Position:</span>
            <span className="font-mono text-[11px] font-bold text-emerald-300">
              {data.peakPosCode} (DOF {data.peakDof?.toFixed(2)} m)
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 text-slate-200">
            <span className="text-slate-300">Actual Fiber Temp (Tf):</span>
            <strong className="font-mono text-sm font-bold text-sky-400">
              {data.currentTfMax?.toFixed(2)} °C
            </strong>
          </div>

          <div className="flex items-center justify-between gap-3 text-slate-200">
            <span className="text-slate-300">Core Conductor Temp (Tc):</span>
            <strong className="font-mono text-sm font-extrabold text-amber-400">
              {data.currentTcMax?.toFixed(2)} °C (+{data.deltaTcMinusTf?.toFixed(2)} °C)
            </strong>
          </div>

          {appliedScenarioConfig.horizonDays > 0 && (
            <div className="flex items-center justify-between gap-3 text-slate-200 pt-0.5 border-t border-slate-800">
              <span className="text-purple-300">
                Forecast (+{appliedScenarioConfig.horizonDays}d) Conductor Tc:
              </span>
              <strong className="font-mono text-sm font-extrabold text-rose-400">
                {data.projected30dTcMax?.toFixed(2)} °C
              </strong>
            </div>
          )}

          {data.tcRecordDateTime && (
            <div className="flex items-center justify-between gap-3 text-[11px] text-amber-300 pt-0.5 border-t border-slate-800">
              <span className="text-slate-400">Heat Event Timestamp:</span>
              <span className="font-mono font-semibold">{data.tcRecordDateTime}</span>
            </div>
          )}

          {data.peakFileName && (
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-300">
              <span className="text-slate-400">Source .TEPR File:</span>
              <span className="font-mono text-[10px] text-sky-300 truncate max-w-[170px]">{data.peakFileName}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 text-[11px] text-indigo-300">
            <span className="text-slate-400">Sync Power (Ckt #3 / Total):</span>
            <span className="font-mono font-semibold">{data.peakPowerCkt3MW} / {data.peakPowerTotalIslandMW} MW</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-lg border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="flex items-center gap-1.5 text-rose-400 text-xs font-bold uppercase tracking-wider">
                <ShieldAlert className="w-4 h-4" />
                Page 6 • Actual Fiber Temperature (Tf) &amp; Core Conductor Thermal Risk Management
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700 font-mono text-[11px] font-bold flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-rose-400" />
                Assessment Period: <span className="text-white">{assessmentDatePeriod.startDate}</span> to <span className="text-white">{assessmentDatePeriod.endDate}</span> ({assessmentDatePeriod.totalDays}d Records)
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-950/90 text-indigo-300 border border-indigo-700/70 font-mono text-[11px] font-bold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Active Mode:{' '}
                {appliedScenarioConfig.horizonDays > 0
                  ? `${appliedScenarioConfig.presetName} (+${appliedScenarioConfig.horizonDays}d Forecast)`
                  : 'Actual Recorded Data (Forecast Off)'}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Thermal Risk Management &amp; Phase-Resolved Conductor Temperature Analysis
            </h2>
            <p className="text-slate-300 text-sm mt-1">
              Reads actual DTS Fiber Temperature (<span className="font-mono text-sky-300 font-semibold">Tf</span>) strictly at discrete DOF positions with Channel-to-Phase identification (<span className="font-mono text-amber-300">CH 0 = Phase A, CH 1 = Phase B, CH 2 = Phase C, CH 3 = Submarine</span>) and evaluates Core Conductor Temperature (<span className="font-mono text-rose-300 font-semibold">Tc</span>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleGenerateAiRiskReport}
              disabled={isGeneratingAi}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white shadow-md transition-all cursor-pointer disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              {isGeneratingAi ? 'Researching Standards & Generating...' : 'AI Risk & Standards Report'}
            </button>
            <button
              onClick={handleExportRiskPdf}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Export Risk Management PDF
            </button>
          </div>
        </div>

        {/* 6-Zone Distribution Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5 pt-4 border-t border-slate-800">
          {THERMAL_ZONE_CRITERIA.map((z) => {
            const count = zoneCounts[z.key] || 0;
            return (
              <div
                key={z.key}
                className="rounded-xl p-3 bg-slate-800/90 border border-slate-700/80 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: z.color }} />
                    <span className="text-xs font-bold text-white">{z.name}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">{z.rangeText}</div>
                </div>
                <div
                  className="text-xl font-extrabold font-mono px-2.5 py-1 rounded-lg"
                  style={{
                    backgroundColor: `${z.color}25`,
                    color: z.color,
                  }}
                >
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Multi-Factor Future Forecast & 4 Scenario Simulation Panel + Assessment Period Selector */}
      <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex flex-wrap items-center gap-2">
                <span>Multi-Factor Future Forecast &amp; 4 Scenario Simulation Panel</span>
                {hasPendingChanges ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-mono text-[10px] font-extrabold animate-pulse">
                    Selection Changed — Click &ldquo;Risk Analyzing&rdquo; to Apply
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                    Applied to Risk Analysis
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500">
                Select assessment date period, prediction horizon, and tourism/climate scenario factors below, then click <strong>Risk Analyzing</strong> to run the risk assessment.
              </p>
            </div>
          </div>

          {/* Prediction Horizon Selector Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 bg-indigo-50/80 p-1.5 rounded-xl border border-indigo-100">
            <span className="text-[11px] font-bold text-indigo-900 px-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              Horizon:
            </span>
            <button
              type="button"
              onClick={() => setPendingHorizonDays(0)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                pendingHorizonDays === 0
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Turn Off (Actual Recorded Only)
            </button>
            <button
              type="button"
              onClick={() => setPendingHorizonDays(7)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                pendingHorizonDays === 7
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Predict 7 Days
            </button>
            <button
              type="button"
              onClick={() => setPendingHorizonDays(14)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                pendingHorizonDays === 14
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Predict 14 Days
            </button>
            <button
              type="button"
              onClick={() => setPendingHorizonDays(30)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                pendingHorizonDays === 30
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Predict 30 Days
            </button>
          </div>
        </div>

        {/* 4 Scenario Presets Grid */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            Select 1 of 4 Tourism, Aviation &amp; Climate Simulation Scenarios (Koh Samui • Koh Pha Ngan • Koh Tao):
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PRESET_SCENARIOS.map((preset) => {
              const active = pendingPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs'
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/80 hover:border-slate-300'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                    {preset.badge}
                  </div>
                  <div className="text-xs font-bold text-slate-900 mt-1">
                    {preset.name}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-Factor Fine-Tuning Sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Flights */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-indigo-600" />
                Flights (Samui USM)
              </span>
              <span className="font-mono text-indigo-600">
                {pendingScenarioFactors.flightGrowthPct >= 0 ? '+' : ''}
                {pendingScenarioFactors.flightGrowthPct}%
              </span>
            </div>
            <input
              type="range"
              min={-10}
              max={45}
              step={1}
              value={pendingScenarioFactors.flightGrowthPct}
              onChange={(e) => {
                setPendingPresetId('custom');
                setPendingScenarioFactors((prev) => ({
                  ...prev,
                  flightGrowthPct: Number(e.target.value),
                }));
              }}
              className="w-full accent-indigo-600 cursor-pointer"
            />
          </div>

          {/* Tourists */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-600" />
                Tourists (Samui/Pha Ngan/Tao)
              </span>
              <span className="font-mono text-cyan-600">
                {pendingScenarioFactors.touristGrowthPct >= 0 ? '+' : ''}
                {pendingScenarioFactors.touristGrowthPct}%
              </span>
            </div>
            <input
              type="range"
              min={-10}
              max={50}
              step={1}
              value={pendingScenarioFactors.touristGrowthPct}
              onChange={(e) => {
                setPendingPresetId('custom');
                setPendingScenarioFactors((prev) => ({
                  ...prev,
                  touristGrowthPct: Number(e.target.value),
                }));
              }}
              className="w-full accent-cyan-600 cursor-pointer"
            />
          </div>

          {/* Ambient / Weather */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                Weather / Seabed ΔT
              </span>
              <span className="font-mono text-amber-600">
                {pendingScenarioFactors.ambientTempDeltaC >= 0 ? '+' : ''}
                {pendingScenarioFactors.ambientTempDeltaC.toFixed(1)} °C
              </span>
            </div>
            <input
              type="range"
              min={-1.5}
              max={5.0}
              step={0.1}
              value={pendingScenarioFactors.ambientTempDeltaC}
              onChange={(e) => {
                setPendingPresetId('custom');
                setPendingScenarioFactors((prev) => ({
                  ...prev,
                  ambientTempDeltaC: Number(e.target.value),
                }));
              }}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* 115kV Ckt #3 Load Share */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-rose-600" />
                115kV Ckt #3 Load Share
              </span>
              <span className="font-mono text-rose-600">
                {pendingScenarioFactors.ckt3LoadSharePct}%
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={85}
              step={1}
              value={pendingScenarioFactors.ckt3LoadSharePct}
              onChange={(e) => {
                setPendingPresetId('custom');
                setPendingScenarioFactors((prev) => ({
                  ...prev,
                  ckt3LoadSharePct: Number(e.target.value),
                }));
              }}
              className="w-full accent-rose-600 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Assessment Period Controls & 19-Section Actual Tf vs Conductor Tc Bar Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left 4 cols: Assessment Period & Filter Controls */}
        <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Assessment Period &amp; Execution</h3>
              <p className="text-xs text-slate-500">
                Discrete DOF reading + Core Conductor Thermal Risk Analysis
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-mono text-xs font-bold">
              19 Sections
            </span>
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800">
              <span className="flex items-center gap-1.5 text-slate-800">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                Assessment Date Period
              </span>
              <span className="font-mono text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-200 font-semibold">
                {assessmentDatePeriod.totalDays}d Window
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">From Date (Page 1):</label>
                <select
                  value={activeStartDate}
                  onChange={(e) => {
                    setCustomStartDate(e.target.value);
                    setCustomEndDate(e.target.value);
                  }}
                  className="w-full px-2.5 py-2 rounded-xl bg-white text-slate-900 text-xs font-mono font-bold border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                >
                  {allAvailableDates.map((d) => (
                    <option key={`start-${d}`} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">To Date (Max +30d):</label>
                <select
                  value={activeEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl bg-white text-slate-900 text-xs font-mono font-bold border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                >
                  {allowedEndDates.map((d) => (
                    <option key={`end-${d}`} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Summary of Staged Scenario Factors before clicking Risk Analyzing */}
            <div className="rounded-lg bg-white p-2.5 border border-slate-200/90 text-[11px] space-y-1">
              <div className="flex items-center justify-between font-bold text-slate-700">
                <span>Selected Scenario Mode:</span>
                <span className="font-mono text-indigo-700">
                  {pendingHorizonDays > 0 ? `+${pendingHorizonDays}d Forecast` : 'Actual Recorded Only'}
                </span>
              </div>
              {pendingHorizonDays > 0 && (
                <div className="text-[10px] font-mono text-slate-500 flex flex-wrap gap-x-2">
                  <span>Flights: +{pendingScenarioFactors.flightGrowthPct}%</span>
                  <span>•</span>
                  <span>Tourists: +{pendingScenarioFactors.touristGrowthPct}%</span>
                  <span>•</span>
                  <span>ΔT: +{pendingScenarioFactors.ambientTempDeltaC.toFixed(1)}°C</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleStartRiskAnalyzing}
              disabled={isAnalyzing}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-rose-600 to-amber-600 hover:from-indigo-500 hover:to-amber-500 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
            >
              <Activity className="w-4 h-4 shrink-0 animate-pulse" />
              <span>Risk Analyzing (Apply Period &amp; Selected Scenario)</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Filter by Cable Category
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'All (19)' },
                  { id: 'land', label: 'Land (6)' },
                  { id: 'submarine', label: 'Subsea (13)' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterCategory(tab.id)}
                  className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    filterCategory === tab.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right 8 cols: 19-Section Bar Chart (Actual Fiber Tf vs Core Conductor Tc) */}
        <div className="xl:col-span-8 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                19 Cable Sections — Actual Peak Fiber Temp (Tf) vs Core Conductor Temperature (Tc)
              </h3>
              <p className="text-xs text-slate-500">
                Hover any bar to inspect the identified <strong className="text-slate-700">Cable Phase (A / B / C / SM)</strong>, discrete <strong className="text-slate-700">DOF (m)</strong>, <strong className="text-slate-700">.TEPR file</strong>, and <strong className="text-slate-700">Core Conductor Temp (Tc)</strong>
              </p>
            </div>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={sectionRisks} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="sectionId"
                  tickFormatter={(v) => `S${v}`}
                  tick={{ fontSize: 10, fill: '#475569', fontWeight: 600 }}
                />
                <YAxis domain={[20, 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} unit="°C" />
                <Tooltip
                  cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
                  wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                  contentStyle={{ backgroundColor: 'transparent', border: 'none', padding: 0, boxShadow: 'none' }}
                  content={<Custom19SectionTooltip />}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <ReferenceLine y={70} stroke="#991b1b" strokeDasharray="4 4" />
                <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="4 4" />
                <ReferenceLine y={55} stroke="#f97316" strokeDasharray="3 3" />
                <ReferenceLine y={45} stroke="#eab308" strokeDasharray="3 3" />

                <Bar
                  dataKey="governingTcMax"
                  name={
                    appliedScenarioConfig.horizonDays > 0
                      ? `Forecast (+${appliedScenarioConfig.horizonDays}d) Core Conductor Temp Tc (°C)`
                      : 'Core Conductor Temp Tc (°C)'
                  }
                  radius={[4, 4, 0, 0]}
                >
                  {sectionRisks.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.governingZone.color} />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="currentTfMax"
                  name="Actual Peak Fiber Temp Tf (DTS Discrete DOF, °C)"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#0284c7' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 5x5 Thermal Risk Matrix & Bottleneck Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* 5x5 Matrix */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-900">
              5×5 Cable Thermal Risk Matrix (Likelihood × Consequence)
            </h3>
            <p className="text-xs text-slate-500">
              Classified by Core Conductor Temperature Tc across all 19 sections
            </p>
          </div>

          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((likeLvl) => (
              <div key={likeLvl} className="grid grid-cols-6 gap-1.5 items-center">
                <div className="text-[10px] font-bold text-slate-600 pr-1 text-right">
                  L{likeLvl}{' '}
                  {likeLvl === 5
                    ? '(>70°C)'
                    : likeLvl === 4
                    ? '(55–70°C)'
                    : likeLvl === 3
                    ? '(45–55°C)'
                    : likeLvl === 2
                    ? '(35–45°C)'
                    : '(<35°C)'}
                </div>
                {[1, 2, 3, 4, 5].map((consLvl) => {
                  const matching = sectionRisks.filter(
                    (s) => s.likelihoodLevel === likeLvl && s.consequenceLevel === consLvl
                  );
                  const severityScore = likeLvl * consLvl;
                  const cellBg =
                    severityScore >= 20
                      ? 'bg-red-900/15 border-red-800/40'
                      : severityScore >= 15
                      ? 'bg-red-500/15 border-red-400/40'
                      : severityScore >= 10
                      ? 'bg-orange-500/15 border-orange-400/40'
                      : severityScore >= 6
                      ? 'bg-yellow-500/15 border-yellow-400/40'
                      : 'bg-emerald-500/15 border-emerald-400/40';

                  return (
                    <div
                      key={consLvl}
                      onClick={() => {
                        if (matching.length > 0) {
                          onNavigateToSectionAnalysis?.(matching[0].sectionId);
                        }
                      }}
                      className={`min-h-13 rounded-lg border p-1 flex flex-wrap gap-1 items-center justify-center transition-all ${
                        matching.length > 0 ? 'cursor-pointer hover:border-slate-400 hover:shadow-xs' : ''
                      } ${cellBg}`}
                      title={
                        matching.length > 0
                          ? `Click cell box to analyze Section ${matching[0].sectionId} on Page 5`
                          : 'No sections in this risk cell'
                      }
                    >
                      {matching.map((m) => (
                        <button
                          key={m.sectionId}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToSectionAnalysis?.(m.sectionId);
                          }}
                          title={`Sec ${m.sectionId}: ${m.name} • ${m.identifiedPhase} • Tf ${m.currentTfMax.toFixed(2)}°C → Tc ${m.governingTcMax.toFixed(2)}°C`}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold text-white shadow-2xs cursor-pointer hover:scale-110 transition-transform"
                          style={{ backgroundColor: m.governingZone.color }}
                        >
                          S{m.sectionId}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="grid grid-cols-6 gap-1.5 pt-1 text-[10px] font-bold text-slate-500 text-center">
              <div></div>
              <div>C1 Minor</div>
              <div>C2 Low</div>
              <div>C3 Mod</div>
              <div>C4 High</div>
              <div>C5 Critical</div>
            </div>
          </div>
        </div>

        {/* Priority Bottlenecks with Phase Identification */}
        <div className="xl:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Highest-Risk Thermal Bottlenecks — Phase Identification &amp; Conductor Thermal Status
            </h3>
            <p className="text-xs text-slate-500">
              Ranked by Core Conductor Temperature Tc (evaluated from actual discrete DOF Fiber Temp Tf)
            </p>
          </div>

          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
            {rankedRisks.slice(0, 5).map((item, idx) => (
              <div
                key={item.sectionId}
                onClick={() => setSelectedCardSectionId(item.sectionId)}
                className="rounded-xl border border-slate-200 p-4 bg-slate-50/60 hover:bg-slate-50 transition-all cursor-pointer"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                      #{idx + 1}
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {item.category === 'land' ? `Sec ${item.sectionId}` : `Zone ${item.sectionId}`}: {item.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 font-mono text-[11px] font-extrabold">
                      {item.identifiedPhase}
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      @ {item.peakPosCode} (DOF {item.peakDof.toFixed(2)}m)
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 font-mono text-xs font-bold">
                      Tf: {item.currentTfMax.toFixed(2)}°C
                    </span>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-xs font-bold"
                      style={{
                        backgroundColor: `${item.governingZone.color}20`,
                        color: item.governingZone.color,
                      }}
                    >
                      Tc: {item.governingTcMax.toFixed(2)}°C
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-mono text-xs font-bold">
                      SRI {item.sriScore}/100
                    </span>
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500">
                  <span>Timestamp: <strong className="text-slate-700">{item.tcRecordDateTime}</strong></span>
                  <span>•</span>
                  <span>TEPR File: <strong className="text-indigo-700">{item.peakFileName}</strong></span>
                  <span>•</span>
                  <span>Ckt #3 / Ckt #2: <strong className="text-slate-700">{item.peakPowerCkt3MW} / {item.peakPowerCkt2MW} MW</strong></span>
                </div>

                <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/80">
                    <div className="font-bold text-slate-800 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      Root Cause &amp; Severity:
                    </div>
                    <p className="text-slate-600 mt-0.5">{item.rootCauseCategory}</p>
                    <div className="text-[11px] font-mono text-indigo-600 font-semibold mt-1">
                      Ref: {item.standardReference}
                    </div>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/80">
                    <div className="font-bold text-slate-800 flex items-center gap-1">
                      <Wrench className="w-3.5 h-3.5 text-emerald-600" />
                      Engineering Mitigation Guidance:
                    </div>
                    <p className="text-slate-600 mt-0.5">
                      <strong>Short-Term:</strong> {item.shortTermAction}
                    </p>
                    <p className="text-slate-600 mt-0.5">
                      <strong>Long-Term:</strong> {item.mediumLongTermAction}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive 19-Section Risk Card & Dropdown Selector */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-rose-50 text-rose-700 font-bold text-xs uppercase tracking-wider">
                19-Section Interactive Card View
              </span>
              <span className="text-xs font-mono text-slate-500">
                Ranked #1 to #19 by Core Conductor Temperature Tc
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Section Thermal Severity Inspector — Phase Identification &amp; Core Conductor Analysis
            </h3>
          </div>

          {/* Section Dropdown Selector & Navigation */}
          <div className="flex items-center gap-2">
            <select
              value={activeSelectedCardRisk?.sectionId || ''}
              onChange={(e) => setSelectedCardSectionId(e.target.value)}
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold border border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer shadow-sm max-w-xs md:max-w-md"
            >
              {rankedRisks.map((r, idx) => (
                <option key={r.sectionId} value={r.sectionId} className="bg-slate-900 text-white font-mono">
                  #{idx + 1} {r.category === 'land' ? `Sec ${r.sectionId}` : `Zone ${r.sectionId}`}: {r.name} ({r.identifiedPhaseShort} • Tf {r.currentTfMax.toFixed(2)}°C → Tc {r.governingTcMax.toFixed(2)}°C)
                </option>
              ))}
            </select>

            {/* Prev / Next buttons */}
            {activeSelectedCardRisk && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const currIdx = rankedRisks.findIndex((r) => r.sectionId === activeSelectedCardRisk.sectionId);
                    if (currIdx > 0) {
                      setSelectedCardSectionId(rankedRisks[currIdx - 1].sectionId);
                    }
                  }}
                  disabled={rankedRisks.findIndex((r) => r.sectionId === activeSelectedCardRisk.sectionId) <= 0}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold cursor-pointer transition-colors"
                  title="Previous higher severity section"
                >
                  &larr; Prev
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currIdx = rankedRisks.findIndex((r) => r.sectionId === activeSelectedCardRisk.sectionId);
                    if (currIdx >= 0 && currIdx < rankedRisks.length - 1) {
                      setSelectedCardSectionId(rankedRisks[currIdx + 1].sectionId);
                    }
                  }}
                  disabled={rankedRisks.findIndex((r) => r.sectionId === activeSelectedCardRisk.sectionId) >= rankedRisks.length - 1}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold cursor-pointer transition-colors"
                  title="Next section"
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Selected Section Details Card */}
        {activeSelectedCardRisk ? (
          <div className="space-y-4">
            {/* Summary Header Banner */}
            <div className="rounded-xl p-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-rose-600 text-white font-mono font-extrabold text-sm flex items-center justify-center shadow-md">
                  #{rankedRisks.findIndex((r) => r.sectionId === activeSelectedCardRisk.sectionId) + 1}
                </span>
                <div>
                  <div className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                    <span>
                      {activeSelectedCardRisk.category === 'land' ? `Sec ${activeSelectedCardRisk.sectionId}` : `Zone ${activeSelectedCardRisk.sectionId}`}: {activeSelectedCardRisk.name}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-extrabold bg-indigo-600 text-white border border-indigo-400">
                      Heat Phase: {activeSelectedCardRisk.identifiedPhase}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {activeSelectedCardRisk.subtitle} • Peak Position: <span className="font-mono text-emerald-300 font-bold">{activeSelectedCardRisk.peakPosCode} (DOF {activeSelectedCardRisk.peakDof.toFixed(2)}m)</span> • Section Range: <span className="font-mono text-slate-200">{activeSelectedCardRisk.startDof.toFixed(2)}m – {activeSelectedCardRisk.endDof.toFixed(2)}m</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold shadow-xs"
                  style={{
                    backgroundColor: `${activeSelectedCardRisk.governingZone.color}30`,
                    color: activeSelectedCardRisk.governingZone.color,
                  }}
                >
                  {activeSelectedCardRisk.governingZone.name}: Tc = {activeSelectedCardRisk.governingTcMax.toFixed(2)} °C
                </span>
                <span className="px-3 py-1 rounded-xl bg-slate-800 text-white font-mono text-xs font-bold border border-slate-700">
                  SRI Risk Score: {activeSelectedCardRisk.sriScore} / 100
                </span>
              </div>
            </div>

            {/* Per-Phase Heat Event Identification Strip (Phase A / B / C for Land, Channel 3 for Submarine) */}
            <div className="rounded-xl p-4 bg-slate-50 border border-slate-200/90 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>Cable Phase Heat Identification (Line 6 `# Channel No` Mapping &amp; Discrete DOF Reading):</span>
                </div>
                <span className="text-[11px] font-mono text-slate-600">
                  Governing Heat Phase: <strong className="text-indigo-700">{activeSelectedCardRisk.identifiedPhase}</strong> @ <strong className="text-emerald-700">{activeSelectedCardRisk.peakPosCode} ({activeSelectedCardRisk.peakDof.toFixed(2)}m)</strong>
                </span>
              </div>

              <div className={`grid grid-cols-1 ${activeSelectedCardRisk.phaseBreakdown.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-1'} gap-2.5`}>
                {activeSelectedCardRisk.phaseBreakdown.map((ph) => {
                  const isWinning = ph.channel === activeSelectedCardRisk.identifiedChannel && ph.maxTf !== null;
                  return (
                    <div
                      key={ph.phaseCode}
                      className={`p-3 rounded-xl border text-xs transition-all ${
                        isWinning
                          ? 'bg-indigo-950 text-white border-indigo-500 shadow-sm'
                          : 'bg-white text-slate-800 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-current/10">
                        <span className="font-mono font-extrabold text-xs flex items-center gap-1.5">
                          <span>{ph.phaseLabel}</span>
                          {isWinning && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-bold uppercase">
                              Peak Heat Phase
                            </span>
                          )}
                        </span>
                        <span className={`font-mono text-[11px] ${isWinning ? 'text-indigo-200' : 'text-slate-500'}`}>
                          {ph.posCode} • DOF {ph.dof.toFixed(2)}m
                        </span>
                      </div>
                      {ph.maxTf !== null ? (
                        <div className="mt-2 space-y-1 font-mono text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className={isWinning ? 'text-slate-300' : 'text-slate-500'}>Actual Fiber Temp (Tf):</span>
                            <strong className={isWinning ? 'text-sky-300 text-sm' : 'text-sky-700 text-sm'}>
                              {ph.maxTf.toFixed(2)} °C
                            </strong>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={isWinning ? 'text-slate-300' : 'text-slate-500'}>
                              Conductor Temp (Tc):
                            </span>
                            <strong className={isWinning ? 'text-amber-300 text-sm' : 'text-rose-700 text-sm'}>
                              {(ph.maxTc ?? ph.maxTf).toFixed(2)} °C
                            </strong>
                          </div>
                          <div className={`text-[10px] pt-1 truncate ${isWinning ? 'text-slate-300' : 'text-slate-500'}`}>
                            File: {ph.fileName || 'Master Summary'} ({ph.dateTimeStr || activeSelectedCardRisk.tcRecordDateKey})
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] font-mono text-slate-400">
                          No TEPR record loaded for {ph.phaseLabel} in selected period
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Synchronized Peak Tc Date/Time & 4-Circuit Operating Power Flow Banner */}
            <div className="rounded-xl p-4 bg-slate-900 text-white border border-slate-800 space-y-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-slate-300">Heat Event Timestamp &amp; Source File:</span>
                  <span className="font-mono text-amber-300 bg-amber-950/80 px-2.5 py-1 rounded-md border border-amber-800/80 text-xs shadow-2xs">
                    {activeSelectedCardRisk.tcRecordDateTime}
                  </span>
                  <span className="font-mono text-sky-300 bg-sky-950/80 px-2.5 py-1 rounded-md border border-sky-800/80 text-xs">
                    {activeSelectedCardRisk.peakFileName}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400">
                  Phase: <span className="text-indigo-300 font-bold">{activeSelectedCardRisk.identifiedPhase}</span> • Date: <span className="text-slate-200 font-bold">{activeSelectedCardRisk.tcRecordDateKey}</span>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  Synchronized System Power Flow Recorded at Peak Tf Timestamp:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div className="bg-slate-800/90 p-2.5 rounded-xl border border-slate-700/80">
                    <div className="text-[10px] text-slate-400 font-semibold">115kV Ckt #3 (KMB)</div>
                    <div className="font-mono font-bold text-red-400 text-sm mt-0.5">
                      {activeSelectedCardRisk.peakPowerCkt3MW.toFixed(2)} MW
                    </div>
                  </div>
                  <div className="bg-slate-800/90 p-2.5 rounded-xl border border-slate-700/80">
                    <div className="text-[10px] text-slate-400 font-semibold">115kV Ckt #2 (KMA)</div>
                    <div className="font-mono font-bold text-blue-400 text-sm mt-0.5">
                      {activeSelectedCardRisk.peakPowerCkt2MW.toFixed(2)} MW
                    </div>
                  </div>
                  <div className="bg-slate-800/90 p-2.5 rounded-xl border border-slate-700/80">
                    <div className="text-[10px] text-slate-400 font-semibold">33kV NKT (KNA)</div>
                    <div className="font-mono font-bold text-emerald-400 text-sm mt-0.5">
                      {activeSelectedCardRisk.peakPower33NktMW.toFixed(2)} MW
                    </div>
                  </div>
                  <div className="bg-slate-800/90 p-2.5 rounded-xl border border-slate-700/80">
                    <div className="text-[10px] text-slate-400 font-semibold">33kV Oil-Filled (KNA)</div>
                    <div className="font-mono font-bold text-amber-400 text-sm mt-0.5">
                      {activeSelectedCardRisk.peakPower33OilMW.toFixed(2)} MW
                    </div>
                  </div>
                  <div className="bg-slate-800/90 p-2.5 rounded-xl border border-slate-700/80 col-span-2 sm:col-span-1">
                    <div className="text-[10px] text-slate-400 font-semibold">Total Island Load</div>
                    <div className="font-mono font-bold text-indigo-300 text-sm mt-0.5">
                      {activeSelectedCardRisk.peakPowerTotalIslandMW.toFixed(2)} MW
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Metric Cards: Actual Fiber Temp (Tf), Core Conductor Temp (Tc), SRI Score, Thermal Margin */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-xs font-semibold text-slate-500">Actual Peak Fiber Temp (Tf)</div>
                <div className="text-lg font-extrabold font-mono text-sky-700 mt-0.5">
                  {activeSelectedCardRisk.currentTfMax.toFixed(2)} °C
                </div>
                <div className="text-[11px] text-slate-600 mt-1 font-mono">
                  Phase: <strong className="text-indigo-700">{activeSelectedCardRisk.identifiedPhaseShort}</strong> @ {activeSelectedCardRisk.peakPosCode} ({activeSelectedCardRisk.peakDof.toFixed(2)}m)
                </div>
                <div className="text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-200/60 font-mono">
                  Min: {activeSelectedCardRisk.currentTfMin.toFixed(2)}°C • Avg: {activeSelectedCardRisk.currentTfAvg.toFixed(2)}°C
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-xs font-semibold text-slate-500">
                  Estimated Core Conductor (Tc)
                </div>
                <div className="text-lg font-extrabold font-mono text-rose-600 mt-0.5">
                  {activeSelectedCardRisk.currentTcMax.toFixed(2)} °C
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                  <span>Δ(Tc − Tf):</span>
                  <strong className="font-mono text-slate-800">+{activeSelectedCardRisk.deltaTcMinusTf.toFixed(2)} °C</strong>
                  <span>•</span>
                  <span
                    className="font-bold"
                    style={{ color: activeSelectedCardRisk.currentZone.color }}
                  >
                    {activeSelectedCardRisk.currentZone.name}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-200/60 font-mono">
                  {appliedScenarioConfig.horizonDays > 0
                    ? `Forecast (+${appliedScenarioConfig.horizonDays}d): Tc = ${activeSelectedCardRisk.projected30dTcMax.toFixed(2)} °C`
                    : 'Mode: Actual Recorded Fiber & Power Data'}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-xs font-semibold text-slate-500">Composite Risk Index (SRI)</div>
                <div className="text-lg font-extrabold font-mono text-indigo-700 mt-0.5">
                  {activeSelectedCardRisk.sriScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-200 mt-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${activeSelectedCardRisk.sriScore}%`,
                      backgroundColor: activeSelectedCardRisk.governingZone.color,
                    }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-200/60 font-mono">
                  At: {activeSelectedCardRisk.tcRecordDateTime}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-xs font-semibold text-slate-500">Thermal Safety Margins (vs Tc)</div>
                <div className="text-lg font-extrabold font-mono text-emerald-700 mt-0.5">
                  {activeSelectedCardRisk.marginToAlert55 > 0
                    ? `+${activeSelectedCardRisk.marginToAlert55.toFixed(2)} °C`
                    : `${activeSelectedCardRisk.marginToAlert55.toFixed(2)} °C`}{' '}
                  <span className="text-xs font-normal text-slate-500">to 55°C Alert</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono">
                  To 60°C Danger:{' '}
                  <strong className="text-slate-800">
                    {activeSelectedCardRisk.marginToDanger60 > 0
                      ? `+${activeSelectedCardRisk.marginToDanger60.toFixed(2)}°C`
                      : `${activeSelectedCardRisk.marginToDanger60.toFixed(2)}°C`}
                  </strong>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-200/60 font-mono">
                  To 70°C Critical:{' '}
                  <strong className="text-slate-800">
                    {activeSelectedCardRisk.marginToCritical70 > 0
                      ? `+${activeSelectedCardRisk.marginToCritical70.toFixed(2)}°C`
                      : `${activeSelectedCardRisk.marginToCritical70.toFixed(2)}°C`}
                  </strong>
                </div>
              </div>
            </div>

            {/* Root Cause, Standard & Action Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/80 space-y-2">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Thermal Bottleneck Root Cause &amp; Standard Reference
                </div>
                <p className="text-slate-700 leading-relaxed">
                  {activeSelectedCardRisk.rootCauseCategory}
                </p>
                <div className="pt-2 border-t border-amber-200/60 font-mono text-xs font-bold text-indigo-700">
                  Governing Standard: {activeSelectedCardRisk.standardReference}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200/80 space-y-2">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 text-emerald-600" />
                  Engineering Mitigation &amp; Dispatch Guidance
                </div>
                <p className="text-slate-700 leading-relaxed">
                  <strong>Short-Term Action:</strong> {activeSelectedCardRisk.shortTermAction}
                </p>
                <p className="text-slate-700 leading-relaxed pt-1 border-t border-emerald-200/60">
                  <strong>Medium/Long-Term Civil Action:</strong> {activeSelectedCardRisk.mediumLongTermAction}
                </p>
              </div>
            </div>

            {/* Navigate to Page 5 Button */}
            {onNavigateToSectionAnalysis && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => onNavigateToSectionAnalysis(activeSelectedCardRisk.sectionId)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-all cursor-pointer"
                >
                  Inspect Section {activeSelectedCardRisk.sectionId} on Page 5
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* AI Report */}
      {aiRiskReport && (
        <div className="bg-white rounded-2xl border border-rose-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  AI Engineering Risk Assessment &amp; International Standards Report
                </h3>
                <p className="text-xs text-slate-500">
                  Grounded in IEC 60287, IEC 60853-2, CIGRE &amp; IEEE Standards • Generated{' '}
                  {aiProcessedAt ? new Date(aiProcessedAt).toLocaleString() : 'just now'}
                </p>
              </div>
            </div>
            <button
              onClick={handleExportRiskPdf}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print / Save Risk PDF
            </button>
          </div>
          <div className="prose prose-slate max-w-none text-xs leading-relaxed whitespace-pre-wrap font-sans text-slate-700 bg-slate-50 p-5 rounded-xl border border-slate-200/80">
            {aiRiskReport}
          </div>
        </div>
      )}

      {/* Risk Analyzing Mini Popup Progress Modal */}
      {isAnalyzing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 text-white rounded-2xl border border-slate-700 shadow-2xl p-6 max-w-md w-full space-y-5 relative overflow-hidden">
            {/* Glowing top border accent */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-rose-500 to-amber-500" />

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/40 text-indigo-400 flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Risk Analyzing in Progress...</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                    {analysisProgress}%
                  </span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Period: <span className="text-amber-300 font-mono font-bold">{activeStartDate}</span> to <span className="text-amber-300 font-mono font-bold">{activeEndDate}</span>
                </p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden border border-slate-700 p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-500 transition-all duration-150 ease-out"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>0%</span>
                <span className="text-slate-300 font-semibold">{analysisStage}</span>
                <span>100%</span>
              </div>
            </div>

            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/80 text-xs text-slate-300 flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                Re-evaluating all 19 cable sections across selected period TEPR DTS, SCADA power files, and Multi-Factor Scenario settings.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

