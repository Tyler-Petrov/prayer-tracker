// The quick Bible reading actions (read or not, delete a plan) for the Days tab and a plan's page: optimistic
// across every loaded query (optimistic.ts), with errors shown as toasts.
// Call `readingActions()` while a component initializes (it uses the Convex client from context).
import { toast } from 'svelte-sonner';
import { useMutation } from 'convex-svelte';
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';
import { passageLabel } from '#convex/shared/bible.js';
import { toastError } from '#lib/errors.js';
import { optimisticPlanRemoved, optimisticRead } from '#lib/optimistic.js';

type Reading = {
	readingId: Id<'readings'>;
	planId: Id<'readingPlans'>;
	book: string;
	from: number;
	to: number;
};

export function readingActions() {
	const setRead = useMutation(api.reading.setRead);
	const removePlan = useMutation(api.reading.remove);

	return {
		/** Read (or not). `withToast` says so once saved (the menus say what they did). */
		read(reading: Reading, read: boolean, withToast = false) {
			return setRead(
				{ readingId: reading.readingId, read },
				{ optimisticUpdate: optimisticRead(reading, read) }
			).then(() => {
				if (withToast)
					toast(
						read
							? `Read ${passageLabel(reading.book, reading)}`
							: `${passageLabel(reading.book, reading)} isn't marked read`
					);
			}, toastError);
		},

		/** Deletes a plan and its readings. Resolves true once deleted. */
		async remove(plan: { planId: Id<'readingPlans'>; book: string }) {
			try {
				await removePlan(
					{ planId: plan.planId },
					{ optimisticUpdate: optimisticPlanRemoved(plan.planId) }
				);
				toast.success(`Deleted the ${plan.book} plan`);
				return true;
			} catch (error) {
				toastError(error);
				return false;
			}
		}
	};
}

export type ReadingActions = ReturnType<typeof readingActions>;
