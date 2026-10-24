// Power Consumption Parser and Data Models for 4 Submarine Cable Circuits
// Circuits:
// 1. 115 kV Circuit #3 (Target folder "KMB" - Column G "03YB01", minus value converted to positive)
// 2. 115 kV Circuit #2 (Target folder "KMA" - Column I "04YB01", minus value converted to positive)
// 3. 33 kV NKT Circuit (Target folder "KNA" - Column N "07WB01", already positive value - no conversion)
// 4. 33 kV Oil filled Circuit (Target folder "KNA" - Column P "10WB01", already positive value - no conversion)

export type SubstationCode = 'KMA' | 'KMB' | 'KNA';

export interface PowerCircuitDefinition {
  id: 'circuit_115kv_2' | 'circuit_115kv_3' | 'circuit_33kv_nkt' | 'circuit_33kv_oil';
  name: string;
  shortName: string;
  voltage: string;
  substation: SubstationCode;
  targetFolderName: SubstationCode;
  columnTag: string;
  columnLetter: string;
  columnIndex: number; // 0-based index: G=6, I=8, N=13, P=15
  color: string;
  invertSign: boolean; // true for KMB (03YB01) and KMA (04YB01) minus -> positive; false for KNA (07WB01, 10WB01)
  description: string;
}

export const POWER_CIRCUITS: PowerCircuitDefinition[] = [
  {
    id: 'circuit_115kv_3',
    name: '115 kV Circuit #3',
    shortName: '115 kV Ckt #3',
    voltage: '115 kV',
    substation: 'KMB',
    targetFolderName: 'KMB',
    columnTag: '03YB01',
    columnLetter: 'G',
    columnIndex: 6,
    color: '#8b5cf6', // Violet
    invertSign: true,
    description: 'Target folder "KMB" · Column G "03YB01" (Minus value converted to positive)',
  },
  {
    id: 'circuit_115kv_2',
    name: '115 kV Circuit #2',
    shortName: '115 kV Ckt #2',
    voltage: '115 kV',
    substation: 'KMA',
    targetFolderName: 'KMA',
    columnTag: '04YB01',
    columnLetter: 'I',
    columnIndex: 8,
    color: '#2563eb', // Royal Blue
    invertSign: true,
    description: 'Target folder "KMA" · Column I "04YB01" (Minus value converted to positive)',
  },
  {
    id: 'circuit_33kv_nkt',
    name: '33 kV NKT Circuit',
    shortName: '33 kV NKT',
    voltage: '33 kV',
    substation: 'KNA',
    targetFolderName: 'KNA',
    columnTag: '07WB01',
    columnLetter: 'N',
    columnIndex: 13,
    color: '#059669', // Emerald
    invertSign: false,
    description: 'Target folder "KNA" · Column N "07WB01" (Already positive value — no conversion)',
  },
  {
    id: 'circuit_33kv_oil',
    name: '33 kV Oil filled Circuit',
    shortName: '33 kV Oil Filled',
    voltage: '33 kV',
    substation: 'KNA',
    targetFolderName: 'KNA',
    columnTag: '10WB01',
    columnLetter: 'P',
    columnIndex: 15,
    color: '#d97706', // Amber / Orange
    invertSign: false,
    description: 'Target folder "KNA" · Column P "10WB01" (Already positive value — no conversion)',
  },
];

export interface PowerScannedFileMeta {
  fileId: string;
  fileName: string;
  substation: SubstationCode;
  subfolderName?: string;
  folderPath?: string;
  modifiedTime?: string;
  dateMeta: {
    year: number;
    month: number;
    day: number;
    yearKey: string;
    monthKey: string;
    dateKey: string;
    formattedDate: string;
    timestamp: number;
  };
}

export interface DailyPowerDataPoint {
  time: string; // HH:mm
  timeMinutes: number; // 0..1439
  kmaCircuit2: number; // MW
  kmbCircuit3: number; // MW
  knaNkt: number; // MW
  knaOilFilled: number; // MW
  totalPower: number; // MW (Sum of all 4 circuits)
}

export interface CircuitMetrics {
  peakMW: number;
  peakTime: string;
  minMW: number;
  avgMW: number;
  totalEnergyMWh: number;
}

export interface DailyPowerSummary {
  dateKey: string; // YYYY-MM-DD
  formattedDate: string;
  year: number;
  month: number;
  day: number;
  dataPoints: DailyPowerDataPoint[];
  metrics: {
    circuit_115kv_2: CircuitMetrics;
    circuit_115kv_3: CircuitMetrics;
    circuit_33kv_nkt: CircuitMetrics;
    circuit_33kv_oil: CircuitMetrics;
    total: CircuitMetrics;
  };
  substationsLoaded: {
    KMA: boolean;
    KMB: boolean;
    KNA: boolean;
  };
  filesLoaded: Array<{
    fileId?: string;
    fileName: string;
    substation: SubstationCode;
    rowCount: number;
  }>;
  isSyntheticSample?: boolean;
}

// Special Time Duration Period Configuration for Daily Peak Load SCADA Analysis
export interface SpecialPeriodConfig {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  startMinutes: number; // 0..1439
  endMinutes: number;   // 0..1440
  crossMidnight?: boolean;
}

export const SPECIAL_PERIODS: SpecialPeriodConfig[] = [
  {
    id: 'full_day',
    name: 'Full Day (24 Hours)',
    shortLabel: '24h Full Day',
    description: '00:00 - 24:00 (Standard all-day peak envelope across 96 intervals)',
    startMinutes: 0,
    endMinutes: 1440,
    crossMidnight: false,
  },
  {
    id: 'on_peak',
    name: 'On-Peak Tariff Period',
    shortLabel: 'On-Peak (09:00 - 22:00)',
    description: '09:00 - 22:00 (Standard Utility & Commercial high-demand window)',
    startMinutes: 9 * 60, // 540
    endMinutes: 22 * 60, // 1320
    crossMidnight: false,
  },
  {
    id: 'off_peak',
    name: 'Off-Peak Period',
    shortLabel: 'Off-Peak (22:00 - 09:00)',
    description: '22:00 - 09:00 (Night & early morning island base load)',
    startMinutes: 22 * 60, // 1320
    endMinutes: 9 * 60,  // 540
    crossMidnight: true,
  },
  {
    id: 'afternoon_peak',
    name: 'Afternoon Peak Period',
    shortLabel: 'Afternoon (12:00 - 17:00)',
    description: '12:00 - 17:00 (High cooling load & solar generation transition)',
    startMinutes: 12 * 60, // 720
    endMinutes: 17 * 60, // 1020
    crossMidnight: false,
  },
  {
    id: 'evening_peak',
    name: 'Evening Island Peak Period',
    shortLabel: 'Evening (18:00 - 22:00)',
    description: '18:00 - 22:00 (Island tourism night peak & lighting load)',
    startMinutes: 18 * 60, // 1080
    endMinutes: 22 * 60, // 1320
    crossMidnight: false,
  },
  {
    id: 'morning_ramp',
    name: 'Morning Ramp Period',
    shortLabel: 'Morning (06:00 - 12:00)',
    description: '06:00 - 12:00 (Morning commercial wake-up & load ramp-up)',
    startMinutes: 6 * 60, // 360
    endMinutes: 12 * 60, // 720
    crossMidnight: false,
  },
];

export interface DailyPeriodPeakPoint {
  dateKey: string;
  formattedDate: string;
  day: number;
  month: number;
  year: number;
  // Peak load MW and exact time for each of the 4 circuits
  peakCircuit2: number;
  timeCircuit2: string;
  peakCircuit3: number;
  timeCircuit3: string;
  peakKnaNkt: number;
  timeKnaNkt: string;
  peakKnaOil: number;
  timeKnaOil: string;
  // Peak load MW and exact time for all 4 circuits combined
  peakTotal: number;
  timeTotal: string;
  sampleCount: number;
}

// Check if a minute falls into the special time duration period
export function isMinuteInSpecialPeriod(
  minute: number,
  startMinutes: number,
  endMinutes: number,
  crossMidnight = false
): boolean {
  if (crossMidnight) {
    return minute >= startMinutes || minute <= endMinutes;
  }
  return minute >= startMinutes && minute <= endMinutes;
}

// Calculate the peak load (MW) and timestamp for each and all 4 circuits within a special duration period
export function calculatePeriodPeakForDay(
  summary: DailyPowerSummary,
  startMinutes: number,
  endMinutes: number,
  crossMidnight = false
): DailyPeriodPeakPoint {
  const filtered = summary.dataPoints.filter((p) =>
    isMinuteInSpecialPeriod(p.timeMinutes, startMinutes, endMinutes, crossMidnight)
  );

  const points = filtered.length > 0 ? filtered : summary.dataPoints;

  let maxCkt2 = 0;
  let timeCkt2 = '--:--';
  let maxCkt3 = 0;
  let timeCkt3 = '--:--';
  let maxNkt = 0;
  let timeNkt = '--:--';
  let maxOil = 0;
  let timeOil = '--:--';
  let maxTotal = 0;
  let timeTotal = '--:--';

  points.forEach((p) => {
    if (p.kmaCircuit2 > maxCkt2) {
      maxCkt2 = p.kmaCircuit2;
      timeCkt2 = p.time;
    }
    if (p.kmbCircuit3 > maxCkt3) {
      maxCkt3 = p.kmbCircuit3;
      timeCkt3 = p.time;
    }
    if (p.knaNkt > maxNkt) {
      maxNkt = p.knaNkt;
      timeNkt = p.time;
    }
    if (p.knaOilFilled > maxOil) {
      maxOil = p.knaOilFilled;
      timeOil = p.time;
    }
    if (p.totalPower > maxTotal) {
      maxTotal = p.totalPower;
      timeTotal = p.time;
    }
  });

  return {
    dateKey: summary.dateKey,
    formattedDate: summary.formattedDate,
    day: summary.day,
    month: summary.month,
    year: summary.year,
    peakCircuit2: Number(maxCkt2.toFixed(2)),
    timeCircuit2: timeCkt2,
    peakCircuit3: Number(maxCkt3.toFixed(2)),
    timeCircuit3: timeCkt3,
    peakKnaNkt: Number(maxNkt.toFixed(2)),
    timeKnaNkt: timeNkt,
    peakKnaOil: Number(maxOil.toFixed(2)),
    timeKnaOil: timeOil,
    peakTotal: Number(maxTotal.toFixed(2)),
    timeTotal: timeTotal,
    sampleCount: points.length,
  };
}

// Identify substation code (KNA, KMA, KMB) from path, folder name, or file name
export function detectSubstationFromPath(fileName: string, folderPath?: string, subfolderName?: string): SubstationCode | null {
  const combined = `${folderPath || ''}/${subfolderName || ''}/${fileName}`.toUpperCase();

  // Explicit check with word boundaries or standard delimiters
  if (/\bKMA\b|[\/_]KMA[\/_.]/.test(combined)) return 'KMA';
  if (/\bKMB\b|[\/_]KMB[\/_.]/.test(combined)) return 'KMB';
  if (/\bKNA\b|[\/_]KNA[\/_.]/.test(combined)) return 'KNA';

  // Fallback substring checks
  if (combined.includes('KMA')) return 'KMA';
  if (combined.includes('KMB')) return 'KMB';
  if (combined.includes('KNA')) return 'KNA';

  return null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Extract Year, Month, Date from file name and directory path
export function extractDateFromPowerFileName(
  fileName: string,
  folderPath = '',
  subfolderName = ''
): {
  year: number;
  month: number;
  day: number;
  yearKey: string;
  monthKey: string;
  dateKey: string;
  formattedDate: string;
  timestamp: number;
} {
  const cleanFn = fileName.replace(/\.csv$/i, '').trim();

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  // --------------------------------------------------------------------------
  // PRIORITY 1: Extract complete date from fileName alone (avoid folder collision)
  // --------------------------------------------------------------------------
  // 1A0. Explicit Target Folder 2 pattern: e.g. KMB_03.2026_22.03.2026.csv or KMA_03-2026_05-03-2026.csv
  // where a month.year prefix precedes the full DD.MM.YYYY date
  const fnPrefixedDmy = cleanFn.match(
    /(?:0?[1-9]|1[0-2])[-_/.](?:20[2-3][0-9]|256[7-9]|257[0-9])[-_ .]+(0?[1-9]|[12][0-9]|3[01])([._/-])(0?[1-9]|1[0-2])\2(20[2-3][0-9]|256[7-9]|257[0-9])(?:[^\d]|$)/
  );
  if (fnPrefixedDmy) {
    day = parseInt(fnPrefixedDmy[1], 10);
    month = parseInt(fnPrefixedDmy[3], 10);
    const rawYr = parseInt(fnPrefixedDmy[4], 10);
    year = rawYr > 2500 ? rawYr - 543 : rawYr;
  }

  // 1A. Standard DMY with matching separator (\2): DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY, DD_MM_YYYY
  // Checked before ISO or with strict separator matching so "03.2026_05.03.2026" matches "05.03.2026" and NOT "2026_05.03"
  if (!year) {
    const fnDmyStrict = cleanFn.match(
      /(?:^|[^\d])(0?[1-9]|[12][0-9]|3[01])([-_/.])(0?[1-9]|1[0-2])\2(20[2-3][0-9])(?:[^\d]|$)/
    );
    if (fnDmyStrict) {
      day = parseInt(fnDmyStrict[1], 10);
      month = parseInt(fnDmyStrict[3], 10);
      year = parseInt(fnDmyStrict[4], 10);
    }
  }

  // 1B. Standard ISO with matching separator (\2): YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD
  if (!year) {
    const fnIso = cleanFn.match(
      /(?:^|[^\d])(20[2-3][0-9])([-_/.])(0?[1-9]|1[0-2])\2(0?[1-9]|[12][0-9]|3[01])(?:[^\d]|$)/
    );
    if (fnIso) {
      year = parseInt(fnIso[1], 10);
      month = parseInt(fnIso[3], 10);
      day = parseInt(fnIso[4], 10);
    }
  }

  // 1C. Thai Buddhist Era ISO with matching separator (\2): 2568-MM-DD or 2569-MM-DD
  if (!year) {
    const fnThaiIso = cleanFn.match(
      /(?:^|[^\d])(256[7-9]|257[0-9])([-_/.])(0?[1-9]|1[0-2])\2(0?[1-9]|[12][0-9]|3[01])(?:[^\d]|$)/
    );
    if (fnThaiIso) {
      year = parseInt(fnThaiIso[1], 10) - 543;
      month = parseInt(fnThaiIso[3], 10);
      day = parseInt(fnThaiIso[4], 10);
    }
  }

  // 1D. Thai Buddhist Era DMY with matching separator (\2): DD-MM-2568 or DD.MM.2569
  if (!year) {
    const fnThaiDmy = cleanFn.match(
      /(?:^|[^\d])(0?[1-9]|[12][0-9]|3[01])([-_/.])(0?[1-9]|1[0-2])\2(256[7-9]|257[0-9])(?:[^\d]|$)/
    );
    if (fnThaiDmy) {
      day = parseInt(fnThaiDmy[1], 10);
      month = parseInt(fnThaiDmy[3], 10);
      year = parseInt(fnThaiDmy[4], 10) - 543;
    }
  }

  // 1E. Compact 8-digit YYYYMMDD in fileName (e.g., KMB_20251204 or 20251204)
  if (!year) {
    const fnYmdCompact = cleanFn.match(/(?:^|[^\d])(20[2-3][0-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?:[^\d]|$)/);
    if (fnYmdCompact) {
      year = parseInt(fnYmdCompact[1], 10);
      month = parseInt(fnYmdCompact[2], 10);
      day = parseInt(fnYmdCompact[3], 10);
    }
  }

  // 1F. Compact 8-digit DDMMYYYY in fileName (e.g., 04122025 or KMB_04122025)
  if (!year) {
    const fnDmyCompact = cleanFn.match(/(?:^|[^\d])(0[1-9]|[12][0-9]|3[01])(0[1-9]|1[0-2])(20[2-3][0-9])(?:[^\d]|$)/);
    if (fnDmyCompact) {
      day = parseInt(fnDmyCompact[1], 10);
      month = parseInt(fnDmyCompact[2], 10);
      year = parseInt(fnDmyCompact[3], 10);
    }
  }

  // 1F2. Compact 7-digit DMMYYYY in fileName (e.g. 9072025 -> Day 9, July 2025)
  if (!year) {
    const fnDmy7 = cleanFn.match(/(?:^|[^\d])([1-9])(0[1-9]|1[0-2])(20[2-3][0-9])(?:[^\d]|$)/);
    if (fnDmy7) {
      day = parseInt(fnDmy7[1], 10);
      month = parseInt(fnDmy7[2], 10);
      year = parseInt(fnDmy7[3], 10);
    }
  }

  // 1F3. Compact 7-digit DDMYYYY in fileName (e.g. 1572025 -> Day 15, July 2025)
  if (!year) {
    const fnDmy7_2 = cleanFn.match(/(?:^|[^\d])(0[1-9]|[12][0-9]|3[01])([1-9])(20[2-3][0-9])(?:[^\d]|$)/);
    if (fnDmy7_2) {
      day = parseInt(fnDmy7_2[1], 10);
      month = parseInt(fnDmy7_2[2], 10);
      year = parseInt(fnDmy7_2[3], 10);
    }
  }

  // 1G. Compact Thai 8-digit: 25681204
  if (!year) {
    const fnThaiCompact = cleanFn.match(/(?:^|[^\d])(256[7-9]|257[0-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?:[^\d]|$)/);
    if (fnThaiCompact) {
      year = parseInt(fnThaiCompact[1], 10) - 543;
      month = parseInt(fnThaiCompact[2], 10);
      day = parseInt(fnThaiCompact[3], 10);
    }
  }

  // 1H. English Named Month in fileName: (e.g. 04Dec2025, 4-Dec-2025, Dec04_2025)
  if (!year) {
    const fnDmyNamed = cleanFn.match(/(?:^|[^\w])(0?[1-9]|[12][0-9]|3[01])[-_ .]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ .]*(20[2-3][0-9])(?:[^\w]|$)/i);
    if (fnDmyNamed) {
      day = parseInt(fnDmyNamed[1], 10);
      const mStr = fnDmyNamed[2].toLowerCase().slice(0, 3);
      month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mStr) + 1;
      year = parseInt(fnDmyNamed[3], 10);
    }
  }

  if (!year) {
    const fnMdyNamed = cleanFn.match(/(?:^|[^\w])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ .]*(0?[1-9]|[12][0-9]|3[01])[-_ .]*(20[2-3][0-9])(?:[^\w]|$)/i);
    if (fnMdyNamed) {
      const mStr = fnMdyNamed[1].toLowerCase().slice(0, 3);
      month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mStr) + 1;
      day = parseInt(fnMdyNamed[2], 10);
      year = parseInt(fnMdyNamed[3], 10);
    }
  }

  // 1I. Compact 6-digit YYMMDD (e.g. 250709 for 2025-07-09)
  if (!year) {
    const fn6DigitYmd = cleanFn.match(/(?:^|[^\d])(2[4-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?:[^\d]|$)/);
    if (fn6DigitYmd) {
      year = 2000 + parseInt(fn6DigitYmd[1], 10);
      month = parseInt(fn6DigitYmd[2], 10);
      day = parseInt(fn6DigitYmd[3], 10);
    }
  }

  // 1J. Standard DMY with 2-digit year: DD-MM-YY, DD_MM_YY, DD.MM.YY (e.g. 09-07-25, 9-7-25)
  if (!year) {
    const fnDmy2Digit = cleanFn.match(/(?:^|[^\d])(0?[1-9]|[12][0-9]|3[01])[-_/.](0?[1-9]|1[0-2])[-_/.](2[4-9])(?:[^\d]|$)/);
    if (fnDmy2Digit) {
      day = parseInt(fnDmy2Digit[1], 10);
      month = parseInt(fnDmy2Digit[2], 10);
      year = 2000 + parseInt(fnDmy2Digit[3], 10);
    }
  }

  // 1K. Compact 6-digit DDMMYY (e.g. 090725 for 09-07-2025)
  if (!year) {
    const fn6DigitDmy = cleanFn.match(/(?:^|[^\d])(0[1-9]|[12][0-9]|3[01])(0[1-9]|1[0-2])(2[4-9])(?:[^\d]|$)/);
    if (fn6DigitDmy) {
      day = parseInt(fn6DigitDmy[1], 10);
      month = parseInt(fn6DigitDmy[2], 10);
      year = 2000 + parseInt(fn6DigitDmy[3], 10);
    }
  }

  // 1K2. Compact 5-digit DMMYY (e.g. 90725 -> Day 9, July 2025)
  if (!year) {
    const fn5DigitDmy = cleanFn.match(/(?:^|[^\d])([1-9])(0[1-9]|1[0-2])(2[4-9])(?:[^\d]|$)/);
    if (fn5DigitDmy) {
      day = parseInt(fn5DigitDmy[1], 10);
      month = parseInt(fn5DigitDmy[2], 10);
      year = 2000 + parseInt(fn5DigitDmy[3], 10);
    }
  }

  // 1L. Standard YMD with 2-digit year: YY-MM-DD, YY_MM_DD (e.g. 25-07-09)
  if (!year) {
    const fnYmd2Digit = cleanFn.match(/(?:^|[^\d])(2[4-9])[-_/.](0?[1-9]|1[0-2])[-_/.](0?[1-9]|[12][0-9]|3[01])(?:[^\d]|$)/);
    if (fnYmd2Digit) {
      year = 2000 + parseInt(fnYmd2Digit[1], 10);
      month = parseInt(fnYmd2Digit[2], 10);
      day = parseInt(fnYmd2Digit[3], 10);
    }
  }

  // --------------------------------------------------------------------------
  // PRIORITY 2: Folder Hierarchy (e.g. KMB/2025/12/04.csv or KMB/2025-12/04.csv)
  // --------------------------------------------------------------------------
  if (!year || !month || !day) {
    // Check if fileName has the day: e.g. "04.csv", "4.csv", "day_04.csv", "KMB_04.csv"
    const dayMatch =
      cleanFn.match(/\b(?:day[-_ ]*)?(0?[1-9]|[12][0-9]|3[01])\b/i) ||
      cleanFn.match(/(?:^|[-_ ])(0?[1-9]|[12][0-9]|3[01])(?:[-_ ]|$)/);
    if (dayMatch) {
      day = parseInt(dayMatch[1], 10);
    }

    // Check year from folderPath
    const folderCombined = `${folderPath} ${subfolderName}`;
    const yrMatch =
      folderCombined.match(/\b(20[2-3][0-9])\b/) ||
      folderCombined.match(/\b(256[7-9]|257[0-9])\b/);
    if (yrMatch) {
      const rawYr = parseInt(yrMatch[1], 10);
      year = rawYr > 2500 ? rawYr - 543 : rawYr;
    }

    // Check month from folderPath: named month first, then numeric month segment
    const moNamedMatch = folderCombined.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
    if (moNamedMatch) {
      const mStr = moNamedMatch[1].toLowerCase().slice(0, 3);
      month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mStr) + 1;
    } else {
      // Look for year-month pattern in folder path e.g. 2025/12 or 2025-12 or 2025_12
      const ymPathMatch = folderCombined.match(/(?:20[2-3][0-9]|256[7-9]|257[0-9])[/\\_.-](0?[1-9]|1[0-2])\b/);
      if (ymPathMatch) {
        month = parseInt(ymPathMatch[1], 10);
      } else if (subfolderName && /^(0?[1-9]|1[0-2])$/.test(subfolderName.trim())) {
        month = parseInt(subfolderName.trim(), 10);
      }
    }
  }

  // --------------------------------------------------------------------------
  // PRIORITY 3: Full string scan fallback (if year, month, or day still missing)
  // --------------------------------------------------------------------------
  if (!year || !month || !day) {
    const fullText = `${folderPath}/${subfolderName}/${fileName}`;
    const isoFull = fullText.match(/\b(20[2-3][0-9])[-_/.](0?[1-9]|1[0-2])[-_/.](0?[1-9]|[12][0-9]|3[01])\b/);
    if (isoFull) {
      year = year || parseInt(isoFull[1], 10);
      month = month || parseInt(isoFull[2], 10);
      day = day || parseInt(isoFull[3], 10);
    }
  }

  // Final fallback safety
  const finalYear = year && year >= 2000 && year <= 2099 ? year : 2026;
  const finalMonth = month && month >= 1 && month <= 12 ? month : 8;
  const finalDay = day && day >= 1 && day <= 31 ? day : 1;

  const yearKey = String(finalYear);
  const monthKey = String(finalMonth).padStart(2, '0');
  const dayKey = String(finalDay).padStart(2, '0');
  const dateKey = `${yearKey}-${monthKey}-${dayKey}`;

  const monthLabel = MONTH_NAMES[finalMonth - 1] || 'Month';
  const formattedDate = `${dayKey} ${monthLabel.slice(0, 3)} ${yearKey}`;
  const timestamp = new Date(finalYear, finalMonth - 1, finalDay).getTime();

  return {
    year: finalYear,
    month: finalMonth,
    day: finalDay,
    yearKey,
    monthKey,
    dateKey,
    formattedDate,
    timestamp,
  };
}

// Instant offline metadata scanner for Power Consumption CSV files
// Supports optional forcedSubstation when scanning directly inside target folder "KMB", "KMA", or "KNA"
export function scanPowerFilesMetadataOnly(
  files: Array<{
    id: string;
    name: string;
    mimeType?: string;
    folderPath?: string;
    subfolderName?: string;
    modifiedTime?: string;
  }>,
  forcedSubstation?: SubstationCode
): PowerScannedFileMeta[] {
  const results: PowerScannedFileMeta[] = [];

  for (const file of files) {
    const nameLower = file.name.toLowerCase();
    const isCsvName =
      nameLower.endsWith('.csv') ||
      nameLower.endsWith('.tsv') ||
      nameLower.endsWith('.txt');
    const isCsvMime =
      file.mimeType === 'text/csv' ||
      file.mimeType === 'text/tab-separated-values' ||
      file.mimeType === 'application/vnd.ms-excel' ||
      file.mimeType === 'application/vnd.google-apps.spreadsheet';
    const isCandidate = isCsvName || isCsvMime || Boolean(forcedSubstation);
    if (!isCandidate) continue;

    const substation =
      forcedSubstation ||
      detectSubstationFromPath(file.name, file.folderPath, file.subfolderName);
    if (!substation) continue; // Only keep files associated with KMB, KMA, or KNA

    const dateMeta = extractDateFromPowerFileName(file.name, file.folderPath, file.subfolderName);

    results.push({
      fileId: file.id,
      fileName: file.name,
      substation,
      subfolderName: file.subfolderName,
      folderPath: file.folderPath || substation,
      modifiedTime: file.modifiedTime,
      dateMeta,
    });
  }

  // Sort chronologically
  results.sort((a, b) => a.dateMeta.timestamp - b.dateMeta.timestamp);
  return results;
}

// Letter to 0-based column index converter (A -> 0, B -> 1, ..., G -> 6, I -> 8, N -> 13, P -> 15)
export function columnLetterToIndex(letter: string): number {
  let index = 0;
  const clean = letter.toUpperCase().trim();
  for (let i = 0; i < clean.length; i++) {
    index = index * 26 + (clean.charCodeAt(i) - 64);
  }
  return index - 1;
}

export interface ParsedCsvRow {
  timeStr: string; // "00:00"
  timeMinutes: number; // 0..1439
  rawValues: Record<string, number>;
}

// Parse CSV content line by line with strict column and sign rules for the 4 circuits:
// 1. 115 kV Circuit #3 -> Target folder "KMB", Column G (index 6) "03YB01", minus value -> convert to positive
// 2. 115 kV Circuit #2 -> Target folder "KMA", Column I (index 8) "04YB01", minus value -> convert to positive
// 3. 33 kV NKT Circuit -> Target folder "KNA", Column N (index 13) "07WB01", already positive -> do not convert
// 4. 33 kV Oil filled Circuit -> Target folder "KNA", Column P (index 15) "10WB01", already positive -> do not convert
export function parseDailyCsvContent(
  csvText: string,
  substation: SubstationCode
): { rows: ParsedCsvRow[]; rowCount: number } {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], rowCount: 0 };
  }

  // Detect delimiter from initial lines (comma, semicolon, or tab)
  const sample = lines.slice(0, 5).join('\n');
  const semiCount = (sample.match(/;/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const commaCount = (sample.match(/,/g) || []).length;
  const delimiter = semiCount > commaCount && semiCount > tabCount ? ';' : tabCount > commaCount ? '\t' : ',';

  const tokenizeLine = (l: string) => l.split(delimiter).map((t) => t.trim().replace(/^["']|["']$/g, ''));

  let headerLineIndex = -1;
  let timeColIdx = 0;
  const targetColIndices: Record<string, number> = {};

  // Strict primary column indices based on the 4-circuit specification:
  // KMB: Column G (index 6) -> "03YB01"
  // KMA: Column I (index 8) -> "04YB01"
  // KNA: Column N (index 13) -> "07WB01", Column P (index 15) -> "10WB01"
  if (substation === 'KMB') {
    targetColIndices['03YB01'] = columnLetterToIndex('G'); // 6
  } else if (substation === 'KMA') {
    targetColIndices['04YB01'] = columnLetterToIndex('I'); // 8
  } else if (substation === 'KNA') {
    targetColIndices['07WB01'] = columnLetterToIndex('N'); // 13
    targetColIndices['10WB01'] = columnLetterToIndex('P'); // 15
  }

  // Inspect first 10 rows for header row & exact tag verification
  // Also inspect the next row (units sub-header: KV, MW, MVAR, A) so when a feeder tag like 03YB01
  // appears across multiple columns (e.g. Col F = KV, Col G = MW, Col H = MVAR), we lock onto the MW column!
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const rawTokens = tokenizeLine(lines[i]);
    const nextTokens = i + 1 < lines.length ? tokenizeLine(lines[i + 1]) : [];
    let foundAnyTag = false;

    const isMwColumn = (colIdx: number) => {
      const unitToken = (nextTokens[colIdx] || '').trim().toUpperCase();
      return unitToken === 'MW' || unitToken.startsWith('MW ') || unitToken.includes('(MW)');
    };

    rawTokens.forEach((token, colIdx) => {
      const upper = token.toUpperCase();
      if (upper === 'TIME' || upper === 'CLOCK' || upper.includes('TIME')) {
        timeColIdx = colIdx;
      }
      if (substation === 'KMB' && upper.includes('03YB01')) {
        // Prefer Column G (6) or the column explicitly labeled MW in the unit row
        if (
          colIdx === 6 ||
          (isMwColumn(colIdx) && !isMwColumn(targetColIndices['03YB01'])) ||
          !rawTokens[6]?.toUpperCase().includes('03YB01')
        ) {
          if (colIdx === 6 || isMwColumn(colIdx) || !rawTokens[targetColIndices['03YB01']]?.toUpperCase().includes('03YB01')) {
            targetColIndices['03YB01'] = colIdx;
          }
        }
        foundAnyTag = true;
      }
      if (substation === 'KMA' && upper.includes('04YB01')) {
        // Prefer Column I (8) or the column explicitly labeled MW in the unit row
        if (
          colIdx === 8 ||
          (isMwColumn(colIdx) && !isMwColumn(targetColIndices['04YB01'])) ||
          !rawTokens[8]?.toUpperCase().includes('04YB01')
        ) {
          if (colIdx === 8 || isMwColumn(colIdx) || !rawTokens[targetColIndices['04YB01']]?.toUpperCase().includes('04YB01')) {
            targetColIndices['04YB01'] = colIdx;
          }
        }
        foundAnyTag = true;
      }
      if (substation === 'KNA') {
        if (upper.includes('07WB01')) {
          if (
            colIdx === 13 ||
            (isMwColumn(colIdx) && !isMwColumn(targetColIndices['07WB01'])) ||
            !rawTokens[13]?.toUpperCase().includes('07WB01')
          ) {
            if (colIdx === 13 || isMwColumn(colIdx) || !rawTokens[targetColIndices['07WB01']]?.toUpperCase().includes('07WB01')) {
              targetColIndices['07WB01'] = colIdx;
            }
          }
          foundAnyTag = true;
        }
        if (upper.includes('10WB01')) {
          if (
            colIdx === 15 ||
            (isMwColumn(colIdx) && !isMwColumn(targetColIndices['10WB01'])) ||
            !rawTokens[15]?.toUpperCase().includes('10WB01')
          ) {
            if (colIdx === 15 || isMwColumn(colIdx) || !rawTokens[targetColIndices['10WB01']]?.toUpperCase().includes('10WB01')) {
              targetColIndices['10WB01'] = colIdx;
            }
          }
          foundAnyTag = true;
        }
      }
    });

    if (foundAnyTag) {
      headerLineIndex = i;
      break;
    }
  }

  const startDataRow = headerLineIndex !== -1 ? headerLineIndex + 1 : 1;
  const rows: ParsedCsvRow[] = [];
  let validDataRowCounter = 0;

  for (let i = startDataRow; i < lines.length; i++) {
    const rawLine = lines[i];
    const tokens = tokenizeLine(rawLine);
    if (tokens.length < 2) continue;

    // Check if this row is a secondary sub-header row (e.g. units "MW", "kV") by verifying at least one target column or time column is numeric/time
    const hasNumericTarget = Object.values(targetColIndices).some((colIdx) => {
      if (colIdx >= tokens.length) return false;
      const cleaned = tokens[colIdx].replace(/[^\d.-]/g, '');
      return cleaned.length > 0 && !isNaN(parseFloat(cleaned));
    });
    if (!hasNumericTarget && i < startDataRow + 4) {
      continue;
    }

    // Extract time: check timeColIdx first, then fallback to scanning first 3 columns for HH:mm or HH.mm
    let timeStr = tokens[timeColIdx] || '';
    let timeMatch = timeStr.match(/(?:^|\s|[T_-])([0-2]?[0-9])[:.]([0-5][0-9])/);
    if (!timeMatch) {
      for (let c = 0; c < Math.min(3, tokens.length); c++) {
        const m = (tokens[c] || '').match(/(?:^|\s|[T_-])([0-2]?[0-9])[:.]([0-5][0-9])/);
        if (m) {
          timeMatch = m;
          break;
        }
      }
    }

    let timeMinutes = 0;
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      // If 24:00 or if 00:00 appears again at the end of the 24-hour file (after >= 80 rows),
      // treat as end-of-day 24:00 (1440 min) so it does NOT overwrite start-of-day 00:00 (0 min)
      if ((h === 24 && m === 0) || (h === 0 && m === 0 && rows.length >= 80)) {
        timeMinutes = 1440;
        timeStr = '24:00';
      } else {
        timeMinutes = h * 60 + m;
        timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    } else {
      // Fallback assuming 15-min intervals (96 points per day)
      const estimatedMinutes = (validDataRowCounter * 15) % 1440;
      const h = Math.floor(estimatedMinutes / 60);
      const m = estimatedMinutes % 60;
      timeMinutes = estimatedMinutes;
      timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    validDataRowCounter++;

    const rawValues: Record<string, number> = {};

    // Extract column values with strict sign conversion rules:
    // - KMB (Col G "03YB01") & KMA (Col I "04YB01"): minus value -> convert to positive
    // - KNA (Col N "07WB01" & Col P "10WB01"): already positive -> do NOT convert
    for (const [tag, colIdx] of Object.entries(targetColIndices)) {
      if (colIdx < tokens.length) {
        const strVal = tokens[colIdx].replace(/[^\d.-]/g, '');
        let num = parseFloat(strVal);
        if (isNaN(num)) num = 0;

        if (substation === 'KMB' || substation === 'KMA') {
          // Minus value in CSV -> convert to positive value
          num = num < 0 ? -num : Math.abs(num);
        }
        // For substation === 'KNA' (07WB01 & 10WB01), it is already a positive value; do not convert it.

        rawValues[tag] = num;
      } else {
        rawValues[tag] = 0;
      }
    }

    rows.push({
      timeStr,
      timeMinutes,
      rawValues,
    });
  }

  return { rows, rowCount: rows.length };
}

// Compute metrics for a circuit over the 24-hour sequence
function computeCircuitMetrics(values: Array<{ time: string; mw: number }>): CircuitMetrics {
  if (values.length === 0) {
    return { peakMW: 0, peakTime: '00:00', minMW: 0, avgMW: 0, totalEnergyMWh: 0 };
  }

  let peakMW = -Infinity;
  let peakTime = '00:00';
  let minMW = Infinity;
  let sumMW = 0;

  values.forEach((v) => {
    if (v.mw > peakMW) {
      peakMW = v.mw;
      peakTime = v.time;
    }
    if (v.mw < minMW) {
      minMW = v.mw;
    }
    sumMW += v.mw;
  });

  const avgMW = sumMW / values.length;
  // If sampled at 15-min intervals (0.25h), energy is sum(MW * deltaT)
  // Approximate deltaT based on number of samples spanning 24h
  const deltaHours = 24 / Math.max(1, values.length);
  const totalEnergyMWh = sumMW * deltaHours;

  return {
    peakMW: Math.max(0, peakMW),
    peakTime,
    minMW: minMW === Infinity ? 0 : Math.max(0, minMW),
    avgMW: Math.max(0, avgMW),
    totalEnergyMWh: Math.max(0, totalEnergyMWh),
  };
}

// Merge substation rows (KMA, KMB, KNA) into synchronized daily points
export function mergeDailySubstations(
  dateKey: string,
  substationData: {
    KMA?: ParsedCsvRow[];
    KMB?: ParsedCsvRow[];
    KNA?: ParsedCsvRow[];
  },
  fileInfos: Array<{ fileId?: string; fileName: string; substation: SubstationCode; rowCount: number }>,
  isSyntheticSample?: boolean
): DailyPowerSummary {
  const dateMeta = extractDateFromPowerFileName(dateKey);

  // Canonical 96 intervals of 15 minutes (00:00 to 23:45)
  // Or synchronize based on present timestamps
  const timeMap = new Map<string, {
    time: string;
    timeMinutes: number;
    kmaCircuit2: number;
    kmbCircuit3: number;
    knaNkt: number;
    knaOilFilled: number;
  }>();

  // Initialize all 96 standard 15-minute slots for a continuous 24h curve
  for (let m = 0; m < 1440; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const timeKey = `${hh}:${mm}`;
    timeMap.set(timeKey, {
      time: timeKey,
      timeMinutes: m,
      kmaCircuit2: 0,
      kmbCircuit3: 0,
      knaNkt: 0,
      knaOilFilled: 0,
    });
  }

  // Helper to find the matching standard 15-minute slot (exact or within +/- 7 minutes)
  const getOrFindSlot = (timeStr: string, timeMinutes: number) => {
    let slot = timeMap.get(timeStr);
    if (!slot) {
      const roundedMin = Math.min(1425, Math.max(0, Math.round(timeMinutes / 15) * 15));
      const hh = String(Math.floor(roundedMin / 60)).padStart(2, '0');
      const mm = String(roundedMin % 60).padStart(2, '0');
      slot = timeMap.get(`${hh}:${mm}`);
    }
    return slot;
  };

  // Populate KMA: 115 kV Ckt #2 (04YB01)
  if (substationData.KMA && substationData.KMA.length > 0) {
    substationData.KMA.forEach((r) => {
      const existing = getOrFindSlot(r.timeStr, r.timeMinutes);
      const val = r.rawValues['04YB01'] ?? 0;
      if (existing) {
        existing.kmaCircuit2 = existing.kmaCircuit2 > 0 ? Math.max(existing.kmaCircuit2, val) : val;
      } else {
        timeMap.set(r.timeStr, {
          time: r.timeStr,
          timeMinutes: r.timeMinutes,
          kmaCircuit2: val,
          kmbCircuit3: 0,
          knaNkt: 0,
          knaOilFilled: 0,
        });
      }
    });
  }

  // Populate KMB: 115 kV Ckt #3 (03YB01)
  if (substationData.KMB && substationData.KMB.length > 0) {
    substationData.KMB.forEach((r) => {
      const existing = getOrFindSlot(r.timeStr, r.timeMinutes);
      const val = r.rawValues['03YB01'] ?? 0;
      if (existing) {
        existing.kmbCircuit3 = existing.kmbCircuit3 > 0 ? Math.max(existing.kmbCircuit3, val) : val;
      } else {
        timeMap.set(r.timeStr, {
          time: r.timeStr,
          timeMinutes: r.timeMinutes,
          kmaCircuit2: 0,
          kmbCircuit3: val,
          knaNkt: 0,
          knaOilFilled: 0,
        });
      }
    });
  }

  // Populate KNA: 33 kV NKT (07WB01) & 33 kV Oil Filled (10WB01)
  if (substationData.KNA && substationData.KNA.length > 0) {
    substationData.KNA.forEach((r) => {
      const existing = getOrFindSlot(r.timeStr, r.timeMinutes);
      const valNkt = r.rawValues['07WB01'] ?? 0;
      const valOil = r.rawValues['10WB01'] ?? 0;
      if (existing) {
        existing.knaNkt = existing.knaNkt > 0 ? Math.max(existing.knaNkt, valNkt) : valNkt;
        existing.knaOilFilled = existing.knaOilFilled > 0 ? Math.max(existing.knaOilFilled, valOil) : valOil;
      } else {
        timeMap.set(r.timeStr, {
          time: r.timeStr,
          timeMinutes: r.timeMinutes,
          kmaCircuit2: 0,
          kmbCircuit3: 0,
          knaNkt: valNkt,
          knaOilFilled: valOil,
        });
      }
    });
  }

  // Convert to sorted array of data points
  const dataPoints: DailyPowerDataPoint[] = Array.from(timeMap.values())
    .sort((a, b) => a.timeMinutes - b.timeMinutes)
    .map((p) => {
      const totalPower = Number((p.kmaCircuit2 + p.kmbCircuit3 + p.knaNkt + p.knaOilFilled).toFixed(2));
      return {
        ...p,
        totalPower,
      };
    });

  // Calculate metrics for each of the 4 circuits
  const metrics115_2 = computeCircuitMetrics(dataPoints.map((p) => ({ time: p.time, mw: p.kmaCircuit2 })));
  const metrics115_3 = computeCircuitMetrics(dataPoints.map((p) => ({ time: p.time, mw: p.kmbCircuit3 })));
  const metrics33_nkt = computeCircuitMetrics(dataPoints.map((p) => ({ time: p.time, mw: p.knaNkt })));
  const metrics33_oil = computeCircuitMetrics(dataPoints.map((p) => ({ time: p.time, mw: p.knaOilFilled })));
  const metricsTotal = computeCircuitMetrics(dataPoints.map((p) => ({ time: p.time, mw: p.totalPower })));

  const inferredSynthetic =
    Boolean(isSyntheticSample) ||
    (fileInfos.length > 0 &&
      fileInfos.every(
        (f) => f.fileId && (String(f.fileId).startsWith('sample-') || String(f.fileId).startsWith('fallback-'))
      ));

  return {
    dateKey,
    formattedDate: dateMeta.formattedDate,
    year: dateMeta.year,
    month: dateMeta.month,
    day: dateMeta.day,
    dataPoints,
    metrics: {
      circuit_115kv_2: metrics115_2,
      circuit_115kv_3: metrics115_3,
      circuit_33kv_nkt: metrics33_nkt,
      circuit_33kv_oil: metrics33_oil,
      total: metricsTotal,
    },
    substationsLoaded: {
      KMA: Boolean(substationData.KMA && substationData.KMA.length > 0),
      KMB: Boolean(substationData.KMB && substationData.KMB.length > 0),
      KNA: Boolean(substationData.KNA && substationData.KNA.length > 0),
    },
    filesLoaded: fileInfos,
    isSyntheticSample: inferredSynthetic,
  };
}

// Generate Realistic Sample Dataset for immediate testing (KNA, KMA, KMB for several days)
export function generateSamplePowerDataset(): Array<{
  fileId: string;
  fileName: string;
  substation: SubstationCode;
  subfolderName: string;
  folderPath: string;
  content: string;
  dateMeta: ReturnType<typeof extractDateFromPowerFileName>;
}> {
  const result: Array<{
    fileId: string;
    fileName: string;
    substation: SubstationCode;
    subfolderName: string;
    folderPath: string;
    content: string;
    dateMeta: ReturnType<typeof extractDateFromPowerFileName>;
  }> = [];

  // Generate sample days spanning March 01, 2026 through September 14, 2026
  const sampleDays = [
    // March 2026
    { day: 1, month: 3, year: 2026, dateStr: '01032026', isoDate: '2026-03-01', folder: 'March_2026', factor: 0.95 },
    { day: 8, month: 3, year: 2026, dateStr: '08032026', isoDate: '2026-03-08', folder: 'March_2026', factor: 0.98 },
    { day: 15, month: 3, year: 2026, dateStr: '15032026', isoDate: '2026-03-15', folder: 'March_2026', factor: 1.02 },
    { day: 22, month: 3, year: 2026, dateStr: '22032026', isoDate: '2026-03-22', folder: 'March_2026', factor: 0.96 },
    { day: 29, month: 3, year: 2026, dateStr: '29032026', isoDate: '2026-03-29', folder: 'March_2026', factor: 1.01 },
    // April 2026
    { day: 5, month: 4, year: 2026, dateStr: '05042026', isoDate: '2026-04-05', folder: 'April_2026', factor: 1.05 },
    { day: 12, month: 4, year: 2026, dateStr: '12042026', isoDate: '2026-04-12', folder: 'April_2026', factor: 1.10 },
    { day: 19, month: 4, year: 2026, dateStr: '19042026', isoDate: '2026-04-19', folder: 'April_2026', factor: 1.08 },
    { day: 26, month: 4, year: 2026, dateStr: '26042026', isoDate: '2026-04-26', folder: 'April_2026', factor: 1.04 },
    // May 2026
    { day: 3, month: 5, year: 2026, dateStr: '03052026', isoDate: '2026-05-03', folder: 'May_2026', factor: 1.03 },
    { day: 10, month: 5, year: 2026, dateStr: '10052026', isoDate: '2026-05-10', folder: 'May_2026', factor: 1.07 },
    { day: 17, month: 5, year: 2026, dateStr: '17052026', isoDate: '2026-05-17', folder: 'May_2026', factor: 1.09 },
    { day: 24, month: 5, year: 2026, dateStr: '24052026', isoDate: '2026-05-24', folder: 'May_2026', factor: 1.06 },
    { day: 31, month: 5, year: 2026, dateStr: '31052026', isoDate: '2026-05-31', folder: 'May_2026', factor: 1.02 },
    // June 2026
    { day: 7, month: 6, year: 2026, dateStr: '07062026', isoDate: '2026-06-07', folder: 'June_2026', factor: 1.00 },
    { day: 14, month: 6, year: 2026, dateStr: '14062026', isoDate: '2026-06-14', folder: 'June_2026', factor: 1.04 },
    { day: 21, month: 6, year: 2026, dateStr: '21062026', isoDate: '2026-06-21', folder: 'June_2026', factor: 1.08 },
    { day: 28, month: 6, year: 2026, dateStr: '28062026', isoDate: '2026-06-28', folder: 'June_2026', factor: 1.01 },
    // July 2026
    { day: 5, month: 7, year: 2026, dateStr: '05072026', isoDate: '2026-07-05', folder: 'July_2026', factor: 1.06 },
    { day: 12, month: 7, year: 2026, dateStr: '12072026', isoDate: '2026-07-12', folder: 'July_2026', factor: 1.11 },
    { day: 19, month: 7, year: 2026, dateStr: '19072026', isoDate: '2026-07-19', folder: 'July_2026', factor: 1.07 },
    { day: 26, month: 7, year: 2026, dateStr: '26072026', isoDate: '2026-07-26', folder: 'July_2026', factor: 1.05 },
    // August 2026 (consecutive full week + weeks)
    { day: 1, month: 8, year: 2026, dateStr: '01082026', isoDate: '2026-08-01', folder: 'August_2026', factor: 1.05 },
    { day: 2, month: 8, year: 2026, dateStr: '02082026', isoDate: '2026-08-02', folder: 'August_2026', factor: 1.08 },
    { day: 3, month: 8, year: 2026, dateStr: '03082026', isoDate: '2026-08-03', folder: 'August_2026', factor: 0.94 },
    { day: 4, month: 8, year: 2026, dateStr: '04082026', isoDate: '2026-08-04', folder: 'August_2026', factor: 0.96 },
    { day: 5, month: 8, year: 2026, dateStr: '05082026', isoDate: '2026-08-05', folder: 'August_2026', factor: 1.00 },
    { day: 6, month: 8, year: 2026, dateStr: '06082026', isoDate: '2026-08-06', folder: 'August_2026', factor: 1.03 },
    { day: 7, month: 8, year: 2026, dateStr: '07082026', isoDate: '2026-08-07', folder: 'August_2026', factor: 1.07 },
    { day: 8, month: 8, year: 2026, dateStr: '08082026', isoDate: '2026-08-08', folder: 'August_2026', factor: 1.14 },
    { day: 15, month: 8, year: 2026, dateStr: '15082026', isoDate: '2026-08-15', folder: 'August_2026', factor: 1.10 },
    { day: 22, month: 8, year: 2026, dateStr: '22082026', isoDate: '2026-08-22', folder: 'August_2026', factor: 1.06 },
    { day: 29, month: 8, year: 2026, dateStr: '29082026', isoDate: '2026-08-29', folder: 'August_2026', factor: 1.04 },
    // September 2026
    { day: 1, month: 9, year: 2026, dateStr: '01092026', isoDate: '2026-09-01', folder: 'September_2026', factor: 1.02 },
    { day: 7, month: 9, year: 2026, dateStr: '07092026', isoDate: '2026-09-07', folder: 'September_2026', factor: 1.05 },
    { day: 14, month: 9, year: 2026, dateStr: '14092026', isoDate: '2026-09-14', folder: 'September_2026', factor: 1.12 },
  ];

  sampleDays.forEach((d) => {
    const factor = d.factor;
    // 1. KMA: 115 kV Ckt #2 (Column I "04YB01", negative numbers in raw SCADA export)
    const kmaFileName = `KMA_${d.dateStr}.csv`;
    const kmaLines = [
      'Date,Time,01YB01,02YB01,02YB02,03YB01,03YB02,04YB00,04YB01,05YB01,Notes',
    ];
    for (let m = 0; m < 1440; m += 15) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const hourFract = m / 60;
      // Typical daily transmission curve: base 22 MW, afternoon peak ~48 MW, evening peak ~54 MW
      const diurnal1 = Math.sin(((hourFract - 6) / 24) * 2 * Math.PI);
      const diurnal2 = Math.sin(((hourFract - 18) / 12) * Math.PI);
      const baseLoad = (24.5 + Math.max(0, diurnal1) * 18.0 + Math.max(0, diurnal2) * 12.0) * factor;
      const noise = Math.sin(m * 0.3 + d.day) * 1.2 + Math.cos(m * 0.7) * 0.8;
      const val = Number((baseLoad + noise).toFixed(2));
      // In KMA raw file, power is negative indicating export from mainland to island:
      const rawNegativeVal = (-val).toFixed(2);
      kmaLines.push(`${d.isoDate},${hh}:${mm},115.2,114.9,0.0,0.0,0.0,0.0,${rawNegativeVal},0.0,OK`);
    }

    const kmaMeta = extractDateFromPowerFileName(kmaFileName, `Power_Submarine_Cables/KMA/${d.folder}`, d.folder);
    result.push({
      fileId: `sample-kma-${d.dateStr}`,
      fileName: kmaFileName,
      substation: 'KMA',
      subfolderName: d.folder,
      folderPath: `Power_Submarine_Cables/KMA/${d.folder}`,
      content: kmaLines.join('\n'),
      dateMeta: kmaMeta,
    });

    // 2. KMB: 115 kV Ckt #3 (Column G "03YB01", negative numbers in raw SCADA export)
    const kmbFileName = `KMB_${d.dateStr}.csv`;
    const kmbLines = [
      'Date,Time,01YB01,02YB01,02YB02,02YB03,03YB01,04YB01,05YB01',
    ];
    for (let m = 0; m < 1440; m += 15) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const hourFract = m / 60;
      // 115 kV Circuit #3: parallel circuit sharing mainland transmission, ~22 to 50 MW
      const diurnal1 = Math.sin(((hourFract - 7) / 24) * 2 * Math.PI);
      const diurnal2 = Math.sin(((hourFract - 19) / 12) * Math.PI);
      const baseLoad = (22.0 + Math.max(0, diurnal1) * 16.5 + Math.max(0, diurnal2) * 11.5) * factor;
      const noise = (Math.cos(m * 0.25 + d.day) * 1.1 + Math.sin(m * 0.5) * 0.7);
      const val = Number((baseLoad + noise).toFixed(2));
      // In KMB raw file, power is negative indicating export from mainland to island:
      const rawNegativeVal = (-val).toFixed(2);
      kmbLines.push(`${d.isoDate},${hh}:${mm},115.1,114.8,0.0,0.0,${rawNegativeVal},0.0,OK`);
    }

    const kmbMeta = extractDateFromPowerFileName(kmbFileName, `Power_Submarine_Cables/KMB/${d.folder}`, d.folder);
    result.push({
      fileId: `sample-kmb-${d.dateStr}`,
      fileName: kmbFileName,
      substation: 'KMB',
      subfolderName: d.folder,
      folderPath: `Power_Submarine_Cables/KMB/${d.folder}`,
      content: kmbLines.join('\n'),
      dateMeta: kmbMeta,
    });

    // 3. KNA: 33 kV NKT (Column N "07WB01", index 13) and 33 kV Oil Filled (Column P "10WB01", index 15)
    const knaFileName = `KNA_${d.dateStr}.csv`;
    const knaLines = [
      'Date,Time,01WB01,02WB01,03WB01,04WB01,05WB01,06WB01,06WB02,06WB03,06WB04,06WB05,06WB06,07WB01,08WB01,10WB01',
    ];
    for (let m = 0; m < 1440; m += 15) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const hourFract = m / 60;

      // 33 kV NKT circuit: base 6.5 MW, peak ~14.8 MW
      const nktLoad = (6.5 + Math.max(0, Math.sin(((hourFract - 8) / 24) * 2 * Math.PI)) * 7.2) * factor + (Math.sin(m * 0.4 + d.day) * 0.4);
      const valNkt = Number(Math.max(1.0, nktLoad).toFixed(2));

      // 33 kV Oil Filled circuit: base 5.0 MW, peak ~11.5 MW
      const oilLoad = (4.8 + Math.max(0, Math.sin(((hourFract - 10) / 24) * 2 * Math.PI)) * 5.8) * factor + (Math.cos(m * 0.35 + d.day) * 0.35);
      const valOil = Number(Math.max(0.8, oilLoad).toFixed(2));

      // Pad columns:
      // Index 0: Date
      // Index 1: Time
      // Col C..M (2..12): intermediate tags
      // Col N (index 13): 07WB01 (NKT)
      // Col O (index 14): dummy
      // Col P (index 15): 10WB01 (Oil Filled)
      knaLines.push(
        `${d.isoDate},${hh}:${mm},33.1,33.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,${valNkt.toFixed(2)},0.0,${valOil.toFixed(2)}`
      );
    }

    const knaMeta = extractDateFromPowerFileName(knaFileName, `Power_Submarine_Cables/KNA/${d.folder}`, d.folder);
    result.push({
      fileId: `sample-kna-${d.dateStr}`,
      fileName: knaFileName,
      substation: 'KNA',
      subfolderName: d.folder,
      folderPath: `Power_Submarine_Cables/KNA/${d.folder}`,
      content: knaLines.join('\n'),
      dateMeta: knaMeta,
    });
  });

  return result;
}

// Find the maximum power consumption in the 1-hour period of the fiber temperature reading (e.g. 14:02 -> 14:00 - 15:00)
export function resolveOperatingPowerAtTime(
  dailySummary: DailyPowerSummary | null | undefined,
  timeInputOrHour?: { hour?: number; minute?: number; timeStr?: string; useDailyPeak?: boolean } | number,
  optionalMinute?: number
): {
  hasPowerData: boolean;
  pCkt3MW: number;
  pCkt2MW: number;
  p33NktMW: number;
  p33OfMW: number;
  tComp: number;
  matchedTimeLabel: string;
  p115kVCkt3MW: number;
  p115kVCkt2MW: number;
  p115kVCkt1MW: number;
  p33kVPhaNganMW: number;
  tcomp: number;
  matchedTimestamp: string | null;
} {
  if (!dailySummary || !dailySummary.dataPoints || dailySummary.dataPoints.length === 0) {
    return {
      hasPowerData: false,
      pCkt3MW: 0,
      pCkt2MW: 0,
      p33NktMW: 0,
      p33OfMW: 0,
      tComp: 0,
      matchedTimeLabel: 'No Power Data for Date',
      p115kVCkt3MW: 0,
      p115kVCkt2MW: 0,
      p115kVCkt1MW: 0,
      p33kVPhaNganMW: 0,
      tcomp: 0,
      matchedTimestamp: null,
    };
  }

  let targetHour: number | null = null;

  if (typeof timeInputOrHour === 'number') {
    if (!isNaN(timeInputOrHour)) {
      targetHour = Math.max(0, Math.min(23, Math.floor(timeInputOrHour)));
    }
  } else if (timeInputOrHour && !timeInputOrHour.useDailyPeak) {
    if (typeof timeInputOrHour.hour === 'number' && !isNaN(timeInputOrHour.hour)) {
      targetHour = Math.max(0, Math.min(23, Math.floor(timeInputOrHour.hour)));
    } else if (timeInputOrHour.timeStr) {
      const match = timeInputOrHour.timeStr.match(/(\d{1,2})[:.](\d{2})/);
      if (match) {
        targetHour = Math.max(0, Math.min(23, parseInt(match[1], 10)));
      }
    }
  }

  // Filter data points within the 1-hour period [HH:00, (HH+1):00]
  // e.g. if Tf is recorded at 14:02, select maximum power during 14:00 - 15:00
  let windowPoints: DailyPowerDataPoint[] = [];
  let hourWindowLabel = 'Daily Peak (24h)';

  if (targetHour !== null) {
    const startMin = targetHour * 60;
    const endMin = (targetHour + 1) * 60;
    windowPoints = dailySummary.dataPoints.filter(
      (pt) => pt.timeMinutes >= startMin && pt.timeMinutes <= endMin
    );
    const hStartStr = `${String(targetHour).padStart(2, '0')}:00`;
    const hEndStr = `${String(targetHour + 1).padStart(2, '0')}:00`;
    hourWindowLabel = `${hStartStr} - ${hEndStr}`;
  }

  if (windowPoints.length === 0) {
    windowPoints = dailySummary.dataPoints;
  }

  let maxCkt3 = -Infinity;
  let maxCkt2 = -Infinity;
  let max33Nkt = -Infinity;
  let max33Of = -Infinity;
  let peakPoint: DailyPowerDataPoint = windowPoints[0];

  for (const pt of windowPoints) {
    if (pt.kmbCircuit3 > maxCkt3) {
      maxCkt3 = pt.kmbCircuit3;
      peakPoint = pt;
    }
    if (pt.kmaCircuit2 > maxCkt2) {
      maxCkt2 = pt.kmaCircuit2;
    }
    if (pt.knaNkt > max33Nkt) {
      max33Nkt = pt.knaNkt;
    }
    if (pt.knaOilFilled > max33Of) {
      max33Of = pt.knaOilFilled;
    }
  }

  const pCkt3MW = Number((maxCkt3 === -Infinity ? 0 : maxCkt3).toFixed(2));
  const pCkt2MW = Number((maxCkt2 === -Infinity ? 0 : maxCkt2).toFixed(2));
  const p33NktMW = Number((max33Nkt === -Infinity ? 0 : max33Nkt).toFixed(2));
  const p33OfMW = Number((max33Of === -Infinity ? 0 : max33Of).toFixed(2));

  const matchedLabel = targetHour !== null ? `${hourWindowLabel} (Max @ ${peakPoint.time})` : peakPoint.time;

  return {
    hasPowerData: true,
    pCkt3MW,
    pCkt2MW,
    p33NktMW,
    p33OfMW,
    tComp: 0,
    matchedTimeLabel: matchedLabel,
    p115kVCkt3MW: pCkt3MW,
    p115kVCkt2MW: pCkt2MW,
    p115kVCkt1MW: p33NktMW,
    p33kVPhaNganMW: p33OfMW,
    tcomp: 0,
    matchedTimestamp: matchedLabel,
  };
}

// Build a deterministic 24-hour DailyPowerSummary for any selected dateKey when external CSVs are not yet synced
const fallbackPowerSummaryCache = new Map<string, DailyPowerSummary>();

export function buildFallbackDailyPowerSummary(dateKey: string): DailyPowerSummary {
  const cleanDate = dateKey && dateKey !== 'all' ? dateKey : '2026-08-01';
  if (fallbackPowerSummaryCache.has(cleanDate)) {
    return fallbackPowerSummaryCache.get(cleanDate)!;
  }

  const parts = cleanDate.split('-');
  const dayNum = parseInt(parts[2] || '1', 10) || 1;
  const factor = 0.96 + ((dayNum % 7) * 0.015);

  const kmaRows: ReturnType<typeof parseDailyCsvContent>['rows'] = [];
  const kmbRows: ReturnType<typeof parseDailyCsvContent>['rows'] = [];
  const knaRows: ReturnType<typeof parseDailyCsvContent>['rows'] = [];

  for (let m = 0; m < 1440; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const time = `${hh}:${mm}`;
    const hourFract = m / 60;

    const diurnal1 = Math.sin(((hourFract - 7) / 24) * 2 * Math.PI);
    const diurnal2 = Math.sin(((hourFract - 19) / 12) * Math.PI);

    const ckt3Load = Number(
      ((22.0 + Math.max(0, diurnal1) * 16.5 + Math.max(0, diurnal2) * 11.5) * factor +
        Math.cos(m * 0.25 + dayNum) * 1.1).toFixed(2)
    );
    const ckt2Load = Number(
      ((24.0 + Math.max(0, diurnal1) * 18.0 + Math.max(0, diurnal2) * 12.0) * factor +
        Math.sin(m * 0.3 + dayNum) * 1.0).toFixed(2)
    );
    const nktLoad = Number(
      Math.max(1.0, (6.5 + Math.max(0, Math.sin(((hourFract - 8) / 24) * 2 * Math.PI)) * 7.2) * factor).toFixed(2)
    );
    const oilLoad = Number(
      Math.max(0.8, (4.8 + Math.max(0, Math.sin(((hourFract - 10) / 24) * 2 * Math.PI)) * 5.8) * factor).toFixed(2)
    );

    kmbRows.push({ timeStr: time, timeMinutes: m, rawValues: { '03YB01': ckt3Load } });
    kmaRows.push({ timeStr: time, timeMinutes: m, rawValues: { '04YB01': ckt2Load } });
    knaRows.push({ timeStr: time, timeMinutes: m, rawValues: { '07WB01': nktLoad, '10WB01': oilLoad } });
  }

  const summary = mergeDailySubstations(
    cleanDate,
    { KMA: kmaRows, KMB: kmbRows, KNA: knaRows },
    [
      { fileId: `fallback-kmb-${cleanDate}`, fileName: `KMB_${cleanDate}.csv`, substation: 'KMB', rowCount: kmbRows.length },
      { fileId: `fallback-kma-${cleanDate}`, fileName: `KMA_${cleanDate}.csv`, substation: 'KMA', rowCount: kmaRows.length },
      { fileId: `fallback-kna-${cleanDate}`, fileName: `KNA_${cleanDate}.csv`, substation: 'KNA', rowCount: knaRows.length },
    ],
    true
  );

  fallbackPowerSummaryCache.set(cleanDate, summary);
  return summary;
}

// Deterministic cache of synthetic sample data points by dateKey to detect and strip mock-up values
// from any previously exported or in-memory database rows
let cachedSyntheticSamplePointsByDate: Map<string, DailyPowerDataPoint[]> | null = null;

function getSyntheticSamplePointsMap(): Map<string, DailyPowerDataPoint[]> {
  if (cachedSyntheticSamplePointsByDate) return cachedSyntheticSamplePointsByDate;
  const map = new Map<string, DailyPowerDataPoint[]>();
  const samples = generateSamplePowerDataset();
  const grouped = new Map<string, typeof samples>();
  for (const s of samples) {
    const dKey = s.dateMeta.dateKey;
    const list = grouped.get(dKey) || [];
    list.push(s);
    grouped.set(dKey, list);
  }
  grouped.forEach((filesForDate, dKey) => {
    const substationData: {
      KMA?: ParsedCsvRow[];
      KMB?: ParsedCsvRow[];
      KNA?: ParsedCsvRow[];
    } = {};
    const fileInfos: Array<{ fileId?: string; fileName: string; substation: SubstationCode; rowCount: number }> = [];
    filesForDate.forEach((f) => {
      const parsed = parseDailyCsvContent(f.content, f.substation);
      substationData[f.substation] = parsed.rows;
      fileInfos.push({
        fileId: f.fileId,
        fileName: f.fileName,
        substation: f.substation,
        rowCount: parsed.rowCount,
      });
    });
    const summary = mergeDailySubstations(dKey, substationData, fileInfos, true);
    map.set(dKey, summary.dataPoints);
  });
  cachedSyntheticSamplePointsByDate = map;
  return map;
}

/**
 * Deterministically detects if a 4-circuit power flow tuple (ckt3, ckt2, nkt, oil)
 * came from either `generateSamplePowerDataset()` or `buildFallbackDailyPowerSummary()`.
 * For example, on 2026-03-22 at 06:36 (06:30 slot), the mock-up tuple (23.81, 25.85, 6.59, 4.66)
 * is immediately identified as synthetic so it can be replaced with the actual Target Folder 2 value (47.92 MW).
 */
export function isSyntheticPowerValues(
  dateKey: string,
  ckt3: number | '' | null | undefined,
  ckt2?: number | '' | null | undefined,
  nkt?: number | '' | null | undefined,
  oil?: number | '' | null | undefined
): boolean {
  if (typeof ckt3 !== 'number' || !isFinite(ckt3) || ckt3 <= 0) return false;

  const sampleMap = getSyntheticSamplePointsMap();
  const candidatePointLists: DailyPowerDataPoint[][] = [];

  if (dateKey && sampleMap.has(dateKey)) {
    candidatePointLists.push(sampleMap.get(dateKey)!);
  }
  if (dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const fb = buildFallbackDailyPowerSummary(dateKey);
    candidatePointLists.push(fb.dataPoints);
  }

  const hasCkt2 = typeof ckt2 === 'number' && isFinite(ckt2) && ckt2 > 0;
  const hasNkt = typeof nkt === 'number' && isFinite(nkt) && nkt > 0;
  const hasOil = typeof oil === 'number' && isFinite(oil) && oil > 0;

  for (const pts of candidatePointLists) {
    for (const pt of pts) {
      if (Math.abs(pt.kmbCircuit3 - ckt3) <= 0.02) {
        if (hasCkt2 && Math.abs(pt.kmaCircuit2 - (ckt2 as number)) <= 0.02) {
          if (!hasNkt || Math.abs(pt.knaNkt - (nkt as number)) <= 0.02) {
            if (!hasOil || Math.abs(pt.knaOilFilled - (oil as number)) <= 0.02) {
              return true;
            }
          }
        } else if (!hasCkt2 && hasNkt && Math.abs(pt.knaNkt - (nkt as number)) <= 0.02) {
          return true;
        }
      }
    }
  }

  // Also check across all 35 sample dates if all 4 circuits match a synthetic sample point
  if (hasCkt2 && hasNkt && hasOil) {
    for (const pts of sampleMap.values()) {
      for (const pt of pts) {
        if (
          Math.abs(pt.kmbCircuit3 - ckt3) <= 0.015 &&
          Math.abs(pt.kmaCircuit2 - (ckt2 as number)) <= 0.015 &&
          Math.abs(pt.knaNkt - (nkt as number)) <= 0.015 &&
          Math.abs(pt.knaOilFilled - (oil as number)) <= 0.015
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks whether a DailyPowerSummary object is a synthetic sample or fallback dataset
 * rather than real SCADA CSV records from Target Folder 2 (KMB, KMA, KNA).
 */
export function isSyntheticPowerSummary(summary?: DailyPowerSummary | null): boolean {
  if (!summary) return false;
  if (summary.isSyntheticSample) return true;
  if (
    summary.filesLoaded &&
    summary.filesLoaded.length > 0 &&
    summary.filesLoaded.some(
      (f: any) =>
        (f.fileId && (String(f.fileId).startsWith('sample-') || String(f.fileId).startsWith('fallback-'))) ||
        /^K(?:MB|MA|NA)_\d{8}\.csv$/i.test(String(f.fileName || '')) ||
        /^K(?:MB|MA|NA)_\d{4}-\d{2}-\d{2}\.csv$/i.test(String(f.fileName || ''))
    )
  ) {
    const dp0 = summary.dataPoints?.[0];
    if (dp0 && isSyntheticPowerValues(summary.dateKey, dp0.kmbCircuit3, dp0.kmaCircuit2, dp0.knaNkt, dp0.knaOilFilled)) {
      return true;
    }
    if (
      summary.filesLoaded.some(
        (f: any) => f.fileId && (String(f.fileId).startsWith('sample-') || String(f.fileId).startsWith('fallback-'))
      )
    ) {
      return true;
    }
  }
  const dpSample = summary.dataPoints?.[0];
  const dpMid = summary.dataPoints?.[26]; // 06:30
  if (
    dpSample &&
    dpMid &&
    isSyntheticPowerValues(summary.dateKey, dpSample.kmbCircuit3, dpSample.kmaCircuit2, dpSample.knaNkt, dpSample.knaOilFilled) &&
    isSyntheticPowerValues(summary.dateKey, dpMid.kmbCircuit3, dpMid.kmaCircuit2, dpMid.knaNkt, dpMid.knaOilFilled)
  ) {
    return true;
  }
  return false;
}



