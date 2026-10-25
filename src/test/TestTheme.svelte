<!-- A theme for tests: records each set of props it's given, and lets the test land it. -->
<script lang="ts" module>
	import type { ThemeProps } from '../lib/types.js';
	export const seen: (Omit<ThemeProps, 'onlanded'> & { extra: Record<string, unknown> })[] = [];
	export const theme = { land: () => {} };
</script>

<script lang="ts">
	let { phase, face, sides, onlanded, win, ...extra }: ThemeProps = $props();
	$effect(() => {
		seen.push({ phase, face, sides, win, extra: { ...extra } });
		theme.land = onlanded;
	});
</script>

<span data-testid="theme">{phase}:{face}</span>
