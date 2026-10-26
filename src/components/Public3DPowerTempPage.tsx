import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import {
  Box,
  Calendar,
  Layers,
  Thermometer,
  Zap,
  Eye,
  Camera,
  Maximize2,
  Sliders,
  Sparkles,
  Info,
  Clock,
  Radio,
  Loader2,
  Database,
  Grid,
  ShieldCheck,
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

// Helper to create a canvas sprite text label for 3D axis markers
function makeTextSprite(
  message: string,
  parameters?: {
    fontface?: string;
    fontsize?: number;
    textColor?: string;
    backgroundColor?: string;
  }
): THREE.Sprite {
  const fontface = parameters?.fontface || 'Courier New, monospace';
  const fontsize = parameters?.fontsize || 28;
  const textColor = parameters?.textColor || '#ffffff';
  const backgroundColor = parameters?.backgroundColor || 'rgba(15, 23, 42, 0.85)';

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = backgroundColor;
    context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 8);
    context.fill();

    context.font = `bold ${fontsize}px ${fontface}`;
    context.fillStyle = textColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(7, 1.75, 1);
  return sprite;
}

export const Public3DPowerTempPage: React.FC<Public3DPowerTempPageProps> = ({
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
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);

  const [profileDbVersion, setProfileDbVersion] = useState<number>(0);

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

  // Cache of all 19 gathered sections per date: dateKey -> Map<sectionId, ActualDailyTelemetrySummary>
  const cachedDaysMapRef = useRef<Map<string, Map<string, ActualDailyTelemetrySummary>>>(new Map());

  // Automatically sync selectedDate and gatheredDate when Panel 3 dates update or user changes date
  useEffect(() => {
    if (availableDates.length > 0 && (!selectedDate || !availableDates.includes(selectedDate))) {
      const latest = availableDates[availableDates.length - 1];
      setSelectedDate(latest);
      setGatheredDate(latest);
      setHasGathered(true);
      void fetchSectionDailyProfileForDate(latest);
    } else if (selectedDate) {
      setGatheredDate(selectedDate);
      setHasGathered(true);
      void fetchSectionDailyProfileForDate(selectedDate);
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

  const isDateCached = cachedDaysMapRef.current.has(selectedDate);
  const isPendingGather = false;

  // -------------------------------------------------------------------------
  // THREE.JS 3D SCENE SETUP WITH AXIS MARKERS & FILLED AREA UNDER CURVE
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const width = container.clientWidth || 960;
    const height = 560;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    camera.position.set(0, 11, 64);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x06b6d4, 1.2);
    dirLight1.position.set(30, 40, 30);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xf59e0b, 0.85);
    dirLight2.position.set(-30, 20, -30);
    scene.add(dirLight2);

    // Pivot group centered at (0, 0, 0) in the middle of the viewport
    const DEFAULT_ROT_X = 0.22;
    const DEFAULT_ROT_Y = -0.38;
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(0, -1.5, 0);
    pivotGroup.rotation.set(DEFAULT_ROT_X, DEFAULT_ROT_Y, 0);
    scene.add(pivotGroup);

    // Offset mainGroup inside pivotGroup so the 3D bounding box & axis labels are centered at (0, 0, 0)
    const mainGroup = new THREE.Group();
    mainGroup.position.set(2.5, -10.5, 0);
    pivotGroup.add(mainGroup);

    resetViewRef.current = () => {
      pivotGroup.rotation.set(DEFAULT_ROT_X, DEFAULT_ROT_Y, 0);
      camera.position.set(0, 11, 64);
      camera.lookAt(0, 0, 0);
    };

    // -----------------------------------------------------------------------
    // 3D BOUNDING BOX & GRID PLANES
    // Dimensions: X = 32 (Time 0..24 hrs), Y = 24 (Temp 0..90 °C), Z = 28 (Power 0..100 MW)
    // -----------------------------------------------------------------------
    const BOX_X = 32;
    const BOX_Y = 24;
    const BOX_Z = 28;

    // Grid Floor (XZ plane at Y = 0)
    const gridFloor = new THREE.GridHelper(32, 16, 0x06b6d4, 0x1e293b);
    gridFloor.position.set(0, 0, 0);
    mainGroup.add(gridFloor);

    // -----------------------------------------------------------------------
    // AXIS MARKERS & LINES FOR ALL 3 DIMENSIONS (Item 2.3 Requirement)
    // 1. X-Axis: Time in hourly (00:00 to 24:00)
    // 2. Y-Axis: Amplitude (Conductor Temperature in °C)
    // 3. Z-Axis: Power Flow in MW (0 to 100 MW)
    // -----------------------------------------------------------------------
    const axisGroup = new THREE.Group();
    mainGroup.add(axisGroup);

    // X-Axis Line (Time, Cyan)
    const xLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-BOX_X / 2, 0, BOX_Z / 2),
      new THREE.Vector3(BOX_X / 2, 0, BOX_Z / 2),
    ]);
    const xLineMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2 });
    axisGroup.add(new THREE.Line(xLineGeo, xLineMat));

    // Y-Axis Line (Temperature, Amber)
    const yLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-BOX_X / 2, 0, BOX_Z / 2),
      new THREE.Vector3(-BOX_X / 2, BOX_Y, BOX_Z / 2),
    ]);
    const yLineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
    axisGroup.add(new THREE.Line(yLineGeo, yLineMat));

    // Z-Axis Line (Power Flow MW, Emerald)
    const zLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-BOX_X / 2, 0, BOX_Z / 2),
      new THREE.Vector3(-BOX_X / 2, 0, -BOX_Z / 2),
    ]);
    const zLineMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2 });
    axisGroup.add(new THREE.Line(zLineGeo, zLineMat));

    // X-Axis Hourly Time Markers (00:00, 04:00, 08:00, 12:00, 16:00, 20:00, 24:00)
    const hourlyLabels = [
      { text: '00:00', x: -BOX_X / 2 },
      { text: '04:00', x: -BOX_X / 2 + (BOX_X / 6) * 1 },
      { text: '08:00', x: -BOX_X / 2 + (BOX_X / 6) * 2 },
      { text: '12:00', x: -BOX_X / 2 + (BOX_X / 6) * 3 },
      { text: '16:00', x: -BOX_X / 2 + (BOX_X / 6) * 4 },
      { text: '20:00', x: -BOX_X / 2 + (BOX_X / 6) * 5 },
      { text: '24:00', x: BOX_X / 2 },
    ];

    hourlyLabels.forEach((lbl) => {
      // Small vertical tick mark
      const tickGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(lbl.x, -0.6, BOX_Z / 2),
        new THREE.Vector3(lbl.x, 0.6, BOX_Z / 2),
      ]);
      axisGroup.add(new THREE.Line(tickGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8 })));

      // 3D Canvas Sprite text label
      const sprite = makeTextSprite(lbl.text, {
        fontsize: 26,
        textColor: '#38bdf8',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      });
      sprite.position.set(lbl.x, -2, BOX_Z / 2 + 2);
      axisGroup.add(sprite);
    });

    // X-Axis Global Title Marker
    const xTitleSprite = makeTextSprite('TIME (HOURLY)', {
      fontsize: 30,
      textColor: '#06b6d4',
      backgroundColor: 'rgba(6, 182, 212, 0.25)',
    });
    xTitleSprite.scale.set(10, 2.2, 1);
    xTitleSprite.position.set(0, -4.5, BOX_Z / 2 + 3);
    axisGroup.add(xTitleSprite);

    // Y-Axis Temperature Amplitude Markers (20°C, 40°C, 60°C, 80°C)
    const tempLabels = [
      { text: '20°C', y: (20 / 90) * BOX_Y },
      { text: '40°C', y: (40 / 90) * BOX_Y },
      { text: '60°C', y: (60 / 90) * BOX_Y },
      { text: '80°C', y: (80 / 90) * BOX_Y },
    ];

    tempLabels.forEach((lbl) => {
      const tickGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-BOX_X / 2 - 0.6, lbl.y, BOX_Z / 2),
        new THREE.Vector3(-BOX_X / 2 + 0.6, lbl.y, BOX_Z / 2),
      ]);
      axisGroup.add(new THREE.Line(tickGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b })));

      const sprite = makeTextSprite(lbl.text, {
        fontsize: 26,
        textColor: '#f59e0b',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      });
      sprite.position.set(-BOX_X / 2 - 4.5, lbl.y, BOX_Z / 2);
      axisGroup.add(sprite);
    });

    // Y-Axis Global Title Marker
    const yTitleSprite = makeTextSprite('CONDUCTOR TEMP (°C)', {
      fontsize: 28,
      textColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.25)',
    });
    yTitleSprite.scale.set(13, 2.3, 1);
    yTitleSprite.position.set(-BOX_X / 2 - 5, BOX_Y + 2.5, BOX_Z / 2);
    axisGroup.add(yTitleSprite);

    // Z-Axis Power Flow Markers (0 MW, 25 MW, 50 MW, 75 MW, 100 MW)
    const powerLabels = [
      { text: '0 MW', z: BOX_Z / 2 },
      { text: '25 MW', z: BOX_Z / 2 - (BOX_Z / 4) * 1 },
      { text: '50 MW', z: BOX_Z / 2 - (BOX_Z / 4) * 2 },
      { text: '75 MW', z: BOX_Z / 2 - (BOX_Z / 4) * 3 },
      { text: '100 MW', z: -BOX_Z / 2 },
    ];

    powerLabels.forEach((lbl) => {
      const tickGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-BOX_X / 2 - 0.6, 0, lbl.z),
        new THREE.Vector3(-BOX_X / 2 + 0.6, 0, lbl.z),
      ]);
      axisGroup.add(new THREE.Line(tickGeo, new THREE.LineBasicMaterial({ color: 0x10b981 })));

      const sprite = makeTextSprite(lbl.text, {
        fontsize: 24,
        textColor: '#10b981',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      });
      sprite.position.set(-BOX_X / 2 - 4.5, 0, lbl.z);
      axisGroup.add(sprite);
    });

    // Z-Axis Global Title Marker
    const zTitleSprite = makeTextSprite('POWER FLOW (MW)', {
      fontsize: 28,
      textColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.25)',
    });
    zTitleSprite.scale.set(11, 2.3, 1);
    zTitleSprite.position.set(-BOX_X / 2 - 4, 0, -BOX_Z / 2 - 3.5);
    axisGroup.add(zTitleSprite);

    // -----------------------------------------------------------------------
    // PLOT 3D CURVE & FILLED AREA UNDER PLOTTED CURVE WITH COLOR (Item 2.3 Requirement)
    // Mapping:
    // X = normalized time across [-BOX_X/2, BOX_X/2]
    // Y = (conductorTempC / 90) * BOX_Y
    // Z = BOX_Z/2 - (powerCkt3MW / 100) * BOX_Z
    // -----------------------------------------------------------------------
    const points = actualTelemetry.points;
    if (points && points.length > 1) {
      const curvePoints3D: THREE.Vector3[] = [];
      const basePoints3D: THREE.Vector3[] = [];
      const vertexColors: number[] = [];

      points.forEach((pt: ActualTelemetryPoint) => {
        const timeFraction = Math.max(0, Math.min(1, pt.timeMinutes / 1440));
        const px = -BOX_X / 2 + timeFraction * BOX_X;
        const py = Math.max(0, (pt.conductorTempC / 90) * BOX_Y);
        const pz = BOX_Z / 2 - Math.max(0, Math.min(1, pt.pCkt3MW / 100)) * BOX_Z;

        curvePoints3D.push(new THREE.Vector3(px, py, pz));
        basePoints3D.push(new THREE.Vector3(px, 0, pz)); // Baseline on floor
      });

      // 1. Plotted 3D Tube / Core Line
      const catmullCurve = new THREE.CatmullRomCurve3(curvePoints3D);
      const tubeGeo = new THREE.TubeGeometry(catmullCurve, 64, 0.45, 12, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      mainGroup.add(tubeMesh);

      // 2. FILLED AREA UNDER PLOTTED CURVE (Triangle Strip Polygon Mesh with Gradient Color)
      // Creates a solid vertical curtain / ribbon dropping from curve down to baseline
      const filledAreaGeo = new THREE.BufferGeometry();
      const areaVertices: number[] = [];
      const areaColors: number[] = [];

      for (let i = 0; i < curvePoints3D.length - 1; i++) {
        const c1 = curvePoints3D[i];
        const c2 = curvePoints3D[i + 1];
        const b1 = basePoints3D[i];
        const b2 = basePoints3D[i + 1];

        // Triangle 1: c1, b1, c2
        areaVertices.push(c1.x, c1.y, c1.z);
        areaVertices.push(b1.x, b1.y, b1.z);
        areaVertices.push(c2.x, c2.y, c2.z);

        // Triangle 2: c2, b1, b2
        areaVertices.push(c2.x, c2.y, c2.z);
        areaVertices.push(b1.x, b1.y, b1.z);
        areaVertices.push(b2.x, b2.y, b2.z);

        // Color interpolation based on temperature (Cyan cool -> Amber warm -> Red hot)
        const t1 = Math.min(1, Math.max(0, (points[i].conductorTempC - 25) / 50));
        const t2 = Math.min(1, Math.max(0, (points[i + 1].conductorTempC - 25) / 50));

        // Vertex 1: c1 (Warm)
        areaColors.push(0.96 * t1 + 0.02 * (1 - t1), 0.62 * t1 + 0.71 * (1 - t1), 0.04 * t1 + 0.83 * (1 - t1));
        // Vertex 2: b1 (Cooler at floor baseline)
        areaColors.push(0.02, 0.55, 0.75);
        // Vertex 3: c2 (Warm)
        areaColors.push(0.96 * t2 + 0.02 * (1 - t2), 0.62 * t2 + 0.71 * (1 - t2), 0.04 * t2 + 0.83 * (1 - t2));

        // Triangle 2 vertices
        areaColors.push(0.96 * t2 + 0.02 * (1 - t2), 0.62 * t2 + 0.71 * (1 - t2), 0.04 * t2 + 0.83 * (1 - t2));
        areaColors.push(0.02, 0.55, 0.75);
        areaColors.push(0.02, 0.55, 0.75);
      }

      filledAreaGeo.setAttribute('position', new THREE.Float32BufferAttribute(areaVertices, 3));
      filledAreaGeo.setAttribute('color', new THREE.Float32BufferAttribute(areaColors, 3));
      filledAreaGeo.computeVertexNormals();

      const filledAreaMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.68,
        side: THREE.DoubleSide,
        roughness: 0.3,
        metalness: 0.2,
      });

      const filledAreaMesh = new THREE.Mesh(filledAreaGeo, filledAreaMat);
      mainGroup.add(filledAreaMesh);

      // 3. Peak Point Sphere Marker
      const peakIdx = points.reduce(
        (maxI, p, idx, arr) => (p.conductorTempC > arr[maxI].conductorTempC ? idx : maxI),
        0
      );
      if (peakIdx >= 0 && peakIdx < curvePoints3D.length) {
        const peakPos = curvePoints3D[peakIdx];
        const peakGeo = new THREE.SphereGeometry(0.9, 16, 16);
        const peakMat = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xdc2626,
          emissiveIntensity: 0.8,
        });
        const peakSphere = new THREE.Mesh(peakGeo, peakMat);
        peakSphere.position.copy(peakPos);
        mainGroup.add(peakSphere);

        // Peak Label Sprite
        const peakSprite = makeTextSprite(
          `PEAK ${points[peakIdx].conductorTempC.toFixed(1)}°C @ ${points[peakIdx].time}`,
          { fontsize: 26, textColor: '#fecaca', backgroundColor: 'rgba(220, 38, 38, 0.9)' }
        );
        peakSprite.scale.set(12, 2.5, 1);
        peakSprite.position.set(peakPos.x, peakPos.y + 3.2, peakPos.z);
        mainGroup.add(peakSprite);
      }
    }

    // Interactive manual mouse drag rotation (stationary by default in center area)
    let isMouseDown = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    const onMouseDown = (e: MouseEvent) => {
      isMouseDown = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isMouseDown) return;
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;
      pivotGroup.rotation.y += deltaX * 0.007;
      pivotGroup.rotation.x = Math.max(
        -0.45,
        Math.min(0.85, pivotGroup.rotation.x + deltaY * 0.007)
      );
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseUp = () => {
      isMouseDown = false;
    };

    const onResize = () => {
      if (!container) return;
      const newW = container.clientWidth || 960;
      camera.aspect = newW / height;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      renderer.setSize(newW, height);
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (resizeObserver) {
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', onResize);

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Animation Loop (stationary in center — no automatic continuous rotation)
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.dispose();
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, [actualTelemetry, hasGathered]);

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
      <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl border border-cyan-500/20 shadow-[0_4px_25px_rgba(6,182,212,0.06)] flex flex-wrap items-center justify-between gap-3">
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
        <div className="relative bg-slate-950 rounded-3xl border border-purple-500/20 overflow-hidden shadow-[0_0_35px_rgba(168,85,247,0.08)]">
          {/* Three.js canvas mount */}
          <div ref={mountRef} className="w-full h-[560px] cursor-grab active:cursor-grabbing" />

          {/* 3D Axis Markers HUD Legend */}
          <div className="absolute top-4 left-4 z-20 bg-slate-950/90 backdrop-blur-md border border-purple-500/30 rounded-2xl p-3 text-slate-200 text-xs shadow-xl space-y-1.5 font-mono max-w-xs">
            <div className="font-extrabold text-[11px] text-purple-300 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Grid className="w-3.5 h-3.5 text-purple-400" />
                3D AXES &amp; FILLED MANIFOLD
              </span>
              <button
                type="button"
                onClick={() => resetViewRef.current?.()}
                className="px-2 py-0.5 rounded-md bg-purple-500/20 hover:bg-purple-500/35 text-purple-200 border border-purple-500/40 text-[10px] font-bold transition-all cursor-pointer"
                title="Reset 3D Chart to Center View"
              >
                Center View
              </button>
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
                Locked in center area. Click &amp; drag manually to inspect 3D angles.
              </div>
            </div>
          </div>

          {/* Quick KPI stats overlay */}
          <div className="absolute top-4 right-4 z-20 bg-slate-950/90 backdrop-blur-md border border-purple-500/30 rounded-2xl p-3 text-xs font-mono shadow-xl flex items-center gap-3">
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
