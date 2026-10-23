# Implementation Plan: Organization Dashboard & Public Access Upgrade (Revised)

## 1. Executive Summary & Revised Requirements

We are upgrading the **Koh Samui 115 kV Submarine Cable DTS & Conductor Thermal Monitoring System** from an in-house engineering tool into a dual-tier **Organization Dashboard**.

### Key Revisions from User Feedback:
1. **Top-Center Global Header**: The public dashboard title **"Koh Samui DTS & Power Monitoring Dashboard"** is centered at the very top.
2. **Compact Top-Right Authentication**: Login button and "Open in new tab" button are minimized in size and positioned strictly at the top-right corner.
3. **No Public Mode Switcher**: Removed any external mode switchers. Unauthorized users cannot enter the internal suite; the **only** way to enter Pages 1–7 (Internal Engineering Suite) is via authenticated admin login.
4. **YouTube-Style Left Sidebar Navigation**: The 4 public dashboard tabs are placed on the left side in a collapsible/expandable YouTube-style sidebar (compact icon strip when unselected/minimized, expandable with clear labels).
5. **No Database = Clean Empty State**: If no database has been uploaded/configured yet by an admin, the system displays a clear message informing users and admins that **no database has been uploaded yet**, rather than rendering placeholder or estimated numbers.
6. **Persistent Admin Database Configuration**: Admin sets the permanent target folder or uploads the database in Page 1 (Folder & Asset) of the logged-in session, and the system permanently remembers this configuration.

---

## 2. Information Architecture & Navigation

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [≡]          Koh Samui DTS & Power Monitoring Dashboard (Top-Center)     [Sign In] [⧉] │
├──────────┬─────────────────────────────────────────────────────────────────────────────┤
│ YOUTUBE- │  MAIN VIEWPORT                                                              │
│ STYLE    │                                                                             │
│ SIDEBAR  │  Tab 2.1: Daily Maximum Heat Map Chart (Satellite DTS map & zones)          │
│          │  Tab 2.2: Daily Temperature Curve (Hourly Fiber & Conductor Temp)           │
│ [ 🗺️ ]   │  Tab 2.3: Daily Est. Conductor Temp vs Power Flow (Interactive 3D)          │
│ [ 📈 ]   │  Tab 2.4: Yearly Comparison & Growth Prediction (Daily Peak MW & Fiber Temp)│
│ [ 🧊 ]   │                                                                             │
│ [ 📅 ]   │  * If no database uploaded: Clean notification banner with admin guidelines │
└──────────┴─────────────────────────────────────────────────────────────────────────────┘
                                      │
                         [Admin Logs In via OAuth]
                                      ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  INTERNAL ENGINEERING SUITE (Pages 1 - 7)                                [Admin: Logout]│
│  Tab 1: Folder & Asset (Target Folder & Permanent Database Upload Panel)               │
│  Tab 2: Satellite Map DTS | Tab 3: Cable Chart | Tab 4: Power (4 Circuits)             │
│  Tab 5: Analyzing | Tab 6: Power vs Temp | Tab 7: Yearly Comparison                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Plan

### A. Global Header & Top-Right Auth Controls (`Header.tsx` / `App.tsx`)
- **Title**: Centered prominently: `Koh Samui DTS & Power Monitoring Dashboard` with sub-badge `115 kV Submarine Cable Transmission System (CK1 - CK4)`.
- **Top-Right Corner**:
  - Compact **"Admin Login"** button (small icon + text, reduced padding, slate/emerald styling).
  - Compact **"Open in New Tab"** icon button (`w-8 h-8 rounded-lg`).
  - When logged in as Admin: displays compact admin identity chip, link to **"Internal Engineering Suite"**, and **"Sign Out"** button.
  - **No generic mode switcher** in the public view.

### B. YouTube-Style Collapsible Left Sidebar (`PublicSidebar.tsx`)
- **Interaction**:
  - Expanded mode (width: `220px`): Full labels with icons, active state pill, section tooltips.
  - Collapsed/Minimized mode (width: `68px`): Compact icon buttons with tooltip hover labels (similar to YouTube's minimized drawer).
  - Quick toggle button (`Menu` hamburger icon) in the header or sidebar top.
- **Tabs**:
  1. **Daily Max Heat Map**: `MapPin` icon — Satellite thermal distribution & GIS submarine cable corridor.
  2. **Daily Temperature Curve**: `LineChart` icon — Hourly fiber & conductor thermal profile per section.
  3. **3D Power vs. Conductor Temp**: `Box` / `Activity` icon — Interactive 3D viewpoint combining time, max conductor temp, and coincident MW flow.
  4. **Yearly Comparison**: `CalendarRange` icon — Multi-year growth prediction and peak power trends.

### C. Public Dashboard Views (4 Dedicated Modules)

#### 1. Daily Maximum Heat Map (`PublicHeatMapPage.tsx`)
- **Concept**: Public version of Page 2 (Satellite Map DTS).
- **Data Source**: Loaded from the permanent database set by the admin (or Page 5 analysis export).
- **Features**:
  - Satellite map (Leaflet) with submarine cable routes CK1–CK4.
  - Thermal color legend (Safe, Warning, Critical thresholds).
  - Date filter selector.
  - Section/Zone breakdown (Mainland landing, deep sea, Samui landing).
  - *No database fallback*: If no database has been uploaded, display: *"No database has been uploaded. Please log in as an administrator to upload or configure the database."*

#### 2. Daily Temperature Curve (`PublicDailyCurvePage.tsx`)
- **Concept**: Hourly temperature progression throughout a selected day (similar to Page 5 Chart 1).
- **Data Source**: Uses same date selection mechanism as Folder & Asset.
- **Controls**:
  - Date picker dropdown.
  - Circuit selector (CK1, CK2, CK3, CK4).
  - **"Reading temperature"** action button.
- **Visualization**:
  - Dual curve: Measured Optical Fiber Temperature vs. Estimated Conductor Temperature.
  - Section-by-section breakdown (Khanom Mainland, Submarine Crossing, Koh Samui Landing).

#### 3. Daily Conductor Temp vs. Power Flow in 3D (`Public3DPowerTempPage.tsx`)
- **Concept**: Interactive 3-Dimensional visualization combining:
  - **X-Axis**: Time of Day (00:00 to 23:00 hourly).
  - **Y-Axis**: Estimated Conductor Temperature (Peak / Maximum °C).
  - **Z-Axis**: Power Flow at moment of heat (MW / MVA for all 4 circuits).
- **Interactive 3D Engine**:
  - Three.js / WebGL canvas with OrbitControls (drag to rotate, pinch/wheel to zoom, pan).
  - Preset POV buttons: **Isometric (Default)**, **Top View (Time vs Power)**, **Side View (Temp vs Power)**, **Front View (Time vs Temp)**.
  - Point inspection / tooltip on hover showing exact timestamp, conductor temp, and circuit MW values.
- **Controls**: Date selector + **"Gathering data"** button.

#### 4. Yearly Comparison & Power Demand Growth (`PublicYearlyComparisonPage.tsx`)
- **Concept**: Long-term trend analysis for infrastructure planning.
- **Chart 1**: Daily record fiber temperature across days/months.
- **Chart 2**: Daily maximum power consumption for each of the 4 circuits (CK1, CK2, CK3, CK4), specifically designed for future growth prediction of Koh Samui, Koh Pha Ngan, and Koh Tao.
- **Data Source**: Sourced from the permanent database.

### D. Permanent Admin Database Setting (`FolderAssetPage.tsx` / `storage.ts`)
- In Page 1 (**Folder & Asset**), add a dedicated card: **"Permanent Database Configuration"**:
  - Option A: Specify permanent target folder on Google Drive.
  - Option B: Upload compiled database file (Excel `.xlsx` / `.csv` generated from Page 5).
  - Application persists this configuration in `localStorage` under `ORGANIZATION_DATABASE_CONFIG` and indexed records under `ORG_SAVED_DATABASE_DATA`.
  - Once set, the dashboard always remembers the setting across sessions and reloads.
  - Admin can update or replace the database file at any time.

---

## 4. Implementation Steps & Verification

1. **Step 1: Permanent Database Storage Engine**
   - Create `src/utils/orgDatabaseStorage.ts` to manage loading, caching, and querying the organization database and persistent target folder.
   - Implement empty-state detection (`isDatabaseConfigured()`).

2. **Step 2: Admin Suite Gating & Header Refactoring**
   - Refactor `App.tsx` header: Centered title `Koh Samui DTS & Power Monitoring Dashboard`, compact top-right login & new tab buttons.
   - Remove public mode switcher. Default unauthenticated state is the Public Dashboard.
   - Logging in via Google OAuth unlocks the Admin Suite (Pages 1–7).

3. **Step 3: YouTube-Style Left Sidebar**
   - Build `PublicSidebar.tsx` with collapsible states (expanded `220px`, collapsed `68px`), active highlights, and tooltip support.

4. **Step 4: Build the 4 Public Dashboard Views**
   - Implement `PublicHeatMapPage.tsx` (satellite heat map with empty state guard).
   - Implement `PublicDailyCurvePage.tsx` ("Reading temperature" workflow).
   - Implement `Public3DPowerTempPage.tsx` (Three.js 3D chart with camera POV presets and data gathering button).
   - Implement `PublicYearlyComparisonPage.tsx` (daily maximum MW growth per circuit).

5. **Step 5: Admin Permanent Database Panel in Page 1**
   - Enhance Page 1 (`FolderAssetPage.tsx`) with the permanent database setup & upload card.

6. **Step 6: Validation & Compilation**
   - Ensure strict compliance with Rules of Hooks.
   - Run `compile_applet` to verify clean build.
