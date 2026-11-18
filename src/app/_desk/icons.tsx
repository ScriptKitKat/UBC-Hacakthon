const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function BrandMark() {
  return (
    <svg width={30} height={30} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4cc2ff" />
          <stop offset="1" stopColor="#3ddc84" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#brand-gradient)" />
      <path d="M7 21l6-6 4 4 8-9" fill="none" stroke="#04121f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 10v4h4l5 4V6L8 10H4z" />
      <path d="M16.5 8.5a5 5 0 010 7" />
      <path d="M19 6a8.5 8.5 0 010 12" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg {...ICON_PROPS} width={34} height={34}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg {...ICON_PROPS} width={30} height={30} fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
