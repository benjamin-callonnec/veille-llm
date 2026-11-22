/** The web app's monogram: "Lw" in a rounded square, coloured by the Papier / Nuit tokens. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <text
        x="16"
        y="22.5"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="700"
        fontSize="17"
        fill="var(--accent-fg)"
      >
        Lw
      </text>
    </svg>
  );
}
