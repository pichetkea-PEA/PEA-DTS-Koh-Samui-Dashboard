import React, { useState, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  MapPin,
  Calendar,
  Layers,
  Thermometer,
  Zap,
  Info,
  Maximize2,
  Minimize2,
  RotateCcw,
  Flame,
  Clock,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Navigation,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  CableSamplingPoint,
  getThermalZoneInfo,
  evaluateSectionConductorTemp,
} from '../data/cableCircuitStructure';
import {
  getOrgRecordsForDate,
  OrgDatabaseRecord,
  OrgDatabaseConfig,
} from '../services/orgDatabaseStorage';
import { ParsedTeprFile } from '../services/teprParser';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import { NoDatabaseEmptyState } from './NoDatabaseEmptyState';

export interface PublicHeatMapPageProps {
  dbConfig: OrgDatabaseConfig;
  onAdminLoginClick: () => void;
  isAdminLoggedIn: boolean;
  onGoToFolderAsset: () => void;
  parsedFiles?: ParsedTeprFile[];
  activeDailyPowerSummary?: DailyPowerSummary | null;
  powerSummariesByDate?: Map<string, DailyPowerSummary>;
  selectedDateFilter?: string;
}

// ---------------------------------------------------------------------------
// Color Interpolation & Threshold Utilities
// ---------------------------------------------------------------------------
function parseColorToRgb(color: string): [number, number, number] {
  if (!color) return [16, 185, 129];
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const num = parseInt(hex, 16);
    if (isNaN(num)) return [16, 185, 129];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  }
  return [16, 185, 129];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

function interpolateHexColor(color1: string, color2: string, t: number): string {
  const [r1, g1, b1] = parseColorToRgb(color1);
  const [r2, g2, b2] = parseColorToRgb(color2);
  const r = r1 + (r2 - r1) * t;
  const g = g1 + (g2 - g1) * t;
  const b = b1 + (b2 - b1) * t;
  return rgbToHex(r, g, b);
}

function getThermalColor(tf: number): string {
  if (tf <= 0) return '#38bdf8'; // Default cool cyan if no reading
  return getThermalZoneInfo(tf).hexColor;
}

function extractTimeFromPeakInfo(timestamp?: string, fileName?: string): string {
  if (timestamp) {
    const timeMatch = timestamp.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (timeMatch) return timeMatch[1].slice(0, 5);
  }
  if (fileName) {
    const patternDts = fileName.match(/(?:temp[_-]?)?([a-z]{3})[-_]?(\d{1,2})[-_]?(\d{2})(\d{2})/i);
    if (patternDts) {
      const hh = parseInt(patternDts[3], 10);
      const mm = parseInt(patternDts[4], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
    const isoTime = fileName.match(/(?:202\d[-_]?\d{2}[-_]?\d{2}|\d{8})[-_T ](\d{2})[-_:]?(\d{2})/);
    if (isoTime) {
      const hh = parseInt(isoTime[1], 10);
      const mm = parseInt(isoTime[2], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
  }
  return '14:30';
}

export interface EnrichedPublicPoint extends CableSamplingPoint {
  tfMax: number;
  tcMax: number;
  powerAtMaxMW: number;
  pCkt3MaxMW: number;
  pCkt2MaxMW: number;
  p33NktMaxMW: number;
  p33OilMaxMW: number;
  peakTime: string;
  sourceFile: string;
}

// 7 Required Important Landmark Locations with Coordinates
interface LandmarkLocation {
  id: string;
  name: string;
  shortLabel: string;
  lat: number;
  lng: number;
  kp: string;
  dof: number;
  category: string;
  color: string;
  iconBg: string;
  description: string;
}

const IMPORTANT_LANDMARKS: LandmarkLocation[] = [
  {
    id: 'TJ1',
    name: 'Transition Joint 1 (TJ1)',
    shortLabel: 'TJ1 Joint Pit',
    lat: 9.240997,
    lng: 99.86213,
    kp: '01+431',
    dof: 3452,
    category: 'Land-to-Submarine Transition',
    color: '#06b6d4',
    iconBg: '#083344',
    description: 'Transition Joint Pit 1 connecting 3 single-core land cables to 3-core submarine cable on mainland shore.',
  },
  {
    id: 'XPWA',
    name: 'Crossing PWA Pipeline',
    shortLabel: 'PWA Water Crossing',
    lat: 9.351642,
    lng: 99.867761,
    kp: '12+414',
    dof: 15106,
    category: 'Subsea Infrastructure Crossing',
    color: '#0284c7',
    iconBg: '#082f49',
    description: 'Subsea crossing over Provincial Waterworks Authority (PWA) potable water pipeline.',
  },
  {
    id: 'NX2',
    name: 'Nexans Subsea Joint NX2',
    shortLabel: 'Joint NX2',
    lat: 9.530821,
    lng: 99.891686,
    kp: '32+441',
    dof: 35133,
    category: 'Subsea Repair Joint (Nexans)',
    color: '#f59e0b',
    iconBg: '#451a03',
    description: 'Nexans rigid subsea factory repair/connection joint #2 at KP 32+441.',
  },
  {
    id: 'NX1',
    name: 'Nexans Subsea Joint NX1',
    shortLabel: 'Joint NX1',
    lat: 9.532082,
    lng: 99.891799,
    kp: '32+572',
    dof: 35264,
    category: 'Subsea Repair Joint (Nexans)',
    color: '#f97316',
    iconBg: '#431407',
    description: 'Nexans rigid subsea factory repair/connection joint #1 at KP 32+572.',
  },
  {
    id: 'FR1',
    name: 'Furukawa Subsea Joint FR1',
    shortLabel: 'Joint FR1',
    lat: 9.541991,
    lng: 99.892689,
    kp: '33+683',
    dof: 36375,
    category: 'Subsea Connection Joint (Furukawa)',
    color: '#ef4444',
    iconBg: '#450a0a',
    description: 'Furukawa subsea rigid repair/connection joint #1 at KP 33+683.',
  },
  {
    id: 'FR2',
    name: 'Furukawa Subsea Joint FR2',
    shortLabel: 'Joint FR2',
    lat: 9.543252,
    lng: 99.892802,
    kp: '33+813',
    dof: 36505,
    category: 'Subsea Connection Joint (Furukawa)',
    color: '#dc2626',
    iconBg: '#450a0a',
    description: 'Furukawa subsea rigid repair/connection joint #2 at KP 33+813.',
  },
  {
    id: 'X33KV',
    name: 'Crossing 33 kV Submarine Cable',
    shortLabel: '33 kV Crossing',
    lat: 9.595251,
    lng: 99.997229,
    kp: '48+679',
    dof: 51370,
    category: 'Cable-to-Cable Subsea Crossing',
    color: '#a855f7',
    iconBg: '#3b0764',
    description: 'Crossing area over existing 33 kV submarine power cable to Koh Pha Ngan.',
  },
];

export const PublicHeatMapPage: React.FC<PublicHeatMapPageProps> = ({
  dbConfig,
  onAdminLoginClick,
  isAdminLoggedIn,
  onGoToFolderAsset,
  parsedFiles = [],
  activeDailyPowerSummary = null,
  powerSummariesByDate,
  selectedDateFilter = 'all',
}) => {
  // Determine available dates strictly from Panel 1 ("Daily peak temperature database")
  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    if (dbConfig && dbConfig.availableDates) {
      dbConfig.availableDates.forEach((d) => dates.add(d));
    }
    return Array.from(dates).sort();
  }, [dbConfig]);

  const hasAnyDataSource = availableDates.length > 0 || (dbConfig.hasDatabase && dbConfig.totalRecords > 0);

  // Initial date selection
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
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'land' | 'submarine'>('all');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>('all');
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [highlightedLandmark, setHighlightedLandmark] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Synchronize selectedDate when Panel 1 database dates update
  useEffect(() => {
    if (selectedDateFilter && selectedDateFilter !== 'all' && availableDates.includes(selectedDateFilter)) {
      setSelectedDate(selectedDateFilter);
    } else if (availableDates.length > 0 && (!selectedDate || !availableDates.includes(selectedDate))) {
      setSelectedDate(availableDates[availableDates.length - 1]);
    }
  }, [selectedDateFilter, availableDates, selectedDate]);

  // Load records for the selected date from Panel 1 ("Daily peak temperature database")
  const dailyRecords = useMemo(() => {
    if (!selectedDate) return [];
    return getOrgRecordsForDate(selectedDate);
  }, [selectedDate, dbConfig]);

  // Determine the day before selectedDate and load its records for day-over-day comparison
  const { prevDate, prevDailyRecords } = useMemo(() => {
    if (!selectedDate) return { prevDate: '', prevDailyRecords: [] as OrgDatabaseRecord[] };
    const dt = new Date(`${selectedDate}T00:00:00Z`);
    let candidateDate = '';
    if (!isNaN(dt.getTime())) {
      dt.setUTCDate(dt.getUTCDate() - 1);
      const calPrev = dt.toISOString().slice(0, 10);
      const calRecs = getOrgRecordsForDate(calPrev);
      if (calRecs.length > 0) {
        return { prevDate: calPrev, prevDailyRecords: calRecs };
      }
      candidateDate = calPrev;
    }
    const idx = availableDates.indexOf(selectedDate);
    if (idx > 0) {
      const fallbackPrev = availableDates[idx - 1];
      return { prevDate: fallbackPrev, prevDailyRecords: getOrgRecordsForDate(fallbackPrev) };
    }
    return { prevDate: candidateDate, prevDailyRecords: [] as OrgDatabaseRecord[] };
  }, [selectedDate, availableDates, dbConfig]);

  // Section record lookup map
  const sectionRecordMap = useMemo(() => {
    const map = new Map<string, OrgDatabaseRecord>();
    dailyRecords.forEach((r) => {
      map.set(r.sectionId, r);
      if (r.phase) {
        const pNorm = r.phase.replace(/^Phase\s+/i, '').trim();
        map.set(`${r.sectionId}_${pNorm}`, r);
      }
    });
    return map;
  }, [dailyRecords]);

  // Helper to resolve per-DOF daily maximum Tf, Tc, and peak time from an OrgDatabaseRecord
  const resolveDofDailyPeak = (p: CableSamplingPoint, rec?: OrgDatabaseRecord) => {
    if (!rec) {
      return { tf: 0, tc: 0, peakTime: '14:30' };
    }
    const k2 = p.dof.toFixed(2);
    const k1 = p.dof.toFixed(1);
    const k0 = String(Math.round(p.dof));

    let dofTf: number | undefined =
      rec.dofTfMax?.[k2] ?? rec.dofTfMax?.[k1] ?? rec.dofTfMax?.[k0];

    if (dofTf === undefined && rec.dofTfMax) {
      for (const [k, val] of Object.entries(rec.dofTfMax)) {
        const dNum = parseFloat(k);
        if (!isNaN(dNum) && Math.abs(dNum - p.dof) < 0.35 && val > 0 && val < 130) {
          dofTf = val;
          break;
        }
      }
    }

    let dofTc: number | undefined =
      rec.dofTcMax?.[k2] ?? rec.dofTcMax?.[k1] ?? rec.dofTcMax?.[k0];

    if (dofTc === undefined && rec.dofTcMax) {
      for (const [k, val] of Object.entries(rec.dofTcMax)) {
        const dNum = parseFloat(k);
        if (!isNaN(dNum) && Math.abs(dNum - p.dof) < 0.35 && val > 0 && val < 160) {
          dofTc = val;
          break;
        }
      }
    }

    const rawSecTf = rec.tfMax > 0 && rec.tfMax < 130 ? rec.tfMax : 45.2;
    const rawSecTc = rec.tcMax > 0 && rec.tcMax < 160 ? rec.tcMax : 54.8;

    const finalTf = dofTf !== undefined && dofTf > 0 && dofTf < 130 ? dofTf : rawSecTf;
    let finalTc = dofTc !== undefined && dofTc > 0 && dofTc < 160 ? dofTc : 0;
    if (finalTc <= 0 && finalTf > 0) {
      const secObj = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === p.sectionId);
      if (secObj) {
        const est = evaluateSectionConductorTemp(
          secObj,
          finalTf,
          rec.pCkt3MaxMW || 35,
          rec.pCkt2MaxMW || 0,
          rec.p33NktMaxMW || 0,
          rec.p33OilMaxMW || 0
        );
        if (est.tc60287 && est.tc60287 > 0) {
          finalTc = Number(est.tc60287.toFixed(2));
        }
      }
      if (finalTc <= 0) finalTc = rawSecTc;
    }

    const dofTime =
      rec.dofTimeMax?.[k2] ||
      rec.dofTimeMax?.[k1] ||
      rec.dofTimeMax?.[k0] ||
      extractTimeFromPeakInfo(rec.timestampMax, rec.fileNameMax);

    return { tf: finalTf, tc: finalTc, peakTime: dofTime };
  };

  // Filtered sampling points enriched with each DOF's daily maximum temperature & coincident power flows
  const enrichedPoints: EnrichedPublicPoint[] = useMemo(() => {
    return CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
      if (selectedCategory === 'land' && p.cableCategory !== 'land') return false;
      if (selectedCategory === 'submarine' && p.cableCategory !== 'submarine') return false;
      if (selectedSectionFilter !== 'all' && p.sectionId !== selectedSectionFilter) return false;
      if (p.cableCategory === 'land' && selectedPhaseFilter !== 'all' && p.phase !== selectedPhaseFilter) {
        return false;
      }
      return true;
    }).map((p) => {
      const rec =
        (p.phase ? sectionRecordMap.get(`${p.sectionId}_${p.phase}`) : null) ||
        sectionRecordMap.get(p.sectionId);

      const { tf, tc, peakTime } = resolveDofDailyPeak(p, rec);
      const powerAtMaxMW = rec?.powerAtMaxMW ?? 0;
      const pCkt3MaxMW = rec?.pCkt3MaxMW ?? 0;
      const pCkt2MaxMW = rec?.pCkt2MaxMW ?? 0;
      const p33NktMaxMW = rec?.p33NktMaxMW ?? 0;
      const p33OilMaxMW = rec?.p33OilMaxMW ?? 0;

      return {
        ...p,
        tfMax: tf,
        tcMax: tc,
        powerAtMaxMW,
        pCkt3MaxMW,
        pCkt2MaxMW,
        p33NktMaxMW,
        p33OilMaxMW,
        peakTime,
        sourceFile: rec?.fileNameMax || '',
      };
    });
  }, [selectedCategory, selectedSectionFilter, selectedPhaseFilter, sectionRecordMap]);

  // Helper to compute stats for a set of daily records (respecting current category/section/phase filters)
  const computeStatsForRecords = (records: OrgDatabaseRecord[]) => {
    if (records.length === 0) {
      return { maxTf: 0, maxTc: 0, hottestSection: '-', totalPowerMW: 0 };
    }
    const recMap = new Map<string, OrgDatabaseRecord>();
    records.forEach((r) => {
      recMap.set(r.sectionId, r);
      if (r.phase) {
        const pNorm = r.phase.replace(/^Phase\s+/i, '').trim();
        recMap.set(`${r.sectionId}_${pNorm}`, r);
      }
    });

    let maxTf = 0;
    let maxTc = 0;
    let hottestSection = '-';
    let totalPowerMW = 0;

    const filteredPts = CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
      if (selectedCategory === 'land' && p.cableCategory !== 'land') return false;
      if (selectedCategory === 'submarine' && p.cableCategory !== 'submarine') return false;
      if (selectedSectionFilter !== 'all' && p.sectionId !== selectedSectionFilter) return false;
      if (p.cableCategory === 'land' && selectedPhaseFilter !== 'all' && p.phase !== selectedPhaseFilter) {
        return false;
      }
      return true;
    });

    filteredPts.forEach((p) => {
      const rec =
        (p.phase ? recMap.get(`${p.sectionId}_${p.phase}`) : null) ||
        recMap.get(p.sectionId);
      if (!rec) return;
      const { tf, tc } = resolveDofDailyPeak(p, rec);
      if (tf > maxTf) {
        maxTf = tf;
        hottestSection = p.sectionId;
      }
      if (tc > maxTc) maxTc = tc;
      if (rec.powerAtMaxMW > totalPowerMW) totalPowerMW = rec.powerAtMaxMW;
    });

    return { maxTf, maxTc, hottestSection, totalPowerMW };
  };

  // Overall stats for the selected date and the day before
  const summaryStats = useMemo(
    () => computeStatsForRecords(dailyRecords),
    [dailyRecords, selectedCategory, selectedSectionFilter, selectedPhaseFilter]
  );

  const prevSummaryStats = useMemo(
    () => computeStatsForRecords(prevDailyRecords),
    [prevDailyRecords, selectedCategory, selectedSectionFilter, selectedPhaseFilter]
  );

  // Helper to render external Increase / Decrease indicator right next to each KPI box
  const renderDayBeforeIndicator = (currentVal: number, prevVal: number, unit: string) => {
    if (currentVal <= 0 || prevVal <= 0) {
      return (
        <div className="flex flex-col justify-center font-mono text-left pl-0.5">
          <span className="text-[10px] font-bold text-slate-400">● No Prior Day Data</span>
          <span className="text-[10px] text-slate-500">N/A vs previous day</span>
        </div>
      );
    }
    const diff = currentVal - prevVal;
    const pct = (diff / prevVal) * 100;
    const isIncrease = diff > 0.04;
    const isDecrease = diff < -0.04;
    const sign = diff > 0 ? '+' : '';

    return (
      <div className="flex flex-col justify-center font-mono text-left leading-tight">
        <div
          className={`inline-flex items-center gap-1 text-xs font-extrabold ${
            isIncrease
              ? 'text-emerald-400'
              : isDecrease
              ? 'text-sky-400'
              : 'text-slate-300'
          }`}
        >
          <span className="text-sm leading-none">
            {isIncrease ? '▲' : isDecrease ? '▼' : '●'}
          </span>
          <span className="uppercase tracking-wide">
            {isIncrease ? 'Increase' : isDecrease ? 'Decrease' : 'Unchanged'}
          </span>
        </div>
        <div className="text-xs font-black text-white mt-0.5">
          {sign}
          {diff.toFixed(1)} {unit}{' '}
          <span
            className={`font-bold ${
              isIncrease
                ? 'text-emerald-300'
                : isDecrease
                ? 'text-sky-300'
                : 'text-slate-400'
            }`}
          >
            ({sign}
            {pct.toFixed(1)}%)
          </span>
        </div>
        <div className="text-[10px] text-slate-400">
          vs {prevDate || 'day before'} ({prevVal.toFixed(1)} {unit})
        </div>
      </div>
    );
  };

  const landSectionsList = useMemo(() => {
    return CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land');
  }, []);

  const submarineZonesList = useMemo(() => {
    return CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine');
  }, []);

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [9.33, 99.88],
        zoom: 11,
        zoomControl: false,
      });

      // ESRI World Imagery (Satellite)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri, Maxar, Earthstar Geographics',
          maxZoom: 18,
        }
      ).addTo(map);

      // Boundaries & labels overlay
      L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 18,
          opacity: 0.85,
        }
      ).addTo(map);

      const layerGroup = L.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!layerGroup) return;

    layerGroup.clearLayers();

    // -------------------------------------------------------------------------
    // 1. DRAW THICK STRAIGHT LINES COLOR-MATCHED WITH THERMAL THRESHOLDS
    // Land Cable: PHASE-TO-PHASE connection (Phase A, Phase B, Phase C separate)
    // Submarine Cable: sequential point-to-point along marine route
    // Enhanced gradient transition with SUB_STEPS = 14 and larger thickness
    // -------------------------------------------------------------------------
    const phaseAPts = enrichedPoints
      .filter((p) => p.cableCategory === 'land' && p.phase === 'A')
      .sort((a, b) => a.dof - b.dof);

    const phaseBPts = enrichedPoints
      .filter((p) => p.cableCategory === 'land' && p.phase === 'B')
      .sort((a, b) => a.dof - b.dof);

    const phaseCPts = enrichedPoints
      .filter((p) => p.cableCategory === 'land' && p.phase === 'C')
      .sort((a, b) => a.dof - b.dof);

    const subPts = enrichedPoints
      .filter((p) => p.cableCategory === 'submarine')
      .sort((a, b) => a.dof - b.dof);

    const tj1Point = subPts[0] || CIRCUIT_3_SAMPLING_POINTS.find((p) => p.id === 'TJ1-P1');

    const lineGroupsToDraw: Array<{
      name: string;
      pts: EnrichedPublicPoint[];
      phaseBadge?: 'A' | 'B' | 'C';
      phaseColor?: string;
    }> = [];

    if (phaseAPts.length > 0) {
      const fullA = tj1Point && selectedSectionFilter === 'all' ? [...phaseAPts, tj1Point as EnrichedPublicPoint] : phaseAPts;
      lineGroupsToDraw.push({ name: 'Land Cable Phase A', pts: fullA, phaseBadge: 'A', phaseColor: '#ef4444' });
    }
    if (phaseBPts.length > 0) {
      const fullB = tj1Point && selectedSectionFilter === 'all' ? [...phaseBPts, tj1Point as EnrichedPublicPoint] : phaseBPts;
      lineGroupsToDraw.push({ name: 'Land Cable Phase B', pts: fullB, phaseBadge: 'B', phaseColor: '#f59e0b' });
    }
    if (phaseCPts.length > 0) {
      const fullC = tj1Point && selectedSectionFilter === 'all' ? [...phaseCPts, tj1Point as EnrichedPublicPoint] : phaseCPts;
      lineGroupsToDraw.push({ name: 'Land Cable Phase C', pts: fullC, phaseBadge: 'C', phaseColor: '#3b82f6' });
    }
    if (subPts.length > 0) {
      lineGroupsToDraw.push({ name: 'PEA-Submarine Cable Route', pts: subPts });
    }

    // Helper: draw thick straight line segments with smooth gradient transition
    const drawThickThermalLine = (
      pts: EnrichedPublicPoint[],
      routeName: string,
      phaseBadge?: string
    ) => {
      if (pts.length < 2) return;

      const SUB_STEPS = 14; // High-resolution smooth continuous thermal gradient

      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];

        const c1 = getThermalColor(p1.tfMax);
        const c2 = getThermalColor(p2.tfMax);
        const isSame = c1.toLowerCase() === c2.toLowerCase();
        const steps = isSame ? 1 : SUB_STEPS;

        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          const tMid = (t0 + t1) / 2;

          const lat0 = p1.latitude + (p2.latitude - p1.latitude) * t0;
          const lng0 = p1.longitude + (p2.longitude - p1.longitude) * t0;
          const lat1 = p1.latitude + (p2.latitude - p1.latitude) * t1;
          const lng1 = p1.longitude + (p2.longitude - p1.longitude) * t1;

          const segColor = isSame ? c1 : interpolateHexColor(c1, c2, tMid);
          const segmentCoords: [number, number][] = [
            [lat0, lng0],
            [lat1, lng1],
          ];

          // 1. Thicker Ambient Glow Line underneath (Weight 30px)
          L.polyline(segmentCoords, {
            color: segColor,
            weight: 30,
            opacity: 0.42,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(layerGroup);

          // 2. Thick Straight Core Line (Weight 14px) color matched with thermal threshold
          const coreLine = L.polyline(segmentCoords, {
            color: segColor,
            weight: 14,
            opacity: 0.98,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(layerGroup);

          coreLine.bindTooltip(
            `<div style="font-family: monospace; font-size: 11px; padding: 6px; color: #0f172a;">
              <div style="font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin-bottom: 3px;">
                ${routeName} ${phaseBadge ? `[Phase ${phaseBadge}]` : ''}
              </div>
              <div style="color: #0369a1; font-weight: bold;">
                From: ${p1.pos} (${p1.tfMax > 0 ? p1.tfMax.toFixed(1) + ' °C' : 'N/A'})
              </div>
              <div style="color: #0369a1; font-weight: bold;">
                To: ${p2.pos} (${p2.tfMax > 0 ? p2.tfMax.toFixed(1) + ' °C' : 'N/A'})
              </div>
            </div>`,
            { sticky: true, opacity: 0.95 }
          );
        }
      }
    };

    lineGroupsToDraw.forEach((group) => {
      drawThickThermalLine(group.pts, group.name, group.phaseBadge);
    });

    // -------------------------------------------------------------------------
    // 2. DRAW DISCRETE THERMAL CIRCLE MARKERS & RICH DETAIL POPUPS
    // (Ref: IEC60287 REMOVED as requested in item 5.1)
    // -------------------------------------------------------------------------
    enrichedPoints.forEach((p) => {
      const color = getThermalColor(p.tfMax);
      const radius = p.tfMax >= 65 ? 10 : p.tfMax >= 45 ? 8 : 6.5;

      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius,
        fillColor: color,
        color: '#ffffff',
        weight: 2.5,
        opacity: 0.95,
        fillOpacity: 0.92,
      });

      const zoneInfo = getThermalZoneInfo(p.tfMax > 0 ? p.tfMax : 28);

      marker.bindPopup(`
        <div style="font-family: monospace; font-size: 11px; min-width: 260px; padding: 4px; color: #0f172a;">
          <!-- Header -->
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid ${color}; padding-bottom: 6px; margin-bottom: 6px;">
            <div>
              <span style="font-weight: 900; font-size: 13px; color: #0284c7;">${p.pos}</span>
              ${p.phase ? `<span style="margin-left: 6px; background-color: #0f172a; color: #38bdf8; padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: bold;">Phase ${p.phase}</span>` : ''}
            </div>
            <span style="background-color: ${color}; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">
              ${zoneInfo.label}
            </span>
          </div>

          <!-- Section & Route Details -->
          <div style="color: #475569; margin-bottom: 3px; font-size: 11px;">
            <b>Section:</b> ${p.sectionId} — ${p.sectionName}
          </div>
          <div style="color: #475569; margin-bottom: 6px; font-size: 10px;">
            <b>Category:</b> ${p.cableCategory === 'land' ? 'Land Cable (Khanom/Samui)' : 'PEA-Submarine Cable (Gulf of Thailand)'} | <b>DOF:</b> ${p.dof.toFixed(1)} m | <b>KP:</b> ${p.kpFormatted}
          </div>

          <!-- Thermal & Power Telemetry Grid -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; margin-bottom: 6px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
              <div>
                <span style="font-size: 9px; text-transform: uppercase; color: #64748b; display: block; font-weight: bold;">Peak Fiber Tf</span>
                <span style="font-size: 15px; font-weight: 900; color: ${color}; font-family: monospace;">
                  ${p.tfMax > 0 ? p.tfMax.toFixed(2) + ' °C' : 'N/A'}
                </span>
              </div>
              <div>
                <span style="font-size: 9px; text-transform: uppercase; color: #64748b; display: block; font-weight: bold;">Est Conductor Tc</span>
                <span style="font-size: 15px; font-weight: 900; color: #d97706; font-family: monospace;">
                  ${p.tcMax > 0 ? p.tcMax.toFixed(2) + ' °C' : 'N/A'}
                </span>
              </div>
            </div>

            <div style="height: 1px; background: #e2e8f0; margin: 6px 0;"></div>

            <!-- Coincident Power Flow & Detection Time -->
            <div style="margin-bottom: 4px;">
              <span style="font-size: 9px; text-transform: uppercase; color: #64748b; display: block; font-weight: bold;">
                ⚡ Power Flow at Daily Peak:
              </span>
              <span style="font-size: 12px; font-weight: bold; color: #0284c7; font-family: monospace;">
                ${p.powerAtMaxMW > 0 ? `${p.powerAtMaxMW.toFixed(2)} MW Total` : (p.pCkt3MaxMW > 0 ? `${p.pCkt3MaxMW.toFixed(2)} MW (Ckt 3)` : 'No power flow logged')}
              </span>
              ${p.pCkt3MaxMW > 0 && p.powerAtMaxMW > p.pCkt3MaxMW ? `<span style="font-size: 10px; color: #64748b;"> (Ckt 3: ${p.pCkt3MaxMW.toFixed(1)} MW)</span>` : ''}
            </div>

            <div>
              <span style="font-size: 9px; text-transform: uppercase; color: #64748b; display: block; font-weight: bold;">
                🕒 Time of Detected Peak Fiber:
              </span>
              <span style="font-size: 11px; font-weight: 800; color: #475569; font-family: monospace; background: #e0f2fe; padding: 2px 6px; border-radius: 4px; display: inline-block;">
                ${p.peakTime} hrs
              </span>
            </div>
          </div>

          <!-- Clean Footer without IEC60287 reference -->
          <div style="font-size: 9px; color: #94a3b8; text-align: right;">
            Record Date: ${selectedDate}
          </div>
        </div>
      `);

      marker.addTo(layerGroup);
    });

    // -------------------------------------------------------------------------
    // 3. ADD ARROW PIN MARKERS ON MAP FOR IMPORTANT LOCATIONS
    // Transition Joint 1, Crossing PWA Pipeline, all 4 subsea Joint, and crossing 33 kV
    // -------------------------------------------------------------------------
    IMPORTANT_LANDMARKS.forEach((lm) => {
      const pinHtml = `
        <div style="position: relative; transform: translate(-50%, -100%); cursor: pointer;">
          <!-- Pin Label Box -->
          <div style="
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(15, 23, 42, 0.95);
            border: 1.5px solid ${lm.color};
            box-shadow: 0 4px 14px rgba(0,0,0,0.4), 0 0 10px ${lm.color}80;
            padding: 4px 8px;
            border-radius: 8px;
            white-space: nowrap;
            color: #ffffff;
            font-family: monospace;
            font-size: 10px;
            font-weight: 800;
          ">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${lm.color};"></span>
            <span>${lm.shortLabel}</span>
          </div>
          <!-- Downward Arrow Pin Pointer -->
          <div style="
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid ${lm.color};
            margin: 0 auto;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
          "></div>
        </div>
      `;

      const landmarkIcon = L.divIcon({
        className: 'landmark-arrow-pin',
        html: pinHtml,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const landmarkMarker = L.marker([lm.lat, lm.lng], {
        icon: landmarkIcon,
        zIndexOffset: 1000,
      });

      landmarkMarker.bindPopup(`
        <div style="font-family: monospace; font-size: 11px; min-width: 240px; padding: 4px; color: #0f172a;">
          <div style="display: flex; align-items: center; gap: 6px; border-bottom: 2px solid ${lm.color}; padding-bottom: 5px; margin-bottom: 5px;">
            <span style="font-weight: 900; font-size: 12px; color: ${lm.color};">${lm.name}</span>
          </div>
          <div style="color: #475569; font-size: 10px; margin-bottom: 4px;">
            <b>Category:</b> ${lm.category}
          </div>
          <div style="color: #475569; font-size: 10px; margin-bottom: 4px;">
            <b>KP Position:</b> ${lm.kp} | <b>DOF:</b> ${lm.dof} m
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; font-size: 10px; color: #334155; line-height: 1.4;">
            ${lm.description}
          </div>
        </div>
      `);

      landmarkMarker.addTo(layerGroup);
    });

    // Auto-fit bounds if points exist
    const allLatLngs = enrichedPoints.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [50, 50], maxZoom: 14 });
    }
  }, [enrichedPoints, selectedDate, selectedSectionFilter]);

  // Handle zooming/focusing to landmark when clicked from legend
  const handleFocusLandmark = (lm: LandmarkLocation) => {
    setHighlightedLandmark(lm.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lm.lat, lm.lng], 14, { duration: 1.2 });
    }
  };

  // If no data source available at all, show empty state
  if (!hasAnyDataSource) {
    return (
      <NoDatabaseEmptyState
        pageNumber="2.1"
        pageTitle="Daily Maximum Heat Map Chart"
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
            <span className="p-2 rounded-xl bg-rose-950/60 text-rose-400 border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.25)]">
              <MapPin className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-black text-slate-100 font-mono tracking-tight leading-tight">
                [2.1] DAILY MAXIMUM HEAT MAP CHART
              </h2>
              <p className="text-[11px] text-cyan-400/80 font-mono">
                Satellite Thermal Distribution along PEA-Submarine Cable Route
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          {/* Date Selector */}
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

          {/* Section Category Filter: All / Submarine / Land */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSelectedSectionFilter('all');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Route (19)
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('submarine');
                setSelectedSectionFilter('all');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                selectedCategory === 'submarine'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.3)] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Submarine (13 Zones)
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('land');
                setSelectedSectionFilter('all');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                selectedCategory === 'land'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)] font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Land (6 Sections)
            </button>
          </div>

          {/* Filter for all land cable section, all submarine cable zone */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400">SECTION / ZONE:</span>
            <select
              value={selectedSectionFilter}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedSectionFilter(val);
                if (val !== 'all') {
                  const isLand = landSectionsList.some((s) => s.sectionId === val);
                  if (isLand && selectedCategory === 'submarine') setSelectedCategory('all');
                  const isSub = submarineZonesList.some((s) => s.sectionId === val);
                  if (isSub && selectedCategory === 'land') setSelectedCategory('all');
                }
              }}
              className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer max-w-[200px]"
            >
              <option value="all" className="bg-slate-900 text-slate-200">
                All Sections &amp; Zones (19)
              </option>
              <optgroup label="── LAND CABLE (6 SECTIONS) ──" className="bg-slate-950 text-emerald-400 font-bold">
                {landSectionsList.map((sec) => (
                  <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                    Sec {sec.sectionId}: {sec.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="── SUBMARINE CABLE (13 ZONES) ──" className="bg-slate-950 text-cyan-400 font-bold">
                {submarineZonesList.map((sec) => (
                  <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                    Zone {sec.sectionId}: {sec.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Land Phase Filter (When Land Cable is selected or active) */}
          {(selectedCategory === 'land' || selectedSectionFilter.startsWith('1.')) && (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-[10px] text-slate-400 px-1 font-bold">PHASE:</span>
              <button
                type="button"
                onClick={() => setSelectedPhaseFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhaseFilter === 'all'
                    ? 'bg-slate-700 text-slate-100 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhaseFilter('A')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhaseFilter === 'A'
                    ? 'bg-red-500/30 text-red-300 border border-red-500/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhaseFilter('B')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhaseFilter === 'B'
                    ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                B
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhaseFilter('C')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhaseFilter === 'C'
                    ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                C
              </button>
            </div>
          )}
        </div>

        {/* Quick KPI stats — Re-arranged with wide separation so the 3 boxes do not stay close to each other,
            and with an external Increase/Decrease indicator right next to each related box */}
        <div className="w-full pt-3 mt-1 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-10">
          {/* 1. Peak Fiber TF Box + Outside Indicator */}
          <div className="flex items-center gap-3.5">
            <div className="bg-rose-950/40 border border-rose-500/40 px-4 py-2 rounded-xl text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.15)] shrink-0 min-w-[145px]">
              <span className="text-[10px] uppercase font-bold text-rose-400 block">
                Peak Fiber TF
              </span>
              <span className="font-extrabold text-base font-mono">
                {summaryStats.maxTf > 0 ? `${summaryStats.maxTf.toFixed(1)} °C` : '-'}
              </span>
            </div>
            {renderDayBeforeIndicator(summaryStats.maxTf, prevSummaryStats.maxTf, '°C')}
          </div>

          {/* 2. Peak Conductor TC Box + Outside Indicator */}
          <div className="flex items-center gap-3.5">
            <div className="bg-amber-950/40 border border-amber-500/40 px-4 py-2 rounded-xl text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)] shrink-0 min-w-[155px]">
              <span className="text-[10px] uppercase font-bold text-amber-400 block">
                Peak Conductor TC
              </span>
              <span className="font-extrabold text-base font-mono">
                {summaryStats.maxTc > 0 ? `${summaryStats.maxTc.toFixed(1)} °C` : '-'}
              </span>
            </div>
            {renderDayBeforeIndicator(summaryStats.maxTc, prevSummaryStats.maxTc, '°C')}
          </div>

          {/* 3. Peak Power Flow Box + Outside Indicator */}
          <div className="flex items-center gap-3.5">
            <div className="bg-cyan-950/40 border border-cyan-500/40 px-4 py-2 rounded-xl text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)] shrink-0 min-w-[150px]">
              <span className="text-[10px] uppercase font-bold text-cyan-400 block">
                Peak Power Flow
              </span>
              <span className="font-extrabold text-base font-mono">
                {summaryStats.totalPowerMW > 0 ? `${summaryStats.totalPowerMW.toFixed(1)} MW` : '-'}
              </span>
            </div>
            {renderDayBeforeIndicator(summaryStats.totalPowerMW, prevSummaryStats.totalPowerMW, 'MW')}
          </div>
        </div>
      </div>

      {/* Satellite Map Container */}
      <div className="relative bg-slate-950 rounded-3xl border border-cyan-500/20 overflow-hidden shadow-[0_0_35px_rgba(6,182,212,0.08)]">
        <div
          ref={mapContainerRef}
          className="w-full h-[600px] z-10"
          style={{ background: '#070b14' }}
        />

        {/* Floating Thermal Threshold Legend */}
        <div className="absolute bottom-4 left-4 z-20 bg-slate-950/90 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-3 text-white text-xs shadow-xl space-y-2 max-w-sm font-mono">
          <div className="font-bold flex items-center justify-between text-[11px] text-slate-300">
            <span className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-rose-400" />
              THERMAL THRESHOLD CONTINUOUS LINE
            </span>
            <span className="font-mono text-[10px] text-cyan-400">GRADIENT</span>
          </div>
          <div className="grid grid-cols-6 gap-1 text-[9px] text-center font-bold">
            <div className="bg-sky-950/80 border border-sky-500/40 p-1 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-sky-400 mx-auto mb-0.5" />
              <div className="text-sky-300">&lt; 35°C</div>
            </div>
            <div className="bg-emerald-950/80 border border-emerald-500/40 p-1 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mx-auto mb-0.5" />
              <div className="text-emerald-300">35–45</div>
            </div>
            <div className="bg-yellow-950/80 border border-yellow-500/40 p-1 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-yellow-400 mx-auto mb-0.5" />
              <div className="text-yellow-300">45–55</div>
            </div>
            <div className="bg-orange-950/80 border border-orange-500/40 p-1 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-orange-400 mx-auto mb-0.5" />
              <div className="text-orange-300">55–60</div>
            </div>
            <div className="bg-red-950/80 border border-red-500/40 p-1 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-red-400 mx-auto mb-0.5" />
              <div className="text-red-300">60–70</div>
            </div>
            <div className="bg-rose-950/80 border border-rose-500/40 p-1 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-rose-700 mx-auto mb-0.5" />
              <div className="text-rose-300">&gt; 70°C</div>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 flex items-center justify-between">
            <span>Enhanced gradient straight line (Weight: 11px)</span>
            <span className="text-cyan-400">Phase-to-Phase Land</span>
          </div>
        </div>

        {/* Floating Legend with Arrow Pins for Important Locations (Item 5.1 Requirement) */}
        <div className="absolute top-4 right-4 z-20 bg-slate-950/92 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-3 text-slate-200 text-xs shadow-2xl max-w-xs font-mono space-y-2">
          <div className="font-extrabold text-[11px] text-cyan-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-cyan-400" />
              IMPORTANT LOCATIONS (ARROW PINS)
            </span>
            <span className="text-[10px] text-slate-400 font-mono">7 Pins</span>
          </div>

          <div className="space-y-1 text-[10px] max-h-48 overflow-y-auto pr-1">
            {IMPORTANT_LANDMARKS.map((lm) => (
              <button
                key={lm.id}
                type="button"
                onClick={() => handleFocusLandmark(lm)}
                className={`w-full text-left p-1.5 rounded-lg border flex items-center justify-between transition-all cursor-pointer ${
                  highlightedLandmark === lm.id
                    ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900/60 hover:bg-slate-850 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
                title={`Click to focus map on ${lm.name}`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: lm.color }}
                  />
                  <span className="font-bold truncate">{lm.name}</span>
                </div>
                <span className="text-[9px] font-mono text-slate-400 shrink-0 ml-1">
                  {lm.kp}
                </span>
              </button>
            ))}
          </div>

          <div className="pt-1.5 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
            <span>Click any location to zoom and inspect</span>
          </div>
        </div>
      </div>
    </div>
  );
};
