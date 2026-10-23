import React, { useState } from 'react';
import { Sparkles, Sliders, Play, FileCheck, HelpCircle, Layers, Check } from 'lucide-react';
import { PRINCIPLE_PRESETS } from '../data/principles';
import { AgentPrinciplePreset } from '../types';

interface PrinciplesConfigProps {
  selectedPresetId: string;
  principlesPrompt: string;
  focusMode: string;
  customInstructions: string;
  onSelectPreset: (preset: AgentPrinciplePreset) => void;
  onPrinciplesChange: (prompt: string) => void;
  onFocusModeChange: (mode: string) => void;
  onCustomInstructionsChange: (val: string) => void;
  onRunBatchAgent: () => void;
  isProcessing: boolean;
  totalFiles: number;
  completedCount: number;
}

const FOCUS_MODES = [
  'Balanced',
  'Executive',
  'Deep Dive',
  'Action-Oriented',
  'Bullet-Points',
];

export const PrinciplesConfig: React.FC<PrinciplesConfigProps> = ({
  selectedPresetId,
  principlesPrompt,
  focusMode,
  customInstructions,
  onSelectPreset,
  onPrinciplesChange,
  onFocusModeChange,
  onCustomInstructionsChange,
  onRunBatchAgent,
  isProcessing,
  totalFiles,
  completedCount,
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
      {/* Header & Preset Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-blue-600" />
          Agent Principles & Directives
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Persona & Guidance Engine</span>
        </div>
      </div>

      {/* Preset Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {PRINCIPLE_PRESETS.map((preset) => {
          const isSelected = selectedPresetId === preset.id;
          return (
            <button
              key={preset.id}
              id={`preset-card-${preset.id}`}
              type="button"
              onClick={() => onSelectPreset(preset)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-blue-50/70 border-blue-500/80 ring-2 ring-blue-500/10'
                  : 'bg-slate-50/50 hover:bg-slate-100/70 border-slate-200/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className={`text-xs font-bold ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                    {preset.name}
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                  {preset.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Principles Prompt Textarea */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="agent-principles-textarea" className="text-xs font-semibold text-slate-700">
            Active Summarization Rules & Schema
          </label>
          <span className="text-[10px] text-slate-400">
            Edit directly to adapt principles to your exact requirements
          </span>
        </div>
        <textarea
          id="agent-principles-textarea"
          rows={3}
          value={principlesPrompt}
          onChange={(e) => onPrinciplesChange(e.target.value)}
          placeholder="Specify the exact principles the autonomous agent must adhere to..."
          className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50/30 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 font-mono transition-all resize-y leading-relaxed"
        />
      </div>

      {/* Focus Mode & Custom Modifiers */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Focus Mode:</span>
          {FOCUS_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onFocusModeChange(mode)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                focusMode === mode
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Action Run Batch Button */}
        <button
          id="run-autonomous-agent-btn"
          type="button"
          onClick={onRunBatchAgent}
          disabled={isProcessing || totalFiles === 0}
          className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:from-blue-800 active:to-indigo-800 disabled:opacity-40 rounded-xl shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 cursor-pointer"
        >
          {isProcessing ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              <span>Processing ({completedCount}/{totalFiles})...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run Agent on {totalFiles} File(s)</span>
            </>
          )}
        </button>
      </div>

      {/* Optional Custom Directive input */}
      <div className="pt-2">
        <input
          id="custom-instructions-input"
          type="text"
          value={customInstructions}
          onChange={(e) => onCustomInstructionsChange(e.target.value)}
          placeholder="Optional custom directive (e.g., 'Emphasize GDPR compliance', 'Translate output into French', 'Extract all dates')..."
          className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700 transition-all"
        />
      </div>
    </div>
  );
};
