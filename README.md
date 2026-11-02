# mecanum-robot-controller

Web controller, live monitoring dashboard and grid localization UI for an ESP32 mecanum-wheel robot.
**Phase: frontend with a deterministic demo simulator.** No robot or firmware is required. AI vision is out of scope.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit + integration tests (Vitest)
npm run build    # typecheck + production build into dist/
```

## Pages
- **Overview**: status summary and a hardware capability checklist (nothing is assumed confirmed).
- **Robot Controller**: hold-to-move 8-way pad, separate in-place rotation, a latching UI STOP, a speed slider, the commanded wheel speeds, and the command history.
  Keyboard: W/A/S/D (diagonals by combining keys), Q/E rotate, Space stop, Esc latch-stop. Ignored while typing. Stops on blur, tab switch or conflicting keys.
- **Live Dashboard**: connection, command RTT (latest/avg/min/max/p95/sample count), link health, power/energy, motor telemetry, recent events. CSV export.
- **Grid Localization**: configurable grid, robot marker and heading, trail, current cell, simulated pose vs odometry estimate, recalibration, ground-truth checks, method assessment.
- **Event Logs**: filter by category, severity, source, time and text. CSV export.
- **Settings**: Demo/ESP32 mode (switching clears all data), ESP32 WebSocket URL, simulator parameters, controller, display, robot geometry and grid.

## Data integrity rules
- Every reading carries `source` (`simulated` | `esp32`), a timestamp, a unit and a validity. The UI labels simulated values everywhere and shows a DEMO badge.
- Demo mode never shows *Connected*. ESP32 mode shows *Connected* only after the firmware sends a valid message.
- Missing measurements show N/A. They are never zero-filled. Timeouts are excluded from latency statistics.
- One store (`src/store/robotStore.ts`) feeds every card, chart and export.

## Architecture
```
src/types/models.ts            typed data models
src/lib/                       pure, tested logic: kinematics, keyboard, latency, commStats, power, grid, csv
src/services/sim/              deterministic simulator + simulated link (seeded)
src/services/datasource/       DataSource interface, DemoDataSource, Esp32WebSocketSource, draft protocol
src/services/localization/     LocalizationEngine interface, simulated + mecanum odometry engines
src/store/                     RobotStore (single source of truth), defaults, CSV exports
src/components/, src/pages/    React UI (hand-written SVG charts, no chart library)
docs/                          ESP32_INTEGRATION.md, LOCALIZATION.md
```

Next steps for hardware: see [docs/ESP32_INTEGRATION.md](docs/ESP32_INTEGRATION.md).
