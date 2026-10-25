<!--
	@component
	The default theme: a flat die, drawn in SVG. It flicks through a few faces when thrown, then
	lands. No
	dependencies, so <Matka> works without three.js. It takes its colours from the page
	(currentColor) unless --matka-die and --matka-pip are set.
-->
<script lang="ts">
	import { PIPS } from './pips.js';
	import type { ThemeProps } from './types.js';

	let { phase, face, sides, onlanded }: ThemeProps = $props();

	const ROLL_MS = 1100;
	const FLICK_MS = 90;

	// Its top face, before it's thrown.
	let shown = $state(6);

	$effect(() => {
		if (phase === 'waiting') shown = Math.min(6, sides);
		if (phase === 'landed' && face) shown = face;
		if (phase !== 'rolling' || !face) return;
		const target = face;
		const flick = setInterval(() => {
			let next = shown;
			while (next === shown) next = 1 + Math.floor(Math.random() * sides);
			shown = next;
		}, FLICK_MS);
		const done = setTimeout(() => {
			clearInterval(flick);
			shown = target;
			onlanded();
		}, ROLL_MS);
		return () => {
			clearInterval(flick);
			clearTimeout(done);
		};
	});
</script>

<svg class="flat-die" class:rolling={phase === 'rolling'} viewBox="0 0 100 100" role="presentation">
	<rect x="8" y="8" width="84" height="84" rx="16" class="body" />
	{#if sides === 6}
		{#each PIPS[shown] as [x, y], i (i)}
			<circle cx={28 + x * 22} cy={28 + y * 22} r="8" class="pip" />
		{/each}
	{:else}
		<text x="50" y="52" class="pip number">{shown}</text>
	{/if}
</svg>

<style>
	.flat-die {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.body {
		fill: var(--matka-die, transparent);
		stroke: var(--matka-pip, currentColor);
		stroke-width: 4;
	}
	.pip {
		fill: var(--matka-pip, currentColor);
	}
	.number {
		font:
			600 40px/1 system-ui,
			sans-serif;
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.rolling {
		animation: tumble 1100ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}
	@keyframes tumble {
		0% {
			transform: translate(-30%, -40%) rotate(-200deg) scale(0.7);
		}
		35% {
			transform: translate(5%, 0) rotate(-40deg) scale(1);
		}
		55% {
			transform: translate(-3%, -8%) rotate(15deg);
		}
		75% {
			transform: translate(2%, 0) rotate(-6deg);
		}
		100% {
			transform: none;
		}
	}
</style>
