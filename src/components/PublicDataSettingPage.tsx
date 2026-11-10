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
  Save,
  ShieldCheck,
  ExternalLink,
  Layers,
  Clock,
} from 'lucide-react';
import {
  OrgDatabaseConfig,
  DataPanelSourceInfo,
  saveUploadedOrgDatabase,
  saveUploadedPowerDatabase,
  saveUploadedSectionDailyProfileDatabase,
  saveUploadedPage26OpCondDatabase,
  saveUploadedPage26LoadCurveDatabase,
  getPanel1SourceInfo,
  savePanel1SourceInfo,
  getPanel2SourceInfo,
  savePanel2SourceInfo,
  getPanel3SourceInfo,
  savePanel3SourceInfo,
  getPanel4SourceInfo,
  savePanel4SourceInfo,
  getPanel5SourceInfo,
  savePanel5SourceInfo,
  resetPanel1ToSample,
  resetPanel2ToSample,
  resetPanel3ToSample,
  resetPanel4ToSample,
  resetPanel5ToSample,
  fetchRemoteDatabaseFile,
  getOrgDatabaseConfig,
  getPublicThreePanelLinksConfig,
  savePublicThreePanelLinksConfig,
  saveAllCurrentPanelsAsDefaultDataSource,
  subscribeOrgDatabase,
  syncPanel1FromFastEndpoint,
  syncPanel2FromFastEndpoint,
  syncSectionProfileFromFastEndpoint,
  ensurePage26DatasetsLoaded,
} from '../services/orgDatabaseStorage';
import { PublicDashboardTab } from './PublicSidebar';

export interface PublicDataSettingPageProps {
  dbConfig: OrgDatabaseConfig;
  onDatabaseUpdated: (newConfig: OrgDatabaseConfig) => void;
  onNavigateToChart: (page: PublicDashboardTab) => void;
  onRefreshPublicData?: () => Promise<void> | void;
  isRefreshingPublicData?: boolean;
  refreshProgress?: number;
  refreshStatusText?: string;
}

export const PublicDataSettingPage: React.FC<PublicDataSettingPageProps> = ({
  dbConfig,
  onDatabaseUpdated,
  onNavigateToChart,
  onRefreshPublicData,
  isRefreshingPublicData = false,
  refreshProgress = 0,
  refreshStatusText = '',
}) => {
  // Active Source Metadata for all 5 Shared Google Drive Database Panels
  const [panel1Info, setPanel1Info] = useState<DataPanelSourceInfo>(() => getPanel1SourceInfo());
  const [panel2Info, setPanel2Info] = useState<DataPanelSourceInfo>(() => getPanel2SourceInfo());
  const [panel3Info, setPanel3Info] = useState<DataPanelSourceInfo>(() => getPanel3SourceInfo());
  const [panel4Info, setPanel4Info] = useState<DataPanelSourceInfo>(() => getPanel4SourceInfo());
  const [panel5Info, setPanel5Info] = useState<DataPanelSourceInfo>(() => getPanel5SourceInfo());

  // Shared Google Drive File/Folder Link Inputs for the 5 Database Panels
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
  const [panel4RemoteUrl, setPanel4RemoteUrl] = useState<string>(
    initialLinks.panel4Url ||
      panel4Info.remoteUrl ||
      'https://drive.google.com/drive/folders/1xGm5ZH9mkNQhTAuXmmBCsCnORL0un4nE?usp=sharing'
  );
  const [panel5RemoteUrl, setPanel5RemoteUrl] = useState<string>(
    initialLinks.panel5Url ||
      panel5Info.remoteUrl ||
      'https://drive.google.com/drive/folders/1OCCulyWoTU5hnRltkH9J7ZcsNdXDbCeo?usp=sharing'
  );

  // Loading & Status States for Panel 1 (Daily peak temperature database)
  const [isLoadingP1, setIsLoadingP1] = useState(false);
  const [statusP1, setStatusP1] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP1Ref = useRef<HTMLInputElement | null>(null);

  // Loading & Status States for Panel 2 (Daily maximum power consumption database)
  const [isLoadingP2, setIsLoadingP2] = useState(false);
  const [statusP2, setStatusP2] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP2Ref = useRef<HTMLInputElement | null>(null);

  // Loading & Status States for Panel 3 (Section daily profile database)
  const [isLoadingP3, setIsLoadingP3] = useState(false);
  const [statusP3, setStatusP3] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP3Ref = useRef<HTMLInputElement | null>(null);

  // Loading & Status States for Panel 4 (Page 2.6 Chart 1 · Operation Condition Database)
  const [isLoadingP4, setIsLoadingP4] = useState(false);
  const [statusP4, setStatusP4] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP4Ref = useRef<HTMLInputElement | null>(null);

  // Loading & Status States for Panel 5 (Page 2.6 Chart 2 · 30-Min Load Curve Database)
  const [isLoadingP5, setIsLoadingP5] = useState(false);
  const [statusP5, setStatusP5] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputP5Ref = useRef<HTMLInputElement | null>(null);

  // Unified Save Setting Status
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
      setPanel4Info(getPanel4SourceInfo());
      setPanel5Info(getPanel5SourceInfo());
    };
    refreshInfos();
    const unsub = subscribeOrgDatabase(refreshInfos);
    return unsub;
  }, [dbConfig]);

  const persistAllFiveLinks = (
    p1 = panel1RemoteUrl,
    p2 = panel2RemoteUrl,
    p3 = panel3RemoteUrl,
    p4 = panel4RemoteUrl,
    p5 = panel5RemoteUrl
  ) => {
    savePublicThreePanelLinksConfig({
      panel1Url: p1.trim(),
      panel2Url: p2.trim(),
      panel3Url: p3.trim(),
      panel4Url: p4.trim(),
      panel5Url: p5.trim(),
      updatedAt: new Date().toISOString(),
    });
  };

  // ---------------------------------------------------------------------------
  // SECTOR 2.1 HANDLERS: Daily peak temperature database (Feeds 2.1 & 2.4)
  // ---------------------------------------------------------------------------
  const syncPanel1FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP1({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive file or folder link (Excel .xlsx or .csv).',
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
            msg: `Saved & synced "${fetched.fileName}" (${res.config.totalDates} dates: ${res.config.dateRange.firstDate} to ${res.config.dateRange.latestDate}) → Active for Daily Max Heat Map (2.1) & Yearly Comparison (2.4).`,
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
          msg: `Saved & synced "${fastP1.fileName}" (${fastP1.totalDates} dates: ${fastP1.dateRange.firstDate} to ${fastP1.dateRange.latestDate}) → Active for Daily Max Heat Map (2.1) & Yearly Comparison (2.4).`,
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
        msg: 'Please enter a valid shared Google Drive file or folder link (Excel .xlsx or .csv).',
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
            msg: `Saved & synced "${fetched.fileName}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Yearly Comparison (2.4).`,
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
          msg: `Saved & synced "${fastP2.fileName}" (${fastP2.totalDates} dates: ${fastP2.dateRange.firstDate} to ${fastP2.dateRange.latestDate}) → Active for Yearly Comparison (2.4).`,
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
  // SECTOR 2.3 HANDLERS: Section daily profile database (Feeds 2.2, 2.3 & 2.5)
  // ---------------------------------------------------------------------------
  const syncPanel3FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP3({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive file or folder link (Excel .xlsx or .csv).',
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
          msg: `Saved & synced "${fastSynced.fileName}" (${fastSynced.totalDates} dates, ${fastSynced.recordCount.toLocaleString()} hourly records: ${fastSynced.dateRange.firstDate} to ${fastSynced.dateRange.latestDate}) → Active for Charts 2.2, 2.3 & 2.5.`,
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
          msg: `Saved & synced "${fetched.fileName}" (${res.dates.length} dates, ${res.count.toLocaleString()} hourly records: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Charts 2.2, 2.3 & 2.5.`,
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
          msg: `Loaded "${file.name}" (${res.dates.length} dates, ${res.count.toLocaleString()} hourly records: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Charts 2.2, 2.3 & 2.5.`,
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
      msg: 'Restored default Section Daily Profile dataset for Charts 2.2, 2.3 & 2.5.',
    });
  };

  // ---------------------------------------------------------------------------
  // SECTOR 2.4 HANDLERS: Operation Condition Database (4 Sheets) — Feeds 2.6 Chart 1
  // ---------------------------------------------------------------------------
  const syncPanel4FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP4({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive folder or file link (Excel .xlsx).',
      });
      return false;
    }

    setIsLoadingP4(true);
    setStatusP4(null);
    try {
      const fetched = await fetchRemoteDatabaseFile(trimmed, 'xlsx');
      if (fetched.success && fetched.buffer) {
        const res = await saveUploadedPage26OpCondDatabase(fetched.buffer, fetched.fileName);
        if (res.success && res.count > 0) {
          savePanel4SourceInfo({
            sourceType: 'remote_link',
            name: fetched.fileName,
            remoteUrl: trimmed,
            updatedAt: new Date().toISOString(),
            totalDates: res.count,
            dateRange: res.dateRange,
            recordCount: res.count * 4,
          });
          setPanel4Info(getPanel4SourceInfo());
          onDatabaseUpdated(getOrgDatabaseConfig());
          setStatusP4({
            type: 'success',
            msg: `Saved & synced "${fetched.fileName}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Now active for Public Dashboard 2.6 Chart 1 (Operation Condition % Database).`,
          });
          return true;
        }
      }

      const loaded = await ensurePage26DatasetsLoaded(true);
      if (loaded.opCond && loaded.opCond.totalDates > 0) {
        const updatedInfo: DataPanelSourceInfo = {
          sourceType: 'remote_link',
          name: loaded.opCond.fileName,
          remoteUrl: trimmed,
          updatedAt: new Date().toISOString(),
          totalDates: loaded.opCond.totalDates,
          dateRange: loaded.opCond.dateRange,
          recordCount: loaded.opCond.totalDates * 4,
        };
        savePanel4SourceInfo(updatedInfo);
        setPanel4Info(updatedInfo);
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP4({
          type: 'success',
          msg: `Saved & synced "${loaded.opCond.fileName}" (${loaded.opCond.totalDates} dates: ${loaded.opCond.dateRange.firstDate} to ${loaded.opCond.dateRange.latestDate}) → Now active for Public Dashboard 2.6 Chart 1.`,
        });
        return true;
      }

      throw new Error(fetched.error || 'Could not download Operation Condition Database from link.');
    } catch (err: any) {
      setStatusP4({
        type: 'error',
        msg: err?.message || 'Failed to sync Operation Condition Database from link.',
      });
      return false;
    } finally {
      setIsLoadingP4(false);
    }
  };

  const handlePanel4FileUpload = async (file: File) => {
    if (!file) return;
    setIsLoadingP4(true);
    setStatusP4(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await saveUploadedPage26OpCondDatabase(buffer, file.name);
      if (res.success && res.count > 0) {
        setPanel4Info(getPanel4SourceInfo());
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP4({
          type: 'success',
          msg: `Loaded "${file.name}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Public Dashboard 2.6 Chart 1 (Operation Condition Database).`,
        });
      } else {
        setStatusP4({
          type: 'error',
          msg: res.error || 'No valid 4-sheet Operation Condition records found in uploaded Excel file.',
        });
      }
    } catch (err: any) {
      setStatusP4({
        type: 'error',
        msg: err?.message || 'Failed to parse Operation Condition Excel file.',
      });
    } finally {
      setIsLoadingP4(false);
    }
  };

  const handlePanel4Reset = () => {
    resetPanel4ToSample();
    const defaultUrl =
      'https://drive.google.com/drive/folders/1xGm5ZH9mkNQhTAuXmmBCsCnORL0un4nE?usp=sharing';
    setPanel4RemoteUrl(defaultUrl);
    setPanel4Info(getPanel4SourceInfo());
    onDatabaseUpdated(getOrgDatabaseConfig());
    setStatusP4({
      type: 'success',
      msg: 'Restored default Operation Condition Database for Public Dashboard 2.6 Chart 1.',
    });
  };

  // ---------------------------------------------------------------------------
  // SECTOR 2.5 HANDLERS: 30-Min Load Curve Database (48 Intervals) — Feeds 2.6 Chart 2
  // ---------------------------------------------------------------------------
  const syncPanel5FromGoogleDriveLink = async (urlToSync: string): Promise<boolean> => {
    const trimmed = urlToSync.trim();
    if (!trimmed) {
      setStatusP5({
        type: 'error',
        msg: 'Please enter a valid shared Google Drive folder or file link (Excel .xlsx).',
      });
      return false;
    }

    setIsLoadingP5(true);
    setStatusP5(null);
    try {
      const fetched = await fetchRemoteDatabaseFile(trimmed, 'xlsx');
      if (fetched.success && fetched.buffer) {
        const res = await saveUploadedPage26LoadCurveDatabase(fetched.buffer, fetched.fileName);
        if (res.success && res.count > 0) {
          savePanel5SourceInfo({
            sourceType: 'remote_link',
            name: fetched.fileName,
            remoteUrl: trimmed,
            updatedAt: new Date().toISOString(),
            totalDates: res.count,
            dateRange: res.dateRange,
            recordCount: res.count * 48,
          });
          setPanel5Info(getPanel5SourceInfo());
          onDatabaseUpdated(getOrgDatabaseConfig());
          setStatusP5({
            type: 'success',
            msg: `Saved & synced "${fetched.fileName}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Now active for Public Dashboard 2.6 Chart 2 (30-Min Load Curve Database).`,
          });
          return true;
        }
      }

      const loaded = await ensurePage26DatasetsLoaded(true);
      if (loaded.loadCurve && loaded.loadCurve.totalDates > 0) {
        const updatedInfo: DataPanelSourceInfo = {
          sourceType: 'remote_link',
          name: loaded.loadCurve.fileName,
          remoteUrl: trimmed,
          updatedAt: new Date().toISOString(),
          totalDates: loaded.loadCurve.totalDates,
          dateRange: loaded.loadCurve.dateRange,
          recordCount: loaded.loadCurve.totalDates * 48,
        };
        savePanel5SourceInfo(updatedInfo);
        setPanel5Info(updatedInfo);
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP5({
          type: 'success',
          msg: `Saved & synced "${loaded.loadCurve.fileName}" (${loaded.loadCurve.totalDates} dates: ${loaded.loadCurve.dateRange.firstDate} to ${loaded.loadCurve.dateRange.latestDate}) → Now active for Public Dashboard 2.6 Chart 2.`,
        });
        return true;
      }

      throw new Error(fetched.error || 'Could not download 30-Min Load Curve Database from link.');
    } catch (err: any) {
      setStatusP5({
        type: 'error',
        msg: err?.message || 'Failed to sync 30-Min Load Curve Database from link.',
      });
      return false;
    } finally {
      setIsLoadingP5(false);
    }
  };

  const handlePanel5FileUpload = async (file: File) => {
    if (!file) return;
    setIsLoadingP5(true);
    setStatusP5(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await saveUploadedPage26LoadCurveDatabase(buffer, file.name);
      if (res.success && res.count > 0) {
        setPanel5Info(getPanel5SourceInfo());
        onDatabaseUpdated(getOrgDatabaseConfig());
        setStatusP5({
          type: 'success',
          msg: `Loaded "${file.name}" (${res.count} dates: ${res.dateRange.firstDate} to ${res.dateRange.latestDate}) → Active for Public Dashboard 2.6 Chart 2 (30-Min Load Curve Database).`,
        });
      } else {
        setStatusP5({
          type: 'error',
          msg: res.error || 'No valid 48-interval Load Curve records found in uploaded Excel file.',
        });
      }
    } catch (err: any) {
      setStatusP5({
        type: 'error',
        msg: err?.message || 'Failed to parse 30-Min Load Curve Excel file.',
      });
    } finally {
      setIsLoadingP5(false);
    }
  };

  const handlePanel5Reset = () => {
    resetPanel5ToSample();
    const defaultUrl =
      'https://drive.google.com/drive/folders/1OCCulyWoTU5hnRltkH9J7ZcsNdXDbCeo?usp=sharing';
    setPanel5RemoteUrl(defaultUrl);
    setPanel5Info(getPanel5SourceInfo());
    onDatabaseUpdated(getOrgDatabaseConfig());
    setStatusP5({
      type: 'success',
      msg: 'Restored default 30-Min Load Curve Database for Public Dashboard 2.6 Chart 2.',
    });
  };

  // ---------------------------------------------------------------------------
  // MASTER HANDLER: Save Setting Across All 5 Shared Google Drive Panels
  // ---------------------------------------------------------------------------
  const handleSaveAllSettings = async () => {
    setIsSavingAll(true);
    setSaveAllStatus(null);

    persistAllFiveLinks();

    const syncedPanels: string[] = [];
    const failedPanels: string[] = [];

    if (panel1RemoteUrl.trim()) {
      const ok1 = await syncPanel1FromGoogleDriveLink(panel1RemoteUrl);
      if (ok1) syncedPanels.push('2.1 Daily Peak Temp DB');
      else failedPanels.push('2.1 Daily Peak Temp DB');
    }
    if (panel2RemoteUrl.trim()) {
      const ok2 = await syncPanel2FromGoogleDriveLink(panel2RemoteUrl);
      if (ok2) syncedPanels.push('2.2 Daily Max Power DB');
      else failedPanels.push('2.2 Daily Max Power DB');
    }
    if (panel3RemoteUrl.trim()) {
      const ok3 = await syncPanel3FromGoogleDriveLink(panel3RemoteUrl);
      if (ok3) syncedPanels.push('2.3 Section Daily Profile DB');
      else failedPanels.push('2.3 Section Daily Profile DB');
    }
    if (panel4RemoteUrl.trim()) {
      const ok4 = await syncPanel4FromGoogleDriveLink(panel4RemoteUrl);
      if (ok4) syncedPanels.push('2.4 Operation Condition DB (2.6 Chart 1)');
      else failedPanels.push('2.4 Operation Condition DB');
    }
    if (panel5RemoteUrl.trim()) {
      const ok5 = await syncPanel5FromGoogleDriveLink(panel5RemoteUrl);
      if (ok5) syncedPanels.push('2.5 30-Min Load Curve DB (2.6 Chart 2)');
      else failedPanels.push('2.5 30-Min Load Curve DB');
    }

    await saveAllCurrentPanelsAsDefaultDataSource();
    setIsSavingAll(false);

    if (failedPanels.length > 0) {
      setSaveAllStatus({
        type: 'error',
        msg: `Saved link settings, but failed to fetch: ${failedPanels.join(', ')}. Ensure the Google Drive folders/files are shared as "Anyone with the link".`,
      });
    } else if (syncedPanels.length > 0) {
      setSaveAllStatus({
        type: 'success',
        msg: `All 5 database panels saved & synchronized (${syncedPanels.join(' · ')}). Public Dashboard charts 2.1 through 2.6 are now visualizing the latest files.`,
      });
    } else {
      setSaveAllStatus({
        type: 'success',
        msg: 'All 5 database panels saved as the default data source for the Public Dashboard (Charts 2.1–2.6).',
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
          <Globe className="w-3 h-3" /> Auto-Synced Shared Drive File
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-mono font-bold uppercase">
        <Database className="w-3 h-3" /> Built-In Baseline Dataset
      </span>
    );
  };

  const clampedRefreshPct = Math.min(100, Math.max(0, Math.round(refreshProgress)));

  return (
    <div className="space-y-6 pb-10">
      {/* Top Header Banner + 5-Folder Auto-Version Check & Live Progress Control */}
      <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden space-y-5">
        <div className="absolute -right-12 -top-12 w-56 h-56 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30">
                  PUBLIC DASHBOARD DATA SETTING · 5 SHARED GOOGLE DRIVE FOLDERS
                </span>
                <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Auto-Selects Newest File Version on Startup &amp; Refresh
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-1.5">
                Public Dashboard 5-Shared-Folder Data Sources (Charts 2.1 – 2.6)
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-4xl leading-relaxed">
                Manage all <strong className="text-white">5 Shared Google Drive Folders</strong> in one place—including{' '}
                <strong className="text-amber-300">Operation Condition Database (2.6 Chart 1)</strong> and{' '}
                <strong className="text-sky-300">30-Min Load Curve Database (2.6 Chart 2)</strong>. Whenever a newer file
                version or new file name is placed in any of the 5 shared Google Drive folders, the web app automatically
                detects and selects the newest file during the opening loading screen or when you click{' '}
                <strong className="text-emerald-300">Refresh All 5 Shared Folders</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {onRefreshPublicData && (
              <button
                type="button"
                onClick={onRefreshPublicData}
                disabled={isRefreshingPublicData || isSavingAll}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-mono text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] border border-emerald-400/40 disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshingPublicData ? 'animate-spin' : ''}`} />
                <span>
                  {isRefreshingPublicData
                    ? `Scanning 5 Folders (${clampedRefreshPct}%)`
                    : 'Refresh All 5 Shared Folders'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSaveAllSettings}
              disabled={
                isSavingAll ||
                isLoadingP1 ||
                isLoadingP2 ||
                isLoadingP3 ||
                isLoadingP4 ||
                isLoadingP5
              }
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

        {/* 5-Folder Overview & Live Update Progress Bar */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-bold text-slate-200">
                5-SHARED-FOLDER AUTOMATIC VERSION MONITOR:
              </span>
              <span className="text-cyan-300">
                {isRefreshingPublicData
                  ? refreshStatusText || 'Scanning all 5 Google Drive shared folders for newer files...'
                  : 'Active — Automatically checks all 5 folders on web app startup & refresh'}
              </span>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold tabular-nums">
              {isRefreshingPublicData ? `${clampedRefreshPct}% SYNCING` : '5 / 5 FOLDERS LINKED'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {[
              {
                num: '01',
                title: 'Folder 1 · Daily Peak Temp',
                file: panel1Info.name,
                dates: `${panel1Info.totalDates} Days`,
                feeds: '2.1 & 2.4',
                color: 'border-cyan-500/30 text-cyan-300',
              },
              {
                num: '02',
                title: 'Folder 2 · 4-Ckt Max Power',
                file: panel2Info.name,
                dates: `${panel2Info.totalDates} Days`,
                feeds: '2.4',
                color: 'border-emerald-500/30 text-emerald-300',
              },
              {
                num: '03',
                title: 'Folder 3 · 24-Hr Section Profile',
                file: panel3Info.name,
                dates: `${panel3Info.totalDates} Days`,
                feeds: '2.2, 2.3 & 2.5',
                color: 'border-purple-500/30 text-purple-300',
              },
              {
                num: '04',
                title: 'Folder 4 · Operation Condition',
                file: panel4Info.name,
                dates: `${panel4Info.totalDates} Days`,
                feeds: '2.6 Chart 1',
                color: 'border-amber-500/30 text-amber-300',
              },
              {
                num: '05',
                title: 'Folder 5 · 30-Min Load Curve',
                file: panel5Info.name,
                dates: `${panel5Info.totalDates} Days`,
                feeds: '2.6 Chart 2',
                color: 'border-sky-500/30 text-sky-300',
              },
            ].map((item) => (
              <div
                key={item.num}
                className={`rounded-xl bg-slate-900/90 border ${item.color} p-2.5 flex flex-col justify-between gap-1`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                  <span>{item.title}</span>
                  <span className="px-1.5 py-0.2 rounded bg-slate-950 text-slate-300 border border-slate-800">
                    {item.feeds}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-white truncate" title={item.file}>
                  {item.file}
                </div>
                <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                  <span>{item.dates}</span>
                  <span className="text-emerald-400 font-bold">Auto-Sync Ready</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6-PANEL GRID LAYOUT (PANELS 2.1 TO 2.5 + 2.6 ROUTING SUMMARY) */}
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
                      SECTOR 2.1 · SHARED FOLDER 1
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30">
                      Feeds 2.1 Heat Map &amp; 2.4 Yearly Comparison
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.1 Data source of &ldquo;Daily peak temperature database&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive Folder 1 (19-sheet Excel <code className="text-cyan-300">.xlsx</code> or{' '}
                    <code className="text-cyan-300">.csv</code>) containing daily peak fiber &amp; conductor temperatures.
                  </p>
                </div>
              </div>
              {panel1RemoteUrl && (
                <a
                  href={panel1RemoteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                >
                  <span>Drive Folder 1</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
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
                Shared Google Drive Folder / File Link (Excel .xlsx or .csv)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel1RemoteUrl}
                  onChange={(e) => setPanel1RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/... or https://drive.google.com/file/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP1}
                  onClick={async () => {
                    persistAllFiveLinks(panel1RemoteUrl);
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
                      SECTOR 2.2 · SHARED FOLDER 2
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-emerald-500/30">
                      Feeds 2.4 Yearly Comparison (4 Circuits)
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.2 Data source of &ldquo;Daily maximum power consumption database&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive Folder 2 (Excel <code className="text-emerald-300">.xlsx</code> or{' '}
                    <code className="text-emerald-300">.csv</code>) containing daily peak power (MW) across 4 circuits.
                  </p>
                </div>
              </div>
              {panel2RemoteUrl && (
                <a
                  href={panel2RemoteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                >
                  <span>Drive Folder 2</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
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
                Shared Google Drive Folder / File Link (Excel .xlsx or .csv)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel2RemoteUrl}
                  onChange={(e) => setPanel2RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/... or https://drive.google.com/file/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP2}
                  onClick={async () => {
                    persistAllFiveLinks(panel1RemoteUrl, panel2RemoteUrl);
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
                      SECTOR 2.3 · SHARED FOLDER 3
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-purple-500/30">
                      Feeds 2.2 Daily Curve, 2.3 3D Surface &amp; 2.5 Temp Stats
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.3 Data source of &ldquo;Section daily profile database&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive Folder 3 (19-sheet Excel <code className="text-purple-300">.xlsx</code> or{' '}
                    <code className="text-purple-300">.csv</code>) containing 24-hour section temperature &amp; power profiles.
                  </p>
                </div>
              </div>
              {panel3RemoteUrl && (
                <a
                  href={panel3RemoteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                >
                  <span>Drive Folder 3</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
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
                Shared Google Drive Folder / File Link (Excel .xlsx or .csv)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel3RemoteUrl}
                  onChange={(e) => setPanel3RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/... or https://drive.google.com/file/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-purple-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP3}
                  onClick={async () => {
                    persistAllFiveLinks(panel1RemoteUrl, panel2RemoteUrl, panel3RemoteUrl);
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
              Visualized in: <strong className="text-purple-300">2.2 Daily Curve</strong>,{' '}
              <strong className="text-purple-300">2.3 3D Surface</strong> &amp;{' '}
              <strong className="text-purple-300">2.5 Temp Stats</strong>
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
        {/* SECTOR 2.4: Operation Condition Database (4 Sheets) — Feeds 2.6 Ch 1  */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-amber-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      SECTOR 2.4 · SHARED FOLDER 4
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-amber-500/30">
                      Feeds 2.6 Power Statistics · Chart 1 (4 Sheets)
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.4 Data source of &ldquo;Operation condition database (4 Sheets)&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive Folder 4 (Excel <code className="text-amber-300">.xlsx</code>) containing daily
                    Normal / Emergency / Critical / Overload % for all 4 circuits (Chart 1 of Page 2.6).
                  </p>
                </div>
              </div>
              {panel4RemoteUrl && (
                <a
                  href={panel4RemoteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                >
                  <span>Drive Folder 4</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Active Source Status Box */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Active Database File (Chart 1 Source):
                </span>
                {renderSourceBadge(panel4Info.sourceType)}
              </div>

              <div className="text-xs font-mono font-bold text-white break-all flex items-center gap-2 bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                <FileSpreadsheet className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{panel4Info.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Dates</div>
                  <div className="text-sm font-mono font-bold text-amber-300 mt-0.5">
                    {panel4Info.totalDates.toLocaleString()} Days
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5 col-span-2">
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-amber-400" /> Date Period
                  </div>
                  <div className="text-xs font-mono font-bold text-white mt-0.5">
                    {panel4Info.dateRange.firstDate || 'N/A'} → {panel4Info.dateRange.latestDate || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Shared Google Drive Link Input */}
            <div className="bg-slate-950/70 border border-amber-500/30 rounded-xl p-4 space-y-3">
              <label className="block text-xs font-mono font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-amber-400" />
                Shared Google Drive Folder / File Link (Excel .xlsx)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel4RemoteUrl}
                  onChange={(e) => setPanel4RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/... or https://drive.google.com/file/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP4}
                  onClick={async () => {
                    persistAllFiveLinks(
                      panel1RemoteUrl,
                      panel2RemoteUrl,
                      panel3RemoteUrl,
                      panel4RemoteUrl,
                      panel5RemoteUrl
                    );
                    await syncPanel4FromGoogleDriveLink(panel4RemoteUrl);
                  }}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingP4 ? (
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
                  ref={fileInputP4Ref}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePanel4FileUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isLoadingP4}
                  onClick={() => fileInputP4Ref.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Browse Local Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={handlePanel4Reset}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-mono transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Default
                </button>
              </div>
            </div>

            {statusP4 && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-mono ${
                  statusP4.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                }`}
              >
                {statusP4.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{statusP4.msg}</span>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Visualized in: <strong className="text-amber-300">2.6 Power Statistics (Chart 1)</strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigateToChart('powerstats')}
              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
            >
              Open 2.6 Chart 1 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* SECTOR 2.5: 30-Min Load Curve Database (48 Intervals) — Feeds 2.6 Ch2 */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-sky-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40">
                      SECTOR 2.5 · SHARED FOLDER 5
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-sky-500/30">
                      Feeds 2.6 Power Statistics · Chart 2 (48 Half-Hr Slots)
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.5 Data source of &ldquo;30-min load curve database (48 intervals/day)&rdquo;
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shared Google Drive Folder 5 (Excel <code className="text-sky-300">.xlsx</code>) containing 48
                    half-hour load curve intervals per day across all 4 circuits (Chart 2 of Page 2.6).
                  </p>
                </div>
              </div>
              {panel5RemoteUrl && (
                <a
                  href={panel5RemoteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-sky-300 border border-sky-500/30 text-[10px] font-mono font-bold flex items-center gap-1 shrink-0"
                >
                  <span>Drive Folder 5</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Active Source Status Box */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Active Database File (Chart 2 Source):
                </span>
                {renderSourceBadge(panel5Info.sourceType)}
              </div>

              <div className="text-xs font-mono font-bold text-white break-all flex items-center gap-2 bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                <FileSpreadsheet className="w-4 h-4 text-sky-400 shrink-0" />
                <span>{panel5Info.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Dates</div>
                  <div className="text-sm font-mono font-bold text-sky-300 mt-0.5">
                    {panel5Info.totalDates.toLocaleString()} Days
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5 col-span-2">
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-sky-400" /> Date Period
                  </div>
                  <div className="text-xs font-mono font-bold text-white mt-0.5">
                    {panel5Info.dateRange.firstDate || 'N/A'} → {panel5Info.dateRange.latestDate || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Shared Google Drive Link Input */}
            <div className="bg-slate-950/70 border border-sky-500/30 rounded-xl p-4 space-y-3">
              <label className="block text-xs font-mono font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-sky-400" />
                Shared Google Drive Folder / File Link (Excel .xlsx)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={panel5RemoteUrl}
                  onChange={(e) => setPanel5RemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/... or https://drive.google.com/file/d/..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-sky-400 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isLoadingP5}
                  onClick={async () => {
                    persistAllFiveLinks(
                      panel1RemoteUrl,
                      panel2RemoteUrl,
                      panel3RemoteUrl,
                      panel4RemoteUrl,
                      panel5RemoteUrl
                    );
                    await syncPanel5FromGoogleDriveLink(panel5RemoteUrl);
                  }}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingP5 ? (
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
                  ref={fileInputP5Ref}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePanel5FileUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isLoadingP5}
                  onClick={() => fileInputP5Ref.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Browse Local Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={handlePanel5Reset}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-mono transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Default
                </button>
              </div>
            </div>

            {statusP5 && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-mono ${
                  statusP5.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                }`}
              >
                {statusP5.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{statusP5.msg}</span>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Visualized in: <strong className="text-sky-300">2.6 Power Statistics (Chart 2)</strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigateToChart('powerstats')}
              className="px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[11px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
            >
              Open 2.6 Chart 2 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* SECTOR 2.6: Save Setting & 5-Folder Public Chart Routing Control      */}
        {/* ===================================================================== */}
        <div className="bg-slate-900/90 border-2 border-teal-500/35 rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            {/* Sector Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-teal-500/15 border border-teal-500/40 flex items-center justify-center text-teal-400 shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/40">
                      SECTOR 2.6 · 5-FOLDER CONTROL &amp; ROUTING
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      All 6 Public Pages (2.1–2.6) Linked
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-1.5">
                    2.6 Public Dashboard Visualization Routing &amp; Save Setting
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Summary of how all 5 shared Google Drive database folders feed Public Dashboard pages 2.1 through 2.6.
                  </p>
                </div>
              </div>
            </div>

            {/* Routing Matrix */}
            <div className="space-y-2.5">
              {/* Route 1: Daily Max Heat Map (2.1) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
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
                  View 2.1 <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Route 2: Daily Curve (2.2), 3D Surface (2.3) & Temp Stats (2.5) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px]">
                      2.2 · 2.3 · 2.5
                    </span>
                    Daily Curve (2.2), 3D Surface (2.3) &amp; Temp Stats (2.5)
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Data Source: <strong className="text-purple-300">Section daily profile database (Panel 2.3)</strong>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigateToChart('dailycurve')}
                    className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold cursor-pointer"
                  >
                    2.2
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateToChart('powertemp3d')}
                    className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold cursor-pointer"
                  >
                    2.3
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateToChart('tempstats')}
                    className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/30 text-[11px] font-mono font-bold cursor-pointer"
                  >
                    2.5
                  </button>
                </div>
              </div>

              {/* Route 3: Yearly comparison (2.4) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
                      2.4
                    </span>
                    Yearly comparison (2.4)
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Data Source:{' '}
                    <strong className="text-cyan-300">Panel 2.1</strong> +{' '}
                    <strong className="text-emerald-300">Panel 2.2</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToChart('yearly')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono font-bold shrink-0 cursor-pointer flex items-center gap-1"
                >
                  View 2.4 <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Route 4: Power Statistics (2.6 Chart 1 & Chart 2) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">
                      2.6
                    </span>
                    Power Statistics · Chart 1 (Op Condition) &amp; Chart 2 (30-Min Load Curve)
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Data Source:{' '}
                    <strong className="text-amber-300">Operation Condition DB (Panel 2.4)</strong> +{' '}
                    <strong className="text-sky-300">30-Min Load Curve DB (Panel 2.5)</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToChart('powerstats')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-[11px] font-mono font-bold shrink-0 cursor-pointer flex items-center gap-1"
                >
                  View 2.6 <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Master Save Setting Action Box */}
            <div className="bg-slate-950/80 border border-teal-500/30 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-xs font-mono font-bold text-teal-300 uppercase">
                    Apply &amp; Synchronize All 5 Shared Google Drive Folders
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Click Save Setting to fetch, parse, and bind all 5 configured Google Drive links to Public Dashboard charts 2.1–2.6.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSaveAllSettings}
                  disabled={
                    isSavingAll ||
                    isLoadingP1 ||
                    isLoadingP2 ||
                    isLoadingP3 ||
                    isLoadingP4 ||
                    isLoadingP5
                  }
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-slate-950 font-mono text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shrink-0 shadow-lg disabled:opacity-50 cursor-pointer"
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
            <span>Public Dashboard 5-Folder Auto-Sync: ACTIVE</span>
            <span className="text-emerald-400 font-bold">Zero Login Session Dependency</span>
          </div>
        </div>
      </div>
    </div>
  );
};
