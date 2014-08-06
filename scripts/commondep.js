define('commondep', [], function() {
	var exports = {};
	
	exports.name = 'commondep';
	exports.version = 1.0;
	
	function showAboutBox(name, version) {
		alert('loaded dependency: ' + name + ' ' + version);
	}
	exports.showAboutBox = showAboutBox;
	
	return exports;
});
