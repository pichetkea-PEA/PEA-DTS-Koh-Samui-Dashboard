import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { User } from 'firebase/auth';
import { 
  Activity, 
  Bot, 
  Sparkles, 
  HardDrive, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Layers, 
  Thermometer, 
  Target, 
  FileText,
  RefreshCw,
  PlusCircle,
  MapPin,
  FolderCog,
  ExternalLink,
  Zap,
  FileSpreadsheet
} from 'lucide-react';
import { DriveFile, DriveFolder } from './types';
import { initAuth, googleSignIn, logout, onAccessTokenChange } from './services/firebaseAuth';
import { 
  fetchFilesInFolder, 
  fetchFileContent, 
  fetchFileArrayBuffer,
  fetchBatchFilesContent,
  fetchDriveFolderItems,
  fastFetchAndParseTeprFiles,
  scanTeprFilesMetadata,
  saveSummaryToGoogleDrive, 
  uploadTextFileToGoogleDrive,
  findDriveFoldersByNames,
  savePermanentConfigToDrive,
  loadPermanentConfigFromDrive,
  saveUserPreferencesToServer,
  loadUserPreferencesFromServer,
  driveAuthorizedFetch
} from './services/driveApi';
import { runCableAgentSummarize } from './services/agentApi';
import { 
  TARGET_LOCATIONS, 
  ParsedTeprFile, 
  parseTeprContent, 
  buildLocationTimeSeries, 
  buildHourlyLocationTimeSeries,
  aggregateHourlyTeprFiles,
  HourlyTeprSummary,
  generateSampleTeprContent, 
  generateSampleTeprDataset,
  parseMultipleTeprFiles,
  LocationTimeSeriesSummary,
  ScannedFileMeta
} from './services/teprParser';
import {
  DailyPowerSummary,
  PowerScannedFileMeta,
  SubstationCode,
  scanPowerFilesMetadataOnly,
  parseDailyCsvContent,
  mergeDailySubstations,
  generateSamplePowerDataset,
  buildFallbackDailyPowerSummary,
  isSyntheticPowerSummary,
} from './services/powerConsumptionParser';

import { Header, AppPageTab } from './components/Header';
import { TopGlobalHeader } from './components/TopGlobalHeader';
import { PublicSidebar, PublicDashboardTab } from './components/PublicSidebar';
import { PublicHeatMapPage } from './components/PublicHeatMapPage';
import { PublicDailyCurvePage } from './components/PublicDailyCurvePage';
import { Public3DPowerTempPage } from './components/Public3DPowerTempPage';
import { PublicYearlyComparisonPage } from './components/PublicYearlyComparisonPage';
import { PublicTempStatisticsPage } from './components/PublicTempStatisticsPage';
import { PublicPowerStatisticsPage } from './components/PublicPowerStatisticsPage';
import { PublicDataSettingPage } from './components/PublicDataSettingPage';
import { DataSettingPasswordModal } from './components/DataSettingPasswordModal';
import {
  getOrgDatabaseConfig,
  subscribeToOrgDatabase,
  OrgDatabaseConfig,
  saveUploadedOrgDatabase,
  saveUploadedPowerDatabase,
  getPermanentFolder3Setting,
  savePermanentFolder3Setting,
  getPermanentFolder4Setting,
  savePermanentFolder4Setting,
  getOrgPowerDatabaseRecordsCount,
  getOrgPowerDatabaseDateRange,
  syncAllPublicSharedTargetFolders,
} from './services/orgDatabaseStorage';
import { FolderSelector, PowerSubstationFoldersConfig } from './components/FolderSelector';
import { CableTemperatureChart } from './components/CableTemperatureChart';
import { CableHeatMap } from './components/CableHeatMap';
import { TargetLocationsMatrix } from './components/TargetLocationsMatrix';
import { TeprFileManager } from './components/TeprFileManager';
import { CableSummaryReport } from './components/CableSummaryReport';
import { ConfirmationModal } from './components/ConfirmationModal';
import { PowerConsumptionPage } from './components/PowerConsumptionPage';
import { SectionAnalyzingPage } from './components/SectionAnalyzingPage';
import { RiskManagementPage } from './components/RiskManagementPage';
import { YearlyComparisonPage } from './components/YearlyComparisonPage';
import { AdminAiSummaryPage } from './components/AdminAiSummaryPage';
import { VideoGameLoadingScreen } from './components/VideoGameLoadingScreen';
import { PublicElectricalLoadingScreen } from './components/PublicElectricalLoadingScreen';

export default function App() {
  // Navigation tab for Admin Internal Suite: 'management' (Page 1) to 'yearly' (Page 7)
  const [activeTab, setActiveTab] = useState<AppPageTab>('management');

  // Navigation tab for Public Dashboard: 'heatmap' (2.1), 'dailycurve' (2.2), 'powertemp3d' (2.3), 'yearly' (2.4)
  const [publicTab, setPublicTab] = useState<PublicDashboardTab>('heatmap');
  const [isDataSettingPwdModalOpen, setIsDataSettingPwdModalOpen] = useState<boolean>(false);
  const [isPublicSidebarCollapsed, setIsPublicSidebarCollapsed] = useState<boolean>(false);
  const [adminViewMode, setAdminViewMode] = useState<'internal' | 'public'>('internal');
  const [dbConfig, setDbConfig] = useState<OrgDatabaseConfig>(() => getOrgDatabaseConfig());

  // Subscribe to changes in persistent organization database
  useEffect(() => {
    const unsubscribe = subscribeToOrgDatabase(() => {
      setDbConfig({ ...getOrgDatabaseConfig() });
    });
    return unsubscribe;
  }, []);

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showGameLoadingScreen, setShowGameLoadingScreen] = useState<boolean>(false);

  // Folder & File selection
  const [permanentFolder, setPermanentFolder] = useState<DriveFolder | null>(() => {
    try {
      const saved = localStorage.getItem('dts_permanent_fiber_folder_v1');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return null;
  });

  const [currentFolder, setCurrentFolder] = useState<DriveFolder>(() => {
    try {
      const savedPermanent = localStorage.getItem('dts_permanent_fiber_folder_v1');
      if (savedPermanent) {
        const parsed = JSON.parse(savedPermanent);
        if (parsed && parsed.id) return parsed;
      }
      const savedLast = localStorage.getItem('dts_last_fiber_folder_v1');
      if (savedLast) {
        const parsed = JSON.parse(savedLast);
        if (parsed && parsed.id) return parsed;
      }
    } catch (e) {
      // ignore
    }
    return { id: 'root', name: 'My Drive' };
  });

  // Target Folder 3 · Daily Temperature Record
  const [permanentFolder3, setPermanentFolder3] = useState<DriveFolder | null>(() => {
    try {
      const saved = getPermanentFolder3Setting();
      if (saved && saved.id) return saved;
      const raw = localStorage.getItem('dts_permanent_folder_3_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  });
  const [folder3, setFolder3] = useState<DriveFolder>(() => {
    try {
      const p = getPermanentFolder3Setting();
      if (p && p.id) return p;
      const raw = localStorage.getItem('dts_permanent_folder_3_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return parsed;
      }
    } catch (e) {}
    return { id: 'root', name: 'My Drive' };
  });
  const [isScanningFolder3, setIsScanningFolder3] = useState(false);

  // Target Folder 4 · Daily Maximum Power Record of 4 Circuits
  const [permanentFolder4, setPermanentFolder4] = useState<DriveFolder | null>(() => {
    try {
      const saved = getPermanentFolder4Setting();
      if (saved && saved.id) return saved;
      const raw = localStorage.getItem('dts_permanent_folder_4_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  });
  const [folder4, setFolder4] = useState<DriveFolder>(() => {
    try {
      const p = getPermanentFolder4Setting();
      if (p && p.id) return p;
      const raw = localStorage.getItem('dts_permanent_folder_4_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return parsed;
      }
    } catch (e) {}
    return { id: 'root', name: 'My Drive' };
  });
  const [isScanningFolder4, setIsScanningFolder4] = useState(false);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number; fileName: string } | null>(null);

  // Metadata & Reading Temperature state
  const [scannedFiles, setScannedFiles] = useState<ScannedFileMeta[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isReadingTemperature, setIsReadingTemperature] = useState(false);
  const [hasReadTemperature, setHasReadTemperature] = useState(false);
  const [loadedFilters, setLoadedFilters] = useState<{ year: string; month: string; date: string } | null>(null);

  // Refs to prevent background folder-restore effects from wiping active temperature reads
  const lastScannedFolderIdRef = useRef<string | null>(null);
  const isReadingTemperatureRef = useRef<boolean>(false);
  const hasReadTemperatureRef = useRef<boolean>(false);
  const hasScannedFilesRef = useRef<boolean>(false);
  const attemptedPowerDatesRef = useRef<Set<string>>(new Set());

  // Parsed .TEPR Data
  const [parsedFiles, setParsedFiles] = useState<ParsedTeprFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<number | null>(2486.50); // Default to Joint Pit 1 (JP1)
  const [targetSectionForAnalyzing, setTargetSectionForAnalyzing] = useState<string | undefined>(undefined);

  // Target Folders 2 (Set ONLY in Page 1 "Folder & Asset"): Power Consumption of 4 Circuits (KMB, KMA, KNA)
  const [powerFolders, setPowerFolders] = useState<PowerSubstationFoldersConfig>(() => {
    try {
      const saved = localStorage.getItem('power_substation_folders_v2');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return {
      parentFolder: { id: 'root', name: 'Power Submarine Cables (Master)' },
      KMB: { id: 'root', name: 'KMB' },
      KMA: { id: 'root', name: 'KMA' },
      KNA: { id: 'root', name: 'KNA' },
    };
  });
  const [powerTargetFolder, setPowerTargetFolder] = useState<DriveFolder>(() => {
    try {
      const saved = localStorage.getItem('power_target_folder_config');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return { id: 'root', name: 'KMB, KMA & KNA (4 Circuits)' };
  });
  const [powerScannedFiles, setPowerScannedFiles] = useState<PowerScannedFileMeta[]>([]);
  const [powerCachedCsv, setPowerCachedCsv] = useState<Map<string, string>>(new Map());
  const [powerSummariesByDate, setPowerSummariesByDate] = useState<Map<string, DailyPowerSummary>>(new Map());
  const [isSyncingPowerForDate, setIsSyncingPowerForDate] = useState<boolean>(false);
  const powerScanInFlightRef = useRef<Promise<PowerScannedFileMeta[]> | null>(null);
  const powerCsvMemoryCache = useRef<Map<string, string>>(new Map());

  // Scan KMB, KMA, and KNA target folders from Google Drive
  const scanConfiguredPowerFolders = useCallback(
    async (foldersToScan: PowerSubstationFoldersConfig = powerFolders): Promise<PowerScannedFileMeta[]> => {
      if (!accessToken) return [];
      if (powerScanInFlightRef.current) {
        return powerScanInFlightRef.current;
      }

      const scanPromise = (async () => {
        setIsSyncingPowerForDate(true);
        try {
          const allScanned: PowerScannedFileMeta[] = [];
          const seenKeys = new Set<string>();

        const addScanned = (items: PowerScannedFileMeta[]) => {
          for (const item of items) {
            const key = `${item.substation}-${item.fileId}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allScanned.push(item);
            }
          }
        };

        // 1. Scan parentFolder (Target Folder 2 master) if configured
        const parentId =
          foldersToScan.parentFolder?.id &&
          foldersToScan.parentFolder.id !== 'root' &&
          foldersToScan.parentFolder.id !== 'sample-folder'
            ? foldersToScan.parentFolder.id
            : null;

        if (parentId) {
          const parentCsvs = await fetchFilesInFolder(
            accessToken,
            parentId,
            'csv',
            '',
            8,
            foldersToScan.parentFolder?.name
          );
          const parentMeta = scanPowerFilesMetadataOnly(parentCsvs);
          addScanned(parentMeta);
        }

        // 2. Scan dedicated KMB, KMA, KNA folders ONLY if their IDs are distinct from parentFolder
        const substationEntries: Array<{ code: SubstationCode; folder: DriveFolder }> = [
          { code: 'KMB', folder: foldersToScan.KMB },
          { code: 'KMA', folder: foldersToScan.KMA },
          { code: 'KNA', folder: foldersToScan.KNA },
        ];

        await Promise.all(
          substationEntries.map(async ({ code, folder }) => {
            if (folder && folder.id && folder.id !== 'root' && folder.id !== parentId) {
              const csvFiles = await fetchFilesInFolder(accessToken, folder.id, 'csv', '', 8, code);
              const meta = scanPowerFilesMetadataOnly(csvFiles, code);
              addScanned(meta);
            }
          })
        );

        allScanned.sort((a, b) => a.dateMeta.timestamp - b.dateMeta.timestamp);
        if (allScanned.length > 0) {
          setPowerScannedFiles((prev) =>
            prev.length === allScanned.length &&
            prev[0]?.fileId === allScanned[0]?.fileId &&
            prev[prev.length - 1]?.fileId === allScanned[allScanned.length - 1]?.fileId
              ? prev
              : allScanned
          );
          // Clear demo/sample summaries if real Drive CSV files were discovered
          setPowerSummariesByDate((prev) => {
            let removedAny = false;
            const next = new Map<string, DailyPowerSummary>();
            prev.forEach((val, key) => {
              if (!isSyntheticPowerSummary(val)) {
                next.set(key, val);
              } else {
                removedAny = true;
              }
            });
            return removedAny ? next : prev;
          });
        }
        return allScanned;
        } catch (err) {
          console.warn('Error scanning KMB, KMA, KNA power folders:', err);
          return [];
        } finally {
          setIsSyncingPowerForDate(false);
        }
      })();

      powerScanInFlightRef.current = scanPromise;
      return scanPromise.finally(() => {
        powerScanInFlightRef.current = null;
      });
    },
    [accessToken, powerFolders]
  );

  // Update powerFolders from Page 1 ("Folder & Asset") and persist to localStorage, server, and Drive
  const handleUpdatePowerFolders = useCallback(
    async (next: PowerSubstationFoldersConfig) => {
      setPowerFolders(next);
      try {
        localStorage.setItem('power_substation_folders_v2', JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      saveUserPreferencesToServer({
        email: user?.email,
        uid: user?.uid,
        permanentFolder,
        powerFolders: next,
      });
      if (accessToken) {
        savePermanentConfigToDrive(accessToken, {
          permanentFolder,
          powerFolders: next,
        });
        const scanned = await scanConfiguredPowerFolders(next);
        if (scanned.length > 0) {
          showNotification(
            'success',
            `Scanned ${scanned.length} CSV files across KMB (115kV #3), KMA (115kV #2) & KNA (33kV NKT & Oil)!`
          );
        }
      }
    },
    [accessToken, scanConfiguredPowerFolders, user, permanentFolder]
  );

  // Restore saved permanent Target Folders 1, 3, 4 & Power Target Folders from Server Memory on initial mount (works across devices)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const serverPrefs = await loadUserPreferencesFromServer({
        email: user?.email,
        uid: user?.uid,
      });
      if (cancelled || !serverPrefs) return;

      if (
        serverPrefs.permanentFolder &&
        serverPrefs.permanentFolder.id &&
        serverPrefs.permanentFolder.id !== 'root'
      ) {
        setPermanentFolder((prev) =>
          prev?.id === serverPrefs.permanentFolder.id ? prev : serverPrefs.permanentFolder
        );
        setCurrentFolder((prev) =>
          prev.id === serverPrefs.permanentFolder.id ? prev : serverPrefs.permanentFolder
        );
        try {
          localStorage.setItem(
            'dts_permanent_fiber_folder_v1',
            JSON.stringify(serverPrefs.permanentFolder)
          );
          localStorage.setItem(
            'dts_last_fiber_folder_v1',
            JSON.stringify(serverPrefs.permanentFolder)
          );
        } catch (e) {
          // ignore
        }
      }

      if (
        serverPrefs.permanentFolder3 &&
        serverPrefs.permanentFolder3.id &&
        serverPrefs.permanentFolder3.id !== 'root'
      ) {
        setPermanentFolder3((prev) =>
          prev?.id === serverPrefs.permanentFolder3!.id ? prev : serverPrefs.permanentFolder3!
        );
        setFolder3((prev) =>
          prev.id === serverPrefs.permanentFolder3!.id ? prev : serverPrefs.permanentFolder3!
        );
        savePermanentFolder3Setting(serverPrefs.permanentFolder3);
        try {
          localStorage.setItem(
            'dts_permanent_folder_3_v1',
            JSON.stringify(serverPrefs.permanentFolder3)
          );
        } catch (e) {}
      }

      if (
        serverPrefs.permanentFolder4 &&
        serverPrefs.permanentFolder4.id &&
        serverPrefs.permanentFolder4.id !== 'root'
      ) {
        setPermanentFolder4((prev) =>
          prev?.id === serverPrefs.permanentFolder4!.id ? prev : serverPrefs.permanentFolder4!
        );
        setFolder4((prev) =>
          prev.id === serverPrefs.permanentFolder4!.id ? prev : serverPrefs.permanentFolder4!
        );
        savePermanentFolder4Setting(serverPrefs.permanentFolder4);
        try {
          localStorage.setItem(
            'dts_permanent_folder_4_v1',
            JSON.stringify(serverPrefs.permanentFolder4)
          );
        } catch (e) {}
      }

      if (serverPrefs.powerFolders) {
        setPowerFolders(serverPrefs.powerFolders);
        try {
          localStorage.setItem(
            'power_substation_folders_v2',
            JSON.stringify(serverPrefs.powerFolders)
          );
        } catch (e) {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, user?.uid]);

  // Restore saved permanent Target Folders from Google Drive & Server Memory whenever user logs in from any device
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      const [driveConfig, serverPrefs] = await Promise.all([
        loadPermanentConfigFromDrive(accessToken),
        loadUserPreferencesFromServer({ email: user?.email, uid: user?.uid }),
      ]);
      if (cancelled) return;

      const restoredPermanent =
        (driveConfig?.permanentFolder?.id &&
        driveConfig.permanentFolder.id !== 'root'
          ? driveConfig.permanentFolder
          : null) ||
        (serverPrefs?.permanentFolder?.id &&
        serverPrefs.permanentFolder.id !== 'root'
          ? serverPrefs.permanentFolder
          : null) ||
        (permanentFolder?.id && permanentFolder.id !== 'root'
          ? permanentFolder
          : null);

      if (restoredPermanent) {
        setPermanentFolder((prev) =>
          prev?.id === restoredPermanent.id ? prev : restoredPermanent
        );
        setCurrentFolder((prev) =>
          prev.id === restoredPermanent.id ? prev : restoredPermanent
        );
        try {
          localStorage.setItem(
            'dts_permanent_fiber_folder_v1',
            JSON.stringify(restoredPermanent)
          );
          localStorage.setItem(
            'dts_last_fiber_folder_v1',
            JSON.stringify(restoredPermanent)
          );
        } catch (e) {
          // ignore
        }
      }

      // Restore Target Folder 3
      const restoredFolder3 =
        (driveConfig?.permanentFolder3?.id && driveConfig.permanentFolder3.id !== 'root'
          ? driveConfig.permanentFolder3
          : null) ||
        (serverPrefs?.permanentFolder3?.id && serverPrefs.permanentFolder3.id !== 'root'
          ? serverPrefs.permanentFolder3
          : null) ||
        (permanentFolder3?.id && permanentFolder3.id !== 'root' ? permanentFolder3 : null);

      if (restoredFolder3) {
        setPermanentFolder3((prev) => (prev?.id === restoredFolder3.id ? prev : restoredFolder3));
        setFolder3((prev) => (prev.id === restoredFolder3.id ? prev : restoredFolder3));
        savePermanentFolder3Setting(restoredFolder3);
        try {
          localStorage.setItem('dts_permanent_folder_3_v1', JSON.stringify(restoredFolder3));
        } catch (e) {}
      }

      // Restore Target Folder 4
      const restoredFolder4 =
        (driveConfig?.permanentFolder4?.id && driveConfig.permanentFolder4.id !== 'root'
          ? driveConfig.permanentFolder4
          : null) ||
        (serverPrefs?.permanentFolder4?.id && serverPrefs.permanentFolder4.id !== 'root'
          ? serverPrefs.permanentFolder4
          : null) ||
        (permanentFolder4?.id && permanentFolder4.id !== 'root' ? permanentFolder4 : null);

      if (restoredFolder4) {
        setPermanentFolder4((prev) => (prev?.id === restoredFolder4.id ? prev : restoredFolder4));
        setFolder4((prev) => (prev.id === restoredFolder4.id ? prev : restoredFolder4));
        savePermanentFolder4Setting(restoredFolder4);
        try {
          localStorage.setItem('dts_permanent_folder_4_v1', JSON.stringify(restoredFolder4));
        } catch (e) {}
      }

      // Keep server and Drive in sync
      saveUserPreferencesToServer({
        email: user?.email,
        uid: user?.uid,
        permanentFolder: restoredPermanent,
        powerFolders: driveConfig?.powerFolders || serverPrefs?.powerFolders || powerFolders,
        permanentFolder3: restoredFolder3,
        permanentFolder4: restoredFolder4,
      });
      savePermanentConfigToDrive(accessToken, {
        permanentFolder: restoredPermanent,
        powerFolders: driveConfig?.powerFolders || serverPrefs?.powerFolders || powerFolders,
        permanentFolder3: restoredFolder3,
        permanentFolder4: restoredFolder4,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, user?.email, user?.uid]);

  // Auto-discover KMB, KMA, KNA folders in Google Drive when user connects
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      const needsLookup =
        powerFolders.KMB.id === 'root' ||
        powerFolders.KMA.id === 'root' ||
        powerFolders.KNA.id === 'root';
      let effectiveFolders = powerFolders;
      if (needsLookup) {
        const found = await findDriveFoldersByNames(accessToken, ['KMB', 'KMA', 'KNA']);
        if (!cancelled && (found.KMB || found.KMA || found.KNA)) {
          effectiveFolders = {
            ...powerFolders,
            KMB: found.KMB || powerFolders.KMB,
            KMA: found.KMA || powerFolders.KMA,
            KNA: found.KNA || powerFolders.KNA,
          };
          setPowerFolders(effectiveFolders);
          try {
            localStorage.setItem('power_substation_folders_v2', JSON.stringify(effectiveFolders));
          } catch (e) {
            // ignore
          }
        }
      }
      if (!cancelled) {
        await scanConfiguredPowerFolders(effectiveFolders);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Callback from PowerConsumptionPage when user updates Target Folder 2 or compiles power CSVs
  const handlePowerDataSync = useCallback(
    (
      summaries: Map<string, DailyPowerSummary>,
      scanned: PowerScannedFileMeta[],
      cachedCsv: Map<string, string>,
      folder: DriveFolder
    ) => {
      const hasRealScanned = scanned.some((f) => !f.fileId.startsWith('sample-'));
      setPowerSummariesByDate((prev) => {
        const filtered = new Map<string, DailyPowerSummary>();
        summaries.forEach((v, k) => {
          if (!hasRealScanned || !isSyntheticPowerSummary(v)) {
            filtered.set(k, v);
          }
        });
        let changed = prev.size !== filtered.size;
        if (!changed) {
          filtered.forEach((v, k) => {
            if (prev.get(k) !== v) changed = true;
          });
        }
        return changed ? filtered : prev;
      });
      setPowerScannedFiles((prev) =>
        prev === scanned ||
        (prev.length === scanned.length &&
          prev[0]?.fileId === scanned[0]?.fileId &&
          prev[prev.length - 1]?.fileId === scanned[scanned.length - 1]?.fileId)
          ? prev
          : scanned
      );
      setPowerCachedCsv((prev) => {
        let changed = prev.size !== cachedCsv.size;
        if (!changed) {
          cachedCsv.forEach((v, k) => {
            if (prev.get(k) !== v) changed = true;
          });
        }
        return changed ? new Map(cachedCsv) : prev;
      });
      setPowerTargetFolder((prev) => (prev.id === folder.id && prev.name === folder.name ? prev : folder));
    },
    []
  );

  // Resolve or fetch 4-Substation Power Consumption for a selected .TEPR reference date
  const ensurePowerSummaryForDate = useCallback(
    async (dateKey: string, strictExactDate = false): Promise<DailyPowerSummary | null> => {
      if (!dateKey || dateKey === 'all') return null;

      // 1. Check if already compiled in powerSummariesByDate
      const existing = powerSummariesByDate.get(dateKey);
      if (existing) {
        const isSyntheticDemo = isSyntheticPowerSummary(existing);
        if (!isSyntheticDemo) {
          // Verify all available substations (KMB, KMA, KNA) are present, or return if already loaded
          if (
            existing.substationsLoaded?.KMB &&
            existing.substationsLoaded?.KMA &&
            existing.substationsLoaded?.KNA
          ) {
            return existing;
          }
          if (!accessToken) {
            return existing;
          }
        } else if (!strictExactDate && !accessToken && powerScannedFiles.every((f) => f.fileId.startsWith('sample-'))) {
          return existing;
        }
      }

      // 2. Check local scanned files / cached CSVs first (works for both online & offline / locally uploaded Target Folder 2 files)
      try {
        let currentScanned = powerScannedFiles;
        const realScannedInitial = currentScanned.filter((f) => !f.fileId.startsWith('sample-'));
        if (realScannedInitial.length === 0 && accessToken) {
          const freshlyScanned = await scanConfiguredPowerFolders(powerFolders);
          if (freshlyScanned.length > 0) {
            currentScanned = freshlyScanned;
          }
        }

        const realScanned = currentScanned.filter((f) => !f.fileId.startsWith('sample-'));
        const candidatePool = realScanned;

        // Normalize requested dateKey (pad month and day to 2 digits: YYYY-MM-DD)
        const dateParts = dateKey.split(/[-_./]/);
        const normYear = dateParts[0] || '2026';
        const normMonth = String(parseInt(dateParts[1] || '3', 10)).padStart(2, '0');
        const normDay = String(parseInt(dateParts[2] || '1', 10)).padStart(2, '0');
        const normDateKey = `${normYear}-${normMonth}-${normDay}`;
        const numYear = parseInt(normYear, 10);
        const numMonth = parseInt(normMonth, 10);
        const numDay = parseInt(normDay, 10);

        const matchesRequestedDate = (f: PowerScannedFileMeta) =>
          f.dateMeta.dateKey === normDateKey ||
          f.dateMeta.dateKey === dateKey ||
          (f.dateMeta.year === numYear && f.dateMeta.month === numMonth && f.dateMeta.day === numDay);

        let matchingFiles = candidatePool.filter(matchesRequestedDate);

        // If no match in current pool and we have accessToken, try refreshing scan of Target Folder 2
        if (matchingFiles.length === 0 && accessToken) {
          const freshlyScanned = await scanConfiguredPowerFolders(powerFolders);
          if (freshlyScanned.length > 0) {
            const freshReal = freshlyScanned.filter((f) => !f.fileId.startsWith('sample-'));
            matchingFiles = freshReal.filter(matchesRequestedDate);
          }
        }

        // Check which substations (KMB, KMA, KNA) are already represented in matchingFiles
        const foundSubstations = new Set<SubstationCode>(matchingFiles.map((f) => f.substation));
        const missingAnySubstation =
          !foundSubstations.has('KMB') || !foundSubstations.has('KMA') || !foundSubstations.has('KNA');

        // Direct targeted Google Drive search fallback if any substation file (KMB, KMA, KNA) was not in the bulk scan
        if ((matchingFiles.length === 0 || missingAnySubstation) && accessToken) {
          const dottedDmy = `${normDay}.${normMonth}.${normYear}`; // e.g. 22.03.2026 (KMB_03.2026_22.03.2026.csv)
          const dashedDmy = `${normDay}-${normMonth}-${normYear}`; // e.g. 22-03-2026
          const underscoredDmy = `${normDay}_${normMonth}_${normYear}`; // e.g. 22_03_2026
          const compactDmy = `${normDay}${normMonth}${normYear}`; // e.g. 22032026
          const compactYmd = `${normYear}${normMonth}${normDay}`; // e.g. 20260322
          const compactDmyShort = `${normDay}${normMonth}${normYear.slice(2)}`;
          const singleDayDmy = `${numDay}.${normMonth}.${normYear}`;

          const qParts = [
            `name contains '${dottedDmy}'`,
            `name contains '${normDateKey}'`,
            `name contains '${dashedDmy}'`,
            `name contains '${underscoredDmy}'`,
            `name contains '${compactDmy}'`,
            `name contains '${compactYmd}'`,
            `name contains '${compactDmyShort}'`,
            `name contains '${singleDayDmy}'`,
          ];

          const targetFolderIds = [
            powerFolders.parentFolder?.id,
            powerFolders.KMB?.id,
            powerFolders.KMA?.id,
            powerFolders.KNA?.id,
          ].filter((id): id is string => Boolean(id && id !== 'root' && id !== 'sample-folder'));

          const directDiscovered: PowerScannedFileMeta[] = [];

          // 1. Search directly inside configured Target Folder 2 IDs
          for (const fid of Array.from(new Set(targetFolderIds))) {
            try {
              const query = `'${fid}' in parents and (${qParts.join(' or ')}) and trashed = false`;
              const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
                query
              )}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`;
              const res = await driveAuthorizedFetch(url, accessToken);
              if (res.ok) {
                const data = await res.json();
                const forcedSub: SubstationCode | undefined =
                  fid === powerFolders.KMB?.id
                    ? 'KMB'
                    : fid === powerFolders.KMA?.id
                    ? 'KMA'
                    : fid === powerFolders.KNA?.id
                    ? 'KNA'
                    : undefined;
                const meta = scanPowerFilesMetadataOnly(data.files || [], forcedSub).filter(
                  matchesRequestedDate
                );
                directDiscovered.push(...meta);
              }
            } catch {
              // Ignore search errors
            }
          }

          // 2. Also search across nested subfolders (e.g. KMB/03.2026/KMB_03.2026_22.03.2026.csv)
          const discoveredSubs = new Set<SubstationCode>([
            ...foundSubstations,
            ...directDiscovered.map((d) => d.substation),
          ]);
          if (!discoveredSubs.has('KMB') || !discoveredSubs.has('KMA') || !discoveredSubs.has('KNA')) {
            try {
              const globalQuery = `(${qParts.join(' or ')}) and trashed = false`;
              const globalUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
                globalQuery
              )}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`;
              const res = await driveAuthorizedFetch(globalUrl, accessToken);
              if (res.ok) {
                const data = await res.json();
                const meta = scanPowerFilesMetadataOnly(data.files || []).filter(matchesRequestedDate);
                directDiscovered.push(...meta);
              }
            } catch {
              // Ignore global search errors
            }
          }

          if (directDiscovered.length > 0) {
            const seenIds = new Set(matchingFiles.map((f) => f.fileId));
            for (const d of directDiscovered) {
              if (!seenIds.has(d.fileId)) {
                seenIds.add(d.fileId);
                matchingFiles.push(d);
              }
            }
            setPowerScannedFiles((prev) => {
              const existingIds = new Set(prev.map((p) => p.fileId));
              const newItems = directDiscovered.filter((d) => !existingIds.has(d.fileId));
              return newItems.length > 0 ? [...prev, ...newItems] : prev;
            });
          }
        }

        if (matchingFiles.length > 0) {
          const substationData: {
            KMA?: ReturnType<typeof parseDailyCsvContent>['rows'];
            KMB?: ReturnType<typeof parseDailyCsvContent>['rows'];
            KNA?: ReturnType<typeof parseDailyCsvContent>['rows'];
          } = {};
          const fileInfos: Array<{
            fileId?: string;
            fileName: string;
            substation: SubstationCode;
            rowCount: number;
          }> = [];

          await Promise.all(
            matchingFiles.map(async (fileMeta) => {
              let content =
                powerCsvMemoryCache.current.get(fileMeta.fileId) ||
                powerCachedCsv.get(fileMeta.fileId);
              if (!content && accessToken) {
                // Retry fetch up to 3 times with gentle exponential backoff
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    content = await fetchFileContent(
                      accessToken,
                      fileMeta.fileId,
                      (fileMeta as any).mimeType || 'text/csv',
                      fileMeta.modifiedTime,
                      4,
                      false
                    );
                    if (content) {
                      powerCsvMemoryCache.current.set(fileMeta.fileId, content);
                      break;
                    }
                  } catch (e) {
                    if (attempt < 2) await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
                  }
                }
              }
              if (content) {
                const parsed = parseDailyCsvContent(content, fileMeta.substation);
                if (parsed.rows.length > 0) {
                  substationData[fileMeta.substation] = parsed.rows;
                  fileInfos.push({
                    fileId: fileMeta.fileId,
                    fileName: fileMeta.fileName,
                    substation: fileMeta.substation,
                    rowCount: parsed.rowCount,
                  });
                }
              }
            })
          );

          if (Object.keys(substationData).length > 0) {
            const summary = mergeDailySubstations(normDateKey, substationData, fileInfos, false);
            setPowerSummariesByDate((prev) => {
              const next = new Map(prev);
              next.set(normDateKey, summary);
              next.set(dateKey, summary);
              return next;
            });
            return summary;
          }
        }
      } catch (err) {
        console.warn('Could not sync power CSVs for date:', dateKey, err);
      }

      return null;
    },
    [accessToken, powerSummariesByDate, powerScannedFiles, powerCachedCsv, powerFolders, scanConfiguredPowerFolders]
  );

  // Instant System Loader for both Target Folder 1 (.TEPR) and Target Folder 2 (4-Circuit Power CSVs)
  const handleLoadOfflineDemoDataset = useCallback(() => {
    // 1. Target Folder 2: 4-Circuit Power Substation SCADA CSVs (KMB, KMA, KNA)
    const rawPowerFiles = generateSamplePowerDataset();
    const powerMeta: PowerScannedFileMeta[] = rawPowerFiles.map((p) => ({
      fileId: p.fileId,
      fileName: p.fileName,
      substation: p.substation,
      subfolderName: p.subfolderName,
      folderPath: p.folderPath,
      dateMeta: p.dateMeta,
    }));
    setPowerScannedFiles(powerMeta);

    const powerMap = new Map<string, DailyPowerSummary>();
    const groupedPower = new Map<
      string,
      Array<{ fileId: string; substation: SubstationCode; content: string; fileName: string }>
    >();
    rawPowerFiles.forEach((p) => {
      if (p.dateMeta) {
        const dKey = p.dateMeta.dateKey;
        const list = groupedPower.get(dKey) || [];
        list.push({ fileId: p.fileId, substation: p.substation, content: p.content, fileName: p.fileName });
        groupedPower.set(dKey, list);
      }
    });
    groupedPower.forEach((list, dKey) => {
      const substationData: { KMA?: any[]; KMB?: any[]; KNA?: any[] } = {};
      const fileInfos: Array<{ fileId?: string; fileName: string; substation: SubstationCode; rowCount: number }> = [];
      list.forEach((item) => {
        const parsed = parseDailyCsvContent(item.content, item.substation);
        if (parsed) {
          substationData[item.substation] = parsed.rows;
          fileInfos.push({
            fileId: item.fileId,
            fileName: item.fileName,
            substation: item.substation,
            rowCount: parsed.rowCount,
          });
        }
      });
      const merged = mergeDailySubstations(dKey, substationData, fileInfos, true);
      powerMap.set(dKey, merged);
    });
    setPowerSummariesByDate(powerMap);

    // 2. Target Folder 1: Fiber Optic Temperature Records (.TEPR)
    const rawSamples = generateSampleTeprDataset();
    const dataset = parseMultipleTeprFiles(rawSamples, powerMap);
    setParsedFiles(dataset.files);
    setScannedFiles(
      dataset.files.map((f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        folderPath: 'Target_Folder_1_TEPR/2026/08',
        subfolderName: '08',
        dateMeta: f.dateMeta!,
        cablePhase: f.cablePhase,
        channel: f.channel,
      }))
    );
    setCurrentFolder({ id: 'target-folder-1', name: 'Target Folder 1 (.TEPR - Circuit #3)' });

    // 3. Populate Taxonomy Dropdowns
    setSelectedYearFilter('2026');
    setSelectedMonthFilter('8');
    setSelectedDateFilter('2026-08-08');
    setSelectedPhaseFilter('all');
    setSelectedHourFilter('all');
    setLoadedFilters({ year: '2026', month: '8', date: '2026-08-08' });
    setHasReadTemperature(true);
    if (dataset.files.length > 0) {
      setActiveFileId(dataset.files[dataset.files.length - 1].fileId);
    }
  }, []);

  // Autonomous Agent Summary State
  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [isAnalyzingCable, setIsAnalyzingCable] = useState(false);

  // Revised 3 Cascading Dropdown Filters: Year, Month, Date
  const [selectedYearFilter, setSelectedYearFilter] = useState<string>('all');
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  // Phase filter (Controlled inside Chart after reading finishes - Requirement 4)
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState<string>('all');
  // Hourly Filter next to Phase Filter (24 Hours dropdown - shows hourly maximum value)
  const [selectedHourFilter, setSelectedHourFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Computed state: Checks if currently selected Year/Month/Date filters have been read
  const currentFiltersLoaded = useMemo(() => {
    if (!loadedFilters || !hasReadTemperature) return false;
    return (
      loadedFilters.year === selectedYearFilter &&
      loadedFilters.month === selectedMonthFilter &&
      loadedFilters.date === selectedDateFilter
    );
  }, [loadedFilters, hasReadTemperature, selectedYearFilter, selectedMonthFilter, selectedDateFilter]);

  // Sample data generation
  const [isGeneratingSamples, setIsGeneratingSamples] = useState(false);

  // Confirmation Modal
  const [confirmModalData, setConfirmModalData] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Initialize auth and listen for token refreshes
  useEffect(() => {
    const unsubscribeAuth = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
        setNeedsAuth(false);
        setAdminViewMode('internal');
        setShowGameLoadingScreen(true);
        if (permanentFolder && permanentFolder.id !== 'root') {
          setCurrentFolder((prev) => (prev.id === permanentFolder.id ? prev : permanentFolder));
        }
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
        setShowGameLoadingScreen(false);
      }
    );

    const unsubscribeToken = onAccessTokenChange((newToken, newUser) => {
      if (newToken) {
        setAccessToken(newToken);
        if (newUser) setUser(newUser);
        setNeedsAuth(false);
      } else {
        setAccessToken(null);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeToken();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Set or remove permanent target folder for fiber optic temperature (automatically synced across devices via Server & Google Drive)
  const handleSetPermanentFolder = useCallback(
    (folderToSet: DriveFolder | null) => {
      setPermanentFolder(folderToSet);
      try {
        if (folderToSet && folderToSet.id !== 'root') {
          localStorage.setItem('dts_permanent_fiber_folder_v1', JSON.stringify(folderToSet));
          localStorage.setItem('dts_last_fiber_folder_v1', JSON.stringify(folderToSet));
          saveUserPreferencesToServer({
            email: user?.email,
            uid: user?.uid,
            permanentFolder: folderToSet,
            powerFolders,
          });
          if (accessToken) {
            savePermanentConfigToDrive(accessToken, {
              permanentFolder: folderToSet,
              powerFolders,
            });
          }
          showNotification(
            'success',
            `Saved "${folderToSet.name}" as your permanent target folder. It will load automatically on any device when you log in!`
          );
        } else {
          localStorage.removeItem('dts_permanent_fiber_folder_v1');
          saveUserPreferencesToServer({
            email: user?.email,
            uid: user?.uid,
            permanentFolder: null,
            powerFolders,
          });
          if (accessToken) {
            savePermanentConfigToDrive(accessToken, {
              permanentFolder: null,
              powerFolders,
            });
          }
          showNotification('success', 'Cleared permanent target folder preference.');
        }
      } catch (e) {
        console.error('Failed to update permanent folder:', e);
      }
    },
    [accessToken, user?.email, user?.uid, powerFolders]
  );

  // Handler for selecting folder from FolderSelector modal or list — automatically remembers and saves as permanent folder across devices
  const handleSelectFolder = useCallback(
    (folder: DriveFolder, isPermanent = true) => {
      if (folder.id !== currentFolder.id) {
        lastScannedFolderIdRef.current = null;
        hasReadTemperatureRef.current = false;
        setHasReadTemperature(false);
        setParsedFiles([]);
        setLoadedFilters(null);
      }
      setCurrentFolder(folder);
      setAgentSummary(null);
      try {
        localStorage.setItem('dts_last_fiber_folder_v1', JSON.stringify(folder));
        if (isPermanent && folder.id !== 'root') {
          localStorage.setItem('dts_permanent_fiber_folder_v1', JSON.stringify(folder));
          setPermanentFolder(folder);
          saveUserPreferencesToServer({
            email: user?.email,
            uid: user?.uid,
            permanentFolder: folder,
            powerFolders,
          });
          if (accessToken) {
            savePermanentConfigToDrive(accessToken, {
              permanentFolder: folder,
              powerFolders,
            });
          }
          showNotification(
            'success',
            `Remembered "${folder.name}" as your permanent Target Folder 1 across all devices!`
          );
        }
      } catch (e) {
        // ignore
      }
    },
    [accessToken, user?.email, user?.uid, powerFolders, currentFolder.id]
  );

  // Target Folder 4 Scanning: Automatic date scanning of daily maximum power record (.csv) inside subfolder "Daily peak power"
  const scanTargetFolder4 = useCallback(
    async (targetFolder: DriveFolder) => {
      if (!accessToken || !targetFolder || targetFolder.id === 'root') return;
      setIsScanningFolder4(true);
      try {
        const { files: parentFiles, subfolders } = await fetchDriveFolderItems(accessToken, targetFolder.id);

        let targetFile: DriveFile | undefined;
        let scanFolderDescription = targetFolder.name;

        // Target Folder 4: Subfolder name "Daily peak power" inside parent folder
        const dailyPowerSub = subfolders.find((f) =>
          f.name.toLowerCase().includes('daily') && (f.name.toLowerCase().includes('peak') || f.name.toLowerCase().includes('power'))
        ) || subfolders.find((f) => f.name.toLowerCase().includes('peak power') || f.name.toLowerCase().includes('daily peak power') || f.name.toLowerCase().includes('power'));

        if (dailyPowerSub) {
          scanFolderDescription = `${targetFolder.name} → ${dailyPowerSub.name}`;
          const { files: subFiles } = await fetchDriveFolderItems(accessToken, dailyPowerSub.id);
          const csvFiles = subFiles.filter((f) => {
            const lower = f.name.toLowerCase();
            return lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls');
          });
          targetFile = csvFiles[0] || subFiles[0];
        } else {
          // Fallback if user selected subfolder directly or parent doesn't have subfolder
          const csvFiles = parentFiles.filter((f) => {
            const lower = f.name.toLowerCase();
            return lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls');
          });
          targetFile = csvFiles.find((f) => /power|max|circuit|daily|peak|load/i.test(f.name)) || csvFiles[0] || parentFiles[0];
        }

        if (!targetFile) {
          showNotification(
            'error',
            `No power database file (.csv) found inside subfolder "Daily peak power" (or Target Folder 4 "${targetFolder.name}"). Please place the daily peak power .csv file inside.`
          );
          return;
        }

        const buffer = await fetchFileArrayBuffer(accessToken, targetFile.id, targetFile.mimeType);
        const res = await saveUploadedPowerDatabase(buffer, targetFile.name);
        if (res.success) {
          setDbConfig(getOrgDatabaseConfig());
          showNotification(
            'success',
            `Target Folder 4 scanned (${scanFolderDescription}): Loaded "${targetFile.name}" with ${res.count} records across ${res.dates.length} dates! Active in Public Dashboard 2.4 Yearly comparison chart CIRCUIT PEAK MW DEMAND.`
          );
        } else {
          showNotification('error', res.error || 'Failed to parse power database in Target Folder 4');
        }
      } catch (err: any) {
        console.error('Error scanning Target Folder 4:', err);
        showNotification('error', err?.message || 'Failed to scan Target Folder 4');
      } finally {
        setIsScanningFolder4(false);
      }
    },
    [accessToken]
  );

  const handleSetPermanentFolder4 = useCallback(
    (folderToSet: DriveFolder | null) => {
      savePermanentFolder4Setting(folderToSet);
      if (folderToSet && folderToSet.id !== 'root') {
        try {
          localStorage.setItem('dts_permanent_folder_4_v1', JSON.stringify(folderToSet));
        } catch (e) {}
        setPermanentFolder4(folderToSet);
        setFolder4(folderToSet);
        saveUserPreferencesToServer({
          email: user?.email,
          uid: user?.uid,
          permanentFolder4: folderToSet,
        });
        if (accessToken) {
          savePermanentConfigToDrive(accessToken, {
            permanentFolder,
            powerFolders,
            permanentFolder3,
            permanentFolder4: folderToSet,
          });
        }
        showNotification('success', `Saved "${folderToSet.name}" as Permanent Target Folder 4!`);
        scanTargetFolder4(folderToSet);
      } else {
        try {
          localStorage.removeItem('dts_permanent_folder_4_v1');
        } catch (e) {}
        setPermanentFolder4(null);
        saveUserPreferencesToServer({
          email: user?.email,
          uid: user?.uid,
          permanentFolder4: null,
        });
        if (accessToken) {
          savePermanentConfigToDrive(accessToken, {
            permanentFolder,
            powerFolders,
            permanentFolder3,
            permanentFolder4: null,
          });
        }
        showNotification('success', 'Cleared Target Folder 4 permanent default.');
      }
    },
    [accessToken, user?.email, user?.uid, permanentFolder, powerFolders, permanentFolder3, scanTargetFolder4]
  );

  const handleImportUrlFolder4 = useCallback(
    async (url: string) => {
      if (!accessToken || !url) return;
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fileId = match ? match[1] : url.trim();
      setIsScanningFolder4(true);
      try {
        const buffer = await fetchFileArrayBuffer(accessToken, fileId);
        const res = await saveUploadedPowerDatabase(buffer, 'Imported_Power_Database.csv');
        if (res.success) {
          setDbConfig(getOrgDatabaseConfig());
          const virtualFolder: DriveFolder = { id: fileId, name: `Power Link (${fileId.slice(0, 8)}...)` };
          handleSetPermanentFolder4(virtualFolder);
          showNotification(
            'success',
            `Target Folder 4 imported from link: Loaded with ${res.count} records across ${res.dates.length} dates! Active in Public Dashboard 2.4 Yearly comparison chart CIRCUIT PEAK MW DEMAND.`
          );
        } else {
          showNotification('error', res.error || 'Failed to parse power database from link');
        }
      } catch (err: any) {
        showNotification('error', err?.message || 'Failed to fetch file from link');
      } finally {
        setIsScanningFolder4(false);
      }
    },
    [accessToken, handleSetPermanentFolder4]
  );

  const handleSelectFolder4 = useCallback(
    (folder: DriveFolder, isPermanent = true) => {
      setFolder4(folder);
      if (isPermanent && folder.id !== 'root') {
        handleSetPermanentFolder4(folder);
      } else {
        scanTargetFolder4(folder);
      }
    },
    [handleSetPermanentFolder4, scanTargetFolder4]
  );

  // Target Folder 3 Scanning: Automatic date scanning of daily temperature record (.xlsx) inside subfolder "Daily Temperature"
  const scanTargetFolder3 = useCallback(
    async (targetFolder: DriveFolder) => {
      if (!accessToken || !targetFolder || targetFolder.id === 'root') return;
      setIsScanningFolder3(true);
      try {
        const { files: parentFiles, subfolders } = await fetchDriveFolderItems(accessToken, targetFolder.id);

        let targetFile: DriveFile | undefined;
        let scanFolderDescription = targetFolder.name;

        // Target Folder 3: Subfolder name "Daily Temperature" inside parent folder
        const dailyTempSub = subfolders.find((f) =>
          f.name.toLowerCase().includes('daily') && (f.name.toLowerCase().includes('temp') || f.name.toLowerCase().includes('thermal'))
        ) || subfolders.find((f) => f.name.toLowerCase().includes('temperature') || f.name.toLowerCase().includes('daily temperature'));

        if (dailyTempSub) {
          scanFolderDescription = `${targetFolder.name} → ${dailyTempSub.name}`;
          const { files: subFiles } = await fetchDriveFolderItems(accessToken, dailyTempSub.id);
          const excelFiles = subFiles.filter((f) => {
            const lower = f.name.toLowerCase();
            return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
          });
          targetFile = excelFiles[0] || subFiles[0];
        } else {
          // Fallback if user selected subfolder directly or parent doesn't have subfolder
          const excelFiles = parentFiles.filter((f) => {
            const lower = f.name.toLowerCase();
            return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
          });
          targetFile = excelFiles.find((f) => /database|temp|peak|conductor|heat|master|section/i.test(f.name)) || excelFiles[0] || parentFiles[0];
        }

        if (!targetFile) {
          showNotification(
            'error',
            `No database file (.xlsx) found inside subfolder "Daily Temperature" (or Target Folder 3 "${targetFolder.name}"). Please place the daily temperature .xlsx file inside.`
          );
          return;
        }

        const buffer = await fetchFileArrayBuffer(accessToken, targetFile.id, targetFile.mimeType);
        const res = await saveUploadedOrgDatabase(buffer, targetFile.name);
        if (res.success) {
          setDbConfig(getOrgDatabaseConfig());
          showNotification(
            'success',
            `Target Folder 3 scanned (${scanFolderDescription}): Loaded "${targetFile.name}" with ${res.config.totalDates} dates! Active in Public Dashboard 2.1 Daily Max Heat Map.`
          );
        } else {
          showNotification('error', res.error || 'Failed to parse database file in Target Folder 3');
        }
      } catch (err: any) {
        console.error('Error scanning Target Folder 3:', err);
        showNotification('error', err?.message || 'Failed to scan Target Folder 3');
      } finally {
        setIsScanningFolder3(false);
      }
    },
    [accessToken]
  );

  const handleSetPermanentFolder3 = useCallback(
    (folderToSet: DriveFolder | null) => {
      savePermanentFolder3Setting(folderToSet);
      if (folderToSet && folderToSet.id !== 'root') {
        try {
          localStorage.setItem('dts_permanent_folder_3_v1', JSON.stringify(folderToSet));
        } catch (e) {}
        setPermanentFolder3(folderToSet);
        setFolder3(folderToSet);
        saveUserPreferencesToServer({
          email: user?.email,
          uid: user?.uid,
          permanentFolder3: folderToSet,
        });
        if (accessToken) {
          savePermanentConfigToDrive(accessToken, {
            permanentFolder,
            powerFolders,
            permanentFolder3: folderToSet,
            permanentFolder4,
          });
        }
        showNotification('success', `Saved "${folderToSet.name}" as Permanent Target Folder 3!`);
        scanTargetFolder3(folderToSet);
      } else {
        try {
          localStorage.removeItem('dts_permanent_folder_3_v1');
        } catch (e) {}
        setPermanentFolder3(null);
        saveUserPreferencesToServer({
          email: user?.email,
          uid: user?.uid,
          permanentFolder3: null,
        });
        if (accessToken) {
          savePermanentConfigToDrive(accessToken, {
            permanentFolder,
            powerFolders,
            permanentFolder3: null,
            permanentFolder4,
          });
        }
        showNotification('success', 'Cleared Target Folder 3 permanent default.');
      }
    },
    [accessToken, user?.email, user?.uid, permanentFolder, powerFolders, permanentFolder4, scanTargetFolder3]
  );

  const handleSelectFolder3 = useCallback(
    (folder: DriveFolder, isPermanent = true) => {
      setFolder3(folder);
      if (isPermanent && folder.id !== 'root') {
        handleSetPermanentFolder3(folder);
      } else {
        scanTargetFolder3(folder);
      }
    },
    [handleSetPermanentFolder3, scanTargetFolder3]
  );

  const handleImportUrlFolder3 = useCallback(
    async (url: string) => {
      if (!accessToken || !url) return;
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fileId = match ? match[1] : url.trim();
      setIsScanningFolder3(true);
      try {
        const buffer = await fetchFileArrayBuffer(accessToken, fileId);
        const res = await saveUploadedOrgDatabase(buffer, 'Imported_Temperature_Database.xlsx');
        if (res.success) {
          setDbConfig(getOrgDatabaseConfig());
          const virtualFolder: DriveFolder = { id: fileId, name: `Temperature Link (${fileId.slice(0, 8)}...)` };
          handleSetPermanentFolder3(virtualFolder);
          showNotification(
            'success',
            `Target Folder 3 imported from link: Loaded with ${res.config.totalDates} dates! Active in Public Dashboard 2.1 Daily Max Heat Map.`
          );
        } else {
          showNotification('error', res.error || 'Failed to parse database from link');
        }
      } catch (err: any) {
        showNotification('error', err?.message || 'Failed to fetch file from link');
      } finally {
        setIsScanningFolder3(false);
      }
    },
    [accessToken, handleSetPermanentFolder3]
  );

  // Auto-scan Target Folder 3 and Target Folder 4 when access token becomes ready
  useEffect(() => {
    if (!accessToken) return;
    if (permanentFolder3 && permanentFolder3.id !== 'root') {
      scanTargetFolder3(permanentFolder3);
    }
    if (permanentFolder4 && permanentFolder4.id !== 'root') {
      scanTargetFolder4(permanentFolder4);
    }
  }, [accessToken, permanentFolder3?.id, permanentFolder4?.id]);

  // High-speed parallel concurrent metadata scanning of .TEPR files in current folder
  const loadAndParseTeprFiles = useCallback(
    async (forceRefresh = false, overrideFolder?: DriveFolder): Promise<ScannedFileMeta[]> => {
      if (!accessToken) return [];

      const targetFolder = overrideFolder || currentFolder;

      // Prevent duplicate background scans of the exact same folder from wiping already-read temperature data
      if (
        !forceRefresh &&
        lastScannedFolderIdRef.current === targetFolder.id &&
        (isReadingTemperatureRef.current || hasReadTemperatureRef.current || hasScannedFilesRef.current)
      ) {
        return scannedFiles;
      }

      lastScannedFolderIdRef.current = targetFolder.id;
      setIsLoadingFiles(true);
      setLoadingProgress(null);
      if (forceRefresh) {
        hasScannedFilesRef.current = false;
        setScannedFiles([]);
        setParsedFiles([]);
        setLoadedFilters(null);
        setHasReadTemperature(false);
        hasReadTemperatureRef.current = false;
      }

      try {
        // Step 1: Query list of .tepr files in folder
        const teprFiles = await fetchFilesInFolder(accessToken, targetFolder.id, 'tepr', '.tepr', 10, targetFolder.name);
        setFiles(teprFiles);

        if (teprFiles.length === 0) {
          hasScannedFilesRef.current = false;
          setScannedFiles([]);
          if (!isReadingTemperatureRef.current && !hasReadTemperatureRef.current) {
            setParsedFiles([]);
            setHasReadTemperature(false);
            setLoadedFilters(null);
          }
          setAgentSummary(null);
          setIsLoadingFiles(false);
          setLoadingProgress(null);
          return [];
        }

        setLoadingProgress({ loaded: 0, total: teprFiles.length, fileName: 'Scanning folder metadata...' });

        // Step 2: Extract Year, Month, Date metadata purely by scanning folder, subfolder and file names (0 .tepr content reads)
        const scannedMeta = await scanTeprFilesMetadata(accessToken, teprFiles, (loaded, total, currentName) => {
          setLoadingProgress({ loaded, total, fileName: `Scanned: ${currentName}` });
        });

        hasScannedFilesRef.current = scannedMeta.length > 0;
        setScannedFiles(scannedMeta);
        // Only reset parsedFiles if user hasn't started or completed reading temperature for this folder
        if (!isReadingTemperatureRef.current && !hasReadTemperatureRef.current) {
          setParsedFiles([]);
          setHasReadTemperature(false);
          setLoadedFilters(null);
        }

        // Auto-populate the 3 dropdowns with Year, Month, Date from scanned metadata (only if not already reading/read)
        if (scannedMeta.length > 0 && !isReadingTemperatureRef.current && !hasReadTemperatureRef.current) {
          // Distinct years sorted descending
          const years = Array.from(new Set(scannedMeta.map((s) => s.dateMeta?.year || 2026))).sort((a, b) => b - a);
          const initialYear = String(years[0]);
          setSelectedYearFilter(initialYear);

          // Find available months for initial year
          const monthsForYear = Array.from(
            new Set(
              scannedMeta
                .filter((s) => (s.dateMeta?.year || 2026) === Number(initialYear))
                .map((s) => s.dateMeta?.month || 8)
            )
          ).sort((a, b) => a - b);
          const initialMonth = monthsForYear.length > 0 ? String(monthsForYear[0]) : 'all';
          setSelectedMonthFilter(initialMonth);

          // Find available dates for initial year and month
          const datesForYearAndMonth = Array.from(
            new Set(
              scannedMeta
                .filter(
                  (s) =>
                    (s.dateMeta?.year || 2026) === Number(initialYear) &&
                    (s.dateMeta?.month || 8) === Number(initialMonth)
                )
                .map((s) => s.dateMeta?.dateKey)
            )
          ).sort();
          const initialDate = datesForYearAndMonth.length > 0 ? datesForYearAndMonth[0] : 'all';
          setSelectedDateFilter(initialDate);
          setSelectedPhaseFilter('all');
        }

        return scannedMeta;
      } catch (err: any) {
        console.error('Error fast scanning folder metadata:', err);
        showNotification('error', err.message || 'Failed to scan folder metadata from Google Drive');
        return [];
      } finally {
        setIsLoadingFiles(false);
        setLoadingProgress(null);
      }
    },
    [accessToken, currentFolder.id, currentFolder.name, scannedFiles]
  );

  // Requirement 3: Reading Temperature ONLY for files in the focused Year, Month, and Date path
  const handleReadTemperature = useCallback(
    async (
      overrideScannedMeta?: ScannedFileMeta[],
      overrideYear?: string,
      overrideMonth?: string,
      overrideDate?: string
    ) => {
      if (!accessToken) return;

      const activeScanned = Array.isArray(overrideScannedMeta)
        ? overrideScannedMeta
        : Array.isArray(scannedFiles)
        ? scannedFiles
        : [];
      const targetYear = typeof overrideYear === 'string' ? overrideYear : selectedYearFilter;
      const targetMonth = typeof overrideMonth === 'string' ? overrideMonth : selectedMonthFilter;
      const targetDate = typeof overrideDate === 'string' ? overrideDate : selectedDateFilter;

      isReadingTemperatureRef.current = true;
      setIsReadingTemperature(true);
      setLoadingProgress(null);
      try {
        // Find matching scanned files strictly within current focus path
        const focusScanned = activeScanned.filter((sf) => {
          if (targetYear !== 'all' && String(sf.dateMeta?.year || 2026) !== targetYear) return false;
          if (targetMonth !== 'all' && String(sf.dateMeta?.month || 8) !== targetMonth) return false;
          if (targetDate !== 'all' && sf.dateMeta?.dateKey !== targetDate) return false;
          return true;
        });

      if (focusScanned.length === 0) {
        showNotification('error', 'No files match the selected Year, Month, and Date focus path.');
        isReadingTemperatureRef.current = false;
        setIsReadingTemperature(false);
        return;
      }

      // Immediately mark filters as loaded and clear previous date's parsedFiles so Pages 2-4 reflect the new read right away
      setParsedFiles([]);
      setLoadedFilters({
        year: selectedYearFilter,
        month: selectedMonthFilter,
        date: selectedDateFilter,
      });
      hasReadTemperatureRef.current = true;
      setHasReadTemperature(true);

      setLoadingProgress({ loaded: 0, total: focusScanned.length, fileName: 'Reading focus temperature profiles...' });

      // Match focus scanned files back to DriveFile structures
      const focusScannedMap = new Map(focusScanned.map((fs) => [fs.fileId, fs]));
      const filesToRead = files.filter((f) => focusScannedMap.has(f.id));

      // Helper to stamp each parsed file with the exact Date metadata from Page 1 ("Folder & Asset")
      const applyPage1DateMeta = (batch: ParsedTeprFile[]): ParsedTeprFile[] =>
        batch.map((pf) => {
          const sf = focusScannedMap.get(pf.fileId);
          if (!sf || !sf.dateMeta) return pf;
          const mergedDateMeta = {
            ...pf.dateMeta,
            year: sf.dateMeta.year,
            month: sf.dateMeta.month,
            monthName: sf.dateMeta.monthName,
            monthAbbr: sf.dateMeta.monthAbbr,
            day: sf.dateMeta.day,
            dateKey: sf.dateMeta.dateKey,
            formattedDate: sf.dateMeta.formattedDate,
            subfolderName: sf.dateMeta.subfolderName || pf.dateMeta?.subfolderName,
          };
          return {
            ...pf,
            cablePhase: pf.cablePhase && pf.cablePhase !== 'Unassigned' ? pf.cablePhase : (sf.cablePhase || pf.cablePhase),
            channel: pf.channel !== undefined ? pf.channel : sf.channel,
            dateMeta: mergedDateMeta,
          };
        });

      // Fetch and parse focused .TEPR files AND sync Target Folder 2 (4-Circuit Power Consumption) concurrently
      const [rawParsedResults, syncedPower] = await Promise.all([
        fastFetchAndParseTeprFiles(
          accessToken,
          filesToRead,
          (loaded, total, currentFileName, cachedCount) => {
            const cachedMsg = cachedCount > 0 ? ` (${cachedCount} cached)` : '';
            setLoadingProgress({ loaded, total, fileName: `${currentFileName}${cachedMsg}` });
          },
          36, // Parallel workers
          (newBatch) => {
            const stampedBatch = applyPage1DateMeta(newBatch);
            setParsedFiles((prev) => {
              if (prev.length === 0) return stampedBatch;
              const existingIds = new Set(prev.map((f) => f.fileId));
              const fresh = stampedBatch.filter((f) => !existingIds.has(f.fileId));
              if (fresh.length === 0) return prev;
              return [...prev, ...fresh];
            });
            setActiveFileId((current) => current || (stampedBatch[0]?.fileId ?? null));
          }
        ),
        selectedDateFilter !== 'all' ? ensurePowerSummaryForDate(selectedDateFilter) : Promise.resolve(null),
      ]);

      const parsedResults = applyPage1DateMeta(rawParsedResults);
      parsedResults.sort((a, b) => (a.header.timestamp || 0) - (b.header.timestamp || 0));
      setParsedFiles(parsedResults);

      if (parsedResults.length > 0) {
        setActiveFileId(parsedResults[parsedResults.length - 1].fileId);
      }

      // Requirement 4: Cable Phase detection automatically from read files in focus area
      const detectedPhases = Array.from(new Set(parsedResults.map((p) => p.cablePhase))).filter(
        (p) => p !== 'Unassigned'
      );
      if (detectedPhases.length === 1) {
        setSelectedPhaseFilter(detectedPhases[0]);
      } else {
        setSelectedPhaseFilter('all');
      }

      setLoadedFilters({
        year: selectedYearFilter,
        month: selectedMonthFilter,
        date: selectedDateFilter,
      });
      hasReadTemperatureRef.current = true;
      setHasReadTemperature(true);

      // Notify that data is automatically applied across Page 2, Page 3, and Page 4
      if (selectedDateFilter !== 'all') {
        const effectivePower = syncedPower || buildFallbackDailyPowerSummary(selectedDateFilter);
        showNotification(
          'success',
          `Read ${parsedResults.length} .TEPR files for ${selectedDateFilter}! Data automatically applied to Page 2 (Heat Map), Page 3 (Profile & Matrix @ ${effectivePower.metrics.circuit_115kv_3.peakMW.toFixed(2)} MW), and Page 4 (Power Consumption).`
        );
      } else {
        showNotification(
          'success',
          `Successfully read temperature for ${parsedResults.length} .TEPR files! Data automatically applied to Page 2, Page 3, and Page 4.`
        );
      }
    } catch (err: any) {
      console.error('Error reading temperature:', err);
      showNotification('error', err.message || 'Failed to read temperature points.');
    } finally {
      isReadingTemperatureRef.current = false;
      setIsReadingTemperature(false);
      setLoadingProgress(null);
    }
  }, [accessToken, scannedFiles, files, selectedYearFilter, selectedMonthFilter, selectedDateFilter, ensurePowerSummaryForDate]);

  const [isInitialSystemLoading, setIsInitialSystemLoading] = useState<boolean>(false);
  const initialScanRanRef = useRef<boolean>(false);

  // Perform Master Background System Scan during Loading Screen
  const performFullInitialSystemScan = useCallback(async () => {
    if (!accessToken) return;
    setIsInitialSystemLoading(true);
    try {
      // 1. Restore Permanent Target Folder 1 & Target Folders 2
      const [driveConfig, serverPrefs] = await Promise.all([
        loadPermanentConfigFromDrive(accessToken),
        loadUserPreferencesFromServer({ email: user?.email, uid: user?.uid }),
      ]);

      const restoredPermanent =
        (driveConfig?.permanentFolder?.id && driveConfig.permanentFolder.id !== 'root' ? driveConfig.permanentFolder : null) ||
        (serverPrefs?.permanentFolder?.id && serverPrefs.permanentFolder.id !== 'root' ? serverPrefs.permanentFolder : null) ||
        (permanentFolder?.id && permanentFolder.id !== 'root' ? permanentFolder : null);

      let effectiveFolder = currentFolder;
      if (restoredPermanent) {
        setPermanentFolder(restoredPermanent);
        setCurrentFolder(restoredPermanent);
        effectiveFolder = restoredPermanent;
      }

      const effectivePowerFolders = driveConfig?.powerFolders || serverPrefs?.powerFolders || powerFolders;
      if (driveConfig?.powerFolders || serverPrefs?.powerFolders) {
        setPowerFolders(effectivePowerFolders);
      }

      // 2. Concurrently Scan Fiber Optic Temperature Records (Target Folder 1) AND Power CSV Files (Target Folders 2)
      const [scannedMeta] = await Promise.all([
        loadAndParseTeprFiles(true, effectiveFolder),
        scanConfiguredPowerFolders(effectivePowerFolders),
      ]);

      // 3. Populate Year, Month, Date Taxonomy Dropdowns
      if (scannedMeta && scannedMeta.length > 0) {
        const years = Array.from(new Set(scannedMeta.map((s) => s.dateMeta?.year || 2026))).sort((a, b) => b - a);
        const initialYear = String(years[0]);
        setSelectedYearFilter(initialYear);

        const monthsForYear = Array.from(
          new Set(
            scannedMeta
              .filter((s) => (s.dateMeta?.year || 2026) === Number(initialYear))
              .map((s) => s.dateMeta?.month || 8)
          )
        ).sort((a, b) => a - b);
        const initialMonth = monthsForYear.length > 0 ? String(monthsForYear[0]) : 'all';
        setSelectedMonthFilter(initialMonth);

        const datesForYearAndMonth = Array.from(
          new Set(
            scannedMeta
              .filter(
                (s) =>
                  (s.dateMeta?.year || 2026) === Number(initialYear) &&
                  (s.dateMeta?.month || 8) === Number(initialMonth)
              )
              .map((s) => s.dateMeta?.dateKey)
          )
        ).sort();
        const initialDate = datesForYearAndMonth.length > 0 ? datesForYearAndMonth[0] : 'all';
        setSelectedDateFilter(initialDate);
        setSelectedPhaseFilter('all');

        // 4. Pre-read focus temperature records and sync power summary for initial focus date
        if (initialDate && initialDate !== 'all') {
          await Promise.all([
            handleReadTemperature(scannedMeta, initialYear, initialMonth, initialDate),
            ensurePowerSummaryForDate(initialDate),
          ]);
        }
      }
    } catch (err) {
      console.warn('Initial system scan encounter:', err);
    } finally {
      setIsInitialSystemLoading(false);
    }
  }, [
    accessToken,
    user?.email,
    user?.uid,
    permanentFolder,
    powerFolders,
    currentFolder,
    loadAndParseTeprFiles,
    scanConfiguredPowerFolders,
    handleReadTemperature,
    ensurePowerSummaryForDate,
  ]);

  useEffect(() => {
    if (!initialScanRanRef.current) {
      initialScanRanRef.current = true;
      if (accessToken) {
        performFullInitialSystemScan();
      } else {
        // Automatic scan and load of Target Folder 1 (.TEPR) and Target Folder 2 (Power CSVs) on startup
        setIsInitialSystemLoading(true);
        handleLoadOfflineDemoDataset();
        setIsInitialSystemLoading(false);
      }
    }
  }, [accessToken, performFullInitialSystemScan, handleLoadOfflineDemoDataset]);

  useEffect(() => {
    if (accessToken) {
      loadAndParseTeprFiles();
    }
  }, [accessToken, currentFolder.id, loadAndParseTeprFiles]);

  const handleUpdatePublicFolders = useCallback(
    (config: {
      folder1Url?: string;
      folder1Id?: string;
      folder1Name?: string;
      folder2Url?: string;
      folder2Id?: string;
      folder2Name?: string;
      parentFolderUrl?: string;
      parentFolderId?: string;
    }) => {
      if (config.folder1Id) {
        const f1: DriveFolder = {
          id: config.folder1Id,
          name: config.folder1Name || 'Target Folder 1 (.TEPR - Public Default)',
        };
        setCurrentFolder(f1);
        setPermanentFolder(f1);
        try {
          localStorage.setItem('dts_permanent_fiber_folder_v1', JSON.stringify(f1));
        } catch (e) {}
      }
      if (config.folder2Id) {
        const f2Id = config.folder2Id;
        const nextPf: PowerSubstationFoldersConfig = {
          parentFolder: {
            id: f2Id,
            name: config.folder2Name || 'Target Folder 2 (Power SCADA - Public Default)',
          },
          KMB: { id: f2Id, name: 'KMB' },
          KMA: { id: f2Id, name: 'KMA' },
          KNA: { id: f2Id, name: 'KNA' },
        };
        setPowerFolders(nextPf);
        try {
          localStorage.setItem('power_substation_folders_v2', JSON.stringify(nextPf));
        } catch (e) {}
      }
      showNotification('success', 'Public default data source updated for Target Folder 1 & 2!');
    },
    [showNotification]
  );

  const handleTriggerPublicRescan = useCallback(async () => {
    showNotification('success', 'Scanning public default data sources (Target Folders 1 & 2)...');
    if (accessToken) {
      await performFullInitialSystemScan();
    } else {
      handleLoadOfflineDemoDataset();
    }
  }, [accessToken, performFullInitialSystemScan, handleLoadOfflineDemoDataset, showNotification]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        setAdminViewMode('internal');
        setShowGameLoadingScreen(true);
        if (permanentFolder && permanentFolder.id !== 'root') {
          setCurrentFolder(permanentFolder);
        }
        showNotification('success', 'Connected to Google Drive successfully!');
      }
    } catch (err: any) {
      console.error('Sign in failed:', err);
      showNotification('error', err.message || 'Google authentication was cancelled or failed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = useCallback(async (reasonMessage?: unknown) => {
    await logout();
    setUser(null);
    setAccessToken(null);
    setFiles([]);
    setParsedFiles([]);
    setAgentSummary(null);
    setShowGameLoadingScreen(false);
    setNeedsAuth(true);
    const customReason = typeof reasonMessage === 'string' && reasonMessage.trim() ? reasonMessage : null;
    showNotification(
      customReason ? 'error' : 'success',
      customReason || 'Disconnected from Google Drive.'
    );
  }, []);

  // Automatic sign-out after 30 minutes of user inactivity
  useEffect(() => {
    const isSignedIn = !needsAuth || !!user || !!accessToken;
    if (!isSignedIn) return;

    const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    let lastActivityTime = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const triggerInactivityLogout = () => {
      handleLogout('Session expired: Automatically signed out after 30 minutes of inactivity.');
    };

    const resetInactivityTimer = () => {
      const now = Date.now();
      // Throttle timer resets to at most once per second during rapid events like mousemove
      if (now - lastActivityTime < 1000 && timeoutId !== null) {
        return;
      }
      lastActivityTime = now;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(triggerInactivityLogout, INACTIVITY_TIMEOUT_MS);
    };

    const handleVisibilityOrFocus = () => {
      if (Date.now() - lastActivityTime >= INACTIVITY_TIMEOUT_MS) {
        triggerInactivityLogout();
      } else {
        resetInactivityTimer();
      }
    };

    // Start initial 30-minute countdown
    timeoutId = setTimeout(triggerInactivityLogout, INACTIVITY_TIMEOUT_MS);

    const activityEvents: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'pointerdown',
      'wheel',
      'click',
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    // Periodic check every 30s in case browser throttled background timers during sleep
    const checkIntervalId = setInterval(() => {
      if (Date.now() - lastActivityTime >= INACTIVITY_TIMEOUT_MS) {
        triggerInactivityLogout();
      }
    }, 30000);

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      clearInterval(checkIntervalId);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [needsAuth, user, accessToken, handleLogout]);

  // Date-filtered .TEPR files grounded to the Year, Month, and Date selected on Page 1 ("Folder & Asset")
  const dateFilteredParsedFiles = useMemo(() => {
    if (parsedFiles.length === 0) return [];

    // Build lookup of fileIds in Page 1's selected Year/Month/Date focus area
    const focusFileIds = new Set(
      scannedFiles
        .filter((sf) => {
          if (selectedYearFilter !== 'all' && String(sf.dateMeta?.year || 2026) !== selectedYearFilter) return false;
          if (selectedMonthFilter !== 'all' && String(sf.dateMeta?.month || 8) !== selectedMonthFilter) return false;
          if (selectedDateFilter !== 'all' && sf.dateMeta?.dateKey !== selectedDateFilter) return false;
          return true;
        })
        .map((sf) => sf.fileId)
    );

    const matched = parsedFiles.filter((file) => {
      if (focusFileIds.has(file.fileId)) return true;

      // 1. Year Filter
      if (selectedYearFilter !== 'all') {
        const fileYear = String(file.dateMeta?.year || 2026);
        if (fileYear !== selectedYearFilter) return false;
      }

      // 2. Month Filter
      if (selectedMonthFilter !== 'all') {
        const fileMonth = String(file.dateMeta?.month || 8);
        if (fileMonth !== selectedMonthFilter) return false;
      }

      // 3. Date Filter (Ground data to the date selected in Page 1)
      if (selectedDateFilter !== 'all') {
        const fileDate = file.dateMeta?.dateKey || '';
        if (fileDate !== selectedDateFilter) return false;
      }

      return true;
    });

    // If the user already clicked Reading Temperature on Page 1 (or reading is in progress), ensure we never return empty
    if (matched.length === 0 && (hasReadTemperature || isReadingTemperature || parsedFiles.length > 0)) {
      return parsedFiles;
    }

    return matched;
  }, [parsedFiles, scannedFiles, selectedYearFilter, selectedMonthFilter, selectedDateFilter, hasReadTemperature, isReadingTemperature]);

  // Filtered .TEPR files based on Date (from Page 1), Phase, and Search query
  const filteredParsedFiles = useMemo(() => {
    return dateFilteredParsedFiles.filter((file) => {
      // 4. Cable Phase Filter (selected from Chart controls - Requirement 4)
      if (selectedPhaseFilter !== 'all') {
        if (file.cablePhase !== selectedPhaseFilter) return false;
      }

      // 5. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = file.fileName.toLowerCase().includes(q);
        const matchesPhase = file.cablePhase.toLowerCase().includes(q);
        const matchesDate = file.dateMeta?.formattedDate?.toLowerCase().includes(q);
        const matchesTime = file.dateMeta?.formattedTime?.includes(q);
        const matchesChannel = file.channel !== undefined && `ch ${file.channel}`.includes(q);
        if (!matchesName && !matchesPhase && !matchesDate && !matchesTime && !matchesChannel) {
          return false;
        }
      }

      return true;
    });
  }, [dateFilteredParsedFiles, selectedPhaseFilter, searchQuery]);

  // Hourly Aggregations for Active Phase and Active Date from Page 1
  const activeHourlySummaries = useMemo(() => {
    const filesForPhaseAndDate = dateFilteredParsedFiles.filter((f) => {
      if (selectedPhaseFilter !== 'all' && f.cablePhase !== selectedPhaseFilter) return false;
      return true;
    });
    return aggregateHourlyTeprFiles(filesForPhaseAndDate, selectedPhaseFilter);
  }, [dateFilteredParsedFiles, selectedPhaseFilter]);

  // CASCADING HIERARCHY HANDLERS:
  // Dropdown 1: Year Handler -> Cascades to Month and Date
  const handleYearFilterChange = (newYear: string) => {
    setSelectedYearFilter(newYear);

    const filesInYear = newYear === 'all'
      ? scannedFiles
      : scannedFiles.filter((f) => String(f.dateMeta?.year || 2026) === newYear);

    let effectiveMonth = selectedMonthFilter;
    if (selectedMonthFilter !== 'all') {
      const monthExists = filesInYear.some((f) => String(f.dateMeta?.month || 8) === selectedMonthFilter);
      if (!monthExists) {
        const availableMonths = Array.from(new Set(filesInYear.map((f) => String(f.dateMeta?.month || 8)))).sort();
        effectiveMonth = availableMonths[0] || 'all';
        setSelectedMonthFilter(effectiveMonth);
      }
    }

    if (selectedDateFilter !== 'all') {
      const filesInYearAndMonth = effectiveMonth === 'all'
        ? filesInYear
        : filesInYear.filter((f) => String(f.dateMeta?.month || 8) === effectiveMonth);

      const dateExists = filesInYearAndMonth.some((f) => f.dateMeta?.dateKey === selectedDateFilter);
      if (!dateExists) {
        const availableDates = Array.from(new Set(filesInYearAndMonth.map((f) => f.dateMeta?.dateKey))).sort();
        setSelectedDateFilter(availableDates[0] || 'all');
      }
    }
  };

  // Dropdown 2: Month Handler -> Cascades to Date
  const handleMonthFilterChange = (newMonth: string) => {
    setSelectedMonthFilter(newMonth);

    const filesInYear = selectedYearFilter === 'all'
      ? scannedFiles
      : scannedFiles.filter((f) => String(f.dateMeta?.year || 2026) === selectedYearFilter);

    const filesInYearAndMonth = newMonth === 'all'
      ? filesInYear
      : filesInYear.filter((f) => String(f.dateMeta?.month || 8) === newMonth);

    if (selectedDateFilter !== 'all') {
      const dateExists = filesInYearAndMonth.some((f) => f.dateMeta?.dateKey === selectedDateFilter);
      if (!dateExists) {
        const availableDates = Array.from(new Set(filesInYearAndMonth.map((f) => f.dateMeta?.dateKey))).sort();
        setSelectedDateFilter(availableDates[0] || 'all');
      }
    }
  };

  // Dropdown 3: Date Handler
  const handleDateFilterChange = (newDate: string) => {
    setSelectedDateFilter(newDate);
  };

  // Phase Filter Handler (Controlled from Chart after reading)
  const handlePhaseFilterChange = (newPhase: string) => {
    setSelectedPhaseFilter(newPhase);
  };

  // Hourly Filter Handler (24 Hours dropdown next to phase filter)
  const handleHourFilterChange = (newHour: string) => {
    setSelectedHourFilter(newHour);
  };

  const handleResetFilters = () => {
    if (scannedFiles.length > 0) {
      const years = Array.from(new Set(scannedFiles.map((s) => s.dateMeta?.year || 2026))).sort((a, b) => b - a);
      setSelectedYearFilter(String(years[0]));
      const months = Array.from(
        new Set(
          scannedFiles
            .filter((s) => (s.dateMeta?.year || 2026) === years[0])
            .map((s) => s.dateMeta?.month || 8)
        )
      ).sort((a, b) => a - b);
      setSelectedMonthFilter(months.length > 0 ? String(months[0]) : 'all');
      const dates = Array.from(
        new Set(
          scannedFiles
            .filter(
              (s) =>
                (s.dateMeta?.year || 2026) === years[0] &&
                (s.dateMeta?.month || 8) === (months[0] || 8)
            )
            .map((s) => s.dateMeta?.dateKey)
        )
      ).sort();
      setSelectedDateFilter(dates.length > 0 ? dates[0] : 'all');
    } else {
      setSelectedYearFilter('all');
      setSelectedMonthFilter('all');
      setSelectedDateFilter('all');
    }
    setSelectedPhaseFilter('all');
    setSelectedHourFilter('all');
    setSearchQuery('');
  };

  // Keep activeFileId synchronized with filtered set
  useEffect(() => {
    if (filteredParsedFiles.length > 0) {
      const exists = filteredParsedFiles.some((f) => f.fileId === activeFileId);
      if (!exists) {
        setActiveFileId(filteredParsedFiles[filteredParsedFiles.length - 1].fileId);
      }
    } else {
      setActiveFileId(null);
    }
  }, [filteredParsedFiles, activeFileId]);

  // Active DailyPowerSummary referenced by selectedDateFilter from Page 1 ("Folder & Asset")
  const activeDailyPowerSummary: DailyPowerSummary | null = useMemo(() => {
    const findPowerByDateOrMmDd = (dKey?: string): DailyPowerSummary | null => {
      if (!dKey || dKey === 'all') return null;
      const exact = powerSummariesByDate.get(dKey);
      if (exact) return exact;
      const mmdd = dKey.slice(5);
      if (mmdd && mmdd.length === 5) {
        for (const [k, val] of powerSummariesByDate.entries()) {
          if (k.slice(5) === mmdd) return val;
        }
      }
      return null;
    };

    if (selectedDateFilter && selectedDateFilter !== 'all') {
      const matched = findPowerByDateOrMmDd(selectedDateFilter);
      if (matched) return matched;
      return buildFallbackDailyPowerSummary(selectedDateFilter);
    }
    if (dateFilteredParsedFiles.length > 0) {
      const latestDateKey = dateFilteredParsedFiles[dateFilteredParsedFiles.length - 1]?.dateMeta?.dateKey;
      const found = findPowerByDateOrMmDd(latestDateKey);
      if (found) return found;
      if (latestDateKey) return buildFallbackDailyPowerSummary(latestDateKey);
    }
    return buildFallbackDailyPowerSummary('2026-08-01');
  }, [selectedDateFilter, powerSummariesByDate, dateFilteredParsedFiles]);

  // Trigger background lookup in Target Folder 2 whenever selectedDateFilter changes
  useEffect(() => {
    if (
      selectedDateFilter &&
      selectedDateFilter !== 'all' &&
      !powerSummariesByDate.has(selectedDateFilter) &&
      !attemptedPowerDatesRef.current.has(selectedDateFilter)
    ) {
      attemptedPowerDatesRef.current.add(selectedDateFilter);
      ensurePowerSummaryForDate(selectedDateFilter);
    }
  }, [selectedDateFilter, powerSummariesByDate, ensurePowerSummaryForDate]);

  // Build time-series matrix for designated points (38 Land points/phase vs 81 Submarine points)
  // Using the date data read from Page 1 ("Folder & Asset")
  const timeSeriesSummary: LocationTimeSeriesSummary[] = useMemo(() => {
    if (selectedHourFilter !== 'all') {
      const singleHourSummaries = activeHourlySummaries.filter((h) => h.hourKey === selectedHourFilter);
      if (singleHourSummaries.length > 0) {
        return buildHourlyLocationTimeSeries(singleHourSummaries, selectedPhaseFilter, activeDailyPowerSummary);
      }
    }
    const targetSet =
      filteredParsedFiles.length > 0
        ? filteredParsedFiles
        : dateFilteredParsedFiles.length > 0
        ? dateFilteredParsedFiles
        : parsedFiles;
    return buildLocationTimeSeries(targetSet, selectedPhaseFilter, activeDailyPowerSummary);
  }, [filteredParsedFiles, dateFilteredParsedFiles, parsedFiles, selectedPhaseFilter, selectedHourFilter, activeHourlySummaries, activeDailyPowerSummary]);

  // Run Autonomous Agent for Cable Temperature Analysis
  const handleRunAgent = async () => {
    if (parsedFiles.length === 0) return;

    setIsAnalyzingCable(true);
    try {
      const res = await runCableAgentSummarize({
        folderName: currentFolder.name,
        timeSeriesList: parsedFiles.map((f) => ({
          fileName: f.fileName,
          timestamp: f.header.timestamp || 0,
          dateTimeStr: f.dateMeta?.formattedDate ? `${f.dateMeta.formattedDate} ${f.dateMeta.formattedTime}` : (f.header.dateTimeStr || f.fileName),
          channel: f.header.channel,
          cablePhase: f.cablePhase,
          fiberReferenceTemp: f.header.fiberReferenceTemp,
          maxDeltaTemp: f.maxDeltaTemp,
          maxAbsoluteTemp: f.header.fiberReferenceTemp + f.maxDeltaTemp,
        })),
        targetPointsMatrix: timeSeriesSummary.map((t) => ({
          location: t.location,
          tag: t.tag,
          currentDeltaTemp: t.currentDeltaTemp,
          currentAbsoluteTemp: t.currentAbsoluteTemp,
          baselineTemp: t.baselineTemp,
          maxDeltaTemp: t.maxDeltaTemp,
          status: t.status,
          readings: t.readings,
        })),
        principles: 'DTS linear cable thermal analysis, 19-point verification, Phase A/B/C/Submarine classification, and rate of change',
        focusMode: 'Deep Dive',
      });

      setAgentSummary(res.summary);
      showNotification('success', 'Autonomous agent successfully evaluated cable temperature profile!');
    } catch (err: any) {
      console.error('Agent analysis failed:', err);
      showNotification('error', err.message || 'Autonomous agent failed to analyze cable profile.');
    } finally {
      setIsAnalyzingCable(false);
    }
  };

  // Generate authentic multi-phase sample .TEPR dataset
  const handleGenerateSampleDataset = () => {
    setConfirmModalData({
      isOpen: true,
      title: 'Generate & Save Multi-Phase .TEPR Files to Drive?',
      message: `This will create 8 authentic .TEPR files in folder "${currentFolder.name}" with Cable Phases (Channel 0: Phase A, 1: Phase B, 2: Phase C, 3: Submarine Cable) and timestamps across multiple dates (e.g. Temp_Aug010007_514150.tepr, Temp_Aug010830_514152.tepr, Temp_Aug020007_514154.tepr).`,
      onConfirm: async () => {
        setConfirmModalData((prev) => ({ ...prev, isOpen: false }));
        if (!accessToken) return;

        setIsGeneratingSamples(true);
        try {
          const sampleFiles = [
            // Aug 01 Records
            { 
              name: 'Temp_Aug010007_514150.tepr', 
              timeStr: '2026-08-01T00:07:00.000Z', 
              channel: 0, 
              refTemp: 30.0, 
              mult: 0.9 
            },
            { 
              name: 'Temp_Aug010415_514151.tepr', 
              timeStr: '2026-08-01T04:15:00.000Z', 
              channel: 1, 
              refTemp: 30.0, 
              mult: 1.15 
            },
            { 
              name: 'Temp_Aug010830_514152.tepr', 
              timeStr: '2026-08-01T08:30:00.000Z', 
              channel: 2, 
              refTemp: 30.0, 
              mult: 1.05 
            },
            { 
              name: 'Temp_Aug011245_514153.tepr', 
              timeStr: '2026-08-01T12:45:00.000Z', 
              channel: 3, 
              refTemp: 30.0, 
              mult: 1.35 
            },
            // Aug 02 Records
            { 
              name: 'Temp_Aug020007_514154.tepr', 
              timeStr: '2026-08-02T00:07:00.000Z', 
              channel: 0, 
              refTemp: 30.0, 
              mult: 1.45 
            },
            { 
              name: 'Temp_Aug020830_514155.tepr', 
              timeStr: '2026-08-02T08:30:00.000Z', 
              channel: 0, 
              refTemp: 30.0, 
              mult: 1.2 
            },
            { 
              name: 'Temp_Aug020415_514156.tepr', 
              timeStr: '2026-08-02T04:15:00.000Z', 
              channel: 1, 
              refTemp: 30.0, 
              mult: 1.1 
            },
            { 
              name: 'Temp_Aug021600_514157.tepr', 
              timeStr: '2026-08-02T16:00:00.000Z', 
              channel: 2, 
              refTemp: 30.0, 
              mult: 1.25 
            },
            { 
              name: 'Temp_Aug021830_514158.tepr', 
              timeStr: '2026-08-02T18:30:00.000Z', 
              channel: 3, 
              refTemp: 30.0, 
              mult: 1.42 
            },
          ];

          for (const s of sampleFiles) {
            const content = generateSampleTeprContent(s.timeStr, s.channel, s.refTemp, s.mult);
            await uploadTextFileToGoogleDrive(accessToken, currentFolder.id, s.name, content, 'text/plain');
          }

          showNotification('success', 'Multi-phase sample .TEPR files created in Google Drive folder!');
          await loadAndParseTeprFiles();
        } catch (err: any) {
          console.error('Error generating sample files:', err);
          showNotification('error', err.message || 'Failed to upload sample .TEPR files.');
        } finally {
          setIsGeneratingSamples(false);
        }
      },
    });
  };

  // Save full agent summary report to Google Drive
  const handleSaveReportToDrive = () => {
    if (!agentSummary) return;

    setConfirmModalData({
      isOpen: true,
      title: 'Save Temperature Analysis Report to Google Drive?',
      message: `This will create "Asset_Cable_Temperature_Summary_Report.md" in your folder "${currentFolder.name}".`,
      onConfirm: async () => {
        setConfirmModalData((prev) => ({ ...prev, isOpen: false }));
        if (!accessToken || !agentSummary) return;

        setIsSavingToDrive(true);
        try {
          const saved = await saveSummaryToGoogleDrive(
            accessToken,
            currentFolder.id,
            'Asset_Cable_Temperature_Summary_Report.md',
            agentSummary
          );
          showNotification('success', `Saved report "${saved.name}" to Google Drive folder.`);
        } catch (err: any) {
          console.error('Error saving report to Drive:', err);
          showNotification('error', err.message || 'Failed to save summary report to Drive.');
        } finally {
          setIsSavingToDrive(false);
        }
      },
    });
  };

  // Navigate to any tab (via left side panel or Page 1 buttons) and ensure read data is automatically synced
  const handleNavigateToTab = useCallback(
    (tab: AppPageTab) => {
      setActiveTab(tab);
      if (tab !== 'management' && tab !== 'yearly') {
        // If user already clicked Reading Temperature and changed date filter or files are still pending, auto-apply
        if (
          hasReadTemperature &&
          !isReadingTemperature &&
          scannedFiles.length > 0 &&
          (!currentFiltersLoaded || parsedFiles.length === 0)
        ) {
          handleReadTemperature();
        }
        if (selectedDateFilter && selectedDateFilter !== 'all' && !powerSummariesByDate.has(selectedDateFilter)) {
          ensurePowerSummaryForDate(selectedDateFilter);
        }
      }
    },
    [
      hasReadTemperature,
      isReadingTemperature,
      scannedFiles.length,
      currentFiltersLoaded,
      parsedFiles.length,
      handleReadTemperature,
      selectedDateFilter,
      powerSummariesByDate,
      ensurePowerSummaryForDate,
    ]
  );

  const baselineTemp = parsedFiles[0]?.header.fiberReferenceTemp ?? 30.0;

  const isPublicView = needsAuth || adminViewMode === 'public';

  const [isRefreshingPublicData, setIsRefreshingPublicData] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<number>(0);
  const [showPublicChargingScreen, setShowPublicChargingScreen] = useState<boolean>(true);
  const [publicSyncStatusText, setPublicSyncStatusText] = useState<string>(
    'Initializing 115 kV Submarine Cable Telemetry Grid...'
  );
  const [isInitialPublicSyncComplete, setIsInitialPublicSyncComplete] = useState<boolean>(false);

  // Automatic backdoor sync from the 3 shared Google Drive folders on initial web app launch
  // All initial data loading finishes inside PublicElectricalLoadingScreen before entering the Public Dashboard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRefreshProgress(0);
      try {
        const res = await syncAllPublicSharedTargetFolders(
          accessToken || undefined,
          (pct, statusText) => {
            if (cancelled) return;
            setRefreshProgress(Math.min(100, Math.max(0, Math.round(pct))));
            if (statusText) {
              setPublicSyncStatusText(statusText);
            }
          }
        );
        if (!cancelled) {
          setDbConfig(getOrgDatabaseConfig());
          setRefreshProgress(100);
          setPublicSyncStatusText(
            res.success
              ? 'All 3 Shared Telemetry Conduits Synchronized (100%)'
              : res.message || 'Telemetry Grid Ready'
          );
        }
      } catch (err: any) {
        console.warn('Initial public shared folder sync warning:', err);
        if (!cancelled) {
          setDbConfig(getOrgDatabaseConfig());
          setRefreshProgress(100);
          setPublicSyncStatusText('Telemetry Grid Synchronized from Cached Snapshots');
        }
      } finally {
        if (!cancelled) {
          setIsInitialPublicSyncComplete(true);
          setIsRefreshingPublicData(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefreshPublicData = async () => {
    if (isRefreshingPublicData || showPublicChargingScreen) return;
    setIsRefreshingPublicData(true);
    setRefreshProgress(0);
    try {
      const res = await syncAllPublicSharedTargetFolders(accessToken || undefined, (pct, statusText) => {
        setRefreshProgress(Math.min(100, Math.max(0, Math.round(pct))));
        if (statusText) {
          setPublicSyncStatusText(statusText);
        }
      });
      if (res.success) {
        setDbConfig(getOrgDatabaseConfig());
        showNotification('success', res.message);
      } else {
        showNotification('error', res.message);
      }
    } catch (err: any) {
      console.error('Error refreshing public shared data:', err);
      showNotification('error', `Data refresh error: ${err?.message || 'Could not reach server proxy'}`);
    } finally {
      setIsRefreshingPublicData(false);
      setTimeout(() => setRefreshProgress(0), 1200);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans antialiased transition-colors ${
      isPublicView
        ? 'bg-[#070b14] text-slate-100 selection:bg-cyan-500 selection:text-slate-950'
        : 'bg-slate-100/60 text-slate-900'
    }`}>
      {/* Public Dashboard Electrical Charging Loading Screen (0 - 100% while backdoor loads 3 shared folders) */}
      {showPublicChargingScreen && isPublicView && (
        <PublicElectricalLoadingScreen
          syncProgress={refreshProgress}
          syncStatusText={publicSyncStatusText}
          isSyncComplete={isInitialPublicSyncComplete}
          onComplete={() => {
            setShowPublicChargingScreen(false);
            setIsInitialPublicSyncComplete(true);
            setIsRefreshingPublicData(false);
            setRefreshProgress(0);
            setDbConfig(getOrgDatabaseConfig());
          }}
        />
      )}

      {/* Global Top Header strictly centered with reduced-size top-right login & new tab */}
      <TopGlobalHeader
        user={user}
        isAuthenticated={!needsAuth}
        isLoggingIn={isLoggingIn}
        onLogin={handleLogin}
        onLogout={() => handleLogout()}
        isAdminModeActive={!needsAuth && adminViewMode === 'internal'}
        onToggleAdminViewMode={
          !needsAuth
            ? () => setAdminViewMode((prev) => (prev === 'internal' ? 'public' : 'internal'))
            : undefined
        }
        onToggleSidebar={
          isPublicView
            ? () => setIsPublicSidebarCollapsed((prev) => !prev)
            : undefined
        }
        isSidebarCollapsed={isPublicSidebarCollapsed}
        onRefreshPublicData={handleRefreshPublicData}
        isRefreshingPublicData={isRefreshingPublicData && !showPublicChargingScreen}
        refreshProgress={showPublicChargingScreen ? 0 : refreshProgress}
      />

      {/* Toast Notification */}
      {notification && !showGameLoadingScreen && !showPublicChargingScreen && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold animate-in slide-in-from-bottom-5 duration-200 ${
            notification.type === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : 'bg-rose-900 text-white border-rose-700'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Sci-Fi Loading Screen after passing Admin Login Session (0-100% Date Scanning in Target Folder 1 & 2) */}
      {showGameLoadingScreen && !needsAuth && (
        <VideoGameLoadingScreen
          scannedFiles={scannedFiles}
          parsedFiles={parsedFiles}
          powerScannedFiles={powerScannedFiles}
          loadingProgress={loadingProgress}
          isLoadingFiles={isLoadingFiles}
          isSyncingPowerForDate={isSyncingPowerForDate}
          isReadingTemperature={isReadingTemperature}
          isInitialScanning={isScanning}
          isInitialSystemLoading={isInitialSystemLoading}
          folderName={currentFolder.name}
          selectedYearFilter={selectedYearFilter}
          selectedMonthFilter={selectedMonthFilter}
          selectedDateFilter={selectedDateFilter}
          onComplete={() => setShowGameLoadingScreen(false)}
        />
      )}

      {/* Main Body Layout */}
      {isPublicView ? (
        /* PUBLIC DASHBOARD: YouTube-Style Left Sidebar + 5 Dedicated Public Views (Decoupled from Admin Login Session) */
        <div className="flex-1 flex flex-col lg:flex-row min-h-[calc(100vh-64px)]">
          <PublicSidebar
            activeTab={publicTab}
            onTabChange={(tab) => {
              if (tab === 'datasetting') {
                setIsDataSettingPwdModalOpen(true);
              } else {
                setPublicTab(tab);
              }
            }}
            isCollapsed={isPublicSidebarCollapsed}
            onToggleCollapse={() => setIsPublicSidebarCollapsed((prev) => !prev)}
            dbConfig={dbConfig}
          />

          <DataSettingPasswordModal
            isOpen={isDataSettingPwdModalOpen}
            onSuccess={() => {
              setIsDataSettingPwdModalOpen(false);
              setPublicTab('datasetting');
            }}
            onCancel={() => setIsDataSettingPwdModalOpen(false)}
          />

          <main className="flex-1 min-w-0 w-full max-w-[1880px] mx-auto px-2.5 sm:px-4 lg:px-6 py-4 sm:py-5 space-y-5">
            {publicTab === 'heatmap' ? (
              <PublicHeatMapPage
                dbConfig={dbConfig}
                onAdminLoginClick={handleLogin}
                isAdminLoggedIn={!needsAuth}
                onGoToFolderAsset={() => {
                  setAdminViewMode('internal');
                  setActiveTab('management');
                }}
                parsedFiles={[]}
                activeDailyPowerSummary={null}
                powerSummariesByDate={new Map()}
                selectedDateFilter="all"
              />
            ) : publicTab === 'dailycurve' ? (
              <PublicDailyCurvePage
                dbConfig={dbConfig}
                onAdminLoginClick={handleLogin}
                isAdminLoggedIn={!needsAuth}
                onGoToFolderAsset={() => {
                  setAdminViewMode('internal');
                  setActiveTab('management');
                }}
                parsedFiles={[]}
                scannedFiles={[]}
                powerScannedFiles={[]}
                dateFilteredParsedFiles={[]}
                activeDailyPowerSummary={null}
                powerSummariesByDate={new Map()}
                selectedDateFilter="all"
                selectedYearFilter="all"
                selectedMonthFilter="all"
                selectedPhaseFilter="all"
                hasReadTemperature={false}
              />
            ) : publicTab === 'powertemp3d' ? (
              <Public3DPowerTempPage
                dbConfig={dbConfig}
                onAdminLoginClick={handleLogin}
                isAdminLoggedIn={!needsAuth}
                onGoToFolderAsset={() => {
                  setAdminViewMode('internal');
                  setActiveTab('management');
                }}
                parsedFiles={[]}
                scannedFiles={[]}
                powerScannedFiles={[]}
                dateFilteredParsedFiles={[]}
                activeDailyPowerSummary={null}
                powerSummariesByDate={new Map()}
                selectedDateFilter="all"
                selectedYearFilter="all"
                selectedMonthFilter="all"
                selectedPhaseFilter="all"
                hasReadTemperature={false}
              />
            ) : publicTab === 'yearly' ? (
              <PublicYearlyComparisonPage
                dbConfig={dbConfig}
                onAdminLoginClick={handleLogin}
                isAdminLoggedIn={!needsAuth}
                onGoToFolderAsset={() => {
                  setAdminViewMode('internal');
                  setActiveTab('management');
                }}
                powerSummariesByDate={new Map()}
              />
            ) : publicTab === 'tempstats' ? (
              <PublicTempStatisticsPage dbConfig={dbConfig} />
            ) : publicTab === 'powerstats' ? (
              <PublicPowerStatisticsPage dbConfig={dbConfig} />
            ) : (
              <PublicDataSettingPage
                dbConfig={dbConfig}
                onDatabaseUpdated={(newConfig) => setDbConfig(newConfig)}
                onNavigateToChart={(tab) => setPublicTab(tab)}
              />
            )}
          </main>
        </div>
      ) : (
        /* INTERNAL ENGINEERING SUITE (PAGES 1-7) - For Authenticated Admin */
        <div className="flex-1 flex flex-col lg:flex-row min-h-[calc(100vh-64px)]">
          {/* YouTube-Style Collapsible Left Side Panel for Internal Suite */}
          <Header
            user={user}
            needsAuth={needsAuth}
            isLoggingIn={isLoggingIn}
            onLogin={handleLogin}
            onLogout={() => handleLogout()}
            activeTab={activeTab}
            onTabChange={handleNavigateToTab}
            referenceDateKey={selectedDateFilter}
            hasPowerForDate={!!activeDailyPowerSummary}
          />

          {/* Main Content Area for Pages 1-7 */}
          <main className="flex-1 min-w-0 w-full max-w-[1880px] mx-auto px-2.5 sm:px-4 lg:px-6 py-4 sm:py-5 space-y-5">
            {activeTab === 'power' ? (
              /* PAGE 4: Power consumption of 4 submarine cable circuits (KMB, KMA, KNA) */
              <PowerConsumptionPage
                user={user}
                accessToken={accessToken}
                onLogin={handleLogin}
                showNotification={showNotification}
                syncedDateKey={selectedDateFilter}
                activeDailyPowerSummary={activeDailyPowerSummary}
                hasReadTemperature={hasReadTemperature}
                externalSummaries={powerSummariesByDate}
                externalScannedFiles={powerScannedFiles}
                powerFolders={powerFolders}
                onNavigateToPage1={() => handleNavigateToTab('management')}
                onScanFromPage1={async () => {
                  await scanConfiguredPowerFolders(powerFolders);
                }}
                onSelectDateFilter={(dateKey) => {
                  handleDateFilterChange(dateKey);
                }}
                ensurePowerSummaryForDate={ensurePowerSummaryForDate}
                onPowerDataSync={handlePowerDataSync}
              />
            ) : activeTab === 'management' ? (
              /* PAGE 1: Designated Target Folder, Asset & Phase Management */
              <div className="space-y-6 animate-in fade-in duration-200">
                {/* Target Google Drive Folders Selector (Target Folders 1, 2, 3, and 4) */}
                <FolderSelector
                  accessToken={accessToken || ''}
                  currentFolder={currentFolder}
                  permanentFolder={permanentFolder}
                  onSetPermanentFolder={handleSetPermanentFolder}
                  onSelectFolder={handleSelectFolder}
                  onRefresh={() => loadAndParseTeprFiles(true)}
                  isLoading={isLoadingFiles}
                  powerFolders={powerFolders}
                  onUpdatePowerFolders={handleUpdatePowerFolders}
                  onScanPowerFolders={() => {
                    scanConfiguredPowerFolders(powerFolders);
                  }}
                  isScanningPower={isSyncingPowerForDate}
                  referenceDateKey={selectedDateFilter}
                  activeDailyPowerSummary={activeDailyPowerSummary}
                  powerScannedCount={powerScannedFiles.length}
                  // Target Folder 3: Daily Temperature Record
                  folder3={folder3}
                  permanentFolder3={permanentFolder3}
                  onSelectFolder3={handleSelectFolder3}
                  onSetPermanentFolder3={handleSetPermanentFolder3}
                  onRescanFolder3={() => scanTargetFolder3(folder3)}
                  isScanningFolder3={isScanningFolder3}
                  folder3ScannedDatesCount={dbConfig.totalDates}
                  folder3DateRange={dbConfig.dateRange}
                  // Target Folder 4: Daily Maximum Power Record of 4 Circuits
                  folder4={folder4}
                  permanentFolder4={permanentFolder4}
                  onSelectFolder4={handleSelectFolder4}
                  onSetPermanentFolder4={handleSetPermanentFolder4}
                  onRescanFolder4={() => scanTargetFolder4(folder4)}
                  isScanningFolder4={isScanningFolder4}
                  folder4ScannedRecordsCount={getOrgPowerDatabaseRecordsCount()}
                  folder4DateRange={getOrgPowerDatabaseDateRange()}
                />

            {/* .TEPR Multi-File Manager (Cascading Date Filters & Reading) */}
            <TeprFileManager
              files={files}
              parsedFiles={parsedFiles}
              filteredParsedFiles={filteredParsedFiles}
              scannedFiles={scannedFiles}
              isScanning={isLoadingFiles}
              isReadingTemperature={isReadingTemperature}
              hasReadTemperature={hasReadTemperature}
              currentFiltersLoaded={currentFiltersLoaded}
              onReadTemperature={handleReadTemperature}
              activeFileId={activeFileId}
              onSelectFile={(fileId) => setActiveFileId(fileId)}
              onRunAnalyzeAll={handleRunAgent}
              isProcessing={isAnalyzingCable || isLoadingFiles || isReadingTemperature}
              isLoadingFiles={isLoadingFiles}
              loadingProgress={loadingProgress}
              onGenerateSampleFiles={handleGenerateSampleDataset}
              isGeneratingSamples={isGeneratingSamples}
              selectedYearFilter={selectedYearFilter}
              onYearFilterChange={handleYearFilterChange}
              selectedMonthFilter={selectedMonthFilter}
              onMonthFilterChange={handleMonthFilterChange}
              selectedDateFilter={selectedDateFilter}
              onDateFilterChange={handleDateFilterChange}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onResetFilters={handleResetFilters}
            />

            {/* 3 Navigation Buttons below Autonomous Asset & Phase Management Panel (Available after user clicks "Reading Temperature") */}
            {hasReadTemperature && (
              <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl border border-slate-700/80 p-4 sm:p-5 text-white shadow-md animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3.5 border-b border-slate-700/80">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs sm:text-sm font-bold text-white">
                      Temperature Reading Complete ({filteredParsedFiles.length} .TEPR profiles loaded for{' '}
                      <span className="text-emerald-300 font-mono">
                        {selectedDateFilter !== 'all' ? selectedDateFilter : 'All Dates'}
                      </span>
                      )
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-300">
                    Select an analysis view below to inspect results:
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Button 1: Go to Satellite Heat Map */}
                  <button
                    type="button"
                    onClick={() => handleNavigateToTab('heatmap')}
                    className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-blue-600/25 border border-blue-400/30 transition-all flex items-center justify-between gap-2 cursor-pointer group"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="p-2 rounded-lg bg-white/15 text-white">
                        <MapPin className="w-4 h-4" />
                      </span>
                      <span className="text-left">
                        <span className="block font-extrabold">Go to Satellite Heat Map</span>
                        <span className="block text-[10px] text-blue-100 font-normal">
                          Page 2 • GPS Route &amp; Thermal Hotspots
                        </span>
                      </span>
                    </span>
                    <span className="text-base group-hover:translate-x-1 transition-transform">➔</span>
                  </button>

                  {/* Button 2: Temperature Profile & Matrix */}
                  <button
                    type="button"
                    onClick={() => handleNavigateToTab('profile')}
                    className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-indigo-600/25 border border-indigo-400/30 transition-all flex items-center justify-between gap-2 cursor-pointer group"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="p-2 rounded-lg bg-white/15 text-white">
                        <Activity className="w-4 h-4" />
                      </span>
                      <span className="text-left">
                        <span className="block font-extrabold">Temperature Profile &amp; Matrix</span>
                        <span className="block text-[10px] text-indigo-100 font-normal">
                          Page 3 • Reading Tf &amp; Calculated Tc,60287
                        </span>
                      </span>
                    </span>
                    <span className="text-base group-hover:translate-x-1 transition-transform">➔</span>
                  </button>

                  {/* Button 3: Power Consumption (4 Circuits) */}
                  <button
                    type="button"
                    onClick={() => handleNavigateToTab('power')}
                    className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/25 border border-emerald-400/30 transition-all flex items-center justify-between gap-2 cursor-pointer group"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="p-2 rounded-lg bg-white/15 text-white">
                        <Zap className="w-4 h-4" />
                      </span>
                      <span className="text-left">
                        <span className="block font-extrabold">Power Consumption (4 Circuits)</span>
                        <span className="block text-[10px] text-emerald-100 font-normal">
                          Page 4 • KMB, KMA &amp; KNA 15-Min Load
                        </span>
                      </span>
                    </span>
                    <span className="text-base group-hover:translate-x-1 transition-transform">➔</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'heatmap' ? (
          /* PAGE 2: 115 kV Submarine Cable Circuit #3 - Satellite Heat Map (Larger Map Size) */
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Top Synchronized Context Bar with Page 1 Settings */}
            <div className="bg-white p-3.5 px-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  Page 2: 115 kV Submarine Cable Circuit #3 - Satellite Heat Map
                </span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500">Folder:</span>
                <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">{currentFolder.name}</span>
                <span className="text-slate-500">Date:</span>
                <span className="font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">{selectedDateFilter !== 'all' ? selectedDateFilter : 'All Dates'}</span>
                <span className="text-slate-500">Phase:</span>
                <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">{selectedPhaseFilter === 'all' ? 'All Phases' : selectedPhaseFilter}</span>
                <span className="text-slate-500">Mode:</span>
                <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                  {selectedHourFilter === 'all' ? 'Daily Maximum' : `Hour ${selectedHourFilter} Max`}
                </span>
              </div>

              {/* Action Buttons to Switch to Page 1 or Page 3 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('management')}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 border border-slate-200 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <FolderCog className="w-3.5 h-3.5" />
                  <span>⚙️ Adjust Folder & Assets (Page 1)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('profile')}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Profile Chart (Page 3) ➔</span>
                </button>
              </div>
            </div>

            {/* Geographic Cable Heat Map (GPS coordinates, sectional filters, and T4 parameter visualization with larger size) */}
            <CableHeatMap
              timeSeriesSummary={timeSeriesSummary}
              parsedFiles={filteredParsedFiles}
              allParsedFiles={parsedFiles}
              selectedLocation={selectedLocation}
              onSelectLocation={(loc) => setSelectedLocation(loc)}
              selectedPhaseFilter={selectedPhaseFilter}
              onPhaseFilterChange={handlePhaseFilterChange}
              activeHourFilter={selectedHourFilter}
              onHourFilterChange={handleHourFilterChange}
              activeDateFilter={selectedDateFilter}
              hasReadTemperature={hasReadTemperature}
              isReadingTemperature={isReadingTemperature}
              dailyPowerSummary={activeDailyPowerSummary}
            />
          </div>
        ) : activeTab === 'profile' ? (
          /* PAGE 3: Peak Asset Temperature Profile (X-Y Discrete Position Chart) and Other */
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Synchronized Context Bar with Page 1 Settings */}
            <div className="bg-white p-3.5 px-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  Page 3: Peak Asset Temperature Profile (X-Y Discrete Position Chart)
                </span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500">Folder:</span>
                <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">{currentFolder.name}</span>
                <span className="text-slate-500">Date:</span>
                <span className="font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">{selectedDateFilter !== 'all' ? selectedDateFilter : 'All Dates'}</span>
                <span className="text-slate-500">Phase:</span>
                <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">{selectedPhaseFilter === 'all' ? 'All Phases' : selectedPhaseFilter}</span>
                <span className="text-slate-500">Mode:</span>
                <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                  {selectedHourFilter === 'all' ? 'Daily Maximum' : `Hour ${selectedHourFilter} Max`}
                </span>
              </div>

              {/* Action Buttons to Switch to Page 1 or Page 2 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('management')}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 border border-slate-200 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <FolderCog className="w-3.5 h-3.5" />
                  <span>⚙️ Adjust Folder & Assets (Page 1)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('heatmap')}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Satellite Heat Map (Page 2) ➔</span>
                </button>
              </div>
            </div>

            {/* Cable Temperature Chart (Discrete Peak Profile across Designated Points) */}
            <CableTemperatureChart
              parsedFiles={dateFilteredParsedFiles}
              activeFileId={activeFileId}
              onSelectFile={(fileId) => setActiveFileId(fileId)}
              selectedLocation={selectedLocation}
              onSelectLocation={(loc) => setSelectedLocation(loc)}
              activePhaseFilter={selectedPhaseFilter}
              onPhaseFilterChange={handlePhaseFilterChange}
              activeHourFilter={selectedHourFilter}
              onHourFilterChange={handleHourFilterChange}
              activeDateFilter={selectedDateFilter}
              onReadTemperature={handleReadTemperature}
              isReadingTemperature={isReadingTemperature}
              dailyPowerSummary={activeDailyPowerSummary}
            />

            {/* Split Grid: 19 Target Locations Matrix & Autonomous Agent Report */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 6 cols: Designated Key Target Locations Matrix */}
              <div className="lg:col-span-6">
                <TargetLocationsMatrix
                  timeSeriesSummary={timeSeriesSummary}
                  selectedLocation={selectedLocation}
                  onSelectLocation={(loc) => setSelectedLocation(loc)}
                  baselineTemp={baselineTemp}
                  selectedPhaseFilter={selectedPhaseFilter}
                  activeTimeFilter={selectedHourFilter}
                  activeDateFilter={selectedDateFilter}
                />
              </div>

              {/* Right 6 cols: Gemini Agent Summary Report & Q&A */}
              <div className="lg:col-span-6">
                <CableSummaryReport
                  summary={agentSummary}
                  isAnalyzing={isAnalyzingCable}
                  onRunAgent={handleRunAgent}
                  onSaveToDrive={handleSaveReportToDrive}
                  isSavingToDrive={isSavingToDrive}
                  timeSeriesSummary={timeSeriesSummary}
                  parsedFiles={parsedFiles}
                />
              </div>
            </div>
          </div>
        ) : activeTab === 'analyzing' ? (
          /* PAGE 5: Section Historical Trend & Multi-Factor Future Prediction ("Analyzing Page") */
          <div className="space-y-6 animate-in fade-in duration-200">
            <SectionAnalyzingPage
              parsedFiles={dateFilteredParsedFiles}
              allParsedFiles={parsedFiles}
              scannedFiles={scannedFiles}
              driveFiles={files}
              accessToken={accessToken || undefined}
              powerSummariesByDate={powerSummariesByDate}
              ensurePowerSummaryForDate={ensurePowerSummaryForDate}
              activeDateFilter={selectedDateFilter !== 'all' ? selectedDateFilter : undefined}
              initialSectionId={targetSectionForAnalyzing}
              showNotification={showNotification}
              currentFolder={currentFolder}
              permanentFolder={permanentFolder}
              onSetPermanentFolder={handleSetPermanentFolder}
              onSelectFolder={handleSelectFolder}
              onRefreshTeprFolder={() => loadAndParseTeprFiles(true)}
              isLoadingTeprFolder={isLoadingFiles}
              powerFolders={powerFolders}
              onUpdatePowerFolders={handleUpdatePowerFolders}
              onScanPowerFolders={async () => {
                await scanConfiguredPowerFolders(powerFolders);
              }}
              isScanningPower={isSyncingPowerForDate}
              activeDailyPowerSummary={activeDailyPowerSummary}
              powerScannedCount={powerScannedFiles.length}
            />
          </div>
        ) : activeTab === 'yearly' ? (
          /* PAGE 7: Multi-Year Visual Chart Comparison ("Yearly comparison") — Isolated Filters & Uploaded/URL Data Only */
          <div className="space-y-6 animate-in fade-in duration-200">
            <YearlyComparisonPage showNotification={showNotification} />
          </div>
        ) : activeTab === 'ai_summary' ? (
          /* PAGE 8: Executive AI Summary ("AI Summary") — Single-Page Quarterly & Monthly Report from 3 Shared Drive Links */
          <div className="space-y-6 animate-in fade-in duration-200">
            <AdminAiSummaryPage
              dbConfig={dbConfig}
              powerSummariesByDate={powerSummariesByDate}
              ensurePowerSummaryForDate={ensurePowerSummaryForDate}
              showNotification={showNotification}
            />
          </div>
        ) : (
          /* PAGE 6: System Thermal Risk Management & International Standards Mitigation ("Risk Management Page") */
          <div className="space-y-6 animate-in fade-in duration-200">
            <RiskManagementPage
              parsedFiles={dateFilteredParsedFiles}
              allParsedFiles={parsedFiles}
              scannedFiles={scannedFiles}
              powerSummariesByDate={powerSummariesByDate}
              activeDateFilter={selectedDateFilter !== 'all' ? selectedDateFilter : undefined}
              onNavigateToSectionAnalysis={(sectionId) => {
                setTargetSectionForAnalyzing(sectionId);
                setActiveTab('analyzing');
              }}
              showNotification={showNotification}
            />
          </div>
        )}
      </main>
    </div>
  )}

  {/* Confirmation Modal */}
  <ConfirmationModal
    isOpen={confirmModalData.isOpen}
    title={confirmModalData.title}
    message={confirmModalData.message}
    confirmLabel="Confirm & Proceed"
    onConfirm={confirmModalData.onConfirm}
    onCancel={() => setConfirmModalData((prev) => ({ ...prev, isOpen: false }))}
  />
</div>
  );
}
