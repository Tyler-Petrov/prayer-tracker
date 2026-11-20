import { on } from 'svelte/events';
import { createSubscriber } from 'svelte/reactivity';

/**
 * How much of the screen an on-screen keyboard covers. Phones open the keyboard over the page and shrink only the
 * visual viewport, so a `position: fixed; bottom: 0` sheet ends up behind it. `inset` is the part of the layout
 * viewport hidden below the visible area, `height` the visible height (both CSS px; 0 and the window height when no
 * keyboard is up). A pinch zoom moves the visual viewport too, so it's ignored.
 */
class Keyboard {
	#subscribe = createSubscriber((update) => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const offResize = on(viewport, 'resize', update);
		const offScroll = on(viewport, 'scroll', update);
		return () => {
			offResize();
			offScroll();
		};
	});

	get inset() {
		this.#subscribe();
		const viewport = window.visualViewport;
		if (!viewport || viewport.scale > 1.01) return 0;
		const inset = window.innerHeight - viewport.offsetTop - viewport.height;
		// Browser chrome sliding in and out moves it a little; a keyboard is far taller.
		return inset > 80 ? inset : 0;
	}

	get height() {
		this.#subscribe();
		return window.visualViewport?.height ?? window.innerHeight;
	}
}

export const keyboard = new Keyboard();
