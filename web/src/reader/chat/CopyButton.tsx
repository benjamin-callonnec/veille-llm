import { useEffect, useState } from "react";
import { IconButton } from "../../components/Icon";

/** A copy icon that turns into a check for a moment once the text is on the clipboard. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      icon={copied ? "check" : "copy"}
      label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(text);
          setCopied(true);
        } catch {
          // the clipboard is not available: nothing to confirm
        }
      }}
    />
  );
}
