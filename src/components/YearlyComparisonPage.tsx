import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import {
  Activity,
  Thermometer,
  Zap,
  MapPin,
  SlidersHorizontal,
  Upload,
  Link,
  ExternalLink,
  CheckCircle2,
  Loader2,
  FileSpreadsheet,
  Calendar,
  Minimize2,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Layers,
  Plus,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  THERMAL_ZONE_CRITERIA,
  getThermalZoneInfo,
  evaluateSectionConductorTemp,
} from '../data/cableCircuitStructure';
import {
  MasterSectionPeakRecord,
  parseDatabaseFileOrBuffer,
} from '../services/masterSectionSummary';

interface YearlyComparisonPageProps {
  showNotification: (type: 'success' | 'error', message: string) => void;
}

interface YearlyDayRecord {
  year: string;
  monthDay: string; // "MM-DD"
  month: string; // "MM"
  dateKey: string; // "YYYY-MM-DD"
  tfMax: number;
  tfMin: number;
  tfMean: number;
  tcMax: number;
  tcMin: number;
  tcMean: number;
  pTotalIslandMW: number;
  pCkt3MW: number;
  pCkt2MW: number;
  p33NktMW: number;
  p33OilMW: number;
  dofMax?: number;
  dofMin?: number;
  timestampMax?: string;
  timestampMin?: string;
  sourceFileName?: string;
  zoneName: string;
  zoneColor: string;
}

interface YearStyleConfig {
  year: string;
  color: string;
  secondaryColor: string;
  minColor: string;
  strokeDasharray: string;
  lineStyleLabel: string;
  markerShape: 'circle' | 'triangle' | 'diamond' | 'square' | 'star';
  markerSymbol: string;
  markerLabel: string;
  patternId: string;
  patternLabel: string;
}

const YEAR_VISUAL_STYLES: Omit<YearStyleConfig, 'year'>[] = [
  {
    color: '#dc2626', // Red
    secondaryColor: '#0284c7', // Sky Blue
    minColor: '#0d9488', // Teal
    strokeDasharray: '',
    lineStyleLabel: 'Solid Line (───)',
    markerShape: 'circle',
    markerSymbol: '●',
    markerLabel: 'Circle (●)',
    patternId: 'year-pattern-diagonal',
    patternLabel: 'Diagonal Stripes',
  },
  {
    color: '#2563eb', // Royal Blue
    secondaryColor: '#7c3aed', // Violet
    minColor: '#059669', // Emerald
    strokeDasharray: '8 4',
    lineStyleLabel: 'Dashed Line (─ ─ ─)',
    markerShape: 'triangle',
    markerSymbol: '▲',
    markerLabel: 'Triangle (▲)',
    patternId: 'year-pattern-crosshatch',
    patternLabel: 'Cross-Hatch Grid',
  },
  {
    color: '#d97706', // Amber
    secondaryColor: '#db2777', // Pink
    minColor: '#4f46e5', // Indigo
    strokeDasharray: '3 3',
    lineStyleLabel: 'Dotted Line (∙∙∙∙∙)',
    markerShape: 'diamond',
    markerSymbol: '◆',
    markerLabel: 'Diamond (◆)',
    patternId: 'year-pattern-dots',
    patternLabel: 'Polka Dots',
  },
  {
    color: '#059669', // Emerald
    secondaryColor: '#ea580c', // Orange
    minColor: '#0891b2', // Cyan
    strokeDasharray: '10 4 2 4',
    lineStyleLabel: 'Dash-Dot Line (─∙─∙)',
    markerShape: 'square',
    markerSymbol: '■',
    markerLabel: 'Square (■)',
    patternId: 'year-pattern-horizontal',
    patternLabel: 'Horizontal Stripes',
  },
  {
    color: '#9333ea', // Purple
    secondaryColor: '#e11d48', // Rose
    minColor: '#65a30d', // Lime
    strokeDasharray: '14 5',
    lineStyleLabel: 'Long-Dash Line (── ──)',
    markerShape: 'star',
    markerSymbol: '★',
    markerLabel: 'Star (★)',
    patternId: 'year-pattern-vertical',
    patternLabel: 'Vertical Stripes',
  },
];

const MONTH_OPTIONS = [
  { value: 'ALL', label: 'Full 1-Year Window (Jan – Dec)' },
  { value: '01', label: '01 — January' },
  { value: '02', label: '02 — February' },
  { value: '03', label: '03 — March' },
  { value: '04', label: '04 — April' },
  { value: '05', label: '05 — May' },
  { value: '06', label: '06 — June' },
  { value: '07', label: '07 — July' },
  { value: '08', label: '08 — August' },
  { value: '09', label: '09 — September' },
  { value: '10', label: '10 — October' },
  { value: '11', label: '11 — November' },
  { value: '12', label: '12 — December' },
];

// Custom SVG Scatter Marker Renderer for Chart 3 (Different Marker per Year)
const renderYearScatterShape = (shapeType: YearStyleConfig['markerShape'], fillColor: string) => {
  return (props: any) => {
    const { cx, cy } = props;
    if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) return null;

    switch (shapeType) {
      case 'triangle':
        return (
          <polygon
            points={`${cx},${cy - 7} ${cx - 6.5},${cy + 5.5} ${cx + 6.5},${cy + 5.5}`}
            fill={fillColor}
            stroke="#ffffff"
            strokeWidth={1.5}
          />
        );
      case 'diamond':
        return (
          <polygon
            points={`${cx},${cy - 7.5} ${cx + 7},${cy} ${cx},${cy + 7.5} ${cx - 7},${cy}`}
            fill={fillColor}
            stroke="#ffffff"
            strokeWidth={1.5}
          />
        );
      case 'square':
        return (
          <rect
            x={cx - 5.5}
            y={cy - 5.5}
            width={11}
            height={11}
            fill={fillColor}
            stroke="#ffffff"
            strokeWidth={1.5}
          />
        );
      case 'star': {
        const outerR = 7.5;
        const innerR = 3.3;
        const pts: string[] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (Math.PI / 5) * i - Math.PI / 2;
          pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
        }
        return (
          <polygon
            points={pts.join(' ')}
            fill={fillColor}
            stroke="#ffffff"
            strokeWidth={1.2}
          />
        );
      }
      case 'circle':
      default:
        return (
          <circle
            cx={cx}
            cy={cy}
            r={6}
            fill={fillColor}
            stroke="#ffffff"
            strokeWidth={1.5}
          />
        );
    }
  };
};

const MONTH_SHORT_NAMES: Record<string, string> = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
};

const DAYS_IN_MONTH: Record<string, number> = {
  '01': 31,
  '02': 29,
  '03': 31,
  '04': 30,
  '05': 31,
  '06': 30,
  '07': 31,
  '08': 31,
  '09': 30,
  '10': 31,
  '11': 30,
  '12': 31,
};

const ALL_CALENDAR_MONTH_DAYS: string[] = (() => {
  const list: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const maxD = DAYS_IN_MONTH[mm] || 30;
    for (let d = 1; d <= maxD; d++) {
      const dd = String(d).padStart(2, '0');
      list.push(`${mm}-${dd}`);
    }
  }
  return list;
})();

function formatMonthDayLabel(md: string): string {
  const [mm, dd] = md.split('-');
  const mName = MONTH_SHORT_NAMES[mm] || mm;
  return `${mName} ${dd} (${md})`;
}

export const YearlyComparisonPage: React.FC<YearlyComparisonPageProps> = ({
  showNotification,
}) => {
  // 1. Isolated Database Source State (Uploaded CSV/XLSX file(s) or Shared URL Link ONLY)
  const [csvDatabaseUrl, setCsvDatabaseUrl] = useState<string>('');
  const [isLoadingSharedUrl, setIsLoadingSharedUrl] = useState<boolean>(false);
  const [csvDatabaseSource, setCsvDatabaseSource] = useState<{
    filenames: string[];
    totalRecords: number;
    dateKeys: string[];
    years: string[];
    parsedMap: Map<string, MasterSectionPeakRecord>;
  } | null>(null);

  // 2. Isolated Display Filters (Completely independent from Pages 1–6)
  const [selectedSectionId, setSelectedSectionId] = useState<string>('2.3');
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState<string>('all');
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('ALL');
  const [startMonthDay, setStartMonthDay] = useState<string>('');
  const [endMonthDay, setEndMonthDay] = useState<string>('');
  const [enabledYears, setEnabledYears] = useState<string[]>([]);
  const [horizontalAxisScale, setHorizontalAxisScale] = useState<'uploaded' | 'full_1year'>(
    'uploaded'
  );

  // 3. Chart Selection & Curve Display Toggles
  const [selectedChartTab, setSelectedChartTab] = useState<
    'thermal' | 'power' | 'physics' | 'points'
  >('thermal');
  const [thermalMetricFilter, setThermalMetricFilter] = useState<
    'all' | 'tcMax' | 'tfMax' | 'tfMin'
  >('all');
  const [powerCircuitFilter, setPowerCircuitFilter] = useState<
    'all' | 'total' | 'ckt3' | 'ckt2' | 'nkt33' | 'oil33'
  >('all');
  const [isMatrixMinimized, setIsMatrixMinimized] = useState<boolean>(false);
  const [selectedSamplingPointId, setSelectedSamplingPointId] = useState<string>('ALL');

  // Active Section & Discrete Sampling Points
  const activeSection = useMemo(() => {
    return (
      CIRCUIT_3_SECTIONS.find((s) => s.sectionId === selectedSectionId) || CIRCUIT_3_SECTIONS[0]
    );
  }, [selectedSectionId]);

  const activeSectionPoints = useMemo(() => {
    return CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
      if (p.sectionId !== activeSection.sectionId) return false;
      if (selectedPhaseFilter !== 'all') {
        if (p.cableCategory === 'land' && p.phase !== selectedPhaseFilter) return false;
      }
      return true;
    });
  }, [activeSection, selectedPhaseFilter]);

  // Helper to merge new parsed database records into csvDatabaseSource
  const mergeIntoDatabaseSource = (
    fileName: string,
    newSections: Record<string, MasterSectionPeakRecord>,
    newDateKeys: string[],
    replaceExisting: boolean
  ) => {
    setCsvDatabaseSource((prev) => {
      const nextMap =
        replaceExisting || !prev
          ? new Map<string, MasterSectionPeakRecord>()
          : new Map(prev.parsedMap);
      Object.entries(newSections).forEach(([k, v]) => {
        nextMap.set(k, v);
      });

      const dateSet = new Set<string>(replaceExisting || !prev ? [] : prev.dateKeys);
      for (const dk of newDateKeys) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
          dateSet.add(dk);
        }
      }
      nextMap.forEach((_rec, mapKey) => {
        const match = mapKey.match(/(\d{4}-\d{2}-\d{2})$/);
        if (match) {
          dateSet.add(match[1]);
        }
      });

      const yearSet = new Set<string>();
      dateSet.forEach((dk) => {
        yearSet.add(dk.slice(0, 4));
      });

      const sortedDates = Array.from(dateSet).sort();
      const sortedYears = Array.from(yearSet).sort();
      const filenames =
        replaceExisting || !prev
          ? [fileName]
          : prev.filenames.includes(fileName)
          ? prev.filenames
          : [...prev.filenames, fileName];

      // Initialize month-day range & enabled years
      const monthDays = Array.from(new Set(sortedDates.map((d) => d.slice(5)))).sort();
      if (monthDays.length > 0) {
        setStartMonthDay(monthDays[0]);
        setEndMonthDay(monthDays[monthDays.length - 1]);
      }
      setEnabledYears(sortedYears);

      return {
        filenames,
        totalRecords: nextMap.size,
        dateKeys: sortedDates,
        years: sortedYears,
        parsedMap: nextMap,
      };
    });
  };

  // Load Database from Shared Google Drive URL
  const handleLoadDatabaseFromUrl = async (mergeMode = false) => {
    const urlToFetch = csvDatabaseUrl.trim();
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

      let parsed = parseDatabaseFileOrBuffer(bytes);
      if (parsed.totalRecords === 0) {
        const textDecoder = new TextDecoder('utf-8');
        const textStr = textDecoder.decode(bytes);
        parsed = parseDatabaseFileOrBuffer(textStr);
      }

      if (parsed.totalRecords === 0) {
        throw new Error('No valid section records found in the shared URL file.');
      }

      mergeIntoDatabaseSource(
        data.fileName || 'Google_Drive_Database.xlsx',
        parsed.sections,
        parsed.dateKeys,
        !mergeMode
      );

      showNotification(
        'success',
        `${mergeMode ? 'Merged' : 'Loaded'} Database from URL: ${
          data.fileName || 'Shared Database'
        } (${parsed.totalRecords} records across ${parsed.dateKeys.length} days)`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to load database from URL');
    } finally {
      setIsLoadingSharedUrl(false);
    }
  };

  // Upload 1 or multiple CSV / XLSX Database files (supports merging multiple yearly files)
  const handleUploadDatabaseFiles = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mergeMode = false
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesArray: File[] = Array.from(fileList);
    let combinedSections: Record<string, MasterSectionPeakRecord> = {};
    const combinedDates: string[] = [];
    const loadedNames: string[] = [];
    let totalParsed = 0;

    for (const file of filesArray) {
      try {
        const buffer = await file.arrayBuffer();
        let parsed = parseDatabaseFileOrBuffer(buffer);
        if (parsed.totalRecords === 0) {
          const text = await file.text();
          parsed = parseDatabaseFileOrBuffer(text);
        }
        if (parsed.totalRecords > 0) {
          combinedSections = { ...combinedSections, ...parsed.sections };
          combinedDates.push(...parsed.dateKeys);
          loadedNames.push(file.name);
          totalParsed += parsed.totalRecords;
        }
      } catch (err) {
        console.warn(`Failed reading ${file.name}:`, err);
      }
    }

    e.target.value = '';

    if (totalParsed === 0) {
      showNotification('error', 'Could not parse valid section database records from selected file(s).');
      return;
    }

    mergeIntoDatabaseSource(loadedNames.join(', '), combinedSections, combinedDates, !mergeMode);
    showNotification(
      'success',
      `${mergeMode ? 'Added & Merged' : 'Loaded'} ${loadedNames.length} Database File(s): ${loadedNames.join(
        ', '
      )} (${totalParsed} section-day records ready for Yearly Comparison)`
    );
  };

  // Available Calendar Month-Days ("MM-DD") within the 1-Year Time Frame
  const availableMonthDays = useMemo(() => {
    if (!csvDatabaseSource || csvDatabaseSource.dateKeys.length === 0) return [] as string[];
    const mdSet = new Set<string>();
    for (const dKey of csvDatabaseSource.dateKeys) {
      const md = dKey.slice(5); // "MM-DD"
      if (selectedMonthFilter !== 'ALL' && md.slice(0, 2) !== selectedMonthFilter) {
        continue;
      }
      mdSet.add(md);
    }
    return Array.from(mdSet).sort();
  }, [csvDatabaseSource, selectedMonthFilter]);

  // Keep startMonthDay / endMonthDay valid when month filter changes
  React.useEffect(() => {
    if (availableMonthDays.length > 0) {
      if (!startMonthDay || !availableMonthDays.includes(startMonthDay)) {
        setStartMonthDay(availableMonthDays[0]);
      }
      if (!endMonthDay || !availableMonthDays.includes(endMonthDay)) {
        setEndMonthDay(availableMonthDays[availableMonthDays.length - 1]);
      }
    }
  }, [availableMonthDays]);

  // Assign visual style config (line dash style, scatter marker shape, bar fill pattern) to each Year
  const yearConfigs = useMemo<YearStyleConfig[]>(() => {
    const years = csvDatabaseSource?.years || [];
    return years.map((yr, idx) => {
      const base = YEAR_VISUAL_STYLES[idx % YEAR_VISUAL_STYLES.length];
      return {
        year: yr,
        ...base,
      };
    });
  }, [csvDatabaseSource?.years]);

  const activeYearConfigs = useMemo(() => {
    return yearConfigs.filter((yc) => enabledYears.includes(yc.year));
  }, [yearConfigs, enabledYears]);

  // Build Multi-Year 1-Year Timeframe Series (Aligned by Calendar "MM-DD")
  const {
    recordsByYear,
    alignedCalendarSeries,
    scatterByYear,
    multiYearPointsBreakdown,
    yearSummaryStats,
  } = useMemo(() => {
    if (!csvDatabaseSource || csvDatabaseSource.dateKeys.length === 0) {
      return {
        recordsByYear: new Map<string, YearlyDayRecord[]>(),
        alignedCalendarSeries: [] as any[],
        scatterByYear: new Map<string, any[]>(),
        multiYearPointsBreakdown: [] as any[],
        yearSummaryStats: [] as Array<{
          year: string;
          daysCount: number;
          peakTc: number;
          peakTf: number;
          minTf: number;
          peakDate: string;
          peakTotalMW: number;
          peakCkt3MW: number;
          style: YearStyleConfig;
        }>,
      };
    }

    const effStartMD =
      horizontalAxisScale === 'full_1year'
        ? selectedMonthFilter === 'ALL'
          ? '01-01'
          : `${selectedMonthFilter}-01`
        : startMonthDay || availableMonthDays[0] || '01-01';
    const effEndMD =
      horizontalAxisScale === 'full_1year'
        ? selectedMonthFilter === 'ALL'
          ? '12-31'
          : `${selectedMonthFilter}-${String(DAYS_IN_MONTH[selectedMonthFilter] || 31).padStart(
              2,
              '0'
            )}`
        : endMonthDay || availableMonthDays[availableMonthDays.length - 1] || '12-31';

    const byYear = new Map<string, YearlyDayRecord[]>();
    const byMonthDay = new Map<string, Record<string, any>>();

    // Pre-seed the 1-Year Horizontal Axis when Full 1-Year Calendar Axis mode is selected
    // (or seed all calendar days within effStartMD..effEndMD, max 1 year = 366 days)
    if (horizontalAxisScale === 'full_1year') {
      for (const md of ALL_CALENDAR_MONTH_DAYS) {
        if (selectedMonthFilter !== 'ALL' && md.slice(0, 2) !== selectedMonthFilter) continue;
        if (md < effStartMD || md > effEndMD) continue;
        byMonthDay.set(md, {
          monthDay: md,
          label: formatMonthDayLabel(md),
          rawByYear: {} as Record<string, YearlyDayRecord>,
        });
      }
    }

    for (const dateKey of csvDatabaseSource.dateKeys) {
      const year = dateKey.slice(0, 4);
      const monthDay = dateKey.slice(5); // "MM-DD" (strictly within 1-Year Calendar 01-01 to 12-31)
      const month = dateKey.slice(5, 7);

      if (!enabledYears.includes(year)) continue;
      if (selectedMonthFilter !== 'ALL' && month !== selectedMonthFilter) continue;
      if (effStartMD && monthDay < effStartMD) continue;
      if (effEndMD && monthDay > effEndMD) continue;

      // Resolve record strictly from uploaded CSV/XLSX or URL database
      let csvPeak: MasterSectionPeakRecord | undefined;
      if (activeSection.category === 'land') {
        if (
          selectedPhaseFilter === 'A' ||
          selectedPhaseFilter === 'B' ||
          selectedPhaseFilter === 'C'
        ) {
          csvPeak =
            csvDatabaseSource.parsedMap.get(
              `${activeSection.sectionId}_${selectedPhaseFilter}_${dateKey}`
            ) || csvDatabaseSource.parsedMap.get(`${activeSection.sectionId}_${dateKey}`);
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

      const tfMax = Number(csvPeak.maxTf.toFixed(2));
      const tfMin = Number(csvPeak.minTf.toFixed(2));
      const tfMean = Number(csvPeak.meanTf.toFixed(2));

      const pCkt3MW = Number((csvPeak.pCkt3MaxMW ?? 0).toFixed(2));
      const pCkt2MW = Number((csvPeak.pCkt2MaxMW ?? 0).toFixed(2));
      const p33NktMW = Number((csvPeak.p33NktMaxMW ?? 0).toFixed(2));
      const p33OilMW = Number((csvPeak.p33OilMaxMW ?? 0).toFixed(2));
      const pTotalIslandMW = Number(
        (csvPeak.powerAtMaxMW ?? pCkt3MW + pCkt2MW + p33NktMW + p33OilMW).toFixed(2)
      );

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
        pCkt3MW,
        pCkt2MW,
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

      const dayRec: YearlyDayRecord = {
        year,
        monthDay,
        month,
        dateKey,
        tfMax,
        tfMin,
        tfMean,
        tcMax,
        tcMin,
        tcMean,
        pTotalIslandMW,
        pCkt3MW,
        pCkt2MW,
        p33NktMW,
        p33OilMW,
        dofMax: csvPeak.maxTfDof,
        dofMin: csvPeak.minTfDof,
        timestampMax: csvPeak.maxTimestamp || csvPeak.peakTime,
        timestampMin: csvPeak.minTimestamp,
        sourceFileName: csvPeak.maxFileName || csvPeak.sourceFile,
        zoneName: zone.name,
        zoneColor: zone.color,
      };

      const yrArr = byYear.get(year) || [];
      yrArr.push(dayRec);
      byYear.set(year, yrArr);

      // Populate aligned 1-Year calendar row keyed by "MM-DD" (maximum 1 year: 01-01 to 12-31)
      const row = byMonthDay.get(monthDay) || {
        monthDay,
        label: formatMonthDayLabel(monthDay),
        rawByYear: {} as Record<string, YearlyDayRecord>,
      };
      row[`tcMax_${year}`] = tcMax;
      row[`tfMax_${year}`] = tfMax;
      row[`tfMin_${year}`] = tfMin;
      row[`tcMean_${year}`] = tcMean;
      row[`pTotal_${year}`] = pTotalIslandMW;
      row[`pCkt3_${year}`] = pCkt3MW;
      row[`pCkt2_${year}`] = pCkt2MW;
      row[`p33Nkt_${year}`] = p33NktMW;
      row[`p33Oil_${year}`] = p33OilMW;
      row.rawByYear[year] = dayRec;
      byMonthDay.set(monthDay, row);
    }

    const aligned = Array.from(byMonthDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, val]) => val);

    // Build scatter data per year for Chart 3
    const scatterMap = new Map<string, any[]>();
    const statsList: Array<{
      year: string;
      daysCount: number;
      peakTc: number;
      peakTf: number;
      minTf: number;
      peakDate: string;
      peakTotalMW: number;
      peakCkt3MW: number;
      style: YearStyleConfig;
    }> = [];

    for (const yc of activeYearConfigs) {
      const list = byYear.get(yc.year) || [];
      scatterMap.set(
        yc.year,
        list.map((r) => ({
          ...r,
          markerLabel: yc.markerLabel,
          markerSymbol: yc.markerSymbol,
          yearColor: yc.color,
        }))
      );

      if (list.length > 0) {
        let bestRec = list[0];
        let minTfVal = list[0].tfMin;
        for (const r of list) {
          if (r.tcMax > bestRec.tcMax) bestRec = r;
          if (r.tfMin < minTfVal) minTfVal = r.tfMin;
        }
        statsList.push({
          year: yc.year,
          daysCount: list.length,
          peakTc: bestRec.tcMax,
          peakTf: bestRec.tfMax,
          minTf: minTfVal,
          peakDate: bestRec.dateKey,
          peakTotalMW: bestRec.pTotalIslandMW,
          peakCkt3MW: bestRec.pCkt3MW,
          style: yc,
        });
      }
    }

    // Build Discrete Sampling Points Multi-Year Breakdown for Chart 4 & Table
    // Uses ONLY values from the uploaded CSV/XLSX / URL record (DOF_Max_m, Max_Fiber_Temp_C, DOF_Min_m, Min_Fiber_Temp_C, Mean_Fiber_Temp_C, and Cols O-S power)
    const secDofs = activeSectionPoints.map((p) => p.dof);
    const minSecDof = secDofs.length > 0 ? Math.min(...secDofs) : 0;
    const maxSecDof = secDofs.length > 0 ? Math.max(...secDofs) : 100;
    const secDofSpan = Math.max(1, maxSecDof - minSecDof);

    const ptsBreakdown = activeSectionPoints.map((sp) => {
      const rowObj: Record<string, any> = {
        id: sp.id,
        pos: sp.pos,
        phase: sp.phase,
        dof: sp.dof,
        kp: sp.kpFormatted || `${sp.kp} km`,
        latitude: sp.latitude,
        longitude: sp.longitude,
        byYear: {} as Record<
          string,
          {
            tfMax: number;
            tcMax: number;
            peakDate: string;
            zone: ReturnType<typeof getThermalZoneInfo>;
          }
        >,
      };

      for (const yc of activeYearConfigs) {
        const yrList = byYear.get(yc.year) || [];
        if (yrList.length === 0) continue;

        // Use the period peak record from the uploaded file for that year
        const peakRec = yrList.reduce(
          (best, cur) => (cur.tcMax > best.tcMax ? cur : best),
          yrList[0]
        );

        const distToMax =
          peakRec.dofMax !== undefined ? Math.abs(sp.dof - peakRec.dofMax) : Infinity;
        const distToMin =
          peakRec.dofMin !== undefined ? Math.abs(sp.dof - peakRec.dofMin) : Infinity;
        let ptTf: number;
        if (distToMax <= 3.0) {
          ptTf = peakRec.tfMax;
        } else if (distToMin <= 3.0) {
          ptTf = peakRec.tfMin;
        } else if (peakRec.dofMax !== undefined && peakRec.dofMin !== undefined) {
          // Direct spatial interpolation between uploaded DOF_Max_m, Mean_Fiber_Temp_C, and DOF_Min_m
          const proxMax = Math.max(0, 1 - distToMax / secDofSpan);
          const proxMin = Math.max(0, 1 - distToMin / secDofSpan);
          const weighted =
            peakRec.tfMean +
            (peakRec.tfMax - peakRec.tfMean) * proxMax * 0.5 -
            (peakRec.tfMean - peakRec.tfMin) * proxMin * 0.5;
          ptTf = Number(
            Math.max(peakRec.tfMin, Math.min(peakRec.tfMax, weighted)).toFixed(2)
          );
        } else {
          ptTf = peakRec.tfMean;
        }

        const tcDelta = peakRec.tcMax - peakRec.tfMax;
        const ptTc = Number((ptTf + Math.max(0, tcDelta)).toFixed(2));
        const zone = getThermalZoneInfo(ptTc);

        rowObj[`tcMax_${yc.year}`] = ptTc;
        rowObj[`tfMax_${yc.year}`] = ptTf;
        rowObj.byYear[yc.year] = {
          tfMax: ptTf,
          tcMax: ptTc,
          peakDate: peakRec.dateKey,
          zone,
        };
      }

      return rowObj;
    });

    return {
      recordsByYear: byYear,
      alignedCalendarSeries: aligned,
      scatterByYear: scatterMap,
      multiYearPointsBreakdown: ptsBreakdown,
      yearSummaryStats: statsList,
    };
  }, [
    csvDatabaseSource,
    activeSection,
    activeSectionPoints,
    selectedPhaseFilter,
    selectedMonthFilter,
    startMonthDay,
    endMonthDay,
    availableMonthDays,
    enabledYears,
    activeYearConfigs,
    horizontalAxisScale,
  ]);

  // Custom Tooltips for Charts 1 - 4
  const CustomYearlyThermalTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    return (
      <div className="bg-slate-900/95 text-white p-3.5 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-2 font-sans min-w-[280px] backdrop-blur-md">
        <div className="font-bold border-b border-slate-700 pb-1.5 flex items-center justify-between text-cyan-300">
          <span>Calendar Date (MM-DD): {label}</span>
          <span className="text-[10px] font-mono text-slate-300">
            Sec {activeSection.sectionId}
          </span>
        </div>
        <div className="space-y-2">
          {activeYearConfigs.map((yc) => {
            const rec: YearlyDayRecord | undefined = row.rawByYear?.[yc.year];
            if (!rec) return null;
            return (
              <div
                key={yc.year}
                className="p-2 rounded-lg bg-slate-800/90 border border-slate-700/80 space-y-1"
              >
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1.5" style={{ color: yc.color }}>
                    <span>{yc.markerSymbol}</span>
                    <span>Year {yc.year}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({yc.lineStyleLabel})
                    </span>
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{
                      backgroundColor: `${rec.zoneColor}25`,
                      color: rec.zoneColor,
                    }}
                  >
                    {rec.zoneName}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono pt-0.5">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Tc Max</span>
                    <strong className="text-rose-400">{rec.tcMax.toFixed(2)}°C</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Tf Max</span>
                    <strong className="text-sky-400">{rec.tfMax.toFixed(2)}°C</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Tf Min</span>
                    <strong className="text-teal-400">{rec.tfMin.toFixed(2)}°C</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const CustomYearlyPowerTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    return (
      <div className="bg-slate-900/95 text-white p-3.5 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-2 font-sans min-w-[300px] backdrop-blur-md">
        <div className="font-bold border-b border-slate-700 pb-1.5 flex items-center justify-between text-amber-300">
          <span>Calendar Date (MM-DD): {label}</span>
          <span className="text-[10px] font-mono text-slate-300">Cols O–S (At Max Tf)</span>
        </div>
        <div className="space-y-2">
          {activeYearConfigs.map((yc) => {
            const rec: YearlyDayRecord | undefined = row.rawByYear?.[yc.year];
            if (!rec) return null;
            return (
              <div
                key={yc.year}
                className="p-2 rounded-lg bg-slate-800/90 border border-slate-700/80 space-y-1"
              >
                <div className="flex items-center justify-between font-bold border-b border-slate-700/70 pb-1">
                  <span style={{ color: yc.color }}>
                    Year {yc.year} ({yc.lineStyleLabel})
                  </span>
                  <strong className="font-mono text-indigo-300">
                    Total: {rec.pTotalIslandMW.toFixed(2)} MW
                  </strong>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono pt-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ckt #3 [Col P]:</span>
                    <span className="text-red-400 font-bold">{rec.pCkt3MW.toFixed(1)} MW</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ckt #2 [Col Q]:</span>
                    <span className="text-blue-400 font-bold">{rec.pCkt2MW.toFixed(1)} MW</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">33kV NKT [Col R]:</span>
                    <span className="text-emerald-400 font-bold">{rec.p33NktMW.toFixed(1)} MW</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">33kV Oil [Col S]:</span>
                    <span className="text-amber-400 font-bold">{rec.p33OilMW.toFixed(1)} MW</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const CustomYearlyPhysicsTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0]?.payload;
    if (!data) return null;

    return (
      <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-1.5 font-sans min-w-[250px] backdrop-blur-md">
        <div className="font-bold border-b border-slate-700 pb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5" style={{ color: data.yearColor }}>
            <span className="text-sm">{data.markerSymbol}</span>
            <span>Year {data.year} ({data.dateKey})</span>
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
            {data.markerLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">115kV Ckt #3 Power:</span>
          <strong className="text-amber-400 font-mono text-sm">
            {data.pCkt3MW?.toFixed(2)} MW
          </strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">Max Conductor Temp Tc:</span>
          <strong className="font-mono text-sm font-extrabold text-rose-400">
            {data.tcMax?.toFixed(2)} °C
          </strong>
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] pt-1 border-t border-slate-800">
          <span className="text-slate-400">Daily Max / Min Fiber Tf:</span>
          <span className="text-cyan-400 font-mono font-bold">
            {data.tfMax?.toFixed(2)}°C / {data.tfMin?.toFixed(2)}°C
          </span>
        </div>
      </div>
    );
  };

  const CustomYearlyPointsTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0]?.payload;
    if (!data) return null;

    return (
      <div className="bg-slate-900/95 text-white p-3.5 rounded-xl border border-slate-700 shadow-2xl text-xs space-y-2 font-sans min-w-[260px] backdrop-blur-md">
        <div className="font-bold border-b border-slate-700 pb-1 flex items-center justify-between text-slate-200">
          <span>
            Point: {data.id} ({data.pos})
          </span>
          <span className="text-[10px] text-cyan-400 font-mono">
            DOF {data.dof?.toFixed(1)}m
          </span>
        </div>
        <div className="space-y-1.5">
          {activeYearConfigs.map((yc) => {
            const yrInfo = data.byYear?.[yc.year];
            if (!yrInfo) return null;
            return (
              <div
                key={yc.year}
                className="flex items-center justify-between gap-3 p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/70"
              >
                <div>
                  <div className="font-bold flex items-center gap-1.5" style={{ color: yc.color }}>
                    <span>Year {yc.year}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({yc.patternLabel})
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Peak Date: {yrInfo.peakDate} · Tf: {yrInfo.tfMax.toFixed(2)}°C
                  </div>
                </div>
                <div className="text-right">
                  <strong className="font-mono text-sm font-extrabold text-white">
                    {yrInfo.tcMax.toFixed(2)} °C
                  </strong>
                  <div
                    className="text-[10px] font-bold"
                    style={{ color: yrInfo.zone.color }}
                  >
                    {yrInfo.zone.shortLabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Page 7 Title & 6-Zone Temperature Criteria Strip */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-lg border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
              <Layers className="w-4 h-4" />
              Page 7 • Multi-Year Historical Comparison (1-Year Calendar Time Frame)
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Yearly Comparison — Visual Chart Analysis (Page 7)
            </h2>
            <p className="text-slate-300 text-sm mt-1">
              Compare different years of recorded fiber temperature, conductor temperature (T
              <sub>c,60287</sub>), and 4-circuit power flow within the same month, same date, or
              same period across a 1-year calendar window.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-cyan-300">
              {yearConfigs.length > 0
                ? `${enabledYears.length} / ${yearConfigs.length} Year(s) Active: ${enabledYears.join(', ')}`
                : 'Upload 1 or Multiple Yearly CSV/XLSX Files to Compare'}
            </span>
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
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: z.color }}
                />
                <span className="font-bold text-white">{z.shortLabel}:</span>
                <span className="font-mono text-slate-300">{z.rangeText}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-Year Summary Cards (When Database is Loaded) */}
      {yearSummaryStats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {yearSummaryStats.map((st) => {
            const zInfo = getThermalZoneInfo(st.peakTc);
            return (
              <div
                key={st.year}
                className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-2"
                style={{ borderTopWidth: '4px', borderTopColor: st.style.color }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-sm font-extrabold font-mono flex items-center gap-1.5"
                    style={{ color: st.style.color }}
                  >
                    <span>{st.style.markerSymbol}</span>
                    <span>Year {st.year}</span>
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: `${zInfo.color}18`, color: zInfo.color }}
                  >
                    {zInfo.name}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500 font-semibold">
                      Period Peak Conductor Tc
                    </div>
                    <div className="text-xl font-extrabold font-mono text-slate-900">
                      {st.peakTc.toFixed(2)} °C
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs text-slate-600">
                    <div>Tf Max: {st.peakTf.toFixed(2)}°C</div>
                    <div>Tf Min: {st.minTf.toFixed(2)}°C</div>
                  </div>
                </div>
                <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>
                    {st.daysCount}d · Peak {st.peakDate}
                  </span>
                  <span className="font-bold text-indigo-600">
                    {st.peakTotalMW.toFixed(1)} MW Total
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded-lg">
                  <span>Curve: {st.style.lineStyleLabel}</span>
                  <span>Bar: {st.style.patternLabel}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Visual Chart Section (Database Source, Display Filter, 4 Visual Charts) */}
      <div className="space-y-4">
        {/* 1. Visual Chart Database Source Bar (Google Drive Shared URL Box & Multi-File CSV/XLSX Upload) */}
        <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 shadow-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Link className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                Visual Chart Database Source (Upload 1 or Multiple Yearly CSV/XLSX Files or Google Drive URL)
              </span>
            </div>
            {csvDatabaseSource ? (
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[11px] font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Loaded ({csvDatabaseSource.years.join(', ')}):{' '}
                  {csvDatabaseSource.filenames.join(' + ')} ({csvDatabaseSource.totalRecords}{' '}
                  Records · {csvDatabaseSource.dateKeys.length} Days)
                </span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[11px] font-bold">
                Awaiting Upload or Shared URL — Upload Yearly Excel/CSV Files to Compare Years
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
            {/* Google Drive Shared URL Input Box */}
            <div className="lg:col-span-7 flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
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
                onClick={() => handleLoadDatabaseFromUrl(false)}
                disabled={isLoadingSharedUrl || !csvDatabaseUrl.trim()}
                className="shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                {isLoadingSharedUrl ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Load URL</span>
                  </>
                )}
              </button>
              {csvDatabaseSource && (
                <button
                  type="button"
                  onClick={() => handleLoadDatabaseFromUrl(true)}
                  disabled={isLoadingSharedUrl || !csvDatabaseUrl.trim()}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-700 hover:bg-cyan-600 text-white transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-sm"
                  title="Merge this URL's year data with already loaded year(s)"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Merge URL</span>
                </button>
              )}
            </div>

            {/* Upload CSV / XLSX File(s) Box */}
            <div className="lg:col-span-5 flex items-center gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-all cursor-pointer shadow-sm">
                <Upload className="w-4 h-4" />
                <span>Upload CSV / XLSX (1 or Multi-Year)</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  multiple
                  onChange={(e) => handleUploadDatabaseFiles(e, false)}
                  className="hidden"
                />
              </label>

              {csvDatabaseSource && (
                <>
                  <label
                    className="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-950 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/70 transition-all cursor-pointer shrink-0 flex items-center gap-1"
                    title="Upload another year's CSV/XLSX database file to compare together"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Year File</span>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      multiple
                      onChange={(e) => handleUploadDatabaseFiles(e, true)}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setCsvDatabaseSource(null);
                      setCsvDatabaseUrl('');
                      setStartMonthDay('');
                      setEndMonthDay('');
                      setEnabledYears([]);
                      showNotification('success', 'Cleared loaded yearly comparison database');
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer shrink-0"
                    title="Clear all loaded database files"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 2. Isolated Visual Chart Display Filters (1-Year Calendar Month / MM-DD Period, Section, Phase & Years) */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Isolated Page 7 Display Filters (1-Year Calendar Horizontal Axis • Uploaded File / URL Only)
              </h4>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* 1-Year Horizontal Axis Scale Toggle */}
              <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setHorizontalAxisScale('uploaded')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    horizontalAxisScale === 'uploaded'
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Show uploaded MM-DD date range within the 1-year calendar axis"
                >
                  Uploaded MM-DD Range (≤1 Year)
                </button>
                <button
                  type="button"
                  onClick={() => setHorizontalAxisScale('full_1year')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    horizontalAxisScale === 'full_1year'
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Show full 1-year calendar horizontal axis (Jan 01 – Dec 31, 365/366 days)"
                >
                  Full 1-Year Axis (Jan 01 – Dec 31)
                </button>
              </div>

              <span className="text-[11px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                {csvDatabaseSource && availableMonthDays.length > 0
                  ? `Sec ${activeSection.sectionId} (${activeSection.name}) · 1-Year Axis: ${
                      horizontalAxisScale === 'full_1year'
                        ? selectedMonthFilter === 'ALL'
                          ? '01-01 → 12-31 (Full 1-Year)'
                          : `${selectedMonthFilter}-01 → ${selectedMonthFilter}-${
                              DAYS_IN_MONTH[selectedMonthFilter] || 31
                            }`
                        : `${startMonthDay || availableMonthDays[0]} → ${
                            endMonthDay || availableMonthDays[availableMonthDays.length - 1]
                          }`
                    } · Years: ${enabledYears.join(' vs ')}`
                  : `Sec ${activeSection.sectionId} (${activeSection.name}) · Isolated Filter (Upload File or URL)`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Filter 1: Same-Month Quick Filter (Within 1-Year Timeframe) */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>1. Month Filter (1-Year Frame)</span>
                <span className="font-mono text-[10px] text-indigo-600 font-bold">
                  {selectedMonthFilter === 'ALL' ? 'All Months' : `Month ${selectedMonthFilter}`}
                </span>
              </label>
              <select
                value={selectedMonthFilter}
                onChange={(e) => {
                  setSelectedMonthFilter(e.target.value);
                  setStartMonthDay('');
                  setEndMonthDay('');
                }}
                className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 2: Same Calendar Date / Period Range (MM-DD to MM-DD within 1-Year Timeframe) */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>2. 1-Year Date Range (MM-DD)</span>
                <span className="font-mono text-[10px] text-cyan-600 font-bold">
                  {availableMonthDays.length > 0
                    ? `${startMonthDay || availableMonthDays[0]} → ${
                        endMonthDay || availableMonthDays[availableMonthDays.length - 1]
                      }`
                    : 'No Dates'}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={startMonthDay}
                  disabled={availableMonthDays.length === 0}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setStartMonthDay(nextStart);
                    if (endMonthDay && nextStart > endMonthDay) setEndMonthDay(nextStart);
                  }}
                  className="w-full px-2 py-1.5 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                >
                  {availableMonthDays.length > 0 ? (
                    availableMonthDays.map((md) => (
                      <option key={md} value={md}>
                        {md}
                      </option>
                    ))
                  ) : (
                    <option value="">Start MM-DD</option>
                  )}
                </select>
                <select
                  value={endMonthDay}
                  disabled={availableMonthDays.length === 0}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    setEndMonthDay(nextEnd);
                    if (startMonthDay && nextEnd < startMonthDay) setStartMonthDay(nextEnd);
                  }}
                  className="w-full px-2 py-1.5 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                >
                  {availableMonthDays.length > 0 ? (
                    availableMonthDays.map((md) => (
                      <option key={md} value={md}>
                        {md}
                      </option>
                    ))
                  ) : (
                    <option value="">End MM-DD</option>
                  )}
                </select>
              </div>
            </div>

            {/* Filter 3: Section / Zone Filter */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>3. Section / Zone Filter</span>
                <span className="font-mono text-[10px] text-indigo-600 font-bold">
                  Sec {activeSection.sectionId}
                </span>
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
                    {sec.category === 'land' ? `Sec ${sec.sectionId}` : `Zone ${sec.sectionId}`}:{' '}
                    {sec.name} ({sec.category.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 4: Cable Phase / Channel Filter */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>4. Cable Phase / Channel</span>
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

          {/* Year Comparison Legend & Interactive Year Toggles */}
          {yearConfigs.length > 0 && (
            <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>Compared Years &amp; Visual Style Indicators:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {yearConfigs.map((yc) => {
                  const isEnabled = enabledYears.includes(yc.year);
                  return (
                    <button
                      key={yc.year}
                      type="button"
                      onClick={() => {
                        setEnabledYears((prev) => {
                          if (prev.includes(yc.year)) {
                            return prev.length > 1 ? prev.filter((y) => y !== yc.year) : prev;
                          }
                          return [...prev, yc.year].sort();
                        });
                      }}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-2 ${
                        isEnabled
                          ? 'bg-slate-900 text-white border-slate-800 shadow-xs'
                          : 'bg-slate-100 text-slate-400 border-slate-200 opacity-60'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: yc.color }}
                      />
                      <span>Year {yc.year}</span>
                      <span className="text-[10px] text-cyan-300 font-normal">
                        [{yc.lineStyleLabel} · Marker {yc.markerSymbol} · {yc.patternLabel}]
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. Select Visual Chart (Maximized Single View) */}
        <div className="bg-slate-900/95 backdrop-blur-md p-2 rounded-2xl border border-slate-800 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 mb-1 border-b border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Select Yearly Comparison Visual Chart (1-Year Calendar Time Frame):
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              Comparing different years across same month, date, or time period
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
                  selectedChartTab === 'thermal'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-700 text-cyan-400'
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
                  Distinct Line Curve Style per Year (No Dots)
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
                  selectedChartTab === 'power'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-700 text-amber-400'
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
                  Distinct Yearly Curve Style + Thicker Total Flow
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
                  selectedChartTab === 'physics'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-700 text-emerald-400'
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
                  Different Scatter Marker Shape per Year (● ▲ ◆ ■ ★)
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
                  selectedChartTab === 'points'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-700 text-purple-400'
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
                  Adjacent Bars with Distinct Pattern Fill per Year
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* 4. Maximized Single Chart Container */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
          {/* Chart Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs uppercase tracking-wider">
                  {selectedChartTab === 'thermal'
                    ? 'Yearly Comparison Chart 1 / 4'
                    : selectedChartTab === 'power'
                    ? 'Yearly Comparison Chart 2 / 4'
                    : selectedChartTab === 'physics'
                    ? 'Yearly Comparison Chart 3 / 4'
                    : 'Yearly Comparison Chart 4 / 4'}
                </span>
                <span className="font-mono text-xs font-bold text-slate-500">
                  Sec {activeSection.sectionId} ({activeSection.name})
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-1">
                {selectedChartTab === 'thermal' &&
                  'Daily record of fiber temperature & core conductor temperature trajectory (Yearly Comparison)'}
                {selectedChartTab === 'power' &&
                  'Power flow in system during record of maximum fiber temperature (Yearly Comparison)'}
                {selectedChartTab === 'physics' &&
                  'Chart 3: IEC 60287 Load–Temperature Physics Response (Different Marker per Year)'}
                {selectedChartTab === 'points' &&
                  `Chart 4: Intra-Section Discrete Sampling Points — Adjacent Pattern-Filled Bars by Year (${multiYearPointsBreakdown.length} Points)`}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedChartTab === 'thermal' &&
                  '1-Year calendar time frame (MM-DD) comparing Core Conductor Tc,60287, Daily Max Tf, and Daily Min Tf with distinct curve line styles per year.'}
                {selectedChartTab === 'power' &&
                  '1-Year calendar time frame (MM-DD) comparing Columns O to S power flow during maximum fiber temperature with thicker Total 4-Circuit curve and distinct line style per year.'}
                {selectedChartTab === 'physics' &&
                  'Each year is plotted with a distinct geometric marker shape (Circle ●, Triangle ▲, Diamond ◆, Square ■, Star ★) for same-month/period comparison.'}
                {selectedChartTab === 'points' &&
                  'Adjacent side-by-side bars at each discrete sampling point filled with distinct geometric SVG patterns and colors for each compared year.'}
              </p>
            </div>

            {/* Metric / Circuit Sub-Filters for Chart 1 & Chart 2 */}
            <div className="flex flex-wrap items-center gap-2">
              {selectedChartTab === 'thermal' && (
                <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  {(
                    [
                      { id: 'all', label: 'All (Tc Max + Tf Max + Tf Min)' },
                      { id: 'tcMax', label: 'Core Conductor Tc Max Only' },
                      { id: 'tfMax', label: 'Fiber Tf Max Only' },
                      { id: 'tfMin', label: 'Fiber Tf Min Only' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setThermalMetricFilter(opt.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        thermalMetricFilter === opt.id
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {selectedChartTab === 'power' && (
                <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  {(
                    [
                      { id: 'all', label: 'All 4 Circuits + Total (Cols O–S)' },
                      { id: 'total', label: 'Total 4-Ckt [Col O]' },
                      { id: 'ckt3', label: '115kV Ckt #3 [Col P]' },
                      { id: 'ckt2', label: '115kV Ckt #2 [Col Q]' },
                      { id: 'nkt33', label: '33kV NKT [Col R]' },
                      { id: 'oil33', label: '33kV Oil [Col S]' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPowerCircuitFilter(opt.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        powerCircuitFilter === opt.id
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Chart Body */}
          {!csvDatabaseSource || alignedCalendarSeries.length === 0 ? (
            <div className="h-[500px] w-full rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <div className="max-w-lg space-y-1.5">
                <h4 className="text-base font-extrabold text-slate-900">
                  Page 7 Charts 1–4 Display Data from Uploaded Excel/CSV File(s) or Shared URL Link Only
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Page 7 filters and charts are completely isolated from Pages 1–6. Upload a
                  multi-year 19-sheet Excel (<code>.xlsx</code>) / CSV (<code>.csv</code>) database
                  file, or upload multiple yearly database files using{' '}
                  <strong>Upload CSV / XLSX</strong> and <strong>+ Add Year File</strong> (or paste
                  a shared URL link) in the source bar above to compare different years on the
                  maximum 1-year calendar horizontal axis.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>Upload Yearly Excel / CSV Database File(s)</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    multiple
                    onChange={(e) => handleUploadDatabaseFiles(e, false)}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Visual Year Curve Style / Marker / Pattern Key Banner */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-bold text-slate-700 flex items-center gap-2">
                  <span>
                    {selectedChartTab === 'thermal' || selectedChartTab === 'power'
                      ? '1-Year Calendar Horizontal Axis (Jan 01 – Dec 31 Max) • Curve Style by Year:'
                      : selectedChartTab === 'physics'
                      ? 'Scatter Marker Shape by Year:'
                      : 'Adjacent Bar Fill Pattern by Year:'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {activeYearConfigs.map((yc) => (
                    <div
                      key={yc.year}
                      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white border border-slate-200 shadow-2xs font-mono text-[11px]"
                    >
                      {(selectedChartTab === 'thermal' || selectedChartTab === 'power') && (
                        <svg width="38" height="12" className="shrink-0">
                          <line
                            x1="0"
                            y1="6"
                            x2="38"
                            y2="6"
                            stroke={yc.color}
                            strokeWidth="3"
                            strokeDasharray={yc.strokeDasharray || undefined}
                          />
                        </svg>
                      )}
                      {selectedChartTab === 'physics' && (
                        <span className="text-sm font-bold" style={{ color: yc.color }}>
                          {yc.markerSymbol}
                        </span>
                      )}
                      {selectedChartTab === 'points' && (
                        <span
                          className="w-3.5 h-3.5 rounded-xs border border-slate-300 shrink-0"
                          style={{ backgroundColor: yc.color }}
                        />
                      )}
                      <strong style={{ color: yc.color }}>Year {yc.year}:</strong>
                      <span className="text-slate-600">
                        {selectedChartTab === 'thermal' || selectedChartTab === 'power'
                          ? yc.lineStyleLabel
                          : selectedChartTab === 'physics'
                          ? yc.markerLabel
                          : yc.patternLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="h-[520px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {selectedChartTab === 'thermal' ? (
                  /* ----------------- CHART 1: MULTI-YEAR FIBER & CORE CONDUCTOR TEMPERATURE TRAJECTORY (MAX 1-YEAR HORIZONTAL AXIS, NO DOTS, DISTINCT YEAR LINE STYLES) ----------------- */
                  <ComposedChart
                    data={alignedCalendarSeries}
                    margin={{ top: 15, right: 30, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      interval="preserveStartEnd"
                      label={{
                        value:
                          '1-Year Calendar Time Frame (Month-Day MM-DD — Maximum 1 Year: Jan 01 to Dec 31)',
                        position: 'insideBottom',
                        offset: -10,
                        fill: '#475569',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />
                    <YAxis
                      domain={[20, 80]}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      unit="°C"
                    />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        padding: 0,
                        boxShadow: 'none',
                      }}
                      content={<CustomYearlyThermalTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />

                    {/* 6-Zone Reference Lines */}
                    <ReferenceLine
                      y={70}
                      stroke="#991b1b"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Critical >70°C',
                        position: 'insideTopRight',
                        fill: '#991b1b',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Danger 60°C',
                        position: 'insideTopRight',
                        fill: '#ef4444',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />
                    <ReferenceLine
                      y={55}
                      stroke="#f97316"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Alert 55°C',
                        position: 'insideTopRight',
                        fill: '#f97316',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />
                    <ReferenceLine
                      y={45}
                      stroke="#eab308"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Monitoring 45°C',
                        position: 'insideTopRight',
                        fill: '#eab308',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />
                    <ReferenceLine
                      y={35}
                      stroke="#10b981"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Normal 35°C',
                        position: 'insideTopRight',
                        fill: '#10b981',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />

                    {/* Render each active year's curves with distinct strokeDasharray and NO circle dots */}
                    {activeYearConfigs.map((yc) => (
                      <React.Fragment key={yc.year}>
                        {(thermalMetricFilter === 'all' || thermalMetricFilter === 'tcMax') && (
                          <Line
                            type="monotone"
                            dataKey={`tcMax_${yc.year}`}
                            name={`${yc.year} Core Conductor Tc Max (°C) [${yc.lineStyleLabel}]`}
                            stroke={yc.color}
                            strokeWidth={3}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                        {(thermalMetricFilter === 'all' || thermalMetricFilter === 'tfMax') && (
                          <Line
                            type="monotone"
                            dataKey={`tfMax_${yc.year}`}
                            name={`${yc.year} Daily Max Fiber Tf (°C) [${yc.lineStyleLabel}]`}
                            stroke={yc.secondaryColor}
                            strokeWidth={2.5}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                        {(thermalMetricFilter === 'all' || thermalMetricFilter === 'tfMin') && (
                          <Line
                            type="monotone"
                            dataKey={`tfMin_${yc.year}`}
                            name={`${yc.year} Daily Min Fiber Tf (°C) [${yc.lineStyleLabel}]`}
                            stroke={yc.minColor}
                            strokeWidth={2}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </ComposedChart>
                ) : selectedChartTab === 'power' ? (
                  /* ----------------- CHART 2: MULTI-YEAR POWER FLOW DURING MAX FIBER TEMPERATURE (MAX 1-YEAR HORIZONTAL AXIS, NO DOTS, THICKER TOTAL 4-CKT CURVE) ----------------- */
                  <ComposedChart
                    data={alignedCalendarSeries}
                    margin={{ top: 15, right: 30, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      interval="preserveStartEnd"
                      label={{
                        value:
                          '1-Year Calendar Time Frame (Month-Day MM-DD — Maximum 1 Year: Jan 01 to Dec 31)',
                        position: 'insideBottom',
                        offset: -10,
                        fill: '#475569',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} unit=" MW" />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        padding: 0,
                        boxShadow: 'none',
                      }}
                      content={<CustomYearlyPowerTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />

                    {activeYearConfigs.map((yc) => (
                      <React.Fragment key={yc.year}>
                        {/* Col O: Total 4-Circuit Power Flow — THICKER CURVE (strokeWidth={4.5}) & NO DOTS */}
                        {(powerCircuitFilter === 'all' || powerCircuitFilter === 'total') && (
                          <Line
                            type="monotone"
                            dataKey={`pTotal_${yc.year}`}
                            name={`${yc.year} Total 4-Circuit Flow [Col O] (MW) [${yc.lineStyleLabel}]`}
                            stroke={yc.color}
                            strokeWidth={4.5}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                        {/* Col P: 115kV Ckt #3 (KMB) */}
                        {(powerCircuitFilter === 'all' || powerCircuitFilter === 'ckt3') && (
                          <Line
                            type="monotone"
                            dataKey={`pCkt3_${yc.year}`}
                            name={`${yc.year} 115kV Ckt #3 (KMB) [Col P] (MW)`}
                            stroke="#dc2626"
                            strokeWidth={2.5}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                        {/* Col Q: 115kV Ckt #2 (KMA) */}
                        {(powerCircuitFilter === 'all' || powerCircuitFilter === 'ckt2') && (
                          <Line
                            type="monotone"
                            dataKey={`pCkt2_${yc.year}`}
                            name={`${yc.year} 115kV Ckt #2 (KMA) [Col Q] (MW)`}
                            stroke="#2563eb"
                            strokeWidth={2.5}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                        {/* Col R: 33kV NKT (KNA) */}
                        {(powerCircuitFilter === 'all' || powerCircuitFilter === 'nkt33') && (
                          <Line
                            type="monotone"
                            dataKey={`p33Nkt_${yc.year}`}
                            name={`${yc.year} 33kV NKT (KNA) [Col R] (MW)`}
                            stroke="#059669"
                            strokeWidth={2}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                        {/* Col S: 33kV Oil-Filled (KNA) */}
                        {(powerCircuitFilter === 'all' || powerCircuitFilter === 'oil33') && (
                          <Line
                            type="monotone"
                            dataKey={`p33Oil_${yc.year}`}
                            name={`${yc.year} 33kV Oil-Filled (KNA) [Col S] (MW)`}
                            stroke="#d97706"
                            strokeWidth={2}
                            strokeDasharray={yc.strokeDasharray || undefined}
                            dot={false}
                            connectNulls
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </ComposedChart>
                ) : selectedChartTab === 'physics' ? (
                  /* ----------------- CHART 3: THERMAL RESPONSE SCATTER (DIFFERENT MARKER SHAPE PER YEAR) ----------------- */
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
                    <ZAxis range={[80, 80]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }}
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        padding: 0,
                        boxShadow: 'none',
                      }}
                      content={<CustomYearlyPhysicsTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <ReferenceLine
                      y={70}
                      stroke="#991b1b"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Critical >70°C',
                        position: 'insideTopRight',
                        fill: '#991b1b',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Danger 60°C',
                        position: 'insideTopRight',
                        fill: '#ef4444',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={55}
                      stroke="#f97316"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Alert 55°C',
                        position: 'insideTopRight',
                        fill: '#f97316',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={45}
                      stroke="#eab308"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Monitoring 45°C',
                        position: 'insideTopRight',
                        fill: '#eab308',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={35}
                      stroke="#10b981"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Normal 35°C',
                        position: 'insideTopRight',
                        fill: '#10b981',
                        fontSize: 11,
                      }}
                    />

                    {/* Separate Scatter series per Year with a distinct custom geometric marker shape */}
                    {activeYearConfigs.map((yc) => (
                      <Scatter
                        key={yc.year}
                        name={`Year ${yc.year} — Marker: ${yc.markerLabel}`}
                        data={scatterByYear.get(yc.year) || []}
                        fill={yc.color}
                        shape={renderYearScatterShape(yc.markerShape, yc.color)}
                      />
                    ))}
                  </ScatterChart>
                ) : (
                  /* ----------------- CHART 4: DISCRETE SAMPLING POINTS (ADJACENT BARS WITH DIFFERENT PATTERN FILL PER YEAR) ----------------- */
                  <ComposedChart
                    data={multiYearPointsBreakdown}
                    margin={{ top: 15, right: 30, left: 10, bottom: 15 }}
                  >
                    {/* SVG Pattern Definitions for Adjacent Yearly Bars */}
                    <defs>
                      {activeYearConfigs.map((yc, idx) => {
                        const patType = idx % 5;
                        if (patType === 0) {
                          // Diagonal Stripes Pattern
                          return (
                            <pattern
                              key={yc.patternId}
                              id={`${yc.patternId}-${yc.year}`}
                              width="8"
                              height="8"
                              patternUnits="userSpaceOnUse"
                              patternTransform="rotate(45)"
                            >
                              <rect width="8" height="8" fill={yc.color} fillOpacity={0.22} />
                              <line
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="8"
                                stroke={yc.color}
                                strokeWidth="4"
                              />
                            </pattern>
                          );
                        }
                        if (patType === 1) {
                          // Cross-Hatch Grid Pattern
                          return (
                            <pattern
                              key={yc.patternId}
                              id={`${yc.patternId}-${yc.year}`}
                              width="8"
                              height="8"
                              patternUnits="userSpaceOnUse"
                            >
                              <rect width="8" height="8" fill={yc.color} fillOpacity={0.2} />
                              <path
                                d="M 0 0 L 8 8 M 8 0 L 0 8"
                                stroke={yc.color}
                                strokeWidth="2"
                              />
                            </pattern>
                          );
                        }
                        if (patType === 2) {
                          // Polka Dots Pattern
                          return (
                            <pattern
                              key={yc.patternId}
                              id={`${yc.patternId}-${yc.year}`}
                              width="8"
                              height="8"
                              patternUnits="userSpaceOnUse"
                            >
                              <rect width="8" height="8" fill={yc.color} fillOpacity={0.22} />
                              <circle cx="4" cy="4" r="2.2" fill={yc.color} />
                            </pattern>
                          );
                        }
                        if (patType === 3) {
                          // Horizontal Stripes Pattern
                          return (
                            <pattern
                              key={yc.patternId}
                              id={`${yc.patternId}-${yc.year}`}
                              width="8"
                              height="8"
                              patternUnits="userSpaceOnUse"
                            >
                              <rect width="8" height="8" fill={yc.color} fillOpacity={0.22} />
                              <line
                                x1="0"
                                y1="2"
                                x2="8"
                                y2="2"
                                stroke={yc.color}
                                strokeWidth="2.5"
                              />
                              <line
                                x1="0"
                                y1="6"
                                x2="8"
                                y2="6"
                                stroke={yc.color}
                                strokeWidth="2.5"
                              />
                            </pattern>
                          );
                        }
                        // Vertical Stripes Pattern
                        return (
                          <pattern
                            key={yc.patternId}
                            id={`${yc.patternId}-${yc.year}`}
                            width="8"
                            height="8"
                            patternUnits="userSpaceOnUse"
                          >
                            <rect width="8" height="8" fill={yc.color} fillOpacity={0.22} />
                            <line
                              x1="2"
                              y1="0"
                              x2="2"
                              y2="8"
                              stroke={yc.color}
                              strokeWidth="2.5"
                            />
                            <line
                              x1="6"
                              y1="0"
                              x2="6"
                              y2="8"
                              stroke={yc.color}
                              strokeWidth="2.5"
                            />
                          </pattern>
                        );
                      })}
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="dof"
                      tickFormatter={(v) => `${Number(v).toFixed(0)}m`}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <YAxis
                      domain={[20, 80]}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      unit="°C"
                    />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
                      contentStyle={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        padding: 0,
                        boxShadow: 'none',
                      }}
                      content={<CustomYearlyPointsTooltip />}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <ReferenceLine
                      y={70}
                      stroke="#991b1b"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Critical 70°C',
                        position: 'insideTopRight',
                        fill: '#991b1b',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#ef4444"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Danger 60°C',
                        position: 'insideTopRight',
                        fill: '#ef4444',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={45}
                      stroke="#eab308"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Monitoring 45°C',
                        position: 'insideTopRight',
                        fill: '#eab308',
                        fontSize: 11,
                      }}
                    />

                    {/* Adjacent Bars for each Year filled with Distinct Pattern & Color */}
                    {activeYearConfigs.map((yc) => (
                      <Bar
                        key={yc.year}
                        dataKey={`tcMax_${yc.year}`}
                        name={`Year ${yc.year} Max Conductor Tc (°C) [${yc.patternLabel}]`}
                        fill={`url(#${yc.patternId}-${yc.year})`}
                        stroke={yc.color}
                        strokeWidth={1.5}
                        radius={[4, 4, 0, 0]}
                      />
                    ))}
                  </ComposedChart>
                )}
              </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Discrete Sampling Points Multi-Year Matrix Table (No Forecast Section) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden transition-all duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Section {activeSection.sectionId} ({activeSection.name}) — Discrete Sampling Points
                Multi-Year Comparison Matrix
              </h3>
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                {multiYearPointsBreakdown.length} Points
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Comparing recorded peak Fiber Tf and Core Conductor Tc across loaded years at each
              discrete sampling point
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMatrixMinimized((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-all active:scale-95 shadow-xs ${
                isMatrixMinimized
                  ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-500'
                  : 'bg-slate-900 text-white border-slate-800 hover:bg-slate-800'
              }`}
            >
              {isMatrixMinimized ? (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Expand Matrix ({multiYearPointsBreakdown.length})</span>
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
            <span>
              Multi-year matrix minimized ({multiYearPointsBreakdown.length} discrete sampling
              points hidden).
            </span>
            <button
              type="button"
              onClick={() => setIsMatrixMinimized(false)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer hover:underline"
            >
              Show Table
            </button>
          </div>
        ) : !csvDatabaseSource || multiYearPointsBreakdown.length === 0 ? (
          <div className="px-6 py-8 bg-slate-50/60 border-t border-slate-100 text-center text-xs text-slate-500">
            Upload Yearly Excel/CSV Database file(s) or load a Google Drive Shared URL above to
            populate the Multi-Year Discrete Sampling Points Matrix.
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
                  {activeYearConfigs.map((yc) => (
                    <th key={yc.year} className="py-3 px-4">
                      Year {yc.year} Peak Tf / Conductor Tc ({yc.patternLabel})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {multiYearPointsBreakdown.map((pt) => {
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
                      {activeYearConfigs.map((yc) => {
                        const yrData = pt.byYear?.[yc.year];
                        if (!yrData) {
                          return (
                            <td key={yc.year} className="py-2.5 px-4 font-mono text-slate-400">
                              —
                            </td>
                          );
                        }
                        return (
                          <td key={yc.year} className="py-2.5 px-4 font-mono">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">
                                Tc: {yrData.tcMax.toFixed(2)} °C
                              </span>
                              <span className="text-slate-500 text-[11px]">
                                (Tf: {yrData.tfMax.toFixed(2)} °C)
                              </span>
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                                style={{
                                  backgroundColor: `${yrData.zone.color}18`,
                                  color: yrData.zone.color,
                                }}
                              >
                                {yrData.zone.shortLabel}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
