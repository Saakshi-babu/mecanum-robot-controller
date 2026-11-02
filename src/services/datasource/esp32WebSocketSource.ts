import type { MotionCommand } from '../../types/models';
import { encodeCommand, parseMessage } from './protocol';
import { clockNow, type DataSource, type DataSourceListener } from './types';

/**
 * ESP32 adapter over WebSocket using the DRAFT protocol in protocol.ts.
 *
 * Connection states:
 *  - connecting:   socket opening, or open but no valid message received from firmware yet.
 *  - connected:    socket open AND a valid hello/ack/telemetry message has been received.
 *  - disconnected: socket closed; reconnect attempts with exponential backoff (1 s → 10 s).
 *  - error:        URL invalid or socket error.
 * "Connected" therefore means "a device speaking the protocol answered", not merely "socket open".
 */
export class Esp32WebSocketSource implements DataSource {
  readonly kind = 'esp32' as const;
  private ws: WebSocket | null = null;
  private listener: DataSourceListener | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;
  private everConnected = false;
  private confirmed = false;
  private stopped = true;

  constructor(private readonly url: string) {}

  get writable(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  start(listener: DataSourceListener): void {
    this.listener = listener;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
    this.listener = null;
  }

  send(cmd: MotionCommand): number | null {
    if (!this.writable || !this.ws) return null;
    const sentAt = clockNow();
    try {
      this.ws.send(encodeCommand(cmd));
    } catch (e) {
      this.listener?.onError(`Send failed: ${(e as Error).message}`);
      return null;
    }
    return sentAt;
  }

  private open(): void {
    const l = this.listener;
    if (!l) return;
    if (!/^wss?:\/\/[^\s/]+/i.test(this.url)) {
      l.onState('error', 'No valid WebSocket URL configured (expected ws://host/path). Set it in Settings.');
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      l.onState('error', `Cannot open socket: ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    this.confirmed = false;
    l.onState('connecting', `Opening ${this.url}`);
    ws.onopen = () => {
      this.backoffMs = 1000;
      this.listener?.onState('connecting', 'Socket open — waiting for a valid message from the firmware');
    };
    ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : '';
      const msg = parseMessage(text, clockNow());
      const li = this.listener;
      if (!li) return;
      if (msg.type === 'invalid') {
        li.onInvalid(msg.reason, text.slice(0, 200));
        return;
      }
      if (!this.confirmed) {
        this.confirmed = true;
        li.onState('connected', 'Firmware responded with a valid message');
        if (this.everConnected) li.onReconnect?.();
        this.everConnected = true;
      }
      if (msg.type === 'hello') li.onInfo?.(`Firmware hello: version ${msg.firmware ?? 'unknown'}, capabilities [${msg.caps.join(', ') || 'none declared'}]`);
      else if (msg.type === 'ack') li.onAck(msg.ack);
      else li.onTelemetry(msg.frame);
    };
    ws.onerror = () => {
      this.listener?.onError('WebSocket error (browser does not expose details)');
    };
    ws.onclose = (ev) => {
      this.ws = null;
      if (this.stopped) return;
      this.listener?.onState('disconnected', `Socket closed (code ${ev.code}). Retrying in ${Math.round(this.backoffMs / 1000)} s`);
      this.retryTimer = setTimeout(() => this.open(), this.backoffMs);
      this.backoffMs = Math.min(10000, this.backoffMs * 2);
    };
  }
}
