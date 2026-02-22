import React from 'react';

/**
 * Iran country silhouette with accurate geographic borders from GeoJSON,
 * filled with flag gradient (Green → White → Red) and neon glow effects.
 */
export default function IranLogo({ size = 90 }) {
    const id = 'iran-flag-grad';
    const glowId = 'iran-glow';

    // Real Iran border path converted from GeoJSON coordinates
    // Source coords: lon 44.1–63.3, lat 25.1–39.8
    // Mapped to viewBox 0 0 200 160 with Y-flip
    const iranPath = `M 102.3,11.6 L 111.4,6.4 L 118.8,2.3 L 125.7,3.5 L 130.3,1.1 L 137.7,2.6 L 148.9,5.3 L 156.5,4.7 L 168.5,11.2 L 178.5,10.0 L 178.1,17.9 L 174.3,24.6 L 171.4,28.5 L 175.9,31.5 L 171.5,35.7 L 174.8,37.0 L 174.0,40.2 L 183.3,40.4 L 195.1,43.6 L 194.8,50.0 L 189.8,54.3 L 184.1,60.6 L 176.7,60.2 L 173.1,68.2 L 166.4,71.9 L 150.2,72.1 L 143.5,72.3 L 130.5,73.5 L 118.3,75.6 L 111.7,80.3 L 100.2,82.3 L 91.3,82.3 L 74.3,90.7 L 66.3,89.3 L 50.7,89.8 L 45.3,85.0 L 41.0,76.5 L 35.0,76.2 L 28.3,62.1 L 24.6,50.9 L 46.0,49.2 L 46.6,47.9 L 42.2,42.4 L 41.2,41.4 L 40.6,38.8 L 39.4,37.1 L 35.1,35.1 L 20.4,30.2 L 10.1,14.3 L 5.0,9.3 L 6.6,1.3 L 9.2,1.2 L 15.4,6.4 L 21.7,4.7 L 21.3,10.2 L 26.2,15.1 L 33.5,12.2 L 38.1,8.1 L 36.5,5.2 L 44.9,0.6 L 56.2,5.1 L 64.8,2.2 L 73.3,3.9 L 87.2,4.2 L 95.7,6.1 Z`;

    return (
        <svg
            width={size}
            height={size * 0.8}
            viewBox="0 0 200 160"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: 'drop-shadow(0 0 8px rgba(57,255,20,0.4)) drop-shadow(0 0 16px rgba(255,0,64,0.3))' }}
        >
            <defs>
                {/* Iran flag gradient: Green → White → Red (top to bottom) */}
                <linearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#009b3a" />
                    <stop offset="22%" stopColor="#009b3a" />
                    <stop offset="33%" stopColor="#22e066" />
                    <stop offset="36%" stopColor="#ffffff" />
                    <stop offset="50%" stopColor="#ffffff" />
                    <stop offset="64%" stopColor="#ffffff" />
                    <stop offset="67%" stopColor="#ff2244" />
                    <stop offset="78%" stopColor="#c41230" />
                    <stop offset="100%" stopColor="#c41230" />
                </linearGradient>
                {/* Glow filter */}
                <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            <g filter={`url(#${glowId})`}>
                <path
                    d={iranPath}
                    fill={`url(#${id})`}
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth="1"
                    strokeLinejoin="round"
                />
            </g>
        </svg>
    );
}
