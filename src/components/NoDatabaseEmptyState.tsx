import React from 'react';
import { Database, AlertCircle, HardDrive, ShieldAlert, ArrowRight } from 'lucide-react';

interface NoDatabaseEmptyStateProps {
  pageTitle: string;
  pageNumber: string;
  onAdminLoginClick?: () => void;
  isAdminLoggedIn?: boolean;
  onGoToFolderAsset?: () => void;
}

export const NoDatabaseEmptyState: React.FC<NoDatabaseEmptyStateProps> = ({
  pageTitle,
  pageNumber,
  onAdminLoginClick,
  isAdminLoggedIn = false,
  onGoToFolderAsset,
}) => {
  return (
    <div className="w-full max-w-3xl mx-auto my-12 bg-slate-900/80 backdrop-blur-xl rounded-3xl border border-cyan-500/20 p-8 sm:p-12 shadow-[0_0_50px_rgba(6,182,212,0.06)] text-center space-y-6 animate-in fade-in duration-300">
      <div className="w-16 h-16 rounded-2xl bg-amber-950/60 text-amber-400 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(245,158,11,0.25)] border border-amber-500/40">
        <Database className="w-8 h-8" />
      </div>

      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-500/30 text-xs font-mono font-bold tracking-wide">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          <span>NO TELEMETRY DATABASE CONFIGURED</span>
        </div>
        <h3 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">
          <span className="font-mono text-cyan-400 mr-2">[{pageNumber}]</span> {pageTitle}
        </h3>
        <p className="text-sm text-slate-400 leading-relaxed max-w-xl mx-auto font-sans">
          There is currently no compiled DTS or SCADA database attached to this telemetry node. The public dashboard strictly visualizes verified operational records from the submarine power grid and never generates synthetic or placeholder data.
        </p>
      </div>

      <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/80 border border-slate-800 max-w-lg mx-auto text-left space-y-2.5 text-xs text-slate-300 font-mono">
        <div className="font-bold text-cyan-300 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-cyan-400" />
          <span>ADMINISTRATOR ACTIVATION PROCEDURE:</span>
        </div>
        <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pl-1 text-[11px] leading-relaxed">
          <li>
            Sign in with authorized PEA-Submarine Cable credentials via the top-right button.
          </li>
          <li>
            Navigate to <strong className="text-slate-200">Page 1 (Folder &amp; Asset)</strong>.
          </li>
          <li>
            Set the permanent target folder or upload the multi-sheet database (<code>.xlsx</code> / <code>.csv</code>).
          </li>
          <li>
            The database will be permanently saved and live across all telemetry feeds.
          </li>
        </ol>
      </div>

      <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
        {isAdminLoggedIn ? (
          <button
            type="button"
            onClick={onGoToFolderAsset}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold font-mono text-cyan-950 bg-cyan-400 hover:bg-cyan-300 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all cursor-pointer"
          >
            <span>CONFIGURE IN PAGE 1 (FOLDER &amp; ASSET)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onAdminLoginClick}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold font-mono text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/40 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <HardDrive className="w-4 h-4 text-cyan-400" />
            <span>ADMINISTRATOR SIGN-IN</span>
          </button>
        )}
      </div>
    </div>
  );
};
