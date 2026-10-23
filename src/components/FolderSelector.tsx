import React, { useState, useEffect } from 'react';
import {
  Folder,
  ChevronRight,
  HardDrive,
  Check,
  RefreshCw,
  FolderOpen,
  X,
  Search,
  Sparkles,
  Zap,
  Calendar,
  CheckCircle2,
  AlertCircle,
  FolderSearch,
  Pin,
  PinOff,
  BookmarkCheck,
  Star,
  Thermometer,
  Database,
  FileSpreadsheet
} from 'lucide-react';
import { DriveFolder } from '../types';
import { fetchDriveFolders, findDriveFoldersByNames, isDriveAuthError } from '../services/driveApi';
import {
  getLatestAccessTokenSync,
  isAccessTokenExpired,
  refreshGoogleAccessToken,
} from '../services/firebaseAuth';
import { SubstationCode, DailyPowerSummary } from '../services/powerConsumptionParser';

export interface PowerSubstationFoldersConfig {
  parentFolder: DriveFolder;
  KMB: DriveFolder; // 115 kV Circuit #3 · Column G "03YB01" (minus -> positive)
  KMA: DriveFolder; // 115 kV Circuit #2 · Column I "04YB01" (minus -> positive)
  KNA: DriveFolder; // 33 kV NKT (Col N "07WB01", +) & 33 kV Oil-filled (Col P "10WB01", +)
}

interface FolderSelectorProps {
  accessToken: string;
  currentFolder: DriveFolder;
  onSelectFolder: (folder: DriveFolder, isPermanent?: boolean) => void;
  onRefresh: () => void;
  isLoading: boolean;
  // Permanent target folder support for fiber optic temperature
  permanentFolder?: DriveFolder | null;
  onSetPermanentFolder?: (folder: DriveFolder | null) => void;
  // Power Consumption Target Folders (Configured ONLY in Page 1 "Folder & Asset")
  powerFolders?: PowerSubstationFoldersConfig;
  onUpdatePowerFolders?: (next: PowerSubstationFoldersConfig) => void;
  onScanPowerFolders?: () => void;
  isScanningPower?: boolean;
  referenceDateKey?: string;
  activeDailyPowerSummary?: DailyPowerSummary | null;
  powerScannedCount?: number;

  // Target Folder 3: Daily Temperature Record (.xlsx, .csv)
  folder3?: DriveFolder;
  permanentFolder3?: DriveFolder | null;
  onSelectFolder3?: (folder: DriveFolder, isPermanent?: boolean) => void;
  onSetPermanentFolder3?: (folder: DriveFolder | null) => void;
  onRescanFolder3?: () => void;
  isScanningFolder3?: boolean;
  folder3ScannedDatesCount?: number;
  folder3DateRange?: { firstDate: string; latestDate: string };

  // Target Folder 4: Daily Maximum Power Record of 4 Circuits (.csv, .xlsx)
  folder4?: DriveFolder;
  permanentFolder4?: DriveFolder | null;
  onSelectFolder4?: (folder: DriveFolder, isPermanent?: boolean) => void;
  onSetPermanentFolder4?: (folder: DriveFolder | null) => void;
  onRescanFolder4?: () => void;
  isScanningFolder4?: boolean;
  folder4ScannedRecordsCount?: number;
  folder4DateRange?: { firstDate: string; latestDate: string };
  onImportFileUrl3?: (url: string) => void;
  onImportFileUrl4?: (url: string) => void;
}

type ModalTargetMode = 'TEPR' | 'POWER_PARENT' | 'KMB' | 'KMA' | 'KNA' | 'FOLDER_3' | 'FOLDER_4';

export const FolderSelector: React.FC<FolderSelectorProps> = ({
  accessToken,
  currentFolder,
  onSelectFolder,
  onRefresh,
  isLoading,
  permanentFolder = null,
  onSetPermanentFolder,
  powerFolders,
  onUpdatePowerFolders,
  onScanPowerFolders,
  isScanningPower = false,
  referenceDateKey = 'all',
  activeDailyPowerSummary = null,
  powerScannedCount = 0,
  folder3 = { id: 'root', name: 'My Drive' },
  permanentFolder3 = null,
  onSelectFolder3,
  onSetPermanentFolder3,
  onRescanFolder3,
  isScanningFolder3 = false,
  folder3ScannedDatesCount = 0,
  folder3DateRange = { firstDate: '', latestDate: '' },
  folder4 = { id: 'root', name: 'My Drive' },
  permanentFolder4 = null,
  onSelectFolder4,
  onSetPermanentFolder4,
  onRescanFolder4,
  isScanningFolder4 = false,
  folder4ScannedRecordsCount = 0,
  folder4DateRange = { firstDate: '', latestDate: '' },
  onImportFileUrl3,
  onImportFileUrl4,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTargetMode, setModalTargetMode] = useState<ModalTargetMode>('TEPR');
  const [setAsPermanentOnSelect, setSetAsPermanentOnSelect] = useState(true);
  const [breadcrumbs, setBreadcrumbs] = useState<DriveFolder[]>([
    { id: 'root', name: 'My Drive (Root)' },
  ]);
  const [subfolders, setSubfolders] = useState<DriveFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [isAutoFinding, setIsAutoFinding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const activeBrowseFolder = breadcrumbs[breadcrumbs.length - 1];

  const loadSubfolders = async (parentId: string, overrideToken?: string) => {
    const effectiveToken = overrideToken || getLatestAccessTokenSync() || accessToken;
    if (!effectiveToken) {
      setIsAuthError(true);
      setError(
        'Your Google Drive OAuth session token is missing or has expired. Click "Reconnect Google Drive" below to refresh your credentials and load your folders.'
      );
      return;
    }
    setLoadingFolders(true);
    setError(null);
    setIsAuthError(false);
    try {
      const list = await fetchDriveFolders(effectiveToken, parentId);
      setSubfolders(list);
    } catch (err: any) {
      const authFailed = isDriveAuthError(err);
      setIsAuthError(authFailed);
      setError(
        authFailed
          ? 'Your Google Drive access token has expired or is invalid. Click "Reconnect Google Drive" below to refresh your OAuth credentials and load folders.'
          : err.message || 'Could not load folders'
      );
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleReconnectDrive = async (targetParentId = activeBrowseFolder.id) => {
    setIsReconnecting(true);
    setError(null);
    try {
      const freshToken = await refreshGoogleAccessToken();
      if (freshToken) {
        setIsAuthError(false);
        await loadSubfolders(targetParentId, freshToken);
      } else {
        setIsAuthError(true);
        setError('Could not obtain a new Google Drive access token. Please try reconnecting again.');
      }
    } catch (err: any) {
      setIsAuthError(true);
      setError(err?.message || 'Google Sign-In was cancelled or blocked by the browser.');
    } finally {
      setIsReconnecting(false);
    }
  };

  useEffect(() => {
    if (isModalOpen) {
      loadSubfolders(activeBrowseFolder.id);
    }
  }, [isModalOpen, activeBrowseFolder.id, accessToken]);

  const handleOpenPicker = async (mode: ModalTargetMode) => {
    setModalTargetMode(mode);
    setBreadcrumbs([{ id: 'root', name: 'My Drive (Root)' }]);
    setSearchQuery('');
    setError(null);
    setIsAuthError(false);
    setIsModalOpen(true);

    // If token is missing or known to be expired, trigger popup directly inside user click gesture
    if ((!accessToken && !getLatestAccessTokenSync()) || isAccessTokenExpired()) {
      await handleReconnectDrive('root');
    }
  };

  const handleNavigateInto = (folder: DriveFolder) => {
    setBreadcrumbs((prev) => [...prev, folder]);
    setSearchQuery('');
  };

  const handleBreadcrumbClick = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setSearchQuery('');
  };

  // Auto-detect KMB, KMA, KNA folders in Google Drive
  const handleAutoDetectPowerFolders = async () => {
    if (!accessToken || !powerFolders || !onUpdatePowerFolders) return;
    setIsAutoFinding(true);
    try {
      const found = await findDriveFoldersByNames(accessToken, ['KMB', 'KMA', 'KNA']);
      const next: PowerSubstationFoldersConfig = {
        ...powerFolders,
        KMB: found.KMB || powerFolders.KMB,
        KMA: found.KMA || powerFolders.KMA,
        KNA: found.KNA || powerFolders.KNA,
      };
      onUpdatePowerFolders(next);
    } finally {
      setIsAutoFinding(false);
    }
  };

  const handleConfirmSelection = async (folderToConfirm: DriveFolder = activeBrowseFolder) => {
    if (modalTargetMode === 'TEPR') {
      onSelectFolder(folderToConfirm, setAsPermanentOnSelect);
      setIsModalOpen(false);
      return;
    }

    if (modalTargetMode === 'FOLDER_3') {
      onSelectFolder3?.(folderToConfirm, setAsPermanentOnSelect);
      setIsModalOpen(false);
      return;
    }

    if (modalTargetMode === 'FOLDER_4') {
      onSelectFolder4?.(folderToConfirm, setAsPermanentOnSelect);
      setIsModalOpen(false);
      return;
    }

    if (!powerFolders || !onUpdatePowerFolders) {
      setIsModalOpen(false);
      return;
    }

    if (modalTargetMode === 'KMB' || modalTargetMode === 'KMA' || modalTargetMode === 'KNA') {
      const next: PowerSubstationFoldersConfig = {
        ...powerFolders,
        [modalTargetMode]: folderToConfirm,
      };
      onUpdatePowerFolders(next);
      setIsModalOpen(false);
      return;
    }

    if (modalTargetMode === 'POWER_PARENT') {
      // Also check if this parent folder directly contains child folders named KMB, KMA, KNA
      let next: PowerSubstationFoldersConfig = {
        ...powerFolders,
        parentFolder: folderToConfirm,
      };
      if (accessToken) {
        try {
          const children = await fetchDriveFolders(accessToken, folderToConfirm.id);
          for (const child of children) {
            const upper = child.name.trim().toUpperCase();
            if (upper === 'KMB' || upper.includes('KMB')) {
              next.KMB = child;
            } else if (upper === 'KMA' || upper.includes('KMA')) {
              next.KMA = child;
            } else if (upper === 'KNA' || upper.includes('KNA')) {
              next.KNA = child;
            }
          }
          // If the selected folder itself is named KMB, KMA, or KNA:
          const selfUpper = folderToConfirm.name.trim().toUpperCase();
          if (selfUpper === 'KMB') next.KMB = folderToConfirm;
          if (selfUpper === 'KMA') next.KMA = folderToConfirm;
          if (selfUpper === 'KNA') next.KNA = folderToConfirm;
        } catch (e) {
          console.warn('Could not inspect child folders of parent:', e);
        }
      }
      onUpdatePowerFolders(next);
      setIsModalOpen(false);
    }
  };

  const filteredSubfolders = subfolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getModalTitle = () => {
    switch (modalTargetMode) {
      case 'TEPR':
        return 'Select Fiber Optic Temperature Folder (.TEPR)';
      case 'FOLDER_3':
        return 'Select Target Folder 3 · Daily Temperature Record (.xlsx, .csv)';
      case 'FOLDER_4':
        return 'Select Target Folder 4 · Daily Maximum Power Record of 4 Circuits (.csv, .xlsx)';
      case 'KMB':
        return 'Select Target Folder "KMB" (115 kV Circuit #3 · Col G "03YB01")';
      case 'KMA':
        return 'Select Target Folder "KMA" (115 kV Circuit #2 · Col I "04YB01")';
      case 'KNA':
        return 'Select Target Folder "KNA" (33 kV NKT Col N "07WB01" & Oil Col P "10WB01")';
      case 'POWER_PARENT':
        return 'Select Master Power Consumption Folder (Containing KMB, KMA, KNA)';
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Fiber Optic (.TEPR) Target Folder Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${
              permanentFolder && permanentFolder.id === currentFolder.id && currentFolder.id !== 'root'
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-300'
                : 'bg-blue-50 text-blue-600 border border-blue-200/60'
            }`}>
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  Target Folder 1 · Fiber Optic Temperature (.TEPR)
                </span>
                
                {permanentFolder && permanentFolder.id === currentFolder.id && currentFolder.id !== 'root' ? (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                    <Pin className="w-3 h-3 text-emerald-600 fill-emerald-600" />
                    <span>Permanent Default (Auto-Loads on Login)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    <Sparkles className="w-2.5 h-2.5 text-blue-500" /> Session Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <h2 className="text-base font-bold text-slate-900">{currentFolder.name}</h2>
                <span className="text-xs text-slate-400 font-mono hidden md:inline">
                  ({currentFolder.id === 'root' ? 'root' : `${currentFolder.id.slice(0, 10)}...`})
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Permanent Folder Set / Unpin Button */}
            {currentFolder.id !== 'root' && (
              permanentFolder && permanentFolder.id === currentFolder.id ? (
                <button
                  type="button"
                  onClick={() => onSetPermanentFolder && onSetPermanentFolder(null)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Remove this folder as the permanent default on login"
                >
                  <PinOff className="w-3.5 h-3.5 text-slate-400 hover:text-rose-600" />
                  <span>Unpin Default</span>
                </button>
              ) : (
                <button
                  id="set-permanent-folder-btn"
                  type="button"
                  onClick={() => onSetPermanentFolder && onSetPermanentFolder(currentFolder)}
                  className="px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs"
                  title="Set this folder as your permanent target folder so it loads automatically whenever you log in"
                >
                  <Pin className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Set as Permanent Target Folder</span>
                </button>
              )
            )}

            {/* Change .TEPR Folder Button */}
            <button
              id="change-target-folder-btn"
              type="button"
              onClick={() => handleOpenPicker('TEPR')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-slate-500" />
              <span>Change .TEPR Folder</span>
            </button>

            {/* Rescan .TEPR Button */}
            <button
              id="refresh-folder-files-btn"
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100/80 disabled:opacity-50 border border-blue-200/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Rescan .TEPR</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Power Consumption Target Folders for 4 Circuits (Configured ONLY in Page 1 "Folder & Asset") */}
      {powerFolders && onUpdatePowerFolders && (
        <div className="bg-white rounded-2xl border border-indigo-200/90 p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-600 shrink-0 shadow-2xs">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700">
                    Target Folders 2 · 4-Circuit Power Consumption (KMB, KMA, KNA)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                    Synchronized Setting (Page 1 &amp; Page 5 Database Builder)
                  </span>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-blue-600" />
                    <span>
                      Linked to Fiber Optic Date Ref:{' '}
                      <strong>{referenceDateKey !== 'all' ? referenceDateKey : 'All Dates'}</strong>
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  Configures the target folders for the 4 submarine cable circuits and automatically links daily power consumption CSVs with fiber optic temperature readings using <strong>Date</strong> as the reference.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {accessToken && (
                <button
                  type="button"
                  onClick={handleAutoDetectPowerFolders}
                  disabled={isAutoFinding || isScanningPower}
                  className="px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Search Google Drive for folders named KMB, KMA, and KNA automatically"
                >
                  <FolderSearch className={`w-3.5 h-3.5 ${isAutoFinding ? 'animate-spin' : ''}`} />
                  <span>{isAutoFinding ? 'Finding KMB/KMA/KNA...' : 'Auto-Detect KMB, KMA, KNA'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenPicker('POWER_PARENT')}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Select a parent folder that contains KMB, KMA, and KNA subfolders"
              >
                <Folder className="w-3.5 h-3.5 text-slate-500" />
                <span>Set Master Parent Folder</span>
              </button>

              {onScanPowerFolders && (
                <button
                  type="button"
                  onClick={onScanPowerFolders}
                  disabled={isScanningPower}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanningPower ? 'animate-spin' : ''}`} />
                  <span>
                    {isScanningPower
                      ? 'Scanning KMB/KMA/KNA...'
                      : `Scan Power CSVs (${powerScannedCount})`}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* 4 Circuits Specification & Target Folder Assignment Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Target Folder KMB -> 115 kV Circuit #3 (Col G "03YB01", minus -> positive) */}
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3.5 flex flex-col justify-between gap-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-violet-950 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-600 shrink-0" />
                    <span>1. 115 kV Circuit #3</span>
                  </span>
                  <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded bg-violet-100 text-violet-900 border border-violet-300">
                    Target Folder: &quot;KMB&quot;
                  </span>
                </div>

                <div className="text-[11px] text-slate-700 space-y-0.5 bg-white/90 p-2 rounded-lg border border-violet-200/70">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">CSV Column:</span>
                    <span className="font-mono font-bold text-violet-800">
                      Column G (&quot;03YB01&quot;)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Value Conversion:</span>
                    <span className="font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200 text-[10px]">
                      Minus (-) → Positive (+)
                    </span>
                  </div>
                  {activeDailyPowerSummary && (
                    <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-100">
                      <span className="text-slate-500 font-semibold">Date Ref Peak:</span>
                      <span className="font-mono font-extrabold text-violet-700">
                        {activeDailyPowerSummary.metrics.circuit_115kv_3.peakMW.toFixed(2)} MW
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Bound Folder</div>
                  <div className="text-xs font-bold text-slate-800 truncate" title={powerFolders.KMB.name}>
                    {powerFolders.KMB.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenPicker('KMB')}
                  className="px-2.5 py-1.5 text-[11px] font-bold text-violet-800 bg-white hover:bg-violet-100 border border-violet-300 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Set &quot;KMB&quot; Folder
                </button>
              </div>
            </div>

            {/* 2. Target Folder KMA -> 115 kV Circuit #2 (Col I "04YB01", minus -> positive) */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5 flex flex-col justify-between gap-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-blue-950 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                    <span>2. 115 kV Circuit #2</span>
                  </span>
                  <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">
                    Target Folder: &quot;KMA&quot;
                  </span>
                </div>

                <div className="text-[11px] text-slate-700 space-y-0.5 bg-white/90 p-2 rounded-lg border border-blue-200/70">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">CSV Column:</span>
                    <span className="font-mono font-bold text-blue-800">
                      Column I (&quot;04YB01&quot;)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Value Conversion:</span>
                    <span className="font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200 text-[10px]">
                      Minus (-) → Positive (+)
                    </span>
                  </div>
                  {activeDailyPowerSummary && (
                    <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-100">
                      <span className="text-slate-500 font-semibold">Date Ref Peak:</span>
                      <span className="font-mono font-extrabold text-blue-700">
                        {activeDailyPowerSummary.metrics.circuit_115kv_2.peakMW.toFixed(2)} MW
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Bound Folder</div>
                  <div className="text-xs font-bold text-slate-800 truncate" title={powerFolders.KMA.name}>
                    {powerFolders.KMA.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenPicker('KMA')}
                  className="px-2.5 py-1.5 text-[11px] font-bold text-blue-800 bg-white hover:bg-blue-100 border border-blue-300 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Set &quot;KMA&quot; Folder
                </button>
              </div>
            </div>

            {/* 3 & 4. Target Folder KNA -> 33 kV NKT (Col N "07WB01") & 33 kV Oil filled (Col P "10WB01") */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 flex flex-col justify-between gap-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-emerald-950 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                    <span>3 &amp; 4. 33 kV NKT &amp; Oil Filled</span>
                  </span>
                  <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                    Target Folder: &quot;KNA&quot;
                  </span>
                </div>

                <div className="text-[11px] text-slate-700 space-y-1 bg-white/90 p-2 rounded-lg border border-emerald-200/70">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">3. 33 kV NKT:</span>
                    <span className="font-mono font-bold text-emerald-800">
                      Col N (&quot;07WB01&quot;)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">4. 33 kV Oil filled:</span>
                    <span className="font-mono font-bold text-amber-800">
                      Col P (&quot;10WB01&quot;)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Value Conversion:</span>
                    <span className="font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 text-[10px]">
                      Already Positive (+) · No Convert
                    </span>
                  </div>
                  {activeDailyPowerSummary && (
                    <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-100 text-[10px] font-mono">
                      <span className="text-emerald-800 font-bold">
                        NKT Peak: {activeDailyPowerSummary.metrics.circuit_33kv_nkt.peakMW.toFixed(2)} MW
                      </span>
                      <span className="text-amber-800 font-bold">
                        Oil Peak: {activeDailyPowerSummary.metrics.circuit_33kv_oil.peakMW.toFixed(2)} MW
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Bound Folder</div>
                  <div className="text-xs font-bold text-slate-800 truncate" title={powerFolders.KNA.name}>
                    {powerFolders.KNA.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenPicker('KNA')}
                  className="px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 bg-white hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Set &quot;KNA&quot; Folder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Target Folder 3 · Daily Temperature Record (Fiber Temp & Est. Conductor Temp) */}
      <div className="bg-white rounded-2xl border border-indigo-200/90 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${
              permanentFolder3 && permanentFolder3.id === folder3.id && folder3.id !== 'root'
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-300'
                : 'bg-indigo-50 text-indigo-600 border border-indigo-200/60'
            }`}>
              <Thermometer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                  Target Folder 3 · Daily Temperature Record (Fiber Temp &amp; Est. Conductor Temp)
                </span>
                
                {permanentFolder3 && permanentFolder3.id === folder3.id && folder3.id !== 'root' ? (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                    <Pin className="w-3 h-3 text-emerald-600 fill-emerald-600" />
                    <span>Permanent Default (Auto-Loads on Login)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    <Sparkles className="w-2.5 h-2.5 text-indigo-500" /> Session Active
                  </span>
                )}

                {folder3ScannedDatesCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>{folder3ScannedDatesCount} Dates Scanned &amp; Memory Synced</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <h2 className="text-base font-bold text-slate-900">{folder3.name}</h2>
                <span className="text-xs text-slate-400 font-mono hidden md:inline">
                  ({folder3.id === 'root' ? 'root' : `${folder3.id.slice(0, 10)}...`})
                </span>
                {folder3DateRange.firstDate && (
                  <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                    {folder3DateRange.firstDate} → {folder3DateRange.latestDate}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Parent folder in Google Drive for daily peak temperature (fiber temperature &amp; estimate conductor temperature). Automatically scans all dates to populate the Date dropdown list in <strong>Public Dashboard 2.1 Daily Max Heat Map</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Permanent Folder Set / Unpin Button */}
            {folder3.id !== 'root' && (
              permanentFolder3 && permanentFolder3.id === folder3.id ? (
                <button
                  type="button"
                  onClick={() => onSetPermanentFolder3 && onSetPermanentFolder3(null)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Remove this folder as the permanent default on login"
                >
                  <PinOff className="w-3.5 h-3.5 text-slate-400 hover:text-rose-600" />
                  <span>Unpin Default</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetPermanentFolder3 && onSetPermanentFolder3(folder3)}
                  className="px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs"
                  title="Set this folder as your permanent Target Folder 3 so it loads automatically on login"
                >
                  <Pin className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Set as Permanent Target Folder 3</span>
                </button>
              )
            )}

            {/* Change Folder 3 Button */}
            <button
              type="button"
              onClick={() => handleOpenPicker('FOLDER_3')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-slate-500" />
              <span>Change Folder 3</span>
            </button>

            {/* Paste Shared Link / URL Button */}
            {onImportFileUrl3 && (
              <button
                type="button"
                onClick={() => {
                  const url = window.prompt('Paste Google Drive shared link or direct URL of the Temperature database file (.xlsx):');
                  if (url) onImportFileUrl3(url.trim());
                }}
                className="px-3.5 py-2 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Paste Google Drive link of file and set as permanent"
              >
                <span>Paste Link</span>
              </button>
            )}

            {/* Rescan Folder 3 Button */}
            {onRescanFolder3 && (
              <button
                type="button"
                onClick={onRescanFolder3}
                disabled={isScanningFolder3}
                className="px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 disabled:opacity-50 border border-indigo-200/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanningFolder3 ? 'animate-spin' : ''}`} />
                <span>{isScanningFolder3 ? 'Scanning Dates...' : 'Rescan Dates (2.1 Heat Map)'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4. Target Folder 4 · Daily Maximum Power Record of 4 Circuits */}
      <div className="bg-white rounded-2xl border border-cyan-200/90 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${
              permanentFolder4 && permanentFolder4.id === folder4.id && folder4.id !== 'root'
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-300'
                : 'bg-cyan-50 text-cyan-600 border border-cyan-200/60'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700">
                  Target Folder 4 · Daily Maximum Power Record of 4 Circuits
                </span>
                
                {permanentFolder4 && permanentFolder4.id === folder4.id && folder4.id !== 'root' ? (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                    <Pin className="w-3 h-3 text-emerald-600 fill-emerald-600" />
                    <span>Permanent Default (Auto-Loads on Login)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    <Sparkles className="w-2.5 h-2.5 text-cyan-500" /> Session Active
                  </span>
                )}

                {folder4ScannedRecordsCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>{folder4ScannedRecordsCount} Power Records Active</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <h2 className="text-base font-bold text-slate-900">{folder4.name}</h2>
                <span className="text-xs text-slate-400 font-mono hidden md:inline">
                  ({folder4.id === 'root' ? 'root' : `${folder4.id.slice(0, 10)}...`})
                </span>
                {folder4DateRange.firstDate && (
                  <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                    {folder4DateRange.firstDate} → {folder4DateRange.latestDate}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Parent folder in Google Drive for daily peak power consumption for all 4 circuits. Automatically scans 4-circuit peak MW records to update <strong>Public Dashboard 2.4 Yearly comparison chart CIRCUIT PEAK MW DEMAND</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Permanent Folder Set / Unpin Button */}
            {folder4.id !== 'root' && (
              permanentFolder4 && permanentFolder4.id === folder4.id ? (
                <button
                  type="button"
                  onClick={() => onSetPermanentFolder4 && onSetPermanentFolder4(null)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Remove this folder as the permanent default on login"
                >
                  <PinOff className="w-3.5 h-3.5 text-slate-400 hover:text-rose-600" />
                  <span>Unpin Default</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetPermanentFolder4 && onSetPermanentFolder4(folder4)}
                  className="px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs"
                  title="Set this folder as your permanent Target Folder 4 so it loads automatically on login"
                >
                  <Pin className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Set as Permanent Target Folder 4</span>
                </button>
              )
            )}

            {/* Change Folder 4 Button */}
            <button
              type="button"
              onClick={() => handleOpenPicker('FOLDER_4')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-slate-500" />
              <span>Change Folder 4</span>
            </button>

            {/* Paste Shared Link / URL Button */}
            {onImportFileUrl4 && (
              <button
                type="button"
                onClick={() => {
                  const url = window.prompt('Paste Google Drive shared link or direct URL of the Power database file (.csv):');
                  if (url) onImportFileUrl4(url.trim());
                }}
                className="px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Paste Google Drive link of file and set as permanent"
              >
                <span>Paste Link</span>
              </button>
            )}

            {/* Rescan Folder 4 Button */}
            {onRescanFolder4 && (
              <button
                type="button"
                onClick={onRescanFolder4}
                disabled={isScanningFolder4}
                className="px-3.5 py-2 text-xs font-semibold text-cyan-700 bg-cyan-50 hover:bg-cyan-100/80 disabled:opacity-50 border border-cyan-200/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanningFolder4 ? 'animate-spin' : ''}`} />
                <span>{isScanningFolder4 ? 'Scanning Power DB...' : 'Rescan Power DB (2.4 Yearly)'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Folder Picker Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[82vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {getModalTitle()}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Navigate into a folder or click &quot;Select&quot; next to any folder below
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Breadcrumbs */}
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-1 overflow-x-auto text-xs">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                  <button
                    type="button"
                    onClick={() => handleBreadcrumbClick(idx)}
                    className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      idx === breadcrumbs.length - 1
                        ? 'font-bold text-blue-700 bg-blue-50/80'
                        : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Search Filter */}
            <div className="px-5 py-2.5 border-b border-slate-100">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter subfolders (e.g. KMB, KMA, KNA)..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Subfolders List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-[240px]">
              {loadingFolders || isReconnecting ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                  <span className="text-xs">
                    {isReconnecting
                      ? 'Reconnecting Google Drive OAuth credentials...'
                      : 'Loading folders from Google Drive...'}
                  </span>
                </div>
              ) : error ? (
                <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-3 text-center">
                  <div className="flex items-center justify-center gap-2 text-rose-700 font-bold text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>
                      {isAuthError
                        ? 'Google Drive Authentication Session Expired'
                        : 'Unable to Load Google Drive Folders'}
                    </span>
                  </div>
                  <p className="text-rose-700/90 leading-relaxed max-w-md mx-auto">{error}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleReconnectDrive(activeBrowseFolder.id)}
                      disabled={isReconnecting}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                      <span>Reconnect Google Drive &amp; Load Folders</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => loadSubfolders(activeBrowseFolder.id)}
                      className="px-3.5 py-2 rounded-xl bg-white hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs transition-all cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : filteredSubfolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-1.5">
                  <Folder className="w-7 h-7 stroke-1" />
                  <span className="text-xs font-medium">No subfolders inside this folder</span>
                  <span className="text-[11px] text-slate-400">
                    Click &quot;Use Current Folder&quot; below to select &quot;{activeBrowseFolder.name}&quot;
                  </span>
                </div>
              ) : (
                filteredSubfolders.map((folder) => {
                  const upper = folder.name.trim().toUpperCase();
                  const isHighlight =
                    (modalTargetMode === 'KMB' && upper.includes('KMB')) ||
                    (modalTargetMode === 'KMA' && upper.includes('KMA')) ||
                    (modalTargetMode === 'KNA' && upper.includes('KNA')) ||
                    (modalTargetMode === 'POWER_PARENT' &&
                      (upper === 'KMB' || upper === 'KMA' || upper === 'KNA'));

                  return (
                    <div
                      key={folder.id}
                      className={`w-full px-3.5 py-2.5 rounded-xl border transition-all flex items-center justify-between group ${
                        isHighlight
                          ? 'bg-indigo-50/70 border-indigo-200 hover:bg-indigo-100/70'
                          : 'border-transparent hover:border-blue-100 hover:bg-blue-50/50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleNavigateInto(folder)}
                        className="flex items-center gap-3 text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <Folder className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
                        <span className="text-xs font-medium text-slate-700 group-hover:text-blue-900 truncate">
                          {folder.name}
                        </span>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleConfirmSelection(folder)}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] cursor-pointer"
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNavigateInto(folder)}
                          className="p-1 text-slate-400 hover:text-blue-600 cursor-pointer"
                          title="Open Subfolder"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="text-xs text-slate-600 truncate">
                  Current: <span className="font-bold text-slate-900">{activeBrowseFolder.name}</span>
                </div>

                {/* Option to set as permanent target folder directly in picker */}
                {(modalTargetMode === 'TEPR' || modalTargetMode === 'FOLDER_3' || modalTargetMode === 'FOLDER_4') && activeBrowseFolder.id !== 'root' && (
                  <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-emerald-900 font-semibold bg-emerald-50/90 border border-emerald-200 px-2.5 py-1 rounded-lg mt-0.5">
                    <input
                      type="checkbox"
                      checked={setAsPermanentOnSelect}
                      onChange={(e) => setSetAsPermanentOnSelect(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                    />
                    <span className="flex items-center gap-1">
                      <Pin className="w-3 h-3 text-emerald-600 fill-emerald-600" />
                      <span>Set as Permanent Target Folder (Auto-loads on login)</span>
                    </span>
                  </label>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="confirm-folder-selection-btn"
                  type="button"
                  onClick={() => handleConfirmSelection(activeBrowseFolder)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Use &quot;{activeBrowseFolder.name}&quot;</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
