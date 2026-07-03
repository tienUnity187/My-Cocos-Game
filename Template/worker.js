let interval;

self.addEventListener('message', function(e) {
	const data = e.data;
	switch (data) {
		case 'start':
			interval = setInterval(async ()=> {
				postMessage('interval');
			}, 20)
			break;
		case 'stop':
			clearInterval(interval);
			self.postMessage('WORKER STOPPED: ' + data.msg +
							'. (buttons will no longer work)');
			break;
		default:
			self.postMessage('Unknown command: ' + data.msg);
	};
});
