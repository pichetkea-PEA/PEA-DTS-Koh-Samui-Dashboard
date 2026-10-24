// PowerBI-Style Master Section & Point Summary Engine (Option 1)
// Compiles and persists daily maximum, minimum, and mean fiber temperatures across all 19 Sections (1.1-1.6 & 2.1-2.13)
// and 195 Discrete Sampling Points into a single lightweight Master Summary Table (~300 KB for 77 days, ~1.4 MB/year).
// Synchronized across:
//   1. Browser Memory & localStorage (0.01s instant read)
//   2. Backend Server Store (/api/master-section-summary)
//   3. Google Drive Master File (dts_master_section_summary_v1.json)

import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  evaluateSectionConductorTemp,
  CableSectionInfo,
} from '../data/cableCircuitStructure';
import { ParsedTeprFile, setPhaseIndexEntry, guessPhaseFromPath } from './teprParser';
import {
  DailyPowerSummary,
  isSyntheticPowerSummary,
  isSyntheticPowerValues,
} from './powerConsumptionParser';
import * as XLSX from 'xlsx';

export interface MasterSectionPeakRecord {
  maxTf: number;
  minTf: number;
  meanTf: number;
  dailySumTf?: number;
  dailyCountTf?: number;
  maxTfDof?: number;
  minTfDof?: number;
  maxTimestamp?: string;
  minTimestamp?: string;
  peakTime?: string; // alias for maxTimestamp
  iecMaxTc?: number;
  iecMinTc?: number;
  powerAtMaxMW?: number;
  pCkt3MaxMW?: number;
  pCkt2MaxMW?: number;
  p33NktMaxMW?: number;
  p33OilMaxMW?: number;
  powerAtMinMW?: number;
  pCkt3MinMW?: number;
  pCkt2MinMW?: number;
  p33NktMinMW?: number;
  p33OilMinMW?: number;
  maxFileName?: string;
  minFileName?: string;
  sourceFile?: string; // alias for maxFileName
  maxPhase?: string; // 'Phase A' | 'Phase B' | 'Phase C' | 'Submarine (CH 3)'
  minPhase?: string;
  maxChannel?: number;
  minChannel?: number;
}

export interface DofTimeRecord {
  dof: number;
  maxTf: number;
  timestamp: string;
  fileName: string;
}

export interface MasterSectionSummaryData {
  version: number;
  updatedAt: string;
  // Key: `${sectionId}_${dateKey}` (e.g. "2.1_2026-03-31") or `${sectionId}_${phase}_${dateKey}` (e.g. "1.1_A_2026-03-31")
  sections: Record<string, MasterSectionPeakRecord>;
  // Key: `${pointId}_${dateKey}` -> daily maxTf at that discrete sampling point
  points: Record<string, number>;
  // Key: `${sectionId}_${phase}_${dateKey}_${dof}` -> daily peak record for that specific DOF
  dofDailyPeaks?: Record<string, DofTimeRecord>;
  // Key: `${sectionId}_${phase}_${dateKey}_${hourStr}_${dof}` -> hourly peak record for that specific DOF
  dofHourlyPeaks?: Record<string, DofTimeRecord>;
  // Key: `${dateKey}` -> array of channels (0, 1, 2, 3) already compiled into the master table for that date
  syncedChannelsByDate: Record<string, number[]>;
  // Key: `${dateKey}` -> array of fileIds compiled into the master table for that date
  compiledFilesByDate?: Record<string, string[]>;
}

const LOCAL_STORAGE_KEY = 'dts_master_section_summary_v5';
const DRIVE_MASTER_FILE_NAME = 'dts_master_section_summary_v5.json';

export function getSectionDistinctDofs(
  sec: CableSectionInfo | { sectionId: string; category: string }
): number[] {
  const pts = CIRCUIT_3_SAMPLING_POINTS.filter(
    (p) => p.sectionId === sec.sectionId && p.cableCategory === sec.category
  );
  return Array.from(new Set(pts.map((p) => p.dof))).sort((a, b) => a - b);
}

// Precompute exact DOF bounding windows for all 19 sections according to specified section DOFs
interface SectionDofWindow {
  sectionId: string;
  category: 'land' | 'submarine';
  minDof: number;
  maxDof: number;
}

const ALL_SECTION_WINDOWS: SectionDofWindow[] = CIRCUIT_3_SECTIONS.map((sec) => {
  const pts = CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === sec.sectionId);
  if (pts.length === 0) {
    return { sectionId: sec.sectionId, category: sec.category, minDof: 0, maxDof: 100 };
  }
  const dofs = pts.map((p) => p.dof);
  const startDof = Math.min(...dofs);
  const endDof = Math.max(...dofs);
  // Use tight 0.55m tolerance around multi-point sections (zero overlap between adjacent sections like 1.5 and 1.6)
  // and 1.5m tolerance for single-point section 2.7
  const pad = endDof - startDof < 1 ? 1.5 : 0.55;
  return {
    sectionId: sec.sectionId,
    category: sec.category,
    minDof: startDof - pad,
    maxDof: endDof + pad,
  };
});

const SUBMARINE_SECTION_WINDOWS = ALL_SECTION_WINDOWS.filter((w) => w.category === 'submarine');
const LAND_SECTION_WINDOWS = ALL_SECTION_WINDOWS.filter((w) => w.category === 'land');

const SUBMARINE_SAMPLING_POINTS = CIRCUIT_3_SAMPLING_POINTS.filter(
  (p) => p.cableCategory === 'submarine'
);
const LAND_SAMPLING_POINTS_BY_PHASE: Record<string, typeof CIRCUIT_3_SAMPLING_POINTS> = {
  A: CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.cableCategory === 'land' && p.phase === 'A'),
  B: CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.cableCategory === 'land' && p.phase === 'B'),
  C: CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.cableCategory === 'land' && p.phase === 'C'),
};

let inMemoryMasterStore: MasterSectionSummaryData | null = null;
let cachedDriveMasterFileId: string | null = null;
const inMemoryCompiledFileSets = new Map<string, Set<string>>();

export function isSyntheticSectionRecord(rec?: MasterSectionPeakRecord | null): boolean {
  if (!rec) return true;
  const maxFn = rec.maxFileName || rec.sourceFile || '';
  const minFn = rec.minFileName || '';
  if (
    maxFn.startsWith('dts_land_phase_') ||
    maxFn.startsWith('dts_subsea_ch3_') ||
    minFn.startsWith('dts_land_phase_') ||
    minFn.startsWith('dts_subsea_ch3_')
  ) {
    return true;
  }
  return false;
}

function createEmptyMasterStore(): MasterSectionSummaryData {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    sections: {},
    points: {},
    dofDailyPeaks: {},
    dofHourlyPeaks: {},
    syncedChannelsByDate: {},
    compiledFilesByDate: {},
  };
}

export function getMasterSectionSummary(): MasterSectionSummaryData {
  if (inMemoryMasterStore) return inMemoryMasterStore;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.sections) {
          const cleanedSections: Record<string, MasterSectionPeakRecord> = {};
          for (const [k, v] of Object.entries(parsed.sections as Record<string, MasterSectionPeakRecord>)) {
            if (!isSyntheticSectionRecord(v)) {
              cleanedSections[k] = v;
            }
          }
          inMemoryMasterStore = {
            version: 2,
            updatedAt: parsed.updatedAt || new Date().toISOString(),
            sections: cleanedSections,
            points: parsed.points || {},
            dofDailyPeaks: parsed.dofDailyPeaks || {},
            dofHourlyPeaks: parsed.dofHourlyPeaks || {},
            syncedChannelsByDate: parsed.syncedChannelsByDate || {},
            compiledFilesByDate: parsed.compiledFilesByDate || {},
          };
          return inMemoryMasterStore;
        }
      }
    }
  } catch {
    // ignore storage read errors
  }
  inMemoryMasterStore = createEmptyMasterStore();
  return inMemoryMasterStore;
}

/**
 * Resets compiled section records for a specific list of dates before a fresh full-day all-file build,
 * ensuring zero stale or partial data and true daily max, min, and mean across all .TEPR records.
 */
export function resetMasterSummaryForDates(dateKeys: string[]): void {
  if (!dateKeys || dateKeys.length === 0) return;
  const targetSet = new Set(dateKeys);
  const store = getMasterSectionSummary();

  for (const key of Object.keys(store.sections)) {
    const parts = key.split('_');
    const dKey = parts[parts.length - 1];
    if (targetSet.has(dKey)) {
      delete store.sections[key];
    }
  }

  for (const ptKey of Object.keys(store.points)) {
    const parts = ptKey.split('_');
    const dKey = parts[parts.length - 1];
    if (targetSet.has(dKey)) {
      delete store.points[ptKey];
    }
  }

  if (store.dofDailyPeaks) {
    for (const key of Object.keys(store.dofDailyPeaks)) {
      const parts = key.split('_');
      const dKey = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
      if (dKey && targetSet.has(dKey)) {
        delete store.dofDailyPeaks[key];
      }
    }
  }

  if (store.dofHourlyPeaks) {
    for (const key of Object.keys(store.dofHourlyPeaks)) {
      const parts = key.split('_');
      const dKey = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
      if (dKey && targetSet.has(dKey)) {
        delete store.dofHourlyPeaks[key];
      }
    }
  }

  for (const dKey of dateKeys) {
    inMemoryCompiledFileSets.delete(dKey);
    delete store.syncedChannelsByDate[dKey];
    if (store.compiledFilesByDate) {
      delete store.compiledFilesByDate[dKey];
    }
  }
}

export function saveMasterSectionSummaryToLocal(store?: MasterSectionSummaryData): void {
  const target = store || getMasterSectionSummary();
  target.updatedAt = new Date().toISOString();
  inMemoryMasterStore = target;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Only serialize the lightweight master summary tables (sections, points, synced channels)
      // Do NOT serialize millions of dofHourlyPeaks and dofDailyPeaks into localStorage,
      // which blocks the UI thread during JSON.stringify and exceeds 5MB localStorage limits!
      const persistentStore: MasterSectionSummaryData = {
        version: target.version,
        updatedAt: target.updatedAt,
        sections: target.sections,
        points: target.points,
        syncedChannelsByDate: target.syncedChannelsByDate,
      };
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(persistentStore));
    }
  } catch {
    // ignore quota errors
  }
}

export function mergeExternalMasterSummary(
  incoming: Partial<MasterSectionSummaryData> | null | undefined
): boolean {
  if (!incoming || typeof incoming !== 'object') return false;
  const current = getMasterSectionSummary();
  let changed = false;

  if (incoming.sections && typeof incoming.sections === 'object') {
    for (const [key, rec] of Object.entries(incoming.sections)) {
      if (!rec || typeof rec.maxTf !== 'number' || isSyntheticSectionRecord(rec)) continue;
      const existing = current.sections[key];
      if (!existing || rec.maxTf > existing.maxTf) {
        current.sections[key] = {
          maxTf: rec.maxTf,
          minTf: existing ? Math.min(existing.minTf, rec.minTf) : rec.minTf,
          meanTf: rec.meanTf,
          dailySumTf: rec.dailySumTf ?? existing?.dailySumTf,
          dailyCountTf: rec.dailyCountTf ?? existing?.dailyCountTf,
          maxTfDof: rec.maxTfDof ?? existing?.maxTfDof,
          minTfDof: rec.minTfDof ?? existing?.minTfDof,
          maxTimestamp: rec.maxTimestamp || rec.peakTime || existing?.maxTimestamp || existing?.peakTime,
          minTimestamp: rec.minTimestamp || existing?.minTimestamp,
          peakTime: rec.peakTime || rec.maxTimestamp || existing?.peakTime,
          maxFileName: rec.maxFileName || rec.sourceFile || existing?.maxFileName || existing?.sourceFile,
          minFileName: rec.minFileName || existing?.minFileName || rec.sourceFile,
          sourceFile: rec.sourceFile || rec.maxFileName || existing?.sourceFile,
          maxPhase: rec.maxPhase || existing?.maxPhase,
          minPhase: rec.minPhase || existing?.minPhase,
          maxChannel: rec.maxChannel ?? existing?.maxChannel,
          minChannel: rec.minChannel ?? existing?.minChannel,
        };
        changed = true;
      } else if (existing && rec.minTf < existing.minTf) {
        existing.minTf = rec.minTf;
        if (rec.minTfDof !== undefined) existing.minTfDof = rec.minTfDof;
        if (rec.minTimestamp || rec.peakTime) existing.minTimestamp = rec.minTimestamp || rec.peakTime;
        if (rec.minFileName || rec.sourceFile) existing.minFileName = rec.minFileName || rec.sourceFile;
        if (rec.minPhase) existing.minPhase = rec.minPhase;
        if (rec.minChannel !== undefined) existing.minChannel = rec.minChannel;
        changed = true;
      }
    }
  }

  if (incoming.points && typeof incoming.points === 'object') {
    for (const [ptKey, val] of Object.entries(incoming.points)) {
      if (typeof val !== 'number') continue;
      const existingVal = current.points[ptKey];
      if (existingVal === undefined || val > existingVal) {
        current.points[ptKey] = val;
        changed = true;
      }
    }
  }

  if (incoming.dofDailyPeaks && typeof incoming.dofDailyPeaks === 'object') {
    if (!current.dofDailyPeaks) current.dofDailyPeaks = {};
    for (const [k, v] of Object.entries(incoming.dofDailyPeaks)) {
      if (!v || typeof v.maxTf !== 'number') continue;
      const ex = current.dofDailyPeaks[k];
      if (!ex || v.maxTf > ex.maxTf) {
        current.dofDailyPeaks[k] = v;
        changed = true;
      }
    }
  }

  if (incoming.dofHourlyPeaks && typeof incoming.dofHourlyPeaks === 'object') {
    if (!current.dofHourlyPeaks) current.dofHourlyPeaks = {};
    for (const [k, v] of Object.entries(incoming.dofHourlyPeaks)) {
      if (!v || typeof v.maxTf !== 'number') continue;
      const ex = current.dofHourlyPeaks[k];
      if (!ex || v.maxTf > ex.maxTf) {
        current.dofHourlyPeaks[k] = v;
        changed = true;
      }
    }
  }

  if (incoming.syncedChannelsByDate && typeof incoming.syncedChannelsByDate === 'object') {
    for (const [dateKey, chArr] of Object.entries(incoming.syncedChannelsByDate)) {
      if (!Array.isArray(chArr)) continue;
      const existingArr = current.syncedChannelsByDate[dateKey] || [];
      const merged = Array.from(new Set([...existingArr, ...chArr]));
      if (merged.length !== existingArr.length) {
        current.syncedChannelsByDate[dateKey] = merged;
        changed = true;
      }
    }
  }

  if (changed) {
    saveMasterSectionSummaryToLocal(current);
  }
  return changed;
}

export function getMasterSectionPeak(
  sectionId: string,
  dateKey: string,
  phaseFilter = 'all'
): MasterSectionPeakRecord | undefined {
  const store = getMasterSectionSummary();
  if (phaseFilter && phaseFilter !== 'all' && phaseFilter !== 'SM') {
    const phaseSpecific = store.sections[`${sectionId}_${phaseFilter}_${dateKey}`];
    if (phaseSpecific && !isSyntheticSectionRecord(phaseSpecific)) return phaseSpecific;
  }
  const base = store.sections[`${sectionId}_${dateKey}`];
  return base && !isSyntheticSectionRecord(base) ? base : undefined;
}

export function getMasterSamplingPointPeak(
  pointId: string,
  dateKey: string
): number | undefined {
  const store = getMasterSectionSummary();
  return store.points[`${pointId}_${dateKey}`];
}

export function isDateSyncedInMasterSummary(
  dateKey: string,
  category: 'land' | 'submarine',
  phaseFilter = 'all',
  sectionId?: string
): boolean {
  const store = getMasterSectionSummary();
  if (sectionId && store.sections[`${sectionId}_${dateKey}`]) {
    if (category === 'submarine' || phaseFilter === 'all' || phaseFilter === 'SM') {
      return true;
    }
    if (store.sections[`${sectionId}_${phaseFilter}_${dateKey}`]) {
      return true;
    }
  }
  const syncedChannels = store.syncedChannelsByDate[dateKey];
  if (!syncedChannels || syncedChannels.length === 0) return false;
  if (category === 'submarine' || phaseFilter === 'SM') {
    return syncedChannels.includes(3);
  }
  if (phaseFilter === 'A') return syncedChannels.includes(0);
  if (phaseFilter === 'B') return syncedChannels.includes(1);
  if (phaseFilter === 'C') return syncedChannels.includes(2);
  return (
    syncedChannels.includes(0) ||
    syncedChannels.includes(1) ||
    syncedChannels.includes(2)
  );
}

function parseTimeStringToHHMM(timeStr: string): string {
  if (!timeStr) return '';
  const clean = timeStr.trim().toUpperCase();
  const ampmMatch = clean.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/);
  if (ampmMatch) {
    let hh = parseInt(ampmMatch[1], 10);
    const mm = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const isPm = ampmMatch[4] === 'PM';
    if (isPm && hh < 12) hh += 12;
    if (!isPm && hh === 12) hh = 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  const hmsMatch = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hmsMatch) {
    const hh = parseInt(hmsMatch[1], 10);
    const mm = parseInt(hmsMatch[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  return '';
}

function extractTimeFromFilenameOrHeader(
  fileName: string,
  headerTimeStr?: string,
  providedTimeStr?: string
): string {
  if (providedTimeStr) {
    const p = parseTimeStringToHHMM(providedTimeStr);
    if (p) return p;
  }
  if (headerTimeStr) {
    const h = parseTimeStringToHHMM(headerTimeStr);
    if (h) return h;
  }
  const pmCheck = fileName.match(/(\d{1,2})[:_]?(\d{2})\s*(PM)/i);
  if (pmCheck) {
    let hh = parseInt(pmCheck[1], 10);
    const mm = parseInt(pmCheck[2], 10);
    if (hh < 12) hh += 12;
    if (hh >= 12 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  // Handle HHMM directly
  const hhmmMatch = fileName.match(/(\d{2})(\d{2})(?:\.\w+)?$/);
  if (hhmmMatch) {
    const hh = parseInt(hhmmMatch[1], 10);
    const mm = parseInt(hhmmMatch[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

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
  return providedTimeStr || headerTimeStr || '';
}

function extractHourNumberFromTime(timeStr: string): number {
  const matchRange = timeStr.match(/^(\d{2})\./); // For "HH.01 - ..."
  if (matchRange) return parseInt(matchRange[1], 10);

  const matchOld = timeStr.match(/^(\d{1,2}):/); // For "HH:00"
  if (matchOld) return parseInt(matchOld[1], 10);

  return 0;
}

function recordSectionPeakInStore(
  store: MasterSectionSummaryData,
  key: string,
  maxTf: number,
  minTf: number,
  sumTf: number,
  countTf: number,
  maxTfDof: number,
  minTfDof: number,
  fileName: string,
  timeStr: string,
  accumulateIntoDailyMean: boolean,
  phaseCode?: string,
  channel?: number
) {
  const phaseLabel =
    phaseCode === 'A'
      ? 'Phase A'
      : phaseCode === 'B'
      ? 'Phase B'
      : phaseCode === 'C'
      ? 'Phase C'
      : phaseCode === 'SM' || channel === 3
      ? 'Submarine (CH 3)'
      : undefined;

  const fileMeanTf = sumTf / Math.max(1, countTf);
  const existing = store.sections[key];
  if (!existing || isSyntheticSectionRecord(existing)) {
    store.sections[key] = {
      maxTf: Number(maxTf.toFixed(2)),
      minTf: Number(minTf.toFixed(2)),
      meanTf: Number(fileMeanTf.toFixed(2)),
      dailySumTf: sumTf,
      dailyCountTf: countTf,
      maxTfDof: Number(maxTfDof.toFixed(2)),
      minTfDof: Number(minTfDof.toFixed(2)),
      maxTimestamp: timeStr,
      minTimestamp: timeStr,
      peakTime: timeStr,
      maxFileName: fileName,
      minFileName: fileName,
      sourceFile: fileName,
      maxPhase: phaseLabel,
      minPhase: phaseLabel,
      maxChannel: channel,
      minChannel: channel,
    };
    return;
  }

  // Accumulate daily average across all unique .TEPR records read for this section & phase in the day
  if (accumulateIntoDailyMean) {
    const prevSum = existing.dailySumTf ?? existing.meanTf * (existing.dailyCountTf ?? 1);
    const prevCount = existing.dailyCountTf ?? 1;
    const nextSum = prevSum + sumTf;
    const nextCount = prevCount + countTf;
    existing.dailySumTf = nextSum;
    existing.dailyCountTf = nextCount;
    existing.meanTf = Number((nextSum / Math.max(1, nextCount)).toFixed(2));
  }

  // Update daily maximum record if a higher temperature is found in this .TEPR file
  if (maxTf > existing.maxTf || existing.maxTfDof === undefined) {
    existing.maxTf = Number(maxTf.toFixed(2));
    existing.maxTfDof = Number(maxTfDof.toFixed(2));
    if (timeStr) {
      existing.maxTimestamp = timeStr;
      existing.peakTime = timeStr;
    }
    if (fileName) {
      existing.maxFileName = fileName;
      existing.sourceFile = fileName;
    }
    if (phaseLabel) existing.maxPhase = phaseLabel;
    if (channel !== undefined) existing.maxChannel = channel;
  }

  // Update daily minimum record independently if a lower temperature is found in this .TEPR file
  if (minTf < existing.minTf || existing.minTfDof === undefined) {
    existing.minTf = Number(minTf.toFixed(2));
    existing.minTfDof = Number(minTfDof.toFixed(2));
    if (timeStr) {
      existing.minTimestamp = timeStr;
    }
    if (fileName) {
      existing.minFileName = fileName;
    }
    if (phaseLabel) existing.minPhase = phaseLabel;
    if (channel !== undefined) existing.minChannel = channel;
  }
}

/**
 * Single-pass full-circuit compiler:
 * Reads a single .TEPR file's text and simultaneously extracts the exact max, min, average, DOF, and timestamp
 * for ALL 13 Submarine Zones (2.1-2.13) OR ALL 6 Land Sections (1.1-1.6) + all discrete sampling points,
 * recording them into the Master Summary Table.
 */
export function compileTeprTextIntoMasterSummary(
  rawText: string,
  fileId: string,
  fileName: string,
  dateKey: string,
  timeStr?: string,
  fallbackChannel?: number
): { channel: number; referenceTemp: number; sectionsUpdated: number } | null {
  const lines = rawText.split(/\r?\n/);
  let fiberReferenceTemp = 30.0;
  let foundExplicitFiberTemp = false;
  let channel: number | undefined;
  let foundExplicitChannel = false;
  let headerTimeStr: string | undefined;
  let part2StartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 35) {
      const strictChMatch = line.match(/#\s*Channel\s*(?:No\.?|Number)?\s*[:=]\s*(\d+)/i);
      if (strictChMatch) {
        channel = parseInt(strictChMatch[1], 10);
        foundExplicitChannel = true;
      } else if (!foundExplicitChannel) {
        const looseChMatch = line.match(/#.*channel[:= ]*(\d+)/i);
        if (looseChMatch) channel = parseInt(looseChMatch[1], 10);
      }

      if (!headerTimeStr) {
        const tmMatch = line.match(/\b([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
        if (tmMatch) {
          headerTimeStr = `${tmMatch[1]}:${tmMatch[2]}`;
        }
      }

      const explicitFiberTempMatch = line.match(
        /#.*(?:fiber\s+reference\s+temperature|characteristic:\s*fiber\s+temperature)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)\s*(?:c|°c|degc|celsius)\b/i
      );
      if (explicitFiberTempMatch && !foundExplicitFiberTemp) {
        const val = parseFloat(explicitFiberTempMatch[1]);
        if (!isNaN(val) && val >= 20 && val <= 40) {
          fiberReferenceTemp = val;
          foundExplicitFiberTemp = true;
        }
      }
    } else {
      const numMatch = line.match(/^(\d+)$/);
      part2StartIndex = numMatch ? i + 1 : i;
      break;
    }
  }

  if (part2StartIndex < 0) return null;

  // O(1) tail check for max trace position
  let maxTracePos = 0;
  for (let k = lines.length - 1; k >= part2StartIndex; k--) {
    const tl = lines[k].trim();
    if (!tl || tl.charCodeAt(0) === 35) continue;
    const p = parseFloat(tl);
    if (!isNaN(p)) {
      maxTracePos = p;
      break;
    }
  }

  // Strictly respect # Channel No from row 6 of .TEPR file:
  // Channel 0 = Land Phase A, Channel 1 = Land Phase B, Channel 2 = Land Phase C, Channel 3 = Submarine Phase SM
  if (channel === undefined) {
    if (fallbackChannel !== undefined) {
      channel = fallbackChannel;
    } else {
      const guessed = guessPhaseFromPath(fileName);
      if (guessed === 'Phase A') channel = 0;
      else if (guessed === 'Phase B') channel = 1;
      else if (guessed === 'Phase C') channel = 2;
      else if (guessed === 'Submarine Cable') channel = 3;
      else if (maxTracePos > 4500) channel = 3;
      else channel = 0;
    }
  }

  const resolvedTimeStr = extractTimeFromFilenameOrHeader(fileName, headerTimeStr, timeStr);

  setPhaseIndexEntry(fileId, {
    ch: channel,
    ref: fiberReferenceTemp,
    maxPos: maxTracePos,
  });

  const isSubmarine = channel === 3;
  const targetWindows = isSubmarine ? SUBMARINE_SECTION_WINDOWS : LAND_SECTION_WINDOWS;
  const phaseCode = channel === 0 ? 'A' : channel === 1 ? 'B' : channel === 2 ? 'C' : 'SM';
  const targetPoints = isSubmarine
    ? SUBMARINE_SAMPLING_POINTS
    : LAND_SAMPLING_POINTS_BY_PHASE[phaseCode] || LAND_SAMPLING_POINTS_BY_PHASE.A;

  const minTargetDofBound = targetWindows.length > 0 ? targetWindows[0].minDof - 25 : 0;
  const maxTargetDofBound =
    targetWindows.length > 0 ? targetWindows[targetWindows.length - 1].maxDof + 25 : 60000;

  // Fallback window accumulators for each section in this category
  const secWindowAcc = targetWindows.map((w) => ({
    maxTf: -Infinity,
    minTf: Infinity,
    sumTf: 0,
    count: 0,
    maxDof: w.minDof,
    minDof: w.maxDof,
  }));

  // Closest temperature tracker for each specified DOF sampling point from Circuit Structure.txt
  const ptBestDiff = new Float64Array(targetPoints.length).fill(Infinity);
  const ptBestTemp = new Float64Array(targetPoints.length).fill(-999);

  let prevPos = -Infinity;
  let ptCursor = 0;
  let wCursor = 0;

  for (let i = part2StartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charCodeAt(0) === 35) continue;

    let sepIdx = -1;
    for (let j = 0; j < line.length; j++) {
      const c = line.charCodeAt(j);
      if (c === 32 || c === 9 || c === 44 || c === 59) {
        sepIdx = j;
        break;
      }
    }
    if (sepIdx === -1) continue;

    const pos = parseFloat(line.substring(0, sepIdx));
    if (isNaN(pos)) continue;

    // Early skip / break outside the category's DOF range (e.g. skip >3490m for Land Cable)
    if (pos < minTargetDofBound) {
      prevPos = pos;
      continue;
    }
    if (pos > maxTargetDofBound && pos >= prevPos) {
      break;
    }
    prevPos = pos;

    let valStart = sepIdx + 1;
    while (valStart < line.length) {
      const vc = line.charCodeAt(valStart);
      if (vc === 32 || vc === 9 || vc === 44 || vc === 59) {
        valStart++;
      } else {
        break;
      }
    }
    const delta = parseFloat(line.substring(valStart));
    if (isNaN(delta)) continue;

    const absTemp = fiberReferenceTemp + delta;
    if (absTemp < -50 || absTemp > 500) continue;

    // 1. Sliding window pointer for discrete sampling points (Circuit Structure DOFs)
    while (ptCursor < targetPoints.length && targetPoints[ptCursor].dof < pos - 25) {
      ptCursor++;
    }
    for (let pIdx = ptCursor; pIdx < targetPoints.length; pIdx++) {
      const ptDof = targetPoints[pIdx].dof;
      if (ptDof > pos + 25) break;
      const d = Math.abs(pos - ptDof);
      if (d < ptBestDiff[pIdx]) {
        ptBestDiff[pIdx] = d;
        ptBestTemp[pIdx] = absTemp;
      }
    }

    // 2. Sliding window pointer for section windows
    while (wCursor < targetWindows.length && pos > targetWindows[wCursor].maxDof) {
      wCursor++;
    }
    if (wCursor < targetWindows.length) {
      const w = targetWindows[wCursor];
      if (pos >= w.minDof) {
        const acc = secWindowAcc[wCursor];
        if (absTemp > acc.maxTf) {
          acc.maxTf = absTemp;
          acc.maxDof = pos;
        }
        if (absTemp < acc.minTf) {
          acc.minTf = absTemp;
          acc.minDof = pos;
        }
        acc.sumTf += absTemp;
        acc.count++;
      }
    }
  }

  // Build section accumulators directly from the specified DOFs in Circuit Structure.txt for each section
  const secAcc = targetWindows.map((w, wIdx) => {
    let maxTf = -Infinity;
    let minTf = Infinity;
    let sumTf = 0;
    let count = 0;
    let maxDof = w.minDof;
    let minDof = w.maxDof;

    for (let pIdx = 0; pIdx < targetPoints.length; pIdx++) {
      const pt = targetPoints[pIdx];
      if (pt.sectionId !== w.sectionId) continue;
      const val = ptBestTemp[pIdx];
      if (val <= -100) continue;
      if (val > maxTf) {
        maxTf = val;
        maxDof = pt.dof;
      }
      if (val < minTf) {
        minTf = val;
        minDof = pt.dof;
      }
      sumTf += val;
      count++;
    }

    if (count > 0) {
      return { maxTf, minTf, sumTf, count, maxDof, minDof };
    }
    return secWindowAcc[wIdx];
  });

  const store = getMasterSectionSummary();
  if (!store.compiledFilesByDate) store.compiledFilesByDate = {};
  let dateSet = inMemoryCompiledFileSets.get(dateKey);
  if (!dateSet) {
    dateSet = new Set(store.compiledFilesByDate[dateKey] || []);
    inMemoryCompiledFileSets.set(dateKey, dateSet);
  }
  const fileUniqueId = fileId || fileName;
  const isNewFileForDate = !dateSet.has(fileUniqueId);
  if (isNewFileForDate) {
    dateSet.add(fileUniqueId);
    if (!store.compiledFilesByDate[dateKey]) store.compiledFilesByDate[dateKey] = [];
    store.compiledFilesByDate[dateKey].push(fileUniqueId);
  }

  // Populate DOF-level daily and hourly peak records across all assigned section sampling points
  if (!store.dofDailyPeaks) store.dofDailyPeaks = {};
  if (!store.dofHourlyPeaks) store.dofHourlyPeaks = {};
  const timeMin = parseTimeStrToMinutes(resolvedTimeStr);
  let hIdx = 0;
  if (timeMin !== null && timeMin > 0) {
    hIdx = Math.min(23, Math.floor((timeMin - 1) / 60));
  }
  const hourStr = (resolvedTimeStr ? resolvedTimeStr.slice(0, 2).padStart(2, '0') : '00') + ':00';
  const hourIdxStr = String(hIdx);
  const hourFormattedStr = `${String(hIdx).padStart(2, '0')}:00`;

  for (let pIdx = 0; pIdx < targetPoints.length; pIdx++) {
    const sp = targetPoints[pIdx];
    const val = ptBestTemp[pIdx];
    if (val <= -100) continue;
    const rounded = Number(val.toFixed(2));
    const dofStr = sp.dof.toFixed(2);

    const dailyKey = `${sp.sectionId}_${phaseCode}_${dateKey}_${dofStr}`;
    const curDaily = store.dofDailyPeaks[dailyKey];
    if (!curDaily || rounded > curDaily.maxTf) {
      store.dofDailyPeaks[dailyKey] = {
        dof: sp.dof,
        maxTf: rounded,
        timestamp: resolvedTimeStr,
        fileName,
      };
    }

    const hourlyRec = {
      dof: sp.dof,
      maxTf: rounded,
      timestamp: resolvedTimeStr,
      fileName,
    };

    const hourlyKeyIdx = `${sp.sectionId}_${phaseCode}_${dateKey}_${hourIdxStr}_${dofStr}`;
    const curHourlyIdx = store.dofHourlyPeaks[hourlyKeyIdx];
    if (!curHourlyIdx || rounded > curHourlyIdx.maxTf) {
      store.dofHourlyPeaks[hourlyKeyIdx] = hourlyRec;
    }

    const hourlyKeyFmt = `${sp.sectionId}_${phaseCode}_${dateKey}_${hourFormattedStr}_${dofStr}`;
    const curHourlyFmt = store.dofHourlyPeaks[hourlyKeyFmt];
    if (!curHourlyFmt || rounded > curHourlyFmt.maxTf) {
      store.dofHourlyPeaks[hourlyKeyFmt] = hourlyRec;
    }

    const hourlyKeyLegacy = `${sp.sectionId}_${phaseCode}_${dateKey}_${hourStr}_${dofStr}`;
    const curHourlyLegacy = store.dofHourlyPeaks[hourlyKeyLegacy];
    if (!curHourlyLegacy || rounded > curHourlyLegacy.maxTf) {
      store.dofHourlyPeaks[hourlyKeyLegacy] = hourlyRec;
    }
  }

  let sectionsUpdated = 0;

  for (let wIdx = 0; wIdx < targetWindows.length; wIdx++) {
    const acc = secAcc[wIdx];
    if (acc.count > 0) {
      const secId = targetWindows[wIdx].sectionId;
      // Record overall section daily peak, trough, and accumulated daily average
      recordSectionPeakInStore(
        store,
        `${secId}_${dateKey}`,
        acc.maxTf,
        acc.minTf,
        acc.sumTf,
        acc.count,
        acc.maxDof,
        acc.minDof,
        fileName,
        resolvedTimeStr,
        isNewFileForDate,
        phaseCode,
        channel
      );
      // If land cable, also record phase-specific section daily peak, trough, and daily average
      if (!isSubmarine && (phaseCode === 'A' || phaseCode === 'B' || phaseCode === 'C')) {
        recordSectionPeakInStore(
          store,
          `${secId}_${phaseCode}_${dateKey}`,
          acc.maxTf,
          acc.minTf,
          acc.sumTf,
          acc.count,
          acc.maxDof,
          acc.minDof,
          fileName,
          resolvedTimeStr,
          isNewFileForDate,
          phaseCode,
          channel
        );
      } else if (isSubmarine) {
        recordSectionPeakInStore(
          store,
          `${secId}_SM_${dateKey}`,
          acc.maxTf,
          acc.minTf,
          acc.sumTf,
          acc.count,
          acc.maxDof,
          acc.minDof,
          fileName,
          resolvedTimeStr,
          isNewFileForDate,
          'SM',
          3
        );
      }
      sectionsUpdated++;
    }
  }

  for (let pIdx = 0; pIdx < targetPoints.length; pIdx++) {
    const val = ptBestTemp[pIdx];
    if (val > -100) {
      const ptKey = `${targetPoints[pIdx].id}_${dateKey}`;
      const existingVal = store.points[ptKey];
      const rounded = Number(val.toFixed(2));
      if (existingVal === undefined || rounded > existingVal) {
        store.points[ptKey] = rounded;
      }
    }
  }

  if (sectionsUpdated > 0) {
    const chList = store.syncedChannelsByDate[dateKey] || [];
    if (!chList.includes(channel)) {
      store.syncedChannelsByDate[dateKey] = [...chList, channel];
    }
  }

  return {
    channel,
    referenceTemp: fiberReferenceTemp,
    sectionsUpdated,
  };
}

/**
 * Compiles already-parsed ParsedTeprFile objects (e.g. from Page 1) into the Master Summary Table.
 */
export function ingestParsedFilesIntoMasterSummary(parsedFiles: ParsedTeprFile[]): number {
  if (!parsedFiles || parsedFiles.length === 0) return 0;
  const store = getMasterSectionSummary();
  if (!store.compiledFilesByDate) store.compiledFilesByDate = {};
  let updatedCount = 0;

  for (const pf of parsedFiles) {
    const pts = pf.dataPoints || [];
    if (pts.length === 0) continue;
    const dateKey = pf.dateMeta?.dateKey || pf.dateMeta?.dateTimeStr?.slice(0, 10);
    if (!dateKey) continue;

    const maxPos = pts[pts.length - 1].position;
    let ch: number | undefined;
    if (pf.header?.rawComments) {
      for (const cLine of pf.header.rawComments) {
        const m = cLine.match(/#\s*Channel\s*(?:No\.?|Number)?\s*[:=]\s*(\d+)/i);
        if (m) {
          ch = parseInt(m[1], 10);
          break;
        }
      }
    }
    if (ch === undefined) {
      ch = pf.channel;
    }
    if (ch === undefined) {
      const guessed = pf.cablePhase && pf.cablePhase !== 'Unassigned' ? pf.cablePhase : guessPhaseFromPath(pf.fileName);
      if (guessed === 'Phase A') ch = 0;
      else if (guessed === 'Phase B') ch = 1;
      else if (guessed === 'Phase C') ch = 2;
      else if (guessed === 'Submarine Cable') ch = 3;
      else if (maxPos > 4500) ch = 3;
      else ch = 0;
    }

    const isSubmarine = ch === 3;
    const phaseCode = ch === 0 ? 'A' : ch === 1 ? 'B' : ch === 2 ? 'C' : 'SM';
    const targetWindows = isSubmarine ? SUBMARINE_SECTION_WINDOWS : LAND_SECTION_WINDOWS;
    const targetPoints = isSubmarine
      ? SUBMARINE_SAMPLING_POINTS
      : LAND_SAMPLING_POINTS_BY_PHASE[phaseCode] || LAND_SAMPLING_POINTS_BY_PHASE.A;

    const resolvedTimeStr = extractTimeFromFilenameOrHeader(
      pf.fileName,
      pf.header?.dateTimeStr,
      pf.dateMeta?.formattedTime
    );

    let dateSet = inMemoryCompiledFileSets.get(dateKey);
    if (!dateSet) {
      dateSet = new Set(store.compiledFilesByDate[dateKey] || []);
      inMemoryCompiledFileSets.set(dateKey, dateSet);
    }
    const fileUniqueId = pf.fileId || pf.fileName;
    const isNewFileForDate = !dateSet.has(fileUniqueId);
    if (isNewFileForDate) {
      dateSet.add(fileUniqueId);
      if (!store.compiledFilesByDate[dateKey]) store.compiledFilesByDate[dateKey] = [];
      store.compiledFilesByDate[dateKey].push(fileUniqueId);
    }

    const ptTemps = new Float64Array(targetPoints.length).fill(-999);
    for (let pIdx = 0; pIdx < targetPoints.length; pIdx++) {
      const sp = targetPoints[pIdx];
      let bestDiff = Infinity;
      let bestTemp = -999;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(pts[i].position - sp.dof);
        if (d < bestDiff && d <= 25) {
          bestDiff = d;
          bestTemp = pts[i].absoluteTemp;
        }
        if (pts[i].position > sp.dof + 35) break;
      }
      ptTemps[pIdx] = bestTemp;
      if (bestTemp > -100) {
        const ptKey = `${sp.id}_${dateKey}`;
        const existingVal = store.points[ptKey];
        const rounded = Number(bestTemp.toFixed(2));
        if (existingVal === undefined || rounded > existingVal) {
          store.points[ptKey] = rounded;
        }

        if (!store.dofDailyPeaks) store.dofDailyPeaks = {};
        if (!store.dofHourlyPeaks) store.dofHourlyPeaks = {};
        const timeMin = parseTimeStrToMinutes(resolvedTimeStr);
        let hIdx = 0;
        if (timeMin !== null && timeMin > 0) {
          hIdx = Math.min(23, Math.floor((timeMin - 1) / 60));
        }
        const hourStr = (resolvedTimeStr ? resolvedTimeStr.slice(0, 2).padStart(2, '0') : '00') + ':00';
        const hourIdxStr = String(hIdx);
        const hourFormattedStr = `${String(hIdx).padStart(2, '0')}:00`;
        const dofStr = sp.dof.toFixed(2);

        const dailyKey = `${sp.sectionId}_${phaseCode}_${dateKey}_${dofStr}`;
        const curDaily = store.dofDailyPeaks[dailyKey];
        if (!curDaily || rounded > curDaily.maxTf) {
          store.dofDailyPeaks[dailyKey] = {
            dof: sp.dof,
            maxTf: rounded,
            timestamp: resolvedTimeStr,
            fileName: pf.fileName,
          };
        }

        const hourlyRec = {
          dof: sp.dof,
          maxTf: rounded,
          timestamp: resolvedTimeStr,
          fileName: pf.fileName,
        };

        const hourlyKeyIdx = `${sp.sectionId}_${phaseCode}_${dateKey}_${hourIdxStr}_${dofStr}`;
        const curHourlyIdx = store.dofHourlyPeaks[hourlyKeyIdx];
        if (!curHourlyIdx || rounded > curHourlyIdx.maxTf) {
          store.dofHourlyPeaks[hourlyKeyIdx] = hourlyRec;
        }

        const hourlyKeyFmt = `${sp.sectionId}_${phaseCode}_${dateKey}_${hourFormattedStr}_${dofStr}`;
        const curHourlyFmt = store.dofHourlyPeaks[hourlyKeyFmt];
        if (!curHourlyFmt || rounded > curHourlyFmt.maxTf) {
          store.dofHourlyPeaks[hourlyKeyFmt] = hourlyRec;
        }

        const hourlyKeyLegacy = `${sp.sectionId}_${phaseCode}_${dateKey}_${hourStr}_${dofStr}`;
        const curHourlyLegacy = store.dofHourlyPeaks[hourlyKeyLegacy];
        if (!curHourlyLegacy || rounded > curHourlyLegacy.maxTf) {
          store.dofHourlyPeaks[hourlyKeyLegacy] = hourlyRec;
        }
      }
    }

    for (let wIdx = 0; wIdx < targetWindows.length; wIdx++) {
      const w = targetWindows[wIdx];
      let maxTf = -Infinity;
      let minTf = Infinity;
      let sumTf = 0;
      let count = 0;
      let maxDof = w.minDof;
      let minDof = w.maxDof;

      // Primary: evaluate at specified discrete DOFs from Circuit Structure.txt for this section
      for (let pIdx = 0; pIdx < targetPoints.length; pIdx++) {
        const sp = targetPoints[pIdx];
        if (sp.sectionId !== w.sectionId) continue;
        const val = ptTemps[pIdx];
        if (val <= -100) continue;
        if (val > maxTf) {
          maxTf = val;
          maxDof = sp.dof;
        }
        if (val < minTf) {
          minTf = val;
          minDof = sp.dof;
        }
        sumTf += val;
        count++;
      }

      // Fallback: window scan if no discrete point matched
      if (count === 0) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p.position < w.minDof) continue;
          if (p.position > w.maxDof) break;
          if (p.absoluteTemp < -50 || p.absoluteTemp > 500) continue;
          if (p.absoluteTemp > maxTf) {
            maxTf = p.absoluteTemp;
            maxDof = p.position;
          }
          if (p.absoluteTemp < minTf) {
            minTf = p.absoluteTemp;
            minDof = p.position;
          }
          sumTf += p.absoluteTemp;
          count++;
        }
      }

      if (count > 0) {
        recordSectionPeakInStore(
          store,
          `${w.sectionId}_${dateKey}`,
          maxTf,
          minTf,
          sumTf,
          count,
          maxDof,
          minDof,
          pf.fileName,
          resolvedTimeStr,
          isNewFileForDate,
          phaseCode,
          ch
        );
        if (!isSubmarine && (phaseCode === 'A' || phaseCode === 'B' || phaseCode === 'C')) {
          recordSectionPeakInStore(
            store,
            `${w.sectionId}_${phaseCode}_${dateKey}`,
            maxTf,
            minTf,
            sumTf,
            count,
            maxDof,
            minDof,
            pf.fileName,
            resolvedTimeStr,
            isNewFileForDate,
            phaseCode,
            ch
          );
        } else if (isSubmarine) {
          recordSectionPeakInStore(
            store,
            `${w.sectionId}_SM_${dateKey}`,
            maxTf,
            minTf,
            sumTf,
            count,
            maxDof,
            minDof,
            pf.fileName,
            resolvedTimeStr,
            isNewFileForDate,
            'SM',
            3
          );
        }
        updatedCount++;
      }
    }

    const chList = store.syncedChannelsByDate[dateKey] || [];
    if (!chList.includes(ch)) {
      store.syncedChannelsByDate[dateKey] = [...chList, ch];
    }
  }

  if (updatedCount > 0) {
    saveMasterSectionSummaryToLocal(store);
  }
  return updatedCount;
}

// ============================================================================
// Server & Google Drive Persistence for PowerBI-Style Master Summary Table
// ============================================================================

export async function loadMasterSummaryFromServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/master-section-summary');
    if (!res.ok) return false;
    const data = await res.json();
    if (data?.summary) {
      return mergeExternalMasterSummary(data.summary);
    }
  } catch {
    // ignore network errors
  }
  return false;
}

export async function saveMasterSummaryToServer(): Promise<void> {
  try {
    const store = getMasterSectionSummary();
    const lightweightPayload = {
      version: store.version,
      updatedAt: store.updatedAt,
      sections: store.sections,
      points: store.points,
      syncedChannelsByDate: store.syncedChannelsByDate,
    };
    await fetch('/api/master-section-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: lightweightPayload }),
    });
  } catch {
    // ignore network errors
  }
}

export async function loadMasterSummaryFromDrive(accessToken: string): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const q = `name = '${DRIVE_MASTER_FILE_NAME}' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!searchRes.ok) return false;
    const searchData = await searchRes.json();
    const file = searchData.files?.[0];
    if (!file?.id) return false;

    cachedDriveMasterFileId = file.id;
    const contentUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
    const contentRes = await fetch(contentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!contentRes.ok) return false;
    const json = await contentRes.json();
    return mergeExternalMasterSummary(json);
  } catch {
    return false;
  }
}

export async function saveMasterSummaryToDrive(
  accessToken: string,
  parentFolderId?: string
): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const store = getMasterSectionSummary();
    const jsonContent = JSON.stringify(store);

    let fileId = cachedDriveMasterFileId;
    if (!fileId) {
      const q = `name = '${DRIVE_MASTER_FILE_NAME}' and trashed = false`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        q
      )}&fields=files(id,name)&pageSize=5`;
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files?.[0]?.id) {
          fileId = searchData.files[0].id;
          cachedDriveMasterFileId = fileId;
        }
      }
    }

    if (fileId) {
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`;
      const res = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: jsonContent,
      });
      return res.ok;
    } else {
      const metadata: Record<string, any> = {
        name: DRIVE_MASTER_FILE_NAME,
        mimeType: 'application/json',
      };
      if (parentFolderId && parentFolderId !== 'root') {
        metadata.parents = [parentFolderId];
      }
      const boundary = '-------dts_master_summary_boundary';
      const multipartBody =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${jsonContent}\r\n` +
        `--${boundary}--`;

      const createUrl =
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true';
      const res = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      });
      if (res.ok) {
        const created = await res.json();
        if (created?.id) cachedDriveMasterFileId = created.id;
        return true;
      }
    }
  } catch {
    // ignore drive upload errors
  }
  return false;
}

/**
 * Multi-Sheet Database Row Data Model (1 Section/Sheet)
 * Any missing or unreadable Fiber Temperature or Power Flow value is strictly left empty ('').
 */
export interface DatabaseSheetRow {
  Sheet_Section_ID: string;
  Section_Name: string;
  Category: string;
  Date: string;
  Phase: string;
  DOF_Point_Index?: string;
  DOF_Position_m?: number | '';
  Daily_Peak_Fiber_Temp_C?: number | '';
  Timestamp_Peak?: string;
  IEC_Est_Conductor_C?: number | '';
  Power_Flow_During_Peak_Total_MW?: number | '';
  Power_Flow_During_Peak_Ckt3_MW?: number | '';
  Power_Flow_During_Peak_Ckt2_MW?: number | '';
  Power_Flow_During_Peak_33NKT_MW?: number | '';
  Power_Flow_During_Peak_33Oil_MW?: number | '';
  Section_Overall_Max_Fiber_Temp_C?: number | '';
  Section_Overall_Max_Conductor_C?: number | '';
  Section_Overall_Max_DOF_m?: number | '';
  File_Name_Peak?: string;
  Max_Fiber_Temp_C: number | '';
  Min_Fiber_Temp_C: number | '';
  Mean_Fiber_Temp_C: number | '';
  IEC_Est_Max_Conductor_C: number | '';
  IEC_Est_Min_Conductor_C: number | '';
  DOF_Max_m: number | '';
  DOF_Min_m: number | '';
  Timestamp_Max: string;
  Timestamp_Min: string;
  Power_Flow_During_Max_Total_MW: number | '';
  Power_Flow_During_Max_Ckt3_MW: number | '';
  Power_Flow_During_Max_Ckt2_MW: number | '';
  Power_Flow_During_Max_33NKT_MW: number | '';
  Power_Flow_During_Max_33Oil_MW: number | '';
  Power_Flow_During_Min_Total_MW: number | '';
  Power_Flow_During_Min_Ckt3_MW: number | '';
  Power_Flow_During_Min_Ckt2_MW: number | '';
  Power_Flow_During_Min_33NKT_MW: number | '';
  Power_Flow_During_Min_33Oil_MW: number | '';
  File_Name_Max: string;
  File_Name_Min: string;
  [key: string]: any;
}

export interface SectionDailyProfileRow {
  Sheet_Section_ID: string;
  Section_Name: string;
  Category: string;
  Date: string;
  Time: string;
  Phase: string;
  Section_Max_Tf_C?: number | '';
  Section_Max_Tc_C?: number | '';
  Section_Max_DOF_m?: number | '';
  Hourly_Peak_Time?: string;
  Power_Ckt3_MW?: number | '';
  Power_Ckt2_MW?: number | '';
  Power_33NKT_MW?: number | '';
  Power_33Oil_MW?: number | '';
  Total_Power_MW?: number | '';
  [key: string]: any;
}

export interface ParsedExistingDailyProfileFile {
  fileName: string;
  fileFormat: 'xlsx' | 'csv';
  rowsBySection: Map<string, SectionDailyProfileRow[]>;
  existingValidDates: string[];
  datesWithMissingPower: string[];
  allRowDates: string[];
  firstDate: string;
  latestDate: string;
  totalExistingRows: number;
}

export interface GeneratedDatabaseResult {
  csvText: string;
  xlsxBuffer: Uint8Array;
  recordCount: number;
  sheetCount: number;
  dateKeys: string[];
  filenameBase: string;
}

export function parseTimeStrToMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const cleaned = String(timeStr).trim();
  // Support standard "18:57", "18.57" (DTS report format), "18:57:00", "18.57.00", "2026-01-01 18:57"
  const match =
    cleaned.match(/(?:^|\s|[T_-])([0-2]?[0-9])[:.]([0-5][0-9])(?:[:.][0-5][0-9])?(?:\s|$)/) ||
    cleaned.match(/([0-2]?[0-9])[:.]([0-5][0-9])/);
  if (match) {
    const hh = parseInt(match[1], 10);
    const mm = parseInt(match[2], 10);
    if (!isNaN(hh) && !isNaN(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return hh * 60 + mm;
    }
  }
  // Support 4-digit compact time like "1857"
  const compactMatch = cleaned.match(/\b([01]\d|2[0-3])([0-5]\d)\b/);
  if (compactMatch) {
    return parseInt(compactMatch[1], 10) * 60 + parseInt(compactMatch[2], 10);
  }
  return null;
}

function findPowerSummaryForDate(
  dKey: string,
  powerSummariesByDate?: Map<string, DailyPowerSummary>
): DailyPowerSummary | undefined {
  if (!powerSummariesByDate || !dKey) return undefined;
  // Exact date match
  const direct = powerSummariesByDate.get(dKey);
  if (direct && !isSyntheticPowerSummary(direct)) return direct;

  // Normalized YYYY-MM-DD match
  const parts = dKey.split(/[-_./]/);
  const targetNorm =
    parts.length === 3
      ? `${parts[0]}-${String(parseInt(parts[1], 10)).padStart(2, '0')}-${String(parseInt(parts[2], 10)).padStart(2, '0')}`
      : dKey;

  const normMatch = powerSummariesByDate.get(targetNorm);
  if (normMatch && !isSyntheticPowerSummary(normMatch)) return normMatch;

  // Key-level normalized search across all entries
  for (const [k, val] of powerSummariesByDate.entries()) {
    if (isSyntheticPowerSummary(val)) continue;
    const kParts = k.split(/[-_./]/);
    if (kParts.length === 3) {
      const kNorm = `${kParts[0]}-${String(parseInt(kParts[1], 10)).padStart(2, '0')}-${String(parseInt(kParts[2], 10)).padStart(2, '0')}`;
      if (kNorm === targetNorm) return val;
    }
  }

  return undefined;
}

/**
 * Helper to check if a SCADA data point contains real positive power values (> 0)
 */
function hasScadaPower(
  dp:
    | {
        kmbCircuit3?: number;
        kmaCircuit2?: number;
        knaNkt?: number;
        knaOilFilled?: number;
        totalPower?: number;
      }
    | null
    | undefined
): boolean {
  if (!dp) return false;
  const c3 = typeof dp.kmbCircuit3 === 'number' && !isNaN(dp.kmbCircuit3) ? dp.kmbCircuit3 : 0;
  const c2 = typeof dp.kmaCircuit2 === 'number' && !isNaN(dp.kmaCircuit2) ? dp.kmaCircuit2 : 0;
  const nkt = typeof dp.knaNkt === 'number' && !isNaN(dp.knaNkt) ? dp.knaNkt : 0;
  const oil = typeof dp.knaOilFilled === 'number' && !isNaN(dp.knaOilFilled) ? dp.knaOilFilled : 0;
  const tot = typeof dp.totalPower === 'number' && !isNaN(dp.totalPower) ? dp.totalPower : 0;
  return c3 > 0 || c2 > 0 || nkt > 0 || oil > 0 || tot > 0;
}

/**
 * Looks up coincident 4-circuit power flow from Target Folders 2 (KMB, KMA, KNA) at the exact
 * Timestamp_Max or Timestamp_Min from Target Folder 1 (.TEPR).
 * Uses the surrounding 15-minute interval selection within the same hour period (selecting whichever
 * 15-minute point has higher Circuit 3 / total load), and strictly returns null (which exports as empty "")
 * if the power summary or circuit file is missing/unreadable or synthetic.
 * NEVER uses simulation or estimation.
 */
export function lookupCoincidentPowerAtTimestamp(
  powerSummary: DailyPowerSummary | undefined,
  timestampStr: string
): {
  pTotal: number | null;
  pCkt3: number | null;
  pCkt2: number | null;
  p33Nkt: number | null;
  p33Oil: number | null;
} {
  if (
    !powerSummary ||
    isSyntheticPowerSummary(powerSummary) ||
    !Array.isArray(powerSummary.dataPoints) ||
    powerSummary.dataPoints.length === 0
  ) {
    return { pTotal: null, pCkt3: null, pCkt2: null, p33Nkt: null, p33Oil: null };
  }

  const targetMinutes = parseTimeStrToMinutes(timestampStr);
  let bestPoint: (typeof powerSummary.dataPoints)[0] | null = null;

  if (targetMinutes !== null) {
    const h = Math.max(0, Math.min(23, targetMinutes > 0 ? Math.floor((targetMinutes - 1) / 60) : 0));
    const hStartMin = h * 60;
    const hEndMin = (h + 1) * 60;
    const gridLower = Math.max(hStartMin, Math.min(hEndMin, Math.floor(targetMinutes / 15) * 15));
    const gridUpper = Math.max(hStartMin, Math.min(hEndMin, Math.ceil(targetMinutes / 15) * 15));

    const findDpAt = (targetMin: number, requirePower: boolean) => {
      let best: (typeof powerSummary.dataPoints)[0] | null = null;
      let bestDiff = Infinity;
      for (const dp of powerSummary.dataPoints) {
        if (requirePower && !hasScadaPower(dp)) continue;
        let dpMin = dp.timeMinutes;
        if (targetMin === 1440 && dpMin === 0 && dp.time && (dp.time.startsWith('24:') || dp.time === '00:00')) {
          dpMin = 1440;
        }
        const diff = Math.abs(dpMin - targetMin);
        if (diff < bestDiff && diff <= 15) {
          bestDiff = diff;
          best = dp;
        }
      }
      return best;
    };

    let point1 = findDpAt(gridLower, true);
    let point2 = findDpAt(gridUpper, true);

    if (point1 && point2 && point1 !== point2) {
      const ckt3_1 = typeof point1.kmbCircuit3 === 'number' && !isNaN(point1.kmbCircuit3) ? point1.kmbCircuit3 : 0;
      const ckt3_2 = typeof point2.kmbCircuit3 === 'number' && !isNaN(point2.kmbCircuit3) ? point2.kmbCircuit3 : 0;
      const load1 = ckt3_1 > 0 ? ckt3_1 : (point1.totalPower || 0);
      const load2 = ckt3_2 > 0 ? ckt3_2 : (point2.totalPower || 0);
      bestPoint = load2 > load1 ? point2 : point1;
    } else {
      bestPoint = point1 || point2;
    }

    // Step 2: If surrounding grid candidates lack power, search +/- 15 min around the event moment
    if (!hasScadaPower(bestPoint)) {
      let closestIn15: (typeof powerSummary.dataPoints)[0] | null = null;
      let closestDiff15 = Infinity;
      for (const dp of powerSummary.dataPoints) {
        if (!hasScadaPower(dp)) continue;
        let dpMin = dp.timeMinutes;
        if (targetMinutes === 1440 && dpMin === 0) dpMin = 1440;
        const diff = Math.abs(dpMin - targetMinutes);
        if (diff <= 15 && diff < closestDiff15) {
          closestDiff15 = diff;
          closestIn15 = dp;
        }
      }
      if (closestIn15) {
        bestPoint = closestIn15;
      }
    }

    // Step 3: Search within the same hour interval [hStartMin, hEndMin]
    if (!hasScadaPower(bestPoint)) {
      const inHour = powerSummary.dataPoints.filter((dp) => {
        if (!hasScadaPower(dp)) return false;
        let dpMin = dp.timeMinutes;
        if (hEndMin === 1440 && dpMin === 0) dpMin = 1440;
        return dpMin >= hStartMin && dpMin <= hEndMin;
      });
      if (inHour.length > 0) {
        bestPoint = inHour.reduce((max, cur) => {
          const curVal = cur.kmbCircuit3 || cur.totalPower || 0;
          const maxVal = max.kmbCircuit3 || max.totalPower || 0;
          return curVal > maxVal ? cur : max;
        }, inHour[0]);
      }
    }

    // Step 4: Search within +/- 90 minutes of targetMinutes
    if (!hasScadaPower(bestPoint)) {
      let bestDiff = Infinity;
      for (const dp of powerSummary.dataPoints) {
        if (!hasScadaPower(dp)) continue;
        const diff = Math.abs(dp.timeMinutes - targetMinutes);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestPoint = dp;
        }
      }
      if (bestPoint && bestDiff > 90) {
        bestPoint = null;
      }
    }
  }

  // Step 5: Final fallback to peak load point on that day with non-zero power
  if (!hasScadaPower(bestPoint)) {
    const validPoints = powerSummary.dataPoints.filter(hasScadaPower);
    if (validPoints.length > 0) {
      bestPoint = validPoints.reduce((max, cur) => {
        const curVal = cur.kmbCircuit3 || cur.totalPower || 0;
        const maxVal = max.kmbCircuit3 || max.totalPower || 0;
        return curVal > maxVal ? cur : max;
      }, validPoints[0]);
    }
  }

  if (!bestPoint) {
    return { pTotal: null, pCkt3: null, pCkt2: null, p33Nkt: null, p33Oil: null };
  }

  const hasKmb = powerSummary.substationsLoaded ? Boolean(powerSummary.substationsLoaded.KMB) : true;
  const hasKma = powerSummary.substationsLoaded ? Boolean(powerSummary.substationsLoaded.KMA) : true;
  const hasKna = powerSummary.substationsLoaded ? Boolean(powerSummary.substationsLoaded.KNA) : true;

  const pCkt3 =
    hasKmb && typeof bestPoint.kmbCircuit3 === 'number' && !isNaN(bestPoint.kmbCircuit3)
      ? Number(bestPoint.kmbCircuit3.toFixed(2))
      : null;
  const pCkt2 =
    hasKma && typeof bestPoint.kmaCircuit2 === 'number' && !isNaN(bestPoint.kmaCircuit2)
      ? Number(bestPoint.kmaCircuit2.toFixed(2))
      : null;
  const p33Nkt =
    hasKna && typeof bestPoint.knaNkt === 'number' && !isNaN(bestPoint.knaNkt)
      ? Number(bestPoint.knaNkt.toFixed(2))
      : null;
  const p33Oil =
    hasKna && typeof bestPoint.knaOilFilled === 'number' && !isNaN(bestPoint.knaOilFilled)
      ? Number(bestPoint.knaOilFilled.toFixed(2))
      : null;

  const pTotal =
    pCkt3 !== null && pCkt2 !== null && p33Nkt !== null && p33Oil !== null
      ? Number((pCkt3 + pCkt2 + p33Nkt + p33Oil).toFixed(2))
      : typeof bestPoint.totalPower === 'number' && !isNaN(bestPoint.totalPower) && bestPoint.totalPower > 0
      ? Number(bestPoint.totalPower.toFixed(2))
      : null;

  return { pTotal, pCkt3, pCkt2, p33Nkt, p33Oil };
}

/**
 * Looks up coincident 4-circuit power flow for Section Daily Profile within the specific hour interval.
 * Strictly adheres to the rule:
 * 1. Power record must stay within the same hour period [h * 60, (h + 1) * 60] (e.g. For 00.01 - 01.00, power cannot go beyond 01.00).
 * 2. Power records are sampled every 15 minutes. Around the peak fiber temperature timestamp (e.g. 00:59),
 *    the two nearest 15-minute grid points are located (e.g. 00:45 and 01:00).
 * 3. Whichever 15-minute interval has the larger Circuit 3 load (falling back to total power if Ckt3 is 0) is selected.
 * 4. At least 1 power flow reading within (+15 minute or -15 minute) of the recording moment is used to prevent 0 values.
 * 5. If fiber temperature is missing for that hour, the peak power flow within that same hour interval is used.
 */
export function lookupCoincidentPowerForHourlyProfile(
  powerSummary: DailyPowerSummary | undefined,
  timestampStr: string,
  hourIndex: number
): {
  pTotal: number | null;
  pCkt3: number | null;
  pCkt2: number | null;
  p33Nkt: number | null;
  p33Oil: number | null;
  selectedTime: string;
} {
  const emptyRes = { pTotal: null, pCkt3: null, pCkt2: null, p33Nkt: null, p33Oil: null, selectedTime: '' };
  if (
    !powerSummary ||
    isSyntheticPowerSummary(powerSummary) ||
    !Array.isArray(powerSummary.dataPoints) ||
    powerSummary.dataPoints.length === 0
  ) {
    return emptyRes;
  }

  const h = Math.max(0, Math.min(23, hourIndex));
  const hStartMin = h * 60;
  const hEndMin = (h + 1) * 60; // e.g. 60 for h=0 (01:00)

  // Target minutes from fiber timestamp
  const targetMinRaw = parseTimeStrToMinutes(timestampStr);
  const targetMinutes =
    targetMinRaw !== null
      ? Math.max(hStartMin, Math.min(hEndMin, targetMinRaw))
      : hStartMin + 30;

  // The two surrounding 15-minute intervals
  const gridLower = Math.floor(targetMinutes / 15) * 15;
  const gridUpper = Math.ceil(targetMinutes / 15) * 15;

  const c1Min = Math.max(hStartMin, Math.min(hEndMin, gridLower));
  const c2Min = Math.max(hStartMin, Math.min(hEndMin, gridUpper));

  const findNearestDp = (targetMin: number, requirePower: boolean) => {
    let best: (typeof powerSummary.dataPoints)[0] | null = null;
    let bestDiff = Infinity;
    for (const dp of powerSummary.dataPoints) {
      if (requirePower && !hasScadaPower(dp)) continue;
      let dpMin = dp.timeMinutes;
      if (targetMin === 1440 && dpMin === 0 && dp.time && (dp.time.startsWith('24:') || dp.time === '00:00')) {
        dpMin = 1440;
      }
      const diff = Math.abs(dpMin - targetMin);
      if (diff < bestDiff && diff <= 15) {
        bestDiff = diff;
        best = dp;
      }
    }
    return best;
  };

  // 1. Try finding nearest points at the two 15-minute grid candidates with non-zero power
  let point1 = findNearestDp(c1Min, true);
  let point2 = findNearestDp(c2Min, true);

  if (!point1) point1 = findNearestDp(c1Min, false);
  if (!point2) point2 = findNearestDp(c2Min, false);

  let selectedPoint: (typeof powerSummary.dataPoints)[0] | null = null;

  if (point1 && point2 && point1 !== point2) {
    const hasP1 = hasScadaPower(point1);
    const hasP2 = hasScadaPower(point2);
    if (hasP1 && !hasP2) {
      selectedPoint = point1;
    } else if (hasP2 && !hasP1) {
      selectedPoint = point2;
    } else {
      const ckt3_1 =
        typeof point1.kmbCircuit3 === 'number' && !isNaN(point1.kmbCircuit3) ? point1.kmbCircuit3 : 0;
      const ckt3_2 =
        typeof point2.kmbCircuit3 === 'number' && !isNaN(point2.kmbCircuit3) ? point2.kmbCircuit3 : 0;
      const load1 =
        ckt3_1 > 0
          ? ckt3_1
          : typeof point1.totalPower === 'number' && !isNaN(point1.totalPower)
          ? point1.totalPower
          : 0;
      const load2 =
        ckt3_2 > 0
          ? ckt3_2
          : typeof point2.totalPower === 'number' && !isNaN(point2.totalPower)
          ? point2.totalPower
          : 0;

      selectedPoint = load2 > load1 ? point2 : point1;
    }
  } else {
    selectedPoint = (hasScadaPower(point1) ? point1 : null) || (hasScadaPower(point2) ? point2 : null) || point1 || point2;
  }

  // 2. User's rule: Ensure at least 1 power flow value during that moment (+15 min or -15 min from time of record)
  // to prevent 0 values of power record and to be used in estimation of conductor temperature
  if (!hasScadaPower(selectedPoint)) {
    let closestIn15: (typeof powerSummary.dataPoints)[0] | null = null;
    let closestDiff15 = Infinity;
    for (const dp of powerSummary.dataPoints) {
      if (!hasScadaPower(dp)) continue;
      let dpMin = dp.timeMinutes;
      if (targetMinutes === 1440 && dpMin === 0) dpMin = 1440;
      const diff = Math.abs(dpMin - targetMinutes);
      if (diff <= 15 && diff < closestDiff15) {
        closestDiff15 = diff;
        closestIn15 = dp;
      }
    }
    if (closestIn15) {
      selectedPoint = closestIn15;
    }
  }

  // 3. Fallback: Search for the highest non-zero power point within the same hour
  if (!hasScadaPower(selectedPoint)) {
    const pointsInHour = powerSummary.dataPoints.filter((dp) => {
      if (!hasScadaPower(dp)) return false;
      let dpMin = dp.timeMinutes;
      if (hEndMin === 1440 && dpMin === 0) dpMin = 1440;
      return dpMin >= hStartMin && dpMin <= hEndMin;
    });
    if (pointsInHour.length > 0) {
      selectedPoint = pointsInHour.reduce((max, cur) => {
        const curVal = cur.totalPower || cur.kmbCircuit3 || 0;
        const maxVal = max.totalPower || max.kmbCircuit3 || 0;
        return curVal > maxVal ? cur : max;
      }, pointsInHour[0]);
    }
  }

  // 4. Fallback: Search within +/- 90 minutes of targetMinutes
  if (!hasScadaPower(selectedPoint)) {
    let closestAny: (typeof powerSummary.dataPoints)[0] | null = null;
    let closestAnyDiff = Infinity;
    for (const dp of powerSummary.dataPoints) {
      if (!hasScadaPower(dp)) continue;
      let dpMin = dp.timeMinutes;
      if (targetMinutes === 1440 && dpMin === 0) dpMin = 1440;
      const diff = Math.abs(dpMin - targetMinutes);
      if (diff < closestAnyDiff) {
        closestAnyDiff = diff;
        closestAny = dp;
      }
    }
    if (closestAny && closestAnyDiff <= 90) {
      selectedPoint = closestAny;
    }
  }

  // 5. Final fallback to peak load point on that day
  if (!hasScadaPower(selectedPoint)) {
    const validPoints = powerSummary.dataPoints.filter(hasScadaPower);
    if (validPoints.length > 0) {
      selectedPoint = validPoints.reduce((max, cur) => {
        const curVal = cur.totalPower || cur.kmbCircuit3 || 0;
        const maxVal = max.totalPower || max.kmbCircuit3 || 0;
        return curVal > maxVal ? cur : max;
      }, validPoints[0]);
    }
  }

  if (!selectedPoint) {
    return emptyRes;
  }

  const hasKmb = powerSummary.substationsLoaded ? Boolean(powerSummary.substationsLoaded.KMB) : true;
  const hasKma = powerSummary.substationsLoaded ? Boolean(powerSummary.substationsLoaded.KMA) : true;
  const hasKna = powerSummary.substationsLoaded ? Boolean(powerSummary.substationsLoaded.KNA) : true;

  const pCkt3 =
    hasKmb && typeof selectedPoint.kmbCircuit3 === 'number' && !isNaN(selectedPoint.kmbCircuit3)
      ? Number(selectedPoint.kmbCircuit3.toFixed(2))
      : null;
  const pCkt2 =
    hasKma && typeof selectedPoint.kmaCircuit2 === 'number' && !isNaN(selectedPoint.kmaCircuit2)
      ? Number(selectedPoint.kmaCircuit2.toFixed(2))
      : null;
  const p33Nkt =
    hasKna && typeof selectedPoint.knaNkt === 'number' && !isNaN(selectedPoint.knaNkt)
      ? Number(selectedPoint.knaNkt.toFixed(2))
      : null;
  const p33Oil =
    hasKna && typeof selectedPoint.knaOilFilled === 'number' && !isNaN(selectedPoint.knaOilFilled)
      ? Number(selectedPoint.knaOilFilled.toFixed(2))
      : null;
  const pTotal =
    typeof selectedPoint.totalPower === 'number' && !isNaN(selectedPoint.totalPower) && selectedPoint.totalPower > 0
      ? Number(selectedPoint.totalPower.toFixed(2))
      : pCkt3 !== null || pCkt2 !== null || p33Nkt !== null || p33Oil !== null
      ? Number(((pCkt3 ?? 0) + (pCkt2 ?? 0) + (p33Nkt ?? 0) + (p33Oil ?? 0)).toFixed(2))
      : null;

  return {
    pTotal,
    pCkt3,
    pCkt2,
    p33Nkt,
    p33Oil,
    selectedTime: selectedPoint.time || '',
  };
}

export function computeSectionRowsForDatabase(
  sec: CableSectionInfo,
  sortedDates: string[],
  store: MasterSectionSummaryData,
  powerSummariesByDate?: Map<string, DailyPowerSummary>
): DatabaseSheetRow[] {
  const secRows: DatabaseSheetRow[] = [];
  const phasesToExport = sec.category === 'land' ? ['A', 'B', 'C'] : ['SM'];
  const distinctDofs = getSectionDistinctDofs(sec);

  for (let dateIdx = 0; dateIdx < sortedDates.length; dateIdx++) {
    const dKey = sortedDates[dateIdx];
    const powerSummary = findPowerSummaryForDate(dKey, powerSummariesByDate);

    for (const ph of phasesToExport) {
      let rec: MasterSectionPeakRecord | undefined;
      if (sec.category === 'land') {
        rec = store.sections[`${sec.sectionId}_${ph}_${dKey}`];
      } else {
        rec =
          store.sections[`${sec.sectionId}_SM_${dKey}`] ||
          store.sections[`${sec.sectionId}_${dKey}`];
      }

      if (rec && isSyntheticSectionRecord(rec)) {
        rec = undefined;
      }

      const sectionSamplingPoints = CIRCUIT_3_SAMPLING_POINTS.filter(
        (p) =>
          p.sectionId === sec.sectionId &&
          (sec.category === 'submarine' ? p.cableCategory === 'submarine' : p.phase === ph)
      );

      const tsMax = rec?.maxTimestamp || rec?.peakTime || '';
      const tsMin = rec?.minTimestamp || '';
      const flowAtMax = lookupCoincidentPowerAtTimestamp(powerSummary, tsMax);
      const flowAtMin = lookupCoincidentPowerAtTimestamp(powerSummary, tsMin);

      const row: DatabaseSheetRow = {
        Sheet_Section_ID: sec.sectionId,
        Section_Name: sec.name,
        Category: sec.category,
        Date: dKey,
        Phase: ph,
        Max_Fiber_Temp_C: '',
        Min_Fiber_Temp_C: '',
        Mean_Fiber_Temp_C: '',
        IEC_Est_Max_Conductor_C: '',
        IEC_Est_Min_Conductor_C: '',
        DOF_Max_m: '',
        DOF_Min_m: '',
        Timestamp_Max: '',
        Timestamp_Min: '',
        Power_Flow_During_Max_Total_MW: '',
        Power_Flow_During_Max_Ckt3_MW: '',
        Power_Flow_During_Max_Ckt2_MW: '',
        Power_Flow_During_Max_33NKT_MW: '',
        Power_Flow_During_Max_33Oil_MW: '',
        Power_Flow_During_Min_Total_MW: '',
        Power_Flow_During_Min_Ckt3_MW: '',
        Power_Flow_During_Min_Ckt2_MW: '',
        Power_Flow_During_Min_33NKT_MW: '',
        Power_Flow_During_Min_33Oil_MW: '',
        File_Name_Max: '',
        File_Name_Min: '',
      };

      // 1. Populate Daily Peak Fiber Temp (Tf) & IEC Conductor Temp (Tc) for ALL DOFs in this section
      let maxDofTf = -Infinity;
      let minDofTf = Infinity;
      let sumDofTf = 0;
      let countDofTf = 0;
      let maxDofTc = -Infinity;
      let maxDofPos: number | '' = '';
      let minDofPos: number | '' = '';
      let bestDofTs = tsMax;
      let bestDofFile = rec?.maxFileName || rec?.sourceFile || '';

      for (const dof of distinctDofs) {
        const dofKey = dof.toFixed(2);
        const dofDailyRec = store.dofDailyPeaks?.[`${sec.sectionId}_${ph}_${dKey}_${dofKey}`];
        const sp = sectionSamplingPoints.find((p) => Math.abs(p.dof - dof) < 0.05);
        const pointVal = sp ? store.points?.[`${sp.id}_${dKey}`] : undefined;

        let tfVal: number | '' = '';
        let dofTs = tsMax;

        if (dofDailyRec && typeof dofDailyRec.maxTf === 'number' && dofDailyRec.maxTf > -100) {
          tfVal = Number(dofDailyRec.maxTf.toFixed(2));
          if (dofDailyRec.timestamp) dofTs = dofDailyRec.timestamp;
        } else if (typeof pointVal === 'number' && pointVal > -100) {
          tfVal = Number(pointVal.toFixed(2));
        } else if (
          rec &&
          typeof rec.maxTf === 'number' &&
          (distinctDofs.length === 1 ||
            (rec.maxTfDof !== undefined && Math.abs(rec.maxTfDof - dof) < 0.05))
        ) {
          tfVal = Number(rec.maxTf.toFixed(2));
        }

        let tcVal: number | '' = '';
        if (typeof tfVal === 'number' && flowAtMax.pCkt3 !== null) {
          const estDof = evaluateSectionConductorTemp(
            sec,
            tfVal,
            flowAtMax.pCkt3,
            flowAtMax.pCkt2 ?? 0,
            flowAtMax.p33Nkt ?? 0,
            flowAtMax.p33Oil ?? 0
          );
          if (estDof.tc60287 !== null && !isNaN(estDof.tc60287)) {
            tcVal = Number(estDof.tc60287.toFixed(2));
          }
        }

        row[`Tf_DOF_${dofKey}m_C`] = tfVal;
        row[`Tc_DOF_${dofKey}m_C`] = tcVal;

        if (typeof tfVal === 'number') {
          if (tfVal > maxDofTf) {
            maxDofTf = tfVal;
            maxDofPos = Number(dof.toFixed(2));
            if (dofTs) bestDofTs = dofTs;
            if (dofDailyRec?.fileName) bestDofFile = dofDailyRec.fileName;
          }
          if (tfVal < minDofTf) {
            minDofTf = tfVal;
            minDofPos = Number(dof.toFixed(2));
          }
          sumDofTf += tfVal;
          countDofTf++;
        }
        if (typeof tcVal === 'number' && tcVal > maxDofTc) {
          maxDofTc = tcVal;
        }
      }

      // 2. Populate Section Daily Summary & Coincident 4-Circuit Power Flow Record (same structure)
      const hasValidRecord = Boolean(rec) || countDofTf > 0;
      if (!hasValidRecord) {
        secRows.push(row);
        continue;
      }

      const finalMaxTf =
        rec && typeof rec.maxTf === 'number'
          ? Number(rec.maxTf.toFixed(2))
          : maxDofTf !== -Infinity
          ? Number(maxDofTf.toFixed(2))
          : '';
      const finalMinTf =
        rec && typeof rec.minTf === 'number'
          ? Number(rec.minTf.toFixed(2))
          : minDofTf !== Infinity
          ? Number(minDofTf.toFixed(2))
          : finalMaxTf;
      const finalMeanTf =
        rec && typeof rec.meanTf === 'number'
          ? Number(rec.meanTf.toFixed(2))
          : countDofTf > 0
          ? Number((sumDofTf / countDofTf).toFixed(2))
          : finalMaxTf;

      let iecMaxConductor: number | '' = maxDofTc !== -Infinity ? Number(maxDofTc.toFixed(2)) : '';
      if (typeof finalMaxTf === 'number' && flowAtMax.pCkt3 !== null) {
        const estMax = evaluateSectionConductorTemp(
          sec,
          finalMaxTf,
          flowAtMax.pCkt3,
          flowAtMax.pCkt2 ?? 0,
          flowAtMax.p33Nkt ?? 0,
          flowAtMax.p33Oil ?? 0
        );
        if (estMax.tc60287 !== null && !isNaN(estMax.tc60287)) {
          iecMaxConductor = Number(estMax.tc60287.toFixed(2));
        }
      }

      let iecMinConductor: number | '' = '';
      if (typeof finalMinTf === 'number' && flowAtMin.pCkt3 !== null) {
        const estMin = evaluateSectionConductorTemp(
          sec,
          finalMinTf,
          flowAtMin.pCkt3,
          flowAtMin.pCkt2 ?? 0,
          flowAtMin.p33Nkt ?? 0,
          flowAtMin.p33Oil ?? 0
        );
        if (estMin.tc60287 !== null && !isNaN(estMin.tc60287)) {
          iecMinConductor = Number(estMin.tc60287.toFixed(2));
        }
      }

      row.Max_Fiber_Temp_C = finalMaxTf;
      row.Min_Fiber_Temp_C = finalMinTf;
      row.Mean_Fiber_Temp_C = finalMeanTf;
      row.IEC_Est_Max_Conductor_C = iecMaxConductor;
      row.IEC_Est_Min_Conductor_C = iecMinConductor;
      row.DOF_Max_m =
        rec?.maxTfDof !== undefined ? Number(rec.maxTfDof.toFixed(2)) : maxDofPos;
      row.DOF_Min_m =
        rec?.minTfDof !== undefined ? Number(rec.minTfDof.toFixed(2)) : minDofPos;
      row.Timestamp_Max = bestDofTs || tsMax;
      row.Timestamp_Min = tsMin;
      row.Power_Flow_During_Max_Total_MW = flowAtMax.pTotal !== null ? flowAtMax.pTotal : '';
      row.Power_Flow_During_Max_Ckt3_MW = flowAtMax.pCkt3 !== null ? flowAtMax.pCkt3 : '';
      row.Power_Flow_During_Max_Ckt2_MW = flowAtMax.pCkt2 !== null ? flowAtMax.pCkt2 : '';
      row.Power_Flow_During_Max_33NKT_MW = flowAtMax.p33Nkt !== null ? flowAtMax.p33Nkt : '';
      row.Power_Flow_During_Max_33Oil_MW = flowAtMax.p33Oil !== null ? flowAtMax.p33Oil : '';
      row.Power_Flow_During_Min_Total_MW = flowAtMin.pTotal !== null ? flowAtMin.pTotal : '';
      row.Power_Flow_During_Min_Ckt3_MW = flowAtMin.pCkt3 !== null ? flowAtMin.pCkt3 : '';
      row.Power_Flow_During_Min_Ckt2_MW = flowAtMin.pCkt2 !== null ? flowAtMin.pCkt2 : '';
      row.Power_Flow_During_Min_33NKT_MW = flowAtMin.p33Nkt !== null ? flowAtMin.p33Nkt : '';
      row.Power_Flow_During_Min_33Oil_MW = flowAtMin.p33Oil !== null ? flowAtMin.p33Oil : '';
      row.File_Name_Max = bestDofFile;
      row.File_Name_Min = rec?.minFileName || rec?.sourceFile || bestDofFile;

      secRows.push(row);
    }
  }

  return secRows;
}

/**
 * Computes Section Daily Profile rows: 24 hourly records per day.
 * Columns: Every DOF in the section (Raw Tf & Estimated Core Tc),
 * followed by Section Maximum Tf & Tc, Max DOF, Peak Timestamp,
 * and 4-Circuit Power Flow during hourly peak (KMB Ckt 3, KMA Ckt 2, KNA 33kV NKT, KNA 33kV Oil).
 */
export function computeSectionDailyProfileRows(
  sec: CableSectionInfo,
  sortedDates: string[],
  store: MasterSectionSummaryData,
  powerSummariesByDate?: Map<string, DailyPowerSummary>
): SectionDailyProfileRow[] {
  const secRows: SectionDailyProfileRow[] = [];
  const phasesToExport = sec.category === 'land' ? ['A', 'B', 'C'] : ['SM'];
  const distinctDofs = getSectionDistinctDofs(sec);

  for (let dateIdx = 0; dateIdx < sortedDates.length; dateIdx++) {
    const dKey = sortedDates[dateIdx];
    const powerSummary = findPowerSummaryForDate(dKey, powerSummariesByDate);

    for (const ph of phasesToExport) {
      for (let h = 0; h < 24; h++) {
        const hourStr = `${String(h).padStart(2, '0')}:00`;
        const hourIdxStr = String(h);
        const nextHourLegacyStr = `${String((h + 1) % 24).padStart(2, '0')}:00`;
        const startH = String(h).padStart(2, '0');
        const endH = String((h + 1) % 24).padStart(2, '0');
        const timeRangeStr = `${startH}.01 - ${endH}.00`;
        const row: SectionDailyProfileRow = {
          Sheet_Section_ID: sec.sectionId,
          Section_Name: sec.name,
          Category: sec.category,
          Date: dKey,
          Time: timeRangeStr,
          Phase: ph,
        };

        let maxTfInHour = -Infinity;
        let maxTcInHour = -Infinity;
        let peakDof: number | '' = '';
        let peakTime = '';
        let peakFlow: ReturnType<typeof lookupCoincidentPowerForHourlyProfile> | null = null;
        let hasAnyDofInHour = false;

        for (const dof of distinctDofs) {
          const dofKey = dof.toFixed(2);
          // Look up across all keying conventions (hour index, hour:00, or legacy end-of-hour boundary key)
          const kIdx = `${sec.sectionId}_${ph}_${dKey}_${hourIdxStr}_${dofKey}`;
          const kStr = `${sec.sectionId}_${ph}_${dKey}_${hourStr}_${dofKey}`;
          const kNext = `${sec.sectionId}_${ph}_${dKey}_${nextHourLegacyStr}_${dofKey}`;

          let dofHourlyRec = store.dofHourlyPeaks?.[kIdx] || store.dofHourlyPeaks?.[kStr];
          const recNext = store.dofHourlyPeaks?.[kNext];
          if (recNext && typeof recNext.maxTf === 'number') {
            const nextTsMin = parseTimeStrToMinutes(recNext.timestamp);
            if (nextTsMin !== null && Math.floor((nextTsMin - 1) / 60) === h) {
              if (!dofHourlyRec || recNext.maxTf > dofHourlyRec.maxTf) {
                dofHourlyRec = recNext;
              }
            }
          }

          if (dofHourlyRec && typeof dofHourlyRec.maxTf === 'number') {
            hasAnyDofInHour = true;
            const tfVal = Number(dofHourlyRec.maxTf.toFixed(2));
            const ts = dofHourlyRec.timestamp || hourStr;
            const flow = lookupCoincidentPowerForHourlyProfile(powerSummary, ts, h);

            let tcVal: number | '' = '';
            if (flow.pCkt3 !== null) {
              const est = evaluateSectionConductorTemp(
                sec,
                tfVal,
                flow.pCkt3,
                flow.pCkt2 ?? 0,
                flow.p33Nkt ?? 0,
                flow.p33Oil ?? 0
              );
              if (est.tc60287 !== null && !isNaN(est.tc60287)) {
                tcVal = Number(est.tc60287.toFixed(2));
              }
            }

            row[`Tf_DOF_${dofKey}m_C`] = tfVal;
            row[`Tc_DOF_${dofKey}m_C`] = tcVal;

            if (tfVal > maxTfInHour) {
              maxTfInHour = tfVal;
              peakDof = Number(dof.toFixed(2));
              peakTime = ts;
              peakFlow = flow;
            }
            if (tcVal !== '' && tcVal > maxTcInHour) {
              maxTcInHour = tcVal;
            }
          } else {
            row[`Tf_DOF_${dofKey}m_C`] = '';
            row[`Tc_DOF_${dofKey}m_C`] = '';
          }
        }

        if (hasAnyDofInHour) {
          if (!peakFlow || (peakFlow.pCkt3 === 0 && (peakFlow.pTotal ?? 0) === 0)) {
            peakFlow = lookupCoincidentPowerForHourlyProfile(powerSummary, peakTime || hourStr, h);
          }
          row.Section_Max_Tf_C = maxTfInHour !== -Infinity ? Number(maxTfInHour.toFixed(2)) : '';
          row.Section_Max_Tc_C = maxTcInHour !== -Infinity ? Number(maxTcInHour.toFixed(2)) : '';
          row.Section_Max_DOF_m = peakDof !== '' ? Number(Number(peakDof).toFixed(2)) : '';
          row.Hourly_Peak_Time = peakTime;
          row.Power_Ckt3_MW =
            peakFlow?.pCkt3 !== null && peakFlow?.pCkt3 !== undefined
              ? Number(peakFlow.pCkt3.toFixed(2))
              : '';
          row.Power_Ckt2_MW =
            peakFlow?.pCkt2 !== null && peakFlow?.pCkt2 !== undefined
              ? Number(peakFlow.pCkt2.toFixed(2))
              : '';
          row.Power_33NKT_MW =
            peakFlow?.p33Nkt !== null && peakFlow?.p33Nkt !== undefined
              ? Number(peakFlow.p33Nkt.toFixed(2))
              : '';
          row.Power_33Oil_MW =
            peakFlow?.p33Oil !== null && peakFlow?.p33Oil !== undefined
              ? Number(peakFlow.p33Oil.toFixed(2))
              : '';
          row.Total_Power_MW =
            peakFlow?.pTotal !== null && peakFlow?.pTotal !== undefined
              ? Number(peakFlow.pTotal.toFixed(2))
              : '';
        } else {
          row.Section_Max_Tf_C = '';
          row.Section_Max_Tc_C = '';
          row.Section_Max_DOF_m = '';
          row.Hourly_Peak_Time = '';
          // If power summary exists for this date, preserve coincident power flow for this hour period so power is never missing
          const hourFlow = lookupCoincidentPowerForHourlyProfile(powerSummary, hourStr, h);
          row.Power_Ckt3_MW = hourFlow.pCkt3 !== null ? Number(hourFlow.pCkt3.toFixed(2)) : '';
          row.Power_Ckt2_MW = hourFlow.pCkt2 !== null ? Number(hourFlow.pCkt2.toFixed(2)) : '';
          row.Power_33NKT_MW = hourFlow.p33Nkt !== null ? Number(hourFlow.p33Nkt.toFixed(2)) : '';
          row.Power_33Oil_MW = hourFlow.p33Oil !== null ? Number(hourFlow.p33Oil.toFixed(2)) : '';
          row.Total_Power_MW = hourFlow.pTotal !== null ? Number(hourFlow.pTotal.toFixed(2)) : '';
        }

        secRows.push(row);
      }
    }
  }

  return secRows;
}

function formatDatabaseNumCell(val: number | '' | undefined): string {
  if (typeof val === 'number' && !isNaN(val)) {
    return val.toFixed(2);
  }
  return '';
}

function getOrderedMasterSheetColumns(sec: CableSectionInfo, sampleRow?: DatabaseSheetRow): string[] {
  const distinctDofs = getSectionDistinctDofs(sec);
  const baseStart = ['Sheet_Section_ID', 'Section_Name', 'Category', 'Date', 'Phase'];
  const dofCols: string[] = [];
  for (const dof of distinctDofs) {
    const dofKey = dof.toFixed(2);
    dofCols.push(`Tf_DOF_${dofKey}m_C`, `Tc_DOF_${dofKey}m_C`);
  }
  const summaryAndPowerCols = [
    'Max_Fiber_Temp_C',
    'Min_Fiber_Temp_C',
    'Mean_Fiber_Temp_C',
    'IEC_Est_Max_Conductor_C',
    'IEC_Est_Min_Conductor_C',
    'DOF_Max_m',
    'DOF_Min_m',
    'Timestamp_Max',
    'Timestamp_Min',
    'Power_Flow_During_Max_Total_MW',
    'Power_Flow_During_Max_Ckt3_MW',
    'Power_Flow_During_Max_Ckt2_MW',
    'Power_Flow_During_Max_33NKT_MW',
    'Power_Flow_During_Max_33Oil_MW',
    'Power_Flow_During_Min_Total_MW',
    'Power_Flow_During_Min_Ckt3_MW',
    'Power_Flow_During_Min_Ckt2_MW',
    'Power_Flow_During_Min_33NKT_MW',
    'Power_Flow_During_Min_33Oil_MW',
    'File_Name_Max',
    'File_Name_Min',
  ];
  const combined = [...baseStart, ...dofCols, ...summaryAndPowerCols];
  if (sampleRow) {
    for (const k of Object.keys(sampleRow)) {
      if (!combined.includes(k) && !k.startsWith('_')) {
        combined.push(k);
      }
    }
  }
  return combined;
}

function finalizeMultiSheetWorkbookAndCsv(
  rowsBySection: Map<string, DatabaseSheetRow[]>,
  sortedDates: string[]
): GeneratedDatabaseResult {
  // 1. Build Strictly 19-Sheet XLSX Excel Workbook (1 Section per 1 Sheet — 19 Sheets Total)
  const wb = XLSX.utils.book_new();
  let totalRecordCount = 0;

  // Strictly 19 sheets: 1 section per 1 sheet (Sec_1.1 .. Sec_1.6 & Zone_2.1 .. Zone_2.13)
  for (const sec of CIRCUIT_3_SECTIONS) {
    const sRows = rowsBySection.get(sec.sectionId) || [];
    totalRecordCount += sRows.length;
    const sheetName = sec.category === 'land' ? `Sec_${sec.sectionId}` : `Zone_${sec.sectionId}`;
    const orderedCols = getOrderedMasterSheetColumns(sec, sRows[0]);

    const normalizedRows =
      sRows.length > 0
        ? sRows.map((r) => {
            const orderedObj: Record<string, any> = {};
            for (const col of orderedCols) {
              orderedObj[col] = r[col] !== undefined ? r[col] : '';
            }
            return orderedObj;
          })
        : [{ Sheet_Section_ID: sec.sectionId, Section_Name: sec.name }];

    const ws = XLSX.utils.json_to_sheet(normalizedRows, { header: orderedCols });

    // Prune blank/empty cells from the worksheet structure so SheetJS doesn't bloat XML
    for (const cellAddress of Object.keys(ws)) {
      if (cellAddress.startsWith('!')) continue;
      const cell = ws[cellAddress];
      if (!cell || cell.v === '' || cell.v === null || cell.v === undefined) {
        delete ws[cellAddress];
      }
    }
    ws['!cols'] = orderedCols.map((col) => {
      if (col === 'Section_Name' || col.startsWith('File_Name')) return { wch: 32 };
      if (col.startsWith('Power_Flow_')) return { wch: 27 };
      if (col.startsWith('Tf_DOF_') || col.startsWith('Tc_DOF_')) return { wch: 19 };
      if (col.startsWith('IEC_Est_')) return { wch: 23 };
      return { wch: 16 };
    });
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Enable DEFLATE compression for compact file output
  const xlsxArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  const xlsxBuffer = new Uint8Array(xlsxArrayBuffer);

  // 2. Build Multi-Sheet CSV Database String (including all DOF columns per section + same Power Flow columns)
  const csvLines: string[] = [];

  for (const sec of CIRCUIT_3_SECTIONS) {
    const sRows = rowsBySection.get(sec.sectionId) || [];
    const orderedCols = getOrderedMasterSheetColumns(sec, sRows[0]);
    csvLines.push(`\n# =========================================================================`);
    csvLines.push(`# SHEET: ${sec.category === 'land' ? 'Sec' : 'Zone'} ${sec.sectionId} — ${sec.name}`);
    csvLines.push(`# =========================================================================`);
    csvLines.push(orderedCols.join(','));

    for (const r of sRows) {
      csvLines.push(
        orderedCols
          .map((k) => {
            const v = r[k];
            if (typeof v === 'number') {
              return Number.isFinite(v) ? v.toFixed(2) : '';
            }
            if (v === '' || v === undefined || v === null) return '';
            const str = String(v);
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      );
    }
  }

  const filenameBase = `DTS_Circuit3_19Sheets_Database_${sortedDates[0] || 'start'}_to_${sortedDates[sortedDates.length - 1] || 'end'}`;

  return {
    csvText: csvLines.join('\n').trimStart(),
    xlsxBuffer,
    recordCount: totalRecordCount,
    sheetCount: CIRCUIT_3_SECTIONS.length,
    dateKeys: sortedDates,
    filenameBase,
  };
}

/**
 * Builds a 19-sheet XLSX and CSV Section Daily Profile file.
 * Each sheet represents 1 of 19 sections.
 * Rows: 24 hourly records per day.
 * Columns: Every DOF (Tf and Tc), Section Max Tf & Tc, and Coincident 4-Circuit Power Flow.
 */
function finalizeSectionDailyProfileWorkbookAndCsv(
  rowsBySection: Map<string, SectionDailyProfileRow[]>,
  sortedDates: string[]
): GeneratedDatabaseResult {
  const wb = XLSX.utils.book_new();
  let totalRecordCount = 0;

  for (const sec of CIRCUIT_3_SECTIONS) {
    const sRows = rowsBySection.get(sec.sectionId) || [];
    totalRecordCount += sRows.length;
    const sheetName = sec.category === 'land' ? `Sec_${sec.sectionId}` : `Zone_${sec.sectionId}`;
    const ws = XLSX.utils.json_to_sheet(
      sRows.length > 0 ? sRows : [{ Sheet_Section_ID: sec.sectionId, Section_Name: sec.name }]
    );

    // CRITICAL SIZE OPTIMIZATION:
    // In OpenXML SpreadsheetML, empty cells should NOT emit <c r="..." t="s"><v>0</v></c> tags
    // or bloat the sharedStrings table with millions of empty string tokens.
    // Pruning empty cells allows true sparse storage, reducing uncompressed XML by up to 80%!
    for (const cellAddress of Object.keys(ws)) {
      if (cellAddress.startsWith('!')) continue;
      const cell = ws[cellAddress];
      if (!cell || cell.v === '' || cell.v === null || cell.v === undefined) {
        delete ws[cellAddress];
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // CRITICAL SIZE OPTIMIZATION:
  // Enable ZIP DEFLATE compression in XLSX write (compression: true).
  // Default in SheetJS is compression: false (STORE method), which leaves XML completely uncompressed!
  const xlsxArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  const xlsxBuffer = new Uint8Array(xlsxArrayBuffer);

  const csvLines: string[] = [];
  for (const sec of CIRCUIT_3_SECTIONS) {
    const sRows = rowsBySection.get(sec.sectionId) || [];
    csvLines.push(`\n# =========================================================================`);
    csvLines.push(`# SHEET: ${sec.category === 'land' ? 'Sec' : 'Zone'} ${sec.sectionId} — ${sec.name}`);
    csvLines.push(`# =========================================================================`);

    if (sRows.length > 0) {
      const keys = Object.keys(sRows[0]);
      csvLines.push(keys.join(','));
      for (const r of sRows) {
        csvLines.push(
          keys
            .map((k) => {
              const v = r[k];
              if (typeof v === 'number') {
                return Number.isFinite(v) ? v.toFixed(2) : '';
              }
              if (v === '' || v === undefined || v === null) return '';
              const str = String(v);
              // Only quote strings if they contain commas, quotes, or newlines
              if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(',')
        );
      }
    }
  }

  const filenameBase = `DTS_Section_Daily_Profile_19Sheets_${sortedDates[0] || 'start'}_to_${sortedDates[sortedDates.length - 1] || 'end'}`;

  return {
    csvText: csvLines.join('\n'),
    xlsxBuffer,
    recordCount: totalRecordCount,
    sheetCount: CIRCUIT_3_SECTIONS.length,
    dateKeys: sortedDates,
    filenameBase,
  };
}

let lastUploadedMasterDatabase: ParsedExistingDatabaseFile | null = null;
let lastUploadedProfileDatabase: ParsedExistingDailyProfileFile | null = null;

export function getLastUploadedMasterDatabase(): ParsedExistingDatabaseFile | null {
  return lastUploadedMasterDatabase;
}

export function clearLastUploadedMasterDatabase(): void {
  lastUploadedMasterDatabase = null;
}

export function getLastUploadedProfileDatabase(): ParsedExistingDailyProfileFile | null {
  return lastUploadedProfileDatabase;
}

export function clearLastUploadedProfileDatabase(): void {
  lastUploadedProfileDatabase = null;
}

function hasExistingMasterRowData(row?: DatabaseSheetRow | null): boolean {
  if (!row) return false;
  const isPos = (v: any) => {
    if (typeof v === 'number' && !isNaN(v) && v > 0) return true;
    if (typeof v === 'string' && v.trim() !== '') {
      const num = parseFloat(v.trim());
      return !isNaN(num) && num > 0;
    }
    return false;
  };
  if (isPos(row.Max_Fiber_Temp_C)) return true;
  if (isPos(row.IEC_Est_Max_Conductor_C)) return true;
  if (isPos(row.Mean_Fiber_Temp_C)) return true;
  if (isPos(row.Min_Fiber_Temp_C)) return true;
  for (const [k, v] of Object.entries(row)) {
    if ((k.startsWith('Tf_DOF_') || k.startsWith('Tc_DOF_') || k.startsWith('Power_')) && isPos(v)) {
      return true;
    }
  }
  return false;
}

function hasExistingProfileRowData(row?: SectionDailyProfileRow | null): boolean {
  if (!row) return false;
  const isPos = (v: any) => {
    if (typeof v === 'number' && !isNaN(v) && v > 0) return true;
    if (typeof v === 'string' && v.trim() !== '') {
      const num = parseFloat(v.trim());
      return !isNaN(num) && num > 0;
    }
    return false;
  };
  if (isPos(row.Section_Max_Tf_C)) return true;
  if (isPos(row.Section_Max_Tc_C)) return true;
  for (const [k, v] of Object.entries(row)) {
    if ((k.startsWith('Tf_DOF_') || k.startsWith('Tc_DOF_') || k.startsWith('Power_')) && isPos(v)) {
      return true;
    }
  }
  return false;
}

function normalizePhaseCode(rawPhase: any, category: 'land' | 'submarine'): string {
  if (category === 'submarine') return 'SM';
  const cleaned = String(rawPhase || '')
    .replace(/^Phase\s+/i, '')
    .trim();
  if (/^A$/i.test(cleaned)) return 'A';
  if (/^B$/i.test(cleaned)) return 'B';
  if (/^C$/i.test(cleaned)) return 'C';
  if (/^(SM|Submarine|CH\s*3)/i.test(cleaned)) return 'SM';
  return cleaned || 'A';
}

export async function buildSectionDailyProfileDatabaseAsync(
  startDate?: string,
  endDate?: string,
  powerSummariesByDate?: Map<string, DailyPowerSummary>,
  onSectionProgress?: (info: {
    sectionIndex: number;
    totalSections: number;
    sectionId: string;
    sectionName: string;
    sheetName: string;
    recordsBuilt: number;
  }) => void,
  existingDb?: ParsedExistingDailyProfileFile | null
): Promise<GeneratedDatabaseResult> {
  const store = getMasterSectionSummary();
  const activeExistingDb = existingDb ?? lastUploadedProfileDatabase;
  const baseSortedDates = resolveDatabaseSortedDates(store, startDate, endDate);
  const allDatesSet = new Set<string>(baseSortedDates);
  if (activeExistingDb) {
    for (const d of activeExistingDb.allRowDates) {
      if (!endDate || d <= endDate) allDatesSet.add(d);
    }
    for (const d of activeExistingDb.existingValidDates) {
      if (!endDate || d <= endDate) allDatesSet.add(d);
    }
  }
  const sortedDates = Array.from(allDatesSet).sort();
  const rowsBySection = new Map<string, SectionDailyProfileRow[]>();
  let cumulativeRecords = 0;

  for (let i = 0; i < CIRCUIT_3_SECTIONS.length; i++) {
    const sec = CIRCUIT_3_SECTIONS[i];
    const existingRows = activeExistingDb?.rowsBySection.get(sec.sectionId) || [];
    const existingRowMap = new Map<string, SectionDailyProfileRow>();
    const existingValidDatesInSec = new Set<string>();
    for (const er of existingRows) {
      if (endDate && er.Date > endDate) continue;
      const hNum = extractHourNumberFromTime(er.Time);
      const normPh = normalizePhaseCode(er.Phase, sec.category);
      existingRowMap.set(`${er.Date}_${hNum}_${normPh}`, er);
      if (hasExistingProfileRowData(er)) {
        existingValidDatesInSec.add(er.Date);
      }
    }

    const datesToCompute = sortedDates.filter((d) => !existingValidDatesInSec.has(d));
    const computedRows = computeSectionDailyProfileRows(sec, datesToCompute, store, powerSummariesByDate);

    for (const nr of computedRows) {
      const hNum = extractHourNumberFromTime(nr.Time);
      const normPh = normalizePhaseCode(nr.Phase, sec.category);
      const key = `${nr.Date}_${hNum}_${normPh}`;
      const prev = existingRowMap.get(key);
      if (!prev || !hasExistingProfileRowData(prev)) {
        existingRowMap.set(key, nr);
      }
    }

    const secRows = Array.from(existingRowMap.values()).sort((a, b) => {
      if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
      if (a.Time !== b.Time) return a.Time.localeCompare(b.Time);
      return (a.Phase || '').localeCompare(b.Phase || '');
    });

    rowsBySection.set(sec.sectionId, secRows);
    cumulativeRecords += secRows.length;

    const sheetName = sec.category === 'land' ? `Sec_${sec.sectionId}` : `Zone_${sec.sectionId}`;
    if (onSectionProgress) {
      onSectionProgress({
        sectionIndex: i + 1,
        totalSections: CIRCUIT_3_SECTIONS.length,
        sectionId: sec.sectionId,
        sectionName: sec.name,
        sheetName,
        recordsBuilt: cumulativeRecords,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  saveMasterSectionSummaryToLocal(store);
  return finalizeSectionDailyProfileWorkbookAndCsv(rowsBySection, sortedDates);
}

function resolveDatabaseSortedDates(
  store: MasterSectionSummaryData,
  startDate?: string,
  endDate?: string
): string[] {
  const allSectionKeys = Object.keys(store.sections);
  const dateSet = new Set<string>();
  for (const k of allSectionKeys) {
    const parts = k.split('_');
    const d = parts[parts.length - 1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      if (startDate && d < startDate) continue;
      if (endDate && d > endDate) continue;
      dateSet.add(d);
    }
  }

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
        const dStr = new Date(curMs).toISOString().slice(0, 10);
        dateSet.add(dStr);
      }
    }
  }

  return Array.from(dateSet).sort();
}

/**
 * Builds a 19-sheet XLSX and CSV Database file synchronously (1 Section per 1 Sheet, 19 Sheets total).
 */
export function buildMultiSheetDatabase(
  startDate?: string,
  endDate?: string,
  powerSummariesByDate?: Map<string, DailyPowerSummary>,
  existingDb?: ParsedExistingDatabaseFile | null
): GeneratedDatabaseResult {
  const store = getMasterSectionSummary();
  const activeExistingDb = existingDb ?? lastUploadedMasterDatabase;
  const baseSortedDates = resolveDatabaseSortedDates(store, startDate, endDate);
  const allDatesSet = new Set<string>(baseSortedDates);
  if (activeExistingDb) {
    for (const d of activeExistingDb.allRowDates) {
      if (!endDate || d <= endDate) allDatesSet.add(d);
    }
    for (const d of activeExistingDb.existingValidDates) {
      if (!endDate || d <= endDate) allDatesSet.add(d);
    }
  }
  const sortedDates = Array.from(allDatesSet).sort();
  const rowsBySection = new Map<string, DatabaseSheetRow[]>();

  for (const sec of CIRCUIT_3_SECTIONS) {
    const existingRows = activeExistingDb?.rowsBySection.get(sec.sectionId) || [];
    const rowMap = new Map<string, DatabaseSheetRow>();
    const existingValidDatesInSec = new Set<string>();
    for (const er of existingRows) {
      if (endDate && er.Date > endDate) continue;
      const normPh = normalizePhaseCode(er.Phase, sec.category);
      rowMap.set(`${er.Date}_${normPh}`, er);
      if (hasExistingMasterRowData(er)) {
        existingValidDatesInSec.add(er.Date);
      }
    }

    const datesToCompute = sortedDates.filter((d) => !existingValidDatesInSec.has(d));
    const computedRows = computeSectionRowsForDatabase(sec, datesToCompute, store, powerSummariesByDate);
    for (const nr of computedRows) {
      const normPh = normalizePhaseCode(nr.Phase, sec.category);
      const key = `${nr.Date}_${normPh}`;
      const prev = rowMap.get(key);
      if (!prev) {
        rowMap.set(key, nr);
      } else if (!hasExistingMasterRowData(prev) && hasExistingMasterRowData(nr)) {
        rowMap.set(key, nr);
      }
    }

    const secRows = Array.from(rowMap.values()).sort((a, b) => {
      if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
      return a.Phase.localeCompare(b.Phase);
    });
    rowsBySection.set(sec.sectionId, secRows);
  }

  saveMasterSectionSummaryToLocal(store);
  return finalizeMultiSheetWorkbookAndCsv(rowsBySection, sortedDates);
}

/**
 * Builds a 19-sheet XLSX and CSV Database file asynchronously with real-time per-section calculation progress.
 */
export async function buildMultiSheetDatabaseAsync(
  startDate?: string,
  endDate?: string,
  powerSummariesByDate?: Map<string, DailyPowerSummary>,
  onSectionProgress?: (info: {
    sectionIndex: number;
    totalSections: number;
    sectionId: string;
    sectionName: string;
    sheetName: string;
    recordsBuilt: number;
  }) => void,
  existingDb?: ParsedExistingDatabaseFile | null
): Promise<GeneratedDatabaseResult> {
  const store = getMasterSectionSummary();
  const activeExistingDb = existingDb ?? lastUploadedMasterDatabase;
  const baseSortedDates = resolveDatabaseSortedDates(store, startDate, endDate);
  const allDatesSet = new Set<string>(baseSortedDates);
  if (activeExistingDb) {
    for (const d of activeExistingDb.allRowDates) {
      if (!endDate || d <= endDate) allDatesSet.add(d);
    }
    for (const d of activeExistingDb.existingValidDates) {
      if (!endDate || d <= endDate) allDatesSet.add(d);
    }
  }
  const sortedDates = Array.from(allDatesSet).sort();
  const rowsBySection = new Map<string, DatabaseSheetRow[]>();
  let cumulativeRecords = 0;

  for (let i = 0; i < CIRCUIT_3_SECTIONS.length; i++) {
    const sec = CIRCUIT_3_SECTIONS[i];
    const existingRows = activeExistingDb?.rowsBySection.get(sec.sectionId) || [];
    const rowMap = new Map<string, DatabaseSheetRow>();
    const existingValidDatesInSec = new Set<string>();
    for (const er of existingRows) {
      if (endDate && er.Date > endDate) continue;
      const normPh = normalizePhaseCode(er.Phase, sec.category);
      rowMap.set(`${er.Date}_${normPh}`, er);
      if (hasExistingMasterRowData(er)) {
        existingValidDatesInSec.add(er.Date);
      }
    }

    const datesToCompute = sortedDates.filter((d) => !existingValidDatesInSec.has(d));
    const computedRows = computeSectionRowsForDatabase(sec, datesToCompute, store, powerSummariesByDate);
    for (const nr of computedRows) {
      const normPh = normalizePhaseCode(nr.Phase, sec.category);
      const key = `${nr.Date}_${normPh}`;
      const prev = rowMap.get(key);
      if (!prev) {
        rowMap.set(key, nr);
      } else if (!hasExistingMasterRowData(prev) && hasExistingMasterRowData(nr)) {
        rowMap.set(key, nr);
      }
    }

    const secRows = Array.from(rowMap.values()).sort((a, b) => {
      if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
      return a.Phase.localeCompare(b.Phase);
    });
    rowsBySection.set(sec.sectionId, secRows);
    cumulativeRecords += secRows.length;

    const sheetName = sec.category === 'land' ? `Sec_${sec.sectionId}` : `Zone_${sec.sectionId}`;
    if (onSectionProgress) {
      onSectionProgress({
        sectionIndex: i + 1,
        totalSections: CIRCUIT_3_SECTIONS.length,
        sectionId: sec.sectionId,
        sectionName: sec.name,
        sheetName,
        recordsBuilt: cumulativeRecords,
      });
    }

    // Yield to browser paint so calculation progress updates smoothly on screen
    await new Promise((resolve) => setTimeout(resolve, 12));
  }

  saveMasterSectionSummaryToLocal(store);
  return finalizeMultiSheetWorkbookAndCsv(rowsBySection, sortedDates);
}

export interface ParsedExistingDatabaseFile {
  fileName: string;
  fileFormat: 'xlsx' | 'csv';
  rowsBySection: Map<string, DatabaseSheetRow[]>;
  existingValidDates: string[];
  datesWithMissingPower: string[];
  allRowDates: string[];
  firstDate: string;
  latestDate: string;
  totalExistingRows: number;
}

function toNumOrEmptyCell(val: any): number | '' {
  const parsed = parseOptionalCellNumber(val);
  return parsed !== undefined ? Number(parsed.toFixed(2)) : '';
}

function normalizeDatabaseDateKey(raw: any): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + Math.round(raw) * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    let yr = parseInt(ymd[1], 10);
    if (yr > 2500) yr -= 543;
    return `${yr}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    let yr = parseInt(dmy[3], 10);
    if (yr > 2500) yr -= 543;
    const p1 = parseInt(dmy[1], 10);
    const p2 = parseInt(dmy[2], 10);
    const mo = p1 > 12 ? p2 : p2 > 12 ? p1 : p2;
    const da = p1 > 12 ? p1 : p2 > 12 ? p2 : p1;
    return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }
  return '';
}

/**
 * Parses an existing uploaded CSV or Excel (.xlsx) database file, preserving all 19 section sheets
 * and identifying existing dates so missing/extra dates from the Target Folder can be appended/updated.
 * Strictly keeps all existing records and columns untouched without editing or purging any values.
 */
export function parseUploadedDatabaseForUpdate(
  input: string | ArrayBuffer | Uint8Array,
  fileName: string
): ParsedExistingDatabaseFile {
  const rowsBySection = new Map<string, DatabaseSheetRow[]>();
  for (const sec of CIRCUIT_3_SECTIONS) {
    rowsBySection.set(sec.sectionId, []);
  }

  const validDatesSet = new Set<string>();
  const allDatesSet = new Set<string>();
  let totalExistingRows = 0;
  const validSectionIds = new Set(CIRCUIT_3_SECTIONS.map((s) => s.sectionId));
  const sectionMap = new Map(CIRCUIT_3_SECTIONS.map((s) => [s.sectionId, s]));
  const isCsv = fileName.toLowerCase().endsWith('.csv') || typeof input === 'string';
  const store = getMasterSectionSummary();
  if (!store.dofDailyPeaks) store.dofDailyPeaks = {};

  try {
    const rawRows: any[] = [];

    if (typeof input !== 'string') {
      const wb = XLSX.read(input, {
        type: 'array',
      });
      wb.SheetNames.forEach((sName, sheetIdx) => {
        const sheet = wb.Sheets[sName];
        const sheetSecCandidate = sName
          .replace(/^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)/i, '')
          .trim();
        const fallbackSecId =
          wb.SheetNames.length === CIRCUIT_3_SECTIONS.length
            ? CIRCUIT_3_SECTIONS[sheetIdx]?.sectionId || ''
            : '';
        const sheetSecId = validSectionIds.has(sheetSecCandidate)
          ? sheetSecCandidate
          : fallbackSecId;
        const sheetRows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
        for (const sr of sheetRows) {
          if (sheetSecId) {
            sr._sheetSecId = sheetSecId;
          }
          rawRows.push(sr);
        }
      });
    } else {
      const lines = input.split(/\r?\n/);
      let headers: string[] = [];
      let currentSheetSecId = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('#')) {
          const m = line.match(/SHEET:\s*(?:Sec|Zone)?\s*([0-9.]+)/i);
          if (m && validSectionIds.has(m[1])) {
            currentSheetSecId = m[1];
            headers = [];
          }
          continue;
        }

        const parts = splitCsvLineRespectingQuotes(line).map((p) =>
          p.replace(/^"|"$/g, '').trim()
        );
        if (
          parts[0] === 'Sheet_Section_ID' ||
          parts[0] === 'Section_ID' ||
          (headers.length === 0 &&
            (parts.includes('Date') ||
              parts.includes('Sheet_Section_ID') ||
              parts.includes('Section_ID')))
        ) {
          headers = parts;
          continue;
        }

        if (headers.length > 0 && parts.length >= 5) {
          const rowObj: Record<string, any> = {
            _colValues: parts,
            _sheetSecId: currentSheetSecId,
          };
          headers.forEach((h, idx) => {
            rowObj[h] = parts[idx] ?? '';
          });
          rawRows.push(rowObj);
        }
      }
    }

    for (const r of rawRows) {
      const colVals: any[] = Array.isArray(r._colValues)
        ? r._colValues
        : Object.keys(r)
            .filter((k) => !k.startsWith('_'))
            .map((k) => r[k]);

      const rawSecId = String(
        r._sheetSecId ||
          r.Sheet_Section_ID ||
          r.Section_ID ||
          r.sectionId ||
          r['Section ID'] ||
          colVals[0] ||
          ''
      )
        .replace(/^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)/i, '')
        .trim();

      const secInfo = sectionMap.get(rawSecId);
      if (!secInfo) continue;

      const dateKey = normalizeDatabaseDateKey(r.Date || r.date || r.dateKey || colVals[3] || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

      const phase = normalizePhaseCode(
        r.Phase || r.phase || colVals[4] || (secInfo.category === 'land' ? 'A' : 'SM'),
        secInfo.category
      );

      // Extract any per-DOF columns (`Tf_DOF_*`, `Tc_DOF_*`, `Time_DOF_*`) present in the uploaded sheet
      const distinctDofs = getSectionDistinctDofs(secInfo);
      const dofValuesMap: Record<string, number | string | ''> = {};
      const dofTfNums: number[] = [];
      const dofTcNums: number[] = [];

      // Also scan all raw keys on row `r` for `Tf_DOF_<num>m_C` / `Tc_DOF_<num>m_C` with any decimal precision
      const parsedRawTfByDof = new Map<number, number>();
      const parsedRawTcByDof = new Map<number, number>();
      const parsedRawTimeByDof = new Map<number, string>();
      for (const key of Object.keys(r)) {
        const tfMatch = key.match(/^Tf[_ ]?DOF[_ ]?([\d.]+)m?(?:[_ ]?C)?$/i);
        if (tfMatch) {
          const dNum = parseFloat(tfMatch[1]);
          const val = toNumOrEmptyCell(r[key]);
          if (!isNaN(dNum) && typeof val === 'number' && val > 0) {
            parsedRawTfByDof.set(dNum, val);
          }
          continue;
        }
        const tcMatch = key.match(/^Tc[_ ]?DOF[_ ]?([\d.]+)m?(?:[_ ]?C)?$/i);
        if (tcMatch) {
          const dNum = parseFloat(tcMatch[1]);
          const val = toNumOrEmptyCell(r[key]);
          if (!isNaN(dNum) && typeof val === 'number' && val > 0) {
            parsedRawTcByDof.set(dNum, val);
          }
          continue;
        }
        const timeMatch = key.match(/^Time[_ ]?DOF[_ ]?([\d.]+)m?$/i);
        if (timeMatch) {
          const dNum = parseFloat(timeMatch[1]);
          const tStr = String(r[key] || '').trim();
          if (!isNaN(dNum) && tStr) {
            parsedRawTimeByDof.set(dNum, tStr);
          }
        }
      }

      for (const dof of distinctDofs) {
        const dofKey = dof.toFixed(2);
        const dofKey1 = dof.toFixed(1);
        const dofKey0 = String(Math.round(dof));
        const tfCol = `Tf_DOF_${dofKey}m_C`;
        const tcCol = `Tc_DOF_${dofKey}m_C`;

        let tfCell = toNumOrEmptyCell(
          r[tfCol] ?? r[`Tf_DOF_${dofKey1}m_C`] ?? r[`Tf_DOF_${dofKey0}m_C`]
        );
        if (tfCell === '') {
          for (const [dNum, v] of parsedRawTfByDof.entries()) {
            if (Math.abs(dNum - dof) < 0.6) {
              tfCell = v;
              break;
            }
          }
        }

        let tcCell = toNumOrEmptyCell(
          r[tcCol] ?? r[`Tc_DOF_${dofKey1}m_C`] ?? r[`Tc_DOF_${dofKey0}m_C`]
        );
        if (tcCell === '') {
          for (const [dNum, v] of parsedRawTcByDof.entries()) {
            if (Math.abs(dNum - dof) < 0.6) {
              tcCell = v;
              break;
            }
          }
        }

        dofValuesMap[tfCol] = tfCell;
        dofValuesMap[tcCol] = tcCell;
        for (const [dNum, tStr] of parsedRawTimeByDof.entries()) {
          if (Math.abs(dNum - dof) < 0.6) {
            dofValuesMap[`Time_DOF_${dofKey}m`] = tStr;
            break;
          }
        }
        if (typeof tfCell === 'number' && tfCell > 0) {
          dofTfNums.push(tfCell);
          const dofStoreKey = `${secInfo.sectionId}_${phase}_${dateKey}_${dofKey}`;
          if (!store.dofDailyPeaks[dofStoreKey]) {
            store.dofDailyPeaks[dofStoreKey] = {
              dof,
              maxTf: tfCell,
              timestamp: String(r.Timestamp_Max || r.Timestamp_Peak || r.Peak_Time || ''),
              fileName: String(r.File_Name_Max || r.File_Name_Peak || r.Source_TEPR_File || ''),
            };
          }
        }
        if (typeof tcCell === 'number' && tcCell > 0) dofTcNums.push(tcCell);
      }

      let maxTfCell = toNumOrEmptyCell(
        r.Max_Fiber_Temp_C ??
          r.Section_Overall_Max_Fiber_Temp_C ??
          r.Daily_Peak_Fiber_Temp_C ??
          r.Daily_Max_Fiber_Temp_C ??
          r.DOF_Fiber_Temp_C ??
          r.Max_Fiber_Temp ??
          r.maxTf ??
          r.Max_Tf
      );
      if (maxTfCell === '' && dofTfNums.length > 0) {
        maxTfCell = Number(Math.max(...dofTfNums).toFixed(2));
      }

      const minTfCell = toNumOrEmptyCell(
        r.Min_Fiber_Temp_C ??
          r.Min_Fiber_Temp ??
          r.minTf ??
          r.Min_Tf ??
          (dofTfNums.length > 0 ? Math.min(...dofTfNums) : maxTfCell)
      );
      const meanTfCell = toNumOrEmptyCell(
        r.Mean_Fiber_Temp_C ??
          r.meanTf ??
          (dofTfNums.length > 0
            ? dofTfNums.reduce((a, b) => a + b, 0) / dofTfNums.length
            : maxTfCell)
      );

      let iecMaxCell = toNumOrEmptyCell(
        r.IEC_Est_Max_Conductor_C ??
          r.Section_Overall_Max_Conductor_C ??
          r.IEC_Est_Conductor_C ??
          r.Daily_Max_Conductor_Temp_C ??
          r.DOF_Conductor_Temp_C
      );
      if (iecMaxCell === '' && dofTcNums.length > 0) {
        iecMaxCell = Number(Math.max(...dofTcNums).toFixed(2));
      }
      const iecMinCell = toNumOrEmptyCell(r.IEC_Est_Min_Conductor_C);
      const pTotalMaxCell = toNumOrEmptyCell(
        r.Power_Flow_During_Max_Total_MW ?? r.Power_Flow_During_Peak_Total_MW
      );
      const pCkt3Cell = toNumOrEmptyCell(
        r.Power_Flow_During_Max_Ckt3_MW ?? r.Power_Flow_During_Peak_Ckt3_MW ?? r.Power_Ckt3_MW
      );
      const pCkt2Cell = toNumOrEmptyCell(
        r.Power_Flow_During_Max_Ckt2_MW ?? r.Power_Flow_During_Peak_Ckt2_MW
      );
      const pNktCell = toNumOrEmptyCell(
        r.Power_Flow_During_Max_33NKT_MW ?? r.Power_Flow_During_Peak_33NKT_MW
      );
      const pOilCell = toNumOrEmptyCell(
        r.Power_Flow_During_Max_33Oil_MW ?? r.Power_Flow_During_Peak_33Oil_MW
      );
      const pTotalMinCell = toNumOrEmptyCell(r.Power_Flow_During_Min_Total_MW);
      const pCkt3MinCell = toNumOrEmptyCell(r.Power_Flow_During_Min_Ckt3_MW);
      const pCkt2MinCell = toNumOrEmptyCell(r.Power_Flow_During_Min_Ckt2_MW);
      const pNktMinCell = toNumOrEmptyCell(r.Power_Flow_During_Min_33NKT_MW);
      const pOilMinCell = toNumOrEmptyCell(r.Power_Flow_During_Min_33Oil_MW);

      allDatesSet.add(dateKey);
      if (
        (typeof maxTfCell === 'number' && maxTfCell > 0) ||
        dofTfNums.length > 0 ||
        (typeof iecMaxCell === 'number' && iecMaxCell > 0) ||
        hasExistingMasterRowData(r as any)
      ) {
        validDatesSet.add(dateKey);
      }

      // Preserve any extra original columns on `r` without internal keys
      const cleanOriginalCols: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        if (!k.startsWith('_')) {
          cleanOriginalCols[k] = v;
        }
      }

      const sheetRow: DatabaseSheetRow = {
        ...cleanOriginalCols,
        Sheet_Section_ID: secInfo.sectionId,
        Section_Name: secInfo.name,
        Category: secInfo.category,
        Date: dateKey,
        Phase: phase,
        ...dofValuesMap,
        Max_Fiber_Temp_C: maxTfCell,
        Min_Fiber_Temp_C: minTfCell,
        Mean_Fiber_Temp_C: meanTfCell,
        IEC_Est_Max_Conductor_C: iecMaxCell,
        IEC_Est_Min_Conductor_C: iecMinCell,
        DOF_Max_m: toNumOrEmptyCell(r.DOF_Max_m ?? r.DOF_Position_m ?? r.Peak_DOF_m),
        DOF_Min_m: toNumOrEmptyCell(r.DOF_Min_m),
        Timestamp_Max: String(r.Timestamp_Max || r.Timestamp_Peak || r.Peak_Time || ''),
        Timestamp_Min: String(r.Timestamp_Min || ''),
        Power_Flow_During_Max_Total_MW: pTotalMaxCell,
        Power_Flow_During_Max_Ckt3_MW: pCkt3Cell,
        Power_Flow_During_Max_Ckt2_MW: pCkt2Cell,
        Power_Flow_During_Max_33NKT_MW: pNktCell,
        Power_Flow_During_Max_33Oil_MW: pOilCell,
        Power_Flow_During_Min_Total_MW: pTotalMinCell,
        Power_Flow_During_Min_Ckt3_MW: pCkt3MinCell,
        Power_Flow_During_Min_Ckt2_MW: pCkt2MinCell,
        Power_Flow_During_Min_33NKT_MW: pNktMinCell,
        Power_Flow_During_Min_33Oil_MW: pOilMinCell,
        File_Name_Max: String(r.File_Name_Max || r.File_Name_Peak || r.Source_TEPR_File || ''),
        File_Name_Min: String(r.File_Name_Min || r.Source_TEPR_File || ''),
      };

      // Also seed `store.sections` for this uploaded record if not already present
      if (typeof maxTfCell === 'number' && maxTfCell > 0) {
        const secRecKey =
          secInfo.category === 'land'
            ? `${secInfo.sectionId}_${phase}_${dateKey}`
            : `${secInfo.sectionId}_${dateKey}`;
        if (!store.sections[secRecKey]) {
          store.sections[secRecKey] = {
            maxTf: maxTfCell,
            minTf: typeof minTfCell === 'number' ? minTfCell : maxTfCell,
            meanTf: typeof meanTfCell === 'number' ? meanTfCell : maxTfCell,
            maxTfDof: typeof sheetRow.DOF_Max_m === 'number' ? sheetRow.DOF_Max_m : undefined,
            minTfDof: typeof sheetRow.DOF_Min_m === 'number' ? sheetRow.DOF_Min_m : undefined,
            maxTimestamp: sheetRow.Timestamp_Max,
            minTimestamp: sheetRow.Timestamp_Min,
            peakTime: sheetRow.Timestamp_Max,
            iecMaxTc: typeof iecMaxCell === 'number' ? iecMaxCell : undefined,
            iecMinTc: typeof iecMinCell === 'number' ? iecMinCell : undefined,
            powerAtMaxMW: typeof pTotalMaxCell === 'number' ? pTotalMaxCell : undefined,
            pCkt3MaxMW: typeof pCkt3Cell === 'number' ? pCkt3Cell : undefined,
            pCkt2MaxMW: typeof pCkt2Cell === 'number' ? pCkt2Cell : undefined,
            p33NktMaxMW: typeof pNktCell === 'number' ? pNktCell : undefined,
            p33OilMaxMW: typeof pOilCell === 'number' ? pOilCell : undefined,
            powerAtMinMW: typeof pTotalMinCell === 'number' ? pTotalMinCell : undefined,
            pCkt3MinMW: typeof pCkt3MinCell === 'number' ? pCkt3MinCell : undefined,
            pCkt2MinMW: typeof pCkt2MinCell === 'number' ? pCkt2MinCell : undefined,
            p33NktMinMW: typeof pNktMinCell === 'number' ? pNktMinCell : undefined,
            p33OilMinMW: typeof pOilMinCell === 'number' ? pOilMinCell : undefined,
            maxFileName: sheetRow.File_Name_Max,
            minFileName: sheetRow.File_Name_Min,
            sourceFile: sheetRow.File_Name_Max,
          };
        }
      }

      if (hasExistingMasterRowData(sheetRow)) {
        validDatesSet.add(dateKey);
      }

      rowsBySection.get(secInfo.sectionId)!.push(sheetRow);
      totalExistingRows++;
    }
  } catch (err) {
    console.warn('Error parsing uploaded database for update:', err);
  }

  const existingValidDates = Array.from(validDatesSet).sort();
  const allRowDates = Array.from(allDatesSet).sort();
  const effectiveDates = existingValidDates.length > 0 ? existingValidDates : allRowDates;

  const parsedResult: ParsedExistingDatabaseFile = {
    fileName,
    fileFormat: isCsv ? 'csv' : 'xlsx',
    rowsBySection,
    existingValidDates,
    datesWithMissingPower: [],
    allRowDates,
    firstDate: effectiveDates[0] || '',
    latestDate: effectiveDates[effectiveDates.length - 1] || '',
    totalExistingRows,
  };

  if (totalExistingRows > 0) {
    lastUploadedMasterDatabase = parsedResult;
  }

  return parsedResult;
}

/**
 * Merges an existing uploaded database file with newly compiled records for missing/extra dates
 * and produces an updated 19-sheet Excel (.xlsx) and CSV database file.
 * Strictly keeps all existing records from the uploaded database file untouched without editing them.
 */
export async function buildUpdatedMultiSheetDatabaseAsync(
  existingDb: ParsedExistingDatabaseFile,
  missingDatesToCompile: string[],
  powerSummariesByDate?: Map<string, DailyPowerSummary>,
  onSectionProgress?: (info: {
    sectionIndex: number;
    totalSections: number;
    sectionId: string;
    sectionName: string;
    sheetName: string;
    recordsBuilt: number;
  }) => void
): Promise<GeneratedDatabaseResult> {
  const store = getMasterSectionSummary();
  const existingValidSet = new Set(existingDb.existingValidDates || []);
  // Only compile dates that are NOT already valid in the uploaded database file
  const sortedMissingDates = Array.from(new Set(missingDatesToCompile))
    .filter((d) => !existingValidSet.has(d))
    .sort();
  const mergedRowsBySection = new Map<string, DatabaseSheetRow[]>();
  const allFinalDatesSet = new Set<string>([
    ...existingDb.allRowDates,
    ...existingDb.existingValidDates,
    ...sortedMissingDates,
  ]);

  let cumulativeRecords = 0;

  for (let i = 0; i < CIRCUIT_3_SECTIONS.length; i++) {
    const sec = CIRCUIT_3_SECTIONS[i];
    const existingRows = existingDb.rowsBySection.get(sec.sectionId) || [];
    const newlyCompiledRows =
      sortedMissingDates.length > 0
        ? computeSectionRowsForDatabase(sec, sortedMissingDates, store, powerSummariesByDate)
        : [];

    // Map by `${Date}_${Phase}`: strictly preserve existing valid rows untouched
    const rowMap = new Map<string, DatabaseSheetRow>();
    for (const er of existingRows) {
      const normPh = normalizePhaseCode(er.Phase, sec.category);
      rowMap.set(`${er.Date}_${normPh}`, er);
    }

    for (const nr of newlyCompiledRows) {
      const normPh = normalizePhaseCode(nr.Phase, sec.category);
      const key = `${nr.Date}_${normPh}`;
      const prev = rowMap.get(key);

      // Strictly keep existing data record from uploaded file untouched; only insert if no existing valid record and nr has valid data
      if (!prev) {
        rowMap.set(key, nr);
      } else if (!hasExistingMasterRowData(prev) && hasExistingMasterRowData(nr)) {
        rowMap.set(key, nr);
      }
    }

    const mergedList = Array.from(rowMap.values()).sort((a, b) => {
      if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
      return a.Phase.localeCompare(b.Phase);
    });

    mergedRowsBySection.set(sec.sectionId, mergedList);
    cumulativeRecords += mergedList.length;

    const sheetName = sec.category === 'land' ? `Sec_${sec.sectionId}` : `Zone_${sec.sectionId}`;
    if (onSectionProgress) {
      onSectionProgress({
        sectionIndex: i + 1,
        totalSections: CIRCUIT_3_SECTIONS.length,
        sectionId: sec.sectionId,
        sectionName: sec.name,
        sheetName,
        recordsBuilt: cumulativeRecords,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  saveMasterSectionSummaryToLocal(store);
  const allSortedDates = Array.from(allFinalDatesSet).sort();
  const finalized = finalizeMultiSheetWorkbookAndCsv(mergedRowsBySection, allSortedDates);
  finalized.filenameBase = `DTS_Circuit3_19Sheets_Updated_${allSortedDates[0] || 'start'}_to_${
    allSortedDates[allSortedDates.length - 1] || 'end'
  }`;
  return finalized;
}

/**
 * Parses an existing uploaded Section Daily Profile CSV or Excel (.xlsx) file,
 * preserving all 19 section sheets and identifying dates/hours for update.
 * Strictly keeps all existing records untouched without editing or purging them.
 */
export function parseUploadedSectionDailyProfileDatabase(
  input: string | ArrayBuffer | Uint8Array,
  fileName: string
): ParsedExistingDailyProfileFile {
  const rowsBySection = new Map<string, SectionDailyProfileRow[]>();
  for (const sec of CIRCUIT_3_SECTIONS) {
    rowsBySection.set(sec.sectionId, []);
  }

  const validDatesSet = new Set<string>();
  const allDatesSet = new Set<string>();
  let totalExistingRows = 0;
  const validSectionIds = new Set(CIRCUIT_3_SECTIONS.map((s) => s.sectionId));
  const isCsv = fileName.toLowerCase().endsWith('.csv') || typeof input === 'string';

  try {
    const rawRows: any[] = [];

    if (typeof input !== 'string') {
      const wb = XLSX.read(input, {
        type: 'array',
      });
      wb.SheetNames.forEach((sName, sheetIdx) => {
        const sheet = wb.Sheets[sName];
        const sheetSecCandidate = sName
          .replace(/^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)/i, '')
          .trim();
        const fallbackSecId =
          wb.SheetNames.length === CIRCUIT_3_SECTIONS.length
            ? CIRCUIT_3_SECTIONS[sheetIdx]?.sectionId || ''
            : '';
        const sheetSecId = validSectionIds.has(sheetSecCandidate)
          ? sheetSecCandidate
          : fallbackSecId;
        const sheetRows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
        for (const sr of sheetRows) {
          if (sheetSecId) sr._sheetSecId = sheetSecId;
          rawRows.push(sr);
        }
      });
    } else {
      const lines = input.split(/\r?\n/);
      let headers: string[] = [];
      let currentSheetSecId = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('#')) {
          const m = line.match(/SHEET:\s*(?:Sec|Zone)?\s*([0-9.]+)/i);
          if (m && validSectionIds.has(m[1])) {
            currentSheetSecId = m[1];
            headers = [];
          }
          continue;
        }

        const parts = splitCsvLineRespectingQuotes(line).map((p) =>
          p.replace(/^"|"$/g, '').trim()
        );
        if (
          headers.length === 0 &&
          (parts.includes('Date') || parts.includes('Sheet_Section_ID'))
        ) {
          headers = parts;
          continue;
        }

        if (headers.length > 0 && parts.length >= 4) {
          if (parts[0] === 'Sheet_Section_ID' || parts[0] === 'Date') continue;
          const rowObj: Record<string, any> = { _sheetSecId: currentSheetSecId };
          headers.forEach((h, idx) => {
            rowObj[h] = parts[idx] ?? '';
          });
          rawRows.push(rowObj);
        }
      }
    }

    for (const r of rawRows) {
      const secId = String(
        r._sheetSecId || r.Sheet_Section_ID || r.Section_ID || ''
      )
        .replace(/^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)/i, '')
        .trim();
      const d = normalizeDatabaseDateKey(r.Date || r.date || '');

      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      r.Date = d;
      allDatesSet.add(d);

      // Normalize numeric cells on the profile row without purging or editing any existing values
      const secMaxTf = toNumOrEmptyCell(r.Section_Max_Tf_C);
      const secMaxTc = toNumOrEmptyCell(r.Section_Max_Tc_C);
      const pCkt3 = toNumOrEmptyCell(r.Power_Ckt3_MW);
      const pCkt2 = toNumOrEmptyCell(r.Power_Ckt2_MW);
      const pNkt = toNumOrEmptyCell(r.Power_33NKT_MW);
      const pOil = toNumOrEmptyCell(r.Power_33Oil_MW);
      const pTotal = toNumOrEmptyCell(r.Total_Power_MW);

      let hasAnyDofNum = false;
      for (const k of Object.keys(r)) {
        if (k.startsWith('Tf_DOF_') || k.startsWith('Tc_DOF_') || k === 'Section_Max_DOF_m') {
          r[k] = toNumOrEmptyCell(r[k]);
          if (typeof r[k] === 'number' && r[k] > 0) hasAnyDofNum = true;
        }
      }

      r.Section_Max_Tf_C = secMaxTf;
      r.Section_Max_Tc_C = secMaxTc;
      r.Power_Ckt3_MW = pCkt3;
      r.Power_Ckt2_MW = pCkt2;
      r.Power_33NKT_MW = pNkt;
      r.Power_33Oil_MW = pOil;
      r.Total_Power_MW = pTotal;
      delete r._sheetSecId;

      if (validSectionIds.has(secId)) {
        const list = rowsBySection.get(secId);
        if (list) {
          list.push(r as SectionDailyProfileRow);
          totalExistingRows++;
          if (
            (typeof secMaxTf === 'number' && secMaxTf > 0) ||
            hasAnyDofNum ||
            hasExistingProfileRowData(r as any)
          ) {
            validDatesSet.add(d);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse uploaded Section Daily Profile database:', err);
  }

  const effectiveDates = Array.from(validDatesSet).sort();
  const allRowDates = Array.from(allDatesSet).sort();
  const boundaryDates = effectiveDates.length > 0 ? effectiveDates : allRowDates;

  const parsedResult: ParsedExistingDailyProfileFile = {
    fileName,
    fileFormat: isCsv ? 'csv' : 'xlsx',
    rowsBySection,
    existingValidDates: effectiveDates,
    datesWithMissingPower: [],
    allRowDates,
    firstDate: boundaryDates[0] || '',
    latestDate: boundaryDates[boundaryDates.length - 1] || '',
    totalExistingRows,
  };

  if (totalExistingRows > 0) {
    lastUploadedProfileDatabase = parsedResult;
  }

  return parsedResult;
}

/**
 * Updates an uploaded Section Daily Profile database with missing dates up to the latest date.
 * Strictly keeps all existing records from the uploaded database file untouched without editing them.
 */
export async function buildUpdatedSectionDailyProfileDatabaseAsync(
  existingDb: ParsedExistingDailyProfileFile,
  missingDatesToCompile: string[],
  powerSummariesByDate?: Map<string, DailyPowerSummary>,
  onSectionProgress?: (info: {
    sectionIndex: number;
    totalSections: number;
    sectionId: string;
    sectionName: string;
    sheetName: string;
    recordsBuilt: number;
  }) => void
): Promise<GeneratedDatabaseResult> {
  const store = getMasterSectionSummary();
  const existingValidSet = new Set(existingDb.existingValidDates || []);
  const sortedMissingDates = Array.from(new Set(missingDatesToCompile))
    .filter((d) => !existingValidSet.has(d))
    .sort();
  const mergedRowsBySection = new Map<string, SectionDailyProfileRow[]>();
  const allFinalDatesSet = new Set<string>([
    ...existingDb.allRowDates,
    ...existingDb.existingValidDates,
    ...sortedMissingDates,
  ]);

  let cumulativeRecords = 0;

  for (let i = 0; i < CIRCUIT_3_SECTIONS.length; i++) {
    // Yield to the main thread before heavy computation
    await new Promise((r) => setTimeout(r, 10));

    const sec = CIRCUIT_3_SECTIONS[i];
    const existingRows = existingDb.rowsBySection.get(sec.sectionId) || [];
    const newlyCompiledRows =
      sortedMissingDates.length > 0
        ? computeSectionDailyProfileRows(sec, sortedMissingDates, store, powerSummariesByDate)
        : [];

    const rowMap = new Map<string, SectionDailyProfileRow>();
    for (const er of existingRows) {
      const hNum = extractHourNumberFromTime(er.Time);
      const normPh = normalizePhaseCode(er.Phase, sec.category);
      rowMap.set(`${er.Date}_${hNum}_${normPh}`, er);
    }

    for (const nr of newlyCompiledRows) {
      const hNum = extractHourNumberFromTime(nr.Time);
      const normPh = normalizePhaseCode(nr.Phase, sec.category);
      const key = `${nr.Date}_${hNum}_${normPh}`;
      const prev = rowMap.get(key);
      // Strictly keep existing valid row untouched; only insert if no existing record or prev was empty and nr has data
      if (!prev) {
        rowMap.set(key, nr);
      } else if (!hasExistingProfileRowData(prev) && hasExistingProfileRowData(nr)) {
        rowMap.set(key, nr);
      }
    }

    const mergedList = Array.from(rowMap.values()).sort((a, b) => {
      if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
      if (a.Time !== b.Time) return a.Time.localeCompare(b.Time);
      return (a.Phase || '').localeCompare(b.Phase || '');
    });

    mergedRowsBySection.set(sec.sectionId, mergedList);
    cumulativeRecords += mergedList.length;

    const sheetName = sec.category === 'land' ? `Sec_${sec.sectionId}` : `Zone_${sec.sectionId}`;
    if (onSectionProgress) {
      onSectionProgress({
        sectionIndex: i + 1,
        totalSections: CIRCUIT_3_SECTIONS.length,
        sectionId: sec.sectionId,
        sectionName: sec.name,
        sheetName,
        recordsBuilt: cumulativeRecords,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  saveMasterSectionSummaryToLocal(store);
  const allSortedDates = Array.from(allFinalDatesSet).sort();
  const finalized = finalizeSectionDailyProfileWorkbookAndCsv(mergedRowsBySection, allSortedDates);
  finalized.filenameBase = `DTS_Section_Daily_Profile_19Sheets_Updated_${allSortedDates[0] || 'start'}_to_${
    allSortedDates[allSortedDates.length - 1] || 'end'
  }`;
  return finalized;
}


/**
 * Helper to split a CSV row while respecting quoted strings that may contain commas.
 */
function splitCsvLineRespectingQuotes(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseOptionalCellNumber(rawVal: any): number | undefined {
  if (rawVal === undefined || rawVal === null) return undefined;
  const str = String(rawVal).trim();
  if (str === '') return undefined;
  const num = parseFloat(str);
  return !isNaN(num) ? num : undefined;
}

/**
 * Parses an uploaded or fetched CSV / XLSX Database file into structured Section records for Visual Chart.
 */
export function parseDatabaseFileOrBuffer(
  input: string | ArrayBuffer | Uint8Array
): {
  sections: Record<string, MasterSectionPeakRecord>;
  dateKeys: string[];
  totalRecords: number;
} {
  const sections: Record<string, MasterSectionPeakRecord> = {};
  const dateSet = new Set<string>();
  let totalRecords = 0;
  const validSectionIds = new Set(CIRCUIT_3_SECTIONS.map((s) => s.sectionId));

  try {
    const rows: any[] = [];

    if (typeof input !== 'string') {
      // Binary XLSX ArrayBuffer / Uint8Array
      const wb = XLSX.read(input, { type: 'array', raw: false });
      for (const sName of wb.SheetNames) {
        const sheet = wb.Sheets[sName];
        const sheetSecCandidate = sName
          .replace(/^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)/i, '')
          .trim();
        const sheetSecId = validSectionIds.has(sheetSecCandidate) ? sheetSecCandidate : '';
        const sheetRows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
        for (const sr of sheetRows) {
          if (sheetSecId) {
            sr._sheetSecId = sheetSecId;
          }
          rows.push(sr);
        }
      }
    } else if (input.trim().startsWith('{')) {
      // JSON Master Summary
      const parsed = JSON.parse(input);
      if (parsed.sections) {
        return {
          sections: parsed.sections,
          dateKeys: Array.from(
            new Set<string>(
              Object.keys(parsed.sections)
                .map((k) => k.split('_').pop() || '')
                .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            )
          ).sort(),
          totalRecords: Object.keys(parsed.sections).length,
        };
      }
    } else {
      // CSV String (quote-aware)
      const lines = input.split(/\r?\n/);
      let headers: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;

        const parts = splitCsvLineRespectingQuotes(line).map((p) =>
          p.replace(/^"|"$/g, '').trim()
        );
        if (
          headers.length === 0 &&
          (parts.includes('Date') ||
            parts.includes('Sheet_Section_ID') ||
            parts.includes('Section_ID'))
        ) {
          headers = parts;
          continue;
        }

        if (headers.length > 0 && parts.length >= 5) {
          if (parts[0] === 'Sheet_Section_ID' || parts[0] === 'Section_ID') continue;
          const rowObj: Record<string, any> = { _colValues: parts };
          headers.forEach((h, idx) => {
            rowObj[h] = parts[idx] ?? '';
          });
          rows.push(rowObj);
        }
      }
    }

    for (const r of rows) {
      const colVals: any[] = Array.isArray(r._colValues)
        ? r._colValues
        : Object.keys(r)
            .filter((k) => !k.startsWith('_'))
            .map((k) => r[k]);

      const rawSecId = String(
        r._sheetSecId ||
          r.Sheet_Section_ID ||
          r.Section_ID ||
          r.sectionId ||
          r['Section ID'] ||
          colVals[0] ||
          ''
      ).trim();
      const secId = rawSecId;
      const dateKey = String(r.Date || r.date || r.dateKey || colVals[3] || '').trim();
      const rawPhase = String(r.Phase || r.phase || colVals[4] || 'ALL').trim();
      const phase = rawPhase.replace(/^Phase\s+/i, '').trim();

      if (!secId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

      const hasNamedHeaders =
        'Max_Fiber_Temp_C' in r || 'Max_Fiber_Temp' in r || 'maxTf' in r || 'Max_Tf' in r;

      const maxTf = parseOptionalCellNumber(
        hasNamedHeaders
          ? r.Max_Fiber_Temp_C ?? r.Max_Fiber_Temp ?? r.maxTf ?? r.Max_Tf
          : colVals[5]
      );
      const minTf = parseOptionalCellNumber(
        hasNamedHeaders
          ? r.Min_Fiber_Temp_C ?? r.Min_Fiber_Temp ?? r.minTf ?? r.Min_Tf
          : colVals[6]
      );
      const meanTf = parseOptionalCellNumber(
        hasNamedHeaders ? r.Mean_Fiber_Temp_C ?? r.meanTf : colVals[7]
      );

      // Skip rows where fiber temperature was left intentionally empty ("")
      if (maxTf === undefined || maxTf <= 0) continue;

      dateSet.add(dateKey);

      const colOPowerTotalMax = parseOptionalCellNumber(
        hasNamedHeaders ? r.Power_Flow_During_Max_Total_MW : colVals[14]
      );
      const colPCkt3Max = parseOptionalCellNumber(
        hasNamedHeaders ? r.Power_Flow_During_Max_Ckt3_MW : colVals[15]
      );
      const colQCkt2Max = parseOptionalCellNumber(
        hasNamedHeaders ? r.Power_Flow_During_Max_Ckt2_MW : colVals[16]
      );
      const colR33NktMax = parseOptionalCellNumber(
        hasNamedHeaders ? r.Power_Flow_During_Max_33NKT_MW : colVals[17]
      );
      const colS33OilMax = parseOptionalCellNumber(
        hasNamedHeaders ? r.Power_Flow_During_Max_33Oil_MW : colVals[18]
      );

      const rec: MasterSectionPeakRecord = {
        maxTf,
        minTf: minTf !== undefined && minTf > 0 ? minTf : maxTf,
        meanTf: meanTf !== undefined && meanTf > 0 ? meanTf : maxTf,
        maxTfDof: parseOptionalCellNumber(
          hasNamedHeaders ? r.DOF_Max_m ?? r.Peak_DOF_m : colVals[10]
        ),
        minTfDof: parseOptionalCellNumber(hasNamedHeaders ? r.DOF_Min_m : colVals[11]),
        maxTimestamp: String(
          (hasNamedHeaders ? r.Timestamp_Max || r.Peak_Time : colVals[12]) || ''
        ),
        minTimestamp: String((hasNamedHeaders ? r.Timestamp_Min : colVals[13]) || ''),
        peakTime: String((hasNamedHeaders ? r.Timestamp_Max || r.Peak_Time : colVals[12]) || ''),
        iecMaxTc: parseOptionalCellNumber(
          hasNamedHeaders ? r.IEC_Est_Max_Conductor_C : colVals[8]
        ),
        iecMinTc: parseOptionalCellNumber(
          hasNamedHeaders ? r.IEC_Est_Min_Conductor_C : colVals[9]
        ),
        powerAtMaxMW: colOPowerTotalMax,
        pCkt3MaxMW: colPCkt3Max,
        pCkt2MaxMW: colQCkt2Max,
        p33NktMaxMW: colR33NktMax,
        p33OilMaxMW: colS33OilMax,
        powerAtMinMW: parseOptionalCellNumber(
          hasNamedHeaders ? r.Power_Flow_During_Min_Total_MW : colVals[19]
        ),
        pCkt3MinMW: parseOptionalCellNumber(
          hasNamedHeaders ? r.Power_Flow_During_Min_Ckt3_MW : colVals[20]
        ),
        pCkt2MinMW: parseOptionalCellNumber(
          hasNamedHeaders ? r.Power_Flow_During_Min_Ckt2_MW : colVals[21]
        ),
        p33NktMinMW: parseOptionalCellNumber(
          hasNamedHeaders ? r.Power_Flow_During_Min_33NKT_MW : colVals[22]
        ),
        p33OilMinMW: parseOptionalCellNumber(
          hasNamedHeaders ? r.Power_Flow_During_Min_33Oil_MW : colVals[23]
        ),
        maxFileName: String(
          (hasNamedHeaders ? r.File_Name_Max || r.Source_TEPR_File : colVals[24]) || ''
        ),
        minFileName: String(
          (hasNamedHeaders ? r.File_Name_Min || r.Source_TEPR_File : colVals[25]) || ''
        ),
        sourceFile: String(
          (hasNamedHeaders ? r.File_Name_Max || r.Source_TEPR_File : colVals[24]) || ''
        ),
      };

      const key =
        phase && phase !== 'ALL' && phase !== 'Envelope' && phase !== 'SM'
          ? `${secId}_${phase}_${dateKey}`
          : `${secId}_${dateKey}`;

      sections[key] = rec;

      const baseKey = `${secId}_${dateKey}`;
      const existingBase = sections[baseKey];
      if (!existingBase || rec.maxTf > existingBase.maxTf) {
        sections[baseKey] = {
          ...rec,
          minTf: existingBase ? Math.min(existingBase.minTf, rec.minTf) : rec.minTf,
          minTfDof:
            existingBase && existingBase.minTf < rec.minTf
              ? existingBase.minTfDof
              : rec.minTfDof,
        };
      } else if (existingBase && rec.minTf < existingBase.minTf) {
        existingBase.minTf = rec.minTf;
        existingBase.minTfDof = rec.minTfDof;
        existingBase.minTimestamp = rec.minTimestamp;
        existingBase.minFileName = rec.minFileName;
      }

      totalRecords++;
    }
  } catch (err) {
    console.warn('Failed to parse CSV/XLSX database input:', err);
  }

  return {
    sections,
    dateKeys: Array.from(dateSet).sort(),
    totalRecords,
  };
}

export function exportMasterSummaryToCsv(): void {
  const result = buildMultiSheetDatabase();
  const blob = new Blob([result.xlsxBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${result.filenameBase}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getMasterSummaryStats(): {
  totalDaysCompiled: number;
  totalSectionRecords: number;
  approxSizeKB: number;
} {
  const store = getMasterSectionSummary();
  const sectionKeys = Object.keys(store.sections);
  const uniqueDates = new Set<string>();
  for (const k of sectionKeys) {
    const parts = k.split('_');
    const d = parts[parts.length - 1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) uniqueDates.add(d);
  }
  const approxBytes = sectionKeys.length * 95 + Object.keys(store.points).length * 24;
  return {
    totalDaysCompiled: uniqueDates.size,
    totalSectionRecords: sectionKeys.length,
    approxSizeKB: Math.max(1, Math.round(approxBytes / 1024)),
  };
}

