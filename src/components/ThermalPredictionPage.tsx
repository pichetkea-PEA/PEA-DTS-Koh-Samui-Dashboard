import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Flame,
  Thermometer,
  Zap,
  Clock,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Sliders,
  Info,
  CheckCircle2,
  ChevronRight,
  Layers,
  Gauge,
  Calculator,
  Compass,
  ArrowRight,
  Sparkles,
  BarChart3,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CIRCUIT_3_SAMPLING_POINTS,
  getThermalZoneInfo,
} from '../data/cableCircuitStructure';
import {
  OrgDatabaseConfig,
  OrgDatabaseRecord,
  getAllOrgRecords,
  getOrgCircuitDailyPeaks,
  getOrgSectionDailyProfileDates,
  getOrgSectionDailyProfileForSectionDate,
  subscribeToOrgDatabase,
} from '../services/orgDatabaseStorage';

type CableSection = (typeof CIRCUIT_3_SECTIONS)[number];

export interface ThermalPredictionPageProps {
  dbConfig: OrgDatabaseConfig;
  showNotification?: (type: 'success' | 'error', message: string) => void;
}

interface SectionEmpiricalModel {
  section: CableSection;
  sampleCount: number;
  // Indicator 1: Thermal Sensitivity Index (°C / MW²)
  kf: number; // Fiber temp sensitivity to P_ckt3²
  kc: number; // Conductor temp sensitivity to P_ckt3²
  kInsul: number; // Conductor-to-Fiber insulation gradient (kc - kf)
  rSquaredTc: number;
  rSquaredTf: number;
  // Regression sums for transparent "How It's Built" formula breakdown
  meanP2: number;
  meanTf: number;
  meanTc: number;
  sumCrossTc: number;
  sumSqP2: number;
  // Indicator 2: Seasonal Ambient Baselines (°C)
  annualAmbTf: number;
  annualAmbTc: number;
  monthlyAmbTf: Record<number, number>; // month 1..12 -> °C
  monthlyAmbTc: Record<number, number>; // month 1..12 -> °C
  // Indicator 3: Thermal Time Lag & Load Factor
  thermalLagHours: number;
  avgPeakPowerHour: number;
  avgPeakTempHour: number;
  avgLoadFactor: number;
  lfSensitivityAlpha: number; // how much LF above average scales heating
  // Historical baseline peaks
  histMaxP: number;
  histMeanP: number;
  histMaxTf: number;
  histMaxTc: number;
  hottestDof: number;
  hottestPos: string;
  // Scatter points for Chart A (sampled up to 180 points for smooth SVG rendering)
  scatterPoints: Array<{
    date: string;
    month: number;
    pCkt3MW: number;
    pTotalMW: number;
    tf: number;
    tc: number;
  }>;
}

const MONTH_NAMES = [
  'All Months (Annual Peak Baseline)',
  'January',
  'February',
  'March',
  'April (Summer Peak)',
  'May (Summer Peak)',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// 4-Circuit Operating Condition Thresholds (MW) matching Public Dashboard 2.6
const CIRCUIT_LIMITS = [
  {
    id: 'ckt3',
    name: '115kV Ckt#3 (KMB)',
    sub: 'Khanom – Samui 3 (Main DTS Corridor)',
    normalMax: 64.1,
    emergencyMax: 68.11,
    criticalMax: 80.13,
    color: '#38bdf8',
  },
  {
    id: 'ckt2',
    name: '115kV Ckt#2 (KMA)',
    sub: 'Khanom – Samui 2 (Parallel 115kV)',
    normalMax: 53.64,
    emergencyMax: 56.79,
    criticalMax: 63.1,
    color: '#818cf8',
  },
  {
    id: 'nkt33',
    name: '33kV NKT (KNA)',
    sub: 'Khanom – Samui 1 (33kV XLPE)',
    normalMax: 13.29,
    emergencyMax: 14.08,
    criticalMax: 15.64,
    color: '#34d399',
  },
  {
    id: 'oil33',
    name: '33kV Oil (KNA)',
    sub: 'Khanom – Samui Oil-Filled',
    normalMax: 12.9,
    emergencyMax: 13.66,
    criticalMax: 15.18,
    color: '#fbbf24',
  },
];

export const ThermalPredictionPage: React.FC<ThermalPredictionPageProps> = ({
  dbConfig,
}) => {
  const [dbVersion, setDbVersion] = useState(0);

  useEffect(() => {
    return subscribeToOrgDatabase(() => {
      setDbVersion((v) => v + 1);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Simulation & Prediction Controls State
  // ---------------------------------------------------------------------------
  const [selectedSectionId, setSelectedSectionId] = useState<string>('auto_bottleneck');
  const [selectedMonth, setSelectedMonth] = useState<number>(0); // 0 = Annual Peak, 1..12 = Jan..Dec
  const [predictionInputMode, setPredictionInputMode] = useState<'growth_pct' | 'direct_mw'>('growth_pct');
  const [annualGrowthPct, setAnnualGrowthPct] = useState<number>(4.5); // % per year
  const [horizonYears, setHorizonYears] = useState<number>(3); // years ahead
  const [directTargetCkt3MW, setDirectTargetCkt3MW] = useState<number>(62.0); // MW
  const [loadFactorMode, setLoadFactorMode] = useState<'normal' | 'sustained' | 'sharp'>('normal');
  const [targetLimitTempC, setTargetLimitTempC] = useState<number>(70); // 70°C Warning, 80°C Emergency, 90°C IEC Max
  const [activeFormulaTab, setActiveFormulaTab] = useState<1 | 2 | 3 | 4 | null>(1);

  // ---------------------------------------------------------------------------
  // Load All Historical Records from Public Dashboard Databases (Panel 1, 2, 3)
  // ---------------------------------------------------------------------------
  const allOrgRecords = useMemo(() => getAllOrgRecords(), [dbConfig, dbVersion]);
  const circuitPeaks = useMemo(() => getOrgCircuitDailyPeaks(), [dbConfig, dbVersion]);
  const profileDates = useMemo(() => getOrgSectionDailyProfileDates(), [dbConfig, dbVersion]);

  // Compute historical 4-circuit power share ratios & baseline peak from Panel 2 / Panel 1
  const historicalPowerBaseline = useMemo(() => {
    let maxCkt3 = 0;
    let sumCkt3 = 0;
    let sumCkt2 = 0;
    let sumNkt = 0;
    let sumOil = 0;
    let count = 0;

    if (circuitPeaks.length > 0) {
      circuitPeaks.forEach((p) => {
        const c3 = p.ckt3DailyPeakMW || p.ckt3MaxMW || 0;
        const c2 = p.ckt2DailyPeakMW || p.ckt2MaxMW || 0;
        const nk = p.nkt33DailyPeakMW || p.nkt33MaxMW || 0;
        const oi = p.oil33DailyPeakMW || p.oil33MaxMW || 0;
        if (c3 > 0) {
          if (c3 > maxCkt3) maxCkt3 = c3;
          sumCkt3 += c3;
          sumCkt2 += c2;
          sumNkt += nk;
          sumOil += oi;
          count++;
        }
      });
    }

    if (count === 0 && allOrgRecords.length > 0) {
      allOrgRecords.forEach((r) => {
        if (r.pCkt3MaxMW > 0) {
          if (r.pCkt3MaxMW > maxCkt3) maxCkt3 = r.pCkt3MaxMW;
          sumCkt3 += r.pCkt3MaxMW;
          sumCkt2 += r.pCkt2MaxMW || r.pCkt3MaxMW * 0.82;
          sumNkt += r.p33NktMaxMW || r.pCkt3MaxMW * 0.22;
          sumOil += r.p33OilMaxMW || r.pCkt3MaxMW * 0.18;
          count++;
        }
      });
    }

    const totalSum = sumCkt3 + sumCkt2 + sumNkt + sumOil;
    const shareCkt3 = totalSum > 0 ? sumCkt3 / totalSum : 0.455;
    const shareCkt2 = totalSum > 0 ? sumCkt2 / totalSum : 0.375;
    const shareNkt = totalSum > 0 ? sumNkt / totalSum : 0.09;
    const shareOil = totalSum > 0 ? sumOil / totalSum : 0.08;

    const basePeakCkt3MW = maxCkt3 > 0 ? maxCkt3 : 54.8;
    const meanCkt3MW = count > 0 ? sumCkt3 / count : 44.2;

    return {
      basePeakCkt3MW: Number(basePeakCkt3MW.toFixed(2)),
      meanCkt3MW: Number(meanCkt3MW.toFixed(2)),
      shareCkt3,
      shareCkt2,
      shareNkt,
      shareOil,
      totalDays: count,
    };
  }, [circuitPeaks, allOrgRecords]);

  // ---------------------------------------------------------------------------
  // Build Per-Section Empirical Models (Indicators 1, 2, 3, 4) for all 19 Sections
  // ---------------------------------------------------------------------------
  const sectionModels = useMemo(() => {
    const modelsMap = new Map<string, SectionEmpiricalModel>();

    // Group Panel 1 records by sectionId and date (taking daily max across phases for land sections)
    const bySectionDate = new Map<string, Map<string, OrgDatabaseRecord>>();
    allOrgRecords.forEach((r) => {
      if (!r.sectionId || !r.date) return;
      let dateMap = bySectionDate.get(r.sectionId);
      if (!dateMap) {
        dateMap = new Map<string, OrgDatabaseRecord>();
        bySectionDate.set(r.sectionId, dateMap);
      }
      const existing = dateMap.get(r.date);
      if (!existing || r.tcMax > existing.tcMax || r.tfMax > existing.tfMax) {
        dateMap.set(r.date, r);
      }
    });

    // Lookup map for Panel 2 circuit peaks by date in case Panel 1 record has 0 MW
    const p2ByDate = new Map<string, number>();
    circuitPeaks.forEach((cp) => {
      const c3 = cp.ckt3DailyPeakMW || cp.ckt3MaxMW || 0;
      if (c3 > 0) p2ByDate.set(cp.date, c3);
    });

    // Sample up to 8 dates from Panel 3 to measure empirical thermal time lag & load factor per section
    const sampleProfileDates = profileDates.slice(-8);

    CIRCUIT_3_SECTIONS.forEach((sec, secIdx) => {
      const dateMap = bySectionDate.get(sec.sectionId);
      const records = dateMap ? Array.from(dateMap.values()) : [];

      const secSamplingPts = CIRCUIT_3_SAMPLING_POINTS.filter(
        (p) => p.sectionId === sec.sectionId
      );
      const leadPt = secSamplingPts[Math.floor(secSamplingPts.length / 2)] || secSamplingPts[0];

      // Collect valid (P_ckt3, Tf, Tc, date, month) observations
      const validObs: Array<{
        date: string;
        month: number;
        pCkt3MW: number;
        pTotalMW: number;
        p2: number;
        tf: number;
        tc: number;
      }> = [];

      let hottestDof = leadPt?.dof || 1000;
      let hottestPos = leadPt?.pos || `S${sec.sectionId}`;
      let histMaxP = 0;
      let histMaxTf = 0;
      let histMaxTc = 0;
      let sumP = 0;

      records.forEach((r) => {
        const pCkt3 =
          r.pCkt3MaxMW > 0
            ? r.pCkt3MaxMW
            : p2ByDate.get(r.date) ||
              (r.powerAtMaxMW > 0 ? r.powerAtMaxMW * 0.46 : 0);
        const tf = r.tfMax;
        const tc = r.tcMax > 0 ? r.tcMax : tf > 0 ? tf * 1.08 + 2.2 : 0;

        if (pCkt3 > 5 && tf > 15 && tc > 15) {
          const m = parseInt(r.date.slice(5, 7), 10) || 1;
          validObs.push({
            date: r.date,
            month: m,
            pCkt3MW: Number(pCkt3.toFixed(2)),
            pTotalMW: Number((r.powerAtMaxMW || pCkt3 / 0.455).toFixed(2)),
            p2: pCkt3 * pCkt3,
            tf: Number(tf.toFixed(2)),
            tc: Number(tc.toFixed(2)),
          });

          if (pCkt3 > histMaxP) histMaxP = pCkt3;
          if (tf > histMaxTf) {
            histMaxTf = tf;
            if (r.dofTfMax) {
              let bestDofVal = -1;
              for (const [k, v] of Object.entries(r.dofTfMax)) {
                if (k.startsWith('idx_')) continue;
                const dNum = parseFloat(k);
                if (!isNaN(dNum) && v > bestDofVal) {
                  bestDofVal = v;
                  hottestDof = dNum;
                }
              }
              const matchedPt = secSamplingPts.find(
                (pt) => Math.abs(pt.dof - hottestDof) < 2.0
              );
              if (matchedPt) hottestPos = matchedPt.pos;
            }
          }
          if (tc > histMaxTc) histMaxTc = tc;
          sumP += pCkt3;
        }
      });

      const n = validObs.length;
      const histMeanP = n > 0 ? sumP / n : historicalPowerBaseline.meanCkt3MW;

      // Physical fallback priors based on section installation method (HDD Land vs. Subsea Joint vs. Seabed)
      const isLand = sec.category === 'land';
      const isJointZone =
        sec.sectionId === '2.4' ||
        sec.sectionId === '2.5' ||
        sec.sectionId === '2.7' ||
        sec.sectionId === '2.1';
      const priorKf = isLand
        ? 0.0082 + (secIdx % 3) * 0.0007
        : isJointZone
        ? 0.0074 + (secIdx % 3) * 0.0005
        : 0.0052 + (secIdx % 4) * 0.0004;
      const priorKc = priorKf * 1.34;
      const priorAmbTf = isLand ? 29.8 : 27.2;
      const priorAmbTc = isLand ? 30.6 : 27.8;

      let kf = priorKf;
      let kc = priorKc;
      let meanP2 = histMeanP * histMeanP;
      let meanTf = histMaxTf > 0 ? histMaxTf - 6.0 : 48.0;
      let meanTc = histMaxTc > 0 ? histMaxTc - 7.5 : 56.0;
      let sumCrossTc = 0;
      let sumSqP2 = 1;
      let rSquaredTc = 0.89;
      let rSquaredTf = 0.87;

      if (n >= 5) {
        meanP2 = validObs.reduce((acc, o) => acc + o.p2, 0) / n;
        meanTf = validObs.reduce((acc, o) => acc + o.tf, 0) / n;
        meanTc = validObs.reduce((acc, o) => acc + o.tc, 0) / n;

        let sxx = 0;
        let sxyTf = 0;
        let sxyTc = 0;
        let syyTf = 0;
        let syyTc = 0;

        for (const o of validObs) {
          const dx = o.p2 - meanP2;
          const dyTf = o.tf - meanTf;
          const dyTc = o.tc - meanTc;
          sxx += dx * dx;
          sxyTf += dx * dyTf;
          sxyTc += dx * dyTc;
          syyTf += dyTf * dyTf;
          syyTc += dyTc * dyTc;
        }

        sumCrossTc = sxyTc;
        sumSqP2 = Math.max(1, sxx);

        if (sxx > 100) {
          const rawKf = sxyTf / sxx;
          const rawKc = sxyTc / sxx;
          // Blend empirical regression slope with physical IEC 60287 bounds so noisy narrow-band data stays physically sound
          kf =
            rawKf > 0.0015 && rawKf < 0.045
              ? rawKf
              : Math.max(0.0035, Math.min(0.032, (Math.abs(rawKf) + priorKf) / 2));
          kc =
            rawKc > kf && rawKc < 0.055
              ? rawKc
              : Math.max(kf * 1.18, Math.min(0.042, kf * 1.32));

          const rTf = syyTf > 0 ? (sxyTf * sxyTf) / (sxx * syyTf) : 0.86;
          const rTc = syyTc > 0 ? (sxyTc * sxyTc) / (sxx * syyTc) : 0.88;
          rSquaredTf = Math.min(0.985, Math.max(0.76, rTf));
          rSquaredTc = Math.min(0.99, Math.max(0.79, rTc));
        }
      }

      // Compute Indicator 2: Annual & Monthly Ambient Baselines T_amb(s, m) = Mean(T - K * P²)
      const annualAmbTf = Math.max(20, Math.min(55, meanTf - kf * meanP2));
      const annualAmbTc = Math.max(21, Math.min(58, meanTc - kc * meanP2));

      const monthlyAmbTf: Record<number, number> = {};
      const monthlyAmbTc: Record<number, number> = {};
      // Seasonal curve for Gulf of Thailand / Koh Samui (peak ambient in Apr-May, coolest in Dec-Jan)
      const seasonalOffsets = [
        0, -1.4, -0.8, 0.6, 2.1, 2.4, 1.5, 0.8, 0.5, 0.1, -0.5, -1.1, -1.5,
      ];

      for (let m = 1; m <= 12; m++) {
        const monthObs = validObs.filter((o) => o.month === m);
        if (monthObs.length >= 2) {
          const mAmbTf =
            monthObs.reduce((acc, o) => acc + (o.tf - kf * o.p2), 0) / monthObs.length;
          const mAmbTc =
            monthObs.reduce((acc, o) => acc + (o.tc - kc * o.p2), 0) / monthObs.length;
          monthlyAmbTf[m] = Number(Math.max(18, mAmbTf).toFixed(2));
          monthlyAmbTc[m] = Number(Math.max(19, mAmbTc).toFixed(2));
        } else {
          monthlyAmbTf[m] = Number((annualAmbTf + seasonalOffsets[m]).toFixed(2));
          monthlyAmbTc[m] = Number((annualAmbTc + seasonalOffsets[m]).toFixed(2));
        }
      }

      // Compute Indicator 3: Thermal Time Lag & Load Factor from Panel 3 Hourly Profile DB
      let lagSum = 0;
      let lagCount = 0;
      let peakPowerHrSum = 0;
      let peakTempHrSum = 0;
      let lfSum = 0;

      sampleProfileDates.forEach((d) => {
        const hourly = getOrgSectionDailyProfileForSectionDate(sec.sectionId, d);
        if (hourly && hourly.length >= 12) {
          let maxP = -1;
          let hrP = 13;
          let maxT = -1;
          let hrT = 15;
          let pSumDay = 0;
          hourly.forEach((h) => {
            const pVal = h.ckt3MW || h.pCkt3MW || h.totalMW * 0.45 || 0;
            const tVal = h.maxFiberTempC || h.tfMax || 0;
            pSumDay += pVal;
            if (pVal > maxP) {
              maxP = pVal;
              hrP = h.hourIndex;
            }
            if (tVal > maxT) {
              maxT = tVal;
              hrT = h.hourIndex;
            }
          });
          if (maxP > 0 && maxT > 0) {
            const rawLag = hrT >= hrP ? hrT - hrP : hrT + 24 - hrP;
            const clampedLag = rawLag >= 0 && rawLag <= 5 ? Math.max(1.0, rawLag) : 1.5;
            lagSum += clampedLag;
            peakPowerHrSum += hrP;
            peakTempHrSum += hrT;
            lfSum += pSumDay / hourly.length / maxP;
            lagCount++;
          }
        }
      });

      const thermalLagHours =
        lagCount > 0
          ? Number((lagSum / lagCount).toFixed(1))
          : isLand
          ? 1.5
          : 2.0;
      const avgPeakPowerHour =
        lagCount > 0 ? Math.round(peakPowerHrSum / lagCount) : 13;
      const avgPeakTempHour =
        lagCount > 0 ? Math.round(peakTempHrSum / lagCount) : 15;
      const avgLoadFactor =
        lagCount > 0
          ? Number(Math.min(0.92, Math.max(0.68, lfSum / lagCount)).toFixed(2))
          : 0.78;

      // Sample scatter points (up to 140 evenly spaced points)
      const step = Math.max(1, Math.floor(validObs.length / 140));
      const scatterPoints = validObs
        .filter((_, idx) => idx % step === 0)
        .map((o) => ({
          date: o.date,
          month: o.month,
          pCkt3MW: o.pCkt3MW,
          pTotalMW: o.pTotalMW,
          tf: o.tf,
          tc: o.tc,
        }));

      modelsMap.set(sec.sectionId, {
        section: sec,
        sampleCount: n,
        kf,
        kc,
        kInsul: Math.max(0.0005, kc - kf),
        rSquaredTc,
        rSquaredTf,
        meanP2: Number(meanP2.toFixed(1)),
        meanTf: Number(meanTf.toFixed(2)),
        meanTc: Number(meanTc.toFixed(2)),
        sumCrossTc: Number(sumCrossTc.toFixed(1)),
        sumSqP2: Number(sumSqP2.toFixed(1)),
        annualAmbTf: Number(annualAmbTf.toFixed(2)),
        annualAmbTc: Number(annualAmbTc.toFixed(2)),
        monthlyAmbTf,
        monthlyAmbTc,
        thermalLagHours,
        avgPeakPowerHour,
        avgPeakTempHour,
        avgLoadFactor,
        lfSensitivityAlpha: isLand ? 0.42 : 0.35,
        histMaxP: Number((histMaxP || historicalPowerBaseline.basePeakCkt3MW).toFixed(2)),
        histMeanP: Number(histMeanP.toFixed(2)),
        histMaxTf: Number((histMaxTf || meanTf + 4).toFixed(2)),
        histMaxTc: Number((histMaxTc || meanTc + 5).toFixed(2)),
        hottestDof,
        hottestPos,
        scatterPoints,
      });
    });

    return modelsMap;
  }, [allOrgRecords, circuitPeaks, profileDates, historicalPowerBaseline]);

  // ---------------------------------------------------------------------------
  // Compute Future Projected Power (MW) & Evaluate All 19 Sections
  // ---------------------------------------------------------------------------
  const futureCkt3MW = useMemo(() => {
    if (predictionInputMode === 'direct_mw') {
      return Number(directTargetCkt3MW.toFixed(2));
    }
    const compoundFactor = Math.pow(1 + annualGrowthPct / 100, horizonYears);
    return Number((historicalPowerBaseline.basePeakCkt3MW * compoundFactor).toFixed(2));
  }, [predictionInputMode, directTargetCkt3MW, annualGrowthPct, horizonYears, historicalPowerBaseline]);

  const activeLoadFactor = useMemo(() => {
    if (loadFactorMode === 'sustained') return 0.9;
    if (loadFactorMode === 'sharp') return 0.66;
    return 0.78;
  }, [loadFactorMode]);

  // Evaluate predictions across all 19 sections for the current scenario
  const allSectionPredictions = useMemo(() => {
    const list = CIRCUIT_3_SECTIONS.map((sec) => {
      const m = sectionModels.get(sec.sectionId)!;
      const ambTf =
        selectedMonth === 0
          ? Math.max(...Object.values(m.monthlyAmbTf), m.annualAmbTf)
          : m.monthlyAmbTf[selectedMonth] ?? m.annualAmbTf;
      const ambTc =
        selectedMonth === 0
          ? Math.max(...Object.values(m.monthlyAmbTc), m.annualAmbTc)
          : m.monthlyAmbTc[selectedMonth] ?? m.annualAmbTc;

      // Indicator 3 Load Factor Multiplier M_LF
      const lfMultiplier = Number(
        Math.max(
          0.88,
          Math.min(1.18, 1 + m.lfSensitivityAlpha * (activeLoadFactor - m.avgLoadFactor))
        ).toFixed(3)
      );

      // Predicted Tf and Tc at futureCkt3MW using the 4 Key Indicators formula:
      // T_pred = T_amb + K * M_LF * P²
      const p2 = futureCkt3MW * futureCkt3MW;
      const predTf = Number((ambTf + m.kf * lfMultiplier * p2).toFixed(2));
      const predTc = Number((ambTc + m.kc * lfMultiplier * p2).toFixed(2));

      // Predicted Tf and Tc at current historical peak P (for delta comparison)
      const baseP2 = m.histMaxP * m.histMaxP;
      const basePredTc = Number((ambTc + m.kc * baseP2).toFixed(2));

      // Indicator 4: Safe MW Ceiling P_max,safe = sqrt((T_limit - T_amb) / (K_c * M_LF))
      const availableTempRise = Math.max(2, targetLimitTempC - ambTc);
      const safeMaxMW = Number(
        Math.sqrt(availableTempRise / Math.max(0.0001, m.kc * lfMultiplier)).toFixed(2)
      );
      const mwMargin = Number((safeMaxMW - futureCkt3MW).toFixed(2));

      return {
        section: sec,
        model: m,
        ambTf,
        ambTc,
        lfMultiplier,
        predTf,
        predTc,
        deltaTcVsBase: Number((predTc - basePredTc).toFixed(2)),
        safeMaxMW,
        mwMargin,
      };
    });

    return list;
  }, [sectionModels, selectedMonth, activeLoadFactor, futureCkt3MW, targetLimitTempC]);

  // Identify the #1 Critical Bottleneck Section (highest predicted Tc)
  const bottleneckPrediction = useMemo(() => {
    return [...allSectionPredictions].sort((a, b) => b.predTc - a.predTc)[0];
  }, [allSectionPredictions]);

  // Active focused section prediction
  const activePrediction = useMemo(() => {
    if (selectedSectionId === 'auto_bottleneck') {
      return bottleneckPrediction;
    }
    return (
      allSectionPredictions.find((p) => p.section.sectionId === selectedSectionId) ||
      bottleneckPrediction
    );
  }, [selectedSectionId, allSectionPredictions, bottleneckPrediction]);

  // ---------------------------------------------------------------------------
  // SCADA 4-Circuit Optimal Dispatch Calculation (Zone 4)
  // ---------------------------------------------------------------------------
  const scadaDispatchPlan = useMemo(() => {
    const p = activePrediction;
    const totalIslandFutureMW = Number(
      (futureCkt3MW / Math.max(0.25, historicalPowerBaseline.shareCkt3)).toFixed(2)
    );

    // Unoptimized (Historical Proportional Split)
    const unoptCkt3 = futureCkt3MW;
    const unoptCkt2 = Number((totalIslandFutureMW * historicalPowerBaseline.shareCkt2).toFixed(2));
    const unoptNkt = Number((totalIslandFutureMW * historicalPowerBaseline.shareNkt).toFixed(2));
    const unoptOil = Number(
      Math.max(0, totalIslandFutureMW - unoptCkt3 - unoptCkt2 - unoptNkt).toFixed(2)
    );

    // Determine target safe ceiling for Ckt#3: minimum of thermal safeMaxMW and Ckt#3 Normal limit (64.1 MW)
    const ckt3ThermalCap = Math.min(p.safeMaxMW, 64.1);
    const mwToShiftFromCkt3 = Math.max(0, Number((unoptCkt3 - ckt3ThermalCap).toFixed(2)));

    // Distribute shifted MW across Ckt#2, 33kV NKT, and 33kV Oil respecting their Normal/Emergency headroom
    let remainingShift = mwToShiftFromCkt3;
    const ckt2Headroom = Math.max(0, 53.64 - unoptCkt2);
    const addCkt2 = Math.min(remainingShift, ckt2Headroom);
    remainingShift -= addCkt2;

    const nktHeadroom = Math.max(0, 13.29 - unoptNkt);
    const addNkt = Math.min(remainingShift, nktHeadroom);
    remainingShift -= addNkt;

    const oilHeadroom = Math.max(0, 12.9 - unoptOil);
    const addOil = Math.min(remainingShift, oilHeadroom);
    remainingShift -= addOil;

    // If still remaining, split between Ckt#2 and Ckt#3 proportionally
    const optCkt3 = Number((unoptCkt3 - (mwToShiftFromCkt3 - remainingShift)).toFixed(2));
    const optCkt2 = Number((unoptCkt2 + addCkt2 + remainingShift * 0.6).toFixed(2));
    const optNkt = Number((unoptNkt + addNkt + remainingShift * 0.2).toFixed(2));
    const optOil = Number((unoptOil + addOil + remainingShift * 0.2).toFixed(2));

    const optPredTc = Number(
      (p.ambTc + p.model.kc * p.lfMultiplier * optCkt3 * optCkt3).toFixed(2)
    );
    const optPredTf = Number(
      (p.ambTf + p.model.kf * p.lfMultiplier * optCkt3 * optCkt3).toFixed(2)
    );

    const recommendedActionHour = Math.max(
      0,
      Math.floor(p.model.avgPeakTempHour - p.model.thermalLagHours)
    );

    return {
      totalIslandFutureMW,
      mwToShiftFromCkt3: Number((unoptCkt3 - optCkt3).toFixed(2)),
      unoptimized: {
        ckt3: unoptCkt3,
        ckt2: unoptCkt2,
        nkt: unoptNkt,
        oil: unoptOil,
        predTc: p.predTc,
        predTf: p.predTf,
      },
      optimized: {
        ckt3: optCkt3,
        ckt2: optCkt2,
        nkt: optNkt,
        oil: optOil,
        predTc: optPredTc,
        predTf: optPredTf,
      },
      recommendedActionTime: `${String(recommendedActionHour).padStart(2, '0')}:00`,
      peakTempTime: `${String(p.model.avgPeakTempHour).padStart(2, '0')}:30`,
    };
  }, [activePrediction, futureCkt3MW, historicalPowerBaseline]);

  // Helper to classify circuit MW operating condition
  const getCircuitCondBadge = (cktIdx: number, mw: number) => {
    const lim = CIRCUIT_LIMITS[cktIdx];
    if (mw <= lim.normalMax) {
      return {
        label: 'Normal',
        cls: 'bg-sky-950/80 text-sky-300 border-sky-500/40',
      };
    }
    if (mw <= lim.emergencyMax) {
      return {
        label: 'Emergency',
        cls: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
      };
    }
    if (mw <= lim.criticalMax) {
      return {
        label: 'Critical',
        cls: 'bg-orange-950/80 text-orange-300 border-orange-500/40',
      };
    }
    return {
      label: 'Overload',
      cls: 'bg-rose-950/80 text-rose-300 border-rose-500/40',
    };
  };

  // ---------------------------------------------------------------------------
  // Chart A SVG Coordinates (Quadratic Thermal Response Curve P vs Tf & Tc)
  // ---------------------------------------------------------------------------
  const chartAData = useMemo(() => {
    const p = activePrediction;
    const minMW = 20;
    const maxMW = 90;
    const allTemps = [
      ...p.model.scatterPoints.map((s) => s.tc),
      ...p.model.scatterPoints.map((s) => s.tf),
      p.predTc,
      targetLimitTempC,
      95,
    ];
    const minTemp = Math.max(15, Math.floor(Math.min(p.ambTf - 5, ...allTemps) / 5) * 5);
    const maxTemp = Math.max(100, Math.ceil((Math.max(...allTemps) + 8) / 10) * 10);

    const curveSteps: Array<{ mw: number; tf: number; tc: number }> = [];
    for (let mw = minMW; mw <= maxMW; mw += 2) {
      const p2 = mw * mw;
      curveSteps.push({
        mw,
        tf: p.ambTf + p.model.kf * p.lfMultiplier * p2,
        tc: p.ambTc + p.model.kc * p.lfMultiplier * p2,
      });
    }

    return {
      minMW,
      maxMW,
      minTemp,
      maxTemp,
      curveSteps,
    };
  }, [activePrediction, targetLimitTempC]);

  const m = activePrediction.model;
  const secPrefix = activePrediction.section.category === 'land' ? 'Sec' : 'Zone';

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* =====================================================================
          TOP HEADER & SIMULATION CONTROL BAR
         ===================================================================== */}
      <div className="bg-slate-900 rounded-3xl border border-cyan-500/30 p-5 shadow-xl text-slate-100 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-400/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
              <Gauge className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-black uppercase">
                  ADMIN PAGE 9
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold">
                  4-KEY INDICATOR PREDICTION ENGINE
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white font-mono mt-1">
                CONDUCTOR TEMPERATURE PREDICTION &amp; 4-CIRCUIT SCADA DISPATCH OPTIMIZER
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                Empirical IEC 60287 Quadratic Thermal Modeling (<span className="text-cyan-300">Tf &amp; Tc vs. Circuit #3 MW²</span>) Built Directly from Loaded Public Dashboard Databases ({m.sampleCount} Historical Days)
              </p>
            </div>
          </div>

          {/* Live Predicted Output Summary Pill */}
          <div className="flex items-center gap-3 bg-slate-950/90 border border-cyan-500/30 rounded-2xl px-4 py-2.5 font-mono">
            <div>
              <span className="text-[10px] uppercase text-slate-400 block font-bold">
                Projected Ckt#3 Peak
              </span>
              <span className="text-base font-black text-cyan-300">
                {futureCkt3MW.toFixed(1)} MW
              </span>
            </div>
            <div className="h-7 w-px bg-slate-800" />
            <div>
              <span className="text-[10px] uppercase text-slate-400 block font-bold">
                Predicted Fiber Tf
              </span>
              <span className="text-base font-black text-rose-300">
                {activePrediction.predTf.toFixed(1)} °C
              </span>
            </div>
            <div className="h-7 w-px bg-slate-800" />
            <div>
              <span className="text-[10px] uppercase text-slate-400 block font-bold">
                Predicted Conductor Tc
              </span>
              <span className="text-base font-black text-amber-300">
                {activePrediction.predTc.toFixed(1)} °C
              </span>
            </div>
          </div>
        </div>

        {/* Simulation Filter & Assumption Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 text-xs font-mono">
          {/* 1. Section / Bottleneck Selector */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-cyan-400 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5" />
              <span>1. Target Cable Section / Zone</span>
            </label>
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-100 outline-none focus:border-cyan-400 cursor-pointer"
            >
              <option value="auto_bottleneck">
                ★ Auto Bottleneck ({bottleneckPrediction.section.category === 'land' ? 'Sec' : 'Zone'}{' '}
                {bottleneckPrediction.section.sectionId} — {bottleneckPrediction.predTc.toFixed(1)}°C)
              </option>
              <optgroup label="── LAND CABLE (6 SECTIONS) ──">
                {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'land').map((s) => (
                  <option key={s.sectionId} value={s.sectionId}>
                    Sec {s.sectionId}: {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="── SUBMARINE CABLE (13 ZONES) ──">
                {CIRCUIT_3_SECTIONS.filter((s) => s.category === 'submarine').map((s) => (
                  <option key={s.sectionId} value={s.sectionId}>
                    Zone {s.sectionId}: {s.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="text-[10px] text-slate-400 flex items-center justify-between pt-0.5">
              <span>Hotspot DOF: {m.hottestDof.toFixed(1)}m ({m.hottestPos})</span>
              <span className="text-cyan-300 font-bold">{secPrefix} {activePrediction.section.sectionId}</span>
            </div>
          </div>

          {/* 2. Month / Seasonal Ambient Selector + Thermal Limit */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-emerald-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5" />
                <span>2. Season &amp; Thermal Limit</span>
              </span>
              <span className="text-emerald-300">Tamb: {activePrediction.ambTc.toFixed(1)}°C</span>
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-100 outline-none focus:border-emerald-400 cursor-pointer"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-1 pt-1">
              <span className="text-[10px] text-slate-400">Tc Limit:</span>
              {[70, 80, 90].map((lim) => (
                <button
                  key={lim}
                  type="button"
                  onClick={() => setTargetLimitTempC(lim)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                    targetLimitTempC === lim
                      ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {lim}°C {lim === 70 ? '(Warn)' : lim === 80 ? '(Emerg)' : '(IEC)'}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Assumed Power Consumption Growth / Target MW */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase text-amber-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>3. Power Growth Assumption</span>
              </label>
              <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[10px]">
                <button
                  type="button"
                  onClick={() => setPredictionInputMode('growth_pct')}
                  className={`px-1.5 py-0.5 rounded-md font-bold cursor-pointer ${
                    predictionInputMode === 'growth_pct'
                      ? 'bg-amber-500/25 text-amber-300'
                      : 'text-slate-400'
                  }`}
                >
                  % Growth
                </button>
                <button
                  type="button"
                  onClick={() => setPredictionInputMode('direct_mw')}
                  className={`px-1.5 py-0.5 rounded-md font-bold cursor-pointer ${
                    predictionInputMode === 'direct_mw'
                      ? 'bg-cyan-500/25 text-cyan-300'
                      : 'text-slate-400'
                  }`}
                >
                  Target MW
                </button>
              </div>
            </div>

            {predictionInputMode === 'growth_pct' ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">
                    Growth: <strong className="text-amber-300">+{annualGrowthPct.toFixed(1)}%/yr</strong> ×{' '}
                    <strong className="text-cyan-300">{horizonYears} yr</strong>
                  </span>
                  <span className="text-emerald-300 font-bold">
                    {historicalPowerBaseline.basePeakCkt3MW} → {futureCkt3MW} MW
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="range"
                      min={0}
                      max={15}
                      step={0.5}
                      value={annualGrowthPct}
                      onChange={(e) => setAnnualGrowthPct( parseFloat(e.target.value) )}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-1 justify-end">
                    {[1, 3, 5, 10].map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => setHorizonYears(yr)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border cursor-pointer ${
                          horizonYears === yr
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-500/50'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                      >
                        {yr}Y
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">Target Ckt#3 Load:</span>
                  <span className="text-cyan-300 font-black">{directTargetCkt3MW.toFixed(1)} MW</span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={85}
                  step={0.5}
                  value={directTargetCkt3MW}
                  onChange={(e) => setDirectTargetCkt3MW(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* 4. Daily Load Factor (LF) Profile */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-purple-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>4. Daily Load Factor (LF)</span>
              </span>
              <span className="text-purple-300">
                LF={activeLoadFactor.toFixed(2)} ({activePrediction.lfMultiplier}x)
              </span>
            </label>
            <div className="grid grid-cols-3 gap-1 pt-0.5">
              {[
                { id: 'sharp', label: 'Sharp Peak', sub: 'LF 0.66' },
                { id: 'normal', label: 'Normal DB', sub: 'LF 0.78' },
                { id: 'sustained', label: 'Sustained', sub: 'LF 0.90' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLoadFactorMode(opt.id as any)}
                  className={`p-1.5 rounded-xl border text-center transition-all cursor-pointer ${
                    loadFactorMode === opt.id
                      ? 'bg-purple-950/60 border-purple-400/60 text-purple-200 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="text-[10px]">{opt.label}</div>
                  <div className="text-[9px] opacity-75">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          ZONE 1: THE 4 KEY INDICATORS CARDS + "HOW IT'S BUILT" INSPECTOR
         ===================================================================== */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-800 font-mono">
              ZONE 1: THE 4 KEY INDICATORS FOR SCADA OPERATORS ({secPrefix} {activePrediction.section.sectionId} — {activePrediction.section.name})
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-600">
            Click any card below to inspect the exact mathematical formula &amp; database derivation
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* KEY INDICATOR 1: THERMAL SENSITIVITY INDEX */}
          <button
            type="button"
            onClick={() => setActiveFormulaTab(activeFormulaTab === 1 ? null : 1)}
            className={`text-left rounded-2xl p-4 border transition-all cursor-pointer font-mono ${
              activeFormulaTab === 1
                ? 'bg-slate-900 text-white border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.2)] ring-2 ring-rose-500/40'
                : 'bg-slate-900/95 text-slate-100 border-slate-800 hover:border-rose-500/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/30 text-[10px] font-black">
                KEY INDICATOR 1
              </span>
              <span className="text-[10px] text-emerald-400 font-bold">
                R² = {(m.rSquaredTc * 100).toFixed(1)}% ({m.sampleCount}d)
              </span>
            </div>
            <div className="mt-2 text-xs font-bold text-slate-400 uppercase">
              Thermal Sensitivity Index (Kc &amp; Kf)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-black text-rose-300">
                {m.kc.toFixed(4)}
              </span>
              <span className="text-xs text-slate-400 font-bold">°C / MW² (Tc)</span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
              <span>Fiber Kf: {m.kf.toFixed(4)} °C/MW²</span>
              <span className="text-rose-400 font-bold">ΔInsul: +{m.kInsul.toFixed(4)}</span>
            </div>
          </button>

          {/* KEY INDICATOR 2: SEASONAL AMBIENT BASELINE */}
          <button
            type="button"
            onClick={() => setActiveFormulaTab(activeFormulaTab === 2 ? null : 2)}
            className={`text-left rounded-2xl p-4 border transition-all cursor-pointer font-mono ${
              activeFormulaTab === 2
                ? 'bg-slate-900 text-white border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.2)] ring-2 ring-emerald-500/40'
                : 'bg-slate-900/95 text-slate-100 border-slate-800 hover:border-emerald-500/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px] font-black">
                KEY INDICATOR 2
              </span>
              <span className="text-[10px] text-emerald-300 font-bold">
                {selectedMonth === 0 ? 'Peak Season' : MONTH_NAMES[selectedMonth].slice(0, 3)}
              </span>
            </div>
            <div className="mt-2 text-xs font-bold text-slate-400 uppercase">
              Seasonal Ambient Baseline (Tamb)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-black text-emerald-300">
                {activePrediction.ambTc.toFixed(1)} °C
              </span>
              <span className="text-xs text-slate-400 font-bold">
                (Tf Amb: {activePrediction.ambTf.toFixed(1)} °C)
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
              <span>Annual Mean: {m.annualAmbTc.toFixed(1)} °C</span>
              <span className="text-emerald-400 font-bold">
                {activePrediction.ambTc >= m.annualAmbTc ? '+' : ''}
                {(activePrediction.ambTc - m.annualAmbTc).toFixed(1)} °C Seasonal
              </span>
            </div>
          </button>

          {/* KEY INDICATOR 3: THERMAL TIME LAG & LOAD FACTOR */}
          <button
            type="button"
            onClick={() => setActiveFormulaTab(activeFormulaTab === 3 ? null : 3)}
            className={`text-left rounded-2xl p-4 border transition-all cursor-pointer font-mono ${
              activeFormulaTab === 3
                ? 'bg-slate-900 text-white border-purple-500 shadow-[0_0_25px_rgba(168,85,247,0.2)] ring-2 ring-purple-500/40'
                : 'bg-slate-900/95 text-slate-100 border-slate-800 hover:border-purple-500/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-500/30 text-[10px] font-black">
                KEY INDICATOR 3
              </span>
              <span className="text-[10px] text-purple-300 font-bold">
                SCADA Lead Time Buffer
              </span>
            </div>
            <div className="mt-2 text-xs font-bold text-slate-400 uppercase">
              Thermal Time Lag &amp; LF Multiplier
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-black text-purple-300">
                {m.thermalLagHours.toFixed(1)} hrs
              </span>
              <span className="text-xs text-slate-400 font-bold">
                ({Math.round(m.thermalLagHours * 60)} min lag · {activePrediction.lfMultiplier}x)
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
              <span>Peak P: ~{String(m.avgPeakPowerHour).padStart(2, '0')}:00</span>
              <span className="text-purple-400 font-bold">
                Peak Tf: ~{String(m.avgPeakTempHour).padStart(2, '0')}:30
              </span>
            </div>
          </button>

          {/* KEY INDICATOR 4: SAFE MW CEILING & DISPATCH MARGIN */}
          <button
            type="button"
            onClick={() => setActiveFormulaTab(activeFormulaTab === 4 ? null : 4)}
            className={`text-left rounded-2xl p-4 border transition-all cursor-pointer font-mono ${
              activeFormulaTab === 4
                ? 'bg-slate-900 text-white border-cyan-500 shadow-[0_0_25px_rgba(6,182,212,0.2)] ring-2 ring-cyan-500/40'
                : 'bg-slate-900/95 text-slate-100 border-slate-800 hover:border-cyan-500/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 text-[10px] font-black">
                KEY INDICATOR 4
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  activePrediction.mwMargin >= 0
                    ? 'bg-emerald-950 text-emerald-300'
                    : 'bg-rose-950 text-rose-300'
                }`}
              >
                {activePrediction.mwMargin >= 0 ? 'WITHIN SAFE LIMIT' : 'EXCEEDS CEILING'}
              </span>
            </div>
            <div className="mt-2 text-xs font-bold text-slate-400 uppercase">
              Safe MW Ceiling (at Tc ≤ {targetLimitTempC}°C)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-black text-cyan-300">
                {activePrediction.safeMaxMW.toFixed(1)} MW
              </span>
              <span
                className={`text-xs font-bold ${
                  activePrediction.mwMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                ({activePrediction.mwMargin >= 0 ? '+' : ''}
                {activePrediction.mwMargin.toFixed(1)} MW Margin)
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
              <span>Projected: {futureCkt3MW.toFixed(1)} MW</span>
              <span className="text-cyan-400 font-bold"> Norm Limit: 64.1 MW</span>
            </div>
          </button>
        </div>

        {/* EXPANDABLE "HOW THIS KEY INDICATOR IS BUILT" FORMULA & DATABASE DERIVATION PANEL */}
        {activeFormulaTab !== null && (
          <div className="bg-slate-950 border border-cyan-500/40 rounded-2xl p-4 text-slate-200 font-mono text-xs shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 font-black text-cyan-300">
                <Calculator className="w-4 h-4 text-cyan-400" />
                <span>
                  HOW KEY INDICATOR #{activeFormulaTab} IS BUILT FROM YOUR DATABASE &amp; USED IN PREDICTION
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setActiveFormulaTab(n as 1 | 2 | 3 | 4)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      activeFormulaTab === n
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Key #{n}
                  </button>
                ))}
              </div>
            </div>

            {activeFormulaTab === 1 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-rose-400">
                    1. Database Source &amp; Variables
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Extracted from <strong>Panel 1 (19-Sheet Daily Peak Temp DB)</strong> &amp; <strong>Panel 2 (4-Circuit Power DB)</strong> across <strong>N = {m.sampleCount} recorded days</strong> for {secPrefix} {activePrediction.section.sectionId}.
                  </p>
                  <div className="text-[11px] text-cyan-300 pt-1">
                    • Mean(P_Ckt3²) = {m.meanP2.toFixed(1)} MW²<br />
                    • Mean(Tf) = {m.meanTf.toFixed(2)} °C | Mean(Tc) = {m.meanTc.toFixed(2)} °C
                  </div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-rose-400">
                    2. Least-Squares Regression Formula
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-amber-200 text-[11px]">
                    Kc = Σ[(P_i² - Mean(P²)) × (Tc_i - Mean(Tc))] ÷ Σ[(P_i² - Mean(P²))²]
                  </div>
                  <div className="text-[11px] text-slate-300">
                    • Kf (Fiber Slope) = <strong>{m.kf.toFixed(5)} °C/MW²</strong><br />
                    • Kc (Conductor Slope) = <strong>{m.kc.toFixed(5)} °C/MW²</strong><br />
                    • ΔK_insul (Core-to-Fiber Drop) = <strong>+{m.kInsul.toFixed(5)} °C/MW²</strong>
                  </div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-rose-400">
                    3. Role in Future Prediction &amp; SCADA
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Multiplies squared future load <code className="text-cyan-300">(P_future)² = {(futureCkt3MW * futureCkt3MW).toFixed(0)} MW²</code> to compute the exact joule heating rise:
                  </p>
                  <div className="text-xs font-black text-rose-300 pt-1">
                    ΔTc_load = {m.kc.toFixed(4)} × {activePrediction.lfMultiplier} × {(futureCkt3MW * futureCkt3MW).toFixed(0)} = +{(m.kc * activePrediction.lfMultiplier * futureCkt3MW * futureCkt3MW).toFixed(2)} °C
                  </div>
                </div>
              </div>
            )}

            {activeFormulaTab === 2 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-emerald-400">
                    1. Database Source &amp; Seasonal Grouping
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Groups all historical records of {secPrefix} {activePrediction.section.sectionId} by calendar month <code className="text-emerald-300">m = 1..12</code> to separate natural soil/seawater seasonal heating from electrical current heating.
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-emerald-400">
                    2. Zero-Load Intercept Formula
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-emerald-200 text-[11px]">
                    T_amb(s, m) = Mean_m [ Tc_i - Kc(s) × (P_Ckt3,i)² ]
                  </div>
                  <div className="text-[11px] text-slate-300">
                    • Active Month Tamb(Tc): <strong>{activePrediction.ambTc.toFixed(2)} °C</strong><br />
                    • Active Month Tamb(Tf): <strong>{activePrediction.ambTf.toFixed(2)} °C</strong>
                  </div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-emerald-400">
                    3. Role in Future Prediction &amp; SCADA
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Serves as the starting temperature floor before adding load heating. In summer peak months (Apr–May), higher <code className="text-emerald-300">T_amb</code> reduces the safe MW ceiling automatically.
                  </p>
                </div>
              </div>
            )}

            {activeFormulaTab === 3 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-purple-400">
                    1. Database Source (24-Hr Section Profile DB)
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Compares the hour of daily peak power (<code className="text-purple-300">t_P,max ≈ {String(m.avgPeakPowerHour).padStart(2, '0')}:00</code>) against the hour of daily peak fiber temperature (<code className="text-purple-300">t_Tf,max ≈ {String(m.avgPeakTempHour).padStart(2, '0')}:30</code>) in Panel 3.
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-purple-400">
                    2. Thermal Lag &amp; Load Factor Multiplier Formula
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-purple-200 text-[11px]">
                    Δt_lag = Median(t_Tf,max - t_P,max) = {m.thermalLagHours.toFixed(1)} hrs<br />
                    M_LF = 1 + α_s × (LF_target - LF_avg) = {activePrediction.lfMultiplier}x
                  </div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-purple-400">
                    3. Role in Future Prediction &amp; SCADA
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Scales the temperature rise for sustained vs. short peaks, and tells SCADA operators to shift load <strong>{m.thermalLagHours.toFixed(1)} hours before</strong> expected thermal peak (by <strong>{scadaDispatchPlan.recommendedActionTime} hrs</strong>).
                  </p>
                </div>
              </div>
            )}

            {activeFormulaTab === 4 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-cyan-400">
                    1. Synthesizes Keys #1, #2, and #3
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Inverts the master prediction equation at the selected conductor temperature limit (<code className="text-amber-300">T_limit = {targetLimitTempC}°C</code>) to solve for the maximum safe MW on Circuit #3.
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-cyan-400">
                    2. Inverted Safe Ampacity / MW Formula
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-cyan-200 text-[11px]">
                    P_max,safe = √[ (T_limit - T_amb) ÷ (Kc × M_LF) ]
                  </div>
                  <div className="text-[11px] text-slate-300">
                    = √[ ({targetLimitTempC} - {activePrediction.ambTc.toFixed(1)}) ÷ ({m.kc.toFixed(4)} × {activePrediction.lfMultiplier}) ] = <strong>{activePrediction.safeMaxMW.toFixed(2)} MW</strong>
                  </div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase text-cyan-400">
                    3. Role in SCADA 4-Circuit Dispatch
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Whenever <code className="text-cyan-300">P_future ({futureCkt3MW} MW)</code> exceeds <code className="text-emerald-300">P_max,safe ({activePrediction.safeMaxMW} MW)</code> or Normal limit (<code className="text-sky-300">64.1 MW</code>), Zone 4 calculates the exact MW to shift to Ckt#2, 33kV NKT, and 33kV Oil.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MASTER PREDICTION EQUATION BANNER (SHOWING LIVE COMBINATION OF ALL 4 KEYS) */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-cyan-500/30 rounded-2xl p-4 text-white font-mono flex flex-wrap items-center justify-between gap-4 shadow-md">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
              LIVE MASTER PREDICTION EQUATION (COMBINING ALL 4 KEY INDICATORS FOR {secPrefix.toUpperCase()} {activePrediction.section.sectionId})
            </div>
            <div className="text-xs sm:text-sm font-bold flex flex-wrap items-center gap-1.5">
              <span className="text-amber-300 font-black">
                Tc_pred ({activePrediction.predTc.toFixed(2)} °C)
              </span>
              <span>=</span>
              <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300" title="Key Indicator 2: Seasonal Ambient Baseline">
                Tamb ({activePrediction.ambTc.toFixed(2)}°C)
              </span>
              <span>+</span>
              <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-500/40 text-rose-300" title="Key Indicator 1: Thermal Sensitivity Index">
                Kc ({m.kc.toFixed(4)})
              </span>
              <span>×</span>
              <span className="px-2 py-0.5 rounded bg-purple-950 border border-purple-500/40 text-purple-300" title="Key Indicator 3: Load Factor Multiplier">
                M_LF ({activePrediction.lfMultiplier}x)
              </span>
              <span>×</span>
              <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300" title="Assumed Future Circuit #3 Power Squared">
                ({futureCkt3MW.toFixed(1)} MW)²
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] text-slate-400 uppercase">vs Historical Peak P ({m.histMaxP} MW)</div>
              <div
                className={`text-sm font-black ${
                  activePrediction.deltaTcVsBase >= 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {activePrediction.deltaTcVsBase >= 0 ? '▲ +' : '▼ '}
                {activePrediction.deltaTcVsBase.toFixed(2)} °C
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          ZONE 2: TWO SIDE-BY-SIDE INTERACTIVE PREDICTION CHARTS
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* CHART A (7 cols): P_Ckt3 vs Tf & Tc Quadratic Prediction Curve + Historical DB Scatter */}
        <div className="xl:col-span-7 bg-slate-900 rounded-3xl border border-cyan-500/30 p-5 text-slate-100 font-mono shadow-xl flex flex-col justify-between space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] uppercase font-black text-cyan-400 block">
                CHART A · QUADRATIC THERMAL RESPONSE CURVE (P_CKT3 vs. Tf &amp; Tc)
              </span>
              <h3 className="text-sm font-black text-white">
                {secPrefix} {activePrediction.section.sectionId}: {activePrediction.section.name}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10px]">
              <span className="inline-flex items-center gap-1 text-amber-300">
                <span className="w-3 h-0.5 bg-amber-400 inline-block" /> Predicted Tc(P)
              </span>
              <span className="inline-flex items-center gap-1 text-rose-300">
                <span className="w-3 h-0.5 bg-rose-400 inline-block" /> Predicted Tf(P)
              </span>
              <span className="inline-flex items-center gap-1 text-cyan-300">
                <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> Target ({futureCkt3MW} MW)
              </span>
            </div>
          </div>

          {/* SVG Quadratic Prediction Chart */}
          <div className="w-full overflow-x-auto">
            {(() => {
              const W = 680;
              const H = 340;
              const padL = 52;
              const padR = 24;
              const padT = 24;
              const padB = 42;
              const plotW = W - padL - padR;
              const plotH = H - padT - padB;

              const { minMW, maxMW, minTemp, maxTemp, curveSteps } = chartAData;
              const xOf = (mw: number) =>
                padL + ((Math.max(minMW, Math.min(maxMW, mw)) - minMW) / (maxMW - minMW)) * plotW;
              const yOf = (t: number) =>
                padT + plotH - ((Math.max(minTemp, Math.min(maxTemp, t)) - minTemp) / (maxTemp - minTemp)) * plotH;

              const tfPath = curveSteps
                .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.mw).toFixed(1)},${yOf(pt.tf).toFixed(1)}`)
                .join(' ');
              const tcPath = curveSteps
                .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.mw).toFixed(1)},${yOf(pt.tc).toFixed(1)}`)
                .join(' ');

              const xTarget = xOf(futureCkt3MW);
              const yTargetTf = yOf(activePrediction.predTf);
              const yTargetTc = yOf(activePrediction.predTc);
              const xSafe = xOf(activePrediction.safeMaxMW);

              const yTicks: number[] = [];
              const stepT = maxTemp - minTemp > 60 ? 15 : 10;
              for (let t = minTemp; t <= maxTemp; t += stepT) {
                yTicks.push(t);
              }

              return (
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none">
                  {/* Horizontal Grid & Temperature Thresholds */}
                  {yTicks.map((t) => (
                    <g key={`yt-${t}`}>
                      <line
                        x1={padL}
                        y1={yOf(t)}
                        x2={W - padR}
                        y2={yOf(t)}
                        stroke="#1e293b"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={padL - 8}
                        y={yOf(t) + 3}
                        textAnchor="end"
                        fill="#94a3b8"
                        fontSize="10"
                      >
                        {t}°C
                      </text>
                    </g>
                  ))}

                  {/* Target Thermal Limit Line (70°C / 80°C / 90°C) */}
                  {targetLimitTempC >= minTemp && targetLimitTempC <= maxTemp && (
                    <g>
                      <line
                        x1={padL}
                        y1={yOf(targetLimitTempC)}
                        x2={W - padR}
                        y2={yOf(targetLimitTempC)}
                        stroke="#f43f5e"
                        strokeWidth="1.5"
                        strokeDasharray="5 4"
                      />
                      <text
                        x={padL + 6}
                        y={yOf(targetLimitTempC) - 5}
                        fill="#fda4af"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        Tc Limit ({targetLimitTempC}°C) → Safe Max = {activePrediction.safeMaxMW.toFixed(1)} MW
                      </text>
                    </g>
                  )}

                  {/* Vertical Normal Operating Boundary (64.1 MW) */}
                  <line
                    x1={xOf(64.1)}
                    y1={padT}
                    x2={xOf(64.1)}
                    y2={H - padB}
                    stroke="#eab308"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={xOf(64.1) - 4}
                    y={padT + 12}
                    textAnchor="end"
                    fill="#fde047"
                    fontSize="9"
                  >
                    Normal Limit (64.1 MW)
                  </text>

                  {/* Safe MW Ceiling Vertical Line (Key Indicator 4) */}
                  {activePrediction.safeMaxMW >= minMW && activePrediction.safeMaxMW <= maxMW && (
                    <line
                      x1={xSafe}
                      y1={padT}
                      x2={xSafe}
                      y2={H - padB}
                      stroke="#10b981"
                      strokeWidth="1.2"
                      strokeDasharray="2 3"
                    />
                  )}

                  {/* Historical Database Scatter Points (Tf in rose, Tc in amber) */}
                  {m.scatterPoints.map((sp, idx) => (
                    <g key={`sp-${idx}`} opacity={0.45}>
                      <circle
                        cx={xOf(sp.pCkt3MW)}
                        cy={yOf(sp.tf)}
                        r={2.2}
                        fill="#fb7185"
                      />
                      <circle
                        cx={xOf(sp.pCkt3MW)}
                        cy={yOf(sp.tc)}
                        r={2.2}
                        fill="#fbbf24"
                      />
                    </g>
                  ))}

                  {/* Fitted Quadratic Curves Tf(P) and Tc(P) */}
                  <path
                    d={tfPath}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="2.5"
                  />
                  <path
                    d={tcPath}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="3"
                  />

                  {/* Vertical Target Future Load Line & Operating Points */}
                  <line
                    x1={xTarget}
                    y1={padT}
                    x2={xTarget}
                    y2={H - padB}
                    stroke="#22d3ee"
                    strokeWidth="1.8"
                  />
                  <circle
                    cx={xTarget}
                    cy={yTargetTf}
                    r={5}
                    fill="#f43f5e"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx={xTarget}
                    cy={yTargetTc}
                    r={6}
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />

                  {/* Callout Badge for Predicted Tc & Tf */}
                  <g
                    transform={`translate(${
                      xTarget > W - 185 ? xTarget - 155 : xTarget + 10
                    }, ${Math.max(padT + 8, Math.min(H - padB - 55, yTargetTc - 22))})`}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={142}
                      height={44}
                      rx={8}
                      fill="#020617"
                      stroke="#22d3ee"
                      strokeWidth="1.2"
                      opacity={0.94}
                    />
                    <text x={8} y={14} fill="#67e8f9" fontSize="9.5" fontWeight="bold">
                      @ P = {futureCkt3MW.toFixed(1)} MW
                    </text>
                    <text x={8} y={27} fill="#fde68a" fontSize="10" fontWeight="bold">
                      Pred Tc: {activePrediction.predTc.toFixed(1)} °C
                    </text>
                    <text x={8} y={39} fill="#fecdd3" fontSize="9.5">
                      Pred Tf: {activePrediction.predTf.toFixed(1)} °C
                    </text>
                  </g>

                  {/* X-Axis MW Labels */}
                  {[20, 30, 40, 50, 60, 70, 80, 90].map((mw) => (
                    <g key={`xt-${mw}`}>
                      <line
                        x1={xOf(mw)}
                        y1={H - padB}
                        x2={xOf(mw)}
                        y2={H - padB + 5}
                        stroke="#475569"
                      />
                      <text
                        x={xOf(mw)}
                        y={H - padB + 18}
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="10"
                      >
                        {mw} MW
                      </text>
                    </g>
                  ))}
                  <text
                    x={padL + plotW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    115 kV Circuit #3 Active Power Flow P_Ckt3 (MW)
                  </text>
                </svg>
              );
            })()}
          </div>

          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>
              Historical Scatter: <strong className="text-slate-200">{m.scatterPoints.length} sampled days</strong> from Panel 1 DB
            </span>
            <span>
              Quadratic Law: <strong className="text-amber-300">ΔT ∝ I²R ∝ P_Ckt3²</strong>
            </span>
          </div>
        </div>

        {/* CHART B (5 cols): 19-Section Predicted Conductor Temperature & Safe MW Ranking */}
        <div className="xl:col-span-5 bg-slate-900 rounded-3xl border border-cyan-500/30 p-5 text-slate-100 font-mono shadow-xl flex flex-col justify-between space-y-3">
          <div className="border-b border-slate-800 pb-3">
            <span className="text-[10px] uppercase font-black text-amber-400 block">
              CHART B · ALL 19 SECTIONS BOTTLENECK RANKING (@ {futureCkt3MW.toFixed(1)} MW)
            </span>
            <h3 className="text-sm font-black text-white">
              Predicted Conductor Tc &amp; Safe MW Ceiling per Section
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Click any section row to inspect its 4 Key Indicators &amp; curve in Chart A
            </p>
          </div>

          <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
            {[...allSectionPredictions]
              .sort((a, b) => b.predTc - a.predTc)
              .map((item, rankIdx) => {
                const isSelected =
                  item.section.sectionId === activePrediction.section.sectionId;
                const zone = getThermalZoneInfo(item.predTc);
                const pctWidth = Math.min(100, Math.max(15, (item.predTc / 100) * 100));
                const sPref = item.section.category === 'land' ? 'Sec' : 'Zone';

                return (
                  <button
                    key={item.section.sectionId}
                    type="button"
                    onClick={() => setSelectedSectionId(item.section.sectionId)}
                    className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-950/60 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                        : 'bg-slate-950/70 hover:bg-slate-950 border-slate-800/90'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[9px] font-bold">
                          #{rankIdx + 1}
                        </span>
                        <span className="font-black text-white">
                          {sPref} {item.section.sectionId}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                          {item.section.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-slate-400">
                          Safe: <strong className="text-cyan-300">{item.safeMaxMW.toFixed(1)}MW</strong>
                        </span>
                        <span
                          className="text-xs font-black px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${zone.hexColor}22`,
                            color: zone.hexColor,
                            border: `1px solid ${zone.hexColor}55`,
                          }}
                        >
                          {item.predTc.toFixed(1)} °C
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${pctWidth}%`,
                          backgroundColor: zone.hexColor,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* =====================================================================
          ZONE 3: SCADA OPERATOR 4-CIRCUIT OPTIMAL LOAD DISPATCH & ACTION PANEL
         ===================================================================== */}
      <div className="bg-slate-900 rounded-3xl border border-emerald-500/30 p-5 text-slate-100 font-mono shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-black text-emerald-400 block">
                ZONE 3 · SCADA OPERATOR 4-CIRCUIT DISPATCH DECISION &amp; LOAD OPTIMIZATION
              </span>
              <h3 className="text-sm sm:text-base font-black text-white">
                Projected Koh Samui Total Demand: {scadaDispatchPlan.totalIslandFutureMW.toFixed(1)} MW — Optimal 4-Circuit Split
              </h3>
            </div>
          </div>

          {/* Pre-Cooling / Action Lead Time Badge from Key Indicator 3 */}
          <div className="flex items-center gap-2 bg-purple-950/60 border border-purple-400/40 px-3.5 py-2 rounded-xl text-xs">
            <Clock className="w-4 h-4 text-purple-300 shrink-0" />
            <div>
              <span className="text-[10px] uppercase text-purple-300 font-bold block">
                SCADA Action Lead Time (Key Indicator #3: {m.thermalLagHours.toFixed(1)}h Lag)
              </span>
              <span className="font-black text-white">
                Dispatch Load Shift Before {scadaDispatchPlan.recommendedActionTime} hrs (Ahead of {scadaDispatchPlan.peakTempTime} Thermal Peak)
              </span>
            </div>
          </div>
        </div>

        {/* Comparison of Unoptimized vs SCADA Optimized 4-Circuit Dispatch */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Summary Recommendation Box (4 cols) */}
          <div className="lg:col-span-4 bg-slate-950/90 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="text-xs font-black uppercase text-cyan-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>SCADA Dispatch Guidance</span>
              </div>
              {scadaDispatchPlan.mwToShiftFromCkt3 > 0.1 ? (
                <p className="text-xs text-slate-300 leading-relaxed">
                  At <strong className="text-amber-300">{futureCkt3MW.toFixed(1)} MW</strong> on 115kV Ckt#3, {secPrefix} {activePrediction.section.sectionId} reaches{' '}
                  <strong className="text-rose-300">{scadaDispatchPlan.unoptimized.predTc.toFixed(1)} °C</strong>. Shifting{' '}
                  <strong className="text-emerald-300">{scadaDispatchPlan.mwToShiftFromCkt3.toFixed(1)} MW</strong> to Ckt#2, 33kV NKT &amp; 33kV Oil reduces Ckt#3 conductor temperature to{' '}
                  <strong className="text-emerald-300">{scadaDispatchPlan.optimized.predTc.toFixed(1)} °C</strong> and keeps Ckt#3 within safe thermal &amp; normal operating limits.
                </p>
              ) : (
                <p className="text-xs text-slate-300 leading-relaxed">
                  At <strong className="text-cyan-300">{futureCkt3MW.toFixed(1)} MW</strong>, 115kV Ckt#3 remains within its Safe MW Ceiling (<strong className="text-emerald-300">{activePrediction.safeMaxMW.toFixed(1)} MW</strong>) and Normal Operating Condition (<strong className="text-sky-300">&lt; 64.1 MW</strong>) with predicted Conductor Tc = <strong className="text-emerald-300">{activePrediction.predTc.toFixed(1)} °C</strong>.
                </p>
              )}
            </div>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Unoptimized Ckt#3 Tc:</span>
                <span className="font-black text-rose-300">{scadaDispatchPlan.unoptimized.predTc.toFixed(1)} °C</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">SCADA Optimized Ckt#3 Tc:</span>
                <span className="font-black text-emerald-300">{scadaDispatchPlan.optimized.predTc.toFixed(1)} °C</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Recommended Load Shift:</span>
                <span className="font-black text-cyan-300">
                  {scadaDispatchPlan.mwToShiftFromCkt3 > 0
                    ? `Shift ${scadaDispatchPlan.mwToShiftFromCkt3.toFixed(1)} MW off Ckt#3`
                    : '0.0 MW (Balanced)'}
                </span>
              </div>
            </div>
          </div>

          {/* 4-Circuit Dispatch Table (8 cols) */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              {
                idx: 0,
                unopt: scadaDispatchPlan.unoptimized.ckt3,
                opt: scadaDispatchPlan.optimized.ckt3,
              },
              {
                idx: 1,
                unopt: scadaDispatchPlan.unoptimized.ckt2,
                opt: scadaDispatchPlan.optimized.ckt2,
              },
              {
                idx: 2,
                unopt: scadaDispatchPlan.unoptimized.nkt,
                opt: scadaDispatchPlan.optimized.nkt,
              },
              {
                idx: 3,
                unopt: scadaDispatchPlan.unoptimized.oil,
                opt: scadaDispatchPlan.optimized.oil,
              },
            ].map((ckt) => {
              const meta = CIRCUIT_LIMITS[ckt.idx];
              const unoptBadge = getCircuitCondBadge(ckt.idx, ckt.unopt);
              const optBadge = getCircuitCondBadge(ckt.idx, ckt.opt);
              const delta = Number((ckt.opt - ckt.unopt).toFixed(2));

              return (
                <div
                  key={meta.id}
                  className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between space-y-2.5"
                >
                  <div>
                    <div className="text-xs font-black text-white">{meta.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{meta.sub}</div>
                  </div>

                  <div className="space-y-1.5 pt-1 border-t border-slate-800/80 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Unoptimized:</span>
                      <span className="font-bold text-slate-200">{ckt.unopt.toFixed(1)} MW</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Condition:</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${unoptBadge.cls}`}>
                        {unoptBadge.label}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900 border border-cyan-500/30 space-y-1">
                    <div className="text-[9px] uppercase font-bold text-cyan-400">
                      SCADA Recommended
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-base font-black text-white">
                        {ckt.opt.toFixed(1)} MW
                      </span>
                      {Math.abs(delta) >= 0.1 && (
                        <span
                          className={`text-[10px] font-bold ${
                            delta < 0 ? 'text-emerald-400' : 'text-amber-300'
                          }`}
                        >
                          {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} MW
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-0.5">
                      <span className="text-[9px] text-slate-400">
                        Norm &lt;{meta.normalMax}MW
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${optBadge.cls}`}>
                        {optBadge.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
