/**
 * Red, yellow, blue. The red is as bright as it can be and still read against the yellow (3:1);
 * red and blue are too close in lightness to read against each other, so they're never paired.
 */
export const PRIMARIES = ['#f2140e', '#ffd500', '#1e5bff'];

/** WCAG's contrast for graphics: pips should stand out from the die at least this much. */
export const MIN_CONTRAST = 3;

/** Relative luminance (WCAG) of a hex colour, #rgb or #rrggbb. */
function luminance(hex: string): number {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
	if (!m) throw new TypeError(`a hex colour (#rgb or #rrggbb), not ${hex}`);
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Two different colours from the palette, [die, pips], chosen by `random` (0 ≤ r < 1) from the
 * pairs that contrast enough. If none do, the pair that contrasts most.
 */
export function pickTwo(palette: string[], random: () => number = Math.random): [string, string] {
	if (palette.length < 2) throw new RangeError('a palette of two colours or more');
	const pairs: [string, string][] = [];
	let best: [string, string] = [palette[0], palette[1]];
	for (const a of palette) {
		for (const b of palette) {
			if (a === b) continue;
			if (contrast(a, b) >= MIN_CONTRAST) pairs.push([a, b]);
			if (contrast(a, b) > contrast(...best)) best = [a, b];
		}
	}
	if (!pairs.length) return random() < 0.5 ? best : [best[1], best[0]];
	return pairs[Math.floor(random() * pairs.length)];
}
