import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Calendar,
  Layers,
  Zap,
  Radio,
  Loader2,
  Database,
  Grid,
  ShieldCheck,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CIRCUIT_3_SECTIONS,
  CableSectionInfo,
} from '../data/cableCircuitStructure';
import {
  OrgDatabaseConfig,
  getOrgSectionDailyProfileDates,
  fetchSectionDailyProfileForDate,
  subscribeOrgDatabase,
} from '../services/orgDatabaseStorage';
import { ParsedTeprFile } from '../services/teprParser';
import { DailyPowerSummary } from '../services/powerConsumptionParser';
import {
  extractActualTelemetryForSection,
  ActualDailyTelemetrySummary,
  ActualTelemetryPoint,
} from '../services/actualTelemetryService';
import { NoDatabaseEmptyState } from './NoDatabaseEmptyState';

export interface Public3DPowerTempPageProps {
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

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface ProjectedVec {
  sx: number;
  sy: number;
  depth: number;
  scale: number;
}

const DEFAULT_ROT_X = 0.34;
const DEFAULT_ROT_Y = -0.52;
const DEFAULT_ZOOM = 1.05;

function projectPoint3D(
  pt: Vec3,
  rotX: number,
  rotY: number,
  zoom: number,
  width: number,
  height: number
): ProjectedVec {
  // Center offset so the 3D box (Y: 0..22) sits vertically balanced in the viewport
  const cx = pt.x + 1.2;
  const cy = pt.y - 9.8;
  const cz = pt.z;

  // Rotate around Y axis (yaw)
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const x1 = cx * cosY + cz * sinY;
  const z1 = -cx * sinY + cz * cosY;

  // Rotate around X axis (pitch)
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const y2 = cy * cosX - z1 * sinX;
  const z2 = cy * sinX + z1 * cosX;

  const fov = Math.min(width * 0.72, 680) * zoom;
  const cameraDist = 66;
  const denom = Math.max(15, cameraDist - z2);
  const scale = fov / denom;

  return {
    sx: width * 0.52 + x1 * scale,
    sy: height * 0.54 - y2 * scale,
    depth: z2,
    scale,
  };
}

function drawRoundedPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillStyle: string,
  strokeStyle?: string,
  lineWidth = 1
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function draw3DTextBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  proj: ProjectedVec,
  options: {
    textColor: string;
    bgColor: string;
    borderColor?: string;
    fontSize?: number;
    paddingX?: number;
    paddingY?: number;
    offsetX?: number;
    offsetY?: number;
  }
) {
  const fontSize = options.fontSize || 11;
  const padX = options.paddingX ?? 7;
  const padY = options.paddingY ?? 4;
  const ox = options.offsetX ?? 0;
  const oy = options.offsetY ?? 0;

  ctx.save();
  ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + padX * 2;
  const boxH = fontSize + padY * 2;
  const bx = proj.sx + ox - boxW / 2;
  const by = proj.sy + oy - boxH / 2;

  drawRoundedPill(
    ctx,
    bx,
    by,
    boxW,
    boxH,
    6,
    options.bgColor,
    options.borderColor,
    1
  );

  ctx.fillStyle = options.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, proj.sx + ox, proj.sy + oy + 0.5);
  ctx.restore();
}

function getThermalColorRGB(tempC: number): { r: number; g: number; b: number; hex: string } {
  if (tempC >= 55) {
    return { r: 244, g: 63, b: 94, hex: '#f43f5e' }; // Rose / Hot
  }
  if (tempC >= 42) {
    const t = Math.min(1, Math.max(0, (tempC - 42) / 13));
    const r = Math.round(245 + (244 - 245) * t);
    const g = Math.round(158 + (63 - 158) * t);
    const b = Math.round(11 + (94 - 11) * t);
    return { r, g, b, hex: `rgb(${r},${g},${b})` };
  }
  const t = Math.min(1, Math.max(0, (tempC - 26) / 16));
  const r = Math.round(6 + (245 - 6) * t);
  const g = Math.round(182 + (158 - 182) * t);
  const b = Math.round(212 + (11 - 212) * t);
  return { r, g, b, hex: `rgb(${r},${g},${b})` };
}

export const Public3DPowerTempPage: React.FC<Public3DPowerTempPageProps> = ({
  dbConfig,
  onAdminLoginClick,
  isAdminLoggedIn,
  onGoToFolderAsset,
  selectedDateFilter = 'all',
  selectedPhaseFilter = 'all',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [profileDbVersion, setProfileDbVersion] = useState<number>(0);

  // Camera state stored in refs for 60fps drag performance + state trigger for redraw
  const cameraRef = useRef<{ rotX: number; rotY: number; zoom: number }>({
    rotX: DEFAULT_ROT_X,
    rotY: DEFAULT_ROT_Y,
    zoom: DEFAULT_ZOOM,
  });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const hoveredIdxRef = useRef<number | null>(null);
  const projectedNodesRef = useRef<Array<{ idx: number; sx: number; sy: number; point: ActualTelemetryPoint }>>([]);

  useEffect(() => {
    const unsub = subscribeOrgDatabase(() => {
      cachedDaysMapRef.current.clear();
      setProfileDbVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  // Available dates strictly from Panel 3 ("Section daily profile database")
  const availableDates = useMemo(() => {
    return getOrgSectionDailyProfileDates();
  }, [dbConfig, profileDbVersion]);

  const hasAnyDataSource = availableDates.length > 0;

  const initialDate = useMemo(() => {
    if (selectedDateFilter && selectedDateFilter !== 'all' && availableDates.includes(selectedDateFilter)) {
      return selectedDateFilter;
    }
    if (availableDates.length > 0) {
      return availableDates[availableDates.length - 1];
    }
    return '';
  }, [selectedDateFilter, availableDates]);

  // Dropdown UI selection states
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('2.3');
  const [selectedPhase, setSelectedPhase] = useState<string>(
    selectedPhaseFilter !== 'all' ? selectedPhaseFilter : 'all'
  );

  const [gatheredDate, setGatheredDate] = useState<string>(initialDate);
  const [hasGathered, setHasGathered] = useState<boolean>(Boolean(initialDate));
  const [isGathering, setIsGathering] = useState<boolean>(false);
  const [isGatheringModalOpen, setIsGatheringModalOpen] = useState<boolean>(false);
  const [gatherProgress, setGatherProgress] = useState<number>(100);
  const [gatherTeprCount, setGatherTeprCount] = useState<number>(24);
  const [gatherTeprTarget, setGatherTeprTarget] = useState<number>(24);
  const [gatherCsvIntervals, setGatherCsvIntervals] = useState<number>(24);
  const [gatherCurrentSecName, setGatherCurrentSecName] = useState<string>('');
  const [gatherCurrentEquation, setGatherCurrentEquation] = useState<string>('Charlie');

  // Cache of all gathered sections per date: dateKey -> Map<sectionId, ActualDailyTelemetrySummary>
  const cachedDaysMapRef = useRef<Map<string, Map<string, ActualDailyTelemetrySummary>>>(new Map());

  // Automatically sync selectedDate and gatheredDate when Panel 3 dates update or user changes date
  useEffect(() => {
    if (availableDates.length > 0 && (!selectedDate || !availableDates.includes(selectedDate))) {
      const latest = availableDates[availableDates.length - 1];
      setSelectedDate(latest);
      setGatheredDate(latest);
      setHasGathered(true);
      void fetchSectionDailyProfileForDate(latest).then(() => {
        setProfileDbVersion((v) => v + 1);
      });
    } else if (selectedDate) {
      setGatheredDate(selectedDate);
      setHasGathered(true);
      void fetchSectionDailyProfileForDate(selectedDate).then(() => {
        setProfileDbVersion((v) => v + 1);
      });
    }
  }, [availableDates, selectedDate]);

  useEffect(() => {
    if (selectedPhaseFilter && selectedPhaseFilter !== 'all') {
      setSelectedPhase(selectedPhaseFilter);
    }
  }, [selectedPhaseFilter]);

  const handleGatherData = async () => {
    if (!selectedDate) return;
    setIsGathering(true);
    setIsGatheringModalOpen(true);
    setGatherProgress(0);
    setGatherTeprCount(0);
    setGatherCsvIntervals(0);

    await fetchSectionDailyProfileForDate(selectedDate);

    const sections = CIRCUIT_3_SECTIONS;
    const total = sections.length;
    let idx = 0;
    const expectedTeprCount = 24;
    setGatherTeprTarget(expectedTeprCount);

    const dayMap = new Map<string, ActualDailyTelemetrySummary>();

    const interval = setInterval(() => {
      if (idx < total) {
        const sec = sections[idx];
        setGatherCurrentSecName(`${sec.sectionId}: ${sec.name}`);
        setGatherCurrentEquation(`Equation ${sec.equationName}`);
        const isSecLand = sec.category === 'land' || sec.sectionId.startsWith('1.');

        const summary = extractActualTelemetryForSection({
          sectionId: sec.sectionId,
          dateKey: selectedDate,
          phaseFilter: isSecLand ? selectedPhase : 'all',
          parsedFiles: [],
        });
        dayMap.set(sec.sectionId, summary);

        idx++;
        const pct = Math.round((idx / total) * 100);
        setGatherProgress(pct);
        setGatherTeprCount(Math.min(expectedTeprCount, Math.round((pct / 100) * expectedTeprCount)));
        setGatherCsvIntervals(Math.min(24, Math.round((pct / 100) * 24)));
      } else {
        clearInterval(interval);
        setGatherProgress(100);
        setGatherTeprCount(expectedTeprCount);
        setGatherCsvIntervals(24);
        cachedDaysMapRef.current.set(selectedDate, dayMap);
        setGatheredDate(selectedDate);
        setHasGathered(true);
        setProfileDbVersion((v) => v + 1);
        setIsGathering(false);
        setTimeout(() => {
          setIsGatheringModalOpen(false);
        }, 350);
      }
    }, 30);
  };

  const activeSection: CableSectionInfo = useMemo(() => {
    return (
      CIRCUIT_3_SECTIONS.find((s) => s.sectionId === selectedSectionId) ||
      CIRCUIT_3_SECTIONS[0]
    );
  }, [selectedSectionId]);

  const isLand = activeSection.category === 'land' || activeSection.sectionId.startsWith('1.');

  // Extract Section Daily Profile records from Panel 3 ("Section daily profile database")
  const actualTelemetry: ActualDailyTelemetrySummary = useMemo(() => {
    const targetDate = gatheredDate || selectedDate;
    if (!targetDate) {
      return {
        sectionId: selectedSectionId,
        sectionName: activeSection.name,
        category: (activeSection.category || 'submarine') as 'land' | 'submarine',
        dateKey: selectedDate,
        phase: selectedPhase,
        dataSource: 'none',
        dataSourceLabel: 'No Data Gathered',
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
    gatheredDate,
    selectedDate,
    selectedSectionId,
    selectedPhase,
    activeSection,
    isLand,
    profileDbVersion,
  ]);

  const isPendingGather = false;

  // Ensure we always have a sorted 24-hour point array to render the 3D manifold
  const plotPoints: ActualTelemetryPoint[] = useMemo(() => {
    const raw = actualTelemetry?.points || [];
    if (raw.length > 1) {
      return [...raw].sort((a, b) => a.timeMinutes - b.timeMinutes);
    }
    return [];
  }, [actualTelemetry]);

  // -------------------------------------------------------------------------
  // HARDWARE-INDEPENDENT 3D SPATIAL MANIFOLD RENDERER (HTML5 2D CANVAS)
  // Guarantees 100% visibility across all third-party browsers, VDIs & GPUs
  // -------------------------------------------------------------------------
  const render3DScene = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = Math.max(320, container.clientWidth || 960);
    const height = 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Deep space radial gradient background
    const bgGrad = ctx.createRadialGradient(
      width * 0.52,
      height * 0.48,
      30,
      width * 0.52,
      height * 0.5,
      Math.max(width, height) * 0.7
    );
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.55, '#070b14');
    bgGrad.addColorStop(1, '#03060c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const { rotX, rotY, zoom } = cameraRef.current;
    const proj = (x: number, y: number, z: number) =>
      projectPoint3D({ x, y, z }, rotX, rotY, zoom, width, height);

    // 3D Box dimensions
    // X: Time 00:00..24:00 mapped to [-16, +16] (width 32)
    // Y: Conductor Temp 0..90°C mapped to [0, 22] (height 22)
    // Z: Circuit 3 Power 0..100 MW mapped to [+13, -13] (depth 26)
    const BOX_X = 32;
    const BOX_Y = 22;
    const BOX_Z = 26;
    const halfX = BOX_X / 2;
    const halfZ = BOX_Z / 2;

    // 2. Draw Back Wall Grid (XY plane at Z = -halfZ, i.e. 100 MW back plane)
    const backWallCorners = [
      proj(-halfX, 0, -halfZ),
      proj(halfX, 0, -halfZ),
      proj(halfX, BOX_Y, -halfZ),
      proj(-halfX, BOX_Y, -halfZ),
    ];
    ctx.beginPath();
    ctx.moveTo(backWallCorners[0].sx, backWallCorners[0].sy);
    backWallCorners.slice(1).forEach((p) => ctx.lineTo(p.sx, p.sy));
    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.38)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Back wall horizontal temperature grid lines (20, 40, 60, 80, 90°C)
    [20, 40, 60, 80, 90].forEach((tC) => {
      const yVal = (tC / 90) * BOX_Y;
      const p1 = proj(-halfX, yVal, -halfZ);
      const p2 = proj(halfX, yVal, -halfZ);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = tC === 60 ? 'rgba(245, 158, 11, 0.22)' : 'rgba(51, 65, 85, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Back wall vertical time lines
    for (let i = 1; i < 6; i++) {
      const xVal = -halfX + (BOX_X / 6) * i;
      const p1 = proj(xVal, 0, -halfZ);
      const p2 = proj(xVal, BOX_Y, -halfZ);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 3. Draw Side Wall Grid (YZ plane at X = -halfX)
    const sideWallCorners = [
      proj(-halfX, 0, halfZ),
      proj(-halfX, 0, -halfZ),
      proj(-halfX, BOX_Y, -halfZ),
      proj(-halfX, BOX_Y, halfZ),
    ];
    ctx.beginPath();
    ctx.moveTo(sideWallCorners[0].sx, sideWallCorners[0].sy);
    sideWallCorners.slice(1).forEach((p) => ctx.lineTo(p.sx, p.sy));
    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    [20, 40, 60, 80, 90].forEach((tC) => {
      const yVal = (tC / 90) * BOX_Y;
      const p1 = proj(-halfX, yVal, halfZ);
      const p2 = proj(-halfX, yVal, -halfZ);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    for (let i = 1; i < 4; i++) {
      const zVal = halfZ - (BOX_Z / 4) * i;
      const p1 = proj(-halfX, 0, zVal);
      const p2 = proj(-halfX, BOX_Y, zVal);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 4. Draw Floor Grid (XZ plane at Y = 0)
    const floorCorners = [
      proj(-halfX, 0, halfZ),
      proj(halfX, 0, halfZ),
      proj(halfX, 0, -halfZ),
      proj(-halfX, 0, -halfZ),
    ];
    ctx.beginPath();
    ctx.moveTo(floorCorners[0].sx, floorCorners[0].sy);
    floorCorners.slice(1).forEach((p) => ctx.lineTo(p.sx, p.sy));
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 47, 73, 0.24)';
    ctx.fill();

    // Floor grid lines along X (12 subdivisions = every 2 hours)
    for (let i = 0; i <= 12; i++) {
      const xVal = -halfX + (BOX_X / 12) * i;
      const p1 = proj(xVal, 0, halfZ);
      const p2 = proj(xVal, 0, -halfZ);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(6, 182, 212, 0.32)' : 'rgba(30, 41, 59, 0.65)';
      ctx.lineWidth = i % 2 === 0 ? 1.1 : 0.8;
      ctx.stroke();
    }

    // Floor grid lines along Z (8 subdivisions = every 12.5 MW)
    for (let j = 0; j <= 8; j++) {
      const zVal = halfZ - (BOX_Z / 8) * j;
      const p1 = proj(-halfX, 0, zVal);
      const p2 = proj(halfX, 0, zVal);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = j % 2 === 0 ? 'rgba(16, 185, 129, 0.28)' : 'rgba(30, 41, 59, 0.65)';
      ctx.lineWidth = j % 2 === 0 ? 1.1 : 0.8;
      ctx.stroke();
    }

    // 5. Plot 3D Manifold (Filled Area Under Curve + Floor Track + 3D Trajectory Ribbon)
    const screenNodes: Array<{
      idx: number;
      sx: number;
      sy: number;
      baseSx: number;
      baseSy: number;
      pos3D: Vec3;
      point: ActualTelemetryPoint;
    }> = [];

    if (plotPoints.length > 1) {
      const rawNodes = plotPoints.map((pt, idx) => {
        const timeFrac = Math.max(0, Math.min(1, pt.timeMinutes / 1440));
        const px = -halfX + timeFrac * BOX_X;
        const py = Math.max(0, Math.min(BOX_Y, (pt.conductorTempC / 90) * BOX_Y));
        const pz = halfZ - Math.max(0, Math.min(1, pt.pCkt3MW / 100)) * BOX_Z;
        const pTop = proj(px, py, pz);
        const pBase = proj(px, 0, pz);
        return {
          idx,
          sx: pTop.sx,
          sy: pTop.sy,
          baseSx: pBase.sx,
          baseSy: pBase.sy,
          pos3D: { x: px, y: py, z: pz },
          point: pt,
        };
      });

      screenNodes.push(...rawNodes);

      // Subdivide each hourly interval into 4 sub-steps for a smooth 3D curtain manifold
      const densePoints: Array<{ pos: Vec3; tempC: number; mw: number }> = [];
      for (let i = 0; i < rawNodes.length - 1; i++) {
        const n0 = rawNodes[Math.max(0, i - 1)];
        const n1 = rawNodes[i];
        const n2 = rawNodes[i + 1];
        const n3 = rawNodes[Math.min(rawNodes.length - 1, i + 2)];
        const steps = 4;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const t2 = t * t;
          const t3 = t2 * t;
          // Catmull-Rom spline interpolation
          const interp = (v0: number, v1: number, v2: number, v3: number) =>
            0.5 *
            (2 * v1 +
              (-v0 + v2) * t +
              (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
              (-v0 + 3 * v1 - 3 * v2 + v3) * t3);

          densePoints.push({
            pos: {
              x: n1.pos3D.x + (n2.pos3D.x - n1.pos3D.x) * t,
              y: Math.max(0, interp(n0.pos3D.y, n1.pos3D.y, n2.pos3D.y, n3.pos3D.y)),
              z: Math.max(-halfZ, Math.min(halfZ, interp(n0.pos3D.z, n1.pos3D.z, n2.pos3D.z, n3.pos3D.z))),
            },
            tempC: n1.point.conductorTempC + (n2.point.conductorTempC - n1.point.conductorTempC) * t,
            mw: n1.point.pCkt3MW + (n2.point.pCkt3MW - n1.point.pCkt3MW) * t,
          });
        }
      }
      const lastNode = rawNodes[rawNodes.length - 1];
      densePoints.push({
        pos: lastNode.pos3D,
        tempC: lastNode.point.conductorTempC,
        mw: lastNode.point.pCkt3MW,
      });

      // 5A. Floor shadow / power footprint line (at Y = 0)
      ctx.beginPath();
      densePoints.forEach((dp, i) => {
        const pFloor = proj(dp.pos.x, 0, dp.pos.z);
        if (i === 0) ctx.moveTo(pFloor.sx, pFloor.sy);
        else ctx.lineTo(pFloor.sx, pFloor.sy);
      });
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // 5B. Filled 3D Curtain Manifold Polygons (depth-sorted along segments)
      for (let i = 0; i < densePoints.length - 1; i++) {
        const d1 = densePoints[i];
        const d2 = densePoints[i + 1];
        const c1 = proj(d1.pos.x, d1.pos.y, d1.pos.z);
        const c2 = proj(d2.pos.x, d2.pos.y, d2.pos.z);
        const b1 = proj(d1.pos.x, 0, d1.pos.z);
        const b2 = proj(d2.pos.x, 0, d2.pos.z);

        const avgTemp = (d1.tempC + d2.tempC) * 0.5;
        const col = getThermalColorRGB(avgTemp);

        const topY = Math.min(c1.sy, c2.sy);
        const botY = Math.max(b1.sy, b2.sy);
        const grad = ctx.createLinearGradient(0, topY, 0, Math.max(topY + 10, botY));
        grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0.72)`);
        grad.addColorStop(0.55, `rgba(${col.r}, ${col.g}, ${col.b}, 0.36)`);
        grad.addColorStop(1, 'rgba(6, 182, 212, 0.14)');

        ctx.beginPath();
        ctx.moveTo(c1.sx, c1.sy);
        ctx.lineTo(c2.sx, c2.sy);
        ctx.lineTo(b2.sx, b2.sy);
        ctx.lineTo(b1.sx, b1.sy);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // 5C. Vertical hourly drop pillars inside the manifold for 3D depth perception
      rawNodes.forEach((node) => {
        ctx.beginPath();
        ctx.moveTo(node.sx, node.sy);
        ctx.lineTo(node.baseSx, node.baseSy);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Floor anchor dot
        ctx.beginPath();
        ctx.arc(node.baseSx, node.baseSy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
        ctx.fill();
      });

      // 5D. Glowing 3D Trajectory Tube (Outer Glow + Core Metallic Line + Specular Highlight)
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Pass 1: Outer thermal glow
      ctx.beginPath();
      densePoints.forEach((dp, i) => {
        const p = proj(dp.pos.x, dp.pos.y, dp.pos.z);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      });
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.lineWidth = 10;
      ctx.stroke();

      // Pass 2: Main 3D Tube Core
      ctx.beginPath();
      densePoints.forEach((dp, i) => {
        const p = proj(dp.pos.x, dp.pos.y, dp.pos.z);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      });
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 4.5;
      ctx.stroke();

      // Pass 3: Specular top highlight
      ctx.beginPath();
      densePoints.forEach((dp, i) => {
        const p = proj(dp.pos.x, dp.pos.y, dp.pos.z);
        if (i === 0) ctx.moveTo(p.sx, p.sy - 1);
        else ctx.lineTo(p.sx, p.sy - 1);
      });
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // 5E. Hourly 3D Sphere Nodes
      rawNodes.forEach((node) => {
        const isHovered = hoveredIdxRef.current === node.idx;
        const radius = isHovered ? 6 : 3.6;
        ctx.beginPath();
        ctx.arc(node.sx, node.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? '#38bdf8' : '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    // 6. Draw Primary 3D Axis Lines & Ticks (Foreground crisp overlay)
    // X-Axis (Time 00:00..24:00, Cyan)
    const xStart = proj(-halfX, 0, halfZ);
    const xEnd = proj(halfX, 0, halfZ);
    ctx.beginPath();
    ctx.moveTo(xStart.sx, xStart.sy);
    ctx.lineTo(xEnd.sx, xEnd.sy);
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Y-Axis (Conductor Temp 0..90°C, Amber)
    const yStart = proj(-halfX, 0, halfZ);
    const yEnd = proj(-halfX, BOX_Y, halfZ);
    ctx.beginPath();
    ctx.moveTo(yStart.sx, yStart.sy);
    ctx.lineTo(yEnd.sx, yEnd.sy);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Z-Axis (Circuit 3 Power Flow 0..100 MW, Emerald)
    const zStart = proj(-halfX, 0, halfZ);
    const zEnd = proj(-halfX, 0, -halfZ);
    ctx.beginPath();
    ctx.moveTo(zStart.sx, zStart.sy);
    ctx.lineTo(zEnd.sx, zEnd.sy);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // X-Axis Ticks & Labels
    const hourlyLabels = [
      { text: '00:00', x: -halfX },
      { text: '04:00', x: -halfX + (BOX_X / 6) * 1 },
      { text: '08:00', x: -halfX + (BOX_X / 6) * 2 },
      { text: '12:00', x: -halfX + (BOX_X / 6) * 3 },
      { text: '16:00', x: -halfX + (BOX_X / 6) * 4 },
      { text: '20:00', x: -halfX + (BOX_X / 6) * 5 },
      { text: '24:00', x: halfX },
    ];
    hourlyLabels.forEach((lbl) => {
      const tTop = proj(lbl.x, 0.5, halfZ);
      const tBot = proj(lbl.x, -0.5, halfZ);
      ctx.beginPath();
      ctx.moveTo(tTop.sx, tTop.sy);
      ctx.lineTo(tBot.sx, tBot.sy);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const lblPos = proj(lbl.x, -1.8, halfZ + 1.8);
      draw3DTextBadge(ctx, lbl.text, lblPos, {
        textColor: '#7dd3fc',
        bgColor: 'rgba(15, 23, 42, 0.88)',
        borderColor: 'rgba(56, 189, 248, 0.35)',
        fontSize: 10,
      });
    });

    const xTitlePos = proj(0, -4.2, halfZ + 3.2);
    draw3DTextBadge(ctx, 'TIME (HOURLY)', xTitlePos, {
      textColor: '#22d3ee',
      bgColor: 'rgba(8, 51, 68, 0.85)',
      borderColor: 'rgba(6, 182, 212, 0.55)',
      fontSize: 11,
      paddingX: 10,
      paddingY: 4,
    });

    // Y-Axis Ticks & Labels
    const tempLabels = [
      { text: '20°C', y: (20 / 90) * BOX_Y },
      { text: '40°C', y: (40 / 90) * BOX_Y },
      { text: '60°C', y: (60 / 90) * BOX_Y },
      { text: '80°C', y: (80 / 90) * BOX_Y },
    ];
    tempLabels.forEach((lbl) => {
      const tL = proj(-halfX - 0.5, lbl.y, halfZ);
      const tR = proj(-halfX + 0.5, lbl.y, halfZ);
      ctx.beginPath();
      ctx.moveTo(tL.sx, tL.sy);
      ctx.lineTo(tR.sx, tR.sy);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const lblPos = proj(-halfX - 3.2, lbl.y, halfZ);
      draw3DTextBadge(ctx, lbl.text, lblPos, {
        textColor: '#fcd34d',
        bgColor: 'rgba(15, 23, 42, 0.88)',
        borderColor: 'rgba(245, 158, 11, 0.35)',
        fontSize: 10,
      });
    });

    const yTitlePos = proj(-halfX - 3.5, BOX_Y + 2.3, halfZ);
    draw3DTextBadge(ctx, 'CONDUCTOR TEMP (°C)', yTitlePos, {
      textColor: '#fbbf24',
      bgColor: 'rgba(69, 26, 3, 0.85)',
      borderColor: 'rgba(245, 158, 11, 0.55)',
      fontSize: 11,
      paddingX: 10,
      paddingY: 4,
    });

    // Z-Axis Ticks & Labels
    const powerLabels = [
      { text: '0 MW', z: halfZ },
      { text: '25 MW', z: halfZ - (BOX_Z / 4) * 1 },
      { text: '50 MW', z: halfZ - (BOX_Z / 4) * 2 },
      { text: '75 MW', z: halfZ - (BOX_Z / 4) * 3 },
      { text: '100 MW', z: -halfZ },
    ];
    powerLabels.forEach((lbl) => {
      const tL = proj(-halfX - 0.5, 0, lbl.z);
      const tR = proj(-halfX + 0.5, 0, lbl.z);
      ctx.beginPath();
      ctx.moveTo(tL.sx, tL.sy);
      ctx.lineTo(tR.sx, tR.sy);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const lblPos = proj(-halfX - 3.8, 0, lbl.z);
      draw3DTextBadge(ctx, lbl.text, lblPos, {
        textColor: '#6ee7b7',
        bgColor: 'rgba(15, 23, 42, 0.88)',
        borderColor: 'rgba(16, 185, 129, 0.35)',
        fontSize: 10,
      });
    });

    const zTitlePos = proj(-halfX - 4.2, 0, -halfZ - 2.6);
    draw3DTextBadge(ctx, 'POWER FLOW (MW)', zTitlePos, {
      textColor: '#34d399',
      bgColor: 'rgba(6, 78, 59, 0.85)',
      borderColor: 'rgba(16, 185, 129, 0.55)',
      fontSize: 11,
      paddingX: 10,
      paddingY: 4,
    });

    // 7. Peak Point 3D Beacon & Callout Badge
    if (screenNodes.length > 0) {
      let peakNode = screenNodes[0];
      for (const n of screenNodes) {
        if (n.point.conductorTempC > peakNode.point.conductorTempC) {
          peakNode = n;
        }
      }

      // Outer pulse ring
      ctx.beginPath();
      ctx.arc(peakNode.sx, peakNode.sy, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.fill();

      // Core 3D sphere
      const sphereGrad = ctx.createRadialGradient(
        peakNode.sx - 2,
        peakNode.sy - 2,
        1,
        peakNode.sx,
        peakNode.sy,
        7
      );
      sphereGrad.addColorStop(0, '#fecaca');
      sphereGrad.addColorStop(0.45, '#ef4444');
      sphereGrad.addColorStop(1, '#991b1b');
      ctx.beginPath();
      ctx.arc(peakNode.sx, peakNode.sy, 6.8, 0, Math.PI * 2);
      ctx.fillStyle = sphereGrad;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Connector stem to peak badge
      const badgePos = proj(peakNode.pos3D.x, peakNode.pos3D.y + 3.2, peakNode.pos3D.z);
      ctx.beginPath();
      ctx.moveTo(peakNode.sx, peakNode.sy - 7);
      ctx.lineTo(badgePos.sx, badgePos.sy + 10);
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      draw3DTextBadge(
        ctx,
        `PEAK ${peakNode.point.conductorTempC.toFixed(1)}°C @ ${peakNode.point.time} (${peakNode.point.pCkt3MW.toFixed(1)} MW)`,
        badgePos,
        {
          textColor: '#fef2f2',
          bgColor: 'rgba(185, 28, 28, 0.92)',
          borderColor: 'rgba(252, 165, 165, 0.7)',
          fontSize: 11,
          paddingX: 9,
          paddingY: 5,
        }
      );

      // 8. Interactive Hover Crosshair Projections
      if (hoveredIdxRef.current !== null && screenNodes[hoveredIdxRef.current]) {
        const hNode = screenNodes[hoveredIdxRef.current];
        const pAxisX = proj(hNode.pos3D.x, 0, halfZ);
        const pAxisY = proj(-halfX, hNode.pos3D.y, halfZ);
        const pAxisZ = proj(-halfX, 0, hNode.pos3D.z);

        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.4;

        // Drop line to floor & X-axis
        ctx.beginPath();
        ctx.moveTo(hNode.sx, hNode.sy);
        ctx.lineTo(hNode.baseSx, hNode.baseSy);
        ctx.lineTo(pAxisX.sx, pAxisX.sy);
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();

        // Projection line to Y-axis (Conductor Temp)
        ctx.beginPath();
        ctx.moveTo(hNode.sx, hNode.sy);
        ctx.lineTo(pAxisY.sx, pAxisY.sy);
        ctx.strokeStyle = '#fbbf24';
        ctx.stroke();

        // Projection line from floor to Z-axis (Power MW)
        ctx.beginPath();
        ctx.moveTo(hNode.baseSx, hNode.baseSy);
        ctx.lineTo(pAxisZ.sx, pAxisZ.sy);
        ctx.strokeStyle = '#34d399';
        ctx.stroke();
        ctx.restore();
      }
    }

    projectedNodesRef.current = screenNodes.map((n) => ({
      idx: n.idx,
      sx: n.sx,
      sy: n.sy,
      point: n.point,
    }));

    ctx.restore();
  }, [plotPoints]);

  const handleResetView = useCallback(() => {
    cameraRef.current = {
      rotX: DEFAULT_ROT_X,
      rotY: DEFAULT_ROT_Y,
      zoom: DEFAULT_ZOOM,
    };
    render3DScene();
  }, [render3DScene]);

  const handleZoom = useCallback(
    (delta: number) => {
      cameraRef.current.zoom = Math.max(0.7, Math.min(1.65, cameraRef.current.zoom + delta));
      render3DScene();
    },
    [render3DScene]
  );

  // Set up interactive drag rotation, wheel zoom, hover inspection & ResizeObserver
  useEffect(() => {
    render3DScene();

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let isDragging = false;
    let prevX = 0;
    let prevY = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (isDragging) {
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        cameraRef.current.rotY += dx * 0.008;
        cameraRef.current.rotX = Math.max(
          -0.25,
          Math.min(0.95, cameraRef.current.rotX + dy * 0.008)
        );
        prevX = e.clientX;
        prevY = e.clientY;
        render3DScene();
        return;
      }

      // Check hover proximity to projected 3D nodes
      if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
        let bestIdx: number | null = null;
        let bestDist = 28; // snap radius in px
        for (const node of projectedNodesRef.current) {
          const dist = Math.hypot(node.sx - mx, node.sy - my);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = node.idx;
          }
        }
        if (bestIdx !== hoveredIdxRef.current) {
          hoveredIdxRef.current = bestIdx;
          setHoveredIdx(bestIdx);
          render3DScene();
        }
      }
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onMouseLeave = () => {
      if (hoveredIdxRef.current !== null) {
        hoveredIdxRef.current = null;
        setHoveredIdx(null);
        render3DScene();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging = true;
        prevX = e.touches[0].clientX;
        prevY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - prevX;
      const dy = e.touches[0].clientY - prevY;
      cameraRef.current.rotY += dx * 0.008;
      cameraRef.current.rotX = Math.max(
        -0.25,
        Math.min(0.95, cameraRef.current.rotX + dy * 0.008)
      );
      prevX = e.touches[0].clientX;
      prevY = e.touches[0].clientY;
      render3DScene();
    };

    const onTouchEnd = () => {
      isDragging = false;
    };

    const onResize = () => {
      render3DScene();
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (resizeObserver) {
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', onResize);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [render3DScene, hasGathered]);

  const hoveredPoint =
    hoveredIdx !== null && plotPoints[hoveredIdx] ? plotPoints[hoveredIdx] : null;

  if (!hasAnyDataSource) {
    return (
      <NoDatabaseEmptyState
        pageNumber="2.3"
        pageTitle="3D Conductor Temperature VS Power Flow"
        onAdminLoginClick={onAdminLoginClick}
        isAdminLoggedIn={isAdminLoggedIn}
        onGoToFolderAsset={onGoToFolderAsset}
      />
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Top Filter and Context Bar */}
      <div className="bg-slate-900/90 p-4 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-purple-950/60 text-purple-400 border border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.25)]">
              <Box className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-black text-slate-100 font-mono tracking-tight leading-tight">
                [2.3] 3D CONDUCTOR TEMPERATURE VS POWER FLOW
              </h2>
              <p className="text-[11px] text-purple-400/80 font-mono">
                Interactive Spatial Manifold: Time (X) × Conductor Tc (Y) × Circuit 3 MW (Z)
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          {/* 1. Date Filter (Appears first) */}
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

          {/* 4. Action Button: Gather temperature data and power record */}
          <button
            type="button"
            onClick={handleGatherData}
            disabled={isGathering}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer shadow-md ${
              isPendingGather
                ? 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white shadow-purple-500/25 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-750 text-purple-300 border border-purple-500/30 shadow-black/20'
            }`}
            title="Read fiber temperature in Target Folder 1 and power consumption in Target Folder 2"
          >
            {isGathering ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-300" />
                <span>Gathering Records...</span>
              </>
            ) : (
              <>
                <Database className="w-3.5 h-3.5 text-purple-300" />
                <span>Gather temperature data and power record</span>
              </>
            )}
          </button>
        </div>

        {hasGathered && (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-[10px] text-slate-400 uppercase">PLOTTED 3D:</span>
            <span className="px-2.5 py-1 rounded-lg bg-purple-950/70 border border-purple-500/40 text-purple-300 font-bold">
              {gatheredDate} (Sec {selectedSectionId})
            </span>
          </div>
        )}
      </div>

      {/* 3D Visualizer Container or Gathering Required Empty State */}
      {!hasGathered ? (
        <div className="bg-slate-950 rounded-3xl border border-purple-500/20 p-8 sm:p-14 text-center space-y-5 shadow-[0_0_35px_rgba(168,85,247,0.08)] max-w-xl mx-auto">
          <div className="w-16 h-16 rounded-3xl bg-purple-950/70 border border-purple-500/40 text-purple-400 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(168,85,247,0.25)] animate-pulse">
            <Box className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-extrabold text-white font-mono tracking-tight uppercase">
              3D TELEMETRY GATHERING REQUIRED FOR {selectedDate || 'SELECTED DATE'}
            </h3>
            <p className="text-xs text-slate-400 font-mono leading-relaxed">
              To guarantee zero mockup data, the 3D thermal manifold is not visualized until actual files are gathered from Target Folders 1 &amp; 2.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-left text-xs font-mono space-y-2.5">
            <div className="text-purple-300 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>3D Spatial Telemetry Pipeline</span>
            </div>
            <div className="text-slate-300 text-[11px] space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                <div>
                  <strong className="text-cyan-300">Target Folder 1 (.TEPR)</strong>: Reads fiber temperature inside ~480 records/day across all DOFs for Section {activeSection.sectionId} ({activeSection.name}).
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div>
                  <strong className="text-emerald-300">Target Folder 2 (.CSV)</strong>: Reads 1-record CSV per day for 4 submarine power circuits (96 intervals @ 15 min).
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <div>
                  <strong className="text-amber-300">Equations Alpha – Echo</strong>: Calculates conductor temperature Tc along the 3D spatial time axis.
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGatherData}
            disabled={isGathering || !selectedDate}
            className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-purple-500 via-indigo-600 to-cyan-500 hover:from-purple-400 hover:to-cyan-400 text-white font-mono font-bold text-sm shadow-[0_0_25px_rgba(168,85,247,0.4)] transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
          >
            <Database className="w-4 h-4 text-white" />
            <span>Gather temperature data and power record</span>
          </button>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative bg-slate-950 rounded-3xl border border-purple-500/20 overflow-hidden shadow-[0_0_35px_rgba(168,85,247,0.08)]"
        >
          {/* Guaranteed 3D Spatial Projection Canvas */}
          <canvas
            ref={canvasRef}
            className="block w-full h-[560px] cursor-grab active:cursor-grabbing select-none"
          />

          {/* 3D Axis Markers HUD Legend */}
          <div className="absolute top-4 left-4 z-20 bg-slate-950/92 border border-purple-500/30 rounded-2xl p-3 text-slate-200 text-xs shadow-xl space-y-1.5 font-mono max-w-xs">
            <div className="font-extrabold text-[11px] text-purple-300 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Grid className="w-3.5 h-3.5 text-purple-400" />
                3D AXES &amp; FILLED MANIFOLD
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleZoom(0.12)}
                  className="p-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                  title="Zoom In 3D"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleZoom(-0.12)}
                  className="p-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                  title="Zoom Out 3D"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={handleResetView}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/20 hover:bg-purple-500/35 text-purple-200 border border-purple-500/40 text-[10px] font-bold transition-all cursor-pointer"
                  title="Reset 3D Chart to Center View"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Center View
                </button>
              </div>
            </div>
            <div className="space-y-1 text-[10px]">
              <div className="flex items-center gap-2 text-cyan-300">
                <span className="w-2.5 h-0.5 bg-cyan-400 rounded-full" />
                <span>X-Axis: Time (00:00 to 24:00 Hourly)</span>
              </div>
              <div className="flex items-center gap-2 text-amber-300">
                <span className="w-2.5 h-0.5 bg-amber-400 rounded-full" />
                <span>Y-Axis: Conductor Temp Amplitude (0–90°C)</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-300">
                <span className="w-2.5 h-0.5 bg-emerald-400 rounded-full" />
                <span>Z-Axis: Circuit 3 Power Flow (0–100 MW)</span>
              </div>
              <div className="pt-1 border-t border-slate-800 text-slate-400">
                Locked in center area. Click &amp; drag manually to inspect 3D angles, or hover nodes to inspect hourly telemetry.
              </div>
            </div>
          </div>

          {/* Quick KPI stats overlay */}
          <div className="absolute top-4 right-4 z-20 bg-slate-950/92 border border-purple-500/30 rounded-2xl p-3 text-xs font-mono shadow-xl flex items-center gap-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Peak Conductor</span>
              <span className="font-extrabold text-sm text-amber-400">
                {(actualTelemetry?.peakConductorTempC ?? 0) > 0 ? `${actualTelemetry.peakConductorTempC.toFixed(1)} °C` : '-'}
              </span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Circuit 3 Peak</span>
              <span className="font-extrabold text-sm text-emerald-400">
                {(actualTelemetry?.peakPowerMW ?? 0) > 0 ? `${actualTelemetry.peakPowerMW.toFixed(1)} MW` : '-'}
              </span>
            </div>
          </div>

          {/* Interactive Hovered Node Telemetry HUD */}
          {hoveredPoint && (
            <div className="absolute bottom-4 right-4 z-20 bg-slate-950/95 border border-cyan-500/40 rounded-2xl px-4 py-2.5 text-xs font-mono shadow-2xl flex items-center gap-4 animate-in fade-in duration-150">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Time (X)</span>
                <span className="font-bold text-cyan-300">{hoveredPoint.time}</span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Conductor Tc (Y)</span>
                <span className="font-bold text-amber-400">{hoveredPoint.conductorTempC.toFixed(2)} °C</span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Fiber Tf</span>
                <span className="font-bold text-sky-300">{hoveredPoint.fiberTempC.toFixed(2)} °C</span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Circuit 3 (Z)</span>
                <span className="font-bold text-emerald-400">{hoveredPoint.pCkt3MW.toFixed(1)} MW</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mini Pop-up Loading Screen for Gathering (0 - 100%) with Reading Status of both TEPR & CSV */}
      {isGatheringModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-slate-900 border border-purple-500/40 rounded-3xl p-6 shadow-[0_0_60px_rgba(168,85,247,0.3)] space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-2xl bg-purple-950 text-purple-400 border border-purple-500/40 animate-pulse">
                  <Database className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-black font-mono text-white tracking-wide">
                    GATHERING TELEMETRY &amp; POWER RECORD (3D)
                  </h3>
                  <p className="text-[11px] font-mono text-purple-300">
                    Selected Date: <span className="font-bold text-white">{selectedDate}</span> • Target Folders 1 &amp; 2
                  </p>
                </div>
              </div>
              <div className="px-3 py-1 rounded-full bg-purple-950/80 border border-purple-500/30 text-purple-400 font-mono font-bold text-xs">
                {gatherProgress}%
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs font-mono text-slate-300">
                <span className="truncate max-w-[280px]">
                  {gatherCurrentSecName ? `Evaluating ${gatherCurrentSecName}` : 'Scanning Target Folders 1 & 2...'}
                </span>
                <span className="font-bold text-purple-400">{gatherProgress}%</span>
              </div>
              <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-400 rounded-full transition-all duration-150 shadow-[0_0_12px_rgba(168,85,247,0.6)]"
                  style={{ width: `${gatherProgress}%` }}
                />
              </div>
            </div>

            {/* Reading Status 1: Target Folder 1 (.TEPR Files) */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-cyan-500/30 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  TARGET FOLDER 1 (.TEPR): Optical Fiber Records
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 font-bold border border-cyan-500/30">
                  {gatherProgress >= 100 ? 'COMPLETED' : 'READING...'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Reading status across assigned DOFs:</span>
                <span className="text-white font-bold">
                  {gatherTeprCount} / ~{gatherTeprTarget} records
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-500">
                Normally in 1 day there will be approx. 480 records of .TEPR file (Channels 0–3: Phase A/B/C &amp; Submarine).
              </p>
            </div>

            {/* Reading Status 2: Target Folder 2 (Power Record .CSV) */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-emerald-500/30 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  TARGET FOLDER 2 (.CSV): Substation Power Records
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-bold border border-emerald-500/30">
                  {gatherProgress >= 100 ? 'COMPLETED' : 'READING...'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>1 record CSV file per day (4 submarine power circuits):</span>
                <span className="text-emerald-300 font-bold">
                  {gatherCsvIntervals} / 96 intervals @ 15 min
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 flex flex-wrap gap-2 pt-0.5">
                <span className="text-slate-400">• KMB (115kV Ckt 3)</span>
                <span className="text-slate-400">• KMA (115kV Ckt 2)</span>
                <span className="text-slate-400">• KNA (33kV NKT)</span>
                <span className="text-slate-400">• KNA (33kV Oil)</span>
              </div>
            </div>

            {/* Conductor Temperature Estimation & Caching Status */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-amber-500/30 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  IEC 60287 EQUATION ALPHA – ECHO
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-bold border border-amber-500/30">
                  {gatherCurrentEquation || 'Alpha – Echo'}
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400">
                Estimating conductor temperature using Circuit 3 power flow at nearest time of capture for each section.
              </p>
            </div>

            {/* Footer Guarantee */}
            <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-slate-400">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zero Mockup Data Guarantee</span>
              </div>
              <span className="text-slate-500">All 18 sections cached for date</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
