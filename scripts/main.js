define('config', [], function() {
	var config = {};
	
	config.plugins = ['plugin-a', 'plugin-b'];
	
	return config;
});

require(['commondep', 'plugin-loader'], function(cp, pl) {

	pl.startPlugins();

});
