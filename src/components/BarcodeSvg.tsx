'use client'

import React, { useMemo } from 'react';

// Code 128 Pattern Table (Symbols 0 to 106)
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
];

const START_B = 104;
const STOP = 106;

export interface BarcodeSvgProps {
  value: string;
  height?: number;
  barWidth?: number;
  showText?: boolean;
  className?: string;
}

export function BarcodeSvg({
  value,
  height = 32,
  barWidth = 1.3,
  showText = false,
  className = ''
}: BarcodeSvgProps) {
  const { bars, totalWidth, displayValue } = useMemo(() => {
    if (!value || typeof value !== 'string') {
      return { bars: [], totalWidth: 0, displayValue: '' };
    }

    // Filter only valid printable ASCII characters (32 to 126) for Code 128B
    const sanitized = value
      .replace(/[\u00A0\u200B\uFEFF\r\n\t]/g, ' ')
      .split('')
      .filter(char => {
        const code = char.charCodeAt(0);
        return code >= 32 && code <= 126;
      })
      .join('')
      .trim();

    if (!sanitized) return { bars: [], totalWidth: 0, displayValue: '' };

    const codes: number[] = [START_B];
    let checksum = START_B;

    for (let i = 0; i < sanitized.length; i++) {
      const code = sanitized.charCodeAt(i) - 32;
      codes.push(code);
      checksum += (i + 1) * code;
    }

    codes.push(checksum % 103);
    codes.push(STOP);

    const quietZone = 4 * barWidth;
    let currentX = quietZone;
    const barSegments: { x: number; width: number }[] = [];

    for (const code of codes) {
      const pattern = CODE128_PATTERNS[code];
      if (!pattern) continue;

      for (let p = 0; p < pattern.length; p++) {
        const moduleWidth = parseInt(pattern[p], 10) * barWidth;
        const isBar = p % 2 === 0;
        if (isBar) {
          barSegments.push({ x: currentX, width: moduleWidth });
        }
        currentX += moduleWidth;
      }
    }

    return { bars: barSegments, totalWidth: currentX + quietZone, displayValue: sanitized };
  }, [value, barWidth]);

  if (!bars.length) {
    return <span className="text-[10px] text-red-500 font-mono">Invalid Barcode</span>;
  }

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        style={{ width: '100%', height: `${height}px`, maxWidth: `${totalWidth}px` }}
        className="overflow-visible block"
        shapeRendering="crispEdges"
        xmlns="http://www.w3.org/2000/svg"
      >
        {bars.map((bar, idx) => (
          <rect
            key={idx}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill="#000000"
          />
        ))}
      </svg>
      {showText && (
        <span className="text-[10px] font-mono tracking-widest font-bold text-black mt-0.5 select-none leading-none">
          {displayValue || value}
        </span>
      )}
    </div>
  );
}
