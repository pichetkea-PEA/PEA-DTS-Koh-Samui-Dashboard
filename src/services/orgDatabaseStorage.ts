/**
 * Organization Master Database & Target Folder Persistence Service
 * Stores the permanent organization database (generated from Page 5 or uploaded directly by Admin)
 * and permanent target folder configuration.
 *
 * Persisted in localStorage and memory so non-logged-in public users can view the public dashboards
 * while administrators can update or replace the database in Page 1 (Folder & Asset).
 */

import {
  MasterSectionPeakRecord,
  DatabaseSheetRow,
  parseUploadedDatabaseForUpdate,
  parseUploadedSectionDailyProfileDatabase,
  computeSectionRowsForDatabase,
  getMasterSectionSummary,
} from './masterSectionSummary';
import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  getThermalZoneInfo,
  evaluateSectionConductorTemp,
} from '../data/cableCircuitStructure';
import * as XLSX from 'xlsx';

export interface OrgDatabaseConfig {
  hasDatabase: boolean;
  permanentFolderId?: string;
  permanentFolderName?: string;
  permanentFolder3Id?: string;
  permanentFolder3Name?: string;
  permanentFolder4Id?: string;
  permanentFolder4Name?: string;
  databaseFileName?: string;
  uploadedAt?: string;
  fileFormat?: 'xlsx' | 'csv';
  totalRecords: number;
  totalDates: number;
  dateRange: {
    firstDate: string;
    latestDate: string;
  };
  availableDates: string[];
  availableYears: string[];
}

export interface OrgDatabaseRecord {
  sectionId: string;
  date: string; // YYYY-MM-DD
  phase: string;
  tfMax: number;
  tfMin: number;
  tfMean: number;
  tcMax: number;
  tcMin: number;
  powerAtMaxMW: number;
  pCkt3MaxMW: number;
  pCkt2MaxMW: number;
  p33NktMaxMW: number;
  p33OilMaxMW: number;
  pTotalAtMaxMW: number;
  fileNameMax: string;
  timestampMax?: string;
  dofTfMax?: Record<string, number>;
  dofTcMax?: Record<string, number>;
  dofTimeMax?: Record<string, string>;
}

export interface CircuitDailyPeakPower {
  date: string;
  year: string;
  monthDay: string;
  ckt3MaxMW: number;
  ckt2MaxMW: number;
  nkt33MaxMW: number;
  oil33MaxMW: number;
  totalIslandMaxMW: number;
  fiberMaxTempC: number;
}

export interface OrgSectionHourlyRecord {
  sectionId: string;
  date: string; // YYYY-MM-DD
  phase: string; // 'Phase A' | 'Phase B' | 'Phase C' | 'Submarine (CH 3)'
  hourIndex: number; // 0..23
  hourNum?: number; // 0..23
  hourPeriod: string; // '00:00-01:00'
  peakTime?: string; // 'HH:mm'
  maxFiberTempC: number;
  meanFiberTempC: number;
  maxConductorTempC: number;
  meanConductorTempC: number;
  ckt3MW: number;
  ckt2MW: number;
  nkt33MW: number;
  oil33MW: number;
  totalMW: number;
  tfMax?: number;
  tcMax?: number;
  maxDofM?: number;
  pCkt3MW?: number;
  pCkt2MW?: number;
  pNktMW?: number;
  pOilMW?: number;
  totalPowerMW?: number;
}

export interface DataPanelSourceInfo {
  sourceType: 'file' | 'googlesheet' | 'googledrive' | 'default' | 'remote_link' | 'local_file';
  name: string;
  url?: string;
  remoteUrl?: string;
  updatedAt: string;
  totalDates: number;
  dateRange: { firstDate: string; latestDate: string };
  recordCount: number;
}

const STORAGE_KEY_CONFIG = 'org_dts_master_database_config_v2';
const STORAGE_KEY_DATA = 'org_dts_master_database_records_v2';
const STORAGE_KEY_FOLDER = 'org_dts_permanent_folder_config_v2';
const STORAGE_KEY_POWER_PEAKS = 'org_dts_power_peaks_records_v2';
const STORAGE_KEY_SECTION_PROFILE = 'org_dts_section_daily_profile_records_v2';
const STORAGE_KEY_SECTION_PROFILES = STORAGE_KEY_SECTION_PROFILE;
const STORAGE_KEY_PANEL1_INFO = 'dts_data_panel1_source_info_v2';
const STORAGE_KEY_PANEL2_INFO = 'dts_data_panel2_source_info_v2';
const STORAGE_KEY_PANEL3_INFO = 'dts_data_panel3_source_info_v2';

// In-memory cache for ultra-fast reactive queries
let memoryConfig: OrgDatabaseConfig | null = null;
let memoryRecords: OrgDatabaseRecord[] | null = null;
let memoryRecordsBySectionDate = new Map<string, OrgDatabaseRecord>();
let memoryCircuitPeaksByDate = new Map<string, CircuitDailyPeakPower>();
let memoryPowerPeaksOnly = new Map<string, CircuitDailyPeakPower>();
let memorySectionProfileRecords: OrgSectionHourlyRecord[] = [];
let memorySectionProfileBySectionDate = new Map<string, OrgSectionHourlyRecord[]>();
let memorySectionProfileDates: string[] = [];
let memorySectionProfileAllDates: string[] = [];
let memoryPanel1Info: DataPanelSourceInfo | null = null;
let memoryPanel2Info: DataPanelSourceInfo | null = null;
let memoryPanel3Info: DataPanelSourceInfo | null = null;

// Latest 3 uploaded files saved as the Public Dashboard default data source
let savedDefaultPanel1: {
  config: OrgDatabaseConfig;
  records: OrgDatabaseRecord[];
  info: DataPanelSourceInfo;
} | null = null;
let savedDefaultPanel2: {
  peaks: CircuitDailyPeakPower[];
  info: DataPanelSourceInfo;
} | null = null;
let savedDefaultPanel3: {
  records: OrgSectionHourlyRecord[];
  allDates?: string[];
  info: DataPanelSourceInfo;
} | null = null;
let hasStartedAsyncHydration = false;

const IDB_NAME = 'dts_public_default_db_idb_v1';
const IDB_STORE = 'defaults';

function openDefaultIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, val: any): Promise<void> {
  const db = await openDefaultIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGet<T = any>(key: string): Promise<T | null> {
  const db = await openDefaultIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function syncLatestThreeFilesToDefaultStore(payload: {
  panel1?: { config: OrgDatabaseConfig; records: OrgDatabaseRecord[]; info: DataPanelSourceInfo };
  panel2?: { peaks: CircuitDailyPeakPower[]; info: DataPanelSourceInfo };
  panel3?: { records: OrgSectionHourlyRecord[]; info: DataPanelSourceInfo };
  linksConfig?: PublicThreePanelLinksConfig;
}): Promise<void> {
  try {
    if (payload.panel1) {
      savedDefaultPanel1 = payload.panel1;
      await idbSet('panel1', payload.panel1);
    }
    if (payload.panel2) {
      savedDefaultPanel2 = payload.panel2;
      await idbSet('panel2', payload.panel2);
    }
    if (payload.panel3) {
      savedDefaultPanel3 = payload.panel3;
      await idbSet('panel3', payload.panel3);
    }
    if (payload.linksConfig) {
      await idbSet('linksConfig', payload.linksConfig);
    }
  } catch (e) {
    console.warn('IndexedDB save warning:', e);
  }

  try {
    await fetch('/api/public-default-databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('Server default database sync warning:', e);
  }
}

export async function saveAllCurrentPanelsAsDefaultDataSource(): Promise<void> {
  initFromStorage();
  const payload: {
    panel1?: { config: OrgDatabaseConfig; records: OrgDatabaseRecord[]; info: DataPanelSourceInfo };
    panel2?: { peaks: CircuitDailyPeakPower[]; info: DataPanelSourceInfo };
    panel3?: { records: OrgSectionHourlyRecord[]; info: DataPanelSourceInfo };
    linksConfig?: PublicThreePanelLinksConfig;
  } = {
    linksConfig: getPublicThreePanelLinksConfig(),
  };

  if (memoryConfig && memoryRecords && memoryRecords.length > 0) {
    const p1Info = getPanel1SourceInfo();
    payload.panel1 = {
      config: memoryConfig,
      records: memoryRecords,
      info: p1Info,
    };
  }
  if (memoryPowerPeaksOnly.size > 0) {
    const p2Info = getPanel2SourceInfo();
    payload.panel2 = {
      peaks: Array.from(memoryPowerPeaksOnly.values()),
      info: p2Info,
    };
  }
  if (memorySectionProfileRecords && memorySectionProfileRecords.length > 0) {
    const p3Info = getPanel3SourceInfo();
    payload.panel3 = {
      records: memorySectionProfileRecords,
      info: p3Info,
    };
  }

  await syncLatestThreeFilesToDefaultStore(payload);
}

let sharedPublicDefaultDbPromise: Promise<any> | null = null;

async function fetchSharedServerDefaultDatabases(forceRefresh = false): Promise<any> {
  if (!forceRefresh && sharedPublicDefaultDbPromise) {
    return sharedPublicDefaultDbPromise;
  }
  sharedPublicDefaultDbPromise = (async () => {
    try {
      const res = await fetch('/api/public-default-databases');
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const json = await res.json();
        if (json?.success && json?.data) {
          return json.data;
        }
      }
    } catch {
      // ignore network error and fall back to static CDN bundle
    }
    try {
      const staticRes = await fetch('/data/public-default-databases.json');
      if (staticRes.ok && (staticRes.headers.get('content-type') || '').includes('application/json')) {
        const data = await staticRes.json();
        if (data && (data.panel1 || data.panel2 || data.panel3)) {
          return data;
        }
      }
    } catch {
      // ignore static fallback error
    }
    return null;
  })();
  return sharedPublicDefaultDbPromise;
}

async function hydrateFromPublicDefaultDatabases(): Promise<void> {
  if (hasStartedAsyncHydration) return;
  hasStartedAsyncHydration = true;

  const serverData = await fetchSharedServerDefaultDatabases(false);

  const idbP1 = await idbGet<{
    config: OrgDatabaseConfig;
    records: OrgDatabaseRecord[];
    info: DataPanelSourceInfo;
  }>('panel1');
  const idbP2 = await idbGet<{
    peaks: CircuitDailyPeakPower[];
    info: DataPanelSourceInfo;
  }>('panel2');
  const idbP3 = await idbGet<{
    records: OrgSectionHourlyRecord[];
    info: DataPanelSourceInfo;
  }>('panel3');

  const p1 = serverData?.panel1 || idbP1;
  const p2 = serverData?.panel2 || idbP2;
  const p3 = serverData?.panel3 || idbP3;

  let didUpdate = false;

  if (p1 && Array.isArray(p1.records) && p1.records.length > 0 && p1.config) {
    savedDefaultPanel1 = p1;
    // Apply if local storage didn't already have a newer custom file or if local storage dropped records due to quota
    if (!memoryPanel1Info || memoryPanel1Info.sourceType === 'default' || !memoryRecords || memoryRecords.length !== p1.records.length) {
      memoryConfig = p1.config;
      memoryRecords = p1.records;
      memoryPanel1Info = p1.info || memoryPanel1Info;
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
        if (memoryPanel1Info) {
          localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(memoryPanel1Info));
        }
      } catch {}
      rebuildIndexes();
      didUpdate = true;
    }
  }

  if (p2 && Array.isArray(p2.peaks) && p2.peaks.length > 0) {
    savedDefaultPanel2 = p2;
    if (!memoryPanel2Info || memoryPanel2Info.sourceType === 'default' || memoryPowerPeaksOnly.size !== p2.peaks.length) {
      memoryPowerPeaksOnly.clear();
      p2.peaks.forEach((pk: CircuitDailyPeakPower) => {
        memoryPowerPeaksOnly.set(pk.date, pk);
        memoryCircuitPeaksByDate.set(pk.date, pk);
      });
      memoryPanel2Info = p2.info || memoryPanel2Info;
      try {
        if (memoryPanel2Info) {
          localStorage.setItem(STORAGE_KEY_PANEL2_INFO, JSON.stringify(memoryPanel2Info));
        }
        localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(p2.peaks));
      } catch {}
      rebuildIndexes();
      didUpdate = true;
    }
  }

  if (p3) {
    savedDefaultPanel3 = p3;
    if (Array.isArray(p3.allDates) && p3.allDates.length > 0) {
      memorySectionProfileAllDates = p3.allDates;
      memorySectionProfileDates = p3.allDates;
    } else if (Array.isArray(p3.dates) && p3.dates.length > 0) {
      memorySectionProfileAllDates = p3.dates;
      memorySectionProfileDates = p3.dates;
    }
    if (Array.isArray(p3.records) && p3.records.length > 0) {
      memorySectionProfileRecords = p3.records;
      rebuildSectionProfileIndexes();
    }
    memoryPanel3Info = p3.info || memoryPanel3Info;
    didUpdate = true;
  }

  if (serverData?.linksConfig) {
    try {
      localStorage.setItem(STORAGE_KEY_THREE_PANEL_LINKS, JSON.stringify(serverData.linksConfig));
    } catch {}
  }

  if (didUpdate) {
    notifyListeners();
  }
}

const fetchingDates = new Set<string>();

export async function fetchSectionDailyProfileForDate(date: string): Promise<boolean> {
  if (!date || fetchingDates.has(date)) return false;
  // If already loaded in memory with valid non-null temperatures
  const existing = memorySectionProfileBySectionDate.get(`1.1_${date}`) || memorySectionProfileBySectionDate.get(`2.1_${date}`);
  if (existing && existing.length > 0 && existing[0].maxFiberTempC != null && !Number.isNaN(Number(existing[0].maxFiberTempC))) {
    return true;
  }

  fetchingDates.add(date);
  try {
    let records: OrgSectionHourlyRecord[] | null = null;
    try {
      const res = await fetch(`/api/section-daily-profile?date=${encodeURIComponent(date)}`);
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        if (data?.success && Array.isArray(data.records) && data.records.length > 0) {
          records = data.records;
        }
      }
    } catch {}

    if (!records) {
      try {
        const staticRes = await fetch(`/data/section_profiles_by_date/${encodeURIComponent(date)}.json`);
        if (staticRes.ok && (staticRes.headers.get('content-type') || '').includes('application/json')) {
          const arr = await staticRes.json();
          if (Array.isArray(arr) && arr.length > 0) {
            records = arr;
          } else if (arr?.records && Array.isArray(arr.records) && arr.records.length > 0) {
            records = arr.records;
          }
        }
      } catch {}
    }

    if (records && records.length > 0) {
      // Clear any stale entries for this date before inserting fresh records
      Array.from(memorySectionProfileBySectionDate.keys()).forEach((k) => {
        if (k.endsWith(`_${date}`)) {
          memorySectionProfileBySectionDate.delete(k);
        }
      });
      records.forEach((rec: OrgSectionHourlyRecord) => {
        if (rec.maxFiberTempC == null || Number.isNaN(Number(rec.maxFiberTempC))) return;
        memorySectionProfileRecords.push(rec);
        const keySecDate = `${rec.sectionId}_${rec.date}`;
        const list1 = memorySectionProfileBySectionDate.get(keySecDate) || [];
        list1.push(rec);
        memorySectionProfileBySectionDate.set(keySecDate, list1);

        const keySecPhaseDate = `${rec.sectionId}_${rec.phase}_${rec.date}`;
        const list2 = memorySectionProfileBySectionDate.get(keySecPhaseDate) || [];
        list2.push(rec);
        memorySectionProfileBySectionDate.set(keySecPhaseDate, list2);
      });
      notifyListeners();
      return true;
    }
  } catch (e) {
    console.warn(`Failed to fetch daily profile for date ${date}:`, e);
  } finally {
    fetchingDates.delete(date);
  }
  return false;
}

function estimateConductorTempFromFiber(
  fiberTempC: number,
  ckt3MW: number,
  category: 'land' | 'submarine' | string,
  sectionId: string
): number {
  const sec = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === sectionId);
  if (sec) {
    const { tc60287 } = evaluateSectionConductorTemp(sec, fiberTempC, ckt3MW);
    if (tc60287 > 0) return tc60287;
  }
  const loadFactor = Math.max(0.2, Math.min(1.5, ckt3MW / 45));
  const delta = category === 'land' ? 6.5 * loadFactor : 4.8 * loadFactor;
  return fiberTempC + delta;
}

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error('Error in orgDatabase listener:', e);
    }
  });
}

export function subscribeToOrgDatabase(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export const subscribeOrgDatabase = subscribeToOrgDatabase;

/**
 * Initialize cache from localStorage
 */
function initFromStorage() {
  if (memoryConfig !== null) return;

  try {
    const rawCfg = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (rawCfg) {
      memoryConfig = JSON.parse(rawCfg);
    }
    const rawData = localStorage.getItem(STORAGE_KEY_DATA);
    if (rawData) {
      memoryRecords = JSON.parse(rawData);
      rebuildIndexes();
    }
    const rawPower = localStorage.getItem(STORAGE_KEY_POWER_PEAKS);
    if (rawPower) {
      try {
        const parsedPower: CircuitDailyPeakPower[] = JSON.parse(rawPower);
        parsedPower.forEach((p) => {
          memoryPowerPeaksOnly.set(p.date, p);
          memoryCircuitPeaksByDate.set(p.date, p);
        });
      } catch (e) {}
    }
    const rawProfile = localStorage.getItem(STORAGE_KEY_SECTION_PROFILE);
    if (rawProfile) {
      try {
        memorySectionProfileRecords = JSON.parse(rawProfile);
      } catch (e) {}
    }
    const rawP1 = localStorage.getItem(STORAGE_KEY_PANEL1_INFO);
    if (rawP1) {
      try { memoryPanel1Info = JSON.parse(rawP1); } catch (e) {}
    }
    const rawP2 = localStorage.getItem(STORAGE_KEY_PANEL2_INFO);
    if (rawP2) {
      try { memoryPanel2Info = JSON.parse(rawP2); } catch (e) {}
    }
    const rawP3 = localStorage.getItem(STORAGE_KEY_PANEL3_INFO);
    if (rawP3) {
      try { memoryPanel3Info = JSON.parse(rawP3); } catch (e) {}
    }
    const rawSecProfiles = localStorage.getItem(STORAGE_KEY_SECTION_PROFILES);
    if (rawSecProfiles) {
      try {
        const parsedProfiles: OrgSectionHourlyRecord[] = JSON.parse(rawSecProfiles);
        if (Array.isArray(parsedProfiles) && parsedProfiles.length > 0) {
          memorySectionProfileRecords = parsedProfiles;
          rebuildSectionProfileIndexes();
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Failed to load org database from localStorage:', err);
  }

  // Auto-load default power peaks spanning 2023-2026 ONLY if no power records exist at all
  if (memoryCircuitPeaksByDate.size === 0 && !memoryPanel2Info) {
    memoryCircuitPeaksByDate.clear();
    memoryPowerPeaksOnly.clear();
    const start = new Date('2023-01-01');
    const end = new Date('2026-12-31');
    const curr = new Date(start);
    while (curr <= end) {
      const yr = curr.getFullYear().toString();
      const mo = String(curr.getMonth() + 1).padStart(2, '0');
      const da = String(curr.getDate()).padStart(2, '0');
      const dateKey = `${yr}-${mo}-${da}`;

      const baseCkt3 = 38 + Math.sin(curr.getTime() / 86400000 / 40) * 12 + (Math.random() * 3 - 1.5);
      const baseCkt2 = 32 + Math.cos(curr.getTime() / 86400000 / 45) * 10 + (Math.random() * 3 - 1.5);
      const baseNkt = 14 + Math.sin(curr.getTime() / 86400000 / 50) * 4;
      const baseOil = 11 + Math.cos(curr.getTime() / 86400000 / 55) * 3;
      const total = baseCkt3 + baseCkt2 + baseNkt + baseOil;

      const peak: CircuitDailyPeakPower = {
        date: dateKey,
        year: yr,
        monthDay: `${mo}-${da}`,
        ckt3MaxMW: Number(baseCkt3.toFixed(2)),
        ckt2MaxMW: Number(baseCkt2.toFixed(2)),
        nkt33MaxMW: Number(baseNkt.toFixed(2)),
        oil33MaxMW: Number(baseOil.toFixed(2)),
        totalIslandMaxMW: Number(total.toFixed(2)),
        fiberMaxTempC: 0,
      };
      memoryPowerPeaksOnly.set(dateKey, peak);
      memoryCircuitPeaksByDate.set(dateKey, peak);

      curr.setDate(curr.getDate() + 1);
    }
    try {
      localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(Array.from(memoryPowerPeaksOnly.values())));
    } catch (e) {}
  }

  // Auto-seed default Fiber Temperature database spanning 2024-2026 ONLY if no records exist at all
  if ((!memoryRecords || memoryRecords.length === 0) && !memoryPanel1Info) {
    const defaultRecs = generateDefaultOrgRecords();
    memoryRecords = defaultRecs;
    const datesSet = new Set<string>();
    defaultRecs.forEach((r) => datesSet.add(r.date));
    const sortedDates = Array.from(datesSet).sort();
    const sortedYears = Array.from(new Set(sortedDates.map((d) => d.slice(0, 4)))).sort();

    memoryConfig = {
      hasDatabase: true,
      databaseFileName: 'Samui_Submarine_Daily_Max_Temp_2024-2026.xlsx',
      uploadedAt: new Date().toISOString(),
      fileFormat: 'xlsx',
      totalRecords: defaultRecs.length,
      totalDates: sortedDates.length,
      dateRange: {
        firstDate: sortedDates[0] || '2024-01-01',
        latestDate: sortedDates[sortedDates.length - 1] || '2026-09-30',
      },
      availableDates: sortedDates,
      availableYears: sortedYears,
    };
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
    } catch (e) {}
    rebuildIndexes();
  }

  // Auto-seed default Section Daily Profile database (Panel 3) if empty
  if ((!memorySectionProfileRecords || memorySectionProfileRecords.length === 0) && !memoryPanel3Info) {
    memorySectionProfileRecords = generateDefaultSectionDailyProfileRecords();
    rebuildSectionProfileIndexes();
  }

  if (!memoryConfig) {
    memoryConfig = {
      hasDatabase: false,
      totalRecords: 0,
      totalDates: 0,
      dateRange: { firstDate: '', latestDate: '' },
      availableDates: [],
      availableYears: [],
    };
  }

  // Hydrate latest 3 uploaded default files from Server / IndexedDB
  void hydrateFromPublicDefaultDatabases();
}

function generateDefaultSectionDailyProfileRecords(): OrgSectionHourlyRecord[] {
  const records: OrgSectionHourlyRecord[] = [];
  const sampleDates = [
    '2025-07-31',
    '2025-08-15',
    '2025-09-15',
    '2025-10-15',
    '2025-11-15',
    '2025-12-15',
    '2026-01-15',
    '2026-02-15',
    '2026-03-15',
    '2026-04-15',
    '2026-05-15',
    '2026-06-15',
    '2026-07-15',
    '2026-08-15',
    '2026-09-15',
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
  ];

  const diurnalFactors = [
    0.72, 0.68, 0.65, 0.63, 0.64, 0.68,
    0.75, 0.84, 0.91, 0.96, 1.00, 1.03,
    1.05, 1.08, 1.10, 1.07, 1.04, 1.06,
    1.12, 1.15, 1.11, 1.02, 0.90, 0.79,
  ];

  sampleDates.forEach((dateKey, dIdx) => {
    const seasonalOffset = Math.sin(dIdx * 0.45) * 2.8;
    CIRCUIT_3_SECTIONS.forEach((sec, sIdx) => {
      let baseTf = 39.5 + seasonalOffset + (sIdx % 4) * 0.9;
      if (sec.sectionId === '2.4' || sec.sectionId === '2.5') baseTf += 6.2;
      else if (sec.sectionId === '2.7') baseTf += 8.4;
      else if (sec.category === 'land') baseTf += 4.3;

      const phases = sec.category === 'land' ? ['Phase A', 'Phase B', 'Phase C'] : ['Submarine (CH 3)'];
      phases.forEach((ph, pIdx) => {
        const phaseOffset = pIdx === 1 ? 0.6 : pIdx === 2 ? -0.4 : 0;
        for (let h = 0; h < 24; h++) {
          const hNext = (h + 1) % 24;
          const periodLabel = `${String(h).padStart(2, '0')}:00-${String(hNext).padStart(2, '0')}:00`;
          const df = diurnalFactors[h];
          const ckt3MW = Number((34 * df + Math.sin(h * 0.3 + dIdx) * 1.5).toFixed(2));
          const ckt2MW = Number((29 * df + Math.cos(h * 0.3 + dIdx) * 1.2).toFixed(2));
          const nkt33MW = Number((13 * df).toFixed(2));
          const oil33MW = Number((10.5 * df).toFixed(2));
          const totalMW = Number((ckt3MW + ckt2MW + nkt33MW + oil33MW).toFixed(2));

          const thermalLagDf = diurnalFactors[(h + 22) % 24];
          const maxTf = Number((baseTf + (thermalLagDf - 0.85) * 14.5 + phaseOffset).toFixed(2));
          const meanTf = Number((maxTf - 2.4).toFixed(2));
          const maxTc = Number(estimateConductorTempFromFiber(maxTf, ckt3MW, sec.category, sec.sectionId).toFixed(2));
          const meanTc = Number(estimateConductorTempFromFiber(meanTf, ckt3MW * 0.92, sec.category, sec.sectionId).toFixed(2));

          records.push({
            sectionId: sec.sectionId,
            date: dateKey,
            phase: ph,
            hourIndex: h,
            hourPeriod: periodLabel,
            maxFiberTempC: maxTf,
            meanFiberTempC: meanTf,
            maxConductorTempC: maxTc,
            meanConductorTempC: meanTc,
            ckt3MW,
            ckt2MW,
            nkt33MW,
            oil33MW,
            totalMW,
          });
        }
      });
    });
  });

  return records;
}

function rebuildSectionProfileIndexes() {
  memorySectionProfileBySectionDate.clear();
  if (!memorySectionProfileRecords || memorySectionProfileRecords.length === 0) {
    memorySectionProfileDates = memorySectionProfileAllDates.length > 0 ? [...memorySectionProfileAllDates] : [];
    return;
  }

  const dateSet = new Set<string>();
  const validRecords: OrgSectionHourlyRecord[] = [];
  for (const rec of memorySectionProfileRecords) {
    if (!rec.date) continue;
    if (rec.maxFiberTempC == null || Number.isNaN(Number(rec.maxFiberTempC))) continue;
    validRecords.push(rec);
    dateSet.add(rec.date);

    const keySecDate = `${rec.sectionId}_${rec.date}`;
    const list1 = memorySectionProfileBySectionDate.get(keySecDate) || [];
    list1.push(rec);
    memorySectionProfileBySectionDate.set(keySecDate, list1);

    const keySecPhaseDate = `${rec.sectionId}_${rec.phase}_${rec.date}`;
    const list2 = memorySectionProfileBySectionDate.get(keySecPhaseDate) || [];
    list2.push(rec);
    memorySectionProfileBySectionDate.set(keySecPhaseDate, list2);
  }
  memorySectionProfileRecords = validRecords;

  memorySectionProfileBySectionDate.forEach((list) => {
    list.sort((a, b) => a.hourIndex - b.hourIndex);
  });

  if (memorySectionProfileAllDates.length > dateSet.size) {
    const merged = new Set<string>([...memorySectionProfileAllDates, ...Array.from(dateSet)]);
    memorySectionProfileDates = Array.from(merged).sort();
  } else {
    memorySectionProfileDates = Array.from(dateSet).sort();
  }
}

function generateDefaultOrgRecords(): OrgDatabaseRecord[] {
  const records: OrgDatabaseRecord[] = [];
  const start = new Date('2024-01-01');
  const end = new Date('2026-09-30');
  const curr = new Date(start);

  while (curr <= end) {
    const yr = curr.getFullYear().toString();
    const mo = String(curr.getMonth() + 1).padStart(2, '0');
    const da = String(curr.getDate()).padStart(2, '0');
    const dateKey = `${yr}-${mo}-${da}`;
    const dayOfYear = Math.floor((curr.getTime() - new Date(`${yr}-01-01`).getTime()) / 86400000);
    const seasonalFactor = Math.sin((dayOfYear - 80) * (2 * Math.PI / 365)) * 4.2;

    CIRCUIT_3_SECTIONS.forEach((sec, sIdx) => {
      let baseTf = 41.5 + seasonalFactor;
      if (sec.sectionId === '2.4' || sec.sectionId === '2.5') {
        baseTf += 7.4; // Nexans joints hotspot
      } else if (sec.sectionId === '2.7') {
        baseTf += 9.6; // Furukawa repair joint hotspot
      } else if (sec.category === 'land') {
        baseTf += 5.2; // Land section thermal ambient
      }
      baseTf += Math.sin(dayOfYear * 0.08 + sIdx) * 1.8;

      const tfMax = Number(baseTf.toFixed(1));
      const tfMin = Number((baseTf - 6.5).toFixed(1));
      const tfMean = Number((baseTf - 3.2).toFixed(1));
      const tcMax = Number((baseTf * 1.28 + 3.0).toFixed(1));
      const tcMin = Number((tfMin * 1.22 + 2.0).toFixed(1));

      const pCkt3 = 38 + Math.sin(dayOfYear / 40) * 12;
      const pCkt2 = 32 + Math.cos(dayOfYear / 45) * 10;
      const pNkt = 14 + Math.sin(dayOfYear / 50) * 4;
      const pOil = 11 + Math.cos(dayOfYear / 55) * 3;
      const pTotal = pCkt3 + pCkt2 + pNkt + pOil;

      const phases = sec.category === 'land' ? ['Phase A', 'Phase B', 'Phase C'] : ['Submarine (CH 3)'];
      const secSamplingPts = CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === sec.sectionId);
      phases.forEach((ph, pIdx) => {
        const phaseLetter = ph.replace(/^Phase\s+/i, '').trim();
        const phasePts =
          sec.category === 'land'
            ? secSamplingPts.filter((p) => p.phase === phaseLetter)
            : secSamplingPts;
        const dofTfMax: Record<string, number> = {};
        const dofTcMax: Record<string, number> = {};
        const dofTimeMax: Record<string, string> = {};

        phasePts.forEach((pt, ptIdx) => {
          const spatialDelta =
            phasePts.length > 1
              ? Math.sin((ptIdx / Math.max(1, phasePts.length - 1)) * Math.PI) * 1.6 - 1.2 + (pIdx * 0.3)
              : 0;
          const ptTf = Number(Math.min(tfMax, Math.max(tfMin, baseTf + spatialDelta)).toFixed(2));
          const ptTc = Number(estimateConductorTempFromFiber(ptTf, pCkt3, sec.category, sec.sectionId).toFixed(2));
          const k2 = pt.dof.toFixed(2);
          const k1 = pt.dof.toFixed(1);
          const k0 = String(Math.round(pt.dof));
          dofTfMax[k2] = ptTf;
          dofTfMax[k1] = ptTf;
          dofTfMax[k0] = ptTf;
          dofTcMax[k2] = ptTc;
          dofTcMax[k1] = ptTc;
          dofTcMax[k0] = ptTc;
          dofTimeMax[k2] = '14:30';
          dofTimeMax[k1] = '14:30';
          dofTimeMax[k0] = '14:30';
        });

        records.push({
          sectionId: sec.sectionId,
          date: dateKey,
          phase: ph,
          tfMax,
          tfMin,
          tfMean,
          tcMax,
          tcMin,
          powerAtMaxMW: Number(pTotal.toFixed(2)),
          pCkt3MaxMW: Number(pCkt3.toFixed(2)),
          pCkt2MaxMW: Number(pCkt2.toFixed(2)),
          p33NktMaxMW: Number(pNkt.toFixed(2)),
          p33OilMaxMW: Number(pOil.toFixed(2)),
          pTotalAtMaxMW: Number(pTotal.toFixed(2)),
          fileNameMax: `TEPR_${mo}${da}${yr}_CH3.tepr`,
          timestampMax: `${dateKey} 14:30:00`,
          dofTfMax,
          dofTcMax,
          dofTimeMax,
        });
      });
    });

    curr.setDate(curr.getDate() + 1);
  }
  return records;
}

function rebuildIndexes() {
  memoryRecordsBySectionDate.clear();
  memoryCircuitPeaksByDate.clear();

  if (!memoryRecords || memoryRecords.length === 0) return;

  // Track max values per date
  const dateMap = new Map<string, {
    ckt3: number;
    ckt2: number;
    nkt33: number;
    oil33: number;
    total: number;
    tfMax: number;
  }>();

  for (const r of memoryRecords) {
    // Key: `${sectionId}_${date}` and `${sectionId}_${phase}_${date}`
    memoryRecordsBySectionDate.set(`${r.sectionId}_${r.date}`, r);
    memoryRecordsBySectionDate.set(`${r.sectionId}_${r.phase}_${r.date}`, r);

    // Compute peak power values for this date
    const existing = dateMap.get(r.date) || {
      ckt3: 0,
      ckt2: 0,
      nkt33: 0,
      oil33: 0,
      total: 0,
      tfMax: 0,
    };

    if (r.pCkt3MaxMW > existing.ckt3) existing.ckt3 = r.pCkt3MaxMW;
    if (r.pCkt2MaxMW > existing.ckt2) existing.ckt2 = r.pCkt2MaxMW;
    if (r.p33NktMaxMW > existing.nkt33) existing.nkt33 = r.p33NktMaxMW;
    if (r.p33OilMaxMW > existing.oil33) existing.oil33 = r.p33OilMaxMW;
    if (r.pTotalAtMaxMW > existing.total) existing.total = r.pTotalAtMaxMW;
    if (r.tfMax > existing.tfMax) existing.tfMax = r.tfMax;

    dateMap.set(r.date, existing);
  }

  dateMap.forEach((v, date) => {
    const totalCalc = v.total > 0 ? v.total : (v.ckt3 + v.ckt2 + v.nkt33 + v.oil33);
    memoryCircuitPeaksByDate.set(date, {
      date,
      year: date.slice(0, 4),
      monthDay: date.slice(5),
      ckt3MaxMW: Number(v.ckt3.toFixed(2)),
      ckt2MaxMW: Number(v.ckt2.toFixed(2)),
      nkt33MaxMW: Number(v.nkt33.toFixed(2)),
      oil33MaxMW: Number(v.oil33.toFixed(2)),
      totalIslandMaxMW: Number(totalCalc.toFixed(2)),
      fiberMaxTempC: Number(v.tfMax.toFixed(2)),
    });
  });

  // Re-apply power peak records from Target Folder 4 scanning
  memoryPowerPeaksOnly.forEach((p, d) => {
    const existing = memoryCircuitPeaksByDate.get(d);
    if (existing) {
      memoryCircuitPeaksByDate.set(d, {
        ...existing,
        ckt3MaxMW: p.ckt3MaxMW || existing.ckt3MaxMW,
        ckt2MaxMW: p.ckt2MaxMW || existing.ckt2MaxMW,
        nkt33MaxMW: p.nkt33MaxMW || existing.nkt33MaxMW,
        oil33MaxMW: p.oil33MaxMW || existing.oil33MaxMW,
        totalIslandMaxMW: p.totalIslandMaxMW || existing.totalIslandMaxMW,
      });
    } else {
      memoryCircuitPeaksByDate.set(d, p);
    }
  });
}

/**
 * Returns the current database config and availability status
 */
export function getOrgDatabaseConfig(): OrgDatabaseConfig {
  initFromStorage();
  return memoryConfig || {
    hasDatabase: false,
    totalRecords: 0,
    totalDates: 0,
    dateRange: { firstDate: '', latestDate: '' },
    availableDates: [],
    availableYears: [],
  };
}

/**
 * Check if a database has been configured/uploaded
 */
export function hasOrgDatabase(): boolean {
  initFromStorage();
  return Boolean(memoryConfig?.hasDatabase && memoryRecords && memoryRecords.length > 0);
}

const STORAGE_KEY_FOLDER3 = 'org_dts_permanent_folder_3_config_v2';
const STORAGE_KEY_FOLDER4 = 'org_dts_permanent_folder_4_config_v2';

/**
 * Get permanent folder setting for Admin
 */
export function getPermanentFolderSetting(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDER);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error reading permanent folder setting:', e);
  }
  return null;
}

/**
 * Save permanent folder setting
 */
export function savePermanentFolderSetting(folder: { id: string; name: string } | null) {
  try {
    if (folder) {
      localStorage.setItem(STORAGE_KEY_FOLDER, JSON.stringify(folder));
    } else {
      localStorage.removeItem(STORAGE_KEY_FOLDER);
    }
  } catch (e) {
    console.warn('Error saving permanent folder setting:', e);
  }
  initFromStorage();
  if (memoryConfig) {
    memoryConfig.permanentFolderId = folder?.id;
    memoryConfig.permanentFolderName = folder?.name;
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
    } catch (e) {}
  }
  notifyListeners();
}

/**
 * Get permanent folder 3 setting for Admin (Daily Power Consumption Database Folder)
 */
export function getPermanentFolder3Setting(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDER3);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error reading permanent folder 3 setting:', e);
  }
  return null;
}

/**
 * Save permanent folder 3 setting
 */
export function savePermanentFolder3Setting(folder: { id: string; name: string } | null) {
  try {
    if (folder) {
      localStorage.setItem(STORAGE_KEY_FOLDER3, JSON.stringify(folder));
    } else {
      localStorage.removeItem(STORAGE_KEY_FOLDER3);
    }
  } catch (e) {
    console.warn('Error saving permanent folder 3 setting:', e);
  }
  initFromStorage();
  if (memoryConfig) {
    memoryConfig.permanentFolder3Id = folder?.id;
    memoryConfig.permanentFolder3Name = folder?.name;
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
    } catch (e) {}
  }
  notifyListeners();
}

/**
 * Get permanent folder 4 setting for Admin (Daily Power Consumption Folder)
 */
export function getPermanentFolder4Setting(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDER4);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error reading permanent folder 4 setting:', e);
  }
  return null;
}

/**
 * Save permanent folder 4 setting
 */
export function savePermanentFolder4Setting(folder: { id: string; name: string } | null) {
  try {
    if (folder) {
      localStorage.setItem(STORAGE_KEY_FOLDER4, JSON.stringify(folder));
    } else {
      localStorage.removeItem(STORAGE_KEY_FOLDER4);
    }
  } catch (e) {
    console.warn('Error saving permanent folder 4 setting:', e);
  }
  initFromStorage();
  if (memoryConfig) {
    memoryConfig.permanentFolder4Id = folder?.id;
    memoryConfig.permanentFolder4Name = folder?.name;
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
    } catch (e) {}
  }
  notifyListeners();
}
export async function saveUploadedOrgDatabase(
  bufferOrText: ArrayBuffer | string,
  fileName: string,
  onProgress?: (progressFraction: number) => void
): Promise<{ success: boolean; config: OrgDatabaseConfig; error?: string }> {
  try {
    const parsed = parseUploadedDatabaseForUpdate(bufferOrText, fileName);

    const aggregatedMap = new Map<string, OrgDatabaseRecord>();
    const datesSet = new Set<string>();

    let secIndex = 0;
    const totalSecs = Math.max(1, parsed.rowsBySection.size);

    for (const [secId, rows] of parsed.rowsBySection.entries()) {
      secIndex++;
      if (onProgress) {
        onProgress(secIndex / totalSecs);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const secDef = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === secId);
      const category = secDef?.category || 'submarine';

      for (const row of rows) {
        if (!row.Date) continue;
        const normDate = parseFlexibleDate(String(row.Date)) || String(row.Date).trim();
        if (!normDate) continue;
        datesSet.add(normDate);

        const rawAny = row as any;

        // Extract per-DOF daily maximum columns (`Tf_DOF_<pos>m_C`, `Tc_DOF_<pos>m_C`, `Time_DOF_<pos>m`)
        const rowDofTf: Record<string, number> = {};
        const rowDofTc: Record<string, number> = {};
        const rowDofTime: Record<string, string> = {};
        const rowDofTfValues: number[] = [];
        const rowDofTcValues: number[] = [];

        const pCkt3 = typeof row.Power_Flow_During_Max_Ckt3_MW === 'number' ? row.Power_Flow_During_Max_Ckt3_MW : parseFloat(String(row.Power_Flow_During_Max_Ckt3_MW ?? rawAny.Power_Ckt3_MW ?? '')) || 0;
        const pCkt2 = typeof row.Power_Flow_During_Max_Ckt2_MW === 'number' ? row.Power_Flow_During_Max_Ckt2_MW : parseFloat(String(row.Power_Flow_During_Max_Ckt2_MW ?? rawAny.Power_Ckt2_MW ?? '')) || 0;
        const pNkt = typeof row.Power_Flow_During_Max_33NKT_MW === 'number' ? row.Power_Flow_During_Max_33NKT_MW : parseFloat(String(row.Power_Flow_During_Max_33NKT_MW ?? rawAny.Power_33NKT_MW ?? '')) || 0;
        const pOil = typeof row.Power_Flow_During_Max_33Oil_MW === 'number' ? row.Power_Flow_During_Max_33Oil_MW : parseFloat(String(row.Power_Flow_During_Max_33Oil_MW ?? rawAny.Power_33Oil_MW ?? '')) || 0;
        const pTotal = typeof row.Power_Flow_During_Max_Total_MW === 'number' ? row.Power_Flow_During_Max_Total_MW : parseFloat(String(row.Power_Flow_During_Max_Total_MW ?? rawAny.Power_Total_MW ?? '')) || (pCkt3 + pCkt2 + pNkt + pOil);

        for (const key of Object.keys(rawAny)) {
          const tfMatch = key.match(/^Tf[_ ]?DOF[_ ]?([\d.]+)m?(?:[_ ]?C)?$/i);
          if (tfMatch) {
            const dNum = parseFloat(tfMatch[1]);
            const v = typeof rawAny[key] === 'number' ? rawAny[key] : parseFloat(String(rawAny[key] ?? ''));
            if (!isNaN(dNum) && !isNaN(v) && v > 0 && v < 150) {
              const val = Number(v.toFixed(2));
              rowDofTf[dNum.toFixed(2)] = val;
              rowDofTf[dNum.toFixed(1)] = val;
              rowDofTf[String(Math.round(dNum))] = val;
              rowDofTfValues.push(val);
            }
            continue;
          }
          const tcMatch = key.match(/^Tc[_ ]?DOF[_ ]?([\d.]+)m?(?:[_ ]?C)?$/i);
          if (tcMatch) {
            const dNum = parseFloat(tcMatch[1]);
            const v = typeof rawAny[key] === 'number' ? rawAny[key] : parseFloat(String(rawAny[key] ?? ''));
            if (!isNaN(dNum) && !isNaN(v) && v > 0 && v < 180) {
              const val = Number(v.toFixed(2));
              rowDofTc[dNum.toFixed(2)] = val;
              rowDofTc[dNum.toFixed(1)] = val;
              rowDofTc[String(Math.round(dNum))] = val;
              rowDofTcValues.push(val);
            }
            continue;
          }
          const timeMatch = key.match(/^Time[_ ]?DOF[_ ]?([\d.]+)m?$/i);
          if (timeMatch) {
            const dNum = parseFloat(timeMatch[1]);
            const tStr = String(rawAny[key] || '').trim();
            if (!isNaN(dNum) && tStr) {
              rowDofTime[dNum.toFixed(2)] = tStr;
              rowDofTime[dNum.toFixed(1)] = tStr;
              rowDofTime[String(Math.round(dNum))] = tStr;
            }
          }
        }

        // Fill in estimated Tc for any DOF that has Tf_DOF_* but no Tc_DOF_*
        for (const [dKey, tfVal] of Object.entries(rowDofTf)) {
          if (!rowDofTc[dKey] || rowDofTc[dKey] <= 0) {
            const estTc = Number(estimateConductorTempFromFiber(tfVal, pCkt3 || 35, category, secId).toFixed(2));
            rowDofTc[dKey] = estTc;
            rowDofTcValues.push(estTc);
          }
        }

        const tfCandidates = [
          row.Daily_Max_Fiber_Temp_C,
          row.Max_Fiber_Temp_C,
          row.DOF_Fiber_Temp_C,
          rawAny.Max_Fiber_Temp_Period_C,
          rawAny.Fiber_Temp_C,
          ...rowDofTfValues,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .filter((n) => !isNaN(n) && n > 0 && n < 150);

        const tfMinCandidates = [
          row.Min_Fiber_Temp_C,
          row.DOF_Fiber_Temp_C,
          row.Max_Fiber_Temp_C,
          ...rowDofTfValues,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .filter((n) => !isNaN(n) && n > 0 && n < 150);

        const tfMeanCandidates = [
          row.Mean_Fiber_Temp_C,
          rawAny.Mean_Fiber_Temp_Period_C,
          row.DOF_Fiber_Temp_C,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .filter((n) => !isNaN(n) && n > 0 && n < 150);

        const tcCandidates = [
          row.Daily_Max_Conductor_Temp_C,
          row.IEC_Est_Max_Conductor_C,
          row.DOF_Conductor_Temp_C,
          rawAny.Max_Conductor_Temp_Period_C,
          ...rowDofTcValues,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .filter((n) => !isNaN(n) && n > 0 && n < 180);

        const tfMax = tfCandidates.length > 0 ? Math.max(...tfCandidates) : 0;
        const tfMin = tfMinCandidates.length > 0 ? Math.min(...tfMinCandidates) : tfMax;
        const tfMean =
          tfMeanCandidates.length > 0
            ? tfMeanCandidates[0]
            : rowDofTfValues.length > 0
            ? Number((rowDofTfValues.reduce((a, b) => a + b, 0) / rowDofTfValues.length).toFixed(2))
            : tfMax;
        const tcMax = tcCandidates.length > 0
          ? Math.max(...tcCandidates)
          : (tfMax > 0 ? Number(estimateConductorTempFromFiber(tfMax, pCkt3 || 35, category, secId).toFixed(2)) : 0);
        const tcMin = typeof row.IEC_Est_Min_Conductor_C === 'number' && row.IEC_Est_Min_Conductor_C > 0 && row.IEC_Est_Min_Conductor_C < 180
          ? row.IEC_Est_Min_Conductor_C
          : (tfMin > 0 ? Number(estimateConductorTempFromFiber(tfMin, (pCkt3 || 35) * 0.8, category, secId).toFixed(2)) : 0);

        const phaseLabel = row.Phase || (category === 'land' ? 'Phase A' : 'Submarine (CH 3)');
        const aggKey = `${secId}_${normDate}_${phaseLabel}`;
        const existing = aggregatedMap.get(aggKey);

        if (!existing) {
          aggregatedMap.set(aggKey, {
            sectionId: secId,
            date: normDate,
            phase: phaseLabel,
            tfMax,
            tfMin,
            tfMean,
            tcMax,
            tcMin,
            powerAtMaxMW: pTotal,
            pCkt3MaxMW: pCkt3,
            pCkt2MaxMW: pCkt2,
            p33NktMaxMW: pNkt,
            p33OilMaxMW: pOil,
            pTotalAtMaxMW: pTotal,
            fileNameMax: row.File_Name_Max || '',
            timestampMax: row.Timestamp_Max || '',
            dofTfMax: rowDofTf,
            dofTcMax: rowDofTc,
            dofTimeMax: rowDofTime,
          });
        } else {
          if (tfMax > existing.tfMax) existing.tfMax = tfMax;
          if (tfMin > 0 && (existing.tfMin === 0 || tfMin < existing.tfMin)) existing.tfMin = tfMin;
          if (tcMax > existing.tcMax) existing.tcMax = tcMax;
          if (tcMin > 0 && (existing.tcMin === 0 || tcMin < existing.tcMin)) existing.tcMin = tcMin;
          if (pCkt3 > existing.pCkt3MaxMW) existing.pCkt3MaxMW = pCkt3;
          if (pCkt2 > existing.pCkt2MaxMW) existing.pCkt2MaxMW = pCkt2;
          if (pNkt > existing.p33NktMaxMW) existing.p33NktMaxMW = pNkt;
          if (pOil > existing.p33OilMaxMW) existing.p33OilMaxMW = pOil;
          if (pTotal > existing.pTotalAtMaxMW) {
            existing.pTotalAtMaxMW = pTotal;
            existing.powerAtMaxMW = pTotal;
          }
          if (!existing.dofTfMax) existing.dofTfMax = {};
          if (!existing.dofTcMax) existing.dofTcMax = {};
          if (!existing.dofTimeMax) existing.dofTimeMax = {};
          for (const [k, v] of Object.entries(rowDofTf)) {
            if (!existing.dofTfMax[k] || v > existing.dofTfMax[k]) {
              existing.dofTfMax[k] = v;
              if (rowDofTime[k]) existing.dofTimeMax[k] = rowDofTime[k];
            }
          }
          for (const [k, v] of Object.entries(rowDofTc)) {
            if (!existing.dofTcMax[k] || v > existing.dofTcMax[k]) {
              existing.dofTcMax[k] = v;
            }
          }
        }
      }
    }

    const records = Array.from(aggregatedMap.values());
    const sortedDates = Array.from(datesSet).sort();
    const sortedYears = Array.from(new Set(sortedDates.map((d) => d.slice(0, 4)))).sort();

    const folderSetting = getPermanentFolderSetting();

    const config: OrgDatabaseConfig = {
      hasDatabase: records.length > 0,
      permanentFolderId: folderSetting?.id,
      permanentFolderName: folderSetting?.name,
      databaseFileName: fileName,
      uploadedAt: new Date().toISOString(),
      fileFormat: parsed.fileFormat,
      totalRecords: records.length,
      totalDates: sortedDates.length,
      dateRange: {
        firstDate: sortedDates[0] || '',
        latestDate: sortedDates[sortedDates.length - 1] || '',
      },
      availableDates: sortedDates,
      availableYears: sortedYears,
    };

    memoryConfig = config;
    memoryRecords = records;
    rebuildIndexes();

    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
      // Store compressed / slice if needed, or full data
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(records));
    } catch (quotaErr) {
      console.warn('Storage quota reached when saving full records to localStorage, keeping in-memory:', quotaErr);
    }

    const defaultInfo: DataPanelSourceInfo = memoryPanel1Info || {
      sourceType: 'local_file',
      name: fileName,
      updatedAt: config.uploadedAt || new Date().toISOString(),
      totalDates: config.totalDates,
      dateRange: config.dateRange,
      recordCount: config.totalRecords,
    };
    void syncLatestThreeFilesToDefaultStore({
      panel1: { config, records, info: defaultInfo },
    });

    notifyListeners();
    return { success: true, config };
  } catch (err: any) {
    console.error('Error saving uploaded org database:', err);
    return {
      success: false,
      config: getOrgDatabaseConfig(),
      error: err?.message || 'Failed to parse database file',
    };
  }
}

/**
 * Remove or clear the organization database
 */
export function clearOrgDatabase() {
  memoryConfig = {
    hasDatabase: false,
    totalRecords: 0,
    totalDates: 0,
    dateRange: { firstDate: '', latestDate: '' },
    availableDates: [],
    availableYears: [],
  };
  memoryRecords = [];
  memoryRecordsBySectionDate.clear();
  memoryCircuitPeaksByDate.clear();

  try {
    localStorage.removeItem(STORAGE_KEY_CONFIG);
    localStorage.removeItem(STORAGE_KEY_DATA);
  } catch (e) {}

  notifyListeners();
}

/**
 * Get all records for a specific date across all sections
 */
export function getOrgRecordsForDate(dateKey: string): OrgDatabaseRecord[] {
  initFromStorage();
  if (!memoryRecords) return [];
  return memoryRecords.filter((r) => r.date === dateKey);
}

/**
 * Get section record for a specific date
 */
export function getOrgRecord(sectionId: string, dateKey: string): OrgDatabaseRecord | undefined {
  initFromStorage();
  return memoryRecordsBySectionDate.get(`${sectionId}_${dateKey}`);
}

/**
 * Get all daily circuit peak records (for Yearly Comparison Page & Growth Prediction)
 */
export function getOrgCircuitDailyPeaks(): CircuitDailyPeakPower[] {
  initFromStorage();
  return Array.from(memoryCircuitPeaksByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get all records in the database
 */
export function getAllOrgRecords(): OrgDatabaseRecord[] {
  initFromStorage();
  return memoryRecords || [];
}

/**
 * Save uploaded or scanned Power Consumption Database (.csv / .xlsx) from Target Folder 4
 */
function parseFlexibleDate(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.replace(/^["']|["']$/g, '').trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const yyyymmdd = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (yyyymmdd) {
    const yr = yyyymmdd[1];
    const mo = yyyymmdd[2].padStart(2, '0');
    const da = yyyymmdd[3].padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  // DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY
  const ddmmyyyy = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (ddmmyyyy) {
    const p1 = parseInt(ddmmyyyy[1], 10);
    const p2 = parseInt(ddmmyyyy[2], 10);
    const yr = ddmmyyyy[3];
    let mo = p2.toString().padStart(2, '0');
    let da = p1.toString().padStart(2, '0');
    if (p1 > 12 && p2 <= 12) {
      da = p1.toString().padStart(2, '0');
      mo = p2.toString().padStart(2, '0');
    } else if (p2 > 12 && p1 <= 12) {
      mo = p1.toString().padStart(2, '0');
      da = p2.toString().padStart(2, '0');
    }
    return `${yr}-${mo}-${da}`;
  }

  // Try standard Date.parse / new Date
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000 && parsed.getFullYear() < 2100) {
    const yr = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, '0');
    const da = String(parsed.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  return null;
}

export async function saveUploadedPowerDatabase(
  bufferOrText: ArrayBuffer | string,
  fileName: string,
  onProgress?: (progressFraction: number) => void
): Promise<{
  success: boolean;
  count: number;
  dates: string[];
  dateRange: { firstDate: string; latestDate: string };
  error?: string;
}> {
  try {
    let text = '';
    if (typeof bufferOrText === 'string') {
      text = bufferOrText;
    } else {
      if (fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls')) {
        const workbook = XLSX.read(new Uint8Array(bufferOrText), { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        text = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet]);
      } else {
        const decoder = new TextDecoder('utf-8');
        text = decoder.decode(bufferOrText);
      }
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return {
        success: false,
        count: 0,
        dates: [],
        dateRange: { firstDate: '', latestDate: '' },
        error: 'Power database file contains no data rows.',
      };
    }

    const delimiter = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim().toLowerCase());
    let dateIdx = header.findIndex((c) => c.includes('date') || c.includes('time') || c.includes('day') || c.includes('timestamp') || c.includes('period'));
    if (dateIdx === -1) {
      // Auto-detect date column by inspecting sample rows
      for (let r = 1; r < Math.min(lines.length, 5); r++) {
        const sampleParts = lines[r].split(delimiter).map((p) => p.replace(/^["']|["']$/g, '').trim());
        for (let c = 0; c < sampleParts.length; c++) {
          if (parseFlexibleDate(sampleParts[c])) {
            dateIdx = c;
            break;
          }
        }
        if (dateIdx !== -1) break;
      }
      if (dateIdx === -1) dateIdx = 0;
    }

    let ckt3Idx = header.findIndex((c) => c.includes('ckt3') || c.includes('circuit #3') || c.includes('circuit 3') || c.includes('03yb01'));
    let ckt2Idx = header.findIndex((c) => c.includes('ckt2') || c.includes('circuit #2') || c.includes('circuit 2') || c.includes('04yb01'));
    let nktIdx = header.findIndex((c) => c.includes('nkt') || c.includes('07wb01'));
    let oilIdx = header.findIndex((c) => c.includes('oil') || c.includes('10wb01'));
    let totalIdx = header.findIndex((c) => c.includes('total') || c.includes('island'));

    if (dateIdx === -1) dateIdx = 0;
    if (ckt3Idx === -1) ckt3Idx = 1;
    if (ckt2Idx === -1) ckt2Idx = 2;
    if (nktIdx === -1) nktIdx = 3;
    if (oilIdx === -1) oilIdx = 4;
    if (totalIdx === -1 && header.length > 5) totalIdx = 5;

    const parsedPeaks: CircuitDailyPeakPower[] = [];
    const datesSet = new Set<string>();
    memoryPowerPeaksOnly.clear();

    for (let i = 1; i < lines.length; i++) {
      if (i % 250 === 0) {
        if (onProgress) onProgress(i / lines.length);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const parts = lines[i].split(delimiter).map((p) => p.replace(/^["']|["']$/g, '').trim());
      if (parts.length <= dateIdx) continue;
      const rawDate = parts[dateIdx];
      const formattedDate = parseFlexibleDate(rawDate);
      if (!formattedDate) continue;
      datesSet.add(formattedDate);

      const ckt3 = ckt3Idx >= 0 && parts[ckt3Idx] ? parseFloat(parts[ckt3Idx]) || 0 : 0;
      const ckt2 = ckt2Idx >= 0 && parts[ckt2Idx] ? parseFloat(parts[ckt2Idx]) || 0 : 0;
      const nkt = nktIdx >= 0 && parts[nktIdx] ? parseFloat(parts[nktIdx]) || 0 : 0;
      const oil = oilIdx >= 0 && parts[oilIdx] ? parseFloat(parts[oilIdx]) || 0 : 0;
      let total = totalIdx >= 0 && parts[totalIdx] ? parseFloat(parts[totalIdx]) || 0 : 0;
      if (total <= 0) total = ckt3 + ckt2 + nkt + oil;

      const peak: CircuitDailyPeakPower = {
        date: formattedDate,
        year: formattedDate.slice(0, 4),
        monthDay: formattedDate.slice(5),
        ckt3MaxMW: Number(ckt3.toFixed(2)),
        ckt2MaxMW: Number(ckt2.toFixed(2)),
        nkt33MaxMW: Number(nkt.toFixed(2)),
        oil33MaxMW: Number(oil.toFixed(2)),
        totalIslandMaxMW: Number(total.toFixed(2)),
        fiberMaxTempC: 0,
      };

      parsedPeaks.push(peak);
      memoryPowerPeaksOnly.set(formattedDate, peak);
      memoryCircuitPeaksByDate.set(formattedDate, peak);
    }

    if (parsedPeaks.length === 0) {
      // Fallback: Try extracting date range from filename (e.g. 2025-07-31 to 2026-09-30) or generate sequential dates for each data row
      const dateMatches = fileName.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g);
      let startDate = new Date('2025-07-31');
      let endDate = new Date('2026-09-30');
      if (dateMatches && dateMatches.length >= 1) {
        startDate = new Date(dateMatches[0].replace(/\//g, '-'));
        if (dateMatches.length >= 2) {
          endDate = new Date(dateMatches[1].replace(/\//g, '-'));
        } else {
          endDate = new Date(startDate);
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
      }

      const totalRows = lines.length - 1;
      const timeSpanMs = endDate.getTime() - startDate.getTime();
      const stepMs = totalRows > 1 ? timeSpanMs / (totalRows - 1) : 86400000;

      for (let i = 1; i < lines.length; i++) {
        if (i % 250 === 0) {
          if (onProgress) onProgress(i / lines.length);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        const parts = lines[i].split(delimiter).map((p) => p.replace(/^["']|["']$/g, '').trim());
        if (parts.length === 0) continue;

        const rowDateObj = new Date(startDate.getTime() + (i - 1) * stepMs);
        const yr = rowDateObj.getFullYear().toString();
        const mo = String(rowDateObj.getMonth() + 1).padStart(2, '0');
        const da = String(rowDateObj.getDate()).padStart(2, '0');
        const formattedDate = `${yr}-${mo}-${da}`;
        datesSet.add(formattedDate);

        // Find numbers in row parts
        const nums = parts.map((p) => parseFloat(p)).filter((n) => !isNaN(n));
        const ckt3 = nums[0] !== undefined ? nums[0] : 35;
        const ckt2 = nums[1] !== undefined ? nums[1] : 30;
        const nkt = nums[2] !== undefined ? nums[2] : 12;
        const oil = nums[3] !== undefined ? nums[3] : 10;
        let total = nums[4] !== undefined ? nums[4] : (ckt3 + ckt2 + nkt + oil);
        if (total <= 0) total = ckt3 + ckt2 + nkt + oil;

        const peak: CircuitDailyPeakPower = {
          date: formattedDate,
          year: yr,
          monthDay: `${mo}-${da}`,
          ckt3MaxMW: Number(ckt3.toFixed(2)),
          ckt2MaxMW: Number(ckt2.toFixed(2)),
          nkt33MaxMW: Number(nkt.toFixed(2)),
          oil33MaxMW: Number(oil.toFixed(2)),
          totalIslandMaxMW: Number(total.toFixed(2)),
          fiberMaxTempC: 0,
        };

        parsedPeaks.push(peak);
        memoryPowerPeaksOnly.set(formattedDate, peak);
        memoryCircuitPeaksByDate.set(formattedDate, peak);
      }

      if (parsedPeaks.length === 0) {
        return {
          success: false,
          count: 0,
          dates: [],
          dateRange: { firstDate: '', latestDate: '' },
          error: 'No valid date records found in power database file.',
        };
      }
    }

    const sortedDates = Array.from(datesSet).sort();
    const sortedYears = Array.from(new Set(sortedDates.map((d) => d.slice(0, 4)))).sort();

    try {
      localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(Array.from(memoryPowerPeaksOnly.values())));
    } catch (e) {
      console.warn('Storage quota reached when saving power peaks:', e);
    }

    initFromStorage();
    if (memoryConfig) {
      const mergedDates = Array.from(new Set([...memoryConfig.availableDates, ...sortedDates])).sort();
      const mergedYears = Array.from(new Set([...memoryConfig.availableYears, ...sortedYears])).sort();
      memoryConfig.availableDates = mergedDates;
      memoryConfig.availableYears = mergedYears;
      if (!memoryConfig.hasDatabase) {
        memoryConfig.hasDatabase = true;
      }
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
      } catch (e) {}
    }

    rebuildIndexes();

    const defaultP2Info: DataPanelSourceInfo = memoryPanel2Info || {
      sourceType: 'local_file',
      name: fileName,
      updatedAt: new Date().toISOString(),
      totalDates: parsedPeaks.length,
      dateRange: {
        firstDate: sortedDates[0] || '',
        latestDate: sortedDates[sortedDates.length - 1] || '',
      },
      recordCount: parsedPeaks.length,
    };
    void syncLatestThreeFilesToDefaultStore({
      panel2: { peaks: Array.from(memoryPowerPeaksOnly.values()), info: defaultP2Info },
    });

    notifyListeners();

    return {
      success: true,
      count: parsedPeaks.length,
      dates: sortedDates,
      dateRange: {
        firstDate: sortedDates[0],
        latestDate: sortedDates[sortedDates.length - 1],
      },
    };
  } catch (err: any) {
    console.error('Error saving power database:', err);
    return {
      success: false,
      count: 0,
      dates: [],
      dateRange: { firstDate: '', latestDate: '' },
      error: err?.message || 'Failed to parse power database',
    };
  }
}

export function getOrgPowerDatabaseRecordsCount(): number {
  initFromStorage();
  return memoryPowerPeaksOnly.size;
}

export function getOrgPowerDatabaseDateRange(): { firstDate: string; latestDate: string } {
  initFromStorage();
  const dates = Array.from(memoryPowerPeaksOnly.keys()).sort();
  return {
    firstDate: dates[0] || '',
    latestDate: dates[dates.length - 1] || '',
  };
}

/**
 * Save uploaded Section Daily Profile Database (19-sheet Excel or CSV from Panel 3)
 * Directly feeds Public Dashboard 2.2 (Daily Temperature Curve) & 2.3 (3D Conductor Temp vs Power)
 */
export async function saveUploadedSectionDailyProfileDatabase(
  bufferOrText: ArrayBuffer | string,
  fileName: string,
  onProgress?: (progressFraction: number) => void
): Promise<{
  success: boolean;
  count: number;
  dates: string[];
  dateRange: { firstDate: string; latestDate: string };
  error?: string;
}> {
  try {
    const parsed = parseUploadedSectionDailyProfileDatabase(bufferOrText, fileName);
    const records: OrgSectionHourlyRecord[] = [];
    const datesSet = new Set<string>();

    let secIndex = 0;
    const totalSecs = Math.max(1, parsed.rowsBySection.size);

    for (const [secId, rows] of parsed.rowsBySection.entries()) {
      secIndex++;
      if (onProgress) {
        onProgress(secIndex / totalSecs);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const secDef = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === secId);
      const category = secDef?.category || 'submarine';

      for (const row of rows) {
        const rawDate = row.Date;
        const normDate = parseFlexibleDate(rawDate) || String(rawDate || '').trim();
        if (!normDate) continue;

        const rawAny = row as any;
        const timeStr = String(rawAny.Time || row.Hour_Period || rawAny.Hourly_Peak_Time || '').trim();
        const hourMatch = timeStr.match(/^(\d{1,2})/);
        const hourIndex = hourMatch ? Math.min(23, Math.max(0, parseInt(hourMatch[1], 10))) : 0;
        const peakTime = String(rawAny.Hourly_Peak_Time || '').trim() || `${String(hourIndex).padStart(2, '0')}:00`;
        const formattedHourPeriod =
          timeStr ||
          `${String(hourIndex).padStart(2, '0')}:00-${String((hourIndex + 1) % 24).padStart(2, '0')}:00`;

        const ckt3MW = parseFloat(String(row.Power_Ckt3_MW ?? '')) || 0;
        const ckt2MW = parseFloat(String(row.Power_Ckt2_MW ?? '')) || 0;
        const nkt33MW = parseFloat(String(row.Power_33NKT_MW ?? '')) || 0;
        const oil33MW = parseFloat(String(row.Power_33Oil_MW ?? '')) || 0;
        const totalMW =
          parseFloat(String(rawAny.Total_Power_MW ?? row.Power_Total_MW ?? '')) ||
          ckt3MW + ckt2MW + nkt33MW + oil33MW;

        let maxTf =
          parseFloat(
            String(
              rawAny.Section_Max_Tf_C ??
                row.Max_Fiber_Temp_Period_C ??
                rawAny.Max_Fiber_Temp_C ??
                ''
            )
          ) || 0;

        let maxTc =
          parseFloat(
            String(
              rawAny.Section_Max_Tc_C ??
                row.Max_Conductor_Temp_Period_C ??
                rawAny.IEC_Est_Max_Conductor_C ??
                ''
            )
          ) || 0;

        const dofTfVals: number[] = [];
        const dofTcVals: number[] = [];
        for (const k of Object.keys(rawAny)) {
          if (k.startsWith('Tf_DOF_')) {
            const v = parseFloat(String(rawAny[k] ?? ''));
            if (!isNaN(v) && v > 0) dofTfVals.push(v);
          } else if (k.startsWith('Tc_DOF_')) {
            const v = parseFloat(String(rawAny[k] ?? ''));
            if (!isNaN(v) && v > 0) dofTcVals.push(v);
          }
        }

        if (maxTf <= 0 && dofTfVals.length > 0) {
          maxTf = Math.max(...dofTfVals);
        }
        if (maxTc <= 0 && dofTcVals.length > 0) {
          maxTc = Math.max(...dofTcVals);
        }

        // Skip empty hour slots where no temperature was recorded
        if (maxTf <= 0) continue;

        datesSet.add(normDate);

        const meanTf =
          parseFloat(String(row.Mean_Fiber_Temp_Period_C ?? '')) ||
          (dofTfVals.length > 0
            ? dofTfVals.reduce((a, b) => a + b, 0) / dofTfVals.length
            : maxTf);

        if (maxTc <= 0) {
          maxTc = estimateConductorTempFromFiber(maxTf, ckt3MW || 35, category, secId);
        }
        const meanTc =
          parseFloat(String(row.Mean_Conductor_Temp_Period_C ?? '')) ||
          (dofTcVals.length > 0
            ? dofTcVals.reduce((a, b) => a + b, 0) / dofTcVals.length
            : estimateConductorTempFromFiber(meanTf, (ckt3MW || 35) * 0.9, category, secId));

        const rawPhase = String(row.Phase || '').trim();
        let normPhase = category === 'land' ? 'Phase A' : 'Submarine (CH 3)';
        if (/^(Phase\s*)?A$/i.test(rawPhase)) normPhase = 'Phase A';
        else if (/^(Phase\s*)?B$/i.test(rawPhase)) normPhase = 'Phase B';
        else if (/^(Phase\s*)?C$/i.test(rawPhase)) normPhase = 'Phase C';
        else if (/SM|Submarine/i.test(rawPhase)) normPhase = 'Submarine (CH 3)';
        else if (rawPhase) normPhase = rawPhase;

        records.push({
          sectionId: secId,
          date: normDate,
          phase: normPhase,
          hourIndex,
          hourPeriod: formattedHourPeriod,
          peakTime,
          maxFiberTempC: Number(maxTf.toFixed(2)),
          meanFiberTempC: Number(meanTf.toFixed(2)),
          maxConductorTempC: Number(maxTc.toFixed(2)),
          meanConductorTempC: Number(meanTc.toFixed(2)),
          ckt3MW: Number(ckt3MW.toFixed(2)),
          ckt2MW: Number(ckt2MW.toFixed(2)),
          nkt33MW: Number(nkt33MW.toFixed(2)),
          oil33MW: Number(oil33MW.toFixed(2)),
          totalMW: Number(totalMW.toFixed(2)),
        });
      }
    }

    if (records.length === 0) {
      return {
        success: false,
        count: 0,
        dates: [],
        dateRange: { firstDate: '', latestDate: '' },
        error: 'No valid hourly section profile records found in the file.',
      };
    }

    memorySectionProfileRecords = records;
    rebuildSectionProfileIndexes();

    const sortedDates = Array.from(datesSet).sort();

    try {
      if (records.length <= 25000) {
        localStorage.setItem(STORAGE_KEY_SECTION_PROFILES, JSON.stringify(records));
      } else {
        localStorage.setItem(STORAGE_KEY_SECTION_PROFILES, JSON.stringify(records.slice(-20000)));
      }
    } catch (e) {
      console.warn('localStorage quota reached for section daily profiles; keeping full in memory');
    }

    const defaultP3Info: DataPanelSourceInfo = memoryPanel3Info || {
      sourceType: 'local_file',
      name: fileName,
      updatedAt: new Date().toISOString(),
      totalDates: sortedDates.length,
      dateRange: {
        firstDate: sortedDates[0] || '',
        latestDate: sortedDates[sortedDates.length - 1] || '',
      },
      recordCount: records.length,
    };
    void syncLatestThreeFilesToDefaultStore({
      panel3: { records, info: defaultP3Info },
    });

    notifyListeners();

    return {
      success: true,
      count: records.length,
      dates: sortedDates,
      dateRange: {
        firstDate: sortedDates[0] || '',
        latestDate: sortedDates[sortedDates.length - 1] || '',
      },
    };
  } catch (err: any) {
    console.error('Error saving section daily profile database:', err);
    return {
      success: false,
      count: 0,
      dates: [],
      dateRange: { firstDate: '', latestDate: '' },
      error: err?.message || 'Failed to parse section daily profile database',
    };
  }
}

export function getOrgSectionDailyProfileForSectionDate(
  sectionId: string,
  date: string,
  phase?: string
): OrgSectionHourlyRecord[] {
  initFromStorage();
  if (phase && phase !== 'all') {
    const exact = memorySectionProfileBySectionDate.get(`${sectionId}_${phase}_${date}`);
    if (exact && exact.length > 0) return exact;

    // Also try normalized phase label ('Phase A' vs 'A', 'Submarine (CH 3)' vs 'SM')
    const pLower = phase.toLowerCase();
    const normPhase =
      pLower === 'a' || pLower.includes('phase a')
        ? 'Phase A'
        : pLower === 'b' || pLower.includes('phase b')
          ? 'Phase B'
          : pLower === 'c' || pLower.includes('phase c')
            ? 'Phase C'
            : pLower === 'sm' || pLower.includes('submarine')
              ? 'Submarine (CH 3)'
              : phase;
    const normMatch = memorySectionProfileBySectionDate.get(`${sectionId}_${normPhase}_${date}`);
    if (normMatch && normMatch.length > 0) return normMatch;
  }
  const bySecDate = memorySectionProfileBySectionDate.get(`${sectionId}_${date}`);
  if (bySecDate && bySecDate.length > 0) {
    const byHour = new Map<number, OrgSectionHourlyRecord>();
    for (const r of bySecDate) {
      const existing = byHour.get(r.hourIndex);
      if (!existing || r.maxFiberTempC > existing.maxFiberTempC) {
        byHour.set(r.hourIndex, r);
      }
    }
    return Array.from(byHour.values()).sort((a, b) => a.hourIndex - b.hourIndex);
  }

  // If not yet loaded in memory for this date, fetch asynchronously and provide immediate fallback from Panel 1
  if (date) {
    void fetchSectionDailyProfileForDate(date);

    const p1Rec =
      (phase && phase !== 'all' ? memoryRecordsBySectionDate.get(`${sectionId}_${phase}_${date}`) : undefined) ||
      memoryRecordsBySectionDate.get(`${sectionId}_${date}`);
    if (p1Rec) {
      const tfMax = Number(p1Rec.tfMax ?? 34.5) || 34.5;
      const tfMin = Number(p1Rec.tfMin ?? (tfMax - 5.5)) || (tfMax - 5.5);
      const tcMax = Number(p1Rec.tcMax ?? (tfMax + 2.5)) || (tfMax + 2.5);
      const tcMin = Number(p1Rec.tcMin ?? (tcMax - 6.0)) || (tcMax - 6.0);
      const ckt3Max = Number(p1Rec.pCkt3MaxMW ?? 45.0) || 45.0;
      const ckt2Max = Number(p1Rec.pCkt2MaxMW ?? 38.0) || 38.0;
      const nktMax = Number(p1Rec.p33NktMaxMW ?? 11.0) || 11.0;
      const oilMax = Number(p1Rec.p33OilMaxMW ?? 9.5) || 9.5;

      const diurnalFactors = [
        0.82, 0.79, 0.77, 0.76, 0.77, 0.80,
        0.85, 0.90, 0.94, 0.97, 0.99, 1.00,
        1.00, 1.00, 0.99, 0.98, 0.97, 0.98,
        0.99, 1.00, 0.97, 0.93, 0.89, 0.85,
      ];
      const powerFactors = [
        0.74, 0.70, 0.68, 0.67, 0.69, 0.75,
        0.83, 0.91, 0.95, 0.97, 0.99, 1.00,
        0.99, 1.00, 0.98, 0.96, 0.95, 0.97,
        1.00, 0.99, 0.95, 0.90, 0.84, 0.78,
      ];

      const fallbackRows: OrgSectionHourlyRecord[] = [];
      for (let h = 0; h < 24; h++) {
        const df = diurnalFactors[h];
        const pf = powerFactors[h];
        const normT = (df - 0.76) / 0.24;
        const tf = Number((tfMin + (tfMax - tfMin) * normT).toFixed(2));
        const tc = Number((tcMin + (tcMax - tcMin) * normT).toFixed(2));
        const ckt3 = Number((ckt3Max * pf).toFixed(2));
        const ckt2 = Number((ckt2Max * pf).toFixed(2));
        const nkt = Number((nktMax * pf).toFixed(2));
        const oil = Number((oilMax * pf).toFixed(2));
        const total = Number((ckt3 + ckt2 + nkt + oil).toFixed(2));
        const hh = String(h).padStart(2, '0');
        const hhNext = String(h + 1).padStart(2, '0');

        fallbackRows.push({
          sectionId: p1Rec.sectionId,
          date,
          phase: p1Rec.phase,
          hourIndex: h,
          hourPeriod: `${hh}:00-${hhNext}:00`,
          peakTime: `${hh}:15`,
          maxFiberTempC: tf,
          meanFiberTempC: Number((tf - 0.35).toFixed(2)),
          maxConductorTempC: tc,
          meanConductorTempC: Number((tc - 0.45).toFixed(2)),
          ckt3MW: ckt3,
          ckt2MW: ckt2,
          nkt33MW: nkt,
          oil33MW: oil,
          totalMW: total,
        });
      }
      return fallbackRows;
    }
  }

  return [];
}

export function getOrgSectionDailyProfileDates(): string[] {
  initFromStorage();
  return memorySectionProfileDates;
}

export function getOrgSectionDailyProfileRecordsCount(): number {
  initFromStorage();
  return memorySectionProfileRecords.length;
}

/**
 * Get Source Info for Panel 1 (Daily Max Temp / Fiber Temp - Feeds 2.1 & 2.4)
 */
export function getPanel1SourceInfo(): DataPanelSourceInfo {
  initFromStorage();
  if (memoryPanel1Info) return memoryPanel1Info;

  const cfg = getOrgDatabaseConfig();
  return {
    sourceType: 'default',
    name: cfg.databaseFileName || 'Samui_Submarine_Daily_Max_Temp_2024-2026.xlsx',
    updatedAt: cfg.uploadedAt || new Date().toISOString(),
    totalDates: cfg.totalDates || 400,
    dateRange: cfg.dateRange,
    recordCount: cfg.totalRecords || (cfg.totalDates * 18),
  };
}

export function savePanel1SourceInfo(info: DataPanelSourceInfo) {
  memoryPanel1Info = info;
  try {
    localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(info));
  } catch (e) {}
  if (memoryConfig && memoryRecords && memoryRecords.length > 0) {
    void syncLatestThreeFilesToDefaultStore({
      panel1: { config: memoryConfig, records: memoryRecords, info },
    });
  }
  notifyListeners();
}

/**
 * Get Source Info for Panel 2 (Daily Maximum Power Records 4 Circuits - Feeds 2.4)
 */
export function getPanel2SourceInfo(): DataPanelSourceInfo {
  initFromStorage();
  if (memoryPanel2Info) return memoryPanel2Info;

  const dateRange = getOrgPowerDatabaseDateRange();
  const count = getOrgPowerDatabaseRecordsCount();
  return {
    sourceType: 'default',
    name: 'Daily_Maximum_Power_Record_4Circuits_2023-2026.csv',
    updatedAt: new Date().toISOString(),
    totalDates: count || 1461,
    dateRange: dateRange.firstDate ? dateRange : { firstDate: '2023-01-01', latestDate: '2026-12-31' },
    recordCount: count || 1461,
  };
}

export function savePanel2SourceInfo(info: DataPanelSourceInfo) {
  memoryPanel2Info = info;
  try {
    localStorage.setItem(STORAGE_KEY_PANEL2_INFO, JSON.stringify(info));
  } catch (e) {}
  if (memoryPowerPeaksOnly.size > 0) {
    void syncLatestThreeFilesToDefaultStore({
      panel2: { peaks: Array.from(memoryPowerPeaksOnly.values()), info },
    });
  }
  notifyListeners();
}

/**
 * Get Source Info for Panel 3 (Section daily profile database - Feeds 2.2 & 2.3)
 */
export function getPanel3SourceInfo(): DataPanelSourceInfo {
  initFromStorage();
  if (memoryPanel3Info) return memoryPanel3Info;

  const dates = getOrgSectionDailyProfileDates();
  const count = getOrgSectionDailyProfileRecordsCount();
  return {
    sourceType: 'default',
    name: 'Circuit3_19Sheets_Section_Daily_Profile_Database.xlsx',
    updatedAt: new Date().toISOString(),
    totalDates: dates.length || 18,
    dateRange: {
      firstDate: dates[0] || '2025-07-31',
      latestDate: dates[dates.length - 1] || '2026-09-30',
    },
    recordCount: count || (18 * 18 * 24),
  };
}

export function savePanel3SourceInfo(info: DataPanelSourceInfo) {
  memoryPanel3Info = info;
  try {
    localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(info));
  } catch (e) {}
  if (memorySectionProfileRecords && memorySectionProfileRecords.length > 0) {
    void syncLatestThreeFilesToDefaultStore({
      panel3: { records: memorySectionProfileRecords, info },
    });
  }
  notifyListeners();
}

export async function syncPanel1FromFastEndpoint(url: string): Promise<{
  success: boolean;
  fileName: string;
  totalDates: number;
  recordCount: number;
  dateRange: { firstDate: string; latestDate: string };
  config: OrgDatabaseConfig;
} | null> {
  try {
    const cachedDb = await fetchSharedServerDefaultDatabases(false);
    const p1 = cachedDb?.panel1;
    if (
      p1 &&
      Array.isArray(p1.records) &&
      p1.records.length > 0 &&
      p1.config &&
      (url.includes('1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS') ||
        url.includes('1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N') ||
        p1.info?.remoteUrl === url)
    ) {
      memoryConfig = p1.config;
      memoryRecords = p1.records;
      savedDefaultPanel1 = p1;
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
      } catch {}
      rebuildIndexes();
      const fileName =
        p1.info?.name ||
        p1.config.databaseFileName ||
        'DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-18 (1).xlsx';
      const info: DataPanelSourceInfo = {
        sourceType: 'remote_link',
        name: fileName,
        remoteUrl: url,
        updatedAt: new Date().toISOString(),
        totalDates: p1.config.totalDates,
        dateRange: p1.config.dateRange,
        recordCount: p1.config.totalRecords || p1.records.length,
      };
      memoryPanel1Info = info;
      try {
        localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(info));
      } catch {}
      notifyListeners();
      return {
        success: true,
        fileName,
        totalDates: info.totalDates,
        recordCount: info.recordCount,
        dateRange: info.dateRange,
        config: p1.config,
      };
    }
  } catch (e) {
    console.warn('Fast Panel 1 sync warning:', e);
  }
  return null;
}

export async function syncPanel2FromFastEndpoint(url: string): Promise<{
  success: boolean;
  fileName: string;
  totalDates: number;
  recordCount: number;
  dateRange: { firstDate: string; latestDate: string };
} | null> {
  try {
    const cachedDb = await fetchSharedServerDefaultDatabases(false);
    const p2 = cachedDb?.panel2;
    if (
      p2 &&
      Array.isArray(p2.peaks) &&
      p2.peaks.length > 0 &&
      (url.includes('1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6') ||
        url.includes('1TnB2X_ctCOsFCQ_4oBJfNMTsilSXmFP-') ||
        p2.info?.remoteUrl === url)
    ) {
      memoryPowerPeaksOnly.clear();
      p2.peaks.forEach((pk: CircuitDailyPeakPower) => {
        memoryPowerPeaksOnly.set(pk.date, pk);
        memoryCircuitPeaksByDate.set(pk.date, pk);
      });
      savedDefaultPanel2 = p2;
      try {
        localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(p2.peaks));
      } catch {}
      rebuildIndexes();
      const sortedDates = p2.peaks.map((p: CircuitDailyPeakPower) => p.date).sort();
      const fileName =
        p2.info?.name ||
        'Daily_Maximum_Power_Consumption_Database_Updated_2026-09-30_to_2026-10-18.csv';
      const dateRange = p2.info?.dateRange || {
        firstDate: sortedDates[0] || '2025-07-01',
        latestDate: sortedDates[sortedDates.length - 1] || '2026-10-18',
      };
      const info: DataPanelSourceInfo = {
        sourceType: 'remote_link',
        name: fileName,
        remoteUrl: url,
        updatedAt: new Date().toISOString(),
        totalDates: p2.peaks.length,
        dateRange,
        recordCount: p2.peaks.length,
      };
      memoryPanel2Info = info;
      try {
        localStorage.setItem(STORAGE_KEY_PANEL2_INFO, JSON.stringify(info));
      } catch {}
      notifyListeners();
      return {
        success: true,
        fileName,
        totalDates: p2.peaks.length,
        recordCount: p2.peaks.length,
        dateRange,
      };
    }
  } catch (e) {
    console.warn('Fast Panel 2 sync warning:', e);
  }
  return null;
}

export async function syncSectionProfileFromFastEndpoint(url: string): Promise<{
  success: boolean;
  fileName: string;
  totalDates: number;
  recordCount: number;
  dateRange: { firstDate: string; latestDate: string };
} | null> {
  try {
    const fastRes = await fetch(`/api/fetch-shared-section-profiles?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : null))
      .catch(() => null);

    const cachedDb = await fetchSharedServerDefaultDatabases(false);
    const p3Cached = cachedDb?.panel3;

    const recordsToUse: OrgSectionHourlyRecord[] =
      fastRes && fastRes.success && Array.isArray(fastRes.records) && fastRes.records.length > 0
        ? fastRes.records
        : p3Cached && Array.isArray(p3Cached.records) && p3Cached.records.length > 0
          ? p3Cached.records
          : [];

    const allDatesToUse: string[] =
      fastRes && Array.isArray(fastRes.allDates) && fastRes.allDates.length > 0
        ? fastRes.allDates
        : p3Cached && Array.isArray(p3Cached.allDates) && p3Cached.allDates.length > 0
          ? p3Cached.allDates
          : p3Cached && Array.isArray(p3Cached.dates) && p3Cached.dates.length > 0
            ? p3Cached.dates
            : [];

    if (recordsToUse.length > 0) {
      memorySectionProfileRecords = recordsToUse;
      if (allDatesToUse.length > 0) {
        memorySectionProfileAllDates = allDatesToUse;
        memorySectionProfileDates = [...allDatesToUse];
      }
      rebuildSectionProfileIndexes();
      const totalDates =
        fastRes?.totalDates ||
        allDatesToUse.length ||
        p3Cached?.info?.totalDates ||
        memorySectionProfileDates.length;
      const dateRange = fastRes?.dateRange ||
        p3Cached?.info?.dateRange || {
          firstDate: memorySectionProfileDates[0] || '2025-07-01',
          latestDate: memorySectionProfileDates[memorySectionProfileDates.length - 1] || '2026-10-18',
        };
      const recordCount = fastRes?.recordCount || p3Cached?.info?.recordCount || totalDates * 744;
      const fileName =
        fastRes?.fileName ||
        p3Cached?.info?.name ||
        'DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-18.xlsx';

      const info: DataPanelSourceInfo = {
        sourceType: 'remote_link',
        name: fileName,
        remoteUrl: url,
        updatedAt: new Date().toISOString(),
        totalDates,
        dateRange,
        recordCount,
      };
      memoryPanel3Info = info;
      savedDefaultPanel3 = {
        records: recordsToUse,
        allDates: memorySectionProfileDates,
        info,
      };
      try {
        localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(info));
      } catch {}
      notifyListeners();

      return {
        success: true,
        fileName,
        totalDates,
        recordCount,
        dateRange,
      };
    }
  } catch (e) {
    console.warn('Fast section profile sync warning:', e);
  }
  return null;
}

/**
 * Reset Panel 1 to the latest saved default uploaded file (or baseline if none uploaded yet)
 */
export function resetPanel1ToSample(): void {
  if (savedDefaultPanel1 && savedDefaultPanel1.records.length > 0) {
    memoryConfig = savedDefaultPanel1.config;
    memoryRecords = savedDefaultPanel1.records;
    memoryPanel1Info = savedDefaultPanel1.info;
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(memoryRecords));
      localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(memoryPanel1Info));
    } catch (e) {}
    rebuildIndexes();
    notifyListeners();
    return;
  }

  const defaultRecs = generateDefaultOrgRecords();
  memoryRecords = defaultRecs;
  const datesSet = new Set<string>();
  defaultRecs.forEach((r) => datesSet.add(r.date));
  const sortedDates = Array.from(datesSet).sort();
  const sortedYears = Array.from(new Set(sortedDates.map((d) => d.slice(0, 4)))).sort();

  memoryConfig = {
    hasDatabase: true,
    databaseFileName: 'Samui_Submarine_Daily_Max_Temp_2024-2026.xlsx',
    uploadedAt: new Date().toISOString(),
    fileFormat: 'xlsx',
    totalRecords: defaultRecs.length,
    totalDates: sortedDates.length,
    dateRange: {
      firstDate: sortedDates[0] || '2024-01-01',
      latestDate: sortedDates[sortedDates.length - 1] || '2026-09-30',
    },
    availableDates: sortedDates,
    availableYears: sortedYears,
  };
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(defaultRecs));
    localStorage.removeItem(STORAGE_KEY_PANEL1_INFO);
  } catch (e) {}
  memoryPanel1Info = null;
  rebuildIndexes();
  notifyListeners();
}

/**
 * Reset Panel 2 to the latest saved default uploaded file (or baseline if none uploaded yet)
 */
export function resetPanel2ToSample(): void {
  if (savedDefaultPanel2 && savedDefaultPanel2.peaks.length > 0) {
    memoryCircuitPeaksByDate.clear();
    memoryPowerPeaksOnly.clear();
    savedDefaultPanel2.peaks.forEach((pk) => {
      memoryPowerPeaksOnly.set(pk.date, pk);
      memoryCircuitPeaksByDate.set(pk.date, pk);
    });
    memoryPanel2Info = savedDefaultPanel2.info;
    try {
      localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(savedDefaultPanel2.peaks));
      localStorage.setItem(STORAGE_KEY_PANEL2_INFO, JSON.stringify(memoryPanel2Info));
    } catch (e) {}
    rebuildIndexes();
    notifyListeners();
    return;
  }

  memoryCircuitPeaksByDate.clear();
  memoryPowerPeaksOnly.clear();
  const start = new Date('2023-01-01');
  const end = new Date('2026-12-31');
  const curr = new Date(start);
  while (curr <= end) {
    const yr = curr.getFullYear().toString();
    const mo = String(curr.getMonth() + 1).padStart(2, '0');
    const da = String(curr.getDate()).padStart(2, '0');
    const dateKey = `${yr}-${mo}-${da}`;

    const baseCkt3 = 38 + Math.sin(curr.getTime() / 86400000 / 40) * 12 + (Math.random() * 3 - 1.5);
    const baseCkt2 = 32 + Math.cos(curr.getTime() / 86400000 / 45) * 10 + (Math.random() * 3 - 1.5);
    const baseNkt = 14 + Math.sin(curr.getTime() / 86400000 / 50) * 4;
    const baseOil = 11 + Math.cos(curr.getTime() / 86400000 / 55) * 3;
    const total = baseCkt3 + baseCkt2 + baseNkt + baseOil;

    const peak: CircuitDailyPeakPower = {
      date: dateKey,
      year: yr,
      monthDay: `${mo}-${da}`,
      ckt3MaxMW: Number(baseCkt3.toFixed(2)),
      ckt2MaxMW: Number(baseCkt2.toFixed(2)),
      nkt33MaxMW: Number(baseNkt.toFixed(2)),
      oil33MaxMW: Number(baseOil.toFixed(2)),
      totalIslandMaxMW: Number(total.toFixed(2)),
      fiberMaxTempC: 0,
    };
    memoryPowerPeaksOnly.set(dateKey, peak);
    memoryCircuitPeaksByDate.set(dateKey, peak);
    curr.setDate(curr.getDate() + 1);
  }

  try {
    localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(Array.from(memoryPowerPeaksOnly.values())));
    localStorage.removeItem(STORAGE_KEY_PANEL2_INFO);
  } catch (e) {}
  memoryPanel2Info = null;
  rebuildIndexes();
  notifyListeners();
}

/**
 * Reset Panel 3 to the latest saved default uploaded file (or baseline if none uploaded yet)
 */
export function resetPanel3ToSample(): void {
  if (savedDefaultPanel3 && savedDefaultPanel3.records.length > 0) {
    memorySectionProfileRecords = savedDefaultPanel3.records;
    if (Array.isArray(savedDefaultPanel3.allDates) && savedDefaultPanel3.allDates.length > 0) {
      memorySectionProfileDates = savedDefaultPanel3.allDates;
    }
    memoryPanel3Info = savedDefaultPanel3.info;
    rebuildSectionProfileIndexes();
    if (Array.isArray(savedDefaultPanel3.allDates) && savedDefaultPanel3.allDates.length > memorySectionProfileDates.length) {
      memorySectionProfileDates = savedDefaultPanel3.allDates;
    }
    try {
      localStorage.setItem(STORAGE_KEY_SECTION_PROFILES, JSON.stringify(savedDefaultPanel3.records.slice(-15000)));
      localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(memoryPanel3Info));
    } catch (e) {}
    notifyListeners();
    return;
  }

  memorySectionProfileRecords = generateDefaultSectionDailyProfileRecords();
  rebuildSectionProfileIndexes();
  try {
    localStorage.removeItem(STORAGE_KEY_SECTION_PROFILES);
    localStorage.removeItem(STORAGE_KEY_PANEL3_INFO);
  } catch (e) {}
  memoryPanel3Info = null;
  notifyListeners();
}

/**
 * Shared Google Drive File Links Configuration for the 3 Public Data Source Panels (2.1, 2.2, 2.3)
 */
export interface PublicThreePanelLinksConfig {
  panel1Url: string;
  panel2Url: string;
  panel3Url: string;
  updatedAt: string;
}

const STORAGE_KEY_THREE_PANEL_LINKS = 'dts_public_three_panel_drive_links_v1';

const DEFAULT_THREE_PANEL_LINKS: PublicThreePanelLinksConfig = {
  panel1Url: 'https://drive.google.com/drive/folders/1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS?usp=sharing',
  panel2Url: 'https://drive.google.com/drive/folders/1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6?usp=sharing',
  panel3Url: 'https://drive.google.com/drive/folders/15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_?usp=sharing',
  updatedAt: '2026-10-18T18:00:00.000Z',
};

export function getPublicThreePanelLinksConfig(): PublicThreePanelLinksConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_THREE_PANEL_LINKS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        panel1Url: parsed.panel1Url || DEFAULT_THREE_PANEL_LINKS.panel1Url,
        panel2Url: parsed.panel2Url || DEFAULT_THREE_PANEL_LINKS.panel2Url,
        panel3Url: parsed.panel3Url || DEFAULT_THREE_PANEL_LINKS.panel3Url,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch (e) {}
  return {
    panel1Url: memoryPanel1Info?.remoteUrl || DEFAULT_THREE_PANEL_LINKS.panel1Url,
    panel2Url: memoryPanel2Info?.remoteUrl || DEFAULT_THREE_PANEL_LINKS.panel2Url,
    panel3Url: memoryPanel3Info?.remoteUrl || DEFAULT_THREE_PANEL_LINKS.panel3Url,
    updatedAt: DEFAULT_THREE_PANEL_LINKS.updatedAt,
  };
}

export function savePublicThreePanelLinksConfig(cfg: PublicThreePanelLinksConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_THREE_PANEL_LINKS, JSON.stringify(cfg));
  } catch (e) {}
}

export const KNOWN_DEFAULT_GOOGLE_DRIVE_FILES: Record<
  string,
  { fileId: string; fileName: string; format: 'csv' | 'xlsx' }
> = {
  // Folder 1: Daily Peak Temp
  '1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS': {
    fileId: '1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N',
    fileName: 'DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-18 (1).xlsx',
    format: 'xlsx',
  },
  // Folder 2: 4-Circuit Power Record
  '1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6': {
    fileId: '1TnB2X_ctCOsFCQ_4oBJfNMTsilSXmFP-',
    fileName: 'Daily_Maximum_Power_Consumption_Database_Updated_2026-09-30_to_2026-10-18.csv',
    format: 'csv',
  },
  // Folder 3: 24-Hour Section Profile
  '15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_': {
    fileId: '1cZTbNwPPL9rom44BZIyI_f_m1mSyHYwK',
    fileName: 'DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-18.xlsx',
    format: 'xlsx',
  },
};

export function formatErrorMessage(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    if (typeof err.message === 'string') return err.message;
    if (typeof err.error === 'string') return err.error;
    if (typeof err.error?.message === 'string') return err.error.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Fetch remote database file from Google Sheet, Google Drive, or direct URL
 * Supports direct browser download from drive.usercontent.google.com (CORS *) for static deployments (Vercel)
 * with server proxy fallback.
 */
export async function fetchRemoteDatabaseFile(
  url: string,
  preferredFormat: 'csv' | 'xlsx' = 'xlsx',
  accessToken?: string
): Promise<{
  success: boolean;
  fileName: string;
  buffer?: ArrayBuffer;
  error?: string;
}> {
  const cleanUrl = (url || '').trim();
  if (!cleanUrl) {
    return { success: false, fileName: '', error: 'Missing remote URL' };
  }

  let directFileId = '';
  let directFileName = '';

  const folderMatch = cleanUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) {
    const fId = folderMatch[1];
    if (KNOWN_DEFAULT_GOOGLE_DRIVE_FILES[fId]) {
      directFileId = KNOWN_DEFAULT_GOOGLE_DRIVE_FILES[fId].fileId;
      directFileName = KNOWN_DEFAULT_GOOGLE_DRIVE_FILES[fId].fileName;
    }
  }

  if (!directFileId) {
    const fileMatch =
      cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileMatch && fileMatch[1]) {
      directFileId = fileMatch[1];
      directFileName = preferredFormat === 'csv' ? 'remote_power_database.csv' : 'remote_database.xlsx';
    }
  }

  // Strategy A: Try local/deployed server proxy endpoint (/api/fetch-shared-database) first if available
  try {
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream, application/json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    const res = await fetch(
      `/api/fetch-shared-database?url=${encodeURIComponent(cleanUrl)}&format=${preferredFormat}&binary=1`,
      { headers }
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html') && !contentType.includes('text/plain')) {
      let explicitName = directFileName;
      const rawHeaderName = res.headers.get('X-File-Name');
      if (rawHeaderName) {
        try {
          explicitName = decodeURIComponent(rawHeaderName);
        } catch {}
      }
      if (!explicitName) {
        const disp = res.headers.get('content-disposition') || '';
        const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
        if (m && m[1]) {
          try {
            explicitName = decodeURIComponent(m[1]);
          } catch {
            explicitName = m[1];
          }
        }
      }

      if (!contentType.includes('application/json')) {
        const buffer = await res.arrayBuffer();
        if (buffer && buffer.byteLength > 100) {
          return {
            success: true,
            fileName: explicitName || (preferredFormat === 'csv' ? 'remote_power_database.csv' : 'remote_database.xlsx'),
            buffer,
          };
        }
      } else {
        const data = await res.json();
        if (data?.success && data?.base64) {
          const binaryString = atob(data.base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          const CHUNK = 65536;
          for (let i = 0; i < len; i += CHUNK) {
            const end = Math.min(len, i + CHUNK);
            for (let j = i; j < end; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            if (len > 2000000 && i % (CHUNK * 16) === 0) {
              await new Promise((r) => setTimeout(r, 0));
            }
          }
          return {
            success: true,
            fileName:
              data.fileName ||
              explicitName ||
              (preferredFormat === 'csv' ? 'remote_power_database.csv' : 'remote_database.xlsx'),
            buffer: bytes.buffer,
          };
        }
      }
    }
  } catch {
    // Proxy unavailable (e.g. static deployment on Vercel) — proceed to direct client download
  }

  // Strategy B: Static CDN bundle fallback for known shared folders on Vercel
  if (
    directFileId === '1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N' ||
    directFileId === '1TnB2X_ctCOsFCQ_4oBJfNMTsilSXmFP-'
  ) {
    try {
      const staticPath =
        directFileId === '1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N'
          ? '/data/drive_downloads/panel1_default.xlsx'
          : '/data/drive_downloads/panel2_default.csv';
      const sRes = await fetch(staticPath);
      if (sRes.ok && !(sRes.headers.get('content-type') || '').includes('text/html')) {
        const buffer = await sRes.arrayBuffer();
        if (buffer && buffer.byteLength > 100) {
          return {
            success: true,
            fileName: directFileName,
            buffer,
          };
        }
      }
    } catch {}
  }

  // Strategy C: Direct Google Drive usercontent download
  if (directFileId) {
    try {
      const gdriveDirectUrl = `https://drive.usercontent.google.com/download?id=${directFileId}&export=download&confirm=t`;
      const gRes = await fetch(gdriveDirectUrl);
      if (gRes.ok) {
        let explicitName = directFileName;
        const disp = gRes.headers.get('content-disposition') || '';
        const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
        if (m && m[1]) {
          try {
            explicitName = decodeURIComponent(m[1]);
          } catch {
            explicitName = m[1];
          }
        }
        const buffer = await gRes.arrayBuffer();
        if (buffer && buffer.byteLength > 100) {
          return {
            success: true,
            fileName: explicitName || directFileName || `remote_database.${preferredFormat}`,
            buffer,
          };
        }
      }
    } catch (directErr) {
      console.warn('Direct Google Drive usercontent download failed:', directErr);
    }
  }

  // Strategy C: Direct Google Sheets export
  const sheetsMatch = cleanUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch && sheetsMatch[1]) {
    try {
      const sheetId = sheetsMatch[1];
      const gidMatch = cleanUrl.match(/[#&?]gid=([0-9]+)/);
      const gidQuery = gidMatch ? `&gid=${gidMatch[1]}` : '';
      const sheetsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=${preferredFormat}${gidQuery}`;
      const sRes = await fetch(sheetsUrl);
      if (sRes.ok) {
        const buffer = await sRes.arrayBuffer();
        if (buffer && buffer.byteLength > 100) {
          return {
            success: true,
            fileName: `Google_Sheets_Database.${preferredFormat}`,
            buffer,
          };
        }
      }
    } catch (sheetsErr) {
      console.warn('Google Sheets direct export failed:', sheetsErr);
    }
  }

  // Strategy D: Google Drive API v3 folder listing if OAuth accessToken is present
  if (accessToken && folderMatch && folderMatch[1]) {
    try {
      const folderId = folderMatch[1];
      const driveApiRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id%2Cname%2CmimeType)&orderBy=modifiedTime+desc`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (driveApiRes.ok) {
        const driveData = await driveApiRes.json();
        const candidate = driveData.files?.find(
          (f: any) =>
            f.name?.toLowerCase().endsWith('.' + preferredFormat) ||
            f.name?.toLowerCase().endsWith('.xlsx') ||
            f.name?.toLowerCase().endsWith('.csv')
        );
        if (candidate?.id) {
          const downloadUrl = `https://drive.usercontent.google.com/download?id=${candidate.id}&export=download&confirm=t`;
          const fileRes = await fetch(downloadUrl);
          if (fileRes.ok) {
            const buffer = await fileRes.arrayBuffer();
            if (buffer && buffer.byteLength > 100) {
              return {
                success: true,
                fileName: candidate.name,
                buffer,
              };
            }
          }
        }
      }
    } catch (apiErr) {
      console.warn('Google Drive API v3 direct listing failed:', apiErr);
    }
  }

  return {
    success: false,
    fileName: '',
    error: 'Unable to reach remote Google Drive file. Verify link sharing is set to "Anyone with the link".',
  };
}

export interface PublicDataRefreshResult {
  success: boolean;
  panel1: { success: boolean; count: number; name?: string; error?: string };
  panel2: { success: boolean; count: number; name?: string; error?: string };
  panel3: { success: boolean; count: number; name?: string; error?: string };
  totalLoaded: number;
  message: string;
}

/**
 * Automatically reads and loads data from the 3 configured shared Google Drive folders
 * (Panel 1: Daily Peak Temp, Panel 2: 4-Circuit Power Record, Panel 3: Section Daily Profile)
 * with non-blocking async yielding and 0-100% progress tracking.
 */
export async function syncAllPublicSharedTargetFolders(
  accessToken?: string,
  onProgress?: (percent: number, statusText: string) => void
): Promise<PublicDataRefreshResult> {
  const links = getPublicThreePanelLinksConfig();
  const result: PublicDataRefreshResult = {
    success: false,
    panel1: { success: false, count: 0 },
    panel2: { success: false, count: 0 },
    panel3: { success: false, count: 0 },
    totalLoaded: 0,
    message: '',
  };

  onProgress?.(6, 'Connecting to Shared Folder 1 (Daily Peak Fiber & Conductor Temp)...');
  await new Promise((r) => setTimeout(r, 30));

  const cachedServerDb = await fetchSharedServerDefaultDatabases(false);

  // 1. Panel 1: Daily Peak Temperature (6% - 35%)
  if (links.panel1Url) {
    try {
      onProgress?.(14, 'Energizing Folder 1: Reading 19-Section Daily Peak Temperature...');
      const p1Cached = cachedServerDb?.panel1;
      if (
        p1Cached &&
        Array.isArray(p1Cached.records) &&
        p1Cached.records.length > 0 &&
        p1Cached.config &&
        (!p1Cached.info?.remoteUrl || p1Cached.info.remoteUrl === links.panel1Url)
      ) {
        await new Promise((r) => setTimeout(r, 60));
        onProgress?.(24, 'Indexing 14,725 Section Records across 475 Dates (Folder 1)...');
        memoryConfig = p1Cached.config;
        memoryRecords = p1Cached.records;
        savedDefaultPanel1 = p1Cached;
        try {
          localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
        } catch {}
        rebuildIndexes();
        await new Promise((r) => setTimeout(r, 60));
        onProgress?.(32, 'Synchronizing Heat Map (2.1) & Section Peak telemetry...');
        const p1Info: DataPanelSourceInfo = {
          ...(p1Cached.info || {}),
          sourceType: 'googledrive',
          name:
            p1Cached.info?.name ||
            p1Cached.config.databaseFileName ||
            'DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-18 (1).xlsx',
          remoteUrl: links.panel1Url,
          updatedAt: new Date().toISOString(),
          totalDates: p1Cached.config.totalDates,
          dateRange: p1Cached.config.dateRange,
          recordCount: p1Cached.config.totalRecords || p1Cached.records.length,
        };
        memoryPanel1Info = p1Info;
        try {
          localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(p1Info));
        } catch {}
        result.panel1 = {
          success: true,
          count: p1Cached.config.totalRecords || p1Cached.config.totalDates,
          name: p1Info.name,
        };
      } else {
        const fileRes = await fetchRemoteDatabaseFile(links.panel1Url, 'xlsx', accessToken);
        onProgress?.(18, 'Reading & indexing Daily Peak Temp records...');
        if (fileRes.success && fileRes.buffer) {
          const saveRes = await saveUploadedOrgDatabase(fileRes.buffer, fileRes.fileName, (p) => {
            onProgress?.(Math.min(34, Math.round(18 + p * 16)), 'Indexing Daily Peak Temp records...');
          });
          if (saveRes.success) {
            result.panel1 = {
              success: true,
              count: saveRes.config.totalRecords || saveRes.config.totalDates,
              name: fileRes.fileName,
            };
            savePanel1SourceInfo({
              sourceType: 'googledrive',
              name: fileRes.fileName,
              remoteUrl: links.panel1Url,
              updatedAt: new Date().toISOString(),
              totalDates: saveRes.config.totalDates,
              dateRange: saveRes.config.dateRange,
              recordCount: saveRes.config.totalRecords,
            });
          } else {
            result.panel1 = { success: false, count: 0, error: formatErrorMessage(saveRes.error) };
          }
        } else {
          result.panel1 = { success: false, count: 0, error: formatErrorMessage(fileRes.error) };
        }
      }
    } catch (e: any) {
      result.panel1 = { success: false, count: 0, error: formatErrorMessage(e) };
    }
  }
  onProgress?.(35, 'Shared Folder 1 Synchronized (100%)');
  await new Promise((r) => setTimeout(r, 50));

  // 2. Panel 2: 4-Circuit Power Record (36% - 65%)
  if (links.panel2Url) {
    try {
      onProgress?.(42, 'Energizing Folder 2: Reading 4-Circuit Submarine Power Load...');
      const p2Cached = cachedServerDb?.panel2;
      if (
        p2Cached &&
        Array.isArray(p2Cached.peaks) &&
        p2Cached.peaks.length > 0 &&
        (!p2Cached.info?.remoteUrl || p2Cached.info.remoteUrl === links.panel2Url)
      ) {
        await new Promise((r) => setTimeout(r, 60));
        onProgress?.(53, 'Indexing 115kV Ckt #3, Ckt #2, 33kV NKT & Oil-Filled MW (Folder 2)...');
        memoryPowerPeaksOnly.clear();
        p2Cached.peaks.forEach((pk: CircuitDailyPeakPower) => {
          memoryPowerPeaksOnly.set(pk.date, pk);
          memoryCircuitPeaksByDate.set(pk.date, pk);
        });
        savedDefaultPanel2 = p2Cached;
        try {
          localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(p2Cached.peaks));
        } catch {}
        rebuildIndexes();
        await new Promise((r) => setTimeout(r, 60));
        onProgress?.(62, 'Synchronizing 4-Circuit Yearly Comparison (2.4)...');
        const sortedP2Dates = p2Cached.peaks.map((p: CircuitDailyPeakPower) => p.date).sort();
        const p2Info: DataPanelSourceInfo = {
          ...(p2Cached.info || {}),
          sourceType: 'googledrive',
          name:
            p2Cached.info?.name ||
            'Daily_Maximum_Power_Consumption_Database_Updated_2026-09-30_to_2026-10-18.csv',
          remoteUrl: links.panel2Url,
          updatedAt: new Date().toISOString(),
          totalDates: p2Cached.peaks.length,
          dateRange: p2Cached.info?.dateRange || {
            firstDate: sortedP2Dates[0] || '2025-07-01',
            latestDate: sortedP2Dates[sortedP2Dates.length - 1] || '2026-10-18',
          },
          recordCount: p2Cached.peaks.length,
        };
        memoryPanel2Info = p2Info;
        try {
          localStorage.setItem(STORAGE_KEY_PANEL2_INFO, JSON.stringify(p2Info));
        } catch {}
        result.panel2 = {
          success: true,
          count: p2Cached.peaks.length,
          name: p2Info.name,
        };
      } else {
        const fileRes = await fetchRemoteDatabaseFile(links.panel2Url, 'csv', accessToken);
        onProgress?.(48, 'Parsing 4-circuit daily power flows...');
        if (fileRes.success && fileRes.buffer) {
          const saveRes = await saveUploadedPowerDatabase(fileRes.buffer, fileRes.fileName, (p) => {
            onProgress?.(Math.min(64, Math.round(48 + p * 16)), 'Parsing 4-circuit daily power flows...');
          });
          if (saveRes.success) {
            result.panel2 = {
              success: true,
              count: saveRes.count,
              name: fileRes.fileName,
            };
            savePanel2SourceInfo({
              sourceType: 'googledrive',
              name: fileRes.fileName,
              remoteUrl: links.panel2Url,
              updatedAt: new Date().toISOString(),
              totalDates: saveRes.dates.length,
              dateRange: saveRes.dateRange,
              recordCount: saveRes.count,
            });
          } else {
            result.panel2 = { success: false, count: 0, error: formatErrorMessage(saveRes.error) };
          }
        } else {
          result.panel2 = { success: false, count: 0, error: formatErrorMessage(fileRes.error) };
        }
      }
    } catch (e: any) {
      result.panel2 = { success: false, count: 0, error: formatErrorMessage(e) };
    }
  }
  onProgress?.(65, 'Shared Folder 2 Synchronized (100%)');
  await new Promise((r) => setTimeout(r, 50));

  // 3. Panel 3: Section Daily Profile (66% - 96%)
  if (links.panel3Url) {
    try {
      onProgress?.(72, 'Energizing Folder 3: Fetching 24-Hour Section Daily Profile...');
      let loadedFromFastEndpoint = false;
      const p3Cached = cachedServerDb?.panel3;

      try {
        const fastRes = await fetch(`/api/fetch-shared-section-profiles?url=${encodeURIComponent(links.panel3Url)}`).then(
          (r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : null)
        ).catch(() => null);

        const recordsToUse: OrgSectionHourlyRecord[] =
          fastRes && fastRes.success && Array.isArray(fastRes.records) && fastRes.records.length > 0
            ? fastRes.records
            : p3Cached && Array.isArray(p3Cached.records) && p3Cached.records.length > 0
              ? p3Cached.records
              : [];

        const allDatesToUse: string[] =
          fastRes && Array.isArray(fastRes.allDates) && fastRes.allDates.length > 0
            ? fastRes.allDates
            : p3Cached && Array.isArray(p3Cached.allDates) && p3Cached.allDates.length > 0
              ? p3Cached.allDates
              : p3Cached && Array.isArray(p3Cached.dates) && p3Cached.dates.length > 0
                ? p3Cached.dates
                : [];

        if (recordsToUse.length > 0) {
          onProgress?.(84, 'Indexing 24-Hour Section Curves & Ckt #3 MW across 19 Sections (Folder 3)...');
          await new Promise((r) => setTimeout(r, 60));

          memorySectionProfileRecords = recordsToUse;
          if (allDatesToUse.length > 0) {
            memorySectionProfileAllDates = allDatesToUse;
            memorySectionProfileDates = [...allDatesToUse];
          }
          rebuildSectionProfileIndexes();

          onProgress?.(93, 'Synchronizing Daily Curve (2.2) & 3D Thermal Surface (2.3)...');
          await new Promise((r) => setTimeout(r, 50));

          const totalDatesCount =
            fastRes?.totalDates ||
            allDatesToUse.length ||
            p3Cached?.info?.totalDates ||
            memorySectionProfileDates.length;

          const defaultP3Info: DataPanelSourceInfo = {
            ...(p3Cached?.info || {}),
            sourceType: 'googledrive',
            name:
              fastRes?.fileName ||
              p3Cached?.info?.name ||
              'DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-18.xlsx',
            remoteUrl: links.panel3Url,
            updatedAt: new Date().toISOString(),
            totalDates: totalDatesCount,
            dateRange: fastRes?.dateRange ||
              p3Cached?.info?.dateRange || {
                firstDate: memorySectionProfileDates[0] || '2025-07-01',
                latestDate: memorySectionProfileDates[memorySectionProfileDates.length - 1] || '2026-10-18',
              },
            recordCount:
              fastRes?.recordCount ||
              p3Cached?.info?.recordCount ||
              totalDatesCount * 744,
          };

          savedDefaultPanel3 = {
            records: recordsToUse,
            allDates: memorySectionProfileDates,
            info: defaultP3Info,
          };
          memoryPanel3Info = defaultP3Info;
          try {
            localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(defaultP3Info));
          } catch {}

          result.panel3 = {
            success: true,
            count: totalDatesCount,
            name: defaultP3Info.name,
          };
          loadedFromFastEndpoint = true;
        }
      } catch (fastErr) {
        console.warn('Fast section profile fetch fallback:', fastErr);
      }

      if (!loadedFromFastEndpoint && p3Cached && Array.isArray(p3Cached.records) && p3Cached.records.length > 0) {
        onProgress?.(84, 'Indexing 24-Hour Section Curves & Ckt #3 MW across 19 Sections (Folder 3)...');
        await new Promise((r) => setTimeout(r, 60));
        const allDatesToUse: string[] =
          Array.isArray(p3Cached.allDates) && p3Cached.allDates.length > 0
            ? p3Cached.allDates
            : Array.isArray(p3Cached.dates) && p3Cached.dates.length > 0
              ? p3Cached.dates
              : [];
        memorySectionProfileRecords = p3Cached.records;
        if (allDatesToUse.length > 0) {
          memorySectionProfileAllDates = allDatesToUse;
          memorySectionProfileDates = [...allDatesToUse];
        }
        rebuildSectionProfileIndexes();
        const totalDatesCount = allDatesToUse.length || p3Cached.info?.totalDates || memorySectionProfileDates.length;
        const p3Info: DataPanelSourceInfo = {
          ...(p3Cached.info || {}),
          sourceType: 'googledrive',
          name: p3Cached.info?.name || 'DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-18.xlsx',
          remoteUrl: links.panel3Url,
          updatedAt: new Date().toISOString(),
          totalDates: totalDatesCount,
          dateRange: p3Cached.info?.dateRange || {
            firstDate: memorySectionProfileDates[0] || '2025-07-01',
            latestDate: memorySectionProfileDates[memorySectionProfileDates.length - 1] || '2026-10-18',
          },
          recordCount: p3Cached.info?.recordCount || totalDatesCount * 744,
        };
        savedDefaultPanel3 = {
          records: p3Cached.records,
          allDates: memorySectionProfileDates,
          info: p3Info,
        };
        memoryPanel3Info = p3Info;
        try {
          localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(p3Info));
        } catch {}
        result.panel3 = {
          success: true,
          count: totalDatesCount,
          name: p3Info.name,
        };
        loadedFromFastEndpoint = true;
      }

      if (!loadedFromFastEndpoint) {
        const fileRes = await fetchRemoteDatabaseFile(links.panel3Url, 'xlsx', accessToken);
        onProgress?.(78, 'Compiling hourly section profiles across 19 sections...');
        await new Promise((r) => setTimeout(r, 40));
        if (fileRes.success && fileRes.buffer) {
          const saveRes = await saveUploadedSectionDailyProfileDatabase(fileRes.buffer, fileRes.fileName, (p) => {
            onProgress?.(Math.min(94, Math.round(78 + p * 16)), 'Compiling hourly section profiles...');
          });
          if (saveRes.success) {
            result.panel3 = {
              success: true,
              count: saveRes.dates.length || saveRes.count,
              name: fileRes.fileName,
            };
            savePanel3SourceInfo({
              sourceType: 'googledrive',
              name: fileRes.fileName,
              remoteUrl: links.panel3Url,
              updatedAt: new Date().toISOString(),
              totalDates: saveRes.dates.length,
              dateRange: saveRes.dateRange,
              recordCount: saveRes.count,
            });
          } else {
            result.panel3 = { success: false, count: 0, error: formatErrorMessage(saveRes.error) };
          }
        } else {
          result.panel3 = { success: false, count: 0, error: formatErrorMessage(fileRes.error) };
        }
      }
    } catch (e: any) {
      result.panel3 = { success: false, count: 0, error: formatErrorMessage(e) };
    }
  }
  onProgress?.(97, 'Shared Folder 3 Synchronized (100%)');
  await new Promise((r) => setTimeout(r, 40));

  // 4. Finalization & index rebuild: (98% - 100%)
  onProgress?.(99, 'Finalizing Public Dashboard Views [2.1, 2.2, 2.3, 2.4]...');
  notifyListeners();
  await new Promise((r) => setTimeout(r, 30));

  result.totalLoaded =
    (result.panel1.success ? result.panel1.count : 0) +
    (result.panel2.success ? result.panel2.count : 0) +
    (result.panel3.success ? result.panel3.count : 0);

  result.success = result.panel1.success || result.panel2.success || result.panel3.success;

  const successfulPanels: string[] = [];
  if (result.panel1.success) successfulPanels.push(`Panel 1 (${result.panel1.count} temp records)`);
  if (result.panel2.success) successfulPanels.push(`Panel 2 (${result.panel2.count} dates)`);
  if (result.panel3.success) successfulPanels.push(`Panel 3 (${result.panel3.count} dates)`);

  if (result.success) {
    result.message = `Successfully loaded data from shared folders: ${successfulPanels.join(', ')}.`;
  } else {
    const errorDetails = [result.panel1.error, result.panel2.error, result.panel3.error]
      .filter(Boolean)
      .map(formatErrorMessage)
      .join('; ');
    result.message = `Unable to fetch from shared Google Drive links (${errorDetails || 'Network or access error'}). Current telemetry remains active.`;
  }

  onProgress?.(100, 'All 3 Shared Folders Synchronized (100%)');
  return result;
}

/**
 * Public Dashboard Target Folder Configuration
 * Represents shared & editable Google Drive folder links for Target Folder 1 & Target Folder 2
 */
export interface PublicTargetFoldersConfig {
  folder1Url: string;
  folder1Id: string;
  folder1Name?: string;
  folder2Url: string;
  folder2Id: string;
  folder2Name?: string;
  parentFolderUrl?: string;
  parentFolderId?: string;
  updatedAt: string;
  isCustomConfigured: boolean;
}

const STORAGE_KEY_PUBLIC_TARGET_FOLDERS = 'dts_public_target_folders_config_v2';

/**
 * Extract Google Drive Folder ID from a shared folder URL or raw ID
 */
export function extractDriveFolderId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  // 1. Check /folders/ID or /u/0/folders/ID
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) return folderMatch[1];

  // 2. Check id=ID query param
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) return idMatch[1];

  // 3. Check /file/d/ID
  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch && fileMatch[1]) return fileMatch[1];

  // 4. Raw alphanumeric ID with dashes/underscores (at least 10 chars)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

const DEFAULT_PUBLIC_TARGET_FOLDERS: PublicTargetFoldersConfig = {
  folder1Url: 'https://drive.google.com/drive/folders/1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS?usp=sharing',
  folder1Id: '1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS',
  folder1Name: 'Shared Folder for Daily Peak Temperature (Panel 1)',
  folder2Url: 'https://drive.google.com/drive/folders/1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6?usp=sharing',
  folder2Id: '1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6',
  folder2Name: 'Shared Folder for Power Record (Panel 2)',
  parentFolderUrl: 'https://drive.google.com/drive/folders/15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_?usp=sharing',
  parentFolderId: '15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_',
  updatedAt: new Date().toISOString(),
  isCustomConfigured: false,
};

export function getPublicTargetFoldersConfig(): PublicTargetFoldersConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PUBLIC_TARGET_FOLDERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.folder1Id || parsed.folder2Id)) {
        return { ...DEFAULT_PUBLIC_TARGET_FOLDERS, ...parsed };
      }
    }
  } catch (e) {
    // ignore
  }
  return DEFAULT_PUBLIC_TARGET_FOLDERS;
}

export function savePublicTargetFoldersConfig(cfg: PublicTargetFoldersConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_PUBLIC_TARGET_FOLDERS, JSON.stringify(cfg));
    // Also sync to individual storage keys for system compatibility
    if (cfg.folder1Id) {
      localStorage.setItem('public_target_folder_1_id', cfg.folder1Id);
      localStorage.setItem('public_target_folder_1_url', cfg.folder1Url);
    }
    if (cfg.folder2Id) {
      localStorage.setItem('public_target_folder_2_id', cfg.folder2Id);
      localStorage.setItem('public_target_folder_2_url', cfg.folder2Url);
    }
  } catch (e) {
    console.warn('Failed to save public target folders config to localStorage:', e);
  }
}

export function resetPublicTargetFoldersConfig(): PublicTargetFoldersConfig {
  try {
    localStorage.removeItem(STORAGE_KEY_PUBLIC_TARGET_FOLDERS);
    localStorage.removeItem('public_target_folder_1_id');
    localStorage.removeItem('public_target_folder_1_url');
    localStorage.removeItem('public_target_folder_2_id');
    localStorage.removeItem('public_target_folder_2_url');
  } catch (e) {}
  return DEFAULT_PUBLIC_TARGET_FOLDERS;
}
