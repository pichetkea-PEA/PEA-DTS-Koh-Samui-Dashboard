import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { 
  Bot, 
  Sparkles, 
  Copy, 
  Check, 
  Download, 
  CloudUpload, 
  MessageSquare, 
  Send, 
  RefreshCw, 
  Flame, 
  AlertCircle,
  FileCheck2,
  TrendingUp
} from 'lucide-react';
import { askAgentQuestion } from '../services/agentApi';
import { LocationTimeSeriesSummary, ParsedTeprFile } from '../services/teprParser';

interface CableSummaryReportProps {
  summary: string | null;
  isAnalyzing: boolean;
  onRunAgent: () => void;
  onSaveToDrive: () => void;
  isSavingToDrive: boolean;
  timeSeriesSummary: LocationTimeSeriesSummary[];
  parsedFiles: ParsedTeprFile[];
}

export const CableSummaryReport: React.FC<CableSummaryReportProps> = ({
  summary,
  isAnalyzing,
  onRunAgent,
  onSaveToDrive,
  isSavingToDrive,
  timeSeriesSummary,
  parsedFiles,
}) => {
  const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');
  const [copied, setCopied] = useState(false);

  // Chat Q&A state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'model'; content: string }>>([]);
  const [isAsking, setIsAsking] = useState(false);

  const handleCopy = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!summary) return;
    const blob = new Blob([summary], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Asset_Cable_Temperature_Summary_Report.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = chatInput.trim();
    if (!query || isAsking) return;

    const newHistory = [...chatMessages, { role: 'user' as const, content: query }];
    setChatMessages(newHistory);
    setChatInput('');
    setIsAsking(true);

    try {
      // Build summary of cable state for grounding
      const context = `
Chronological .TEPR Files (${parsedFiles.length}):
${parsedFiles.map((f) => `- ${f.fileName}: Date/Time=${f.header.dateTimeStr}, BaseTemp=${f.header.fiberReferenceTemp}C, MaxDelta=+${f.maxDeltaTemp}C at ${f.maxDeltaPosition}m`).join('\n')}

19 Monitoring Points State:
${timeSeriesSummary.map((t) => `- Location ${t.location}m (${t.tag}): Current Delta=+${t.currentDeltaTemp}C, Absolute=${t.currentAbsoluteTemp}C, Max=+${t.maxDeltaTemp}C, Status=${t.status}`).join('\n')}
      `;

      const reply = await askAgentQuestion({
        fileName: 'Linear Cable DTS Temperature Profile',
        fileContent: context,
        summary: summary || undefined,
        message: query,
        history: newHistory,
      });

      setChatMessages((prev) => [...prev, { role: 'model' as const, content: reply }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'model' as const, content: `Error: ${err.message || 'Could not query agent'}` },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const suggestedQuestions = [
    'Which of the 19 points has the highest temperature spike?',
    'What is the rate of temperature rise at Splice Zone Alpha (2541.62m)?',
    'Are there any immediate maintenance interventions needed?',
    'Compare temperature between the first and last .TEPR timestamps',
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col h-[620px] overflow-hidden">
      {/* Header & Tabs */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>Autonomous Agent Summary</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                Gemini 3.8 Flash
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Multi-file DTS thermal evaluation along linear cable asset
            </div>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'report' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
            <span>Report</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'chat' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
            <span>Agent Q&A</span>
          </button>
        </div>
      </div>

      {/* Action Toolbar */}
      {activeTab === 'report' && summary && (
        <div className="px-4 py-2 bg-slate-50/30 border-b border-slate-100 flex items-center justify-between text-xs">
          <div className="text-[11px] text-slate-500 font-medium">
            Generated from {parsedFiles.length} chronological .TEPR timestamps
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Copy Markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Download Markdown Report"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              type="button"
              onClick={onSaveToDrive}
              disabled={isSavingToDrive}
              className="px-2.5 py-1 text-blue-700 bg-blue-50 hover:bg-blue-100 font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Save report into Google Drive folder"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>{isSavingToDrive ? 'Saving...' : 'Save to Drive'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'report' ? (
          <div>
            {isAnalyzing ? (
              <div className="py-24 text-center space-y-3">
                <Sparkles className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
                <div className="text-base font-bold text-slate-800">
                  Autonomous Agent is Analyzing Cable Thermal Profile...
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Evaluating 19 designated monitoring positions, temperature gradients ($\Delta T$), and cross-timestamp heating trends.
                </p>
              </div>
            ) : summary ? (
              <div className="prose prose-slate prose-sm max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-h1:text-base prose-h2:text-sm prose-h3:text-xs prose-p:text-slate-700 prose-p:leading-relaxed prose-li:text-slate-700 prose-table:text-xs prose-th:bg-slate-100 prose-th:p-2 prose-td:p-2 font-sans">
                <Markdown>{summary}</Markdown>
              </div>
            ) : (
              <div className="py-24 text-center space-y-4">
                <Bot className="w-12 h-12 text-slate-300 mx-auto" />
                <div className="text-sm font-semibold text-slate-700">
                  No Cable Summary Generated Yet
                </div>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Click the "Analyze Cable Temperature Profile" button to run the autonomous agent across all .TEPR files.
                </p>
                <button
                  type="button"
                  onClick={onRunAgent}
                  disabled={parsedFiles.length === 0}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 rounded-xl shadow-md shadow-blue-500/20 transition-all cursor-pointer inline-flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Analyze Cable Profile Now</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Q&A Tab */
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-4">
              {chatMessages.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <MessageSquare className="w-9 h-9 text-indigo-400 mx-auto" />
                  <div className="text-xs font-semibold text-slate-800">
                    Ask Questions About Cable Temperature & Critical Points
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    The agent has full access to the 19 target location temperature measurements and chronological .TEPR timestamps.
                  </p>
                  <div className="flex flex-wrap gap-1.5 justify-center max-w-md mx-auto pt-2">
                    {suggestedQuestions.map((q, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setChatInput(q)}
                        className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'model' && (
                      <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-xs max-w-[85%] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-xs'
                          : 'bg-slate-100 text-slate-800 rounded-bl-xs'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}

              {isAsking && (
                <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  Agent is evaluating DTS sensor records...
                </div>
              )}
            </div>

            {/* Input */}
            <form onSubmit={handleSendChat} className="pt-2 border-t border-slate-100 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about hotspots, rate of change, specific meters..."
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isAsking}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
