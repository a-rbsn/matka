<script lang="ts">
	import { page } from '$app/state';
	import { FlatDie, Matka } from '../../lib/index.js';
	import { Dice3D, PrimaryDice } from '../../lib/themes/dice3d/index.js';

	const themes = { '3d': Dice3D, primary: PrimaryDice, flat: FlatDie };
	type Name = keyof typeof themes;
	const names: Record<Name, string> = {
		'3d': 'The 3D die',
		primary: 'Primary colours',
		flat: 'The flat die'
	};

	const sessionId = $derived(page.url.searchParams.get('session_id') ?? '');
	const name = $derived((page.url.searchParams.get('theme') ?? '3d') as Name);
	const theme = $derived(themes[name] ?? Dice3D);
</script>

<svelte:head><title>Thanks · Matka demo</title></svelte:head>

<h1>Thanks for your order</h1>

{#if sessionId}
	<Matka {sessionId} {theme} />
{:else}
	<p>No order here. <a href="/">Buy one</a>.</p>
{/if}

<p class="quiet">
	Refresh: the roll stays the same.
	{#each Object.keys(themes) as Name[] as other (other)}
		{#if other !== name}
			<a href="?session_id={sessionId}&theme={other}">{names[other]}</a> ·
		{/if}
	{/each}
	<a href="/">Buy another</a>
</p>

<style>
	h1 {
		text-align: center;
	}
	.quiet {
		margin-top: 3rem;
		text-align: center;
		color: var(--quiet);
		font-size: 0.9em;
	}
</style>
