import React, { useState } from 'react';
import { 
  Target, 
  Flame, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  ArrowUpRight, 
  ArrowDownRight,
  TrendingUp,
  MapPin,
  Filter,
  Search,
  Info
} from 'lucide-react';
import { LocationTimeSeriesSummary, TARGET_LOCATIONS } from '../services/teprParser';
import { getThermalZoneInfo } from '../data/cableCircuitStructure';

interface TargetLocationsMatrixProps {
  timeSeriesSummary: LocationTimeSeriesSummary[];
  selectedLocation: number | null;
  onSelectLocation: (loc: number) => void;
  baselineTemp: number;
  selectedPhaseFilter?: string;
  activeTimeFilter?: string;
  activeDateFilter?: string;
}

export const TargetLocationsMatrix: React.FC<TargetLocationsMatrixProps> = ({
  timeSeriesSummary,
  selectedLocation,
  onSelectLocation,
  baselineTemp,
  selectedPhaseFilter = 'all',
  activeTimeFilter = 'all',
  activeDateFilter = 'all',
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'warning_critical'>('all');
  const [sectionalFilter, setSectionalFilter] = useState<'all' | 'normal' | 'special' | 'land_normal' | 'land_special' | 'sub_normal' | 'sub_special'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const isHourlyActive = activeTimeFilter !== 'all' || activeDateFilter !== 'all';

  const isSubmarine = 
    selectedPhaseFilter === 'Submarine Cable' || 
    timeSeriesSummary.some((item) => item.location > 3600 || item.tag.includes('Subsea') || item.tag.includes('Shore Landing'));

  const filteredItems = timeSeriesSummary.filter((item) => {
    if (filterStatus === 'warning_critical' && item.status === 'normal') {
      return false;
    }
    if (sectionalFilter === 'normal' && item.sectionType !== 'normal') return false;
    if (sectionalFilter === 'special' && item.sectionType !== 'special') return false;
    if (sectionalFilter === 'land_normal' && !(item.cableCategory === 'land' && item.sectionType === 'normal')) return false;
    if (sectionalFilter === 'land_special' && !(item.cableCategory === 'land' && item.sectionType === 'special')) return false;
    if (sectionalFilter === 'sub_normal' && !(item.cableCategory === 'submarine' && item.sectionType === 'normal')) return false;
    if (sectionalFilter === 'sub_special' && !(item.cableCategory === 'submarine' && item.sectionType === 'special')) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.location.toString().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        (item.pos && item.pos.toLowerCase().includes(q)) ||
        (item.sectionName && item.sectionName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleExportCSV = () => {
    if (timeSeriesSummary.length === 0) return;

    let csv = 'Section ID,POS,Section Name,Type,Cable Category,KP,DAB (m),DOF (m),Reading Fiber Tf (C),Raw Delta Temp (C),Est Conductor Tc_60287 (C),IEC Estimation,1h Max P_Ckt3 (MW),Power Period,Status\n';
    timeSeriesSummary.forEach((item) => {
      const tcVal = item.tc60287 ?? item.tcMax;
      csv += `"${item.sectionId || ''}","${item.pos || ''}","${item.sectionName || item.tag}","${item.sectionType || ''}","${item.cableCategory || ''}","${item.kp || ''}",${item.dab !== null && item.dab !== undefined ? item.dab : ''},${item.location},${item.currentAbsoluteTemp},${item.currentDeltaTemp},${item.hasPowerData && tcVal !== null && tcVal !== undefined ? tcVal : 'No Power Data'},"IEC Estimation",${item.pCkt3MW ?? ''},"${item.matchedPowerTime || ''}","${item.status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Cable_${isSubmarine ? 'Submarine_CH3_81' : 'Land_38'}_Target_Locations_Report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const criticalCount = timeSeriesSummary.filter((i) => i.status === 'critical').length;
  const warningCount = timeSeriesSummary.filter((i) => i.status === 'warning').length;
  const anyPowerData = timeSeriesSummary.some((i) => i.hasPowerData);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col space-y-3 p-5">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-blue-600" />
            <span>
              {selectedPhaseFilter === 'Submarine Cable' ? (
                <span className="text-teal-700 font-bold">Submarine Cable (CH 3) Monitoring Positions ({timeSeriesSummary.length} Points across Zones 2.1–2.13)</span>
              ) : selectedPhaseFilter === 'Phase A' ? (
                <span className="text-red-700 font-bold">Phase A (CH 0) Land Monitoring Locations ({timeSeriesSummary.length} Points across Sections 1.1–1.6)</span>
              ) : selectedPhaseFilter === 'Phase B' ? (
                <span className="text-amber-700 font-bold">Phase B (CH 1) Land Monitoring Locations ({timeSeriesSummary.length} Points across Sections 1.1–1.6)</span>
              ) : selectedPhaseFilter === 'Phase C' ? (
                <span className="text-blue-700 font-bold">Phase C (CH 2) Land Monitoring Locations ({timeSeriesSummary.length} Points across Sections 1.1–1.6)</span>
              ) : isSubmarine ? (
                <span className="text-teal-700 font-bold">Submarine Cable (CH 3) Monitoring Positions ({timeSeriesSummary.length} Points across Zones 2.1–2.13)</span>
              ) : (
                <span>{timeSeriesSummary.length} Designated Monitoring Locations (Sections 1.1–1.6 / Zones 2.1–2.13)</span>
              )}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {selectedPhaseFilter === 'Submarine Cable' || isSubmarine ? (
              <span>Showing 81 monitoring points along Submarine Cable (2,691.75m – 55,225.87m) with IEC Estimation Conductor Temperature.</span>
            ) : (
              <span>Showing 38 designated locations per phase for Land Cable (2,020.94m – 3,464.56m) with IEC Estimation Conductor Temperature.</span>
            )}
          </div>
        </div>

        {/* Status Highlights & CSV Download */}
        <div className="flex flex-wrap items-center gap-2">
          {!anyPowerData && timeSeriesSummary.length > 0 && (
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
              ⚠️ No Power Data for Date
            </span>
          )}
          {criticalCount > 0 && (
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-rose-600" />
              {criticalCount} Hotspot(s)
            </span>
          )}
          {warningCount > 0 && (
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              {warningCount} Warning(s)
            </span>
          )}

          <button
            id="export-locations-csv-btn"
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-white hover:bg-blue-50 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Absolute & Conductor Temperature Formula Banner */}
      <div className="p-3 bg-blue-50/70 border border-blue-200/70 rounded-xl flex items-start gap-2.5 text-xs text-slate-700">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-0.5">
          <div className="font-semibold text-blue-900 flex flex-wrap items-center justify-between gap-2">
            <span>Reading Fiber Optic Temp ($T_f$) & IEC Estimation Conductor Temperature ($T_{'{'}c,60287{'}'}$):</span>
            <div className="flex items-center gap-1.5">
              {activeDateFilter && activeDateFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-600 text-white font-mono font-bold">
                  Date: {activeDateFilter}
                </span>
              )}
              {activeTimeFilter !== 'all' ? (
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-mono font-bold">
                  Hour {activeTimeFilter} Peak Mode
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-mono font-semibold">
                  24h Daily Peak Mode
                </span>
              )}
            </div>
          </div>
          <p className="text-[11px] text-blue-800 leading-relaxed">
            $T_f = 30.0^\circ\text{'{'}C{'}'} + \Delta T$. Conductor Temperature is estimated via <strong>IEC Estimation: $T_{'{'}c,60287{'}'}$</strong> from $T_f$ and maximum power $P$ (MW) during the 1-hour period of the fiber reading.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            All Points ({timeSeriesSummary.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('warning_critical')}
            className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
              filterStatus === 'warning_critical'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            Hotspots & Warnings ({criticalCount + warningCount})
          </button>

          {/* Sectional Filter Dropdown */}
          <select
            value={sectionalFilter}
            onChange={(e) => setSectionalFilter(e.target.value as any)}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Filter Sections: All Sections</option>
            <option value="normal">Normal Sections Only</option>
            <option value="special">Special Sections Only (Joints/Crossings/Bottleneck)</option>
            <option value="land_normal">Land Cable (Normal: LS1, LS2, LS3)</option>
            <option value="land_special">Land Cable (Special: JP1, JP2, TJ1)</option>
            <option value="sub_normal">Submarine Cable (Normal: NM1–NM6)</option>
            <option value="sub_special">Submarine Cable (Special: BTN, XPWA, NX, FR, X33kV, TJ2)</option>
          </select>

          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-medium ml-1">
            {filteredItems.length} Points
          </span>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search POS, section, KP, DOF..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-slate-800"
          />
        </div>
      </div>

      {/* Table Data Matrix - Compact Scrollable Container with Scrollbar */}
      <div className="relative rounded-xl border border-slate-200/80 overflow-hidden shadow-2xs">
        <div className="max-h-80 sm:max-h-96 overflow-y-auto overflow-x-auto custom-scrollbar bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs font-semibold text-slate-700 z-10 border-b border-slate-200 shadow-2xs text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-2.5 bg-slate-50/95">Sec</th>
                <th className="py-2.5 px-3 bg-slate-50/95">POS</th>
                <th className="py-2.5 px-2.5 bg-slate-50/95">KP</th>
                <th className="py-2.5 px-2.5 text-right bg-slate-50/95 font-mono text-blue-700">DOF (m)</th>
                <th className="py-2.5 px-2.5 text-right bg-slate-50/95">Reading Fiber $T_f$</th>
                <th className="py-2.5 px-2.5 text-right bg-rose-50/80 text-rose-800 font-extrabold">Est. Conductor $T_{'{'}c,60287{'}'}$</th>
                <th className="py-2.5 px-2.5 text-center bg-slate-50/95">IEC Estimation</th>
                <th className="py-2.5 px-2.5 text-right bg-slate-50/95">Max 1h Power $P$</th>
                <th className="py-2.5 px-2.5 text-center bg-slate-50/95">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredItems.map((item, idx) => {
                const isSelected = selectedLocation === item.location;
                const tcVal = item.tc60287 ?? item.tcMax;
                return (
                  <tr
                    key={`${item.location}-${item.pos || item.tag}-${idx}`}
                    id={`loc-row-${item.location}`}
                    onClick={() => onSelectLocation(item.location)}
                    className={`hover:bg-blue-50/50 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/80 font-medium' : ''
                    }`}
                  >
                    <td className="py-2 px-2.5 font-mono text-[11px] font-bold text-slate-600 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded ${
                        item.sectionType === 'special'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {item.sectionId || '-'}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap" title={item.sectionName || item.tag}>
                      <div className="flex items-center gap-1.5">
                        <MapPin className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                        <span>{item.pos || `${item.location.toFixed(1)}m`}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {item.kp || '-'}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-semibold text-blue-700 whitespace-nowrap">
                      {item.dof !== undefined ? item.dof.toFixed(2) : item.location.toFixed(2)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono whitespace-nowrap">
                      <div className="font-bold text-slate-900">{item.currentAbsoluteTemp.toFixed(2)} °C</div>
                      <div className="text-[10px] text-slate-400">
                        {item.currentDeltaTemp >= 0 ? `+${item.currentDeltaTemp.toFixed(2)}` : item.currentDeltaTemp.toFixed(2)}° ΔT
                      </div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono bg-rose-50/30 whitespace-nowrap">
                      {tcVal !== null && tcVal !== undefined ? (
                        <div>
                          <div className="font-extrabold text-rose-700">{tcVal.toFixed(2)} °C</div>
                          <div className="text-[10px] text-rose-500">
                            +{(tcVal - item.currentAbsoluteTemp).toFixed(2)}°C (IEC 60287)
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                          {item.currentAbsoluteTemp.toFixed(2)} °C
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-center font-mono text-[11px] whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-bold">
                        IEC Estimation
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-[11px] whitespace-nowrap">
                      {item.pCkt3MW !== null && item.pCkt3MW !== undefined ? (
                        <div>
                          <div className="font-bold text-slate-800">{item.pCkt3MW.toFixed(2)} MW</div>
                          <div className="text-[10px] text-slate-400">{item.matchedPowerTime || '1h Max'}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-center whitespace-nowrap">
                      {(() => {
                        const evalTemp = tcVal ?? item.currentAbsoluteTemp;
                        const zInfo = getThermalZoneInfo(evalTemp);
                        return (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold border ${zInfo.badgeBgClass} ${zInfo.badgeTextClass} ${zInfo.badgeBorderClass}`}
                            title={`${zInfo.label} (${zInfo.rangeText})`}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: zInfo.hexColor }}
                            />
                            <span>{zInfo.shortLabel}</span>
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Scroll view footer indicator */}
        <div className="bg-slate-50 px-3 py-1.5 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Showing {filteredItems.length} of {timeSeriesSummary.length} designated locations</span>
          <span className="text-slate-400">Scroll down to view all monitoring points ↕</span>
        </div>
      </div>
    </div>
  );
};
