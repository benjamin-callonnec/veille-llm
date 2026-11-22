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
  | "compose";

/** One line style for every icon of the app: 24px grid, round caps, drawn in the current colour. */
const SHAPES: Record<IconName, ReactNode> = {
  send: (
    <>
      <path d="M20 5v6a3 3 0 0 1-3 3H5" />
      <path d="M9 10l-4 4 4 4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  compose: (
    <>
      <path d="M12 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h9a2.5 2.5 0 0 0 2.5-2.5V12" />
      <path d="M17.5 4.5a1.8 1.8 0 0 1 2.5 2.5L12 15l-3.5 1 1-3.5z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
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
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : "icon-btn"}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
