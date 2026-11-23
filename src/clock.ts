/**
 * Production clock adapter: Unix seconds with millisecond precision.
 *
 * The I/O-free core defines the `Clock` type; this shell module owns the real
 * adapter. Tests inject a frozen clock through the same seam.
 */

import type { Clock } from "./query-window.js";

export const realClock: Clock = () => Date.now() / 1000;
