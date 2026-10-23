import React, { useState } from 'react';
import { FileText, FileCode, Table, Terminal, FileEdit, Filter, Plus, Activity } from 'lucide-react';
import { KNOWN_FILE_TYPES } from '../services/driveApi';

interface FileTypeFilterProps {
  selectedTypeId: string;
  customExt: string;
  onSelectType: (typeId: string) => void;
  onCustomExtChange: (ext: string) => void;
  matchingCount: number;
}

export const FileTypeFilter: React.FC<FileTypeFilterProps> = ({
  selectedTypeId,
  customExt,
  onSelectType,
  onCustomExtChange,
  matchingCount,
}) => {
  const [showCustomInput, setShowCustomInput] = useState(Boolean(customExt));

  const getIcon = (id: string) => {
    switch (id) {
      case 'tepr':
        return <Activity className="w-3.5 h-3.5" />;
      case 'txt':
        return <FileText className="w-3.5 h-3.5" />;
      case 'md':
        return <FileCode className="w-3.5 h-3.5" />;
      case 'csv':
        return <Table className="w-3.5 h-3.5" />;
      case 'code_json':
        return <FileCode className="w-3.5 h-3.5" />;
      case 'logs':
        return <Terminal className="w-3.5 h-3.5" />;
      case 'gdoc':
        return <FileEdit className="w-3.5 h-3.5" />;
      default:
        return <FileText className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-blue-600" />
          Target File Type Filter
        </div>
        <div className="text-xs font-medium text-slate-600">
          Found <span className="font-bold text-slate-900">{matchingCount}</span> matching file(s)
        </div>
      </div>

      {/* Pill buttons */}
      <div className="flex flex-wrap gap-2">
        {KNOWN_FILE_TYPES.map((type) => {
          const isSelected = selectedTypeId === type.id && !customExt;
          return (
            <button
              key={type.id}
              id={`filter-btn-${type.id}`}
              type="button"
              onClick={() => {
                onSelectType(type.id);
                if (customExt) onCustomExtChange('');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs shadow-blue-500/20'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/80'
              }`}
            >
              {getIcon(type.id)}
              <span>{type.label}</span>
            </button>
          );
        })}

        {/* Custom extension button */}
        <button
          id="filter-custom-ext-btn"
          type="button"
          onClick={() => setShowCustomInput(!showCustomInput)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
            customExt
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/80'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{customExt ? `Custom: ${customExt}` : 'Specific Extension (.xyz)'}</span>
        </button>
      </div>

      {/* Custom extension text box */}
      {showCustomInput && (
        <div className="pt-2 flex items-center gap-2 animate-in fade-in duration-150">
          <input
            id="custom-ext-input"
            type="text"
            value={customExt}
            onChange={(e) => onCustomExtChange(e.target.value)}
            placeholder="e.g. .py, .sql, .log, .yaml, .rst"
            className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono w-64"
          />
          <span className="text-[11px] text-slate-400">
            Filters files ending with this extension
          </span>
        </div>
      )}
    </div>
  );
};
