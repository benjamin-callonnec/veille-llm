/** Frames the server sends (see src/veille_reader/voice.py). */
export type Incoming =
  | { type: "hello"; protocol: number; stt: boolean; tts: boolean }
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "audio_start"; id: number; format: string; rate: number }
  | { type: "audio_end"; id: number }
  | { type: "cancelled"; id: number }
  | { type: "pong" }
  | { type: "error"; code: string; message: string }
  | { type: "audio"; data: ArrayBuffer };

/** Frames the client sends. */
export type Outgoing =
  | { type: "start_stt"; rate: number }
  | { type: "stop_stt" }
  | { type: "speak"; id: number; text: string }
  | { type: "cancel"; id: number }
  | { type: "ping" };

export type SocketStatus = "connecting" | "open" | "closed" | "failed";

/** The part of WebSocket used here, so a test can pass a fake. */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

const OPEN = 1;
const POLICY = 1008;
const FIRST_DELAY = 500;
const MAX_DELAY = 8000;
const MAX_ATTEMPTS = 5;

export function voiceUrl(loc: { protocol: string; host: string } = window.location): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/voice`;
}

interface Options {
  url?: string;
  factory?: (url: string) => SocketLike;
  onMessage(message: Incoming): void;
  onStatus(status: SocketStatus): void;
}

/** The client side of the voice channel: reconnects with a growing delay, then says it gave up. */
export class VoiceSocket {
  problem: string | null = null;
  private socket: SocketLike | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;

  constructor(private readonly options: Options) {}

  connect(): void {
    this.wanted = true;
    this.problem = null;
    this.open();
  }

  close(): void {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    s?.close();
    this.options.onStatus("closed");
  }

  send(message: Outgoing): boolean {
    if (this.socket?.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  sendAudio(chunk: ArrayBuffer): boolean {
    if (this.socket?.readyState !== OPEN) return false;
    this.socket.send(chunk);
    return true;
  }

  private open(): void {
    const url = this.options.url ?? voiceUrl();
    const s: SocketLike = this.options.factory
      ? this.options.factory(url)
      : (new WebSocket(url) as unknown as SocketLike);
    s.binaryType = "arraybuffer";
    this.socket = s;
    this.options.onStatus("connecting");
    s.onopen = () => this.options.onStatus("open");
    s.onmessage = (e) => {
      if (typeof e.data !== "string") {
        this.options.onMessage({ type: "audio", data: e.data });
        return;
      }
      try {
        const frame = JSON.parse(e.data) as Incoming;
        if (frame.type === "hello") this.attempts = 0;
        this.options.onMessage(frame);
      } catch {
        // a frame we cannot read is ignored
      }
    };
    s.onerror = () => {};
    s.onclose = (e) => {
      if (this.socket !== s) return;
      this.socket = null;
      if (!this.wanted) return;
      if (e.code === POLICY) {
        this.fail("The voice channel was refused by the local server.");
      } else this.retry();
    };
  }

  private retry(): void {
    if (this.attempts >= MAX_ATTEMPTS) {
      this.fail("The voice channel is not reachable. Is the reader still running?");
      return;
    }
    const delay = Math.min(FIRST_DELAY * 2 ** this.attempts, MAX_DELAY);
    this.attempts += 1;
    this.options.onStatus("connecting");
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wanted) this.open();
    }, delay);
  }

  private fail(problem: string): void {
    this.problem = problem;
    this.wanted = false;
    this.options.onStatus("failed");
  }
}
