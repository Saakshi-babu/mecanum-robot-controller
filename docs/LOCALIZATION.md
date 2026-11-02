# Grid localization

## Conventions
- Grid frame in **metres**. Origin = bottom-left grid corner. +X right (columns), +Y up (rows).
- Cells are zero-based: `col = ⌊x / cell⌋`, `row = ⌊y / cell⌋`. Row 0 is at the bottom. Label `C{col}·R{row}`. Points on the far edge belong to the last cell (a 1e-9 m tolerance absorbs float error).
- Heading in degrees. 0° = +X, CCW positive, normalised to (−180°, 180°].
- Body frame: x forward, y left, ω CCW.

## Estimate kinds (never interchangeable)
| Kind | Engine | Available |
|---|---|---|
| `simulated` | `SimulatedPoseEngine`: the simulator's internal pose | demo only |
| `odometry` | `MecanumOdometryEngine`: encoder dead reckoning | demo (simulated encoders) or ESP32 with encoder telemetry |
| `sensor_corrected` | not implemented: needs an absolute reference | — |
| `ground_truth` | manual measurements entered on the page | always (for testing) |

No confidence percentage is shown: no validated uncertainty model exists.

## Odometry algorithm (`src/services/localization/mecanumOdometry.ts`)
Per valid frame: Δθ_w = 2π·Δticks_w / ticksPerRev, then X-roller forward kinematics
`Δx = r/4(FL+FR+RL+RR)`, `Δy = r/4(−FL+FR+RL−RR)`, `Δψ = r/(4k)(−FL+FR−RL+RR)` with k = lx+ly,
rotated into the grid at the midpoint heading. Frames with any missing or invalid encoder reading are skipped.
Jumps over 1.5 × max rpm are rejected and a new baseline is taken. The estimate goes *stale* after 1 s without valid data.

**Drift:** errors in r and k, roller slip (worst when strafing), and uneven floors accumulate without bound.
Re-anchor with **Recalibrate** at known poses and quantify with **Ground-truth checks**.

## Method comparison and recommendation
See the table on the Grid Localization page. Recommended order: (1) encoders + this engine,
(2) gyro for heading (complementary filter or EKF), (3) grid-line or tag detection as a `sensor_corrected`
engine. Each implements `LocalizationEngine` (`src/services/localization/types.ts`), so the UI doesn't change.

## Demo simulator assumptions (`src/services/sim/simulationEngine.ts`)
Fixed 50 ms step. Seeded PRNG. 1st-order motor lag τ = 0.15 s. 100% = max rpm. Lateral efficiency 0.9.
Random slip events (probability set in Settings). Boundary clamp. 500 ms watchdog. Demo trajectories say nothing about real accuracy.
