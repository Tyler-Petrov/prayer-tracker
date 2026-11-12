import { getLocalTimeZone, today as todayIn } from '@internationalized/date';

const local = () => todayIn(getLocalTimeZone()).toString();

/** The user's local calendar day, YYYY-MM-DD. Every query and mutation that needs a date takes `today.current`. */
class Today {
	current = $state(local());
	constructor() {
		const refresh = () => (this.current = local()); // a phone left open overnight rolls to the new day
		document.addEventListener('visibilitychange', refresh);
		setInterval(refresh, 60_000);
	}
}

export const today = new Today();
