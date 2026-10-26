import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp,
  Calendar,
  Layers,
  Thermometer,
  Zap,
  Info,
  Clock,
  Radio,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Sparkles,
  SlidersHorizontal,
  SplitSquareVertical,
  Maximize2,
  Palette,
  Pin,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CableSectionInfo,
} from '../data/cableCircuitStructure';
import {
  OrgDatabaseConfig,
  getOrgSectionDailyProfileDates,
  subscribeOrgDatabase,
} from '../services/orgDatabaseStorage';
import { ParsedTeprFile } from '../services/teprParser';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import {
  extractActualTelemetryForSection,
  ActualDailyTelemetrySummary,
  ActualTelemetryPoint,
} from '../services/actualTelemetryService';
import { NoDatabaseEmptyState } from './NoDatabaseEmptyState';

export interface PublicDailyCurvePageProps {
  dbConfig: OrgDatabaseConfig;
  onAdminLoginClick: () => void;
  isAdminLoggedIn: boolean;
  onGoToFolderAsset: () => void;
  parsedFiles?: ParsedTeprFile[];
  scannedFiles?: any[];
  powerScannedFiles?: any[];
  dateFilteredParsedFiles?: ParsedTeprFile[];
  activeDailyPowerSummary?: DailyPowerSummary | null;
  powerSummariesByDate?: Map<string, DailyPowerSummary>;
  selectedDateFilter?: string;
  selectedYearFilter?: string;
  selectedMonthFilter?: string;
  selectedPhaseFilter?: string;
  hasReadTemperature?: boolean;
  onReadTemperature?: (scannedMeta?: any[], year?: string, month?: string, date?: string) => Promise<void>;
}

type SubPanelMode = 'single' | 'comparison';
type ComparisonLayoutMode = 'split_zones' | 'stacked_charts';
type ColorTheme = 'amber_rose' | 'cyan_coral';

export const PublicDailyCurvePage: React.FC<PublicDailyCurvePageProps> = ({
  dbConfig,
  onAdminLoginClick,
  isAdminLoggedIn,
  onGoToFolderAsset,
  parsedFiles = [],
  scannedFiles = [],
  powerScannedFiles = [],
  dateFilteredParsedFiles = [],
  activeDailyPowerSummary = null,
  powerSummariesByDate,
  selectedDateFilter = 'all',
  selectedPhaseFilter = 'all',
  onReadTemperature,
}) => {
  const [profileDbVersion, setProfileDbVersion] = useState<number>(0);
  const [activeSubPanel, setActiveSubPanel] = useState<SubPanelMode>('single');

  useEffect(() => {
    const unsub = subscribeOrgDatabase(() => {
      setProfileDbVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  // Available dates strictly from Panel 3 ("Section daily profile database")
  const availableDates = useMemo(() => {
    return getOrgSectionDailyProfileDates();
  }, [dbConfig, profileDbVersion]);

  const hasAnyDataSource = availableDates.length > 0;

  // Single Date Mode: State
  const initialDate = useMemo(() => {
    if (selectedDateFilter && selectedDateFilter !== 'all' && availableDates.includes(selectedDateFilter)) {
      return selectedDateFilter;
    }
    if (availableDates.length > 0) {
      return availableDates[availableDates.length - 1];
    }
    return '';
  }, [selectedDateFilter, availableDates]);

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('2.3');
  const [selectedPhase, setSelectedPhase] = useState<string>(
    selectedPhaseFilter !== 'all' ? selectedPhaseFilter : 'all'
  );

  // Comparison Mode: State for 2 different dates
  const [compareDate1, setCompareDate1] = useState<string>(() => {
    if (availableDates.length >= 2) return availableDates[availableDates.length - 2];
    return availableDates[0] || '';
  });
  const [compareDate2, setCompareDate2] = useState<string>(() => {
    return availableDates[availableDates.length - 1] || '';
  });
  const [showHourlyChangeLabels, setShowHourlyChangeLabels] = useState<boolean>(true);
  const [layoutMode, setLayoutMode] = useState<ComparisonLayoutMode>('split_zones');
  const [colorTheme, setColorTheme] = useState<ColorTheme>('amber_rose');

  // Determine chronological order between the 2 dates:
  // The change indicator will PIN specifically at the NEWER date curve!
  const isDate2Newer = useMemo(() => {
    return compareDate2 >= compareDate1;
  }, [compareDate1, compareDate2]);

  const newerDateLabel = isDate2Newer ? compareDate2 : compareDate1;
  const olderDateLabel = isDate2Newer ? compareDate1 : compareDate2;

  // Palette Definitions: Same date group uses the same tone, with fiber temp as a lighter shade!
  const themeColors = useMemo(() => {
    if (colorTheme === 'cyan_coral') {
      return {
        // Date 1: Cool Sky Cyan Tone Family
        date1: {
          name: 'Cool Sky Cyan',
          badgeText: 'text-sky-300',
          badgeBorder: 'border-sky-500/40',
          badgeBg: 'bg-sky-950/70',
          conductor: '#0ea5e9', // Saturated Sky Blue
          fiber: '#7dd3fc', // Lighter shade in sky cyan tone
          power: '#0369a1', // Deep cobalt/cyan in same family
          powerAreaGrad: 'skyGradDate1',
          powerAreaColor: '#0284c7',
        },
        // Date 2: Warm Coral Tone Family
        date2: {
          name: 'Warm Coral',
          badgeText: 'text-rose-300',
          badgeBorder: 'border-rose-500/40',
          badgeBg: 'bg-rose-950/70',
          conductor: '#ef4444', // Saturated Coral Red
          fiber: '#fca5a5', // Lighter shade in coral tone
          power: '#991b1b', // Deep crimson in same family
          powerAreaGrad: 'coralGradDate2',
          powerAreaColor: '#dc2626',
        },
      };
    }

    // Default: Amber Tone (Date 1) vs. Rose Tone (Date 2)
    return {
      // Date 1: Warm Amber / Gold Family
      date1: {
        name: 'Warm Amber / Gold',
        badgeText: 'text-amber-300',
        badgeBorder: 'border-amber-500/40',
        badgeBg: 'bg-amber-950/70',
        conductor: '#f59e0b', // Saturated Amber Gold
        fiber: '#fde68a', // Lighter shade: soft warm yellow
        power: '#b45309', // Deep bronze ochre in same warm amber family
        powerAreaGrad: 'amberGradDate1',
        powerAreaColor: '#d97706',
      },
      // Date 2: Vibrant Rose / Crimson Family
      date2: {
        name: 'Vibrant Rose / Crimson',
        badgeText: 'text-rose-300',
        badgeBorder: 'border-rose-500/40',
        badgeBg: 'bg-rose-950/70',
        conductor: '#f43f5e', // Saturated Vivid Rose / Crimson
        fiber: '#fbcfe8', // Lighter shade: soft petal rose
        power: '#be123c', // Deep wine rose in same family
        powerAreaGrad: 'roseGradDate2',
        powerAreaColor: '#e11d48',
      },
    };
  }, [colorTheme]);

  // Automatically sync single selectedDate when Panel 3 dates update
  useEffect(() => {
    if (availableDates.length > 0 && (!selectedDate || !availableDates.includes(selectedDate))) {
      const latest = availableDates[availableDates.length - 1];
      setSelectedDate(latest);
    }
  }, [availableDates, selectedDate]);

  // Sync comparison dates when availableDates change
  useEffect(() => {
    if (availableDates.length > 0) {
      if (!compareDate1 || !availableDates.includes(compareDate1)) {
        setCompareDate1(availableDates.length >= 2 ? availableDates[availableDates.length - 2] : availableDates[0]);
      }
      if (!compareDate2 || !availableDates.includes(compareDate2)) {
        setCompareDate2(availableDates[availableDates.length - 1]);
      }
    }
  }, [availableDates, compareDate1, compareDate2]);

  useEffect(() => {
    if (selectedPhaseFilter && selectedPhaseFilter !== 'all') {
      setSelectedPhase(selectedPhaseFilter);
    }
  }, [selectedPhaseFilter]);

  const activeSection: CableSectionInfo = useMemo(() => {
    return (
      CIRCUIT_3_SECTIONS.find((s) => s.sectionId === selectedSectionId) ||
      CIRCUIT_3_SECTIONS[0]
    );
  }, [selectedSectionId]);

  const isLand = activeSection.category === 'land' || activeSection.sectionId.startsWith('1.');

  // Extract Single Date Actual Telemetry
  const actualTelemetry: ActualDailyTelemetrySummary = useMemo(() => {
    const targetDate = selectedDate;
    if (!targetDate) {
      return {
        sectionId: selectedSectionId,
        sectionName: activeSection.name,
        category: (activeSection.category || 'submarine') as 'land' | 'submarine',
        dateKey: selectedDate,
        phase: selectedPhase,
        dataSource: 'none',
        dataSourceLabel: 'No Data Available',
        points: [],
        peakFiberTempC: 0,
        peakConductorTempC: 0,
        peakTime: '00:00',
        peakPowerMW: 0,
        peakFileName: '',
        totalActualScans: 0,
      };
    }

    return extractActualTelemetryForSection({
      sectionId: selectedSectionId,
      dateKey: targetDate,
      phaseFilter: isLand ? selectedPhase : 'all',
      parsedFiles: [],
    });
  }, [
    selectedDate,
    selectedSectionId,
    selectedPhase,
    activeSection,
    isLand,
    profileDbVersion,
  ]);

  // Extract Comparison Date 1 Telemetry
  const telemetryDate1: ActualDailyTelemetrySummary = useMemo(() => {
    if (!compareDate1) {
      return {
        sectionId: selectedSectionId,
        sectionName: activeSection.name,
        category: (activeSection.category || 'submarine') as 'land' | 'submarine',
        dateKey: '',
        phase: selectedPhase,
        dataSource: 'none',
        dataSourceLabel: 'No Data',
        points: [],
        peakFiberTempC: 0,
        peakConductorTempC: 0,
        peakTime: '00:00',
        peakPowerMW: 0,
        peakFileName: '',
        totalActualScans: 0,
      };
    }
    return extractActualTelemetryForSection({
      sectionId: selectedSectionId,
      dateKey: compareDate1,
      phaseFilter: isLand ? selectedPhase : 'all',
      parsedFiles: [],
    });
  }, [
    compareDate1,
    selectedSectionId,
    selectedPhase,
    activeSection,
    isLand,
    profileDbVersion,
  ]);

  // Extract Comparison Date 2 Telemetry
  const telemetryDate2: ActualDailyTelemetrySummary = useMemo(() => {
    if (!compareDate2) {
      return {
        sectionId: selectedSectionId,
        sectionName: activeSection.name,
        category: (activeSection.category || 'submarine') as 'land' | 'submarine',
        dateKey: '',
        phase: selectedPhase,
        dataSource: 'none',
        dataSourceLabel: 'No Data',
        points: [],
        peakFiberTempC: 0,
        peakConductorTempC: 0,
        peakTime: '00:00',
        peakPowerMW: 0,
        peakFileName: '',
        totalActualScans: 0,
      };
    }
    return extractActualTelemetryForSection({
      sectionId: selectedSectionId,
      dateKey: compareDate2,
      phaseFilter: isLand ? selectedPhase : 'all',
      parsedFiles: [],
    });
  }, [
    compareDate2,
    selectedSectionId,
    selectedPhase,
    activeSection,
    isLand,
    profileDbVersion,
  ]);

  // Merged 24-Hour Comparison Telemetry with Change Indicators
  const comparisonData = useMemo(() => {
    if (!compareDate1 || !compareDate2) return [];

    const map1 = new Map<number, ActualTelemetryPoint>();
    const map2 = new Map<number, ActualTelemetryPoint>();

    (telemetryDate1?.points || []).forEach((p, idx) => {
      const h = typeof p.hourNum === 'number' ? p.hourNum : idx;
      map1.set(h, p);
    });

    (telemetryDate2?.points || []).forEach((p, idx) => {
      const h = typeof p.hourNum === 'number' ? p.hourNum : idx;
      map2.set(h, p);
    });

    const hours = Array.from({ length: 24 }, (_, i) => i);
    return hours.map((hour) => {
      const timeStr = `${String(hour).padStart(2, '0')}:00`;
      const p1 = map1.get(hour);
      const p2 = map2.get(hour);

      const fiberTemp1 = p1?.fiberTempC ?? 0;
      const conductorTemp1 = p1?.conductorTempC ?? 0;
      const power1 = p1?.powerCkt3MW ?? 0;

      const fiberTemp2 = p2?.fiberTempC ?? 0;
      const conductorTemp2 = p2?.conductorTempC ?? 0;
      const power2 = p2?.powerCkt3MW ?? 0;

      const deltaTc = parseFloat((conductorTemp2 - conductorTemp1).toFixed(2));
      const deltaTf = parseFloat((fiberTemp2 - fiberTemp1).toFixed(2));
      const deltaPower = parseFloat((power2 - power1).toFixed(2));

      // Delta relative specifically to newer date vs older date
      const newerTcDelta = isDate2Newer ? deltaTc : -deltaTc;
      const newerPowerDelta = isDate2Newer ? deltaPower : -deltaPower;

      const pctDeltaTc = conductorTemp1 > 0 ? parseFloat(((deltaTc / conductorTemp1) * 100).toFixed(1)) : 0;

      return {
        hour,
        time: timeStr,
        // Date 1 (Baseline / Reference)
        fiberTemp1,
        conductorTemp1,
        power1,
        // Date 2 (Comparison Target)
        fiberTemp2,
        conductorTemp2,
        power2,
        // Deltas & Indicators
        deltaTc,
        deltaTf,
        deltaPower,
        newerTcDelta,
        newerPowerDelta,
        pctDeltaTc,
        isHigherTc: deltaTc > 0.1,
        isLowerTc: deltaTc < -0.1,
      };
    });
  }, [telemetryDate1, telemetryDate2, compareDate1, compareDate2, isDate2Newer]);

  // Comparison Summary Statistics
  const comparisonStats = useMemo(() => {
    if (!telemetryDate1 || !telemetryDate2 || comparisonData.length === 0) return null;

    const peakTc1 = telemetryDate1.peakConductorTempC || 0;
    const peakTc2 = telemetryDate2.peakConductorTempC || 0;
    const peakTcDelta = parseFloat((peakTc2 - peakTc1).toFixed(2));
    const peakTcPct = peakTc1 > 0 ? parseFloat(((peakTcDelta / peakTc1) * 100).toFixed(1)) : 0;

    const peakTf1 = telemetryDate1.peakFiberTempC || 0;
    const peakTf2 = telemetryDate2.peakFiberTempC || 0;
    const peakTfDelta = parseFloat((peakTf2 - peakTf1).toFixed(2));

    const peakPower1 = telemetryDate1.peakPowerMW || 0;
    const peakPower2 = telemetryDate2.peakPowerMW || 0;
    const peakPowerDelta = parseFloat((peakPower2 - peakPower1).toFixed(2));

    // Find hour with maximum divergence
    let maxShift = comparisonData[0];
    for (const pt of comparisonData) {
      if (Math.abs(pt.deltaTc) > Math.abs(maxShift?.deltaTc || 0)) {
        maxShift = pt;
      }
    }

    const validPoints = comparisonData.filter((p) => p.conductorTemp1 > 0 && p.conductorTemp2 > 0);
    const avgTcDelta =
      validPoints.length > 0
        ? parseFloat((validPoints.reduce((acc, p) => acc + p.deltaTc, 0) / validPoints.length).toFixed(2))
        : 0;

    return {
      peakTc1,
      peakTc2,
      peakTcDelta,
      peakTcPct,
      peakTf1,
      peakTf2,
      peakTfDelta,
      peakPower1,
      peakPower2,
      peakPowerDelta,
      maxShiftHour: maxShift?.time || '12:00',
      maxShiftDelta: maxShift?.deltaTc || 0,
      avgTcDelta,
    };
  }, [telemetryDate1, telemetryDate2, comparisonData]);

  // Dynamic Vertical Scale Calculation:
  // Separates Circuit 3 Power into the Upper Zone and Cable Temperatures into the Lower Zone to eliminate overlay!
  const verticalScale = useMemo(() => {
    let minT = Infinity;
    let maxT = -Infinity;
    let minP = Infinity;
    let maxP = -Infinity;

    comparisonData.forEach((d) => {
      if (d.conductorTemp1 > 0) {
        minT = Math.min(minT, d.conductorTemp1, d.fiberTemp1);
        maxT = Math.max(maxT, d.conductorTemp1, d.fiberTemp1);
      }
      if (d.conductorTemp2 > 0) {
        minT = Math.min(minT, d.conductorTemp2, d.fiberTemp2);
        maxT = Math.max(maxT, d.conductorTemp2, d.fiberTemp2);
      }
      if (d.power1 > 0) {
        minP = Math.min(minP, d.power1);
        maxP = Math.max(maxP, d.power1);
      }
      if (d.power2 > 0) {
        minP = Math.min(minP, d.power2);
        maxP = Math.max(maxP, d.power2);
      }
    });

    if (!Number.isFinite(minT)) minT = 32;
    if (!Number.isFinite(maxT)) maxT = 50;
    if (!Number.isFinite(minP)) minP = 30;
    if (!Number.isFinite(maxP)) maxP = 75;

    // For Temperature Axis (Lower Band 5% to 45% of height):
    const tempDomainMin = Math.max(10, Math.floor(minT - 3));
    const rawSpan = Math.max(14, maxT - tempDomainMin + 2);
    const tempDomainMax = Math.max(68, Math.ceil(tempDomainMin + rawSpan / 0.44));

    // For Power Axis (Upper Band 55% to 95% of height):
    const powerSpan = Math.max(25, maxP - minP + 8);
    const totalPowerDomainSpan = powerSpan / 0.40;
    const powerDomainMax = Math.ceil(maxP + 6);
    const powerDomainMin = Math.floor(powerDomainMax - totalPowerDomainSpan);

    // Dedicated pure scales for Stacked Charts mode
    const pureTempMin = Math.max(15, Math.floor(minT - 2));
    const pureTempMax = Math.ceil(Math.max(65, maxT + 3));
    const purePowerMin = Math.max(0, Math.floor(minP - 5));
    const purePowerMax = Math.ceil(maxP + 5);

    return {
      split: {
        tempDomain: [tempDomainMin, tempDomainMax],
        powerDomain: [powerDomainMin, powerDomainMax],
        minTemp: minT,
        maxTemp: maxT,
        minPower: minP,
        maxPower: maxP,
      },
      pure: {
        tempDomain: [pureTempMin, pureTempMax],
        powerDomain: [purePowerMin, purePowerMax],
      },
    };
  }, [comparisonData]);

  // Helper component to render the CHANGE INDICATOR PIN on the newer date curve
  const renderPinnedChangeIndicator = (props: any, metric: 'conductor' | 'power') => {
    const { cx, cy, payload } = props;
    if (!cx || !cy || !payload) return null;

    // Values relative to the newer date vs older date
    const dVal = metric === 'conductor' ? payload.newerTcDelta : payload.newerPowerDelta;
    const isUp = dVal > 0.05;
    const isDown = dVal < -0.05;

    // Pin theme colors
    const pinColor = isUp ? '#f43f5e' : isDown ? '#10b981' : '#94a3b8';
    const arrowSymbol = isUp ? '▲' : isDown ? '▼' : '●';
    const textDelta =
      metric === 'conductor'
        ? `${arrowSymbol}${dVal > 0 ? '+' : ''}${dVal.toFixed(1)}°`
        : `${arrowSymbol}${dVal > 0 ? '+' : ''}${dVal.toFixed(1)}M`;

    // Only render full badge on key hours to avoid clutter (every 2 hours, plus max shift hour)
    const isMaxShift = payload.time === comparisonStats?.maxShiftHour;
    const isEvenHour = payload.hour % 2 === 0;
    const shouldShowBadge = showHourlyChangeLabels && (isEvenHour || isMaxShift);

    // Position badge above or below point
    const pinAbove = cy > 50;
    const badgeY = pinAbove ? cy - 22 : cy + 9;
    const textY = pinAbove ? cy - 11 : cy + 20;

    return (
      <g key={`pin-${metric}-${payload.hour}`}>
        {/* Glow circle for max shift hour */}
        {isMaxShift && (
          <circle cx={cx} cy={cy} r={8} fill={pinColor} opacity={0.25} />
        )}

        {/* Pin Anchor Dot on the Newer Date Curve */}
        <circle
          cx={cx}
          cy={cy}
          r={isMaxShift ? 5 : 4}
          fill={pinColor}
          stroke="#060911"
          strokeWidth={1.8}
        />

        {/* Pinned Callout Pin Badge (Pinned directly to the newer date curve) */}
        {shouldShowBadge && (
          <g>
            {/* Pin Stem Needle */}
            <line
              x1={cx}
              y1={cy}
              x2={cx}
              y2={pinAbove ? cy - 8 : cy + 8}
              stroke={pinColor}
              strokeWidth={1.2}
              strokeDasharray="1 1"
            />
            {/* Pinned Badge Box */}
            <rect
              x={cx - 18}
              y={badgeY}
              width={36}
              height={14}
              rx={4}
              fill="#060911"
              stroke={pinColor}
              strokeWidth={1.1}
              opacity={0.95}
              className="drop-shadow-md"
            />
            {/* Delta Text inside Pin */}
            <text
              x={cx}
              y={textY}
              fill={pinColor}
              fontSize={8.5}
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              {textDelta}
            </text>
          </g>
        )}
      </g>
    );
  };

  const hasSingleData = (actualTelemetry?.points?.length || 0) > 0;
  const hasCompareData = (telemetryDate1?.points?.length || 0) > 0 && (telemetryDate2?.points?.length || 0) > 0;

  const handleSwapDates = () => {
    const temp = compareDate1;
    setCompareDate1(compareDate2);
    setCompareDate2(temp);
  };

  if (!hasAnyDataSource) {
    return (
      <NoDatabaseEmptyState
        pageNumber="2.2"
        pageTitle="Daily Temperature Curve"
        onAdminLoginClick={onAdminLoginClick}
        isAdminLoggedIn={isAdminLoggedIn}
        onGoToFolderAsset={onGoToFolderAsset}
      />
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Sub-Panel Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/95 backdrop-blur-xl p-2.5 px-3 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubPanel('single')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
              activeSubPanel === 'single'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_14px_rgba(6,182,212,0.3)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <span>Single Date Daily Temperature Curve</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubPanel('comparison')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
              activeSubPanel === 'comparison'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_14px_rgba(6,182,212,0.3)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
            <span>Custom Range Comparison</span>
            <span className="text-[10px] uppercase px-1.5 py-0.2 rounded bg-cyan-900/50 text-cyan-300 border border-cyan-500/30">
              Dual Date
            </span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-slate-400 hidden lg:flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>Section Profile Database Active ({availableDates.length} Dates Available)</span>
        </div>
      </div>

      {/* SUB-PANEL 1: SINGLE DATE DAILY TEMPERATURE CURVE */}
      {activeSubPanel === 'single' && (
        <div className="space-y-4">
          {/* Top Filter and Context Bar */}
          <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
                  <TrendingUp className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-sm font-black text-slate-100 font-mono tracking-tight leading-tight">
                    [2.2] SINGLE DATE DAILY TEMPERATURE CURVE
                  </h2>
                  <p className="text-[11px] text-cyan-400/80 font-mono">
                    Fiber &amp; Conductor Thermal Profiles vs. Circuit 3 Power Consumption (Dual Y-Axis)
                  </p>
                </div>
              </div>

              <div className="h-6 w-px bg-slate-800 hidden sm:block" />

              {/* 1. Date Filter */}
              <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs text-slate-400 font-mono">DATE:</span>
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer"
                >
                  {availableDates.map((d) => (
                    <option key={d} value={d} className="bg-slate-900 text-slate-200">
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Section Selector */}
              <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs text-slate-400 font-mono">SEC:</span>
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId(e.target.value)}
                  className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer max-w-[210px] truncate"
                >
                  <optgroup label="── SUBMARINE ZONES (13) ──" className="bg-slate-950 text-cyan-400 font-bold">
                    {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine').map((sec) => (
                      <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                        Zone {sec.sectionId}: {sec.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="── LAND SECTIONS (6) ──" className="bg-slate-950 text-emerald-400 font-bold">
                    {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land').map((sec) => (
                      <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                        Sec {sec.sectionId}: {sec.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* 3. Land Phase Filter */}
              {isLand && (
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
                  <span className="text-[10px] text-slate-400 px-1 font-bold">PHASE:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('all')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'all'
                        ? 'bg-slate-700 text-slate-100 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('Phase A')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'Phase A' || selectedPhase === 'A'
                        ? 'bg-red-500/30 text-red-300 border border-red-500/50 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('Phase B')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'Phase B' || selectedPhase === 'B'
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('Phase C')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'Phase C' || selectedPhase === 'C'
                        ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    C
                  </button>
                </div>
              )}
            </div>

            {/* Current Plotted Target Status */}
            {selectedDate && (
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-[10px] text-slate-400 uppercase">PLOTTED:</span>
                <span className="px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 font-bold">
                  {selectedDate} (Sec {selectedSectionId})
                </span>
              </div>
            )}
          </div>

          {/* Main Telemetry & Chart Area */}
          <div className="bg-slate-900/90 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-cyan-500/20 shadow-[0_0_35px_rgba(6,182,212,0.08)] space-y-5">
            {/* Section Header & KPI Badges */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                    SEC {activeSection.sectionId}
                  </span>
                  <h3 className="text-base font-extrabold text-white tracking-tight">
                    {activeSection.name}
                  </h3>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {activeSection.subtitle} • {activeSection.lengthMeters} m • Equation {activeSection.equationName}
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono">
                <div className="bg-sky-950/40 border border-sky-500/40 px-3 py-1.5 rounded-xl text-sky-300">
                  <span className="text-[10px] uppercase font-bold text-sky-400 block">Peak Fiber Tf</span>
                  <span className="font-extrabold text-sm font-mono">
                    {(actualTelemetry?.peakFiberTempC ?? 0) > 0 ? `${actualTelemetry.peakFiberTempC.toFixed(1)} °C` : '-'}
                  </span>
                </div>
                <div className="bg-amber-950/40 border border-amber-500/40 px-3 py-1.5 rounded-xl text-amber-300">
                  <span className="text-[10px] uppercase font-bold text-amber-400 block">Peak Conductor Tc</span>
                  <span className="font-extrabold text-sm font-mono">
                    {(actualTelemetry?.peakConductorTempC ?? 0) > 0 ? `${actualTelemetry.peakConductorTempC.toFixed(1)} °C` : '-'}
                  </span>
                </div>
                <div className="bg-purple-950/40 border border-purple-500/40 px-3 py-1.5 rounded-xl text-purple-300">
                  <span className="text-[10px] uppercase font-bold text-purple-400 block">Circuit 3 Peak MW</span>
                  <span className="font-extrabold text-sm font-mono">
                    {(actualTelemetry?.peakPowerMW ?? 0) > 0 ? `${actualTelemetry.peakPowerMW.toFixed(1)} MW` : '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* Chart Area */}
            {hasSingleData ? (
              <div className="h-[430px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={actualTelemetry.points}
                    margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                  >
                    <defs>
                      <linearGradient id="ckt3PowerAreaGradSingle" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                    <XAxis
                      dataKey="time"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                      interval={2}
                    />
                    {/* Left Y-Axis: Temperature (°C) */}
                    <YAxis
                      yAxisId="tempAxis"
                      stroke="#38bdf8"
                      domain={[15, 90]}
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
                    {/* Right Y-Axis: Power Consumption (MW) of Circuit 3 */}
                    <YAxis
                      yAxisId="powerAxis"
                      orientation="right"
                      stroke="#a855f7"
                      domain={[0, 110]}
                      tick={{ fill: '#c084fc', fontSize: 11, fontFamily: 'monospace' }}
                      label={{
                        value: 'Circuit 3 Power (MW)',
                        angle: 90,
                        position: 'insideRight',
                        fill: '#c084fc',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        fontWeight: 'bold',
                      }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-slate-950/95 border border-cyan-500/40 rounded-xl p-3 text-xs font-mono shadow-2xl space-y-1.5 min-w-[210px]">
                            <div className="font-bold text-cyan-300 border-b border-slate-800 pb-1 flex justify-between">
                              <span>{d.peakTime ? `${label} (${d.peakTime})` : `${label} hrs`}</span>
                              <span className="text-slate-400">Sec {activeSection.sectionId}</span>
                            </div>
                            <div className="flex justify-between items-center text-sky-400">
                              <span>Fiber Temp (Tf):</span>
                              <span className="font-bold">{(d.fiberTempC ?? 0).toFixed(2)} °C</span>
                            </div>
                            <div className="flex justify-between items-center text-amber-400">
                              <span>Est Conductor (Tc):</span>
                              <span className="font-bold">{(d.conductorTempC ?? 0).toFixed(2)} °C</span>
                            </div>
                            <div className="flex justify-between items-center text-purple-400 border-t border-slate-800/60 pt-1">
                              <span>Circuit 3 Power:</span>
                              <span className="font-bold">{(d.powerCkt3MW ?? 0).toFixed(2)} MW</span>
                            </div>
                            <div className="flex justify-between items-center text-indigo-300">
                              <span>Total Island Power:</span>
                              <span className="font-bold">{(d.totalIslandMW ?? 0).toFixed(2)} MW</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: 10, fontFamily: 'monospace', fontSize: 11 }}
                    />

                    {/* Right Axis: Circuit 3 Power Flow */}
                    <Area
                      yAxisId="powerAxis"
                      type="monotone"
                      dataKey="powerCkt3MW"
                      name="Circuit 3 Power Flow (MW)"
                      stroke="#a855f7"
                      strokeWidth={4}
                      fill="url(#ckt3PowerAreaGradSingle)"
                      fillOpacity={1}
                      dot={{ r: 3, fill: '#a855f7', stroke: '#0f172a', strokeWidth: 1.4 }}
                      activeDot={{ r: 6, fill: '#c084fc', stroke: '#ffffff', strokeWidth: 2 }}
                    />

                    {/* Left Axis: Estimated Conductor Temp (Line, Amber) */}
                    <Line
                      yAxisId="tempAxis"
                      type="monotone"
                      dataKey="conductorTempC"
                      name="Estimated Conductor Temp (Tc, °C)"
                      stroke="#f59e0b"
                      strokeWidth={2.8}
                      dot={{ r: 3, fill: '#f59e0b', stroke: '#ffffff', strokeWidth: 1 }}
                      activeDot={{ r: 5 }}
                    />

                    {/* Left Axis: Measured Optical Fiber Temp (Line, Sky Blue) */}
                    <Line
                      yAxisId="tempAxis"
                      type="monotone"
                      dataKey="fiberTempC"
                      name="Measured Fiber Temp (Tf, °C)"
                      stroke="#38bdf8"
                      strokeWidth={2.4}
                      dot={{ r: 2.5, fill: '#38bdf8' }}
                      activeDot={{ r: 5 }}
                    />

                    <ReferenceLine
                      yAxisId="tempAxis"
                      y={65}
                      stroke="#ef4444"
                      strokeDasharray="3 3"
                      label={{ value: '65°C Alert', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-20 text-center space-y-3">
                <Thermometer className="w-12 h-12 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300 font-mono">
                  No Recorded Telemetry Found for {selectedDate}
                </div>
                <p className="text-xs text-slate-500 font-mono max-w-md mx-auto">
                  Please choose another date or section from the dropdowns above to inspect daily telemetry.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-PANEL 2: CUSTOM RANGE COMPARISON (DUAL DATES) */}
      {activeSubPanel === 'comparison' && (
        <div className="space-y-4">
          {/* Comparison Filter and Date Controls */}
          <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
                  <ArrowLeftRight className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-sm font-black text-slate-100 font-mono tracking-tight leading-tight">
                    [2.2] CUSTOM RANGE COMPARISON
                  </h2>
                  <p className="text-[11px] text-cyan-400/80 font-mono">
                    Multi-Date Hourly Curve Comparison with Real-Time Pinned Change Indicators
                  </p>
                </div>
              </div>

              <div className="h-6 w-px bg-slate-800 hidden sm:block" />

              {/* Date 1 (Baseline / Reference) */}
              <div
                className={`flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border ${themeColors.date1.badgeBorder} shadow-sm`}
              >
                <Calendar className={`w-3.5 h-3.5 ${themeColors.date1.badgeText}`} />
                <span className={`text-[11px] ${themeColors.date1.badgeText} font-mono font-bold`}>DATE 1:</span>
                <select
                  value={compareDate1}
                  onChange={(e) => setCompareDate1(e.target.value)}
                  className={`text-xs font-mono font-bold ${themeColors.date1.badgeText} bg-transparent border-none outline-none cursor-pointer`}
                >
                  {availableDates.map((d) => (
                    <option key={d} value={d} className="bg-slate-900 text-slate-200">
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* Swap Button */}
              <button
                type="button"
                onClick={handleSwapDates}
                title="Swap Date 1 and Date 2"
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 hover:border-cyan-500/40 transition-all cursor-pointer shadow-sm"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>

              {/* Date 2 (Comparison Target) */}
              <div
                className={`flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border ${themeColors.date2.badgeBorder} shadow-sm`}
              >
                <Calendar className={`w-3.5 h-3.5 ${themeColors.date2.badgeText}`} />
                <span className={`text-[11px] ${themeColors.date2.badgeText} font-mono font-bold`}>DATE 2:</span>
                <select
                  value={compareDate2}
                  onChange={(e) => setCompareDate2(e.target.value)}
                  className={`text-xs font-mono font-bold ${themeColors.date2.badgeText} bg-transparent border-none outline-none cursor-pointer`}
                >
                  {availableDates.map((d) => (
                    <option key={d} value={d} className="bg-slate-900 text-slate-200">
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* Section Selector */}
              <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs text-slate-400 font-mono">SEC:</span>
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId(e.target.value)}
                  className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer max-w-[210px] truncate"
                >
                  <optgroup label="── SUBMARINE ZONES (13) ──" className="bg-slate-950 text-cyan-400 font-bold">
                    {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine').map((sec) => (
                      <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                        Zone {sec.sectionId}: {sec.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="── LAND SECTIONS (6) ──" className="bg-slate-950 text-emerald-400 font-bold">
                    {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land').map((sec) => (
                      <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                        Sec {sec.sectionId}: {sec.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Land Phase Filter */}
              {isLand && (
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
                  <span className="text-[10px] text-slate-400 px-1 font-bold">PHASE:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('all')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'all'
                        ? 'bg-slate-700 text-slate-100 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('Phase A')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'Phase A' || selectedPhase === 'A'
                        ? 'bg-red-500/30 text-red-300 border border-red-500/50 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('Phase B')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'Phase B' || selectedPhase === 'B'
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhase('Phase C')}
                    className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                      selectedPhase === 'Phase C' || selectedPhase === 'C'
                        ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    C
                  </button>
                </div>
              )}
            </div>

            {/* Layout & Control Toggles */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Layout Mode Toggle: Split-Band vs Two-Tier Stacked */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setLayoutMode('split_zones')}
                  title="Single Chart with Upper Power Zone and Lower Thermal Zone (Non-Overlapping)"
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    layoutMode === 'split_zones'
                      ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Split Zones</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('stacked_charts')}
                  title="Two Dedicated Stacked Charts: Power on Top, Temperature on Bottom"
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    layoutMode === 'stacked_charts'
                      ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <SplitSquareVertical className="w-3 h-3" />
                  <span>Stacked 2-Tier</span>
                </button>
              </div>

              {/* Color Theme Toggle */}
              <button
                type="button"
                onClick={() => setColorTheme(colorTheme === 'amber_rose' ? 'cyan_coral' : 'amber_rose')}
                title="Toggle Date 1 vs Date 2 Color Palette Theme"
                className="text-[11px] font-mono font-bold px-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Palette className="w-3.5 h-3.5 text-cyan-400" />
                <span>Theme: {colorTheme === 'amber_rose' ? 'Amber vs Rose' : 'Cyan vs Coral'}</span>
              </button>

              {/* Curve Delta Pin Badges Toggle */}
              <button
                type="button"
                onClick={() => setShowHourlyChangeLabels(!showHourlyChangeLabels)}
                title="Toggle change indicator pins on the newer date curve"
                className={`text-[11px] font-mono font-bold px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                  showHourlyChangeLabels
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                <Pin className="w-3.5 h-3.5 text-cyan-400" />
                <span>Pinned Δ Indicators: {showHourlyChangeLabels ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Main Comparison Area */}
          <div className="bg-slate-900/90 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-cyan-500/20 shadow-[0_0_35px_rgba(6,182,212,0.08)] space-y-5">
            {/* Header & Comparative KPI Cards */}
            <div className="space-y-4 pb-4 border-b border-slate-800/80">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                      SEC {activeSection.sectionId}
                    </span>
                    <h3 className="text-base font-extrabold text-white tracking-tight">
                      {activeSection.name}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {activeSection.subtitle} • {activeSection.lengthMeters} m • Equation {activeSection.equationName}
                  </p>
                </div>

                {/* Top Summary Badges for Date 1 vs Date 2 */}
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${themeColors.date1.badgeBorder} ${themeColors.date1.badgeBg}`}
                  >
                    <span
                      className="w-3 h-0.5 border-b-2 border-dashed"
                      style={{ borderColor: themeColors.date1.conductor }}
                    />
                    <span className={`font-bold ${themeColors.date1.badgeText}`}>
                      {compareDate1} {isDate2Newer ? '(Date 1 · Baseline)' : '(Date 1 · Newer Date ★)'}
                    </span>
                  </div>
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${themeColors.date2.badgeBorder} ${themeColors.date2.badgeBg}`}
                  >
                    <span
                      className="w-3 h-0.5"
                      style={{ backgroundColor: themeColors.date2.conductor }}
                    />
                    <span className={`font-bold ${themeColors.date2.badgeText}`}>
                      {compareDate2} {isDate2Newer ? '(Date 2 · Newer Date ★)' : '(Date 2 · Comparison)'}
                    </span>
                  </div>

                  {/* Indicator Pin Callout Banner */}
                  <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-cyan-500/30 text-[11px] font-mono text-cyan-300">
                    <Pin className="w-3 h-3 text-cyan-400" />
                    <span>Δ Pinned on Newer Date ({newerDateLabel})</span>
                  </div>
                </div>
              </div>

              {/* Comparative Delta Strip (Change Indicators) */}
              {comparisonStats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 pt-1">
                  {/* Conductor Temp Comparison */}
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono flex items-center justify-between">
                      <span>Peak Conductor (Tc)</span>
                      {comparisonStats.peakTcDelta > 0 ? (
                        <span className="text-rose-400 flex items-center text-[10px]">
                          <ArrowUpRight className="w-3 h-3" /> +{comparisonStats.peakTcDelta}°C
                        </span>
                      ) : comparisonStats.peakTcDelta < 0 ? (
                        <span className="text-emerald-400 flex items-center text-[10px]">
                          <ArrowDownRight className="w-3 h-3" /> {comparisonStats.peakTcDelta}°C
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">0.0°C</span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between font-mono">
                      <span className="text-xs font-bold" style={{ color: themeColors.date1.conductor }}>
                        {comparisonStats.peakTc1.toFixed(1)}°C
                      </span>
                      <span className="text-[10px] text-slate-500">→</span>
                      <span className="text-sm font-extrabold" style={{ color: themeColors.date2.conductor }}>
                        {comparisonStats.peakTc2.toFixed(1)}°C
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 pt-0.5 border-t border-slate-900">
                      Δ Shift: {comparisonStats.peakTcDelta > 0 ? `+${comparisonStats.peakTcDelta}°C` : `${comparisonStats.peakTcDelta}°C`} ({comparisonStats.peakTcPct > 0 ? `+${comparisonStats.peakTcPct}%` : `${comparisonStats.peakTcPct}%`})
                    </div>
                  </div>

                  {/* Fiber Temp Comparison */}
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono flex items-center justify-between">
                      <span>Peak Fiber (Tf)</span>
                      {comparisonStats.peakTfDelta > 0 ? (
                        <span className="text-emerald-400 flex items-center text-[10px]">
                          <ArrowUpRight className="w-3 h-3" /> +{comparisonStats.peakTfDelta}°C
                        </span>
                      ) : comparisonStats.peakTfDelta < 0 ? (
                        <span className="text-sky-400 flex items-center text-[10px]">
                          <ArrowDownRight className="w-3 h-3" /> {comparisonStats.peakTfDelta}°C
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">0.0°C</span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between font-mono">
                      <span className="text-xs font-bold" style={{ color: themeColors.date1.fiber }}>
                        {comparisonStats.peakTf1.toFixed(1)}°C
                      </span>
                      <span className="text-[10px] text-slate-500">→</span>
                      <span className="text-sm font-extrabold" style={{ color: themeColors.date2.fiber }}>
                        {comparisonStats.peakTf2.toFixed(1)}°C
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 pt-0.5 border-t border-slate-900">
                      Δ Shift: {comparisonStats.peakTfDelta > 0 ? `+${comparisonStats.peakTfDelta}°C` : `${comparisonStats.peakTfDelta}°C`}
                    </div>
                  </div>

                  {/* Circuit 3 Power Flow Comparison */}
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono flex items-center justify-between">
                      <span>Circuit 3 Peak MW</span>
                      {comparisonStats.peakPowerDelta > 0 ? (
                        <span className="text-rose-400 flex items-center text-[10px]">
                          <ArrowUpRight className="w-3 h-3" /> +{comparisonStats.peakPowerDelta} MW
                        </span>
                      ) : comparisonStats.peakPowerDelta < 0 ? (
                        <span className="text-emerald-400 flex items-center text-[10px]">
                          <ArrowDownRight className="w-3 h-3" /> {comparisonStats.peakPowerDelta} MW
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">0.0 MW</span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between font-mono">
                      <span className="text-xs font-bold" style={{ color: themeColors.date1.power }}>
                        {comparisonStats.peakPower1.toFixed(1)} MW
                      </span>
                      <span className="text-[10px] text-slate-500">→</span>
                      <span className="text-sm font-extrabold" style={{ color: themeColors.date2.power }}>
                        {comparisonStats.peakPower2.toFixed(1)} MW
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 pt-0.5 border-t border-slate-900">
                      Δ Load: {comparisonStats.peakPowerDelta > 0 ? `+${comparisonStats.peakPowerDelta} MW` : `${comparisonStats.peakPowerDelta} MW`}
                    </div>
                  </div>

                  {/* Max Divergence Hour */}
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono">
                      Max Hourly Δ Divergence
                    </div>
                    <div className="flex items-baseline justify-between font-mono">
                      <span className="text-sm font-extrabold text-cyan-300">{comparisonStats.maxShiftHour}</span>
                      <span className={`text-xs font-mono font-bold ${comparisonStats.maxShiftDelta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {comparisonStats.maxShiftDelta > 0 ? `+${comparisonStats.maxShiftDelta}°C` : `${comparisonStats.maxShiftDelta}°C`}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 pt-0.5 border-t border-slate-900">
                      Peak divergence point between dates
                    </div>
                  </div>

                  {/* 24-Hour Average Conductor Temp Shift */}
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 space-y-1 col-span-2 sm:col-span-4 lg:col-span-1">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono">
                      24-Hr Mean Conductor Δ
                    </div>
                    <div className="flex items-baseline justify-between font-mono">
                      <span className={`text-sm font-extrabold ${comparisonStats.avgTcDelta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {comparisonStats.avgTcDelta > 0 ? `+${comparisonStats.avgTcDelta}°C` : `${comparisonStats.avgTcDelta}°C`}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {comparisonStats.avgTcDelta > 0 ? 'WARMER' : 'COOLER'}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 pt-0.5 border-t border-slate-900">
                      Overall daily thermal displacement
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Comparison Chart Visualization */}
            {hasCompareData ? (
              <div className="space-y-5">
                {/* MODE A: UNIFIED SPLIT-BAND CHART (Power on Top Band, Temperature on Bottom Band, Non-Overlapping) */}
                {layoutMode === 'split_zones' && (
                  <div className="space-y-2">
                    {/* Zone Markers Banner */}
                    <div className="flex items-center justify-between text-[11px] font-mono px-3 py-1 bg-slate-950/60 rounded-xl border border-slate-800/70 text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColors.date2.power }} />
                        <span className="font-bold text-slate-300">UPPER ZONE: Circuit 3 Power Flow (MW)</span>
                        <span className="text-slate-500">(Right Y-Axis · Scaled out of thermal range to prevent overlay)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColors.date2.conductor }} />
                        <span className="font-bold text-slate-300">LOWER ZONE: Conductor &amp; Fiber Temp (°C)</span>
                        <span className="text-slate-500">(Left Y-Axis · Δ Indicators Pinned to {newerDateLabel})</span>
                      </div>
                    </div>

                    <div className="h-[490px] w-full pt-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={comparisonData}
                          margin={{ top: 25, right: 35, left: 15, bottom: 20 }}
                        >
                          <defs>
                            <linearGradient id={themeColors.date2.powerAreaGrad} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={themeColors.date2.powerAreaColor} stopOpacity={0.22} />
                              <stop offset="95%" stopColor={themeColors.date2.powerAreaColor} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>

                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />

                          <XAxis
                            dataKey="time"
                            stroke="#64748b"
                            tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                            interval={2}
                          />

                          {/* Left Y-Axis: Temperature (°C) - Occupies Lower Band (~10% to 45% height) */}
                          <YAxis
                            yAxisId="tempAxis"
                            stroke={themeColors.date1.conductor}
                            domain={verticalScale.split.tempDomain}
                            tick={{ fill: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' }}
                            label={{
                              value: 'Temperature (°C)',
                              angle: -90,
                              position: 'insideLeft',
                              fill: '#cbd5e1',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                            }}
                          />

                          {/* Right Y-Axis: Circuit 3 Power (MW) - Occupies Upper Band (~55% to 95% height) */}
                          <YAxis
                            yAxisId="powerAxis"
                            orientation="right"
                            stroke={themeColors.date2.power}
                            domain={verticalScale.split.powerDomain}
                            tick={{ fill: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' }}
                            tickFormatter={(val) => (val >= 0 ? `${val} MW` : '')}
                            label={{
                              value: 'Circuit 3 Power (MW)',
                              angle: 90,
                              position: 'insideRight',
                              fill: '#cbd5e1',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                            }}
                          />

                          {/* Tooltip with Side-by-Side Comparison & Change Indicators */}
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload || !payload.length) return null;
                              const d = payload[0].payload;
                              const isUpTc = d.deltaTc > 0;
                              const isDownTc = d.deltaTc < 0;

                              return (
                                <div className="bg-slate-950/95 border border-cyan-500/50 rounded-2xl p-3.5 text-xs font-mono shadow-2xl space-y-2.5 min-w-[340px]">
                                  {/* Header */}
                                  <div className="font-bold text-cyan-300 border-b border-slate-800 pb-1.5 flex justify-between items-center">
                                    <span>{label} hrs Telemetry Comparison</span>
                                    <span className="text-slate-400 font-normal">Sec {activeSection.sectionId}</span>
                                  </div>

                                  {/* Matrix Table */}
                                  <div className="space-y-2">
                                    {/* Conductor Temp (Tc) */}
                                    <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80">
                                      <div className="flex justify-between items-center text-[10px] text-slate-400 uppercase font-bold mb-1">
                                        <span>Conductor Temp (Tc)</span>
                                        <span
                                          className={`px-1.5 py-0.2 rounded font-bold ${
                                            isUpTc
                                              ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                                              : isDownTc
                                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                                              : 'bg-slate-800 text-slate-300'
                                          }`}
                                        >
                                          Δ {isUpTc ? `+${d.deltaTc}°C ▲` : `${d.deltaTc}°C ▼`} ({d.pctDeltaTc > 0 ? `+${d.pctDeltaTc}%` : `${d.pctDeltaTc}%`})
                                        </span>
                                      </div>
                                      <div className="flex justify-between items-center font-mono">
                                        <span style={{ color: themeColors.date1.conductor }}>
                                          {compareDate1}: <strong className="text-slate-100">{d.conductorTemp1.toFixed(1)}°C</strong>
                                        </span>
                                        <span className="text-slate-600">vs</span>
                                        <span style={{ color: themeColors.date2.conductor }}>
                                          {compareDate2}: <strong className="text-slate-100">{d.conductorTemp2.toFixed(1)}°C</strong>
                                        </span>
                                      </div>
                                    </div>

                                    {/* Fiber Temp (Tf) */}
                                    <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80">
                                      <div className="flex justify-between items-center text-[10px] text-slate-400 uppercase font-bold mb-1">
                                        <span>Optical Fiber (Tf)</span>
                                        <span
                                          className={`px-1.5 py-0.2 rounded font-bold ${
                                            d.deltaTf > 0
                                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                                              : d.deltaTf < 0
                                              ? 'bg-sky-950/60 text-sky-300 border border-sky-500/40'
                                              : 'bg-slate-800 text-slate-300'
                                          }`}
                                        >
                                          Δ {d.deltaTf > 0 ? `+${d.deltaTf}°C ▲` : `${d.deltaTf}°C ▼`}
                                        </span>
                                      </div>
                                      <div className="flex justify-between items-center font-mono">
                                        <span style={{ color: themeColors.date1.fiber }}>
                                          {compareDate1}: <strong className="text-slate-100">{d.fiberTemp1.toFixed(1)}°C</strong>
                                        </span>
                                        <span className="text-slate-600">vs</span>
                                        <span style={{ color: themeColors.date2.fiber }}>
                                          {compareDate2}: <strong className="text-slate-100">{d.fiberTemp2.toFixed(1)}°C</strong>
                                        </span>
                                      </div>
                                    </div>

                                    {/* Circuit 3 Power Flow */}
                                    <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80">
                                      <div className="flex justify-between items-center text-[10px] text-slate-400 uppercase font-bold mb-1">
                                        <span>Circuit 3 Power Flow</span>
                                        <span
                                          className={`px-1.5 py-0.2 rounded font-bold ${
                                            d.deltaPower > 0
                                              ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                                              : d.deltaPower < 0
                                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                                              : 'bg-slate-800 text-slate-300'
                                          }`}
                                        >
                                          Δ {d.deltaPower > 0 ? `+${d.deltaPower} MW ▲` : `${d.deltaPower} MW ▼`}
                                        </span>
                                      </div>
                                      <div className="flex justify-between items-center font-mono">
                                        <span style={{ color: themeColors.date1.power }}>
                                          {compareDate1}: <strong className="text-slate-100">{d.power1.toFixed(1)} MW</strong>
                                        </span>
                                        <span className="text-slate-600">vs</span>
                                        <span style={{ color: themeColors.date2.power }}>
                                          {compareDate2}: <strong className="text-slate-100">{d.power2.toFixed(1)} MW</strong>
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          />

                          {/* 65°C Alert Reference Line in Thermal Zone */}
                          <ReferenceLine
                            yAxisId="tempAxis"
                            y={65}
                            stroke="#ef4444"
                            strokeDasharray="3 3"
                            label={{ value: '65°C Alert Threshold', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                          />

                          {/* Zone Partition Boundary Line */}
                          <ReferenceLine
                            yAxisId="tempAxis"
                            y={verticalScale.split.tempDomain[1] * 0.96}
                            stroke="#334155"
                            strokeDasharray="4 4"
                            label={{
                              value: '▲ Power Flow Zone (Upper Band)  /  Thermal Zone (Lower Band) ▼',
                              fill: '#64748b',
                              fontSize: 9.5,
                              fontFamily: 'monospace',
                              position: 'insideBottom',
                            }}
                          />

                          {/* ──── UPPER ZONE: CIRCUIT 3 POWER CURVES ──── */}
                          {/* DATE 1 POWER (If Date 1 is newer, PINNED INDICATOR attaches here; otherwise clean dot) */}
                          <Line
                            yAxisId="powerAxis"
                            type="monotone"
                            dataKey="power1"
                            name={`Ckt 3 Power · ${compareDate1} (MW)`}
                            stroke={themeColors.date1.power}
                            strokeWidth={2.4}
                            strokeDasharray="4 3"
                            dot={!isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'power') : { r: 2.5, fill: themeColors.date1.power }}
                          />

                          {/* DATE 2 POWER (If Date 2 is newer, PINNED INDICATOR attaches here!) */}
                          <Area
                            yAxisId="powerAxis"
                            type="monotone"
                            dataKey="power2"
                            name={`Ckt 3 Power · ${compareDate2} (MW)`}
                            stroke={themeColors.date2.power}
                            strokeWidth={3}
                            fill={`url(#${themeColors.date2.powerAreaGrad})`}
                            fillOpacity={1}
                            dot={isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'power') : { r: 3, fill: themeColors.date2.power, stroke: '#0f172a', strokeWidth: 1.2 }}
                          />

                          {/* ──── LOWER ZONE: TEMPERATURE CURVES ──── */}
                          {/* DATE 1 FIBER TEMP (Lighter shade of Date 1 Tone, Dashed) */}
                          <Line
                            yAxisId="tempAxis"
                            type="monotone"
                            dataKey="fiberTemp1"
                            name={`Fiber Tf · ${compareDate1} (°C)`}
                            stroke={themeColors.date1.fiber}
                            strokeWidth={2.2}
                            strokeDasharray="4 3"
                            dot={{ r: 2.5, fill: themeColors.date1.fiber }}
                          />

                          {/* DATE 2 FIBER TEMP (Lighter shade of Date 2 Tone, Solid) */}
                          <Line
                            yAxisId="tempAxis"
                            type="monotone"
                            dataKey="fiberTemp2"
                            name={`Fiber Tf · ${compareDate2} (°C)`}
                            stroke={themeColors.date2.fiber}
                            strokeWidth={2.6}
                            dot={{ r: 3, fill: themeColors.date2.fiber }}
                          />

                          {/* DATE 1 CONDUCTOR TEMP (If Date 1 is newer, PINNED INDICATOR attaches here!) */}
                          <Line
                            yAxisId="tempAxis"
                            type="monotone"
                            dataKey="conductorTemp1"
                            name={`Conductor Tc · ${compareDate1} (°C)`}
                            stroke={themeColors.date1.conductor}
                            strokeWidth={2.8}
                            strokeDasharray="5 3"
                            dot={!isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'conductor') : { r: 3, fill: themeColors.date1.conductor }}
                          />

                          {/* DATE 2 CONDUCTOR TEMP (If Date 2 is newer, PINNED INDICATOR attaches here!) */}
                          <Line
                            yAxisId="tempAxis"
                            type="monotone"
                            dataKey="conductorTemp2"
                            name={`Conductor Tc · ${compareDate2} (°C)`}
                            stroke={themeColors.date2.conductor}
                            strokeWidth={3.4}
                            dot={isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'conductor') : { r: 3, fill: themeColors.date2.conductor }}
                            activeDot={{ r: 7, fill: themeColors.date2.conductor, stroke: '#ffffff', strokeWidth: 2 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* MODE B: STACKED 2-TIER CHARTS (Top = Dedicated Circuit 3 Power, Bottom = Dedicated Temperatures) */}
                {layoutMode === 'stacked_charts' && (
                  <div className="space-y-4">
                    {/* Top Tier: Circuit 3 Power Flow Chart */}
                    <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono pb-1 border-b border-slate-800/80">
                        <span className="font-bold text-slate-200 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-cyan-400" />
                          [TIER 1] CIRCUIT 3 POWER FLOW (MW) · HOURLY PROFILE
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 flex items-center gap-1">
                            <Pin className="w-2.5 h-2.5" /> Δ Pins on {newerDateLabel}
                          </span>
                          <span>
                            {compareDate1} ({comparisonStats?.peakPower1.toFixed(1)} MW) vs {compareDate2} ({comparisonStats?.peakPower2.toFixed(1)} MW)
                          </span>
                        </div>
                      </div>
                      <div className="h-[230px] w-full pt-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={comparisonData}
                            margin={{ top: 22, right: 30, left: 10, bottom: 5 }}
                          >
                            <defs>
                              <linearGradient id={`${themeColors.date2.powerAreaGrad}_tier`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={themeColors.date2.powerAreaColor} stopOpacity={0.25} />
                                <stop offset="95%" stopColor={themeColors.date2.powerAreaColor} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                            <XAxis
                              dataKey="time"
                              stroke="#64748b"
                              tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}
                              interval={2}
                            />
                            <YAxis
                              stroke={themeColors.date2.power}
                              domain={verticalScale.pure.powerDomain}
                              tick={{ fill: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' }}
                              label={{
                                value: 'Circuit 3 Power (MW)',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#cbd5e1',
                                fontSize: 11,
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                              }}
                            />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (!active || !payload || !payload.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="bg-slate-950/95 border border-cyan-500/50 rounded-xl p-2.5 text-xs font-mono shadow-2xl space-y-1">
                                    <div className="font-bold text-cyan-300">{label} hrs · Power Flow</div>
                                    <div className="flex justify-between gap-4" style={{ color: themeColors.date1.power }}>
                                      <span>{compareDate1}:</span>
                                      <span className="font-bold">{d.power1.toFixed(1)} MW</span>
                                    </div>
                                    <div className="flex justify-between gap-4" style={{ color: themeColors.date2.power }}>
                                      <span>{compareDate2}:</span>
                                      <span className="font-bold">{d.power2.toFixed(1)} MW</span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                                      Δ Shift: {d.deltaPower > 0 ? `+${d.deltaPower} MW ▲` : `${d.deltaPower} MW ▼`}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            {/* Date 1 Power */}
                            <Line
                              type="monotone"
                              dataKey="power1"
                              name={`Ckt 3 Power · ${compareDate1}`}
                              stroke={themeColors.date1.power}
                              strokeWidth={2.2}
                              strokeDasharray="4 3"
                              dot={!isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'power') : { r: 2.5, fill: themeColors.date1.power }}
                            />
                            {/* Date 2 Power */}
                            <Area
                              type="monotone"
                              dataKey="power2"
                              name={`Ckt 3 Power · ${compareDate2}`}
                              stroke={themeColors.date2.power}
                              strokeWidth={2.8}
                              fill={`url(#${themeColors.date2.powerAreaGrad}_tier)`}
                              fillOpacity={1}
                              dot={isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'power') : { r: 3, fill: themeColors.date2.power }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Bottom Tier: Cable Temperatures Chart */}
                    <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono pb-1 border-b border-slate-800/80">
                        <span className="font-bold text-slate-200 flex items-center gap-1.5">
                          <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
                          [TIER 2] CABLE TEMPERATURES (°C) · CONDUCTOR &amp; FIBER
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 flex items-center gap-1">
                            <Pin className="w-2.5 h-2.5" /> Δ Pins on {newerDateLabel}
                          </span>
                          <span>
                            Dynamic Scale [{verticalScale.pure.tempDomain[0]}°C - {verticalScale.pure.tempDomain[1]}°C]
                          </span>
                        </div>
                      </div>
                      <div className="h-[300px] w-full pt-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={comparisonData}
                            margin={{ top: 22, right: 30, left: 10, bottom: 15 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                            <XAxis
                              dataKey="time"
                              stroke="#64748b"
                              tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}
                              interval={2}
                            />
                            <YAxis
                              stroke={themeColors.date1.conductor}
                              domain={verticalScale.pure.tempDomain}
                              tick={{ fill: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' }}
                              label={{
                                value: 'Temperature (°C)',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#cbd5e1',
                                fontSize: 11,
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                              }}
                            />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (!active || !payload || !payload.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="bg-slate-950/95 border border-cyan-500/50 rounded-xl p-2.5 text-xs font-mono shadow-2xl space-y-1 min-w-[260px]">
                                    <div className="font-bold text-cyan-300">{label} hrs · Temperatures</div>
                                    <div className="flex justify-between" style={{ color: themeColors.date1.conductor }}>
                                      <span>Tc ({compareDate1}):</span>
                                      <span className="font-bold">{d.conductorTemp1.toFixed(1)}°C</span>
                                    </div>
                                    <div className="flex justify-between" style={{ color: themeColors.date2.conductor }}>
                                      <span>Tc ({compareDate2}):</span>
                                      <span className="font-bold">{d.conductorTemp2.toFixed(1)}°C</span>
                                    </div>
                                    <div className="flex justify-between" style={{ color: themeColors.date1.fiber }}>
                                      <span>Tf ({compareDate1}):</span>
                                      <span>{d.fiberTemp1.toFixed(1)}°C</span>
                                    </div>
                                    <div className="flex justify-between" style={{ color: themeColors.date2.fiber }}>
                                      <span>Tf ({compareDate2}):</span>
                                      <span>{d.fiberTemp2.toFixed(1)}°C</span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                                      Δ Tc: {d.deltaTc > 0 ? `+${d.deltaTc}°C ▲` : `${d.deltaTc}°C ▼`}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <ReferenceLine
                              y={65}
                              stroke="#ef4444"
                              strokeDasharray="3 3"
                              label={{ value: '65°C Alert', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                            />
                            <Line
                              type="monotone"
                              dataKey="fiberTemp1"
                              name={`Fiber Tf · ${compareDate1}`}
                              stroke={themeColors.date1.fiber}
                              strokeWidth={2}
                              strokeDasharray="4 3"
                              dot={{ r: 2.5, fill: themeColors.date1.fiber }}
                            />
                            <Line
                              type="monotone"
                              dataKey="fiberTemp2"
                              name={`Fiber Tf · ${compareDate2}`}
                              stroke={themeColors.date2.fiber}
                              strokeWidth={2.4}
                              dot={{ r: 3, fill: themeColors.date2.fiber }}
                            />
                            {/* Conductor Temp 1: Pinned indicator if Date 1 is newer */}
                            <Line
                              type="monotone"
                              dataKey="conductorTemp1"
                              name={`Conductor Tc · ${compareDate1}`}
                              stroke={themeColors.date1.conductor}
                              strokeWidth={2.6}
                              strokeDasharray="5 3"
                              dot={!isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'conductor') : { r: 3, fill: themeColors.date1.conductor }}
                            />
                            {/* Conductor Temp 2: Pinned indicator if Date 2 is newer */}
                            <Line
                              type="monotone"
                              dataKey="conductorTemp2"
                              name={`Conductor Tc · ${compareDate2}`}
                              stroke={themeColors.date2.conductor}
                              strokeWidth={3.2}
                              dot={isDate2Newer ? (p) => renderPinnedChangeIndicator(p, 'conductor') : { r: 3.5, fill: themeColors.date2.conductor }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* ──── CATEGORIZED SEPARATE LEGEND BOXES (LEFT = DATE 1 GROUP, RIGHT = DATE 2 GROUP) ──── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {/* Left Column: DATE 1 DATA GROUP (Baseline / Reference) */}
                  <div
                    className={`bg-slate-950/90 p-4 rounded-2xl border ${themeColors.date1.badgeBorder} shadow-lg space-y-3`}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shadow-sm"
                          style={{ backgroundColor: themeColors.date1.conductor }}
                        />
                        <span className={`text-xs font-mono font-bold ${themeColors.date1.badgeText}`}>
                          DATE 1: {compareDate1} {!isDate2Newer && '(Newer Date ★)'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 uppercase px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                        Dashed Curves (- - -)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                      {/* Conductor Tc */}
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-0.5 border-b-2 border-dashed shrink-0"
                            style={{ borderColor: themeColors.date1.conductor }}
                          />
                          <span className="font-bold text-slate-200">Conductor Tc</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-6">
                          Peak: <strong style={{ color: themeColors.date1.conductor }}>{comparisonStats?.peakTc1.toFixed(1)}°C</strong>
                        </div>
                        <div className="text-[10px] text-slate-500 pl-6">
                          {!isDate2Newer ? 'Pinned Δ on curve' : 'Reference baseline'}
                        </div>
                      </div>

                      {/* Fiber Tf */}
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-0.5 border-b-2 border-dashed shrink-0"
                            style={{ borderColor: themeColors.date1.fiber }}
                          />
                          <span className="font-bold text-slate-200">Fiber Tf</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-6">
                          Peak: <strong style={{ color: themeColors.date1.fiber }}>{comparisonStats?.peakTf1.toFixed(1)}°C</strong>
                        </div>
                        <div className="text-[10px] text-slate-500 pl-6">
                          Lighter Shade (Same Tone)
                        </div>
                      </div>

                      {/* Circuit 3 Power */}
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-0.5 border-b-2 border-dashed shrink-0"
                            style={{ borderColor: themeColors.date1.power }}
                          />
                          <span className="font-bold text-slate-200">Ckt 3 Power</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-6">
                          Peak: <strong style={{ color: themeColors.date1.power }}>{comparisonStats?.peakPower1.toFixed(1)} MW</strong>
                        </div>
                        <div className="text-[10px] text-slate-500 pl-6">
                          {!isDate2Newer ? 'Pinned Δ on curve' : 'Upper Zone (MW)'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: DATE 2 DATA GROUP (Comparison Target) */}
                  <div
                    className={`bg-slate-950/90 p-4 rounded-2xl border ${themeColors.date2.badgeBorder} shadow-lg space-y-3`}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shadow-sm"
                          style={{ backgroundColor: themeColors.date2.conductor }}
                        />
                        <span className={`text-xs font-mono font-bold ${themeColors.date2.badgeText}`}>
                          DATE 2: {compareDate2} {isDate2Newer && '(Newer Date ★)'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 uppercase px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                        Solid Curves (───)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                      {/* Conductor Tc */}
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-0.5 shrink-0"
                            style={{ backgroundColor: themeColors.date2.conductor }}
                          />
                          <span className="font-bold text-slate-200">Conductor Tc</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-6">
                          Peak: <strong style={{ color: themeColors.date2.conductor }}>{comparisonStats?.peakTc2.toFixed(1)}°C</strong>
                        </div>
                        <div className="text-[10px] text-slate-500 pl-6">
                          {isDate2Newer ? 'Pinned Δ on curve' : 'Comparison curve'}
                        </div>
                      </div>

                      {/* Fiber Tf */}
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-0.5 shrink-0"
                            style={{ backgroundColor: themeColors.date2.fiber }}
                          />
                          <span className="font-bold text-slate-200">Fiber Tf</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-6">
                          Peak: <strong style={{ color: themeColors.date2.fiber }}>{comparisonStats?.peakTf2.toFixed(1)}°C</strong>
                        </div>
                        <div className="text-[10px] text-slate-500 pl-6">
                          Lighter Shade (Same Tone)
                        </div>
                      </div>

                      {/* Circuit 3 Power */}
                      <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-0.5 shrink-0"
                            style={{ backgroundColor: themeColors.date2.power }}
                          />
                          <span className="font-bold text-slate-200">Ckt 3 Power</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-6">
                          Peak: <strong style={{ color: themeColors.date2.power }}>{comparisonStats?.peakPower2.toFixed(1)} MW</strong>
                        </div>
                        <div className="text-[10px] text-slate-500 pl-6">
                          {isDate2Newer ? 'Pinned Δ on curve' : 'Upper Zone (MW)'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Hourly Change Indicators Timeline Strip (00:00 - 23:00) */}
                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-slate-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-cyan-400" />
                      24-HOUR HOURLY CHANGE INDICATORS MATRIX ({newerDateLabel} vs {olderDateLabel})
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Positive (Red/Rose = {newerDateLabel} Hotter) · Negative (Green/Emerald = {newerDateLabel} Cooler)
                    </span>
                  </div>

                  <div className="grid grid-cols-6 sm:grid-cols-12 lg:grid-cols-24 gap-1.5 pt-1 overflow-x-auto">
                    {comparisonData.map((pt) => {
                      const dTc = pt.newerTcDelta;
                      const isUp = dTc > 0.1;
                      const isDown = dTc < -0.1;

                      return (
                        <div
                          key={pt.hour}
                          className={`p-1.5 rounded-lg border text-center font-mono transition-all ${
                            isUp
                              ? 'bg-rose-950/30 border-rose-500/30 text-rose-300 hover:border-rose-500'
                              : isDown
                              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300 hover:border-emerald-500'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400'
                          }`}
                          title={`${pt.time} hrs: Older=${isDate2Newer ? pt.conductorTemp1.toFixed(1) : pt.conductorTemp2.toFixed(1)}°C, Newer=${isDate2Newer ? pt.conductorTemp2.toFixed(1) : pt.conductorTemp1.toFixed(1)}°C (Δ ${dTc > 0 ? `+${dTc}` : dTc}°C)`}
                        >
                          <div className="text-[10px] text-slate-400 font-bold">{pt.time.replace(':00', 'h')}</div>
                          <div className="text-[11px] font-extrabold flex items-center justify-center gap-0.5 mt-0.5">
                            {isUp ? (
                              <ArrowUpRight className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                            ) : isDown ? (
                              <ArrowDownRight className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Minus className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                            )}
                            <span>{isUp ? `+${dTc.toFixed(1)}` : dTc.toFixed(1)}</span>
                          </div>
                          <div className="text-[9px] text-slate-500">
                            {pt.newerPowerDelta > 0 ? `+${pt.newerPowerDelta.toFixed(0)}M` : `${pt.newerPowerDelta.toFixed(0)}M`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-20 text-center space-y-3">
                <Thermometer className="w-12 h-12 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300 font-mono">
                  Comparison Data Incomplete
                </div>
                <p className="text-xs text-slate-500 font-mono max-w-md mx-auto">
                  One or both selected dates ({compareDate1}, {compareDate2}) do not have records for Section {selectedSectionId}. Please choose different dates.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
