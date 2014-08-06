define(['module', 'fetch', 'config'], function (module, fetch, config) {
    'use strict';

	function getEntryModule(pluginName) {
	    //may be overriden for specific plugins
		if(typeof config.getPluginEntryModule === 'function') {
			return config.getPluginEntryModule(pluginName);
		}
		
		return 'main';
	}

	function getContextPath(pluginName) {
	    //may be overriden for specific plugins
		if(typeof config.getPluginContextPath === 'function') {
			return config.getPluginContextPath(pluginName);
		}
		
		return getGlobalContext().config.baseUrl + pluginName;
	}
	
	function loadPlugin(pluginName) {
		if(isPluginLoaded(pluginName)) {
			return;
		}
		
		createSandbox(pluginName, function(sandbox) {
			sandbox([ getEntryModule(pluginName) ], function(plugin){
				plugin.init();
			});
		});
	}
	
	function createSandbox(pluginName, callback) {
		configureRequire(pluginName, function(config) {
			config.context = pluginName;
			config.baseUrl = getContextPath(pluginName); 
				
			var sandbox = require.config(config);

			configureSandbox(sandbox, pluginName, function() {
				callback(sandbox);
			});		
		});
	}
	
	function configureRequire(pluginName, callback) {
		var url = getContextPath(pluginName) + '/require.config.json';
		
		fetch.fetch(url, function(scriptSource) {
			var config = JSON.parse(scriptSource);
			callback(config);
		}, function(error) {
			console.log('No require.config.json found for plugin ' + pluginName + '. Assuming default configuration.');
		});
	}

	function configureSandbox(sandbox, pluginName, callback) {
		getInheritedDependencies(pluginName, function(inheritedDeps) {
			injectDependencies(inheritedDeps, pluginName);
			callback();
		});
	}
	
	function injectDependencies(dependencies, contextName) {
		dependencies.forEach(function(dependency) {
			injectDependency(dependency, contextName);
		});
	}
	
	function injectDependency(dependencyName, contextName) {
		var ctx = getContext(contextName);
		var dependencyInstance = require(dependencyName);
		
		ctx.defQueue.push([ dependencyName, [], function() { return dependencyInstance; }]);
	}

	function isPluginLoaded(pluginName) {
		return getContext(pluginName) !== undefined;
	}
	
	function getContext(contextName) {
		return requirejs.s.contexts[contextName];
	}

	function getGlobalContext() {
		return getContext('_');
	}
	
	function getInheritedDependencies(pluginName, callback) {
		var ctx = getContext(pluginName);
		
		resolveDependencies(ctx, getEntryModule(pluginName), function(deps) {
			callback(deps);
		});
	}

	//for now we only support 1 level
	//of context nesting.
	function getGlobalDependencies() {
		var validDependencies = [];

		var depMap = getGlobalContext().defined;
		var dependencies = Object.keys(depMap);
		dependencies.forEach(function(dependency) {
			if(depMap[dependency] !== undefined) {
				validDependencies.push(dependency);
			}
		});
		
		return validDependencies;
	}
	
	function resolveDependencies(requireContext, moduleName, readyCallback) {
		var ctx = new DependencyContext(requireContext, getGlobalDependencies(), readyCallback);
		var tree = new DependencyTree(moduleName);
		tree.markProcessing();
	
		buildDependencyTree(ctx, tree, moduleName);
	}
	
	function buildDependencyTree(ctx, tree, moduleName) {
		if(moduleName == undefined) {
			return;
		}
		
		if(ignoreDependency(moduleName)) {
			return;
		}
		
		if(ctx.isGlobalModule(moduleName)) {
			//don't try to load global dependencies
			tree.addDependency(moduleName).markResolved();
			processNextDependency(ctx, tree);
			return;
		}
		
		var url = ctx.nameToUrl(moduleName);
		
		fetch.fetch(url, function(scriptSource) {
			var deps = extractDependencies(scriptSource);
			deps.forEach(function(dep) {
				tree.addDependency(dep);
			});
			
			processNextDependency(ctx, tree);
		}, function(error) {
			//module can't be loaded; possibly defined in parent context
			console.log('Could not determine dependencies of ' + moduleName);
			var dependency = tree.findDependency(moduleName);
			dependency.status = ResolveStatus.RESOLVED;
			
			processNextDependency(ctx, tree);
		});
	}
	
	function processNextDependency(ctx, tree) {
		var dependency = tree.takeDependency();
		if(dependency !== undefined) {
			buildDependencyTree(ctx, tree, dependency.moduleName);
		}
		
		if(tree.allResolved) {
			ctx.ready(tree);
		}
	}

	var ignoredDependencies = [ 'module', 'require', 'exports' ];
	
	function ignoreDependency(moduleName) {
		return ignoredDependencies.indexOf(moduleName) > 0;
	}

	var defineRegex = /define\(\s*\[(.*)\]/
	
	function extractDependencies(scriptSource) {
		var dependencies = defineRegex.exec(scriptSource)[1].split(',');
		
		var filteredDeps = [];
		dependencies.forEach(function(dep) {
			var filteredDep = dep.trim().replace(/'/g,'');
			if(filteredDep.length != 0) {
				filteredDeps.push(filteredDep);
			}
		});
	
		//TODO process require calls in scriptSource
		return filteredDeps;
	}
	
	function DependencyContext(requireContext, globalDependencies, readyCallback) {
		this.requireContext = requireContext;
		this.globalDependencies = globalDependencies;
		this.readyCallback = readyCallback;
		this.callbackCalled = false;
		
		this.nameToUrl = function(moduleName) {
			return this.requireContext.nameToUrl(moduleName);
		}
		
		this.isGlobalModule = function(moduleName) {
			return this.globalDependencies.indexOf(moduleName) != -1;
		}

		function getSharedDeps(moduleDeps, globalDeps) {
			var sharedDeps = [];
			
			moduleDeps.forEach(function(moduleDep) {
				if(globalDeps.indexOf(moduleDep) != -1) {
					sharedDeps.push(moduleDep);
				}
			});
			
			return sharedDeps;
		}
	
		this.ready = function(tree) {
			if(this.callbackCalled) {
				return;
			}
			
			this.callbackCalled = true;
			
			var sharedDependencies = getSharedDeps(tree.toList(), this.globalDependencies);
			this.readyCallback(sharedDependencies);
		}
	}
	
	var ResolveStatus = {
		RESOLVED : 'RESOLVED',
		PROCESSING : 'PROCESSING',
		UNRESOLVED : 'UNRESOLVED'
	}
	
	function DependencyTree(moduleName) {
		this.moduleName = moduleName;
		this.status = ResolveStatus.UNRESOLVED;
		this.parent = null;
			
		this.dependencies = {};
		
		this.markProcessing = function() {
			this.status = ResolveStatus.PROCESSING;
		}

		this.markResolved = function() {
			this.status = ResolveStatus.RESOLVED;
		}
		
		this.getRoot = function() {
			var node = this;
			while(node.parent != null) {
				node = node.parent;
			}
			return node;
		}
		
		this.walk = function(callback) {
			var result = callback(this);
			if(result !== undefined) {
				return result;
			}
			
			for(var key in this.dependencies) {
				var dependency = this.dependencies[key];
				var result = dependency.walk(callback);
				if(result !== undefined) {
					return result;
				}
			}
		}
		
		this.findDependency = function(moduleName) {
			var result = this.getRoot().walk(function(dependency) {
				if (dependency.moduleName === moduleName) {
					return dependency;
				}
			});
			
			return result;
		}
		
		this.existDependency = function(moduleName) {
			return this.findDependency(moduleName) !== undefined;
		}
		
		this.addDependency = function(moduleName) {
			var existingDependency = this.findDependency(moduleName);
			
			if(existingDependency != undefined) {
				return existingDependency;
			}
			
			//a module may exist only once in the tree
			var dependency = new DependencyTree(moduleName);
			this.dependencies[moduleName] = dependency;
			return dependency;
		}
		
		this.takeDependency = function() {
			var result = this.getRoot().walk(function(dependency) {
				if(dependency.status === ResolveStatus.UNRESOLVED) {
					dependency.status = ResolveStatus.PROCESSING;
					return dependency;
				}
			});
			
			return result;
		}
		
		this.allResolved = function() {
			var result = this.getRoot().walk(function(dependency) {
				if(dependency.status !== ResolveStatus.RESOLVED) {
					return false;
				}
			});
			
			return result;
		}
		
		this.toList = function() {
			var result = [];
			
			this.getRoot().walk(function (node){
				for(var moduleName in node.dependencies) {
					if (result.indexOf(moduleName) == -1) {
						result.push(moduleName);
					}
				}
			});
			
			return result;
		}
	}

	var loader = {};
	
    function startPlugins() {
    	if(config.plugins === undefined || config.plugins.length == 0) {
    		return;
    	}
		
    	for(var i = 0; i < config.plugins.length; i++) {
    		startPlugin(config.plugins[i]);
    	}
    }
    loader.startPlugins = startPlugins;
	
    function startPlugin(pluginName) {
    		loadPlugin(pluginName);
    }
    loader.startPlugin = startPlugin;
	
	return loader;
});