/** Keeps the screen from sleeping while `when()` is true and this component is mounted. */
export function keepScreenOn(when: () => boolean) {
	if (!('wakeLock' in navigator)) return;
	let visible = $state(document.visibilityState === 'visible');
	$effect(() => {
		const update = () => (visible = document.visibilityState === 'visible');
		document.addEventListener('visibilitychange', update);
		return () => document.removeEventListener('visibilitychange', update);
	});

	// The browser drops the lock whenever the page is hidden, so hold one per visible stretch.
	$effect(() => {
		if (!when() || !visible) return;
		let lock: WakeLockSentinel | undefined;
		let done = false;
		navigator.wakeLock
			.request('screen')
			.then((l) => {
				if (done) l.release();
				else lock = l;
			})
			.catch(() => {}); // denied, e.g. battery saver: the screen just sleeps as usual
		return () => {
			done = true;
			lock?.release();
		};
	});
}
