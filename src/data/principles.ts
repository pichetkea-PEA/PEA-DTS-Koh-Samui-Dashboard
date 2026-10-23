import { AgentPrinciplePreset } from '../types';

export const PRINCIPLE_PRESETS: AgentPrinciplePreset[] = [
  {
    id: 'tepr_report',
    name: 'TEPR & Engineering Test Evaluation',
    description: 'Specialized for .TEPR files: extracts test conditions, measured parameters, tolerances, pass/fail status, and anomalies.',
    focusMode: 'Deep Dive',
    prompt: `1. Test Objective & Scope: Summary of what was tested, test standard, device/sample ID, and environment parameters.
2. Key Measured Parameters & Tolerances: Extract nominal values, measured limits, threshold breaches, and maximum/minimum metrics in structured tables.
3. Pass / Fail & Compliance Status: Explicitly determine if tests passed, failed, or showed marginal deviations.
4. Anomalies, Spikes & Failure Analysis: Detail any outliers, unexpected behaviors, or temperature/electrical fluctuations.
5. Engineering Verdict & Next Actions: Actionable recommendations for design revisions or re-testing.`,
  },
  {
    id: 'executive',
    name: 'Executive Briefing & Decisions',
    description: 'High-level synthesis emphasizing critical decisions, key takeaways, and strategic implications.',
    focusMode: 'Executive',
    prompt: `1. Executive Summary: Provide a 3-4 sentence high-level overview.
2. Key Decisions & Strategic Takeaways: Extract all core decisions, conclusions, and strategic points.
3. Critical Risks & Blockers: Highlight any risks, vulnerabilities, or constraints mentioned.
4. Action Items: List all direct next steps with expected owners/timelines if specified.`,
  },
  {
    id: 'action_items',
    name: 'Action Items & Task Matrix',
    description: 'Extract every action item, deliverable, deadline, owner, and prerequisite systematically.',
    focusMode: 'Action-Oriented',
    prompt: `1. Overview of Task Context: Brief summary of the document purpose.
2. Categorized Action Items: List every explicit and implicit task broken down by category/priority.
3. Assigned Owners & Deadlines: Extract any mentioned names, roles, or target dates.
4. Open Questions & Dependencies: Highlight unassigned tasks or blocking dependencies.`,
  },
  {
    id: 'technical',
    name: 'Technical & Architecture Review',
    description: 'Deconstruct systems, architecture, specifications, code logic, dependencies, and parameters.',
    focusMode: 'Deep Dive',
    prompt: `1. System / Component Objective: What is this module, log, or technical document doing?
2. Architecture & Key Specifications: Extract configuration parameters, functions, endpoints, or data models.
3. Notable Dependencies & Interfaces: List integrated services or libraries.
4. Edge Cases & Potential Failure Modes: Note any warnings, potential bugs, or performance implications.`,
  },
  {
    id: 'bullet_insights',
    name: 'Concise Bullet Points & Metrics',
    description: 'Fast scannable bullet points extracting numbers, stats, dates, and essential facts.',
    focusMode: 'Bullet-Points',
    prompt: `1. Core Facts (Top 5-7 strictly formatted bullet points).
2. Key Metrics & Figures: Extract all dates, statistics, percentages, and numerical values.
3. Crucial Quotes or Direct Excerpts: Extract important lines verbatim.`,
  },
  {
    id: 'custom',
    name: 'Custom Principles & Directives',
    description: 'Define your own exact rules, guidelines, evaluation criteria, and formatting structure.',
    focusMode: 'Balanced',
    prompt: `Summarize the document focusing on the primary purpose, core findings, actionable items, and any critical details. Format with clean headings and bullet points.`,
  },
];
