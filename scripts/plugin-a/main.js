define(['commondep', 'plugindep-1.0'], function(cd, pld) {
	var exports = {};

	function init() {
		cd.showAboutBox(pld.name, pld.version);
	}
	exports.init = init;
	
	return exports;
});
