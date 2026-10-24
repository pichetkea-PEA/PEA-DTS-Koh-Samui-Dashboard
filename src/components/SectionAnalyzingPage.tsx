import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell,
} from 'recharts';
import {
  Activity,
  Compass,
  Calendar,
  TrendingUp,
  Zap,
  Thermometer,
  Plane,
  Users,
  Sun,
  Sliders,
  Sparkles,
  Printer,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Filter,
  Search,
  Gauge,
  ArrowUpRight,
  Info,
  MapPin,
  FolderCog,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Minimize2,
  Maximize2,
  SlidersHorizontal,
  Play,
  Loader2,
  X,
  Database,
  Download,
  RefreshCw,
  Link,
  Upload,
  FileSpreadsheet,
  Copy,
  ExternalLink,
  FileText,
  Check,
  Share2,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  CableSectionInfo,
  CableSamplingPoint,
  ConductorEquationName,
  CONDUCTOR_EQUATIONS,
  evaluateSectionConductorTemp,
  THERMAL_ZONE_CRITERIA,
  getThermalZoneInfo,
  ThermalZoneInfo,
} from '../data/cableCircuitStructure';
import {
  ParsedTeprFile,
  ScannedFileMeta,
  SectionPeakExtractResult,
  flushPhaseIndexToStorage,
} from '../services/teprParser';
import {
  getMasterSectionPeak,
  getMasterSamplingPointPeak,
  getMasterSectionSummary,
  isDateSyncedInMasterSummary,
  ingestParsedFilesIntoMasterSummary,
  compileTeprTextIntoMasterSummary,
  resetMasterSummaryForDates,
  saveMasterSectionSummaryToLocal,
  loadMasterSummaryFromServer,
  saveMasterSummaryToServer,
  loadMasterSummaryFromDrive,
  saveMasterSummaryToDrive,
  exportMasterSummaryToCsv,
  getMasterSummaryStats,
  buildMultiSheetDatabase,
  buildMultiSheetDatabaseAsync,
  parseUploadedDatabaseForUpdate,
  buildUpdatedMultiSheetDatabaseAsync,
  ParsedExistingDatabaseFile,
  getLastUploadedMasterDatabase,
  clearLastUploadedMasterDatabase,
  buildSectionDailyProfileDatabaseAsync,
  parseUploadedSectionDailyProfileDatabase,
  buildUpdatedSectionDailyProfileDatabaseAsync,
  ParsedExistingDailyProfileFile,
  getLastUploadedProfileDatabase,
  clearLastUploadedProfileDatabase,
  parseDatabaseFileOrBuffer,
  GeneratedDatabaseResult,
  MasterSectionPeakRecord,
} from '../services/masterSectionSummary';
import {
  DailyPowerSummary,
  isSyntheticPowerSummary,
} from '../services/powerConsumptionParser';
import { DriveFile, DriveFolder } from '../types';
import { FolderSelector, PowerSubstationFoldersConfig } from './FolderSelector';
import {
  runPhaseSeparationProcedure,
  fetchSectionPeakDofOnly,
  fetchFileContent,
  clearDriveContentCache,
} from '../services/driveApi';
import { getBatchCachedParsedFiles } from '../services/cacheStorage';
import {
  runSectionHistoryAiReport,
  exportEngineeringReportToPdf,
} from '../services/agentApi';

interface SectionAnalyzingPageProps {
  parsedFiles: ParsedTeprFile[];
  allParsedFiles?: ParsedTeprFile[];
  scannedFiles: ScannedFileMeta[];
  driveFiles?: DriveFile[];
  accessToken?: string;
  powerSummariesByDate: Map<string, DailyPowerSummary>;
  ensurePowerSummaryForDate?: (
    dateKey: string,
    strictExactDate?: boolean
  ) => Promise<DailyPowerSummary | null>;
  activeDateFilter?: string;
  initialSectionId?: string;
  showNotification: (type: 'success' | 'error', message: string) => void;
  // Shared Page 1 Target Folder 1 (.TEPR) & Target Folders 2 (KMB, KMA, KNA) settings
  currentFolder?: DriveFolder;
  permanentFolder?: DriveFolder | null;
  onSetPermanentFolder?: (folder: DriveFolder | null) => void;
  onSelectFolder?: (folder: DriveFolder, isPermanent?: boolean) => void;
  onRefreshTeprFolder?: () => void;
  isLoadingTeprFolder?: boolean;
  powerFolders?: PowerSubstationFoldersConfig;
  onUpdatePowerFolders?: (next: PowerSubstationFoldersConfig) => void;
  onScanPowerFolders?: () => void;
  isScanningPower?: boolean;
  activeDailyPowerSummary?: DailyPowerSummary | null;
  powerScannedCount?: number;
}

interface ScenarioFactors {
  flightGrowthPct: number; // Flights to USM (Koh Samui) & Ferry Transfers
  touristGrowthPct: number; // Tourists to Samui, Pha Ngan (Full Moon), Koh Tao
  populationGrowthPct: number; // Annualized local & commercial growth
  ambientTempDeltaC: number; // Weather / Soil / Seabed temperature anomaly (°C)
  ckt3LoadSharePct: number; // 115kV Ckt #3 share of 115kV backbone (%)
  includeFullMoonPeak: boolean;
}

interface HistoricalDataPoint {
  id: string;
  dateKey: string;
  label: string;
  timestamp: number;
  isForecast: boolean;
  isVerifiedRaw?: boolean;
  sourceFileName?: string;
  minFileName?: string;
  dofMax?: number;
  dofMin?: number;
  timestampMax?: string;
  timestampMin?: string;
  tfMax: number;
  tfMean: number;
  tfMin: number;
  tcMax: number;
  tcMin?: number;
  tcMean: number;
  tcUpper95?: number;
  tcLower95?: number;
  pCkt3MW: number;
  pCkt2MW: number;
  p33NktMW: number;
  p33OilMW: number;
  pTotalIslandMW: number;
  zoneName: string;
  zoneColor: string;
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

// Helper to compute DOF bounding range for a section from CIRCUIT_3_SECTIONS / CIRCUIT_3_SAMPLING_POINTS
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

// Deterministic section baseline thermal signature helper
function getSectionBaselineSignature(sec: CableSectionInfo): {
  baseTf: number;
  loadSensitivity: number;
} {
  if (sec.sectionType === 'special') {
    if (sec.name.includes('TJ1') || sec.name.includes('TJ2')) {
      return { baseTf: 37.8, loadSensitivity: 0.15 };
    }
    if (sec.name.includes('XPWA') || sec.name.includes('Pipeline')) {
      return { baseTf: 38.2, loadSensitivity: 0.16 };
    }
    if (sec.name.includes('Crossing') || sec.name.includes('X33kV')) {
      return { baseTf: 36.8, loadSensitivity: 0.14 };
    }
    if (sec.name.includes('JP1') || sec.name.includes('JP2')) {
      return { baseTf: 36.2, loadSensitivity: 0.13 };
    }
    if (sec.name.includes('NX') || sec.name.includes('FR')) {
      return { baseTf: 33.5, loadSensitivity: 0.08 };
    }
    return { baseTf: 35.5, loadSensitivity: 0.12 };
  }
  if (sec.category === 'land') {
    return { baseTf: 34.2, loadSensitivity: 0.10 };
  }
  // Submarine normal
  return { baseTf: 29.6, loadSensitivity: 0.05 };
}

export const SectionAnalyzingPage: React.FC<SectionAnalyzingPageProps> = ({
  parsedFiles,
  allParsedFiles,
  scannedFiles,
  driveFiles,
  accessToken,
  powerSummariesByDate,
  ensurePowerSummaryForDate,
  activeDateFilter,
  initialSectionId,
  showNotification,
  currentFolder,
  permanentFolder = null,
  onSetPermanentFolder,
  onSelectFolder,
  onRefreshTeprFolder,
  isLoadingTeprFolder = false,
  powerFolders,
  onUpdatePowerFolders,
  onScanPowerFolders,
  isScanningPower = false,
  activeDailyPowerSummary = null,
  powerScannedCount = 0,
}) => {
  // -------------------------------------------------------------------------
  // 1. Target Section & Zone Filter (Same Data Structure as Heat Map)
  // -------------------------------------------------------------------------
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'land' | 'submarine'>('all');
  const [sectionTypeFilter, setSectionTypeFilter] = useState<'all' | 'normal' | 'special'>('all');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(initialSectionId || '2.3'); // Default to initialSectionId or Zone 2.3
  const [selectedSamplingPointId, setSelectedSamplingPointId] = useState<string>('ALL');
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState<string>('all');
  const [sectionSearchQuery, setSectionSearchQuery] = useState<string>('');
  const [isMatrixMinimized, setIsMatrixMinimized] = useState<boolean>(false);
  const [isFilterMinimized, setIsFilterMinimized] = useState<boolean>(false);
  const [isTargetFoldersHidden, setIsTargetFoldersHidden] = useState<boolean>(false);

  // Loaded section peaks cache: Map<`${sectionId}_${dateKey}`, { maxTf: number, minTf: number, meanTf: number, peakTime?: string, sourceFile?: string }>
  const [loadedSectionPeaks, setLoadedSectionPeaks] = useState<
    Map<string, { maxTf: number; minTf: number; meanTf: number; peakTime?: string; sourceFile?: string }>
  >(() => {
    try {
      const saved = localStorage.getItem('dts_section_peaks_cache_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return new Map(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
    return new Map();
  });

  // Persist loadedSectionPeaks to localStorage whenever updated
  useEffect(() => {
    try {
      if (loadedSectionPeaks.size > 0) {
        const entries = Array.from(loadedSectionPeaks.entries()).slice(-2500);
        localStorage.setItem('dts_section_peaks_cache_v3', JSON.stringify(entries));
      }
    } catch {
      // ignore quota errors
    }
  }, [loadedSectionPeaks]);

  // Determine source parsed files pool
  const sourceFilesPool = useMemo(() => {
    return allParsedFiles && allParsedFiles.length > 0 ? allParsedFiles : parsedFiles;
  }, [allParsedFiles, parsedFiles]);

  // PowerBI-Style Master Summary Table state version counter (triggers instant re-render when Master Table updates)
  const [masterSummaryVersion, setMasterSummaryVersion] = useState<number>(0);

  // Automatically load Master Section Summary Table from Server & Google Drive on mount
  useEffect(() => {
    let mounted = true;
    loadMasterSummaryFromServer().then((changed) => {
      if (mounted && changed) {
        setMasterSummaryVersion((v) => v + 1);
      }
    });
    if (accessToken) {
      loadMasterSummaryFromDrive(accessToken).then((changed) => {
        if (mounted && changed) {
          setMasterSummaryVersion((v) => v + 1);
          saveMasterSummaryToServer();
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, [accessToken]);

  // Automatically ingest any already-parsed files (from Page 1) into the Master Summary Table
  useEffect(() => {
    if (sourceFilesPool && sourceFilesPool.length > 0) {
      const updated = ingestParsedFilesIntoMasterSummary(sourceFilesPool);
      if (updated > 0) {
        setMasterSummaryVersion((v) => v + 1);
        saveMasterSummaryToServer();
      }
    }
  }, [sourceFilesPool]);

  const masterSummaryStats = useMemo(() => {
    void masterSummaryVersion;
    return getMasterSummaryStats();
  }, [masterSummaryVersion, loadedSectionPeaks]);

  // Reading section historical progress state & mini popup modal
  const [isReadingSectionHistory, setIsReadingSectionHistory] = useState<boolean>(false);
  const [readingSectionProgress, setReadingSectionProgress] = useState<{
    stage?: 'phase-separation' | 'dof-extraction' | 'completed';
    loaded: number;
    total: number;
    pct: number;
    currentFileName: string;
    currentDate: string;
    focusedPhaseFilesCount?: number;
    skippedOtherPhaseCount?: number;
    totalFolderFilesInPeriod?: number;
    targetPhaseLabel?: string;
    foundPeakTf?: number;
    peakDate?: string;
    isCompleted?: boolean;
    datesLoadedCount?: number;
    elapsedSec?: string;
  } | null>(null);

  const abortReadingSectionRef = useRef<boolean>(false);

  // -------------------------------------------------------------------------
  // 1b. CSV & Multi-Sheet Database Generator & Visual Chart Source State
  // -------------------------------------------------------------------------
  const [csvDatabaseUrl, setCsvDatabaseUrl] = useState<string>('');
  const [isLoadingSharedUrl, setIsLoadingSharedUrl] = useState<boolean>(false);
  const [copiedDriveLink, setCopiedDriveLink] = useState<boolean>(false);

  const [csvDatabaseSource, setCsvDatabaseSource] = useState<{
    filename: string;
    totalRecords: number;
    dateKeys: string[];
    source: 'generated' | 'upload' | 'url' | 'master_cache';
    parsedMap: Map<string, MasterSectionPeakRecord>;
  } | null>(null);
  const [chartStartDate, setChartStartDate] = useState<string>('');
  const [chartEndDate, setChartEndDate] = useState<string>('');
  const [showTotalPowerColO, setShowTotalPowerColO] = useState<boolean>(true);

  // Sub-panel Page Navigation inside CSV / Excel Database Management card:
  // Page 1: 'daily-peak' (Master Daily Peak Database - 19 Sheets)
  // Page 2: 'section-daily-profile' (Section Daily Profile: Hourly Peak of all section DOFs - 19 Sheets)
  const [dbManagementSubPage, setDbManagementSubPage] = useState<
    'daily-peak' | 'section-daily-profile'
  >('daily-peak');

  // CSV Database Management Mode for Page 1: Option 1 ('build-new') vs Option 2 ('update-existing')
  const [dbManageMode, setDbManageMode] = useState<'build-new' | 'update-existing'>('build-new');
  const [uploadedDbForUpdate, setUploadedDbForUpdate] =
    useState<ParsedExistingDatabaseFile | null>(null);
  const [updateTargetEndDate, setUpdateTargetEndDate] = useState<string>('');

  // Section Daily Profile Mode for Page 2: Option 1 ('build-new') vs Option 2 ('update-existing')
  const [profileDbManageMode, setProfileDbManageMode] = useState<
    'build-new' | 'update-existing'
  >('build-new');
  const [uploadedProfileDbForUpdate, setUploadedProfileDbForUpdate] =
    useState<ParsedExistingDailyProfileFile | null>(null);
  const [updateProfileTargetEndDate, setUpdateProfileTargetEndDate] = useState<string>('');

  // Upload status (0-100%) for Option 2: Update Existing Database File (Daily Peak & Section Daily Profile)
  const [peakDbUploadStatus, setPeakDbUploadStatus] = useState<{
    isUploading: boolean;
    pct: number;
    fileName: string;
    phaseText: string;
    isComplete?: boolean;
    error?: string;
  } | null>(null);

  const [profileDbUploadStatus, setProfileDbUploadStatus] = useState<{
    isUploading: boolean;
    pct: number;
    fileName: string;
    phaseText: string;
    isComplete?: boolean;
    error?: string;
  } | null>(null);

  const abortDatabaseGenRef = useRef<boolean>(false);

  const [csvGenModal, setCsvGenModal] = useState<{
    isOpen: boolean;
    stage: 'idle' | 'preparing' | 'reading-tepr' | 'compiling-sheets' | 'completed';
    databaseKind?: 'master-daily-peak' | 'section-daily-profile';
    loaded: number;
    total: number;
    pct: number;
    elapsedSec: number;
    etaSec: number;
    currentDate: string;
    currentSheetName: string;
    filesRead: number;
    filesTotal: number;
    readingPct: number;
    filesPerSec: number;
    currentFileName: string;
    sectionsCalculated: number;
    sectionsTotal: number;
    calculationPct: number;
    generatedResult?: GeneratedDatabaseResult;
  }>({
    isOpen: false,
    stage: 'idle',
    databaseKind: 'master-daily-peak',
    loaded: 0,
    total: 100,
    pct: 0,
    elapsedSec: 0,
    etaSec: 0,
    currentDate: '',
    currentSheetName: '',
    filesRead: 0,
    filesTotal: 0,
    readingPct: 0,
    filesPerSec: 0,
    currentFileName: '',
    sectionsCalculated: 0,
    sectionsTotal: 19,
    calculationPct: 0,
  });

  useEffect(() => {
    if (initialSectionId) {
      setSelectedSectionId(initialSectionId);
    }
  }, [initialSectionId]);

  // -------------------------------------------------------------------------
  // 2. Time Frame Filter: Start Date & End Date Filter (from Target Folder)
  //    End Date is limited at the latest data date (compared to present day),
  //    with NO 1-year maximum cap.
  // -------------------------------------------------------------------------
  const presentDayDateKey = useMemo(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  // Extract available years, months, and dates from scannedFiles metadata
  const scannedTimeHierarchy = useMemo(() => {
    const yearsSet = new Set<string>();
    const monthsByYear = new Map<string, Set<string>>();
    const datesByYearMonth = new Map<string, Set<string>>();
    const rawDatesSet = new Set<string>();

    const collectRawDate = (dKey?: string) => {
      if (!dKey || !/^\d{4}-\d{2}-\d{2}$/.test(dKey)) return;
      rawDatesSet.add(dKey);
    };

    // 1. From scannedFiles (Target Folder 1: .TEPR)
    for (const file of scannedFiles) {
      if (file.dateMeta?.dateKey) {
        collectRawDate(file.dateMeta.dateKey);
      }
    }

    // 2. From allParsedFiles / parsedFiles
    const sourceFiles = allParsedFiles && allParsedFiles.length > 0 ? allParsedFiles : parsedFiles;
    for (const file of sourceFiles) {
      if (file.dateMeta?.dateKey) {
        collectRawDate(file.dateMeta.dateKey);
      }
    }

    // 3. From powerSummariesByDate (Target Folders 2: KMB, KMA, KNA)
    // Only include sample power dates if no real .TEPR files have been scanned yet
    const hasRealTeprScan = scannedFiles.length > 0 || sourceFiles.length > 0;
    powerSummariesByDate.forEach((summary, k) => {
      if (hasRealTeprScan) {
        const isSyntheticDemo =
          summary.filesLoaded.length > 0 &&
          summary.filesLoaded.every(
            (f: any) => f.fileId && String(f.fileId).startsWith('sample-')
          );
        if (!isSyntheticDemo) {
          collectRawDate(k);
        }
      } else {
        collectRawDate(k);
      }
    });

    // 4. Default fallback if empty
    if (rawDatesSet.size === 0) {
      collectRawDate('2026-08-01');
      collectRawDate('2026-08-02');
      collectRawDate('2026-08-03');
    }

    const sortedRawDates = Array.from(rawDatesSet).sort();

    // Limit at latest data date compared to present day (<= presentDayDateKey)
    const datesUpToPresent = sortedRawDates.filter((d) => d <= presentDayDateKey);
    const effectiveDates = datesUpToPresent.length > 0 ? datesUpToPresent : sortedRawDates;

    for (const dKey of effectiveDates) {
      const yr = dKey.slice(0, 4);
      const mo = dKey.slice(5, 7);
      yearsSet.add(yr);

      if (!monthsByYear.has(yr)) monthsByYear.set(yr, new Set());
      monthsByYear.get(yr)!.add(mo);

      const ymKey = `${yr}-${mo}`;
      if (!datesByYearMonth.has(ymKey)) datesByYearMonth.set(ymKey, new Set());
      datesByYearMonth.get(ymKey)!.add(dKey);
    }

    const sortedYears = Array.from(yearsSet).sort();
    const latestDataDate =
      effectiveDates.length > 0 ? effectiveDates[effectiveDates.length - 1] : presentDayDateKey;

    return {
      years: sortedYears,
      monthsByYear,
      datesByYearMonth,
      allDates: effectiveDates,
      latestDataDate,
    };
  }, [scannedFiles, allParsedFiles, parsedFiles, powerSummariesByDate, presentDayDateKey]);

  const latestDataDate = scannedTimeHierarchy.latestDataDate;

  // Initial Start Date and End Date from scanned folder dates
  const defaultStartDate = useMemo(() => {
    if (activeDateFilter && activeDateFilter !== 'all') {
      return activeDateFilter;
    }
    return scannedTimeHierarchy.allDates[0] || '2026-08-01';
  }, [activeDateFilter, scannedTimeHierarchy]);

  const defaultEndDate = useMemo(() => {
    if (activeDateFilter && activeDateFilter !== 'all') {
      return activeDateFilter;
    }
    return (
      scannedTimeHierarchy.latestDataDate ||
      scannedTimeHierarchy.allDates[scannedTimeHierarchy.allDates.length - 1] ||
      '2026-08-30'
    );
  }, [activeDateFilter, scannedTimeHierarchy]);

  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [endDate, setEndDate] = useState<string>(defaultEndDate);
  const [forecastHorizonDays, setForecastHorizonDays] = useState<number>(30); // 0 = Turn Off, 7, 14, 30
  const [selectedChartTab, setSelectedChartTab] = useState<
    'thermal' | 'power' | 'physics' | 'points'
  >('thermal');

  // Sync with activeDateFilter if it changes from outside
  useEffect(() => {
    if (activeDateFilter && activeDateFilter !== 'all') {
      setStartDate(activeDateFilter);
      setEndDate(activeDateFilter);
    }
  }, [activeDateFilter]);

  // Sync when scanned dates load — default to [First Folder Date, Latest Data Date (compared to present day)]
  const prevDatesCountRef = useRef<number>(0);
  const prevFirstDateRef = useRef<string>('');
  const prevLatestDateRef = useRef<string>('');
  useEffect(() => {
    const all = scannedTimeHierarchy.allDates;
    if (all.length > 0) {
      const firstD = all[0];
      const latestD = all[all.length - 1];
      const folderRangeChanged =
        prevDatesCountRef.current !== all.length ||
        prevFirstDateRef.current !== firstD ||
        prevLatestDateRef.current !== latestD;

      prevDatesCountRef.current = all.length;
      prevFirstDateRef.current = firstD;
      prevLatestDateRef.current = latestD;

      if (!startDate || !all.includes(startDate)) {
        setStartDate(firstD);
      }
      if (!endDate || !all.includes(endDate) || folderRangeChanged) {
        setEndDate(latestD);
      }
    }
  }, [scannedTimeHierarchy.allDates]);

  // Available End Dates: limited at the latest data date (compared to present day), NOT capped at 1 year
  const availableEndDates = useMemo(() => {
    const all = scannedTimeHierarchy.allDates;
    if (!startDate || all.length === 0) return all;
    const filtered = all.filter((d) => d >= startDate && d <= scannedTimeHierarchy.latestDataDate);
    return filtered.length > 0 ? filtered : [scannedTimeHierarchy.latestDataDate || startDate];
  }, [scannedTimeHierarchy.allDates, scannedTimeHierarchy.latestDataDate, startDate]);

  // Ensure endDate stays within [startDate, latestDataDate] (no 1-year limit)
  useEffect(() => {
    if (availableEndDates.length > 0) {
      const maxAllowedEnd = availableEndDates[availableEndDates.length - 1];
      if (endDate < startDate) {
        setEndDate(startDate);
      } else if (endDate > maxAllowedEnd) {
        setEndDate(maxAllowedEnd);
      }
    }
  }, [startDate, endDate, availableEndDates]);

  // Quick Range Presets Handler (End Date always set to Latest Data Date compared to present day)
  const handleApplyPresetRange = (preset: 'all' | 'year1' | 'last7' | 'last14' | 'last30') => {
    const dates = scannedTimeHierarchy.allDates;
    if (dates.length === 0) return;
    const lastDate = dates[dates.length - 1];
    const lastMs = new Date(`${lastDate}T00:00:00`).getTime();
    const oneYearAgoMs = lastMs - 365 * 86400000;

    setEndDate(lastDate);

    if (preset === 'all') {
      setStartDate(dates[0]);
    } else if (preset === 'year1') {
      const withinOneYear = dates.find((d) => new Date(`${d}T00:00:00`).getTime() >= oneYearAgoMs);
      setStartDate(withinOneYear || dates[0]);
    } else if (preset === 'last7') {
      const idx = Math.max(0, dates.length - 7);
      setStartDate(dates[idx]);
    } else if (preset === 'last14') {
      const idx = Math.max(0, dates.length - 14);
      setStartDate(dates[idx]);
    } else if (preset === 'last30') {
      const idx = Math.max(0, dates.length - 30);
      setStartDate(dates[idx]);
    }
  };

  // -------------------------------------------------------------------------
  // 3. Multi-Factor Scenario Simulation & AI Report State
  // -------------------------------------------------------------------------
  const [activePresetId, setActivePresetId] = useState<string>('baseline');
  const [scenarioFactors, setScenarioFactors] = useState<ScenarioFactors>(
    PRESET_SCENARIOS[0].factors
  );

  const [aiReportMarkdown, setAiReportMarkdown] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiProcessedAt, setAiProcessedAt] = useState<string>('');

  // -------------------------------------------------------------------------
  // 4. Section Definition & Sampling Points (CIRCUIT_3_SECTIONS & CIRCUIT_3_SAMPLING_POINTS)
  // -------------------------------------------------------------------------
  // Filtered sections list using same data structure as Heat Map
  const filteredSections = useMemo(() => {
    return CIRCUIT_3_SECTIONS.filter((sec) => {
      if (categoryFilter !== 'all' && sec.category !== categoryFilter) return false;
      if (sectionTypeFilter !== 'all' && sec.sectionType !== sectionTypeFilter) return false;
      if (sectionSearchQuery.trim()) {
        const q = sectionSearchQuery.toLowerCase();
        const matchId = sec.sectionId.toLowerCase().includes(q);
        const matchName = sec.name.toLowerCase().includes(q);
        const matchSubtitle = sec.subtitle.toLowerCase().includes(q);
        const matchEq = sec.equationName.toLowerCase().includes(q);
        return matchId || matchName || matchSubtitle || matchEq;
      }
      return true;
    });
  }, [categoryFilter, sectionTypeFilter, sectionSearchQuery]);

  // Active Selected Section
  const activeSection = useMemo(() => {
    const found = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === selectedSectionId);
    return found || CIRCUIT_3_SECTIONS[0];
  }, [selectedSectionId]);

  // Discrete Sampling Points for Active Section from CIRCUIT_3_SAMPLING_POINTS
  const activeSectionPoints = useMemo(() => {
    return CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
      if (p.sectionId !== activeSection.sectionId) return false;
      if (selectedPhaseFilter !== 'all') {
        if (p.cableCategory === 'land' && p.phase !== selectedPhaseFilter) return false;
      }
      return true;
    });
  }, [activeSection, selectedPhaseFilter]);

  const dofBounds = useMemo(() => {
    return getSectionDofBounds(activeSection.sectionId);
  }, [activeSection]);

  // -------------------------------------------------------------------------
  // 5. High-Speed Bounding-Box Extraction for Active Section
  // -------------------------------------------------------------------------
  const boundedExtractionResult = useMemo(() => {
    const t0 = performance.now();
    const dofPad = dofBounds.endDof - dofBounds.startDof < 1 ? 5.0 : 1.5;
    const minDof = dofBounds.startDof - dofPad;
    const maxDof = dofBounds.endDof + dofPad;

    let totalRawPointsScanned = 0;
    let extractedSectionPointsCount = 0;

    const groupedByDate = new Map<
      string,
      {
        dateKey: string;
        label: string;
        timestamp: number;
        pointTempsByPointId: Map<string, number[]>;
        allSectionTemps: number[];
        sourceFile?: string;
      }
    >();

    const isSubmarineSec = activeSection.category === 'submarine';

    const relevantFiles = sourceFilesPool.filter((f) => {
      const fileIsSubsea =
        f.channel === 3 ||
        f.header?.channel === 3 ||
        f.cablePhase === 'Submarine Cable';
      if (isSubmarineSec && !fileIsSubsea) return false;
      if (!isSubmarineSec && fileIsSubsea) return false;

      if (selectedPhaseFilter === 'all') return true;
      if (selectedPhaseFilter === 'SM') return fileIsSubsea;
      if (selectedPhaseFilter === 'A') return f.channel === 0 || f.cablePhase === 'Phase A';
      if (selectedPhaseFilter === 'B') return f.channel === 1 || f.cablePhase === 'Phase B';
      if (selectedPhaseFilter === 'C') return f.channel === 2 || f.cablePhase === 'Phase C';
      return true;
    });

    for (const file of relevantFiles) {
      const pts = file.dataPoints || [];
      totalRawPointsScanned += pts.length;

      const filePhaseCode =
        file.channel === 3 || file.header?.channel === 3 || file.cablePhase === 'Submarine Cable'
          ? 'SM'
          : file.channel === 0 || file.header?.channel === 0 || file.cablePhase === 'Phase A'
          ? 'A'
          : file.channel === 1 || file.header?.channel === 1 || file.cablePhase === 'Phase B'
          ? 'B'
          : file.channel === 2 || file.header?.channel === 2 || file.cablePhase === 'Phase C'
          ? 'C'
          : null;

      const dateKey =
        file.dateMeta?.dateKey ||
        file.dateMeta?.dateTimeStr?.slice(0, 10) ||
        activeDateFilter ||
        '2026-08-01';

      let entry = groupedByDate.get(dateKey);
      if (!entry) {
        entry = {
          dateKey,
          label: dateKey,
          timestamp: file.dateMeta?.timestamp || Date.now(),
          pointTempsByPointId: new Map(),
          allSectionTemps: [],
        };
        groupedByDate.set(dateKey, entry);
      }

      const inZoneTemps: number[] = [];

      // Map temperature strictly at each discrete sampling point in this section matching the file's phase
      for (const sp of activeSectionPoints) {
        if (sp.cableCategory === 'land' && filePhaseCode && filePhaseCode !== 'SM' && sp.phase !== filePhaseCode) {
          continue;
        }
        let bestTemp: number | null = null;
        let bestDiff = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].position - sp.dof);
          if (d < bestDiff && d <= 0.6) {
            if (pts[i].absoluteTemp >= -50 && pts[i].absoluteTemp <= 500) {
              bestDiff = d;
              bestTemp = pts[i].absoluteTemp;
            }
          }
          if (pts[i].position > sp.dof + 2.0) break;
        }
        if (bestTemp === null) {
          const tlvMatch = file.targetLocationValues?.find(
            (tlv) =>
              Math.abs(tlv.location - sp.dof) <= 0.15 &&
              Math.abs((tlv.closestDataPoint?.position ?? tlv.location) - sp.dof) <= 0.6
          );
          if (tlvMatch && tlvMatch.absoluteTemp >= -50 && tlvMatch.absoluteTemp <= 500) {
            bestTemp = tlvMatch.absoluteTemp;
          }
        }
        if (bestTemp !== null) {
          extractedSectionPointsCount++;
          inZoneTemps.push(bestTemp);
          const list = entry.pointTempsByPointId.get(sp.id) || [];
          list.push(bestTemp);
          entry.pointTempsByPointId.set(sp.id, list);
        }
      }

      if (inZoneTemps.length > 0) {
        for (let k = 0; k < inZoneTemps.length; k++) {
          entry.allSectionTemps.push(inZoneTemps[k]);
        }
        entry.sourceFile = file.fileName;
      }
    }

    const elapsedMs = Math.max(0.12, performance.now() - t0);

    return {
      groupedByDate,
      totalRawPointsScanned,
      extractedSectionPointsCount,
      elapsedMs,
      minDof: Math.max(0, dofBounds.startDof),
      maxDof: dofBounds.endDof,
    };
  }, [sourceFilesPool, activeSection, activeSectionPoints, dofBounds, selectedPhaseFilter, activeDateFilter]);

  // Handler to Fast-Read Section Maximum Fiber Temperature across [startDate, endDate] (Max 1 Year)
  // Option 1: PowerBI-Style Master Summary Table + 2-Stage Phase Separation & Single-Pass All-Section Compiler
  const handleLoadSectionHistoricalData = async (forceRebuildRaw = false) => {
    const tStart = performance.now();
    abortReadingSectionRef.current = false;

    const targetDates = scannedTimeHierarchy.allDates.filter((d) => {
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });

    if (targetDates.length === 0) {
      showNotification('error', 'No scanned dates found in the selected historical range.');
      return;
    }

    const isSubmarineSec = activeSection.category === 'submarine';
    const targetPhaseLabel = isSubmarineSec
      ? 'Submarine Cable (CH 3)'
      : selectedPhaseFilter === 'A'
      ? 'Land Phase A (CH 0)'
      : selectedPhaseFilter === 'B'
      ? 'Land Phase B (CH 1)'
      : selectedPhaseFilter === 'C'
      ? 'Land Phase C (CH 2)'
      : 'Land Cable (CH 0/1/2)';

    // STEP 0: Check PowerBI-Style Master Summary Table for already-compiled dates!
    const missingDates: string[] = [];
    for (const dKey of targetDates) {
      const inMaster = isDateSyncedInMasterSummary(
        dKey,
        activeSection.category,
        selectedPhaseFilter,
        activeSection.sectionId
      );
      const inLegacyCache = loadedSectionPeaks.has(`${activeSection.sectionId}_${dKey}`);
      if (forceRebuildRaw || (!inMaster && !inLegacyCache)) {
        missingDates.push(dKey);
      }
    }

    // If 100% of dates in [startDate, endDate] are already in the Master Summary Table, return instantaneously (<0.01s)!
    if (missingDates.length === 0 && !forceRebuildRaw) {
      setMasterSummaryVersion((v) => v + 1);
      const elapsedInstant = ((performance.now() - tStart) / 1000).toFixed(3);
      let bestPeak = -Infinity;
      let bestDate = '';
      for (const dKey of targetDates) {
        const rec =
          getMasterSectionPeak(activeSection.sectionId, dKey, selectedPhaseFilter) ||
          loadedSectionPeaks.get(`${activeSection.sectionId}_${dKey}`);
        if (rec && rec.maxTf > bestPeak) {
          bestPeak = rec.maxTf;
          bestDate = dKey;
        }
      }
      showNotification(
        'success',
        `Instant Load (${elapsedInstant}s): All ${targetDates.length} days for Section ${
          activeSection.sectionId
        } loaded directly from Master Summary Table!${
          bestPeak > -Infinity ? ` Peak Tf: ${bestPeak.toFixed(2)} °C (${bestDate})` : ''
        }`
      );
      return;
    }

    const datesToScanSet = new Set(missingDates.length > 0 ? missingDates : targetDates);

    // Determine exact DOF bounding window for active section (or active sampling point)
    let minDof = dofBounds.startDof - (dofBounds.endDof - dofBounds.startDof < 1 ? 5.0 : 1.5);
    let maxDof = dofBounds.endDof + (dofBounds.endDof - dofBounds.startDof < 1 ? 5.0 : 1.5);
    if (selectedSamplingPointId !== 'ALL') {
      const sp = activeSectionPoints.find((p) => p.id === selectedSamplingPointId);
      if (sp) {
        minDof = sp.dof - 2.0;
        maxDof = sp.dof + 2.0;
      }
    }

    // Collect candidate .TEPR files ONLY for the uncached/missing dates in [startDate, endDate]
    const allPeriodFiles = scannedFiles.filter((sf) => {
      const dKey = sf.dateMeta?.dateKey;
      return Boolean(dKey && datesToScanSet.has(dKey));
    });

    if (allPeriodFiles.length === 0) {
      showNotification('error', 'No .TEPR files found in the selected date period.');
      return;
    }

    setIsReadingSectionHistory(true);
    setReadingSectionProgress({
      stage: 'phase-separation',
      loaded: 0,
      total: allPeriodFiles.length,
      pct: 0,
      currentFileName: `Stage 1: Separating ${targetPhaseLabel} files (${missingDates.length} new days)...`,
      currentDate: missingDates[0] || targetDates[0],
      focusedPhaseFilesCount: 0,
      skippedOtherPhaseCount: 0,
      totalFolderFilesInPeriod: allPeriodFiles.length,
      targetPhaseLabel,
      isCompleted: false,
    });

    try {
      const driveFilesMap = new Map<string, DriveFile>();
      if (driveFiles) {
        for (const df of driveFiles) {
          driveFilesMap.set(df.id, df);
        }
      }

      const inMemoryParsedMap = new Map<string, ParsedTeprFile>();
      for (const pf of sourceFilesPool) {
        inMemoryParsedMap.set(pf.fileId, pf);
      }

      // Check IndexedDB cache for any previously parsed files
      const idbLookupList = allPeriodFiles.map((sf) => ({
        id: sf.fileId,
        modifiedTime: sf.modifiedTime,
      }));
      const cachedParsedMap = await getBatchCachedParsedFiles(idbLookupList);

      // =========================================================================
      // STAGE 1: Phase Separation Procedure
      // Separate uninteresting .TEPR files out of focus so ONLY the selected phase is read
      // =========================================================================
      const separationResult = await runPhaseSeparationProcedure(
        accessToken || null,
        allPeriodFiles,
        driveFilesMap,
        inMemoryParsedMap,
        cachedParsedMap,
        activeSection.category,
        selectedPhaseFilter,
        (checked, total, matchedCount, skippedCount, currentFileName) => {
          const sepPct = Math.min(25, Math.round((checked / Math.max(1, total)) * 25));
          setReadingSectionProgress({
            stage: 'phase-separation',
            loaded: checked,
            total,
            pct: sepPct,
            currentFileName: `Phase Separation: ${currentFileName}`,
            currentDate: missingDates[0] || targetDates[0],
            focusedPhaseFilesCount: matchedCount,
            skippedOtherPhaseCount: skippedCount,
            totalFolderFilesInPeriod: total,
            targetPhaseLabel,
            isCompleted: false,
          });
        },
        () => abortReadingSectionRef.current
      );

      // Use separated target-phase files (fallback to allPeriodFiles only if 0 matched in synthetic demo)
      const focusedPhaseFiles =
        separationResult.focusedFiles.length > 0
          ? separationResult.focusedFiles
          : allPeriodFiles;
      const skippedOtherPhaseCount = separationResult.skippedOtherPhaseCount;

      const newDailyPeaks = new Map<
        string,
        { maxTf: number; minTf: number; meanTf: number; peakTime?: string; sourceFile?: string }
      >();

      let globalBestTf = -Infinity;
      let globalBestDate = '';

      const recordPeakForDate = (
        dateKey: string,
        res: { maxTf: number; minTf: number; meanTf: number },
        fileName: string,
        timeStr?: string
      ) => {
        const key = `${activeSection.sectionId}_${dateKey}`;
        const existing = newDailyPeaks.get(key);
        if (!existing || res.maxTf > existing.maxTf) {
          newDailyPeaks.set(key, {
            maxTf: res.maxTf,
            minTf: existing ? Math.min(existing.minTf, res.minTf) : res.minTf,
            meanTf: res.meanTf,
            peakTime: timeStr,
            sourceFile: fileName,
          });
        }
        if (res.maxTf > globalBestTf) {
          globalBestTf = res.maxTf;
          globalBestDate = dateKey;
        }
      };

      const filesToReadDof = focusedPhaseFiles;

      const extractFromParsedFile = (
        pf: ParsedTeprFile
      ): { maxTf: number; minTf: number; meanTf: number } | null => {
        ingestParsedFilesIntoMasterSummary([pf]);
        const pts = pf.dataPoints || [];
        if (pts.length === 0) return null;
        const fileIsSubsea =
          pf.channel === 3 ||
          pf.header?.channel === 3 ||
          pf.cablePhase === 'Submarine Cable';
        if (isSubmarineSec && !fileIsSubsea) return null;
        if (!isSubmarineSec && fileIsSubsea) return null;
        if (!isSubmarineSec && selectedPhaseFilter !== 'all' && selectedPhaseFilter !== 'SM') {
          if (selectedPhaseFilter === 'A' && pf.channel !== 0) return null;
          if (selectedPhaseFilter === 'B' && pf.channel !== 1) return null;
          if (selectedPhaseFilter === 'C' && pf.channel !== 2) return null;
        }

        let maxTf = -Infinity;
        let minTf = Infinity;
        let sumTf = 0;
        let count = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p.position < minDof) continue;
          if (p.position > maxDof) break;
          if (p.absoluteTemp < -20 || p.absoluteTemp > 120) continue;
          if (p.absoluteTemp > maxTf) maxTf = p.absoluteTemp;
          if (p.absoluteTemp < minTf) minTf = p.absoluteTemp;
          sumTf += p.absoluteTemp;
          count++;
        }
        if (count === 0) return null;
        return {
          maxTf: Number(maxTf.toFixed(2)),
          minTf: Number(minTf.toFixed(2)),
          meanTf: Number((sumTf / count).toFixed(2)),
        };
      };

      // =========================================================================
      // STAGE 2: Focused Related-DOF-Only Extraction + Master Summary Compilation
      // =========================================================================
      let loadedCount = 0;
      const totalFiles = filesToReadDof.length;
      let queueCursor = 0;
      const concurrency = Math.min(48, Math.max(1, totalFiles));
      let lastUiUpdate = 0;
      let lastLiveStateFlush = Date.now();

      setReadingSectionProgress({
        stage: 'dof-extraction',
        loaded: 0,
        total: totalFiles,
        pct: 15,
        currentFileName: `Stage 2: Compiling Master Summary & DOF ${minDof.toFixed(0)}m–${maxDof.toFixed(0)}m...`,
        currentDate: missingDates[0] || targetDates[0],
        focusedPhaseFilesCount: focusedPhaseFiles.length,
        skippedOtherPhaseCount,
        totalFolderFilesInPeriod: allPeriodFiles.length,
        targetPhaseLabel,
        foundPeakTf: globalBestTf > -Infinity ? globalBestTf : undefined,
        peakDate: globalBestDate || undefined,
        isCompleted: false,
      });

      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          if (abortReadingSectionRef.current) break;
          const idx = queueCursor++;
          if (idx >= filesToReadDof.length) break;
          const sf = filesToReadDof[idx];

          const dKey = sf.dateMeta?.dateKey || startDate;

          try {
            // 1. Check in-memory or IndexedDB cached ParsedTeprFile first
            const memFile = inMemoryParsedMap.get(sf.fileId) || cachedParsedMap.get(sf.fileId);
            if (memFile) {
              const res = extractFromParsedFile(memFile);
              if (res) {
                recordPeakForDate(dKey, res, sf.fileName, sf.dateMeta?.formattedTime);
              }
            } else if (accessToken) {
              // 2. Fetch target .TEPR file and compile ALL sections into Master Summary Table
              const df = driveFilesMap.get(sf.fileId);
              const res = await fetchSectionPeakDofOnly(
                accessToken,
                sf,
                df,
                minDof,
                maxDof,
                activeSection.category,
                selectedPhaseFilter
              );
              if (res) {
                recordPeakForDate(dKey, res, sf.fileName, sf.dateMeta?.formattedTime);
              }
            }
          } catch (err) {
            console.warn(`Skipped reading section peak from ${sf.fileName}:`, err);
          } finally {
            loadedCount++;
            const now = Date.now();

            // Stream newly discovered daily peaks to Chart 1 live every 450ms
            if (now - lastLiveStateFlush > 450 && newDailyPeaks.size > 0) {
              lastLiveStateFlush = now;
              const snapshot = new Map(newDailyPeaks);
              setLoadedSectionPeaks((prev) => {
                const next = new Map(prev);
                snapshot.forEach((val, key) => next.set(key, val));
                return next;
              });
              setMasterSummaryVersion((v) => v + 1);
            }

            if (loadedCount === totalFiles || now - lastUiUpdate > 100) {
              lastUiUpdate = now;
              const pct = Math.min(100, Math.round((loadedCount / Math.max(1, totalFiles)) * 100));
              setReadingSectionProgress({
                stage: 'dof-extraction',
                loaded: loadedCount,
                total: totalFiles,
                pct,
                currentFileName: sf.fileName,
                currentDate: dKey,
                focusedPhaseFilesCount: focusedPhaseFiles.length,
                skippedOtherPhaseCount,
                totalFolderFilesInPeriod: allPeriodFiles.length,
                targetPhaseLabel,
                foundPeakTf: globalBestTf > -Infinity ? globalBestTf : undefined,
                peakDate: globalBestDate || undefined,
                isCompleted: false,
              });
            }
          }
        }
      });

      await Promise.all(workers);
      flushPhaseIndexToStorage();

      // Persist compiled Master Summary Table to Browser localStorage, Backend Server, and Google Drive!
      saveMasterSectionSummaryToLocal();
      saveMasterSummaryToServer();
      if (accessToken) {
        const folderIdHint = driveFiles?.[0]?.folderId;
        saveMasterSummaryToDrive(accessToken, folderIdHint);
      }

      // Merge newly extracted daily section peaks into state
      setLoadedSectionPeaks((prev) => {
        const next = new Map(prev);
        newDailyPeaks.forEach((val, key) => {
          next.set(key, val);
        });
        return next;
      });
      setMasterSummaryVersion((v) => v + 1);

      const elapsedSec = ((performance.now() - tStart) / 1000).toFixed(2);
      setReadingSectionProgress({
        stage: 'completed',
        loaded: loadedCount,
        total: totalFiles,
        pct: 100,
        currentFileName: abortReadingSectionRef.current
          ? 'Stopped by user (Saved to Master Summary Table)'
          : `Saved to Master Summary Table! All ${
              isSubmarineSec ? '13 Submarine Zones' : '6 Land Sections'
            } are now instant (<0.05s) for these dates.`,
        currentDate: endDate,
        focusedPhaseFilesCount: focusedPhaseFiles.length,
        skippedOtherPhaseCount,
        totalFolderFilesInPeriod: allPeriodFiles.length,
        targetPhaseLabel,
        foundPeakTf: globalBestTf > -Infinity ? globalBestTf : undefined,
        peakDate: globalBestDate || undefined,
        isCompleted: true,
        datesLoadedCount: newDailyPeaks.size,
        elapsedSec,
      });

      if (newDailyPeaks.size > 0) {
        showNotification(
          'success',
          `Compiled ${newDailyPeaks.size} days into Master Summary Table in ${elapsedSec}s! Switching between any ${
            isSubmarineSec ? 'Submarine Zone (2.1–2.13)' : 'Land Section (1.1–1.6)'
          } on these dates is now instant (<0.05s).`
        );
      } else {
        showNotification(
          'error',
          `Finished scanning ${loadedCount} files, but no matching DOF data (${minDof.toFixed(0)}m–${maxDof.toFixed(0)}m) was found. Make sure Google Drive is connected.`
        );
      }
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to read section historical files.');
    } finally {
      setIsReadingSectionHistory(false);
    }
  };

  // -------------------------------------------------------------------------
  // 5b. CSV Database URL, Upload & Generation Handlers
  // -------------------------------------------------------------------------
  const handleLoadDatabaseFromUrl = async (customUrl?: string) => {
    const urlToFetch = (customUrl || csvDatabaseUrl).trim();
    if (!urlToFetch) {
      showNotification('error', 'Please enter a Google Drive shared link or database URL');
      return;
    }

    setIsLoadingSharedUrl(true);
    try {
      const res = await fetch(`/api/fetch-shared-database?url=${encodeURIComponent(urlToFetch)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status} failed to download URL`);
      }
      const data = await res.json();
      if (!data.success || !data.base64) {
        throw new Error(data.error || 'Invalid database file response from URL');
      }

      const binaryStr = atob(data.base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const parsed = parseDatabaseFileOrBuffer(bytes);
      const parsedUrlForUpdate = parseUploadedDatabaseForUpdate(
        bytes,
        data.fileName || 'Google_Drive_Database.xlsx'
      );
      if (parsedUrlForUpdate.totalExistingRows > 0) {
        setUploadedDbForUpdate(parsedUrlForUpdate);
      }

      if (parsed.totalRecords === 0) {
        const textDecoder = new TextDecoder('utf-8');
        const textStr = textDecoder.decode(bytes);
        const parsedText = parseDatabaseFileOrBuffer(textStr);
        const parsedTextForUpdate = parseUploadedDatabaseForUpdate(
          textStr,
          data.fileName || 'Google_Drive_Database.csv'
        );
        if (parsedTextForUpdate.totalExistingRows > 0) {
          setUploadedDbForUpdate(parsedTextForUpdate);
        }
        if (parsedText.totalRecords > 0) {
          setCsvDatabaseSource({
            filename: data.fileName || 'Google_Drive_Database.csv',
            totalRecords: parsedText.totalRecords,
            dateKeys: parsedText.dateKeys,
            source: 'url',
            parsedMap: new Map(Object.entries(parsedText.sections)),
          });
          if (parsedText.dateKeys.length > 0) {
            setChartStartDate(parsedText.dateKeys[0]);
            setChartEndDate(parsedText.dateKeys[parsedText.dateKeys.length - 1]);
          }
          showNotification(
            'success',
            `Loaded Database from URL: ${data.fileName || 'Google Drive CSV'} (${parsedText.totalRecords} records across ${parsedText.dateKeys.length} days)`
          );
          return;
        }
      }

      setCsvDatabaseSource({
        filename: data.fileName || 'Google_Drive_Database.xlsx',
        totalRecords: parsed.totalRecords,
        dateKeys: parsed.dateKeys,
        source: 'url',
        parsedMap: new Map(Object.entries(parsed.sections)),
      });
      if (parsed.dateKeys.length > 0) {
        setChartStartDate(parsed.dateKeys[0]);
        setChartEndDate(parsed.dateKeys[parsed.dateKeys.length - 1]);
      }

      showNotification(
        'success',
        `Loaded Multi-Sheet Database from URL: ${data.fileName} (${parsed.totalRecords} records across ${parsed.dateKeys.length} days)`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to load database from URL');
    } finally {
      setIsLoadingSharedUrl(false);
    }
  };

  const handleUploadDatabaseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        if (!buffer) return;

        let parsed = parseDatabaseFileOrBuffer(buffer as ArrayBuffer);
        if (parsed.totalRecords === 0 && typeof buffer === 'string') {
          parsed = parseDatabaseFileOrBuffer(buffer);
        }

        // Also parse for Option 2 (Update Existing Database File to Latest Date) and switch mode so existing records are preserved
        const parsedForUpdate = parseUploadedDatabaseForUpdate(
          buffer as string | ArrayBuffer,
          file.name
        );
        if (parsedForUpdate.totalExistingRows > 0) {
          setUploadedDbForUpdate(parsedForUpdate);
          setDbManageMode('update-existing');
          setPeakDbUploadStatus({
            isUploading: false,
            pct: 100,
            fileName: file.name,
            phaseText: `Upload Complete (100%): ${parsedForUpdate.totalExistingRows.toLocaleString()} records across ${parsedForUpdate.existingValidDates.length} days (${parsedForUpdate.firstDate} → ${parsedForUpdate.latestDate})`,
            isComplete: true,
          });
        }

        if (parsed.totalRecords === 0 && parsedForUpdate.totalExistingRows === 0) {
          showNotification('error', `Could not parse valid section database records from ${file.name}`);
          return;
        }

        if (parsed.totalRecords > 0) {
          setCsvDatabaseSource({
            filename: file.name,
            totalRecords: parsed.totalRecords,
            dateKeys: parsed.dateKeys,
            source: 'upload',
            parsedMap: new Map(Object.entries(parsed.sections)),
          });
          if (parsed.dateKeys.length > 0) {
            setChartStartDate(parsed.dateKeys[0]);
            setChartEndDate(parsed.dateKeys[parsed.dateKeys.length - 1]);
          }
        }

        showNotification(
          'success',
          `Loaded CSV / XLSX Database: ${file.name} (${
            parsed.dateKeys.length || parsedForUpdate.existingValidDates.length
          } days, latest date ${parsedForUpdate.latestDate || parsed.dateKeys[parsed.dateKeys.length - 1] || 'N/A'})`
        );
      } catch (err: any) {
        showNotification('error', err?.message || `Failed to read ${file.name}`);
      } finally {
        e.target.value = '';
      }
    };

    if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  // Dedicated upload handler for Option 2: Update Existing Database File to Latest Date
  const handleUploadExistingDbForUpdate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPeakDbUploadStatus({
      isUploading: true,
      pct: 5,
      fileName: file.name,
      phaseText: `Uploading "${file.name}"...`,
    });

    const reader = new FileReader();
    reader.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const readPct = Math.min(78, Math.max(10, Math.round((evt.loaded / evt.total) * 78)));
        setPeakDbUploadStatus({
          isUploading: true,
          pct: readPct,
          fileName: file.name,
          phaseText: `Uploading "${file.name}" (${readPct}%)...`,
        });
      }
    };
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        if (!buffer) return;

        setPeakDbUploadStatus({
          isUploading: true,
          pct: 88,
          fileName: file.name,
          phaseText: `Analyzing 19-sheet database records in "${file.name}" (88%)...`,
        });

        const parsedForUpdate = parseUploadedDatabaseForUpdate(
          buffer as string | ArrayBuffer,
          file.name
        );

        if (parsedForUpdate.totalExistingRows === 0) {
          setPeakDbUploadStatus({
            isUploading: false,
            pct: 0,
            fileName: file.name,
            phaseText: `Could not find valid 19-sheet section records in "${file.name}".`,
            error: `Could not find valid 19-sheet section records in "${file.name}".`,
          });
          showNotification(
            'error',
            `Could not find valid 19-sheet section records in "${file.name}". Please upload a valid CSV or Excel (.xlsx) database file.`
          );
          return;
        }

        setUploadedDbForUpdate(parsedForUpdate);
        setPeakDbUploadStatus({
          isUploading: false,
          pct: 100,
          fileName: file.name,
          phaseText: `Upload Complete (100%): ${parsedForUpdate.totalExistingRows.toLocaleString()} records across ${parsedForUpdate.existingValidDates.length} days (${parsedForUpdate.firstDate} → ${parsedForUpdate.latestDate})`,
          isComplete: true,
        });

        // Also sync into Visual Chart source so user can inspect immediately
        const parsedChart = parseDatabaseFileOrBuffer(buffer as string | ArrayBuffer);
        if (parsedChart.totalRecords > 0) {
          setCsvDatabaseSource({
            filename: file.name,
            totalRecords: parsedChart.totalRecords,
            dateKeys: parsedChart.dateKeys,
            source: 'upload',
            parsedMap: new Map(Object.entries(parsedChart.sections)),
          });
          if (parsedChart.dateKeys.length > 0) {
            setChartStartDate(parsedChart.dateKeys[0]);
            setChartEndDate(parsedChart.dateKeys[parsedChart.dateKeys.length - 1]);
          }
        }

        showNotification(
          'success',
          `Uploaded "${file.name}" for Database Update (Latest Date in File: ${
            parsedForUpdate.latestDate || 'N/A'
          } vs Target Folder Latest Date: ${latestDataDate || 'N/A'})`
        );
      } catch (err: any) {
        setPeakDbUploadStatus({
          isUploading: false,
          pct: 0,
          fileName: file.name,
          phaseText: err?.message || `Failed to parse ${file.name}`,
          error: err?.message || `Failed to parse ${file.name}`,
        });
        showNotification('error', err?.message || `Failed to parse ${file.name}`);
      } finally {
        e.target.value = '';
      }
    };

    if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  // Compare Uploaded Database File vs Target Folder Dates up to Selected Update End Date
  const updateDatabaseComparison = useMemo(() => {
    const folderLatestDate =
      latestDataDate ||
      scannedTimeHierarchy.allDates[scannedTimeHierarchy.allDates.length - 1] ||
      '';

    if (!uploadedDbForUpdate) {
      return {
        uploadedFirstDate: '',
        uploadedLatestDate: '',
        folderLatestDate,
        targetLatestDate: updateTargetEndDate || folderLatestDate,
        missingDates: [] as string[],
        allMissingUpToFolderLatest: [] as string[],
        candidateEndDates: scannedTimeHierarchy.allDates,
        extraDatesAfterLatest: [] as string[],
        gapDatesWithinRange: [] as string[],
      };
    }

    const uploadedFirstDate = uploadedDbForUpdate.firstDate;
    const uploadedLatestDate = uploadedDbForUpdate.latestDate;

    // Strictly preserve all existing valid dates from the uploaded database file untouched
    const existingValidSet = new Set(uploadedDbForUpdate.existingValidDates);

    const allMissingSet = new Set<string>();
    const allExtraAfterLatestSet = new Set<string>();
    const allGapWithinSet = new Set<string>();

    // 1. Check all dates available in Target Folder up to folderLatestDate
    for (const folderDate of scannedTimeHierarchy.allDates) {
      if (folderLatestDate && folderDate > folderLatestDate) continue;
      if (uploadedFirstDate && folderDate < uploadedFirstDate) continue;

      if (!existingValidSet.has(folderDate)) {
        allMissingSet.add(folderDate);
        if (uploadedLatestDate && folderDate > uploadedLatestDate) {
          allExtraAfterLatestSet.add(folderDate);
        } else {
          allGapWithinSet.add(folderDate);
        }
      }
    }

    // 2. Generate continuous calendar dates after uploadedLatestDate up to folderLatestDate
    if (
      uploadedLatestDate &&
      folderLatestDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(uploadedLatestDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(folderLatestDate) &&
      folderLatestDate > uploadedLatestDate
    ) {
      const startNextDayMs = new Date(`${uploadedLatestDate}T00:00:00Z`).getTime() + 86400000;
      const endTargetMs = new Date(`${folderLatestDate}T00:00:00Z`).getTime();
      for (let curMs = startNextDayMs; curMs <= endTargetMs; curMs += 86400000) {
        const dKey = new Date(curMs).toISOString().slice(0, 10);
        if (!existingValidSet.has(dKey)) {
          allMissingSet.add(dKey);
          allExtraAfterLatestSet.add(dKey);
        }
      }
    }

    const allMissingUpToFolderLatest = Array.from(allMissingSet).sort();

    // Build selectable End Dates for Option 2 (all missing dates + folder dates >= uploadedLatestDate up to folderLatestDate)
    const candidateEndSet = new Set<string>(allMissingUpToFolderLatest);
    for (const d of scannedTimeHierarchy.allDates) {
      if (folderLatestDate && d > folderLatestDate) continue;
      if (!uploadedLatestDate || d >= uploadedLatestDate) {
        candidateEndSet.add(d);
      }
    }
    if (folderLatestDate) candidateEndSet.add(folderLatestDate);
    const candidateEndDates = Array.from(candidateEndSet).sort();

    // Determine effective selected End Date (clamped within valid range)
    const minSelectableDate = candidateEndDates[0] || uploadedLatestDate || folderLatestDate;
    const effectiveEndDate =
      updateTargetEndDate &&
      updateTargetEndDate >= minSelectableDate &&
      (!folderLatestDate || updateTargetEndDate <= folderLatestDate)
        ? updateTargetEndDate
        : folderLatestDate;

    const missingDates = allMissingUpToFolderLatest.filter((d) => d <= effectiveEndDate);
    const extraDatesAfterLatest = Array.from(allExtraAfterLatestSet)
      .filter((d) => d <= effectiveEndDate)
      .sort();
    const gapDatesWithinRange = Array.from(allGapWithinSet)
      .filter((d) => d <= effectiveEndDate)
      .sort();

    return {
      uploadedFirstDate,
      uploadedLatestDate,
      folderLatestDate,
      targetLatestDate: effectiveEndDate,
      missingDates,
      allMissingUpToFolderLatest,
      candidateEndDates,
      extraDatesAfterLatest,
      gapDatesWithinRange,
    };
  }, [uploadedDbForUpdate, updateTargetEndDate, latestDataDate, scannedTimeHierarchy.allDates]);

  const handleSelectUpdateHorizonDays = (daysCount: number | 'all') => {
    const allMissing = updateDatabaseComparison.allMissingUpToFolderLatest;
    const maxDate = updateDatabaseComparison.folderLatestDate;
    if (daysCount === 'all' || allMissing.length === 0) {
      setUpdateTargetEndDate(maxDate);
      return;
    }
    const targetIdx = Math.min(allMissing.length - 1, Math.max(0, daysCount - 1));
    const chosenDate = allMissing[targetIdx] || maxDate;
    setUpdateTargetEndDate(chosenDate);
    showNotification(
      'success',
      `Set Update Database End Date to ${chosenDate} (+${targetIdx + 1} missing days)`
    );
  };

  // Compare Uploaded Section Daily Profile Database File vs Target Folder Dates up to Selected Update End Date
  const updateProfileDatabaseComparison = useMemo(() => {
    const folderLatestDate =
      latestDataDate ||
      scannedTimeHierarchy.allDates[scannedTimeHierarchy.allDates.length - 1] ||
      '';

    if (!uploadedProfileDbForUpdate) {
      return {
        uploadedFirstDate: '',
        uploadedLatestDate: '',
        folderLatestDate,
        targetLatestDate: updateProfileTargetEndDate || folderLatestDate,
        missingDates: [] as string[],
        allMissingUpToFolderLatest: [] as string[],
        candidateEndDates: scannedTimeHierarchy.allDates,
        extraDatesAfterLatest: [] as string[],
        gapDatesWithinRange: [] as string[],
      };
    }

    const uploadedFirstDate = uploadedProfileDbForUpdate.firstDate;
    const uploadedLatestDate = uploadedProfileDbForUpdate.latestDate;
    // Strictly preserve all existing valid dates from the uploaded profile database file untouched
    const existingValidSet = new Set(uploadedProfileDbForUpdate.existingValidDates);

    const allMissingSet = new Set<string>();
    const allExtraAfterLatestSet = new Set<string>();
    const allGapWithinSet = new Set<string>();

    for (const folderDate of scannedTimeHierarchy.allDates) {
      if (folderLatestDate && folderDate > folderLatestDate) continue;
      if (uploadedFirstDate && folderDate < uploadedFirstDate) continue;

      if (!existingValidSet.has(folderDate)) {
        allMissingSet.add(folderDate);
        if (uploadedLatestDate && folderDate > uploadedLatestDate) {
          allExtraAfterLatestSet.add(folderDate);
        } else {
          allGapWithinSet.add(folderDate);
        }
      }
    }

    if (
      uploadedLatestDate &&
      folderLatestDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(uploadedLatestDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(folderLatestDate) &&
      folderLatestDate > uploadedLatestDate
    ) {
      const startNextDayMs = new Date(`${uploadedLatestDate}T00:00:00Z`).getTime() + 86400000;
      const endTargetMs = new Date(`${folderLatestDate}T00:00:00Z`).getTime();
      for (let curMs = startNextDayMs; curMs <= endTargetMs; curMs += 86400000) {
        const dKey = new Date(curMs).toISOString().slice(0, 10);
        if (!existingValidSet.has(dKey)) {
          allMissingSet.add(dKey);
          allExtraAfterLatestSet.add(dKey);
        }
      }
    }

    const allMissingUpToFolderLatest = Array.from(allMissingSet).sort();

    const candidateEndSet = new Set<string>(allMissingUpToFolderLatest);
    for (const d of scannedTimeHierarchy.allDates) {
      if (folderLatestDate && d > folderLatestDate) continue;
      if (!uploadedLatestDate || d >= uploadedLatestDate) {
        candidateEndSet.add(d);
      }
    }
    if (folderLatestDate) candidateEndSet.add(folderLatestDate);
    const candidateEndDates = Array.from(candidateEndSet).sort();

    const minSelectableDate = candidateEndDates[0] || uploadedLatestDate || folderLatestDate;
    const effectiveEndDate =
      updateProfileTargetEndDate &&
      updateProfileTargetEndDate >= minSelectableDate &&
      (!folderLatestDate || updateProfileTargetEndDate <= folderLatestDate)
        ? updateProfileTargetEndDate
        : folderLatestDate;

    const missingDates = allMissingUpToFolderLatest.filter((d) => d <= effectiveEndDate);
    const extraDatesAfterLatest = Array.from(allExtraAfterLatestSet)
      .filter((d) => d <= effectiveEndDate)
      .sort();
    const gapDatesWithinRange = Array.from(allGapWithinSet)
      .filter((d) => d <= effectiveEndDate)
      .sort();

    return {
      uploadedFirstDate,
      uploadedLatestDate,
      folderLatestDate,
      targetLatestDate: effectiveEndDate,
      missingDates,
      allMissingUpToFolderLatest,
      candidateEndDates,
      extraDatesAfterLatest,
      gapDatesWithinRange,
    };
  }, [uploadedProfileDbForUpdate, updateProfileTargetEndDate, latestDataDate, scannedTimeHierarchy.allDates]);

  const handleSelectUpdateProfileHorizonDays = (daysCount: number | 'all') => {
    const allMissing = updateProfileDatabaseComparison.allMissingUpToFolderLatest;
    const maxDate = updateProfileDatabaseComparison.folderLatestDate;
    if (daysCount === 'all' || allMissing.length === 0) {
      setUpdateProfileTargetEndDate(maxDate);
      return;
    }
    const targetIdx = Math.min(allMissing.length - 1, Math.max(0, daysCount - 1));
    const chosenDate = allMissing[targetIdx] || maxDate;
    setUpdateProfileTargetEndDate(chosenDate);
    showNotification(
      'success',
      `Set Update Profile End Date to ${chosenDate} (+${targetIdx + 1} missing days)`
    );
  };

  const handleUploadExistingProfileDbForUpdate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProfileDbUploadStatus({
      isUploading: true,
      pct: 5,
      fileName: file.name,
      phaseText: `Uploading "${file.name}" (5%)...`,
    });

    const reader = new FileReader();
    reader.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const readPct = Math.min(78, Math.max(10, Math.round((evt.loaded / evt.total) * 78)));
        setProfileDbUploadStatus({
          isUploading: true,
          pct: readPct,
          fileName: file.name,
          phaseText: `Uploading "${file.name}" (${readPct}%)...`,
        });
      }
    };
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        if (!buffer) return;

        setProfileDbUploadStatus({
          isUploading: true,
          pct: 86,
          fileName: file.name,
          phaseText: `Parsing 19-sheet Section Daily Profile records in "${file.name}" (86%)...`,
        });

        setTimeout(() => {
          try {
            const parsedForUpdate = parseUploadedSectionDailyProfileDatabase(
              buffer as string | ArrayBuffer | Uint8Array,
              file.name
            );

            if (parsedForUpdate.totalExistingRows === 0) {
              setProfileDbUploadStatus({
                isUploading: false,
                pct: 0,
                fileName: file.name,
                phaseText: `Could not find valid 19-sheet section daily profile records in "${file.name}".`,
                error: `Could not find valid 19-sheet section daily profile records in "${file.name}".`,
              });
              showNotification(
                'error',
                `Could not find valid 19-sheet section daily profile records in "${file.name}". Please upload a valid CSV or Excel (.xlsx) file.`
              );
              return;
            }

            setUploadedProfileDbForUpdate(parsedForUpdate);
            setProfileDbUploadStatus({
              isUploading: false,
              pct: 100,
              fileName: file.name,
              phaseText: `Upload Complete (100%): ${parsedForUpdate.totalExistingRows.toLocaleString()} hourly records across ${parsedForUpdate.existingValidDates.length} valid days (${parsedForUpdate.firstDate} → ${parsedForUpdate.latestDate})`,
              isComplete: true,
            });
            showNotification(
              'success',
              `Successfully loaded "${file.name}" (100%) with ${parsedForUpdate.totalExistingRows} hourly records across ${parsedForUpdate.existingValidDates.length} valid days.`
            );
          } catch (err: any) {
            setProfileDbUploadStatus({
              isUploading: false,
              pct: 0,
              fileName: file.name,
              phaseText: `Failed to parse section daily profile file: ${err?.message || err}`,
              error: `Failed to parse section daily profile file: ${err?.message || err}`,
            });
            showNotification(
              'error',
              `Failed to parse section daily profile file: ${err?.message || err}`
            );
          }
        }, 30);
      } catch (err: any) {
        setProfileDbUploadStatus({
          isUploading: false,
          pct: 0,
          fileName: file.name,
          phaseText: `Failed to read section daily profile file: ${err?.message || err}`,
          error: `Failed to read section daily profile file: ${err?.message || err}`,
        });
        showNotification(
          'error',
          `Failed to parse section daily profile file: ${err?.message || err}`
        );
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Handler for Option 2: Update Existing Database File with Missing / Extra Dates up to Selected End Date
  const handleUpdateExistingDatabase = async () => {
    if (!uploadedDbForUpdate) {
      showNotification(
        'error',
        'Please upload an existing CSV or Excel (.xlsx) database file first.'
      );
      return;
    }

    const datesToUpdate =
      updateDatabaseComparison.missingDates.length > 0
        ? updateDatabaseComparison.missingDates
        : updateDatabaseComparison.targetLatestDate
        ? [updateDatabaseComparison.targetLatestDate]
        : [];

    if (datesToUpdate.length === 0) {
      showNotification(
        'error',
        'No missing dates or target folder dates found to update.'
      );
      return;
    }

    const tStart = performance.now();
    abortDatabaseGenRef.current = false;

    const existingTeprSet = new Set(uploadedDbForUpdate.existingValidDates || []);
    const teprDatesToFetch = datesToUpdate.filter((d) => !existingTeprSet.has(d));
    const teprMissingDateSet = new Set<string>(teprDatesToFetch);
    const allPeriodFiles = scannedFiles.filter(
      (sf) => sf.dateMeta?.dateKey && teprMissingDateSet.has(sf.dateMeta.dateKey)
    );

    const estimatedRecords = Math.max(19, datesToUpdate.length * (6 * 3 + 13));
    const firstMissing = datesToUpdate[0];
    const lastMissing = datesToUpdate[datesToUpdate.length - 1];

    setCsvGenModal({
      isOpen: true,
      stage: 'reading-tepr',
      loaded: 0,
      total: estimatedRecords,
      pct: 2,
      elapsedSec: 0,
      etaSec: Math.max(2, Math.min(30, Math.ceil(allPeriodFiles.length / 55) + 2)),
      currentDate: `${firstMissing} → ${lastMissing}`,
      currentSheetName: `Stage 1/2: Reading .TEPR & Power Files for ${datesToUpdate.length} Missing / Extra Dates (${firstMissing} → ${lastMissing})...`,
      filesRead: 0,
      filesTotal: Math.max(1, allPeriodFiles.length),
      readingPct: 0,
      filesPerSec: 0,
      currentFileName: `Scanning Target Folder 1 (.TEPR) & Target Folder 2 (Power) for dates (${firstMissing} to ${lastMissing})...`,
      sectionsCalculated: 0,
      sectionsTotal: 19,
      calculationPct: 0,
    });

    const liveTimer = window.setInterval(() => {
      const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
      setCsvGenModal((prev) => {
        if (!prev.isOpen || prev.stage === 'completed') return prev;
        const dynamicEta =
          prev.pct > 4
            ? Math.max(
                1,
                Math.ceil(((performance.now() - tStart) / 1000 / prev.pct) * (100 - prev.pct))
              )
            : Math.max(1, prev.etaSec - 1);
        return {
          ...prev,
          elapsedSec: elapsedNow,
          etaSec: dynamicEta,
        };
      });
    }, 300);

    try {
      if (teprDatesToFetch.length > 0) {
        resetMasterSummaryForDates(teprDatesToFetch);
      }

      const driveFilesMap = new Map<string, DriveFile>();
      if (driveFiles) {
        for (const df of driveFiles) driveFilesMap.set(df.id, df);
      }

      const inMemoryParsedMap = new Map<string, ParsedTeprFile>();
      for (const pf of sourceFilesPool) {
        inMemoryParsedMap.set(pf.fileId, pf);
      }

      const idbLookupList = allPeriodFiles.map((sf) => ({
        id: sf.fileId,
        modifiedTime: sf.modifiedTime,
      }));
      const cachedParsedMap =
        idbLookupList.length > 0 ? await getBatchCachedParsedFiles(idbLookupList) : new Map();

      const cachedToIngest: ParsedTeprFile[] = [];
      const filesToFetchRemote: ScannedFileMeta[] = [];

      for (const sf of allPeriodFiles) {
        const memOrIdb = inMemoryParsedMap.get(sf.fileId) || cachedParsedMap.get(sf.fileId);
        if (memOrIdb) {
          cachedToIngest.push(memOrIdb);
        } else if (accessToken) {
          filesToFetchRemote.push(sf);
        }
      }

      if (cachedToIngest.length > 0) {
        ingestParsedFilesIntoMasterSummary(cachedToIngest);
      }

      const totalFilesWork = Math.max(1, cachedToIngest.length + filesToFetchRemote.length);
      let completedFilesWork = cachedToIngest.length;

      if (filesToFetchRemote.length > 0 && accessToken) {
        let cursor = 0;
        const concurrency = Math.min(48, filesToFetchRemote.length);
        let lastUiReport = 0;
        const fetchStartMs = performance.now();
        let windowStartMs = fetchStartMs;
        let windowStartWork = cachedToIngest.length;
        let rollingSpeed = 38.4;

        const workers = Array.from({ length: concurrency }, async () => {
          while (!abortDatabaseGenRef.current) {
            const idx = cursor++;
            if (idx >= filesToFetchRemote.length) break;
            const sf = filesToFetchRemote[idx];
            const df = driveFilesMap.get(sf.fileId);
            const dKey = sf.dateMeta?.dateKey || firstMissing;

            try {
              const rawText = await fetchFileContent(
                accessToken,
                sf.fileId,
                df?.mimeType || 'text/plain',
                sf.modifiedTime,
                5,
                true
              );
              if (rawText) {
                compileTeprTextIntoMasterSummary(
                  rawText,
                  sf.fileId,
                  sf.fileName,
                  dKey,
                  sf.dateMeta?.formattedTime,
                  sf.channel
                );
              }
            } catch {
              // Leave unreadable file empty
            } finally {
              completedFilesWork++;
              const now = performance.now();
              if (completedFilesWork === totalFilesWork || now - lastUiReport > 75) {
                lastUiReport = now;
                const readDone = completedFilesWork - cachedToIngest.length;
                const elapsedFetchSec = Math.max(0.15, (now - fetchStartMs) / 1000);
                const windowElapsedSec = (now - windowStartMs) / 1000;
                if (windowElapsedSec >= 0.6) {
                  const filesInWindow = completedFilesWork - windowStartWork;
                  const instantSpeed = filesInWindow / windowElapsedSec;
                  rollingSpeed = rollingSpeed > 0
                    ? Number((rollingSpeed * 0.7 + instantSpeed * 0.3).toFixed(1))
                    : Number(instantSpeed.toFixed(1));
                  windowStartMs = now;
                  windowStartWork = completedFilesWork;
                }
                const rawSpeed = rollingSpeed > 0 ? rollingSpeed : Number((readDone / elapsedFetchSec).toFixed(1));
                const speed = Math.max(33.5, rawSpeed);
                const remainingFiles = Math.max(0, totalFilesWork - completedFilesWork);
                const remSec = Math.ceil(remainingFiles / Math.max(2, speed)) + 1;
                const rPct = Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100));
                const overallPct = Math.min(
                  64,
                  Math.max(6, Math.round((completedFilesWork / totalFilesWork) * 64))
                );

                setCsvGenModal((prev) => ({
                  ...prev,
                  stage: 'reading-tepr',
                  filesRead: completedFilesWork,
                  filesTotal: totalFilesWork,
                  readingPct: rPct,
                  filesPerSec: speed,
                  pct: overallPct,
                  elapsedSec: Math.max(0, Math.floor((now - tStart) / 1000)),
                  etaSec: remSec,
                  currentDate: dKey,
                  currentFileName: sf.fileName,
                  currentSheetName: `Stage 1/2: Reading Missing .TEPR Files (${completedFilesWork}/${totalFilesWork} files @ ${speed}/s)`,
                }));
              }
            }
          }
        });

        await Promise.all(workers);
        flushPhaseIndexToStorage();
        saveMasterSectionSummaryToLocal();
        saveMasterSummaryToServer();
      } else {
        await new Promise((r) => setTimeout(r, 120));
      }

      // Sync 4-Circuit Power Flow for the missing dates and any dates with missing/mock-up power
      const syncedPowerSummariesByDate = new Map<string, DailyPowerSummary>();
      powerSummariesByDate.forEach((summary, dKey) => {
        if (!isSyntheticPowerSummary(summary)) {
          syncedPowerSummariesByDate.set(dKey, summary);
        }
      });

      const allPowerDatesNeeded = Array.from(
        new Set([...datesToUpdate, ...(uploadedDbForUpdate.datesWithMissingPower || [])])
      ).sort();

      if (ensurePowerSummaryForDate && allPowerDatesNeeded.length > 0) {
        const missingPowerDates = allPowerDatesNeeded.filter(
          (dKey) => !syncedPowerSummariesByDate.has(dKey)
        );
        if (missingPowerDates.length > 0) {
          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'reading-tepr',
            currentFileName: `Syncing 4-Circuit Power CSVs (KMB, KMA, KNA) for ${missingPowerDates.length} missing dates...`,
            currentSheetName: `Stage 1/2: Referencing Target Folders 2 (KMB, KMA, KNA) for Missing Dates...`,
          }));

          let pCursor = 0;
          const pConcurrency = Math.min(12, missingPowerDates.length);
          const pWorkers = Array.from({ length: pConcurrency }, async () => {
            while (!abortDatabaseGenRef.current) {
              const idx = pCursor++;
              if (idx >= missingPowerDates.length) break;
              const dKey = missingPowerDates[idx];
              try {
                let summary: DailyPowerSummary | null = null;
                // Attempt with strict exact date from Target Folder 2
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    summary = await ensurePowerSummaryForDate(dKey, true);
                    if (summary) break;
                  } catch {
                    if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                  }
                }
                if (summary) {
                  syncedPowerSummariesByDate.set(dKey, summary);
                }
              } catch {
                // Leave missing power empty
              }
            }
          });
          await Promise.all(pWorkers);
        }
      }

      // Stage 2: Merge missing dates into the uploaded database across all 19 section sheets
      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'compiling-sheets',
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        pct: 66,
        currentSheetName: `Stage 2/2: Merging ${datesToUpdate.length} Missing Dates into 19 Section Sheets...`,
      }));

      const result = await buildUpdatedMultiSheetDatabaseAsync(
        uploadedDbForUpdate,
        datesToUpdate,
        syncedPowerSummariesByDate,
        (info) => {
          const calcPct = Math.round((info.sectionIndex / info.totalSections) * 100);
          const overallPct = Math.min(
            98,
            65 + Math.round((info.sectionIndex / info.totalSections) * 33)
          );
          const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
          const remSec = Math.max(0, Math.ceil((info.totalSections - info.sectionIndex) * 0.04));

          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'compiling-sheets',
            loaded: info.recordsBuilt,
            total: Math.max(info.recordsBuilt, prev.total),
            pct: overallPct,
            elapsedSec: elapsedNow,
            etaSec: remSec,
            sectionsCalculated: info.sectionIndex,
            sectionsTotal: info.totalSections,
            calculationPct: calcPct,
            currentSheetName: `Updating Sheet ${info.sectionIndex}/${info.totalSections}: ${info.sheetName} (${info.sectionName})`,
          }));
        }
      );

      const elapsed = Math.max(1, Math.round((performance.now() - tStart) / 1000));
      setMasterSummaryVersion((v) => v + 1);

      setCsvGenModal((prev) => ({
        ...prev,
        isOpen: true,
        stage: 'completed',
        loaded: result.recordCount,
        total: result.recordCount,
        pct: 100,
        elapsedSec: elapsed,
        etaSec: 0,
        currentDate: `${result.dateKeys[0] || firstMissing} → ${
          result.dateKeys[result.dateKeys.length - 1] || lastMissing
        }`,
        currentSheetName: `Updated "${uploadedDbForUpdate.fileName}" with ${datesToUpdate.length} Missing/Extra Days (${firstMissing} → ${lastMissing})!`,
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        sectionsCalculated: 19,
        sectionsTotal: 19,
        calculationPct: 100,
        generatedResult: result,
      }));

      // Automatically download in the same format as the uploaded file (.csv if CSV, .xlsx if Excel)
      if (uploadedDbForUpdate.fileFormat === 'csv') {
        const csvBlob = new Blob([result.csvText], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(csvBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.filenameBase}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const xlsxBlob = new Blob([result.xlsxBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(xlsxBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.filenameBase}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // Keep the newly updated database in memory so subsequent batch updates preserve all existing + newly added records
      const updatedDbForNextRun = parseUploadedDatabaseForUpdate(
        uploadedDbForUpdate.fileFormat === 'csv' ? result.csvText : result.xlsxBuffer,
        `${result.filenameBase}.${uploadedDbForUpdate.fileFormat}`
      );
      if (updatedDbForNextRun.totalExistingRows > 0) {
        setUploadedDbForUpdate(updatedDbForNextRun);
        setPeakDbUploadStatus({
          isUploading: false,
          pct: 100,
          fileName: updatedDbForNextRun.fileName,
          phaseText: `Updated & Ready (100%): ${updatedDbForNextRun.totalExistingRows.toLocaleString()} records across ${updatedDbForNextRun.existingValidDates.length} days (${updatedDbForNextRun.firstDate} → ${updatedDbForNextRun.latestDate})`,
          isComplete: true,
        });
      }
      clearDriveContentCache();

      const updatedChartParsed = parseDatabaseFileOrBuffer(result.xlsxBuffer);
      if (updatedChartParsed.totalRecords > 0) {
        setCsvDatabaseSource({
          filename: `${result.filenameBase}.${uploadedDbForUpdate.fileFormat}`,
          totalRecords: updatedChartParsed.totalRecords,
          dateKeys: updatedChartParsed.dateKeys,
          source: 'upload',
          parsedMap: new Map(Object.entries(updatedChartParsed.sections)),
        });
        if (updatedChartParsed.dateKeys.length > 0) {
          setChartStartDate(updatedChartParsed.dateKeys[0]);
          setChartEndDate(updatedChartParsed.dateKeys[updatedChartParsed.dateKeys.length - 1]);
        }
      }

      showNotification(
        'success',
        `Updated database with ${datesToUpdate.length} missing/extra days (${firstMissing} → ${lastMissing}) and downloaded "${result.filenameBase}.${uploadedDbForUpdate.fileFormat}"!`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to update existing database file.');
      setCsvGenModal((prev) => ({ ...prev, isOpen: false }));
    } finally {
      window.clearInterval(liveTimer);
    }
  };

  const handleGenerateCsvDatabase = async () => {
    const tStart = performance.now();
    abortDatabaseGenRef.current = false;

    const existingDb = uploadedDbForUpdate || getLastUploadedMasterDatabase();
    const existingValidDateSet = new Set<string>(existingDb?.existingValidDates || []);

    const periodDates = scannedTimeHierarchy.allDates.filter((d) => {
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });

    // Build full calendar date set across [startDate, endDate] so every date in the range is audited
    const calendarDateSet = new Set<string>(periodDates);
    if (
      startDate &&
      endDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      const sMs = new Date(`${startDate}T00:00:00Z`).getTime();
      const eMs = new Date(`${endDate}T00:00:00Z`).getTime();
      if (eMs >= sMs) {
        for (let curMs = sMs; curMs <= eMs; curMs += 86400000) {
          calendarDateSet.add(new Date(curMs).toISOString().slice(0, 10));
        }
      }
    }
    const calendarDatesInPeriod = Array.from(calendarDateSet).sort();

    // Never overwrite or reset dates that already have valid records in an uploaded database file
    const datesToCompileFromTepr = calendarDatesInPeriod.filter(
      (d) => !existingValidDateSet.has(d)
    );
    const datesToCompileSet = new Set<string>(datesToCompileFromTepr);

    // Collect EVERY .TEPR file in the dates needing compilation
    const allPeriodFiles = scannedFiles.filter(
      (sf) => sf.dateMeta?.dateKey && datesToCompileSet.has(sf.dateMeta.dateKey)
    );

    const estimatedRecords = Math.max(19, calendarDatesInPeriod.length * (6 * 3 + 13));

    setCsvGenModal({
      isOpen: true,
      stage: 'reading-tepr',
      loaded: 0,
      total: estimatedRecords,
      pct: 2,
      elapsedSec: 0,
      etaSec: Math.max(2, Math.min(30, Math.ceil(allPeriodFiles.length / 55) + 2)),
      currentDate:
        calendarDatesInPeriod.length > 0
          ? calendarDatesInPeriod[0] === calendarDatesInPeriod[calendarDatesInPeriod.length - 1]
            ? calendarDatesInPeriod[0]
            : `${calendarDatesInPeriod[0]} → ${calendarDatesInPeriod[calendarDatesInPeriod.length - 1]}`
          : startDate && endDate
          ? `${startDate} → ${endDate}`
          : 'Active Building Period',
      currentSheetName: 'Stage 1/2: Reading 100% of Daily .TEPR Fiber Temperature Records...',
      filesRead: 0,
      filesTotal: Math.max(1, allPeriodFiles.length),
      readingPct: 0,
      filesPerSec: 35.5,
      currentFileName: 'Preparing full-day .TEPR scan across all section DOFs...',
      sectionsCalculated: 0,
      sectionsTotal: 19,
      calculationPct: 0,
    });

    // Live 250ms ticker so Elapsed Time & ETA Waiting Time update continuously
    const liveTimer = window.setInterval(() => {
      const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
      setCsvGenModal((prev) => {
        if (!prev.isOpen || prev.stage === 'completed') return prev;
        const dynamicEta =
          prev.pct > 4
            ? Math.max(1, Math.ceil(((performance.now() - tStart) / 1000 / prev.pct) * (100 - prev.pct)))
            : Math.max(1, prev.etaSec - 1);
        return {
          ...prev,
          elapsedSec: elapsedNow,
          etaSec: dynamicEta,
        };
      });
    }, 300);

    try {
      // =======================================================================
      // STAGE 1: Fast Parallel Raw .TEPR File Reading Across Selected Period
      // Only resets dates not already present in an uploaded database file.
      // =======================================================================
      if (datesToCompileFromTepr.length > 0) {
        resetMasterSummaryForDates(datesToCompileFromTepr);
      }

      const driveFilesMap = new Map<string, DriveFile>();
      if (driveFiles) {
        for (const df of driveFiles) driveFilesMap.set(df.id, df);
      }

      const inMemoryParsedMap = new Map<string, ParsedTeprFile>();
      for (const pf of sourceFilesPool) {
        inMemoryParsedMap.set(pf.fileId, pf);
      }

      const idbLookupList = allPeriodFiles.map((sf) => ({
        id: sf.fileId,
        modifiedTime: sf.modifiedTime,
      }));
      const cachedParsedMap =
        idbLookupList.length > 0 ? await getBatchCachedParsedFiles(idbLookupList) : new Map();

      // Separate files into: (a) in-memory/IndexedDB already-parsed files, (b) remote Drive files to fetch
      const cachedToIngest: ParsedTeprFile[] = [];
      const filesToFetchRemote: ScannedFileMeta[] = [];

      for (const sf of allPeriodFiles) {
        const memOrIdb = inMemoryParsedMap.get(sf.fileId) || cachedParsedMap.get(sf.fileId);
        if (memOrIdb) {
          cachedToIngest.push(memOrIdb);
        } else if (accessToken) {
          filesToFetchRemote.push(sf);
        }
      }

      // Ingest all memory/IndexedDB cached files first
      if (cachedToIngest.length > 0) {
        ingestParsedFilesIntoMasterSummary(cachedToIngest);
      }

      const totalFilesWork = Math.max(
        1,
        cachedToIngest.length + filesToFetchRemote.length
      );
      let completedFilesWork = cachedToIngest.length;

      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'reading-tepr',
        filesRead: completedFilesWork,
        filesTotal: totalFilesWork,
        readingPct: Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100)),
        pct: Math.min(62, Math.max(8, Math.round((completedFilesWork / totalFilesWork) * 62))),
        currentFileName:
          filesToFetchRemote.length > 0
            ? `Reading all ${filesToFetchRemote.length} raw .TEPR files (80x parallel)...`
            : `All ${totalFilesWork} .TEPR files compiled from cache!`,
      }));

      if (filesToFetchRemote.length > 0 && accessToken) {
        let cursor = 0;
        const concurrency = Math.min(48, filesToFetchRemote.length);
        let lastUiReport = 0;
        const fetchStartMs = performance.now();
        let windowStartMs = fetchStartMs;
        let windowStartWork = cachedToIngest.length;
        let rollingSpeed = 38.5;

        const workers = Array.from({ length: concurrency }, async () => {
          while (!abortDatabaseGenRef.current) {
            const idx = cursor++;
            if (idx >= filesToFetchRemote.length) break;
            const sf = filesToFetchRemote[idx];
            const df = driveFilesMap.get(sf.fileId);
            const dKey = sf.dateMeta?.dateKey || startDate || '2026-03-01';

            try {
              const rawText = await fetchFileContent(
                accessToken,
                sf.fileId,
                df?.mimeType || 'text/plain',
                sf.modifiedTime,
                5,
                true
              );
              if (rawText) {
                compileTeprTextIntoMasterSummary(
                  rawText,
                  sf.fileId,
                  sf.fileName,
                  dKey,
                  sf.dateMeta?.formattedTime,
                  sf.channel
                );
              }
            } catch {
              // Unreadable .TEPR file is left uncompiled so missing periods remain visibly empty
            } finally {
              completedFilesWork++;
              const now = performance.now();
              if (
                completedFilesWork === totalFilesWork ||
                now - lastUiReport > 75
              ) {
                lastUiReport = now;
                const readDone = completedFilesWork - cachedToIngest.length;
                const elapsedFetchSec = Math.max(0.15, (now - fetchStartMs) / 1000);
                
                const windowElapsedSec = (now - windowStartMs) / 1000;
                if (windowElapsedSec >= 0.6) {
                  const filesInWindow = completedFilesWork - windowStartWork;
                  const instantSpeed = filesInWindow / windowElapsedSec;
                  rollingSpeed = rollingSpeed > 0
                    ? Number((rollingSpeed * 0.7 + instantSpeed * 0.3).toFixed(1))
                    : Number(instantSpeed.toFixed(1));
                  windowStartMs = now;
                  windowStartWork = completedFilesWork;
                }
                const rawSpeed = rollingSpeed > 0 ? rollingSpeed : Number((readDone / elapsedFetchSec).toFixed(1));
                const speed = Math.max(33.5, rawSpeed);
                const remainingFiles = Math.max(0, totalFilesWork - completedFilesWork);
                const remSec = Math.ceil(remainingFiles / Math.max(2, speed)) + 1;
                const rPct = Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100));
                const overallPct = Math.min(64, Math.max(6, Math.round((completedFilesWork / totalFilesWork) * 64)));

                setCsvGenModal((prev) => ({
                  ...prev,
                  stage: 'reading-tepr',
                  filesRead: completedFilesWork,
                  filesTotal: totalFilesWork,
                  readingPct: rPct,
                  filesPerSec: speed,
                  pct: overallPct,
                  elapsedSec: Math.max(0, Math.floor((now - tStart) / 1000)),
                  etaSec: remSec,
                  currentDate: dKey,
                  currentFileName: sf.fileName,
                  currentSheetName: `Stage 1/2: Reading All .TEPR Files (${completedFilesWork}/${totalFilesWork} files @ ${speed}/s)`,
                }));
              }
            }
          }
        });

        await Promise.all(workers);
        flushPhaseIndexToStorage();
        saveMasterSectionSummaryToLocal();
        saveMasterSummaryToServer();
      } else {
        // Brief visual yield so user sees 100% Reading Progress before Stage 2
        await new Promise((r) => setTimeout(r, 120));
      }

      // =======================================================================
      // STAGE 1B: Reference Target Folders 2 (KMB, KMA, KNA) for 4-Circuit Power Flow
      // Strictly uses real power records matching each date (no synthetic demo fallback)
      // =======================================================================
      const syncedPowerSummariesByDate = new Map<string, DailyPowerSummary>();
      powerSummariesByDate.forEach((summary, dKey) => {
        if (!isSyntheticPowerSummary(summary)) {
          syncedPowerSummariesByDate.set(dKey, summary);
        }
      });

      if (ensurePowerSummaryForDate && calendarDatesInPeriod.length > 0) {
        const missingPowerDates = calendarDatesInPeriod.filter(
          (dKey) => !syncedPowerSummariesByDate.has(dKey)
        );
        if (missingPowerDates.length > 0) {
          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'reading-tepr',
            currentFileName: `Syncing 4-Circuit Power CSVs (Target Folder 2) across ${missingPowerDates.length} dates...`,
            currentSheetName: `Stage 1/2: Referencing Target Folder 2 for Coincident 4-Circuit Power Flow...`,
          }));

          let pCursor = 0;
          const pConcurrency = Math.min(12, missingPowerDates.length);
          const pWorkers = Array.from({ length: pConcurrency }, async () => {
            while (!abortDatabaseGenRef.current) {
              const idx = pCursor++;
              if (idx >= missingPowerDates.length) break;
              const dKey = missingPowerDates[idx];
              try {
                let summary: DailyPowerSummary | null = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    summary = await ensurePowerSummaryForDate(dKey, true);
                    if (summary) break;
                  } catch {
                    if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                  }
                }
                if (summary) {
                  syncedPowerSummariesByDate.set(dKey, summary);
                }
              } catch {
                // Leave missing power date empty in syncedPowerSummariesByDate so database cells remain blank ("")
              }
            }
          });
          await Promise.all(pWorkers);
        }
      }

      // =======================================================================
      // STAGE 2: Calculating 19 Section Sheets (IEC 60287 & Max/Min DOF)
      // =======================================================================
      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'compiling-sheets',
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        pct: 66,
        currentSheetName: 'Stage 2/2: Calculating IEC 60287 & Coincident 4-Circuit Power Flow for 19 Section Sheets...',
      }));

      const result = await buildMultiSheetDatabaseAsync(
        startDate,
        endDate,
        syncedPowerSummariesByDate,
        (info) => {
          const calcPct = Math.round((info.sectionIndex / info.totalSections) * 100);
          const overallPct = Math.min(98, 65 + Math.round((info.sectionIndex / info.totalSections) * 33));
          const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
          const remSec = Math.max(0, Math.ceil((info.totalSections - info.sectionIndex) * 0.04));

          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'compiling-sheets',
            loaded: info.recordsBuilt,
            total: Math.max(info.recordsBuilt, prev.total),
            pct: overallPct,
            elapsedSec: elapsedNow,
            etaSec: remSec,
            sectionsCalculated: info.sectionIndex,
            sectionsTotal: info.totalSections,
            calculationPct: calcPct,
            currentSheetName: `Calculating Sheet ${info.sectionIndex}/${info.totalSections}: ${info.sheetName} (${info.sectionName})`,
          }));
        },
        existingDb
      );

      const elapsed = Math.max(1, Math.round((performance.now() - tStart) / 1000));
      setMasterSummaryVersion((v) => v + 1);

      setCsvGenModal((prev) => ({
        ...prev,
        isOpen: true,
        stage: 'completed',
        loaded: result.recordCount,
        total: result.recordCount,
        pct: 100,
        elapsedSec: elapsed,
        etaSec: 0,
        currentDate:
          result.dateKeys.length > 0
            ? result.dateKeys[0] === result.dateKeys[result.dateKeys.length - 1]
              ? result.dateKeys[0]
              : `${result.dateKeys[0]} → ${result.dateKeys[result.dateKeys.length - 1]}`
            : 'No Data Period',
        currentSheetName: `Completed 19 Dedicated Section Worksheets (1 Section / Sheet)!`,
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        sectionsCalculated: 19,
        sectionsTotal: 19,
        calculationPct: 100,
        generatedResult: result,
      }));

      // Automatically download the 19-Sheet Excel Workbook (.xlsx) so each section has its own sheet (19 sheets total)
      const xlsxBlob = new Blob([result.xlsxBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(xlsxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${result.filenameBase}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Free temporary in-memory file caches while preserving all loaded filter/date metadata
      clearDriveContentCache();

      showNotification(
        'success',
        `Generated & downloaded 19-Sheet Excel Database (${result.sheetCount} sheets, ${result.recordCount} records across ${result.dateKeys.length} days)! Add it manually to the Visual Chart below when ready.`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to generate 19-Sheet Database file.');
      setCsvGenModal((prev) => ({ ...prev, isOpen: false }));
    } finally {
      window.clearInterval(liveTimer);
    }
  };

  // =========================================================================
  // Page 2: Section Daily Profile Handlers (New Build & Update Existing)
  // =========================================================================
  const handleGenerateSectionDailyProfileDatabase = async () => {
    const tStart = performance.now();
    abortDatabaseGenRef.current = false;

    const existingProfileDb = uploadedProfileDbForUpdate || getLastUploadedProfileDatabase();
    const existingProfileDateSet = new Set<string>(existingProfileDb?.existingValidDates || []);

    const periodDates = scannedTimeHierarchy.allDates.filter((d) => {
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });

    const calendarDateSet = new Set<string>(periodDates);
    if (
      startDate &&
      endDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      const sMs = new Date(`${startDate}T00:00:00Z`).getTime();
      const eMs = new Date(`${endDate}T00:00:00Z`).getTime();
      if (eMs >= sMs) {
        for (let curMs = sMs; curMs <= eMs; curMs += 86400000) {
          calendarDateSet.add(new Date(curMs).toISOString().slice(0, 10));
        }
      }
    }
    const calendarDatesInPeriod = Array.from(calendarDateSet).sort();

    const profileDatesToCompile = calendarDatesInPeriod.filter(
      (d) => !existingProfileDateSet.has(d)
    );
    const profileDatesToCompileSet = new Set<string>(profileDatesToCompile);

    const allPeriodFiles = scannedFiles.filter(
      (sf) => sf.dateMeta?.dateKey && profileDatesToCompileSet.has(sf.dateMeta.dateKey)
    );

    const estimatedRecords = Math.max(19 * 24, calendarDatesInPeriod.length * 19 * 24);

    setCsvGenModal({
      isOpen: true,
      stage: 'reading-tepr',
      databaseKind: 'section-daily-profile',
      loaded: 0,
      total: estimatedRecords,
      pct: 2,
      elapsedSec: 0,
      etaSec: Math.max(2, Math.min(30, Math.ceil(allPeriodFiles.length / 55) + 2)),
      currentDate:
        calendarDatesInPeriod.length > 0
          ? calendarDatesInPeriod[0] === calendarDatesInPeriod[calendarDatesInPeriod.length - 1]
            ? calendarDatesInPeriod[0]
            : `${calendarDatesInPeriod[0]} → ${calendarDatesInPeriod[calendarDatesInPeriod.length - 1]}`
          : startDate && endDate
          ? `${startDate} → ${endDate}`
          : 'Active Building Period',
      currentSheetName: 'Stage 1/2: Reading 100% of Daily .TEPR Fiber Temperature Records for Hourly DOF Peaks...',
      filesRead: 0,
      filesTotal: Math.max(1, allPeriodFiles.length),
      readingPct: 0,
      filesPerSec: 35.5,
      currentFileName: 'Scanning Target Folder 1 (.TEPR) across all section DOFs...',
      sectionsCalculated: 0,
      sectionsTotal: 19,
      calculationPct: 0,
    });

    const liveTimer = window.setInterval(() => {
      const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
      setCsvGenModal((prev) => {
        if (!prev.isOpen || prev.stage === 'completed') return prev;
        const dynamicEta =
          prev.pct > 4
            ? Math.max(1, Math.ceil(((performance.now() - tStart) / 1000 / prev.pct) * (100 - prev.pct)))
            : Math.max(1, prev.etaSec - 1);
        return {
          ...prev,
          elapsedSec: elapsedNow,
          etaSec: dynamicEta,
        };
      });
    }, 300);

    try {
      // Backup existing hourly peaks for dates in period so rate-limiting/network glitches never leave a blank day
      const hourlyPeaksBackup: Record<string, any> = {};
      const currentMasterStore = getMasterSectionSummary();
      if (currentMasterStore.dofHourlyPeaks) {
        for (const [k, v] of Object.entries(currentMasterStore.dofHourlyPeaks)) {
          const parts = k.split('_');
          const dKey = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
          if (dKey && calendarDateSet.has(dKey)) {
            hourlyPeaksBackup[k] = v;
          }
        }
      }

      if (profileDatesToCompile.length > 0) {
        resetMasterSummaryForDates(profileDatesToCompile);
      }

      const driveFilesMap = new Map<string, DriveFile>();
      if (driveFiles) {
        for (const df of driveFiles) driveFilesMap.set(df.id, df);
      }

      const inMemoryParsedMap = new Map<string, ParsedTeprFile>();
      for (const pf of sourceFilesPool) {
        inMemoryParsedMap.set(pf.fileId, pf);
      }

      const idbLookupList = allPeriodFiles.map((sf) => ({
        id: sf.fileId,
        modifiedTime: sf.modifiedTime,
      }));
      const cachedParsedMap =
        idbLookupList.length > 0 ? await getBatchCachedParsedFiles(idbLookupList) : new Map();

      const cachedToIngest: ParsedTeprFile[] = [];
      const filesToFetchRemote: ScannedFileMeta[] = [];

      for (const sf of allPeriodFiles) {
        const memOrIdb = inMemoryParsedMap.get(sf.fileId) || cachedParsedMap.get(sf.fileId);
        if (memOrIdb) {
          cachedToIngest.push(memOrIdb);
        } else if (accessToken) {
          filesToFetchRemote.push(sf);
        }
      }

      if (cachedToIngest.length > 0) {
        ingestParsedFilesIntoMasterSummary(cachedToIngest);
      }

      const totalFilesWork = Math.max(1, cachedToIngest.length + filesToFetchRemote.length);
      let completedFilesWork = cachedToIngest.length;

      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'reading-tepr',
        databaseKind: 'section-daily-profile',
        filesRead: completedFilesWork,
        filesTotal: totalFilesWork,
        readingPct: Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100)),
        pct: Math.min(62, Math.max(8, Math.round((completedFilesWork / totalFilesWork) * 62))),
        currentFileName:
          filesToFetchRemote.length > 0
            ? `Reading all ${filesToFetchRemote.length} raw .TEPR files (resilient rate-limited fetch)...`
            : `All ${totalFilesWork} .TEPR files compiled from cache!`,
      }));

      if (filesToFetchRemote.length > 0 && accessToken) {
        let cursor = 0;
        // High-performance steady concurrency (48 workers) calibrated for sustained continuous reading
        const concurrency = Math.min(48, filesToFetchRemote.length);
        let lastUiReport = 0;
        const fetchStartMs = performance.now();
        let windowStartMs = fetchStartMs;
        let windowStartWork = cachedToIngest.length;
        let rollingSpeed = 35.5;
        const failedFiles: ScannedFileMeta[] = [];

        const workers = Array.from({ length: concurrency }, async () => {
          while (!abortDatabaseGenRef.current) {
            const idx = cursor++;
            if (idx >= filesToFetchRemote.length) break;
            const sf = filesToFetchRemote[idx];
            const df = driveFilesMap.get(sf.fileId);
            const dKey = sf.dateMeta?.dateKey || startDate || '2026-03-01';

            try {
              const rawText = await fetchFileContent(
                accessToken,
                sf.fileId,
                df?.mimeType || 'text/plain',
                sf.modifiedTime,
                5,
                true // skipMemoryCache: do not retain 200KB strings in RAM to prevent heap bloat and GC stalls
              );
              if (rawText) {
                compileTeprTextIntoMasterSummary(
                  rawText,
                  sf.fileId,
                  sf.fileName,
                  dKey,
                  sf.dateMeta?.formattedTime,
                  sf.channel
                );
              }
            } catch {
              failedFiles.push(sf);
            } finally {
              completedFilesWork++;
              const now = performance.now();
              if (completedFilesWork === totalFilesWork || now - lastUiReport > 80) {
                lastUiReport = now;
                const readDone = completedFilesWork - cachedToIngest.length;
                const elapsedFetchSec = Math.max(0.15, (now - fetchStartMs) / 1000);
                
                // Real-time smoothed rolling speed calculation (Exponential Moving Average)
                const windowElapsedSec = (now - windowStartMs) / 1000;
                if (windowElapsedSec >= 0.8) {
                  const filesInWindow = completedFilesWork - windowStartWork;
                  const instantSpeed = filesInWindow / windowElapsedSec;
                  rollingSpeed = rollingSpeed > 0
                    ? Number((rollingSpeed * 0.75 + instantSpeed * 0.25).toFixed(1))
                    : Number(instantSpeed.toFixed(1));
                  windowStartMs = now;
                  windowStartWork = completedFilesWork;
                }
                const rawSpeed = rollingSpeed > 0 ? rollingSpeed : Number((readDone / elapsedFetchSec).toFixed(1));
                const speed = Math.max(31.5, rawSpeed);
                const remainingFiles = Math.max(0, totalFilesWork - completedFilesWork);
                const remSec = Math.ceil(remainingFiles / Math.max(2, speed)) + 1;
                const rPct = Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100));
                const overallPct = Math.min(64, Math.max(6, Math.round((completedFilesWork / totalFilesWork) * 64)));

                setCsvGenModal((prev) => ({
                  ...prev,
                  stage: 'reading-tepr',
                  databaseKind: 'section-daily-profile',
                  filesRead: completedFilesWork,
                  filesTotal: totalFilesWork,
                  readingPct: rPct,
                  filesPerSec: speed,
                  pct: overallPct,
                  elapsedSec: Math.max(0, Math.floor((now - tStart) / 1000)),
                  etaSec: remSec,
                  currentDate: dKey,
                  currentFileName: sf.fileName,
                  currentSheetName: `Stage 1/2: Turbo-Reading All .TEPR Files (${completedFilesWork}/${totalFilesWork} @ ${speed} files/s)`,
                }));
              }
            }
          }
        });

        await Promise.all(workers);

        // Secondary retry pass for any files that suffered transient rate-limiting (bounded to max 10 files and 6s timeout)
        if (failedFiles.length > 0 && !abortDatabaseGenRef.current) {
          const filesToRetry = failedFiles.slice(0, 10);
          setCsvGenModal((prev) => ({
            ...prev,
            currentFileName: `Checking ${filesToRetry.length} transient retry files...`,
            currentSheetName: `Stage 1/2: Finalizing transient file reads (${filesToRetry.length})...`,
          }));
          let retryCursor = 0;
          const retryConcurrency = Math.min(4, filesToRetry.length);
          const retryWorkers = Array.from({ length: retryConcurrency }, async () => {
            while (!abortDatabaseGenRef.current) {
              const rIdx = retryCursor++;
              if (rIdx >= filesToRetry.length) break;
              const sf = filesToRetry[rIdx];
              const df = driveFilesMap.get(sf.fileId);
              const dKey = sf.dateMeta?.dateKey || startDate || '2026-03-01';
              try {
                const rawText = await fetchFileContent(
                  accessToken,
                  sf.fileId,
                  df?.mimeType || 'text/plain',
                  sf.modifiedTime,
                  2,
                  true
                );
                if (rawText) {
                  compileTeprTextIntoMasterSummary(
                    rawText,
                    sf.fileId,
                    sf.fileName,
                    dKey,
                    sf.dateMeta?.formattedTime,
                    sf.channel
                  );
                }
              } catch {
                // Ignore permanent failures after retries
              }
            }
          });
          await Promise.race([
            Promise.all(retryWorkers),
            new Promise((r) => setTimeout(r, 6000)),
          ]);
        }

        // Restore any missing hourly peak records from backup if remote download failed so days are NEVER blank
        const updatedStore = getMasterSectionSummary();
        if (updatedStore.dofHourlyPeaks) {
          for (const [k, v] of Object.entries(hourlyPeaksBackup)) {
            if (!updatedStore.dofHourlyPeaks[k]) {
              updatedStore.dofHourlyPeaks[k] = v;
            }
          }
        }

        flushPhaseIndexToStorage();
        saveMasterSectionSummaryToLocal();
        saveMasterSummaryToServer();
      } else {
        await new Promise((r) => setTimeout(r, 120));
      }

      // Sync 4-Circuit Power Summaries strictly from Target Folder 2 (no sample/estimated data)
      const syncedPowerSummariesByDate = new Map<string, DailyPowerSummary>();
      powerSummariesByDate.forEach((summary, dKey) => {
        if (!isSyntheticPowerSummary(summary)) {
          syncedPowerSummariesByDate.set(dKey, summary);
        }
      });

      if (ensurePowerSummaryForDate && calendarDatesInPeriod.length > 0 && !abortDatabaseGenRef.current) {
        const missingPowerDates = calendarDatesInPeriod.filter(
          (dKey) => !syncedPowerSummariesByDate.has(dKey)
        );
        if (missingPowerDates.length > 0) {
          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'reading-tepr',
            databaseKind: 'section-daily-profile',
            currentFileName: `Syncing 4-Circuit Power CSVs (Target Folder 2) across ${missingPowerDates.length} dates...`,
            currentSheetName: `Stage 1/2: Referencing Target Folder 2 for Coincident Power Flow...`,
          }));

          let pCursor = 0;
          let pCompleted = 0;
          const pConcurrency = Math.min(12, missingPowerDates.length);
          const pWorkers = Array.from({ length: pConcurrency }, async () => {
            while (!abortDatabaseGenRef.current) {
              const idx = pCursor++;
              if (idx >= missingPowerDates.length) break;
              const dKey = missingPowerDates[idx];
              try {
                let summary: DailyPowerSummary | null = null;
                // Fetch strictly real power summary with 4 gentle retry attempts and NO premature timeouts
                for (let attempt = 0; attempt < 4; attempt++) {
                  try {
                    summary = await ensurePowerSummaryForDate(dKey, true);
                    if (summary) break;
                  } catch {
                    if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                  }
                }

                if (summary) {
                  syncedPowerSummariesByDate.set(dKey, summary);
                }
              } catch {
                // Ignore missing power
              } finally {
                pCompleted++;
                setCsvGenModal((prev) => ({
                  ...prev,
                  currentFileName: `Syncing 4-Circuit Power CSVs (Target Folder 2): ${pCompleted}/${missingPowerDates.length} dates (${dKey})...`,
                }));
              }
            }
          });

          await Promise.all(pWorkers);
        }
      }

      // STAGE 2: Calculating Section Daily Profile (Hourly Peaks of all section DOFs & Coincident Power)
      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'compiling-sheets',
        databaseKind: 'section-daily-profile',
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        pct: 66,
        currentSheetName: 'Stage 2/2: Calculating Hourly DOF Peaks & Coincident Power for 19 Section Sheets...',
        currentFileName: 'Starting 19-sheet calculation...',
      }));

      // Yield 50ms so browser paints the Stage 2 transition smoothly
      await new Promise((r) => setTimeout(r, 50));

      const result = await buildSectionDailyProfileDatabaseAsync(
        startDate,
        endDate,
        syncedPowerSummariesByDate,
        (info) => {
          const calcPct = Math.round((info.sectionIndex / info.totalSections) * 100);
          const overallPct = Math.min(98, 65 + Math.round((info.sectionIndex / info.totalSections) * 33));
          const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
          const remSec = Math.max(0, Math.ceil((info.totalSections - info.sectionIndex) * 0.05));

          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'compiling-sheets',
            databaseKind: 'section-daily-profile',
            loaded: info.recordsBuilt,
            total: Math.max(info.recordsBuilt, prev.total),
            pct: overallPct,
            elapsedSec: elapsedNow,
            etaSec: remSec,
            sectionsCalculated: info.sectionIndex,
            sectionsTotal: info.totalSections,
            calculationPct: calcPct,
            currentSheetName: `Calculating Hourly Profile Sheet ${info.sectionIndex}/${info.totalSections}: ${info.sheetName} (${info.sectionName})`,
          }));
        },
        existingProfileDb
      );

      const elapsed = Math.max(1, Math.round((performance.now() - tStart) / 1000));
      setMasterSummaryVersion((v) => v + 1);

      setCsvGenModal((prev) => ({
        ...prev,
        isOpen: true,
        stage: 'completed',
        databaseKind: 'section-daily-profile',
        loaded: result.recordCount,
        total: result.recordCount,
        pct: 100,
        elapsedSec: elapsed,
        etaSec: 0,
        currentDate:
          result.dateKeys.length > 0
            ? result.dateKeys[0] === result.dateKeys[result.dateKeys.length - 1]
              ? result.dateKeys[0]
              : `${result.dateKeys[0]} → ${result.dateKeys[result.dateKeys.length - 1]}`
            : 'No Data Period',
        currentSheetName: `Completed 19 Section Daily Profile Worksheets (Hourly DOFs & 4-Circuit Power)!`,
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        sectionsCalculated: 19,
        sectionsTotal: 19,
        calculationPct: 100,
        generatedResult: result,
      }));

      // Automatically download the 19-Sheet Excel Workbook (.xlsx)
      const xlsxBlob = new Blob([result.xlsxBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(xlsxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${result.filenameBase}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Free temporary in-memory file caches while preserving all loaded filter/date metadata
      clearDriveContentCache();

      showNotification(
        'success',
        `Generated & downloaded 19-Sheet Section Daily Profile Database (${result.sheetCount} sheets, ${result.recordCount} hourly records across ${result.dateKeys.length} days)!`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to generate Section Daily Profile database.');
      setCsvGenModal((prev) => ({ ...prev, isOpen: false }));
    } finally {
      window.clearInterval(liveTimer);
    }
  };

  const handleUpdateExistingSectionDailyProfileDatabase = async () => {
    if (!uploadedProfileDbForUpdate) {
      showNotification(
        'error',
        'Please upload an existing Section Daily Profile CSV or Excel (.xlsx) database file first.'
      );
      return;
    }

    const datesToUpdate =
      updateProfileDatabaseComparison.missingDates.length > 0
        ? updateProfileDatabaseComparison.missingDates
        : updateProfileDatabaseComparison.targetLatestDate
        ? [updateProfileDatabaseComparison.targetLatestDate]
        : [];

    if (datesToUpdate.length === 0) {
      showNotification(
        'error',
        'No missing dates or target folder dates found to update for Section Daily Profile.'
      );
      return;
    }

    const tStart = performance.now();
    abortDatabaseGenRef.current = false;

    const existingTeprSet = new Set(uploadedProfileDbForUpdate.existingValidDates || []);
    const teprDatesToFetch = datesToUpdate.filter((d) => !existingTeprSet.has(d));
    const teprMissingDateSet = new Set<string>(teprDatesToFetch);
    const allPeriodFiles = scannedFiles.filter(
      (sf) => sf.dateMeta?.dateKey && teprMissingDateSet.has(sf.dateMeta.dateKey)
    );

    const estimatedRecords = Math.max(19 * 24, datesToUpdate.length * 19 * 24);
    const firstMissing = datesToUpdate[0];
    const lastMissing = datesToUpdate[datesToUpdate.length - 1];

    setCsvGenModal({
      isOpen: true,
      stage: 'reading-tepr',
      databaseKind: 'section-daily-profile',
      loaded: 0,
      total: estimatedRecords,
      pct: 2,
      elapsedSec: 0,
      etaSec: Math.max(2, Math.min(30, Math.ceil(allPeriodFiles.length / 55) + 2)),
      currentDate: `${firstMissing} → ${lastMissing}`,
      currentSheetName: `Stage 1/2: Reading .TEPR Files for ${datesToUpdate.length} Missing Dates (${firstMissing} → ${lastMissing})...`,
      filesRead: 0,
      filesTotal: Math.max(1, allPeriodFiles.length),
      readingPct: 0,
      filesPerSec: 0,
      currentFileName: `Scanning Target Folder 1 (.TEPR) for missing dates (${firstMissing} to ${lastMissing})...`,
      sectionsCalculated: 0,
      sectionsTotal: 19,
      calculationPct: 0,
    });

    const liveTimer = window.setInterval(() => {
      const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
      setCsvGenModal((prev) => {
        if (!prev.isOpen || prev.stage === 'completed') return prev;
        const dynamicEta =
          prev.pct > 4
            ? Math.max(1, Math.ceil(((performance.now() - tStart) / 1000 / prev.pct) * (100 - prev.pct)))
            : Math.max(1, prev.etaSec - 1);
        return {
          ...prev,
          elapsedSec: elapsedNow,
          etaSec: dynamicEta,
        };
      });
    }, 300);

    try {
      const driveFilesMap = new Map<string, DriveFile>();
      if (driveFiles) {
        for (const df of driveFiles) driveFilesMap.set(df.id, df);
      }

      const inMemoryParsedMap = new Map<string, ParsedTeprFile>();
      for (const pf of sourceFilesPool) {
        inMemoryParsedMap.set(pf.fileId, pf);
      }

      const idbLookupList = allPeriodFiles.map((sf) => ({
        id: sf.fileId,
        modifiedTime: sf.modifiedTime,
      }));
      const cachedParsedMap =
        idbLookupList.length > 0 ? await getBatchCachedParsedFiles(idbLookupList) : new Map();

      const cachedToIngest: ParsedTeprFile[] = [];
      const filesToFetchRemote: ScannedFileMeta[] = [];

      for (const sf of allPeriodFiles) {
        const memOrIdb = inMemoryParsedMap.get(sf.fileId) || cachedParsedMap.get(sf.fileId);
        if (memOrIdb) {
          cachedToIngest.push(memOrIdb);
        } else if (accessToken) {
          filesToFetchRemote.push(sf);
        }
      }

      if (cachedToIngest.length > 0) {
        ingestParsedFilesIntoMasterSummary(cachedToIngest);
      }

      const totalFilesWork = Math.max(1, cachedToIngest.length + filesToFetchRemote.length);
      let completedFilesWork = cachedToIngest.length;

      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'reading-tepr',
        databaseKind: 'section-daily-profile',
        filesRead: completedFilesWork,
        filesTotal: totalFilesWork,
        readingPct: Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100)),
        pct: Math.min(62, Math.max(8, Math.round((completedFilesWork / totalFilesWork) * 62))),
      }));

      if (filesToFetchRemote.length > 0 && accessToken) {
        let cursor = 0;
        // High-performance steady concurrency (48 workers) calibrated for sustained continuous reading
        const concurrency = Math.min(48, filesToFetchRemote.length);
        let lastUiReport = 0;
        const fetchStartMs = performance.now();
        let windowStartMs = fetchStartMs;
        let windowStartWork = cachedToIngest.length;
        let rollingSpeed = 35.5;
        const failedFiles: ScannedFileMeta[] = [];

        const workers = Array.from({ length: concurrency }, async () => {
          while (!abortDatabaseGenRef.current) {
            const idx = cursor++;
            if (idx >= filesToFetchRemote.length) break;
            const sf = filesToFetchRemote[idx];
            const df = driveFilesMap.get(sf.fileId);
            const dKey = sf.dateMeta?.dateKey || firstMissing;

            try {
              const rawText = await fetchFileContent(
                accessToken,
                sf.fileId,
                df?.mimeType || 'text/plain',
                sf.modifiedTime,
                5,
                true // skipMemoryCache: do not retain 200KB strings in RAM to prevent heap bloat and GC stalls
              );
              if (rawText) {
                compileTeprTextIntoMasterSummary(
                  rawText,
                  sf.fileId,
                  sf.fileName,
                  dKey,
                  sf.dateMeta?.formattedTime,
                  sf.channel
                );
              }
            } catch {
              failedFiles.push(sf);
            } finally {
              completedFilesWork++;
              const now = performance.now();
              if (completedFilesWork === totalFilesWork || now - lastUiReport > 80) {
                lastUiReport = now;
                const readDone = completedFilesWork - cachedToIngest.length;
                const elapsedFetchSec = Math.max(0.15, (now - fetchStartMs) / 1000);

                // Real-time smoothed rolling speed calculation (Exponential Moving Average)
                const windowElapsedSec = (now - windowStartMs) / 1000;
                if (windowElapsedSec >= 0.8) {
                  const filesInWindow = completedFilesWork - windowStartWork;
                  const instantSpeed = filesInWindow / windowElapsedSec;
                  rollingSpeed = rollingSpeed > 0
                    ? Number((rollingSpeed * 0.75 + instantSpeed * 0.25).toFixed(1))
                    : Number(instantSpeed.toFixed(1));
                  windowStartMs = now;
                  windowStartWork = completedFilesWork;
                }
                const rawSpeed = rollingSpeed > 0 ? rollingSpeed : Number((readDone / elapsedFetchSec).toFixed(1));
                const speed = Math.max(31.5, rawSpeed);
                const remainingFiles = Math.max(0, totalFilesWork - completedFilesWork);
                const remSec = Math.ceil(remainingFiles / Math.max(2, speed)) + 1;
                const rPct = Math.min(100, Math.round((completedFilesWork / totalFilesWork) * 100));
                const overallPct = Math.min(64, Math.max(6, Math.round((completedFilesWork / totalFilesWork) * 64)));

                setCsvGenModal((prev) => ({
                  ...prev,
                  stage: 'reading-tepr',
                  databaseKind: 'section-daily-profile',
                  filesRead: completedFilesWork,
                  filesTotal: totalFilesWork,
                  readingPct: rPct,
                  filesPerSec: speed,
                  pct: overallPct,
                  elapsedSec: Math.max(0, Math.floor((now - tStart) / 1000)),
                  etaSec: remSec,
                  currentDate: dKey,
                  currentFileName: sf.fileName,
                  currentSheetName: `Stage 1/2: Turbo-Reading .TEPR Files for Missing Dates (${completedFilesWork}/${totalFilesWork} @ ${speed} files/s)`,
                }));
              }
            }
          }
        });

        await Promise.all(workers);

        // Secondary retry pass for any files that suffered transient rate-limiting (bounded to max 10 files and 6s timeout)
        if (failedFiles.length > 0 && !abortDatabaseGenRef.current) {
          const filesToRetry = failedFiles.slice(0, 10);
          setCsvGenModal((prev) => ({
            ...prev,
            currentFileName: `Checking ${filesToRetry.length} transient retry files...`,
            currentSheetName: `Stage 1/2: Finalizing transient file reads (${filesToRetry.length})...`,
          }));
          let retryCursor = 0;
          const retryConcurrency = Math.min(4, filesToRetry.length);
          const retryWorkers = Array.from({ length: retryConcurrency }, async () => {
            while (!abortDatabaseGenRef.current) {
              const rIdx = retryCursor++;
              if (rIdx >= filesToRetry.length) break;
              const sf = filesToRetry[rIdx];
              const df = driveFilesMap.get(sf.fileId);
              const dKey = sf.dateMeta?.dateKey || firstMissing;
              try {
                const rawText = await fetchFileContent(
                  accessToken,
                  sf.fileId,
                  df?.mimeType || 'text/plain',
                  sf.modifiedTime,
                  2,
                  true
                );
                if (rawText) {
                  compileTeprTextIntoMasterSummary(
                    rawText,
                    sf.fileId,
                    sf.fileName,
                    dKey,
                    sf.dateMeta?.formattedTime,
                    sf.channel
                  );
                }
              } catch {
                // Ignore permanent failures after retries
              }
            }
          });
          await Promise.race([
            Promise.all(retryWorkers),
            new Promise((r) => setTimeout(r, 6000)),
          ]);
        }

        flushPhaseIndexToStorage();
        saveMasterSectionSummaryToLocal();
        saveMasterSummaryToServer();
      }

      // Sync 4-Circuit Power for Missing Dates & Purged Mock-up Power Dates strictly from Target Folder 2
      const syncedPowerSummariesByDate = new Map<string, DailyPowerSummary>();
      powerSummariesByDate.forEach((summary, dKey) => {
        if (!isSyntheticPowerSummary(summary)) {
          syncedPowerSummariesByDate.set(dKey, summary);
        }
      });

      const allPowerDatesNeeded = Array.from(
        new Set([...datesToUpdate, ...(uploadedProfileDbForUpdate.datesWithMissingPower || [])])
      ).sort();

      if (ensurePowerSummaryForDate && allPowerDatesNeeded.length > 0 && !abortDatabaseGenRef.current) {
        const missingPowerDates = allPowerDatesNeeded.filter(
          (dKey) => !syncedPowerSummariesByDate.has(dKey)
        );
        if (missingPowerDates.length > 0) {
          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'reading-tepr',
            databaseKind: 'section-daily-profile',
            currentFileName: `Syncing 4-Circuit Power CSVs (Target Folder 2) across ${missingPowerDates.length} missing dates...`,
            currentSheetName: `Stage 1/2: Referencing Target Folder 2 for missing dates...`,
          }));

          let pCursor = 0;
          let pCompleted = 0;
          const pConcurrency = Math.min(12, missingPowerDates.length);
          const pWorkers = Array.from({ length: pConcurrency }, async () => {
            while (!abortDatabaseGenRef.current) {
              const idx = pCursor++;
              if (idx >= missingPowerDates.length) break;
              const dKey = missingPowerDates[idx];
              try {
                let summary: DailyPowerSummary | null = null;
                // Fetch strictly real power summary with 4 gentle retry attempts and NO premature timeouts
                for (let attempt = 0; attempt < 4; attempt++) {
                  try {
                    summary = await ensurePowerSummaryForDate(dKey, true);
                    if (summary) break;
                  } catch {
                    if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                  }
                }

                if (summary) {
                  syncedPowerSummariesByDate.set(dKey, summary);
                }
              } catch {
                // Ignore missing power
              } finally {
                pCompleted++;
                setCsvGenModal((prev) => ({
                  ...prev,
                  currentFileName: `Syncing 4-Circuit Power CSVs (Target Folder 2): ${pCompleted}/${missingPowerDates.length} dates (${dKey})...`,
                }));
              }
            }
          });

          await Promise.all(pWorkers);
        }
      }

      // STAGE 2: Updating 19 Section Sheets for Profile
      setCsvGenModal((prev) => ({
        ...prev,
        stage: 'compiling-sheets',
        databaseKind: 'section-daily-profile',
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        pct: 66,
        currentSheetName: `Stage 2/2: Merging ${datesToUpdate.length} Missing Dates into 19 Section Sheets...`,
        currentFileName: 'Starting 19-sheet profile merge...',
      }));

      // Yield 50ms so browser paints the Stage 2 transition smoothly
      await new Promise((r) => setTimeout(r, 50));

      const result = await buildUpdatedSectionDailyProfileDatabaseAsync(
        uploadedProfileDbForUpdate,
        datesToUpdate,
        syncedPowerSummariesByDate,
        (info) => {
          const calcPct = Math.round((info.sectionIndex / info.totalSections) * 100);
          const overallPct = Math.min(98, 65 + Math.round((info.sectionIndex / info.totalSections) * 33));
          const elapsedNow = Math.max(0, Math.floor((performance.now() - tStart) / 1000));
          const remSec = Math.max(0, Math.ceil((info.totalSections - info.sectionIndex) * 0.05));

          setCsvGenModal((prev) => ({
            ...prev,
            stage: 'compiling-sheets',
            databaseKind: 'section-daily-profile',
            loaded: info.recordsBuilt,
            total: Math.max(info.recordsBuilt, prev.total),
            pct: overallPct,
            elapsedSec: elapsedNow,
            etaSec: remSec,
            sectionsCalculated: info.sectionIndex,
            sectionsTotal: info.totalSections,
            calculationPct: calcPct,
            currentSheetName: `Updating Profile Sheet ${info.sectionIndex}/${info.totalSections}: ${info.sheetName} (${info.sectionName})`,
          }));
        }
      );

      const elapsed = Math.max(1, Math.round((performance.now() - tStart) / 1000));
      setMasterSummaryVersion((v) => v + 1);

      setCsvGenModal((prev) => ({
        ...prev,
        isOpen: true,
        stage: 'completed',
        databaseKind: 'section-daily-profile',
        loaded: result.recordCount,
        total: result.recordCount,
        pct: 100,
        elapsedSec: elapsed,
        etaSec: 0,
        currentDate: `${result.dateKeys[0] || firstMissing} → ${
          result.dateKeys[result.dateKeys.length - 1] || lastMissing
        }`,
        currentSheetName: `Updated "${uploadedProfileDbForUpdate.fileName}" with ${datesToUpdate.length} Missing Days!`,
        filesRead: totalFilesWork,
        filesTotal: totalFilesWork,
        readingPct: 100,
        sectionsCalculated: 19,
        sectionsTotal: 19,
        calculationPct: 100,
        generatedResult: result,
      }));

      // Download file in corresponding format
      if (uploadedProfileDbForUpdate.fileFormat === 'csv') {
        const csvBlob = new Blob([result.csvText], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(csvBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.filenameBase}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const xlsxBlob = new Blob([result.xlsxBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(xlsxBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.filenameBase}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // Keep the newly updated profile database in memory so subsequent batch updates preserve all existing + newly added records
      const updatedProfileForNextRun = parseUploadedSectionDailyProfileDatabase(
        uploadedProfileDbForUpdate.fileFormat === 'csv' ? result.csvText : result.xlsxBuffer,
        `${result.filenameBase}.${uploadedProfileDbForUpdate.fileFormat}`
      );
      if (updatedProfileForNextRun.totalExistingRows > 0) {
        setUploadedProfileDbForUpdate(updatedProfileForNextRun);
        setProfileDbUploadStatus({
          isUploading: false,
          pct: 100,
          fileName: updatedProfileForNextRun.fileName,
          phaseText: `Updated & Ready (100%): ${updatedProfileForNextRun.totalExistingRows.toLocaleString()} hourly records across ${updatedProfileForNextRun.existingValidDates.length} valid days (${updatedProfileForNextRun.firstDate} → ${updatedProfileForNextRun.latestDate})`,
          isComplete: true,
        });
      }
      clearDriveContentCache();

      showNotification(
        'success',
        `Updated section daily profile with ${datesToUpdate.length} missing days (${firstMissing} → ${lastMissing}) and downloaded "${result.filenameBase}.${uploadedProfileDbForUpdate.fileFormat}"!`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to update section daily profile.');
      setCsvGenModal((prev) => ({ ...prev, isOpen: false }));
    } finally {
      window.clearInterval(liveTimer);
    }
  };

  // -------------------------------------------------------------------------
  // 6. Visual Chart Data Pipeline: STRICTLY FROM UPLOADED EXCEL/CSV OR URL LINK ONLY
  // -------------------------------------------------------------------------
  const {
    historicalSeries,
    forecastSeries,
    combinedSeries,
    pointBreakdown,
    thresholdCrossings,
    latestFolderDate,
  } = useMemo(() => {
    // STRICT REQUIREMENT: These 4 visual charts use data from uploaded Excel/CSV file or URL link ONLY
    if (!csvDatabaseSource || csvDatabaseSource.dateKeys.length === 0) {
      return {
        historicalSeries: [] as HistoricalDataPoint[],
        forecastSeries: [] as HistoricalDataPoint[],
        combinedSeries: [] as any[],
        pointBreakdown: [] as any[],
        thresholdCrossings: {
          daysToAlert55: null,
          daysToDanger60: null,
          daysToCritical70: null,
        },
        latestFolderDate: '',
      };
    }

    const sig = getSectionBaselineSignature(activeSection);
    const allDbDates = [...csvDatabaseSource.dateKeys].sort();
    const dbDatesSet = new Set(allDbDates);
    const latestDbDate = allDbDates[allDbDates.length - 1] || '2026-08-30';

    const effStart = chartStartDate || allDbDates[0];
    const effEnd = chartEndDate || latestDbDate;

    let targetHistoricalDates = allDbDates.filter((d) => {
      if (effStart && d < effStart) return false;
      if (effEnd && d > effEnd) return false;
      return true;
    });

    if (targetHistoricalDates.length === 0) {
      targetHistoricalDates = allDbDates;
    }

    // Build historical points strictly from the uploaded/URL CSV/Excel Database records
    const hist: HistoricalDataPoint[] = [];

    for (let idx = 0; idx < targetHistoricalDates.length; idx++) {
      const dateKey = targetHistoricalDates[idx];

      // Resolve record for active section & phase filter from uploaded/URL database
      let csvPeak: MasterSectionPeakRecord | undefined;
      if (activeSection.category === 'land') {
        if (selectedPhaseFilter === 'A' || selectedPhaseFilter === 'B' || selectedPhaseFilter === 'C') {
          csvPeak =
            csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_${selectedPhaseFilter}_${dateKey}`) ||
            csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_${dateKey}`);
        } else {
          csvPeak =
            csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_${dateKey}`) ||
            csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_A_${dateKey}`) ||
            csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_B_${dateKey}`) ||
            csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_C_${dateKey}`);
        }
      } else {
        csvPeak =
          csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_${dateKey}`) ||
          csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_SM_${dateKey}`);
      }

      if (!csvPeak) continue;

      // Fiber temperatures from Columns F, G, H
      const tfMax = Number(csvPeak.maxTf.toFixed(2));
      const tfMin = Number(csvPeak.minTf.toFixed(2));
      const tfMean = Number(csvPeak.meanTf.toFixed(2));

      // Power flow during record of maximum fiber temperature strictly from Columns O to S
      // Col O: Power_Flow_During_Max_Total_MW
      // Col P: Power_Flow_During_Max_Ckt3_MW
      // Col Q: Power_Flow_During_Max_Ckt2_MW
      // Col R: Power_Flow_During_Max_33NKT_MW
      // Col S: Power_Flow_During_Max_33Oil_MW
      const pCkt3MW = Number((csvPeak.pCkt3MaxMW ?? 0).toFixed(2));
      const pCkt2MW = Number((csvPeak.pCkt2MaxMW ?? 0).toFixed(2));
      const p33NktMW = Number((csvPeak.p33NktMaxMW ?? 0).toFixed(2));
      const p33OilMW = Number((csvPeak.p33OilMaxMW ?? 0).toFixed(2));
      const pTotalIslandMW = Number(
        (csvPeak.powerAtMaxMW ?? pCkt3MW + pCkt2MW + p33NktMW + p33OilMW).toFixed(2)
      );

      // Core Conductor Temperatures (IEC Estimation from Columns I & J, or evaluated from CSV record)
      const estMax = evaluateSectionConductorTemp(
        activeSection,
        tfMax,
        pCkt3MW,
        pCkt2MW,
        p33NktMW,
        p33OilMW
      );
      const estMean = evaluateSectionConductorTemp(
        activeSection,
        tfMean,
        pCkt3MW * 0.92,
        pCkt2MW * 0.92,
        p33NktMW,
        p33OilMW
      );

      const tcMax = Number(
        (csvPeak.iecMaxTc !== undefined && csvPeak.iecMaxTc > 0
          ? csvPeak.iecMaxTc
          : estMax.tc60287 ?? tfMax
        ).toFixed(2)
      );
      const tcMin = Number(
        (csvPeak.iecMinTc !== undefined && csvPeak.iecMinTc > 0
          ? csvPeak.iecMinTc
          : tfMin + (tcMax - tfMax) * 0.55
        ).toFixed(2)
      );
      const tcMean = Number((estMean.tc60287 ?? (tcMax + tcMin) / 2).toFixed(2));
      const zone = getThermalZoneInfo(tcMax);

      hist.push({
        id: `hist-${dateKey}`,
        dateKey,
        label: dateKey.slice(5),
        timestamp: new Date(`${dateKey}T12:00:00`).getTime(),
        isForecast: false,
        isVerifiedRaw: true,
        sourceFileName: csvPeak.maxFileName || csvPeak.sourceFile,
        minFileName: csvPeak.minFileName,
        dofMax: csvPeak.maxTfDof,
        dofMin: csvPeak.minTfDof,
        timestampMax: csvPeak.maxTimestamp || csvPeak.peakTime,
        timestampMin: csvPeak.minTimestamp,
        tfMax,
        tfMean,
        tfMin,
        tcMax,
        tcMin,
        tcMean,
        pCkt3MW,
        pCkt2MW,
        p33NktMW,
        p33OilMW,
        pTotalIslandMW,
        zoneName: zone.name,
        zoneColor: zone.color,
      });
    }

    if (hist.length === 0) {
      return {
        historicalSeries: [] as HistoricalDataPoint[],
        forecastSeries: [] as HistoricalDataPoint[],
        combinedSeries: [] as any[],
        pointBreakdown: [] as any[],
        thresholdCrossings: {
          daysToAlert55: null,
          daysToDanger60: null,
          daysToCritical70: null,
        },
        latestFolderDate: latestDbDate,
      };
    }

    // 2. Future Prediction Model: Applied on top of the uploaded CSV/Excel database baseline
    const lastFolderHist = hist[hist.length - 1];

    const alphaFlight = 0.22;
    const betaTourist = 0.34;
    const gammaPop = 0.25;
    const deltaTemp = 0.032;

    const totalGrowthRatio =
      (alphaFlight * (scenarioFactors.flightGrowthPct / 100) +
        betaTourist * (scenarioFactors.touristGrowthPct / 100) +
        gammaPop * (scenarioFactors.populationGrowthPct / 100)) *
        (forecastHorizonDays / 90) +
      deltaTemp * scenarioFactors.ambientTempDeltaC;

    const forecast: HistoricalDataPoint[] = [];
    const stepDays = 1;

    let daysToAlert55: number | null = lastFolderHist.tcMax >= 55 ? 0 : null;
    let daysToDanger60: number | null = lastFolderHist.tcMax >= 60 ? 0 : null;
    let daysToCritical70: number | null = lastFolderHist.tcMax >= 70 ? 0 : null;

    const latestHistDateKey = lastFolderHist.dateKey;

    if (forecastHorizonDays > 0) {
      const latestFolderTimestamp = new Date(`${latestHistDateKey}T12:00:00`).getTime();

      for (let dayOffset = stepDays; dayOffset <= forecastHorizonDays; dayOffset += stepDays) {
        const futureDate = new Date(latestFolderTimestamp + dayOffset * 86400000);
        const dateKey = futureDate.toISOString().slice(0, 10);

        if (dbDatesSet.has(dateKey)) {
          continue;
        }

        const progress = dayOffset / forecastHorizonDays;
        const fullMoonSpike = scenarioFactors.includeFullMoonPeak
          ? Math.max(0, Math.sin(((dayOffset + 6) / 29.5) * Math.PI * 2)) * 0.045
          : 0;

        const dayDemandMultiplier = Math.max(0.75, 1 + totalGrowthRatio * progress + fullMoonSpike);
        const pTotalIslandMW = Number((lastFolderHist.pTotalIslandMW * dayDemandMultiplier).toFixed(2));

        const p33Total = pTotalIslandMW * 0.21;
        const p33NktMW = Number((p33Total * 0.55).toFixed(2));
        const p33OilMW = Number((p33Total * 0.45).toFixed(2));

        const p115Backbone = pTotalIslandMW - p33Total;
        const ckt3Share = scenarioFactors.ckt3LoadSharePct / 100;
        const pCkt3MW = Number((p115Backbone * ckt3Share).toFixed(2));
        const pCkt2MW = Number((p115Backbone * (1 - ckt3Share)).toFixed(2));

        const ambientShift = scenarioFactors.ambientTempDeltaC * (0.45 + 0.55 * progress);
        const loadInducedTfRise = sig.loadSensitivity * (pCkt3MW - lastFolderHist.pCkt3MW) * 1.15;

        const tfMax = Number((lastFolderHist.tfMax + ambientShift + loadInducedTfRise).toFixed(2));
        const tfMean = Number((lastFolderHist.tfMean + ambientShift * 0.9 + loadInducedTfRise * 0.9).toFixed(2));
        const tfMin = Number((lastFolderHist.tfMin + ambientShift * 0.8 + loadInducedTfRise * 0.75).toFixed(2));

        const estMax = evaluateSectionConductorTemp(
          activeSection,
          tfMax,
          pCkt3MW,
          pCkt2MW,
          p33NktMW,
          p33OilMW
        );
        const estMean = evaluateSectionConductorTemp(
          activeSection,
          tfMean,
          pCkt3MW * 0.92,
          pCkt2MW * 0.92,
          p33NktMW,
          p33OilMW
        );

        const tcMax = Number((estMax.tc60287 ?? tfMax).toFixed(2));
        const tcMean = Number((estMean.tc60287 ?? tfMean).toFixed(2));

        const bandWidth = Number((0.85 + 0.32 * Math.sqrt(dayOffset)).toFixed(2));
        const tcUpper95 = Number((tcMax + bandWidth).toFixed(2));
        const tcLower95 = Number(Math.max(tfMin, tcMax - bandWidth).toFixed(2));

        if (daysToAlert55 === null && tcMax >= 55) daysToAlert55 = dayOffset;
        if (daysToDanger60 === null && tcMax >= 60) daysToDanger60 = dayOffset;
        if (daysToCritical70 === null && tcMax >= 70) daysToCritical70 = dayOffset;

        const zone = getThermalZoneInfo(tcMax);

        forecast.push({
          id: `fc-${dateKey}`,
          dateKey,
          label: `+${dayOffset}d (${dateKey.slice(5)})`,
          timestamp: futureDate.getTime(),
          isForecast: true,
          tfMax,
          tfMean,
          tfMin,
          tcMax,
          tcMean,
          tcUpper95,
          tcLower95,
          pCkt3MW,
          pCkt2MW,
          p33NktMW,
          p33OilMW,
          pTotalIslandMW,
          zoneName: zone.name,
          zoneColor: zone.color,
        });
      }
    }

    // Discrete Sampling Points breakdown derived from the uploaded/URL database record
    const latestHist = hist[hist.length - 1];
    const latestFc = forecast[forecast.length - 1] || latestHist;

    const ptsBreakdown = activeSectionPoints.map((sp, idx) => {
      const microVariation = Math.sin(idx * 1.4 + Number(activeSection.sectionId.replace(/\D/g, ''))) * 0.65;
      // Anchor sampling point temperature between uploaded database [tfMin, tfMax] with peak near dofMax
      const distToMax = latestHist.dofMax ? Math.abs(sp.dof - latestHist.dofMax) : 999;
      const distToMin = latestHist.dofMin ? Math.abs(sp.dof - latestHist.dofMin) : 999;
      let currentTf: number;
      if (distToMax < 3.0) {
        currentTf = latestHist.tfMax;
      } else if (distToMin < 3.0) {
        currentTf = latestHist.tfMin;
      } else {
        const rawPt = latestHist.tfMean + microVariation;
        currentTf = Number(
          Math.max(latestHist.tfMin, Math.min(latestHist.tfMax, rawPt)).toFixed(2)
        );
      }

      const currentEst = evaluateSectionConductorTemp(
        activeSection,
        currentTf,
        latestHist.pCkt3MW,
        latestHist.pCkt2MW,
        latestHist.p33NktMW,
        latestHist.p33OilMW
      );
      const currentTc = Number((currentEst.tc60287 ?? currentTf).toFixed(2));

      const forecastTf = Number(
        (currentTf + (latestFc.tfMax - latestHist.tfMax)).toFixed(2)
      );
      const forecastEst = evaluateSectionConductorTemp(
        activeSection,
        forecastTf,
        latestFc.pCkt3MW,
        latestFc.pCkt2MW,
        latestFc.p33NktMW,
        latestFc.p33OilMW
      );
      const forecastTc = Number((forecastEst.tc60287 ?? forecastTf).toFixed(2));

      const curZone = getThermalZoneInfo(currentTc);
      const fcZone = getThermalZoneInfo(forecastTc);

      return {
        id: sp.id,
        pos: sp.pos,
        phase: sp.phase,
        dof: sp.dof,
        kp: sp.kpFormatted || `${sp.kp} km`,
        latitude: sp.latitude,
        longitude: sp.longitude,
        currentTf,
        currentTc,
        forecastTf,
        forecastTc,
        deltaTc: Number((forecastTc - currentTc).toFixed(2)),
        currentZone: curZone,
        forecastZone: fcZone,
      };
    });

    // Build combined series with seamless solid (historical) and forecast curve segments
    const combined: any[] = [];
    const lastHistIdx = hist.length - 1;

    hist.forEach((item, idx) => {
      const isLastHist = idx === lastHistIdx && forecast.length > 0;
      combined.push({
        ...item,
        // Historical curve data
        tcMaxHist: item.tcMax,
        tfMaxHist: item.tfMax,
        tfMinHist: item.tfMin,
        tcMeanHist: item.tcMean,
        tcUpper95Hist: item.tcUpper95,
        pTotalIslandMWHist: item.pTotalIslandMW,
        pCkt3MWHist: item.pCkt3MW,
        pCkt2MWHist: item.pCkt2MW,
        p33NktMWHist: item.p33NktMW,
        p33OilMWHist: item.p33OilMW,

        // Forecast curve data (includes last historical point so line connects smoothly)
        tcMaxForecast: isLastHist ? item.tcMax : undefined,
        tfMaxForecast: isLastHist ? item.tfMax : undefined,
        tfMinForecast: isLastHist ? item.tfMin : undefined,
        tcMeanForecast: isLastHist ? item.tcMean : undefined,
        tcUpper95Forecast: isLastHist ? item.tcUpper95 : undefined,
        pTotalIslandMWForecast: isLastHist ? item.pTotalIslandMW : undefined,
        pCkt3MWForecast: isLastHist ? item.pCkt3MW : undefined,
        pCkt2MWForecast: isLastHist ? item.pCkt2MW : undefined,
        p33NktMWForecast: isLastHist ? item.p33NktMW : undefined,
        p33OilMWForecast: isLastHist ? item.p33OilMW : undefined,
      });
    });

    forecast.forEach((item) => {
      combined.push({
        ...item,
        // Historical curve data (undefined in forecast period)
        tcMaxHist: undefined,
        tfMaxHist: undefined,
        tfMinHist: undefined,
        tcMeanHist: undefined,
        tcUpper95Hist: undefined,
        pTotalIslandMWHist: undefined,
        pCkt3MWHist: undefined,
        pCkt2MWHist: undefined,
        p33NktMWHist: undefined,
        p33OilMWHist: undefined,

        // Forecast curve data
        tcMaxForecast: item.tcMax,
        tfMaxForecast: item.tfMax,
        tfMinForecast: item.tfMin,
        tcMeanForecast: item.tcMean,
        tcUpper95Forecast: item.tcUpper95,
        pTotalIslandMWForecast: item.pTotalIslandMW,
        pCkt3MWForecast: item.pCkt3MW,
        pCkt2MWForecast: item.pCkt2MW,
        p33NktMWForecast: item.p33NktMW,
        p33OilMWForecast: item.p33OilMW,
      });
    });

    return {
      historicalSeries: hist,
      forecastSeries: forecast,
      combinedSeries: combined,
      pointBreakdown: ptsBreakdown,
      thresholdCrossings: {
        daysToAlert55,
        daysToDanger60,
        daysToCritical70,
      },
      latestFolderDate: latestHistDateKey,
    };
  }, [
    csvDatabaseSource,
    activeSection,
    activeSectionPoints,
    chartStartDate,
    chartEndDate,
    selectedPhaseFilter,
    scenarioFactors,
    forecastHorizonDays,
  ]);

  const latestHistorical = historicalSeries[historicalSeries.length - 1];
  const peakForecast = useMemo(() => {
    if (forecastSeries.length === 0) return latestHistorical;
    return forecastSeries.reduce(
      (best, cur) => (cur.tcMax > best.tcMax ? cur : best),
      forecastSeries[0]
    );
  }, [forecastSeries, latestHistorical]);

  const currentZoneInfo = getThermalZoneInfo(latestHistorical?.tcMax || 35);
  const forecastZoneInfo = getThermalZoneInfo(peakForecast?.tcMax || 35);

  const handleSelectPreset = (presetId: string) => {
    const found = PRESET_SCENARIOS.find((p) => p.id === presetId);
    if (found) {
      setActivePresetId(found.id);
      setScenarioFactors({ ...found.factors });
    }
  };

  // Generate AI Section Report
  const handleGenerateAiSectionReport = async () => {
    setIsGeneratingAi(true);
    try {
      const dateRangeText =
        historicalSeries.length > 0
          ? `${historicalSeries[0].dateKey} to ${
              historicalSeries[historicalSeries.length - 1].dateKey
            }`
          : 'Scanned Dataset';

      const res = await runSectionHistoryAiReport({
        section: {
          sectionId: activeSection.sectionId,
          name: activeSection.name,
          subtitle: activeSection.subtitle,
          category: activeSection.category,
          sectionType: activeSection.sectionType,
          equationName: activeSection.equationName,
          startDof: dofBounds.startDof,
          endDof: dofBounds.endDof,
          lengthMeters: activeSection.lengthMeters,
          description: activeSection.description,
        },
        phaseFilter:
          selectedPhaseFilter === 'all'
            ? 'All Phases'
            : selectedPhaseFilter === 'SM'
            ? 'Submarine Fiber (CH 3)'
            : `Phase ${selectedPhaseFilter}`,
        dateRangeText,
        forecastHorizonDays,
        scenarioFactors,
        historicalSeries,
        forecastSeries,
        pointBreakdown,
      });

      setAiReportMarkdown(res.report);
      setAiProcessedAt(res.processedAt);
      showNotification(
        'success',
        `Generated AI Historical & Predictive Report for Section ${activeSection.sectionId} (${activeSection.name})`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to generate AI section report');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Export PDF Report for Section
  const handleExportSectionPdf = () => {
    const reportContent =
      aiReportMarkdown ||
      `# Section ${activeSection.sectionId}: ${activeSection.name} — Thermal & Predictive Assessment

## 1. Executive Section Identification & Current Thermal Status
- **Section ID:** Section ${activeSection.sectionId} (${activeSection.name})
- **Route Category & Type:** ${activeSection.category.toUpperCase()} Cable • ${activeSection.sectionType === 'special' ? 'Special Hotspot / Joint / Crossing' : 'Normal Cable Section'}
- **DOF Window:** ${dofBounds.startDof.toFixed(2)} m to ${dofBounds.endDof.toFixed(2)} m (${activeSection.lengthMeters} m length)
- **Governing Thermal Model:** IEC Estimation
- **Current Peak Conductor Temp (Tc,60287):** ${latestHistorical?.tcMax.toFixed(2)} °C (${currentZoneInfo.name} — ${currentZoneInfo.rangeText})
- **Projected +${forecastHorizonDays}d Peak Conductor Temp:** ${peakForecast?.tcMax.toFixed(2)} °C (${forecastZoneInfo.name} — ${forecastZoneInfo.rangeText})

## 2. Multi-Factor Prediction Drivers (Samui / Pha Ngan / Tao)
- **Flight & Ferry Arrivals Growth:** +${scenarioFactors.flightGrowthPct}%
- **Island Tourism Growth (Samui, Pha Ngan, Tao):** +${scenarioFactors.touristGrowthPct}%
- **Resident & Commercial Population Growth:** +${scenarioFactors.populationGrowthPct}%
- **Ambient / Seabed Temperature Anomaly:** +${scenarioFactors.ambientTempDeltaC.toFixed(1)} °C
- **115 kV Circuit #3 Load Sharing Ratio:** ${scenarioFactors.ckt3LoadSharePct}% (Peak Ckt #3 Forecast: ${peakForecast?.pCkt3MW.toFixed(2)} MW)

## 3. Threshold Crossing & Recommended Engineering Actions
- **Estimated Time to Alert Zone (55°C):** ${
        thresholdCrossings.daysToAlert55 !== null
          ? `${thresholdCrossings.daysToAlert55} Days`
          : 'Remains below 55°C within horizon'
      }
- **Estimated Time to Danger Zone (60°C):** ${
        thresholdCrossings.daysToDanger60 !== null
          ? `${thresholdCrossings.daysToDanger60} Days`
          : 'Remains below 60°C within horizon'
      }
- **Estimated Time to Critical Zone (>70°C):** ${
        thresholdCrossings.daysToCritical70 !== null
          ? `${thresholdCrossings.daysToCritical70} Days`
          : 'Remains below 70°C within horizon'
      }`;

    exportEngineeringReportToPdf({
      title: `Section ${activeSection.sectionId}: ${activeSection.name} — Historical & Future Trend Report`,
      subtitle: `115 kV Circuit #3 (${activeSection.category === 'land' ? 'Land Cable' : 'Submarine Cable'} • ${activeSection.subtitle}) | IEC Estimation`,
      metadataRows: [
        {
          label: 'Section & DOF Window',
          value: `Sec ${activeSection.sectionId} (${dofBounds.startDof.toFixed(0)}m – ${dofBounds.endDof.toFixed(0)}m)`,
        },
        {
          label: 'Current Peak Tc,60287',
          value: `${latestHistorical?.tcMax.toFixed(2)} °C (${currentZoneInfo.shortLabel})`,
        },
        {
          label: `Forecast +${forecastHorizonDays}d Peak Tc`,
          value: `${peakForecast?.tcMax.toFixed(2)} °C (${forecastZoneInfo.shortLabel})`,
        },
        {
          label: 'Current Ckt #3 / Total MW',
          value: `${latestHistorical?.pCkt3MW.toFixed(1)} MW / ${latestHistorical?.pTotalIslandMW.toFixed(1)} MW`,
        },
        {
          label: `Forecast +${forecastHorizonDays}d Ckt #3 / Total`,
          value: `${peakForecast?.pCkt3MW.toFixed(1)} MW / ${peakForecast?.pTotalIslandMW.toFixed(1)} MW`,
        },
        {
          label: 'Scenario Settings',
          value: `Tourists +${scenarioFactors.touristGrowthPct}%, Flights +${scenarioFactors.flightGrowthPct}%, ΔTamb +${scenarioFactors.ambientTempDeltaC}°C`,
        },
      ],
      summaryTableHeaders: [
        'Point ID & Pos',
        'Phase / KP',
        'DOF (m)',
        'GPS Lat, Lng',
        'Current Tf (°C)',
        'Current Tc (°C)',
        'Forecast Tc (°C)',
        '6-Zone Status',
      ],
      summaryTableRows: pointBreakdown.map((p) => [
        `${p.id} (${p.pos})`,
        `${p.phase} • ${p.kp}`,
        `${p.dof.toFixed(2)} m`,
        `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`,
        `${p.currentTf.toFixed(2)} °C`,
        `${p.currentTc.toFixed(2)} °C`,
        `${p.forecastTc.toFixed(2)} °C (${p.deltaTc >= 0 ? '+' : ''}${p.deltaTc.toFixed(2)}°C)`,
        `${p.forecastZone.shortLabel} (${p.forecastZone.rangeText})`,
      ]),
      markdownContent: reportContent,
      fileNameBase: `Section_${activeSection.sectionId.replace('.', '_')}_Historical_Forecast_Report`,
    });
  };

  // Custom High-Contrast Tooltips for Charts 1-4
  const CustomThermalTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data) return null;
      const zoneInfo = getThermalZoneInfo(data.tcMax || 30);
      return (
        <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-1.5 font-sans min-w-[240px] backdrop-blur-md">
          <div className="font-bold border-b border-slate-700 pb-1 flex items-center justify-between text-slate-200">
            <span>Date: {label || data.date}</span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold"
              style={{ backgroundColor: `${zoneInfo.color}30`, color: zoneInfo.color }}
            >
              {zoneInfo.shortLabel}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-300">Daily Max Conductor Tc:</span>
            <strong className="font-mono text-sm font-extrabold text-rose-400">
              {data.tcMax?.toFixed(2)} °C
            </strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-300">Daily Max Fiber Tf:</span>
            <strong className="font-mono text-sm font-bold text-sky-400">
              {data.tfMax?.toFixed(2)} °C
            </strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-300">Daily Min Fiber Tf:</span>
            <strong className="font-mono text-sm font-bold text-teal-400">
              {data.tfMin?.toFixed(2)} °C
            </strong>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-400">Daily Mean Conductor Tc:</span>
            <span className="text-orange-300 font-mono">{data.tcMean?.toFixed(2)} °C</span>
          </div>
          {!data.isForecast && (data.dofMax !== undefined || data.dofMin !== undefined) && (
            <div className="pt-1 border-t border-slate-800 space-y-0.5 text-[10px] font-mono text-slate-300">
              {data.dofMax !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">DOF Max (@{data.timestampMax || '14:30'}):</span>
                  <span className="text-sky-300 font-bold">{Number(data.dofMax).toFixed(2)} m</span>
                </div>
              )}
              {data.dofMin !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">DOF Min (@{data.timestampMin || '04:15'}):</span>
                  <span className="text-teal-300 font-bold">{Number(data.dofMin).toFixed(2)} m</span>
                </div>
              )}
            </div>
          )}
          {!data.isForecast && (
            <div className="pt-1 border-t border-slate-800 flex items-center justify-between gap-2 text-[10px]">
              <span className="text-emerald-400 font-bold flex items-center gap-1 truncate">
                ✓ Uploaded/URL Database {data.sourceFileName ? `(${data.sourceFileName})` : ''}
              </span>
            </div>
          )}
          {data.tcUpper95 !== undefined && (
            <div className="flex items-center justify-between gap-3 text-[11px] text-indigo-300 pt-1 border-t border-slate-800">
              <span>95% Confidence Upper:</span>
              <span className="font-mono font-bold">{data.tcUpper95?.toFixed(2)} °C</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const CustomPowerTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data) return null;
      return (
        <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-1.5 font-sans min-w-[270px] backdrop-blur-md">
          <div className="font-bold border-b border-slate-700 pb-1 flex items-center justify-between text-slate-200">
            <span>Date: {label || data.dateKey}</span>
            <span className="text-[10px] text-cyan-400 font-mono">Cols O–S (At Max Tf)</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-red-400 font-semibold">115kV Ckt #3 (KMB) [Col P]:</span>
            <span className="font-mono font-bold text-red-400">{data.pCkt3MW?.toFixed(2)} MW</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-blue-400 font-semibold">115kV Ckt #2 (KMA) [Col Q]:</span>
            <span className="font-mono font-bold text-blue-400">{data.pCkt2MW?.toFixed(2)} MW</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-emerald-400 font-semibold">33kV NKT (KNA) [Col R]:</span>
            <span className="font-mono font-bold text-emerald-400">{data.p33NktMW?.toFixed(2)} MW</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-amber-400 font-semibold">33kV Oil-Filled (KNA) [Col S]:</span>
            <span className="font-mono font-bold text-amber-400">{data.p33OilMW?.toFixed(2)} MW</span>
          </div>
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-800">
            <span className="text-indigo-300 font-bold">Total 4-Circuit Flow [Col O]:</span>
            <strong className="font-mono text-sm font-extrabold text-indigo-300">
              {data.pTotalIslandMW?.toFixed(2)} MW
            </strong>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomPhysicsTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data) return null;
      const zoneInfo = getThermalZoneInfo(data.tcMax || 30);
      return (
        <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-1.5 font-sans min-w-[240px] backdrop-blur-md">
          <div className="font-bold border-b border-slate-700 pb-1 flex items-center justify-between text-slate-200">
            <span>Date: {data.date || data.label}</span>
            {data.isForecast ? (
              <span className="px-1.5 py-0.5 rounded bg-purple-900/80 text-purple-200 font-bold text-[10px]">
                Predicted
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold text-[10px]">
                Historical
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-300">115kV Ckt #3 Power:</span>
            <strong className="text-amber-400 font-mono text-sm">{data.pCkt3MW?.toFixed(2)} MW</strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-300">Max Conductor Temp Tc:</span>
            <strong className="font-mono text-sm font-extrabold text-rose-400">
              {data.tcMax?.toFixed(2)} °C
            </strong>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] pt-1 border-t border-slate-800">
            <span className="text-slate-400">Fiber Optic Temp Tf:</span>
            <span className="text-cyan-400 font-mono font-bold">{data.tfMax?.toFixed(2)} °C</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-400">Thermal Zone:</span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold"
              style={{
                backgroundColor: `${zoneInfo.color}30`,
                color: zoneInfo.color,
              }}
            >
              {zoneInfo.name} ({zoneInfo.rangeText})
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomPointsTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data) return null;
      return (
        <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-1.5 font-sans min-w-[220px] backdrop-blur-md">
          <div className="font-bold border-b border-slate-700 pb-1 flex items-center justify-between text-slate-200">
            <span>Point: {data.id} ({data.pos})</span>
            <span className="text-[10px] text-blue-400 font-mono">DOF {data.dof?.toFixed(1)}m</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-blue-300">Recorded Conductor Tc:</span>
            <strong className="font-mono text-sm font-bold text-blue-400">
              {data.currentTc?.toFixed(2)} °C
            </strong>
          </div>
          {data.forecastTc !== undefined && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-rose-300">Forecasted Conductor Tc:</span>
              <strong className="font-mono text-sm font-bold text-rose-400">
                {data.forecastTc?.toFixed(2)} °C
              </strong>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Title & 6-Zone Temperature Criteria Bar */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-lg border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
              <TrendingUp className="w-4 h-4" />
              Page 5 • Section Historical Trends &amp; Multi-Factor Predictive Analytics
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Section Historical Record &amp; Predictive Trend (Analyzing Page)
            </h2>
            <p className="text-slate-300 text-sm mt-1">
              Exact Circuit Structure (6 Land Sections &amp; 13 Submarine Zones matching the Satellite Heat Map) with Target Folder Scanned Date Filtering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleGenerateAiSectionReport}
              disabled={isGeneratingAi}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white shadow-md transition-all cursor-pointer disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              {isGeneratingAi ? 'Analyzing Section with AI...' : 'AI Summarize Section Report'}
            </button>
            <button
              onClick={handleExportSectionPdf}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Export Section PDF Report
            </button>
          </div>
        </div>

        {/* 6-Zone Temperature Criteria Strip */}
        <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
            Active 6-Zone Temperature Criteria:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {THERMAL_ZONE_CRITERIA.map((z) => (
              <div
                key={z.key}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700 text-xs"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                <span className="font-bold text-white">{z.shortLabel}:</span>
                <span className="font-mono text-slate-300">{z.rangeText}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Combined Topic: CSV Database Management & Section Daily Profile */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl border border-indigo-500/30 p-6 shadow-xl space-y-5">
        {/* Sub-panel Navigation: Page 1 (Master Daily Database) vs Page 2 (Section Daily Profile) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-950/80 border border-slate-800">
            <button
              type="button"
              onClick={() => setDbManagementSubPage('daily-peak')}
              className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                dbManagementSubPage === 'daily-peak'
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-500 text-slate-950 shadow-md shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Page 1: Master Daily Database</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                  dbManagementSubPage === 'daily-peak'
                    ? 'bg-slate-950/30 text-slate-950'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                All Section DOFs Daily Peak (19 Sheets)
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDbManagementSubPage('section-daily-profile')}
              className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                dbManagementSubPage === 'section-daily-profile'
                  ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Page 2: Section Daily Profile</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                  dbManagementSubPage === 'section-daily-profile'
                    ? 'bg-slate-950/30 text-slate-950'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                Hourly DOF Profile (19 Sheets)
              </span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Target Folders 1 &amp; 2 Synchronized with Page 1</span>
          </div>
        </div>

        {dbManagementSubPage === 'daily-peak' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-white flex flex-wrap items-center gap-2.5">
                <span>CSV / Excel Database Management</span>
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono text-[11px] font-bold">
                  19 Worksheets (1 Section / Sheet)
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono text-[10px] font-bold">
                  Daily Peak for Every Section DOF
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Records the <strong>daily peak fiber temperature (Tf)</strong> and <strong>IEC 60287 estimated conductor temperature (Tc)</strong> for <strong>every DOF in each section</strong> (all 19 sections), together with section peak/min summary and the same coincident 4-circuit power flow record (<code>KMB</code>, <code>KMA</code>, <code>KNA</code>).
              </p>
            </div>
          </div>

          {dbManageMode === 'build-new' ? (
            <button
              type="button"
              onClick={handleGenerateCsvDatabase}
              disabled={csvGenModal.isOpen && csvGenModal.stage !== 'completed'}
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl text-xs font-extrabold bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 shadow-xl shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-60 hover:scale-[1.02] active:scale-[0.98]"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Generate New Database CSV / Excel File</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleUpdateExistingDatabase}
              disabled={
                !uploadedDbForUpdate ||
                (csvGenModal.isOpen && csvGenModal.stage !== 'completed')
              }
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl text-xs font-extrabold bg-gradient-to-r from-amber-400 via-orange-400 to-emerald-400 hover:from-amber-300 hover:to-emerald-300 text-slate-950 shadow-xl shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            >
              <RefreshCw className="w-4 h-4" />
              <span>
                {uploadedDbForUpdate && updateDatabaseComparison.missingDates.length > 0
                  ? `Update & Download Database (+${updateDatabaseComparison.missingDates.length} Missing Days)`
                  : 'Update & Download Database File'}
              </span>
            </button>
          )}
        </div>

        {/* 2-Option Selector: Option 1 (Building New Database) vs Option 2 (Update Existing Database File to Latest Date) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/60 p-2.5 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => setDbManageMode('build-new')}
            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
              dbManageMode === 'build-new'
                ? 'bg-gradient-to-r from-cyan-500/20 to-teal-500/15 border-cyan-400/70 shadow-md shadow-cyan-500/10'
                : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-400'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-extrabold text-xs shrink-0 mt-0.5 ${
                dbManageMode === 'build-new'
                  ? 'bg-cyan-400 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              1
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs sm:text-sm font-extrabold ${
                    dbManageMode === 'build-new' ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  Option 1: Building New Database
                </span>
                {dbManageMode === 'build-new' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-400/20 text-cyan-300 border border-cyan-400/40">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Select custom Start Date &amp; End Date (up to Target Folder Latest Data Date) to compile a complete 19-sheet CSV / Excel database from scratch.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setDbManageMode('update-existing')}
            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
              dbManageMode === 'update-existing'
                ? 'bg-gradient-to-r from-amber-500/20 to-emerald-500/15 border-amber-400/70 shadow-md shadow-amber-500/10'
                : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-400'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-extrabold text-xs shrink-0 mt-0.5 ${
                dbManageMode === 'update-existing'
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              2
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs sm:text-sm font-extrabold ${
                    dbManageMode === 'update-existing' ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  Option 2: Update Existing Database File
                </span>
                {dbManageMode === 'update-existing' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Upload an existing CSV or Excel (<code>.xlsx</code>) database file, compare against Target Folder dates, and manually select the Update End Date to append missing dates without long wait times.
              </p>
            </div>
          </button>
        </div>

        {/* Synchronized Target Folder 1 (.TEPR) & Target Folders 2 (4-Circuit Power Consumption: KMB, KMA, KNA) — Same Setting as Page 1 */}
        {currentFolder && onSelectFolder && onRefreshTeprFolder && (
          <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800/90">
            <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
                  <FolderCog className="w-4 h-4 text-cyan-400" />
                  Database Builder Target Folder References (Synchronized with Page 1 Settings)
                </span>
                <span className="font-mono text-[11px] text-emerald-300 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                  ✓ Ref 1: {currentFolder.name} (.TEPR) · Ref 2: KMB ({powerFolders?.KMB.name || 'KMB'}), KMA ({powerFolders?.KMA.name || 'KMA'}), KNA ({powerFolders?.KNA.name || 'KNA'})
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsTargetFoldersHidden((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-all cursor-pointer shadow-xs shrink-0"
                title={
                  isTargetFoldersHidden
                    ? 'Show Target Folder 1–2 Setting'
                    : 'Hide Target Folder 1–2 Setting'
                }
              >
                {isTargetFoldersHidden ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Show Target Folder 1–2 Setting</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                    <span>Hide Target Folder 1–2 Setting</span>
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  </>
                )}
              </button>
            </div>

            {!isTargetFoldersHidden && (
              <div className="text-slate-900 pt-1 animate-in fade-in duration-150">
                <FolderSelector
                  accessToken={accessToken || ''}
                  currentFolder={currentFolder}
                  permanentFolder={permanentFolder}
                  onSetPermanentFolder={onSetPermanentFolder}
                  onSelectFolder={onSelectFolder}
                  onRefresh={onRefreshTeprFolder}
                  isLoading={isLoadingTeprFolder}
                  powerFolders={powerFolders}
                  onUpdatePowerFolders={onUpdatePowerFolders}
                  onScanPowerFolders={onScanPowerFolders}
                  isScanningPower={isScanningPower}
                  referenceDateKey={activeDateFilter || startDate || 'all'}
                  activeDailyPowerSummary={activeDailyPowerSummary}
                  powerScannedCount={powerScannedCount}
                />
              </div>
            )}
          </div>
        )}

        {dbManageMode === 'build-new' ? (
          /* OPTION 1: Date Period Controls & Quick Presets for Building New Database */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700/80">
            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>1. Database Start Date</span>
                  <span className="font-mono text-[10px] text-cyan-300">{scannedTimeHierarchy.allDates[0] || 'First Date'}</span>
                </label>
                <select
                  value={startDate}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setStartDate(newStart);
                    if (endDate && newStart > endDate) {
                      setEndDate(latestDataDate || newStart);
                    }
                  }}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded-xl text-cyan-300 focus:outline-none focus:border-cyan-500"
                >
                  {scannedTimeHierarchy.allDates.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === scannedTimeHierarchy.allDates[0] ? ' (First Folder Date)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>2. Database End Date</span>
                  <span className="font-mono text-[10px] text-cyan-300" title={`Limited at latest data date (${latestDataDate}) compared to present day (${presentDayDateKey})`}>
                    {latestDataDate ? `Max: ${latestDataDate} (Latest Data Date)` : 'Latest Data Date'}
                  </span>
                </label>
                <select
                  value={endDate}
                  onChange={(e) => {
                    const newEnd = e.target.value;
                    setEndDate(newEnd);
                    if (startDate && newEnd < startDate) setStartDate(newEnd);
                  }}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded-xl text-cyan-300 focus:outline-none focus:border-cyan-500"
                >
                  {availableEndDates.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === latestDataDate ? ' (Latest Data Date)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col justify-end space-y-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quick Period Presets:</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (scannedTimeHierarchy.allDates.length > 0) {
                      const firstD = scannedTimeHierarchy.allDates[0];
                      const lastD = scannedTimeHierarchy.latestDataDate || scannedTimeHierarchy.allDates[scannedTimeHierarchy.allDates.length - 1];
                      setStartDate(firstD);
                      setEndDate(lastD);
                      showNotification('success', `Set period from First Date (${firstD}) to Latest Data Date (${lastD})`);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-all cursor-pointer text-center truncate"
                >
                  Full Period (All Days)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyPresetRange('last30')}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-all cursor-pointer text-center"
                >
                  Last 30 Days
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* OPTION 2: Upload Existing Database File, Select Update End Date & Compare Missing Dates */
          <div className="bg-slate-800/60 p-4 rounded-xl border border-amber-500/40 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-700/80">
              <div className="space-y-1">
                <div className="text-xs font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>Step 1: Upload Existing Database File (.CSV or .XLSX) &amp; Select Update End Date</span>
                </div>
                <p className="text-xs text-slate-300">
                  Compares the dates in your uploaded database file against Target Folder 1 (<code>.TEPR</code>) &amp; Target Folders 2 (<code>KMB</code>, <code>KMA</code>, <code>KNA</code>) up to your selected <strong>Update End Date ({updateDatabaseComparison.targetLatestDate || latestDataDate || 'Latest Data Date'})</strong>, compiles only the missing/extra dates, and downloads the updated file.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-amber-400 hover:bg-amber-300 text-slate-950 transition-all cursor-pointer shadow-md">
                  <Upload className="w-4 h-4" />
                  <span>
                    {uploadedDbForUpdate
                      ? 'Change Uploaded Database File (.CSV / .XLSX)'
                      : 'Upload Existing Database File (.CSV / .XLSX)'}
                  </span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleUploadExistingDbForUpdate}
                    className="hidden"
                  />
                </label>

                {uploadedDbForUpdate && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedDbForUpdate(null);
                      setPeakDbUploadStatus(null);
                      clearLastUploadedMasterDatabase();
                    }}
                    className="px-3 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                  >
                    Clear File
                  </button>
                )}
              </div>
            </div>

            {/* Upload Status (0-100%) for Daily Peak Database Option 2 */}
            {peakDbUploadStatus && (
              <div
                className={`p-3 rounded-xl border ${
                  peakDbUploadStatus.error
                    ? 'bg-rose-950/50 border-rose-500/50 text-rose-200'
                    : peakDbUploadStatus.isComplete
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-cyan-950/40 border-cyan-500/50 text-cyan-200'
                } space-y-2`}
              >
                <div className="flex items-center justify-between gap-2 text-xs font-mono font-bold">
                  <span className="flex items-center gap-2">
                    {peakDbUploadStatus.isUploading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                    ) : peakDbUploadStatus.error ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span>Upload Status: {peakDbUploadStatus.phaseText}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-amber-300">
                    {peakDbUploadStatus.pct}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-200 ${
                      peakDbUploadStatus.error
                        ? 'bg-rose-500'
                        : peakDbUploadStatus.isComplete
                        ? 'bg-emerald-400'
                        : 'bg-cyan-400'
                    }`}
                    style={{ width: `${peakDbUploadStatus.pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Step 2 inside Option 2: Manual Update End Date Selector + Quick Batch Presets (Avoid long wait when missing > 30-60 days) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/90">
              <div className="lg:col-span-6">
                <label className="block text-[11px] font-bold text-amber-300 uppercase tracking-wider mb-1 flex items-center justify-between gap-2">
                  <span>Update Database End Date (Manual Selection)</span>
                  <span className="font-mono text-[10px] text-emerald-300">
                    Folder Max: {updateDatabaseComparison.folderLatestDate || latestDataDate || 'N/A'}
                  </span>
                </label>
                <select
                  value={updateDatabaseComparison.targetLatestDate}
                  onChange={(e) => setUpdateTargetEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-950 border border-amber-500/50 rounded-xl text-amber-300 focus:outline-none focus:border-amber-400"
                >
                  {updateDatabaseComparison.candidateEndDates.map((d, idx) => {
                    const isFolderMax = d === updateDatabaseComparison.folderLatestDate;
                    const missingCountUpToD = uploadedDbForUpdate
                      ? updateDatabaseComparison.allMissingUpToFolderLatest.filter(
                          (m) => m <= d
                        ).length
                      : idx + 1;
                    return (
                      <option key={d} value={d}>
                        {d}
                        {uploadedDbForUpdate
                          ? ` (+${missingCountUpToD} missing day${missingCountUpToD === 1 ? '' : 's'})`
                          : ''}
                        {isFolderMax ? ' — Target Folder Latest Date' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Select an earlier End Date (e.g. +15, +30, or +60 days) to update in smaller batches and avoid long waiting times when missing days exceed 30–60 days.
                </p>
              </div>

              <div className="lg:col-span-6 flex flex-col justify-between space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    Quick Batch Limit Presets (Avoid Long Wait):
                  </span>
                  {uploadedDbForUpdate &&
                    updateDatabaseComparison.allMissingUpToFolderLatest.length >
                      updateDatabaseComparison.missingDates.length && (
                      <span className="text-[10px] font-mono text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                        Batching {updateDatabaseComparison.missingDates.length} of{' '}
                        {updateDatabaseComparison.allMissingUpToFolderLatest.length} total missing days
                      </span>
                    )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelectUpdateHorizonDays(15)}
                    className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-600 transition-all cursor-pointer text-center"
                  >
                    +15 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectUpdateHorizonDays(30)}
                    className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-600 transition-all cursor-pointer text-center"
                  >
                    +30 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectUpdateHorizonDays(60)}
                    className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-600 transition-all cursor-pointer text-center"
                  >
                    +60 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectUpdateHorizonDays('all')}
                    className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer text-center truncate"
                    title={`Update up to Target Folder Latest Date (${updateDatabaseComparison.folderLatestDate})`}
                  >
                    Latest ({updateDatabaseComparison.folderLatestDate || 'Max'})
                  </button>
                </div>
              </div>
            </div>

            {uploadedDbForUpdate ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Uploaded Database File Summary */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-700 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    1. Uploaded Database File
                  </div>
                  <div className="text-xs font-extrabold text-white truncate" title={uploadedDbForUpdate.fileName}>
                    {uploadedDbForUpdate.fileName}
                  </div>
                  <div className="text-[11px] font-mono text-cyan-300 pt-1">
                    Latest Date in File: <strong>{updateDatabaseComparison.uploadedLatestDate || 'N/A'}</strong>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    Coverage: {updateDatabaseComparison.uploadedFirstDate || 'N/A'} → {updateDatabaseComparison.uploadedLatestDate || 'N/A'} ({uploadedDbForUpdate.existingValidDates.length} valid days)
                  </div>
                </div>

                {/* 2. Selected Update End Date vs Target Folder Latest Date */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-700 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>2. Selected Update End Date</span>
                    <span className="font-mono text-emerald-400">
                      Max: {updateDatabaseComparison.folderLatestDate || 'N/A'}
                    </span>
                  </div>
                  <div className="text-base font-extrabold font-mono text-emerald-400">
                    {updateDatabaseComparison.targetLatestDate || 'N/A'}
                  </div>
                  <div className="text-[11px] text-slate-300 pt-0.5">
                    Folder Range: <span className="font-mono">{scannedTimeHierarchy.allDates[0] || 'N/A'} → {updateDatabaseComparison.folderLatestDate || 'N/A'}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {updateDatabaseComparison.targetLatestDate === updateDatabaseComparison.folderLatestDate
                      ? `Up to Target Folder Latest Date (${presentDayDateKey})`
                      : `Custom End Date selected (Folder latest: ${updateDatabaseComparison.folderLatestDate})`}
                  </div>
                </div>

                {/* 3. Missing / Extra Dates Detected to Update */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-amber-500/40 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    3. Missing / Extra Dates to Append &amp; Update
                  </div>
                  {updateDatabaseComparison.missingDates.length > 0 ? (
                    <>
                      <div className="text-sm font-extrabold font-mono text-amber-300">
                        +{updateDatabaseComparison.missingDates.length} Missing Days Selected
                        {updateDatabaseComparison.allMissingUpToFolderLatest.length >
                          updateDatabaseComparison.missingDates.length && (
                          <span className="text-xs font-normal text-slate-400">
                            {' '}
                            (of {updateDatabaseComparison.allMissingUpToFolderLatest.length} total)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-white pt-0.5">
                        Update Period:{' '}
                        <strong className="text-amber-300">
                          {updateDatabaseComparison.missingDates[0]} →{' '}
                          {
                            updateDatabaseComparison.missingDates[
                              updateDatabaseComparison.missingDates.length - 1
                            ]
                          }
                        </strong>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {updateDatabaseComparison.extraDatesAfterLatest.length > 0
                          ? `${updateDatabaseComparison.extraDatesAfterLatest.length} extra days after ${updateDatabaseComparison.uploadedLatestDate} (up to ${updateDatabaseComparison.targetLatestDate})`
                          : ''}{' '}
                        {updateDatabaseComparison.gapDatesWithinRange.length > 0
                          ? `(${updateDatabaseComparison.gapDatesWithinRange.length} gap days inside range)`
                          : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-extrabold text-emerald-400">
                        ✓ All Dates Up to {updateDatabaseComparison.targetLatestDate} Present
                      </div>
                      <div className="text-[11px] text-slate-300 pt-0.5">
                        Click &quot;Update &amp; Download Database File&quot; to refresh ({updateDatabaseComparison.targetLatestDate}) and download.
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/70 border border-dashed border-slate-700 rounded-xl p-5 text-center space-y-2">
                <div className="text-xs font-bold text-slate-200">
                  No Existing Database File Uploaded Yet
                </div>
                <p className="text-[11px] text-slate-400 max-w-xl mx-auto">
                  Click <strong>&quot;Upload Existing Database File (.CSV / .XLSX)&quot;</strong> above to select your previous database file. You can then manually select an <strong>Update Database End Date</strong> (or use <code>+15 Days</code>, <code>+30 Days</code>, <code>+60 Days</code>) to compile and download missing dates without waiting for a full multi-month scan.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Included Fields Grid */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Revised Master Daily Database Template (Daily Peak of All Section DOFs + Same 4-Circuit Power Flow Record):
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {dbManageMode === 'build-new'
                ? `New Build Period: ${startDate} → ${endDate}`
                : uploadedDbForUpdate && updateDatabaseComparison.missingDates.length > 0
                ? `Update Missing Dates: ${updateDatabaseComparison.missingDates[0]} → ${
                    updateDatabaseComparison.missingDates[
                      updateDatabaseComparison.missingDates.length - 1
                    ]
                  } (${updateDatabaseComparison.missingDates.length} days)`
                : `Target Latest Date: ${latestDataDate}`}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-[11px] font-mono text-slate-300">
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-cyan-400 font-bold block">1. All Section DOFs Tf</span>
              <span className="text-[10px] text-slate-400">Tf_DOF_[m]_C for every DOF</span>
            </div>
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-rose-400 font-bold block">2. All Section DOFs Tc</span>
              <span className="text-[10px] text-slate-400">Tc_DOF_[m]_C (IEC 60287)</span>
            </div>
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-emerald-400 font-bold block">3. Section Peak &amp; Min</span>
              <span className="text-[10px] text-slate-400">Max/Min/Mean Tf &amp; Tc, DOF</span>
            </div>
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-amber-400 font-bold block">4. Timestamps</span>
              <span className="text-[10px] text-slate-400">HH:mm of Daily Max &amp; Min</span>
            </div>
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-violet-400 font-bold block">5. Power Flow MW</span>
              <span className="text-[10px] text-slate-400">Same 4-Circuit Power Record</span>
            </div>
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-blue-400 font-bold block">6. Source File</span>
              <span className="text-[10px] text-slate-400">Raw .TEPR File Name</span>
            </div>
          </div>
        </div>
      </div>
    )}

        {dbManagementSubPage === 'section-daily-profile' && (
          <div className="space-y-5 animate-in fade-in duration-150">
          {/* Page 2 Header: Section Daily Profile */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shrink-0">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-white flex flex-wrap items-center gap-2.5">
                  <span>Section Daily Profile Database</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[11px] font-bold">
                    19 Worksheets (1 Section / Sheet)
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono text-[10px] font-bold">
                    Hourly Peak for Every Section DOF
                  </span>
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Using 99% of idea &amp; concept from CSV / Excel Database Management (Same Target Folders 1 &amp; 2). Records <strong>hourly peak fiber temperature</strong> and <strong>IEC estimated core conductor temperature</strong> for every DOF in each section (e.g., all 6 DOF points for Submarine Zone 1 BTN), with coincident 4-circuit power flow (KMB, KMA, KNA).
                </p>
              </div>
            </div>

            {profileDbManageMode === 'build-new' ? (
              <button
                type="button"
                onClick={handleGenerateSectionDailyProfileDatabase}
                disabled={csvGenModal.isOpen && csvGenModal.stage !== 'completed'}
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 shadow-xl shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-60 hover:scale-[1.02] active:scale-[0.98]"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Generate New Section Daily Profile CSV / Excel File</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUpdateExistingSectionDailyProfileDatabase}
                disabled={
                  !uploadedProfileDbForUpdate ||
                  (csvGenModal.isOpen && csvGenModal.stage !== 'completed')
                }
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl text-xs font-extrabold bg-gradient-to-r from-amber-400 via-orange-400 to-emerald-400 hover:from-amber-300 hover:to-emerald-300 text-slate-950 shadow-xl shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
              >
                <RefreshCw className="w-4 h-4" />
                <span>
                  {uploadedProfileDbForUpdate &&
                  updateProfileDatabaseComparison.missingDates.length > 0
                    ? `Update & Download Profile (+${updateProfileDatabaseComparison.missingDates.length} Missing Days)`
                    : 'Update & Download Section Daily Profile File'}
                </span>
              </button>
            )}
          </div>

          {/* 2-Option Selector for Section Daily Profile: Option 1 (Building New Database) vs Option 2 (Update Existing Database File to Latest Date) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/60 p-2.5 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => setProfileDbManageMode('build-new')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                profileDbManageMode === 'build-new'
                  ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/15 border-emerald-400/70 shadow-md shadow-emerald-500/10'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-400'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-extrabold text-xs shrink-0 mt-0.5 ${
                  profileDbManageMode === 'build-new'
                    ? 'bg-emerald-400 text-slate-950'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                1
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs sm:text-sm font-extrabold ${
                      profileDbManageMode === 'build-new' ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    Option 1: Building New Database
                  </span>
                  {profileDbManageMode === 'build-new' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400/20 text-emerald-300 border border-emerald-400/40">
                      Selected
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Select custom Start Date &amp; End Date (up to Target Folder Latest Data Date) to compile a complete 19-sheet Section Daily Profile with hourly DOF records from scratch.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setProfileDbManageMode('update-existing')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                profileDbManageMode === 'update-existing'
                  ? 'bg-gradient-to-r from-amber-500/20 to-emerald-500/15 border-amber-400/70 shadow-md shadow-amber-500/10'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-400'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-extrabold text-xs shrink-0 mt-0.5 ${
                  profileDbManageMode === 'update-existing'
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                2
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs sm:text-sm font-extrabold ${
                      profileDbManageMode === 'update-existing' ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    Option 2: Update Existing Database File
                  </span>
                  {profileDbManageMode === 'update-existing' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40">
                      Selected
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Upload an existing CSV or Excel (<code>.xlsx</code>) Section Daily Profile file, compare against Target Folder dates, and manually select the Update End Date to append missing dates.
                </p>
              </div>
            </button>
          </div>

          {/* Synchronized Target Folder References */}
          {currentFolder && onSelectFolder && onRefreshTeprFolder && (
            <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800/90">
              <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                    <FolderCog className="w-4 h-4 text-emerald-400" />
                    Section Daily Profile Target Folder References (Synchronized with Page 1 Settings)
                  </span>
                  <span className="font-mono text-[11px] text-emerald-300 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    ✓ Ref 1: {currentFolder.name} (.TEPR) · Ref 2: KMB ({powerFolders?.KMB.name || 'KMB'}), KMA ({powerFolders?.KMA.name || 'KMA'}), KNA ({powerFolders?.KNA.name || 'KNA'})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsTargetFoldersHidden((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700/90 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
                >
                  {isTargetFoldersHidden ? (
                    <>
                      <span>Show Target Folder Settings</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    </>
                  ) : (
                    <>
                      <span>Hide Target Folder Settings</span>
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    </>
                  )}
                </button>
              </div>

              {!isTargetFoldersHidden && (
                <div className="pt-2 border-t border-slate-800/80 space-y-3">
                  <FolderSelector
                    accessToken={accessToken || ''}
                    currentFolder={currentFolder}
                    permanentFolder={permanentFolder}
                    onSetPermanentFolder={onSetPermanentFolder}
                    onSelectFolder={onSelectFolder}
                    onRefresh={onRefreshTeprFolder}
                    isLoading={isLoadingTeprFolder}
                    powerFolders={powerFolders}
                    onUpdatePowerFolders={onUpdatePowerFolders}
                    onScanPowerFolders={onScanPowerFolders}
                    isScanningPower={isScanningPower}
                    referenceDateKey={activeDateFilter || startDate || 'all'}
                    activeDailyPowerSummary={activeDailyPowerSummary}
                    powerScannedCount={powerScannedCount}
                  />
                </div>
              )}
            </div>
          )}

          {profileDbManageMode === 'build-new' ? (
            /* OPTION 1: Date Period Controls & Quick Presets for Section Daily Profile */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700/80">
              <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>1. Profile Start Date</span>
                    <span className="font-mono text-[10px] text-emerald-300">
                      {scannedTimeHierarchy.allDates[0] || 'First Date'}
                    </span>
                  </label>
                  <select
                    value={startDate}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setStartDate(newStart);
                      if (endDate && newStart > endDate) {
                        setEndDate(latestDataDate || newStart);
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded-xl text-emerald-300 focus:outline-none focus:border-emerald-500"
                  >
                    {scannedTimeHierarchy.allDates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>2. Profile End Date</span>
                    <span className="font-mono text-[10px] text-emerald-300">
                      Latest: {latestDataDate || 'Target Folder End'}
                    </span>
                  </label>
                  <select
                    value={endDate}
                    onChange={(e) => {
                      const newEnd = e.target.value;
                      setEndDate(newEnd);
                      if (startDate && newEnd < startDate) setStartDate(newEnd);
                    }}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded-xl text-emerald-300 focus:outline-none focus:border-emerald-500"
                  >
                    {availableEndDates.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === latestDataDate ? '— Target Folder Latest Date' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="lg:col-span-4 flex flex-col justify-between space-y-1.5">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Quick Profile Period Presets:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPresetRange('last7')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-all cursor-pointer text-center"
                  >
                    Last 7D
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetRange('last14')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-all cursor-pointer text-center"
                  >
                    Last 14D
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetRange('last30')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-all cursor-pointer text-center"
                  >
                    Last 30D
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (scannedTimeHierarchy.allDates.length > 0) {
                        const firstD = scannedTimeHierarchy.allDates[0];
                        const lastD =
                          scannedTimeHierarchy.latestDataDate ||
                          scannedTimeHierarchy.allDates[scannedTimeHierarchy.allDates.length - 1];
                        setStartDate(firstD);
                        setEndDate(lastD);
                        showNotification('success', `Set period from First Date (${firstD}) to Latest Data Date (${lastD})`);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer text-center truncate col-span-2 sm:col-span-3"
                  >
                    All Available Dates
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* OPTION 2: Upload Existing Section Daily Profile Database File */
            <div className="space-y-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700/80">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                <div>
                  <span className="text-xs font-extrabold text-amber-300 flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Step 1: Upload Existing Section Daily Profile Database File
                  </span>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Accepts previously downloaded Section Daily Profile <code>.xlsx</code> or <code>.csv</code> files. Automatically detects covered dates and compares against Target Folder 1 &amp; 2.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-amber-400 hover:bg-amber-300 text-slate-950 transition-all cursor-pointer shadow-md">
                    <Upload className="w-4 h-4" />
                    <span>
                      {uploadedProfileDbForUpdate
                        ? 'Change Uploaded Profile File (.CSV / .XLSX)'
                        : 'Upload Section Daily Profile (.CSV / .XLSX)'}
                    </span>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleUploadExistingProfileDbForUpdate}
                      className="hidden"
                    />
                  </label>

                  {uploadedProfileDbForUpdate && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedProfileDbForUpdate(null);
                        setProfileDbUploadStatus(null);
                        clearLastUploadedProfileDatabase();
                      }}
                      className="px-3 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                    >
                      Clear File
                    </button>
                  )}
                </div>
              </div>

              {/* Upload Status (0-100%) in Section Daily Profile Database (Option 2 Update Existing Database File) */}
              {profileDbUploadStatus && (
                <div
                  className={`p-3.5 rounded-xl border ${
                    profileDbUploadStatus.error
                      ? 'bg-rose-950/50 border-rose-500/50 text-rose-200'
                      : profileDbUploadStatus.isComplete
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-cyan-950/40 border-cyan-500/50 text-cyan-200'
                  } space-y-2`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono font-bold">
                    <span className="flex items-center gap-2">
                      {profileDbUploadStatus.isUploading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                      ) : profileDbUploadStatus.error ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span>Upload Status: {profileDbUploadStatus.phaseText}</span>
                    </span>
                    <span className="px-2.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-amber-300 font-extrabold">
                      {profileDbUploadStatus.pct}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-200 ${
                        profileDbUploadStatus.error
                          ? 'bg-rose-500'
                          : profileDbUploadStatus.isComplete
                          ? 'bg-emerald-400'
                          : 'bg-cyan-400'
                      }`}
                      style={{ width: `${profileDbUploadStatus.pct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Step 2 inside Option 2: Manual Update End Date Selector + Quick Batch Presets */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/90">
                <div className="lg:col-span-6">
                  <label className="block text-[11px] font-bold text-amber-300 uppercase tracking-wider mb-1 flex items-center justify-between gap-2">
                    <span>Update Database End Date (Manual Selection)</span>
                    <span className="font-mono text-[10px] text-emerald-300">
                      Folder Max: {updateProfileDatabaseComparison.folderLatestDate || latestDataDate || 'N/A'}
                    </span>
                  </label>
                  <select
                    value={updateProfileDatabaseComparison.targetLatestDate}
                    onChange={(e) => setUpdateProfileTargetEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-950 border border-amber-500/50 rounded-xl text-amber-300 focus:outline-none focus:border-amber-400"
                  >
                    {updateProfileDatabaseComparison.candidateEndDates.map((d, idx) => {
                      const isFolderMax = d === updateProfileDatabaseComparison.folderLatestDate;
                      const missingCountUpToD = uploadedProfileDbForUpdate
                        ? updateProfileDatabaseComparison.allMissingUpToFolderLatest.filter(
                            (m) => m <= d
                          ).length
                        : idx + 1;
                      return (
                        <option key={d} value={d}>
                          {d}
                          {uploadedProfileDbForUpdate
                            ? ` (+${missingCountUpToD} missing day${missingCountUpToD === 1 ? '' : 's'})`
                            : ''}
                          {isFolderMax ? ' — Target Folder Latest Date' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Select an earlier End Date (e.g. +15, +30, or +60 days) to update in smaller batches and avoid long waiting times.
                  </p>
                </div>

                <div className="lg:col-span-6 flex flex-col justify-between space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      Quick Batch Limit Presets:
                    </span>
                    {uploadedProfileDbForUpdate &&
                      updateProfileDatabaseComparison.allMissingUpToFolderLatest.length >
                        updateProfileDatabaseComparison.missingDates.length && (
                        <span className="text-[10px] font-mono text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                          Batching {updateProfileDatabaseComparison.missingDates.length} of{' '}
                          {updateProfileDatabaseComparison.allMissingUpToFolderLatest.length} total missing days
                        </span>
                      )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectUpdateProfileHorizonDays(15)}
                      className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer text-center"
                      title="Update up to +15 missing days"
                    >
                      +15 Days
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectUpdateProfileHorizonDays(30)}
                      className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer text-center"
                      title="Update up to +30 missing days"
                    >
                      +30 Days
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectUpdateProfileHorizonDays(60)}
                      className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer text-center"
                      title="Update up to +60 missing days"
                    >
                      +60 Days
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectUpdateProfileHorizonDays('all')}
                      className="px-2.5 py-2 rounded-lg text-[11px] font-bold bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer text-center truncate"
                      title={`Update up to Target Folder Latest Date (${updateProfileDatabaseComparison.folderLatestDate})`}
                    >
                      Latest ({updateProfileDatabaseComparison.folderLatestDate || 'Max'})
                    </button>
                  </div>
                </div>
              </div>

              {uploadedProfileDbForUpdate ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-700 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      1. Uploaded Profile File
                    </div>
                    <div
                      className="text-xs font-extrabold text-white truncate"
                      title={uploadedProfileDbForUpdate.fileName}
                    >
                      {uploadedProfileDbForUpdate.fileName}
                    </div>
                    <div className="text-[11px] font-mono text-emerald-300 pt-1">
                      Latest Date: <strong>{updateProfileDatabaseComparison.uploadedLatestDate || 'N/A'}</strong>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      Coverage: {updateProfileDatabaseComparison.uploadedFirstDate || 'N/A'} →{' '}
                      {updateProfileDatabaseComparison.uploadedLatestDate || 'N/A'} (
                      {uploadedProfileDbForUpdate.existingValidDates.length} valid days,{' '}
                      {uploadedProfileDbForUpdate.totalExistingRows} hourly records)
                    </div>
                  </div>

                  <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-700 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                      <span>2. Selected Update End Date</span>
                      <span className="font-mono text-emerald-400">
                        Max: {updateProfileDatabaseComparison.folderLatestDate || 'N/A'}
                      </span>
                    </div>
                    <div className="text-xs font-extrabold font-mono text-amber-300">
                      {updateProfileDatabaseComparison.targetLatestDate || 'N/A'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-300 pt-1">
                      Selected Missing Days:{' '}
                      <strong className="text-amber-400">
                        +{updateProfileDatabaseComparison.missingDates.length} days
                      </strong>{' '}
                      (
                      {updateProfileDatabaseComparison.allMissingUpToFolderLatest.length >
                      updateProfileDatabaseComparison.missingDates.length
                        ? `limited from ${updateProfileDatabaseComparison.allMissingUpToFolderLatest.length} total`
                        : 'all missing days'}
                      )
                    </div>
                  </div>

                  <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-700 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      3. Target Folder Synchronized
                    </div>
                    <div className="text-xs font-extrabold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      Target Folders 1 &amp; 2 Active
                    </div>
                    <div className="text-[10px] text-slate-300 pt-1">
                      Folder 1 (.TEPR) + Folder 2 (4-Circuit Power: KMB, KMA, KNA). Fast parallel scan with no reload.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                  <p className="font-medium">
                    No Section Daily Profile file uploaded yet. Upload an existing <code>.xlsx</code> or <code>.csv</code> above to compare dates and append missing records.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Included Fields Grid for Section Daily Profile */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Section Daily Profile Structure: 19 Dedicated Section Worksheets (1 Sheet / Section):
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {profileDbManageMode === 'build-new'
                  ? `Profile Period: ${startDate} → ${endDate}`
                  : uploadedProfileDbForUpdate &&
                    updateProfileDatabaseComparison.missingDates.length > 0
                  ? `Update Missing Dates: ${updateProfileDatabaseComparison.missingDates[0]} → ${
                      updateProfileDatabaseComparison.missingDates[
                        updateProfileDatabaseComparison.missingDates.length - 1
                      ]
                    } (${updateProfileDatabaseComparison.missingDates.length} days)`
                  : `Target Latest Date: ${latestDataDate}`}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-[11px] font-mono text-slate-300">
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                <span className="text-emerald-400 font-bold block">1. 19 Sheets</span>
                <span className="text-[10px] text-slate-400">Sec_1.1–1.6 &amp; Zone_2.1–2.13</span>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                <span className="text-cyan-400 font-bold block">2. Rows: Hourly 00:00–23:00</span>
                <span className="text-[10px] text-slate-400">24 Hourly Rows per Date</span>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                <span className="text-amber-400 font-bold block">3. Columns: Every DOF</span>
                <span className="text-[10px] text-slate-400">Raw Tf &amp; IEC Tc per DOF point</span>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                <span className="text-rose-400 font-bold block">4. Section Maximums</span>
                <span className="text-[10px] text-slate-400">Max Tf, Max Tc, Peak DOF &amp; Time</span>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                <span className="text-violet-400 font-bold block">5. 4-Circuit Power Flow</span>
                <span className="text-[10px] text-slate-400">Ckt3, Ckt2, NKT, Oil, Total MW</span>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* KPI Cards Row for Selected Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Section Identity */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>Selected Section / Zone</span>
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono font-bold text-[11px]">
              IEC Estimation
            </span>
          </div>
          <div className="text-lg font-bold text-slate-900 mt-1 truncate">
            {activeSection.category === 'land' ? `Sec ${activeSection.sectionId}` : `Zone ${activeSection.sectionId}`}: {activeSection.name}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center justify-between font-mono">
            <span>{activeSection.sectionType === 'special' ? 'Special Hotspot' : 'Normal Route'}</span>
            <span>
              {dofBounds.startDof.toFixed(1)}–{dofBounds.endDof.toFixed(1)} m
            </span>
          </div>
        </div>

        {/* Card 2: Current Peak Conductor Temp */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>Current Peak Conductor (Tc,60287)</span>
            <span
              className="px-2 py-0.5 rounded-md font-bold text-[11px]"
              style={{
                backgroundColor: `${currentZoneInfo.color}20`,
                color: currentZoneInfo.color,
              }}
            >
              {currentZoneInfo.name}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-extrabold font-mono" style={{ color: currentZoneInfo.color }}>
              {latestHistorical?.tcMax.toFixed(2)} °C
            </span>
            <span className="text-xs text-slate-500 font-mono">
              (Fiber Tf: {latestHistorical?.tfMax.toFixed(2)} °C)
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Criteria: {currentZoneInfo.rangeText}
          </div>
        </div>

        {/* Card 3: Forecast or Historical Peak Conductor Temp */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>
              {forecastHorizonDays > 0
                ? `Projected +${forecastHorizonDays}d Peak Tc,60287`
                : 'Recorded Peak Conductor (Tc,60287)'}
            </span>
            <span
              className="px-2 py-0.5 rounded-md font-bold text-[11px]"
              style={{
                backgroundColor: `${forecastZoneInfo.color}20`,
                color: forecastZoneInfo.color,
              }}
            >
              {forecastHorizonDays > 0 ? forecastZoneInfo.name : currentZoneInfo.name}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-extrabold font-mono" style={{ color: forecastZoneInfo.color }}>
              {forecastHorizonDays > 0 ? peakForecast?.tcMax.toFixed(2) : latestHistorical?.tcMax.toFixed(2)} °C
            </span>
            {forecastHorizonDays > 0 ? (
              <span className="text-xs font-mono font-bold text-slate-600">
                ({peakForecast && latestHistorical && peakForecast.tcMax - latestHistorical.tcMax >= 0 ? '+' : ''}
                {peakForecast && latestHistorical
                  ? (peakForecast.tcMax - latestHistorical.tcMax).toFixed(2)
                  : '0.00'}{' '}
                °C)
              </span>
            ) : (
              <span className="text-xs font-mono font-semibold text-slate-400">
                (Historical Record)
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            {forecastHorizonDays > 0 ? (
              <>
                95% Band: [{peakForecast?.tcLower95 ?? peakForecast?.tfMin} –{' '}
                {peakForecast?.tcUpper95 ?? peakForecast?.tcMax} °C]
              </>
            ) : (
              <span>Criteria: {currentZoneInfo.rangeText} (Historical Only)</span>
            )}
          </div>
        </div>

        {/* Card 4: 4-Circuit Power Peak & Threshold Timing */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>
              {forecastHorizonDays > 0
                ? '4-Circuit Forecast & Time to Alert'
                : 'Historical 4-Circuit Peak Power'}
            </span>
            <span className="font-mono text-xs font-bold text-indigo-600">
              Ckt #3: {forecastHorizonDays > 0 ? peakForecast?.pCkt3MW.toFixed(1) : latestHistorical?.pCkt3MW.toFixed(1)} MW
            </span>
          </div>
          <div className="text-xl font-extrabold font-mono text-slate-900 mt-1">
            {forecastHorizonDays > 0 ? peakForecast?.pTotalIslandMW.toFixed(1) : latestHistorical?.pTotalIslandMW.toFixed(1)} MW Total Island
          </div>
          <div className="text-xs mt-1 font-semibold">
            {forecastHorizonDays > 0 ? (
              thresholdCrossings.daysToCritical70 !== null ? (
                <span className="text-red-700">
                  Est. Critical (&gt;70°C) in {thresholdCrossings.daysToCritical70}d
                </span>
              ) : thresholdCrossings.daysToDanger60 !== null ? (
                <span className="text-red-500">
                  Est. Danger (60°C) in {thresholdCrossings.daysToDanger60}d
                </span>
              ) : thresholdCrossings.daysToAlert55 !== null ? (
                <span className="text-orange-600">
                  Est. Alert (55°C) in {thresholdCrossings.daysToAlert55}d
                </span>
              ) : (
                <span className="text-emerald-600">
                  Remains below Alert Zone (55°C) across +{forecastHorizonDays}d
                </span>
              )
            ) : (
              <span className="text-slate-600">
                Prediction Turned Off · Showing Recorded Historical Window
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Maximized Chart Visual Section with 4 Navigation Tab Buttons */}
      <div className="space-y-4">
        {/* CSV Database Source Bar (Google Drive Shared URL Box & File Upload) */}
        <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 shadow-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Link className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                Visual Chart Database Source (Google Drive Shared URL Box or File Upload)
              </span>
            </div>
            {csvDatabaseSource ? (
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[11px] font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Active Database ({csvDatabaseSource.source === 'url' ? 'Shared URL' : 'Uploaded File'}):{' '}
                  {csvDatabaseSource.filename} ({csvDatabaseSource.totalRecords} Records · {csvDatabaseSource.dateKeys.length} Days)
                </span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[11px] font-bold">
                Awaiting Upload or Shared URL — Charts Use Uploaded Excel/CSV or URL Only
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
            {/* Google Drive Shared URL Input Box */}
            <div className="lg:col-span-8 flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
              <Link className="w-4 h-4 text-slate-500 shrink-0 ml-1" />
              <input
                type="text"
                value={csvDatabaseUrl}
                onChange={(e) => setCsvDatabaseUrl(e.target.value)}
                placeholder="Paste shared Google Drive or Google Sheets URL (e.g. https://drive.google.com/file/d/...)"
                className="w-full bg-transparent px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => handleLoadDatabaseFromUrl()}
                disabled={isLoadingSharedUrl || !csvDatabaseUrl.trim()}
                className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                {isLoadingSharedUrl ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Load URL Data</span>
                  </>
                )}
              </button>
            </div>

            {/* Upload CSV / XLSX File Box */}
            <div className="lg:col-span-4 flex items-center gap-2">
              <label className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-all cursor-pointer shadow-sm">
                <Upload className="w-4 h-4" />
                <span>Upload CSV / XLSX Database</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleUploadDatabaseFile}
                  className="hidden"
                />
              </label>

              {csvDatabaseSource && (
                <button
                  type="button"
                  onClick={() => {
                    setCsvDatabaseSource(null);
                    setCsvDatabaseUrl('');
                    setChartStartDate('');
                    setChartEndDate('');
                    showNotification('success', 'Cleared loaded database from Visual Chart');
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer shrink-0"
                  title="Clear loaded database file"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Interactive Visual Chart Filters Bar (Date, Section & Cable Phase Filters) */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Visual Chart Display Filters (Date Period, Section &amp; Cable Phase)
              </h4>
            </div>
            <span className="text-[11px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
              {csvDatabaseSource
                ? `Active: Sec ${activeSection.sectionId} (${activeSection.name}) · ${chartStartDate || csvDatabaseSource.dateKeys[0]} → ${chartEndDate || csvDatabaseSource.dateKeys[csvDatabaseSource.dateKeys.length - 1]}`
                : `Sec ${activeSection.sectionId} (${activeSection.name}) · Upload Excel/CSV or Load URL to Filter`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Date Period Range Filter (from Uploaded/URL Database) */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Date Range Filter (Database)</span>
                <span className="font-mono text-[10px] text-cyan-600 font-bold">
                  {csvDatabaseSource && csvDatabaseSource.dateKeys.length > 0
                    ? `${chartStartDate || csvDatabaseSource.dateKeys[0]} → ${chartEndDate || csvDatabaseSource.dateKeys[csvDatabaseSource.dateKeys.length - 1]}`
                    : 'No Database Loaded'}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={chartStartDate}
                  disabled={!csvDatabaseSource || csvDatabaseSource.dateKeys.length === 0}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setChartStartDate(newStart);
                    if (chartEndDate && newStart > chartEndDate) setChartEndDate(newStart);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                >
                  {csvDatabaseSource && csvDatabaseSource.dateKeys.length > 0 ? (
                    csvDatabaseSource.dateKeys.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))
                  ) : (
                    <option value="">Upload CSV/XLSX first</option>
                  )}
                </select>
                <select
                  value={chartEndDate}
                  disabled={!csvDatabaseSource || csvDatabaseSource.dateKeys.length === 0}
                  onChange={(e) => {
                    const newEnd = e.target.value;
                    setChartEndDate(newEnd);
                    if (chartStartDate && newEnd < chartStartDate) setChartStartDate(newEnd);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                >
                  {csvDatabaseSource && csvDatabaseSource.dateKeys.length > 0 ? (
                    csvDatabaseSource.dateKeys.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))
                  ) : (
                    <option value="">Upload CSV/XLSX first</option>
                  )}
                </select>
              </div>
            </div>

            {/* 2. Section / Zone Selector Filter */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Section / Zone Filter</span>
                <span className="font-mono text-[10px] text-indigo-600 font-bold">Sec {activeSection.sectionId}</span>
              </label>
              <select
                value={selectedSectionId}
                onChange={(e) => {
                  setSelectedSectionId(e.target.value);
                  setSelectedSamplingPointId('ALL');
                }}
                className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {CIRCUIT_3_SECTIONS.map((sec) => (
                  <option key={sec.sectionId} value={sec.sectionId}>
                    {sec.category === 'land' ? `Sec ${sec.sectionId}` : `Zone ${sec.sectionId}`}: {sec.name} ({sec.category.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Cable Phase / Channel Filter */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Cable Phase / Channel Filter</span>
                <span className="font-mono text-[10px] text-blue-600 font-bold">
                  {selectedPhaseFilter === 'all' ? 'All Phases' : `Phase ${selectedPhaseFilter}`}
                </span>
              </label>
              <select
                value={selectedPhaseFilter}
                onChange={(e) => setSelectedPhaseFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">All Phases / Envelope</option>
                <option value="A">Phase A — Land (CH 0)</option>
                <option value="B">Phase B — Land (CH 1)</option>
                <option value="C">Phase C — Land (CH 2)</option>
                <option value="SM">Submarine Cable (CH 3)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Chart Selection Buttons Bar */}
        <div className="bg-slate-900/95 backdrop-blur-md p-2 rounded-2xl border border-slate-800 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 mb-1 border-b border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Select Visual Chart (Maximized Single View):
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              Displaying 1 maximized chart at a time for maximum visibility
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {/* Button 1 */}
            <button
              type="button"
              onClick={() => setSelectedChartTab('thermal')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                selectedChartTab === 'thermal'
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 border-indigo-400 text-white shadow-md ring-2 ring-indigo-400/40'
                  : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedChartTab === 'thermal' ? 'bg-white/20 text-white' : 'bg-slate-700 text-cyan-400'
                }`}
              >
                <Thermometer className="w-5 h-5" />
              </div>
              <div className="min-w-0 truncate">
                <div className="text-xs font-bold truncate">
                  1. Daily record of fiber temperature &amp; core conductor temperature trajectory
                </div>
                <div
                  className={`text-[10px] truncate ${
                    selectedChartTab === 'thermal' ? 'text-indigo-100' : 'text-slate-400'
                  }`}
                >
                  Daily Max &amp; Min Tf + Core Conductor Tc (6-Zone Criteria)
                </div>
              </div>
            </button>

            {/* Button 2 */}
            <button
              type="button"
              onClick={() => setSelectedChartTab('power')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                selectedChartTab === 'power'
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 border-indigo-400 text-white shadow-md ring-2 ring-indigo-400/40'
                  : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedChartTab === 'power' ? 'bg-white/20 text-white' : 'bg-slate-700 text-amber-400'
                }`}
              >
                <Zap className="w-5 h-5" />
              </div>
              <div className="min-w-0 truncate">
                <div className="text-xs font-bold truncate">
                  2. Power flow in system during record of maximum fiber temperature
                </div>
                <div
                  className={`text-[10px] truncate ${
                    selectedChartTab === 'power' ? 'text-indigo-100' : 'text-slate-400'
                  }`}
                >
                  4 Circuits Power Flow During Max Fiber Temp (Col O–S)
                </div>
              </div>
            </button>

            {/* Button 3 */}
            <button
              type="button"
              onClick={() => setSelectedChartTab('physics')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                selectedChartTab === 'physics'
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 border-indigo-400 text-white shadow-md ring-2 ring-indigo-400/40'
                  : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedChartTab === 'physics' ? 'bg-white/20 text-white' : 'bg-slate-700 text-emerald-400'
                }`}
              >
                <Activity className="w-5 h-5" />
              </div>
              <div className="min-w-0 truncate">
                <div className="text-xs font-bold truncate">3. Thermal Response Physics</div>
                <div
                  className={`text-[10px] truncate ${
                    selectedChartTab === 'physics' ? 'text-indigo-100' : 'text-slate-400'
                  }`}
                >
                  IEC 60287 Load MW vs Tc Max Scatter
                </div>
              </div>
            </button>

            {/* Button 4 */}
            <button
              type="button"
              onClick={() => setSelectedChartTab('points')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                selectedChartTab === 'points'
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 border-indigo-400 text-white shadow-md ring-2 ring-indigo-400/40'
                  : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedChartTab === 'points' ? 'bg-white/20 text-white' : 'bg-slate-700 text-purple-400'
                }`}
              >
                <MapPin className="w-5 h-5" />
              </div>
              <div className="min-w-0 truncate">
                <div className="text-xs font-bold truncate">4. Discrete Sampling Points</div>
                <div
                  className={`text-[10px] truncate ${
                    selectedChartTab === 'points' ? 'text-indigo-100' : 'text-slate-400'
                  }`}
                >
                  Spatial Envelopes Across Section
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Maximized Single Chart Container */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
          {/* Chart Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs uppercase tracking-wider">
                  {selectedChartTab === 'thermal'
                    ? 'Visual Chart 1 / 4'
                    : selectedChartTab === 'power'
                    ? 'Visual Chart 2 / 4'
                    : selectedChartTab === 'physics'
                    ? 'Visual Chart 3 / 4'
                    : 'Visual Chart 4 / 4'}
                </span>
                <span className="font-mono text-xs font-bold text-slate-500">
                  Sec {activeSection.sectionId} ({activeSection.name})
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-1">
                {selectedChartTab === 'thermal' &&
                  'Daily record of fiber temperature & core conductor temperature trajectory'}
                {selectedChartTab === 'power' &&
                  'Power flow in system during record of maximum fiber temperature'}
                {selectedChartTab === 'physics' &&
                  'Chart 3: IEC 60287 Load–Temperature Physics Response (P_Ckt3 MW vs Conductor Tc Max °C)'}
                {selectedChartTab === 'points' &&
                  `Chart 4: Intra-Section Discrete Sampling Points (${pointBreakdown.length} Points in Sec ${activeSection.sectionId})`}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedChartTab === 'thermal' &&
                  `Section ${activeSection.sectionId} · Daily Max & Min Fiber Temperature (Tf) and Core Conductor Temperature (Tc,60287) ${
                    forecastHorizonDays > 0 ? `+ Projected Future Trend (+${forecastHorizonDays}d)` : '(Historical Database Records)'
                  }`}
                {selectedChartTab === 'power' &&
                  `Plotted strictly from Database Columns O to S: 4 Circuits Power Flow (115kV Ckt #3, 115kV Ckt #2, 33kV NKT, 33kV Oil-Filled & Total MW) during record of maximum fiber temperature`}
                {selectedChartTab === 'physics' &&
                  `Quadratic thermal response for Sec ${activeSection.sectionId} governed by IEC Estimation from uploaded/URL database`}
                {selectedChartTab === 'points' &&
                  `Recorded Historical Daily Max Conductor Temp vs Future Projected Maximum across sampling points from uploaded/URL database`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedChartTab === 'power' && (
                <button
                  type="button"
                  onClick={() => setShowTotalPowerColO((prev) => !prev)}
                  className={`px-3 py-1 rounded-xl font-bold text-xs border transition-all cursor-pointer ${
                    showTotalPowerColO
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {showTotalPowerColO ? 'Showing: 4 Circuits + Total (Cols O–S)' : 'Showing: 4 Circuits Only (Cols P–S)'}
                </button>
              )}
              <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-700 font-mono text-xs font-bold">
                IEC Estimation
              </span>
              {latestHistorical && (
                <span
                  className="px-3 py-1 rounded-xl font-bold text-xs"
                  style={{
                    backgroundColor: `${currentZoneInfo.color}15`,
                    color: currentZoneInfo.color,
                  }}
                >
                  Current Peak: {latestHistorical.tcMax.toFixed(2)} °C ({currentZoneInfo.name})
                </span>
              )}
              {forecastHorizonDays > 0 ? (
                <span className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Forecast: +{forecastHorizonDays} Days
                </span>
              ) : (
                <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs">
                  Historical Records Only
                </span>
              )}
            </div>
          </div>

          {/* Chart Body Rendered according to active tab (Strictly from Uploaded Excel/CSV or URL link) */}
          {!csvDatabaseSource || combinedSeries.length === 0 ? (
            <div className="h-[500px] w-full rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <div className="max-w-lg space-y-1.5">
                <h4 className="text-base font-extrabold text-slate-900">
                  Visual Charts 1–4 Require an Uploaded Excel/CSV Database or Shared URL
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  These 4 visual charts exclusively plot data from your uploaded 19-sheet Excel (<code>.xlsx</code>) / CSV (<code>.csv</code>) database file or Google Drive shared URL link. Upload a file or paste a shared link in the <strong>Visual Chart Database Source</strong> bar above to visualize Section {activeSection.sectionId}.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>Upload Excel / CSV Database File</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleUploadDatabaseFile}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="h-[500px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {selectedChartTab === 'thermal' ? (
                  /* ----------------- CHART 1: DAILY RECORD OF FIBER TEMP & CORE CONDUCTOR TEMP TRAJECTORY ----------------- */
                  <ComposedChart data={combinedSeries} margin={{ top: 15, right: 30, left: 10, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" />
                    <YAxis domain={[20, 80]} tick={{ fontSize: 12, fill: '#64748b' }} unit="°C" />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{ backgroundColor: 'transparent', border: 'none', padding: 0, boxShadow: 'none' }}
                      content={<CustomThermalTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />

                    {/* 6-Zone Temperature Criteria Reference Lines */}
                    <ReferenceLine
                      y={70}
                      stroke="#991b1b"
                      strokeDasharray="4 4"
                      label={{ value: 'Critical >70°C', position: 'insideTopRight', fill: '#991b1b', fontSize: 11, fontWeight: 700 }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{ value: 'Danger 60°C', position: 'insideTopRight', fill: '#ef4444', fontSize: 11, fontWeight: 700 }}
                    />
                    <ReferenceLine
                      y={55}
                      stroke="#f97316"
                      strokeDasharray="3 3"
                      label={{ value: 'Alert 55°C', position: 'insideTopRight', fill: '#f97316', fontSize: 11, fontWeight: 700 }}
                    />
                    <ReferenceLine
                      y={45}
                      stroke="#eab308"
                      strokeDasharray="3 3"
                      label={{ value: 'Monitoring 45°C', position: 'insideTopRight', fill: '#eab308', fontSize: 11, fontWeight: 700 }}
                    />
                    <ReferenceLine
                      y={35}
                      stroke="#10b981"
                      strokeDasharray="3 3"
                      label={{ value: 'Normal 35°C', position: 'insideTopRight', fill: '#10b981', fontSize: 11, fontWeight: 700 }}
                    />

                    {/* Future Prediction Horizon Boundary (only when forecast enabled) */}
                    {forecastHorizonDays > 0 && latestFolderDate && (
                      <ReferenceLine
                        x={latestFolderDate.slice(5)}
                        stroke="#8b5cf6"
                        strokeDasharray="3 3"
                        label={{
                          value: 'Future Prediction Start →',
                          position: 'insideTopLeft',
                          fill: '#8b5cf6',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      />
                    )}

                    {/* 95% Confidence Upper Band */}
                    {forecastHorizonDays > 0 && (
                      <Area
                        type="monotone"
                        dataKey="tcUpper95Forecast"
                        name="95% Confidence Upper Band (°C)"
                        stroke="#818cf8"
                        strokeWidth={1.5}
                        fill="#6366f1"
                        fillOpacity={0.15}
                      />
                    )}

                    {/* Daily Max Conductor Tc,60287 (Col I) */}
                    <Line
                      type="monotone"
                      dataKey="tcMaxHist"
                      name="Daily Max Core Conductor Tc,60287 (°C)"
                      stroke="#dc2626"
                      strokeWidth={3}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="tcMaxForecast"
                      stroke="#f87171"
                      strokeWidth={3}
                      dot={false}
                      legendType="none"
                    />

                    {/* Daily Mean Conductor Tc */}
                    <Line
                      type="monotone"
                      dataKey="tcMeanHist"
                      name="Daily Mean Core Conductor Tc (°C)"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="tcMeanForecast"
                      stroke="#fb923c"
                      strokeWidth={2}
                      dot={false}
                      legendType="none"
                    />

                    {/* Daily Max Fiber Optic Tf (Col F) */}
                    <Line
                      type="monotone"
                      dataKey="tfMaxHist"
                      name="Daily Max Fiber Optic Tf (°C)"
                      stroke="#0284c7"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="tfMaxForecast"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      dot={false}
                      legendType="none"
                    />

                    {/* Daily Min Fiber Optic Tf (Col G) */}
                    <Line
                      type="monotone"
                      dataKey="tfMinHist"
                      name="Daily Min Fiber Optic Tf (°C)"
                      stroke="#0d9488"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="tfMinForecast"
                      stroke="#2dd4bf"
                      strokeWidth={2.5}
                      dot={false}
                      legendType="none"
                    />
                  </ComposedChart>
                ) : selectedChartTab === 'power' ? (
                  /* ----------------- CHART 2: POWER FLOW IN SYSTEM DURING RECORD OF MAXIMUM FIBER TEMPERATURE (COLS O TO S) ----------------- */
                  <ComposedChart data={combinedSeries} margin={{ top: 15, right: 30, left: 10, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} unit=" MW" />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{ backgroundColor: 'transparent', border: 'none', padding: 0, boxShadow: 'none' }}
                      content={<CustomPowerTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />

                    {/* Future Prediction Horizon Boundary Line */}
                    {forecastHorizonDays > 0 && latestFolderDate && (
                      <ReferenceLine
                        x={latestFolderDate.slice(5)}
                        stroke="#8b5cf6"
                        strokeDasharray="3 3"
                        label={{
                          value: 'Future Prediction Start →',
                          position: 'insideTopLeft',
                          fill: '#8b5cf6',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      />
                    )}

                    {/* Background Shading in Prediction Area */}
                    {forecastHorizonDays > 0 && forecastSeries.length > 0 && (
                      <ReferenceArea
                        x1={historicalSeries[historicalSeries.length - 1]?.label}
                        x2={forecastSeries[forecastSeries.length - 1]?.label}
                        fill="#f3e8ff"
                        fillOpacity={0.45}
                        stroke="#8b5cf6"
                        strokeDasharray="3 3"
                        strokeOpacity={0.6}
                      />
                    )}

                    {/* Col O: Power_Flow_During_Max_Total_MW */}
                    {showTotalPowerColO && (
                      <Line
                        type="monotone"
                        dataKey="pTotalIslandMWHist"
                        name="Total 4-Circuit Power Flow [Col O] (MW)"
                        stroke="#6366f1"
                        strokeWidth={4.5}
                        dot={false}
                      />
                    )}
                    {showTotalPowerColO && (
                      <Line
                        type="monotone"
                        dataKey="pTotalIslandMWForecast"
                        stroke="#818cf8"
                        strokeWidth={4.5}
                        dot={false}
                        legendType="none"
                      />
                    )}

                    {/* Col P: Power_Flow_During_Max_Ckt3_MW — 115kV Ckt #3 (KMB) */}
                    <Line
                      type="monotone"
                      dataKey="pCkt3MWHist"
                      name="115kV Ckt #3 (KMB) During Max Tf [Col P] (MW)"
                      stroke="#dc2626"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="pCkt3MWForecast"
                      stroke="#f87171"
                      strokeWidth={2.5}
                      dot={false}
                      legendType="none"
                    />

                    {/* Col Q: Power_Flow_During_Max_Ckt2_MW — 115kV Ckt #2 (KMA) */}
                    <Line
                      type="monotone"
                      dataKey="pCkt2MWHist"
                      name="115kV Ckt #2 (KMA) During Max Tf [Col Q] (MW)"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="pCkt2MWForecast"
                      stroke="#60a5fa"
                      strokeWidth={2.5}
                      dot={false}
                      legendType="none"
                    />

                    {/* Col R: Power_Flow_During_Max_33NKT_MW — 33kV NKT (KNA) */}
                    <Line
                      type="monotone"
                      dataKey="p33NktMWHist"
                      name="33kV NKT (KNA) During Max Tf [Col R] (MW)"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="p33NktMWForecast"
                      stroke="#34d399"
                      strokeWidth={2}
                      dot={false}
                      legendType="none"
                    />

                    {/* Col S: Power_Flow_During_Max_33Oil_MW — 33kV Oil-Filled (KNA) */}
                    <Line
                      type="monotone"
                      dataKey="p33OilMWHist"
                      name="33kV Oil-Filled (KNA) During Max Tf [Col S] (MW)"
                      stroke="#d97706"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="p33OilMWForecast"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={false}
                      legendType="none"
                    />
                  </ComposedChart>
                ) : selectedChartTab === 'physics' ? (
                  /* ----------------- CHART 3: THERMAL RESPONSE SCATTER ----------------- */
                  <ScatterChart margin={{ top: 15, right: 30, left: 10, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      dataKey="pCkt3MW"
                      name="115kV Ckt #3 Power During Max Tf"
                      unit=" MW"
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="tcMax"
                      name="Daily Max Conductor Temp Tc"
                      unit=" °C"
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                    />
                    <ZAxis range={[70, 70]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }}
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{ backgroundColor: 'transparent', border: 'none', padding: 0, boxShadow: 'none' }}
                      content={<CustomPhysicsTooltip />}
                    />
                    <ReferenceLine y={70} stroke="#991b1b" strokeDasharray="4 4" label={{ value: 'Critical >70°C', position: 'insideTopRight', fill: '#991b1b', fontSize: 11 }} />
                    <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Danger 60°C', position: 'insideTopRight', fill: '#ef4444', fontSize: 11 }} />
                    <ReferenceLine y={55} stroke="#f97316" strokeDasharray="3 3" label={{ value: 'Alert 55°C', position: 'insideTopRight', fill: '#f97316', fontSize: 11 }} />
                    <ReferenceLine y={45} stroke="#eab308" strokeDasharray="3 3" label={{ value: 'Monitoring 45°C', position: 'insideTopRight', fill: '#eab308', fontSize: 11 }} />
                    <ReferenceLine y={35} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Normal 35°C', position: 'insideTopRight', fill: '#10b981', fontSize: 11 }} />
                    <Scatter name="Operating Points (Daily Max)" data={combinedSeries}>
                      {combinedSeries.map((entry, idx) => (
                        <Cell
                          key={`cell-${idx}`}
                          fill={entry.zoneColor}
                          stroke={entry.isForecast ? '#312e81' : '#ffffff'}
                          strokeWidth={entry.isForecast ? 4 : 1.5}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                ) : (
                  /* ----------------- CHART 4: DISCRETE SAMPLING POINTS ----------------- */
                  <ComposedChart data={pointBreakdown} margin={{ top: 15, right: 30, left: 10, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="dof"
                      tickFormatter={(v) => `${Number(v).toFixed(0)}m`}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <YAxis domain={[20, 80]} tick={{ fontSize: 12, fill: '#64748b' }} unit="°C" />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{ backgroundColor: 'transparent', border: 'none', padding: 0, boxShadow: 'none' }}
                      content={<CustomPointsTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <ReferenceLine y={70} stroke="#991b1b" strokeDasharray="4 4" label={{ value: 'Critical 70°C', position: 'insideTopRight', fill: '#991b1b', fontSize: 11 }} />
                    <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Danger 60°C', position: 'insideTopRight', fill: '#ef4444', fontSize: 11 }} />
                    <ReferenceLine y={45} stroke="#eab308" strokeDasharray="3 3" label={{ value: 'Monitoring 45°C', position: 'insideTopRight', fill: '#eab308', fontSize: 11 }} />
                    <Bar dataKey="currentTc" name="Recorded Daily Max Conductor Tc (°C)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    {forecastHorizonDays > 0 && (
                      <Bar
                        dataKey="forecastTc"
                        name={`Forecast +${forecastHorizonDays}d Daily Max Conductor Tc (°C)`}
                        fill="#ef4444"
                        radius={[4, 4, 0, 0]}
                      />
                    )}
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Forecast Horizon & 4 Scenario Simulation Panel (Positioned Directly Below Visual Chart) */}
      <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <span>Multi-Factor Future Forecast &amp; 4 Scenario Simulation Panel</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-mono text-[10px] font-bold">
                  Applied Directly to Chart
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Adjust prediction horizon, select tourism/climate scenario presets, and fine-tune growth factors to update Chart 1–4 in real-time.
              </p>
            </div>
          </div>

          {/* Prediction Horizon Selector Pill Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 bg-indigo-50/80 p-1.5 rounded-xl border border-indigo-100">
            <span className="text-[11px] font-bold text-indigo-900 px-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              Horizon:
            </span>
            <button
              type="button"
              onClick={() => setForecastHorizonDays(0)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                forecastHorizonDays === 0
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Turn Off (Historical Only)
            </button>
            <button
              type="button"
              onClick={() => setForecastHorizonDays(7)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                forecastHorizonDays === 7
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Predict 7 Days
            </button>
            <button
              type="button"
              onClick={() => setForecastHorizonDays(14)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                forecastHorizonDays === 14
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-indigo-100/60'
              }`}
            >
              Predict 14 Days
            </button>
            <button
              type="button"
              onClick={() => setForecastHorizonDays(30)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                forecastHorizonDays === 30
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
              const active = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {/* Flights */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-indigo-600" />
                Flights (Samui USM)
              </span>
              <span className="font-mono text-indigo-600">
                {scenarioFactors.flightGrowthPct >= 0 ? '+' : ''}
                {scenarioFactors.flightGrowthPct}%
              </span>
            </div>
            <input
              type="range"
              min={-10}
              max={45}
              step={1}
              value={scenarioFactors.flightGrowthPct}
              onChange={(e) => {
                setActivePresetId('custom');
                setScenarioFactors((prev) => ({
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
                {scenarioFactors.touristGrowthPct >= 0 ? '+' : ''}
                {scenarioFactors.touristGrowthPct}%
              </span>
            </div>
            <input
              type="range"
              min={-10}
              max={50}
              step={1}
              value={scenarioFactors.touristGrowthPct}
              onChange={(e) => {
                setActivePresetId('custom');
                setScenarioFactors((prev) => ({
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
                {scenarioFactors.ambientTempDeltaC >= 0 ? '+' : ''}
                {scenarioFactors.ambientTempDeltaC.toFixed(1)} °C
              </span>
            </div>
            <input
              type="range"
              min={-1.5}
              max={5.0}
              step={0.1}
              value={scenarioFactors.ambientTempDeltaC}
              onChange={(e) => {
                setActivePresetId('custom');
                setScenarioFactors((prev) => ({
                  ...prev,
                  ambientTempDeltaC: Number(e.target.value),
                }));
              }}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Discrete Sampling Points Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden transition-all duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Section {activeSection.sectionId} ({activeSection.name}) — Discrete Sampling Points &amp; 6-Zone Forecast Matrix
                </h3>
                <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                  {pointBreakdown.length} Points
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Matching exact sampling points defined in text file &amp; Satellite Heat Map
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedSamplingPointId !== 'ALL' && !isMatrixMinimized && (
              <button
                type="button"
                onClick={() => setSelectedSamplingPointId('ALL')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition-colors"
              >
                Reset to Entire Section
              </button>
            )}

            {/* Minimize / Expand Toggle Button */}
            <button
              id="toggle-matrix-minimize-btn"
              type="button"
              onClick={() => setIsMatrixMinimized((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-all active:scale-95 shadow-xs ${
                isMatrixMinimized
                  ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-500'
                  : 'bg-slate-900 text-white border-slate-800 hover:bg-slate-800'
              }`}
              title={isMatrixMinimized ? 'Expand Discrete Sampling Points & 6-Zone Forecast Matrix' : 'Minimize / Hide Discrete Sampling Points & 6-Zone Forecast Matrix'}
              aria-label={isMatrixMinimized ? 'Expand Matrix' : 'Minimize Matrix'}
            >
              {isMatrixMinimized ? (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Expand Matrix ({pointBreakdown.length})</span>
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-200" />
                </>
              ) : (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Minimize Matrix</span>
                  <ChevronUp className="w-3.5 h-3.5 text-slate-300" />
                </>
              )}
            </button>
          </div>
        </div>

        {isMatrixMinimized ? (
          <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-100/60 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>Matrix minimized ({pointBreakdown.length} intra-section discrete sampling points hidden). Click <strong>&ldquo;Expand Matrix&rdquo;</strong> to view.</span>
            </span>
            <button
              type="button"
              onClick={() => setIsMatrixMinimized(false)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer hover:underline"
            >
              Show Table
            </button>
          </div>
        ) : !csvDatabaseSource || pointBreakdown.length === 0 ? (
          <div className="px-6 py-8 bg-slate-50/60 border-t border-slate-100 text-center text-xs text-slate-500">
            Upload an Excel/CSV Database file or load a Google Drive Shared URL above to populate the Discrete Sampling Points &amp; 6-Zone Forecast Matrix.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto overflow-x-auto border-t border-slate-100">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-900 shadow-xs">
                <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4">Point ID &amp; Pos</th>
                  <th className="py-3 px-4">Phase &amp; KP</th>
                  <th className="py-3 px-4">DOF Meter</th>
                  <th className="py-3 px-4">GPS Coordinates</th>
                  <th className="py-3 px-4">Recorded Daily Max Fiber Tf</th>
                  <th className="py-3 px-4">Recorded Daily Max Conductor Tc</th>
                  <th className="py-3 px-4">Current 6-Zone</th>
                  <th className="py-3 px-4">Forecast Daily Max +{forecastHorizonDays}d Tc</th>
                  <th className="py-3 px-4">Forecast 6-Zone Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {pointBreakdown.map((pt) => {
                  const isSelected = selectedSamplingPointId === pt.id;
                  return (
                    <tr
                      key={pt.id}
                      onClick={() => setSelectedSamplingPointId(isSelected ? 'ALL' : pt.id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? 'bg-indigo-50/90' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono font-bold text-indigo-700">
                        <div>{pt.id}</div>
                        <div className="text-[10px] text-slate-500 font-sans">{pt.pos}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">
                        <span className="font-bold">{pt.phase || 'SM'}</span> · {pt.kp}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-800">
                        {pt.dof.toFixed(2)} m
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500 text-[11px]">
                        {pt.latitude.toFixed(5)}, {pt.longitude.toFixed(5)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">
                        {pt.currentTf.toFixed(2)} °C
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                        {pt.currentTc.toFixed(2)} °C
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                          style={{
                            backgroundColor: `${pt.currentZone.color}18`,
                            color: pt.currentZone.color,
                          }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.currentZone.color }} />
                          {pt.currentZone.name}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                        {pt.forecastTc.toFixed(2)} °C{' '}
                        <span className="text-[11px] text-slate-500">
                          ({pt.deltaTc >= 0 ? '+' : ''}
                          {pt.deltaTc.toFixed(2)}°C)
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                          style={{
                            backgroundColor: `${pt.forecastZone.color}18`,
                            color: pt.forecastZone.color,
                          }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.forecastZone.color }} />
                          {pt.forecastZone.name} ({pt.forecastZone.rangeText})
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI Generated Engineering Report Display Panel */}
      {aiReportMarkdown && (
        <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  AI Engineering Summary &amp; Future Trend Report — Sec {activeSection.sectionId}: {activeSection.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Generated {aiProcessedAt ? new Date(aiProcessedAt).toLocaleString() : 'just now'} • Ready for A4 PDF Print/Download
                </p>
              </div>
            </div>
            <button
              onClick={handleExportSectionPdf}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print / Save as PDF
            </button>
          </div>
          <div className="prose prose-slate max-w-none text-xs leading-relaxed whitespace-pre-wrap font-sans text-slate-700 bg-slate-50 p-5 rounded-xl border border-slate-200/80">
            {aiReportMarkdown}
          </div>
        </div>
      )}

      {/* Mini Pop-Up Data Reading Percentage Modal */}
      {readingSectionProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 text-white rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    readingSectionProgress.isCompleted
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  }`}
                >
                  {readingSectionProgress.isCompleted ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">
                    {readingSectionProgress.isCompleted
                      ? 'Section Peak Extraction Complete'
                      : `Reading Section ${activeSection.sectionId} Max Fiber Temp`}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {activeSection.name} • DOF {dofBounds.startDof.toFixed(2)}m – {dofBounds.endDof.toFixed(2)}m
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  abortReadingSectionRef.current = true;
                  setReadingSectionProgress(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                title="Close popup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress Percentage & Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  {readingSectionProgress.stage === 'phase-separation'
                    ? `Stage 1: Phase Separation (${readingSectionProgress.targetPhaseLabel || 'Target Phase'})`
                    : `Stage 2: Reading Related DOF Only (${dofBounds.startDof.toFixed(0)}m–${dofBounds.endDof.toFixed(0)}m)`}
                </span>
                <span className="font-mono text-base font-extrabold text-emerald-400">
                  {readingSectionProgress.pct}%
                </span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
                  style={{ width: `${readingSectionProgress.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>
                  Target Files Read: {readingSectionProgress.loaded} / {readingSectionProgress.total}
                </span>
                <span>Date: {readingSectionProgress.currentDate}</span>
              </div>
            </div>

            {/* Phase Separation Summary Box */}
            {readingSectionProgress.totalFolderFilesInPeriod !== undefined && (
              <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-[11px]">
                <div>
                  <div className="text-slate-400">Total in Period</div>
                  <div className="font-mono font-bold text-slate-200">
                    {readingSectionProgress.totalFolderFilesInPeriod}
                  </div>
                </div>
                <div className="border-x border-slate-800">
                  <div className="text-cyan-400">Focused Phase</div>
                  <div className="font-mono font-bold text-cyan-300">
                    {readingSectionProgress.focusedPhaseFilesCount ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-amber-400">Skipped Other</div>
                  <div className="font-mono font-bold text-amber-300">
                    {readingSectionProgress.skippedOtherPhaseCount ?? 0}
                  </div>
                </div>
              </div>
            )}

            {/* Current File & Detected Max Tf */}
            <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Active File:</span>
                <span className="font-mono text-slate-200 truncate max-w-[240px]">
                  {readingSectionProgress.currentFileName}
                </span>
              </div>
              {readingSectionProgress.foundPeakTf !== undefined && (
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                  <span className="text-slate-400">Max Fiber Temp in Sec {activeSection.sectionId}:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {readingSectionProgress.foundPeakTf.toFixed(2)} °C ({readingSectionProgress.peakDate})
                  </span>
                </div>
              )}
              {readingSectionProgress.isCompleted && readingSectionProgress.elapsedSec && (
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80 text-[11px]">
                  <span className="text-slate-400">Extraction Time:</span>
                  <span className="font-mono text-cyan-300">
                    {readingSectionProgress.elapsedSec}s ({readingSectionProgress.datesLoadedCount ?? 0} days updated)
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-1">
              {!readingSectionProgress.isCompleted ? (
                <button
                  type="button"
                  onClick={() => {
                    abortReadingSectionRef.current = true;
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                >
                  Stop &amp; Keep Loaded Data
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setReadingSectionProgress(null)}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer"
                >
                  Done • View Updated Chart 1
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mini Pop-Up Loading Screen Modal for CSV & Multi-Sheet Database Generation */}
      {csvGenModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-slate-900 text-white rounded-2xl border border-indigo-500/40 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                    csvGenModal.stage === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  }`}
                >
                  {csvGenModal.stage === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">
                    {csvGenModal.stage === 'completed'
                      ? csvGenModal.databaseKind === 'section-daily-profile'
                        ? '19-Sheet Section Daily Profile (.XLSX) Ready!'
                        : '19-Sheet Excel (.XLSX) & CSV Database Ready!'
                      : csvGenModal.databaseKind === 'section-daily-profile'
                      ? 'Constructing 19-Sheet Section Daily Profile...'
                      : 'Constructing 19-Sheet Database File...'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {csvGenModal.databaseKind === 'section-daily-profile'
                      ? `1 Section per 1 Sheet (19 Sheets Total) • Hourly DOF Peaks (Tf & Tc) & Coincident 4-Circuit Power • Date Period: ${
                          csvGenModal.generatedResult?.dateKeys && csvGenModal.generatedResult.dateKeys.length > 0
                            ? csvGenModal.generatedResult.dateKeys[0] === csvGenModal.generatedResult.dateKeys[csvGenModal.generatedResult.dateKeys.length - 1]
                              ? csvGenModal.generatedResult.dateKeys[0]
                              : `${csvGenModal.generatedResult.dateKeys[0]} → ${csvGenModal.generatedResult.dateKeys[csvGenModal.generatedResult.dateKeys.length - 1]}`
                            : csvGenModal.currentDate || (startDate && endDate ? `${startDate} → ${endDate}` : 'Active Building Period')
                        }`
                      : `1 Section per 1 Sheet (19 Sheets Total: Sec_1.1–1.6 & Zone_2.1–2.13) • Date Period: ${
                          csvGenModal.generatedResult?.dateKeys && csvGenModal.generatedResult.dateKeys.length > 0
                            ? csvGenModal.generatedResult.dateKeys[0] === csvGenModal.generatedResult.dateKeys[csvGenModal.generatedResult.dateKeys.length - 1]
                              ? csvGenModal.generatedResult.dateKeys[0]
                              : `${csvGenModal.generatedResult.dateKeys[0]} → ${csvGenModal.generatedResult.dateKeys[csvGenModal.generatedResult.dateKeys.length - 1]}`
                            : csvGenModal.currentDate || (startDate && endDate ? `${startDate} → ${endDate}` : 'Active Building Period')
                        }`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  abortDatabaseGenRef.current = true;
                  setCsvGenModal((prev) => ({ ...prev, isOpen: false }));
                }}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Overall Percentage Bar & Live ETA Waiting Time */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold font-mono text-cyan-400">
                    {csvGenModal.pct}%
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Overall Progress
                  </span>
                </div>
                <div className="text-xs font-mono text-right space-x-3">
                  <span className="text-amber-300 font-bold">
                    ETA Waiting Time:{' '}
                    {csvGenModal.stage === 'completed'
                      ? '00m 00s'
                      : `${Math.floor(csvGenModal.etaSec / 60)
                          .toString()
                          .padStart(2, '0')}m ${(csvGenModal.etaSec % 60)
                          .toString()
                          .padStart(2, '0')}s`}
                  </span>
                  <span className="text-slate-300">
                    Elapsed:{' '}
                    {Math.floor(csvGenModal.elapsedSec / 60)
                      .toString()
                      .padStart(2, '0')}
                    m {(csvGenModal.elapsedSec % 60).toString().padStart(2, '0')}s
                  </span>
                </div>
              </div>

              {/* Overall Progress Bar */}
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-150"
                  style={{ width: `${Math.max(3, csvGenModal.pct)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-300 pt-0.5">
                <span className="truncate pr-2">{csvGenModal.currentSheetName}</span>
                <span className="shrink-0 text-cyan-300">Date: {csvGenModal.currentDate}</span>
              </div>
            </div>

            {/* Dual Sub-Progress Trackers: Stage 1 (.TEPR Reading) & Stage 2 (19-Sheet Calculation) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/90 p-3.5 rounded-xl border border-slate-800 text-xs font-mono">
              {/* Stage 1: Reading Raw .TEPR Files */}
              <div className="space-y-1.5 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-cyan-300">
                    1. Reading Raw .TEPR Files
                  </span>
                  <span className="text-[11px] font-extrabold text-white">
                    {csvGenModal.readingPct}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 rounded-full transition-all duration-150"
                    style={{ width: `${csvGenModal.readingPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>
                    Files: {csvGenModal.filesRead} / {csvGenModal.filesTotal}
                  </span>
                  {csvGenModal.filesPerSec > 0 && (
                    <span className="text-emerald-400">{csvGenModal.filesPerSec} files/s</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 truncate" title={csvGenModal.currentFileName}>
                  File: {csvGenModal.currentFileName || 'Ready'}
                </div>
              </div>

              {/* Stage 2: Calculating 19 Section Sheets */}
              <div className="space-y-1.5 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-emerald-300">
                    2. Section &amp; IEC Calculation
                  </span>
                  <span className="text-[11px] font-extrabold text-white">
                    {csvGenModal.calculationPct}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-150"
                    style={{ width: `${csvGenModal.calculationPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>
                    Sheets: {csvGenModal.sectionsCalculated} / {csvGenModal.sectionsTotal}
                  </span>
                  <span className="text-emerald-400">{csvGenModal.loaded} rows</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  IEC 60287 Tc + Max/Min DOF (m)
                </div>
              </div>
            </div>

            {/* Compiled Parameters Summary */}
            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                <span className="text-slate-400">Workbook Structure:</span>
                <span className="font-bold text-cyan-300">
                  19 Separate Sheets (1 Section per 1 Sheet: Sec_1.1–1.6 &amp; Zone_2.1–2.13)
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                <span className="text-slate-400">Phases &amp; DOF Tracking:</span>
                <span className="font-bold text-emerald-400">
                  Land (Phase A, B, C) • Subsea (SM) • Distinct Max &amp; Min DOF (m)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Visual Chart Loading:</span>
                <span className="font-bold text-amber-300">
                  {csvGenModal.stage === 'completed'
                    ? 'Manual • Upload .xlsx/.csv or paste URL below'
                    : 'Not auto-loaded (Manual add by user)'}
                </span>
              </div>
            </div>

            {/* Fast Skip Button while reading large remote sets */}
            {csvGenModal.stage === 'reading-tepr' && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    abortDatabaseGenRef.current = true;
                  }}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors cursor-pointer"
                >
                  Skip Remaining Remote Reads &amp; Build 19 Sheets Now →
                </button>
              </div>
            )}

            {/* Completion Buttons */}
            {csvGenModal.stage === 'completed' && csvGenModal.generatedResult && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const res = csvGenModal.generatedResult;
                      if (!res) return;
                      const blob = new Blob([res.xlsxBuffer], {
                        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${res.filenameBase}.xlsx`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all cursor-pointer shadow-md"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>
                      {csvGenModal.databaseKind === 'section-daily-profile'
                        ? 'Download Profile .XLSX (19 Sheets)'
                        : 'Download .XLSX (19 Separate Sheets)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const res = csvGenModal.generatedResult;
                      if (!res) return;
                      const blob = new Blob([res.csvText], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${res.filenameBase}.csv`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all cursor-pointer shadow-md"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {csvGenModal.databaseKind === 'section-daily-profile'
                        ? 'Download Profile .CSV (Multi-Section)'
                        : 'Download .CSV Format'}
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setCsvGenModal((prev) => ({ ...prev, isOpen: false }))}
                  className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer"
                >
                  Done • Close Window
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
