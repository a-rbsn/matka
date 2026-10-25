import { describe, expect, it } from 'vitest';
import { contrast, MIN_CONTRAST, pickTwo, PRIMARIES } from './colours.js';
import { DICE, labelsFor, NORMALS, topSide, type Side } from './faces.js';
import * as THREE from 'three';
import { place, simulate } from './simulate.js';
import { lastTopple, stepAt, timeline } from './timing.js';

/** A seeded random (mulberry32), so a failing throw can be replayed. */
function seeded(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SIDES: Side[] = [0, 1, 2, 3, 4, 5];
const opposite = (s: Side) => (s ^ 1) as Side;

describe('faces', () => {
	it('knows the 24 real dice, each a 1 to 6 with opposites adding to 7', () => {
		expect(DICE).toHaveLength(24);
		expect(new Set(DICE.map((d) => d.join())).size).toBe(24);
		for (const d of DICE) {
			expect([...d].sort()).toEqual([1, 2, 3, 4, 5, 6]);
			for (const s of SIDES) expect(d[s] + d[opposite(s)]).toBe(7);
		}
	});

	it('keeps 1, 2, 3 anticlockwise round their corner (no mirror-image dice)', () => {
		for (const d of DICE) {
			const [a, b, c] = [1, 2, 3].map((n) => NORMALS[d.indexOf(n)]);
			// (a × b) · c > 0: right-handed.
			const cross = [
				a[1] * b[2] - a[2] * b[1],
				a[2] * b[0] - a[0] * b[2],
				a[0] * b[1] - a[1] * b[0]
			];
			expect(cross[0] * c[0] + cross[1] * c[1] + cross[2] * c[2]).toBe(1);
		}
	});

	it('puts any face on any side, in four ways', () => {
		for (const side of SIDES) {
			for (let face = 1; face <= 6; face++) {
				const seen = new Set<string>();
				for (let r = 0; r < 1; r += 0.125) {
					const labels = labelsFor(side, face, () => r);
					expect(labels[side]).toBe(face);
					expect(DICE.map((d) => d.join())).toContain(labels.join());
					seen.add(labels.join());
				}
				expect(seen.size).toBe(4);
			}
		}
		expect(() => labelsFor(2, 7)).toThrow(RangeError);
	});

	it('finds the side on top', () => {
		expect(topSide({ x: 0, y: 0, z: 0, w: 1 })).toEqual({ side: 2, up: 1 });
		// A quarter turn about z: +x goes up.
		const s = Math.SQRT1_2;
		expect(topSide({ x: 0, y: 0, z: s, w: s }).side).toBe(0);
		// Half a turn about x: −y goes up.
		expect(topSide({ x: 1, y: 0, z: 0, w: 0 }).side).toBe(3);
	});
});

describe('simulate', () => {
	it('settles flat, in a few seconds, every time', () => {
		const random = seeded(1);
		const seconds: number[] = [];
		for (let i = 0; i < 60; i++) {
			const t = simulate({ random });
			const [, y, , qx, qy, qz, qw] = t.poses.subarray((t.steps - 1) * 7);
			expect(topSide({ x: qx, y: qy, z: qz, w: qw })).toMatchObject({ side: t.top });
			expect(topSide({ x: qx, y: qy, z: qz, w: qw }).up).toBeGreaterThan(0.99);
			expect(y).toBeCloseTo(0.5, 1);
			seconds.push(t.steps / 120);
		}
		seconds.sort((a, b) => a - b);
		// Long enough to be a roll, short enough not to drag.
		expect(seconds[0]).toBeGreaterThan(1);
		expect(seconds[seconds.length - 1]).toBeLessThan(7);
	});

	it('lands on every side, so the remap is doing real work', () => {
		const random = seeded(2);
		const tops = new Set(Array.from({ length: 120 }, () => simulate({ random }).top));
		expect(tops.size).toBe(6);
	});

	it('goes further when thrown harder', () => {
		const travel = (power: number) => {
			const random = seeded(4);
			let sum = 0;
			for (let i = 0; i < 20; i++) {
				const { poses, steps } = simulate({ random, power });
				const e = (steps - 1) * 7;
				sum += Math.hypot(poses[e] - poses[0], poses[e + 2] - poses[2]);
			}
			return sum / 20;
		};
		expect(travel(2)).toBeGreaterThan(travel(1) * 1.3);
	});
});

describe('place', () => {
	const t = simulate({ random: seeded(5) });

	it('ends the throw where asked, turned, with the same side on top', () => {
		const moved = place(t, 1.2, 3, -4);
		const e = (t.steps - 1) * 7;
		expect(moved.poses[e]).toBeCloseTo(3, 4);
		expect(moved.poses[e + 2]).toBeCloseTo(-4, 4);
		const [qx, qy, qz, qw] = moved.poses.subarray(e + 3, e + 7);
		expect(topSide({ x: qx, y: qy, z: qz, w: qw }).side).toBe(t.top);
		// Heights, and how far it went, don't change.
		const dist = (p: Float32Array) => Math.hypot(p[e] - p[0], p[e + 2] - p[2]);
		expect(dist(moved.poses)).toBeCloseTo(dist(t.poses), 3);
		for (let i = 1; i < t.poses.length; i += 7) expect(moved.poses[i]).toBe(t.poses[i]);
	});

	it('turns each pose with the path, as one rigid motion', () => {
		const angle = 2.1;
		const moved = place(t, angle, 0, 0);
		const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
		const corner = new THREE.Vector3(0.5, 0.5, 0.5);
		for (const step of [0, Math.floor(t.steps / 2), t.steps - 1]) {
			const i = step * 7;
			const q = (p: Float32Array) => new THREE.Quaternion(p[i + 3], p[i + 4], p[i + 5], p[i + 6]);
			const expected = corner.clone().applyQuaternion(q(t.poses)).applyQuaternion(turn);
			const actual = corner.clone().applyQuaternion(q(moved.poses));
			expect(actual.distanceTo(expected)).toBeLessThan(1e-5);
		}
	});
});

describe('timing', () => {
	const t = simulate({ random: seeded(6) });

	it('plays straight in real time', () => {
		const wall = timeline(t, false);
		expect(wall[t.steps - 1]).toBeCloseTo(((t.steps - 1) * 1000) / 120, 6);
		expect(stepAt(wall, 500)).toBeCloseTo(60, 6);
		expect(stepAt(wall, 1e9)).toBe(t.steps - 1);
	});

	it('slows round the last topple, and only there', () => {
		const straight = timeline(t, false);
		const slow = timeline(t, true);
		const topple = lastTopple(t);
		const stepMs = (wall: Float64Array, s: number) => wall[s + 1] - wall[s];
		expect(stepMs(slow, topple)).toBeCloseTo(stepMs(straight, topple) / 0.4, 6);
		expect(stepMs(slow, 1)).toBeCloseTo(stepMs(straight, 1), 6);
		expect(stepMs(slow, t.steps - 2)).toBeCloseTo(stepMs(straight, t.steps - 2), 6);
		// About half a second longer in all.
		const extra = slow[t.steps - 1] - straight[t.steps - 1];
		expect(extra).toBeGreaterThan(500);
		expect(extra).toBeLessThan(1200);
		// stepAt undoes the timeline.
		expect(stepAt(slow, slow[topple])).toBeCloseTo(topple, 6);
	});

	it('finds the last time the side on top changed', () => {
		const topple = lastTopple(t);
		const top = (s: number) => {
			const [x, y, z, w] = t.poses.subarray(s * 7 + 3, s * 7 + 7);
			return topSide({ x, y, z, w }).side;
		};
		expect(top(topple)).toBe(t.top);
		expect(top(topple - 1)).not.toBe(t.top);
		for (let s = topple; s < t.steps; s += 10) expect(top(s)).toBe(t.top);
	});
});

describe('contrast', () => {
	it('measures as WCAG does', () => {
		expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
		expect(contrast('#ffffff', '#ffffff')).toBe(1);
		expect(contrast('#777777', '#000000')).toBeCloseTo(contrast('#000000', '#777777'), 10);
		expect(() => contrast('red', '#fff')).toThrow(TypeError);
	});

	it('keeps the primaries readable against each other, except red and blue', () => {
		const [red, yellow, blue] = PRIMARIES;
		expect(contrast(yellow, blue)).toBeGreaterThanOrEqual(MIN_CONTRAST);
		expect(contrast(red, yellow)).toBeGreaterThanOrEqual(MIN_CONTRAST);
		expect(contrast(red, blue)).toBeLessThan(MIN_CONTRAST);
	});
});

describe('pickTwo', () => {
	it('picks only pairs that contrast enough, each of them sometimes', () => {
		const random = seeded(7);
		const pairs = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const [a, b] = pickTwo(PRIMARIES, random);
			expect(a).not.toBe(b);
			expect(contrast(a, b)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			pairs.add(`${a}/${b}`);
		}
		// Yellow with red or blue, either way round; never red with blue.
		expect(pairs.size).toBe(4);
		expect([...pairs].every((p) => p.includes(PRIMARIES[1]))).toBe(true);
	});

	it('falls back to the best pair when none contrast enough', () => {
		const random = seeded(8);
		const palette = ['#777777', '#7a7a7a', '#999999'];
		for (let i = 0; i < 20; i++) {
			expect(pickTwo(palette, random).sort()).toEqual(['#777777', '#999999']);
		}
		expect(() => pickTwo(['#000'])).toThrow(RangeError);
	});
});
