/**
 * Stops a window scroll that carries a row past the top of the viewport, holds it there a moment,
 * then lets go. Scrolling away from the row when already on it is free, and it won't catch again
 * until the row has been half a screen away.
 */
export class Detent {
	holding = $state(false);
	#row: () => HTMLElement | null | undefined;
	#ms: number;
	#armed = false;
	#resting = false;
	/** Which side of the line the row was on at the last scroll: 1 below, -1 above. */
	#side: { row: HTMLElement; sign: number } | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(row: () => HTMLElement | null | undefined, ms = 700) {
		this.#row = row;
		this.#ms = ms;
	}

	/** Call before scrolling to or across the row on purpose, so it doesn't catch. */
	skip() {
		this.#armed = false;
		this.#side = undefined;
		// Until it arrives, or the user takes over.
		this.#resting = true;
	}

	listen = () => {
		const onscroll = () => this.#check();
		const oninput = () => (this.#resting = false);
		const inputs = ['wheel', 'touchstart', 'keydown'] as const;
		addEventListener('scroll', onscroll, { passive: true });
		for (const type of inputs) addEventListener(type, oninput, { passive: true });
		return () => {
			removeEventListener('scroll', onscroll);
			for (const type of inputs) removeEventListener(type, oninput);
			this.#release();
		};
	};

	#check() {
		const row = this.#row();
		if (!row) return;
		const offset = offsetOf(row);
		if (this.holding) return align(offset);
		const sign = Math.sign(offset);
		let caught;
		if (Math.abs(offset) < 1) {
			// A scroll that lands right on it counts too.
			caught = this.#armed;
			this.#resting = false;
		} else {
			if (Math.abs(offset) > innerHeight / 2 && !this.#resting) this.#armed = true;
			caught = this.#armed && this.#side?.row === row && this.#side.sign !== sign;
			this.#side = { row, sign };
		}
		if (!caught) return;
		this.#armed = false;
		this.holding = true;
		align(offset);
		// Stops wheel, keys and drags; touch momentum is also reset by the align above on each scroll.
		// The root keeps its scrollbar gutter, so nothing shifts.
		document.documentElement.style.overflow = 'hidden';
		this.#timer = setTimeout(() => this.#release(), this.#ms);
	}

	#release() {
		clearTimeout(this.#timer);
		if (!this.holding) return;
		this.holding = false;
		document.documentElement.style.overflow = '';
	}
}

/** How far the row's top sits below where `scrollIntoView` would put it. */
function offsetOf(row: HTMLElement) {
	return row.getBoundingClientRect().top - parseFloat(getComputedStyle(row).scrollMarginTop);
}

function align(offset: number) {
	if (Math.abs(offset) >= 1) scrollTo({ top: scrollY + offset, behavior: 'instant' });
}
