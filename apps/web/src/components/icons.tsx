import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps: IconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true
};

export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...props}>
      <path d="M5 3.5v9l7-4.5z" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2 5a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="5" cy="4" r="1.5" />
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="11" cy="8" r="1.5" />
      <path d="M5 5.5v5M6.4 4.7c2.5 0 4 1.4 4 3.3" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 3 3" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <circle cx="8" cy="8" r="7" />
      <path d="M5 5l6 6M11 5l-6 6" />
    </svg>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function MinusCircleIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M5 8h6" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="3" width="9" height="9" rx="1.5" />
      <path d="M5.5 5.5h6v6" />
    </svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2 4a1 1 0 0 1 1-1h4M2 4v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8M2 4l5 5M14 2v4M14 2h-4M14 2L9 7" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2 8a6 6 0 1 0 6-6" />
      <path d="M2 2v4h4" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 2h7l3 3v9H3z" />
      <path d="M10 2v3h3" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="7" r="1.2" />
      <path d="M2 11l4-3 8 5" />
    </svg>
  );
}

export function PlayCircleIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6l4 2-4 2z" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2 5h12M2 8h12M2 11h12" />
    </svg>
  );
}

export function ConsoleIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 3h10v10H3z" />
      <path d="M5 6h6M5 8h6M5 10h4" />
    </svg>
  );
}

export function TraceIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2 12V4l4 2 4-3 4 3v8z" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M8 2v9M4 7l4 4 4-4M3 14h10" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...props}>
      <path d="M9.5 2.5a5.5 5.5 0 1 0 4.5 8.5 6 6 0 0 1-4.5-8.5z" />
    </svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M5.5 13.5h5" />
    </svg>
  );
}
