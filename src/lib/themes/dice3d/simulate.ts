import * as CANNON from 'cannon-es';
import { topSide, type Side } from './faces.js';

/**
 * A throw, worked out before any of it is shown: the die is thrown along an open table (the
 * floor, y = 0, with no walls) and stepped until it's at rest, every pose kept. The renderer
 * plays the poses back; the side that ended on top is then given the server's number (faces.ts).
 *
 * With no walls, a throw can be moved and turned about the vertical without changing its
 * physics: place() moves one so it comes to rest wherever the page wants it.
 */

export const STEP_HZ = 120;
const MAX_SECONDS = 7;
/** Only throws that end this flat (cos of the tilt). */
const FLAT = 0.995;
const TRIES = 30;
/** Heavier than Earth's: a 1-unit die under 9.8 looks like a slow, big box. */
const GRAVITY = 20;

export interface Throw {
	/** x, y, z, qx, qy, qz, qw per step, at STEP_HZ. */
	poses: Float32Array;
	steps: number;
	/** The side on top at the end. */
	top: Side;
}

export interface ThrowOptions {
	random?: () => number;
	/** Scales how hard it's thrown (and so how far it goes). Default 1. */
	power?: number;
}

/** A throw that settles flat, thrown from about the origin towards +x. */
export function simulate({ random = Math.random, power = 1 }: ThrowOptions = {}): Throw {
	for (let i = 0; i < TRIES; i++) {
		const t = once(random, power);
		if (t) return t;
	}
	throw new Error('[matka] no throw settled flat');
}

function once(random: () => number, power: number): Throw | null {
	const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0), allowSleep: true });
	const surface = new CANNON.Material('surface');
	const dieMaterial = new CANNON.Material('die');
	world.addContactMaterial(
		new CANNON.ContactMaterial(surface, dieMaterial, { friction: 0.3, restitution: 0.45 })
	);
	const floor = new CANNON.Body({ mass: 0, material: surface, shape: new CANNON.Plane() });
	floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
	world.addBody(floor);

	const die = new CANNON.Body({
		mass: 1,
		material: dieMaterial,
		shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
		allowSleep: true,
		sleepSpeedLimit: 0.15,
		sleepTimeLimit: 0.25,
		linearDamping: 0.05,
		angularDamping: 0.08
	});
	const between = (a: number, b: number) => a + random() * (b - a);
	die.position.set(0, between(2.2, 3.2), 0);
	die.quaternion.setFromEuler(between(0, 6.3), between(0, 6.3), between(0, 6.3));
	die.velocity.set(between(8, 11) * power, between(-1, 2), between(-1.5, 1.5));
	die.angularVelocity.set(between(-18, 18), between(-18, 18), between(-18, 18));
	world.addBody(die);

	const max = MAX_SECONDS * STEP_HZ;
	const poses = new Float32Array((max + 1) * 7);
	let steps = 0;
	const keep = () => {
		const p = die.position;
		const q = die.quaternion;
		poses.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], steps * 7);
		steps++;
	};
	keep();
	while (steps <= max && die.sleepState !== CANNON.Body.SLEEPING) {
		world.step(1 / STEP_HZ);
		keep();
	}
	if (die.sleepState !== CANNON.Body.SLEEPING) return null;
	const { side, up } = topSide(die.quaternion);
	if (up < FLAT || die.position.y > 0.6) return null;
	return { poses: poses.slice(0, steps * 7), steps, top: side };
}

/**
 * The throw turned by `angle` (radians) about the vertical and moved so it comes to rest at
 * (x, z). The same throw, physically: the side on top doesn't change.
 */
export function place(t: Throw, angle: number, x: number, z: number): Throw {
	const { poses, steps } = t;
	const end = (steps - 1) * 7;
	const [ex, ez] = [poses[end], poses[end + 2]];
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	// The turn as a quaternion (0, sin ½a, 0, cos ½a), applied before each pose's own.
	const s = Math.sin(angle / 2);
	const c = Math.cos(angle / 2);
	const out = new Float32Array(poses.length);
	for (let i = 0; i < poses.length; i += 7) {
		const dx = poses[i] - ex;
		const dz = poses[i + 2] - ez;
		const [qx, qy, qz, qw] = [poses[i + 3], poses[i + 4], poses[i + 5], poses[i + 6]];
		out[i] = cos * dx + sin * dz + x;
		out[i + 1] = poses[i + 1];
		out[i + 2] = -sin * dx + cos * dz + z;
		out[i + 3] = c * qx + s * qz;
		out[i + 4] = c * qy + s * qw;
		out[i + 5] = c * qz - s * qx;
		out[i + 6] = c * qw - s * qy;
	}
	return { poses: out, steps, top: t.top };
}
