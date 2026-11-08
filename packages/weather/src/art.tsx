import { useId, type ReactElement } from "react";

// The illustration on the left of a weather card, drawn in a 120 x 100 box.
// Clouds are slightly see-through so a sun or moon glows behind them, like
// frosted glass. Purely decorative: the card's text carries the information.

export type IconKind = "sun" | "moon" | "sun-cloud" | "moon-cloud" | "cloud" | "rain" | "snow" | "storm" | "fog";

export function iconFor(code: number, isDay: boolean): IconKind {
  if (code === 0 || code === 1) return isDay ? "sun" : "moon";
  if (code === 2) return isDay ? "sun-cloud" : "moon-cloud";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 95 || code === 96 || code === 99) return "storm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloud";
}

// Light cards get a white cloud, dark cards a pale blue one.
export function Icon({ kind, light }: { kind: IconKind; light: boolean }): ReactElement {
  const uid = useId().replace(/:/g, "");
  const cloudTop = light ? "#ffffff" : "#b9d6f6";
  const cloudBottom = light ? "#cfe0f2" : "#5c93d8";
  const stormTop = "#8794a8", stormBottom = "#4b586d";
  const dark = kind === "storm";
  const top = dark ? stormTop : cloudTop, bottom = dark ? stormBottom : cloudBottom;
  const cloudId = `${uid}c`, sunId = `${uid}s`, glowId = `${uid}g`, blurId = `${uid}b`;
  const cloud = (dx = 0, dy = 0, scale = 1, opacity = 0.92) => (
    <g transform={`translate(${dx} ${dy}) scale(${scale})`} fill={`url(#${cloudId})`} opacity={opacity}>
      <circle cx="36" cy="64" r="17" />
      <circle cx="58" cy="52" r="23" />
      <circle cx="84" cy="62" r="18" />
      <rect x="22" y="62" width="76" height="20" rx="10" />
      <ellipse cx="52" cy="46" rx="16" ry="7" fill="#ffffff" opacity="0.35" filter={`url(#${blurId})`} />
    </g>
  );
  const rays = (cx: number, cy: number, r1: number, r2: number, angles: readonly number[]) => angles.map((a) => {
    const rad = (a * Math.PI) / 180;
    return <line key={a} x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1} x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2} stroke="#ffcf3f" strokeWidth="5" strokeLinecap="round" />;
  });
  let body: ReactElement;
  switch (kind) {
    case "sun":
      body = <>{rays(60, 50, 33, 44, [0, 45, 90, 135, 180, 225, 270, 315])}<circle cx="60" cy="50" r="26" fill={`url(#${sunId})`} /></>;
      break;
    case "moon":
      body = <>
        <path d="M74 14 A36 36 0 1 0 100 70 A28 28 0 1 1 74 14 Z" fill="#ffe08a" />
        <circle cx="96" cy="22" r="2.4" fill="#ffe9a8" /><circle cx="108" cy="42" r="1.8" fill="#ffe9a8" /><circle cx="26" cy="22" r="1.8" fill="#ffe9a8" />
      </>;
      break;
    case "sun-cloud":
      body = <>
        {rays(74, 38, 29, 39, [-150, -110, -70, -30])}
        <circle cx="74" cy="38" r="22" fill={`url(#${sunId})`} />
        {cloud(-4, 6, 0.95, 0.9)}
      </>;
      break;
    case "moon-cloud":
      body = <>
        <path d="M86 8 A26 26 0 1 0 104 50 A20 20 0 1 1 86 8 Z" fill="#ffe08a" />
        {cloud(-4, 8, 0.95, 0.92)}
      </>;
      break;
    case "rain":
      body = <>
        {cloud(0, -6, 1)}
        {[34, 56, 78].map((x, i) => <path key={x} d={`M${x} ${80 + (i % 2) * 6} q-5 9 0 13 q5 -4 0 -13 z`} fill="#58b0ff" stroke="#58b0ff" strokeWidth="3" strokeLinejoin="round" />)}
      </>;
      break;
    case "snow":
      body = <>
        {cloud(0, -6, 1)}
        {[34, 56, 78].map((x, i) => <circle key={x} cx={x} cy={88 + (i % 2) * 6} r="4" fill="#ffffff" stroke={light ? "#8fb4d8" : "#ffffff"} strokeWidth="1" />)}
      </>;
      break;
    case "storm":
      body = <>
        {cloud(0, -8, 1)}
        <path d="M62 66 L46 90 L58 90 L52 108 L76 80 L63 80 L72 66 Z" fill="#ffd34d" transform="translate(0 -6)" />
      </>;
      break;
    case "fog":
      body = <>
        {cloud(0, -8, 1, 0.9)}
        {[78, 88, 98].map((y, i) => <line key={y} x1={22 + i * 6} y1={y} x2={98 - i * 4} y2={y} stroke={light ? "#8aa0ae" : "#c3ced5"} strokeWidth="5" strokeLinecap="round" opacity="0.85" />)}
      </>;
      break;
    default:
      body = cloud();
  }
  return (
    <svg className="wx-icon" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={cloudId} gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="84">
          <stop offset="0" stopColor={top} /><stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={sunId} cx="0.4" cy="0.35" r="0.8"><stop offset="0" stopColor="#ffe45c" /><stop offset="1" stopColor="#ffb020" /></radialGradient>
        <radialGradient id={glowId}><stop offset="0" stopColor="#ffffff" stopOpacity="0.5" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></radialGradient>
        <filter id={blurId} x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      {body}
    </svg>
  );
}
