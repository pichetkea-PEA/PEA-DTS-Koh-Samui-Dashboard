import React, { useState, useRef, useEffect } from 'react';
import {
  Database,
  Upload,
  CheckCircle2,
  AlertCircle,
  Calendar,
  FileSpreadsheet,
  RefreshCw,
  ArrowRight,
  Thermometer,
  Zap,
  Globe,
  Link2,
  RotateCcw,
  Activity,
  Box,
  TrendingUp,
  Save,
  ShieldCheck,
  ExternalLink,
  Layers,
} from 'lucide-react';
import {
  OrgDatabaseConfig,
  DataPanelSourceInfo,
  saveUploadedOrgDatabase,
  saveUploadedPowerDatabase,
  saveUploadedSectionDailyProfileDatabase,
  getPanel1SourceInfo,
  savePanel1SourceInfo,
  getPanel2SourceInfo,
  savePanel2SourceInfo,
  getPanel3SourceInfo,
  savePanel3SourceInfo,
  resetPanel1ToSample,
  resetPanel2ToSample,
  resetPanel3ToSample,
  fetchRemoteDatabaseFile,
  getOrgDatabaseConfig,
  getPublicThreePanelLinksConfig,
  savePublicThreePanelLinksConfig,
  saveAllCurrentPanelsAsDefaultDataSource,
  subscribeOrgDatabase,
  syncPanel1FromFastEndpoint,
  syncPanel2FromFastEndpoint,
  syncSectionProfileFromFastEndpoint,
} from '../services/orgDatabaseStorage';
import { PublicDashboardTab } from './PublicSidebar';

export interface PublicDataSettingPageProps {
  dbConfig: OrgDatabaseConfig;
  onDatabaseUpdated: (newConfig: OrgDatabaseConfig) => void;
  onNavigateToChart: (page: PublicDashboardTab) => void;
}

export const PublicDataSettingPage: React.FC<PublicDataSettingPageProps> = ({
  dbConfig,
  onDatabaseUpdated,
  onNavigateToChart,
}) => {
  // Active Source Metadata for Sector 2.1, Sector 2.2, and Sector 2.3
  const [panel1Info, setPanel1Info] = useState<DataPanelSourceInfo>(() => getPanel1SourceInfo());
  const [panel2Info, setPanel2Info] = useState<DataPanelSourceInfo>(() => getPanel2SourceInfo());
  const [panel3Info, setPanel3Info] = useState<DataPanelSourceInfo>(() => getPanel3SourceInfo());

  // Shared Google Drive File Link Inputs for the 3 Database Panels
  const initialLinks = getPublicThreePanelLinksConfig();
  const [panel1RemoteUrl, setPanel1RemoteUrl] = useState<string>(
    initialLinks.panel1Url || panel1Info.remoteUrl || ''
  );
  const [panel2RemoteUrl, setPanel2RemoteUrl] = useState<string>(
    initialLinks.panel2Url || panel2Info.remoteUrl || ''
  );
  const [panel3RemoteUrl, setPanel3RemoteUrl] = useState<string>(
    initialLinks.panel3Url || panel3Info.remoteUrl || ''
  );

  // Loading & Status States for Sector 2.1 (Daily peak temperature database)
  const [isLoadingP1, setIsLoadingP1] = useState(false);
  const [statusP1, setStatusP1] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP1Ref = useRef<HTMLInputElement | null>(null);

  // Loading & Status States for Sector 2.2 (Daily maximum power consumption database)
  const [isLoadingP2, setIsLoadingP2] = useState(false);
  const [statusP2, setStatusP2] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP2Ref = useRef<HTMLInputElement | null>(null);

  // Loading & Status States for Sector 2.3 (Section daily profile database)
  const [isLoadingP3, setIsLoadingP3] = useState(false);
  const [statusP3, setStatusP3] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP3Ref = useRef<HTMLInputElement | null>(null);

  // Unified Save Setting Status (Sector 2.4)
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [saveAllStatus, setSaveAllStatus] = useState<{
    type: 'success' | 'error';
    msg: string;
  } | null>(null);

  useEffect(() => {
    const refreshInfos = () => {
      setPanel1Info(getPanel1SourceInfo());
      setPanel2Info(getPanel2SourceInfo());
      setPanel3Info(getPanel3SourceInfo());
    };
    refreshInfos();
    const unsub = subscribeOrgDatabase(refreshInfos);
    return unsub;
  }, [dbConfig]);

  // ---------------------------------------------------------------------------
  // SECTOR 2.1 HANDLERS: Daily peak temperature database (Feeds 2.1 & 2.4)
  // ---------------------------------------------------------------------------
  const syncPanel1FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP1({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive file link (Excel .xlsx or .csv).',
      });
      return false;
    }

    setIsLoadingP1(true);
    setStatusP1(null);
    try {
      const preferredFmt = trimmed.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
      const fetched = await fetchRemoteDatabaseFile(trimmed, preferredFmt);
      if (fetched.success && fetched.buffer) {
        const res = await saveUploadedOrgDatabase(fetched.buffer, fetched.fileName);
        if (res.success && res.config.totalRecords > 0) {
          const newInfo: DataPanelSourceInfo = {
            sourceType: 'remote_link',
            name: fetched.fileName,
            remoteUrl: trimmed,
            updatedAt: new Date().toISOString(),
            totalDates: res.config.totalDates,
            dateRange: res.config.dateRange,
            recordCount: res.config.totalRecords,
          };
          savePanel1SourceInfo(newInfo);
          setPanel1Info(newInfo);
          onDatabaseUpdated(res.config);
          setStatusP1({
            type: 'success',
            msg: `Saved & synced "${fetched.fileName}" (${res.config.totalDates} dates: ${res.config.dateRange.firstDate} to ${res.config.dateRange.latestDate}) → Now active for Daily Max Heat Map (2.1) & Yearly Comparison (2.4).`,
          });
          return true;
        }
      }

      const fastP1 = await syncPanel1FromFastEndpoint(trimmed);
      if (fastP1 && fastP1.success) {
        setPanel1Info(getPanel1SourceInfo());
        onDatabaseUpdated(fastP1.config);
        setStatusP1({
          type: 'success',
          msg: `Saved & synced "${fastP1.fileName}" (${fastP1.totalDates} dates: ${fastP1.dateRange.firstDate} to ${fastP1.dateRange.latestDate}) → Now active for Daily Max Heat Map (2.1) & Yearly Comparison (2.4).`,
        });
        return true;
      }

      throw new Error(
        fetched.error || 'Could not download file from shared Google Drive link.'
      );
    } catch (err: any) {
      setStatusP1({
        type: 'error',
        msg: err?.message || 'Failed to sync Daily Peak Temperature database from link.',
      });
      return false;
    } finally {
      setIsLoadingP1(false);
    }
  };

  const handlePanel1FileUpload = async (file: File) => {
    if (!file) return;
    setIsLoadingP1(true);
    setStatusP1(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await saveUploadedOrgDatabase(buffer, file.name);
      if (res.success && res.config.totalRecords > 0) {
        const newInfo: DataPanelSourceInfo = {
          sourceType: 'local_file',
          name: file.name,
          updatedAt: new Date().toISOString(),
          totalDates: res.config.totalDates,
          dateRange: res.config.dateRange,
          recordCount: res.config.totalRecords,
        };
        savePanel1SourceInfo(newInfo);
        setPanel1Info(newInfo);
        onDatabaseUpdated(res.config);
        setStatusP1({
          type: 'success',
          msg: `Loaded "${file.name}" (${res.config.totalDates} dates: ${res.config.dateRange.firstDate} to ${res.config.dateRange.latestDate}) → Active for Daily Max Heat Map (2.1) & Yearly Comparison (2.4).`,
        });
      } else {
        setStatusP1({
          type: 'error',
          msg: res.error || 'No valid Daily Peak Temperature records found in the uploaded file.',
        });
      }
    } catch (err: any) {
      setStatusP1({
        type: 'error',
        msg: err?.message || 'Failed to parse Daily Peak Temperature database file.',
      });
    } finally {
      setIsLoadingP1(false);
    }
  };

  const handlePanel1Reset = () => {
    resetPanel1ToSample();
    setPanel1RemoteUrl('');
    const updatedCfg = getOrgDatabaseConfig();
    setPanel1Info(getPanel1SourceInfo());
    onDatabaseUpdated(updatedCfg);
    setStatusP1({
      type: 'success',
      msg: 'Restored default Daily Peak Temperature dataset for Charts 2.1 & 2.4.',
    });
  };

  // ---------------------------------------------------------------------------
  // SECTOR 2.2 HANDLERS: Daily maximum power consumption database (Feeds 2.4)
  // ---------------------------------------------------------------------------
  const syncPanel2FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP2({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive file link (Excel .xlsx or .csv).',
      });
      return false;
    }

    setIsLoadingP2(true);
    setStatusP2(null);
    try {
      const preferredFmt = trimmed.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
      const fetched = await fetchRemoteDatabaseFile(trimmed, preferredFmt);
      if (fetched.success && fetched.buffer) {
        const res = await saveUploadedPowerDatabase(fetched.buffer, fetched.fileName);
        if (res.success && res.count > 0) {
          const newInfo: DataPanelSourceInfo = {
            sourceType: 'remote_link',
            name: fetched.fileName,
            remoteUrl: trimmed,
            updatedAt: new Date().toISOString(),
            totalDates: res.count,
            dateRange: res.dateRange,
            recordCount: res.count,
          };
          savePanel2SourceInfo(newInfo);
          setPanel2Info(newInfo);
          onDatabaseUpdated(getOrgDatabaseConfig());
          setStatusP2({
            type: 'success',
            msg: `Saved & synced "${fetched.fileName}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Now active for Yearly Comparison (2.4).`,
          });
          return true;
        }
      }

      const fastP2 = await syncPanel2FromFastEndpoint(trimmed);
      if (fastP2 && fastP2.success) {
        setPanel2Info(getPanel2SourceInfo());
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP2({
          type: 'success',
          msg: `Saved & synced "${fastP2.fileName}" (${fastP2.totalDates} dates: ${fastP2.dateRange.firstDate} to ${fastP2.dateRange.latestDate}) → Now active for Yearly Comparison (2.4).`,
        });
        return true;
      }

      throw new Error(
        fetched.error || 'Could not download file from shared Google Drive link.'
      );
    } catch (err: any) {
      setStatusP2({
        type: 'error',
        msg: err?.message || 'Failed to sync Daily Maximum Power Consumption database from link.',
      });
      return false;
    } finally {
      setIsLoadingP2(false);
    }
  };

  const handlePanel2FileUpload = async (file: File) => {
    if (!file) return;
    setIsLoadingP2(true);
    setStatusP2(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await saveUploadedPowerDatabase(buffer, file.name);
      if (res.success && res.count > 0) {
        const newInfo: DataPanelSourceInfo = {
          sourceType: 'local_file',
          name: file.name,
          updatedAt: new Date().toISOString(),
          totalDates: res.count,
          dateRange: res.dateRange,
          recordCount: res.count,
        };
        savePanel2SourceInfo(newInfo);
        setPanel2Info(newInfo);
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP2({
          type: 'success',
          msg: `Loaded "${file.name}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Yearly Comparison (2.4).`,
        });
      } else {
        setStatusP2({
          type: 'error',
          msg: res.error || 'No valid Daily Maximum Power Consumption records found in file.',
        });
      }
    } catch (err: any) {
      setStatusP2({
        type: 'error',
        msg: err?.message || 'Failed to parse Daily Maximum Power Consumption database file.',
      });
    } finally {
      setIsLoadingP2(false);
    }
  };

  const handlePanel2Reset = () => {
    resetPanel2ToSample();
    setPanel2RemoteUrl('');
    const updatedCfg = getOrgDatabaseConfig();
    setPanel2Info(getPanel2SourceInfo());
    onDatabaseUpdated(updatedCfg);
    setStatusP2({
      type: 'success',
      msg: 'Restored default 4-Circuit Daily Maximum Power Consumption dataset for Chart 2.4.',
    });
  };

  // ---------------------------------------------------------------------------
  // SECTOR 2.3 HANDLERS: Section daily profile database (Feeds 2.2 & 2.3)
  // ---------------------------------------------------------------------------
  const syncPanel3FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP3({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive file link (Excel .xlsx or .csv).',
      });
      return false;
    }

    setIsLoadingP3(true);
    setStatusP3(null);
    try {
      const fastSynced = await syncSectionProfileFromFastEndpoint(trimmed);
      if (fastSynced && fastSynced.success) {
        setPanel3Info(getPanel3SourceInfo());
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP3({
          type: 'success',
          msg: `Saved & synced "${fastSynced.fileName}" (${fastSynced.totalDates} dates, ${fastSynced.recordCount.toLocaleString()} hourly records: ${fastSynced.dateRange.firstDate} to ${fastSynced.dateRange.latestDate}) → Now active for Daily Temperature Curve (2.2) & 3D Conductor Temp vs Power (2.3).`,
        });
        return true;
      }

      const preferredFmt = trimmed.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
      const fetched = await fetchRemoteDatabaseFile(trimmed, preferredFmt);
      if (!fetched.success || !fetched.buffer) {
        throw new Error(fetched.error || 'Could not download file from shared Google Drive link.');
      }

      const res = await saveUploadedSectionDailyProfileDatabase(fetched.buffer, fetched.fileName);
      if (res.success && res.count > 0) {
        const newInfo: DataPanelSourceInfo = {
          sourceType: 'remote_link',
          name: fetched.fileName,
          remoteUrl: trimmed,
          updatedAt: new Date().toISOString(),
          totalDates: res.dates.length,
          dateRange: res.dateRange,
          recordCount: res.count,
        };
        savePanel3SourceInfo(newInfo);
        setPanel3Info(newInfo);
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP3({
          type: 'success',
          msg: `Saved & synced "${fetched.fileName}" (${res.dates.length} dates, ${res.count.toLocaleString()} hourly records: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Now active for Daily Temperature Curve (2.2) & 3D Conductor Temp vs Power (2.3).`,
        });
        return true;
      } else {
        throw new Error(
          res.error || 'No valid Section Daily Profile records found in the shared file.'
        );
      }
    } catch (err: any) {
      setStatusP3({
        type: 'error',
        msg: err?.message || 'Failed to sync Section Daily Profile database from link.',
      });
      return false;
    } finally {
      setIsLoadingP3(false);
    }
  };

  const handlePanel3FileUpload = async (file: File) => {
    if (!file) return;
    setIsLoadingP3(true);
    setStatusP3(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await saveUploadedSectionDailyProfileDatabase(buffer, file.name);
      if (res.success && res.count > 0) {
        const newInfo: DataPanelSourceInfo = {
          sourceType: 'local_file',
          name: file.name,
          updatedAt: new Date().toISOString(),
          totalDates: res.dates.length,
          dateRange: res.dateRange,
          recordCount: res.count,
        };
        savePanel3SourceInfo(newInfo);
        setPanel3Info(newInfo);
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP3({
          type: 'success',
          msg: `Loaded "${file.name}" (${res.dates.length} dates, ${res.count.toLocaleString()} hourly records: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Daily Temperature Curve (2.2) & 3D Conductor Temp vs Power (2.3).`,
        });
      } else {
        setStatusP3({
          type: 'error',
          msg: res.error || 'No valid Section Daily Profile records found in file.',
        });
      }
    } catch (err: any) {
      setStatusP3({
        type: 'error',
        msg: err?.message || 'Failed to parse Section Daily Profile database file.',
      });
    } finally {
      setIsLoadingP3(false);
    }
  };

  const handlePanel3Reset = () => {
    resetPanel3ToSample();
    setPanel3RemoteUrl('');
    const updatedCfg = getOrgDatabaseConfig();
    setPanel3Info(getPanel3SourceInfo());
    onDatabaseUpdated(updatedCfg);
    setStatusP3({
      type: 'success',
      msg: 'Restored default Section Daily Profile dataset for Charts 2.2 & 2.3.',
    });
  };

  // ---------------------------------------------------------------------------
  // SECTOR 2.4 HANDLER: Save Setting Across All 3 Panels
  // ---------------------------------------------------------------------------
  const handleSaveAllSettings = async () => {
    setIsSavingAll(true);
    setSaveAllStatus(null);

    savePublicThreePanelLinksConfig({
      panel1Url: panel1RemoteUrl.trim(),
      panel2Url: panel2RemoteUrl.trim(),
      panel3Url: panel3RemoteUrl.trim(),
      updatedAt: new Date().toISOString(),
    });

    const syncedPanels: string[] = [];
    const failedPanels: string[] = [];

    if (panel1RemoteUrl.trim()) {
      const ok1 = await syncPanel1FromGoogleDriveLink(panel1RemoteUrl);
      if (ok1) syncedPanels.push('2.1 Daily Peak Temperature DB');
      else failedPanels.push('2.1 Daily Peak Temperature DB');
    }
    if (panel2RemoteUrl.trim()) {
      const ok2 = await syncPanel2FromGoogleDriveLink(panel2RemoteUrl);
      if (ok2) syncedPanels.push('2.2 Daily Max Power Consumption DB');
      else failedPanels.push('2.2 Daily Max Power Consumption DB');
    }
    if (panel3RemoteUrl.trim()) {
      const ok3 = await syncPanel3FromGoogleDriveLink(panel3RemoteUrl);
      if (ok3) syncedPanels.push('2.3 Section Daily Profile DB');
      else failedPanels.push('2.3 Section Daily Profile DB');
    }

    await saveAllCurrentPanelsAsDefaultDataSource();
    setIsSavingAll(false);

    if (failedPanels.length > 0) {
      setSaveAllStatus({
        type: 'error',
        msg: `Saved link settings, but failed to fetch: ${failedPanels.join(', ')}. Ensure the Google Drive files are shared as "Anyone with the link".`,
      });
    } else if (syncedPanels.length > 0) {
      setSaveAllStatus({
        type: 'success',
        msg: `Latest 3 database files saved & synchronized as default data source (${syncedPanels.join(' · ')}). Public Dashboard charts 2.1, 2.2, 2.3, and 2.4 are now visualizing these default database files.`,
      });
    } else {
      setSaveAllStatus({
        type: 'success',
        msg: 'Latest 3 uploaded files saved as the default data source for the Public Dashboard (Charts 2.1, 2.2, 2.3, and 2.4).',
      });
    }
  };

  const renderSourceBadge = (type: DataPanelSourceInfo['sourceType']) => {
    if (type === 'local_file') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono font-bold uppercase">
          <FileSpreadsheet className="w-3 h-3" /> Default Data Source (Latest Uploaded File)
        </span>
      );
    }
    if (type === 'remote_link' || type === 'googledrive') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono font-bold uppercase">
          <Globe className="w-3 h-3" /> Default Data Source (Shared Drive File)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-mono font-bold uppercase">
        <Database className="w-3 h-3" /> Built-In Baseline Dataset
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Top Header Banner */}
      <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-56 h-56 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30">
                  PUBLIC DASHBOARD DATA SETTING · 4-SECTOR ARCHITECTURE
                </span>
                <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Decoupled from Admin Login Session
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-1.5">
                Public Dashboard Shared Google Drive Data Sources
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-4xl leading-relaxed">
                Configure the 3 shared Google Drive database files (Excel{' '}
                <code className="text-cyan-300">.xlsx</code> or{' '}
                <code className="text-cyan-300">.csv</code>) below and click{' '}
                <strong className="text-white">Save Setting</strong>. The Public Dashboard
                exclusively uses these 3 database panels to visualize Charts{' '}
                <strong className="text-cyan-300">2.1</strong>,{' '}
                <strong className="text-purple-300">2.2</strong>,{' '}
                <strong className="text-purple-300">2.3</strong>, and{' '}
                <strong className="text-emerald-300">2.4</strong> with zero dependency on the Admin
                login session.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSaveAllSettings}
              disabled={isSavingAll || isLoadingP1 || isLoadingP2 || isLoadingP3}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-mono text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.35)] disabled:opacity-50 cursor-pointer"
            >
              {isSavingAll ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Setting
            </button>
          </div>
        </div>
      </div>

      {/* 4-SECTOR GRID LAYOUT */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ===================================================================== */}
        {/* SECTOR 2.1: Data source of "Daily peak temperature database"          */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-cyan-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
                  <Thermometer className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                      SECTOR 2.1 · PANEL 1
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30">
                      Feeds 2.1 Heat Map &amp; 2.4 Yearly Comparison
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.1 Data source of &ldquo;Daily peak temperature database&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive file (19-sheet Excel <code className="text-cyan-300">.xlsx</code> or{' '}
                    <code className="text-cyan-300">.csv</code>) containing daily peak fiber &amp; conductor temperatures.
                  </p>
                </div>
              </div>
            </div>

            {/* Active Source Status Box */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Active Database File:
                </span>
                {renderSourceBadge(panel1Info.sourceType)}
              </div>

              <div className="text-xs font-mono font-bold text-white break-all flex items-center gap-2 bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                <FileSpreadsheet className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>{panel1Info.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Dates</div>
                  <div className="text-sm font-mono font-bold text-cyan-300 mt-0.5">
                    {panel1Info.totalDates.toLocaleString()} Days
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5 col-span-2">
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-cyan-400" /> Date Period
                  </div>
                  <div className="text-xs font-mono font-bold text-white mt-0.5">
                    {panel1Info.dateRange.firstDate || 'N/A'} → {panel1Info.dateRange.latestDate || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Shared Google Drive Link Input */}
            <div className="bg-slate-950/70 border border-cyan-500/30 rounded-xl p-4 space-y-3">
              <label className="block text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                Shared Google Drive File Link (Excel .xlsx or .csv)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel1RemoteUrl}
                  onChange={(e) => setPanel1RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... or https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP1}
                  onClick={async () => {
                    savePublicThreePanelLinksConfig({
                      panel1Url: panel1RemoteUrl.trim(),
                      panel2Url: panel2RemoteUrl.trim(),
                      panel3Url: panel3RemoteUrl.trim(),
                      updatedAt: new Date().toISOString(),
                    });
                    await syncPanel1FromGoogleDriveLink(panel1RemoteUrl);
                  }}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingP1 ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Setting
                </button>
              </div>

              {/* Optional Local File Upload */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <input
                  ref={fileInputP1Ref}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePanel1FileUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isLoadingP1}
                  onClick={() => fileInputP1Ref.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Browse Local Excel / CSV
                </button>
                <button
                  type="button"
                  onClick={handlePanel1Reset}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-mono transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Default
                </button>
              </div>
            </div>

            {statusP1 && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-mono ${
                  statusP1.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                }`}
              >
                {statusP1.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{statusP1.msg}</span>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Visualized in: <strong className="text-cyan-300">2.1 Heat Map</strong> &amp;{' '}
              <strong className="text-cyan-300">2.4 Yearly Comparison</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigateToChart('heatmap')}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                Open 2.1 <ArrowRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onNavigateToChart('yearly')}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                Open 2.4 <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* SECTOR 2.2: Data source of "Daily maximum power consumption database" */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-emerald-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      SECTOR 2.2 · PANEL 2
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-emerald-500/30">
                      Feeds 2.4 Yearly Comparison (4 Circuits)
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.2 Data source of &ldquo;Daily maximum power consumption database&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive file (Excel <code className="text-emerald-300">.xlsx</code> or{' '}
                    <code className="text-emerald-300">.csv</code>) containing daily peak power (MW) across 4 circuits.
                  </p>
                </div>
              </div>
            </div>

            {/* Active Source Status Box */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Active Database File:
                </span>
                {renderSourceBadge(panel2Info.sourceType)}
              </div>

              <div className="text-xs font-mono font-bold text-white break-all flex items-center gap-2 bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{panel2Info.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Dates</div>
                  <div className="text-sm font-mono font-bold text-emerald-300 mt-0.5">
                    {panel2Info.totalDates.toLocaleString()} Days
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5 col-span-2">
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-emerald-400" /> Date Period
                  </div>
                  <div className="text-xs font-mono font-bold text-white mt-0.5">
                    {panel2Info.dateRange.firstDate || 'N/A'} → {panel2Info.dateRange.latestDate || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Shared Google Drive Link Input */}
            <div className="bg-slate-950/70 border border-emerald-500/30 rounded-xl p-4 space-y-3">
              <label className="block text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-emerald-400" />
                Shared Google Drive File Link (Excel .xlsx or .csv)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel2RemoteUrl}
                  onChange={(e) => setPanel2RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... or https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP2}
                  onClick={async () => {
                    savePublicThreePanelLinksConfig({
                      panel1Url: panel1RemoteUrl.trim(),
                      panel2Url: panel2RemoteUrl.trim(),
                      panel3Url: panel3RemoteUrl.trim(),
                      updatedAt: new Date().toISOString(),
                    });
                    await syncPanel2FromGoogleDriveLink(panel2RemoteUrl);
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingP2 ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Setting
                </button>
              </div>

              {/* Optional Local File Upload */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <input
                  ref={fileInputP2Ref}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePanel2FileUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isLoadingP2}
                  onClick={() => fileInputP2Ref.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Browse Local CSV / Excel
                </button>
                <button
                  type="button"
                  onClick={handlePanel2Reset}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-mono transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Default
                </button>
              </div>
            </div>

            {statusP2 && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-mono ${
                  statusP2.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                }`}
              >
                {statusP2.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{statusP2.msg}</span>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Visualized in: <strong className="text-emerald-300">2.4 Yearly Comparison</strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigateToChart('yearly')}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
            >
              Open 2.4 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* SECTOR 2.3: Data source of "Section daily profile database"           */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-purple-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-purple-500/15 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                      SECTOR 2.3 · PANEL 3
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-purple-500/30">
                      Feeds 2.2 Daily Curve &amp; 2.3 3D Temp vs Power
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.3 Data source of &ldquo;Section daily profile database&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive file (19-sheet Excel <code className="text-purple-300">.xlsx</code> or{' '}
                    <code className="text-purple-300">.csv</code>) containing 24-hour section temperature &amp; power profiles.
                  </p>
                </div>
              </div>
            </div>

            {/* Active Source Status Box */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Active Database File:
                </span>
                {renderSourceBadge(panel3Info.sourceType)}
              </div>

              <div className="text-xs font-mono font-bold text-white break-all flex items-center gap-2 bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                <FileSpreadsheet className="w-4 h-4 text-purple-400 shrink-0" />
                <span>{panel3Info.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Dates</div>
                  <div className="text-sm font-mono font-bold text-purple-300 mt-0.5">
                    {panel3Info.totalDates.toLocaleString()} Days
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5 col-span-2">
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-purple-400" /> Date Period
                  </div>
                  <div className="text-xs font-mono font-bold text-white mt-0.5">
                    {panel3Info.dateRange.firstDate || 'N/A'} → {panel3Info.dateRange.latestDate || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Shared Google Drive Link Input */}
            <div className="bg-slate-950/70 border border-purple-500/30 rounded-xl p-4 space-y-3">
              <label className="block text-xs font-mono font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-purple-400" />
                Shared Google Drive File Link (Excel .xlsx or .csv)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel3RemoteUrl}
                  onChange={(e) => setPanel3RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... or https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-purple-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP3}
                  onClick={async () => {
                    savePublicThreePanelLinksConfig({
                      panel1Url: panel1RemoteUrl.trim(),
                      panel2Url: panel2RemoteUrl.trim(),
                      panel3Url: panel3RemoteUrl.trim(),
                      updatedAt: new Date().toISOString(),
                    });
                    await syncPanel3FromGoogleDriveLink(panel3RemoteUrl);
                  }}
                  className="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingP3 ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Setting
                </button>
              </div>

              {/* Optional Local File Upload */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <input
                  ref={fileInputP3Ref}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePanel3FileUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isLoadingP3}
                  onClick={() => fileInputP3Ref.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Browse Local Excel / CSV
                </button>
                <button
                  type="button"
                  onClick={handlePanel3Reset}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-mono transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Default
                </button>
              </div>
            </div>

            {statusP3 && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-mono ${
                  statusP3.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                }`}
              >
                {statusP3.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{statusP3.msg}</span>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Visualized in: <strong className="text-purple-300">2.2 Daily Curve</strong> &amp;{' '}
              <strong className="text-purple-300">2.3 3D Temp vs Power</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigateToChart('dailycurve')}
                className="px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                Open 2.2 <ArrowRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onNavigateToChart('powertemp3d')}
                className="px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                Open 2.3 <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* SECTOR 2.4: Save Setting & Public Chart Data Routing Control Panel    */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-amber-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      SECTOR 2.4 · CONTROL &amp; ROUTING
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      All 4 Public Charts Linked
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.4 Public Dashboard Visualization Routing &amp; Save Setting
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Summary of how the 3 shared Google Drive database panels feed each Public Dashboard chart.
                  </p>
                </div>
              </div>
            </div>

            {/* Routing Matrix */}
            <div className="space-y-2.5">
              {/* Route 1: Daily Max Heat Map (2.1) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px]">
                      2.1
                    </span>
                    Daily Max Heat Map (2.1)
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Data Source: <strong className="text-cyan-300">Daily peak temperature database (Panel 2.1)</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToChart('heatmap')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-bold shrink-0 cursor-pointer flex items-center gap-1"
                >
                  View Chart <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Route 2: Daily Temperature Curve (2.2) & 3D Conductor Temp vs Power (2.3) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px]">
                      2.2 &amp; 2.3
                    </span>
                    Daily Temperature Curve (2.2) &amp; 3D Conductor Temp vs Power (2.3)
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Data Source: <strong className="text-purple-300">Section daily profile database (Panel 2.3)</strong>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigateToChart('dailycurve')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold cursor-pointer"
                  >
                    2.2
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateToChart('powertemp3d')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold cursor-pointer"
                  >
                    2.3
                  </button>
                </div>
              </div>

              {/* Route 3: Yearly comparison (2.4) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
                      2.4
                    </span>
                    Yearly comparison (2.4)
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Data Source:{' '}
                    <strong className="text-cyan-300">Daily peak temperature database (Panel 2.1)</strong> +{' '}
                    <strong className="text-emerald-300">
                      Daily maximum power consumption database (Panel 2.2)
                    </strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToChart('yearly')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono font-bold shrink-0 cursor-pointer flex items-center gap-1"
                >
                  View Chart <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Master Save Setting Action Box */}
            <div className="bg-slate-950/80 border border-amber-500/30 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-xs font-mono font-bold text-amber-300 uppercase">
                    Apply &amp; Synchronize All 3 Shared Google Drive Links
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Click Save Setting to fetch, parse, and bind all configured Google Drive links to Public Dashboard charts.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSaveAllSettings}
                  disabled={isSavingAll || isLoadingP1 || isLoadingP2 || isLoadingP3}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 text-slate-950 font-mono text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shrink-0 shadow-lg disabled:opacity-50 cursor-pointer"
                >
                  {isSavingAll ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Setting
                </button>
              </div>

              {saveAllStatus && (
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-mono ${
                    saveAllStatus.type === 'success'
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {saveAllStatus.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span>{saveAllStatus.msg}</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Public Dashboard Data Isolation: ACTIVE</span>
            <span className="text-emerald-400 font-bold">Zero Login Session Dependency</span>
          </div>
        </div>
      </div>
    </div>
  );
};
