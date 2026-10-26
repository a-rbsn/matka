import { isUnrefunded, refundIsStale, type MatkaStore, type Roll } from './store.js';

/**
 * Rolls kept in memory: for tests and local demos. Gone when the process ends, and not shared
 * between serverless instances, so never for real orders.
 */
export function memoryStore(): MatkaStore & { rolls: Map<string, Roll> } {
	const rolls = new Map<string, Roll>();
	const none = new Set<string>();
	const copy = (roll: Roll): Roll => ({ ...roll });
	return {
		rolls,
		async create(roll) {
			if (!rolls.has(roll.sessionId)) rolls.set(roll.sessionId, copy(roll));
			return copy(rolls.get(roll.sessionId)!);
		},
		async get(sessionId) {
			const roll = rolls.get(sessionId);
			return roll ? copy(roll) : null;
		},
		async markRevealed(sessionId, at) {
			const roll = rolls.get(sessionId);
			if (!roll) return null;
			const first = !roll.revealedAt;
			if (first) roll.revealedAt = at;
			return { roll: copy(roll), first };
		},
		async claimRefund(sessionId, at, staleBefore) {
			const roll = rolls.get(sessionId);
			if (!roll || !refundIsStale(roll, staleBefore)) return false;
			roll.refundTriedAt = at;
			return true;
		},
		async recordRefund(sessionId, refundId) {
			const roll = rolls.get(sessionId);
			if (!roll) throw new Error(`no roll for ${sessionId}`);
			roll.refundId ??= refundId;
			return copy(roll);
		},
		async listUnrevealed({ before } = {}) {
			return [...rolls.values()]
				.filter((r) => !r.revealedAt && (!before || r.createdAt < before))
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
				.map(copy);
		},
		async listUnrefunded() {
			return [...rolls.values()]
				.filter(isUnrefunded)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
				.map(copy);
		},
		async markNone(sessionId) {
			none.add(sessionId);
		},
		async isNone(sessionId) {
			return none.has(sessionId);
		}
	};
}
