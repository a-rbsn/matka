import { topSide } from './faces.js';
import { STEP_HZ, type Throw } from './simulate.js';

/**
 * When each step of a throw is shown. Played straight, step s is at s / STEP_HZ. With slow
 * motion, time slows around the die's last topple (the last time the side on top changes: the
 * "will it go over?" moment), then picks up again for the settle.
 */

/** How slow, and for how long either side of the topple (seconds), with a ramp in and out. */
const SLOW = 0.4;
const BEFORE = 0.3;
const AFTER = 0.2;
const RAMP = 0.15;

/** The step at which the side on top last changed. */
export function lastTopple({ poses, steps }: Throw): number {
	const top = (s: number) =>
		topSide({ x: poses[s * 7 + 3], y: poses[s * 7 + 4], z: poses[s * 7 + 5], w: poses[s * 7 + 6] })
			.side;
	const end = top(steps - 1);
	for (let s = steps - 2; s >= 0; s--) if (top(s) !== end) return s + 1;
	return 0;
}

/** How fast step s plays (1 is real time), `d` seconds from the topple. */
function rate(d: number): number {
	const smooth = (x: number) => x * x * (3 - 2 * x);
	if (d >= -BEFORE && d <= AFTER) return SLOW;
	const out = d < -BEFORE ? (-BEFORE - d) / RAMP : (d - AFTER) / RAMP;
	if (out >= 1) return 1;
	return SLOW + (1 - SLOW) * smooth(out);
}

/** The time (ms from the start) at which each step is shown. */
export function timeline(t: Throw, slow: boolean): Float64Array {
	const wall = new Float64Array(t.steps);
	const topple = slow ? lastTopple(t) : 0;
	for (let s = 1; s < t.steps; s++) {
		const r = slow ? rate((s - 1 - topple) / STEP_HZ) : 1;
		wall[s] = wall[s - 1] + 1000 / STEP_HZ / r;
	}
	return wall;
}

/** The (fractional) step to show `ms` into the throw. */
export function stepAt(wall: Float64Array, ms: number): number {
	const last = wall.length - 1;
	if (ms >= wall[last]) return last;
	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (wall[mid] <= ms) lo = mid;
		else hi = mid;
	}
	return lo + (ms - wall[lo]) / (wall[hi] - wall[lo]);
}
