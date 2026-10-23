export interface SummarizeParams {
  fileName: string;
  fileContent: string;
  fileType?: string;
  principles: string;
  focusMode: string;
  customPrompt?: string;
}

export interface SummarizeResponse {
  success: boolean;
  summary: string;
  fileName: string;
  characterCount: number;
  wordCount: number;
  processedAt: string;
  error?: string;
}

export async function runAgentSummarize(params: SummarizeParams): Promise<SummarizeResponse> {
  const res = await fetch('/api/agent/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Agent failed to summarize the file');
  }

  return data;
}

export async function askAgentQuestion(params: {
  fileName: string;
  fileContent: string;
  summary?: string;
  message: string;
  history: Array<{ role: 'user' | 'model'; content: string }>;
}): Promise<string> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Agent failed to answer question');
  }

  return data.reply;
}

export interface CableAnalysisParams {
  folderName: string;
  timeSeriesList: Array<{
    fileName: string;
    timestamp: number;
    dateTimeStr: string;
    channel?: number;
    fiberReferenceTemp: number;
    maxDeltaTemp: number;
  }>;
  targetPointsMatrix: Array<{
    location: number;
    tag: string;
    currentDeltaTemp: number;
    currentAbsoluteTemp: number;
    maxDeltaTemp: number;
    status: string;
    readings: Array<{
      fileName: string;
      dateTimeStr: string;
      deltaTemp: number;
      absoluteTemp: number;
    }>;
  }>;
  principles?: string;
  focusMode?: string;
  customPrompt?: string;
}

export async function runCableAgentSummarize(params: CableAnalysisParams): Promise<{
  success: boolean;
  summary: string;
  processedAt: string;
}> {
  const res = await fetch('/api/agent/analyze-cable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Autonomous agent failed to analyze cable temperature data');
  }

  return data;
}

export async function runSectionHistoryAiReport(params: {
  section: any;
  phaseFilter: string;
  dateRangeText: string;
  forecastHorizonDays: number;
  scenarioFactors: any;
  historicalSeries: any[];
  forecastSeries: any[];
  pointBreakdown: any[];
}): Promise<{
  success: boolean;
  report: string;
  modelUsed?: string;
  processedAt: string;
}> {
  const res = await fetch('/api/agent/analyze-section-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to generate section historical & predictive report');
  }
  return data;
}

export async function runSystemRiskAiReport(params: {
  referenceDate: string;
  zoneDistribution: any;
  criticalSections: any[];
  allSectionRisks: any[];
  powerSummaryMetrics: any;
  scenarioFactors: any;
}): Promise<{
  success: boolean;
  report: string;
  modelUsed?: string;
  processedAt: string;
}> {
  const res = await fetch('/api/agent/analyze-system-risk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to generate system risk management report');
  }
  return data;
}

import { jsPDF } from 'jspdf';

// Convert Markdown-like text to clean structured HTML for PDF print/download
function formatMarkdownForPrint(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const htmlLines: string[] = [];
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        htmlLines.push('</ul>');
        inList = false;
      }
      htmlLines.push('<div style="height: 8px;"></div>');
      continue;
    }

    const formattedInline = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px;">$1</code>');

    if (line.startsWith('### ')) {
      if (inList) { htmlLines.push('</ul>'); inList = false; }
      htmlLines.push(`<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:14px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">${formattedInline.slice(4)}</h3>`);
    } else if (line.startsWith('## ')) {
      if (inList) { htmlLines.push('</ul>'); inList = false; }
      htmlLines.push(`<h2 style="font-size:16px;font-weight:800;color:#1e3a8a;margin:18px 0 8px;border-bottom:2px solid #cbd5e1;padding-bottom:4px;">${formattedInline.slice(3)}</h2>`);
    } else if (line.startsWith('# ')) {
      if (inList) { htmlLines.push('</ul>'); inList = false; }
      htmlLines.push(`<h1 style="font-size:18px;font-weight:800;color:#0f172a;margin:20px 0 10px;">${formattedInline.slice(2)}</h1>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        htmlLines.push('<ul style="margin:6px 0 10px 20px;padding:0;">');
        inList = true;
      }
      htmlLines.push(`<li style="margin-bottom:4px;line-height:1.5;font-size:12px;color:#334155;">${formattedInline.slice(2)}</li>`);
    } else {
      if (inList) { htmlLines.push('</ul>'); inList = false; }
      htmlLines.push(`<p style="margin:4px 0;line-height:1.6;font-size:12px;color:#334155;">${formattedInline}</p>`);
    }
  }
  if (inList) htmlLines.push('</ul>');
  return htmlLines.join('\n');
}

// Sanitize strings for standard PDF ASCII fonts (replaces non-ASCII symbols that cause jsPDF to throw)
function toPdfAscii(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/[°º]/g, ' deg ')
    .replace(/[—–]/g, '-')
    .replace(/[•·]/g, '- ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[±]/g, '+/-')
    .replace(/[×]/g, 'x')
    .replace(/[^\x20-\x7E\r\n\t]/g, ' ');
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (document.body.contains(a)) {
      document.body.removeChild(a);
    }
    URL.revokeObjectURL(blobUrl);
  }, 2500);
}

// Generate & Download real PDF file directly to user device using jsPDF
export function exportEngineeringReportToPdf(options: {
  title: string;
  subtitle: string;
  metadataRows: Array<{ label: string; value: string }>;
  summaryTableHeaders?: string[];
  summaryTableRows?: string[][];
  markdownContent: string;
  fileNameBase: string;
}) {
  const {
    title,
    subtitle,
    metadataRows,
    summaryTableHeaders,
    summaryTableRows,
    markdownContent,
    fileNameBase,
  } = options;

  const pdfFileName = `${fileNameBase || 'Engineering_Report'}_${new Date().toISOString().split('T')[0]}.pdf`;

  let pdfGeneratedSuccessfully = false;

  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = 14;

    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > 280) {
        doc.addPage();
        y = 15;
      }
    };

    // Top Accent Bar
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(margin, y, contentWidth, 2, 'F');
    y += 6;

    // Subheader
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235); // blue-600
    doc.text(
      toPdfAscii('115 kV SUBMARINE & LAND CABLE CIRCUIT #3 -- ENGINEERING DIAGNOSTIC SYSTEM'),
      margin,
      y
    );
    y += 5;

    // Main Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(toPdfAscii(title), margin, y);
    y += 5;

    // Subtitle
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(toPdfAscii(subtitle), margin, y);
    y += 5;

    // Generation timestamp & standard banner
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfAscii(`Generated: ${new Date().toLocaleString()} | Governing Standards: IEC 60287 / IEC 60853-2 / CIGRE TB 610`),
      margin,
      y
    );
    y += 6;

    // 6-Zone Criteria Reference Banner
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(margin, y, contentWidth, 6.5, 1, 1, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(241, 245, 249);
    doc.text(
      toPdfAscii('6-Zone Thermal Criteria: <35 deg C Cool | 35-45 Normal | 45-55 Monitoring | 55-60 Alert | 60-70 Danger | >70 Critical'),
      margin + 3,
      y + 4.5
    );
    y += 10;

    // Metadata Grid (2-column key/value boxes)
    if (metadataRows && metadataRows.length > 0) {
      const colWidth = (contentWidth - 4) / 2;
      const boxHeight = 11;

      for (let i = 0; i < metadataRows.length; i += 2) {
        checkPageBreak(boxHeight + 2);
        const item1 = metadataRows[i];
        const item2 = metadataRows[i + 1];

        // Column 1
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, y, colWidth, boxHeight, 1, 1, 'FD');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.setFont('helvetica', 'bold');
        doc.text(toPdfAscii(item1.label).toUpperCase(), margin + 3, y + 4);
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text(toPdfAscii(String(item1.value)).slice(0, 48), margin + 3, y + 8.5);

        // Column 2
        if (item2) {
          doc.roundedRect(margin + colWidth + 4, y, colWidth, boxHeight, 1, 1, 'FD');
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          doc.setFont('helvetica', 'bold');
          doc.text(toPdfAscii(item2.label).toUpperCase(), margin + colWidth + 7, y + 4);
          doc.setFontSize(8);
          doc.setTextColor(15, 23, 42);
          doc.setFont('helvetica', 'bold');
          doc.text(toPdfAscii(String(item2.value)).slice(0, 48), margin + colWidth + 7, y + 8.5);
        }

        y += boxHeight + 2;
      }
      y += 4;
    }

    // Summary Table (if provided)
    if (summaryTableHeaders && summaryTableRows && summaryTableRows.length > 0) {
      checkPageBreak(15);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(toPdfAscii('Key Section Thermal Severity Rankings & Mitigation Table'), margin, y);
      y += 4;

      const colWidths = [12, 42, 30, 20, 20, 26, 14, 18];
      const rowHeight = 6;

      // Table Header
      checkPageBreak(rowHeight + 2);
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);

      let curX = margin;
      summaryTableHeaders.slice(0, 8).forEach((h, idx) => {
        const w = colWidths[idx] || 20;
        doc.text(toPdfAscii(h), curX + 1.5, y + 4.2);
        curX += w;
      });
      y += rowHeight;

      // Table Rows
      summaryTableRows.slice(0, 19).forEach((row, rowIdx) => {
        checkPageBreak(rowHeight);
        doc.setFillColor(rowIdx % 2 === 0 ? 255 : 248, rowIdx % 2 === 0 ? 255 : 250, rowIdx % 2 === 0 ? 255 : 252);
        doc.setDrawColor(226, 232, 240);
        doc.rect(margin, y, contentWidth, rowHeight, 'FD');

        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);

        let cellX = margin;
        row.slice(0, 8).forEach((cell, cellIdx) => {
          const w = colWidths[cellIdx] || 20;
          const str = toPdfAscii(String(cell || ''));
          doc.text(str.length > 24 ? str.slice(0, 22) + '..' : str, cellX + 1.5, y + 4.2);
          cellX += w;
        });
        y += rowHeight;
      });
      y += 6;
    }

    // Markdown Content (Text paragraphs, headers, bullet points)
    checkPageBreak(15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(toPdfAscii('Detailed Thermal Diagnostics & Standards Guidance'), margin, y);
    y += 5;

    const rawLines = (markdownContent || '').split('\n');
    for (const rawLine of rawLines) {
      const line = toPdfAscii(rawLine.trim());
      if (!line) {
        y += 2.5;
        continue;
      }

      if (line.startsWith('### ')) {
        checkPageBreak(8);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(line.replace('### ', ''), margin, y);
        y += 4.5;
      } else if (line.startsWith('## ')) {
        checkPageBreak(10);
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 58, 138); // blue-900
        doc.text(line.replace('## ', ''), margin, y);
        y += 5.5;
      } else if (line.startsWith('# ')) {
        checkPageBreak(12);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(line.replace('# ', ''), margin, y);
        y += 6;
      } else {
        const isBullet = line.startsWith('- ') || line.startsWith('* ');
        const cleanLine = isBullet ? '- ' + line.slice(2).replace(/\*\*/g, '') : line.replace(/\*\*/g, '');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);

        const wrapped = doc.splitTextToSize(cleanLine, contentWidth - (isBullet ? 4 : 0));
        checkPageBreak(wrapped.length * 3.8 + 1);

        doc.text(wrapped, margin + (isBullet ? 3 : 0), y);
        y += wrapped.length * 3.8 + 1.5;
      }
    }

    // Direct Blob download of valid PDF file
    const pdfBlob = doc.output('blob');
    triggerBlobDownload(pdfBlob, pdfFileName);
    pdfGeneratedSuccessfully = true;
  } catch (pdfErr) {
    // If jsPDF fails, fall back to downloading standalone HTML report
    pdfGeneratedSuccessfully = false;
  }

  // Fallback if jsPDF had any issue: deliver full formatted standalone document
  if (!pdfGeneratedSuccessfully) {
    try {
      const metaHtml = metadataRows
        .map(
          (m) => `
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;">${m.label}</div>
            <div style="font-size:12px;color:#0f172a;font-weight:700;font-family:monospace;margin-top:2px;">${m.value}</div>
          </div>`
        )
        .join('');

      let tableHtml = '';
      if (summaryTableHeaders && summaryTableRows && summaryTableRows.length > 0) {
        const ths = summaryTableHeaders
          .map(
            (h) =>
              `<th style="text-align:left;padding:7px 8px;background:#0f172a;color:#ffffff;font-size:10px;text-transform:uppercase;">${h}</th>`
          )
          .join('');
        const trs = summaryTableRows
          .map(
            (r, idx) =>
              `<tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};border-bottom:1px solid #e2e8f0;">${r
                .map((c) => `<td style="padding:6px 8px;font-size:11px;font-family:monospace;color:#1e293b;">${c}</td>`)
                .join('')}</tr>`
          )
          .join('');
        tableHtml = `
          <div style="margin:16px 0;">
            <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;">
              <thead><tr>${ths}</tr></thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        `;
      }

      const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 24px; max-width: 900px; margin: auto; }
    .header-bar { border-bottom: 3px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
    .zone-bar { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; padding: 8px 12px; background: #0f172a; color: #fff; border-radius: 8px; font-size: 10px; font-family: monospace; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="header-bar">
    <div>
      <div style="font-size:10px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.08em;">115 kV Submarine &amp; Land Cable Circuit #3 -- Engineering Diagnostic &amp; Predictive System</div>
      <h1 style="font-size:20px;font-weight:800;margin:4px 0;color:#0f172a;">${title}</h1>
      <div style="font-size:12px;color:#475569;">${subtitle}</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#64748b;font-family:monospace;">
      <div>Generated: ${new Date().toLocaleString()}</div>
      <div>Standard: IEC 60287 / IEC 60853 / CIGRE</div>
    </div>
  </div>

  <div class="zone-bar">
    <span><strong>6-Zone Criteria:</strong></span>
    <span style="color:#38bdf8;">● Cool (&lt;35°C)</span>
    <span style="color:#10b981;">● Normal (35–45°C)</span>
    <span style="color:#eab308;">● Monitoring (45–55°C)</span>
    <span style="color:#f97316;">● Alert (55–60°C)</span>
    <span style="color:#ef4444;">● Danger (60–70°C)</span>
    <span style="color:#fca5a5;">● Critical (&gt;70°C)</span>
  </div>

  <div class="meta-grid">${metaHtml}</div>
  ${tableHtml}
  <div style="margin-top:16px;">
    ${formatMarkdownForPrint(markdownContent)}
  </div>
</body>
</html>`;

      const htmlBlob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
      triggerBlobDownload(htmlBlob, pdfFileName.replace(/\.pdf$/, '.html'));
    } catch (_) {}
  }
}


