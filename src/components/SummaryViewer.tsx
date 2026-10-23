import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { 
  FileText, 
  Sparkles, 
  Copy, 
  Check, 
  Download, 
  CloudUpload, 
  MessageSquare, 
  Code, 
  Info, 
  Send, 
  Bot, 
  User as UserIcon,
  RefreshCw
} from 'lucide-react';
import { AgentFileResult } from '../types';
import { askAgentQuestion } from '../services/agentApi';

interface SummaryViewerProps {
  result: AgentFileResult | null;
  onSaveToDriveRequest: (result: AgentFileResult) => void;
  isSavingToDrive: boolean;
}

export const SummaryViewer: React.FC<SummaryViewerProps> = ({
  result,
  onSaveToDriveRequest,
  isSavingToDrive,
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'original' | 'chat' | 'metadata'>('summary');
  const [copied, setCopied] = useState(false);
  
  // Interactive Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'model'; content: string }>>([]);
  const [isAsking, setIsAsking] = useState(false);

  if (!result) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xs flex flex-col items-center justify-center text-center h-[540px] text-slate-400">
        <Bot className="w-12 h-12 text-slate-300 mb-3" />
        <h3 className="text-base font-semibold text-slate-700">No Document Selected</h3>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          Select a file from the list or run the autonomous agent to inspect the structured summary.
        </p>
      </div>
    );
  }

  const handleCopySummary = () => {
    if (!result.summary) return;
    navigator.clipboard.writeText(result.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    if (!result.summary) return;
    const blob = new Blob([result.summary], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${result.fileName}_Summary.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = chatInput.trim();
    if (!query || isAsking) return;

    const newHistory = [...chatMessages, { role: 'user' as const, content: query }];
    setChatMessages(newHistory);
    setChatInput('');
    setIsAsking(true);

    try {
      const reply = await askAgentQuestion({
        fileName: result.fileName,
        fileContent: result.originalText || '',
        summary: result.summary,
        message: query,
        history: newHistory,
      });

      setChatMessages((prev) => [...prev, { role: 'model' as const, content: reply }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'model' as const, content: `Error: ${err.message || 'Could not answer query'}` },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const suggestedQuestions = [
    'What are the key action items?',
    'Summarize this for an executive in 2 sentences',
    'Are there any notable risks or blockers mentioned?',
    'Extract all dates, deadlines, or metrics',
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col h-[580px] overflow-hidden">
      {/* Header bar */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 truncate">
              {result.fileName}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/60 font-semibold">
              {result.wordCount ? `${result.wordCount} words` : 'Text File'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {result.processedAt ? `Processed ${new Date(result.processedAt).toLocaleTimeString()}` : 'Ready for analysis'}
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl">
          <button
            id="tab-summary-btn"
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'summary' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Summary</span>
          </button>

          <button
            id="tab-original-btn"
            type="button"
            onClick={() => setActiveTab('original')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'original' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>Original Text</span>
          </button>

          <button
            id="tab-chat-btn"
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'chat' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
            <span>Q&A</span>
          </button>
        </div>
      </div>

      {/* Action Toolbar (for Summary Tab) */}
      {activeTab === 'summary' && result.summary && (
        <div className="px-4 py-2 bg-slate-50/30 border-b border-slate-100 flex items-center justify-between text-xs">
          <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-blue-600" />
            Autonomous Agent Structured Output
          </div>
          <div className="flex items-center gap-1.5">
            <button
              id="copy-summary-btn"
              type="button"
              onClick={handleCopySummary}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Copy Summary Markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            <button
              id="download-markdown-btn"
              type="button"
              onClick={handleDownloadMarkdown}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Download as Markdown"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              id="save-to-drive-btn"
              type="button"
              onClick={() => onSaveToDriveRequest(result)}
              disabled={isSavingToDrive}
              className="px-2.5 py-1 text-blue-700 bg-blue-50 hover:bg-blue-100 font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Save Summary file to Drive folder"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>{isSavingToDrive ? 'Saving...' : 'Save to Drive'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Tab 1: Summary */}
        {activeTab === 'summary' && (
          <div>
            {result.status === 'reading' || result.status === 'analyzing' ? (
              <div className="py-20 text-center space-y-3">
                <Sparkles className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
                <div className="text-sm font-semibold text-slate-800">
                  {result.status === 'reading' ? 'Fetching text from Google Drive...' : 'Gemini Agent is analyzing document principles...'}
                </div>
                <p className="text-xs text-slate-400">Extracting facts, key takeaways, and action items</p>
              </div>
            ) : result.summary ? (
              <div className="prose prose-slate prose-sm max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-h1:text-base prose-h2:text-sm prose-h3:text-xs prose-p:text-slate-700 prose-p:leading-relaxed prose-li:text-slate-700 prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs font-sans">
                <Markdown>{result.summary}</Markdown>
              </div>
            ) : result.error ? (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-xs">
                <div className="font-semibold mb-1">Analysis Failed:</div>
                <div>{result.error}</div>
              </div>
            ) : (
              <div className="py-20 text-center text-xs text-slate-400">
                Click "Analyze" to run the autonomous summarizer on this file.
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Original Text File */}
        {activeTab === 'original' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-slate-100">
              <span>Characters: {result.originalText?.length || 0}</span>
              <span>MIME: {result.fileType}</span>
            </div>
            <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap max-h-[440px]">
              {result.originalText || 'Content has not been fetched yet.'}
            </pre>
          </div>
        )}

        {/* Tab 3: Interactive Q&A Chat */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-4">
              {chatMessages.length === 0 ? (
                <div className="py-8 text-center space-y-3">
                  <MessageSquare className="w-8 h-8 text-indigo-400 mx-auto" />
                  <div className="text-xs font-semibold text-slate-700">
                    Ask questions about {result.fileName}
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    The agent is grounded on this document's text to answer follow-up questions or extract custom details.
                  </p>
                  <div className="flex flex-wrap gap-1.5 justify-center max-w-md mx-auto pt-2">
                    {suggestedQuestions.map((q, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setChatInput(q);
                        }}
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
                  Agent is reviewing document...
                </div>
              )}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendChatMessage} className="pt-2 border-t border-slate-100 flex gap-2">
              <input
                id="doc-chat-input"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask anything about this document..."
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
              />
              <button
                id="send-doc-chat-btn"
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
