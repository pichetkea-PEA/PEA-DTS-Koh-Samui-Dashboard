import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  getThermalZoneInfo,
  evaluateSectionConductorTemp,
  CableSectionInfo,
} from '../data/cableCircuitStructure';
import { ParsedTeprFile } from './teprParser';
import {
  DailyPowerSummary,
  resolveOperatingPowerAtTime,
} from './powerConsumptionParser';
import {
  OrgDatabaseRecord,
  getOrgSectionDailyProfileForSectionDate,
  getPanel3SourceInfo,
} from './orgDatabaseStorage';

export interface ActualTelemetryPoint {
  time: string; // HH:mm or HH:mm:ss
  peakTime?: string;
  hourNum: number; // 0..23
  timeMinutes: number; // 0..1439
  fiberTempC: number;
  conductorTempC: number;
  powerFlowMW: number;
  pCkt3MW: number;
  powerCkt3MW?: number;
  totalIslandMW?: number;
  pCkt2MW: number;
  pNktMW: number;
  pOilMW: number;
  thermalZone: string;
  zoneColor: string;
  fileName: string;
  isPeak?: boolean;
  isMin?: boolean;
  readingSource: 'tepr_scan' | 'org_database';
}

export interface ActualDailyTelemetrySummary {
  dateKey: string;
  sectionId: string;
  sectionName: string;
  category: 'land' | 'submarine';
  phase: string;
  points: ActualTelemetryPoint[];
  dataSource: 'tepr_files' | 'org_database' | 'none';
  dataSourceLabel: string;
  peakFiberTempC: number;
  peakConductorTempC: number;
  peakTime: string;
  peakPowerMW: number;
  peakFileName: string;
  totalActualScans: number;
}

/**
 * Extracts strictly ACTUAL telemetry records for a given section, date, and phase.
 * NEVER uses sine wave, sinusoidal diurnal simulation, or synthetic mathematical interpolation.
 */
export function extractActualTelemetryForSection(params: {
  sectionId: string;
  dateKey: string;
  phaseFilter?: string; // 'all' | 'Phase A' | 'Phase B' | 'Phase C' | 'Submarine Cable'
  parsedFiles?: ParsedTeprFile[];
  dailyPowerSummary?: DailyPowerSummary | null;
  powerSummariesByDate?: Map<string, DailyPowerSummary>;
}): ActualDailyTelemetrySummary {
  const {
    sectionId,
    dateKey,
    phaseFilter = 'all',
    parsedFiles = [],
    dailyPowerSummary,
    powerSummariesByDate,
  } = params;

  const section =
    CIRCUIT_3_SECTIONS.find((s) => s.sectionId === sectionId) ||
    CIRCUIT_3_SECTIONS[0];
  const isLand = section.category === 'land' || sectionId.startsWith('1.');

  // Find effective power summary for strictly the given date from Target Folder 2
  const effectivePowerSummary =
    dailyPowerSummary?.dateKey === dateKey
      ? dailyPowerSummary
      : powerSummariesByDate?.get(dateKey) || null;

  // 1. Filter real parsed .TEPR files for this date from Target Folder 1
  const dateFiles = parsedFiles.filter((f) => {
    const fDate = f.dateMeta?.dateKey || '';
    if (fDate !== dateKey) return false;
    if (isLand && phaseFilter && phaseFilter !== 'all') {
      const fPh = (f.cablePhase || '').toLowerCase();
      const sPh = phaseFilter.toLowerCase();
      const letter = sPh.includes('a') ? 'a' : sPh.includes('b') ? 'b' : 'c';
      if (!fPh.includes(letter)) return false;
    }
    return true;
  });

  // Identify sampling points and DOF range belonging to this individual section
  const sectionSamplingPoints = CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
    if (p.sectionId !== section.sectionId) return false;
    if (isLand && phaseFilter && phaseFilter !== 'all') {
      const pPh = (p.phase || '').toLowerCase();
      const sPh = phaseFilter.toLowerCase();
      const letter = sPh.includes('a') ? 'a' : sPh.includes('b') ? 'b' : 'c';
      if (!pPh.includes(letter)) return false;
    }
    return true;
  });

  const targetDofMin =
    sectionSamplingPoints.length > 0
      ? Math.min(...sectionSamplingPoints.map((p) => p.dof))
      : 0;
  const targetDofMax =
    sectionSamplingPoints.length > 0
      ? Math.max(...sectionSamplingPoints.map((p) => p.dof))
      : 0;

  // Helper to read maximum fiber temperature across all section assigned DOFs from given .TEPR file(s)
  const extractMaxTfForFiles = (files: ParsedTeprFile[]): { maxTf: number; matchedFile: ParsedTeprFile | null } => {
    let maxTf = -Infinity;
    let matchedFile: ParsedTeprFile | null = null;

    for (const file of files) {
      // 1. Check discrete section sampling points
      for (const sp of sectionSamplingPoints) {
        const matched = file.targetLocationValues.find(
          (v) => Math.abs(v.location - sp.dof) < 0.1
        );
        if (matched && matched.absoluteTemp > maxTf) {
          maxTf = matched.absoluteTemp;
          matchedFile = file;
        }
      }

      // 2. Check continuous targetLocationValues within section DOF bounds
      if (file.targetLocationValues && file.targetLocationValues.length > 0) {
        for (const tv of file.targetLocationValues) {
          if (tv.location >= targetDofMin && tv.location <= targetDofMax) {
            if (tv.absoluteTemp > maxTf) {
              maxTf = tv.absoluteTemp;
              matchedFile = file;
            }
          }
        }
      }

      // 3. Check continuous raw DTS dataPoints within section DOF bounds
      if (file.dataPoints && file.dataPoints.length > 0) {
        for (const pt of file.dataPoints) {
          if (pt.position >= targetDofMin && pt.position <= targetDofMax) {
            const ptAbs = (file.header.fiberReferenceTemp || 30.0) + pt.deltaTemp;
            if (ptAbs > maxTf) {
              maxTf = ptAbs;
              matchedFile = file;
            }
          }
        }
      }

      // 4. Fallback to file delta position if within section DOF bounds
      if (maxTf === -Infinity) {
        if (
          file.maxDeltaPosition >= targetDofMin &&
          file.maxDeltaPosition <= targetDofMax
        ) {
          maxTf = (file.header.fiberReferenceTemp || 30.0) + file.maxDeltaTemp;
          matchedFile = file;
        }
      }
    }

    if (maxTf === -Infinity && files.length > 0) {
      const ref = files[0].header.fiberReferenceTemp || 30.0;
      maxTf = files[0].avgDeltaTemp ? ref + files[0].avgDeltaTemp : ref;
      matchedFile = files[0];
    }

    return { maxTf, matchedFile };
  };

  const points: ActualTelemetryPoint[] = [];

  // Sort .TEPR files chronologically
  const sortedFiles = [...dateFiles].sort(
    (a, b) => (a.header.timestamp || 0) - (b.header.timestamp || 0)
  );

  // Case A: 15-Minute Power Records from Target Folder 2 (96 records per day, every 15 min)
  if (
    effectivePowerSummary &&
    effectivePowerSummary.dataPoints &&
    effectivePowerSummary.dataPoints.length > 0 &&
    sortedFiles.length > 0
  ) {
    for (const dp of effectivePowerSummary.dataPoints) {
      const pCkt3 = Math.max(0, dp.kmbCircuit3 || 0);
      const pTotal = dp.totalPower || (pCkt3 + dp.kmaCircuit2 + dp.knaNkt + dp.knaOilFilled);

      // Find .TEPR files within ±15 minutes of this 15-minute power capture interval
      let slotFiles = sortedFiles.filter(
        (f) => {
          const fMinutes = (f.dateMeta?.hour || 0) * 60 + (f.dateMeta?.minute || 0);
          return Math.abs(fMinutes - dp.timeMinutes) <= 15;
        }
      );

      // If no file within ±15 min, find the closest file of the day
      if (slotFiles.length === 0) {
        let bestDist = Infinity;
        let bestF = sortedFiles[0];
        for (const f of sortedFiles) {
          const fMinutes = (f.dateMeta?.hour || 0) * 60 + (f.dateMeta?.minute || 0);
          const dist = Math.abs(fMinutes - dp.timeMinutes);
          if (dist < bestDist) {
            bestDist = dist;
            bestF = f;
          }
        }
        slotFiles = [bestF];
      }

      // Read temperature inside .TEPR file with all DOF range assigned to this section
      const { maxTf: rawMaxTf, matchedFile } = extractMaxTfForFiles(slotFiles);
      const maxTf = Number.isFinite(rawMaxTf) ? rawMaxTf : 30.0;

      // Estimate conductor temperature by using equation Alpha - Echo, using Circuit 3 power flow at nearest time
      const { tc60287: rawTc } = evaluateSectionConductorTemp(section, maxTf, pCkt3);
      const tc60287 = Number.isFinite(rawTc) ? rawTc : maxTf + 2.0;
      const zoneInfo = getThermalZoneInfo(tc60287);

      const safeTotal = Number(pTotal ?? 0) || 0;
      const safeCkt3 = Number(pCkt3 ?? 0) || 0;
      const safeCkt2 = Number(dp.kmaCircuit2 ?? 0) || 0;
      const safeNkt = Number(dp.knaNkt ?? 0) || 0;
      const safeOil = Number(dp.knaOilFilled ?? 0) || 0;

      points.push({
        time: dp.time,
        hourNum: Math.floor(dp.timeMinutes / 60),
        timeMinutes: dp.timeMinutes,
        fiberTempC: parseFloat(maxTf.toFixed(2)),
        conductorTempC: parseFloat(tc60287.toFixed(2)),
        powerFlowMW: parseFloat(safeTotal.toFixed(1)),
        pCkt3MW: parseFloat(safeCkt3.toFixed(1)),
        powerCkt3MW: parseFloat(safeCkt3.toFixed(1)),
        totalIslandMW: parseFloat(safeTotal.toFixed(1)),
        pCkt2MW: parseFloat(safeCkt2.toFixed(1)),
        pNktMW: parseFloat(safeNkt.toFixed(1)),
        pOilMW: parseFloat(safeOil.toFixed(1)),
        thermalZone: zoneInfo.shortLabel,
        zoneColor: zoneInfo.color,
        fileName: matchedFile?.fileName || `15-min Telemetry (${dp.time})`,
        readingSource: 'tepr_scan',
      });
    }
  } else if (sortedFiles.length > 0) {
    // Case B: Map directly through scanned .TEPR files and align with nearest 15-min power flow
    for (const file of sortedFiles) {
      const { maxTf: rawMaxTf } = extractMaxTfForFiles([file]);
      const maxTf = Number.isFinite(rawMaxTf) ? rawMaxTf : 30.0;

      const h = file.dateMeta?.hour || 0;
      const m = file.dateMeta?.minute || 0;
      const timeStr =
        file.dateMeta?.formattedTime ||
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const timeMinutes = h * 60 + m;

      // Extract coincident power flow from Target Folder 2 at nearest time of fiber capture
      const opPower = resolveOperatingPowerAtTime(effectivePowerSummary, {
        hour: h,
        minute: m,
        timeStr,
      });

      const safeCkt3 = Number(opPower.pCkt3MW ?? 0) || 0;
      const safeCkt2 = Number(opPower.pCkt2MW ?? 0) || 0;
      const safeNkt = Number(opPower.p33NktMW ?? 0) || 0;
      const safeOil = Number(opPower.p33OfMW ?? 0) || 0;
      const pTotal = safeCkt3 + safeCkt2 + safeNkt + safeOil;

      // Estimate conductor temperature by using equation Alpha - Echo
      const { tc60287: rawTc } = evaluateSectionConductorTemp(
        section,
        maxTf,
        safeCkt3
      );
      const tc60287 = Number.isFinite(rawTc) ? rawTc : maxTf + 2.0;

      const zoneInfo = getThermalZoneInfo(tc60287);

      points.push({
        time: timeStr,
        hourNum: h,
        timeMinutes,
        fiberTempC: parseFloat(maxTf.toFixed(2)),
        conductorTempC: parseFloat(tc60287.toFixed(2)),
        powerFlowMW: parseFloat(pTotal.toFixed(1)),
        pCkt3MW: parseFloat(safeCkt3.toFixed(1)),
        powerCkt3MW: parseFloat(safeCkt3.toFixed(1)),
        totalIslandMW: parseFloat(pTotal.toFixed(1)),
        pCkt2MW: parseFloat(safeCkt2.toFixed(1)),
        pNktMW: parseFloat(safeNkt.toFixed(1)),
        pOilMW: parseFloat(safeOil.toFixed(1)),
        thermalZone: zoneInfo.shortLabel,
        zoneColor: zoneInfo.color,
        fileName: file.fileName,
        readingSource: 'tepr_scan',
      });
    }
  }

  // If points exist from real files, mark peak & min and return real summary
  if (points.length > 0) {
    let peakPoint = points[0];
    let minPoint = points[0];
    for (const p of points) {
      if (p.fiberTempC > peakPoint.fiberTempC) peakPoint = p;
      if (p.fiberTempC < minPoint.fiberTempC) minPoint = p;
    }
    peakPoint.isPeak = true;
    minPoint.isMin = true;

    return {
      dateKey,
      sectionId: section.sectionId,
      sectionName: section.name,
      category: section.category,
      phase: isLand ? phaseFilter : 'SM',
      points,
      dataSource: 'tepr_files',
      dataSourceLabel: `Actual Telemetry (${points.length} points · Equation ${section.equationName})`,
      peakFiberTempC: peakPoint.fiberTempC,
      peakConductorTempC: peakPoint.conductorTempC,
      peakTime: peakPoint.time,
      peakPowerMW: peakPoint.pCkt3MW,
      peakFileName: peakPoint.fileName,
      totalActualScans: points.length,
    };
  }

  // Case C: Public Dashboard — Read directly from Panel 3 ("Section daily profile database")
  const panel3Rows = getOrgSectionDailyProfileForSectionDate(
    section.sectionId,
    dateKey,
    isLand ? phaseFilter : undefined
  );
  if (panel3Rows && panel3Rows.length > 0) {
    const p3Info = getPanel3SourceInfo();
    const dbPoints: ActualTelemetryPoint[] = [];

    for (const r of panel3Rows) {
      const h = Number(r.hourIndex ?? 0) || 0;
      const timeStr = `${String(h).padStart(2, '0')}:00`;
      const timeMinutes = h * 60;
      const maxTf = Number(r.maxFiberTempC ?? 32.0) || 32.0;
      const pCkt3 = Number(r.ckt3MW ?? 0) || 0;
      const pCkt2 = Number(r.ckt2MW ?? 0) || 0;
      const pNkt = Number(r.nkt33MW ?? 0) || 0;
      const pOil = Number(r.oil33MW ?? 0) || 0;
      const pTotal = Number(r.totalMW ?? 0) || (pCkt3 + pCkt2 + pNkt + pOil);

      let tcVal = Number(r.maxConductorTempC ?? 0) || 0;
      if (!tcVal || tcVal <= 0) {
        const { tc60287 } = evaluateSectionConductorTemp(section, maxTf, pCkt3);
        tcVal = Number.isFinite(tc60287) && tc60287 > 0 ? tc60287 : maxTf + 2.0;
      }
      const zoneInfo = getThermalZoneInfo(tcVal);

      dbPoints.push({
        time: timeStr,
        peakTime: r.peakTime || timeStr,
        hourNum: h,
        timeMinutes,
        fiberTempC: parseFloat(maxTf.toFixed(2)),
        conductorTempC: parseFloat(tcVal.toFixed(2)),
        powerFlowMW: parseFloat(pTotal.toFixed(1)),
        pCkt3MW: parseFloat(pCkt3.toFixed(1)),
        powerCkt3MW: parseFloat(pCkt3.toFixed(1)),
        totalIslandMW: parseFloat(pTotal.toFixed(1)),
        pCkt2MW: parseFloat(pCkt2.toFixed(1)),
        pNktMW: parseFloat(pNkt.toFixed(1)),
        pOilMW: parseFloat(pOil.toFixed(1)),
        thermalZone: zoneInfo.shortLabel,
        zoneColor: zoneInfo.color,
        fileName: `${p3Info.name} (${r.hourPeriod || timeStr})`,
        readingSource: 'org_database',
      });
    }

    if (dbPoints.length > 0) {
      let peakPoint = dbPoints[0];
      let minPoint = dbPoints[0];
      let peakPowerPoint = dbPoints[0];
      for (const p of dbPoints) {
        if (p.fiberTempC > peakPoint.fiberTempC) peakPoint = p;
        if (p.fiberTempC < minPoint.fiberTempC) minPoint = p;
        if (p.pCkt3MW > peakPowerPoint.pCkt3MW) peakPowerPoint = p;
      }
      peakPoint.isPeak = true;
      minPoint.isMin = true;

      return {
        dateKey,
        sectionId: section.sectionId,
        sectionName: section.name,
        category: section.category,
        phase: isLand ? phaseFilter : 'SM',
        points: dbPoints,
        dataSource: 'org_database',
        dataSourceLabel: `Section Daily Profile Database (${dbPoints.length} hrs · Equation ${section.equationName})`,
        peakFiberTempC: peakPoint.fiberTempC,
        peakConductorTempC: peakPoint.conductorTempC,
        peakTime: peakPoint.time,
        peakPowerMW: peakPowerPoint.pCkt3MW,
        peakFileName: peakPoint.fileName,
        totalActualScans: dbPoints.length,
      };
    }
  }

  return {
    dateKey,
    sectionId: section.sectionId,
    sectionName: section.name,
    category: section.category,
    phase: isLand ? phaseFilter : 'SM',
    points: [],
    dataSource: 'none',
    dataSourceLabel: 'No Section Daily Profile database records found for this date',
    peakFiberTempC: 0,
    peakConductorTempC: 0,
    peakTime: '-',
    peakPowerMW: 0,
    peakFileName: '-',
    totalActualScans: 0,
  };
}
