// 115 kV Submarine Cable Circuit #3 ("Khanom - Samui 115 kV XLPE Submarine Cable Circuit #3")
// Revised System Structure: 19 Sections (1.1-1.6 Land, 2.1-2.13 Submarine), Sampling Points & 5 IEC 60287 Equations (Alpha, Beta, Charlie, Delta, Echo)

export type CableSectionType = 'normal' | 'special';
export type CableCategory = 'land' | 'submarine';
export type CablePhase = 'A' | 'B' | 'C' | 'SM';
export type ConductorEquationName = 'Alpha' | 'Beta' | 'Charlie' | 'Delta' | 'Echo';

export interface ConductorEquationInfo {
  name: ConductorEquationName;
  label: string;
  formulaText: string;
  targetSections: string;
  sectionIds: string[];
}

export const CONDUCTOR_EQUATIONS: Record<ConductorEquationName, ConductorEquationInfo> = {
  Alpha: {
    name: 'Alpha',
    label: 'Equation Alpha',
    formulaText: 'Tc,60287 = (Tf + 0.07219 + (4.3080×10⁻⁴ × P²)) / (1 - (1.8375×10⁻⁶ × P²))',
    targetSections: 'Land Cable Section 1, 3, 5 (Normal Sections LS1, LS2, LS3)',
    sectionIds: ['1.1', '1.3', '1.5'],
  },
  Beta: {
    name: 'Beta',
    label: 'Equation Beta',
    formulaText: 'Tc,60287 = (Tf + 0.018007 + (8.1610×10⁻⁴ × P²)) / (1 - (3.4809×10⁻⁶ × P²))',
    targetSections: 'Land Cable Section 2, 4, 6 (Joint JP1, JP2, and TJ1)',
    sectionIds: ['1.2', '1.4', '1.6'],
  },
  Charlie: {
    name: 'Charlie',
    label: 'Equation Charlie',
    formulaText: 'Tc,60287 = (Tf + 0.14625 + (1.1577×10⁻³ × P²)) / (1 - (4.9379×10⁻⁶ × P²))',
    targetSections: 'Submarine Cable Zone 1–4, 7, 10–13 (Bottleneck, Crossing Area, and Normal Sections)',
    sectionIds: ['2.1', '2.2', '2.3', '2.4', '2.7', '2.10', '2.11', '2.12', '2.13'],
  },
  Delta: {
    name: 'Delta',
    label: 'Equation Delta',
    formulaText: 'Tc,60287 = (Tf + 0.20022 + (2.3412×10⁻³ × P²)) / (1 - (6.8648×10⁻⁶ × P²))',
    targetSections: 'Submarine Cable Zone 5–6 (Nexans Subsea Joint 1–2)',
    sectionIds: ['2.5', '2.6'],
  },
  Echo: {
    name: 'Echo',
    label: 'Equation Echo',
    formulaText: 'Tc,60287 = (Tf + 0.26185 + (3.097×10⁻³ × P²)) / (1 - (7.8565×10⁻⁶ × P²))',
    targetSections: 'Submarine Cable Zone 8–9 (Furukawa Subsea Joint 1–2)',
    sectionIds: ['2.8', '2.9'],
  },
};

export const CONDUCTOR_EQUATION_FORMULAS: Record<ConductorEquationName, string> = {
  Alpha: CONDUCTOR_EQUATIONS.Alpha.formulaText,
  Beta: CONDUCTOR_EQUATIONS.Beta.formulaText,
  Charlie: CONDUCTOR_EQUATIONS.Charlie.formulaText,
  Delta: CONDUCTOR_EQUATIONS.Delta.formulaText,
  Echo: CONDUCTOR_EQUATIONS.Echo.formulaText,
};

export interface CableSamplingPoint {
  id: string;
  pos: string;
  phase: CablePhase;
  sectionId: string; // "1.1".."1.6", "2.1".."2.13"
  sectionName: string;
  sectionType: CableSectionType;
  cableCategory: CableCategory;
  latitude: number;
  longitude: number;
  kp: number; // km (e.g. 1.431)
  kpFormatted: string; // e.g. "01+431"
  dab: number | null; // meters derived from KP
  dof: number; // Distance in Fiber Optic record (.TEPR)
  equationName: ConductorEquationName; // "Alpha" | "Beta" | "Charlie" | "Delta" | "Echo"
  description: string;
}

export interface CableSectionInfo {
  sectionId: string;
  category: CableCategory;
  sectionType: CableSectionType;
  name: string;
  subtitle: string;
  lengthMeters: number;
  pointsCount: number; // points per phase (land) or points (submarine)
  equationName: ConductorEquationName;
  description: string;
}

export const CABLE_SECTIONS: CableSectionInfo[] = [
  // ================= 1. LAND CABLE (1,460 m, 6 Sections, 38 Points/Phase) =================
  {
    sectionId: '1.1',
    category: 'land',
    sectionType: 'normal',
    name: 'Land Cable Section 1 (LS1)',
    subtitle: 'Riserpole to Entry of Joint Pit 1',
    lengthMeters: 470,
    pointsCount: 8,
    equationName: 'Alpha',
    description: 'Normal section from switchyard riserpole to entry of JP1 (8 points/phase). Governed by IEC Estimation.',
  },
  {
    sectionId: '1.2',
    category: 'land',
    sectionType: 'special',
    name: 'Land Cable Section 2 - Special 1 (JP1)',
    subtitle: 'Inside Joint Pit 1 (12m Joint)',
    lengthMeters: 12,
    pointsCount: 4,
    equationName: 'Beta',
    description: 'Special section 1 inside Joint Pit 1 with fiber optic on outer sheath of joint (4 points/phase). Governed by IEC Estimation.',
  },
  {
    sectionId: '1.3',
    category: 'land',
    sectionType: 'normal',
    name: 'Land Cable Section 3 (LS2)',
    subtitle: 'Outro of Joint Pit 1 to Entry of Joint Pit 2',
    lengthMeters: 471,
    pointsCount: 8,
    equationName: 'Alpha',
    description: 'Normal underground section from outro of JP1 to entry of JP2 (8 points/phase). Governed by IEC Estimation.',
  },
  {
    sectionId: '1.4',
    category: 'land',
    sectionType: 'special',
    name: 'Land Cable Section 4 - Special 2 (JP2)',
    subtitle: 'Inside Joint Pit 2 (12m Joint)',
    lengthMeters: 12,
    pointsCount: 4,
    equationName: 'Beta',
    description: 'Special section 2 inside Joint Pit 2 with fiber optic on outer sheath of joint (4 points/phase). Governed by IEC Estimation.',
  },
  {
    sectionId: '1.5',
    category: 'land',
    sectionType: 'normal',
    name: 'Land Cable Section 5 (LS3)',
    subtitle: 'Outro of Joint Pit 2 to Entry of TJ1',
    lengthMeters: 500,
    pointsCount: 8,
    equationName: 'Alpha',
    description: 'Normal section from outro of JP2 to entry of Transition Joint Pit 1 (8 points/phase). Governed by IEC Estimation.',
  },
  {
    sectionId: '1.6',
    category: 'land',
    sectionType: 'special',
    name: 'Land Cable Section 6 - Special 3 (TJ1)',
    subtitle: 'Inside Transition Joint Pit 1 (14m Joint)',
    lengthMeters: 14,
    pointsCount: 6,
    equationName: 'Beta',
    description: 'Special section 3 inside Transition Joint Pit 1 connecting 3-single core land cables to 3-core submarine cable (6 points/phase). Governed by IEC Estimation.',
  },

  // ================= 2. SUBMARINE CABLE (~52 km, 13 Zones, 81 Points) =================
  {
    sectionId: '2.1',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 1 - Special 1 (Bottleneck)',
    subtitle: 'Beach Head Bottleneck (Multi-Circuit Proximity)',
    lengthMeters: 160,
    pointsCount: 6,
    equationName: 'Charlie',
    description: 'Bottleneck section after TJ1 to shallow water laid adjacent to 3 other submarine circuits (6 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.2',
    category: 'submarine',
    sectionType: 'normal',
    name: 'Submarine Zone 2 - Normal 1 (NM1)',
    subtitle: 'Khanom Beach to Water Pipeline Crossing',
    lengthMeters: 10160,
    pointsCount: 13,
    equationName: 'Charlie',
    description: 'Direct buried seabed section (1.5-2m depth) to PWA water pipeline crossing (13 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.3',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 3 - Special 2 (XPWA)',
    subtitle: 'Water Pipeline (PWA) Crossing Area',
    lengthMeters: 65,
    pointsCount: 3,
    equationName: 'Charlie',
    description: 'Crossing area over underwater PWA water pipeline (3 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.4',
    category: 'submarine',
    sectionType: 'normal',
    name: 'Submarine Zone 4 - Normal 2 (NM2)',
    subtitle: 'PWA Crossing to Subsea Joint Nexans #2',
    lengthMeters: 18950,
    pointsCount: 20,
    equationName: 'Charlie',
    description: 'Deep seabed section from PWA crossing to before Joint Nexans #2 (20 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.5',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 5 - Special 3 (NX2)',
    subtitle: 'Subsea Cable Joint Nexans #2',
    lengthMeters: 65,
    pointsCount: 3,
    equationName: 'Delta',
    description: 'Subsea repair/connection joint Nexans product NX2 (3 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.6',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 6 - Special 4 (NX1)',
    subtitle: 'Subsea Cable Joint Nexans #1',
    lengthMeters: 65,
    pointsCount: 3,
    equationName: 'Delta',
    description: 'Subsea repair/connection joint Nexans product NX1 (3 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.7',
    category: 'submarine',
    sectionType: 'normal',
    name: 'Submarine Zone 7 - Normal 3 (NM3)',
    subtitle: 'Joint NX1 to Joint Furukawa #1',
    lengthMeters: 294,
    pointsCount: 1,
    equationName: 'Charlie',
    description: 'Short intermediate subsea section between NX1 and FR1 (1 point). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.8',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 8 - Special 5 (FR1)',
    subtitle: 'Subsea Cable Joint Furukawa #1',
    lengthMeters: 65,
    pointsCount: 3,
    equationName: 'Echo',
    description: 'Subsea repair/connection joint Furukawa product FR1 (3 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.9',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 9 - Special 6 (FR2)',
    subtitle: 'Subsea Cable Joint Furukawa #2',
    lengthMeters: 65,
    pointsCount: 3,
    equationName: 'Echo',
    description: 'Subsea repair/connection joint Furukawa product FR2 (3 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.10',
    category: 'submarine',
    sectionType: 'normal',
    name: 'Submarine Zone 10 - Normal 4 (NM4)',
    subtitle: 'Joint FR2 to 33kV Cable Crossing',
    lengthMeters: 14603,
    pointsCount: 15,
    equationName: 'Charlie',
    description: 'Seabed section from FR2 to before 33kV Koh Pha Ngan cable crossing (15 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.11',
    category: 'submarine',
    sectionType: 'special',
    name: 'Submarine Zone 11 - Special 7 (X33kV)',
    subtitle: '33kV Koh Pha Ngan Cable Crossing',
    lengthMeters: 163,
    pointsCount: 4,
    equationName: 'Charlie',
    description: 'Crossing area over 33kV submarine cable to Koh Pha Ngan (4 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.12',
    category: 'submarine',
    sectionType: 'normal',
    name: 'Submarine Zone 12 - Normal 5 (NM5)',
    subtitle: '33kV Crossing to Transition Joint Pit #2',
    lengthMeters: 3169,
    pointsCount: 6,
    equationName: 'Charlie',
    description: 'Normal subsea approach section to edge of Transition Joint Pit #2 on Koh Samui (6 points). Governed by IEC Estimation.',
  },
  {
    sectionId: '2.13',
    category: 'submarine',
    sectionType: 'normal',
    name: 'Submarine Zone 13 - Normal 6 (NM6)',
    subtitle: 'Mae Nam Beach Landing before Transition Joint Pit 2 (Koh Samui)',
    lengthMeters: 392,
    pointsCount: 3,
    equationName: 'Charlie',
    description: 'Mae Nam Beach landing section before entering Transition Joint Pit 2 on Koh Samui (3 points). Governed by IEC Estimation.',
  },
];

// Helper to parse KP "00+034" -> 34
function kpToMeters(kp: string): number {
  const parts = kp.split('+');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0], 10) * 1000 + parseInt(parts[1], 10);
}

interface RawPointTuple {
  pos: string;
  phase: CablePhase;
  lat: number;
  lng: number;
  kp: string;
  dof: number;
}

const RAW_SECTION_POINTS: Record<string, RawPointTuple[]> = {
  // 1.1 Land cable section 1 (8 points/phase)
  '1.1': [
    { pos: 'LS1-Point 1', phase: 'A', lat: 9.233199, lng: 99.859123, kp: '00+000', dof: 2020.94 },
    { pos: 'LS1-Point 1', phase: 'B', lat: 9.233229, lng: 99.859084, kp: '00+000', dof: 2020.94 },
    { pos: 'LS1-Point 1', phase: 'C', lat: 9.233274, lng: 99.859029, kp: '00+000', dof: 2020.94 },
    { pos: 'LS1-Point 2', phase: 'A', lat: 9.233008, lng: 99.858922, kp: '00+034', dof: 2055.65 },
    { pos: 'LS1-Point 2', phase: 'B', lat: 9.233033, lng: 99.858873, kp: '00+034', dof: 2055.65 },
    { pos: 'LS1-Point 2', phase: 'C', lat: 9.233061, lng: 99.858839, kp: '00+034', dof: 2055.65 },
    { pos: 'LS1-Point 3', phase: 'A', lat: 9.232899, lng: 99.858797, kp: '00+053', dof: 2074.03 },
    { pos: 'LS1-Point 3', phase: 'B', lat: 9.2328262, lng: 99.8585011, kp: '00+053', dof: 2074.03 },
    { pos: 'LS1-Point 3', phase: 'C', lat: 9.232955, lng: 99.858726, kp: '00+053', dof: 2074.03 },
    { pos: 'LS1-Point 4', phase: 'A', lat: 9.232527, lng: 99.858172, kp: '00+115', dof: 2135.28 },
    { pos: 'LS1-Point 4', phase: 'B', lat: 9.232502, lng: 99.858137, kp: '00+115', dof: 2135.28 },
    { pos: 'LS1-Point 4', phase: 'C', lat: 9.232481, lng: 99.858113, kp: '00+115', dof: 2135.28 },
    { pos: 'LS1-Point 5', phase: 'A', lat: 9.233344, lng: 99.856939, kp: '00+186', dof: 2206.75 },
    { pos: 'LS1-Point 5', phase: 'B', lat: 9.233386, lng: 99.856975, kp: '00+186', dof: 2206.75 },
    { pos: 'LS1-Point 5', phase: 'C', lat: 9.233415, lng: 99.857011, kp: '00+186', dof: 2206.75 },
    { pos: 'LS1-Point 6', phase: 'A', lat: 9.233664, lng: 99.856537, kp: '00+280', dof: 2300.68 },
    { pos: 'LS1-Point 6', phase: 'B', lat: 9.233704, lng: 99.856580, kp: '00+280', dof: 2300.68 },
    { pos: 'LS1-Point 6', phase: 'C', lat: 9.233726, lng: 99.856614, kp: '00+280', dof: 2300.68 },
    { pos: 'LS1-Point 7', phase: 'A', lat: 9.234029, lng: 99.856227, kp: '00+380', dof: 2400.73 },
    { pos: 'LS1-Point 7', phase: 'B', lat: 9.234027, lng: 99.856306, kp: '00+380', dof: 2400.73 },
    { pos: 'LS1-Point 7', phase: 'C', lat: 9.234029, lng: 99.856380, kp: '00+380', dof: 2400.73 },
    { pos: 'LS1-Point 8', phase: 'A', lat: 9.234531, lng: 99.856591, kp: '00+470', dof: 2490.57 },
    { pos: 'LS1-Point 8', phase: 'B', lat: 9.234491, lng: 99.856627, kp: '00+470', dof: 2490.57 },
    { pos: 'LS1-Point 8', phase: 'C', lat: 9.234454, lng: 99.856681, kp: '00+470', dof: 2490.57 },
  ],
  // 1.2 Land cable section 2 - Special Section 1 (JP1, 4 points/phase)
  '1.2': [
    { pos: 'JP1 Point 1', phase: 'A', lat: 9.234600, lng: 99.856637, kp: '00+521', dof: 2541.62 },
    { pos: 'JP1 Point 1', phase: 'B', lat: 9.234563, lng: 99.856682, kp: '00+521', dof: 2541.62 },
    { pos: 'JP1 Point 1', phase: 'C', lat: 9.234533, lng: 99.856718, kp: '00+521', dof: 2541.62 },
    { pos: 'JP1 Point 2', phase: 'A', lat: 9.234620, lng: 99.856682, kp: '00+525', dof: 2545.71 },
    { pos: 'JP1 Point 2', phase: 'B', lat: 9.234585, lng: 99.856705, kp: '00+525', dof: 2545.71 },
    { pos: 'JP1 Point 2', phase: 'C', lat: 9.234559, lng: 99.856740, kp: '00+525', dof: 2545.71 },
    { pos: 'JP1 Point 3', phase: 'A', lat: 9.234636, lng: 99.856689, kp: '00+529', dof: 2549.79 },
    { pos: 'JP1 Point 3', phase: 'B', lat: 9.234612, lng: 99.856721, kp: '00+529', dof: 2549.79 },
    { pos: 'JP1 Point 3', phase: 'C', lat: 9.234589, lng: 99.856751, kp: '00+529', dof: 2549.79 },
    { pos: 'JP1 Point 4', phase: 'A', lat: 9.234660, lng: 99.856704, kp: '00+532', dof: 2553.87 },
    { pos: 'JP1 Point 4', phase: 'B', lat: 9.234634, lng: 99.856737, kp: '00+532', dof: 2553.87 },
    { pos: 'JP1 Point 4', phase: 'C', lat: 9.234609, lng: 99.856774, kp: '00+532', dof: 2553.87 },
  ],
  // 1.3 Land cable section 3 (LS2, 8 points/phase)
  '1.3': [
    { pos: 'LS2-Point 1', phase: 'A', lat: 9.234697, lng: 99.856718, kp: '00+572', dof: 2592.67 },
    { pos: 'LS2-Point 1', phase: 'B', lat: 9.234661, lng: 99.856761, kp: '00+572', dof: 2592.67 },
    { pos: 'LS2-Point 1', phase: 'C', lat: 9.234631, lng: 99.856805, kp: '00+572', dof: 2592.67 },
    { pos: 'LS2-Point 2', phase: 'A', lat: 9.234815, lng: 99.856804, kp: '00+590', dof: 2611.05 },
    { pos: 'LS2-Point 2', phase: 'B', lat: 9.234774, lng: 99.856854, kp: '00+590', dof: 2611.05 },
    { pos: 'LS2-Point 2', phase: 'C', lat: 9.234749, lng: 99.856902, kp: '00+590', dof: 2611.05 },
    { pos: 'LS2-Point 3', phase: 'A', lat: 9.235295, lng: 99.857201, kp: '00+662', dof: 2682.51 },
    { pos: 'LS2-Point 3', phase: 'B', lat: 9.235261, lng: 99.857262, kp: '00+662', dof: 2682.51 },
    { pos: 'LS2-Point 3', phase: 'C', lat: 9.235242, lng: 99.857303, kp: '00+662', dof: 2682.51 },
    { pos: 'LS2-Point 4', phase: 'A', lat: 9.235798, lng: 99.857549, kp: '00+727', dof: 2747.85 },
    { pos: 'LS2-Point 4', phase: 'B', lat: 9.235761, lng: 99.857608, kp: '00+727', dof: 2747.85 },
    { pos: 'LS2-Point 4', phase: 'C', lat: 9.235726, lng: 99.857658, kp: '00+727', dof: 2747.85 },
    { pos: 'LS2-Point 5', phase: 'A', lat: 9.236220, lng: 99.857859, kp: '00+786', dof: 2807.07 },
    { pos: 'LS2-Point 5', phase: 'B', lat: 9.236174, lng: 99.857927, kp: '00+786', dof: 2807.07 },
    { pos: 'LS2-Point 5', phase: 'C', lat: 9.236138, lng: 99.857985, kp: '00+786', dof: 2807.07 },
    { pos: 'LS2-Point 6', phase: 'A', lat: 9.236608, lng: 99.858112, kp: '00+837', dof: 2858.12 },
    { pos: 'LS2-Point 6', phase: 'B', lat: 9.236547, lng: 99.858205, kp: '00+837', dof: 2858.12 },
    { pos: 'LS2-Point 6', phase: 'C', lat: 9.236498, lng: 99.858277, kp: '00+837', dof: 2858.12 },
    { pos: 'LS2-Point 7', phase: 'A', lat: 9.237228, lng: 99.858609, kp: '00+925', dof: 2945.92 },
    { pos: 'LS2-Point 7', phase: 'B', lat: 9.237206, lng: 99.858665, kp: '00+925', dof: 2945.92 },
    { pos: 'LS2-Point 7', phase: 'C', lat: 9.237190, lng: 99.858719, kp: '00+925', dof: 2945.92 },
    { pos: 'LS2-Point 8', phase: 'A', lat: 9.237643, lng: 99.858834, kp: '00+988', dof: 3009.22 },
    { pos: 'LS2-Point 8', phase: 'B', lat: 9.237631, lng: 99.858882, kp: '00+988', dof: 3009.22 },
    { pos: 'LS2-Point 8', phase: 'C', lat: 9.237611, lng: 99.858926, kp: '00+988', dof: 3009.22 },
  ],
  // 1.4 Land cable section 4 - Special Section 2 (JP2, 4 points/phase)
  '1.4': [
    { pos: 'JP2 Point 1', phase: 'A', lat: 9.237723, lng: 99.858878, kp: '01+027', dof: 3048.01 },
    { pos: 'JP2 Point 1', phase: 'B', lat: 9.237705, lng: 99.858909, kp: '01+027', dof: 3048.01 },
    { pos: 'JP2 Point 1', phase: 'C', lat: 9.237683, lng: 99.858942, kp: '01+027', dof: 3048.01 },
    { pos: 'JP2 Point 2', phase: 'A', lat: 9.237751, lng: 99.858887, kp: '01+029', dof: 3050.06 },
    { pos: 'JP2 Point 2', phase: 'B', lat: 9.237738, lng: 99.858917, kp: '01+029', dof: 3050.06 },
    { pos: 'JP2 Point 2', phase: 'C', lat: 9.237721, lng: 99.858942, kp: '01+029', dof: 3050.06 },
    { pos: 'JP2 Point 3', phase: 'A', lat: 9.237782, lng: 99.858911, kp: '01+033', dof: 3054.14 },
    { pos: 'JP2 Point 3', phase: 'B', lat: 9.237759, lng: 99.858939, kp: '01+033', dof: 3054.14 },
    { pos: 'JP2 Point 3', phase: 'C', lat: 9.237736, lng: 99.858969, kp: '01+033', dof: 3054.14 },
    { pos: 'JP2 Point 4', phase: 'A', lat: 9.237790, lng: 99.858914, kp: '01+039', dof: 3060.27 },
    { pos: 'JP2 Point 4', phase: 'B', lat: 9.237771, lng: 99.858946, kp: '01+039', dof: 3060.27 },
    { pos: 'JP2 Point 4', phase: 'C', lat: 9.237748, lng: 99.858972, kp: '01+039', dof: 3060.27 },
  ],
  // 1.5 Land cable section 5 (LS3, 8 points/phase)
  '1.5': [
    { pos: 'LS3-Point 1', phase: 'A', lat: 9.238377, lng: 99.859311, kp: '01+041', dof: 3068.43 },
    { pos: 'LS3-Point 1', phase: 'B', lat: 9.238339, lng: 99.859408, kp: '01+041', dof: 3068.43 },
    { pos: 'LS3-Point 1', phase: 'C', lat: 9.238288, lng: 99.859462, kp: '01+041', dof: 3068.43 },
    { pos: 'LS3-Point 2', phase: 'A', lat: 9.238696, lng: 99.859581, kp: '01+074', dof: 3094.98 },
    { pos: 'LS3-Point 2', phase: 'B', lat: 9.238640, lng: 99.859636, kp: '01+074', dof: 3094.98 },
    { pos: 'LS3-Point 2', phase: 'C', lat: 9.238592, lng: 99.859702, kp: '01+074', dof: 3094.98 },
    { pos: 'LS3-Point 3', phase: 'A', lat: 9.238975, lng: 99.859953, kp: '01+156', dof: 3176.65 },
    { pos: 'LS3-Point 3', phase: 'B', lat: 9.238892, lng: 99.860018, kp: '01+156', dof: 3176.65 },
    { pos: 'LS3-Point 3', phase: 'C', lat: 9.238835, lng: 99.860072, kp: '01+156', dof: 3176.65 },
    { pos: 'LS3-Point 4', phase: 'A', lat: 9.239236, lng: 99.860048, kp: '01+182', dof: 3203.2 },
    { pos: 'LS3-Point 4', phase: 'B', lat: 9.239161, lng: 99.860133, kp: '01+182', dof: 3203.2 },
    { pos: 'LS3-Point 4', phase: 'C', lat: 9.239073, lng: 99.860246, kp: '01+182', dof: 3203.2 },
    { pos: 'LS3-Point 5', phase: 'A', lat: 9.239494, lng: 99.860381, kp: '01+205', dof: 3225.66 },
    { pos: 'LS3-Point 5', phase: 'B', lat: 9.239424, lng: 99.860499, kp: '01+205', dof: 3225.66 },
    { pos: 'LS3-Point 5', phase: 'C', lat: 9.239368, lng: 99.860559, kp: '01+205', dof: 3225.66 },
    { pos: 'LS3-Point 6', phase: 'A', lat: 9.239947, lng: 99.860731, kp: '01+278', dof: 3299.17 },
    { pos: 'LS3-Point 6', phase: 'B', lat: 9.239891, lng: 99.860838, kp: '01+278', dof: 3299.17 },
    { pos: 'LS3-Point 6', phase: 'C', lat: 9.239833, lng: 99.860971, kp: '01+278', dof: 3299.17 },
    { pos: 'LS3-Point 7', phase: 'A', lat: 9.240567, lng: 99.861452, kp: '01+374', dof: 3395.14 },
    { pos: 'LS3-Point 7', phase: 'B', lat: 9.240475, lng: 99.861553, kp: '01+374', dof: 3395.14 },
    { pos: 'LS3-Point 7', phase: 'C', lat: 9.240384, lng: 99.861647, kp: '01+374', dof: 3395.14 },
    { pos: 'LS3-Point 8', phase: 'A', lat: 9.240922, lng: 99.861945, kp: '01+429', dof: 3450.27 },
    { pos: 'LS3-Point 8', phase: 'B', lat: 9.240818, lng: 99.862031, kp: '01+429', dof: 3450.27 },
    { pos: 'LS3-Point 8', phase: 'C', lat: 9.240696, lng: 99.862119, kp: '01+429', dof: 3450.27 },
  ],
  // 1.6 Land cable section 6 - Special Section 3 (TJ1, 6 points/phase)
  '1.6': [
    { pos: 'TJ1-Point 1', phase: 'A', lat: 9.240997, lng: 99.862130, kp: '01+431', dof: 3452.31 },
    { pos: 'TJ1-Point 1', phase: 'B', lat: 9.240877, lng: 99.862213, kp: '01+431', dof: 3452.31 },
    { pos: 'TJ1-Point 1', phase: 'C', lat: 9.240787, lng: 99.862284, kp: '01+431', dof: 3452.31 },
    { pos: 'TJ1-Point 2', phase: 'A', lat: 9.241056, lng: 99.862205, kp: '01+435', dof: 3456.39 },
    { pos: 'TJ1-Point 2', phase: 'B', lat: 9.240968, lng: 99.862242, kp: '01+435', dof: 3456.39 },
    { pos: 'TJ1-Point 2', phase: 'C', lat: 9.240869, lng: 99.862287, kp: '01+435', dof: 3456.39 },
    { pos: 'TJ1-Point 3', phase: 'A', lat: 9.241101, lng: 99.862256, kp: '01+437', dof: 3458.44 },
    { pos: 'TJ1-Point 3', phase: 'B', lat: 9.240993, lng: 99.862325, kp: '01+437', dof: 3458.44 },
    { pos: 'TJ1-Point 3', phase: 'C', lat: 9.240901, lng: 99.862397, kp: '01+437', dof: 3458.44 },
    { pos: 'TJ1-Point 4', phase: 'A', lat: 9.241152, lng: 99.862315, kp: '01+439', dof: 3460.48 },
    { pos: 'TJ1-Point 4', phase: 'B', lat: 9.241048, lng: 99.862382, kp: '01+439', dof: 3460.48 },
    { pos: 'TJ1-Point 4', phase: 'C', lat: 9.240915, lng: 99.862450, kp: '01+439', dof: 3460.48 },
    { pos: 'TJ1-Point 5', phase: 'A', lat: 9.241192, lng: 99.862387, kp: '01+441', dof: 3462.52 },
    { pos: 'TJ1-Point 5', phase: 'B', lat: 9.241092, lng: 99.862436, kp: '01+441', dof: 3462.52 },
    { pos: 'TJ1-Point 5', phase: 'C', lat: 9.240986, lng: 99.862486, kp: '01+441', dof: 3462.52 },
    { pos: 'TJ1-Point 6', phase: 'A', lat: 9.241251, lng: 99.862395, kp: '01+443', dof: 3464.56 },
    { pos: 'TJ1-Point 6', phase: 'B', lat: 9.241124, lng: 99.862458, kp: '01+443', dof: 3464.56 },
    { pos: 'TJ1-Point 6', phase: 'C', lat: 9.240980, lng: 99.862535, kp: '01+443', dof: 3464.56 },
  ],
  // 2.1 Submarine cable zone 1 - Special Section 1 (Bottleneck, 6 points)
  '2.1': [
    { pos: 'Zone1BTN-Point 1', phase: 'SM', lat: 9.24106740662338, lng: 99.8626185674284, kp: '00+000', dof: 2691.75 },
    { pos: 'Zone1BTN-Point 2', phase: 'SM', lat: 9.24127488442481, lng: 99.8629161081777, kp: '00+033', dof: 2724.42 },
    { pos: 'Zone1BTN-Point 3', phase: 'SM', lat: 9.24137051522082, lng: 99.863070548405, kp: '00+066', dof: 2757.09 },
    { pos: 'Zone1BTN-Point 4', phase: 'SM', lat: 9.2415165051372, lng: 99.8632315746058, kp: '00+099', dof: 2789.76 },
    { pos: 'Zone1BTN-Point 5', phase: 'SM', lat: 9.24157451572919, lng: 99.8637608368589, kp: '00+130', dof: 2822.43 },
    { pos: 'Zone1BTN-Point 6', phase: 'SM', lat: 9.24160641713544, lng: 99.8639399281758, kp: '00+160', dof: 2855.1 },
  ],
  // 2.2 Submarine cable zone 2 - Normal section 1 (13 points)
  '2.2': [
    { pos: 'Zone2NM1-Point 1', phase: 'SM', lat: 9.24275655309627, lng: 99.8652869536429, kp: '00+360', dof: 3051.12 },
    { pos: 'Zone2NM1-Point 2', phase: 'SM', lat: 9.25108751029708, lng: 99.8660920179093, kp: '01+307', dof: 3998.57 },
    { pos: 'Zone2NM1-Point 3', phase: 'SM', lat: 9.26031109299905, lng: 99.8662449113134, kp: '02+320', dof: 5011.35 },
    { pos: 'Zone2NM1-Point 4', phase: 'SM', lat: 9.26917297102895, lng: 99.8663918954527, kp: '03+300', dof: 5991.47 },
    { pos: 'Zone2NM1-Point 5', phase: 'SM', lat: 9.27839649765637, lng: 99.8665448936418, kp: '04+312', dof: 7004.25 },
    { pos: 'Zone2NM1-Point 6', phase: 'SM', lat: 9.28743923729577, lng: 99.866694928601, kp: '05+325', dof: 8017.04 },
    { pos: 'Zone2NM1-Point 7', phase: 'SM', lat: 9.29630109982002, lng: 99.8668419983739, kp: '06+305', dof: 8997.15 },
    { pos: 'Zone2NM1-Point 8', phase: 'SM', lat: 9.30552465551476, lng: 99.8669950858408, kp: '07+318', dof: 10009.94 },
    { pos: 'Zone2NM1-Point 9', phase: 'SM', lat: 9.31456733408534, lng: 99.8671452081467, kp: '08+330', dof: 11022.72 },
    { pos: 'Zone2NM1-Point 10', phase: 'SM', lat: 9.32324830954273, lng: 99.8672893676017, kp: '09+278', dof: 11970.16 },
    { pos: 'Zone2NM1-Point 11', phase: 'SM', lat: 9.33265267534564, lng: 99.8674455403059, kp: '10+324', dof: 13015.62 },
    { pos: 'Zone2NM1-Point 12', phase: 'SM', lat: 9.34187620933135, lng: 99.8675987474405, kp: '11+337', dof: 14028.4 },
    { pos: 'Zone2NM1-Point 13', phase: 'SM', lat: 9.34784441812999, lng: 99.8676978442073, kp: '11+990', dof: 14681.81 },
  ],
  // 2.3 Submarine cable zone 3 - Special section 2 (XPWA, 3 points)
  '2.3': [
    { pos: 'Zone3XPWA-Point 1', phase: 'SM', lat: 9.35128060899161, lng: 99.8677549828356, kp: '12+382', dof: 15073.86 },
    { pos: 'Zone3XPWA-Point 2', phase: 'SM', lat: 9.35164230615519, lng: 99.8677609784855, kp: '12+414', dof: 15106.53 },
    { pos: 'Zone3XPWA-Point 3', phase: 'SM', lat: 9.35182313212411, lng: 99.867763976272, kp: '12+447', dof: 15139.2 },
  ],
  // 2.4 Submarine cable zone 4 - Normal section 2 (20 points)
  '2.4': [
    { pos: 'Zone4NM2-Point 1', phase: 'SM', lat: 9.3606099479176, lng: 99.8687015749792, kp: '13+427', dof: 16119.31 },
    { pos: 'Zone4NM2-Point 2', phase: 'SM', lat: 9.36963723563484, lng: 99.8706130461476, kp: '14+440', dof: 17132.1 },
    { pos: 'Zone4NM2-Point 3', phase: 'SM', lat: 9.37866449930923, lng: 99.8725247276696, kp: '15+453', dof: 18144.88 },
    { pos: 'Zone4NM2-Point 4', phase: 'SM', lat: 9.38751475244234, lng: 99.8743990198058, kp: '16+465', dof: 19157.67 },
    { pos: 'Zone4NM2-Point 5', phase: 'SM', lat: 9.39618799637865, lng: 99.876235915802, kp: '17+446', dof: 20137.78 },
    { pos: 'Zone4NM2-Point 6', phase: 'SM', lat: 9.40521523501377, lng: 99.8781479491527, kp: '18+458', dof: 21150.57 },
    { pos: 'Zone4NM2-Point 7', phase: 'SM', lat: 9.4142424047008, lng: 99.8800600111891, kp: '19+471', dof: 22163.35 },
    { pos: 'Zone4NM2-Point 8', phase: 'SM', lat: 9.422916587845, lng: 99.8818922414402, kp: '20+451', dof: 23143.47 },
    { pos: 'Zone4NM2-Point 9', phase: 'SM', lat: 9.43191184617549, lng: 99.8828071258117, kp: '21+464', dof: 24156.25 },
    { pos: 'Zone4NM2-Point 10', phase: 'SM', lat: 9.44110013538219, lng: 99.883631579064, kp: '22+477', dof: 25169.04 },
    { pos: 'Zone4NM2-Point 11', phase: 'SM', lat: 9.45010825615197, lng: 99.8844399262761, kp: '23+490', dof: 26181.82 },
    { pos: 'Zone4NM2-Point 12', phase: 'SM', lat: 9.45929652423882, lng: 99.8852645104883, kp: '24+502', dof: 27194.61 },
    { pos: 'Zone4NM2-Point 13', phase: 'SM', lat: 9.46794430943033, lng: 99.8860406824289, kp: '25+450', dof: 28142.05 },
    { pos: 'Zone4NM2-Point 14', phase: 'SM', lat: 9.47695239961093, lng: 99.8868492193349, kp: '26+463', dof: 29154.83 },
    { pos: 'Zone4NM2-Point 15', phase: 'SM', lat: 9.48614063646705, lng: 99.8876739972309, kp: '27+475', dof: 30167.62 },
    { pos: 'Zone4NM2-Point 16', phase: 'SM', lat: 9.4949685489947, lng: 99.8884665301053, kp: '28+455', dof: 31147.73 },
    { pos: 'Zone4NM2-Point 17', phase: 'SM', lat: 9.50379645174247, lng: 99.8892590788115, kp: '29+436', dof: 32127.85 },
    { pos: 'Zone4NM2-Point 18', phase: 'SM', lat: 9.51316485883982, lng: 99.8901002321308, kp: '30+481', dof: 33173.3 },
    { pos: 'Zone4NM2-Point 19', phase: 'SM', lat: 9.52199274104592, lng: 99.8908929530942, kp: '31+461', dof: 34153.42 },
    { pos: 'Zone4NM2-Point 20', phase: 'SM', lat: 9.5302801002896, lng: 99.8916371849091, kp: '32+376', dof: 35068.19 },
  ],
  // 2.5 Submarine cable zone 5 - Special section 3 (NX2, 3 points)
  '2.5': [
    { pos: 'Zone5NX2-Point 1', phase: 'SM', lat: 9.53046030156892, lng: 99.8916533229799, kp: '32+410', dof: 35100.86 },
    { pos: 'Zone5NX2-Point 2', phase: 'SM', lat: 9.5308206134449, lng: 99.8916856900696, kp: '32+441', dof: 35133.53 },
    { pos: 'Zone5NX2-Point 3', phase: 'SM', lat: 9.53118092530432, lng: 99.8917180572619, kp: '32+474', dof: 35166.2 },
  ],
  // 2.6 Submarine cable zone 6 - Special section 4 (NX1, 3 points)
  '2.6': [
    { pos: 'Zone6NX1-Point 1', phase: 'SM', lat: 9.53172139306242, lng: 99.891766608243, kp: '32+539', dof: 35231.54 },
    { pos: 'Zone6NX1-Point 2', phase: 'SM', lat: 9.53208170488047, lng: 99.891798975692, kp: '32+572', dof: 35264.21 },
    { pos: 'Zone6NX1-Point 3', phase: 'SM', lat: 9.53226190600189, lng: 99.8918151595725, kp: '32+605', dof: 35296.88 },
  ],
  // 2.7 Submarine cable zone 7 - Normal section 3 (NM3, 1 point)
  '2.7': [
    { pos: 'Zone7NM3-Point 1', phase: 'SM', lat: 9.53496428949936, lng: 99.8920578281097, kp: '32+900', dof: 35590.92 },
  ],
  // 2.8 Submarine cable zone 8 - Special section 5 (FR1, 3 points)
  '2.8': [
    { pos: 'Zone8FR1-Point 1', phase: 'SM', lat: 9.54163023392093, lng: 99.8926565234571, kp: '33+650', dof: 36342.34 },
    { pos: 'Zone8FR1-Point 2', phase: 'SM', lat: 9.54199054528361, lng: 99.8926888937315, kp: '33+683', dof: 36375.01 },
    { pos: 'Zone8FR1-Point 3', phase: 'SM', lat: 9.54235085674652, lng: 99.8927212185542, kp: '33+715', dof: 36407.68 },
  ],
  // 2.9 Submarine cable zone 9 - Special section 6 (FR2, 3 points)
  '2.9': [
    { pos: 'Zone9FR2-Point 1', phase: 'SM', lat: 9.54289136895317, lng: 99.8927697744304, kp: '33+781', dof: 36473.02 },
    { pos: 'Zone9FR2-Point 2', phase: 'SM', lat: 9.54325168025786, lng: 99.8928021450646, kp: '33+813', dof: 36505.69 },
    { pos: 'Zone9FR2-Point 3', phase: 'SM', lat: 9.54343183590399, lng: 99.8928183304202, kp: '33+846', dof: 36538.36 },
  ],
  // 2.10 Submarine cable zone 10 - Normal section 4 (NM4, 15 points)
  '2.10': [
    { pos: 'Zone10NM4-Point 1', phase: 'SM', lat: 9.55006286424693, lng: 99.8941386737184, kp: '34+598', dof: 37289.78 },
    { pos: 'Zone10NM4-Point 2', phase: 'SM', lat: 9.5584921734244, lng: 99.8969198692745, kp: '35+610', dof: 38302.57 },
    { pos: 'Zone10NM4-Point 3', phase: 'SM', lat: 9.56674886907487, lng: 99.8976118891605, kp: '36+590', dof: 39282.68 },
    { pos: 'Zone10NM4-Point 4', phase: 'SM', lat: 9.57303443119413, lng: 99.9044141745752, kp: '37+603', dof: 40295.47 },
    { pos: 'Zone10NM4-Point 5', phase: 'SM', lat: 9.57907332517903, lng: 99.9109500752457, kp: '38+583', dof: 41275.58 },
    { pos: 'Zone10NM4-Point 6', phase: 'SM', lat: 9.58535853052105, lng: 99.9177529390073, kp: '39+596', dof: 42288.37 },
    { pos: 'Zone10NM4-Point 7', phase: 'SM', lat: 9.59108229217689, lng: 99.9245519339066, kp: '40+576', dof: 43268.48 },
    { pos: 'Zone10NM4-Point 8', phase: 'SM', lat: 9.59452852166891, lng: 99.9323436826564, kp: '41+524', dof: 44215.92 },
    { pos: 'Zone10NM4-Point 9', phase: 'SM', lat: 9.59550440594155, lng: 99.940826354569, kp: '42+471', dof: 45163.37 },
    { pos: 'Zone10NM4-Point 10', phase: 'SM', lat: 9.59575906931246, lng: 99.9504818885029, kp: '43+517', dof: 46208.82 },
    { pos: 'Zone10NM4-Point 11', phase: 'SM', lat: 9.59601824736884, lng: 99.9603195770651, kp: '44+595', dof: 47286.95 },
    { pos: 'Zone10NM4-Point 12', phase: 'SM', lat: 9.59625797816523, lng: 99.9694285416682, kp: '45+607', dof: 48299.73 },
    { pos: 'Zone10NM4-Point 13', phase: 'SM', lat: 9.5964543929461, lng: 99.9768979080597, kp: '46+424', dof: 49116.5 },
    { pos: 'Zone10NM4-Point 14', phase: 'SM', lat: 9.59669845690941, lng: 99.9861890181447, kp: '47+437', dof: 50129.28 },
    { pos: 'Zone10NM4-Point 15', phase: 'SM', lat: 9.59604657910901, lng: 99.9953939892626, kp: '48+450', dof: 51142.07 },
  ],
  // 2.11 Submarine cable zone 11 - Special section 7 (X33kV, 4 points)
  '2.11': [
    { pos: 'Zone11X33kV-Point 1', phase: 'SM', lat: 9.59541529324561, lng: 99.9969047563475, kp: '48+646', dof: 51338.09 },
    { pos: 'Zone11X33kV-Point 2', phase: 'SM', lat: 9.5952508975142, lng: 99.9972293955343, kp: '48+679', dof: 51370.76 },
    { pos: 'Zone11X33kV-Point 3', phase: 'SM', lat: 9.59507796834712, lng: 99.9975495445057, kp: '48+711', dof: 51403.43 },
    { pos: 'Zone11X33kV-Point 4', phase: 'SM', lat: 9.59466849972102, lng: 99.9982360813231, kp: '48+809', dof: 51501.44 },
  ],
  // 2.12 Submarine cable zone 12 - Normal section 5 (NM5, 6 points)
  '2.12': [
    { pos: 'Zone12NM5-Point 1', phase: 'SM', lat: 9.59021350015152, lng: 100.002585715019, kp: '49+495', dof: 52187.52 },
    { pos: 'Zone12NM5-Point 2', phase: 'SM', lat: 9.58843742639705, lng: 100.003484990832, kp: '49+724', dof: 52416.21 },
    { pos: 'Zone12NM5-Point 3', phase: 'SM', lat: 9.58025290357467, lng: 100.004514524958, kp: '50+639', dof: 53330.99 },
    { pos: 'Zone12NM5-Point 4', phase: 'SM', lat: 9.57265820080602, lng: 100.00446432349, kp: '51+488', dof: 54180.42 },
    { pos: 'Zone12NM5-Point 5', phase: 'SM', lat: 9.5690548537629, lng: 100.004485994539, kp: '51+880', dof: 54572.47 },
    { pos: 'Zone12NM5-Point 6', phase: 'SM', lat: 9.56887457614205, lng: 100.004500180015, kp: '51+978', dof: 54670.48 },
  ],
  // 2.13 Submarine cable zone 13 - Normal section 6 (NM6, 3 points)
  '2.13': [
    { pos: 'Zone13NM6-Point 1', phase: 'SM', lat: 9.568860, lng: 100.004510, kp: '52+142', dof: 54833.83 },
    { pos: 'Zone13NM6-Point 2', phase: 'SM', lat: 9.568801, lng: 100.004529, kp: '52+240', dof: 54931.84 },
    { pos: 'Zone13NM6-Point 3', phase: 'SM', lat: 9.568749, lng: 100.004551, kp: '52+534', dof: 55225.87 },
  ],
};

// Build complete CIRCUIT_3_SAMPLING_POINTS array (114 Land + 81 Submarine = 195 points)
export const CIRCUIT_3_SECTIONS = CABLE_SECTIONS.map((s) => ({
  ...s,
  id: s.sectionId,
  type: s.sectionType,
}));

export const CIRCUIT_3_SAMPLING_POINTS: CableSamplingPoint[] = CABLE_SECTIONS.flatMap((sec) => {
  const rawPts = RAW_SECTION_POINTS[sec.sectionId] || [];
  return rawPts.map((pt) => {
    const dabMeters = kpToMeters(pt.kp);
    return {
      id: `${pt.pos.replace(/\s+/g, '-')}-${pt.phase}`,
      pos: pt.pos,
      phase: pt.phase,
      sectionId: sec.sectionId,
      sectionName: sec.name,
      sectionType: sec.sectionType,
      cableCategory: sec.category,
      latitude: pt.lat,
      longitude: pt.lng,
      kp: Number((dabMeters / 1000).toFixed(3)),
      kpFormatted: pt.kp,
      dab: dabMeters,
      dof: pt.dof,
      equationName: sec.equationName,
      description: `${sec.subtitle} (KP ${pt.kp})`,
    };
  });
});

// Distinct DOF array for Land Cable Phase A/B/C (38 sampling points per phase)
export const LAND_CABLE_DOFS: number[] = [
  // 1.1 LS1 (8)
  2020.94, 2055.65, 2074.03, 2135.28, 2206.75, 2300.68, 2400.73, 2490.57,
  // 1.2 JP1 (4)
  2541.62, 2545.71, 2549.79, 2553.87,
  // 1.3 LS2 (8)
  2592.67, 2611.05, 2682.51, 2747.85, 2807.07, 2858.12, 2945.92, 3009.22,
  // 1.4 JP2 (4)
  3048.01, 3050.06, 3054.14, 3060.27,
  // 1.5 LS3 (8)
  3068.43, 3094.98, 3176.65, 3203.2, 3225.66, 3299.17, 3395.14, 3450.27,
  // 1.6 TJ1 (6)
  3452.31, 3456.39, 3458.44, 3460.48, 3462.52, 3464.56,
];

// Distinct DOF array for Submarine Cable (81 sampling points)
export const SUBMARINE_CABLE_DOFS: number[] = [
  // 2.1 Zone1BTN (6)
  2691.75, 2724.42, 2757.09, 2789.76, 2822.43, 2855.1,
  // 2.2 Zone2NM1 (13)
  3051.12, 3998.57, 5011.35, 5991.47, 7004.25, 8017.04, 8997.15, 10009.94, 11022.72, 11970.16, 13015.62, 14028.4, 14681.81,
  // 2.3 Zone3XPWA (3)
  15073.86, 15106.53, 15139.2,
  // 2.4 Zone4NM2 (20)
  16119.31, 17132.1, 18144.88, 19157.67, 20137.78, 21150.57, 22163.35, 23143.47, 24156.25, 25169.04,
  26181.82, 27194.61, 28142.05, 29154.83, 30167.62, 31147.73, 32127.85, 33173.3, 34153.42, 35068.19,
  // 2.5 Zone5NX2 (3)
  35100.86, 35133.53, 35166.2,
  // 2.6 Zone6NX1 (3)
  35231.54, 35264.21, 35296.88,
  // 2.7 Zone7NM3 (1)
  35590.92,
  // 2.8 Zone8FR1 (3)
  36342.34, 36375.01, 36407.68,
  // 2.9 Zone9FR2 (3)
  36473.02, 36505.69, 36538.36,
  // 2.10 Zone10NM4 (15)
  37289.78, 38302.57, 39282.68, 40295.47, 41275.58, 42288.37, 43268.48, 44215.92, 45163.37, 46208.82,
  47286.95, 48299.73, 49116.5, 50129.28, 51142.07,
  // 2.11 Zone11X33kV (4)
  51338.09, 51370.76, 51403.43, 51501.44,
  // 2.12 Zone12NM5 (6)
  52187.52, 52416.21, 53330.99, 54180.42, 54572.47, 54670.48,
  // 2.13 Zone13TJ2 (3)
  54833.83, 54931.84, 55225.87,
];

// Fast O(1)-like lookup of sampling point by DOF and Phase
export function findPointByDof(
  dof: number,
  phase?: 'A' | 'B' | 'C' | 'SM' | string,
  tolerance = 1.0
): CableSamplingPoint | undefined {
  const isSub = phase && (phase === 'SM' || phase.toUpperCase().includes('SUBMARINE'));
  const candidates = CIRCUIT_3_SAMPLING_POINTS.filter((p) => {
    if (isSub && p.cableCategory !== 'submarine') return false;
    if (phase && !isSub && (phase === 'A' || phase === 'B' || phase === 'C' || phase.includes('Phase')) && p.cableCategory !== 'land') {
      return false;
    }
    return Math.abs(p.dof - dof) <= tolerance;
  });

  const matchingPoints = candidates.length > 0
    ? candidates
    : CIRCUIT_3_SAMPLING_POINTS.filter((p) => Math.abs(p.dof - dof) <= tolerance);

  if (matchingPoints.length === 0) return undefined;

  if (phase) {
    const phaseUpper = phase.toUpperCase();
    const phaseMatch = matchingPoints.find(
      (p) =>
        p.phase === phase ||
        (phaseUpper.includes('PHASE A') && p.phase === 'A') ||
        (phaseUpper.includes('PHASE B') && p.phase === 'B') ||
        (phaseUpper.includes('PHASE C') && p.phase === 'C') ||
        (phaseUpper === 'A' && p.phase === 'A') ||
        (phaseUpper === 'B' && p.phase === 'B') ||
        (phaseUpper === 'C' && p.phase === 'C') ||
        (phaseUpper.includes('SUBMARINE') && p.phase === 'SM')
    );
    if (phaseMatch) return phaseMatch;
  }

  return matchingPoints[0];
}

// ============================================================================
// 5 IEC 60287 EQUATIONS (ALPHA, BETA, CHARLIE, DELTA, ECHO):
// SINGLE-METHOD CONDUCTOR TEMPERATURE ESTIMATION ENGINE (Tc,60287)
// ============================================================================

export interface OperatingPowerAtTimestamp {
  hasPowerData: boolean;
  pCkt3MW?: number;          // P: Max power in 115 kV Circuit #3 during 1-hour period of Tf (KMB - 03YB01)
  pCkt2MW?: number;          // Max power in 115 kV Circuit #2 during 1-hour period of Tf (KMA - 04YB01)
  p33NktMW?: number;         // Max power in 33 kV NKT Circuit during 1-hour period of Tf (KNA - 07WB01)
  p33OfMW?: number;          // Max power in 33 kV Oil-Filled Circuit during 1-hour period of Tf (KNA - 10WB01)
  matchedTimeLabel?: string;
  // Aliases from powerConsumptionParser
  p115kVCkt3MW?: number;
  p115kVCkt2MW?: number;
  p115kVCkt1MW?: number;
  p33kVPhaNganMW?: number;
  matchedTimestamp?: string | null;
}

export interface ConductorTempEstimationResult {
  hasPowerData: boolean;
  tf: number;                 // Measured fiber optic temperature (°C) from .TEPR
  tc60287: number | null;     // Estimated conductor temperature (°C) from IEC 60287 equation (Alpha..Echo)
  equationName: ConductorEquationName; // "Alpha" | "Beta" | "Charlie" | "Delta" | "Echo"
  // Backwards-compatible aliases mapped to the single IEC 60287 conductor estimation
  tcf: number | null;
  tcl: number | null;
  tcMax: number | null;
  maxTc: number | null;
  pCkt3MW: number | null;
  pCkt2MW: number | null;
  p33NktMW: number | null;
  p33OfMW: number | null;
  statusText: string;         // e.g. "Estimated (Equation Alpha)" or "No Power Data for Date"
}

export function resolveEquationNameForSection(sectionId?: string, existingEq?: ConductorEquationName): ConductorEquationName {
  if (existingEq) return existingEq;
  if (!sectionId) return 'Alpha';
  if (sectionId === '1.1' || sectionId === '1.3' || sectionId === '1.5') return 'Alpha';
  if (sectionId === '1.2' || sectionId === '1.4' || sectionId === '1.6') return 'Beta';
  if (sectionId === '2.5' || sectionId === '2.6') return 'Delta';
  if (sectionId === '2.8' || sectionId === '2.9') return 'Echo';
  return 'Charlie'; // 2.1, 2.2, 2.3, 2.4, 2.7, 2.10, 2.11, 2.12, 2.13
}

// Evaluate IEC 60287 Conductor Temperature (Equations Alpha, Beta, Charlie, Delta, Echo)
export function estimateConductorTemperatures(
  arg1: number | Pick<CableSamplingPoint, 'sectionId' | 'equationName'> | undefined,
  arg2: number | Pick<CableSamplingPoint, 'sectionId' | 'equationName'> | undefined,
  power: OperatingPowerAtTimestamp | null | undefined
): ConductorTempEstimationResult {
  const tf = typeof arg1 === 'number' ? arg1 : (typeof arg2 === 'number' ? arg2 : 30.0);
  const point = typeof arg1 === 'object' ? arg1 : (typeof arg2 === 'object' ? arg2 : undefined);

  const equationName = resolveEquationNameForSection(point?.sectionId, point?.equationName);

  const hasPower = Boolean(power && power.hasPowerData);
  const P = hasPower ? (power!.pCkt3MW ?? power!.p115kVCkt3MW ?? 0) : 0;
  const pCkt2 = hasPower ? (power!.pCkt2MW ?? power!.p115kVCkt2MW ?? 0) : 0;
  const p33Nkt = hasPower ? (power!.p33NktMW ?? power!.p115kVCkt1MW ?? 0) : 0;
  const p33Of = hasPower ? (power!.p33OfMW ?? power!.p33kVPhaNganMW ?? 0) : 0;
  const P2 = P * P;

  // Calculate Tc,60287 using the section's designated IEC 60287 equation (Alpha, Beta, Charlie, Delta, Echo)
  let tcVal = tf;
  switch (equationName) {
    case 'Alpha': // Land Cable Section 1, 3, 5 (1.1, 1.3, 1.5)
      tcVal = (tf + 0.07219 + (4.3080e-4 * P2)) / (1 - (1.8375e-6 * P2));
      break;
    case 'Beta': // Land Cable Section 2, 4, 6 (Joint JP1, JP2, and TJ1: 1.2, 1.4, 1.6)
      tcVal = (tf + 0.018007 + (8.1610e-4 * P2)) / (1 - (3.4809e-6 * P2));
      break;
    case 'Charlie': // Submarine Cable Zone 1–4, 7, 10–13 (2.1, 2.2, 2.3, 2.4, 2.7, 2.10, 2.11, 2.12, 2.13)
      tcVal = (tf + 0.14625 + (1.1577e-3 * P2)) / (1 - (4.9379e-6 * P2));
      break;
    case 'Delta': // Submarine Cable Zone 5–6 (Nexans Subsea Joint 1–2: 2.5, 2.6)
      tcVal = (tf + 0.20022 + (2.3412e-3 * P2)) / (1 - (6.8648e-6 * P2));
      break;
    case 'Echo': // Submarine Cable Zone 8–9 (Furukawa Subsea Joint 1–2: 2.8, 2.9)
      tcVal = (tf + 0.26185 + (3.097e-3 * P2)) / (1 - (7.8565e-6 * P2));
      break;
    default:
      tcVal = (tf + 0.07219 + (4.3080e-4 * P2)) / (1 - (1.8375e-6 * P2));
  }

  const finalTc = Number(tcVal.toFixed(4));

  return {
    hasPowerData: true,
    tf,
    tc60287: finalTc,
    equationName,
    tcf: finalTc,
    tcl: finalTc,
    tcMax: finalTc,
    maxTc: finalTc,
    pCkt3MW: Number(P.toFixed(2)),
    pCkt2MW: Number(pCkt2.toFixed(2)),
    p33NktMW: Number(p33Nkt.toFixed(2)),
    p33OfMW: Number(p33Of.toFixed(2)),
    statusText: 'Estimated (IEC Estimation)',
  };
}

// ============================================================================
// 6-ZONE TEMPERATURE CRITERIA & COLOR CLASSIFICATION
// 1. Critical Zone (Dark Red):   > 70 °C
// 2. Danger Zone (Light Red):    60 – 70 °C
// 3. Alert Zone (Orange):        55 – 60 °C
// 4. Monitoring Zone (Yellow):   45 – 55 °C
// 5. Normal Zone (Green):        35 – 45 °C
// 6. Cool Zone (Light Blue):     < 35 °C
// ============================================================================

export type ThermalZoneKey =
  | 'cool'
  | 'normal'
  | 'monitoring'
  | 'alert'
  | 'danger'
  | 'critical';

export interface ThermalZoneInfo {
  key: ThermalZoneKey;
  label: string;
  name: string; // Alias for label
  shortLabel: string;
  rangeText: string;
  minTemp: number;
  maxTemp: number;
  hexColor: string;
  color: string; // Alias for hexColor
  badgeBgClass: string;
  badgeTextClass: string;
  badgeBorderClass: string;
  legacyStatus: 'normal' | 'warning' | 'critical';
  riskLevel: number; // 1 (lowest) to 6 (highest)
}

export const THERMAL_ZONES_6: ThermalZoneInfo[] = [
  {
    key: 'cool',
    label: 'Cool Zone',
    name: 'Cool Zone',
    shortLabel: 'Cool',
    rangeText: '< 35°C',
    minTemp: -Infinity,
    maxTemp: 35,
    hexColor: '#38bdf8', // Light Blue
    color: '#38bdf8',
    badgeBgClass: 'bg-sky-500/15',
    badgeTextClass: 'text-sky-600',
    badgeBorderClass: 'border-sky-400/40',
    legacyStatus: 'normal',
    riskLevel: 1,
  },
  {
    key: 'normal',
    label: 'Normal Zone',
    name: 'Normal Zone',
    shortLabel: 'Normal',
    rangeText: '35 – 45°C',
    minTemp: 35,
    maxTemp: 45,
    hexColor: '#10b981', // Green
    color: '#10b981',
    badgeBgClass: 'bg-emerald-500/15',
    badgeTextClass: 'text-emerald-600',
    badgeBorderClass: 'border-emerald-400/40',
    legacyStatus: 'normal',
    riskLevel: 2,
  },
  {
    key: 'monitoring',
    label: 'Monitoring Zone',
    name: 'Monitoring Zone',
    shortLabel: 'Monitoring',
    rangeText: '45 – 55°C',
    minTemp: 45,
    maxTemp: 55,
    hexColor: '#eab308', // Yellow
    color: '#eab308',
    badgeBgClass: 'bg-yellow-500/15',
    badgeTextClass: 'text-yellow-700',
    badgeBorderClass: 'border-yellow-400/50',
    legacyStatus: 'warning',
    riskLevel: 3,
  },
  {
    key: 'alert',
    label: 'Alert Zone',
    name: 'Alert Zone',
    shortLabel: 'Alert',
    rangeText: '55 – 60°C',
    minTemp: 55,
    maxTemp: 60,
    hexColor: '#f97316', // Orange
    color: '#f97316',
    badgeBgClass: 'bg-orange-500/15',
    badgeTextClass: 'text-orange-700',
    badgeBorderClass: 'border-orange-400/50',
    legacyStatus: 'warning',
    riskLevel: 4,
  },
  {
    key: 'danger',
    label: 'Danger Zone',
    name: 'Danger Zone',
    shortLabel: 'Danger',
    rangeText: '60 – 70°C',
    minTemp: 60,
    maxTemp: 70,
    hexColor: '#ef4444', // Light Red
    color: '#ef4444',
    badgeBgClass: 'bg-red-500/15',
    badgeTextClass: 'text-red-600',
    badgeBorderClass: 'border-red-400/50',
    legacyStatus: 'critical',
    riskLevel: 5,
  },
  {
    key: 'critical',
    label: 'Critical Zone',
    name: 'Critical Zone',
    shortLabel: 'Critical',
    rangeText: '> 70°C',
    minTemp: 70,
    maxTemp: Infinity,
    hexColor: '#991b1b', // Dark Red
    color: '#991b1b',
    badgeBgClass: 'bg-rose-950/20',
    badgeTextClass: 'text-rose-900',
    badgeBorderClass: 'border-rose-800/60',
    legacyStatus: 'critical',
    riskLevel: 6,
  },
];

export const THERMAL_ZONE_CRITERIA = THERMAL_ZONES_6;

export function getThermalZoneInfo(tempC: number): ThermalZoneInfo {
  if (tempC > 70) return THERMAL_ZONES_6[5]; // Critical Zone (Dark Red)
  if (tempC >= 60) return THERMAL_ZONES_6[4]; // Danger Zone (Light Red)
  if (tempC >= 55) return THERMAL_ZONES_6[3]; // Alert Zone (Orange)
  if (tempC >= 45) return THERMAL_ZONES_6[2]; // Monitoring Zone (Yellow)
  if (tempC >= 35) return THERMAL_ZONES_6[1]; // Normal Zone (Green)
  return THERMAL_ZONES_6[0]; // Cool Zone (Light Blue)
}

export interface CableSectionDefinition {
  sectionNumber: number;
  sectionName: string;
  segment: 'Khanom Land' | 'Submarine Cable' | 'Koh Samui Land';
  installationType:
    | 'Land Conduit'
    | 'Direct Buried'
    | 'Transition Joint'
    | 'Pipe Crossing'
    | 'Cable Crossing'
    | 'Submarine Deep';
  equationName: ConductorEquationName;
  startDof: number;
  endDof: number;
  lengthMeters: number;
  samplingPoints: Array<{
    pointId: string;
    dofMeter: number;
    latitude: number;
    longitude: number;
  }>;
}

export const CABLE_CIRCUIT_SECTIONS: CableSectionDefinition[] = CABLE_SECTIONS.map((sec, idx) => {
  const samplingPts = CIRCUIT_3_SAMPLING_POINTS.filter(
    (p) => p.cableCategory === sec.category && p.sectionId === sec.sectionId
  );
  const dofs = samplingPts.map((p) => p.dof);
  const startDof = dofs.length > 0 ? Math.min(...dofs) : 0;
  const endDof = dofs.length > 0 ? Math.max(...dofs) : 0;
  return {
    sectionNumber: idx + 1,
    sectionName: `${sec.sectionId} - ${sec.name}`,
    segment: sec.category === 'land' ? 'Khanom Land' : 'Submarine Cable',
    installationType: sec.category === 'land' ? 'Land Conduit' : 'Submarine Deep',
    equationName: sec.equationName,
    startDof,
    endDof,
    lengthMeters: sec.lengthMeters,
    samplingPoints: samplingPts.map((pt, pIdx) => ({
      pointId: `p${pIdx + 1}`,
      dofMeter: pt.dof,
      latitude: pt.latitude,
      longitude: pt.longitude,
    })),
  };
});

export function evaluateSectionConductorTemp(
  section: CableSectionDefinition | { equationName: ConductorEquationName; [key: string]: any },
  fiberTempC: number,
  pCkt3MW: number,
  pCkt2MW = 0,
  p33NktMW = 0,
  p33OilMW = 0
): {
  tc60287: number;
  equationName: ConductorEquationName;
  pCkt3MW: number;
} {
  const eq = section.equationName || 'Alpha';
  const P = Math.max(0, pCkt3MW);
  const P2 = P * P;
  let tc = fiberTempC;

  switch (eq) {
    case 'Alpha':
      tc = (fiberTempC + 0.07219 + (4.308e-4 * P2)) / (1 - (1.8375e-6 * P2));
      break;
    case 'Beta':
      tc = (fiberTempC + 0.018007 + (8.161e-4 * P2)) / (1 - (3.4809e-6 * P2));
      break;
    case 'Charlie':
      tc = (fiberTempC + 0.14625 + (1.1577e-3 * P2)) / (1 - (4.9379e-6 * P2));
      break;
    case 'Delta':
      tc = (fiberTempC + 0.20022 + (2.3412e-3 * P2)) / (1 - (6.8648e-6 * P2));
      break;
    case 'Echo':
      tc = (fiberTempC + 0.26185 + (3.097e-3 * P2)) / (1 - (7.8565e-6 * P2));
      break;
    default:
      tc = (fiberTempC + 0.07219 + (4.308e-4 * P2)) / (1 - (1.8375e-6 * P2));
  }

  return {
    tc60287: Number(tc.toFixed(4)),
    equationName: eq,
    pCkt3MW: Number(P.toFixed(2)),
  };
}

