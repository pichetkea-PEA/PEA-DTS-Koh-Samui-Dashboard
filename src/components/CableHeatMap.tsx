import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import { 
  MapPin, 
  Layers, 
  Flame, 
  Filter, 
  Compass, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Info, 
  Download, 
  Sliders, 
  Thermometer, 
  Crosshair, 
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  Navigation,
  Globe,
  Radio,
  Clock,
  Calendar,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff
} from 'lucide-react';
import { 
  CIRCUIT_3_SAMPLING_POINTS, 
  CIRCUIT_3_SECTIONS, 
  CableSamplingPoint, 
  CableSectionInfo, 
  CableSectionType, 
  CableCategory,
  ConductorEquationName,
  findPointByDof,
  estimateConductorTemperatures
} from '../data/cableCircuitStructure';
import {
  DailyPowerSummary,
  resolveOperatingPowerAtTime,
} from '../services/powerConsumptionParser';
import { LocationTimeSeriesSummary, ParsedTeprFile } from '../services/teprParser';

export interface EnrichedSamplingPoint extends CableSamplingPoint {
  currentDelta: number;
  currentAbsoluteTemp: number;
  maxDelta: number;
  peakTime?: string;
  peakFileName?: string;
  readingsCount?: number;
  status: 'normal' | 'warning' | 'critical';
  summary?: LocationTimeSeriesSummary;
  // Conductor Temperature Estimation (IEC 60287 Method: Equations Alpha - Echo)
  estimatedConductorTemp60287: number | null;
  equationName: ConductorEquationName;
  hasPowerData: boolean;
  power115kVCkt3MW: number | null;
  matchedPowerTimestamp: string | null;
}

// ---------------------------------------------------------
// Smooth Color & Thermal Gradient Helper Functions
// ---------------------------------------------------------
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

function getSmoothMetricColor(
  absTemp: number
): string {
  const t = absTemp;
  if (t > 70) return '#991b1b'; // Critical Zone (Dark Red: > 70°C)
  if (t >= 60) return '#ef4444'; // Danger Zone (Light Red: 60 - 70°C)
  if (t >= 55) return '#f97316'; // Alert Zone (Orange: 55 - 60°C)
  if (t >= 45) return '#eab308'; // Monitoring Zone (Yellow: 45 - 55°C)
  if (t >= 35) return '#10b981'; // Normal Zone (Green: 35 - 45°C)
  return '#38bdf8'; // Cool Zone (Light Blue: < 35°C)
}

interface CableHeatMapProps {
  timeSeriesSummary: LocationTimeSeriesSummary[];
  parsedFiles: ParsedTeprFile[];
  allParsedFiles?: ParsedTeprFile[];
  selectedLocation: number | null;
  onSelectLocation: (loc: number) => void;
  selectedPhaseFilter?: string;
  onPhaseFilterChange?: (phase: string) => void;
  activeHourFilter?: string;
  onHourFilterChange?: (hour: string) => void;
  activeDateFilter?: string;
  hasReadTemperature?: boolean;
  isReadingTemperature?: boolean;
  dailyPowerSummary?: DailyPowerSummary | null;
}

type BaseLayerType = 'satellite' | 'hybrid' | 'dark';
type HeatMapColorMode = 'conductor_60287' | 'temperature';

export const CableHeatMap: React.FC<CableHeatMapProps> = ({
  timeSeriesSummary,
  parsedFiles,
  allParsedFiles,
  selectedLocation,
  onSelectLocation,
  selectedPhaseFilter = 'all',
  onPhaseFilterChange,
  activeHourFilter = 'all',
  onHourFilterChange,
  activeDateFilter = 'all',
  hasReadTemperature = false,
  isReadingTemperature = false,
  dailyPowerSummary = null,
}) => {
  // Filter & View states
  const [baseLayer, setBaseLayer] = useState<BaseLayerType>('hybrid');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'land' | 'submarine'>('all');
  const [sectionTypeFilter, setSectionTypeFilter] = useState<'all' | 'normal' | 'special'>('all');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('all');
  const [displayMode, setDisplayMode] = useState<HeatMapColorMode>('conductor_60287');
  const [hoveredPoint, setHoveredPoint] = useState<EnrichedSamplingPoint | null>(null);
  const [showRegistryModal, setShowRegistryModal] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showHeatAura, setShowHeatAura] = useState<boolean>(true);
  const [showMapPinCallouts, setShowMapPinCallouts] = useState<boolean>(false);
  const [isLegendMinimized, setIsLegendMinimized] = useState<boolean>(false);

  // Hourly Maximum selection state (synchronized with activeHourFilter)
  const [internalHourFilter, setInternalHourFilter] = useState<string>('all');
  const currentHourFilter = activeHourFilter !== undefined ? activeHourFilter : internalHourFilter;

  // Land Cable Phase selection state (synchronized with selectedPhaseFilter)
  const [internalPhaseFilter, setInternalPhaseFilter] = useState<string>(selectedPhaseFilter || 'all');
  useEffect(() => {
    setInternalPhaseFilter(selectedPhaseFilter || 'all');
  }, [selectedPhaseFilter]);
  const currentPhaseFilter = internalPhaseFilter;

  const handlePhaseChange = (newPhase: string) => {
    setInternalPhaseFilter(newPhase);
    if (onPhaseFilterChange) {
      onPhaseFilterChange(newPhase);
    }
  };

  const handleHourChange = (newHour: string) => {
    setInternalHourFilter(newHour);
    if (onHourFilterChange) {
      onHourFilterChange(newHour);
    }
  };

  // Map DOM & Leaflet references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsTileLayerRef = useRef<L.TileLayer | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const routesGroupRef = useRef<L.LayerGroup | null>(null);
  const landmarksGroupRef = useRef<L.LayerGroup | null>(null);

  // Active files dataset for this date (grounded to activeDateFilter configured in Page 1)
  const filesToScan = useMemo(() => {
    const baseSet =
      parsedFiles && parsedFiles.length > 0
        ? parsedFiles
        : allParsedFiles && allParsedFiles.length > 0
        ? allParsedFiles
        : [];
    if (!activeDateFilter || activeDateFilter === 'all') return baseSet;
    const matched = baseSet.filter((f) => f.dateMeta?.dateKey === activeDateFilter);
    return matched.length > 0 ? matched : baseSet;
  }, [allParsedFiles, parsedFiles, activeDateFilter]);

  // Hourly file counts & hourly peak temperatures across all 24 hours
  const { hourCounts, hourPeaks } = useMemo(() => {
    const counts: Record<string, number> = {};
    const peaks: Record<string, number> = {};

    for (const f of filesToScan) {
      const hKey = f.dateMeta?.hourKey || (f.dateMeta?.hour !== undefined ? String(f.dateMeta.hour).padStart(2, '0') : '');
      if (hKey) {
        counts[hKey] = (counts[hKey] || 0) + 1;
        const fileMaxAbs = (f.header.fiberReferenceTemp || 30.0) + (f.maxDeltaTemp || 0);
        if (!peaks[hKey] || fileMaxAbs > peaks[hKey]) {
          peaks[hKey] = fileMaxAbs;
        }
      }
    }
    return { hourCounts: counts, hourPeaks: peaks };
  }, [filesToScan]);

  // Overall Daily Maximum Metric across all files of the day
  const dailyPeakMetric = useMemo(() => {
    if (filesToScan.length === 0) return null;
    let maxDelta = -Infinity;
    let maxAbs = -Infinity;
    let peakFile: ParsedTeprFile | null = null;

    for (const f of filesToScan) {
      const delta = f.maxDeltaTemp || 0;
      const abs = (f.header.fiberReferenceTemp || 30.0) + delta;
      if (abs > maxAbs) {
        maxAbs = abs;
        maxDelta = delta;
        peakFile = f;
      }
    }

    if (!peakFile) return null;

    return {
      maxDelta: parseFloat(maxDelta.toFixed(2)),
      maxAbsoluteTemp: parseFloat(maxAbs.toFixed(2)),
      peakTime: peakFile.dateMeta?.formattedTime || peakFile.dateMeta?.displayDateTime || peakFile.fileName,
      peakDate: peakFile.dateMeta?.formattedDate || '',
      fileName: peakFile.fileName,
      totalFiles: filesToScan.length,
    };
  }, [filesToScan]);

  // Merge Circuit 3 sampling points with Daily Maximum or Hourly Maximum thermal data
  const enrichedPoints = useMemo<EnrichedSamplingPoint[]>(() => {
    // 1. Files for the chosen time window (either all files for Daily Max, or specific hour files for Hourly Max)
    const activeTimeFiles = currentHourFilter === 'all'
      ? filesToScan
      : filesToScan.filter((f) => {
          const hKey = f.dateMeta?.hourKey || (f.dateMeta?.hour !== undefined ? String(f.dateMeta.hour).padStart(2, '0') : '');
          return hKey === currentHourFilter;
        });

    // 2. Pre-index active files by phase
    const phaseFilesMap: Record<string, ParsedTeprFile[]> = {
      'A': activeTimeFiles.filter((f) => f.cablePhase === 'Phase A' || f.channel === 0),
      'B': activeTimeFiles.filter((f) => f.cablePhase === 'Phase B' || f.channel === 1),
      'C': activeTimeFiles.filter((f) => f.cablePhase === 'Phase C' || f.channel === 2),
      'SM': activeTimeFiles.filter((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3),
    };

    const summaryMap = new Map<number, LocationTimeSeriesSummary>();
    timeSeriesSummary.forEach((s) => {
      summaryMap.set(s.location, s);
    });

    return CIRCUIT_3_SAMPLING_POINTS.map((pt) => {
      // Find candidate files for this specific sampling point
      let targetFiles: ParsedTeprFile[] = [];
      if (pt.cableCategory === 'land') {
        const ph = pt.phase || 'A';
        targetFiles = phaseFilesMap[ph] || [];
        if (targetFiles.length === 0) {
          targetFiles = activeTimeFiles.filter((f) => f.cablePhase !== 'Submarine Cable' && f.channel !== 3);
        }
      } else {
        targetFiles = phaseFilesMap['SM'] || [];
        if (targetFiles.length === 0) {
          targetFiles = activeTimeFiles;
        }
      }

      // If user has focused on a specific phase, apply that filter
      if (currentPhaseFilter !== 'all') {
        if (currentPhaseFilter === 'Submarine Cable') {
          targetFiles = targetFiles.filter((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3);
        } else if (currentPhaseFilter === 'Phase A') {
          targetFiles = targetFiles.filter((f) => f.cablePhase === 'Phase A' || f.channel === 0);
        } else if (currentPhaseFilter === 'Phase B') {
          targetFiles = targetFiles.filter((f) => f.cablePhase === 'Phase B' || f.channel === 1);
        } else if (currentPhaseFilter === 'Phase C') {
          targetFiles = targetFiles.filter((f) => f.cablePhase === 'Phase C' || f.channel === 2);
        }
      }

      let maxDelta = -Infinity;
      let maxAbs = -Infinity;
      let peakTime: string | undefined = undefined;
      let peakFileName: string | undefined = undefined;
      let peakFileObj: ParsedTeprFile | null = null;
      let readingsCount = 0;

      for (const f of targetFiles) {
        // Fast match on targetLocationValues
        const locVal = f.targetLocationValues?.find((v) => Math.abs(v.location - pt.dof) < 0.15);
        let delta: number | null = locVal ? locVal.deltaTemp : null;
        let abs: number | null = locVal ? locVal.absoluteTemp : null;

        // If not in precalculated target locations, search raw data points
        if (delta === null && f.dataPoints && f.dataPoints.length > 0) {
          let closest = f.dataPoints[0];
          let minDist = Math.abs(closest.position - pt.dof);
          for (let i = 1; i < f.dataPoints.length; i++) {
            const dist = Math.abs(f.dataPoints[i].position - pt.dof);
            if (dist < minDist) {
              minDist = dist;
              closest = f.dataPoints[i];
            } else if (dist > minDist && f.dataPoints[i].position > pt.dof) {
              break;
            }
          }
          if (minDist <= 60) {
            delta = closest.deltaTemp;
            abs = closest.absoluteTemp;
          }
        }

        if (delta !== null && abs !== null) {
          readingsCount++;
          if (abs > maxAbs) {
            maxAbs = abs;
            maxDelta = delta;
            peakFileName = f.fileName;
            peakFileObj = f;
            peakTime = f.dateMeta?.formattedTime || f.dateMeta?.displayDateTime || f.fileName;
          }
        }
      }

      // Summary map match as fallback
      let summaryMatch = summaryMap.get(pt.dof);
      if (!summaryMatch) {
        for (const [loc, s] of summaryMap.entries()) {
          if (Math.abs(loc - pt.dof) < 0.15) {
            summaryMatch = s;
            break;
          }
        }
      }

      if (maxAbs === -Infinity) {
        if (summaryMatch) {
          maxDelta = summaryMatch.maxDeltaTemp || summaryMatch.currentDeltaTemp || 0;
          maxAbs = summaryMatch.currentAbsoluteTemp || (summaryMatch.baselineTemp + maxDelta);
        } else {
          maxDelta = 0;
          maxAbs = 30.0;
        }
      }

      const cleanAbs = parseFloat(maxAbs.toFixed(2));
      const cleanDelta = parseFloat(maxDelta.toFixed(2));

      // Resolve maximum operating power during the 1-hour period of the fiber temperature reading and compute Conductor Temperature (IEC 60287: Alpha - Echo)
      const opPower = resolveOperatingPowerAtTime(
        dailyPowerSummary,
        peakFileObj?.dateMeta
          ? { hour: peakFileObj.dateMeta.hour, minute: peakFileObj.dateMeta.minute }
          : undefined
      );

      let estimatedConductorTemp60287: number | null = null;
      let equationName: ConductorEquationName = pt.equationName;
      let hasPowerData = opPower.hasPowerData;
      let power115kVCkt3MW: number | null = opPower.hasPowerData ? opPower.pCkt3MW : null;
      let matchedPowerTimestamp: string | null = opPower.hasPowerData ? opPower.matchedTimeLabel : null;

      if (opPower.hasPowerData) {
        const est = estimateConductorTemperatures(pt, cleanAbs, opPower);
        estimatedConductorTemp60287 = est.tc60287;
        equationName = est.equationName;
      } else if (summaryMatch && summaryMatch.hasPowerData) {
        estimatedConductorTemp60287 = summaryMatch.tc60287 ?? summaryMatch.tcMax ?? null;
        equationName = summaryMatch.equationName || pt.equationName;
        hasPowerData = true;
        power115kVCkt3MW = summaryMatch.pCkt3MW ?? null;
        matchedPowerTimestamp = summaryMatch.matchedPowerTime ?? null;
      }

      const evalTempForStatus = estimatedConductorTemp60287 !== null ? estimatedConductorTemp60287 : cleanAbs;
      const status: 'normal' | 'warning' | 'critical' =
        evalTempForStatus >= 60 ? 'critical' : evalTempForStatus >= 45 ? 'warning' : 'normal';

      return {
        ...pt,
        currentDelta: cleanDelta,
        currentAbsoluteTemp: cleanAbs,
        maxDelta: cleanDelta,
        peakTime,
        peakFileName,
        readingsCount,
        status,
        summary: summaryMatch,
        estimatedConductorTemp60287,
        equationName,
        hasPowerData,
        power115kVCkt3MW,
        matchedPowerTimestamp,
      };
    });
  }, [filesToScan, currentHourFilter, currentPhaseFilter, timeSeriesSummary, dailyPowerSummary]);

  // Land Cable Phase Summary Metrics for the Land Cable Phase Legend (Phase A, Phase B, Phase C)
  const landPhaseLegendStats = useMemo(() => {
    const getPhasePeak = (ph: 'A' | 'B' | 'C') => {
      const pts = enrichedPoints.filter((p) => p.cableCategory === 'land' && p.phase === ph);
      let maxVal = -Infinity;
      let maxTf = -Infinity;
      let hottestPos = '';
      pts.forEach((pt) => {
        const val =
          displayMode === 'conductor_60287' && pt.estimatedConductorTemp60287 !== null
            ? pt.estimatedConductorTemp60287
            : pt.currentAbsoluteTemp;
        if (val > maxVal) {
          maxVal = val;
          hottestPos = pt.pos;
        }
        if (pt.currentAbsoluteTemp > maxTf) {
          maxTf = pt.currentAbsoluteTemp;
        }
      });
      return {
        count: pts.length,
        maxMetric: maxVal === -Infinity ? 30.0 : maxVal,
        maxTf: maxTf === -Infinity ? 30.0 : maxTf,
        hottestPos: hottestPos || `LS1-Point 1`,
      };
    };

    return [
      {
        phaseKey: 'A' as const,
        filterValue: 'Phase A',
        label: 'Phase A',
        channelLabel: 'CH 0',
        trackDesc: 'North / West Track',
        color: '#ef4444',
        borderHex: '#f87171',
        bgClass: 'bg-rose-500/20 border-rose-500/50 text-rose-200',
        activeBgClass: 'bg-rose-600 border-rose-400 text-white shadow-md shadow-rose-600/30',
        dotClass: 'bg-[#ef4444]',
        ...getPhasePeak('A'),
      },
      {
        phaseKey: 'B' as const,
        filterValue: 'Phase B',
        label: 'Phase B',
        channelLabel: 'CH 1',
        trackDesc: 'Center / Middle Track',
        color: '#f59e0b',
        borderHex: '#fbbf24',
        bgClass: 'bg-amber-500/20 border-amber-500/50 text-amber-200',
        activeBgClass: 'bg-amber-500 border-amber-300 text-slate-950 shadow-md shadow-amber-500/30',
        dotClass: 'bg-[#f59e0b]',
        ...getPhasePeak('B'),
      },
      {
        phaseKey: 'C' as const,
        filterValue: 'Phase C',
        label: 'Phase C',
        channelLabel: 'CH 2',
        trackDesc: 'South / East Track',
        color: '#3b82f6',
        borderHex: '#60a5fa',
        bgClass: 'bg-blue-500/20 border-blue-500/50 text-blue-200',
        activeBgClass: 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-600/30',
        dotClass: 'bg-[#3b82f6]',
        ...getPhasePeak('C'),
      },
    ];
  }, [enrichedPoints, displayMode]);

  // Filtered points
  const filteredPoints = useMemo(() => {
    return enrichedPoints.filter((pt) => {
      if (categoryFilter !== 'all' && pt.cableCategory !== categoryFilter) return false;
      if (sectionTypeFilter !== 'all' && pt.sectionType !== sectionTypeFilter) return false;
      if (selectedSectionId !== 'all' && pt.sectionId !== selectedSectionId) return false;
      if (currentPhaseFilter === 'Phase A' && pt.cableCategory === 'land' && pt.phase !== 'A') return false;
      if (currentPhaseFilter === 'Phase B' && pt.cableCategory === 'land' && pt.phase !== 'B') return false;
      if (currentPhaseFilter === 'Phase C' && pt.cableCategory === 'land' && pt.phase !== 'C') return false;
      if (currentPhaseFilter === 'Submarine Cable' && pt.cableCategory !== 'submarine') return false;
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matchesQuery = 
          pt.pos.toLowerCase().includes(q) ||
          pt.sectionName.toLowerCase().includes(q) ||
          pt.dof.toString().includes(q) ||
          (pt.dab !== null && pt.dab.toString().includes(q));
        if (!matchesQuery) return false;
      }
      return true;
    });
  }, [enrichedPoints, categoryFilter, sectionTypeFilter, selectedSectionId, currentPhaseFilter, searchFilter]);

  // Global Statistics
  const stats = useMemo(() => {
    let maxTemp = -Infinity;
    let minTemp = Infinity;
    let hottestPoint: EnrichedSamplingPoint | null = null;
    let maxConductorPoint: EnrichedSamplingPoint | null = null;
    let maxConductorVal = -Infinity;
    let criticalCount = 0;
    let warningCount = 0;
    let hasAnyPower = false;

    enrichedPoints.forEach((pt) => {
      if (pt.hasPowerData) hasAnyPower = true;
      const t =
        displayMode === 'conductor_60287' && pt.estimatedConductorTemp60287 !== null
          ? pt.estimatedConductorTemp60287
          : pt.currentAbsoluteTemp;

      if (t > maxTemp) {
        maxTemp = t;
        hottestPoint = pt;
      }
      if (t < minTemp) minTemp = t;
      if (pt.estimatedConductorTemp60287 !== null && pt.estimatedConductorTemp60287 > maxConductorVal) {
        maxConductorVal = pt.estimatedConductorTemp60287;
        maxConductorPoint = pt;
      }
      if (pt.status === 'critical') criticalCount++;
      if (pt.status === 'warning') warningCount++;
    });

    return {
      maxTemp: maxTemp === -Infinity ? 30.0 : maxTemp,
      minTemp: minTemp === Infinity ? 30.0 : minTemp,
      hottestPoint,
      maxConductorPoint,
      maxConductorVal: maxConductorVal === -Infinity ? null : maxConductorVal,
      hasAnyPower,
      criticalCount,
      warningCount,
      totalPoints: enrichedPoints.length,
      normalCount: enrichedPoints.filter((p) => p.sectionType === 'normal').length,
      specialCount: enrichedPoints.filter((p) => p.sectionType === 'special').length,
    };
  }, [enrichedPoints, displayMode]);

  // Color mapper based on display mode (Reading Fiber Tf vs Estimated Conductor Tc,60287)
  const getColorForPoint = useCallback((pt: EnrichedSamplingPoint) => {
    if (displayMode === 'conductor_60287' && pt.estimatedConductorTemp60287 !== null) {
      return getSmoothMetricColor(pt.estimatedConductorTemp60287);
    }
    return getSmoothMetricColor(pt.currentAbsoluteTemp);
  }, [displayMode]);

  // CRITICAL FIX: Prevent wheel zoom from causing the parent web page to scroll up and down
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const preventOuterPageScroll = (e: WheelEvent) => {
      // Stop the browser window from scrolling vertically when cursor is over the map
      e.preventDefault();
      e.stopPropagation();
    };

    // passive: false is REQUIRED so e.preventDefault() actually cancels the window scroll
    container.addEventListener('wheel', preventOuterPageScroll, { passive: false });

    return () => {
      container.removeEventListener('wheel', preventOuterPageScroll);
    };
  }, []);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center between Khanom (9.23°N) and Samui (9.57°N)
    const map = L.map(mapContainerRef.current, {
      center: [9.40, 99.93],
      zoom: 10,
      minZoom: 8,
      maxZoom: 18,
      zoomControl: false, // We provide modern styled custom zoom buttons
      scrollWheelZoom: true,
      attributionControl: false,
    });

    mapRef.current = map;

    // Create Layer Groups
    const routesGroup = L.layerGroup().addTo(map);
    routesGroupRef.current = routesGroup;

    const landmarksGroup = L.layerGroup().addTo(map);
    landmarksGroupRef.current = landmarksGroup;

    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;

    // Trigger map resize check
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      map.remove();
      mapRef.current = null;
      routesGroupRef.current = null;
      landmarksGroupRef.current = null;
      markersGroupRef.current = null;
    };
  }, []);

  // Update Base Tile Layer based on selection (Satellite, Hybrid, Dark)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing tile layers
    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current);
      baseTileLayerRef.current = null;
    }
    if (labelsTileLayerRef.current) {
      map.removeLayer(labelsTileLayerRef.current);
      labelsTileLayerRef.current = null;
    }

    if (baseLayer === 'satellite' || baseLayer === 'hybrid') {
      // Esri World Imagery (High-Resolution Satellite)
      const esriSatellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 18,
          attribution: 'Tiles &copy; Esri',
        }
      );
      esriSatellite.addTo(map);
      baseTileLayerRef.current = esriSatellite;

      if (baseLayer === 'hybrid') {
        // Overlay reference labels (cities, islands, roads)
        const esriLabels = L.tileLayer(
          'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          {
            maxZoom: 18,
            pane: 'overlayPane',
          }
        );
        esriLabels.addTo(map);
        labelsTileLayerRef.current = esriLabels;
      }
    } else {
      // Dark Nautical / CartoDB Dark Matter
      const darkLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          subdomains: 'abcd',
          maxZoom: 19,
          attribution: '&copy; CartoDB',
        }
      );
      darkLayer.addTo(map);
      baseTileLayerRef.current = darkLayer;
    }
  }, [baseLayer]);

  // Update Cable Polyline Route, Heat Aura, Landmarks, and Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Separate Land Cable Phases and Submarine Cable (NO CROSSING PHASES ON LAND)
    const routesGroup = routesGroupRef.current;
    if (routesGroup) {
      routesGroup.clearLayers();

      // Land Cable Phase A: points in sequential order by DOF
      const phaseAPoints = enrichedPoints
        .filter((p) => p.cableCategory === 'land' && p.phase === 'A')
        .sort((a, b) => a.dof - b.dof);

      // Land Cable Phase B: points in sequential order by DOF
      const phaseBPoints = enrichedPoints
        .filter((p) => p.cableCategory === 'land' && p.phase === 'B')
        .sort((a, b) => a.dof - b.dof);

      // Land Cable Phase C: points in sequential order by DOF
      const phaseCPoints = enrichedPoints
        .filter((p) => p.cableCategory === 'land' && p.phase === 'C')
        .sort((a, b) => a.dof - b.dof);

      // Submarine Cable Route: 79 points in sequential order from TJ1 to TJ2
      const submarinePoints = enrichedPoints
        .filter((p) => p.cableCategory === 'submarine')
        .sort((a, b) => a.dof - b.dof);

      // Transition Joint Pit 1 (TJ1) offshore entry point - terminal landing for land phases
      const tj1Entry = submarinePoints[0] || enrichedPoints.find((p) => p.id === 'TJ1-P1');
      const fullPathA = tj1Entry ? [...phaseAPoints, tj1Entry] : phaseAPoints;
      const fullPathB = tj1Entry ? [...phaseBPoints, tj1Entry] : phaseBPoints;
      const fullPathC = tj1Entry ? [...phaseCPoints, tj1Entry] : phaseCPoints;
      const fullPathSub = submarinePoints;

      // Phase focus opacities & weights based on currentPhaseFilter
      const isPhaseA = currentPhaseFilter === 'Phase A';
      const isPhaseB = currentPhaseFilter === 'Phase B';
      const isPhaseC = currentPhaseFilter === 'Phase C';
      const isSub = currentPhaseFilter === 'Submarine Cable';
      const isAll = !isPhaseA && !isPhaseB && !isPhaseC && !isSub;

      const PHASE_COLORS: Record<'A' | 'B' | 'C' | 'sub', string> = {
        A: '#ef4444', // Phase A Red
        B: '#f59e0b', // Phase B Amber/Yellow
        C: '#3b82f6', // Phase C Blue
        sub: '#06b6d4', // Submarine Cyan
      };

      const getPhaseStyle = (phase: 'A' | 'B' | 'C' | 'sub') => {
        if (isAll) {
          return {
            weight: 8, // Prominently increased line size (from 3.5-4px to 8px)
            opacity: 0.95,
            auraOpacity: 0.38,
            phaseColor: PHASE_COLORS[phase],
          };
        }
        if (phase === 'A') {
          return isPhaseA
            ? { weight: 9.5, opacity: 1, auraOpacity: 0.48, phaseColor: PHASE_COLORS.A }
            : { weight: 4.5, opacity: 0.25, auraOpacity: 0.06, phaseColor: PHASE_COLORS.A };
        }
        if (phase === 'B') {
          return isPhaseB
            ? { weight: 9.5, opacity: 1, auraOpacity: 0.48, phaseColor: PHASE_COLORS.B }
            : { weight: 4.5, opacity: 0.25, auraOpacity: 0.06, phaseColor: PHASE_COLORS.B };
        }
        if (phase === 'C') {
          return isPhaseC
            ? { weight: 9.5, opacity: 1, auraOpacity: 0.48, phaseColor: PHASE_COLORS.C }
            : { weight: 4.5, opacity: 0.25, auraOpacity: 0.06, phaseColor: PHASE_COLORS.C };
        }
        // Submarine
        return isSub
          ? { weight: 9.5, opacity: 1, auraOpacity: 0.48, phaseColor: PHASE_COLORS.sub }
          : { weight: 4.5, opacity: 0.25, auraOpacity: 0.06, phaseColor: PHASE_COLORS.sub };
      };

      const styleA = getPhaseStyle('A');
      const styleB = getPhaseStyle('B');
      const styleC = getPhaseStyle('C');
      const styleSub = getPhaseStyle('sub');

      // Helper function to render a thickened gradient polyline between consecutive dots
      const renderGradientPolyline = (
        pts: EnrichedSamplingPoint[],
        style: { weight: number; opacity: number; auraOpacity: number; phaseColor: string },
        routeName: string,
        phaseBadge?: string
      ) => {
        if (pts.length < 2) return;

        // Render outer phase-colored track casing line for Land Cable phases so Phase A/B/C tracks are visually identifiable
        if (phaseBadge && style.opacity > 0.3) {
          const allCoords: [number, number][] = pts.map((p) => [p.latitude, p.longitude]);
          L.polyline(allCoords, {
            color: style.phaseColor,
            weight: style.weight + 3.5,
            opacity: 0.75,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(routesGroup);
        }

        const SUB_STEPS = 4; // 4 micro-segments between adjacent dots for smooth continuous gradient

        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];

          const c1 = getColorForPoint(p1);
          const c2 = getColorForPoint(p2);

          const isSameColor = c1.toLowerCase() === c2.toLowerCase();
          const steps = isSameColor ? 1 : SUB_STEPS;

          for (let s = 0; s < steps; s++) {
            const t0 = s / steps;
            const t1 = (s + 1) / steps;
            const tMid = (t0 + t1) / 2;

            const segLat0 = p1.latitude + (p2.latitude - p1.latitude) * t0;
            const segLng0 = p1.longitude + (p2.longitude - p1.longitude) * t0;
            const segLat1 = p1.latitude + (p2.latitude - p1.latitude) * t1;
            const segLng1 = p1.longitude + (p2.longitude - p1.longitude) * t1;

            // Interpolate color smoothly from dot p1's color to dot p2's color
            const stepColor = isSameColor ? c1 : interpolateHexColor(c1, c2, tMid);

            const segmentCoords: [number, number][] = [
              [segLat0, segLng0],
              [segLat1, segLng1],
            ];

            // 1. Thick Glowing Thermal Aura Underneath
            if (showHeatAura && style.auraOpacity > 0) {
              L.polyline(segmentCoords, {
                color: stepColor,
                weight: Math.round(style.weight * 2.25), // 18px - 22px glowing thermal halo
                opacity: style.auraOpacity,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false,
              }).addTo(routesGroup);
            }

            // 2. Thick Core Gradient Polyline
            const segLine = L.polyline(segmentCoords, {
              color: stepColor,
              weight: style.weight, // 8px - 9.5px thick line
              opacity: style.opacity,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(routesGroup);

            // Informative gradient tooltip connecting the two positions
            segLine.bindTooltip(
              `<div class="p-2 font-sans min-w-[215px] max-w-[265px] text-slate-800">
                <div class="font-bold text-slate-900 text-xs flex items-center justify-between gap-2 pb-1 border-b border-slate-200">
                  <span class="flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full inline-block" style="background-color: ${style.phaseColor};"></span>
                    <span>${routeName}</span>
                  </span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold text-white" style="background-color: ${style.phaseColor};">${phaseBadge || 'Subsea CH 3'}</span>
                </div>
                <div class="text-slate-600 text-[11px] font-medium py-1 truncate">${p1.pos} ➔ ${p2.pos}</div>
                <div class="pt-1.5 border-t border-slate-100 space-y-1 text-[11px] font-mono">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-slate-500">From (${p1.pos}):</span>
                    <strong class="text-slate-900">${p1.currentAbsoluteTemp.toFixed(1)}°C</strong>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-slate-500">To (${p2.pos}):</span>
                    <strong class="text-slate-900">${p2.currentAbsoluteTemp.toFixed(1)}°C</strong>
                  </div>
                </div>
              </div>`,
              { sticky: true, className: 'custom-heat-tooltip shadow-lg rounded-xl border border-slate-200 bg-white/95' }
            );

            segLine.on('click', () => {
              onSelectLocation(tMid < 0.5 ? p1.dof : p2.dof);
            });
          }
        }
      };

      // Render each cable circuit branch with thickened thermal gradient lines & phase casing
      renderGradientPolyline(fullPathA, styleA, 'Land Cable Phase A', 'Phase A • CH 0');
      renderGradientPolyline(fullPathB, styleB, 'Land Cable Phase B', 'Phase B • CH 1');
      renderGradientPolyline(fullPathC, styleC, 'Land Cable Phase C', 'Phase C • CH 2');
      renderGradientPolyline(fullPathSub, styleSub, '115 kV Submarine Cable', 'Subsea • CH 3');
    }

    // 2. Special Section Pins & Optional Staggered Callout Banners
    const landmarksGroup = landmarksGroupRef.current;
    if (landmarksGroup) {
      landmarksGroup.clearLayers();

      const specialSectionBanners = [
        {
          code: 'SWY',
          name: 'Khanom Switchyard Riserpole',
          badge: 'Mainland SWY (0m)',
          detail: 'Switchyard Riserpole • Sec 1.1',
          lat: 9.233223,
          lng: 99.859099,
          dof: 2020.94,
          color: '#ef4444',
          side: 'right' as const,
          offsetY: 28,
        },
        {
          code: 'JP1',
          name: 'Joint Pit 1 (JP1)',
          badge: 'Joint Pit 1 (JP1)',
          detail: 'Special Joint Pit • 475m',
          lat: 9.234430,
          lng: 99.856651,
          dof: 2486.50,
          color: '#f59e0b',
          side: 'left' as const,
          offsetY: 28,
        },
        {
          code: 'JP2',
          name: 'Joint Pit 2 (JP2)',
          badge: 'Joint Pit 2 (JP2)',
          detail: 'Special Joint Pit • 955m',
          lat: 9.238423,
          lng: 99.859666,
          dof: 2950.00,
          color: '#f59e0b',
          side: 'left' as const,
          offsetY: -42,
        },
        {
          code: 'TJ1',
          name: 'Transition Joint Pit 1 (TJ1)',
          badge: 'Landing Pit TJ1',
          detail: 'Shore Landing • 1,460m',
          lat: 9.241058,
          lng: 99.862550,
          dof: 2691.75,
          color: '#10b981',
          side: 'right' as const,
          offsetY: -42,
        },
        {
          code: 'XPWA',
          name: 'Water Pipeline Crossing (XPWA)',
          badge: 'XPWA Water Crossing',
          detail: 'Subsea Pipeline • 15.1 km',
          lat: 9.351386,
          lng: 99.867757,
          dof: 15139.20,
          color: '#0284c7',
          side: 'right' as const,
          offsetY: -16,
        },
        {
          code: 'NX',
          name: 'Subsea Joint Nexans (NX1/NX2)',
          badge: 'Subsea Joint NX',
          detail: 'Nexans Joint • 35.2 km',
          lat: 9.532998,
          lng: 99.891797,
          dof: 35198.87,
          color: '#a855f7',
          side: 'right' as const,
          offsetY: 18,
        },
        {
          code: 'FR',
          name: 'Subsea Joint Furukawa (FR1/FR2)',
          badge: 'Subsea Joint FR',
          detail: 'Furukawa Joint • 36.3 km',
          lat: 9.540556,
          lng: 99.892500,
          dof: 36309.67,
          color: '#ec4899',
          side: 'left' as const,
          offsetY: -28,
        },
        {
          code: '33kV',
          name: '33kV Pha Ngan Power Crossing',
          badge: '33kV Cable Crossing',
          detail: 'Pha Ngan Crossing (IEC Estimation) • 51.3 km',
          lat: 9.594609,
          lng: 99.998328,
          dof: 51305.42,
          color: '#f59e0b',
          side: 'top' as const,
          offsetY: -34,
        },
        {
          code: 'TJ2',
          name: 'Transition Joint Pit 2 (TJ2)',
          badge: 'Samui Landfall TJ2',
          detail: 'Samui Landing • 54.9 km',
          lat: 9.569008,
          lng: 100.004530,
          dof: 54931.84,
          color: '#10b981',
          side: 'right' as const,
          offsetY: -16,
        },
      ];

      specialSectionBanners.forEach((lm) => {
        let calloutHtml = '';
        if (showMapPinCallouts) {
          let arrowSvg = '';
          let bannerStyle = '';
          let bannerInnerClass = '';
          const targetEndY = lm.offsetY + 15;

          if (lm.side === 'right') {
            arrowSvg = `
              <svg style="position: absolute; left: 0; top: -60px; width: 36px; height: 120px; overflow: visible; pointer-events: none; z-index: 5;">
                <polygon points="2,60 9,56 9,64" fill="${lm.color}" stroke="#ffffff" stroke-width="0.8" />
                <polyline points="8,60 20,${60 + targetEndY} 32,${60 + targetEndY}" fill="none" stroke="${lm.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            `;
            bannerStyle = `position: absolute; left: 32px; top: ${lm.offsetY}px;`;
            bannerInnerClass = 'flex items-center gap-1.5';
          } else if (lm.side === 'left') {
            arrowSvg = `
              <svg style="position: absolute; left: -36px; top: -60px; width: 36px; height: 120px; overflow: visible; pointer-events: none; z-index: 5;">
                <polygon points="34,60 27,56 27,64" fill="${lm.color}" stroke="#ffffff" stroke-width="0.8" />
                <polyline points="28,60 16,${60 + targetEndY} 4,${60 + targetEndY}" fill="none" stroke="${lm.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            `;
            bannerStyle = `position: absolute; right: 32px; top: ${lm.offsetY}px;`;
            bannerInnerClass = 'flex items-center gap-1.5 flex-row-reverse';
          } else {
            arrowSvg = `
              <svg style="position: absolute; left: -10px; top: -32px; width: 20px; height: 32px; overflow: visible; pointer-events: none; z-index: 5;">
                <polygon points="10,30 6,22 14,22" fill="${lm.color}" stroke="#ffffff" stroke-width="0.8" />
                <line x1="10" y1="2" x2="10" y2="23" stroke="${lm.color}" stroke-width="2" stroke-linecap="round" />
              </svg>
            `;
            bannerStyle = 'position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);';
            bannerInnerClass = 'flex items-center gap-1.5';
          }

          calloutHtml = `
            ${arrowSvg}
            <div style="${bannerStyle} pointer-events: auto; cursor: pointer; white-space: nowrap; z-index: 25;">
              <div class="${bannerInnerClass} px-2 py-0.5 rounded-lg bg-slate-900/95 hover:bg-slate-900 text-white backdrop-blur-md border shadow-lg transition-transform hover:scale-105 active:scale-95" style="border-color: ${lm.color};">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${lm.color};"></span>
                <div class="flex flex-col text-left">
                  <span class="text-[10px] font-bold text-white whitespace-nowrap leading-tight tracking-tight">${lm.badge}</span>
                  <span class="text-[8px] font-mono text-slate-300 whitespace-nowrap leading-tight">${lm.detail}</span>
                </div>
              </div>
            </div>
          `;
        }

        const iconHtml = `
          <div style="position: relative; width: 0; height: 0; pointer-events: none;">
            <!-- Clean Special Landmark Pin Marker -->
            <span style="position: absolute; left: -6px; top: -6px; width: 12px; height: 12px; border-radius: 50%; background-color: ${lm.color}; border: 2px solid #ffffff; box-shadow: 0 0 8px ${lm.color}; pointer-events: auto; cursor: pointer; z-index: 15;"></span>
            ${calloutHtml}
          </div>
        `;

        const divIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-special-banner-icon',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        const marker = L.marker([lm.lat, lm.lng], {
          icon: divIcon,
          interactive: true,
          zIndexOffset: 1200,
        });

        marker.bindTooltip(
          `<div class="px-2 py-1 font-sans text-xs">
            <div class="font-bold text-slate-900">${lm.badge}</div>
            <div class="text-[10px] text-slate-500 font-mono">${lm.detail}</div>
          </div>`,
          { direction: 'top', offset: [0, -8], className: 'custom-heat-tooltip shadow-md rounded-lg border border-slate-200 bg-white/95' }
        );

        marker.on('click', () => {
          onSelectLocation(lm.dof);
          map.flyTo([lm.lat, lm.lng], 15, { duration: 0.8 });
        });

        marker.addTo(landmarksGroup);
      });
    }

    // 3. Render Individual Sampling Point Markers (Heat Circles)
    const markersGroup = markersGroupRef.current;
    if (markersGroup) {
      markersGroup.clearLayers();

      filteredPoints.forEach((pt) => {
        const color = getColorForPoint(pt);
        const isSelected = selectedLocation !== null && Math.abs(pt.dof - selectedLocation) < 0.1;
        const isHottest = stats.hottestPoint?.id === pt.id;
        const isSpecial = pt.sectionType === 'special';

        // Outer heat aura halo (radial thermal glow)
        if (showHeatAura) {
          const outerGlow = L.circleMarker([pt.latitude, pt.longitude], {
            radius: isHottest ? 24 : isSpecial ? 18 : 14,
            fillColor: color,
            fillOpacity: isHottest ? 0.45 : 0.25,
            stroke: false,
            interactive: false,
          });
          outerGlow.addTo(markersGroup);
        }

        // Selected Location Halo Ring
        if (isSelected) {
          const selectRing = L.circleMarker([pt.latitude, pt.longitude], {
            radius: 15,
            fillColor: 'transparent',
            color: '#38bdf8',
            weight: 3.5,
            dashArray: '3, 3',
            interactive: false,
          });
          selectRing.addTo(markersGroup);
        }

        // Phase border color for Land Cable Phase A, Phase B, Phase C vs Submarine
        const phaseRingColor =
          pt.cableCategory === 'land'
            ? pt.phase === 'A'
              ? '#ef4444' // Phase A Red
              : pt.phase === 'B'
              ? '#f59e0b' // Phase B Amber/Yellow
              : '#3b82f6' // Phase C Blue
            : '#0f172a';

        const phaseLabelText =
          pt.cableCategory === 'land'
            ? `Phase ${pt.phase} (CH ${pt.phase === 'A' ? 0 : pt.phase === 'B' ? 1 : 2})`
            : 'Submarine 3-Core (CH 3)';

        // Center Marker (Circle for normal, with Phase-colored ring for Land Cable A/B/C)
        const centerMarker = L.circleMarker([pt.latitude, pt.longitude], {
          radius: isSelected ? 9.5 : isSpecial ? 7.5 : 6.5,
          fillColor: color,
          fillOpacity: 1,
          color: isSelected ? '#ffffff' : phaseRingColor,
          weight: isSelected ? 3 : pt.cableCategory === 'land' ? 2.2 : 1.5,
        });

        // Interactive Tooltip (Hover)
        const isDailyMax = currentHourFilter === 'all';
        const condRowsHtml = pt.hasPowerData && pt.estimatedConductorTemp60287 !== null
          ? `
              <div class="flex items-center justify-between gap-3 bg-rose-50 px-1.5 py-0.5 rounded pt-1 border-t border-slate-100">
                <span class="text-rose-800 font-bold">Est. Conductor Tc,60287 (IEC Estimation):</span>
                <strong class="text-rose-700 font-extrabold text-xs">${pt.estimatedConductorTemp60287.toFixed(2)}°C</strong>
              </div>
            `
          : `
              <div class="mt-1 px-1.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-sans font-semibold">
                No Power Data for Date — Showing Tf Only
              </div>
            `;

        const tooltipContent = `
          <div class="p-2.5 font-sans min-w-[250px] max-w-[300px] text-slate-800 select-none">
            <div class="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
              <span class="font-bold text-slate-900 text-xs tracking-tight">${pt.pos} <span class="text-[10px] font-mono text-slate-500">(Sec ${pt.sectionId})</span></span>
              <span class="text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${isDailyMax ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}">
                ${isDailyMax ? 'Daily Max' : `Hour ${currentHourFilter} Max`}
              </span>
            </div>
            <div class="flex items-center justify-between gap-2 py-1">
              <span class="text-[11px] text-slate-600 font-medium truncate">${pt.sectionName}</span>
              <span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded text-white shrink-0" style="background-color: ${pt.cableCategory === 'land' ? phaseRingColor : '#0284c7'};">
                ${phaseLabelText}
              </span>
            </div>
            <div class="pt-1.5 border-t border-slate-100 space-y-1 text-[11px] font-mono">
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-500">Reading Fiber (Tf):</span>
                <strong class="text-blue-700 font-bold text-xs">${pt.currentAbsoluteTemp.toFixed(2)}°C</strong>
              </div>
              ${condRowsHtml}
              <div class="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                <span class="text-slate-500">Sensing (DOF):</span>
                <span class="text-slate-700 font-semibold">${pt.dof.toFixed(2)} m (KP ${pt.kp.toFixed(3)})</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-500">Timestamp:</span>
                <span class="text-slate-700 font-semibold">${pt.peakTime || '-'}</span>
              </div>
            </div>
          </div>
        `;
        centerMarker.bindTooltip(tooltipContent, {
          direction: 'top',
          offset: [0, -6],
          className: 'custom-heat-tooltip shadow-lg rounded-xl border border-slate-200 bg-white/98',
        });

        // Popup Content (Click)
        const popupCondHtml = pt.hasPowerData && pt.estimatedConductorTemp60287 !== null
          ? `
              <div class="flex justify-between text-rose-700 font-bold bg-rose-50 px-1 py-0.5 rounded"><span>Est. Conductor Tc,60287 (IEC Estimation):</span><strong>${pt.estimatedConductorTemp60287.toFixed(2)} °C</strong></div>
              <div class="flex justify-between text-slate-600"><span>115kV Ckt #3 Max 1h Power:</span><strong>${pt.power115kVCkt3MW?.toFixed(2)} MW</strong></div>
            `
          : `<div class="text-amber-800 bg-amber-50 p-1 rounded text-[10px] font-sans font-semibold">No Power Data for Date — Conductor Estimation Halted</div>`;

        const popupContent = `
          <div class="text-xs p-2 space-y-1.5 font-sans min-w-[245px]">
            <div class="flex items-center justify-between border-b border-slate-200 pb-1">
              <span class="font-bold text-slate-900">${pt.pos} (Sec ${pt.sectionId})</span>
              <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded ${isDailyMax ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}">
                ${isDailyMax ? 'Daily Maximum (24h Peak)' : `Hourly Maximum (${currentHourFilter}:00 - ${currentHourFilter}:59)`}
              </span>
            </div>
            <div class="text-slate-600 text-[11px] font-medium">${pt.sectionName}</div>
            <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-200 space-y-1 font-mono text-[11px]">
              <div class="flex justify-between"><span>Reading Fiber Temp (Tf):</span><strong class="text-blue-700">${pt.currentAbsoluteTemp.toFixed(2)} °C</strong></div>
              ${popupCondHtml}
              <div class="flex justify-between"><span>Peak Timestamp:</span><strong>${pt.peakTime || 'Evaluated'}</strong></div>
              <div class="flex justify-between"><span>Sensing (DOF / KP):</span><strong>${pt.dof.toFixed(2)} m / KP ${pt.kp.toFixed(3)}</strong></div>
              <div class="flex justify-between"><span>As-Built (DAB):</span><strong>${pt.dab !== null ? `${pt.dab.toFixed(2)} m` : 'N/A'}</strong></div>
              <div class="flex justify-between text-slate-500 text-[9px] pt-1 border-t border-slate-200">
                <span>GPS:</span><span>${pt.latitude.toFixed(5)}, ${pt.longitude.toFixed(5)}</span>
              </div>
            </div>
          </div>
        `;
        centerMarker.bindPopup(popupContent, {
          className: 'custom-heat-popup rounded-2xl overflow-hidden',
        });

        // Click handler
        centerMarker.on('click', () => {
          onSelectLocation(pt.dof);
          setHoveredPoint(pt);
        });

        centerMarker.addTo(markersGroup);
      });
    }
  }, [filteredPoints, enrichedPoints, displayMode, selectedLocation, showHeatAura, showMapPinCallouts, getColorForPoint, onSelectLocation, stats.hottestPoint, currentPhaseFilter, currentHourFilter]);

  // Smooth Fly-To when selectedLocation changes externally
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedLocation === null) return;

    const matched = enrichedPoints.find((p) => Math.abs(p.dof - selectedLocation) < 0.1);
    if (matched) {
      const currentZoom = map.getZoom();
      const targetZoom = Math.max(currentZoom, 13);
      map.flyTo([matched.latitude, matched.longitude], targetZoom, {
        duration: 0.8,
        easeLinearity: 0.25,
      });
    }
  }, [selectedLocation, enrichedPoints]);

  // Navigation Presets Handlers
  const handleFitEntireRoute = () => {
    const map = mapRef.current;
    if (!map) return;
    // Bounding box of Circuit #3 (Khanom to Samui)
    map.fitBounds([
      [9.225, 99.850],
      [9.575, 100.015],
    ], { padding: [40, 40], duration: 0.8 });
  };

  const handleFocusLandCable = () => {
    const map = mapRef.current;
    if (!map) return;
    setCategoryFilter('land');
    map.flyTo([9.238, 99.863], 15, { duration: 0.8 });
  };

  const handleFocusSubmarineCorridor = () => {
    const map = mapRef.current;
    if (!map) return;
    setCategoryFilter('submarine');
    map.flyTo([9.400, 99.935], 11, { duration: 0.8 });
  };

  const handleFocusSamuiLandfall = () => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([9.568, 100.004], 15, { duration: 0.8 });
  };

  // Export Filtered Circuit Points to CSV
  const handleExportCSV = () => {
    let csv = 'POS,Section ID,Section Name,Type,Cable Category,KP,DAB (m),DOF (m),Latitude,Longitude,Reading Fiber Tf (C),Current Delta (C),Est Conductor Tc_60287 (C),IEC Estimation,115kV Ckt3 Max 1h MW,Power Status,Status\n';
    filteredPoints.forEach((p) => {
      csv += `"${p.pos}","${p.sectionId}","${p.sectionName}","${p.sectionType}","${p.cableCategory}",${p.kp.toFixed(3)},${p.dab !== null ? p.dab : ''},${p.dof},${p.latitude},${p.longitude},${p.currentAbsoluteTemp},${p.currentDelta},${p.estimatedConductorTemp60287 !== null ? p.estimatedConductorTemp60287.toFixed(2) : 'N/A'},"IEC Estimation",${p.power115kVCkt3MW !== null ? p.power115kVCkt3MW.toFixed(2) : 'N/A'},"${p.hasPowerData ? `1h Max Power (${p.matchedPowerTimestamp})` : 'No Power Data for Date'}","${p.status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Circuit_3_Cable_Satellite_HeatMap_Points_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Selected or hovered point info for inspection panel
  const activeInspectPoint = hoveredPoint || (selectedLocation !== null ? enrichedPoints.find((p) => Math.abs(p.dof - selectedLocation) < 0.1) : null) || stats.hottestPoint;

  return (
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col space-y-4 p-5 transition-all ${isFullscreen ? 'fixed inset-4 z-50 shadow-2xl max-h-[96vh]' : ''}`}>
      {/* Top Header & Overview Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 shadow-2xs">
              <Compass className="w-4 h-4" />
            </span>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              115 kV Submarine Cable Circuit #3 - Satellite Heat Map
            </h3>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-100/70 text-teal-800 border border-teal-200">
              Khanom ↔ Koh Samui (53.5 km)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Displays Reading Fiber Optic Temperature ($T_f$) and Estimated Conductor Temperature ($T_{'{'}c,60287{'}'}$) via IEC Estimation.
          </p>
        </div>

        {/* Global Key Metrics Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2">
            <span className="text-slate-400 font-medium">Plotted Nodes:</span>
            <span className="font-bold text-slate-800">{enrichedPoints.length}</span>
            <span className="text-[10px] text-slate-400">({stats.normalCount} normal / {stats.specialCount} special)</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
            <span className="text-blue-700 font-medium">
              {currentHourFilter === 'all' ? 'Reading Fiber Tf:' : `Hour ${currentHourFilter} Tf:`}
            </span>
            <span className="font-bold text-blue-900">
              {stats.hottestPoint ? `${stats.hottestPoint.pos} (${stats.hottestPoint.currentAbsoluteTemp.toFixed(2)}°C)` : '30.00°C'}
            </span>
          </div>

          {stats.hasAnyPower && stats.maxConductorPoint && stats.maxConductorVal !== null ? (
            <div className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-1.5">
              <Thermometer className="w-3.5 h-3.5 text-rose-600" />
              <span className="text-rose-700 font-medium">Est. Conductor Tc,60287:</span>
              <span className="font-extrabold text-rose-950 font-mono">
                {stats.maxConductorPoint.pos} ({stats.maxConductorVal.toFixed(2)}°C)
              </span>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 flex items-center gap-1.5 text-amber-900 font-semibold">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>No Power Data for Date — Showing Tf Only</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowRegistryModal(true)}
            className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold border border-blue-200 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Inspect full IEC Estimation & Conductor Temperature registry table"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>IEC Estimation Conductor Registry ({enrichedPoints.length})</span>
          </button>
        </div>
      </div>

      {/* Main Filter Connection Bar & Hourly Maximum Dropdown */}
      <div className="bg-slate-900 text-white rounded-xl p-3 border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        {/* Left: Main Filter Active Date & Connection Status */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Date Tag */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 font-semibold">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400 text-[11px]">Main Filter Date:</span>
            <span className="text-white font-mono font-bold">
              {activeDateFilter && activeDateFilter !== 'all' ? activeDateFilter : 'All Loaded Traces'}
            </span>
          </div>

          {/* Current Evaluation Mode Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950 border border-blue-800 font-semibold text-blue-300">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 text-[11px]">Mode:</span>
            <span className="text-amber-300 font-bold">
              {currentHourFilter === 'all'
                ? 'Daily Maximum (24h Peak Value)'
                : `Hourly Maximum (${currentHourFilter}:00 - ${currentHourFilter}:59)`}
            </span>
          </div>

          {/* Records connection & update status */}
          {filesToScan.length > 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px] bg-emerald-950/70 border border-emerald-800/80 px-2.5 py-1 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>
                Updated: {filesToScan.length} TEPR trace files
                {dailyPeakMetric && currentHourFilter === 'all' && (
                  <span className="text-slate-200 ml-1">
                    (Daily Max: <strong className="text-white">{dailyPeakMetric.maxAbsoluteTemp.toFixed(2)}°C</strong> at {dailyPeakMetric.peakTime})
                  </span>
                )}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-300 font-medium text-[11px] bg-amber-950/70 border border-amber-800/80 px-2.5 py-1 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                {isReadingTemperature
                  ? 'Reading temperature files from main filter...'
                  : 'Main filter awaiting setup: Select Year, Month, Date & click "Reading Temperature" above to load daily traces.'}
              </span>
            </div>
          )}
        </div>

        {/* Right: Dropdown List for Hourly Maximum / Daily Maximum */}
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="heatmap-hourly-select" className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>Select Peak Window:</span>
          </label>
          <select
            id="heatmap-hourly-select"
            value={currentHourFilter}
            onChange={(e) => handleHourChange(e.target.value)}
            className="bg-slate-800 hover:bg-slate-750 text-white font-bold text-xs rounded-lg px-3 py-1.5 border border-blue-500/60 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer shadow-inner transition-all"
          >
            <option value="all">
              ⭐ Daily Maximum (Full 24-Hour Peak Value)
              {dailyPeakMetric ? ` [Peak: ${dailyPeakMetric.maxAbsoluteTemp.toFixed(1)}°C]` : ''}
            </option>
            <optgroup label="Select Hourly Maximum Window (00:00 - 23:59)">
              {Array.from({ length: 24 }).map((_, h) => {
                const hKey = String(h).padStart(2, '0');
                const count = hourCounts[hKey] || 0;
                const peak = hourPeaks[hKey];
                const hasData = count > 0;
                return (
                  <option key={hKey} value={hKey}>
                    Hour {hKey}:00 - {hKey}:59 (Hourly Max{hasData ? `: ${peak?.toFixed(1)}°C • ${count} files` : ' • No data'})
                  </option>
                );
              })}
            </optgroup>
          </select>
        </div>
      </div>

      {/* Control & Sectional Filters Toolbar */}
      <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left Filter Group: Base Layer, Route Category & Section Type */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Map Layer Mode Switcher (Satellite vs Hybrid vs Dark) */}
          <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 shadow-2xs">
            <span className="px-2 text-slate-400 font-medium flex items-center gap-1">
              <Globe className="w-3 h-3 text-blue-600" />
              <span>Map Layer:</span>
            </span>
            <button
              type="button"
              onClick={() => setBaseLayer('satellite')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                baseLayer === 'satellite'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="High-resolution satellite view without labels"
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setBaseLayer('hybrid')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                baseLayer === 'hybrid'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Satellite imagery with island, ocean and place labels"
            >
              Satellite + Labels
            </button>
            <button
              type="button"
              onClick={() => setBaseLayer('dark')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                baseLayer === 'dark'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Dark Nautical Cartography"
            >
              Dark Ocean
            </button>
          </div>

          {/* Cable Category Filter */}
          <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 shadow-2xs">
            <span className="px-2 text-slate-400 font-medium flex items-center gap-1">
              <Layers className="w-3 h-3" />
              <span>Route:</span>
            </span>
            <button
              type="button"
              onClick={() => { setCategoryFilter('all'); setSelectedSectionId('all'); handleFitEntireRoute(); }}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                categoryFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All (53.5 km)
            </button>
            <button
              type="button"
              onClick={handleFocusLandCable}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                categoryFilter === 'land'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Land (1,460m)
            </button>
            <button
              type="button"
              onClick={handleFocusSubmarineCorridor}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                categoryFilter === 'submarine'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Submarine (52 km)
            </button>
          </div>

          {/* Land Cable Phase Filter & Legend Bar (Phase A, Phase B, Phase C) */}
          <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 shadow-2xs">
            <span className="px-2 text-slate-500 font-semibold flex items-center gap-1">
              <span>Land Phase:</span>
            </span>
            <button
              type="button"
              onClick={() => handlePhaseChange('all')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                currentPhaseFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Show all Land Cable phases (Phase A, B, C) and Submarine Cable"
            >
              All Phases
            </button>
            {landPhaseLegendStats.map((ph) => {
              const isActive = currentPhaseFilter === ph.filterValue;
              return (
                <button
                  key={ph.phaseKey}
                  type="button"
                  onClick={() => {
                    handlePhaseChange(isActive ? 'all' : ph.filterValue);
                    if (!isActive && categoryFilter === 'submarine') {
                      setCategoryFilter('land');
                    }
                  }}
                  className={`px-2 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-2xs ring-1 ring-slate-700'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  title={`${ph.label} (${ph.channelLabel}) • ${ph.trackDesc} • Peak: ${ph.maxMetric.toFixed(1)}°C`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/15"
                    style={{ backgroundColor: ph.color }}
                  />
                  <span>{ph.label}</span>
                  <span className="text-[10px] font-mono opacity-75">({ph.channelLabel})</span>
                </button>
              );
            })}
          </div>

          {/* Sectional Filter: Normal vs Special */}
          <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 shadow-2xs">
            <span className="px-2 text-slate-400 font-medium flex items-center gap-1">
              <Filter className="w-3 h-3" />
              <span>Type:</span>
            </span>
            <button
              type="button"
              onClick={() => setSectionTypeFilter('all')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                sectionTypeFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setSectionTypeFilter('normal')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                sectionTypeFilter === 'normal'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setSectionTypeFilter('special')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                sectionTypeFilter === 'special'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Special (Joints/Pits)
            </button>
          </div>

          {/* Individual Section Select */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedSectionId}
              onChange={(e) => {
                const secId = e.target.value;
                setSelectedSectionId(secId);
                if (secId !== 'all') {
                  const firstPt = enrichedPoints.find((p) => p.sectionId === secId);
                  if (firstPt && mapRef.current) {
                    onSelectLocation(firstPt.dof);
                    mapRef.current.flyTo([firstPt.latitude, firstPt.longitude], 14, { duration: 0.8 });
                  }
                }
              }}
              className="bg-white border border-slate-200 text-slate-700 font-semibold px-2.5 py-1.5 rounded-lg shadow-2xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer text-xs"
            >
              <option value="all">-- Jump to Section (19 Sections) --</option>
              <optgroup label="Land Cable (Sections 1.1 - 1.6 • 38 DOF/Phase)">
                {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land').map((s) => (
                  <option key={s.id} value={s.id}>
                    Sec {s.id}: {s.name} ({s.type})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Submarine Cable (Sections 2.1 - 2.13 • 81 DOF)">
                {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine').map((s) => (
                  <option key={s.id} value={s.id}>
                    Sec {s.id}: {s.name} ({s.type})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* Right Filter Group: Color By Mode (Only Reading Fiber Tf and Estimated Conductor Tc,60287) & Heat Aura Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Display Mode: Only Est. Conductor Temp (Tc,60287) and Reading Fiber Optic Temp (Tf) */}
          <div className="flex flex-wrap items-center bg-white rounded-lg p-0.5 border border-slate-200 shadow-2xs">
            <span className="px-2 text-slate-400 font-medium flex items-center gap-1">
              <Thermometer className="w-3 h-3 text-rose-500" />
              <span>Color By:</span>
            </span>
            <button
              type="button"
              onClick={() => setDisplayMode('conductor_60287')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                displayMode === 'conductor_60287'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Color-code nodes by Estimated Conductor Temperature Tc,60287 (IEC Estimation)"
            >
              Est. Conductor Temp Tc,60287 (°C)
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('temperature')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                displayMode === 'temperature'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Color-code nodes by Reading Temperature from Fiber Optic Tf (°C)"
            >
              Reading Fiber Temp Tf (°C)
            </button>
          </div>

          {/* Thermal Glow Aura Toggle */}
          <button
            type="button"
            onClick={() => setShowHeatAura(!showHeatAura)}
            className={`px-2 py-1 rounded-md font-semibold border text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-2xs ${
              showHeatAura
                ? 'bg-amber-50 text-amber-900 border-amber-300'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            title="Toggle thermal glow aura around cable and nodes"
          >
            <Radio className="w-3 h-3 text-amber-600" />
            <span>Heat Aura</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsFullscreen(!isFullscreen);
              setTimeout(() => mapRef.current?.invalidateSize(), 200);
            }}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 shadow-2xs cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Map & Inspector Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Satellite Map Container (8 cols on large screen) */}
        <div className="lg:col-span-8 bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden flex flex-col shadow-inner">
          {/* Pinned Top Border Legend & Quick Focus Bar (Outside Map Canvas — Zero Map Overlap) */}
          <div className="bg-slate-900 border-b border-slate-800 px-3.5 py-2 space-y-2 text-[11px] text-slate-200 select-none transition-all">
            {isLegendMinimized ? (
              /* Minimized Sleek Single-Bar View */
              <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-teal-400 font-bold font-mono text-[10px] flex items-center gap-1.5 bg-slate-950/90 px-2 py-1 rounded-lg border border-slate-800">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>MAP LEGEND ({filteredPoints.length} NODES)</span>
                  </span>

                  {/* Compact Temperature Summary */}
                  <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800 text-[10px] font-mono">
                    <span className="text-slate-400 font-sans">6-Zone Scale:</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#38bdf8]" />&lt;35°C Cool</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#10b981]" />35–45°C Normal</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#eab308]" />45–55°C Monitor</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f97316]" />55–60°C Alert</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ef4444]" />60–70°C Danger</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#991b1b] ring-1 ring-red-400/50" />&gt;70°C Critical</span>
                  </div>

                  {/* Compact Phase Summary */}
                  <div className="hidden sm:flex items-center gap-1.5 bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800 text-[10px]">
                    <span className="w-2 h-2 rounded-full bg-[#ef4444]" title="Phase A" />
                    <span className="w-2 h-2 rounded-full bg-[#f59e0b]" title="Phase B" />
                    <span className="w-2 h-2 rounded-full bg-[#3b82f6]" title="Phase C" />
                    <span className="w-2 h-2 rounded-full bg-[#06b6d4]" title="Submarine" />
                    <span className="text-slate-400">CH 0–3</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleFitEntireRoute}
                    className="px-2 py-0.5 rounded-md bg-blue-600/90 hover:bg-blue-500 text-white font-bold text-[10px] cursor-pointer"
                    title="Reset view to fit entire 53.5 km route"
                  >
                    Fit Route
                  </button>
                </div>

                {/* Button to Expand / Show Legend Detail */}
                <button
                  type="button"
                  onClick={() => setIsLegendMinimized(false)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                  title="Show full legend detail (Color scales, Phase metrics, Special section pins)"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Show Legend Detail</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              /* Expanded Full 3-Row Detailed Legend View */
              <>
                {/* Row 1: Route Info + Temperature Color Scale Legend + Node Symbols + Quick Focus Presets + Minimize Button */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  {/* Left: Temperature Scale & Node Type Legend */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-teal-400 font-bold font-mono text-[10px] flex items-center gap-1.5 bg-slate-950/90 px-2 py-1 rounded-lg border border-slate-800">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>PINNED MAP LEGEND ({filteredPoints.length} NODES)</span>
                    </span>

                    {/* 6-Zone Color Ramp Legend */}
                    <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                      <span className="text-slate-400 font-semibold text-[10px]">
                        {displayMode === 'conductor_60287' ? 'Calculated Tc,60287:' : 'Reading Tf:'}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8]" />
                          <span className="text-sky-300">&lt;35°C Cool</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                          <span className="text-emerald-300">35–45°C Normal</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#eab308]" />
                          <span className="text-yellow-300">45–55°C Monitoring</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#f97316]" />
                          <span className="text-orange-300">55–60°C Alert</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                          <span className="text-red-300 font-semibold">60–70°C Danger</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#991b1b] ring-1 ring-red-400/60" />
                          <span className="text-rose-400 font-bold">&gt;70°C Critical</span>
                        </span>
                      </div>
                    </div>

                    {/* Node Type Symbols */}
                    <div className="flex items-center gap-2.5 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800 text-[10px]">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white/40" />
                        <span>Normal Node</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-amber-500 ring-1 ring-white/40" />
                        <span className="text-amber-300 font-semibold">Special Section</span>
                      </span>
                    </div>
                  </div>

                  {/* Right: Quick Focus Map Region Buttons & Minimize Legend Button */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap items-center gap-1 bg-slate-950/90 p-1 rounded-lg border border-slate-800 text-[10px]">
                      <button
                        type="button"
                        onClick={handleFocusLandCable}
                        className="px-2 py-0.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 font-semibold cursor-pointer"
                        title="Zoom into Mainland Khanom land cable section"
                      >
                        Khanom Land
                      </button>
                      <button
                        type="button"
                        onClick={handleFocusSubmarineCorridor}
                        className="px-2 py-0.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 font-semibold cursor-pointer"
                        title="Zoom into Gulf of Thailand subsea route"
                      >
                        Gulf of Thailand
                      </button>
                      <button
                        type="button"
                        onClick={handleFocusSamuiLandfall}
                        className="px-2 py-0.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 font-semibold cursor-pointer"
                        title="Zoom into Koh Samui landfall approach"
                      >
                        Samui Landfall
                      </button>
                      <button
                        type="button"
                        onClick={handleFitEntireRoute}
                        className="px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                        title="Reset view to fit entire 53.5 km route"
                      >
                        Fit Route
                      </button>
                    </div>

                    {/* Button to Minimize / Hide Legend Detail */}
                    <button
                      type="button"
                      onClick={() => setIsLegendMinimized(true)}
                      className="px-2.5 py-1 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 text-[10px] font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="Hide/Minimize legend detail to free up space"
                    >
                      <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                      <span>Hide Legend Detail</span>
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>

                {/* Row 2: Pinned Land Cable Phase A / B / C & Submarine Cable Legend Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-300 font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>Cable Phase &amp; Peak Legend:</span>
                    </span>

                    {landPhaseLegendStats.map((ph) => {
                      const isSelectedPhase = currentPhaseFilter === ph.filterValue;
                      return (
                        <button
                          key={ph.phaseKey}
                          type="button"
                          onClick={() => handlePhaseChange(isSelectedPhase ? 'all' : ph.filterValue)}
                          className={`px-2.5 py-1 rounded-lg border transition-all flex items-center gap-2 cursor-pointer ${
                            isSelectedPhase
                              ? 'bg-slate-800 border-white text-white shadow-xs ring-1 ring-white/40'
                              : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-200'
                          }`}
                          title={`Click to isolate ${ph.label} (${ph.channelLabel}) • ${ph.trackDesc}`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 shrink-0"
                            style={{ borderColor: ph.color }}
                          />
                          <span className="font-bold text-[10.5px]">{ph.label}</span>
                          <span
                            className="text-[9px] font-mono px-1 py-0.2 rounded text-white font-extrabold"
                            style={{ backgroundColor: ph.color }}
                          >
                            {ph.channelLabel}
                          </span>
                          <span className="font-mono text-[10px] font-extrabold text-amber-300">
                            {ph.maxMetric.toFixed(1)}°C
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono hidden sm:inline">
                            ({ph.hottestPos})
                          </span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() =>
                        handlePhaseChange(currentPhaseFilter === 'Submarine Cable' ? 'all' : 'Submarine Cable')
                      }
                      className={`px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer ${
                        currentPhaseFilter === 'Submarine Cable'
                          ? 'bg-teal-950 border-teal-400 text-teal-200 ring-1 ring-teal-400/40'
                          : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-cyan-300'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#06b6d4]" />
                      <span className="font-bold text-[10.5px]">Submarine (CH 3)</span>
                      <span className="text-[9px] text-slate-400 font-mono">81 pts</span>
                    </button>
                  </div>

                  {currentPhaseFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => handlePhaseChange('all')}
                      className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-blue-600/90 hover:bg-blue-500 text-white transition-colors cursor-pointer"
                    >
                      Show All Phases
                    </button>
                  )}
                </div>

                {/* Row 3: Pinned Landmark & Special Section Pins Legend (Moved to Top Border — Zero Map Overlay) */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-emerald-400 font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1 mr-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Pinned Special Section Pins:</span>
                    </span>
                    {[
                      { badge: 'SWY (0m)', detail: 'Sec 1.1 Riserpole', lat: 9.233223, lng: 99.859099, dof: 2020.94, color: '#ef4444' },
                      { badge: 'JP1 (475m)', detail: 'Joint Pit 1', lat: 9.234430, lng: 99.856651, dof: 2486.50, color: '#f59e0b' },
                      { badge: 'JP2 (955m)', detail: 'Joint Pit 2', lat: 9.238423, lng: 99.859666, dof: 2950.00, color: '#f59e0b' },
                      { badge: 'TJ1 (1.46km)', detail: 'Shore Landing', lat: 9.241058, lng: 99.862550, dof: 2691.75, color: '#10b981' },
                      { badge: 'XPWA (15.1km)', detail: 'Water Pipeline Crossing', lat: 9.351386, lng: 99.867757, dof: 15139.20, color: '#0284c7' },
                      { badge: 'Joint NX (35.2km)', detail: 'Nexans Subsea Joint', lat: 9.532998, lng: 99.891797, dof: 35198.87, color: '#a855f7' },
                      { badge: 'Joint FR (36.3km)', detail: 'Furukawa Subsea Joint', lat: 9.540556, lng: 99.892500, dof: 36309.67, color: '#ec4899' },
                      { badge: '33kV Crossing (51.3km)', detail: 'Pha Ngan Crossing (IEC Estimation)', lat: 9.594609, lng: 99.998328, dof: 51305.42, color: '#f59e0b' },
                      { badge: 'Samui TJ2 (54.9km)', detail: 'Samui Landfall', lat: 9.569008, lng: 100.004530, dof: 54931.84, color: '#10b981' },
                    ].map((pin) => {
                      const isPinSelected = selectedLocation !== null && Math.abs(selectedLocation - pin.dof) < 0.5;
                      return (
                        <button
                          key={pin.badge}
                          type="button"
                          onClick={() => {
                            onSelectLocation(pin.dof);
                            mapRef.current?.flyTo([pin.lat, pin.lng], 15, { duration: 0.8 });
                          }}
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                            isPinSelected
                              ? 'bg-slate-800 text-white border-white ring-1 ring-white/40'
                              : 'bg-slate-950/90 hover:bg-slate-800 text-slate-200 border-slate-800'
                          }`}
                          title={`${pin.badge} — ${pin.detail} (Click to zoom to pin)`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0 border border-white/60"
                            style={{ backgroundColor: pin.color }}
                          />
                          <span>{pin.badge}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowMapPinCallouts(!showMapPinCallouts)}
                    className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer shrink-0 ${
                      showMapPinCallouts
                        ? 'bg-amber-500/20 text-amber-300 border-amber-400/60'
                        : 'bg-slate-950/80 text-slate-400 hover:text-white border-slate-800'
                    }`}
                    title="Toggle floating callout banners on map canvas"
                  >
                    {showMapPinCallouts ? 'Hide Map Callouts' : 'Show Map Callouts'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Map Viewport Wrapper */}
          <div className="relative w-full">
            {/* Compact Zoom + / - Buttons on Top-Right Corner of Map */}
            <div className="absolute top-3 right-3 z-20 flex flex-col bg-slate-900/85 backdrop-blur-xs rounded-xl border border-white/15 overflow-hidden shadow-lg">
              <button
                type="button"
                onClick={() => mapRef.current?.zoomIn()}
                className="p-2 text-slate-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer border-b border-white/10"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => mapRef.current?.zoomOut()}
                className="p-2 text-slate-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer border-b border-white/10"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleFitEntireRoute}
                className="p-2 text-slate-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Reset View"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Leaflet Map Canvas Div */}
            <div
              ref={mapContainerRef}
              className={`w-full ${isFullscreen ? 'h-[82vh]' : 'h-[660px] xl:h-[720px]'} relative outline-none bg-slate-950`}
              tabIndex={0}
              style={{ touchAction: 'none' }}
            />
          </div>
        </div>

        {/* Right Inspector & Node Details Drawer (4 cols) */}
        <div className="lg:col-span-4 flex flex-col space-y-3">
          {/* Active Point Card */}
          {activeInspectPoint ? (
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 pb-2.5">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-3 h-3 shadow-sm ${activeInspectPoint.sectionType === 'special' ? 'rotate-45 rounded-2xs' : 'rounded-full'}`}
                      style={{ backgroundColor: getColorForPoint(activeInspectPoint) }}
                    />
                    <h4 className="text-sm font-bold text-slate-900 tracking-tight">
                      {activeInspectPoint.pos}
                    </h4>
                  </div>
                  <p className="text-xs font-semibold text-slate-600 mt-0.5">
                    {activeInspectPoint.sectionName}
                  </p>
                </div>

                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  activeInspectPoint.sectionType === 'special'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}>
                  {activeInspectPoint.sectionType === 'special' ? 'Special Section' : 'Normal Section'}
                </span>
              </div>

              {/* Point Coordinates & Positions Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 block">DTS Sensing Distance (DOF)</span>
                  <span className="font-mono font-bold text-blue-700 text-xs">
                    {activeInspectPoint.dof.toFixed(2)} m
                  </span>
                  <span className="text-[10px] text-teal-600 block mt-0.5">(.TEPR file reading)</span>
                </div>

                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 block">As-Built Distance (DAB)</span>
                  <span className="font-mono font-bold text-slate-800 text-xs">
                    {activeInspectPoint.dab !== null ? `${activeInspectPoint.dab.toFixed(2)} m` : 'N/A (Switchyard)'}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Physical cable marker</span>
                </div>

                <div className="bg-white p-2.5 rounded-xl border border-slate-200 col-span-2">
                  <span className="text-[10px] text-slate-400 block">Exact WGS84 GPS Coordinates</span>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono font-bold text-slate-800 text-xs">
                      {activeInspectPoint.latitude.toFixed(6)}°N, {activeInspectPoint.longitude.toFixed(6)}°E
                    </span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(`${activeInspectPoint.latitude}, ${activeInspectPoint.longitude}`)}
                      className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      Copy GPS
                    </button>
                  </div>
                </div>
              </div>

              {/* Temperature & IEC 60287 Conductor Estimation Box */}
              <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs pb-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Evaluation Window:</span>
                  <span className="font-bold text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {currentHourFilter === 'all'
                      ? 'Daily Maximum (24h Peak)'
                      : `Hourly Maximum (${currentHourFilter}:00 - ${currentHourFilter}:59)`}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">
                    Reading Fiber Optic Temp (Tf):
                  </span>
                  <span className="font-mono font-bold text-sm text-blue-700">
                    {activeInspectPoint.currentAbsoluteTemp.toFixed(2)} °C
                  </span>
                </div>

                {/* Estimated Conductor Temperature (IEC 60287 Method) Block */}
                {activeInspectPoint.hasPowerData && activeInspectPoint.estimatedConductorTemp60287 !== null ? (
                  <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200/80 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-rose-900">
                        Est. Conductor Temp (Tc,60287):
                      </span>
                      <span className="font-mono font-extrabold text-rose-600 text-sm">
                        {activeInspectPoint.estimatedConductorTemp60287.toFixed(2)} °C
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-rose-800">
                      <span className="font-semibold">Thermal Estimation:</span>
                      <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-rose-200">
                        IEC Estimation
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-600 pt-1 border-t border-rose-200/50 font-mono">
                      <span>1h Max P (Ckt #3): {activeInspectPoint.power115kVCkt3MW?.toFixed(2)} MW</span>
                      <span>Period: {activeInspectPoint.matchedPowerTimestamp || 'Peak'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>No Power Data for Date — Showing Reading Fiber Temp (Tf) only.</span>
                  </div>
                )}

                {activeInspectPoint.peakTime && (
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                    <span className="text-slate-500 font-medium">Peak Recorded at:</span>
                    <span className="font-mono font-bold text-blue-700 text-[11px]">
                      {activeInspectPoint.peakTime}
                    </span>
                  </div>
                )}
              </div>

              {/* Quick Jump Action */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onSelectLocation(activeInspectPoint.dof);
                    mapRef.current?.flyTo([activeInspectPoint.latitude, activeInspectPoint.longitude], 15, { duration: 0.8 });
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>Zoom To Node on Satellite Map</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 text-center text-slate-400 space-y-2">
              <Compass className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-xs">Hover or click any node on the satellite map to inspect its GPS coordinates, DAB/DOF distances, and T4 constant parameter.</p>
            </div>
          )}

          {/* Section Directory Mini Table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
              <span className="font-bold text-slate-800">Sections Directory (Circuit #3)</span>
              <span className="text-slate-400 font-mono text-[10px]">19 Total Sections</span>
            </div>

            <div className="max-h-[190px] overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-50 custom-scrollbar">
              {CIRCUIT_3_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    setSelectedSectionId(sec.id);
                    setCategoryFilter(sec.category);
                    const firstPt = enrichedPoints.find((p) => p.sectionId === sec.id);
                    if (firstPt) {
                      onSelectLocation(firstPt.dof);
                      setHoveredPoint(firstPt);
                      mapRef.current?.flyTo([firstPt.latitude, firstPt.longitude], 14, { duration: 0.8 });
                    }
                  }}
                  className={`w-full text-left p-1.5 rounded-lg text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                    selectedSectionId === sec.id ? 'bg-blue-50 text-blue-800 font-bold' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="truncate pr-2">
                    <span className="text-slate-400 font-mono text-[10px] mr-1.5">Sec {sec.id}</span>
                    <span className="truncate">{sec.name}</span>
                  </div>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm shrink-0 ${
                    sec.type === 'special' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {sec.type === 'special' ? 'Special' : 'Normal'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Synchronized Linear Distance Heatmap Ribbon (0 to 55,000 m) */}
      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-blue-600" />
            <span>Linear Route Distance Heat Ribbon (0m to 55,000m)</span>
          </span>
          <span className="text-[11px] text-slate-400">
            Click any point on ribbon to navigate and inspect on satellite map
          </span>
        </div>

        {/* Ribbon Bar */}
        <div className="relative h-6 bg-slate-900 rounded-lg overflow-hidden flex items-center border border-slate-700">
          {enrichedPoints.map((pt) => {
            const pct = Math.min(Math.max((pt.dof / 55029.85) * 100, 0), 100);
            const color = getColorForPoint(pt);
            const isSelected = selectedLocation !== null && Math.abs(pt.dof - selectedLocation) < 0.1;

            return (
              <div
                key={pt.id}
                onClick={() => {
                  onSelectLocation(pt.dof);
                  mapRef.current?.flyTo([pt.latitude, pt.longitude], 14, { duration: 0.8 });
                }}
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
                className={`absolute top-0 bottom-0 cursor-pointer transition-all ${
                  isSelected ? 'z-20 w-2.5 -ml-1.5 bg-white border-2 border-blue-500 shadow-md' : 'w-1.5 -ml-0.75 opacity-90 hover:opacity-100 hover:w-2'
                }`}
                style={{
                  left: `${pct}%`,
                  backgroundColor: isSelected ? '#ffffff' : color,
                }}
                title={`${pt.pos}${pt.phase ? ` (Phase ${pt.phase})` : ''}: ${pt.currentAbsoluteTemp.toFixed(2)}°C (${pt.dof}m)`}
              />
            );
          })}
        </div>

        {/* Ribbon Axis Labels */}
        <div className="flex justify-between text-[10px] text-slate-400 font-mono pt-0.5">
          <span>0m (Khanom SWY)</span>
          <span>1,460m (TJ1 Shore)</span>
          <span>15,204m (XPWA Water Crossing)</span>
          <span>35,133m (Nexans Joint)</span>
          <span>51,370m (33kV Crossing)</span>
          <span>55,029m (Samui TJ2)</span>
        </div>
      </div>

      {/* Modal: Comprehensive IEC 60287 Conductor Temperature Registry Table */}
      {showRegistryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Circuit #3 - IEC Estimation Conductor Temperature Registry
                </h3>
                <p className="text-xs text-slate-500">
                  Full reference specification of {enrichedPoints.length} sensing positions (38 Land/phase + 81 Submarine), GPS coordinates, DAB/DOF mappings, Reading Fiber Temp (Tf), and Estimated Conductor Temp (Tc,60287).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegistryModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Table Search & Filter Bar */}
            <div className="p-3 bg-white border-b border-slate-100 flex items-center gap-3">
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search by POS (e.g. XPWA, JP1, FR1), Section, or Distance..."
                className="w-full max-w-md px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-400">
                Showing {filteredPoints.length} of {enrichedPoints.length} points
              </span>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50/50">
                    <th className="p-2">POS</th>
                    <th className="p-2">Section Name</th>
                    <th className="p-2">Type</th>
                    <th className="p-2 text-right">DAB (m)</th>
                    <th className="p-2 text-right">DOF (.TEPR)</th>
                    <th className="p-2 text-center font-bold text-violet-700">IEC Estimation</th>
                    <th className="p-2 text-right font-bold text-blue-700">Reading Fiber Tf (°C)</th>
                    <th className="p-2 text-right font-bold text-rose-700">Est. Conductor Tc,60287 (°C)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPoints.map((pt) => (
                    <tr 
                      key={pt.id}
                      onClick={() => {
                        onSelectLocation(pt.dof);
                        setShowRegistryModal(false);
                        mapRef.current?.flyTo([pt.latitude, pt.longitude], 15, { duration: 0.8 });
                      }}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="p-2 font-bold text-slate-800">
                        {pt.pos}
                        {pt.phase && (
                          <span className={`ml-1.5 text-[9px] font-semibold px-1.5 py-0.2 rounded ${
                            pt.phase === 'A' ? 'bg-red-100 text-red-700' :
                            pt.phase === 'B' ? 'bg-amber-100 text-amber-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            Phase {pt.phase}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-slate-600 truncate max-w-[180px]">Sec {pt.sectionId}: {pt.sectionName}</td>
                      <td className="p-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          pt.sectionType === 'special' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {pt.sectionType}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono text-slate-600">
                        {pt.dab !== null ? pt.dab.toFixed(2) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-blue-700">
                        {pt.dof.toFixed(2)}
                      </td>
                      <td className="p-2 text-center font-mono font-bold text-violet-700">
                        IEC Estimation
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-blue-700">
                        {pt.currentAbsoluteTemp.toFixed(2)} °C
                      </td>
                      <td className="p-2 text-right font-mono font-extrabold text-rose-700 bg-rose-50/40">
                        {pt.hasPowerData && pt.estimatedConductorTemp60287 !== null ? `${pt.estimatedConductorTemp60287.toFixed(2)} °C` : 'No Power'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
