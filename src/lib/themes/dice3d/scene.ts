import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PIPS } from '../../pips.js';
import { labelsFor, type Side } from './faces.js';
import { place, simulate, type Throw } from './simulate.js';
import { stepAt, timeline } from './timing.js';

/**
 * The die in three.js: a rounded ivory die on the page, seen from above, with its shadow.
 *
 * At rest it's drawn in its stage (`host`). Thrown, its canvas lifts out over the whole window
 * (fixed, under nothing, passing clicks through) and the die comes in from beyond the window's
 * edge, across the page, to rest in the stage. The camera is the same either way: over the
 * window, its frustum is widened about the stage, so the stage's part of the picture is exactly
 * what the stage shows, and the canvas can drop back into the stage when the die is still.
 *
 * It only draws while it's moving; otherwise once per change.
 */
export interface DieScene {
	/** At rest in the middle of the stage, `face` up. */
	rest(face: number): void;
	/** Thrown, landing on `face`; `done` when it's still. `slowmo`: slower round the last topple. */
	roll(face: number, done: () => void, slowmo?: boolean): void;
	/** At rest on `face`: where the throw ended, if one was thrown for it, else in the middle. */
	land(face: number): void;
	/** A win's dance about the window, on and on: hops this way and that, or a walk; or still. */
	dance(style: Dance | false): void;
	/** New colours, in place. */
	paint(color: string, pipColor: string): void;
	dispose(): void;
}

/** hop: hops a random way each time, tipping nearly over as it lands. walk: a happy walk, small
 * hops one after another along a wandering, curving path, turning to face its way. */
export type Dance = 'hop' | 'walk';

export interface Look {
	color: string;
	pipColor: string;
	/**
	 * glossy: a rounded die with soft light and reflections (and colours tone-mapped). flat: a
	 * rounded die, unlit, every side its colour at full brightness, a hard shadow, and
	 * colours exactly as given.
	 */
	finish: 'glossy' | 'flat';
	/**
	 * Where a throw comes to rest. stage: near the middle of the stage, where it's drawn after.
	 * anywhere (experimental): anywhere in the window, and it stays drawn there over the page
	 * (scrolling with it) until the window's resized, when it goes back to the stage.
	 */
	landing?: 'stage' | 'anywhere';
}

const TEXTURE_PX = 256;
/** The resting die's turn about the vertical, so it reads as a cube, not a square. */
const REST_YAW = 0.55;
const UP_SIDE: Side = 2;
/** The stage's field of view (degrees), across its shorter side: the die fills about a third. */
const FOV = 15;
const TAN = Math.tan((FOV * Math.PI) / 360);
/** A throw comes to rest this far, at most, from the middle of the stage. */
const SPREAD = 0.3;
/** Throws tried (each harder than the last) and directions tried for each. */
const THROWS = 24;
const DIRECTIONS = 16;
/** Landing anywhere: how much of the window (across and down) it may come to rest in, the middle. */
const WINDOW_MIDDLE = 0.55;
/** Landing anywhere: spots tried (sharing the throws). */
const SPOTS = 4;
/** The corners of a box round the die, however it's turned (a little over √3 / 2 across). */
const BOUNDS = [-0.6, 0.6].flatMap((x) =>
	[-0.6, 0.6].flatMap((y) => [-0.6, 0.6].map((z) => new THREE.Vector3(x, y, z)))
);
/** The waiting die shrinks and fades away this long (ms) before the throw comes in. */
const VANISH_MS = 250;
/**
 * A win's dance: it hops about the window, never quite the same twice. Each hop goes a random
 * way and this far (die widths), takes this long (s, and this much more per die width) and goes
 * this high, turning up to a quarter turn either way, and tipping forward (this much, radians,
 * by the time it lands). It keeps to the window's middle (this much of it, across and down),
 * turning back from the edges.
 */
const HOP_FAR = [1, 3];
const HOP_S = 0.6;
const HOP_S_PER = 0.15;
const HOP_HEIGHT = [0.5, 1.1];
const HOP_TURN = Math.PI / 2;
const HOP_LEAN = 0.18;
const DANCE_MIDDLE = 0.8;
/**
 * Landing, its momentum tips it up onto its leading edge, nearly over (this far, radians: the
 * balance is π/4), where it hangs a moment; then it falls back onto the six and rocks back a
 * little (this much of the tip). How long each takes (s). Then a pause (up to this much more,
 * mostly short) before the next hop.
 */
const TIP = [0.55, 0.72];
const TIP_ROCK = 0.15;
const TIP_UP_S = 0.28;
const TIP_HANG_S = 0.14;
const TIP_FALL_S = 0.2;
const TIP_ROCK_S = 0.3;
const TIP_S = TIP_UP_S + TIP_HANG_S + TIP_FALL_S + TIP_ROCK_S;
const HOP_PAUSE_S = 1.8;

/**
 * The walk: small hops (this far, die widths, this long, s, and this high), each turning off the
 * last one's way by up to this much (radians) and tipping a little (radians) at this pace (of the
 * hop's tip's), with a short pause after.
 */
const WALK_FAR = [0.6, 1];
const WALK_S = 0.42;
const WALK_HEIGHT = [0.28, 0.42];
const WALK_WANDER = 0.55;
const WALK_TIP = [0.18, 0.3];
const WALK_PACE = 0.55;
const WALK_PAUSE_S = [0.05, 0.25];

/**
 * How far it's tipped (radians, forward), `down` s after landing at `lean`, tipping to `tip`,
 * at `pace` (1: the hop's).
 */
function tipped(down: number, lean: number, tip: number, pace = 1): number {
	down /= pace;
	if (down < TIP_UP_S) return lean + (tip - lean) * Math.sin(((down / TIP_UP_S) * Math.PI) / 2);
	down -= TIP_UP_S;
	// Slowing, at the top, as if it might go over.
	if (down < TIP_HANG_S) return tip * (1 - 0.04 * (down / TIP_HANG_S));
	down -= TIP_HANG_S;
	// Falling back, faster and faster.
	if (down < TIP_FALL_S) return tip * 0.96 * (1 - (down / TIP_FALL_S) ** 2);
	down -= TIP_FALL_S;
	if (down < TIP_ROCK_S) {
		const u = down / TIP_ROCK_S;
		return -TIP_ROCK * tip * Math.sin(Math.PI * u) * (1 - u);
	}
	return 0;
}
const UP = new THREE.Vector3(0, 1, 0);
/** Where the camera is, from the die at rest in the middle of the stage. */
const EYE = new THREE.Vector3(0, 9.6, 4);
/** Where the light is, from the die. */
const SUN = new THREE.Vector3(-3, 9, 4);
/** The window, as `position: fixed; inset: 0` covers it. */
const windowRect = () => ({
	left: 0,
	top: 0,
	right: document.documentElement.clientWidth,
	bottom: document.documentElement.clientHeight
});
type Rect = ReturnType<typeof windowRect>;

/** Draws one face on its canvas: its colour, and `face` pips. */
function drawFace(canvas: HTMLCanvasElement, face: number, color: string, pipColor: string) {
	const g = canvas.getContext('2d')!;
	g.fillStyle = color;
	g.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
	g.fillStyle = pipColor;
	const step = TEXTURE_PX * 0.26;
	for (const [x, y] of PIPS[face]) {
		g.beginPath();
		g.arc(
			TEXTURE_PX / 2 + (x - 1) * step,
			TEXTURE_PX / 2 + (y - 1) * step,
			TEXTURE_PX * 0.085,
			0,
			Math.PI * 2
		);
		g.fill();
	}
}

export function createScene(host: HTMLElement, look: Look): DieScene {
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	const flat = look.finish === 'flat';
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = flat ? THREE.BasicShadowMap : THREE.PCFShadowMap;
	renderer.toneMapping = flat ? THREE.NoToneMapping : THREE.NeutralToneMapping;

	const scene = new THREE.Scene();
	// Glossy: reflections of a room. Flat has none.
	const pmrem = flat ? null : new THREE.PMREMGenerator(renderer);
	const environment = pmrem?.fromScene(new RoomEnvironment(), 0.04).texture ?? null;
	scene.environment = environment;
	scene.environmentIntensity = 0.6;

	// From above and a little in front, so the die reads as a cube. It follows the die (see
	// follow), so the die's seen from the same angle wherever it is on the page.
	const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
	camera.position.copy(EYE);
	camera.lookAt(0, 0.5, 0);
	camera.updateMatrixWorld();

	// The light (and its shadow's little box) follows the die across the page.
	// (Flat is unlit: the light only casts its shadow.)
	const sun = new THREE.DirectionalLight(0xffffff, 1.6);
	sun.castShadow = true;
	sun.shadow.mapSize.set(1024, 1024);
	sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
	sun.shadow.camera.right = sun.shadow.camera.top = 2;
	// Its depth range only as deep as it needs (the light is SUN's length, ~10, from the die, which
	// flies no higher than ~4), so depth bias stays tiny: over three's default 0.5–500, even
	// -0.0005 pushed the shadow a quarter of the die's width away from where it touches the page.
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = 20;
	sun.shadow.radius = 6;
	sun.shadow.bias = -0.0002;
	sun.shadow.normalBias = 0.01;
	scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x888888, 0.5));

	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(400, 400),
		new THREE.ShadowMaterial({ opacity: flat ? 0.16 : 0.22 })
	);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	scene.add(floor);

	const anisotropy = renderer.capabilities.getMaxAnisotropy();
	const faces = [1, 2, 3, 4, 5, 6].map((n) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = TEXTURE_PX;
		drawFace(canvas, n, look.color, look.pipColor);
		return canvas;
	});
	const textures = faces.map((canvas) => {
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = anisotropy;
		return texture;
	});
	const materials = textures.map((map) =>
		flat
			? new THREE.MeshBasicMaterial({ map })
			: new THREE.MeshStandardMaterial({ map, roughness: 0.38, metalness: 0 })
	);
	const geometry = new RoundedBoxGeometry(1, 1, 1, 5, 0.12);
	const die = new THREE.Mesh(geometry, materials);
	die.castShadow = true;
	scene.add(die);

	/** Numbers the die's sides (BoxGeometry's material order). */
	const label = (labels: number[]) => (die.material = labels.map((n) => materials[n - 1]));

	/** Over the whole window (thrown), or in the stage. */
	let lifted = false;
	/** A throw on screen right now. */
	let playing = false;
	const anywhere = look.landing === 'anywhere';

	function stageStyle() {
		canvas.style.cssText = 'display:block;width:100%;height:100%';
		host.append(canvas);
	}
	function liftedStyle() {
		canvas.style.cssText =
			'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483646';
		document.body.append(canvas);
	}

	/**
	 * Points the camera so the stage shows the picture it always does, and `view` (the stage, or
	 * the window) is what's drawn, with the camera's axis through (cx, cy) on the page: the stage's
	 * middle unless given. False if the stage has no size (hidden).
	 */
	function aim(view: Rect, cx?: number, cy?: number) {
		const stage = host.getBoundingClientRect();
		if (!stage.width || !stage.height) return false;
		const n = camera.near;
		// Near-plane units per CSS pixel: the stage's shorter side spans the field of view.
		const k = (n * TAN) / (Math.min(stage.width, stage.height) / 2);
		cx ??= stage.left + stage.width / 2;
		cy ??= stage.top + stage.height / 2;
		camera.projectionMatrix.makePerspective(
			(view.left - cx) * k,
			(view.right - cx) * k,
			(cy - view.top) * k,
			(cy - view.bottom) * k,
			n,
			camera.far
		);
		camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
		return true;
	}

	/**
	 * Aims the camera at the die, wherever it is. Seen from over the stage, a die far across the
	 * page would be seen from the side and stretched (a wide lens's corner). So the camera moves
	 * with it, keeping the angle it has at the stage, and is aimed to put the spot under the die
	 * where the stage's camera would see it on the page.
	 */
	const spot = new THREE.Vector3();
	function follow(view: Rect) {
		camera.position.copy(EYE);
		camera.updateMatrixWorld();
		if (!aim(view)) return false;
		spot.set(die.position.x, 0.5, die.position.z).project(camera);
		const x = view.left + ((spot.x + 1) / 2) * (view.right - view.left);
		const y = view.top + ((1 - spot.y) / 2) * (view.bottom - view.top);
		camera.position.set(EYE.x + die.position.x, EYE.y, EYE.z + die.position.z);
		camera.updateMatrixWorld();
		return aim(view, x, y);
	}

	let size = '';
	function draw() {
		const view = lifted ? windowRect() : host.getBoundingClientRect();
		if (!follow(view)) return;
		const w = view.right - view.left;
		const h = view.bottom - view.top;
		if (size !== `${w}x${h}`) {
			size = `${w}x${h}`;
			renderer.setSize(w, h, false);
		}
		sun.target.position.set(die.position.x, 0, die.position.z);
		sun.position.copy(sun.target.position).add(SUN);
		renderer.render(scene, camera);
	}

	const observer = new ResizeObserver(() => lifted || draw());
	observer.observe(host);

	// Over the page at rest (landed anywhere, or dancing): it moves with the page as it scrolls
	// (any scroller: capture), and goes back to the stage if the window changes size.
	const scrolled = () => lifted && !playing && draw();
	const resized = () => lifted && !playing && thrown && rest(thrown.face);
	document.addEventListener('scroll', scrolled, { capture: true, passive: true });
	window.addEventListener('resize', resized);

	/**
	 * The die's box on screen at step `s` (normalised device coordinates, −1 to 1), as follow
	 * draws it: as if in the middle of the stage, then moved to its spot. (The camera must be at
	 * EYE, aimed at the window, with `middle` its view of the stage's middle.)
	 */
	const corner = new THREE.Vector3();
	const middle = new THREE.Vector3();
	function box(poses: Float32Array, s: number) {
		let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
		spot
			.set(poses[s * 7], 0.5, poses[s * 7 + 2])
			.project(camera)
			.sub(middle);
		for (const c of BOUNDS) {
			corner
				.set(c.x, poses[s * 7 + 1] + c.y, c.z)
				.project(camera)
				.add(spot);
			x0 = Math.min(x0, corner.x);
			x1 = Math.max(x1, corner.x);
			y0 = Math.min(y0, corner.y);
			y1 = Math.max(y1, corner.y);
		}
		return { x0, x1, y0, y1 };
	}
	const outside = (b: ReturnType<typeof box>) => b.x1 < -1 || b.x0 > 1 || b.y1 < -1 || b.y0 > 1;
	const inside = (b: ReturnType<typeof box>) => b.x0 >= -1 && b.x1 <= 1 && b.y0 >= -1 && b.y1 <= 1;

	/**
	 * Whether the window sees this throw come in from beyond its edge and, once in, stay in. (The
	 * camera must be aimed at the window.)
	 */
	function fromOffscreen({ poses, steps }: Throw) {
		if (!outside(box(poses, 0))) return false;
		let s = 1;
		while (s < steps && !inside(box(poses, s))) s++;
		if (s === steps) return false;
		for (; s < steps; s += 2) if (!inside(box(poses, s))) return false;
		return true;
	}

	/** A spot near the middle of the stage. */
	function nearMiddle() {
		const r = SPREAD * Math.sqrt(Math.random());
		const a = Math.random() * Math.PI * 2;
		return [r * Math.cos(a), r * Math.sin(a)];
	}

	/**
	 * A spot in the middle of the window, its central half or so (by the edges, it's easily
	 * missed). (The camera must be aimed at it.)
	 */
	const raycaster = new THREE.Raycaster();
	const table = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
	function inWindow() {
		const spot = new THREE.Vector2(
			(Math.random() * 2 - 1) * WINDOW_MIDDLE,
			(Math.random() * 2 - 1) * WINDOW_MIDDLE
		);
		raycaster.setFromCamera(spot, camera);
		const hit = raycaster.ray.intersectPlane(table, new THREE.Vector3());
		return hit ? [hit.x, hit.z] : nearMiddle();
	}

	/**
	 * A throw that ends near the middle of the stage (or anywhere in the window), coming in from
	 * off the window: each one tried in a few directions, then thrown harder (to come from
	 * further) until one fits.
	 */
	function choose(): Throw {
		camera.position.copy(EYE);
		camera.updateMatrixWorld();
		aim(windowRect());
		middle.set(0, 0.5, 0).project(camera);
		// Landing anywhere, a spot near the window's edge may not fit (in a phone's narrow window,
		// no throw can come in and stay in): another spot, then.
		const spots = anywhere ? SPOTS : 1;
		let last: Throw | null = null;
		for (let p = 0; p < spots; p++) {
			const [x, z] = anywhere ? inWindow() : nearMiddle();
			for (let i = 0; i < THROWS / spots; i++) {
				const t = simulate({ power: 1 + i * 0.15 });
				const first = Math.random() * Math.PI * 2;
				for (let d = 0; d < DIRECTIONS; d++) {
					last = place(t, first + (d * Math.PI * 2) / DIRECTIONS, x, z);
					if (fromOffscreen(last)) return last;
				}
			}
		}
		// Nothing fitted (a huge window?): the last one, which still ends where it should.
		return last!;
	}

	/** The throw on screen, the face it lands on, and the numbers that put that face on top. */
	let thrown: { t: Throw; face: number; labels: number[] } | null = null;

	/** Sets the die to the throw's pose at step `f` (fractional: between two kept poses). */
	const qa = new THREE.Quaternion();
	const qb = new THREE.Quaternion();
	function pose({ poses, steps }: Throw, f: number) {
		const i = Math.min(Math.floor(f), steps - 1);
		const j = Math.min(i + 1, steps - 1);
		const t = Math.min(f - i, 1);
		const a = i * 7;
		const b = j * 7;
		die.position.set(
			poses[a] + (poses[b] - poses[a]) * t,
			poses[a + 1] + (poses[b + 1] - poses[a + 1]) * t,
			poses[a + 2] + (poses[b + 2] - poses[a + 2]) * t
		);
		qa.set(poses[a + 3], poses[a + 4], poses[a + 5], poses[a + 6]);
		qb.set(poses[b + 3], poses[b + 4], poses[b + 5], poses[b + 6]);
		die.quaternion.slerpQuaternions(qa, qb, t);
	}

	/** Stops a throw playing, and puts the canvas back in the stage. */
	/** Stops whatever's playing: a throw, the vanishing before one, or a dance. */
	function halt() {
		renderer.setAnimationLoop(null);
		playing = false;
		dancing = false;
	}

	/** The die's opacity (it fades as it vanishes). */
	function fade(opacity: number) {
		for (const m of materials) {
			if (m.transparent !== opacity < 1) {
				m.transparent = opacity < 1;
				m.needsUpdate = true;
			}
			m.opacity = opacity;
		}
	}

	/** The dance to do whenever it's at rest, and whether it's doing it. */
	let wantDance: Dance | false = false;
	let dancing = false;
	/** Where it was when the dance began. */
	const still = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

	/** Whether a spot on the table is in the window's middle. (Moves the camera: draw after.) */
	function inMiddle(x: number, z: number) {
		camera.position.copy(EYE);
		camera.updateMatrixWorld();
		if (!aim(windowRect())) return false;
		spot.set(x, 0.5, z).project(camera);
		return Math.abs(spot.x) <= DANCE_MIDDLE && Math.abs(spot.y) <= DANCE_MIDDLE;
	}

	/** Where to hop to from (x, z): a random way, or towards the window's middle if none fits. */
	const centre = new THREE.Vector2();
	function hopFrom(x: number, z: number): [number, number] {
		const far = () => HOP_FAR[0] + Math.random() * (HOP_FAR[1] - HOP_FAR[0]);
		for (let i = 0; i < 12; i++) {
			const a = Math.random() * Math.PI * 2;
			const d = far();
			if (inMiddle(x + d * Math.cos(a), z + d * Math.sin(a))) {
				return [x + d * Math.cos(a), z + d * Math.sin(a)];
			}
		}
		raycaster.setFromCamera(centre, camera);
		const middle = raycaster.ray.intersectPlane(table, new THREE.Vector3());
		if (!middle) return [x, z];
		const [dx, dz] = [middle.x - x, middle.z - z];
		const k = Math.min(1, far() / (Math.hypot(dx, dz) || 1));
		return [x + dx * k, z + dz * k];
	}

	/**
	 * The walk's next step from (x, z), heading `way` (radians, on the table): a little off it,
	 * and turning towards the window's middle while the step would leave it. Its way, and where.
	 */
	function stepFrom(x: number, z: number, way: number): [number, number, number] {
		const d = between(WALK_FAR);
		let next = way + (Math.random() * 2 - 1) * WALK_WANDER;
		for (let i = 0; i < 10; i++) {
			if (inMiddle(x + d * Math.cos(next), z + d * Math.sin(next))) break;
			raycaster.setFromCamera(centre, camera);
			const middle = raycaster.ray.intersectPlane(table, new THREE.Vector3());
			if (!middle) break;
			// A turn towards the middle, the shorter way round.
			const off = Math.atan2(middle.z - z, middle.x - x) - next;
			next += Math.atan2(Math.sin(off), Math.cos(off)) * 0.5;
		}
		return [next, x + d * Math.cos(next), z + d * Math.sin(next)];
	}

	const from = new THREE.Vector3();
	const to = new THREE.Vector3();
	const turned = new THREE.Quaternion();
	const twist = new THREE.Quaternion();
	const tilt = new THREE.Quaternion();
	const across = new THREE.Vector3();
	const ahead = new THREE.Vector3();
	const between = (range: number[]) => range[0] + Math.random() * (range[1] - range[0]);
	function startDance() {
		const walk = wantDance === 'walk';
		still.position.copy(die.position);
		still.quaternion.copy(die.quaternion);
		dancing = true;
		// Over the whole window, to hop about it.
		if (!lifted) {
			lifted = true;
			liftedStyle();
		}
		const hop = { begin: 0, s: 0, height: 0, turn: 0, tip: 0, pace: 1, pause: 0 };
		/** The walk's way (radians, on the table), and the curve each step follows. */
		let way = Math.random() * Math.PI * 2;
		const bend = new THREE.Vector3();
		const plan = (wait = 0) => {
			from.set(die.position.x, 0.5, die.position.z);
			turned.copy(die.quaternion);
			if (walk) {
				const [next, x, z] = stepFrom(from.x, from.z, way);
				to.set(x, 0.5, z);
				// Leaving the way it was going, and curving round to the new one.
				const far = from.distanceTo(to);
				bend
					.set(Math.cos(way), 0, Math.sin(way))
					.multiplyScalar(far / 2)
					.add(from);
				// Turning as its way does (a turn about up takes x towards -z).
				const off = next - way;
				hop.turn = -Math.atan2(Math.sin(off), Math.cos(off));
				way = next;
				hop.s = WALK_S;
				hop.height = between(WALK_HEIGHT);
				hop.tip = between(WALK_TIP);
				hop.pace = WALK_PACE;
				hop.pause = TIP_S * WALK_PACE + between(WALK_PAUSE_S);
			} else {
				const [x, z] = hopFrom(from.x, from.z);
				to.set(x, 0.5, z);
				bend.lerpVectors(from, to, 0.5);
				hop.s = HOP_S + HOP_S_PER * from.distanceTo(to);
				hop.height = between(HOP_HEIGHT);
				hop.turn = (Math.random() * 2 - 1) * HOP_TURN;
				hop.tip = between(TIP);
				hop.pace = 1;
				// After the tip settles: mostly short, now and then long.
				hop.pause = TIP_S + 0.1 + Math.random() ** 2 * HOP_PAUSE_S;
			}
			// Its way, and the level line across it that it tips about.
			ahead.subVectors(to, from);
			if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, 1);
			ahead.normalize();
			across.crossVectors(UP, ahead);
			hop.begin = performance.now() + wait;
		};
		plan(400);
		renderer.setAnimationLoop(() => {
			const t = (performance.now() - hop.begin) / 1000;
			const f = Math.min(1, Math.max(0, t / hop.s));
			const down = Math.max(0, t - hop.s);
			// Tipping forward as it goes, then over onto its edge as it lands, and back.
			const lean = f < 1 ? HOP_LEAN * f : tipped(down, HOP_LEAN, hop.tip, hop.pace);
			// Along the curve from `from` past `bend` to `to` (straight, for a hop).
			die.position
				.copy(from)
				.multiplyScalar((1 - f) ** 2)
				.addScaledVector(bend, 2 * (1 - f) * f)
				.addScaledVector(to, f * f);
			// Tipped, it turns about its bottom edge (the leading one, or rocking back, the
			// trailing one), so its middle rises and moves that way.
			const a = Math.abs(lean);
			die.position.addScaledVector(ahead, Math.sign(lean) * 0.5 * (1 - Math.cos(a) + Math.sin(a)));
			die.position.y = hop.height * 4 * f * (1 - f) + 0.5 * (Math.cos(a) + Math.sin(a));
			twist.setFromAxisAngle(UP, hop.turn * f * f * (3 - 2 * f));
			tilt.setFromAxisAngle(across, lean);
			die.quaternion.copy(turned).premultiply(twist).premultiply(tilt);
			draw();
			if (t >= hop.s + hop.pause) plan();
		});
	}

	function stop() {
		halt();
		if (lifted) {
			lifted = false;
			stageStyle();
		}
	}

	function rest(face: number) {
		stop();
		thrown = null;
		label(labelsFor(UP_SIDE, face, () => 0));
		die.position.set(0, 0.5, 0);
		die.quaternion.setFromAxisAngle(UP, REST_YAW);
		draw();
		if (wantDance) startDance();
	}

	stageStyle();
	return {
		rest,
		roll(face, done, slowmo = false) {
			wantDance = false;
			const waiting = !lifted && !thrown;
			stop();
			const t = choose();
			const labels = labelsFor(t.top, face);
			thrown = { t, face, labels };
			const wall = timeline(t, slowmo);
			const go = () => {
				label(labels);
				lifted = true;
				playing = true;
				liftedStyle();
				const begin = performance.now();
				renderer.setAnimationLoop(() => {
					const f = stepAt(wall, performance.now() - begin);
					pose(t, f);
					if (f < t.steps - 1) return draw();
					// Landed anywhere, it stays over the page where it landed.
					if (anywhere) halt();
					else stop();
					draw();
					done();
				});
			};
			if (!waiting) return go();
			// The die waiting in the stage goes first: it shrinks and fades away.
			playing = true;
			const begin = performance.now();
			renderer.setAnimationLoop(() => {
				const k = (performance.now() - begin) / VANISH_MS;
				if (k >= 1) {
					die.scale.setScalar(1);
					fade(1);
					return go();
				}
				die.scale.setScalar(1 - k * k);
				fade(1 - k);
				draw();
			});
		},
		land(face) {
			if (thrown?.face !== face) return rest(face);
			if (anywhere) {
				// Where it landed, if it's still over the page; after a resize, the stage.
				if (!lifted) return rest(face);
				halt();
			} else stop();
			label(thrown.labels);
			pose(thrown.t, thrown.t.steps - 1);
			draw();
			if (wantDance) startDance();
		},
		dance(style) {
			if (style === wantDance) return;
			wantDance = style;
			if (dancing) {
				halt();
				die.position.copy(still.position);
				die.quaternion.copy(still.quaternion);
				if (lifted && !anywhere) {
					lifted = false;
					stageStyle();
				}
				draw();
			}
			if (style && !playing) startDance();
		},
		paint(color, pipColor) {
			faces.forEach((canvas, i) => drawFace(canvas, i + 1, color, pipColor));
			textures.forEach((t) => (t.needsUpdate = true));
			// While it's thrown, the next frame draws it.
			if (!lifted) draw();
		},
		dispose() {
			renderer.setAnimationLoop(null);
			observer.disconnect();
			document.removeEventListener('scroll', scrolled, { capture: true });
			window.removeEventListener('resize', resized);
			canvas.remove();
			geometry.dispose();
			floor.geometry.dispose();
			(floor.material as THREE.Material).dispose();
			materials.forEach((m) => m.dispose());
			textures.forEach((t) => t.dispose());
			environment?.dispose();
			pmrem?.dispose();
			renderer.dispose();
		}
	};
}
