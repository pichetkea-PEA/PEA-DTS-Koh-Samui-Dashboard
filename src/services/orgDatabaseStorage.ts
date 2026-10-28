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
  // Extended 16-column (Columns A to P) fields
  peakTime?: string;
  fileSource?: string;
  ckt3AtPeakMW?: number;
  ckt2AtPeakMW?: number;
  nkt33AtPeakMW?: number;
  oil33AtPeakMW?: number;
  ckt3DailyPeakMW?: number;
  ckt2DailyPeakMW?: number;
  nkt33DailyPeakMW?: number;
  oil33DailyPeakMW?: number;
  ckt3PeakTime?: string;
  ckt2PeakTime?: string;
  nkt33PeakTime?: string;
  oil33PeakTime?: string;
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
  fileId?: string;
  fileSize?: number;
  modifiedTime?: string;
  versionSignature?: string;
}

const STORAGE_KEY_CONFIG = 'org_dts_master_database_config_v2';
const STORAGE_KEY_DATA = 'org_dts_master_database_records_v2';
const STORAGE_KEY_FOLDER = 'org_dts_permanent_folder_config_v2';
const STORAGE_KEY_POWER_PEAKS = 'org_dts_power_peaks_records_v2';
const STORAGE_KEY_SECTION_PROFILE = 'org_dts_section_daily_profile_records_v2';
const STORAGE_KEY_SECTION_PROFILES = STORAGE_KEY_SECTION_PROFILE;
const STORAGE_KEY_SECTION_PROFILE_DATES = 'org_dts_section_daily_profile_dates_v2';
const STORAGE_KEY_PANEL1_INFO = 'dts_data_panel1_source_info_v2';
const STORAGE_KEY_PANEL2_INFO = 'dts_data_panel2_source_info_v2';
const STORAGE_KEY_PANEL3_INFO = 'dts_data_panel3_source_info_v2';

// In-memory cache for ultra-fast reactive queries
let memoryConfig: OrgDatabaseConfig | null = null;
let memoryRecords: OrgDatabaseRecord[] | null = null;
let memoryRecordsByDate = new Map<string, OrgDatabaseRecord[]>();
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
  stats?: Panel3StatisticsSummary;
} | null = null;

export interface Panel3DailyStatsEntry {
  tf: number[][]; // 31 section-phases x 6 thermal zones
  tc: number[][]; // 31 section-phases x 6 thermal zones
  pwrAll: number[][]; // 4 circuits [ckt3, ckt2, nkt33, oil33] x 4 operating ranges (all section-hour records)
  pwrHr: number[][]; // 4 circuits [ckt3, ckt2, nkt33, oil33] x 4 operating ranges (unique hourly intervals)
}

export interface Panel3StatisticsSummary {
  keys: string[];
  dates: string[];
  byDate: Record<string, Panel3DailyStatsEntry>;
  updatedAt?: string;
}

export interface SectionPhaseSlotMeta {
  key: string; // e.g. '1.1_A', '2.1_SM'
  index: number;
  sectionId: string;
  sectionName: string;
  category: 'land' | 'submarine';
  phaseCode: 'A' | 'B' | 'C' | 'SM';
  phaseLabel: string;
  shortLabel: string; // e.g. '1.1 (A)' or '2.1'
  axisSubLabel: string; // e.g. 'LS1·A' or 'SM1'
}

export const PANEL3_SECTION_PHASE_ORDER_KEYS: string[] = [
  '1.1_A', '1.1_B', '1.1_C',
  '1.2_A', '1.2_B', '1.2_C',
  '1.3_A', '1.3_B', '1.3_C',
  '1.4_A', '1.4_B', '1.4_C',
  '1.5_A', '1.5_B', '1.5_C',
  '1.6_A', '1.6_B', '1.6_C',
  '2.1_SM', '2.2_SM', '2.3_SM', '2.4_SM', '2.5_SM',
  '2.6_SM', '2.7_SM', '2.8_SM', '2.9_SM', '2.10_SM',
  '2.11_SM', '2.12_SM', '2.13_SM',
];

export const PANEL3_SECTION_PHASE_SLOTS: SectionPhaseSlotMeta[] = PANEL3_SECTION_PHASE_ORDER_KEYS.map((key, index) => {
  const [sectionId, ph] = key.split('_');
  const secInfo = CIRCUIT_3_SECTIONS.find((s) => s.sectionId === sectionId);
  const category = sectionId.startsWith('1.') ? 'land' : 'submarine';
  const phaseCode = (ph as 'A' | 'B' | 'C' | 'SM') || (category === 'land' ? 'A' : 'SM');
  const phaseLabel = category === 'land' ? `Phase ${phaseCode}` : 'Submarine (CH 3)';
  const shortLabel = category === 'land' ? `${sectionId}-${phaseCode}` : sectionId;
  return {
    key,
    index,
    sectionId,
    sectionName: secInfo?.name || `Section ${sectionId}`,
    category,
    phaseCode,
    phaseLabel,
    shortLabel,
    axisSubLabel: category === 'land' ? `Ph ${phaseCode}` : 'Subsea',
  };
});

export type PowerOperateConditionKey = 'normal' | 'emergency' | 'critical' | 'overload';
export type PowerCircuitKey = 'ckt3' | 'ckt2' | 'nkt33' | 'oil33';

export interface PowerCircuitMeta {
  key: PowerCircuitKey;
  index: number;
  label: string;
  shortLabel: string;
  substation: string;
  thresholds: {
    normalMax: number;
    emergencyMax: number;
    criticalMax: number;
  };
  rangeLabels: Record<PowerOperateConditionKey, string>;
}

export const POWER_CIRCUITS_META: PowerCircuitMeta[] = [
  {
    key: 'ckt3',
    index: 0,
    label: '115kV Ckt#3',
    shortLabel: '115kV Ckt#3',
    substation: 'Khanom – Samui 3 (KMB)',
    thresholds: { normalMax: 64.1, emergencyMax: 68.11, criticalMax: 80.13 },
    rangeLabels: {
      normal: '< 64.1 MW',
      emergency: '64.1 – 68.11 MW',
      critical: '68.11 – 80.13 MW',
      overload: '> 80.13 MW',
    },
  },
  {
    key: 'ckt2',
    index: 1,
    label: '115kV Ckt#2',
    shortLabel: '115kV Ckt#2',
    substation: 'Khanom – Samui 2 (KMA)',
    thresholds: { normalMax: 53.64, emergencyMax: 56.79, criticalMax: 63.10 },
    rangeLabels: {
      normal: '< 53.64 MW',
      emergency: '53.64 – 56.79 MW',
      critical: '56.79 – 63.10 MW',
      overload: '> 63.10 MW',
    },
  },
  {
    key: 'nkt33',
    index: 2,
    label: '33kV NKT',
    shortLabel: '33kV NKT',
    substation: 'Khanom – Samui 1 (KNA)',
    thresholds: { normalMax: 13.29, emergencyMax: 14.08, criticalMax: 15.64 },
    rangeLabels: {
      normal: '< 13.29 MW',
      emergency: '13.29 – 14.08 MW',
      critical: '14.08 – 15.64 MW',
      overload: '> 15.64 MW',
    },
  },
  {
    key: 'oil33',
    index: 3,
    label: '33kV Oil',
    shortLabel: '33kV Oil',
    substation: 'Khanom – Samui Oil-Filled (KNA)',
    thresholds: { normalMax: 12.90, emergencyMax: 13.66, criticalMax: 15.18 },
    rangeLabels: {
      normal: '< 12.90 MW',
      emergency: '12.90 – 13.66 MW',
      critical: '13.66 – 15.18 MW',
      overload: '> 15.18 MW',
    },
  },
];

export interface PowerOperateRangeMeta {
  key: PowerOperateConditionKey;
  index: number;
  label: string;
  shortLabel: string;
  subtitle: string;
  hexColor: string;
  glowColor: string;
  badgeBgClass: string;
  badgeTextClass: string;
  badgeBorderClass: string;
}

export const POWER_OPERATING_RANGES_4: PowerOperateRangeMeta[] = [
  {
    key: 'normal',
    index: 0,
    label: 'Normal Condition',
    shortLabel: 'Normal',
    subtitle: 'Low to moderate power demand',
    hexColor: '#3b82f6', // Blue
    glowColor: 'rgba(59, 130, 246, 0.55)',
    badgeBgClass: 'bg-blue-500/15',
    badgeTextClass: 'text-blue-300',
    badgeBorderClass: 'border-blue-400/40',
  },
  {
    key: 'emergency',
    index: 1,
    label: 'Emergency Condition',
    shortLabel: 'Emergency',
    subtitle: 'High power demand',
    hexColor: '#eab308', // Yellow
    glowColor: 'rgba(234, 179, 8, 0.55)',
    badgeBgClass: 'bg-yellow-500/15',
    badgeTextClass: 'text-yellow-300',
    badgeBorderClass: 'border-yellow-400/50',
  },
  {
    key: 'critical',
    index: 2,
    label: 'Critical Condition',
    shortLabel: 'Critical',
    subtitle: 'Very High power demand',
    hexColor: '#ef4444', // Red
    glowColor: 'rgba(239, 68, 68, 0.55)',
    badgeBgClass: 'bg-red-500/15',
    badgeTextClass: 'text-red-300',
    badgeBorderClass: 'border-red-400/50',
  },
  {
    key: 'overload',
    index: 3,
    label: 'Overload Condition',
    shortLabel: 'Overload',
    subtitle: 'Insufficient power supply (Short-circuit risk)',
    hexColor: '#991b1b', // Dark Red
    glowColor: 'rgba(185, 28, 28, 0.65)',
    badgeBgClass: 'bg-rose-950/50',
    badgeTextClass: 'text-rose-200',
    badgeBorderClass: 'border-rose-700/70',
  },
];

let memoryPanel3StatsSummary: Panel3StatisticsSummary | null = null;
let fetchingPanel3StatsPromise: Promise<Panel3StatisticsSummary | null> | null = null;

function classifyClientTempZone(t: number): number {
  if (t > 70) return 5;
  if (t >= 60) return 4;
  if (t >= 55) return 3;
  if (t >= 45) return 2;
  if (t >= 35) return 1;
  return 0;
}

function classifyClientCircuitRange(circuitIdx: number, mw: number): number {
  const meta = POWER_CIRCUITS_META[circuitIdx];
  if (!meta) return 0;
  if (mw > meta.thresholds.criticalMax) return 3;
  if (mw >= meta.thresholds.emergencyMax) return 2;
  if (mw >= meta.thresholds.normalMax) return 1;
  return 0;
}

export function buildPanel3StatsFromHourlyRecords(records: OrgSectionHourlyRecord[]): Panel3StatisticsSummary {
  const byDateRecords = new Map<string, OrgSectionHourlyRecord[]>();
  for (const r of records) {
    if (!r.date) continue;
    let list = byDateRecords.get(r.date);
    if (!list) {
      list = [];
      byDateRecords.set(r.date, list);
    }
    list.push(r);
  }
  const dates = Array.from(byDateRecords.keys()).sort();
  const keyToIndex = new Map(PANEL3_SECTION_PHASE_ORDER_KEYS.map((k, idx) => [k, idx]));
  const byDate: Record<string, Panel3DailyStatsEntry> = {};

  for (const d of dates) {
    const rows = byDateRecords.get(d) || [];
    const tf = Array.from({ length: PANEL3_SECTION_PHASE_ORDER_KEYS.length }, () => [0, 0, 0, 0, 0, 0]);
    const tc = Array.from({ length: PANEL3_SECTION_PHASE_ORDER_KEYS.length }, () => [0, 0, 0, 0, 0, 0]);
    const pwrAll = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const pwrHr = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const byHr = new Map<number, [number, number, number, number]>();

    for (const r of rows) {
      const phCode = r.sectionId.startsWith('2.')
        ? 'SM'
        : /Phase\s*B|^B$/i.test(r.phase)
          ? 'B'
          : /Phase\s*C|^C$/i.test(r.phase)
            ? 'C'
            : 'A';
      const idx = keyToIndex.get(`${r.sectionId}_${phCode}`);
      if (idx !== undefined && r.maxFiberTempC > 0) {
        tf[idx][classifyClientTempZone(r.maxFiberTempC)]++;
        tc[idx][classifyClientTempZone(r.maxConductorTempC > 0 ? r.maxConductorTempC : r.maxFiberTempC)]++;
      }

      const c3 = r.ckt3MW || 0;
      const c2 = r.ckt2MW || 0;
      const nk = r.nkt33MW || 0;
      const oi = r.oil33MW || 0;
      pwrAll[0][classifyClientCircuitRange(0, c3)]++;
      pwrAll[1][classifyClientCircuitRange(1, c2)]++;
      pwrAll[2][classifyClientCircuitRange(2, nk)]++;
      pwrAll[3][classifyClientCircuitRange(3, oi)]++;

      const prev = byHr.get(r.hourIndex) || [0, 0, 0, 0];
      if (c3 > prev[0]) prev[0] = c3;
      if (c2 > prev[1]) prev[1] = c2;
      if (nk > prev[2]) prev[2] = nk;
      if (oi > prev[3]) prev[3] = oi;
      byHr.set(r.hourIndex, prev);
    }

    for (const [, [c3, c2, nk, oi]] of byHr.entries()) {
      pwrHr[0][classifyClientCircuitRange(0, c3)]++;
      pwrHr[1][classifyClientCircuitRange(1, c2)]++;
      pwrHr[2][classifyClientCircuitRange(2, nk)]++;
      pwrHr[3][classifyClientCircuitRange(3, oi)]++;
    }

    byDate[d] = { tf, tc, pwrAll, pwrHr };
  }

  return {
    keys: PANEL3_SECTION_PHASE_ORDER_KEYS,
    dates,
    byDate,
    updatedAt: new Date().toISOString(),
  };
}

export async function ensurePanel3StatisticsSummaryLoaded(forceRefresh = false): Promise<Panel3StatisticsSummary | null> {
  if (!forceRefresh && memoryPanel3StatsSummary && memoryPanel3StatsSummary.dates?.length > 0) {
    return memoryPanel3StatsSummary;
  }
  if (!forceRefresh && fetchingPanel3StatsPromise) {
    return fetchingPanel3StatsPromise;
  }

  fetchingPanel3StatsPromise = (async () => {
    try {
      const cacheBust = forceRefresh ? `?t=${Date.now()}` : '';
      const res = await fetch(`/api/panel3-statistics-summary${cacheBust}`, forceRefresh ? { cache: 'no-store' } : {});
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const json = await res.json();
        if (json?.success && json?.stats && Array.isArray(json.stats.dates) && json.stats.dates.length > 0) {
          memoryPanel3StatsSummary = json.stats;
          void idbSet('panel3_stats', json.stats);
          notifyListeners();
          return memoryPanel3StatsSummary;
        }
      }
    } catch {}

    try {
      const staticRes = await fetch('/data/panel3_stats.json');
      if (staticRes.ok && (staticRes.headers.get('content-type') || '').includes('application/json')) {
        const stats = await staticRes.json();
        if (stats && Array.isArray(stats.dates) && stats.dates.length > 0) {
          memoryPanel3StatsSummary = stats;
          void idbSet('panel3_stats', stats);
          notifyListeners();
          return memoryPanel3StatsSummary;
        }
      }
    } catch {}

    try {
      const idbStats = await idbGet<Panel3StatisticsSummary>('panel3_stats');
      if (idbStats && Array.isArray(idbStats.dates) && idbStats.dates.length > 0) {
        memoryPanel3StatsSummary = idbStats;
        notifyListeners();
        return memoryPanel3StatsSummary;
      }
    } catch {}

    if (memorySectionProfileRecords.length > 0) {
      memoryPanel3StatsSummary = buildPanel3StatsFromHourlyRecords(memorySectionProfileRecords);
      notifyListeners();
      return memoryPanel3StatsSummary;
    }

    return null;
  })();

  try {
    return await fetchingPanel3StatsPromise;
  } finally {
    fetchingPanel3StatsPromise = null;
  }
}

export function getPanel3StatisticsSummary(): Panel3StatisticsSummary | null {
  initFromStorage();
  if (!memoryPanel3StatsSummary) {
    void ensurePanel3StatisticsSummaryLoaded(false);
  }
  return memoryPanel3StatsSummary;
}
let hasStartedAsyncHydration = false;

const IDB_NAME = 'dts_public_default_db_idb_v2';
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
  const cacheBust = forceRefresh ? `?t=${Date.now()}` : '';
  const fetchOpts: RequestInit = forceRefresh ? { cache: 'no-store' } : {};
  sharedPublicDefaultDbPromise = (async () => {
    try {
      const res = await fetch(`/api/public-default-databases${cacheBust}`, fetchOpts);
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const json = await res.json();
        if (json?.success && json?.data && (json.data.panel1 || json.data.panel2 || json.data.panel3)) {
          return json.data;
        }
      }
    } catch {
      // ignore network error and fall back to static CDN bundle
    }
    try {
      const staticRes = await fetch(`/data/public-default-databases.json${cacheBust}`, fetchOpts);
      if (staticRes.ok && (staticRes.headers.get('content-type') || '').includes('application/json')) {
        const data = await staticRes.json();
        if (data && (data.panel1 || data.panel2 || data.panel3)) {
          return data;
        }
      }
    } catch {
      // ignore static fallback error
    }
    sharedPublicDefaultDbPromise = null;
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
    memoryConfig = p1.config;
    memoryRecords = p1.records;
    memoryPanel1Info = p1.info || memoryPanel1Info;
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
      if (memoryPanel1Info) {
        localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(memoryPanel1Info));
      }
    } catch {}
    void idbSet('panel1', p1);
    didUpdate = true;
  }

  if (p2 && Array.isArray(p2.peaks) && p2.peaks.length > 0) {
    savedDefaultPanel2 = p2;
    memoryPowerPeaksOnly.clear();
    p2.peaks.forEach((pk: CircuitDailyPeakPower) => {
      const c3 = Number((pk.ckt3MaxMW ?? 0).toFixed(2));
      const c2 = Number((pk.ckt2MaxMW ?? 0).toFixed(2));
      const nk = Number((pk.nkt33MaxMW ?? 0).toFixed(2));
      const oi = Number((pk.oil33MaxMW ?? 0).toFixed(2));
      const sumAtPeak = Number(
        (
          (pk.ckt3AtPeakMW ?? c3) +
          (pk.ckt2AtPeakMW ?? c2) +
          (pk.nkt33AtPeakMW ?? nk) +
          (pk.oil33AtPeakMW ?? oi)
        ).toFixed(2)
      );
      const rawTot = Number((pk.totalIslandMaxMW || 0).toFixed(2));
      const normalizedPk: CircuitDailyPeakPower = {
        ...pk,
        ckt3MaxMW: c3,
        ckt2MaxMW: c2,
        nkt33MaxMW: nk,
        oil33MaxMW: oi,
        totalIslandMaxMW: rawTot > 0 ? rawTot : sumAtPeak,
      };
      memoryPowerPeaksOnly.set(pk.date, normalizedPk);
      memoryCircuitPeaksByDate.set(pk.date, normalizedPk);
    });
    memoryPanel2Info = p2.info || memoryPanel2Info;
    try {
      if (memoryPanel2Info) {
        localStorage.setItem(STORAGE_KEY_PANEL2_INFO, JSON.stringify(memoryPanel2Info));
      }
      localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(p2.peaks));
    } catch {}
    void idbSet('panel2', p2);
    didUpdate = true;
  }

  if (didUpdate) {
    rebuildIndexes();
  }

  if (p3) {
    savedDefaultPanel3 = p3;
    if (Array.isArray(p3.allDates) && p3.allDates.length > 0) {
      memorySectionProfileAllDates = p3.allDates;
      memorySectionProfileDates = p3.allDates;
    } else if (Array.isArray((p3 as any).dates) && (p3 as any).dates.length > 0) {
      memorySectionProfileAllDates = (p3 as any).dates;
      memorySectionProfileDates = (p3 as any).dates;
    }
    if (Array.isArray(p3.records) && p3.records.length > 0) {
      memorySectionProfileRecords = p3.records;
      rebuildSectionProfileIndexes();
    }
    if ((p3 as any).stats && Array.isArray((p3 as any).stats.dates) && (p3 as any).stats.dates.length > 0) {
      memoryPanel3StatsSummary = (p3 as any).stats;
    } else {
      void ensurePanel3StatisticsSummaryLoaded(false);
    }
    memoryPanel3Info = p3.info || memoryPanel3Info;
    try {
      if (memoryPanel3Info) {
        localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(memoryPanel3Info));
      }
      if (memorySectionProfileDates.length > 0) {
        localStorage.setItem(STORAGE_KEY_SECTION_PROFILE_DATES, JSON.stringify(memorySectionProfileDates));
      }
    } catch {}
    void idbSet('panel3', p3);
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
const fetchingPanel1DofDates = new Set<string>();
const loadedPanel1DofDates = new Set<string>();

export async function fetchPanel1DofsForDate(date: string): Promise<boolean> {
  if (!date || fetchingPanel1DofDates.has(date) || loadedPanel1DofDates.has(date)) return false;
  const recs = memoryRecordsByDate.get(date);
  if (
    recs &&
    recs.length > 0 &&
    recs[0].dofTfMax &&
    Object.keys(recs[0].dofTfMax).length > 0 &&
    recs[0].dofTcMax &&
    Object.keys(recs[0].dofTcMax).length > 0
  ) {
    loadedPanel1DofDates.add(date);
    return true;
  }

  fetchingPanel1DofDates.add(date);
  try {
    const res = await fetch(`/api/panel1-date-dofs?date=${encodeURIComponent(date)}`);
    if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
      const data = await res.json();
      if (data?.success && data?.dofsBySectionPhase && typeof data.dofsBySectionPhase === 'object') {
        const dofsMap = data.dofsBySectionPhase;
        const dateRecs = memoryRecordsByDate.get(date) || [];
        let updatedAny = false;
        for (const r of dateRecs) {
          const pNorm = (r.phase || '').replace(/^Phase\s+/i, '').trim();
          const entry =
            dofsMap[`${r.sectionId}_${r.phase}`] ||
            dofsMap[`${r.sectionId}_Phase ${pNorm}`] ||
            dofsMap[`${r.sectionId}_Submarine (CH 3)`] ||
            dofsMap[`${r.sectionId}_${pNorm}`];
          if (entry) {
            if (entry.dofTfMax) r.dofTfMax = entry.dofTfMax;
            if (entry.dofTcMax) r.dofTcMax = entry.dofTcMax;
            if (entry.dofTimeMax) r.dofTimeMax = entry.dofTimeMax;
            updatedAny = true;
          }
        }
        loadedPanel1DofDates.add(date);
        if (updatedAny) {
          notifyListeners();
          return true;
        }
      }
    }
  } catch {
    // ignore fetch error
  } finally {
    fetchingPanel1DofDates.delete(date);
  }
  return false;
}

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

    const rawCfg = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (rawCfg) {
      const parsedCfg = JSON.parse(rawCfg);
      // Discard legacy synthetic seed or empty config if present
      if (
        parsedCfg?.databaseFileName === 'Samui_Submarine_Daily_Max_Temp_2024-2026.xlsx' ||
        !parsedCfg?.hasDatabase ||
        !parsedCfg?.totalRecords
      ) {
        localStorage.removeItem(STORAGE_KEY_CONFIG);
        localStorage.removeItem(STORAGE_KEY_DATA);
      } else {
        memoryConfig = parsedCfg;
      }
    }
    const rawData = localStorage.getItem(STORAGE_KEY_DATA);
    if (rawData && memoryConfig) {
      memoryRecords = JSON.parse(rawData);
      rebuildIndexes();
    }
    const rawPower = localStorage.getItem(STORAGE_KEY_POWER_PEAKS);
    if (rawPower) {
      if (!memoryPanel2Info || memoryPanel2Info.sourceType === 'default') {
        localStorage.removeItem(STORAGE_KEY_POWER_PEAKS);
      } else {
        try {
          const parsedPower: CircuitDailyPeakPower[] = JSON.parse(rawPower);
          if (parsedPower.length > 0 && parsedPower[0].ckt3AtPeakMW === undefined) {
            localStorage.removeItem(STORAGE_KEY_POWER_PEAKS);
            localStorage.removeItem(STORAGE_KEY_PANEL2_INFO);
            memoryPanel2Info = null;
          } else {
            parsedPower.forEach((p) => {
              memoryPowerPeaksOnly.set(p.date, p);
              memoryCircuitPeaksByDate.set(p.date, p);
            });
          }
        } catch (e) {}
      }
    }
    const rawSecDates = localStorage.getItem(STORAGE_KEY_SECTION_PROFILE_DATES);
    if (rawSecDates) {
      try {
        const parsedDates = JSON.parse(rawSecDates);
        if (Array.isArray(parsedDates) && parsedDates.length > 0) {
          memorySectionProfileAllDates = parsedDates;
          memorySectionProfileDates = parsedDates;
        }
      } catch (e) {}
    }
    const rawSecProfiles = localStorage.getItem(STORAGE_KEY_SECTION_PROFILES);
    if (rawSecProfiles && memoryPanel3Info && memoryPanel3Info.sourceType !== 'default') {
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
  memoryRecordsByDate.clear();
  memoryRecordsBySectionDate.clear();
  memoryCircuitPeaksByDate.clear();

  if (!memoryRecords || memoryRecords.length === 0) {
    memoryPowerPeaksOnly.forEach((p, d) => {
      memoryCircuitPeaksByDate.set(d, p);
    });
    return;
  }

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
    // O(1) index by date
    let dayList = memoryRecordsByDate.get(r.date);
    if (!dayList) {
      dayList = [];
      memoryRecordsByDate.set(r.date, dayList);
    }
    dayList.push(r);

    // Key: `${sectionId}_${date}` and `${sectionId}_${phase}_${date}`
    const baseSecDateKey = `${r.sectionId}_${r.date}`;
    const prevSecDateRec = memoryRecordsBySectionDate.get(baseSecDateKey);
    if (!prevSecDateRec || r.tfMax >= prevSecDateRec.tfMax) {
      memoryRecordsBySectionDate.set(baseSecDateKey, r);
    }
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
    const c3 = Number(v.ckt3.toFixed(2));
    const c2 = Number(v.ckt2.toFixed(2));
    const nk = Number(v.nkt33.toFixed(2));
    const oi = Number(v.oil33.toFixed(2));
    const sum4 = Number((c3 + c2 + nk + oi).toFixed(2));
    const totalCalc = v.total > 0 ? v.total : sum4;
    memoryCircuitPeaksByDate.set(date, {
      date,
      year: date.slice(0, 4),
      monthDay: date.slice(5),
      ckt3MaxMW: c3,
      ckt2MaxMW: c2,
      nkt33MaxMW: nk,
      oil33MaxMW: oi,
      totalIslandMaxMW: Number(totalCalc.toFixed(2)),
      fiberMaxTempC: Number(v.tfMax.toFixed(2)),
    });
  });

  // Re-apply power peak records from Target Folder 2 / Panel 2 scanning
  memoryPowerPeaksOnly.forEach((p, d) => {
    const existing = memoryCircuitPeaksByDate.get(d);
    const c3 = Number((p.ckt3MaxMW !== undefined ? p.ckt3MaxMW : existing?.ckt3MaxMW || 0).toFixed(2));
    const c2 = Number((p.ckt2MaxMW !== undefined ? p.ckt2MaxMW : existing?.ckt2MaxMW || 0).toFixed(2));
    const nk = Number((p.nkt33MaxMW !== undefined ? p.nkt33MaxMW : existing?.nkt33MaxMW || 0).toFixed(2));
    const oi = Number((p.oil33MaxMW !== undefined ? p.oil33MaxMW : existing?.oil33MaxMW || 0).toFixed(2));
    const sumAtPeak = Number(
      (
        (p.ckt3AtPeakMW ?? c3) +
        (p.ckt2AtPeakMW ?? c2) +
        (p.nkt33AtPeakMW ?? nk) +
        (p.oil33AtPeakMW ?? oi)
      ).toFixed(2)
    );
    const rawTot = Number((p.totalIslandMaxMW || existing?.totalIslandMaxMW || 0).toFixed(2));
    const tot = rawTot > 0 ? rawTot : sumAtPeak;
    if (existing) {
      memoryCircuitPeaksByDate.set(d, {
        ...existing,
        ...p,
        ckt3MaxMW: c3,
        ckt2MaxMW: c2,
        nkt33MaxMW: nk,
        oil33MaxMW: oi,
        totalIslandMaxMW: tot,
        fiberMaxTempC: existing.fiberMaxTempC,
      });
    } else {
      memoryCircuitPeaksByDate.set(d, {
        ...p,
        ckt3MaxMW: c3,
        ckt2MaxMW: c2,
        nkt33MaxMW: nk,
        oil33MaxMW: oi,
        totalIslandMaxMW: tot,
      });
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

        const secSamplingDofs = Array.from(
          new Set(
            CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === secId).map((p) =>
              Number(p.dof.toFixed(2))
            )
          )
        ).sort((a, b) => a - b);

        for (const key of Object.keys(rawAny)) {
          const tfMatch = key.match(/^Tf[_ ]?DOF[_ ]?([\d.]+)m?(?:[_ ]?C)?$/i);
          if (tfMatch) {
            const dNum = parseFloat(tfMatch[1]);
            const cellRaw = rawAny[key];
            if (cellRaw === '' || cellRaw === null || cellRaw === undefined) continue;
            const v = typeof cellRaw === 'number' ? cellRaw : parseFloat(String(cellRaw));
            if (!isNaN(dNum) && !isNaN(v)) {
              const val = Number(v.toFixed(2));
              rowDofTf[dNum.toFixed(2)] = val;
              rowDofTf[dNum.toFixed(1)] = val;
              rowDofTf[String(Math.round(dNum))] = val;
              const ptIdx = secSamplingDofs.findIndex((d) => Math.abs(d - dNum) < 0.6);
              if (ptIdx >= 0) rowDofTf[`idx_${ptIdx}`] = val;
              rowDofTfValues.push(val);
            }
            continue;
          }
          const tcMatch = key.match(/^Tc[_ ]?DOF[_ ]?([\d.]+)m?(?:[_ ]?C)?$/i);
          if (tcMatch) {
            const dNum = parseFloat(tcMatch[1]);
            const cellRaw = rawAny[key];
            if (cellRaw === '' || cellRaw === null || cellRaw === undefined) continue;
            const v = typeof cellRaw === 'number' ? cellRaw : parseFloat(String(cellRaw));
            if (!isNaN(dNum) && !isNaN(v)) {
              const val = Number(v.toFixed(2));
              rowDofTc[dNum.toFixed(2)] = val;
              rowDofTc[dNum.toFixed(1)] = val;
              rowDofTc[String(Math.round(dNum))] = val;
              const ptIdx = secSamplingDofs.findIndex((d) => Math.abs(d - dNum) < 0.6);
              if (ptIdx >= 0) rowDofTc[`idx_${ptIdx}`] = val;
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
              const ptIdx = secSamplingDofs.findIndex((d) => Math.abs(d - dNum) < 0.6);
              if (ptIdx >= 0) rowDofTime[`idx_${ptIdx}`] = tStr;
            }
          }
        }

        // Fill in estimated Tc for any DOF that has Tf_DOF_* but no Tc_DOF_*
        for (const [dKey, tfVal] of Object.entries(rowDofTf)) {
          if (rowDofTc[dKey] === undefined) {
            const estTc = Number(estimateConductorTempFromFiber(tfVal, pCkt3 || 35, category, secId).toFixed(2));
            rowDofTc[dKey] = estTc;
            rowDofTcValues.push(estTc);
          }
        }

        const directMaxTf = [
          row.Max_Fiber_Temp_C,
          row.Daily_Max_Fiber_Temp_C,
          row.DOF_Fiber_Temp_C,
          rawAny.Max_Fiber_Temp_Period_C,
          rawAny.Fiber_Temp_C,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .find((n) => !isNaN(n) && n > 0);

        const maxDofTf = rowDofTfValues.length > 0 ? Math.max(...rowDofTfValues) : 0;
        const tfMax = Number(
          (directMaxTf && directMaxTf > 0 ? Math.max(directMaxTf, maxDofTf) : maxDofTf).toFixed(2)
        );

        const tfMinCandidates = [
          row.Min_Fiber_Temp_C,
          row.DOF_Fiber_Temp_C,
          ...rowDofTfValues,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .filter((n) => !isNaN(n) && n > 0);

        const tfMeanCandidates = [
          row.Mean_Fiber_Temp_C,
          rawAny.Mean_Fiber_Temp_Period_C,
          row.DOF_Fiber_Temp_C,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .filter((n) => !isNaN(n) && n > 0);

        const directMaxTc = [
          row.IEC_Est_Max_Conductor_C,
          row.Daily_Max_Conductor_Temp_C,
          row.DOF_Conductor_Temp_C,
          rawAny.Max_Conductor_Temp_Period_C,
        ]
          .map((v) => (typeof v === 'number' ? v : parseFloat(String(v ?? ''))))
          .find((n) => !isNaN(n) && n > 0);

        const maxDofTc = rowDofTcValues.length > 0 ? Math.max(...rowDofTcValues) : 0;
        const tcMax =
          directMaxTc && directMaxTc > 0
            ? Number(Math.max(directMaxTc, maxDofTc).toFixed(2))
            : maxDofTc > 0
              ? Number(maxDofTc.toFixed(2))
              : tfMax > 0
                ? Number(estimateConductorTempFromFiber(tfMax, pCkt3 || 35, category, secId).toFixed(2))
                : 0;

        const tfMin = tfMinCandidates.length > 0 ? Number(Math.min(...tfMinCandidates).toFixed(2)) : tfMax;
        const tfMean =
          tfMeanCandidates.length > 0
            ? Number(tfMeanCandidates[0].toFixed(2))
            : rowDofTfValues.length > 0
              ? Number((rowDofTfValues.reduce((a, b) => a + b, 0) / rowDofTfValues.length).toFixed(2))
              : tfMax;
        const rawMinTc =
          typeof row.IEC_Est_Min_Conductor_C === 'number'
            ? row.IEC_Est_Min_Conductor_C
            : parseFloat(String(row.IEC_Est_Min_Conductor_C ?? ''));
        const tcMin =
          !isNaN(rawMinTc) && rawMinTc > 0
            ? Number(rawMinTc.toFixed(2))
            : tfMin > 0
              ? Number(estimateConductorTempFromFiber(tfMin, (pCkt3 || 35) * 0.8, category, secId).toFixed(2))
              : 0;

        const rawPh = String(row.Phase || '').trim();
        let phaseLabel = category === 'land' ? 'Phase A' : 'Submarine (CH 3)';
        if (/^(Phase\s*)?A$/i.test(rawPh)) phaseLabel = 'Phase A';
        else if (/^(Phase\s*)?B$/i.test(rawPh)) phaseLabel = 'Phase B';
        else if (/^(Phase\s*)?C$/i.test(rawPh)) phaseLabel = 'Phase C';
        else if (/^(SM|Submarine)/i.test(rawPh)) phaseLabel = 'Submarine (CH 3)';
        else if (rawPh) phaseLabel = rawPh;

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
      if (records.length <= 1500) {
        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(records));
      } else {
        localStorage.removeItem(STORAGE_KEY_DATA);
      }
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
  memoryRecordsByDate.clear();
  memoryRecordsBySectionDate.clear();
  memoryCircuitPeaksByDate.clear();

  try {
    localStorage.removeItem(STORAGE_KEY_CONFIG);
    localStorage.removeItem(STORAGE_KEY_DATA);
  } catch (e) {}

  notifyListeners();
}

/**
 * Get all records for a specific date across all sections (O(1) lookup + automatic DOF hydration for historical dates)
 */
export function getOrgRecordsForDate(dateKey: string): OrgDatabaseRecord[] {
  initFromStorage();
  const list = memoryRecordsByDate.get(dateKey) || [];
  if (list.length > 0 && (!list[0].dofTfMax || Object.keys(list[0].dofTfMax).length === 0)) {
    void fetchPanel1DofsForDate(dateKey);
  }
  return list;
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
    let dateIdx = header.findIndex((c) => c === 'date' || c.includes('date') || c.includes('day'));
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

    let ckt3Idx = header.findIndex((c) => (c.includes('ckt3') || c.includes('circuit #3') || c.includes('circuit 3') || c.includes('03yb01')) && !c.includes('daily_peak') && !c.includes('peak_time'));
    let ckt2Idx = header.findIndex((c) => (c.includes('ckt2') || c.includes('circuit #2') || c.includes('circuit 2') || c.includes('04yb01')) && !c.includes('daily_peak') && !c.includes('peak_time'));
    let nktIdx = header.findIndex((c) => (c.includes('nkt') || c.includes('07wb01')) && !c.includes('daily_peak') && !c.includes('peak_time'));
    let oilIdx = header.findIndex((c) => (c.includes('oil') || c.includes('10wb01')) && !c.includes('daily_peak') && !c.includes('peak_time'));
    let totalIdx = header.findIndex((c) => c.includes('total') || c.includes('island'));
    let peakTimeIdx = header.findIndex((c) => (c === 'peak_time' || c.includes('peak_time') || c.includes('time')) && !c.includes('ckt') && !c.includes('nkt') && !c.includes('oil'));
    let fileSrcIdx = header.findIndex((c) => c.includes('source') || c.includes('file'));

    // Columns I to P (indices 8 to 15) for 16-column format
    let ckt3DailyIdx = header.findIndex((c) => c.includes('ckt3_daily_peak'));
    let ckt2DailyIdx = header.findIndex((c) => c.includes('ckt2_daily_peak'));
    let nktDailyIdx = header.findIndex((c) => c.includes('nkt_daily_peak'));
    let oilDailyIdx = header.findIndex((c) => c.includes('oil_daily_peak'));
    let ckt3TimeIdx = header.findIndex((c) => c.includes('ckt3_peak_time'));
    let ckt2TimeIdx = header.findIndex((c) => c.includes('ckt2_peak_time'));
    let nktTimeIdx = header.findIndex((c) => c.includes('nkt_peak_time'));
    let oilTimeIdx = header.findIndex((c) => c.includes('oil_peak_time'));

    if (dateIdx === -1) dateIdx = 0;
    if (ckt3Idx === -1) ckt3Idx = 1;
    if (ckt2Idx === -1) ckt2Idx = 2;
    if (nktIdx === -1) nktIdx = 3;
    if (oilIdx === -1) oilIdx = 4;
    if (totalIdx === -1 && header.length > 5) totalIdx = 5;
    if (peakTimeIdx === -1 && header.length > 6) peakTimeIdx = 6;
    if (fileSrcIdx === -1 && header.length > 7) fileSrcIdx = 7;
    if (ckt3DailyIdx === -1) ckt3DailyIdx = 8;
    if (ckt2DailyIdx === -1) ckt2DailyIdx = 9;
    if (nktDailyIdx === -1) nktDailyIdx = 10;
    if (oilDailyIdx === -1) oilDailyIdx = 11;
    if (ckt3TimeIdx === -1) ckt3TimeIdx = 12;
    if (ckt2TimeIdx === -1) ckt2TimeIdx = 13;
    if (nktTimeIdx === -1) nktTimeIdx = 14;
    if (oilTimeIdx === -1) oilTimeIdx = 15;

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

      const hasExtendedCols = parts.length >= 12;
      const ckt3AtPeak = Number((ckt3Idx >= 0 && parts[ckt3Idx] ? parseFloat(parts[ckt3Idx]) || 0 : 0).toFixed(2));
      const ckt2AtPeak = Number((ckt2Idx >= 0 && parts[ckt2Idx] ? parseFloat(parts[ckt2Idx]) || 0 : 0).toFixed(2));
      const nktAtPeak = Number((nktIdx >= 0 && parts[nktIdx] ? parseFloat(parts[nktIdx]) || 0 : 0).toFixed(2));
      const oilAtPeak = Number((oilIdx >= 0 && parts[oilIdx] ? parseFloat(parts[oilIdx]) || 0 : 0).toFixed(2));
      const sumAtPeak = Number((ckt3AtPeak + ckt2AtPeak + nktAtPeak + oilAtPeak).toFixed(2));
      const rawTotal = totalIdx >= 0 && parts[totalIdx] ? parseFloat(parts[totalIdx]) || 0 : 0;

      // Column F: Total Island Max (coincident 15-min interval peak)
      const total = hasExtendedCols
        ? sumAtPeak > 0
          ? sumAtPeak
          : Number(rawTotal.toFixed(2))
        : rawTotal > 0
        ? Number(rawTotal.toFixed(2))
        : sumAtPeak;

      const peakTime = (peakTimeIdx >= 0 && parts[peakTimeIdx]) || '00:00';
      const fileSource = (fileSrcIdx >= 0 && parts[fileSrcIdx]) || fileName;

      // Columns I to L: Individual circuit daily peaks
      const ckt3Daily = hasExtendedCols
        ? Number(((parts[ckt3DailyIdx] ? parseFloat(parts[ckt3DailyIdx]) : 0) || ckt3AtPeak).toFixed(2))
        : ckt3AtPeak;
      const ckt2Daily = hasExtendedCols
        ? Number(((parts[ckt2DailyIdx] ? parseFloat(parts[ckt2DailyIdx]) : 0) || ckt2AtPeak).toFixed(2))
        : ckt2AtPeak;
      const nktDaily = hasExtendedCols
        ? Number(((parts[nktDailyIdx] ? parseFloat(parts[nktDailyIdx]) : 0) || nktAtPeak).toFixed(2))
        : nktAtPeak;
      const oilDaily = hasExtendedCols
        ? Number(((parts[oilDailyIdx] ? parseFloat(parts[oilDailyIdx]) : 0) || oilAtPeak).toFixed(2))
        : oilAtPeak;

      const ckt3PeakTime = (hasExtendedCols && parts[ckt3TimeIdx]) || peakTime;
      const ckt2PeakTime = (hasExtendedCols && parts[ckt2TimeIdx]) || peakTime;
      const nktPeakTime = (hasExtendedCols && parts[nktTimeIdx]) || peakTime;
      const oilPeakTime = (hasExtendedCols && parts[oilTimeIdx]) || peakTime;

      const peak: CircuitDailyPeakPower = {
        date: formattedDate,
        year: formattedDate.slice(0, 4),
        monthDay: formattedDate.slice(5),
        ckt3MaxMW: ckt3Daily,
        ckt2MaxMW: ckt2Daily,
        nkt33MaxMW: nktDaily,
        oil33MaxMW: oilDaily,
        totalIslandMaxMW: total,
        fiberMaxTempC: 0,
        peakTime,
        fileSource,
        ckt3AtPeakMW: ckt3AtPeak,
        ckt2AtPeakMW: ckt2AtPeak,
        nkt33AtPeakMW: nktAtPeak,
        oil33AtPeakMW: oilAtPeak,
        ckt3DailyPeakMW: ckt3Daily,
        ckt2DailyPeakMW: ckt2Daily,
        nkt33DailyPeakMW: nktDaily,
        oil33DailyPeakMW: oilDaily,
        ckt3PeakTime,
        ckt2PeakTime,
        nkt33PeakTime: nktPeakTime,
        oil33PeakTime: oilPeakTime,
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
        const ckt3 = Number((nums[0] !== undefined ? nums[0] : 35).toFixed(2));
        const ckt2 = Number((nums[1] !== undefined ? nums[1] : 30).toFixed(2));
        const nkt = Number((nums[2] !== undefined ? nums[2] : 12).toFixed(2));
        const oil = Number((nums[3] !== undefined ? nums[3] : 10).toFixed(2));
        const sumFour = Number((ckt3 + ckt2 + nkt + oil).toFixed(2));
        const rawTotal = nums[4] !== undefined ? nums[4] : sumFour;
        const total = sumFour > 0 ? sumFour : Number(rawTotal.toFixed(2));

        const peak: CircuitDailyPeakPower = {
          date: formattedDate,
          year: yr,
          monthDay: `${mo}-${da}`,
          ckt3MaxMW: ckt3,
          ckt2MaxMW: ckt2,
          nkt33MaxMW: nkt,
          oil33MaxMW: oil,
          totalIslandMaxMW: total,
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
    memorySectionProfileAllDates = Array.from(datesSet).sort();
    rebuildSectionProfileIndexes();

    const sortedDates = memorySectionProfileDates;

    try {
      localStorage.setItem(STORAGE_KEY_SECTION_PROFILE_DATES, JSON.stringify(sortedDates));
      localStorage.removeItem(STORAGE_KEY_SECTION_PROFILES);
    } catch (e) {
      // Ignore quota
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
    memoryPanel3StatsSummary = buildPanel3StatsFromHourlyRecords(records);
    void idbSet('panel3_stats', memoryPanel3StatsSummary);
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
  if (memorySectionProfileDates.length > 0) {
    return memorySectionProfileDates;
  }
  if (memorySectionProfileAllDates.length > 0) {
    return memorySectionProfileAllDates;
  }
  if (memoryConfig?.availableDates && memoryConfig.availableDates.length > 0) {
    return memoryConfig.availableDates;
  }
  if (memoryCircuitPeaksByDate.size > 0) {
    return Array.from(memoryCircuitPeaksByDate.keys()).sort();
  }
  return [];
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
    await fetch('/api/scan-and-sync-public-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel1Url: url }),
    }).catch(() => null);

    const cachedDb = await fetchSharedServerDefaultDatabases(true);
    const p1 = cachedDb?.panel1;
    if (
      p1 &&
      Array.isArray(p1.records) &&
      p1.records.length > 0 &&
      p1.config &&
      (url.includes('1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS') ||
        url.includes('1awYIr-GJNqlG5clQa6C12_XMJ_mQRbce') ||
        url.includes('1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N') ||
        p1.info?.remoteUrl === url)
    ) {
      memoryConfig = p1.config;
      memoryRecords = p1.records;
      savedDefaultPanel1 = p1;
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
      } catch {}
      void idbSet('panel1', p1);
      rebuildIndexes();
      const fileName =
        p1.info?.name ||
        p1.config.databaseFileName ||
        'DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-23.xlsx';
      const info: DataPanelSourceInfo = {
        ...(p1.info || {}),
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
    await fetch('/api/scan-and-sync-public-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel2Url: url }),
    }).catch(() => null);

    const cachedDb = await fetchSharedServerDefaultDatabases(true);
    const p2 = cachedDb?.panel2;
    if (
      p2 &&
      Array.isArray(p2.peaks) &&
      p2.peaks.length > 0 &&
      (url.includes('1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6') ||
        url.includes('1RkqwwAwFjw4lF8YAA30hxLW1reYoqSE6') ||
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
      void idbSet('panel2', p2);
      rebuildIndexes();
      const sortedDates = p2.peaks.map((p: CircuitDailyPeakPower) => p.date).sort();
      const fileName =
        p2.info?.name ||
        'Daily_Maximum_Power_Consumption_Database_Updated_2025-07-31_to_2026-10-26.csv';
      const dateRange = p2.info?.dateRange || {
        firstDate: sortedDates[0] || '2021-11-28',
        latestDate: sortedDates[sortedDates.length - 1] || '2026-10-26',
      };
      const info: DataPanelSourceInfo = {
        ...(p2.info || {}),
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
    await fetch('/api/scan-and-sync-public-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel3Url: url }),
    }).catch(() => null);

    const fastRes = await fetch(`/api/fetch-shared-section-profiles?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : null))
      .catch(() => null);

    const cachedDb = await fetchSharedServerDefaultDatabases(true);
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
          latestDate: memorySectionProfileDates[memorySectionProfileDates.length - 1] || '2026-10-23',
        };
      const recordCount = fastRes?.recordCount || p3Cached?.info?.recordCount || totalDates * 744;
      const fileName =
        fastRes?.fileName ||
        p3Cached?.info?.name ||
        'DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-23.xlsx';

      const info: DataPanelSourceInfo = {
        ...(p3Cached?.info || {}),
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
        localStorage.setItem(STORAGE_KEY_SECTION_PROFILE_DATES, JSON.stringify(memorySectionProfileDates));
      } catch {}
      void idbSet('panel3', savedDefaultPanel3);
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
      localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(memoryPanel1Info));
    } catch (e) {}
    rebuildIndexes();
    notifyListeners();
    return;
  }

  hasStartedAsyncHydration = false;
  void hydrateFromPublicDefaultDatabases();
  void syncAllPublicSharedTargetFolders();
}

/**
 * Reset Panel 2 to the latest saved default uploaded file (or live Google Drive folder if none cached yet)
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

  hasStartedAsyncHydration = false;
  void hydrateFromPublicDefaultDatabases();
  void syncAllPublicSharedTargetFolders();
}

/**
 * Reset Panel 3 to the latest saved default uploaded file (or live Google Drive folder if none cached yet)
 */
export function resetPanel3ToSample(): void {
  if (savedDefaultPanel3 && savedDefaultPanel3.records.length > 0) {
    memorySectionProfileRecords = savedDefaultPanel3.records;
    if (Array.isArray(savedDefaultPanel3.allDates) && savedDefaultPanel3.allDates.length > 0) {
      memorySectionProfileAllDates = savedDefaultPanel3.allDates;
      memorySectionProfileDates = [...savedDefaultPanel3.allDates];
    }
    memoryPanel3Info = savedDefaultPanel3.info;
    rebuildSectionProfileIndexes();
    try {
      localStorage.setItem(STORAGE_KEY_SECTION_PROFILE_DATES, JSON.stringify(memorySectionProfileDates));
      localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(memoryPanel3Info));
    } catch (e) {}
    notifyListeners();
    return;
  }

  hasStartedAsyncHydration = false;
  void hydrateFromPublicDefaultDatabases();
  void syncAllPublicSharedTargetFolders();
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
    fileId: '1GQUwUGgFliauqXJd2reNsUT9ArifUDen',
    fileName: 'DTS_Circuit3_19Sheets_Updated_2021-11-28_to_2026-10-26.xlsx',
    format: 'xlsx',
  },
  // Folder 2: 4-Circuit Power Record
  '1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6': {
    fileId: '1H2JhkJ1y_ZsZDksIko6AMKwM40zIfhyD',
    fileName: 'Daily_Maximum_Power_Consumption_Database_Updated_2025-07-31_to_2026-10-26.csv',
    format: 'csv',
  },
  // Folder 3: 24-Hour Section Profile
  '15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_': {
    fileId: '1jhWEfxnurZ32G-ck9Tw8Ob_S7EJ7mKay',
    fileName: 'DTS_Section_Daily_Profile_19Sheets_Updated_2021-11-28_to_2026-10-26.xlsx',
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

  onProgress?.(4, 'Connecting to Telemetry Cache & Scanning 3 Shared Google Drive Folders...');
  await new Promise((r) => setTimeout(r, 10));

  // 0. Always check the 3 shared Google Drive folders first for any newly uploaded or updated files
  let scanResult: any = null;
  let scanTicker: ReturnType<typeof setInterval> | null = null;
  try {
    let tickPct = 5;
    scanTicker = setInterval(() => {
      if (tickPct < 11) {
        tickPct += 1;
        onProgress?.(
          tickPct,
          'Checking & Pulling Latest Database Files from 3 Shared Google Drive Folders...'
        );
      }
    }, 1200);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const scanRes = await fetch(`/api/scan-and-sync-public-folders?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        panel1Url: links.panel1Url,
        panel2Url: links.panel2Url,
        panel3Url: links.panel3Url,
        token: accessToken,
      }),
    });
    clearTimeout(timeoutId);
    if (scanTicker) {
      clearInterval(scanTicker);
      scanTicker = null;
    }

    if (scanRes.ok && (scanRes.headers.get('content-type') || '').includes('application/json')) {
      scanResult = await scanRes.json();
      if (scanResult?.changesDetected || scanResult?.anyUpdated) {
        const changedNames = [
          scanResult.panel1?.changed ? scanResult.panel1.fileName : null,
          scanResult.panel2?.changed ? scanResult.panel2.fileName : null,
          scanResult.panel3?.changed ? scanResult.panel3.fileName : null,
        ].filter(Boolean);
        onProgress?.(
          12,
          `Detected & downloaded new database file(s): ${changedNames.join(', ')}`
        );
      } else {
        onProgress?.(11, 'Verified all 3 Google Drive Shared Folders are on the latest version...');
      }
    }
  } catch (scanErr) {
    if (scanTicker) {
      clearInterval(scanTicker);
      scanTicker = null;
    }
    console.warn('Live folder scan warning (using server/cached databases):', scanErr);
  }

  // Always fetch the fresh server database AFTER the 3-folder scan completes
  const cachedServerDb = await fetchSharedServerDefaultDatabases(true);

  let needsIndexRebuild = false;

  // 1. Panel 1: Daily Peak Temperature (12% - 35%)
  if (links.panel1Url) {
    try {
      onProgress?.(16, 'Energizing Folder 1: Reading 19-Section Daily Peak Temperature...');
      const p1Cached = cachedServerDb?.panel1;
      if (
        p1Cached &&
        Array.isArray(p1Cached.records) &&
        p1Cached.records.length > 0 &&
        p1Cached.config
      ) {
        const p1TotalRecords = p1Cached.config.totalRecords || p1Cached.records.length;
        const p1TotalDates = p1Cached.config.totalDates;
        onProgress?.(
          26,
          `Indexing ${p1TotalRecords.toLocaleString()} Section Records across ${p1TotalDates} Dates (Folder 1)...`
        );
        memoryConfig = p1Cached.config;
        memoryRecords = p1Cached.records;
        savedDefaultPanel1 = p1Cached;
        loadedPanel1DofDates.clear();
        needsIndexRebuild = true;
        try {
          localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(memoryConfig));
        } catch {}
        void idbSet('panel1', p1Cached);

        onProgress?.(32, 'Synchronizing Heat Map (2.1) & Section Peak telemetry...');
        const p1Info: DataPanelSourceInfo = {
          ...(p1Cached.info || {}),
          sourceType: 'googledrive',
          name:
            p1Cached.info?.name ||
            p1Cached.config.databaseFileName ||
            'DTS_Circuit3_19Sheets_Updated_2021-11-28_to_2026-10-26.xlsx',
          remoteUrl: links.panel1Url,
          updatedAt: p1Cached.info?.updatedAt || new Date().toISOString(),
          totalDates: p1Cached.config.totalDates,
          dateRange: p1Cached.config.dateRange,
          recordCount: p1TotalRecords,
        };
        memoryPanel1Info = p1Info;
        try {
          localStorage.setItem(STORAGE_KEY_PANEL1_INFO, JSON.stringify(p1Info));
        } catch {}
        result.panel1 = {
          success: true,
          count: p1TotalRecords || p1TotalDates,
          name: p1Info.name,
        };
      }
    } catch (e: any) {
      result.panel1 = { success: false, count: 0, error: formatErrorMessage(e) };
    }
  }
  onProgress?.(35, 'Shared Folder 1 Synchronized (100%)');

  // 2. Panel 2: 4-Circuit Power Record (36% - 65%)
  if (links.panel2Url) {
    try {
      onProgress?.(44, 'Energizing Folder 2: Reading 4-Circuit Submarine Power Load...');
      const p2Cached = cachedServerDb?.panel2;
      if (p2Cached && Array.isArray(p2Cached.peaks) && p2Cached.peaks.length > 0) {
        onProgress?.(
          54,
          `Indexing ${p2Cached.peaks.length} Dates of 115kV Ckt #3, Ckt #2, 33kV NKT & Oil-Filled MW (Folder 2)...`
        );
        memoryPowerPeaksOnly.clear();
        p2Cached.peaks.forEach((pk: CircuitDailyPeakPower) => {
          const c3 = Number((pk.ckt3MaxMW ?? 0).toFixed(2));
          const c2 = Number((pk.ckt2MaxMW ?? 0).toFixed(2));
          const nk = Number((pk.nkt33MaxMW ?? 0).toFixed(2));
          const oi = Number((pk.oil33MaxMW ?? 0).toFixed(2));
          const sumAtPeak = Number(
            (
              (pk.ckt3AtPeakMW ?? c3) +
              (pk.ckt2AtPeakMW ?? c2) +
              (pk.nkt33AtPeakMW ?? nk) +
              (pk.oil33AtPeakMW ?? oi)
            ).toFixed(2)
          );
          const rawTot = Number((pk.totalIslandMaxMW || 0).toFixed(2));
          const normalizedPk: CircuitDailyPeakPower = {
            ...pk,
            ckt3MaxMW: c3,
            ckt2MaxMW: c2,
            nkt33MaxMW: nk,
            oil33MaxMW: oi,
            totalIslandMaxMW: rawTot > 0 ? rawTot : sumAtPeak,
          };
          memoryPowerPeaksOnly.set(pk.date, normalizedPk);
          memoryCircuitPeaksByDate.set(pk.date, normalizedPk);
        });
        savedDefaultPanel2 = p2Cached;
        needsIndexRebuild = true;
        try {
          localStorage.setItem(STORAGE_KEY_POWER_PEAKS, JSON.stringify(p2Cached.peaks));
        } catch {}
        void idbSet('panel2', p2Cached);

        onProgress?.(62, 'Synchronizing 4-Circuit Yearly Comparison (2.4)...');
        const sortedP2Dates = p2Cached.peaks.map((p: CircuitDailyPeakPower) => p.date).sort();
        const p2Info: DataPanelSourceInfo = {
          ...(p2Cached.info || {}),
          sourceType: 'googledrive',
          name:
            p2Cached.info?.name ||
            'Daily_Maximum_Power_Consumption_Database_Updated_2025-07-31_to_2026-10-26.csv',
          remoteUrl: links.panel2Url,
          updatedAt: p2Cached.info?.updatedAt || new Date().toISOString(),
          totalDates: p2Cached.peaks.length,
          dateRange: p2Cached.info?.dateRange || {
            firstDate: sortedP2Dates[0] || '2021-11-28',
            latestDate: sortedP2Dates[sortedP2Dates.length - 1] || '2026-10-26',
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
      }
    } catch (e: any) {
      result.panel2 = { success: false, count: 0, error: formatErrorMessage(e) };
    }
  }

  if (needsIndexRebuild) {
    await new Promise((r) => setTimeout(r, 10));
    rebuildIndexes();
  }

  onProgress?.(65, 'Shared Folder 2 Synchronized (100%)');

  // 3. Panel 3: Section Daily Profile (66% - 96%)
  if (links.panel3Url) {
    try {
      onProgress?.(74, 'Energizing Folder 3: Fetching 24-Hour Section Daily Profile...');
      const p3Cached = cachedServerDb?.panel3;

      let recordsToUse: OrgSectionHourlyRecord[] =
        p3Cached && Array.isArray(p3Cached.records) && p3Cached.records.length > 0
          ? p3Cached.records
          : [];

      let allDatesToUse: string[] =
        p3Cached && Array.isArray(p3Cached.allDates) && p3Cached.allDates.length > 0
          ? p3Cached.allDates
          : p3Cached && Array.isArray(p3Cached.dates) && p3Cached.dates.length > 0
            ? p3Cached.dates
            : [];

      // If cachedServerDb didn't include Panel 3 records, query the dedicated fast endpoint
      if (recordsToUse.length === 0 || allDatesToUse.length === 0) {
        const fastRes = await fetch(
          `/api/fetch-shared-section-profiles?url=${encodeURIComponent(links.panel3Url)}&t=${Date.now()}`,
          { cache: 'no-store' }
        )
          .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : null))
          .catch(() => null);
        if (fastRes?.success) {
          if (Array.isArray(fastRes.records) && fastRes.records.length > 0) {
            recordsToUse = fastRes.records;
          }
          if (Array.isArray(fastRes.allDates) && fastRes.allDates.length > 0) {
            allDatesToUse = fastRes.allDates;
          }
        }
      }

      if (allDatesToUse.length === 0 && memoryConfig?.availableDates?.length) {
        allDatesToUse = [...memoryConfig.availableDates];
      }

      if (recordsToUse.length > 0 || allDatesToUse.length > 0) {
        onProgress?.(85, 'Indexing 24-Hour Section Curves & Ckt #3 MW across 19 Sections (Folder 3)...');
        await new Promise((r) => setTimeout(r, 10));

        fetchingDates.clear();
        if (recordsToUse.length > 0) {
          memorySectionProfileRecords = recordsToUse;
        }
        if (allDatesToUse.length > 0) {
          memorySectionProfileAllDates = allDatesToUse;
          memorySectionProfileDates = [...allDatesToUse];
        }
        rebuildSectionProfileIndexes();

        onProgress?.(91, 'Synchronizing Daily Curve (2.2) & 3D Thermal Surface (2.3)...');

        // Also pre-load or compute the full 484-date Panel 3 Statistics Summary for Page 2.5 & Page 2.6
        onProgress?.(94, 'Pre-calculating Temperature (2.5) & Power Operating Condition (2.6) Statistics...');
        if (p3Cached?.stats && Array.isArray(p3Cached.stats.dates) && p3Cached.stats.dates.length > 0) {
          memoryPanel3StatsSummary = p3Cached.stats;
          void idbSet('panel3_stats', p3Cached.stats);
        } else {
          await ensurePanel3StatisticsSummaryLoaded(true);
        }

        const totalDatesCount =
          allDatesToUse.length ||
          p3Cached?.info?.totalDates ||
          memorySectionProfileDates.length;

        const defaultP3Info: DataPanelSourceInfo = {
          ...(p3Cached?.info || {}),
          sourceType: 'googledrive',
          name:
            p3Cached?.info?.name ||
            'DTS_Section_Daily_Profile_19Sheets_Updated_2021-11-28_to_2026-10-26.xlsx',
          remoteUrl: links.panel3Url,
          updatedAt: p3Cached?.info?.updatedAt || new Date().toISOString(),
          totalDates: totalDatesCount,
          dateRange: p3Cached?.info?.dateRange || {
            firstDate: memorySectionProfileDates[0] || '2021-11-28',
            latestDate: memorySectionProfileDates[memorySectionProfileDates.length - 1] || '2026-10-26',
          },
          recordCount:
            p3Cached?.info?.recordCount ||
            totalDatesCount * 744,
        };

        savedDefaultPanel3 = {
          records: memorySectionProfileRecords,
          allDates: memorySectionProfileDates,
          info: defaultP3Info,
          stats: memoryPanel3StatsSummary || undefined,
        };
        memoryPanel3Info = defaultP3Info;
        try {
          localStorage.setItem(STORAGE_KEY_PANEL3_INFO, JSON.stringify(defaultP3Info));
          if (memorySectionProfileDates.length > 0) {
            localStorage.setItem(STORAGE_KEY_SECTION_PROFILE_DATES, JSON.stringify(memorySectionProfileDates));
          }
        } catch {}
        void idbSet('panel3', savedDefaultPanel3);

        result.panel3 = {
          success: true,
          count: totalDatesCount,
          name: defaultP3Info.name,
        };
      }
    } catch (e: any) {
      result.panel3 = { success: false, count: 0, error: formatErrorMessage(e) };
    }
  }
  onProgress?.(97, 'Shared Folder 3 Synchronized (100%)');

  // 4. Finalization & listener notification: (98% - 100%)
  onProgress?.(99, 'Finalizing Public Dashboard Views [2.1, 2.2, 2.3, 2.4, 2.5, 2.6]...');
  notifyListeners();
  await new Promise((r) => setTimeout(r, 30));

  result.totalLoaded =
    (result.panel1.success ? result.panel1.count : 0) +
    (result.panel2.success ? result.panel2.count : 0) +
    (result.panel3.success ? result.panel3.count : 0);

  result.success = result.panel1.success || result.panel2.success || result.panel3.success;

  const successfulPanels: string[] = [];
  if (result.panel1.success) successfulPanels.push(`Panel 1 (${result.panel1.count.toLocaleString()} temp records)`);
  if (result.panel2.success) successfulPanels.push(`Panel 2 (${result.panel2.count} dates)`);
  if (result.panel3.success) successfulPanels.push(`Panel 3 (${result.panel3.count} dates)`);

  if (result.success) {
    const updatePrefix = scanResult?.anyUpdated ? 'Detected & auto-downloaded updated Google Drive files! ' : '';
    result.message = `${updatePrefix}Successfully loaded data from shared folders: ${successfulPanels.join(', ')}.`;
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
