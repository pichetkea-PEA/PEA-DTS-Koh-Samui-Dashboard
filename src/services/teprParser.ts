// DTS Linear Asset Cable Monitoring Parser & Interpolator for .TEPR Files
import { 
  findPointByDof, 
  CIRCUIT_3_SAMPLING_POINTS, 
  LAND_CABLE_DOFS,
  SUBMARINE_CABLE_DOFS,
  CableSamplingPoint,
  CableSectionType,
  CableCategory,
  ConductorEquationName,
  estimateConductorTemperatures,
  OperatingPowerAtTimestamp
} from '../data/cableCircuitStructure';
import { DailyPowerSummary, resolveOperatingPowerAtTime } from './powerConsumptionParser';

// Standard Phase A / B / C Land Cable Monitoring Locations (38 Points per phase across Sections 1.1 to 1.6)
export const TARGET_LOCATIONS_STANDARD: number[] = LAND_CABLE_DOFS;

// Submarine Cable (Channel 3) Monitoring Locations (81 Points across Sections 2.1 to 2.13)
export const TARGET_LOCATIONS_SUBMARINE: number[] = SUBMARINE_CABLE_DOFS;

// Alias for standard cable points default
export const TARGET_LOCATIONS: number[] = TARGET_LOCATIONS_STANDARD;

// Resolve target monitoring locations dynamically based on cable phase / channel
export function getTargetLocationsForPhase(cablePhase?: CablePhaseType | string, channel?: number): number[] {
  if (channel === 3 || cablePhase === 'Submarine Cable') {
    return TARGET_LOCATIONS_SUBMARINE;
  }
  return TARGET_LOCATIONS_STANDARD;
}

export type CablePhaseType = 'Phase A' | 'Phase B' | 'Phase C' | 'Submarine Cable' | 'Unassigned';

export interface CablePhaseInfo {
  phase: CablePhaseType;
  channel: number | undefined;
  shortLabel: string;
  color: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  description: string;
}

export function getCablePhaseFromChannel(channel?: number): CablePhaseInfo {
  switch (channel) {
    case 0:
      return {
        phase: 'Phase A',
        channel: 0,
        shortLabel: 'Phase A (CH 0)',
        color: '#dc2626', // Red
        badgeBg: 'bg-red-50',
        badgeText: 'text-red-700',
        badgeBorder: 'border-red-200',
        description: 'Linear Cable Phase A (Channel 0)',
      };
    case 1:
      return {
        phase: 'Phase B',
        channel: 1,
        shortLabel: 'Phase B (CH 1)',
        color: '#d97706', // Amber / Gold
        badgeBg: 'bg-amber-50',
        badgeText: 'text-amber-700',
        badgeBorder: 'border-amber-200',
        description: 'Linear Cable Phase B (Channel 1)',
      };
    case 2:
      return {
        phase: 'Phase C',
        channel: 2,
        shortLabel: 'Phase C (CH 2)',
        color: '#2563eb', // Blue
        badgeBg: 'bg-blue-50',
        badgeText: 'text-blue-700',
        badgeBorder: 'border-blue-200',
        description: 'Linear Cable Phase C (Channel 2)',
      };
    case 3:
      return {
        phase: 'Submarine Cable',
        channel: 3,
        shortLabel: 'Submarine (CH 3)',
        color: '#0d9488', // Teal / Cyan
        badgeBg: 'bg-teal-50',
        badgeText: 'text-teal-700',
        badgeBorder: 'border-teal-200',
        description: 'Submarine Section (Channel 3)',
      };
    default:
      return {
        phase: 'Unassigned',
        channel,
        shortLabel: channel !== undefined ? `CH ${channel}` : 'Unassigned Phase',
        color: '#64748b',
        badgeBg: 'bg-slate-50',
        badgeText: 'text-slate-700',
        badgeBorder: 'border-slate-200',
        description: channel !== undefined ? `Auxiliary Channel ${channel}` : 'Unspecified Phase Channel',
      };
  }
}

// Guesses cable phase purely from the filename and directory path (100% offline, zero latency)
export function guessPhaseFromPath(fileName: string, folderPath = '', subfolderName = ''): CablePhaseType {
  const combined = `${folderPath}/${subfolderName}/${fileName}`.toLowerCase();
  
  // Phase A / Channel 0
  if (
    combined.includes('phase a') || 
    combined.includes('phase_a') || 
    combined.includes('phase-a') || 
    combined.includes('phasea') || 
    combined.includes('ch0') || 
    combined.includes('ch_0') || 
    combined.includes('ch-0') ||
    combined.includes('ch 0') ||
    combined.includes('channel 0') ||
    combined.includes('channel0') ||
    combined.includes('channel_0') ||
    combined.includes('_514150') || 
    combined.includes('_514154') ||
    combined.includes('_516020')
  ) return 'Phase A';
  
  // Phase B / Channel 1
  if (
    combined.includes('phase b') || 
    combined.includes('phase_b') || 
    combined.includes('phase-b') || 
    combined.includes('phaseb') || 
    combined.includes('ch1') || 
    combined.includes('ch_1') || 
    combined.includes('ch-1') ||
    combined.includes('ch 1') ||
    combined.includes('channel 1') ||
    combined.includes('channel1') ||
    combined.includes('channel_1') ||
    combined.includes('_514151') || 
    combined.includes('_514156')
  ) return 'Phase B';

  // Phase C / Channel 2
  if (
    combined.includes('phase c') || 
    combined.includes('phase_c') || 
    combined.includes('phase-c') || 
    combined.includes('phasec') || 
    combined.includes('ch2') || 
    combined.includes('ch_2') || 
    combined.includes('ch-2') ||
    combined.includes('ch 2') ||
    combined.includes('channel 2') ||
    combined.includes('channel2') ||
    combined.includes('channel_2') ||
    combined.includes('_514152') || 
    combined.includes('_514157')
  ) return 'Phase C';

  // Submarine Cable / Channel 3
  if (
    combined.includes('submarine') || 
    combined.includes('subsea') || 
    combined.includes('ch3') || 
    combined.includes('ch_3') || 
    combined.includes('ch-3') ||
    combined.includes('ch 3') ||
    combined.includes('channel 3') ||
    combined.includes('channel3') ||
    combined.includes('channel_3') ||
    combined.includes('_514153') || 
    combined.includes('_514158')
  ) return 'Submarine Cable';

  return 'Unassigned';
}

export interface TeprDateMeta {
  year: number;
  month: number; // 1-12
  monthName: string; // e.g. "August"
  monthAbbr: string; // e.g. "Aug"
  day: number; // 1-31
  dayStr: string; // "01"
  hour: number; // 0-23
  hourStr: string; // "00"
  hourKey: string; // "00", "01", ... "23"
  hourLabel: string; // "00:00 - 00:59"
  fullHourLabel: string; // "Hour 00 (00:00 - 00:59)"
  minute: number; // 0-59
  minuteStr: string; // "07"
  second: number; // 0-59
  secondStr: string; // "00"
  dateKey: string; // "2026-08-01"
  timeKey: string; // "00:07"
  formattedDate: string; // "Aug 01, 2026"
  formattedTime: string; // "00:07"
  displayDateTime: string; // "Aug 01, 2026 at 00:07"
  dateTimeStr: string; // "2026-08-01 00:07:00"
  timestamp: number; // epoch ms
  subfolderName?: string; // e.g. "01082026"
}

export interface TeprHeader {
  channel?: number;
  dateTimeStr?: string;
  timestamp?: number; // epoch ms
  fiberReferenceTemp: number; // baseline temperature in °C (default 30°C)
  startPoint?: number;
  endPoint?: number;
  sampleCount?: number;
  rawComments: string[];
}

export interface TeprDataPoint {
  position: number; // distance in meters
  deltaTemp: number; // raw result relative change (°C), e.g. -4.9507
  absoluteTemp: number; // fiberReferenceTemp + deltaTemp (°C), e.g. 30 + (-4.9507) = 25.0493
}

export interface TargetLocationValue {
  location: number; // target position (m)
  deltaTemp: number; // interpolated result change (°C)
  absoluteTemp: number; // fiberReferenceTemp + deltaTemp (°C)
  closestDataPoint: { position: number; deltaTemp: number };
  tag?: string;
}

export interface ParsedTeprFile {
  fileId: string;
  fileName: string;
  header: TeprHeader;
  channel?: number;
  cablePhase: CablePhaseType;
  phaseInfo: CablePhaseInfo;
  dateMeta: TeprDateMeta;
  dataPoints: TeprDataPoint[];
  targetLocationValues: TargetLocationValue[];
  maxDeltaTemp: number;
  maxDeltaPosition: number;
  minDeltaTemp: number;
  avgDeltaTemp: number;
  parsedAt: string;
}

export interface ScannedFileMeta {
  fileId: string;
  fileName: string;
  subfolderName?: string;
  folderPath?: string;
  modifiedTime?: string;
  dateMeta: TeprDateMeta;
  cablePhase: CablePhaseType;
  channel?: number;
}

export interface LocationTimeSeriesSummary {
  location: number;
  tag: string;
  pos?: string;
  kp?: string | number;
  sectionId?: string;
  sectionName?: string;
  sectionType?: CableSectionType;
  cableCategory?: CableCategory;
  dab?: number | null;
  dof?: number;
  latitude?: number;
  longitude?: number;
  equationName?: ConductorEquationName;
  // Conductor Temperature Estimation (IEC 60287: Equations Alpha, Beta, Charlie, Delta, Echo)
  hasPowerData?: boolean;
  tc60287?: number | null;      // Estimated Conductor Temp from Fiber + Power via IEC 60287 (Tc,60287)
  tcf?: number | null;          // Alias for tc60287
  tcl?: number | null;          // Alias for tc60287
  tcMax?: number | null;        // Alias for tc60287
  pCkt3MW?: number | null;
  pCkt2MW?: number | null;
  p33NktMW?: number | null;
  p33OfMW?: number | null;
  matchedPowerTime?: string;
  powerStatusText?: string;
  // Aliases for UI components
  estimatedConductorTemp: number | null;
  estimatedConductorTempTcf: number | null;
  estimatedConductorTempTcl: number | null;
  maxEstimatedConductorTemp: number | null;
  power115kVCkt3MW: number | null;
  power115kVCkt2MW: number | null;
  power115kVCkt1MW: number | null;
  power33kVPhaNganMW: number | null;
  matchedPowerTimestamp: string | null;
  readings: Array<{
    fileName: string;
    timestamp: number;
    dateTimeStr: string;
    displayTime: string;
    cablePhase: CablePhaseType;
    channel?: number;
    deltaTemp: number;
    absoluteTemp: number;
    isHourlyMax?: boolean;
    readingsCount?: number;
    hasPowerData?: boolean;
    tc60287?: number | null;
    tcf?: number | null;
    tcl?: number | null;
    tcMax?: number | null;
    pCkt3MW?: number | null;
    pCkt2MW?: number | null;
    p33NktMW?: number | null;
    p33OfMW?: number | null;
    matchedPowerTime?: string;
  }>;
  currentDeltaTemp: number;
  currentAbsoluteTemp: number;
  baselineTemp: number;
  maxDeltaTemp: number;
  minDeltaTemp: number;
  tempChangeAcrossSeries: number; // delta between last and first
  rateOfChangePerHour?: number;
  status: 'normal' | 'warning' | 'critical';
}

// Assign segment tags to specific cable points (Standard Land vs Submarine Cable) using As-Built Specification
export function getLocationTag(location: number, cablePhase?: CablePhaseType | string, channel?: number): string {
  const isSubmarine = channel === 3 || cablePhase === 'Submarine Cable' || (cablePhase !== 'Phase A' && cablePhase !== 'Phase B' && cablePhase !== 'Phase C' && TARGET_LOCATIONS_SUBMARINE.includes(location));

  // Exact lookup from Revised Circuit 3 Engineering Specification
  const matched = findPointByDof(location, isSubmarine ? 'SM' : (cablePhase || 'A'));
  if (matched) {
    const typeLabel = matched.sectionType === 'special' ? ' [Special]' : '';
    const kpInfo = matched.kp ? ` | KP ${matched.kp}` : '';
    return `${matched.pos}: ${matched.sectionName}${typeLabel} (DOF ${matched.dof}m${kpInfo})`;
  }

  const prefix = cablePhase && cablePhase !== 'all' && cablePhase !== 'Unassigned' ? `${cablePhase}: ` : '';
  return `${prefix}Monitoring Point ${location}m`;
}

const MONTH_MAP: Record<string, { num: number; full: string; abbr: string }> = {
  jan: { num: 1, full: 'January', abbr: 'Jan' },
  feb: { num: 2, full: 'February', abbr: 'Feb' },
  mar: { num: 3, full: 'March', abbr: 'Mar' },
  apr: { num: 4, full: 'April', abbr: 'Apr' },
  may: { num: 5, full: 'May', abbr: 'May' },
  jun: { num: 6, full: 'June', abbr: 'Jun' },
  jul: { num: 7, full: 'July', abbr: 'Jul' },
  aug: { num: 8, full: 'August', abbr: 'Aug' },
  sep: { num: 9, full: 'September', abbr: 'Sep' },
  oct: { num: 10, full: 'October', abbr: 'Oct' },
  nov: { num: 11, full: 'November', abbr: 'Nov' },
  dec: { num: 12, full: 'December', abbr: 'Dec' },
};

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Autonomously extract structured Date, Time, and Category metadata from folder hierarchy (Year/Month/Date), subfolder name, filename, and header text
export function extractDateTimeFromText(
  text: string,
  fileName = '',
  subfolderName = '',
  folderPath = '',
  contextYear?: number
): TeprDateMeta {
  let year = contextYear || 2026;
  let month = 8;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dateMatched = false;
  let timeMatched = false;
  let yearExplicitlyFound = false;

  const combinedPath = [folderPath, subfolderName].filter(Boolean).join('/');

  // 1. Check for Year in folder path / subfolder (e.g. "2026", "2025", "2024")
  const yearPathMatch = combinedPath.match(/\b(20[2-3][0-9])\b/);
  if (yearPathMatch) {
    year = parseInt(yearPathMatch[1], 10);
    yearExplicitlyFound = true;
  }

  // 2. Check for Year in header comments text
  if (!yearExplicitlyFound && text) {
    const headerYearMatch = text.match(/#.*?(?:date|time|created|timestamp|dts).*?\b(20[2-3][0-9])\b/i);
    if (headerYearMatch) {
      year = parseInt(headerYearMatch[1], 10);
      yearExplicitlyFound = true;
    }
  }

  // 3. Check for Year in filename
  if (!yearExplicitlyFound && fileName) {
    const fnYearMatch = fileName.match(/\b(20[2-3][0-9])\b/);
    if (fnYearMatch) {
      year = parseInt(fnYearMatch[1], 10);
      yearExplicitlyFound = true;
    }
  }

  // 4. HIGHEST PRIORITY for Month, Day, Hour, Minute: Filename Pattern
  // Example: "Temp_Jul070059_514150.tepr", "Temp_Aug042151_516020.tepr", "Temp_Aug010007_514150.tepr", "Temp_Jul07_1400.tepr"
  // Format: [Temp_] + [Month 3 chars e.g. Jul, Aug, Sep] + [Day 1-2 digits e.g. 07, 7, 04] + [Hour 2 digits] + [Minute 2 digits]
  const patternDts = fileName.match(/(?:temp[_-]?)?([a-z]{3})[-_]?(\d{1,2})[-_]?(\d{2})[-_:]?(\d{2})/i);
  if (patternDts) {
    const mStr = patternDts[1].toLowerCase();
    if (MONTH_MAP[mStr]) {
      month = MONTH_MAP[mStr].num;
      const dVal = parseInt(patternDts[2], 10);
      if (dVal >= 1 && dVal <= 31) {
        day = dVal;
        dateMatched = true;
      }
      const hVal = parseInt(patternDts[3], 10);
      const minVal = parseInt(patternDts[4], 10);
      if (hVal >= 0 && hVal <= 23 && minVal >= 0 && minVal <= 59) {
        hour = hVal;
        minute = minVal;
        timeMatched = true;
      }
    }
  }

  // Alternative: [Day 1-2 digits] + [Month 3 chars] e.g. "07Jul2025", "07Jul0059"
  if (!dateMatched) {
    const dayMonthMatch = fileName.match(/(?:temp[_-]?)?(\d{1,2})[-_]?([a-z]{3})[-_]?(?:(20[2-3][0-9])|(\d{2})[-_:]?(\d{2}))?/i);
    if (dayMonthMatch) {
      const mStr = dayMonthMatch[2].toLowerCase();
      if (MONTH_MAP[mStr]) {
        month = MONTH_MAP[mStr].num;
        const dVal = parseInt(dayMonthMatch[1], 10);
        if (dVal >= 1 && dVal <= 31) {
          day = dVal;
          dateMatched = true;
        }
        if (dayMonthMatch[3]) {
          year = parseInt(dayMonthMatch[3], 10);
          yearExplicitlyFound = true;
        } else if (dayMonthMatch[4] && dayMonthMatch[5]) {
          const hVal = parseInt(dayMonthMatch[4], 10);
          const minVal = parseInt(dayMonthMatch[5], 10);
          if (hVal >= 0 && hVal <= 23 && minVal >= 0 && minVal <= 59) {
            hour = hVal;
            minute = minVal;
            timeMatched = true;
          }
        }
      }
    }
  }

  // Fallback 4B: "Temp_Aug04_..." or "Temp_Jul07_..." without packed time
  if (!dateMatched) {
    const mDayMatch = fileName.match(/(?:temp[_-]?)?([a-z]{3})[-_]?(\d{1,2})/i);
    if (mDayMatch) {
      const mStr = mDayMatch[1].toLowerCase();
      if (MONTH_MAP[mStr]) {
        month = MONTH_MAP[mStr].num;
        const dVal = parseInt(mDayMatch[2], 10);
        if (dVal >= 1 && dVal <= 31) {
          day = dVal;
          dateMatched = true;
        }
      }
    }
  }

  // Fallback 4C: Standard ISO / Numeric Filename patterns: e.g. TEPR_2026-08-04_14-30-00, 20260804_143000
  if (!dateMatched || !timeMatched) {
    const fnIsoMatch = fileName.match(/(202[0-9]|203[0-9])[-_]?(\d{2})[-_]?(\d{2})[-_T ]?(\d{2})[-_:]?(\d{2})(?:[-_:]?(\d{2}))?/i);
    if (fnIsoMatch) {
      if (!dateMatched) {
        year = parseInt(fnIsoMatch[1], 10);
        month = parseInt(fnIsoMatch[2], 10);
        day = parseInt(fnIsoMatch[3], 10);
        dateMatched = true;
      }
      if (!timeMatched) {
        hour = parseInt(fnIsoMatch[4], 10);
        minute = parseInt(fnIsoMatch[5], 10);
        second = fnIsoMatch[6] ? parseInt(fnIsoMatch[6], 10) : 0;
        timeMatched = true;
      }
    }
  }

  // Fallback 4D: DDMMYYYY in filename: e.g. Temp_01082026_0007.tepr, 01082026_0007
  if (!dateMatched) {
    const ddmmyyyyMatch = fileName.match(/\b(\d{2})(\d{2})(202[0-9]|203[0-9])\b/i);
    if (ddmmyyyyMatch) {
      const dVal = parseInt(ddmmyyyyMatch[1], 10);
      const mVal = parseInt(ddmmyyyyMatch[2], 10);
      const yVal = parseInt(ddmmyyyyMatch[3], 10);
      if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
        day = dVal;
        month = mVal;
        year = yVal;
        dateMatched = true;
      }
    }
  }

  // Fallback 4E: DD-MM-YYYY or DD.MM.YYYY in filename
  if (!dateMatched) {
    const ddmmyyyySepMatch = fileName.match(/\b(\d{1,2})[-_.](\d{1,2})[-_.](202[0-9]|203[0-9])\b/i);
    if (ddmmyyyySepMatch) {
      const dVal = parseInt(ddmmyyyySepMatch[1], 10);
      const mVal = parseInt(ddmmyyyySepMatch[2], 10);
      const yVal = parseInt(ddmmyyyySepMatch[3], 10);
      if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
        day = dVal;
        month = mVal;
        year = yVal;
        dateMatched = true;
      }
    }
  }

  // 5. Folder Hierarchy Fallback if date still not resolved
  if (!dateMatched && combinedPath.trim()) {
    const segments = combinedPath.split(/[\\/]+/).map((s) => s.trim()).filter(Boolean);
    let folderMonth: number | null = null;
    let folderDay: number | null = null;

    for (const seg of segments) {
      // Check full DDMMYYYY (e.g., "01082026" or "01092026")
      const ddmmyyyy = seg.match(/^(\d{2})[-_.]?(\d{2})[-_.]?(202\d|203\d)$/);
      if (ddmmyyyy) {
        const dVal = parseInt(ddmmyyyy[1], 10);
        const mVal = parseInt(ddmmyyyy[2], 10);
        const yVal = parseInt(ddmmyyyy[3], 10);
        if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
          day = dVal;
          month = mVal;
          year = yVal;
          dateMatched = true;
          break;
        }
      }

      // Check full YYYYMMDD (e.g., "20260801" or "2026-08-01")
      const yyyymmdd = seg.match(/^(202\d|203\d)[-_.]?(\d{2})[-_.]?(\d{2})$/);
      if (yyyymmdd) {
        const yVal = parseInt(yyyymmdd[1], 10);
        const mVal = parseInt(yyyymmdd[2], 10);
        const dVal = parseInt(yyyymmdd[3], 10);
        if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
          year = yVal;
          month = mVal;
          day = dVal;
          dateMatched = true;
          break;
        }
      }

      // Check named month folder segment e.g. "August", "Aug", "September", "Sep"
      const namedM = seg.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
      if (namedM && MONTH_MAP[namedM[1].substring(0, 3)]) {
        folderMonth = MONTH_MAP[namedM[1].substring(0, 3)].num;
      }

      // Check day candidate
      const numD = seg.match(/^(?:day[_-]?)?0?([1-9]|[12]\d|3[01])$/i);
      if (numD && segments.indexOf(seg) >= 1) {
        folderDay = parseInt(numD[1], 10);
      }
    }

    if (!dateMatched) {
      if (folderMonth) month = folderMonth;
      if (folderDay) day = folderDay;
      if (folderMonth || folderDay) {
        dateMatched = true;
      }
    }
  }

  // 6. Time only in filename if not yet matched
  if (!timeMatched && fileName) {
    const timeOnlyMatch = fileName.match(/(?:[^\d]|^)(\d{2})[-_:]?(\d{2})(?:[-_:]?(\d{2}))?(?:[^\d]|$)/);
    if (timeOnlyMatch) {
      const hCandidate = parseInt(timeOnlyMatch[1], 10);
      const mCandidate = parseInt(timeOnlyMatch[2], 10);
      if (hCandidate >= 0 && hCandidate <= 23 && mCandidate >= 0 && mCandidate <= 59) {
        hour = hCandidate;
        minute = mCandidate;
        second = timeOnlyMatch[3] ? parseInt(timeOnlyMatch[3], 10) : 0;
        timeMatched = true;
      }
    }
  }

  // 7. Header text fallback
  if (!dateMatched || !timeMatched) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('#')) {
        const isoMatch = line.match(/(202[0-9]|203[0-9])[-/](\d{1,2})[-/](\d{1,2})/);
        if (isoMatch) {
          if (!dateMatched) {
            year = parseInt(isoMatch[1], 10);
            month = parseInt(isoMatch[2], 10);
            day = parseInt(isoMatch[3], 10);
            dateMatched = true;
          }
        }
        
        const ddmmyyyyMatch = line.match(/(\d{1,2})[-/](\d{1,2})[-/](202[0-9]|203[0-9])/);
        if (ddmmyyyyMatch) {
          if (!dateMatched) {
            const dVal = parseInt(ddmmyyyyMatch[1], 10);
            const mVal = parseInt(ddmmyyyyMatch[2], 10);
            const yVal = parseInt(ddmmyyyyMatch[3], 10);
            if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
              if (mVal > 12) {
                day = mVal;
                month = dVal;
              } else {
                day = dVal;
                month = mVal;
              }
              year = yVal;
              dateMatched = true;
            }
          }
        }

        const timeMatch = line.match(/(\d{2})[.:](\d{2})(?:[.:](\d{2}))?/);
        if (timeMatch) {
          if (!timeMatched) {
            const hVal = parseInt(timeMatch[1], 10);
            const minVal = parseInt(timeMatch[2], 10);
            if (hVal >= 0 && hVal <= 23 && minVal >= 0 && minVal <= 59) {
              hour = hVal;
              minute = minVal;
              second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
              timeMatched = true;
            }
          }
        }
      }
    }
  }

  // Backup fallback: regex match date format on whole text
  if (!dateMatched || !timeMatched) {
    const dateMatch = text.match(/#.*(?:date|time|timestamp)[:= ]*([0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ T][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)/i);
    if (dateMatch && dateMatch[1]) {
      const parsed = new Date(dateMatch[1].replace(/\//g, '-'));
      if (!isNaN(parsed.getTime())) {
        if (!dateMatched) {
          year = parsed.getFullYear();
          month = parsed.getMonth() + 1;
          day = parsed.getDate();
          dateMatched = true;
        }
        if (!timeMatched) {
          hour = parsed.getHours();
          minute = parsed.getMinutes();
          second = parsed.getSeconds();
          timeMatched = true;
        }
      }
    }
  }

  // Format strings
  const pad = (n: number) => n.toString().padStart(2, '0');
  const monthAbbr = MONTH_NAMES[month] || 'Aug';
  const monthFull = MONTH_FULL[month] || 'August';
  const dayStr = pad(day);
  const hourStr = pad(hour);
  const minuteStr = pad(minute);
  const secondStr = pad(second);

  const dateKey = `${year}-${pad(month)}-${dayStr}`;
  const timeKey = `${hourStr}:${minuteStr}`;
  const hourKey = hourStr; // "00", "01", ... "23"
  const hourLabel = `${hourStr}:00 - ${hourStr}:59`;
  const fullHourLabel = `Hour ${hourStr} (${hourLabel})`;

  const dateTimeStr = `${dateKey} ${hourStr}:${minuteStr}:${secondStr}`;
  const formattedDate = `${dayStr} ${monthAbbr} ${year}`;
  const formattedTime = `${hourStr}:${minuteStr}`;
  const displayDateTime = `${dayStr} ${monthAbbr} ${year} at ${hourStr}:${minuteStr}`;

  // Safe Epoch timestamp calculation
  const epochDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const timestamp = !isNaN(epochDate.getTime()) ? epochDate.getTime() : Date.now();

  return {
    year,
    month,
    monthName: monthFull,
    monthAbbr,
    day,
    dayStr,
    hour,
    hourStr,
    hourKey,
    hourLabel,
    fullHourLabel,
    minute,
    minuteStr,
    second,
    secondStr,
    dateKey,
    timeKey,
    formattedDate,
    formattedTime,
    displayDateTime,
    dateTimeStr,
    timestamp,
    subfolderName: subfolderName || undefined,
  };
}

// Linear interpolation helper with ultra-fast binary search
export function interpolateValue(dataPoints: TeprDataPoint[], targetLocation: number): { deltaTemp: number; closest: { position: number; deltaTemp: number } } {
  const len = dataPoints.length;
  if (len === 0) {
    return { deltaTemp: 0, closest: { position: targetLocation, deltaTemp: 0 } };
  }

  // Quick boundary checks
  const first = dataPoints[0];
  if (targetLocation <= first.position) {
    return { deltaTemp: first.deltaTemp, closest: { position: first.position, deltaTemp: first.deltaTemp } };
  }
  const last = dataPoints[len - 1];
  if (targetLocation >= last.position) {
    return { deltaTemp: last.deltaTemp, closest: { position: last.position, deltaTemp: last.deltaTemp } };
  }

  // Fast binary search
  let low = 0;
  let high = len - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midPos = dataPoints[mid].position;
    if (Math.abs(midPos - targetLocation) < 0.001) {
      return { deltaTemp: dataPoints[mid].deltaTemp, closest: { position: midPos, deltaTemp: dataPoints[mid].deltaTemp } };
    }
    if (midPos < targetLocation) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idx0 = Math.max(0, low - 1);
  const idx1 = Math.min(len - 1, low);
  const p0 = dataPoints[idx0];
  const p1 = dataPoints[idx1];

  if (p0.position === p1.position) {
    return { deltaTemp: p0.deltaTemp, closest: { position: p0.position, deltaTemp: p0.deltaTemp } };
  }

  // Linear interpolation: y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
  const ratio = (targetLocation - p0.position) / (p1.position - p0.position);
  const interpolatedDelta = p0.deltaTemp + ratio * (p1.deltaTemp - p0.deltaTemp);
  const closest = Math.abs(targetLocation - p0.position) < Math.abs(targetLocation - p1.position) ? p0 : p1;

  return {
    deltaTemp: parseFloat(interpolatedDelta.toFixed(4)),
    closest: { position: closest.position, deltaTemp: closest.deltaTemp },
  };
}

// Parse raw .TEPR file content
export function parseTeprContent(
  fileId: string, 
  fileName: string, 
  rawText: string, 
  subfolderName = '', 
  folderPath = ''
): ParsedTeprFile {
  const lines = rawText.split(/\r?\n/);
  const headerComments: string[] = [];
  let channel: number | undefined;
  let foundExplicitChannel = false;
  let fiberReferenceTemp = 30.0; // Default baseline fiber temperature (30 Celsius from characteristic section)
  let foundExplicitFiberTemp = false;
  let startPoint: number | undefined;
  let endPoint: number | undefined;
  let sampleCount: number | undefined;

  let part2StartIndex = -1;

  // Step 1: Parse Part 1 (Rows starting with #)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      headerComments.push(line);

      // Parse Channel (0 = Phase A, 1 = Phase B, 2 = Phase C, 3 = Submarine Cable)
      // Checks for: "# Channel No  = 0", "# Channel No = 0", "# Channel = 0", "# Channel No. = 0", etc.
      const strictChMatch = line.match(/#\s*Channel\s*(?:No\.?|Number)?\s*[:=]\s*(\d+)/i);
      if (strictChMatch) {
        channel = parseInt(strictChMatch[1], 10);
        foundExplicitChannel = true;
      } else if (!foundExplicitChannel) {
        const looseChMatch = line.match(/#.*channel[:= ]*(\d+)/i);
        if (looseChMatch) channel = parseInt(looseChMatch[1], 10);
      }

      // Parse Characteristic Section / Fiber Reference Temperature (strictly default 30.0°C unless explicit Fiber Reference Temp in 20..40°C is given)
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

      // Parse Start / End
      const startMatch = line.match(/#.*start.*[:= ]*([+-]?\d+(?:\.\d+)?)/i);
      if (startMatch) startPoint = parseFloat(startMatch[1]);

      const endMatch = line.match(/#.*end.*[:= ]*([+-]?\d+(?:\.\d+)?)/i);
      if (endMatch) endPoint = parseFloat(endMatch[1]);
    } else {
      // First line after the final # sign
      // As per rule 2.1: Final data before part 2 is a single number at row below the final # sign
      const numMatch = line.match(/^(\d+)$/);
      if (numMatch) {
        sampleCount = parseInt(numMatch[1], 10);
        part2StartIndex = i + 1;
      } else {
        // Direct start of 2-column data
        part2StartIndex = i;
      }
      break;
    }
  }

  // Extract structured Date & Time metadata (grounded by Year/Month/Date hierarchy & subfolderName e.g. "2026/08/01" or "01082026")
  const dateMeta = extractDateTimeFromText(rawText, fileName, subfolderName, folderPath);

  if (channel === undefined) {
    const guessedPhase = guessPhaseFromPath(fileName, subfolderName, folderPath);
    if (guessedPhase === 'Phase A') channel = 0;
    else if (guessedPhase === 'Phase B') channel = 1;
    else if (guessedPhase === 'Phase C') channel = 2;
    else if (guessedPhase === 'Submarine Cable') channel = 3;
  }

  // Step 2: Fast Parse Part 2 Data Points
  // Definition:
  // Absolute Temperature = fiberReferenceTemp (30 Celsius) + result in individual position
  // E.g. at position 2076.07 with result -4.9507 => Absolute Temp = 30 + (-4.9507) = 25.0493 C
  const dataPoints: TeprDataPoint[] = [];
  let maxDelta = -Infinity;
  let maxDeltaPos = 0;
  let minDelta = Infinity;
  let sumDelta = 0;
  let isMonotonic = true;
  let prevPos = -Infinity;

  if (part2StartIndex >= 0) {
    for (let i = part2StartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.charCodeAt(0) === 35) continue; // '#'

      // Ultra-fast number parsing without regex or array allocations
      let sepIdx = -1;
      for (let j = 0; j < line.length; j++) {
        const c = line.charCodeAt(j);
        if (c === 32 || c === 9 || c === 44 || c === 59) { // space, tab, comma, semicolon
          sepIdx = j;
          break;
        }
      }

      if (sepIdx !== -1) {
        const pos = parseFloat(line.substring(0, sepIdx));
        const resultVal = parseFloat(line.substring(sepIdx + 1).replace(/^[,;\s]+/, ''));
        if (!isNaN(pos) && !isNaN(resultVal)) {
          const deltaTemp = parseFloat(resultVal.toFixed(4));
          const absoluteTemp = parseFloat((fiberReferenceTemp + resultVal).toFixed(4));

          // Only filter out corrupted NaN/infinite sensor values; preserve real high-temperature readings (e.g. 121.1678 + 30 = 151.1678°C)
          if (absoluteTemp < -50 || absoluteTemp > 500) {
            continue;
          }

          if (pos < prevPos) isMonotonic = false;
          prevPos = pos;

          if (deltaTemp > maxDelta) {
            maxDelta = deltaTemp;
            maxDeltaPos = pos;
          }
          if (deltaTemp < minDelta) {
            minDelta = deltaTemp;
          }
          sumDelta += deltaTemp;

          dataPoints.push({
            position: pos,
            deltaTemp,
            absoluteTemp,
          });
        }
      }
    }
  }

  // Sort only if not already strictly ascending
  if (!isMonotonic) {
    dataPoints.sort((a, b) => a.position - b.position);
  }

  // Only fallback to DOF distance range if # Channel No was NOT present in header or filename
  if (channel === undefined) {
    if (dataPoints.length > 0 && dataPoints[dataPoints.length - 1].position > 4500) {
      channel = 3;
    } else {
      channel = 0;
    }
  }

  // Cable phase info (0: Phase A, 1: Phase B, 2: Phase C, 3: Submarine Cable)
  const phaseInfo = getCablePhaseFromChannel(channel);

  const header: TeprHeader = {
    channel,
    dateTimeStr: dateMeta.dateTimeStr,
    timestamp: dateMeta.timestamp,
    fiberReferenceTemp,
    startPoint,
    endPoint,
    sampleCount,
    rawComments: headerComments,
  };

  // Step 3: Compute fiber optic readings at ALL designated locations (both 38 Land points and 81 Submarine points)
  const allTargetLocations = Array.from(
    new Set([...TARGET_LOCATIONS_STANDARD, ...TARGET_LOCATIONS_SUBMARINE])
  );
  const targetLocationValues: TargetLocationValue[] = allTargetLocations.map((loc) => {
    const inter = interpolateValue(dataPoints, loc);
    // If closest data point is within 0.6m of the discrete DOF, use its exact deltaTemp rather than linear interpolation
    const useExactClosest = Math.abs(inter.closest.position - loc) <= 0.6;
    const delta = useExactClosest ? inter.closest.deltaTemp : inter.deltaTemp;
    const abs = parseFloat((fiberReferenceTemp + delta).toFixed(4));
    return {
      location: loc,
      deltaTemp: delta,
      absoluteTemp: abs,
      closestDataPoint: inter.closest,
      tag: getLocationTag(loc, phaseInfo.phase, channel),
    };
  });

  return {
    fileId,
    fileName,
    header,
    channel,
    cablePhase: phaseInfo.phase,
    phaseInfo,
    dateMeta,
    dataPoints,
    targetLocationValues,
    maxDeltaTemp: maxDelta === -Infinity ? 0 : parseFloat(maxDelta.toFixed(4)),
    maxDeltaPosition: maxDeltaPos,
    minDeltaTemp: minDelta === Infinity ? 0 : parseFloat(minDelta.toFixed(4)),
    avgDeltaTemp: dataPoints.length > 0 ? parseFloat((sumDelta / dataPoints.length).toFixed(4)) : 0,
    parsedAt: new Date().toISOString(),
  };
}

export interface SectionPeakExtractResult {
  maxTf: number;
  minTf: number;
  meanTf: number;
  maxTfPosition: number;
  pointsCount: number;
  referenceTemp: number;
  channel?: number;
}

export interface TeprPhaseIndexEntry {
  ch: number; // 0: Phase A, 1: Phase B, 2: Phase C, 3: Submarine Cable
  ref: number; // fiberReferenceTemp (e.g. 30.0)
  p2Off?: number; // Byte offset where Part 2 starts
  firstPos?: number; // First DOF position in Part 2
  bpm?: number; // Calibrated average bytes per meter of DOF
  maxPos?: number; // Maximum DOF position in file
}

const PHASE_INDEX_STORAGE_KEY = 'dts_tepr_phase_index_v4';
let inMemoryPhaseIndex: Map<string, TeprPhaseIndexEntry> | null = null;
const calibratedChannelDensity = new Map<
  number,
  { bpm: number; firstPos: number; p2Off: number }
>();

function ensurePhaseIndexLoaded(): Map<string, TeprPhaseIndexEntry> {
  if (inMemoryPhaseIndex) return inMemoryPhaseIndex;
  inMemoryPhaseIndex = new Map<string, TeprPhaseIndexEntry>();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(PHASE_INDEX_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (let i = 0; i < parsed.length; i++) {
            const item = parsed[i];
            if (item && typeof item[0] === 'string' && item[1] && typeof item[1].ch === 'number') {
              inMemoryPhaseIndex.set(item[0], item[1]);
              if (item[1].bpm && item[1].bpm > 2 && item[1].bpm < 200) {
                calibratedChannelDensity.set(item[1].ch, {
                  bpm: item[1].bpm,
                  firstPos: item[1].firstPos ?? 0,
                  p2Off: item[1].p2Off ?? 350,
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return inMemoryPhaseIndex;
}

export function getPhaseIndexEntry(fileId: string): TeprPhaseIndexEntry | undefined {
  return ensurePhaseIndexLoaded().get(fileId);
}

export function setPhaseIndexEntry(fileId: string, entry: TeprPhaseIndexEntry): void {
  const map = ensurePhaseIndexLoaded();
  map.set(fileId, entry);
  if (entry.bpm && entry.bpm > 2 && entry.bpm < 200) {
    calibratedChannelDensity.set(entry.ch, {
      bpm: entry.bpm,
      firstPos: entry.firstPos ?? 0,
      p2Off: entry.p2Off ?? 350,
    });
  }
}

export function flushPhaseIndexToStorage(): void {
  if (!inMemoryPhaseIndex || inMemoryPhaseIndex.size === 0) return;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const entries = Array.from(inMemoryPhaseIndex.entries()).slice(-15000);
      window.localStorage.setItem(PHASE_INDEX_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    // ignore quota errors
  }
}

export function getCalibratedChannelDensity(
  channel: number
): { bpm: number; firstPos: number; p2Off: number } | undefined {
  ensurePhaseIndexLoaded();
  return calibratedChannelDensity.get(channel);
}

export function setCalibratedChannelDensity(
  channel: number,
  data: { bpm: number; firstPos: number; p2Off: number }
): void {
  if (data.bpm > 2 && data.bpm < 200) {
    calibratedChannelDensity.set(channel, data);
  }
}

/**
 * Fast header & layout analyzer for Phase Separation Procedure.
 * Reads the first ~800-1200 bytes of a .TEPR file to extract:
 * - channel (0: Phase A, 1: Phase B, 2: Phase C, 3: Submarine Cable)
 * - fiberReferenceTemp (default 30.0°C)
 * - part2ByteOffset, firstPos, stepDof, and estimated bytesPerMeter (bpm)
 */
export function parseTeprHeaderFast(
  headerText: string,
  fileSizeBytes?: number,
  fileName = '',
  subfolderName = '',
  folderPath = ''
): TeprPhaseIndexEntry {
  const lines = headerText.split(/\r?\n/);
  let fiberReferenceTemp = 30.0;
  let foundExplicitFiberTemp = false;
  let channel: number | undefined;
  let foundExplicitChannel = false;
  let sampleCount: number | undefined;
  let endPoint: number | undefined;
  let part2StartIndex = -1;
  let part2ByteOffset = 0;
  let runningBytes = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineLenWithNewline = rawLine.length + 1;
    const line = rawLine.trim();
    if (!line) {
      runningBytes += lineLenWithNewline;
      continue;
    }

    if (line.charCodeAt(0) === 35) {
      // '#'
      const strictChMatch = line.match(/#\s*Channel\s*(?:No\.?|Number)?\s*[:=]\s*(\d+)/i);
      if (strictChMatch) {
        channel = parseInt(strictChMatch[1], 10);
        foundExplicitChannel = true;
      } else if (!foundExplicitChannel) {
        const looseChMatch = line.match(/#.*channel[:= ]*(\d+)/i);
        if (looseChMatch) channel = parseInt(looseChMatch[1], 10);
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

      const endMatch = line.match(/#.*end.*[:= ]*([+-]?\d+(?:\.\d+)?)/i);
      if (endMatch) endPoint = parseFloat(endMatch[1]);

      runningBytes += lineLenWithNewline;
    } else {
      const numMatch = line.match(/^(\d+)$/);
      if (numMatch) {
        sampleCount = parseInt(numMatch[1], 10);
        part2StartIndex = i + 1;
        part2ByteOffset = runningBytes + lineLenWithNewline;
      } else {
        part2StartIndex = i;
        part2ByteOffset = runningBytes;
      }
      break;
    }
  }

  // Sample first few data rows of Part 2 to measure firstPos, stepDof, and bytesPerMeter
  let firstPos: number | undefined;
  let lastSampledPos: number | undefined;
  let sampledDataBytes = 0;
  let sampledRows = 0;

  if (part2StartIndex >= 0) {
    // Exclude last line in case header chunk truncated mid-line
    const safeEnd = Math.max(part2StartIndex, lines.length - 1);
    for (let i = part2StartIndex; i < safeEnd; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line || line.charCodeAt(0) === 35) continue;
      let sepIdx = -1;
      for (let j = 0; j < line.length; j++) {
        const c = line.charCodeAt(j);
        if (c === 32 || c === 9 || c === 44 || c === 59) {
          sepIdx = j;
          break;
        }
      }
      if (sepIdx !== -1) {
        const pos = parseFloat(line.substring(0, sepIdx));
        if (!isNaN(pos)) {
          if (firstPos === undefined) firstPos = pos;
          lastSampledPos = pos;
          sampledDataBytes += rawLine.length + 1;
          sampledRows++;
        }
      }
    }
  }

  let bpm: number | undefined;
  if (
    firstPos !== undefined &&
    lastSampledPos !== undefined &&
    lastSampledPos > firstPos + 0.2 &&
    sampledDataBytes > 10
  ) {
    bpm = sampledDataBytes / (lastSampledPos - firstPos);
  }

  // Determine channel ONLY if not explicitly found in # Channel header (row 6 of .TEPR file)
  if (channel === undefined) {
    const guessed = guessPhaseFromPath(fileName, folderPath, subfolderName);
    if (guessed === 'Phase A') channel = 0;
    else if (guessed === 'Phase B') channel = 1;
    else if (guessed === 'Phase C') channel = 2;
    else if (guessed === 'Submarine Cable') channel = 3;
    else if (
      (fileSizeBytes && fileSizeBytes > 220000) ||
      (sampleCount && sampleCount > 4500) ||
      (endPoint && endPoint > 4500)
    ) {
      channel = 3; // Submarine Cable (~54 km)
    } else {
      channel = 0;
    }
  }

  return {
    ch: channel,
    ref: fiberReferenceTemp,
    p2Off: part2ByteOffset || 350,
    firstPos: firstPos ?? 0,
    bpm,
  };
}

/**
 * Extracts section peak from an HTTP Byte-Range slice of a .TEPR file.
 * Returns the extracted peak along with the observed DOF boundaries of the slice
 * so the caller can verify 100% coverage of [minDof, maxDof] and self-calibrate bytesPerMeter.
 */
export function extractSectionPeakFromSlice(
  sliceText: string,
  minDof: number,
  maxDof: number,
  referenceTemp: number,
  isMidFileSlice: boolean,
  channel?: number
): {
  result: SectionPeakExtractResult | null;
  sliceFirstPos: number | null;
  sliceLastPos: number | null;
  coveredMinDof: boolean;
  coveredMaxDof: boolean;
} {
  const lines = sliceText.split(/\r?\n/);
  // If slice starts mid-file, skip index 0 (likely partial line); also skip last element if partial
  const startIdx = isMidFileSlice ? 1 : 0;
  const endIdx = lines.length > 2 ? lines.length - 1 : lines.length;

  let sliceFirstPos: number | null = null;
  let sliceLastPos: number | null = null;
  let maxTf = -Infinity;
  let minTf = Infinity;
  let maxPos = 0;
  let sumTf = 0;
  let count = 0;
  let exitedAfterMaxDof = false;

  for (let i = startIdx; i < endIdx; i++) {
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

    if (sliceFirstPos === null) sliceFirstPos = pos;
    sliceLastPos = pos;

    if (pos < minDof) continue;
    if (pos > maxDof) {
      exitedAfterMaxDof = true;
      break;
    }

    const delta = parseFloat(line.substring(sepIdx + 1).replace(/^[,;\s]+/, ''));
    if (isNaN(delta)) continue;

    const absTemp = referenceTemp + delta;
    if (absTemp < -50 || absTemp > 500) continue;

    if (absTemp > maxTf) {
      maxTf = absTemp;
      maxPos = pos;
    }
    if (absTemp < minTf) {
      minTf = absTemp;
    }
    sumTf += absTemp;
    count++;
  }

  const coveredMinDof =
    !isMidFileSlice || (sliceFirstPos !== null && sliceFirstPos <= minDof + 2.5);
  const coveredMaxDof =
    exitedAfterMaxDof || (sliceLastPos !== null && sliceLastPos >= maxDof - 2.5);

  const result: SectionPeakExtractResult | null =
    count > 0
      ? {
          maxTf: Number(maxTf.toFixed(2)),
          minTf: Number(minTf.toFixed(2)),
          meanTf: Number((sumTf / count).toFixed(2)),
          maxTfPosition: Number(maxPos.toFixed(2)),
          pointsCount: count,
          referenceTemp,
          channel,
        }
      : null;

  return {
    result,
    sliceFirstPos,
    sliceLastPos,
    coveredMinDof,
    coveredMaxDof,
  };
}

/**
 * Ultra-fast single-section peak extractor.
 * Reads only the data lines within [minDof, maxDof] and stops parsing as soon as pos > maxDof.
 * Skips ~95% of the file lines and allocates zero point arrays, executing in <0.2ms.
 */
export function extractSectionPeakFromTepr(
  rawText: string,
  minDof: number,
  maxDof: number,
  options?: {
    expectedCategory?: 'land' | 'submarine';
    expectedPhase?: string;
    fallbackChannel?: number;
  }
): SectionPeakExtractResult | null {
  const lines = rawText.split(/\r?\n/);
  let fiberReferenceTemp = 30.0;
  let foundExplicitFiberTemp = false;
  let channel: number | undefined;
  let foundExplicitChannel = false;
  let part2StartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 35) { // '#'
      const strictChMatch = line.match(/#\s*Channel\s*(?:No\.?|Number)?\s*[:=]\s*(\d+)/i);
      if (strictChMatch) {
        channel = parseInt(strictChMatch[1], 10);
        foundExplicitChannel = true;
      } else if (!foundExplicitChannel) {
        const looseChMatch = line.match(/#.*channel[:= ]*(\d+)/i);
        if (looseChMatch) channel = parseInt(looseChMatch[1], 10);
      }

      // Explicit Fiber Reference Temperature (default 30.0°C)
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

  // O(1) tail check to determine max trace length (Submarine ~55,000m vs Land ~3,500m)
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

  if (channel === undefined) {
    if (options?.fallbackChannel !== undefined) {
      channel = options.fallbackChannel;
    } else if (maxTracePos > 4500) {
      channel = 3;
    } else {
      channel = 0;
    }
  }

  if (options?.expectedCategory) {
    const isFileSubmarine = channel === 3;
    if (options.expectedCategory === 'submarine' && !isFileSubmarine) {
      return null;
    }
    if (options.expectedCategory === 'land' && isFileSubmarine) {
      return null;
    }
    if (
      options.expectedCategory === 'land' &&
      options.expectedPhase &&
      options.expectedPhase !== 'all' &&
      options.expectedPhase !== 'SM'
    ) {
      if (options.expectedPhase === 'A' && channel !== 0) return null;
      if (options.expectedPhase === 'B' && channel !== 1) return null;
      if (options.expectedPhase === 'C' && channel !== 2) return null;
    }
  }

  let maxTf = -Infinity;
  let minTf = Infinity;
  let maxPos = 0;
  let sumTf = 0;
  let count = 0;

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

    if (pos < minDof) continue;
    if (pos > maxDof) break; // Exited the section! Early stop skips remaining 50,000 meters

    const delta = parseFloat(line.substring(sepIdx + 1).replace(/^[,;\s]+/, ''));
    if (isNaN(delta)) continue;

    const absTemp = fiberReferenceTemp + delta;
    if (absTemp < -50 || absTemp > 500) continue;

    if (absTemp > maxTf) {
      maxTf = absTemp;
      maxPos = pos;
    }
    if (absTemp < minTf) {
      minTf = absTemp;
    }
    sumTf += absTemp;
    count++;
  }

  if (count === 0) return null;

  return {
    maxTf: Number(maxTf.toFixed(2)),
    minTf: Number(minTf.toFixed(2)),
    meanTf: Number((sumTf / count).toFixed(2)),
    maxTfPosition: Number(maxPos.toFixed(2)),
    pointsCount: count,
    referenceTemp: fiberReferenceTemp,
    channel,
  };
}

export interface HourlyLocationReading {
  location: number;
  tag: string;
  maxDeltaTemp: number;
  maxAbsoluteTemp: number;
  minDeltaTemp: number;
  avgDeltaTemp: number;
  peakFileName: string;
  peakDisplayTime: string;
  readingsCount: number;
}

export interface HourlyTeprSummary {
  hourKey: string; // "00", "01", ... "23"
  hourNum: number; // 0..23
  hourLabel: string; // "00:00 - 00:59"
  fullHourLabel: string; // "Hour 00 (00:00 - 00:59)"
  dateKey: string; // "2026-08-01"
  formattedDate: string; // "Aug 01, 2026"
  cablePhase: CablePhaseType;
  fileCount: number;
  files: ParsedTeprFile[];
  maxDeltaTemp: number; // Maximum temperature result (°C) in this hour period
  maxAbsoluteTemp: number; // Maximum absolute temperature (°C) in this hour period
  minDeltaTemp: number;
  avgDeltaTemp: number;
  maxDeltaPosition: number;
  peakFileName: string;
  peakDisplayTime: string;
  targetLocations: HourlyLocationReading[];
  maxDataPoints: TeprDataPoint[];
}

// Hourly Aggregation Engine: Computes the exact maximum temperature result and maximum absolute temperature for each hour
export function aggregateHourlyTeprFiles(
  parsedFiles: ParsedTeprFile[], 
  activePhase?: string
): HourlyTeprSummary[] {
  if (parsedFiles.length === 0) return [];

  // Group files by hourKey
  const groups = new Map<string, ParsedTeprFile[]>();
  for (const file of parsedFiles) {
    const key = file.dateMeta?.hourKey || '00';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(file);
  }

  const sortedHours = Array.from(groups.keys()).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const isSubmarine = 
    activePhase === 'Submarine Cable' || 
    (activePhase === 'all' && parsedFiles.length > 0 && parsedFiles.every((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3));
  const targetLocations = isSubmarine ? TARGET_LOCATIONS_SUBMARINE : TARGET_LOCATIONS_STANDARD;
  const currentPhase = activePhase && activePhase !== 'all' ? (activePhase as CablePhaseType) : (isSubmarine ? 'Submarine Cable' : undefined);
  const currentChannel = isSubmarine ? 3 : (activePhase === 'Phase A' ? 0 : activePhase === 'Phase B' ? 1 : activePhase === 'Phase C' ? 2 : undefined);

  return sortedHours.map((hKey) => {
    const hourFiles = groups.get(hKey)!;
    const hNum = parseInt(hKey, 10);
    const hourLabel = `${hKey}:00 - ${hKey}:59`;
    const fullHourLabel = `Hour ${hKey} (${hourLabel})`;
    const refFile = hourFiles[0];
    const dateKey = refFile.dateMeta?.dateKey || '';
    const formattedDate = refFile.dateMeta?.formattedDate || '';
    const cablePhase = (currentPhase || refFile.cablePhase) as CablePhaseType;
    const baseline = refFile.header.fiberReferenceTemp || 30.0;

    // 1. Calculate target locations hourly maximums
    const targetReadings: HourlyLocationReading[] = targetLocations.map((loc) => {
      let maxLocDelta = -Infinity;
      let minLocDelta = Infinity;
      let sumLocDelta = 0;
      let peakFn = '';
      let peakDisp = '';

      for (const f of hourFiles) {
        const val = f.targetLocationValues.find((v) => Math.abs(v.location - loc) < 0.01);
        const delta = val ? val.deltaTemp : 0;
        sumLocDelta += delta;
        if (delta > maxLocDelta) {
          maxLocDelta = delta;
          peakFn = f.fileName;
          peakDisp = f.dateMeta?.formattedTime || f.fileName;
        }
        if (delta < minLocDelta) {
          minLocDelta = delta;
        }
      }

      if (maxLocDelta === -Infinity) maxLocDelta = 0;
      if (minLocDelta === Infinity) minLocDelta = 0;
      const count = hourFiles.length || 1;

      return {
        location: loc,
        tag: getLocationTag(loc, currentPhase, currentChannel),
        maxDeltaTemp: parseFloat(maxLocDelta.toFixed(4)),
        maxAbsoluteTemp: parseFloat((baseline + maxLocDelta).toFixed(4)),
        minDeltaTemp: parseFloat(minLocDelta.toFixed(4)),
        avgDeltaTemp: parseFloat((sumLocDelta / count).toFixed(4)),
        peakFileName: peakFn,
        peakDisplayTime: peakDisp,
        readingsCount: hourFiles.length,
      };
    });

    // 2. Continuous data points envelope maximums
    const posMap = new Map<number, number>(); // pos -> max delta
    let globalMaxDelta = -Infinity;
    let globalMinDelta = Infinity;
    let globalSumDelta = 0;
    let globalPointCount = 0;
    let peakPos = 0;
    let peakFileName = '';
    let peakDisplayTime = '';

    for (const f of hourFiles) {
      if (f.maxDeltaTemp > globalMaxDelta) {
        globalMaxDelta = f.maxDeltaTemp;
        peakPos = f.maxDeltaPosition;
        peakFileName = f.fileName;
        peakDisplayTime = f.dateMeta?.formattedTime || f.fileName;
      }
      if (f.minDeltaTemp < globalMinDelta) {
        globalMinDelta = f.minDeltaTemp;
      }
      for (const dp of f.dataPoints) {
        const existing = posMap.get(dp.position);
        if (existing === undefined || dp.deltaTemp > existing) {
          posMap.set(dp.position, dp.deltaTemp);
        }
        globalSumDelta += dp.deltaTemp;
        globalPointCount += 1;
      }
    }

    if (globalMaxDelta === -Infinity) globalMaxDelta = 0;
    if (globalMinDelta === Infinity) globalMinDelta = 0;

    const maxDataPoints: TeprDataPoint[] = Array.from(posMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([pos, maxDelta]) => ({
        position: pos,
        deltaTemp: parseFloat(maxDelta.toFixed(4)),
        absoluteTemp: parseFloat((baseline + maxDelta).toFixed(4)),
      }));

    return {
      hourKey: hKey,
      hourNum: hNum,
      hourLabel,
      fullHourLabel,
      dateKey,
      formattedDate,
      cablePhase,
      fileCount: hourFiles.length,
      files: hourFiles,
      maxDeltaTemp: parseFloat(globalMaxDelta.toFixed(4)),
      maxAbsoluteTemp: parseFloat((baseline + globalMaxDelta).toFixed(4)),
      minDeltaTemp: parseFloat(globalMinDelta.toFixed(4)),
      avgDeltaTemp: globalPointCount > 0 ? parseFloat((globalSumDelta / globalPointCount).toFixed(4)) : 0,
      maxDeltaPosition: peakPos,
      peakFileName,
      peakDisplayTime,
      targetLocations: targetReadings,
      maxDataPoints,
    };
  });
}

// Build multi-file chronological matrix from hourly maximum summaries
export function buildHourlyLocationTimeSeries(
  hourlySummaries: HourlyTeprSummary[],
  activePhase?: string,
  dailyPowerSummary?: DailyPowerSummary | null
): LocationTimeSeriesSummary[] {
  if (hourlySummaries.length === 0) return [];

  const isSubmarine = 
    activePhase === 'Submarine Cable' || 
    (activePhase === 'all' && hourlySummaries.length > 0 && hourlySummaries.every((h) => h.cablePhase === 'Submarine Cable'));
  const targetLocations = isSubmarine ? TARGET_LOCATIONS_SUBMARINE : TARGET_LOCATIONS_STANDARD;
  const currentPhase = activePhase && activePhase !== 'all' ? (activePhase as CablePhaseType) : (isSubmarine ? 'Submarine Cable' : undefined);
  const currentChannel = isSubmarine ? 3 : (activePhase === 'Phase A' ? 0 : activePhase === 'Phase B' ? 1 : activePhase === 'Phase C' ? 2 : undefined);

  return targetLocations.map((loc) => {
    const matchedPoint = findPointByDof(loc, isSubmarine ? 'SM' : (currentPhase || 'A'));

    const readings = hourlySummaries.map((hourSummary) => {
      const locData = hourSummary.targetLocations.find((v) => Math.abs(v.location - loc) < 0.01);
      const delta = locData ? locData.maxDeltaTemp : 0;
      const absTemp = locData ? locData.maxAbsoluteTemp : 30.0;
      const opPower = resolveOperatingPowerAtTime(dailyPowerSummary, {
        hour: hourSummary.hourNum,
        minute: 30,
        timeStr: locData?.peakDisplayTime || hourSummary.peakDisplayTime,
      });
      const rEst = estimateConductorTemperatures(absTemp, matchedPoint, opPower);
      return {
        fileName: locData?.peakFileName || hourSummary.peakFileName,
        timestamp: hourSummary.hourNum,
        dateTimeStr: `${hourSummary.formattedDate} ${hourSummary.hourLabel}`,
        displayTime: hourSummary.hourLabel,
        cablePhase: hourSummary.cablePhase,
        channel: currentChannel,
        deltaTemp: delta,
        absoluteTemp: absTemp,
        isHourlyMax: true,
        readingsCount: locData?.readingsCount || hourSummary.fileCount,
        hasPowerData: rEst.hasPowerData,
        tc60287: rEst.tc60287,
        tcf: rEst.tc60287,
        tcl: rEst.tc60287,
        tcMax: rEst.tc60287,
        pCkt3MW: rEst.pCkt3MW,
        pCkt2MW: rEst.pCkt2MW,
        p33NktMW: rEst.p33NktMW,
        p33OfMW: rEst.p33OfMW,
        matchedPowerTime: opPower.matchedTimeLabel,
      };
    });

    let maxDelta = 0;
    let minDelta = 0;
    if (readings.length > 0) {
      maxDelta = readings[0].deltaTemp;
      minDelta = readings[0].deltaTemp;
      for (let k = 1; k < readings.length; k++) {
        const dt = readings[k].deltaTemp;
        if (dt > maxDelta) maxDelta = dt;
        if (dt < minDelta) minDelta = dt;
      }
    }
    const latest = readings[readings.length - 1] || { deltaTemp: 0, absoluteTemp: 30.0, timestamp: 12, displayTime: '' };
    const first = readings[0] || { deltaTemp: 0, absoluteTemp: 30.0 };
    const changeAcross = latest.deltaTemp - first.deltaTemp;

    let ratePerHour: number | undefined;
    if (readings.length >= 2) {
      ratePerHour = parseFloat((changeAcross / readings.length).toFixed(4));
    }

    const latestPower = resolveOperatingPowerAtTime(dailyPowerSummary, {
      hour: latest.timestamp,
      minute: 30,
      timeStr: latest.displayTime,
    });
    const est = estimateConductorTemperatures(latest.absoluteTemp, matchedPoint, latestPower);

    let status: 'normal' | 'warning' | 'critical' = 'normal';
    const evalTemp = est.tc60287 !== null ? est.tc60287 : latest.absoluteTemp;
    if (evalTemp >= 60 || latest.deltaTemp >= 30 || maxDelta >= 30) {
      status = 'critical';
    } else if (evalTemp >= 45 || latest.deltaTemp >= 15 || maxDelta >= 15) {
      status = 'warning';
    }

    return {
      location: loc,
      tag: getLocationTag(loc, currentPhase, currentChannel),
      pos: matchedPoint?.pos,
      kp: matchedPoint?.kpFormatted ?? matchedPoint?.kp,
      sectionId: matchedPoint?.sectionId,
      sectionName: matchedPoint?.sectionName,
      sectionType: matchedPoint?.sectionType,
      cableCategory: matchedPoint?.cableCategory,
      dab: matchedPoint?.dab,
      dof: matchedPoint?.dof ?? loc,
      latitude: matchedPoint?.latitude,
      longitude: matchedPoint?.longitude,
      equationName: est.equationName,
      hasPowerData: est.hasPowerData,
      tc60287: est.tc60287,
      tcf: est.tc60287,
      tcl: est.tc60287,
      tcMax: est.tc60287,
      pCkt3MW: est.pCkt3MW,
      pCkt2MW: est.pCkt2MW,
      p33NktMW: est.p33NktMW,
      p33OfMW: est.p33OfMW,
      matchedPowerTime: latestPower.matchedTimeLabel,
      powerStatusText: est.statusText,
      estimatedConductorTemp: est.tc60287,
      estimatedConductorTempTcf: est.tc60287,
      estimatedConductorTempTcl: est.tc60287,
      maxEstimatedConductorTemp: est.tc60287,
      power115kVCkt3MW: est.pCkt3MW,
      power115kVCkt2MW: est.pCkt2MW,
      power115kVCkt1MW: est.p33NktMW,
      power33kVPhaNganMW: est.p33OfMW,
      matchedPowerTimestamp: latestPower.matchedTimestamp,
      readings,
      currentDeltaTemp: latest.deltaTemp,
      currentAbsoluteTemp: latest.absoluteTemp,
      baselineTemp: 30.0,
      maxDeltaTemp: parseFloat(maxDelta.toFixed(4)),
      minDeltaTemp: parseFloat(minDelta.toFixed(4)),
      tempChangeAcrossSeries: parseFloat(changeAcross.toFixed(4)),
      rateOfChangePerHour: ratePerHour,
      status,
    };
  });
}

// Build multi-file chronological matrix for designated locations (Standard 38 vs Submarine 81)
export function buildLocationTimeSeries(
  parsedFiles: ParsedTeprFile[], 
  activePhase?: string,
  dailyPowerSummary?: DailyPowerSummary | null
): LocationTimeSeriesSummary[] {
  // Sort files chronologically
  const sorted = [...parsedFiles].sort((a, b) => (a.header.timestamp || 0) - (b.header.timestamp || 0));

  // Determine if Submarine Cable is active strictly based on selected activePhase
  const isSubmarine = 
    activePhase === 'Submarine Cable' || 
    (activePhase === 'all' && sorted.length > 0 && sorted.every((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3));

  const targetLocations = isSubmarine ? TARGET_LOCATIONS_SUBMARINE : TARGET_LOCATIONS_STANDARD;
  const currentPhase = activePhase && activePhase !== 'all' ? (activePhase as CablePhaseType) : (isSubmarine ? 'Submarine Cable' : undefined);
  const currentChannel = isSubmarine ? 3 : (activePhase === 'Phase A' ? 0 : activePhase === 'Phase B' ? 1 : activePhase === 'Phase C' ? 2 : undefined);

  return targetLocations.map((loc) => {
    const matchedPoint = findPointByDof(loc, isSubmarine ? 'SM' : (currentPhase || 'A'));

    const readings = sorted.map((file) => {
      const val = file.targetLocationValues.find((v) => Math.abs(v.location - loc) < 0.01);
      const delta = val ? val.deltaTemp : 0;
      const absTemp = val ? val.absoluteTemp : file.header.fiberReferenceTemp;
      const opPower = resolveOperatingPowerAtTime(dailyPowerSummary, {
        hour: file.dateMeta?.hour,
        minute: file.dateMeta?.minute,
        timeStr: file.dateMeta?.formattedTime,
      });
      const rEst = estimateConductorTemperatures(absTemp, matchedPoint, opPower);
      return {
        fileName: file.fileName,
        timestamp: file.header.timestamp || 0,
        dateTimeStr: file.header.dateTimeStr || file.fileName,
        displayTime: file.dateMeta.displayDateTime || file.fileName,
        cablePhase: file.cablePhase,
        channel: file.channel,
        deltaTemp: delta,
        absoluteTemp: absTemp,
        hasPowerData: rEst.hasPowerData,
        tc60287: rEst.tc60287,
        tcf: rEst.tc60287,
        tcl: rEst.tc60287,
        tcMax: rEst.tc60287,
        pCkt3MW: rEst.pCkt3MW,
        pCkt2MW: rEst.pCkt2MW,
        p33NktMW: rEst.p33NktMW,
        p33OfMW: rEst.p33OfMW,
        matchedPowerTime: opPower.matchedTimeLabel,
      };
    });

    const defaultReading = {
      fileName: '',
      timestamp: 0,
      dateTimeStr: '',
      displayTime: '',
      cablePhase: (isSubmarine ? 'Submarine Cable' : (currentPhase || 'Unassigned')) as CablePhaseType,
      channel: currentChannel,
      deltaTemp: 0,
      absoluteTemp: 30.0,
    };
    const latest = readings[readings.length - 1] || defaultReading;
    const first = readings[0] || defaultReading;

    // Find peak reading across the selected date's readings so Matrix matches the Profile Chart peak
    let peakReading = latest;
    let peakFile = sorted[sorted.length - 1];
    for (let i = 0; i < readings.length; i++) {
      if (readings[i].deltaTemp > peakReading.deltaTemp) {
        peakReading = readings[i];
        peakFile = sorted[i];
      }
    }

    let maxDelta = 0;
    let minDelta = 0;
    if (readings.length > 0) {
      maxDelta = readings[0].deltaTemp;
      minDelta = readings[0].deltaTemp;
      for (let k = 1; k < readings.length; k++) {
        const dt = readings[k].deltaTemp;
        if (dt > maxDelta) maxDelta = dt;
        if (dt < minDelta) minDelta = dt;
      }
    }
    const changeAcross = latest.deltaTemp - first.deltaTemp;

    let ratePerHour: number | undefined;
    if (readings.length >= 2 && first.timestamp && latest.timestamp) {
      const hours = (latest.timestamp - first.timestamp) / (1000 * 60 * 60);
      if (hours > 0) {
        ratePerHour = parseFloat((changeAcross / hours).toFixed(4));
      }
    }

    const peakPower = resolveOperatingPowerAtTime(dailyPowerSummary, {
      hour: peakFile?.dateMeta?.hour,
      minute: peakFile?.dateMeta?.minute,
      timeStr: peakFile?.dateMeta?.formattedTime,
    });
    const est = estimateConductorTemperatures(peakReading.absoluteTemp, matchedPoint, peakPower);

    let status: 'normal' | 'warning' | 'critical' = 'normal';
    const evalTemp = est.tc60287 !== null ? est.tc60287 : peakReading.absoluteTemp;
    if (evalTemp >= 60 || peakReading.deltaTemp >= 30 || maxDelta >= 30) {
      status = 'critical';
    } else if (evalTemp >= 45 || peakReading.deltaTemp >= 15 || maxDelta >= 15) {
      status = 'warning';
    }

    return {
      location: loc,
      tag: getLocationTag(loc, currentPhase, currentChannel),
      pos: matchedPoint?.pos,
      kp: matchedPoint?.kpFormatted ?? matchedPoint?.kp,
      sectionId: matchedPoint?.sectionId,
      sectionName: matchedPoint?.sectionName,
      sectionType: matchedPoint?.sectionType,
      cableCategory: matchedPoint?.cableCategory,
      dab: matchedPoint?.dab,
      dof: matchedPoint?.dof ?? loc,
      latitude: matchedPoint?.latitude,
      longitude: matchedPoint?.longitude,
      equationName: est.equationName,
      hasPowerData: est.hasPowerData,
      tc60287: est.tc60287,
      tcf: est.tc60287,
      tcl: est.tc60287,
      tcMax: est.tc60287,
      pCkt3MW: est.pCkt3MW,
      pCkt2MW: est.pCkt2MW,
      p33NktMW: est.p33NktMW,
      p33OfMW: est.p33OfMW,
      matchedPowerTime: peakPower.matchedTimeLabel,
      powerStatusText: est.statusText,
      estimatedConductorTemp: est.tc60287,
      estimatedConductorTempTcf: est.tc60287,
      estimatedConductorTempTcl: est.tc60287,
      maxEstimatedConductorTemp: est.tc60287,
      power115kVCkt3MW: est.pCkt3MW,
      power115kVCkt2MW: est.pCkt2MW,
      power115kVCkt1MW: est.p33NktMW,
      power33kVPhaNganMW: est.p33OfMW,
      matchedPowerTimestamp: peakPower.matchedTimestamp,
      readings,
      currentDeltaTemp: peakReading.deltaTemp,
      currentAbsoluteTemp: peakReading.absoluteTemp,
      baselineTemp: sorted[0]?.header.fiberReferenceTemp || 30.0,
      maxDeltaTemp: parseFloat(maxDelta.toFixed(4)),
      minDeltaTemp: parseFloat(minDelta.toFixed(4)),
      tempChangeAcrossSeries: parseFloat(changeAcross.toFixed(4)),
      rateOfChangePerHour: ratePerHour,
      status,
    };
  });
}

export interface DiscretePositionPeakMetric {
  location: number;
  locationLabel: string;
  tag: string;
  pos?: string;
  kp?: string | number;
  sectionId?: string;
  sectionName?: string;
  sectionType?: CableSectionType;
  cableCategory?: CableCategory;
  dab?: number | null;
  dof?: number;
  latitude?: number;
  longitude?: number;
  equationName?: ConductorEquationName;
  // Conductor Temperature Estimation (IEC 60287: Equations Alpha, Beta, Charlie, Delta, Echo)
  hasPowerData?: boolean;
  tc60287?: number | null;
  tcf?: number | null;
  tcl?: number | null;
  tcMax?: number | null;
  pCkt3MW?: number | null;
  pCkt2MW?: number | null;
  p33NktMW?: number | null;
  p33OfMW?: number | null;
  matchedPowerTime?: string;
  powerStatusText?: string;
  maxDeltaTemp: number; // Maximum temperature result (°C) for this position
  maxAbsoluteTemp: number; // Maximum absolute temperature (°C) for this position
  peakFileId: string;
  peakFileName: string;
  peakTimestamp: number;
  peakFormattedDateTime: string;
  peakFormattedDate: string;
  peakFormattedTime: string;
  cablePhase: CablePhaseType;
  channel?: number;
  fiberReferenceTemp: number;
  phasePeaks: {
    phaseA?: { maxDelta: number; maxAbs: number; peakTime: string; fileName: string; timestamp: number; tc60287?: number | null; tcf?: number | null; tcl?: number | null };
    phaseB?: { maxDelta: number; maxAbs: number; peakTime: string; fileName: string; timestamp: number; tc60287?: number | null; tcf?: number | null; tcl?: number | null };
    phaseC?: { maxDelta: number; maxAbs: number; peakTime: string; fileName: string; timestamp: number; tc60287?: number | null; tcf?: number | null; tcl?: number | null };
    submarine?: { maxDelta: number; maxAbs: number; peakTime: string; fileName: string; timestamp: number; tc60287?: number | null; tcf?: number | null; tcl?: number | null };
  };
}

// Compute discrete peak amplitude and maximum event timestamps strictly for designated positions
// Phase A/B/C: 38 positions (2020.94m to 3464.56m across Sections 1.1 to 1.6)
// Submarine Cable: 81 positions (2691.75m to 55225.87m across Sections 2.1 to 2.13)
export function buildDiscretePositionPeaks(
  parsedFiles: ParsedTeprFile[],
  phaseFilter = 'all',
  hourFilter = 'all',
  dailyPowerSummary?: DailyPowerSummary | null
): DiscretePositionPeakMetric[] {
  if (parsedFiles.length === 0) return [];

  const isSubmarine = 
    phaseFilter === 'Submarine Cable' || 
    (phaseFilter === 'all' && parsedFiles.length > 0 && parsedFiles.every((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3));

  const targetLocations = isSubmarine ? TARGET_LOCATIONS_SUBMARINE : TARGET_LOCATIONS_STANDARD;

  // Filter files by phase and hour
  const filesToConsider = parsedFiles.filter((f) => {
    if (phaseFilter !== 'all' && f.cablePhase !== phaseFilter) return false;
    if (hourFilter !== 'all') {
      const fHour = f.dateMeta?.hourKey || (f.dateMeta?.hour !== undefined ? String(f.dateMeta.hour).padStart(2, '0') : '');
      if (fHour !== hourFilter) return false;
    }
    return true;
  });

  // Group files by phase for cross-phase peak comparisons (applying hour filter if active)
  const hourMatchingFiles = hourFilter === 'all'
    ? parsedFiles
    : parsedFiles.filter((f) => {
        const fHour = f.dateMeta?.hourKey || (f.dateMeta?.hour !== undefined ? String(f.dateMeta.hour).padStart(2, '0') : '');
        return fHour === hourFilter;
      });

  const filesByPhase = {
    'Phase A': hourMatchingFiles.filter((f) => f.cablePhase === 'Phase A' || f.channel === 0),
    'Phase B': hourMatchingFiles.filter((f) => f.cablePhase === 'Phase B' || f.channel === 1),
    'Phase C': hourMatchingFiles.filter((f) => f.cablePhase === 'Phase C' || f.channel === 2),
    'Submarine Cable': hourMatchingFiles.filter((f) => f.cablePhase === 'Submarine Cable' || f.channel === 3),
  };

  return targetLocations.map((loc) => {
    let globalMaxDelta = -Infinity;
    let bestFile: ParsedTeprFile | null = null;
    let bestDelta = 0;
    let bestAbs = 30.0;

    const phasePeaks: DiscretePositionPeakMetric['phasePeaks'] = {};

    // Calculate individual phase peaks
    for (const [phaseKey, pFiles] of Object.entries(filesByPhase)) {
      if (pFiles.length === 0) continue;
      let pMaxDelta = -Infinity;
      let pBestFile: ParsedTeprFile | null = null;

      for (const f of pFiles) {
        const val = f.targetLocationValues.find((v) => Math.abs(v.location - loc) < 0.01);
        const delta = val ? val.deltaTemp : 0;
        if (delta > pMaxDelta) {
          pMaxDelta = delta;
          pBestFile = f;
        }
      }

      if (pBestFile && pMaxDelta !== -Infinity) {
        const baseline = pBestFile.header.fiberReferenceTemp || 30.0;
        const pAbs = parseFloat((baseline + pMaxDelta).toFixed(4));
        const pMatchedPt = findPointByDof(loc, phaseKey === 'Submarine Cable' ? 'SM' : phaseKey);
        const pPower = resolveOperatingPowerAtTime(dailyPowerSummary, {
          hour: pBestFile.dateMeta?.hour,
          minute: pBestFile.dateMeta?.minute,
          timeStr: pBestFile.dateMeta?.formattedTime,
        });
        const pEst = estimateConductorTemperatures(pAbs, pMatchedPt, pPower);

        const peakEntry = {
          maxDelta: parseFloat(pMaxDelta.toFixed(4)),
          maxAbs: pAbs,
          peakTime: pBestFile.dateMeta?.displayDateTime || pBestFile.fileName,
          fileName: pBestFile.fileName,
          timestamp: pBestFile.dateMeta?.timestamp || 0,
          tc60287: pEst.tc60287,
          tcf: pEst.tc60287,
          tcl: pEst.tc60287,
        };

        if (phaseKey === 'Phase A') phasePeaks.phaseA = peakEntry;
        else if (phaseKey === 'Phase B') phasePeaks.phaseB = peakEntry;
        else if (phaseKey === 'Phase C') phasePeaks.phaseC = peakEntry;
        else if (phaseKey === 'Submarine Cable') phasePeaks.submarine = peakEntry;
      }
    }

    // Find peak for active filesToConsider
    for (const f of filesToConsider) {
      const val = f.targetLocationValues.find((v) => Math.abs(v.location - loc) < 0.01);
      const delta = val ? val.deltaTemp : 0;
      if (delta > globalMaxDelta) {
        globalMaxDelta = delta;
        bestFile = f;
        bestDelta = delta;
        bestAbs = val ? val.absoluteTemp : (f.header.fiberReferenceTemp + delta);
      }
    }

    const fallbackFile = filesToConsider[0] || parsedFiles[0];
    const activeF = bestFile || fallbackFile;
    const baseline = activeF?.header.fiberReferenceTemp || 30.0;
    const finalDelta = globalMaxDelta === -Infinity ? 0 : parseFloat(bestDelta.toFixed(4));
    const finalAbs = globalMaxDelta === -Infinity ? baseline : parseFloat(bestAbs.toFixed(4));
    const activePhase = (phaseFilter !== 'all' ? phaseFilter : activeF?.cablePhase || 'Phase A') as CablePhaseType;
    const channel = isSubmarine ? 3 : (activePhase === 'Phase A' ? 0 : activePhase === 'Phase B' ? 1 : activePhase === 'Phase C' ? 2 : undefined);

    const matchedPoint = findPointByDof(loc, isSubmarine ? 'SM' : (activePhase || 'A'));

    // Nearest 15-minute power reading for active peak timestamp
    const powerAtPeak = resolveOperatingPowerAtTime(dailyPowerSummary, {
      hour: activeF?.dateMeta?.hour,
      minute: activeF?.dateMeta?.minute,
      timeStr: activeF?.dateMeta?.formattedTime,
    });
    const est = estimateConductorTemperatures(finalAbs, matchedPoint, powerAtPeak);

    return {
      location: loc,
      locationLabel: `${loc.toFixed(2)}m`,
      tag: getLocationTag(loc, activePhase, channel),
      pos: matchedPoint?.pos,
      kp: matchedPoint?.kp,
      sectionId: matchedPoint?.sectionId,
      sectionName: matchedPoint?.sectionName,
      sectionType: matchedPoint?.sectionType,
      cableCategory: matchedPoint?.cableCategory,
      dab: matchedPoint?.dab,
      dof: matchedPoint?.dof ?? loc,
      latitude: matchedPoint?.latitude,
      longitude: matchedPoint?.longitude,
      equationName: est.equationName,
      hasPowerData: est.hasPowerData,
      tc60287: est.tc60287,
      tcf: est.tc60287,
      tcl: est.tc60287,
      tcMax: est.tc60287,
      pCkt3MW: est.pCkt3MW,
      pCkt2MW: est.pCkt2MW,
      p33NktMW: est.p33NktMW,
      p33OfMW: est.p33OfMW,
      matchedPowerTime: powerAtPeak.matchedTimeLabel,
      powerStatusText: est.statusText,
      maxDeltaTemp: finalDelta,
      maxAbsoluteTemp: finalAbs,
      peakFileId: activeF?.fileId || '',
      peakFileName: activeF?.fileName || '',
      peakTimestamp: activeF?.dateMeta?.timestamp || activeF?.header.timestamp || 0,
      peakFormattedDateTime: activeF?.dateMeta?.displayDateTime || activeF?.header.dateTimeStr || activeF?.fileName || '',
      peakFormattedDate: activeF?.dateMeta?.formattedDate || '',
      peakFormattedTime: activeF?.dateMeta?.formattedTime || '',
      cablePhase: activePhase,
      channel,
      fiberReferenceTemp: baseline,
      phasePeaks,
    };
  });
}

// Generate realistic synthetic .TEPR dataset for testing & preview with authentic format e.g. Temp_Aug010007_514150
export function generateSampleTeprContent(
  timestampIso: string, 
  channel = 0, 
  baselineFiberTemp = 30.0, 
  hotspotMultiplier = 1.0
): string {
  const dt = new Date(timestampIso);
  const dateStr = dt.toISOString().slice(0, 10);
  const timeStr = dt.toTimeString().slice(0, 8);

  const isSubmarine = channel === 3;
  const startPos = isSubmarine ? 2650.0 : 2000.0;
  const endPos = isSubmarine ? 55350.0 : 3520.0;
  const step = isSubmarine ? 32.67 : 2.04;
  const count = Math.floor((endPos - startPos) / step) + 1;

  const phaseInfo = getCablePhaseFromChannel(channel);

  let content = `# ========================================================\n`;
  content += `# Distributed Temperature Sensing (DTS) - Asset Evaluation Report\n`;
  content += `# Channel No  = ${channel}\n`;
  content += `# Channel: ${channel} (${phaseInfo.phase})\n`;
  content += `# Date: ${dateStr}\n`;
  content += `# Time: ${timeStr}\n`;
  content += `# Characteristic: Fiber Temperature = ${baselineFiberTemp.toFixed(1)} Celsius\n`;
  content += `# Fiber Reference Temperature: ${baselineFiberTemp} C\n`;
  content += `# Cable Asset Section: ${phaseInfo.description}\n`;
  content += `# Start Position: ${startPos.toFixed(2)} m\n`;
  content += `# End Position: ${endPos.toFixed(2)} m\n`;
  content += `# Spatial Sampling Interval: ${step.toFixed(2)} m\n`;
  content += `# ========================================================\n`;
  content += `${count}\n`;

  for (let pos = startPos; pos <= endPos; pos += step) {
    if (isSubmarine) {
      // Submarine subsea temperature profile along 55km route (Zones 2.1 to 2.13)
      let delta = -4.2 + Math.sin(pos / 3800) * 2.4 + (Math.sin(pos * 0.13) * 0.2);

      // Zone 2.1 Bottleneck (2691m - 2855m): HDD & multi-circuit thermal proximity
      if (pos <= 2900) {
        delta += 5.8 * hotspotMultiplier;
      }

      // Zone 2.3 XPWA Water Pipeline Crossing (15073m - 15139m)
      const distXpwa = Math.abs(pos - 15106.53);
      if (distXpwa < 220) {
        delta += Math.exp(-Math.pow(distXpwa / 75, 2)) * 9.5 * hotspotMultiplier;
      }

      // Zone 2.5 & 2.6 Nexans Subsea Repair Joints NX2 & NX1 (35100m - 35296m)
      const distNx = Math.abs(pos - 35198.0);
      if (distNx < 260) {
        delta += Math.exp(-Math.pow(distNx / 95, 2)) * 12.4 * hotspotMultiplier;
      }

      // Zone 2.8 & 2.9 Furukawa Subsea Repair Joints FR1 & FR2 (36342m - 36538m)
      const distFr = Math.abs(pos - 36440.0);
      if (distFr < 260) {
        delta += Math.exp(-Math.pow(distFr / 90, 2)) * 11.2 * hotspotMultiplier;
      }

      // Zone 2.11 X33kV Submarine Cable Crossing (51338m - 51501m)
      const distX33 = Math.abs(pos - 51403.43);
      if (distX33 < 220) {
        delta += Math.exp(-Math.pow(distX33 / 80, 2)) * 10.6 * hotspotMultiplier;
      }

      // Zone 2.13 TJ2 Transition Joint 2 Koh Samui (54833m - 55225m)
      const distTj2 = Math.abs(pos - 54931.84);
      if (distTj2 < 350) {
        delta += Math.exp(-Math.pow(distTj2 / 140, 2)) * 14.8 * hotspotMultiplier;
      }

      content += `${pos.toFixed(2)} ${delta.toFixed(4)}\n`;
    } else {
      // Land Cable thermal profile across Sections 1.1 to 1.6 (2020.94m to 3464.56m)
      let delta = 2.5 + Math.sin(pos / 180) * 1.8 + (Math.cos(pos * 0.25) * 0.25);

      // Phase-specific load offset
      const phaseOffset = channel === 0 ? 0.4 : channel === 1 ? 1.6 : channel === 2 ? -0.5 : 0;
      delta += phaseOffset;

      // Section 1.2 Joint Pit 1 (JP1: 2541.62m - 2553.87m)
      const distJp1 = Math.abs(pos - 2547.75);
      if (distJp1 < 28) {
        delta += Math.exp(-Math.pow(distJp1 / 10, 2)) * 9.5 * hotspotMultiplier;
      }

      // Section 1.4 Joint Pit 2 (JP2: 3048.01m - 3060.27m)
      const distJp2 = Math.abs(pos - 3054.14);
      if (distJp2 < 28) {
        delta += Math.exp(-Math.pow(distJp2 / 10, 2)) * 8.4 * hotspotMultiplier;
      }

      // Section 1.5 Land Section 3 (LS3: 3068.43m - 3450.27m) - Parallel with other 3 circuits
      if (pos >= 3065 && pos <= 3451) {
        delta += 3.2 * hotspotMultiplier;
      }

      // Section 1.6 Transition Joint 1 (TJ1: 3452.31m - 3464.56m)
      const distTj1 = Math.abs(pos - 3458.44);
      if (distTj1 < 25) {
        delta += Math.exp(-Math.pow(distTj1 / 12, 2)) * 11.8 * hotspotMultiplier;
      }

      content += `${pos.toFixed(2)} ${delta.toFixed(4)}\n`;
    }
  }

  return content;
}

export interface ParsedTeprDataset {
  files: ParsedTeprFile[];
  hourlySummaries: HourlyTeprSummary[];
  locationSummaries: LocationTimeSeriesSummary[];
  globalMaxDelta: number;
  globalMaxAbsoluteTemp: number;
  globalMinDelta: number;
  hotspotLocation: number;
  hotspotTag: string;
  hotspotFile: string;
  hotspotPhase?: CablePhaseType;
  timeSpanHours: number;
  // Conductor Temperature & Power Integration (Equations #1 to #15)
  hasPowerData?: boolean;
  powerDateKey?: string;
  globalMaxTcf?: number | null;
  globalMaxTcl?: number | null;
  globalMaxTc?: number | null;
  globalTcomp?: number | null;
  pCkt3MW?: number | null;
  pCkt2MW?: number | null;
  p33NktMW?: number | null;
  p33OfMW?: number | null;
  matchedPowerTime?: string;
  powerStatusText?: string;
}

// Instant offline metadata scanner for .TEPR files
export function scanTeprFilesMetadataOnly(
  files: Array<{
    id: string;
    name: string;
    subfolderName?: string;
    folderPath?: string;
    modifiedTime?: string;
  }>
): ScannedFileMeta[] {
  const scanned: ScannedFileMeta[] = [];

  for (const f of files) {
    const dateMeta = extractDateTimeFromText('', f.name, f.subfolderName || '', f.folderPath || '');
    const cablePhase = guessPhaseFromPath(f.name, f.folderPath || '', f.subfolderName || '');
    const channel =
      cablePhase === 'Phase A'
        ? 0
        : cablePhase === 'Phase B'
        ? 1
        : cablePhase === 'Phase C'
        ? 2
        : cablePhase === 'Submarine Cable'
        ? 3
        : undefined;

    scanned.push({
      fileId: f.id,
      fileName: f.name,
      subfolderName: f.subfolderName,
      folderPath: f.folderPath,
      modifiedTime: f.modifiedTime,
      dateMeta,
      cablePhase,
      channel,
    });
  }

  scanned.sort((a, b) => a.dateMeta.timestamp - b.dateMeta.timestamp);
  return scanned;
}

// Enrich a ParsedTeprDataset with Power Consumption Data (Equations #1 to #15) for the selected date
export function enrichTeprDatasetWithPower(
  dataset: ParsedTeprDataset,
  powerSummariesByDate?: Map<string, DailyPowerSummary> | Record<string, DailyPowerSummary> | null,
  activeDateKey?: string,
  activeHourKey?: string
): ParsedTeprDataset {
  if (!dataset || dataset.files.length === 0) return dataset;

  const targetDateKey = activeDateKey && activeDateKey !== 'all'
    ? activeDateKey
    : dataset.files[dataset.files.length - 1]?.dateMeta?.dateKey || '';

  const getDailyPower = (dateKey: string): DailyPowerSummary | undefined => {
    if (!powerSummariesByDate || !dateKey) return undefined;
    if (powerSummariesByDate instanceof Map) {
      return powerSummariesByDate.get(dateKey);
    }
    return powerSummariesByDate[dateKey];
  };

  const dailySummaryForTargetDate = getDailyPower(targetDateKey);

  // Determine reference time for global summary (either activeHourKey or peak file's timestamp)
  const peakFileObj = dataset.files.find((f) => f.fileName === dataset.hotspotFile) || dataset.files[dataset.files.length - 1];
  const refHour = activeHourKey && activeHourKey !== 'all' ? parseInt(activeHourKey, 10) : peakFileObj?.dateMeta?.hour;
  const refMinute = activeHourKey && activeHourKey !== 'all' ? 30 : peakFileObj?.dateMeta?.minute;

  const globalPower = resolveOperatingPowerAtTime(dailySummaryForTargetDate, {
    hour: refHour,
    minute: refMinute,
    timeStr: peakFileObj?.dateMeta?.formattedTime,
  });

  let globalMaxTc: number | null = null;

  const enrichedLocations: LocationTimeSeriesSummary[] = dataset.locationSummaries.map((locSummary) => {
    const isSub = locSummary.cableCategory === 'submarine';
    const matchedPoint = findPointByDof(locSummary.location, isSub ? 'SM' : 'A');

    // Enrich each reading in readings[]
    const enrichedReadings = locSummary.readings.map((r) => {
      // Determine reading's dateKey and time
      const readingHour = typeof r.timestamp === 'number' && r.timestamp >= 0 && r.timestamp <= 23
        ? r.timestamp
        : new Date(r.timestamp).getUTCHours();
      const readingPower = resolveOperatingPowerAtTime(dailySummaryForTargetDate, {
        hour: readingHour,
        minute: 15,
        timeStr: r.displayTime,
      });
      const rEst = estimateConductorTemperatures(r.absoluteTemp, matchedPoint, readingPower);
      return {
        ...r,
        hasPowerData: rEst.hasPowerData,
        tc60287: rEst.tc60287,
        tcf: rEst.tcf,
        tcl: rEst.tcl,
        tcMax: rEst.tcMax,
        pCkt3MW: rEst.pCkt3MW,
        pCkt2MW: rEst.pCkt2MW,
        p33NktMW: rEst.p33NktMW,
        p33OfMW: rEst.p33OfMW,
        matchedPowerTime: readingPower.matchedTimeLabel,
      };
    });

    // Estimate at current/peak reading of this location
    const locEst = estimateConductorTemperatures(locSummary.currentAbsoluteTemp, matchedPoint, globalPower);

    if (locEst.hasPowerData) {
      if (locEst.tc60287 !== null && (globalMaxTc === null || locEst.tc60287 > globalMaxTc)) {
        globalMaxTc = locEst.tc60287;
      }
    }

    return {
      ...locSummary,
      kp: matchedPoint?.kpFormatted ?? matchedPoint?.kp ?? locSummary.kp,
      equationName: matchedPoint?.equationName ?? locSummary.equationName ?? locEst.equationName,
      hasPowerData: locEst.hasPowerData,
      tc60287: locEst.tc60287,
      tcf: locEst.tcf,
      tcl: locEst.tcl,
      tcMax: locEst.tcMax,
      pCkt3MW: locEst.pCkt3MW,
      pCkt2MW: locEst.pCkt2MW,
      p33NktMW: locEst.p33NktMW,
      p33OfMW: locEst.p33OfMW,
      matchedPowerTime: globalPower.matchedTimeLabel,
      powerStatusText: locEst.statusText,
      estimatedConductorTemp60287: locEst.tc60287,
      estimatedConductorTempTcf: locEst.tcf,
      estimatedConductorTempTcl: locEst.tcl,
      maxEstimatedConductorTemp: locEst.tcMax,
      power115kVCkt3MW: locEst.pCkt3MW,
      power115kVCkt2MW: locEst.pCkt2MW,
      power115kVCkt1MW: locEst.p33NktMW,
      power33kVPhaNganMW: locEst.p33OfMW,
      matchedPowerTimestamp: globalPower.matchedTimestamp,
      readings: enrichedReadings,
    };
  });

  return {
    ...dataset,
    locationSummaries: enrichedLocations,
    hasPowerData: globalPower.hasPowerData,
    powerDateKey: targetDateKey,
    globalMaxTcf: globalMaxTc,
    globalMaxTcl: globalMaxTc,
    globalMaxTc,
    globalTcomp: null,
    pCkt3MW: globalPower.hasPowerData ? globalPower.pCkt3MW : null,
    pCkt2MW: globalPower.hasPowerData ? globalPower.pCkt2MW : null,
    p33NktMW: globalPower.hasPowerData ? globalPower.p33NktMW : null,
    p33OfMW: globalPower.hasPowerData ? globalPower.p33OfMW : null,
    matchedPowerTime: globalPower.matchedTimeLabel,
    powerStatusText: globalPower.hasPowerData ? `1h Max Power (${globalPower.matchedTimeLabel})` : 'No Power Data for Date',
  };
}

// Parse multiple .TEPR files into a unified chronological dataset
export function parseMultipleTeprFiles(
  files: Array<{
    id: string;
    name: string;
    content: string;
    subfolderName?: string;
    folderPath?: string;
  }>,
  powerSummariesByDate?: Map<string, DailyPowerSummary> | Record<string, DailyPowerSummary> | null
): ParsedTeprDataset {
  const parsedFiles = files.map((f) =>
    parseTeprContent(f.id, f.name, f.content, f.subfolderName || '', f.folderPath || '')
  );

  // Sort chronologically
  parsedFiles.sort((a, b) => (a.dateMeta.timestamp || 0) - (b.dateMeta.timestamp || 0));

  const hourlySummaries = aggregateHourlyTeprFiles(parsedFiles);
  const locationSummaries =
    hourlySummaries.length > 0
      ? buildHourlyLocationTimeSeries(hourlySummaries)
      : buildLocationTimeSeries(parsedFiles);

  let globalMaxDelta = -Infinity;
  let globalMaxAbsoluteTemp = -Infinity;
  let globalMinDelta = Infinity;
  let hotspotLocation = 0;
  let hotspotTag = 'N/A';
  let hotspotFile = 'N/A';
  let hotspotPhase: CablePhaseType | undefined;

  for (const f of parsedFiles) {
    if (f.maxDeltaTemp > globalMaxDelta) {
      globalMaxDelta = f.maxDeltaTemp;
      globalMaxAbsoluteTemp = parseFloat((f.header.fiberReferenceTemp + f.maxDeltaTemp).toFixed(4));
      hotspotLocation = f.maxDeltaPosition;
      hotspotTag = getLocationTag(f.maxDeltaPosition, f.cablePhase, f.channel);
      hotspotFile = f.fileName;
      hotspotPhase = f.cablePhase;
    }
    if (f.minDeltaTemp < globalMinDelta) {
      globalMinDelta = f.minDeltaTemp;
    }
  }

  if (globalMaxDelta === -Infinity) {
    globalMaxDelta = 0;
    globalMaxAbsoluteTemp = 30.0;
  }
  if (globalMinDelta === Infinity) {
    globalMinDelta = 0;
  }

  let timeSpanHours = 0;
  if (parsedFiles.length >= 2) {
    const firstTs = parsedFiles[0].dateMeta.timestamp;
    const lastTs = parsedFiles[parsedFiles.length - 1].dateMeta.timestamp;
    timeSpanHours = Math.max(0, parseFloat(((lastTs - firstTs) / (1000 * 60 * 60)).toFixed(2)));
  }

  const baseDataset: ParsedTeprDataset = {
    files: parsedFiles,
    hourlySummaries,
    locationSummaries,
    globalMaxDelta,
    globalMaxAbsoluteTemp,
    globalMinDelta,
    hotspotLocation,
    hotspotTag,
    hotspotFile,
    hotspotPhase,
    timeSpanHours,
  };

  return enrichTeprDatasetWithPower(baseDataset, powerSummariesByDate);
}

// Generate complete synthetic .TEPR multi-day multi-phase dataset for immediate testing
export function generateSampleTeprDataset(): Array<{
  id: string;
  name: string;
  content: string;
  subfolderName: string;
  folderPath: string;
}> {
  const sampleFiles: Array<{
    id: string;
    name: string;
    content: string;
    subfolderName: string;
    folderPath: string;
  }> = [];

  const sampleDays = [
    { dateIso: '2026-08-01', monAbbr: 'Aug', dayStr: '01', subfolder: '01082026', folderPath: '2026/August/01082026', mult: 0.95 },
    { dateIso: '2026-08-04', monAbbr: 'Aug', dayStr: '04', subfolder: '04082026', folderPath: '2026/August/04082026', mult: 1.02 },
    { dateIso: '2026-08-07', monAbbr: 'Aug', dayStr: '07', subfolder: '07082026', folderPath: '2026/August/07082026', mult: 1.12 },
    { dateIso: '2026-08-08', monAbbr: 'Aug', dayStr: '08', subfolder: '08082026', folderPath: '2026/August/08082026', mult: 1.18 },
    { dateIso: '2026-09-01', monAbbr: 'Sep', dayStr: '01', subfolder: '01092026', folderPath: '2026/September/01092026', mult: 1.06 },
  ];

  const sampleHours = [
    { hh: '00', mm: '07', hourFactor: 0.85 },
    { hh: '06', mm: '15', hourFactor: 0.90 },
    { hh: '12', mm: '30', hourFactor: 1.05 },
    { hh: '15', mm: '45', hourFactor: 1.12 },
    { hh: '19', mm: '15', hourFactor: 1.22 },
    { hh: '21', mm: '51', hourFactor: 1.15 },
  ];

  const channels = [
    { ch: 0, code: '514150', phaseFolder: 'Phase_A' },
    { ch: 1, code: '514151', phaseFolder: 'Phase_B' },
    { ch: 2, code: '514152', phaseFolder: 'Phase_C' },
    { ch: 3, code: '514153', phaseFolder: 'Submarine_Cable' },
  ];

  for (const d of sampleDays) {
    for (const h of sampleHours) {
      for (const c of channels) {
        const fileName = `Temp_${d.monAbbr}${d.dayStr}${h.hh}${h.mm}_${c.code}.tepr`;
        const tsIso = `${d.dateIso}T${h.hh}:${h.mm}:00.000Z`;
        const combinedMult = Number((d.mult * h.hourFactor).toFixed(3));
        const content = generateSampleTeprContent(tsIso, c.ch, 30.0, combinedMult);
        sampleFiles.push({
          id: `sample-${d.subfolder}-${h.hh}${h.mm}-ch${c.ch}`,
          name: fileName,
          content,
          subfolderName: d.subfolder,
          folderPath: `${d.folderPath}/${c.phaseFolder}`,
        });
      }
    }
  }

  return sampleFiles;
}

