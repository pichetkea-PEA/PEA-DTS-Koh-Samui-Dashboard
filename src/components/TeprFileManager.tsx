import React, { useMemo, useState, useEffect } from 'react';
import { 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Calendar, 
  Clock, 
  Layers, 
  RefreshCw, 
  FolderOpen, 
  Filter, 
  Search, 
  ChevronRight, 
  RotateCcw, 
  Zap, 
  PlusCircle, 
  Eye, 
  Check, 
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Activity,
  HardDrive,
  Thermometer,
  CalendarDays,
  Target
} from 'lucide-react';
import { 
  ParsedTeprFile, 
  CablePhaseType, 
  ScannedFileMeta
} from '../services/teprParser';
import { DriveFile } from '../types';

interface TeprFileManagerProps {
  files: DriveFile[];
  parsedFiles: ParsedTeprFile[];
  filteredParsedFiles: ParsedTeprFile[];
  scannedFiles: ScannedFileMeta[];
  isScanning: boolean;
  isReadingTemperature: boolean;
  hasReadTemperature: boolean;
  currentFiltersLoaded: boolean;
  onReadTemperature: () => void;
  activeFileId: string | null;
  onSelectFile: (fileId: string) => void;
  onRunAnalyzeAll: () => void;
  isProcessing: boolean;
  isLoadingFiles?: boolean;
  loadingProgress?: { loaded: number; total: number; fileName: string } | null;
  onGenerateSampleFiles: () => void;
  isGeneratingSamples: boolean;
  
  // Revised 3 Cascading Dropdown Filters: Year, Month, Date
  selectedYearFilter: string;
  onYearFilterChange: (year: string) => void;
  selectedMonthFilter: string;
  onMonthFilterChange: (month: string) => void;
  selectedDateFilter: string;
  onDateFilterChange: (date: string) => void;
  
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onResetFilters: () => void;
}

export const TeprFileManager: React.FC<TeprFileManagerProps> = ({
  files,
  parsedFiles,
  filteredParsedFiles,
  scannedFiles,
  isScanning,
  isReadingTemperature,
  hasReadTemperature,
  currentFiltersLoaded,
  onReadTemperature,
  activeFileId,
  onSelectFile,
  onRunAnalyzeAll,
  isProcessing,
  isLoadingFiles = false,
  loadingProgress = null,
  onGenerateSampleFiles,
  isGeneratingSamples,
  selectedYearFilter,
  onYearFilterChange,
  selectedMonthFilter,
  onMonthFilterChange,
  selectedDateFilter,
  onDateFilterChange,
  searchQuery,
  onSearchQueryChange,
  onResetFilters,
}) => {
  // 1. DROPDOWN 1: Available Years from scanned folder/file metadata
  const availableYears = useMemo(() => {
    const yearMap = new Map<number, number>();
    scannedFiles.forEach((file) => {
      const y = file.dateMeta?.year || 2026;
      yearMap.set(y, (yearMap.get(y) || 0) + 1);
    });

    return Array.from(yearMap.entries())
      .map(([year, count]) => ({ year: String(year), count }))
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [scannedFiles]);

  // Files matching Priority 1: Year
  const filesForActiveYear = useMemo(() => {
    if (selectedYearFilter === 'all') return scannedFiles;
    return scannedFiles.filter((f) => String(f.dateMeta?.year || 2026) === selectedYearFilter);
  }, [scannedFiles, selectedYearFilter]);

  // 2. DROPDOWN 2: Available Months (Cascaded from Priority 1: Year)
  const availableMonths = useMemo(() => {
    const monthMap = new Map<number, { num: number; name: string; count: number }>();

    filesForActiveYear.forEach((file) => {
      const m = file.dateMeta?.month || 8;
      const name = file.dateMeta?.monthName || `Month ${m}`;
      if (!monthMap.has(m)) {
        monthMap.set(m, { num: m, name, count: 0 });
      }
      monthMap.get(m)!.count += 1;
    });

    return Array.from(monthMap.values())
      .sort((a, b) => a.num - b.num)
      .map((m) => ({
        key: String(m.num),
        label: m.name,
        count: m.count,
      }));
  }, [filesForActiveYear]);

  // Files matching Priority 1 + Priority 2: Year & Month
  const filesForActiveYearAndMonth = useMemo(() => {
    if (selectedMonthFilter === 'all') return filesForActiveYear;
    return filesForActiveYear.filter((f) => String(f.dateMeta?.month || 8) === selectedMonthFilter);
  }, [filesForActiveYear, selectedMonthFilter]);

  // 3. DROPDOWN 3: Available Dates (Cascaded from Priority 1 & 2: Year & Month)
  const availableDates = useMemo(() => {
    const dateMap = new Map<string, { dateKey: string; formattedDate: string; count: number }>();

    filesForActiveYearAndMonth.forEach((file) => {
      const dKey = file.dateMeta?.dateKey || '2026-08-01';
      const label = file.dateMeta?.formattedDate || dKey;
      if (!dateMap.has(dKey)) {
        dateMap.set(dKey, { dateKey: dKey, formattedDate: label, count: 0 });
      }
      dateMap.get(dKey)!.count += 1;
    });

    return Array.from(dateMap.values())
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .map((d) => ({
        key: d.dateKey,
        label: d.formattedDate,
        count: d.count,
      }));
  }, [filesForActiveYearAndMonth]);

  // FOCUS PATH: Files matching Year, Month, and Date
  const focusScannedFiles = useMemo(() => {
    if (selectedDateFilter === 'all') return filesForActiveYearAndMonth;
    return filesForActiveYearAndMonth.filter((f) => f.dateMeta?.dateKey === selectedDateFilter);
  }, [filesForActiveYearAndMonth, selectedDateFilter]);

  // Map of already parsed files by fileId for quick status lookup
  const parsedFilesMap = useMemo(() => {
    const map = new Map<string, ParsedTeprFile>();
    parsedFiles.forEach((pf) => map.set(pf.fileId, pf));
    return map;
  }, [parsedFiles]);

  const parsedFilesInFocus = useMemo(() => {
    return focusScannedFiles.filter((sf) => parsedFilesMap.has(sf.fileId));
  }, [focusScannedFiles, parsedFilesMap]);

  // Search filter applied within current focus set
  const matchingScannedFiles = useMemo(() => {
    if (!searchQuery.trim()) return focusScannedFiles;
    const q = searchQuery.toLowerCase();
    return focusScannedFiles.filter((file) => {
      const matchesName = file.fileName.toLowerCase().includes(q);
      const matchesDate = file.dateMeta?.formattedDate.toLowerCase().includes(q);
      const matchesTime = file.dateMeta?.formattedTime?.includes(q);
      const matchesSubfolder = file.subfolderName?.toLowerCase().includes(q);
      const matchesPhase = file.cablePhase?.toLowerCase().includes(q);
      return matchesName || matchesDate || matchesTime || matchesSubfolder || matchesPhase;
    });
  }, [focusScannedFiles, searchQuery]);

  const [visibleLimit, setVisibleLimit] = useState(500);
  const [isFilesListMinimized, setIsFilesListMinimized] = useState(true);

  useEffect(() => {
    setVisibleLimit(500);
  }, [selectedYearFilter, selectedMonthFilter, selectedDateFilter, searchQuery]);

  const displayedFiles = useMemo(() => {
    return matchingScannedFiles.slice(0, visibleLimit);
  }, [matchingScannedFiles, visibleLimit]);

  const getActiveYearLabel = () => {
    if (selectedYearFilter === 'all') return 'All Years';
    return `Year ${selectedYearFilter}`;
  };

  const getActiveMonthLabel = () => {
    if (selectedMonthFilter === 'all') return 'All Months';
    const found = availableMonths.find((m) => m.key === selectedMonthFilter);
    return found ? found.label : `Month ${selectedMonthFilter}`;
  };

  const getActiveDateLabel = () => {
    if (selectedDateFilter === 'all') return 'All Dates in Month';
    const found = availableDates.find((d) => d.key === selectedDateFilter);
    return found ? found.label : selectedDateFilter;
  };

  const hasActiveFilters = 
    selectedYearFilter !== 'all' || 
    selectedMonthFilter !== 'all' || 
    selectedDateFilter !== 'all' || 
    searchQuery.trim() !== '';

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col space-y-0">
      {/* Top Header Bar */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            Autonomous Asset & Phase Management
          </div>
          <div className="text-sm font-bold text-slate-900 mt-0.5 flex flex-wrap items-center gap-2">
            <span>Cascading Scanned Path:</span>
            <span className="text-blue-700 font-semibold">1. Year</span>
            <span className="text-slate-400">➔</span>
            <span className="text-indigo-700 font-semibold">2. Month</span>
            <span className="text-slate-400">➔</span>
            <span className="text-emerald-700 font-semibold">3. Date</span>
            <span className="text-xs font-normal text-slate-500 ml-1">
              ({scannedFiles.length} files scanned in directory)
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGenerateSampleFiles}
            disabled={isGeneratingSamples}
            className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100/80 border border-blue-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Generate multi-phase sample .TEPR files in the active Google Drive folder"
          >
            {isGeneratingSamples ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlusCircle className="w-3.5 h-3.5" />
            )}
            <span>Generate Multi-Phase Sample Files</span>
          </button>

          <button
            type="button"
            onClick={onRunAnalyzeAll}
            disabled={isProcessing || parsedFiles.length === 0}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Evaluating Cable Profile...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Evaluate Cable Profile</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Temperature Reading / Indexing Progress Bar Banner */}
      {(isReadingTemperature || (isLoadingFiles && loadingProgress)) && loadingProgress && (
        <div className="bg-blue-50/90 border-b border-blue-200/80 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
            <span className="font-semibold text-blue-900">
              {isReadingTemperature ? 'Reading Focus Temperature Profiles' : 'Indexing Folder & File Names'}: {loadingProgress.loaded} of {loadingProgress.total} files (
              {loadingProgress.total > 0 ? Math.round((loadingProgress.loaded / loadingProgress.total) * 100) : 0}%)
            </span>
            <span className="text-blue-600 truncate max-w-xs font-mono text-[11px]">
              {loadingProgress.fileName}
            </span>
          </div>
          <div className="w-full sm:w-48 bg-blue-200/70 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-600 h-full transition-all duration-150 rounded-full"
              style={{ 
                width: `${loadingProgress.total > 0 ? Math.round((loadingProgress.loaded / loadingProgress.total) * 100) : 0}%` 
              }}
            />
          </div>
        </div>
      )}

      {/* REVISED: 3 Cascading Dropdown Filter Section (Year -> Month -> Date) */}
      <div className="p-4 bg-slate-50/70 border-b border-slate-200/60 space-y-3.5">
        
        {/* The 3 Related Dropdown Selectors Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          
          {/* Dropdown 1: Year (Priority 1) */}
          <div className="space-y-1.5 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <label 
                htmlFor="year-filter-select"
                className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
              >
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                <span>Year (Priority 1)</span>
              </label>
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
            </div>

            <div className="relative">
              <select
                id="year-filter-select"
                value={selectedYearFilter}
                onChange={(e) => onYearFilterChange(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
              >
                <option value="all">All Years ({scannedFiles.length} files)</option>
                {availableYears.map((y) => (
                  <option key={y.year} value={y.year}>
                    {y.year} ({y.count} files)
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            <div className="text-[10px] text-slate-500 flex items-center justify-between">
              <span>Scanned from folder/file</span>
              <span className="font-semibold text-slate-700">
                {selectedYearFilter === 'all' ? `${scannedFiles.length} total` : `${filesForActiveYear.length} in year`}
              </span>
            </div>
          </div>

          {/* Dropdown 2: Month (Priority 2 - Cascaded from Year) */}
          <div className="space-y-1.5 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <label 
                htmlFor="month-filter-select"
                className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
              >
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                <span>Month (Priority 2)</span>
              </label>
              <CalendarDays className="w-3.5 h-3.5 text-indigo-600" />
            </div>

            <div className="relative">
              <select
                id="month-filter-select"
                value={selectedMonthFilter}
                onChange={(e) => onMonthFilterChange(e.target.value)}
                disabled={filesForActiveYear.length === 0}
                className="w-full appearance-none pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer disabled:opacity-50"
              >
                <option value="all">
                  All Months in Year ({filesForActiveYear.length} files)
                </option>
                {availableMonths.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.count} file{m.count > 1 ? 's' : ''})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            <div className="text-[10px] text-slate-500 flex items-center justify-between">
              <span className="truncate">Synchronized to {getActiveYearLabel()}</span>
              <span className="font-semibold text-slate-700">{availableMonths.length} month{availableMonths.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Dropdown 3: Date (Priority 3 - Cascaded from Year & Month) */}
          <div className="space-y-1.5 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <label 
                htmlFor="date-filter-select"
                className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
              >
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold">3</span>
                <span>Date (Priority 3)</span>
              </label>
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
            </div>

            <div className="relative">
              <select
                id="date-filter-select"
                value={selectedDateFilter}
                onChange={(e) => onDateFilterChange(e.target.value)}
                disabled={filesForActiveYearAndMonth.length === 0}
                className="w-full appearance-none pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all cursor-pointer disabled:opacity-50"
              >
                <option value="all">
                  All Dates in Month ({filesForActiveYearAndMonth.length} files)
                </option>
                {availableDates.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label} ({d.count} file{d.count > 1 ? 's' : ''})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            <div className="text-[10px] text-slate-500 flex items-center justify-between">
              <span className="truncate">Month: {getActiveMonthLabel()}</span>
              <span className="font-semibold text-slate-700">{availableDates.length} date{availableDates.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        {/* The "Reading Temperature" Action & Focus Path Banner */}
        <div className="bg-slate-100/90 p-3.5 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              currentFiltersLoaded 
                ? 'bg-emerald-100 text-emerald-700' 
                : 'bg-blue-100 text-blue-700 animate-pulse'
            }`}>
              <Thermometer className="w-5 h-5" />
            </div>
            <div>
              {currentFiltersLoaded ? (
                <div className="font-semibold text-emerald-800 flex items-center gap-1.5 text-xs sm:text-sm">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Temperature Profiles Loaded ({parsedFilesInFocus.length} files parsed)</span>
                </div>
              ) : (
                <div className="font-bold text-slate-800 text-xs sm:text-sm flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-blue-600" />
                  <span>Target Focus Area: {focusScannedFiles.length} files selected for temperature reading</span>
                </div>
              )}
              <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-700">Focus Path:</span>
                <span className="font-medium text-slate-800">{getActiveYearLabel()}</span>
                <span>➔</span>
                <span className="font-medium text-slate-800">{getActiveMonthLabel()}</span>
                <span>➔</span>
                <span className="font-bold text-blue-700">{getActiveDateLabel()}</span>
                <span className="text-slate-400">|</span>
                <span className="text-slate-600">Reads strictly within this path to maximize loading speed</span>
              </div>
            </div>
          </div>

          <button
            id="reading-temperature-btn"
            type="button"
            onClick={() => onReadTemperature()}
            disabled={isReadingTemperature || isScanning || focusScannedFiles.length === 0}
            className={`px-5 py-2.5 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md shrink-0 ${
              currentFiltersLoaded 
                ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border border-slate-300/60 shadow-xs' 
                : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-blue-500/25 animate-pulse'
            }`}
          >
            {isReadingTemperature ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Reading Focus Temperature...</span>
              </>
            ) : (
              <>
                <Thermometer className="w-4 h-4" />
                <span>{currentFiltersLoaded ? `Re-read Focus (${focusScannedFiles.length} files)` : `Reading Temperature (${focusScannedFiles.length} files)`}</span>
              </>
            )}
          </button>
        </div>

        {/* Filter Status Trail & Search Bar */}
        <div className="pt-2 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Active Cascade Pathway Badges */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-500">Active Path:</span>
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-medium text-[11px]">
              1. {getActiveYearLabel()}
            </span>
            <ChevronRight className="w-3 h-3 text-slate-400" />
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 font-medium text-[11px]">
              2. {getActiveMonthLabel()}
            </span>
            <ChevronRight className="w-3 h-3 text-slate-400" />
            <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium text-[11px]">
              3. {getActiveDateLabel()}
            </span>
            {currentFiltersLoaded && (
              <span className="ml-2 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold text-[10px]">
                Phase selector unlocked in Chart below ↓
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Search query input */}
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                placeholder="Search file name or time..."
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={onResetFilters}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Reset filters"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Files List Table - Minimized by default on Page 1 with Toggle to Expand/Minimize */}
      <div className="p-3.5 px-4 bg-slate-50/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 gap-2">
          <div className="font-semibold text-slate-700 flex flex-wrap items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Files in Target Focus Area</span>
            <span className="px-2 py-0.5 rounded-full bg-white text-slate-600 text-[11px] font-medium border border-slate-200">
              {matchingScannedFiles.length} file{matchingScannedFiles.length !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-200/60 font-medium text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Read: {parsedFilesInFocus.length}</span>
            </span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md border border-slate-200/60 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>Pending: {focusScannedFiles.length - parsedFilesInFocus.length}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsFilesListMinimized(!isFilesListMinimized)}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs self-start sm:self-auto"
          >
            {isFilesListMinimized ? (
              <>
                <Eye className="w-3.5 h-3.5 text-blue-600" />
                <span>Show Files in Target Focus Area ({matchingScannedFiles.length})</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                <span>Minimize Files List</span>
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              </>
            )}
          </button>
        </div>

        {!isFilesListMinimized && (
          <div className="mt-3">
            {matchingScannedFiles.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs">
                No files match the selected Year ({getActiveYearLabel()}), Month ({getActiveMonthLabel()}), and Date ({getActiveDateLabel()}).
              </div>
            ) : (
              <div className="relative border border-slate-200/80 rounded-xl overflow-hidden shadow-2xs">
                {/* Scrollable Viewport with reduced height and smooth scrollbar */}
                <div className="max-h-72 sm:max-h-80 overflow-y-auto overflow-x-auto custom-scrollbar bg-white">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider z-10 shadow-2xs">
                      <tr>
                        <th className="py-2.5 px-3 bg-slate-50/95">File Name</th>
                        <th className="py-2.5 px-3 bg-slate-50/95">Date & Time</th>
                        <th className="py-2.5 px-3 bg-slate-50/95">Subfolder / Path</th>
                        <th className="py-2.5 px-3 bg-slate-50/95">Cable Phase</th>
                        <th className="py-2.5 px-3 bg-slate-50/95">Temperature Reading Status</th>
                        <th className="py-2.5 px-3 text-right bg-slate-50/95">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {displayedFiles.map((file) => {
                        const isParsed = parsedFilesMap.has(file.fileId);
                        const parsedData = parsedFilesMap.get(file.fileId);
                        const isSelected = activeFileId === file.fileId;

                        return (
                          <tr 
                            key={file.fileId}
                            onClick={() => onSelectFile(file.fileId)}
                            className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                              isSelected ? 'bg-blue-50/70 font-medium' : ''
                            }`}
                          >
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-800">
                              <div className="flex items-center gap-2">
                                <FileText className={`w-3.5 h-3.5 shrink-0 ${isParsed ? 'text-emerald-600' : 'text-slate-400'}`} />
                                <span className="truncate max-w-[220px]" title={file.fileName}>
                                  {file.fileName}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                              {file.dateMeta?.formattedDate} {file.dateMeta?.formattedTime}
                            </td>
                            <td className="py-2 px-3 text-slate-500 font-mono text-[10px] whitespace-nowrap">
                              {file.subfolderName || file.folderPath || 'Root Folder'}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                file.cablePhase === 'Phase A' ? 'bg-rose-100 text-rose-800' :
                                file.cablePhase === 'Phase B' ? 'bg-amber-100 text-amber-800' :
                                file.cablePhase === 'Phase C' ? 'bg-blue-100 text-blue-800' :
                                file.cablePhase === 'Submarine Cable' ? 'bg-teal-100 text-teal-800' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {file.cablePhase || 'Unassigned'}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {isParsed && parsedData ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>Read (Peak: +{parsedData.maxDeltaTemp.toFixed(2)}°C)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  <span>Pending Reading</span>
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectFile(file.fileId);
                                }}
                                className={`p-1 rounded hover:bg-slate-200 transition-colors ${
                                  isSelected ? 'text-blue-600' : 'text-slate-400'
                                }`}
                                title="View Profile Details"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Scroll view footer indicator */}
                <div className="bg-slate-50 px-3 py-1.5 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Showing {displayedFiles.length} of {matchingScannedFiles.length} files in target focus</span>
                  {displayedFiles.length < matchingScannedFiles.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleLimit((prev) => prev + 500)}
                      className="font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                    >
                      Load more files ({matchingScannedFiles.length - displayedFiles.length} remaining)
                    </button>
                  ) : (
                    <span className="text-slate-400">Scroll down to view all records ↕</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
