import React from 'react';
import { 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink, 
  Eye, 
  Clock, 
  HardDrive,
  RefreshCw,
  FileCode,
  Table,
  Activity
} from 'lucide-react';
import { DriveFile, AgentFileResult } from '../types';

interface FileListProps {
  files: DriveFile[];
  results: Record<string, AgentFileResult>;
  selectedFileId: string | null;
  selectedBatchIds: string[];
  onToggleSelectBatch: (fileId: string) => void;
  onSelectAllBatch: () => void;
  onSelectFileForView: (fileId: string) => void;
  onRunSingleFile: (file: DriveFile) => void;
  isProcessing: boolean;
}

export const FileList: React.FC<FileListProps> = ({
  files,
  results,
  selectedFileId,
  selectedBatchIds,
  onToggleSelectBatch,
  onSelectAllBatch,
  onSelectFileForView,
  onRunSingleFile,
  isProcessing,
}) => {
  const formatBytes = (bytes?: string | number) => {
    if (!bytes) return '--';
    const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (isNaN(num)) return '--';
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '--';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return isoString;
    }
  };

  const getFileIcon = (mimeType: string, name: string) => {
    if (name.endsWith('.tepr')) return <Activity className="w-4 h-4 text-purple-600" />;
    if (name.endsWith('.md')) return <FileCode className="w-4 h-4 text-emerald-600" />;
    if (name.endsWith('.csv') || name.endsWith('.tsv')) return <Table className="w-4 h-4 text-emerald-600" />;
    if (name.endsWith('.json') || name.endsWith('.js') || name.endsWith('.py')) return <FileCode className="w-4 h-4 text-amber-600" />;
    return <FileText className="w-4 h-4 text-blue-600" />;
  };

  const allSelected = files.length > 0 && selectedBatchIds.length === files.length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col">
      {/* Table Header Controls */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <input
            id="select-all-files-checkbox"
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAllBatch}
            disabled={files.length === 0 || isProcessing}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
          />
          <span className="text-xs font-semibold text-slate-700">
            Files in Target Folder ({files.length})
          </span>
          {selectedBatchIds.length > 0 && (
            <span className="text-xs text-blue-600 font-medium">
              ({selectedBatchIds.length} selected)
            </span>
          )}
        </div>

        <div className="text-[11px] text-slate-400 font-medium">
          Click any file to inspect details or run individually
        </div>
      </div>

      {/* Files List */}
      <div className="divide-y divide-slate-100 overflow-y-auto max-h-[480px]">
        {files.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <HardDrive className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-sm font-semibold text-slate-700">No matching text files found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Try switching the file type filter or selecting a different folder in your Google Drive.
            </p>
          </div>
        ) : (
          files.map((file) => {
            const result = results[file.id];
            const isSelectedForView = selectedFileId === file.id;
            const isBatchChecked = selectedBatchIds.includes(file.id);
            const status = result?.status || 'idle';

            return (
              <div
                key={file.id}
                id={`file-row-${file.id}`}
                className={`flex items-center justify-between p-3.5 hover:bg-slate-50/80 transition-colors cursor-pointer ${
                  isSelectedForView ? 'bg-blue-50/50 border-l-4 border-l-blue-600' : ''
                }`}
                onClick={() => onSelectFileForView(file.id)}
              >
                {/* Left: Checkbox & File info */}
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                  <input
                    type="checkbox"
                    checked={isBatchChecked}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleSelectBatch(file.id);
                    }}
                    disabled={isProcessing}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer shrink-0"
                  />

                  <div className="p-2 rounded-lg bg-slate-100 shrink-0">
                    {getFileIcon(file.mimeType, file.name)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {file.name}
                      </span>
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Open original file in Google Drive"
                          className="text-slate-400 hover:text-blue-600"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                      <span>{formatBytes(file.size)}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(file.modifiedTime)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Status Pill & Action button */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Status Badge */}
                  {status === 'reading' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Reading Drive
                    </span>
                  )}
                  {status === 'analyzing' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      <Sparkles className="w-3 h-3 animate-spin text-indigo-600" />
                      Analyzing
                    </span>
                  )}
                  {status === 'completed' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      Summarized
                    </span>
                  )}
                  {status === 'error' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                      Error
                    </span>
                  )}
                  {status === 'idle' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
                      Ready
                    </span>
                  )}

                  {/* Action Button */}
                  {status === 'completed' ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectFileForView(file.id);
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">View</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRunSingleFile(file);
                      }}
                      disabled={isProcessing}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      <span className="hidden sm:inline">Analyze</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
