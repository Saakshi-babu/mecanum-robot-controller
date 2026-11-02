# ESP32 integration requirements

Status: **no firmware exists yet.** The frontend ships with a demo simulator and an ESP32 WebSocket
adapter that speaks the *draft* protocol below. This document lists what the firmware and hardware
must provide before any real telemetry or localization can be shown.

Reviewed references: `Saakshi-babu/iot-ai-wifi-test` (robotic-arm controller, HTTP GET
`/move?base=..&shoulder=..`, no acks or telemetry) and `Saakshi-babu/test` (README only). Neither
contains mecanum firmware, so nothing below is assumed to exist.

## 1. Transport

| Option | Notes |
|---|---|
| **WebSocket (recommended)** | One persistent connection, low overhead, server push for telemetry. Adapter: `src/services/datasource/esp32WebSocketSource.ts`. ESP32 libs: `ESPAsyncWebServer` + `AsyncWebSocket`, or ESP-IDF `httpd` WS. |
| HTTP (like the arm project) | One TCP request per command (higher, more variable latency) and no push telemetry. Would need a new adapter implementing `DataSource`. |

- The URL is configured in **Settings → ESP32 connection** (e.g. `ws://192.168.4.1/ws`). No endpoint is assumed.
- A page served over `https://` cannot open `ws://`. Serve the built app (`dist/`) over plain HTTP on
  the LAN, or from the ESP32's flash (LittleFS).
- No Wi-Fi credentials are stored in the frontend. Keep them in firmware config (not committed to git), or use AP mode.

## 2. Draft protocol v0 (JSON text frames)

Browser → ESP32:
```json
{"type":"cmd","seq":42,"dir":"forward","speed":60,"hb":false}
```
- `seq`: unsigned integer, strictly increasing per connection.
- `dir`: one of `stop forward backward left right forward_left forward_right backward_left backward_right rotate_ccw rotate_cw`.
- `speed`: 0–100 (% of maximum). **Firmware defines what 100% means** (PWM duty or closed-loop wheel speed).
- `hb`: true for a heartbeat re-send of the current command (sent every `heartbeatMs`, default 200 ms).

ESP32 → Browser:
```json
{"type":"hello","fw":"0.1.0","caps":["ack","voltage","current","encoders"]}
{"type":"ack","seq":42,"proc_us":180}
{"type":"telemetry","seq":7,"v":11.92,"i":1.18,"dir":"forward",
 "wheels":{"FL":{"cmd":60,"rpm":118.5,"ticks":34012},"FR":{...},"RL":{...},"RR":{...}}}
```
- `hello` on connect. The UI only shows **Connected** after the first valid message.
- `ack` for **every** `cmd`, including heartbeats, sent as soon as the command is parsed and applied.
  `proc_us` (optional) = microseconds from frame received to ack sent.
- `telemetry` at a fixed rate (10–20 Hz suggested). Any field may be omitted when the hardware doesn't
  have it. Omitted → shown as *missing/N/A*; non-numeric → *invalid*. Never send `0` for "unknown".
- `ticks`: **cumulative** signed encoder count per wheel (not deltas), positive = wheel rolling the robot forward.

## 3. Required firmware behaviour (safety)

1. **Dead-man watchdog:** if no valid `cmd` arrives for ≥ 500 ms (≥ 2.5 × heartbeat), stop all motors.
   The UI cannot enforce this, and the UI STOP button is **not** an emergency stop.
2. On WebSocket disconnect: stop motors immediately.
3. `stop` must always be accepted, regardless of state.
4. A physical emergency stop (a switch cutting motor power) is strongly recommended. Any software stop
   depends on the link, the browser and the firmware.
5. Clamp speed to 0–100 and reject unknown `dir` values (reply nothing or an error frame; never move).

## 4. Measurement definitions the UI relies on

| Metric | Definition | Needs |
|---|---|---|
| Command RTT | browser clock just before `ws.send(cmd)` → browser clock at `ack` with the same `seq` | `ack` with `seq` |
| Timeout | no ack within *Ack timeout* (default 300 ms). Excluded from stats, never 0 | `ack` |
| ESP32 processing | `proc_us` as reported. Not derived from RTT | optional `proc_us` |
| Physical response | **Not measured.** Would need e.g. first encoder change after the command, timestamped on the ESP32 | encoders + firmware timestamp |
| Ack rate | acked ÷ (acked + timeouts) over resolved commands in the window | `ack` |
| P = V × I | only when both are valid and ≤ 50 ms apart | V & I at the same point |
| Energy | trapezoidal ∫P dt; gaps > 500 ms are skipped | continuous V & I |

## 5. Hardware still to confirm

| Item | Why | Example |
|---|---|---|
| Motor driver + pin map | motion at all | TB6612FNG / L298N / DRV8833 ×2 |
| Roller arrangement (X vs O) & motor sign per wheel | kinematics signs | check by strafing |
| Wheel encoders (4×, quadrature) | RPM, odometry | gear motors with Hall encoders. ESP32 PCNT units |
| Voltage/current sensor on battery output | power/energy | INA219 / INA226 (I²C) |
| IMU (optional) | heading drift | MPU-6050, BNO055 |
| Absolute reference (optional) | drift correction | IR grid-line sensors, RFID tags |

Measure and enter in **Settings → Robot geometry**: wheel radius, half wheelbase (lx), half track (ly),
encoder counts per wheel revolution (after the gearbox, ×4 if decoding quadrature), max wheel rpm.

## 6. Integration test plan

1. Connect with a stub firmware that only sends `hello` + acks → verify RTT/ack rate, then unplug Wi-Fi → verify timeouts, *Disconnected*, reconnection count.
2. Send malformed frames → *Invalid msgs* increments, nothing crashes.
3. Wheels off the ground: each direction button → check the wheel sign pattern against the Controller page's "Commanded wheel speeds".
4. Watchdog: close the browser tab while moving → motors stop within 500 ms.
5. Odometry: mark the floor, recalibrate at a known pose, drive 1 m forward / strafe 1 m / rotate 360°. Record ground-truth checks and tune radius and lx+ly.
