import React, { useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';

// Standard World TopoJSON
const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Quick mapping for common ISO Numeric to Alpha 2 codes for IP-API matching
const numericToAlpha2 = {
    "840": "US", "276": "DE", "250": "FR", "826": "GB", "702": "SG",
    "392": "JP", "528": "NL", "124": "CA", "036": "AU", "076": "BR",
    "356": "IN", "710": "ZA", "410": "KR", "344": "HK", "784": "AE",
    "752": "SE", "756": "CH", "380": "IT", "724": "ES", "616": "PL",
    "643": "RU", "156": "CN", "360": "ID", "458": "MY", "764": "TH",
    "704": "VN", "608": "PH", "352": "IS", "246": "FI", "578": "NO",
    "208": "DK", "040": "AT", "056": "BE", "372": "IE", "620": "PT",
    "300": "GR", "792": "TR", "368": "IQ", "364": "IR", "682": "SA",
    "818": "EG", "566": "NG", "404": "KE", "032": "AR", "152": "CL",
    "170": "CO", "604": "PE", "862": "VE", "484": "MX", "192": "CU"
};

export default function GeoMap({ selectedCountry, onSelectCountry }) {
    return (
        <div className="w-full h-48 bg-black/40 border border-white/10 rounded-lg overflow-hidden relative cursor-crosshair">
            <ComposableMap projectionConfig={{ scale: 120 }} width={800} height={400}>
                <ZoomableGroup center={[0, 0]} zoom={1.2}>
                    <Geographies geography={geoUrl}>
                        {({ geographies }) =>
                            geographies.map((geo) => {
                                const isoA2 = numericToAlpha2[geo.id];
                                const isSelected = isoA2 && isoA2 === selectedCountry;
                                return (
                                    <Geography
                                        key={geo.rsmKey}
                                        geography={geo}
                                        onClick={() => {
                                            if (isoA2) {
                                                if (isSelected) onSelectCountry(""); // Toggle off
                                                else onSelectCountry(isoA2);
                                            }
                                        }}
                                        style={{
                                            default: {
                                                fill: isSelected ? "#0ff" : "#1a1a2e",
                                                outline: "none",
                                                stroke: "#0ff",
                                                strokeWidth: 0.5,
                                                opacity: isSelected ? 1 : 0.6
                                            },
                                            hover: {
                                                fill: "#bc13fe",
                                                outline: "none",
                                                opacity: 1
                                            },
                                            pressed: {
                                                fill: "#fff",
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

            {/* Overlay Status */}
            <div className="absolute bottom-2 left-2 pointer-events-none">
                <div className="bg-black/60 px-3 py-1 rounded border border-neon-blue/30 text-xs text-neon-blue font-mono">
                    TARGET: {selectedCountry || "GLOBAL (Any)"}
                </div>
            </div>
        </div>
    );
}
