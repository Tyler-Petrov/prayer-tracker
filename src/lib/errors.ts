import { ConvexError } from 'convex/values';
import { toast } from 'svelte-sonner';

export function errorMessage(error: unknown) {
	return error instanceof ConvexError && typeof error.data === 'string'
		? error.data
		: 'Something went wrong. Try again.';
}
export const toastError = (error: unknown) => void toast.error(errorMessage(error));
