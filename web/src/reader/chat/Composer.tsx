import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../../components/Icon";
import { nextPlaceholder, placeholders } from "../lib/placeholders";
import { browserStt, type SttEngine } from "../voice/stt";
import { joinText, useDictation } from "../voice/useDictation";
import { imagesOf, pickImages } from "./attachments";
import { loadDraft, saveDraft } from "./drafts";
import { SkillMenu } from "./SkillMenu";
import { type SkillInfo, slashQuery, splitSkill } from "./skillsApi";
import { useHint } from "./useHint";

interface Props {
  /** `voice` is true when the message was (at least partly) dictated: the answer is then read aloud. */
  onSend(text: string, images?: File[], voice?: boolean, skill?: string): void;
  onStop(): void;
  streaming: boolean;
  /** The model that answers, shown quietly under the input. */
  model?: string;
  /** The unsent text is kept per key (a conversation). */
  draftKey?: string;
  /** Put this text in the composer (a new `n` each time); a `[placeholder]` is selected. */
  fill?: { text: string; n: number } | null;
  /**
   * The next questions the tutor recommends: they take turns as the placeholder, Tab on an empty
   * composer fills in the one shown (then Enter sends). Without any, the placeholder shows tips.
   */
  recommendations?: string[];
  /** Whether there is something typed (the suggestions fold away then). */
  onDirty?(dirty: boolean): void;
  /** The dictation engine; by default the browser's, absent where it is not supported. */
  speech?: SttEngine | null;
  /** The skills behind the slash menu; with none, a slash is plain text. */
  skills?: SkillInfo[];
  /** There is a report to open: the tips may say so. */
  hasReports?: boolean;
}

const NO_RECOMMENDATIONS: string[] = [];

interface Attached {
  file: File;
  url: string;
}

/**
 * One quiet pill: attached images, the text, and on the right only what applies now:
 * nothing while it is empty, a send icon once there is text or an image, a stop icon while it
 * answers. Images come from a paste or a drop, never from a button.
 */
export function Composer({
  onSend,
  onStop,
  streaming,
  model,
  draftKey = "new",
  fill = null,
  recommendations = NO_RECOMMENDATIONS,
  onDirty,
  speech,
  skills = [],
  hasReports = false,
}: Props) {
  const [text, setText] = useState(() => loadDraft(draftKey));
  const [images, setImages] = useState<Attached[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [guided, setGuided] = useState(false); // Tab walks through the [placeholders]
  const [selectTick, setSelectTick] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const shownKey = useRef(draftKey);
  const imagesRef = useRef<Attached[]>([]);
  imagesRef.current = images;

  const dictated = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const [browser] = useState(() => (speech === undefined ? browserStt() : null));
  const engine = speech === undefined ? browser : speech;
  const dictation = useDictation(
    engine,
    (words) => {
      dictated.current = true;
      const next = joinText(textRef.current, words);
      textRef.current = next;
      setText(next);
      saveDraft(draftKey, next);
    },
    setNotice,
  );
  const shown = joinText(text, dictation.interim);

  const ready = shown.trim().length > 0 || images.length > 0;

  const hint = useHint(
    !streaming && !ready,
    { skills: skills.length > 0, reports: hasReports, dictation: Boolean(engine) },
    recommendations,
  );
  const query = slashQuery(shown);
  const matches = query === null ? [] : skills.filter((s) => s.name.startsWith(query));
  const menuOpen = matches.length > 0 && !menuClosed;
  const active = Math.min(menuIndex, Math.max(matches.length - 1, 0));
  const choose = (name: string) => {
    edit(`/${name} `);
    area.current?.focus();
  };

  useEffect(() => {
    if (shownKey.current === draftKey) return;
    shownKey.current = draftKey;
    setText(loadDraft(draftKey));
    setGuided(false);
  }, [draftKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new fill acts
  const put = (value: string) => {
    setText(value);
    saveDraft(draftKey, value);
    const first = nextPlaceholder(value, 0, 0);
    pending.current = first ?? { start: value.length, end: value.length };
    setGuided(first !== null);
    setSelectTick((n) => n + 1);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new fill acts
  useEffect(() => {
    if (fill) put(fill.text);
  }, [fill]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after a fill was rendered
  useLayoutEffect(() => {
    const target = pending.current;
    const el = area.current;
    if (!target || !el) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(target.start, target.end);
  }, [selectTick]);

  useEffect(() => onDirty?.(text.length > 0), [text, onDirty]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(
    () => () => {
      for (const i of imagesRef.current) URL.revokeObjectURL(i.url);
    },
    [],
  );

  const attach = (files: File[]) => {
    const { accepted, notice: refused } = pickImages(files, images.length);
    setNotice(refused);
    if (accepted.length)
      setImages((cur) => [
        ...cur,
        ...accepted.map((file) => ({ file, url: URL.createObjectURL(file) })),
      ]);
  };

  const remove = (url: string) => {
    URL.revokeObjectURL(url);
    setImages((cur) => cur.filter((i) => i.url !== url));
  };

  const edit = (value: string) => {
    setMenuIndex(0);
    setMenuClosed(false);
    setText(value);
    saveDraft(draftKey, value);
    if (guided && placeholders(value).length === 0) setGuided(false);
  };

  const submit = () => {
    const value = shown.trim();
    if ((!value && images.length === 0) || streaming) return;
    const voice = dictated.current;
    dictated.current = false;
    const files = images.map((i) => i.file);
    const invoked = splitSkill(value, skills);
    if (invoked) onSend(invoked.text, files.length ? files : undefined, voice, invoked.skill);
    else if (voice) onSend(value, files.length ? files : undefined, true);
    else if (files.length) onSend(value, files);
    else onSend(value);
    dictation.abandon();
    for (const i of images) URL.revokeObjectURL(i.url);
    setImages([]);
    setNotice(null);
    setText("");
    setGuided(false);
    saveDraft(draftKey, "");
  };

  return (
    <div className="composer-wrap">
      {menuOpen && (
        <SkillMenu skills={matches} query={query ?? ""} active={active} onPick={choose} />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop zone, the textarea stays the control */}
      <div
        className="composer"
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          // always claim a file drop: left alone, the browser would open the file over the app
          e.preventDefault();
          const files = imagesOf(e.dataTransfer);
          if (files.length === 0) setNotice("Only PNG, JPEG, WebP and GIF images.");
          else attach(files);
        }}
      >
        {images.length > 0 && (
          <ul className="composer-images">
            {images.map((i) => (
              <li key={i.url}>
                <img src={i.url} alt="" />
                <IconButton
                  icon="close"
                  label="Remove image"
                  className="image-remove"
                  size={12}
                  onClick={() => remove(i.url)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="composer-row">
          <textarea
            ref={area}
            aria-label="Message"
            placeholder={streaming ? "Answering…" : hint.text}
            className={hint.fading ? "hint-fading" : undefined}
            rows={1}
            value={shown}
            onChange={(e) => {
              dictation.abandon();
              edit(e.target.value);
            }}
            onPaste={(e) => {
              const files = imagesOf(e.clipboardData);
              // pasted text always wins: a copied table also carries a picture of itself
              if (files.length === 0 || e.clipboardData.getData("text/plain")) return;
              e.preventDefault();
              attach(files);
            }}
            onKeyDown={(e) => {
              if (menuOpen && !e.nativeEvent.isComposing) {
                const move = (to: number) => {
                  e.preventDefault();
                  setMenuIndex((to + matches.length) % matches.length);
                };
                if (e.key === "ArrowDown") return move(active + 1);
                if (e.key === "ArrowUp") return move(active - 1);
                if (e.key === "Escape") {
                  e.preventDefault();
                  return setMenuClosed(true);
                }
                const exact = matches.some((m) => `/${m.name}` === text.trim());
                if (
                  (e.key === "Enter" && !e.shiftKey && !exact) ||
                  (e.key === "Tab" && !e.shiftKey)
                ) {
                  e.preventDefault();
                  return choose(matches[active]?.name ?? "");
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (
                e.key === "Tab" &&
                !e.shiftKey &&
                hint.reco &&
                !text &&
                images.length === 0
              ) {
                e.preventDefault();
                put(hint.reco);
              } else if (e.key === "Tab" && guided) {
                const el = e.currentTarget;
                const next = nextPlaceholder(text, el.selectionStart, el.selectionEnd, e.shiftKey);
                if (next) {
                  e.preventDefault();
                  el.setSelectionRange(next.start, next.end);
                } else if (placeholders(text).length === 0) setGuided(false);
              }
            }}
          />
          {hint.reco && !text && !streaming && images.length === 0 && (
            <kbd className="composer-key" title="Press Tab to use this suggestion">
              Tab
            </kbd>
          )}
          {engine && !streaming && (
            <IconButton
              icon="mic"
              label={dictation.listening ? "Stop dictation" : "Dictate"}
              className={dictation.listening ? "composer-mic listening" : "composer-mic"}
              pressed={dictation.listening}
              size={18}
              onClick={dictation.toggle}
            />
          )}
          {streaming ? (
            <IconButton
              icon="stop"
              label="Stop"
              className="composer-send"
              onClick={onStop}
              size={20}
            />
          ) : (
            ready && (
              <IconButton
                icon="send"
                label="Send"
                className="composer-send"
                onClick={submit}
                size={20}
              />
            )
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className="composer-notice">
          {notice}
        </p>
      )}
      {model && <p className="composer-status">{model}</p>}
    </div>
  );
}
