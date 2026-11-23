import { IconButton } from "../../components/Icon";
import type { Synth } from "./tts";
import { defaultSynth, useReadAloud } from "./useReadAloud";

/** A speaker icon that reads the answer aloud, and a stop icon while it does (click again to replay). */
export function ReadAloudButton({
  text,
  streaming,
  synth,
}: {
  text: string;
  streaming: boolean;
  synth?: Synth | null;
}) {
  const voice = useReadAloud(text, streaming, synth === undefined ? defaultSynth() : synth);
  if (!voice.supported) return null;
  return (
    <>
      <IconButton
        icon={voice.active ? "stop" : "speaker"}
        label={voice.active ? "Stop reading" : "Read aloud"}
        className={voice.active ? "reading" : undefined}
        pressed={voice.active}
        onClick={voice.toggle}
      />
      {voice.error && (
        <span role="status" className="msg-time">
          {voice.error}
        </span>
      )}
    </>
  );
}
