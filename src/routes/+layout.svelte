<script lang="ts">
	let { children } = $props();
</script>

<main>
	{@render children()}
</main>

<style>
	:global(:root) {
		color-scheme: light dark;
		--ink: #1f1b16;
		--paper: #f3eee4;
		--quiet: #6b6358;
		--accent: #b4372b;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--ink: #efe9df;
			--paper: #1b1915;
			--quiet: #a39a8d;
			--accent: #e2685b;
		}
	}
	:global(body) {
		margin: 0;
		background: var(--paper);
		color: var(--ink);
		font:
			17px/1.5 ui-serif,
			Georgia,
			serif;
	}
	:global(a) {
		color: inherit;
	}
	:global(button) {
		font: inherit;
		color: var(--paper);
		background: var(--ink);
		border: 0;
		border-radius: 999px;
		padding: 0.7em 1.6em;
		cursor: pointer;
	}
	:global(button[aria-disabled='true']) {
		opacity: 0.6;
	}
	:global(code) {
		font-size: 0.85em;
	}
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 3rem 1rem;
	}
</style>
