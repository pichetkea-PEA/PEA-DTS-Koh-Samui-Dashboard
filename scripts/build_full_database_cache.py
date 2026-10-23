import os
import sys
import zipfile
import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET

START_TIME = time.time()
print("Starting database cache builder...")

CACHE_DIR = os.path.join(os.getcwd(), ".cache", "section_profiles_by_date")
os.makedirs(CACHE_DIR, exist_ok=True)
DEFAULT_DB_FILE = os.path.join(os.getcwd(), ".dts-public-default-databases.json")

# -----------------------------------------------------------------------------
# 1. PARSE PANEL 2 (Daily Peak Power Consumption CSV)
# -----------------------------------------------------------------------------
print("\n--- Processing Panel 2 (Power CSV) ---")
P2_URL = "https://drive.usercontent.google.com/download?id=1TnB2X_ctCOsFCQ_4oBJfNMTsilSXmFP-&export=download&confirm=t"
req2 = urllib.request.Request(P2_URL, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req2) as resp:
    p2_csv_text = resp.read().decode("utf-8")

p2_lines = p2_csv_text.strip().splitlines()
print(f"Panel 2 lines: {len(p2_lines)}")

panel2_peaks = []
p2_by_date = {}

for line in p2_lines[1:]:
    parts = line.strip().split(",")
    if len(parts) < 6:
        continue
    raw_date = parts[0].strip()
    # DD/MM/YYYY or D/M/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", raw_date)
    if not m:
        continue
    d_day = m.group(1).zfill(2)
    d_mo = m.group(2).zfill(2)
    d_yr = m.group(3)
    norm_date = f"{d_yr}-{d_mo}-{d_day}"

    try:
        c3 = round(float(parts[1]), 2)
        c2 = round(float(parts[2]), 2)
        nkt = round(float(parts[3]), 2)
        oil = round(float(parts[4]), 2)
        tot = round(float(parts[5]), 2)
    except ValueError:
        continue

    item = {
        "date": norm_date,
        "year": d_yr,
        "monthDay": f"{d_mo}-{d_day}",
        "ckt3MaxMW": c3,
        "ckt2MaxMW": c2,
        "nkt33MaxMW": nkt,
        "oil33MaxMW": oil,
        "totalIslandMaxMW": tot,
        "fiberMaxTempC": 0.0,
    }
    panel2_peaks.append(item)
    p2_by_date[norm_date] = item

panel2_peaks.sort(key=lambda x: x["date"])
p2_dates = [x["date"] for x in panel2_peaks]
print(f"Panel 2 parsed {len(panel2_peaks)} peak records from {p2_dates[0]} to {p2_dates[-1]}")

p2_info = {
    "sourceType": "remote_link",
    "name": "Daily_Maximum_Power_Consumption_Database_Updated_2026-09-30_to_2026-10-18.csv",
    "remoteUrl": "https://drive.google.com/drive/folders/1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6?usp=sharing",
    "updatedAt": "2026-10-18T18:00:00.000Z",
    "totalDates": len(p2_dates),
    "dateRange": {
        "firstDate": p2_dates[0],
        "latestDate": p2_dates[-1],
    },
    "recordCount": len(panel2_peaks),
}

# -----------------------------------------------------------------------------
# 2. PARSE PANEL 1 (Daily Peak Temperature 19 Sheets XLSX)
# -----------------------------------------------------------------------------
print("\n--- Processing Panel 1 (Peak Temp XLSX) ---")
P1_URL = "https://drive.usercontent.google.com/download?id=1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N&export=download&confirm=t"
p1_local_path = "/tmp/p1.xlsx"
if not os.path.exists(p1_local_path):
    print("Downloading Panel 1 to /tmp/p1.xlsx...")
    req1 = urllib.request.Request(P1_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req1) as resp, open(p1_local_path, "wb") as f_out:
        f_out.write(resp.read())

print(f"Panel 1 file size: {os.path.getsize(p1_local_path)} bytes")

# Extract Panel 1 shared strings and sheets
p1_records = []
p1_dates_set = set()
p1_max_tf_by_date = {}

with zipfile.ZipFile(p1_local_path, "r") as z1:
    sst1 = []
    if "xl/sharedStrings.xml" in z1.namelist():
        sst_xml = z1.read("xl/sharedStrings.xml")
        root = ET.fromstring(sst_xml)
        for si in root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
            t_elem = si.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
            if t_elem is not None and t_elem.text:
                sst1.append(t_elem.text)
            else:
                txt = "".join(t.text for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t") if t.text)
                sst1.append(txt)

    wb_xml = z1.read("xl/workbook.xml")
    wb_root = ET.fromstring(wb_xml)
    p1_sheets = []
    for s in wb_root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet"):
        s_name = s.attrib["name"]
        p1_sheets.append(s_name)

    print(f"Panel 1 sheets: {len(p1_sheets)}")

    for s_idx, s_name in enumerate(p1_sheets):
        sheet_file = f"xl/worksheets/sheet{s_idx + 1}.xml"
        if sheet_file not in z1.namelist():
            continue

        raw_sec_id = re.sub(r"^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)", "", s_name).strip()

        with z1.open(sheet_file) as f_sheet:
            headers = {}
            for event, elem in ET.iterparse(f_sheet, events=("end",)):
                if elem.tag.endswith("row"):
                    r_num = int(elem.attrib.get("r", "0"))
                    cells = {}
                    for c in elem.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                        ref = c.attrib.get("r", "")
                        col = re.sub(r"[0-9]", "", ref)
                        t_type = c.attrib.get("t", "")
                        v_elem = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                        v_val = v_elem.text if v_elem is not None else ""
                        if t_type == "s" and v_val.isdigit() and int(v_val) < len(sst1):
                            val = sst1[int(v_val)]
                        else:
                            val = v_val
                        cells[col] = val

                    if r_num == 1:
                        headers = {k: v.strip() for k, v in cells.items()}
                    else:
                        # Map to header names
                        row_dict = {}
                        for col_k, col_name in headers.items():
                            row_dict[col_name] = cells.get(col_k, "")

                        d_str = row_dict.get("Date", "").strip()
                        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d_str):
                            continue
                        p1_dates_set.add(d_str)

                        phase_val = row_dict.get("Phase", "").strip()
                        # Normalize phase label
                        is_land = raw_sec_id.startswith("1.")
                        if is_land:
                            norm_phase = f"Phase {phase_val}" if phase_val in ("A", "B", "C") else (phase_val or "Phase A")
                        else:
                            norm_phase = "Submarine (CH 3)" if phase_val == "SM" else (phase_val or "Submarine (CH 3)")

                        # Collect DOF temperatures
                        dof_tf_max = {}
                        dof_tc_max = {}
                        dof_time_max = {}
                        for hk, hv in row_dict.items():
                            tf_m = re.match(r"^Tf_DOF_([\d.]+)m?_C$", hk, re.I)
                            if tf_m and hv:
                                try:
                                    f_val = round(float(hv), 2)
                                    if 0 < f_val < 150:
                                        d_key = f"{float(tf_m.group(1)):.2f}"
                                        dof_tf_max[d_key] = f_val
                                        dof_tf_max[f"{float(tf_m.group(1)):.1f}"] = f_val
                                        dof_tf_max[str(round(float(tf_m.group(1))))] = f_val
                                except ValueError:
                                    pass
                            tc_m = re.match(r"^Tc_DOF_([\d.]+)m?_C$", hk, re.I)
                            if tc_m and hv:
                                try:
                                    f_val = round(float(hv), 2)
                                    if 0 < f_val < 180:
                                        d_key = f"{float(tc_m.group(1)):.2f}"
                                        dof_tc_max[d_key] = f_val
                                        dof_tc_max[f"{float(tc_m.group(1)):.1f}"] = f_val
                                        dof_tc_max[str(round(float(tc_m.group(1))))] = f_val
                                except ValueError:
                                    pass

                        def parse_flt(val, default=0.0):
                            try:
                                return round(float(val), 2) if val else default
                            except ValueError:
                                return default

                        max_tf = parse_flt(row_dict.get("Max_Fiber_Temp_C"))
                        min_tf = parse_flt(row_dict.get("Min_Fiber_Temp_C"), max_tf)
                        mean_tf = parse_flt(row_dict.get("Mean_Fiber_Temp_C"), max_tf)
                        max_tc = parse_flt(row_dict.get("IEC_Est_Max_Conductor_C"))
                        min_tc = parse_flt(row_dict.get("IEC_Est_Min_Conductor_C"), max_tc)
                        p_c3 = parse_flt(row_dict.get("Power_Flow_During_Max_Ckt3_MW"))
                        p_c2 = parse_flt(row_dict.get("Power_Flow_During_Max_Ckt2_MW"))
                        p_nkt = parse_flt(row_dict.get("Power_Flow_During_Max_33NKT_MW"))
                        p_oil = parse_flt(row_dict.get("Power_Flow_During_Max_33Oil_MW"))
                        p_tot = parse_flt(row_dict.get("Power_Flow_During_Max_Total_MW"), p_c3 + p_c2 + p_nkt + p_oil)

                        if max_tf > p1_max_tf_by_date.get(d_str, 0):
                            p1_max_tf_by_date[d_str] = max_tf

                        p1_rec = {
                            "sectionId": raw_sec_id,
                            "date": d_str,
                            "phase": norm_phase,
                            "tfMax": max_tf,
                            "tfMin": min_tf,
                            "tfMean": mean_tf,
                            "tcMax": max_tc,
                            "tcMin": min_tc,
                            "powerAtMaxMW": p_tot,
                            "pCkt3MaxMW": p_c3,
                            "pCkt2MaxMW": p_c2,
                            "p33NktMaxMW": p_nkt,
                            "p33OilMaxMW": p_oil,
                            "pTotalAtMaxMW": p_tot,
                            "fileNameMax": row_dict.get("File_Name_Max", ""),
                            "timestampMax": row_dict.get("Timestamp_Max", ""),
                            "dofTfMax": dof_tf_max,
                            "dofTcMax": dof_tc_max,
                            "dofTimeMax": dof_time_max,
                        }
                        p1_records.append(p1_rec)
                    elem.clear()

p1_dates = sorted(list(p1_dates_set))
p1_years = sorted(list(set(d[:4] for d in p1_dates)))
print(f"Panel 1 extracted {len(p1_records)} records across {len(p1_dates)} dates ({p1_dates[0]} to {p1_dates[-1]})")

# Merge fiberMaxTempC into Panel 2 peaks
for pk in panel2_peaks:
    pk["fiberMaxTempC"] = p1_max_tf_by_date.get(pk["date"], 0.0)

p1_config = {
    "hasDatabase": True,
    "databaseFileName": "DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-18 (1).xlsx",
    "uploadedAt": "2026-10-18T18:00:00.000Z",
    "fileFormat": "xlsx",
    "totalRecords": len(p1_records),
    "totalDates": len(p1_dates),
    "dateRange": {
        "firstDate": p1_dates[0],
        "latestDate": p1_dates[-1],
    },
    "availableDates": p1_dates,
    "availableYears": p1_years,
}

p1_info = {
    "sourceType": "remote_link",
    "name": "DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-18 (1).xlsx",
    "remoteUrl": "https://drive.google.com/drive/folders/1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS?usp=sharing",
    "updatedAt": "2026-10-18T18:00:00.000Z",
    "totalDates": len(p1_dates),
    "dateRange": {
        "firstDate": p1_dates[0],
        "latestDate": p1_dates[-1],
    },
    "recordCount": len(p1_records),
}

# -----------------------------------------------------------------------------
# 3. PARSE PANEL 3 (Section Daily Profile 19 Sheets XLSX)
# -----------------------------------------------------------------------------
print("\n--- Processing Panel 3 (Hourly Profile XLSX) ---")
p3_local_path = "/tmp/p3.xlsx"
if not os.path.exists(p3_local_path):
    print("Downloading Panel 3...")
    P3_URL = "https://drive.usercontent.google.com/download?id=1cZTbNwPPL9rom44BZIyI_f_m1mSyHYwK&export=download&confirm=t"
    req3 = urllib.request.Request(P3_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req3) as resp, open(p3_local_path, "wb") as f_out:
        f_out.write(resp.read())

print(f"Panel 3 file size: {os.path.getsize(p3_local_path)} bytes")

p3_records_by_date = {}
p3_all_dates_set = set()
total_p3_records = 0

with zipfile.ZipFile(p3_local_path, "r") as z3:
    sst3 = []
    if "xl/sharedStrings.xml" in z3.namelist():
        sst_xml = z3.read("xl/sharedStrings.xml")
        root = ET.fromstring(sst_xml)
        for si in root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
            t_elem = si.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
            if t_elem is not None and t_elem.text:
                sst3.append(t_elem.text)
            else:
                txt = "".join(t.text for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t") if t.text)
                sst3.append(txt)

    wb_xml = z3.read("xl/workbook.xml")
    wb_root = ET.fromstring(wb_xml)
    p3_sheets = []
    for s in wb_root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet"):
        p3_sheets.append(s.attrib["name"])

    for s_idx, s_name in enumerate(p3_sheets):
        sheet_file = f"xl/worksheets/sheet{s_idx + 1}.xml"
        if sheet_file not in z3.namelist():
            continue
        raw_sec_id = re.sub(r"^(Sec_|Zone_|Section_|Sec\s+|Zone\s+)", "", s_name).strip()
        is_land = raw_sec_id.startswith("1.")

        with z3.open(sheet_file) as f_sheet:
            headers = {}
            for event, elem in ET.iterparse(f_sheet, events=("end",)):
                if elem.tag.endswith("row"):
                    r_num = int(elem.attrib.get("r", "0"))
                    cells = {}
                    for c in elem.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                        ref = c.attrib.get("r", "")
                        col = re.sub(r"[0-9]", "", ref)
                        t_type = c.attrib.get("t", "")
                        v_elem = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                        v_val = v_elem.text if v_elem is not None else ""
                        if t_type == "s" and v_val.isdigit() and int(v_val) < len(sst3):
                            val = sst3[int(v_val)]
                        else:
                            val = v_val
                        cells[col] = val

                    if r_num == 1:
                        headers = {k: v.strip() for k, v in cells.items()}
                    else:
                        row_dict = {}
                        for col_k, col_name in headers.items():
                            row_dict[col_name] = cells.get(col_k, "")

                        d_str = row_dict.get("Date", "").strip()
                        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d_str):
                            continue

                        p3_all_dates_set.add(d_str)

                        phase_val = row_dict.get("Phase", "").strip()
                        if is_land:
                            norm_phase = f"Phase {phase_val}" if phase_val in ("A", "B", "C") else (phase_val or "Phase A")
                        else:
                            norm_phase = "Submarine (CH 3)" if phase_val == "SM" else (phase_val or "Submarine (CH 3)")

                        time_val = row_dict.get("Time", "").strip()
                        # Extract hour index from e.g. '00.01 - 01.00' or '14:00'
                        h_m = re.match(r"^(\d{1,2})", time_val)
                        h_idx = int(h_m.group(1)) if h_m else 0
                        h_next = (h_idx + 1) % 24
                        period_label = f"{str(h_idx).zfill(2)}:00-{str(h_next).zfill(2)}:00"

                        def parse_flt_p3(v, def_val=0.0):
                            try:
                                return round(float(v), 2) if v else def_val
                            except ValueError:
                                return def_val

                        max_tf = parse_flt_p3(row_dict.get("Section_Max_Tf_C") or row_dict.get("Max_Fiber_Temp_Period_C"))
                        max_tc = parse_flt_p3(row_dict.get("Section_Max_Tc_C") or row_dict.get("Max_Conductor_Temp_Period_C"))
                        c3_mw = parse_flt_p3(row_dict.get("Power_Ckt3_MW"))
                        c2_mw = parse_flt_p3(row_dict.get("Power_Ckt2_MW"))
                        nkt_mw = parse_flt_p3(row_dict.get("Power_33NKT_MW"))
                        oil_mw = parse_flt_p3(row_dict.get("Power_33Oil_MW"))
                        tot_mw = parse_flt_p3(row_dict.get("Total_Power_MW"), c3_mw + c2_mw + nkt_mw + oil_mw)

                        hourly_rec = {
                            "sectionId": raw_sec_id,
                            "date": d_str,
                            "phase": norm_phase,
                            "hourIndex": h_idx,
                            "hourPeriod": period_label,
                            "peakTime": row_dict.get("Hourly_Peak_Time", f"{str(h_idx).zfill(2)}:30"),
                            "maxFiberTempC": max_tf,
                            "meanFiberTempC": max_tf,
                            "maxConductorTempC": max_tc,
                            "meanConductorTempC": max_tc,
                            "ckt3MW": c3_mw,
                            "ckt2MW": c2_mw,
                            "nkt33MW": nkt_mw,
                            "oil33MW": oil_mw,
                            "totalMW": tot_mw,
                        }

                        if d_str not in p3_records_by_date:
                            p3_records_by_date[d_str] = []
                        p3_records_by_date[d_str].append(hourly_rec)
                        total_p3_records += 1
                    elem.clear()

p3_dates = sorted(list(p3_all_dates_set))
print(f"Panel 3 parsed {total_p3_records} hourly records across {len(p3_dates)} dates ({p3_dates[0]} to {p3_dates[-1]})")

# Write per-date JSON files into CACHE_DIR
print("Writing per-date cache files to disk...")
for d_key, d_recs in p3_records_by_date.items():
    d_file = os.path.join(CACHE_DIR, f"{d_key}.json")
    with open(d_file, "w", encoding="utf-8") as f_d:
        json.dump(d_recs, f_d)

# Write all_dates.json
with open(os.path.join(CACHE_DIR, "all_dates.json"), "w", encoding="utf-8") as f_dates:
    json.dump(p3_dates, f_dates)

# Embed latest 30 dates into public default database JSON
recent_dates = p3_dates[-30:] if len(p3_dates) >= 30 else p3_dates
recent_records = []
for rd in recent_dates:
    recent_records.extend(p3_records_by_date.get(rd, []))

print(f"Embedding {len(recent_records)} records for the latest {len(recent_dates)} dates ({recent_dates[0]} to {recent_dates[-1]})")

p3_info = {
    "sourceType": "remote_link",
    "name": "DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-18.xlsx",
    "remoteUrl": "https://drive.google.com/drive/folders/15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_?usp=sharing",
    "updatedAt": "2026-10-18T18:00:00.000Z",
    "totalDates": len(p3_dates),
    "dateRange": {
        "firstDate": p3_dates[0],
        "latestDate": p3_dates[-1],
    },
    "recordCount": total_p3_records,
}

# -----------------------------------------------------------------------------
# 4. WRITE CONSOLIDATED .dts-public-default-databases.json
# -----------------------------------------------------------------------------
print("\n--- Writing master default database file ---")
final_db = {
    "version": 1,
    "updatedAt": "2026-10-18T18:00:00.000Z",
    "panel1": {
        "config": p1_config,
        "records": p1_records,
        "info": p1_info,
    },
    "panel2": {
        "peaks": panel2_peaks,
        "info": p2_info,
    },
    "panel3": {
        "records": recent_records,
        "allDates": p3_dates,
        "info": p3_info,
    },
    "linksConfig": {
        "panel1Url": "https://drive.google.com/drive/folders/1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS?usp=sharing",
        "panel2Url": "https://drive.google.com/drive/folders/1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6?usp=sharing",
        "panel3Url": "https://drive.google.com/drive/folders/15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_?usp=sharing",
        "updatedAt": "2026-10-18T18:00:00.000Z",
    },
}

with open(DEFAULT_DB_FILE, "w", encoding="utf-8") as f_db:
    json.dump(final_db, f_db)

out_size = os.path.getsize(DEFAULT_DB_FILE)
print(f"Master file saved: {DEFAULT_DB_FILE} ({out_size / 1024 / 1024:.2f} MB)")
print(f"Completed in {time.time() - START_TIME:.2f} seconds!")
