import type { JSX } from 'react'

export interface IconProps {
  className?: string
}

function iconProps(className: string | undefined): {
  className: string
  viewBox: string
  fill: string
  stroke: string
  strokeWidth: number
  strokeLinecap: 'round'
  strokeLinejoin: 'round'
} {
  return {
    className: className ?? 'size-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}

export function BranchIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

export function UploadIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  )
}

export function TagIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  )
}

export function CloudIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function FolderOpenIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function SunIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

export function MoonIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

export function MonitorIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  )
}

export function GlobeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  )
}

export function AlertTriangleIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

export function ChevronRightIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

export function FileIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M15 2v5h5" />
    </svg>
  )
}

export function LinkIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export function FilePlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M15 2v5h5" />
      <path d="M12 12v6" />
      <path d="M9 15h6" />
    </svg>
  )
}

export function FolderPlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M12 10v6" />
      <path d="M9 13h6" />
    </svg>
  )
}

export function SlidersIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M1 14h6" />
      <path d="M9 8h6" />
      <path d="M17 16h6" />
    </svg>
  )
}

export function CheckSquareIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

export function SquareIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  )
}

export function XIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

export function MinusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  )
}

export function UndoIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  )
}

export function ChangesIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9v3a6 6 0 0 1-6 6h-3" />
    </svg>
  )
}

export function IgnoreIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...iconProps(className)} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  )
}
