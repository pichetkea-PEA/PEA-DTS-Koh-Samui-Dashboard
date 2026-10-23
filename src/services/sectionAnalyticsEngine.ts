import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  CableSamplingPoint,
  ConductorEquationName,
  estimateConductorTemperatures,
  getThermalZoneInfo,
  ThermalZoneInfo,
  ThermalZoneKey,
  THERMAL_ZONES_6,
} from '../data/cableCircuitStructure';
import { ParsedTeprFile, ScannedFileMeta } from './teprParser';
import {
  DailyPowerSummary,
  buildFallbackDailyPowerSummary,
} from './powerConsumptionParser';

export interface PredictionScenarioFactors {
  touristFlightGrowthPct: number;       // Flights to USM (Koh Samui) & ferries to Pha Ngan / Tao (%)
  populationGrowthPct: number;          // Annual island population & commercial load growth (%)
  weatherAmbientShiftC: number;         // Weather / seabed / soil ambient ΔT (°C)
  soilDrynessFactor: number;            // Soil thermal resistivity multiplier (1.0 = Moist, 1.25 = Dry Season)
  circuit3LoadSharePct: number;         // % of 115kV load on Circuit #3 (50% balanced, 85-100% N-1 contingency)
  dailyFlightsSamui: number;            // Estimated daily flights into Samui Airport (USM)
  monthlyTouristsIslands: number;       // Estimated monthly tourists (Samui + Pha Ngan + Tao)
}

export const DEFAULT_PREDICTION_FACTORS: PredictionScenarioFactors = {
  touristFlightGrowthPct: 18,
  populationGrowthPct: 4.5,
  weatherAmbientShiftC: 1.5,
  soilDrynessFactor: 1.12,
  circuit3LoadSharePct: 54,
  dailyFlightsSamui: 48,
  monthlyTouristsIslands: 285000,
};

export interface SectionHistoricalRecord {
  dateKey: string;
  formattedDate: string;
  isRealRead: boolean;
  isForecast: boolean;
  maxTf: number;
  avgTf: number;
  maxTc60287: number;
  upperTc60287?: number;
  lowerTc60287?: number;
  pCkt3MW: number;
  pCkt2MW: number;
  p33NktMW: number;
  p33OilMW: number;
  totalIslandMW: number;
  hottestPos: string;
  hottestDof: number;
  zoneInfo: ThermalZoneInfo;
}

export interface SectionPointSnapshot {
  pos: string;
  dof: number;
  dab: number | null;
  kp: string;
  phase: string;
  currentTf: number;
  currentTc60287: number;
  forecastPeakTc60287: number;
  equationName: ConductorEquationName;
  currentZone: ThermalZoneInfo;
  forecastZone: ThermalZoneInfo;
}

export interface SectionRiskEvaluation {
  sectionId: string;
  sectionName: string;
  subtitle: string;
  category: 'land' | 'submarine';
  sectionType: 'normal' | 'special';
  equationName: ConductorEquationName;
  pointCount: number;
  dofRangeText: string;
  currentMaxTf: number;
  currentMaxTc60287: number;
  forecastMaxTc60287: number;
  heatingRatePerDayC: number;
  pCkt3MW: number;
  currentZone: ThermalZoneInfo;
  forecastZone: ThermalZoneInfo;
  riskScore: number; // 0 - 100
  likelihoodLevel: 1 | 2 | 3 | 4 | 5; // 1 = Rare, 5 = Almost Certain
  consequenceLevel: 1 | 2 | 3 | 4 | 5; // 1 = Negligible, 5 = Severe
  hottestPos: string;
  hottestDof: number;
  bottleneckCause: string;
  standardReference: string;
  shortTermAction: string;
  longTermMitigation: string;
}

// Section-specific physical baseline thermal profile characteristics
function getSectionBaselineDelta(sectionId: string): number {
  switch (sectionId) {
    case '1.1': return 5.8;  // Land Normal 1
    case '1.2': return 11.4; // Joint Pit 1 (JP1) - Special
    case '1.3': return 6.4;  // Land Normal 2
    case '1.4': return 12.1; // Joint Pit 2 (JP2) - Special
    case '1.5': return 6.9;  // Land Normal 3
    case '1.6': return 10.6; // Transition Joint 1 (TJ1) - Special
    case '2.1': return 8.8;  // Submarine Zone 1 Bottleneck
    case '2.2': return 3.4;  // Submarine Normal 1
    case '2.3': return 9.6;  // XPWA Water Pipeline Crossing - Special
    case '2.4': return 3.8;  // Submarine Normal 2
    case '2.5': return 13.5; // Nexans Subsea Joint NX2 (IEC Estimation)
    case '2.6': return 13.9; // Nexans Subsea Joint NX1 (IEC Estimation)
    case '2.7': return 4.2;  // Submarine Normal 3
    case '2.8': return 15.2; // Furukawa Subsea Joint FR1 (IEC Estimation)
    case '2.9': return 15.8; // Furukawa Subsea Joint FR2 (IEC Estimation)
    case '2.10': return 4.0; // Submarine Normal 4
    case '2.11': return 11.8; // 33kV Pha Ngan Crossing (X33kV) - Special
    case '2.12': return 4.5; // Submarine Normal 5
    case '2.13': return 9.4; // Samui Landfall TJ2
    default: return 6.0;
  }
}

// Fast O(k) Zone-Only Slicing: Extracts temperature readings strictly for the DOFs in a target section
export function extractSectionPeakFromParsedFiles(
  sectionId: string,
  filesForDate: ParsedTeprFile[],
  phaseFilter = 'all'
): {
  maxTf: number;
  avgTf: number;
  hottestPos: string;
  hottestDof: number;
  pointValues: Map<string, number>;
} | null {
  if (!filesForDate || filesForDate.length === 0) return null;

  const sectionPoints = CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
    if (p.sectionId !== sectionId) return false;
    if (phaseFilter === 'Phase A' && p.cableCategory === 'land' && p.phase !== 'A') return false;
    if (phaseFilter === 'Phase B' && p.cableCategory === 'land' && p.phase !== 'B') return false;
    if (phaseFilter === 'Phase C' && p.cableCategory === 'land' && p.phase !== 'C') return false;
    return true;
  });

  if (sectionPoints.length === 0) return null;

  const matchingFiles = filesForDate.filter((f) => {
    if (phaseFilter === 'all') return true;
    return f.cablePhase === phaseFilter;
  });
  const activeFiles = matchingFiles.length > 0 ? matchingFiles : filesForDate;

  let maxTf = -Infinity;
  let sumTf = 0;
  let countTf = 0;
  let hottestPos = sectionPoints[0].pos;
  let hottestDof = sectionPoints[0].dof;
  const pointValues = new Map<string, number>();

  for (const pt of sectionPoints) {
    let ptMax = -Infinity;
    for (const f of activeFiles) {
      // Fast O(1) lookup in targetLocationValues first
      const targetMatch = f.targetLocationValues?.find((v) => Math.abs(v.location - pt.dof) < 0.25);
      let absVal: number | null = targetMatch ? targetMatch.absoluteTemp : null;

      if (absVal === null && f.dataPoints && f.dataPoints.length > 0) {
        // Direct index jump (DOF slicing) for O(1) lookup
        const startDist = f.dataPoints[0].position;
        const step = f.dataPoints.length > 1 ? Math.abs(f.dataPoints[1].position - startDist) || 1 : 1;
        const approxIdx = Math.min(
          f.dataPoints.length - 1,
          Math.max(0, Math.round((pt.dof - startDist) / step))
        );
        const candidate = f.dataPoints[approxIdx];
        if (candidate && Math.abs(candidate.position - pt.dof) <= 30) {
          absVal = candidate.absoluteTemp;
        }
      }

      if (absVal !== null && absVal > ptMax) {
        ptMax = absVal;
      }
    }

    if (ptMax !== -Infinity) {
      pointValues.set(pt.id, ptMax);
      sumTf += ptMax;
      countTf++;
      if (ptMax > maxTf) {
        maxTf = ptMax;
        hottestPos = pt.pos;
        hottestDof = pt.dof;
      }
    }
  }

  if (maxTf === -Infinity) return null;

  return {
    maxTf: Number(maxTf.toFixed(2)),
    avgTf: Number((sumTf / Math.max(1, countTf)).toFixed(2)),
    hottestPos,
    hottestDof,
    pointValues,
  };
}

// Build historical + future forecast time series for a specific Section
export function buildSectionHistoricalAndForecast(params: {
  sectionId: string;
  phaseFilter: string;
  historyDaysCount: number;
  forecastDaysCount: number;
  customStartDate?: string;
  customEndDate?: string;
  parsedFiles: ParsedTeprFile[];
  scannedFiles: ScannedFileMeta[];
  powerSummariesByDate: Map<string, DailyPowerSummary>;
  activeDateFilter?: string;
  factors: PredictionScenarioFactors;
}): {
  sectionInfo: (typeof CIRCUIT_3_SECTIONS)[0];
  historicalSeries: SectionHistoricalRecord[];
  forecastSeries: SectionHistoricalRecord[];
  combinedSeries: SectionHistoricalRecord[];
  pointSnapshots: SectionPointSnapshot[];
  loadVsTempCurve: Array<{ mw: number; theoreticalTc: number; measuredTc?: number; dateKey?: string }>;
  estimatedDaysToAlert: number | null;
  estimatedDaysToDanger: number | null;
  estimatedDaysToCritical: number | null;
} {
  const {
    sectionId,
    phaseFilter,
    historyDaysCount,
    forecastDaysCount,
    customStartDate,
    customEndDate,
    parsedFiles,
    powerSummariesByDate,
    activeDateFilter,
    factors,
  } = params;

  const sectionInfo =
    CIRCUIT_3_SECTIONS.find((s) => s.id === sectionId) || CIRCUIT_3_SECTIONS[0];

  const sectionPoints = CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
    if (p.sectionId !== sectionInfo.id) return false;
    if (phaseFilter === 'Phase A' && p.cableCategory === 'land' && p.phase !== 'A') return false;
    if (phaseFilter === 'Phase B' && p.cableCategory === 'land' && p.phase !== 'B') return false;
    if (phaseFilter === 'Phase C' && p.cableCategory === 'land' && p.phase !== 'C') return false;
    return true;
  });
  const effectivePoints =
    sectionPoints.length > 0
      ? sectionPoints
      : CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === sectionInfo.id);

  // Determine anchor date from activeDateFilter or latest parsed file
  const anchorDateStr =
    activeDateFilter && activeDateFilter !== 'all'
      ? activeDateFilter
      : parsedFiles[parsedFiles.length - 1]?.dateMeta?.dateKey || '2026-08-08';

  const anchorDate = new Date(`${anchorDateStr}T12:00:00Z`);
  const validAnchor = isNaN(anchorDate.getTime()) ? new Date('2026-08-08T12:00:00Z') : anchorDate;

  // Group real parsedFiles by dateKey
  const filesByDate = new Map<string, ParsedTeprFile[]>();
  parsedFiles.forEach((f) => {
    const dKey = f.dateMeta?.dateKey || anchorDateStr;
    if (!filesByDate.has(dKey)) filesByDate.set(dKey, []);
    filesByDate.get(dKey)!.push(f);
  });

  const baseDelta = getSectionBaselineDelta(sectionInfo.id);
  const historicalSeries: SectionHistoricalRecord[] = [];

  // Determine start and end dates for historical window
  let startTs = validAnchor.getTime() - (historyDaysCount - 1) * 86400000;
  let endTs = validAnchor.getTime();
  if (customStartDate && customEndDate) {
    const s = new Date(`${customStartDate}T12:00:00Z`).getTime();
    const e = new Date(`${customEndDate}T12:00:00Z`).getTime();
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      startTs = s;
      endTs = e;
    }
  }

  const totalHistDays = Math.min(120, Math.max(1, Math.round((endTs - startTs) / 86400000) + 1));

  for (let i = 0; i < totalHistDays; i++) {
    const currDate = new Date(startTs + i * 86400000);
    const yyyy = currDate.getUTCFullYear();
    const mm = String(currDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(currDate.getUTCDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;

    const realFiles = filesByDate.get(dateKey);
    const realExtracted = realFiles
      ? extractSectionPeakFromParsedFiles(sectionInfo.id, realFiles, phaseFilter)
      : null;

    // Resolve power summary for dateKey
    const powerSummary =
      powerSummariesByDate.get(dateKey) || buildFallbackDailyPowerSummary(dateKey);

    const pCkt3MW = powerSummary.metrics.circuit_115kv_3.peakMW;
    const pCkt2MW = powerSummary.metrics.circuit_115kv_2.peakMW;
    const p33NktMW = powerSummary.metrics.circuit_33kv_nkt.peakMW;
    const p33OilMW = powerSummary.metrics.circuit_33kv_oil.peakMW;
    const totalIslandMW = powerSummary.metrics.total.peakMW;

    // Deterministic daily seasonal/operational progression if not yet read from Drive
    const dayWave = Math.sin(i * 0.48 + Number(sectionInfo.id) * 2.1) * 1.4;
    const progressiveTrend = (i / Math.max(1, totalHistDays)) * 2.6;
    const loadInducedTf = (pCkt3MW - 65) * 0.14;

    const maxTf = realExtracted
      ? realExtracted.maxTf
      : Number((30.0 + baseDelta + dayWave + progressiveTrend + loadInducedTf).toFixed(2));
    const avgTf = realExtracted
      ? realExtracted.avgTf
      : Number((maxTf - 2.1).toFixed(2));

    const hottestPos = realExtracted
      ? realExtracted.hottestPos
      : effectivePoints[Math.min(effectivePoints.length - 1, Math.floor(effectivePoints.length / 2))]?.pos ||
        `Sec ${sectionInfo.id}`;
    const hottestDof = realExtracted
      ? realExtracted.hottestDof
      : effectivePoints[0]?.dof || 2486.5;

    const est = estimateConductorTemperatures(
      maxTf,
      { sectionId: sectionInfo.id, equationName: sectionInfo.equationName },
      {
        hasPowerData: true,
        pCkt3MW,
        pCkt2MW,
        p33NktMW,
        p33OfMW: p33OilMW,
      }
    );

    const tcVal = Number((est.tc60287 ?? maxTf).toFixed(2));
    const zoneInfo = getThermalZoneInfo(tcVal);

    historicalSeries.push({
      dateKey,
      formattedDate: `${dd}/${mm}/${yyyy}`,
      isRealRead: Boolean(realExtracted),
      isForecast: false,
      maxTf,
      avgTf,
      maxTc60287: tcVal,
      pCkt3MW: Number(pCkt3MW.toFixed(2)),
      pCkt2MW: Number(pCkt2MW.toFixed(2)),
      p33NktMW: Number(p33NktMW.toFixed(2)),
      p33OilMW: Number(p33OilMW.toFixed(2)),
      totalIslandMW: Number(totalIslandMW.toFixed(2)),
      hottestPos,
      hottestDof,
      zoneInfo,
    });
  }

  // Last historical point serves as the baseline for future prediction
  const latestHist = historicalSeries[historicalSeries.length - 1];

  // Calculate historical linear drift (°C/day and MW/day)
  const firstHist = historicalSeries[0] || latestHist;
  const histSpan = Math.max(1, historicalSeries.length - 1);
  const histTempDriftPerDay = (latestHist.maxTf - firstHist.maxTf) / histSpan;

  // Multi-factor growth multipliers from Tourism/Flights, Population, Weather, Soil Dryness, and Circuit #3 Load Share
  const tourismFactor = 1 + (factors.touristFlightGrowthPct / 100) * 0.45;
  const flightBonusMW = Math.max(0, (factors.dailyFlightsSamui - 42) * 0.18);
  const popFactor = 1 + (factors.populationGrowthPct / 100) * 0.35;
  const loadShareMultiplier = factors.circuit3LoadSharePct / 52; // 52% is normal baseline share

  const forecastSeries: SectionHistoricalRecord[] = [];
  let estimatedDaysToAlert: number | null = latestHist.maxTc60287 >= 55 ? 0 : null;
  let estimatedDaysToDanger: number | null = latestHist.maxTc60287 >= 60 ? 0 : null;
  let estimatedDaysToCritical: number | null = latestHist.maxTc60287 > 70 ? 0 : null;

  for (let d = 1; d <= forecastDaysCount; d++) {
    const fDate = new Date(endTs + d * 86400000);
    const yyyy = fDate.getUTCFullYear();
    const mm = String(fDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(fDate.getUTCDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;

    const horizonFraction = d / Math.max(7, forecastDaysCount);
    const weekendTourismPulse = (fDate.getUTCDay() === 5 || fDate.getUTCDay() === 6) ? 2.4 : 0;

    // Forecast 4-Circuit Power (MW)
    const growthScale = 1 + (tourismFactor * popFactor - 1) * horizonFraction;
    const fCkt3MW = Number(
      (
        (latestHist.pCkt3MW * growthScale + flightBonusMW * horizonFraction + weekendTourismPulse) *
        loadShareMultiplier
      ).toFixed(2)
    );
    const fCkt2MW = Number(
      (
        latestHist.pCkt2MW *
        growthScale *
        Math.max(0.2, (100 - factors.circuit3LoadSharePct) / 48)
      ).toFixed(2)
    );
    const f33NktMW = Number((latestHist.p33NktMW * (1 + (growthScale - 1) * 0.75)).toFixed(2));
    const f33OilMW = Number((latestHist.p33OilMW * (1 + (growthScale - 1) * 0.65)).toFixed(2));
    const fTotalMW = Number((fCkt3MW + fCkt2MW + f33NktMW + f33OilMW).toFixed(2));

    // Forecast Fiber Optic Temp (Tf) incorporating ambient weather shift, soil dryness, and power heating
    const ambientShift = factors.weatherAmbientShiftC * Math.min(1, horizonFraction * 1.2);
    const soilDryPenalty = (factors.soilDrynessFactor - 1.0) * 14.5 * horizonFraction;
    const loadDeltaTf = Math.max(0, fCkt3MW - latestHist.pCkt3MW) * 0.19;
    const trendContinuation = Math.max(0.03, histTempDriftPerDay) * d * 0.65;

    const fMaxTf = Number(
      (latestHist.maxTf + ambientShift + soilDryPenalty + loadDeltaTf + trendContinuation).toFixed(2)
    );
    const fAvgTf = Number((fMaxTf - 2.0).toFixed(2));

    const fEst = estimateConductorTemperatures(
      fMaxTf,
      { sectionId: sectionInfo.id, equationName: sectionInfo.equationName },
      {
        hasPowerData: true,
        pCkt3MW: fCkt3MW,
        pCkt2MW: fCkt2MW,
        p33NktMW: f33NktMW,
        p33OfMW: f33OilMW,
      }
    );

    const fTc = Number((fEst.tc60287 ?? fMaxTf).toFixed(2));
    const uncertaintyBand = Number((1.2 + d * 0.14).toFixed(2));
    const upperTc = Number((fTc + uncertaintyBand).toFixed(2));
    const lowerTc = Number(Math.max(25, fTc - uncertaintyBand).toFixed(2));

    if (estimatedDaysToAlert === null && fTc >= 55) estimatedDaysToAlert = d;
    if (estimatedDaysToDanger === null && fTc >= 60) estimatedDaysToDanger = d;
    if (estimatedDaysToCritical === null && fTc > 70) estimatedDaysToCritical = d;

    forecastSeries.push({
      dateKey,
      formattedDate: `${dd}/${mm}/${yyyy} (Forecast)`,
      isRealRead: false,
      isForecast: true,
      maxTf: fMaxTf,
      avgTf: fAvgTf,
      maxTc60287: fTc,
      upperTc60287: upperTc,
      lowerTc60287: lowerTc,
      pCkt3MW: fCkt3MW,
      pCkt2MW: fCkt2MW,
      p33NktMW: f33NktMW,
      p33OilMW: f33OilMW,
      totalIslandMW: fTotalMW,
      hottestPos: latestHist.hottestPos,
      hottestDof: latestHist.hottestDof,
      zoneInfo: getThermalZoneInfo(fTc),
    });
  }

  const peakForecast = forecastSeries[forecastSeries.length - 1] || latestHist;
  const forecastDeltaTf = peakForecast.maxTf - latestHist.maxTf;

  // Build discrete point snapshots inside this section
  const latestRealFiles = filesByDate.get(latestHist.dateKey) || parsedFiles;
  const latestExtracted = extractSectionPeakFromParsedFiles(sectionInfo.id, latestRealFiles, phaseFilter);

  const pointSnapshots: SectionPointSnapshot[] = effectivePoints.map((pt, idx) => {
    const spatialVar = Math.sin(idx * 1.3 + pt.dof * 0.01) * 0.9;
    const currentTf = latestExtracted?.pointValues.get(pt.id)
      ? Number(latestExtracted.pointValues.get(pt.id)!.toFixed(2))
      : Number((latestHist.maxTf - Math.abs(spatialVar)).toFixed(2));

    const currEst = estimateConductorTemperatures(
      currentTf,
      { sectionId: pt.sectionId, equationName: pt.equationName },
      { hasPowerData: true, pCkt3MW: latestHist.pCkt3MW }
    );
    const currentTc60287 = Number((currEst.tc60287 ?? currentTf).toFixed(2));

    const forecastTf = Number((currentTf + forecastDeltaTf).toFixed(2));
    const foreEst = estimateConductorTemperatures(
      forecastTf,
      { sectionId: pt.sectionId, equationName: pt.equationName },
      { hasPowerData: true, pCkt3MW: peakForecast.pCkt3MW }
    );
    const forecastPeakTc60287 = Number((foreEst.tc60287 ?? forecastTf).toFixed(2));

    return {
      pos: pt.pos,
      dof: pt.dof,
      dab: pt.dab,
      kp: pt.kpFormatted,
      phase: pt.phase === 'SM' ? 'Submarine (CH 3)' : `Phase ${pt.phase}`,
      currentTf,
      currentTc60287,
      forecastPeakTc60287,
      equationName: pt.equationName,
      currentZone: getThermalZoneInfo(currentTc60287),
      forecastZone: getThermalZoneInfo(forecastPeakTc60287),
    };
  });

  // Build Load (MW) vs Conductor Temperature (Tc,60287) theoretical IEC 60287 curve + measured scatter points
  const loadVsTempCurve: Array<{ mw: number; theoreticalTc: number; measuredTc?: number; dateKey?: string }> = [];
  for (let mw = 30; mw <= 130; mw += 5) {
    const theoEst = estimateConductorTemperatures(
      latestHist.avgTf,
      { sectionId: sectionInfo.id, equationName: sectionInfo.equationName },
      { hasPowerData: true, pCkt3MW: mw }
    );
    const matchingHist = historicalSeries.find((h) => Math.abs(h.pCkt3MW - mw) < 2.5);
    loadVsTempCurve.push({
      mw,
      theoreticalTc: Number((theoEst.tc60287 ?? latestHist.avgTf).toFixed(2)),
      measuredTc: matchingHist?.maxTc60287,
      dateKey: matchingHist?.dateKey,
    });
  }

  return {
    sectionInfo,
    historicalSeries,
    forecastSeries,
    combinedSeries: [...historicalSeries, ...forecastSeries],
    pointSnapshots,
    loadVsTempCurve,
    estimatedDaysToAlert,
    estimatedDaysToDanger,
    estimatedDaysToCritical,
  };
}

// Standards-based risk and engineering remediation lookup per section
function getSectionEngineeringGuidance(sectionId: string, equationName: ConductorEquationName): {
  bottleneckCause: string;
  standardReference: string;
  shortTermAction: string;
  longTermMitigation: string;
} {
  if (sectionId === '2.8' || sectionId === '2.9') {
    return {
      bottleneckCause: 'Furukawa Rigid Subsea Joint (FR1/FR2) extra insulation thickness & armor loss concentration (IEC Estimation)',
      standardReference: 'CIGRE TB 610 / TB 852 (Subsea Joints) & IEC 60287-1-1 Clause 2.4',
      shortTermAction: 'Cap 115kV Ckt #3 continuous load during evening peak (18:30–22:00) by shifting 8–12 MW to 115kV Ckt #2 (KMA).',
      longTermMitigation: 'Perform ROV bathymetrical burial depth survey over KP 33+650–33+846 to verify sediment cover has not exceeded design T4 depth.',
    };
  }
  if (sectionId === '2.5' || sectionId === '2.6') {
    return {
      bottleneckCause: 'Nexans Subsea Factory/Repair Joint (NX1/NX2) elevated thermal resistance T1/T4 (IEC Estimation)',
      standardReference: 'CIGRE TB 496 / TB 610 & IEC 60853-2 (Cyclic Submarine Rating)',
      shortTermAction: 'Apply IEC 60853-2 4-hour cyclic peak windowing and monitor DTS fiber gradient ΔT across KP 32+410–32+605.',
      longTermMitigation: 'Inspect seabed sand-wave migration around NX1/NX2 and calibrate RTTR (Real-Time Thermal Rating) alarm at 55°C Alert Zone.',
    };
  }
  if (sectionId === '1.2' || sectionId === '1.4' || sectionId === '1.6') {
    return {
      bottleneckCause: 'Underground Concrete Joint Bay / Transition Joint Pit (JP1, JP2, TJ1) restricted air/soil heat dissipation & solar heat gain (IEC Estimation)',
      standardReference: 'IEC 60287-2-1 (T4 External Thermal Resistance in Vaults/Troughs) & IEEE Std 835',
      shortTermAction: 'Inspect joint bay covers, clear vegetation/debris, and balance Phase A/B/C currents at KMB substation.',
      longTermMitigation: 'Install passive/forced ventilation louvers, solar radiation canopy shielding over joint pits, or backfill with Fluidized Thermal Backfill (FTB, ρ < 0.8 K·m/W).',
    };
  }
  if (sectionId === '2.3' || sectionId === '2.11' || sectionId === '2.1' || sectionId === '2.13') {
    return {
      bottleneckCause: 'Subsea Pipeline / 33kV Cable Crossing (XPWA / X33kV) & Shore Landing HDD/J-Tube Bottleneck (BTN / TJ2)',
      standardReference: 'IEC 60287-2-1 Clause 4 (Mutual Heating of Crossing Cables) & CIGRE TB 610',
      shortTermAction: 'Coordinate KNA 33kV NKT/Oil circuit loading during peak hours to minimize mutual heating at KP 48+679 (X33kV).',
      longTermMitigation: 'Verify J-tube / shore landing water level and bentonite grout thermal conductivity at Khanom (BTN) and Samui (TJ2) landfalls.',
    };
  }
  return {
    bottleneckCause: `Normal buried ${equationName === 'Alpha' ? 'land trench (soil moisture migration risk in dry season)' : 'subsea seabed route'}`,
    standardReference: 'IEC 60287-1-1 / IEC 60287-2-1 Two-Zone Soil Drying Model',
    shortTermAction: 'Continue routine 15-minute SCADA & DTS automated monitoring across all 6 temperature zones.',
    longTermMitigation: 'Maintain right-of-way moisture retention and periodic DTS baseline calibration.',
  };
}

// Evaluate all 19 sections for Page 6: Risk Management Page
export function evaluateAllSectionsRisk(params: {
  parsedFiles: ParsedTeprFile[];
  scannedFiles: ScannedFileMeta[];
  powerSummariesByDate: Map<string, DailyPowerSummary>;
  activeDateFilter?: string;
  factors: PredictionScenarioFactors;
}): {
  evaluations: SectionRiskEvaluation[];
  zoneCountsCurrent: Record<ThermalZoneKey, number>;
  zoneCountsForecast: Record<ThermalZoneKey, number>;
} {
  const { parsedFiles, scannedFiles, powerSummariesByDate, activeDateFilter, factors } = params;

  const zoneCountsCurrent: Record<ThermalZoneKey, number> = {
    cool: 0,
    normal: 0,
    monitoring: 0,
    alert: 0,
    danger: 0,
    critical: 0,
  };
  const zoneCountsForecast: Record<ThermalZoneKey, number> = {
    cool: 0,
    normal: 0,
    monitoring: 0,
    alert: 0,
    danger: 0,
    critical: 0,
  };

  const evaluations: SectionRiskEvaluation[] = CIRCUIT_3_SECTIONS.map((sec) => {
    const analysis = buildSectionHistoricalAndForecast({
      sectionId: sec.id,
      phaseFilter: 'all',
      historyDaysCount: 14,
      forecastDaysCount: 30,
      parsedFiles,
      scannedFiles,
      powerSummariesByDate,
      activeDateFilter,
      factors,
    });

    const latestHist = analysis.historicalSeries[analysis.historicalSeries.length - 1];
    const firstHist = analysis.historicalSeries[0] || latestHist;
    const peakForecast = analysis.forecastSeries[analysis.forecastSeries.length - 1] || latestHist;

    const currentMaxTf = latestHist.maxTf;
    const currentMaxTc60287 = latestHist.maxTc60287;
    const forecastMaxTc60287 = peakForecast.maxTc60287;
    const heatingRatePerDayC = Number(
      ((forecastMaxTc60287 - currentMaxTc60287) / Math.max(1, analysis.forecastSeries.length)).toFixed(3)
    );

    const currentZone = getThermalZoneInfo(currentMaxTc60287);
    const forecastZone = getThermalZoneInfo(forecastMaxTc60287);

    zoneCountsCurrent[currentZone.key] += 1;
    zoneCountsForecast[forecastZone.key] += 1;

    // Calculate Likelihood (1-5) & Consequence (1-5) for 5x5 Engineering Risk Matrix
    const likelihoodLevel = (
      forecastMaxTc60287 > 70
        ? 5
        : forecastMaxTc60287 >= 60
        ? 4
        : forecastMaxTc60287 >= 55
        ? 4
        : forecastMaxTc60287 >= 45
        ? 3
        : forecastMaxTc60287 >= 35
        ? 2
        : 1
    ) as 1 | 2 | 3 | 4 | 5;

    const consequenceLevel = (
      sec.type === 'special' && (sec.equationName === 'Echo' || sec.equationName === 'Delta')
        ? 5
        : sec.type === 'special'
        ? 4
        : sec.category === 'submarine'
        ? 3
        : 2
    ) as 1 | 2 | 3 | 4 | 5;

    const rawScore = Math.min(
      100,
      Math.max(
        8,
        Math.round(
          (currentMaxTc60287 - 25) * 1.15 +
            (forecastMaxTc60287 - currentMaxTc60287) * 1.8 +
            (sec.type === 'special' ? 12 : 0) +
            (sec.equationName === 'Echo' ? 10 : sec.equationName === 'Delta' ? 7 : 0)
        )
      )
    );

    const pts = CIRCUIT_3_SAMPLING_POINTS.filter((p) => p.sectionId === sec.id);
    const minDof = pts.length > 0 ? Math.min(...pts.map((p) => p.dof)) : 0;
    const maxDof = pts.length > 0 ? Math.max(...pts.map((p) => p.dof)) : 0;

    const guidance = getSectionEngineeringGuidance(sec.id, sec.equationName);

    return {
      sectionId: sec.id,
      sectionName: sec.name,
      subtitle: sec.subtitle,
      category: sec.category,
      sectionType: sec.type,
      equationName: sec.equationName,
      pointCount: pts.length,
      dofRangeText: `${minDof.toFixed(1)}m – ${maxDof.toFixed(1)}m`,
      currentMaxTf,
      currentMaxTc60287,
      forecastMaxTc60287,
      heatingRatePerDayC,
      pCkt3MW: latestHist.pCkt3MW,
      currentZone,
      forecastZone,
      riskScore: rawScore,
      likelihoodLevel,
      consequenceLevel,
      hottestPos: latestHist.hottestPos,
      hottestDof: latestHist.hottestDof,
      ...guidance,
    };
  });

  evaluations.sort((a, b) => b.riskScore - a.riskScore || b.forecastMaxTc60287 - a.forecastMaxTc60287);

  return {
    evaluations,
    zoneCountsCurrent,
    zoneCountsForecast,
  };
}
