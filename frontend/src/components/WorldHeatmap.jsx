import React, { useState, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { getGeoAnalytics } from '../api';
import { useTranslation } from '../i18n/LanguageContext';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Country name to ISO numeric mapping for TopoJSON
const countryNameToId = {
    "Afghanistan": "004", "Albania": "008", "Algeria": "012", "Argentina": "032",
    "Australia": "036", "Austria": "040", "Azerbaijan": "031", "Bahrain": "048",
    "Bangladesh": "050", "Belarus": "112", "Belgium": "056", "Brazil": "076",
    "Bulgaria": "100", "Cambodia": "116", "Canada": "124", "Chile": "152",
    "China": "156", "Colombia": "170", "Croatia": "191", "Cuba": "192",
    "Czech Republic": "203", "Czechia": "203", "Denmark": "208", "Egypt": "818",
    "Estonia": "233", "Ethiopia": "231", "Finland": "246", "France": "250",
    "Georgia": "268", "Germany": "276", "Ghana": "288", "Greece": "300",
    "Hong Kong": "344", "Hungary": "348", "Iceland": "352", "India": "356",
    "Indonesia": "360", "Iran": "364", "Iraq": "368", "Ireland": "372",
    "Israel": "376", "Italy": "380", "Japan": "392", "Jordan": "400",
    "Kazakhstan": "398", "Kenya": "404", "Korea": "410", "South Korea": "410",
    "Kuwait": "414", "Latvia": "428", "Lebanon": "422", "Libya": "434",
    "Lithuania": "440", "Luxembourg": "442", "Malaysia": "458", "Mexico": "484",
    "Moldova": "498", "Mongolia": "496", "Morocco": "504", "Myanmar": "104",
    "Nepal": "524", "Netherlands": "528", "New Zealand": "554", "Nigeria": "566",
    "Norway": "578", "Oman": "512", "Pakistan": "586", "Palestine": "275",
    "Panama": "591", "Peru": "604", "Philippines": "608", "Poland": "616",
    "Portugal": "620", "Qatar": "634", "Romania": "642", "Russia": "643",
    "Saudi Arabia": "682", "Serbia": "688", "Singapore": "702", "Slovakia": "703",
    "Slovenia": "705", "South Africa": "710", "Spain": "724", "Sri Lanka": "144",
    "Sudan": "729", "Sweden": "752", "Switzerland": "756", "Syria": "760",
    "Taiwan": "158", "Tajikistan": "762", "Tanzania": "834", "Thailand": "764",
    "Tunisia": "788", "Turkey": "792", "Türkiye": "792", "Turkmenistan": "795",
    "Ukraine": "804", "United Arab Emirates": "784", "United Kingdom": "826",
    "United States": "840", "Uzbekistan": "860", "Venezuela": "862",
    "Vietnam": "704", "Viet Nam": "704", "Yemen": "887"
};

// Health color based on success rate
function getHeatColor(successRate, totalScans) {
    if (!totalScans || totalScans === 0) return "#1a1a2e"; // No data
    if (successRate >= 50) return "#00ff41"; // Excellent - Neon Green
    if (successRate >= 30) return "#39ff14"; // Good - Bright Green
    if (successRate >= 15) return "#ffff00"; // Average - Yellow
    if (successRate >= 5) return "#ff8c00";  // Poor - Orange
    return "#ff0040"; // Bad - Red
}

function getHeatOpacity(totalScans, maxScans) {
    if (!totalScans || totalScans === 0) return 0.3;
    return Math.min(0.4 + (totalScans / Math.max(maxScans, 1)) * 0.6, 1);
}

export default function WorldHeatmap() {
    const { t } = useTranslation();
    const [geoData, setGeoData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hoveredCountry, setHoveredCountry] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        getGeoAnalytics().then(data => {
            setGeoData(data || []);
            setLoading(false);
        });
    }, []);

    // Build lookup: { geoId -> countryData }
    const dataByGeoId = {};
    const dataByName = {};
    let maxScans = 1;
    geoData.forEach(c => {
        const geoId = countryNameToId[c.country];
        if (geoId) dataByGeoId[geoId] = c;
        dataByName[c.country] = c;
        if (c.total_scans > maxScans) maxScans = c.total_scans;
    });

    const handleMouseMove = (e) => {
        setTooltipPos({ x: e.clientX, y: e.clientY });
    };

    if (loading) {
        return (
            <div className="glass-panel p-6 neon-border text-center">
                <div className="text-neon-blue animate-pulse">{t('analytics.worldMap.loading')}</div>
            </div>
        );
    }

    return (
        <div className="glass-panel p-6 neon-border relative" onMouseMove={handleMouseMove}>
            <h3 className="text-lg font-bold text-neon-purple mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                {t('analytics.worldMap.title')}
            </h3>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-3 text-[10px] font-mono text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#00ff41' }}></span> &gt;50% {t('analytics.worldMap.successLabel')}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ffff00' }}></span> 15-30%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ff8c00' }}></span> 5-15%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ff0040' }}></span> &lt;5%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#1a1a2e', border: '1px solid #333' }}></span> {t('analytics.worldMap.noData')}</span>
            </div>

            <div className="w-full h-[400px] bg-[#0a0a12] border border-white/10 rounded-xl overflow-hidden relative">
                <ComposableMap projectionConfig={{ scale: 140 }} width={800} height={400} style={{ width: '100%', height: '100%' }}>
                    <ZoomableGroup center={[20, 10]} zoom={1}>
                        <Geographies geography={geoUrl}>
                            {({ geographies }) =>
                                geographies.map((geo) => {
                                    const countryData = dataByGeoId[geo.id];
                                    const fill = countryData
                                        ? getHeatColor(countryData.success_rate, countryData.total_scans)
                                        : "#1a1a2e";
                                    const opacity = countryData
                                        ? getHeatOpacity(countryData.total_scans, maxScans)
                                        : 0.3;

                                    return (
                                        <Geography
                                            key={geo.rsmKey}
                                            geography={geo}
                                            onMouseEnter={() => setHoveredCountry(countryData || null)}
                                            onMouseLeave={() => setHoveredCountry(null)}
                                            style={{
                                                default: {
                                                    fill: fill,
                                                    outline: "none",
                                                    stroke: "#0ff",
                                                    strokeWidth: 0.3,
                                                    opacity: opacity
                                                },
                                                hover: {
                                                    fill: countryData ? "#fff" : "#333",
                                                    outline: "none",
                                                    opacity: 1,
                                                    stroke: "#0ff",
                                                    strokeWidth: 1
                                                },
                                                pressed: {
                                                    fill: "#BC13FE",
                                                    outline: "none"
                                                },
                                            }}
                                        />
                                    );
                                })
                            }
                        </Geographies>
                    </ZoomableGroup>
                </ComposableMap>
            </div>

            {/* Floating Tooltip */}
            {hoveredCountry && (
                <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{ left: tooltipPos.x + 15, top: tooltipPos.y - 10 }}
                >
                    <div className="bg-[#0a0a14]/95 backdrop-blur-xl border border-neon-blue/40 rounded-xl p-4 shadow-[0_0_30px_rgba(0,243,255,0.2)] min-w-[280px]">
                        {/* Country Header */}
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
                            <h4 className="text-white font-black text-sm">{hoveredCountry.country}</h4>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hoveredCountry.success_rate >= 30 ? 'bg-green-500/20 text-green-400' :
                                hoveredCountry.success_rate >= 10 ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-red-500/20 text-red-400'
                                }`}>
                                {hoveredCountry.success_rate}% {t('analytics.worldMap.successLabel')}
                            </span>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                            <div className="bg-black/40 rounded-lg p-2">
                                <div className="text-gray-500 text-[10px]">{t('analytics.worldMap.totalScans')}</div>
                                <div className="text-white font-bold">{hoveredCountry.total_scans.toLocaleString()}</div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-2">
                                <div className="text-gray-500 text-[10px]">{t('analytics.worldMap.goodIps')}</div>
                                <div className="text-neon-green font-bold">{hoveredCountry.good_ips.toLocaleString()}</div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-2">
                                <div className="text-gray-500 text-[10px]">{t('analytics.worldMap.avgPing')}</div>
                                <div className={`font-bold ${hoveredCountry.avg_ping < 300 ? 'text-neon-green' : hoveredCountry.avg_ping < 800 ? 'text-yellow-400' : 'text-red-400'}`}>
                                    {hoveredCountry.avg_ping ?? '—'}ms
                                </div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-2">
                                <div className="text-gray-500 text-[10px]">{t('analytics.worldMap.avgJitter')}</div>
                                <div className="text-gray-300 font-bold">{hoveredCountry.avg_jitter ?? '—'}ms</div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-2">
                                <div className="text-gray-500 text-[10px]">{t('analytics.worldMap.avgDownload')}</div>
                                <div className="text-neon-blue font-bold">{hoveredCountry.avg_download ?? '—'} Mbps</div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-2">
                                <div className="text-gray-500 text-[10px]">{t('analytics.worldMap.avgUpload')}</div>
                                <div className="text-neon-purple font-bold">{hoveredCountry.avg_upload ?? '—'} Mbps</div>
                            </div>
                        </div>

                        {/* Users */}
                        <div className="flex items-center gap-2 mb-3 text-[10px]">
                            <span className="text-gray-500">👤 {t('analytics.worldMap.activeUsers')}:</span>
                            <span className="text-white font-bold">{hoveredCountry.unique_users}</span>
                        </div>

                        {/* Top ISPs */}
                        {hoveredCountry.top_isps && hoveredCountry.top_isps.length > 0 && (
                            <div className="mb-2">
                                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">{t('analytics.worldMap.topIsps')}</div>
                                {hoveredCountry.top_isps.map((isp, i) => (
                                    <div key={i} className="flex justify-between text-[11px] py-0.5">
                                        <span className="text-gray-300 truncate max-w-[180px]">{isp.name}</span>
                                        <span className="text-neon-blue font-mono">{isp.scans}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Top Datacenters */}
                        {hoveredCountry.top_datacenters && hoveredCountry.top_datacenters.length > 0 && (
                            <div>
                                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">{t('analytics.worldMap.bestDcs')}</div>
                                {hoveredCountry.top_datacenters.map((dc, i) => (
                                    <div key={i} className="flex justify-between text-[11px] py-0.5">
                                        <span className="text-neon-green font-mono">{dc.code}</span>
                                        <span className="text-gray-400">{dc.hits} hits</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Summary Bar */}
            {geoData.length > 0 && (
                <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-gray-500 px-1">
                    <span>{geoData.length} {t('analytics.worldMap.countries')}</span>
                    <span>{geoData.reduce((s, c) => s + c.total_scans, 0).toLocaleString()} {t('analytics.worldMap.worldwide')}</span>
                    <span>{geoData.reduce((s, c) => s + c.unique_users, 0)} {t('analytics.worldMap.globalUsers')}</span>
                </div>
            )}
        </div>
    );
}
