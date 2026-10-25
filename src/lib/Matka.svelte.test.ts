import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestTheme, { seen, theme } from '../test/TestTheme.svelte';
import type { MatkaStatus } from './types.js';

const motion = vi.hoisted(() => {
	const motion = { reduce: false };
	Object.defineProperty(window, 'matchMedia', {
		value: (query: string) => ({
			get matches() {
				return query.includes('reduce') && motion.reduce;
			},
			media: query,
			addEventListener() {},
			removeEventListener() {}
		})
	});
	return motion;
});

const { default: Matka } = await import('./Matka.svelte');

const SESSION = 'cs_test_abc';
const rolled = (face: number, firstReveal = true): MatkaStatus => ({
	status: 'rolled',
	face,
	sides: 6,
	winningFace: 6,
	win: face === 6,
	firstReveal,
	refund: face === 6 ? 'issued' : 'none'
});
const ready: MatkaStatus = { status: 'ready', sides: 6, winningFace: 6 };

/** The endpoint: answers GETs and POSTs from these lists in turn (the last one repeating). */
function serve(gets: MatkaStatus[], posts: MatkaStatus[] = []) {
	const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
		expect(url.searchParams.get('session_id')).toBe(SESSION);
		const list = init?.method === 'POST' ? posts : gets;
		const body = list.length > 1 ? list.shift()! : list[0];
		return Response.json(body);
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

const phases = () => seen.map((s) => s.phase);
/** Without the pause: the verdict comes as soon as it lands. */
const plain = { pause: false };

beforeEach(() => {
	seen.length = 0;
	motion.reduce = false;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('<Matka>', () => {
	it('rolls, lets the theme land, then announces the result and focuses it', async () => {
		const fetch = serve([ready], [rolled(4)]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		const button = await screen.findByRole('button', { name: 'Roll the die' });
		expect(screen.getByText("Roll a six and your order's on us.")).toBeTruthy();
		await userEvent.click(button);
		await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('rolling:4'));
		expect(screen.getByRole('status').textContent).toContain('Rolling');
		// The button stays while it rolls, disabled, so nothing moves under the die.
		const rolling = screen.getByRole('button', { name: 'Rolling…' });
		expect(rolling.getAttribute('aria-disabled')).toBe('true');
		expect(rolling.closest('.matka')?.getAttribute('data-step')).toBe('rolling');
		await userEvent.click(rolling);
		expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
		expect(fetch).toHaveBeenLastCalledWith(
			expect.any(URL),
			expect.objectContaining({ method: 'POST' })
		);
		theme.land();
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain('You rolled a four')
		);
		expect(document.activeElement).toBe(screen.getByRole('status'));
		expect(screen.queryByRole('button')).toBe(null);
		expect(phases()).toEqual(['waiting', 'rolling', 'landed']);
	});

	it("says a win's on us", async () => {
		serve([ready], [rolled(6)]);
		const onresult = vi.fn();
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme, onresult });
		await userEvent.click(await screen.findByRole('button'));
		await waitFor(() => expect(phases()).toContain('rolling'));
		theme.land();
		await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/six!.*on us/));
		expect(onresult).toHaveBeenCalledWith(expect.objectContaining({ face: 6, win: true }));
	});

	it('skips the animation with reduced motion, whatever the theme', async () => {
		motion.reduce = true;
		serve([ready], [rolled(2)]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		await userEvent.click(await screen.findByRole('button'));
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('a two'));
		expect(phases()).not.toContain('rolling');
		expect(screen.getByTestId('theme').textContent).toBe('landed:2');
	});

	it('shows a roll already revealed at rest, without a button or moving focus', async () => {
		serve([rolled(3, false)]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('a three'));
		expect(phases()).toEqual(['waiting', 'landed']);
		expect(screen.queryByRole('button')).toBe(null);
		expect(document.activeElement).toBe(document.body);
	});

	it('waits for the webhook, then offers the roll', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		serve([{ status: 'pending' }, { status: 'pending' }, ready]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain('Getting your die')
		);
		await vi.advanceTimersByTimeAsync(4100);
		expect(await screen.findByRole('button', { name: 'Roll the die' })).toBeTruthy();
	});

	it('shows nothing when no roll is coming (a £0 order)', async () => {
		const fetch = serve([{ status: 'none' }]);
		const { container } = render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		await waitFor(() => expect(container.querySelector('.matka')).toBe(null));
	});

	it('shows nothing, and asks nothing, without a session', async () => {
		const fetch = serve([ready]);
		const { container } = render(Matka, { ...plain, sessionId: null, theme: TestTheme });
		await Promise.resolve();
		expect(container.querySelector('.matka')).toBe(null);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('gives up waiting after half a minute, and lets them check again', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const fetch = serve([{ status: 'pending' }]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		await vi.advanceTimersByTimeAsync(31_000);
		const again = await screen.findByRole('button', { name: 'Check again' });
		const asked = fetch.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetch.mock.calls.length).toBe(asked);
		serve([ready]);
		await userEvent.click(again);
		expect(await screen.findByRole('button', { name: 'Roll the die' })).toBeTruthy();
	});

	it('lands anyway if the theme never calls onlanded', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		serve([ready], [rolled(5)]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		await userEvent.click(await screen.findByRole('button'));
		await waitFor(() => expect(phases()).toContain('rolling'));
		await vi.advanceTimersByTimeAsync(10_100);
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('a five'));
	});

	it('offers to try again when the endpoint fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 500 }))
		);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme });
		const again = await screen.findByRole('button', { name: 'Try again' });
		expect(screen.getByRole('status').textContent).toContain('Something went wrong');
		serve([rolled(1, false)]);
		await userEvent.click(again);
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('a one'));
	});

	it('takes its words from copy', async () => {
		serve([ready]);
		render(Matka, {
			...plain,
			sessionId: SESSION,
			theme: TestTheme,
			copy: { button: 'Throw it', intro: () => 'Go on.' }
		});
		expect(await screen.findByRole('button', { name: 'Throw it' })).toBeTruthy();
		expect(screen.getByText('Go on.')).toBeTruthy();
	});

	it('draws a flat die when no theme is given', async () => {
		serve([rolled(6, false)]);
		const { container } = render(Matka, { ...plain, sessionId: SESSION });
		await waitFor(() => expect(container.querySelectorAll('circle.pip')).toHaveLength(6));
		expect(container.querySelector('.matka-stage')?.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('<Matka> showLoss', () => {
	it('hides a loss from view, but still says it to screen readers', async () => {
		serve([rolled(3, false)]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme, showLoss: false });
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('a three'));
		expect(screen.getByText(/a three/).classList).toContain('matka-hidden');
	});

	it('always shows a win', async () => {
		serve([rolled(6, false)]);
		render(Matka, { ...plain, sessionId: SESSION, theme: TestTheme, showLoss: false });
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('six!'));
		expect(screen.getByRole('status').querySelector('.matka-hidden')).toBe(null);
	});
});

describe('<Matka> pause', () => {
	const status = () => screen.getByRole('status').textContent ?? '';

	it('holds a beat after landing before the verdict', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		serve([ready], [rolled(6)]);
		render(Matka, { sessionId: SESSION, theme: TestTheme });
		await userEvent.click(await screen.findByRole('button'));
		await waitFor(() => expect(phases()).toContain('rolling'));
		theme.land();
		await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('landed:6'));
		expect(status()).toBe('');
		await vi.advanceTimersByTimeAsync(400);
		expect(status()).toBe('');
		expect(seen.at(-1)?.win).toBe(null);
		await vi.advanceTimersByTimeAsync(350);
		await waitFor(() => expect(status()).toContain('six!'));
		// The theme hears it's a win with the verdict, not before.
		expect(seen.at(-1)?.win).toBe(true);
		expect(seen.filter((s) => s.phase !== 'landed').every((s) => s.win === null)).toBe(true);
	});

	it("doesn't pause on a revisit", async () => {
		serve([rolled(6, false)]);
		render(Matka, { sessionId: SESSION, theme: TestTheme });
		await waitFor(() => expect(status()).toContain('six!'));
	});

	it('tells the theme a loss is a loss, once said', async () => {
		serve([rolled(2, false)]);
		render(Matka, { sessionId: SESSION, theme: TestTheme });
		await waitFor(() => expect(seen.at(-1)?.win).toBe(false));
	});

	it('passes themeProps to the theme', async () => {
		serve([ready]);
		render(Matka, { sessionId: SESSION, theme: TestTheme, themeProps: { colour: 'red' } });
		await screen.findByRole('button');
		expect(seen.at(-1)).toMatchObject({ extra: { colour: 'red' } });
	});
});
