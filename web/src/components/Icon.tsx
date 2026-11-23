import type { ReactNode } from "react";

export type IconName =
  | "send"
  | "stop"
  | "plus"
  | "copy"
  | "check"
  | "retry"
  | "more"
  | "edit"
  | "download"
  | "trash"
  | "chevron"
  | "compose"
  | "close"
  | "quiz"
  | "highlighter"
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  | "search"
  | "outline"
  | "settings"
  | "mic"
  | "speaker"
  | "note"
  | "trace"
  | "raise"
  | "person"
  | "sparkle"
  | "report"
  | "expand"
  | "external"
  | "minus";

/** One line style for every icon of the app: 24px grid, round caps, drawn in the current colour. */
const SHAPES: Record<IconName, ReactNode> = {
  send: (
    <>
      <path d="M20 5v6a3 3 0 0 1-3 3H5" />
      <path d="M9 10l-4 4 4 4" />
    </>
  ),
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "arrow-up": <path d="M12 19V5M6 11l6-6 6 6" />,
  "arrow-down": <path d="M12 5v14M6 13l6 6 6-6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  highlighter: (
    <>
      <path d="M14 5l5 5-7 7-5-5z" />
      <path d="M7 12l-2.5 5.5L10 15" />
      <path d="M4 20h9" />
    </>
  ),
  compose: (
    <>
      <path d="M12 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h9a2.5 2.5 0 0 0 2.5-2.5V12" />
      <path d="M17.5 4.5a1.8 1.8 0 0 1 2.5 2.5L12 15l-3.5 1 1-3.5z" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8" />
      <circle cx="12" cy="16.6" r="0.6" fill="currentColor" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  retry: (
    <>
      <path d="M20 12a8 8 0 1 1-2.8-6.1" />
      <path d="M20 4v5h-5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  note: (
    <>
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  trace: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  minus: <path d="M5 12h14" />,
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  report: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  raise: <path d="M12 18V8M7 12l5-5 5 5M6 4h12" />,
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  sparkle: <path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" />,
  outline: <path d="M4 6h16M4 12h16M4 18h10" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}

interface IconButtonProps {
  icon: IconName;
  /** The accessible name, also shown as the tooltip. */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  size?: number;
  expanded?: boolean;
  /** A toggle that is on (read by screen readers and styled as active). */
  pressed?: boolean;
}

/** A quiet button that is only an icon: the name lives in aria-label and title. */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  className,
  size,
  expanded,
  pressed,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : "icon-btn"}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-expanded={expanded}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
