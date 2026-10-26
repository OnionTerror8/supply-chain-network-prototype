"use client";

import type { VehicleKind } from "@/lib/visual/mode";

/** Shared SVG symbols for live flow. Colour via `currentColor` on the parent. */
export function VehicleDefs() {
  return (
    <defs>
      <g id="veh-truck">
        <rect x="-10" y="-4.5" width="13" height="7.5" rx="1" fill="currentColor" />
        <rect x="3" y="-3" width="7" height="6" rx="0.9" fill="currentColor" />
        <circle cx="-5.5" cy="4.2" r="1.7" fill="#1c1917" />
        <circle cx="5.5" cy="4.2" r="1.7" fill="#1c1917" />
      </g>
      <g id="veh-ship">
        <path d="M-12 2.2 L-8 -2.4 H8 L12 2.2 Z" fill="currentColor" />
        <rect x="-2" y="-5.5" width="7" height="3.6" rx="0.4" fill="currentColor" />
        <rect x="3.2" y="-8.2" width="1.7" height="3" fill="currentColor" />
      </g>
      <g id="veh-van">
        <rect x="-8" y="-3.8" width="16" height="6.4" rx="1.4" fill="currentColor" />
        <circle cx="-4.2" cy="3.4" r="1.6" fill="#1c1917" />
        <circle cx="4.2" cy="3.4" r="1.6" fill="#1c1917" />
      </g>
    </defs>
  );
}

export function MovingVehicle({
  path,
  kind,
  color,
  dur,
  delay = "0s",
  scale = 1,
}: {
  path: string;
  kind: VehicleKind;
  color: string;
  dur: string;
  delay?: string;
  scale?: number;
}) {
  return (
    <g className="pointer-events-none flow-particle" style={{ color }} aria-hidden>
      <g>
        <animateMotion dur={dur} begin={delay} repeatCount="indefinite" rotate="auto" path={path} />
        <g transform={`scale(${scale})`}>
          <use href={`#veh-${kind}`} />
        </g>
      </g>
    </g>
  );
}
