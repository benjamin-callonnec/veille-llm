import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type Incoming, type SocketLike, VoiceSocket, voiceUrl } from "./voiceSocket";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  binaryType = "";
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function setup() {
  const messages: Incoming[] = [];
  const statuses: string[] = [];
  const socket = new VoiceSocket({
    url: "ws://127.0.0.1:8765/api/voice",
    factory: (url) => new FakeSocket(url),
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
  });
  return { socket, messages, statuses };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

test("the url follows the page, over ws or wss", () => {
  expect(voiceUrl({ protocol: "http:", host: "127.0.0.1:8765" })).toBe(
    "ws://127.0.0.1:8765/api/voice",
  );
  expect(voiceUrl({ protocol: "https:", host: "localhost:1" })).toBe("wss://localhost:1/api/voice");
});

test("connects, reports open and delivers JSON frames", () => {
  const { socket, messages, statuses } = setup();
  socket.connect();
  expect(statuses).toEqual(["connecting"]);
  FakeSocket.all[0]?.open();
  FakeSocket.all[0]?.say({ type: "hello", protocol: 1, stt: true, tts: true });
  expect(statuses).toEqual(["connecting", "open"]);
  expect(messages).toEqual([{ type: "hello", protocol: 1, stt: true, tts: true }]);
});

test("binary audio frames are delivered as bytes", () => {
  const { socket, messages } = setup();
  socket.connect();
  const bytes = new Uint8Array([1, 2]).buffer;
  FakeSocket.all[0]?.onmessage?.({ data: bytes });
  expect(messages).toEqual([{ type: "audio", data: bytes }]);
});

test("nothing is sent while closed; frames go out once open", () => {
  const { socket } = setup();
  expect(socket.send({ type: "ping" })).toBe(false);
  socket.connect();
  expect(socket.send({ type: "ping" })).toBe(false);
  FakeSocket.all[0]?.open();
  expect(socket.send({ type: "ping" })).toBe(true);
  expect(socket.sendAudio(new ArrayBuffer(4))).toBe(true);
  expect(FakeSocket.all[0]?.sent[0]).toBe('{"type":"ping"}');
});

test("a dropped connection is retried with a growing delay, then gives up with a clear error", () => {
  const { socket, statuses } = setup();
  socket.connect();
  for (let i = 0; i < 6; i++) {
    FakeSocket.all[i]?.drop();
    vi.advanceTimersByTime(10_000);
  }
  expect(FakeSocket.all).toHaveLength(6);
  FakeSocket.all[5]?.drop();
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(6);
  expect(statuses.at(-1)).toBe("failed");
  expect(socket.problem).toMatch(/voice/i);
});

test("a successful connection resets the retry budget", () => {
  const { socket } = setup();
  socket.connect();
  for (let round = 0; round < 10; round++) {
    const s = FakeSocket.all.at(-1) as FakeSocket;
    s.open();
    s.say({ type: "hello", protocol: 1, stt: true, tts: true });
    s.drop();
    vi.advanceTimersByTime(1000);
  }
  expect(FakeSocket.all).toHaveLength(11);
});

test("the delay doubles", () => {
  const { socket } = setup();
  socket.connect();
  FakeSocket.all[0]?.drop();
  vi.advanceTimersByTime(499);
  expect(FakeSocket.all).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.all[1]?.drop();
  vi.advanceTimersByTime(999);
  expect(FakeSocket.all).toHaveLength(2);
  vi.advanceTimersByTime(1);
  expect(FakeSocket.all).toHaveLength(3);
});

test("close() is final: no retry", () => {
  const { socket, statuses } = setup();
  socket.connect();
  FakeSocket.all[0]?.open();
  socket.close();
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(1);
  expect(statuses.at(-1)).toBe("closed");
});

test("a refusal by the server (policy close) is not retried", () => {
  const { socket, statuses } = setup();
  socket.connect();
  FakeSocket.all[0]?.drop(1008);
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(1);
  expect(statuses.at(-1)).toBe("failed");
  expect(socket.problem).toMatch(/refused/i);
});

test("a server error frame is delivered", () => {
  const { socket, messages } = setup();
  socket.connect();
  FakeSocket.all[0]?.say({ type: "error", code: "no_engine", message: "none" });
  expect(messages[0]).toEqual({ type: "error", code: "no_engine", message: "none" });
});

test("a garbled frame is ignored", () => {
  const { socket, messages } = setup();
  socket.connect();
  FakeSocket.all[0]?.onmessage?.({ data: "not json" });
  expect(messages).toEqual([]);
});
