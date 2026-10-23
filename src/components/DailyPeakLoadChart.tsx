import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Calendar,
  TrendingUp,
  BarChart2,
  Clock,
  Filter,
  CheckCircle2,
  Info,
  ArrowRight,
  RotateCcw,
  CalendarRange,
  Folder,
  RefreshCw,
  DownloadCloud,
  Zap,
  ExternalLink,
  ChevronRight,
  StopCircle,
  Gauge,
} from 'lucide-react';
import {
  POWER_CIRCUITS,
  DailyPowerSummary,
  PowerScannedFileMeta,
  SubstationCode,
  parseDailyCsvContent,
  mergeDailySubstations,
} from '../services/powerConsumptionParser';
import { DriveFolder } from '../types';
import { fetchFileContent } from '../services/driveApi';

export interface DailyPeakLoadPoint {
  dateKey: string;
  formattedDate: string;
  day: number;
  month: number;
  year: number;
  // Maximum MW in 24 hours for each circuit
  peakCircuit2: number;
  timeCircuit2: string;
  peakCircuit3: number;
  timeCircuit3: string;
  peakKnaNkt: number;
  timeKnaNkt: string;
  peakKnaOil: number;
  timeKnaOil: string;
  // Maximum MW in 24 hours for combine (all 4 circuits simultaneous sum)
  peakCombine: number;
  timeCombine: string;
  sampleCount: number;
}

interface DailyPeakLoadChartProps {
  targetFolder: DriveFolder;
  scannedFiles: PowerScannedFileMeta[];
  cachedFileContents: Map<string, string>;
  onCacheFileContent?: (fileId: string, content: string) => void;
  onBatchCacheContents?: (newEntries: Map<string, string>) => void;
  accessToken?: string | null;
  onScanTargetFolder?: () => void;
  isFolderScanning?: boolean;
  selectedProfileDateKey?: string;
  onSelectDateForProfile?: (dateKey: string) => void;
  allLoadedSummaries: Map<string, DailyPowerSummary>;
  onUpdateSummaries: (newSummaries: Map<string, DailyPowerSummary>) => void;
  showNotification?: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const DailyPeakLoadChart: React.FC<DailyPeakLoadChartProps> = ({
  targetFolder,
  scannedFiles,
  cachedFileContents,
  onCacheFileContent,
  onBatchCacheContents,
  accessToken,
  onScanTargetFolder,
  isFolderScanning = false,
  selectedProfileDateKey,
  onSelectDateForProfile,
  allLoadedSummaries,
  onUpdateSummaries,
  showNotification,
}) => {
  // 1. Discover all distinct dates present across target folder files (independent of daily profile filter)
  const targetFolderDates = useMemo(() => {
    const map = new Map<
      string,
      {
        dateKey: string;
        formattedDate: string;
        year: number;
        month: number;
        day: number;
        files: PowerScannedFileMeta[];
      }
    >();

    scannedFiles.forEach((f) => {
      const dk = f.dateMeta.dateKey;
      if (!map.has(dk)) {
        map.set(dk, {
          dateKey: dk,
          formattedDate: f.dateMeta.formattedDate,
          year: f.dateMeta.year,
          month: f.dateMeta.month,
          day: f.dateMeta.day,
          files: [f],
        });
      } else {
        map.get(dk)!.files.push(f);
      }
    });

    return Array.from(map.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [scannedFiles]);

  const folderMinDate = targetFolderDates[0]?.dateKey || '';
  const folderMaxDate = targetFolderDates[targetFolderDates.length - 1]?.dateKey || '';

  // 2. Custom Filter State: Start Date & End Date (independent of daily power profile)
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [datePreset, setDatePreset] = useState<'all' | '7d' | '14d' | '30d' | 'custom'>('all');

  // Chart Presentation Mode: 'trend' (Line) or 'bars' (Grouped Bars)
  const [chartMode, setChartMode] = useState<'trend' | 'bars'>('trend');

  // Visible circuits toggles (default all TRUE including Combine)
  const [visibleCircuits, setVisibleCircuits] = useState<Record<string, boolean>>({
    circuit_115kv_2: true,
    circuit_115kv_3: true,
    circuit_33kv_nkt: true,
    circuit_33kv_oil: true,
    combine: true,
  });

  // Fetching & Compiling state
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState<{
    current: number;
    total: number;
    speed: string;
    estSeconds: number;
    step: string;
  } | null>(null);
  const abortRef = useRef<boolean>(false);

  // Hover state
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Initialize Start Date and End Date once target folder files are scanned
  useEffect(() => {
    if (folderMinDate && folderMaxDate) {
      if (!startDate || !endDate) {
        setStartDate(folderMinDate);
        setEndDate(folderMaxDate);
      }
    }
  }, [folderMinDate, folderMaxDate]);

  // Handle Preset selection
  const applyDatePreset = (preset: 'all' | '7d' | '14d' | '30d' | 'custom') => {
    setDatePreset(preset);
    if (!folderMaxDate) return;

    if (preset === 'all') {
      setStartDate(folderMinDate);
      setEndDate(folderMaxDate);
      return;
    }

    if (preset === 'custom') {
      return;
    }

    let daysToSubtract = 7;
    if (preset === '14d') daysToSubtract = 14;
    if (preset === '30d') daysToSubtract = 30;

    const maxD = new Date(folderMaxDate);
    const startD = new Date(maxD);
    startD.setDate(startD.getDate() - (daysToSubtract - 1));

    const yyyy = startD.getFullYear();
    const mm = String(startD.getMonth() + 1).padStart(2, '0');
    const dd = String(startD.getDate()).padStart(2, '0');
    const computedStart = `${yyyy}-${mm}-${dd}`;

    setStartDate(computedStart < folderMinDate ? folderMinDate : computedStart);
    setEndDate(folderMaxDate);
  };

  // Toggle Circuit Visibility
  const toggleCircuit = (circuitId: string) => {
    setVisibleCircuits((prev) => ({
      ...prev,
      [circuitId]: !prev[circuitId],
    }));
  };

  // 3. Dates in target folder matching the custom period [startDate, endDate]
  const matchingFolderDates = useMemo(() => {
    if (!startDate || !endDate) return targetFolderDates;
    return targetFolderDates.filter((d) => d.dateKey >= startDate && d.dateKey <= endDate);
  }, [targetFolderDates, startDate, endDate]);

  // Identify dates that need compiling or downloading
  const uncompiledDates = useMemo(() => {
    return matchingFolderDates.filter((d) => !allLoadedSummaries.has(d.dateKey));
  }, [matchingFolderDates, allLoadedSummaries]);

  // Helper to parse and merge a single day from content map
  const parseAndMergeSingleDate = useCallback(
    (
      d: { dateKey: string; files: PowerScannedFileMeta[] },
      contentMap: Map<string, string>
    ): DailyPowerSummary | null => {
      const substationData: {
        KMA?: ReturnType<typeof parseDailyCsvContent>['rows'];
        KMB?: ReturnType<typeof parseDailyCsvContent>['rows'];
        KNA?: ReturnType<typeof parseDailyCsvContent>['rows'];
      } = {};
      const fileInfos: Array<{ fileName: string; substation: SubstationCode; rowCount: number }> = [];

      d.files.forEach((f) => {
        const text = contentMap.get(f.fileId);
        if (text) {
          const parsed = parseDailyCsvContent(text, f.substation);
          substationData[f.substation] = parsed.rows;
          fileInfos.push({
            fileName: f.fileName,
            substation: f.substation,
            rowCount: parsed.rowCount,
          });
        }
      });

      if (Object.keys(substationData).length === 0) return null;
      return mergeDailySubstations(d.dateKey, substationData, fileInfos);
    },
    []
  );

  // Auto-compile dates that are already cached in memory
  useEffect(() => {
    if (uncompiledDates.length === 0) return;

    // Check if any uncompiled dates can be compiled immediately from cachedFileContents
    const compilableDates = uncompiledDates.filter((d) =>
      d.files.every((f) => cachedFileContents.has(f.fileId))
    );

    if (compilableDates.length === 0) return;

    const newMap = new Map(allLoadedSummaries);
    compilableDates.forEach((d) => {
      const summary = parseAndMergeSingleDate(d, cachedFileContents);
      if (summary) {
        newMap.set(d.dateKey, summary);
      }
    });

    onUpdateSummaries(newMap);
  }, [uncompiledDates, cachedFileContents, allLoadedSummaries, parseAndMergeSingleDate, onUpdateSummaries]);

  // High-Speed Multi-Stream Concurrent Turbo Compilation Engine
  const handleFetchAndCompilePeriod = useCallback(async () => {
    if (uncompiledDates.length === 0) return;

    abortRef.current = false;
    setIsCompiling(true);

    const localCache = new Map(cachedFileContents);
    const newlyFetched = new Map<string, string>();
    const workingSummaries = new Map(allLoadedSummaries);

    // Fast Pass 1: Parse all dates whose files are ALREADY in localCache (Instant 0ms pass)
    const instantDates = uncompiledDates.filter((d) =>
      d.files.every((f) => localCache.has(f.fileId))
    );
    const remoteDates = uncompiledDates.filter(
      (d) => !d.files.every((f) => localCache.has(f.fileId))
    );

    instantDates.forEach((d) => {
      const summary = parseAndMergeSingleDate(d, localCache);
      if (summary) workingSummaries.set(d.dateKey, summary);
    });

    if (instantDates.length > 0) {
      onUpdateSummaries(new Map(workingSummaries));
    }

    if (remoteDates.length === 0) {
      setIsCompiling(false);
      if (showNotification) {
        showNotification('success', `Compiled ${uncompiledDates.length} days immediately from memory cache!`);
      }
      return;
    }

    const totalDaysToProcess = uncompiledDates.length;
    let completedDays = instantDates.length;
    const startTime = performance.now();

    setCompileProgress({
      current: completedDays,
      total: totalDaysToProcess,
      speed: '--',
      estSeconds: 0,
      step: `Turbo Multi-Stream initialized for ${remoteDates.length} days...`,
    });

    // Fast Pass 2: Concurrent Multi-Stream Worker Pool
    // Process remoteDates in chunks of 8 days concurrently (up to 24 parallel streams)
    const BATCH_SIZE = 8;

    try {
      for (let i = 0; i < remoteDates.length; i += BATCH_SIZE) {
        if (abortRef.current) break;

        const chunk = remoteDates.slice(i, i + BATCH_SIZE);

        // Process all days in this chunk in parallel!
        const chunkResults = await Promise.all(
          chunk.map(async (d) => {
            // For each day, download all missing substation files in parallel!
            await Promise.all(
              d.files.map(async (fileMeta) => {
                if (localCache.has(fileMeta.fileId)) return;
                if (!accessToken) return;

                try {
                  const content = await fetchFileContent(accessToken, fileMeta.fileId, 'text/csv');
                  if (content) {
                    localCache.set(fileMeta.fileId, content);
                    newlyFetched.set(fileMeta.fileId, content);
                  }
                } catch (err) {
                  console.warn(`Could not fetch ${fileMeta.fileName}:`, err);
                }
              })
            );

            return parseAndMergeSingleDate(d, localCache);
          })
        );

        // Merge newly compiled summaries
        chunkResults.forEach((summary) => {
          if (summary) workingSummaries.set(summary.dateKey, summary);
        });

        completedDays += chunk.length;
        const elapsedSec = Math.max(0.1, (performance.now() - startTime) / 1000);
        const rate = (completedDays / elapsedSec);
        const speedFormatted = rate.toFixed(1);
        const remainingDays = totalDaysToProcess - completedDays;
        const estSeconds = Math.ceil(remainingDays / Math.max(0.5, rate));

        // PROGRESSIVE STREAMING: Push updated summaries to chart every batch so user sees real-time progress!
        onUpdateSummaries(new Map(workingSummaries));

        setCompileProgress({
          current: completedDays,
          total: totalDaysToProcess,
          speed: `${speedFormatted} days/s`,
          estSeconds,
          step: `Compiled ${completedDays} of ${totalDaysToProcess} days (${Math.round((completedDays / totalDaysToProcess) * 100)}%) • ${speedFormatted} days/s • ~${estSeconds}s remaining`,
        });
      }

      // Flush newly fetched files to parent cache in a single batch
      if (newlyFetched.size > 0) {
        if (onBatchCacheContents) {
          onBatchCacheContents(newlyFetched);
        } else if (onCacheFileContent) {
          newlyFetched.forEach((content, fileId) => onCacheFileContent(fileId, content));
        }
      }

      if (showNotification) {
        if (abortRef.current) {
          showNotification('info', `Compilation paused. ${workingSummaries.size} days are ready and plotted on chart.`);
        } else {
          showNotification('success', `Completed compiling ${completedDays} days of daily peak load data!`);
        }
      }
    } catch (err: any) {
      if (showNotification) {
        showNotification('error', err.message || 'Error during compilation');
      }
    } finally {
      setIsCompiling(false);
      setCompileProgress(null);
    }
  }, [
    uncompiledDates,
    allLoadedSummaries,
    cachedFileContents,
    accessToken,
    parseAndMergeSingleDate,
    onCacheFileContent,
    onBatchCacheContents,
    onUpdateSummaries,
    showNotification,
  ]);

  // 4. Calculate Daily Peak (Maximum MW in 24 Hours) of Each Circuit (and Combine) for each day in selected period
  const peakPoints: DailyPeakLoadPoint[] = useMemo(() => {
    const points: DailyPeakLoadPoint[] = [];

    matchingFolderDates.forEach((d) => {
      const summary = allLoadedSummaries.get(d.dateKey);
      if (!summary || summary.dataPoints.length === 0) return;

      // Extract 24-hour maximum MW across all intervals of the day (00:00 - 24:00)
      let maxCkt2 = 0;
      let timeCkt2 = '00:00';
      let maxCkt3 = 0;
      let timeCkt3 = '00:00';
      let maxNkt = 0;
      let timeNkt = '00:00';
      let maxOil = 0;
      let timeOil = '00:00';
      let maxCombine = 0;
      let timeCombine = '00:00';

      summary.dataPoints.forEach((dp) => {
        if (dp.kmaCircuit2 > maxCkt2) {
          maxCkt2 = dp.kmaCircuit2;
          timeCkt2 = dp.time;
        }
        if (dp.kmbCircuit3 > maxCkt3) {
          maxCkt3 = dp.kmbCircuit3;
          timeCkt3 = dp.time;
        }
        if (dp.knaNkt > maxNkt) {
          maxNkt = dp.knaNkt;
          timeNkt = dp.time;
        }
        if (dp.knaOilFilled > maxOil) {
          maxOil = dp.knaOilFilled;
          timeOil = dp.time;
        }
        if (dp.totalPower > maxCombine) {
          maxCombine = dp.totalPower;
          timeCombine = dp.time;
        }
      });

      points.push({
        dateKey: d.dateKey,
        formattedDate: summary.formattedDate || d.formattedDate,
        day: summary.day || d.day,
        month: summary.month || d.month,
        year: summary.year || d.year,
        peakCircuit2: maxCkt2,
        timeCircuit2: timeCkt2,
        peakCircuit3: maxCkt3,
        timeCircuit3: timeCkt3,
        peakKnaNkt: maxNkt,
        timeKnaNkt: timeNkt,
        peakKnaOil: maxOil,
        timeKnaOil: timeOil,
        peakCombine: maxCombine,
        timeCombine: timeCombine,
        sampleCount: summary.dataPoints.length,
      });
    });

    return points.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [matchingFolderDates, allLoadedSummaries]);

  // Statistics across the selected custom period
  const periodStats = useMemo(() => {
    if (peakPoints.length === 0) return null;

    let maxCombine = 0;
    let maxDate = '';
    let maxTime = '';
    let sumCombine = 0;

    let maxCkt2 = 0;
    let maxCkt3 = 0;
    let maxNkt = 0;
    let maxOil = 0;

    peakPoints.forEach((p) => {
      if (p.peakCombine > maxCombine) {
        maxCombine = p.peakCombine;
        maxDate = p.formattedDate;
        maxTime = p.timeCombine;
      }
      sumCombine += p.peakCombine;

      if (p.peakCircuit2 > maxCkt2) maxCkt2 = p.peakCircuit2;
      if (p.peakCircuit3 > maxCkt3) maxCkt3 = p.peakCircuit3;
      if (p.peakKnaNkt > maxNkt) maxNkt = p.peakKnaNkt;
      if (p.peakKnaOil > maxOil) maxOil = p.peakKnaOil;
    });

    return {
      maxCombine,
      maxDate,
      maxTime,
      avgDailyPeak: sumCombine / peakPoints.length,
      maxCkt2,
      maxCkt3,
      maxNkt,
      maxOil,
      totalDays: peakPoints.length,
    };
  }, [peakPoints]);

  // SVG Chart Geometry
  const svgWidth = 880;
  const svgHeight = 320;
  const padLeft = 65;
  const padRight = 35;
  const padTop = 35;
  const padBottom = 45;

  const chartWidth = svgWidth - padLeft - padRight;
  const chartHeight = svgHeight - padTop - padBottom;

  // Maximum Y ceiling with 15% headroom
  const maxYValue = useMemo(() => {
    if (peakPoints.length === 0) return 100;
    let maxFound = 0;
    peakPoints.forEach((p) => {
      if (visibleCircuits.combine && p.peakCombine > maxFound) maxFound = p.peakCombine;
      if (visibleCircuits.circuit_115kv_2 && p.peakCircuit2 > maxFound) maxFound = p.peakCircuit2;
      if (visibleCircuits.circuit_115kv_3 && p.peakCircuit3 > maxFound) maxFound = p.peakCircuit3;
      if (visibleCircuits.circuit_33kv_nkt && p.peakKnaNkt > maxFound) maxFound = p.peakKnaNkt;
      if (visibleCircuits.circuit_33kv_oil && p.peakKnaOil > maxFound) maxFound = p.peakKnaOil;
    });
    const ceiling = Math.max(30, maxFound * 1.15);
    return Math.ceil(ceiling / 20) * 20;
  }, [peakPoints, visibleCircuits]);

  const yTicks = useMemo(() => {
    const step = maxYValue / 5;
    return [0, step, step * 2, step * 3, step * 4, maxYValue];
  }, [maxYValue]);

  const getYCoord = (val: number) => {
    const ratio = Math.max(0, Math.min(1, val / maxYValue));
    return padTop + chartHeight - ratio * chartHeight;
  };

  const getXCoord = (index: number) => {
    if (peakPoints.length <= 1) {
      return padLeft + chartWidth / 2;
    }
    return padLeft + (index / (peakPoints.length - 1)) * chartWidth;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
      {/* 1. Header with Target Folder Reference & View Mode Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Daily Peak Load SCADA Analysis (4 Circuits + Combine)
            </h3>
            {startDate && endDate && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1 font-mono">
                <Calendar className="w-3 h-3 text-blue-600" />
                <span>{startDate} → {endDate}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Plotting only daily maximum peak load (MW in 24 hours) of each circuit and combine during selected period.
          </p>
        </div>

        {/* View Mode & Folder Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {onScanTargetFolder && (
            <button
              type="button"
              onClick={onScanTargetFolder}
              disabled={isFolderScanning}
              title="Rescan target folder for any newly added CSV files"
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isFolderScanning ? 'animate-spin' : ''}`} />
              <span>{isFolderScanning ? 'Scanning Folder...' : 'Rescan Folder'}</span>
            </button>
          )}

          <div className="flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200/80">
            <button
              type="button"
              onClick={() => setChartMode('trend')}
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                chartMode === 'trend'
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              <span>Trend Lines</span>
            </button>
            <button
              type="button"
              onClick={() => setChartMode('bars')}
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                chartMode === 'bars'
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart2 className="w-3 h-3" />
              <span>Grouped Bars</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Target Folder Reference Banner */}
      <div className="bg-slate-50 rounded-xl px-3.5 py-2.5 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-amber-100 text-amber-800">
            <Folder className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="font-bold text-slate-800">Target Folder Reference: </span>
            <span className="font-mono text-slate-700 font-semibold">{targetFolder.name}</span>
            <span className="text-slate-500 ml-2">
              ({scannedFiles.length} SCADA files • {targetFolderDates.length} distinct days recorded)
            </span>
          </div>
        </div>

        {folderMinDate && folderMaxDate && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Folder Date Coverage:</span>
            <button
              type="button"
              onClick={() => {
                setDatePreset('all');
                setStartDate(folderMinDate);
                setEndDate(folderMaxDate);
              }}
              title="Click to set Custom Filter to folder date bounds"
              className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-white border border-slate-300 text-blue-700 hover:bg-blue-50 transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
            >
              <span>{folderMinDate}</span>
              <span>→</span>
              <span>{folderMaxDate}</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Custom Date Filter (Independent from Daily Transmission Profile) */}
      <div className="bg-gradient-to-r from-blue-50/50 via-slate-50 to-slate-50 rounded-xl p-3.5 border border-blue-200/70 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <CalendarRange className="w-4 h-4 text-blue-600" />
            <span>Custom Date Filter:</span>
            <span className="text-[11px] font-normal text-slate-500">
              Independent Start Date & End Date to analyze 24h daily peak loads
            </span>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyDatePreset('all')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border ${
                datePreset === 'all'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              All in Folder
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('7d')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border ${
                datePreset === '7d'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('14d')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border ${
                datePreset === '14d'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Last 14 Days
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('30d')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border ${
                datePreset === '30d'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Last 30 Days
            </button>
          </div>
        </div>

        {/* Start Date & End Date Pickers Bar */}
        <div className="bg-white rounded-lg p-2.5 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Start Date */}
            <div className="flex items-center gap-2">
              <label htmlFor="peak-filter-start-date" className="font-bold text-slate-700 flex items-center gap-1">
                <span>Start Date:</span>
              </label>
              <input
                id="peak-filter-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setDatePreset('custom');
                  const val = e.target.value;
                  setStartDate(val);
                  if (endDate && val > endDate) {
                    setEndDate(val);
                  }
                }}
                className="bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 font-mono text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>

            <div className="text-slate-400">
              <ArrowRight className="w-3.5 h-3.5" />
            </div>

            {/* End Date */}
            <div className="flex items-center gap-2">
              <label htmlFor="peak-filter-end-date" className="font-bold text-slate-700 flex items-center gap-1">
                <span>End Date:</span>
              </label>
              <input
                id="peak-filter-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setDatePreset('custom');
                  const val = e.target.value;
                  setEndDate(val);
                  if (startDate && val < startDate) {
                    setStartDate(val);
                  }
                }}
                className="bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 font-mono text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>

            {/* Reset to Folder Bounds Button */}
            {folderMinDate && folderMaxDate && (startDate !== folderMinDate || endDate !== folderMaxDate) && (
              <button
                type="button"
                onClick={() => applyDatePreset('all')}
                title="Reset to full target folder range"
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer pl-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to Folder Dates</span>
              </button>
            )}
          </div>

          {/* Period Match Status & Action */}
          <div className="flex items-center gap-2">
            {matchingFolderDates.length > 0 ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{matchingFolderDates.length} days matching in folder</span>
              </span>
            ) : (
              <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>No folder files found between {startDate} and {endDate}</span>
              </span>
            )}

            {/* Compile / Download from Drive Button if needed */}
            {uncompiledDates.length > 0 && (
              <button
                type="button"
                onClick={handleFetchAndCompilePeriod}
                disabled={isCompiling}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isCompiling ? (
                  <Zap className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5" />
                )}
                <span>
                  {isCompiling
                    ? compileProgress
                      ? `Compiling (${compileProgress.current}/${compileProgress.total})...`
                      : 'Turbo Compiling...'
                    : `Analyze Period (${uncompiledDates.length} days)`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Turbo Progress Bar during multi-stream compilation */}
        {isCompiling && compileProgress && (
          <div className="bg-gradient-to-r from-blue-50/90 via-indigo-50/80 to-blue-50/90 rounded-xl p-3 border border-blue-200/90 shadow-2xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded-md bg-blue-600 text-white font-extrabold flex items-center gap-1 text-[10px] tracking-wide shadow-2xs">
                  <Zap className="w-3 h-3 text-amber-300 animate-bounce" />
                  TURBO 8X
                </span>
                <span className="font-semibold text-slate-800">{compileProgress.step}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono font-extrabold text-blue-700 text-sm">
                  {Math.round((compileProgress.current / Math.max(1, compileProgress.total)) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => {
                    abortRef.current = true;
                  }}
                  className="px-2.5 py-1 text-xs font-bold text-rose-600 hover:text-rose-700 bg-white hover:bg-rose-50 rounded-md border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Pause / Stop Compilation (already compiled days remain on chart)"
                >
                  <StopCircle className="w-3.5 h-3.5 text-rose-500" />
                  <span>Stop</span>
                </button>
              </div>
            </div>
            <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 h-2 rounded-full transition-all duration-150"
                style={{
                  width: `${Math.min(100, Math.round((compileProgress.current / Math.max(1, compileProgress.total)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 4. Circuit Toggles Toolbar (Each circuit + Combine) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">
            Display Peak Loads:
          </span>

          {/* Combine Total (Enabled by default) */}
          <button
            type="button"
            onClick={() => toggleCircuit('combine')}
            className={`px-2.5 py-1 text-xs font-extrabold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border ${
              visibleCircuits.combine
                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                : 'bg-white text-slate-400 border-slate-200 line-through'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 shrink-0" />
            <span>Combine (All 4 Circuits)</span>
          </button>

          {/* 4 Individual Circuits */}
          {POWER_CIRCUITS.map((ckt) => {
            const isVis = visibleCircuits[ckt.id];
            return (
              <button
                key={ckt.id}
                type="button"
                onClick={() => toggleCircuit(ckt.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border ${
                  isVis
                    ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                    : 'bg-white text-slate-400 border-slate-200 line-through'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: ckt.color }}
                />
                <span>{ckt.shortName}</span>
              </button>
            );
          })}
        </div>

        <span className="text-xs text-slate-500 font-mono">
          {peakPoints.length} Days Plotted in Custom Period
        </span>
      </div>

      {/* 5. SVG Daily Peak Chart */}
      <div className="relative border border-slate-200/90 rounded-2xl bg-gradient-to-b from-white to-slate-50/50 p-2 sm:p-4 shadow-2xs overflow-hidden">
        {peakPoints.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
            <Info className="w-8 h-8 text-slate-400" />
            <p className="text-xs font-bold text-slate-700">No daily peak records ready for this custom date period.</p>
            <p className="text-[11px] text-slate-500 max-w-md">
              Target folder contains files from <strong className="font-mono text-slate-800">{folderMinDate || 'N/A'}</strong> to{' '}
              <strong className="font-mono text-slate-800">{folderMaxDate || 'N/A'}</strong>.
            </p>
            {folderMinDate && folderMaxDate && (
              <button
                type="button"
                onClick={() => applyDatePreset('all')}
                className="mt-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Set Filter to Available Dates ({folderMinDate} → {folderMaxDate})
              </button>
            )}
          </div>
        ) : (
          <div className="relative">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto overflow-visible select-none"
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <defs>
                {/* Gradient for Combine Peak Fill */}
                <linearGradient id="combinePeakGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f172a" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines & Y-axis Labels */}
              {yTicks.map((val) => {
                const y = getYCoord(val);
                return (
                  <g key={val} className="text-slate-400">
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray={val === 0 ? '0' : '4 4'}
                      strokeWidth={val === 0 ? '1.5' : '1'}
                    />
                    <text
                      x={padLeft - 10}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="600"
                      fill="#64748b"
                    >
                      {val.toFixed(0)} MW
                    </text>
                  </g>
                );
              })}

              {/* X-axis baseline */}
              <line
                x1={padLeft}
                y1={padTop + chartHeight}
                x2={svgWidth - padRight}
                y2={padTop + chartHeight}
                stroke="#94a3b8"
                strokeWidth="1.5"
              />

              {/* X-axis Date Labels */}
              {peakPoints.map((point, idx) => {
                const x = getXCoord(idx);
                const isSelected = selectedProfileDateKey === point.dateKey;
                const isHovered = hoveredIndex === idx;

                // For readability: if there are many days, skip some labels
                const showLabel =
                  peakPoints.length <= 15 ||
                  idx === 0 ||
                  idx === peakPoints.length - 1 ||
                  idx % Math.ceil(peakPoints.length / 12) === 0;

                return (
                  <g
                    key={point.dateKey}
                    className="cursor-pointer"
                    onClick={() => onSelectDateForProfile && onSelectDateForProfile(point.dateKey)}
                  >
                    {/* Vertical guideline */}
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + chartHeight}
                      stroke={isSelected ? '#3b82f6' : isHovered ? '#94a3b8' : '#f1f5f9'}
                      strokeWidth={isSelected ? '2' : isHovered ? '1.5' : '1'}
                      strokeDasharray={isSelected ? '0' : '3 3'}
                    />

                    {/* Date label */}
                    {showLabel && (
                      <text
                        x={x}
                        y={padTop + chartHeight + 18}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight={isSelected || isHovered ? '700' : '600'}
                        fill={isSelected ? '#1d4ed8' : isHovered ? '#0f172a' : '#64748b'}
                        fontFamily="sans-serif"
                      >
                        {point.formattedDate.replace(/\s\d{4}$/, '')}
                      </text>
                    )}

                    {/* Badge if selected in daily profile */}
                    {isSelected && (
                      <circle
                        cx={x}
                        cy={padTop + chartHeight + 28}
                        r="3"
                        fill="#2563eb"
                      />
                    )}
                  </g>
                );
              })}

              {/* MODE 1: TREND LINES */}
              {chartMode === 'trend' && peakPoints.length > 1 && (
                <>
                  {/* Combine Area & Line */}
                  {visibleCircuits.combine && (
                    <g>
                      <path
                        d={`M ${getXCoord(0)} ${getYCoord(0)} ${peakPoints
                          .map((p, i) => `L ${getXCoord(i)} ${getYCoord(p.peakCombine)}`)
                          .join(' ')} L ${getXCoord(peakPoints.length - 1)} ${getYCoord(0)} Z`}
                        fill="url(#combinePeakGradient)"
                      />
                      <path
                        d={`M ${peakPoints
                          .map((p, i) => `${getXCoord(i)} ${getYCoord(p.peakCombine)}`)
                          .join(' L ')}`}
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  )}

                  {/* 115 kV Ckt #2 (Royal Blue) */}
                  {visibleCircuits.circuit_115kv_2 && (
                    <path
                      d={`M ${peakPoints
                        .map((p, i) => `${getXCoord(i)} ${getYCoord(p.peakCircuit2)}`)
                        .join(' L ')}`}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* 115 kV Ckt #3 (Violet) */}
                  {visibleCircuits.circuit_115kv_3 && (
                    <path
                      d={`M ${peakPoints
                        .map((p, i) => `${getXCoord(i)} ${getYCoord(p.peakCircuit3)}`)
                        .join(' L ')}`}
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* 33 kV NKT (Emerald) */}
                  {visibleCircuits.circuit_33kv_nkt && (
                    <path
                      d={`M ${peakPoints
                        .map((p, i) => `${getXCoord(i)} ${getYCoord(p.peakKnaNkt)}`)
                        .join(' L ')}`}
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* 33 kV Oil Filled (Amber) */}
                  {visibleCircuits.circuit_33kv_oil && (
                    <path
                      d={`M ${peakPoints
                        .map((p, i) => `${getXCoord(i)} ${getYCoord(p.peakKnaOil)}`)
                        .join(' L ')}`}
                      fill="none"
                      stroke="#d97706"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </>
              )}

              {/* MODE 2: GROUPED BARS */}
              {chartMode === 'bars' && (
                <g>
                  {peakPoints.map((point, idx) => {
                    const groupCenterX = getXCoord(idx);
                    const barWidth = Math.max(3, Math.min(12, chartWidth / (peakPoints.length * 6)));
                    const spacing = 1.5;

                    const activeBars: Array<{ id: string; val: number; color: string }> = [];
                    if (visibleCircuits.combine)
                      activeBars.push({ id: 'comb', val: point.peakCombine, color: '#0f172a' });
                    if (visibleCircuits.circuit_115kv_2)
                      activeBars.push({ id: 'c2', val: point.peakCircuit2, color: '#2563eb' });
                    if (visibleCircuits.circuit_115kv_3)
                      activeBars.push({ id: 'c3', val: point.peakCircuit3, color: '#8b5cf6' });
                    if (visibleCircuits.circuit_33kv_nkt)
                      activeBars.push({ id: 'nkt', val: point.peakKnaNkt, color: '#059669' });
                    if (visibleCircuits.circuit_33kv_oil)
                      activeBars.push({ id: 'oil', val: point.peakKnaOil, color: '#d97706' });

                    const totalGroupWidth = activeBars.length * (barWidth + spacing) - spacing;
                    const startX = groupCenterX - totalGroupWidth / 2;

                    return (
                      <g key={point.dateKey}>
                        {activeBars.map((bar, barIdx) => {
                          const barX = startX + barIdx * (barWidth + spacing);
                          const barY = getYCoord(bar.val);
                          const barH = padTop + chartHeight - barY;

                          return (
                            <rect
                              key={bar.id}
                              x={barX}
                              y={barY}
                              width={barWidth}
                              height={Math.max(1, barH)}
                              fill={bar.color}
                              rx="1.5"
                              className="transition-all opacity-90 hover:opacity-100"
                            />
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              )}

              {/* Interactive Data Markers on Trend Mode */}
              {chartMode === 'trend' &&
                peakPoints.map((point, idx) => {
                  const x = getXCoord(idx);
                  const isHovered = hoveredIndex === idx;
                  const isSelected = selectedProfileDateKey === point.dateKey;

                  return (
                    <g key={point.dateKey}>
                      {/* Combine Marker */}
                      {visibleCircuits.combine && (
                        <circle
                          cx={x}
                          cy={getYCoord(point.peakCombine)}
                          r={isHovered || isSelected ? '5' : '3.5'}
                          fill="#0f172a"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      )}

                      {/* 115 kV Ckt #2 Marker */}
                      {visibleCircuits.circuit_115kv_2 && (
                        <circle
                          cx={x}
                          cy={getYCoord(point.peakCircuit2)}
                          r={isHovered || isSelected ? '4.5' : '3'}
                          fill="#2563eb"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      )}

                      {/* 115 kV Ckt #3 Marker */}
                      {visibleCircuits.circuit_115kv_3 && (
                        <circle
                          cx={x}
                          cy={getYCoord(point.peakCircuit3)}
                          r={isHovered || isSelected ? '4.5' : '3'}
                          fill="#8b5cf6"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      )}

                      {/* 33 kV NKT Marker */}
                      {visibleCircuits.circuit_33kv_nkt && (
                        <circle
                          cx={x}
                          cy={getYCoord(point.peakKnaNkt)}
                          r={isHovered || isSelected ? '4.5' : '3'}
                          fill="#059669"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      )}

                      {/* 33 kV Oil Marker */}
                      {visibleCircuits.circuit_33kv_oil && (
                        <circle
                          cx={x}
                          cy={getYCoord(point.peakKnaOil)}
                          r={isHovered || isSelected ? '4.5' : '3'}
                          fill="#d97706"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      )}

                      {/* Invisible Hover Rect */}
                      <rect
                        x={x - chartWidth / Math.max(1, peakPoints.length * 2)}
                        y={padTop}
                        width={chartWidth / Math.max(1, peakPoints.length)}
                        height={chartHeight}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredIndex(idx)}
                        onClick={() => onSelectDateForProfile && onSelectDateForProfile(point.dateKey)}
                      />
                    </g>
                  );
                })}
            </svg>

            {/* Floating SCADA Tooltip */}
            {hoveredIndex !== null && peakPoints[hoveredIndex] && (
              <div
                className="absolute z-20 top-2 pointer-events-none transition-all duration-75"
                style={{
                  left: `${(getXCoord(hoveredIndex) / svgWidth) * 100}%`,
                  transform:
                    getXCoord(hoveredIndex) > svgWidth * 0.7
                      ? 'translateX(-105%)'
                      : 'translateX(10px)',
                }}
              >
                <div className="bg-slate-900/95 text-white backdrop-blur-md px-3.5 py-3 rounded-xl shadow-xl border border-slate-700/60 text-xs w-64 space-y-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                    <span className="font-bold text-slate-100">
                      {peakPoints[hoveredIndex].formattedDate}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900/80 text-blue-300">
                      24h Daily Peak
                    </span>
                  </div>

                  <div className="space-y-1 font-mono text-[11px]">
                    {visibleCircuits.circuit_115kv_2 && (
                      <div className="flex items-center justify-between">
                        <span className="text-blue-400 font-sans font-semibold">115 kV Ckt #2:</span>
                        <span>
                          <strong>{peakPoints[hoveredIndex].peakCircuit2.toFixed(2)} MW</strong>{' '}
                          <span className="text-[10px] text-slate-400">@{peakPoints[hoveredIndex].timeCircuit2}</span>
                        </span>
                      </div>
                    )}

                    {visibleCircuits.circuit_115kv_3 && (
                      <div className="flex items-center justify-between">
                        <span className="text-violet-400 font-sans font-semibold">115 kV Ckt #3:</span>
                        <span>
                          <strong>{peakPoints[hoveredIndex].peakCircuit3.toFixed(2)} MW</strong>{' '}
                          <span className="text-[10px] text-slate-400">@{peakPoints[hoveredIndex].timeCircuit3}</span>
                        </span>
                      </div>
                    )}

                    {visibleCircuits.circuit_33kv_nkt && (
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-400 font-sans font-semibold">33 kV NKT:</span>
                        <span>
                          <strong>{peakPoints[hoveredIndex].peakKnaNkt.toFixed(2)} MW</strong>{' '}
                          <span className="text-[10px] text-slate-400">@{peakPoints[hoveredIndex].timeKnaNkt}</span>
                        </span>
                      </div>
                    )}

                    {visibleCircuits.circuit_33kv_oil && (
                      <div className="flex items-center justify-between">
                        <span className="text-amber-400 font-sans font-semibold">33 kV Oil:</span>
                        <span>
                          <strong>{peakPoints[hoveredIndex].peakKnaOil.toFixed(2)} MW</strong>{' '}
                          <span className="text-[10px] text-slate-400">@{peakPoints[hoveredIndex].timeKnaOil}</span>
                        </span>
                      </div>
                    )}

                    {visibleCircuits.combine && (
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-white font-bold">
                        <span className="text-slate-200 font-sans">Combine Peak:</span>
                        <span className="text-yellow-300">
                          {peakPoints[hoveredIndex].peakCombine.toFixed(2)} MW{' '}
                          <span className="text-[10px] text-slate-400">@{peakPoints[hoveredIndex].timeCombine}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-400 pt-0.5 text-center italic">
                    Click date to inspect 24h transmission profile
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 6. Custom Date Period Summary KPIs */}
      {periodStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Period Maximum Peak (Combine)
            </div>
            <div className="text-lg font-mono font-extrabold text-slate-900 mt-0.5">
              {periodStats.maxCombine.toFixed(2)}{' '}
              <span className="text-xs text-slate-500 font-normal">MW</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {periodStats.maxDate} at {periodStats.maxTime}
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Avg Daily 24h Peak in Period
            </div>
            <div className="text-lg font-mono font-extrabold text-blue-600 mt-0.5">
              {periodStats.avgDailyPeak.toFixed(2)}{' '}
              <span className="text-xs text-slate-500 font-normal">MW</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Across {periodStats.totalDays} days in custom period
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              115 kV Peak Max (Ckt #2 / #3)
            </div>
            <div className="text-lg font-mono font-extrabold text-indigo-600 mt-0.5">
              {periodStats.maxCkt2.toFixed(1)} / {periodStats.maxCkt3.toFixed(1)}{' '}
              <span className="text-xs text-slate-500 font-normal">MW</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Headroom: {(100 - periodStats.maxCkt2).toFixed(1)} / {(100 - periodStats.maxCkt3).toFixed(1)} MW
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              33 kV Peak Max (NKT / Oil)
            </div>
            <div className="text-lg font-mono font-extrabold text-emerald-600 mt-0.5">
              {periodStats.maxNkt.toFixed(1)} / {periodStats.maxOil.toFixed(1)}{' '}
              <span className="text-xs text-slate-500 font-normal">MW</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Headroom: {(25 - periodStats.maxNkt).toFixed(1)} / {(25 - periodStats.maxOil).toFixed(1)} MW
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
