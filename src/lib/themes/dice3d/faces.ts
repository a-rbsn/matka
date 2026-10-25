/**
 * Which number goes on which side of the die. The sides are numbered in three.js BoxGeometry's
 * material order: 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z.
 *
 * The physics decides which side ends up on top; then the numbers are put on the die so that side
 * shows the server's face. Only real dice are allowed: one of the 24 ways a standard die can be
 * turned, so opposite faces still add up to 7 and 1, 2, 3 still run anticlockwise round a corner.
 */

export type Side = 0 | 1 | 2 | 3 | 4 | 5;

/** Each side's unit normal, in the die's own frame. */
export const NORMALS: readonly (readonly [number, number, number])[] = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1]
];

/** A standard die: 1 on +x, 2 on +y, 3 on +z (anticlockwise seen from that corner), 7 − n opposite. */
const STANDARD = [1, 6, 2, 5, 3, 4];

type Matrix = number[][];

/** The 24 rotations of a cube: the signed permutation matrices with determinant +1. */
const ROTATIONS: Matrix[] = (() => {
	const out: Matrix[] = [];
	const perms = [
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0]
	];
	for (const p of perms) {
		for (let signs = 0; signs < 8; signs++) {
			const m = [0, 1, 2].map((row) =>
				[0, 1, 2].map((col) => (col === p[row] ? ((signs >> row) & 1 ? -1 : 1) : 0))
			);
			const det =
				m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
				m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
				m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
			if (det === 1) out.push(m);
		}
	}
	return out;
})();

const sideOf = (v: number[]): Side =>
	NORMALS.findIndex((n) => n[0] === v[0] && n[1] === v[1] && n[2] === v[2]) as Side;

/** The standard die turned by `m`: the number on each side. */
function turned(m: Matrix): number[] {
	const labels = new Array<number>(6);
	NORMALS.forEach((n, side) => {
		const to = [0, 1, 2].map((row) => m[row][0] * n[0] + m[row][1] * n[1] + m[row][2] * n[2]);
		labels[sideOf(to)] = STANDARD[side];
	});
	return labels;
}

/** Every real die: the number on each side (by Side), 24 of them. */
export const DICE: readonly (readonly number[])[] = ROTATIONS.map(turned);

/**
 * A real die with `face` on `side`: one of the four that do, chosen by `random` (0 ≤ r < 1), so
 * the numbers round the sides differ from roll to roll.
 */
export function labelsFor(side: Side, face: number, random: () => number = Math.random): number[] {
	if (!Number.isInteger(face) || face < 1 || face > 6) throw new RangeError(`no ${face} on a d6`);
	const fits = DICE.filter((d) => d[side] === face);
	return [...fits[Math.floor(random() * fits.length)]];
}

/** The side whose normal, turned by the quaternion (x, y, z, w), points most nearly up (+y). */
export function topSide(q: { x: number; y: number; z: number; w: number }): {
	side: Side;
	/** How nearly straight up: 1 is flat on the table. */
	up: number;
} {
	let side: Side = 0;
	let up = -Infinity;
	NORMALS.forEach(([x, y, z], i) => {
		// The y component of q · n · q⁻¹.
		const ty =
			2 * (q.x * q.y + q.w * q.z) * x +
			(1 - 2 * (q.x * q.x + q.z * q.z)) * y +
			2 * (q.y * q.z - q.w * q.x) * z;
		if (ty > up) {
			up = ty;
			side = i as Side;
		}
	});
	return { side, up };
}
