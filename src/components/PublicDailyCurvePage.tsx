import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp,
  Calendar,
  Layers,
  Thermometer,
  Zap,
  Info,
  Clock,
  Radio,
  Loader2,
  Database,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CableSectionInfo,
} from '../data/cableCircuitStructure';
import {
  OrgDatabaseConfig,
  getOrgSectionDailyProfileDates,
  subscribeOrgDatabase,
} from '../services/orgDatabaseStorage';
import { ParsedTeprFile } from '../services/teprParser';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import {
  extractActualTelemetryForSection,
  ActualDailyTelemetrySummary,
} from '../services/actualTelemetryService';
import { NoDatabaseEmptyState } from './NoDatabaseEmptyState';

export interface PublicDailyCurvePageProps {
  dbConfig: OrgDatabaseConfig;
  onAdminLoginClick: () => void;
  isAdminLoggedIn: boolean;
  onGoToFolderAsset: () => void;
  parsedFiles?: ParsedTeprFile[];
  scannedFiles?: any[];
  powerScannedFiles?: any[];
  dateFilteredParsedFiles?: ParsedTeprFile[];
  activeDailyPowerSummary?: DailyPowerSummary | null;
  powerSummariesByDate?: Map<string, DailyPowerSummary>;
  selectedDateFilter?: string;
  selectedYearFilter?: string;
  selectedMonthFilter?: string;
  selectedPhaseFilter?: string;
  hasReadTemperature?: boolean;
  onReadTemperature?: (scannedMeta?: any[], year?: string, month?: string, date?: string) => Promise<void>;
}

export const PublicDailyCurvePage: React.FC<PublicDailyCurvePageProps> = ({
  dbConfig,
  onAdminLoginClick,
  isAdminLoggedIn,
  onGoToFolderAsset,
  parsedFiles = [],
  scannedFiles = [],
  powerScannedFiles = [],
  dateFilteredParsedFiles = [],
  activeDailyPowerSummary = null,
  powerSummariesByDate,
  selectedDateFilter = 'all',
  selectedPhaseFilter = 'all',
  onReadTemperature,
}) => {
  const [profileDbVersion, setProfileDbVersion] = useState<number>(0);

  useEffect(() => {
    const unsub = subscribeOrgDatabase(() => {
      setProfileDbVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  // Available dates strictly from Panel 3 ("Section daily profile database")
  const availableDates = useMemo(() => {
    return getOrgSectionDailyProfileDates();
  }, [dbConfig, profileDbVersion]);

  const hasAnyDataSource = availableDates.length > 0;

  // Initial candidate date derived from Panel 3 ("Section daily profile database")
  const initialDate = useMemo(() => {
    if (selectedDateFilter && selectedDateFilter !== 'all' && availableDates.includes(selectedDateFilter)) {
      return selectedDateFilter;
    }
    if (availableDates.length > 0) {
      return availableDates[availableDates.length - 1];
    }
    return '';
  }, [selectedDateFilter, availableDates]);

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('2.3');
  const [selectedPhase, setSelectedPhase] = useState<string>(
    selectedPhaseFilter !== 'all' ? selectedPhaseFilter : 'all'
  );

  // Automatically sync selectedDate when Panel 3 dates update
  useEffect(() => {
    if (availableDates.length > 0 && (!selectedDate || !availableDates.includes(selectedDate))) {
      const latest = availableDates[availableDates.length - 1];
      setSelectedDate(latest);
    }
  }, [availableDates, selectedDate]);

  useEffect(() => {
    if (selectedPhaseFilter && selectedPhaseFilter !== 'all') {
      setSelectedPhase(selectedPhaseFilter);
    }
  }, [selectedPhaseFilter]);

  const activeSection: CableSectionInfo = useMemo(() => {
    return (
      CIRCUIT_3_SECTIONS.find((s) => s.sectionId === selectedSectionId) ||
      CIRCUIT_3_SECTIONS[0]
    );
  }, [selectedSectionId]);

  const isLand = activeSection.category === 'land' || activeSection.sectionId.startsWith('1.');

  // Extract Section Daily Profile records from Panel 3 ("Section daily profile database")
  const actualTelemetry: ActualDailyTelemetrySummary = useMemo(() => {
    const targetDate = selectedDate;
    if (!targetDate) {
      return {
        sectionId: selectedSectionId,
        sectionName: activeSection.name,
        category: (activeSection.category || 'submarine') as 'land' | 'submarine',
        dateKey: selectedDate,
        phase: selectedPhase,
        dataSource: 'none',
        dataSourceLabel: 'No Data Available',
        points: [],
        peakFiberTempC: 0,
        peakConductorTempC: 0,
        peakTime: '00:00',
        peakPowerMW: 0,
        peakFileName: '',
        totalActualScans: 0,
      };
    }

    return extractActualTelemetryForSection({
      sectionId: selectedSectionId,
      dateKey: targetDate,
      phaseFilter: isLand ? selectedPhase : 'all',
      parsedFiles: [],
    });
  }, [
    selectedDate,
    selectedSectionId,
    selectedPhase,
    activeSection,
    isLand,
    profileDbVersion,
  ]);

  const hasData = (actualTelemetry?.points?.length || 0) > 0;

  if (!hasAnyDataSource) {
    return (
      <NoDatabaseEmptyState
        pageNumber="2.2"
        pageTitle="Daily Temperature Curve"
        onAdminLoginClick={onAdminLoginClick}
        isAdminLoggedIn={isAdminLoggedIn}
        onGoToFolderAsset={onGoToFolderAsset}
      />
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Top Filter and Context Bar */}
      <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
              <TrendingUp className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-black text-slate-100 font-mono tracking-tight leading-tight">
                [2.2] DAILY TEMPERATURE CURVE
              </h2>
              <p className="text-[11px] text-cyan-400/80 font-mono">
                Fiber &amp; Conductor Thermal Profiles vs. Circuit 3 Power Consumption (Dual Y-Axis)
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          {/* 1. Date Filter (Appears first as required) */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs text-slate-400 font-mono">DATE:</span>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer"
            >
              {availableDates.map((d) => (
                <option key={d} value={d} className="bg-slate-900 text-slate-200">
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Section Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs text-slate-400 font-mono">SEC:</span>
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              className="text-xs font-mono font-bold text-cyan-300 bg-transparent border-none outline-none cursor-pointer max-w-[210px] truncate"
            >
              <optgroup label="── SUBMARINE ZONES (13) ──" className="bg-slate-950 text-cyan-400 font-bold">
                {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine').map((sec) => (
                  <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                    Zone {sec.sectionId}: {sec.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="── LAND SECTIONS (6) ──" className="bg-slate-950 text-emerald-400 font-bold">
                {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land').map((sec) => (
                  <option key={sec.sectionId} value={sec.sectionId} className="bg-slate-900 text-slate-200">
                    Sec {sec.sectionId}: {sec.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* 3. Land Phase Filter */}
          {isLand && (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-[10px] text-slate-400 px-1 font-bold">PHASE:</span>
              <button
                type="button"
                onClick={() => setSelectedPhase('all')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhase === 'all'
                    ? 'bg-slate-700 text-slate-100 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhase('Phase A')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhase === 'Phase A' || selectedPhase === 'A'
                    ? 'bg-red-500/30 text-red-300 border border-red-500/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhase('Phase B')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhase === 'Phase B' || selectedPhase === 'B'
                    ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                B
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhase('Phase C')}
                className={`px-2 py-0.5 rounded text-[11px] transition-all cursor-pointer ${
                  selectedPhase === 'Phase C' || selectedPhase === 'C'
                    ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                C
              </button>
            </div>
          )}

        </div>

        {/* Current Plotted Target Status */}
        {selectedDate && (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-[10px] text-slate-400 uppercase">PLOTTED:</span>
            <span className="px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 font-bold">
              {selectedDate} (Sec {selectedSectionId})
            </span>
          </div>
        )}
      </div>

      {/* Main Telemetry & Chart Area */}
      <div className="bg-slate-900/90 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-cyan-500/20 shadow-[0_0_35px_rgba(6,182,212,0.08)] space-y-5">
        {/* Section Header & KPI Badges */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                SEC {activeSection.sectionId}
              </span>
              <h3 className="text-base font-extrabold text-white tracking-tight">
                {activeSection.name}
              </h3>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {activeSection.subtitle} • {activeSection.lengthMeters} m • Equation {activeSection.equationName}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="bg-sky-950/40 border border-sky-500/40 px-3 py-1.5 rounded-xl text-sky-300">
              <span className="text-[10px] uppercase font-bold text-sky-400 block">Peak Fiber Tf</span>
              <span className="font-extrabold text-sm font-mono">
                {(actualTelemetry?.peakFiberTempC ?? 0) > 0 ? `${actualTelemetry.peakFiberTempC.toFixed(1)} °C` : '-'}
              </span>
            </div>
            <div className="bg-amber-950/40 border border-amber-500/40 px-3 py-1.5 rounded-xl text-amber-300">
              <span className="text-[10px] uppercase font-bold text-amber-400 block">Peak Conductor Tc</span>
              <span className="font-extrabold text-sm font-mono">
                {(actualTelemetry?.peakConductorTempC ?? 0) > 0 ? `${actualTelemetry.peakConductorTempC.toFixed(1)} °C` : '-'}
              </span>
            </div>
            <div className="bg-purple-950/40 border border-purple-500/40 px-3 py-1.5 rounded-xl text-purple-300">
              <span className="text-[10px] uppercase font-bold text-purple-400 block">Circuit 3 Peak MW</span>
              <span className="font-extrabold text-sm font-mono">
                {(actualTelemetry?.peakPowerMW ?? 0) > 0 ? `${actualTelemetry.peakPowerMW.toFixed(1)} MW` : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Chart Area */}
        {hasData ? (
          <div className="h-[430px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={actualTelemetry.points}
                margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
              >
                <defs>
                  <linearGradient id="ckt3PowerAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.7} />
                <XAxis
                  dataKey="time"
                  stroke="#64748b"
                  tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                  interval={2}
                />
                {/* Left Y-Axis: Temperature (°C) */}
                <YAxis
                  yAxisId="tempAxis"
                  stroke="#38bdf8"
                  domain={[15, 90]}
                  tick={{ fill: '#38bdf8', fontSize: 11, fontFamily: 'monospace' }}
                  label={{
                    value: 'Temperature (°C)',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#38bdf8',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                  }}
                />
                {/* Right Y-Axis: Power Consumption (MW) of Circuit 3 */}
                <YAxis
                  yAxisId="powerAxis"
                  orientation="right"
                  stroke="#a855f7"
                  domain={[0, 110]}
                  tick={{ fill: '#c084fc', fontSize: 11, fontFamily: 'monospace' }}
                  label={{
                    value: 'Circuit 3 Power (MW)',
                    angle: 90,
                    position: 'insideRight',
                    fill: '#c084fc',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                  }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-slate-950/95 border border-cyan-500/40 rounded-xl p-3 text-xs font-mono shadow-2xl space-y-1.5 min-w-[210px]">
                        <div className="font-bold text-cyan-300 border-b border-slate-800 pb-1 flex justify-between">
                          <span>{d.peakTime ? `${label} (${d.peakTime})` : `${label} hrs`}</span>
                          <span className="text-slate-400">Sec {activeSection.sectionId}</span>
                        </div>
                        <div className="flex justify-between items-center text-sky-400">
                          <span>Fiber Temp (Tf):</span>
                          <span className="font-bold">{(d.fiberTempC ?? 0).toFixed(2)} °C</span>
                        </div>
                        <div className="flex justify-between items-center text-amber-400">
                          <span>Est Conductor (Tc):</span>
                          <span className="font-bold">{(d.conductorTempC ?? 0).toFixed(2)} °C</span>
                        </div>
                        <div className="flex justify-between items-center text-purple-400 border-t border-slate-800/60 pt-1">
                          <span>Circuit 3 Power:</span>
                          <span className="font-bold">{(d.powerCkt3MW ?? 0).toFixed(2)} MW</span>
                        </div>
                        <div className="flex justify-between items-center text-indigo-300">
                          <span>Total Island Power:</span>
                          <span className="font-bold">{(d.totalIslandMW ?? 0).toFixed(2)} MW</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: 10, fontFamily: 'monospace', fontSize: 11 }}
                />

                {/* Right Axis: Circuit 3 Power Consumption (Thicker Line + Light Area Fill under curve, Purple/Violet — distinct from both temperature curves) */}
                <Area
                  yAxisId="powerAxis"
                  type="monotone"
                  dataKey="powerCkt3MW"
                  name="Circuit 3 Power Flow (MW)"
                  stroke="#a855f7"
                  strokeWidth={4}
                  fill="url(#ckt3PowerAreaGrad)"
                  fillOpacity={1}
                  dot={{ r: 3, fill: '#a855f7', stroke: '#0f172a', strokeWidth: 1.4 }}
                  activeDot={{ r: 6, fill: '#c084fc', stroke: '#ffffff', strokeWidth: 2 }}
                />

                {/* Left Axis: Estimated Conductor Temp (Line, Amber) */}
                <Line
                  yAxisId="tempAxis"
                  type="monotone"
                  dataKey="conductorTempC"
                  name="Estimated Conductor Temp (Tc, °C)"
                  stroke="#f59e0b"
                  strokeWidth={2.8}
                  dot={{ r: 3, fill: '#f59e0b', stroke: '#ffffff', strokeWidth: 1 }}
                  activeDot={{ r: 5 }}
                />

                {/* Left Axis: Measured Optical Fiber Temp (Line, Sky Blue) */}
                <Line
                  yAxisId="tempAxis"
                  type="monotone"
                  dataKey="fiberTempC"
                  name="Measured Fiber Temp (Tf, °C)"
                  stroke="#38bdf8"
                  strokeWidth={2.4}
                  dot={{ r: 2.5, fill: '#38bdf8' }}
                  activeDot={{ r: 5 }}
                />

                <ReferenceLine
                  yAxisId="tempAxis"
                  y={65}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{ value: '65°C Alert', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-20 text-center space-y-3">
            <Thermometer className="w-12 h-12 text-slate-600 mx-auto" />
            <div className="text-sm font-bold text-slate-300 font-mono">
              No Recorded Telemetry Found for {selectedDate}
            </div>
            <p className="text-xs text-slate-500 font-mono max-w-md mx-auto">
              Please choose another date or section from the dropdowns above to inspect daily telemetry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
