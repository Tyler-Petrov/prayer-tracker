// The quick request actions (prayed, skip a day, answer, delete) for the Days tab, the item sheet and a
// request's page: each one optimistic across every loaded query (optimistic.ts), with errors shown as toasts.
// Call `requestActions()` while a component initializes (it uses the Convex client from context).
import { toast } from 'svelte-sonner';
import { useMutation } from 'convex-svelte';
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';
import { toastError } from '#lib/errors.js';
import {
	optimisticAnswered,
	optimisticPrayed,
	optimisticRemoved,
	optimisticSkipped,
	optimisticUnanswered
} from '#lib/optimistic.js';

type RequestId = Id<'requests'>;
type Target = { requestId: RequestId; title: string };

export function requestActions() {
	const setPrayed = useMutation(api.prayers.set);
	const setSkipped = useMutation(api.requests.skip);
	const answerRequest = useMutation(api.requests.answer);
	const unanswerRequest = useMutation(api.requests.unanswer);
	const removeRequest = useMutation(api.requests.remove);

	return {
		/** Marks it prayed on `date` (or not). `message` toasts once saved (the menus say what they did). */
		prayed(target: Target, date: string, prayed: boolean, message?: string) {
			return setPrayed(
				{ requestId: target.requestId, date, prayed },
				{ optimisticUpdate: optimisticPrayed(target.requestId, date, prayed) }
			).then(() => {
				if (message) toast(message);
			}, toastError);
		},

		/** Skips just `date` of a recurring request (or brings it back), with an Undo on the toast. */
		skip(target: Target, date: string, skipped: boolean, dayLabel: string) {
			const run = (skip: boolean) =>
				setSkipped(
					{ requestId: target.requestId, date, skipped: skip },
					{ optimisticUpdate: optimisticSkipped(target.requestId, date, skip) }
				);
			return run(skipped).then(() => {
				toast(
					skipped ? `Skipped ${target.title} ${dayLabel}` : `${target.title} is back ${dayLabel}`,
					{ action: { label: 'Undo', onClick: () => void run(!skipped).catch(toastError) } }
				);
			}, toastError);
		},

		/** Answered on `answeredOn`, with an optional note. Resolves true once saved. */
		async answer(target: Target, answeredOn: string, answerNote?: string) {
			try {
				await answerRequest(
					{ requestId: target.requestId, answeredOn, answerNote: answerNote?.trim() || undefined },
					{ optimisticUpdate: optimisticAnswered(target.requestId, answeredOn, answerNote) }
				);
				toast.success(`${target.title} is answered`);
				return true;
			} catch (error) {
				toastError(error);
				return false;
			}
		},

		unanswer(target: Target) {
			return unanswerRequest(
				{ requestId: target.requestId },
				{ optimisticUpdate: optimisticUnanswered(target.requestId) }
			).then(() => void toast(`${target.title} is back on its schedule`), toastError);
		},

		/** Deletes it and its prayed days. Resolves true once deleted. */
		async remove(target: Target) {
			try {
				await removeRequest(
					{ requestId: target.requestId },
					{ optimisticUpdate: optimisticRemoved(target.requestId) }
				);
				toast.success(`Deleted ${target.title}`);
				return true;
			} catch (error) {
				toastError(error);
				return false;
			}
		}
	};
}

export type RequestActions = ReturnType<typeof requestActions>;
