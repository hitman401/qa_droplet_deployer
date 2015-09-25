/// options
/// clone
/// build and strip
exports = module.exports = function(args) {
  var fs = require('fs');
  var utils = require('./common/utils');
  var config = require('./config.json');
  var auth = require('./common/auth');
  var digitalOcean = require('./common/digitalocean').Api(auth.getDigitalOceanToken());
  var exec = require('child_process').exec;
  var async = require('async');
  var ADVANCED_ARG = 'advanced';

  var selectedLibrary;
  var networkSize;
  var seedNodeSize;
  var dropletRegions;
  var createdDroplets;
  var connectionType;
  var beaconPort;
  var listeningPort;

  var clone = function(callback) {
    console.log('Cloning Repo :: ' + selectedLibrary);
    exec('git clone ' + config.libraries[selectedLibrary].url + ' ' +
          config.workspace + '/' + selectedLibrary + ' --depth 1', function(err) {
      callback(err);
    });
  };

  // TODO add strip command
  var build = function(callback) {
    var path = config.workspace + '/' + selectedLibrary;
    var libConfig = config.libraries[selectedLibrary];
    var buildCommand = 'cargo build';
    if (libConfig.hasOwnProperty('example')) {
      buildCommand += ' --example ' + libConfig['example'];
    }
    buildCommand += ' --release';
    console.log('Building Library :: ' + path);
    exec('cd ' + path + ' && ' + buildCommand, function(err) {
      callback(err)
    });
  };

  var getNetworkSize = function(callback) {
    utils.postQuestion('Please enter the size of the network between ' +
      config.minNetworkSize + '-' + config.maxNetworkSize, function(size) {
      size = parseInt(size);
      if(isNaN(size) || size < config.minNetworkSize || size > config.maxNetworkSize) {
        console.log('Invalid input');
        getNetworkSize(callback);
      } else {
        networkSize = size;
        callback(null);
      }
    });
  };

  var getSeedNodeSize = function(callback) {
    utils.postQuestion('Please enter the size of the seed nodes between ' +
      config.minSeedNodeSize + '-' + config.maxSeedNodeSize, function(size) {
      size = parseInt(size);
      if(isNaN(size) || size < config.minSeedNodeSize || size > config.maxSeedNodeSize) {
        console.log('Invalid input');
        getSeedNodeSize(callback);
      } else {
        seedNodeSize = size;
        callback(null);
      }
    });
  };

  var getNetworkType = function(callback) {
    utils.postQuestion('Please select the type of network \n1. Spread \n2. Concentrated', function(type) {
      type = parseInt(type);
      if(isNaN(type) || type < 0 || type > 2) {
        console.log('Invalid input');
        getSeedNodeSize(callback);
      } else {
        callback(null, type === 1);
      }
    });
  };

  var getDropletRegions = function(callback) {
    digitalOcean.getAvaliableRegions(config.dropletSize, function(err, availableRegions) {
      if (err) {
        callback(err);
        return;
      }
      dropletRegions = availableRegions;
      callback(null);
    });
  };

  var selectDropletRegion = function(spreadNetwork, callback) {
    if (spreadNetwork) {
      callback(null, dropletRegions);
      return;
    }
    var question = 'Please select a region';
    for (var i in dropletRegions) {
      question += ('\n' + (parseInt(i)+1) + ' ' + dropletRegions[i]);
    }
    utils.postQuestion(question, function(value) {
      var index = parseInt(value);
      if (isNaN(index) || index < 1 || index > dropletRegions.length) {
        selectDropletRegion(spreadNetwork, callback);
      } else {
        callback(null, [dropletRegions[index]]);
      }
    });
  };

  var createDroplets = function(selectedRegions, callback) {
    var name;
    var region;
    var TempFunc = function(name, region, size, image, keys) {
      this.run = function(cb) {
        digitalOcean.createDroplet(name, region, size, image, keys, cb);
      };
      return this.run;
    };
    var requests = [];
    for (var i = 0; i < networkSize; i++) {
      region = selectedRegions[i % selectedRegions.length];
      name = auth.getUserName() + '-' + selectedLibrary + '-TN-' + region + '-' + (i+1);
      requests.push(new TempFunc(name, region, config.dropletSize, config.imageId, config.sshKeys));
    }
    async.series(requests, function(err, idList) {
      console.log('Waiting for droplets to initialise');
      setTimeout(function() {
        callback(null, idList);
      }, 5000); // Waiting to give some time for the droplet to be up.
    });
  };

  var getDroplets = function(idList, callback) {
    var TempFunc = function(id) {
      this.run = function(cb) {
        digitalOcean.getDroplet(id, cb);
      };
      return this.run;
    };
    var requests = [];
    for (var i in idList) {
      requests.push(new TempFunc(idList[i]));
    }
    async.series(requests, function(err, droplets) {
      if(err) {
        console.log(err);
        return;
      }
      createdDroplets = droplets;
      callback(null);
    });
  };

  var getConnectionType = function(callback) {
    utils.postQuestion('Please select the Connection type for generating the config file \n' +
    '1. Tcp & Utp (Both) \n2. Tcp \n3. Utp', function(type) {
      type = parseInt(type);
      if(isNaN(type) || type < 0 || type > 3) {
        console.log('Invalid input');
        getConnectionType(callback);
      } else {
        connectionType = type;
        callback(null);
      }
    });
  };

  var getBeconPort = function(callback) {
    if (!args.hasOwnProperty(ADVANCED_ARG)) {
      callback(null);
      return;
    }
    utils.postQuestion('Please enter the Becon port (Default:' + config.beaconPort + ')', function(port) {
      if (port !== '') {
        port = parseInt(port);
        if (isNaN(port)) {
          console.log('Invalid input');
          getBeconPort(callback);
          return;
        }
      }
      beaconPort = port ? port : config.beaconPort;
      callback(null);
    }, true);
  };

  var getListeningPort = function(callback) {
    if (!args.hasOwnProperty(ADVANCED_ARG)) {
      callback(null);
      return;
    }
    utils.postQuestion('Please enter the listening port (Default:' + config.listeningPort + ')', function(port) {
      if (port !== '') {
        port = parseInt(port);
        if (isNaN(port)) {
          console.log('Invalid input');
          getListeningPort(callback);
          return;
        }
      }
      listeningPort = port ? port : config.listeningPort;
      callback(null);
    }, true);
  };

  var generateEndPoints = function() {
    var endPoints = [];
    var ip;
    for (var i = 0; i < seedNodeSize; i++) {
      ip = createdDroplets[i].networks.v4[0].ip_address;
      if (connectionType != 3) {
        endPoints.push({
          protocol: 'tcp',
          address: ip
        });
      }
      if (connectionType != 2) {
        endPoints.push({
          protocol: 'utp',
          address: ip
        });
      }
    }
    return endPoints;
  };

  var generateConfigFile = function(callback) {
    var bootstrapFile;
    var spaceDelimittedFile = '';
    bootstrapFile = require('./bootstrap_template.json');
    bootstrapFile['tcp_listening_port'] = listeningPort | config.listeningPort;
    bootstrapFile['beacon_port'] = beaconPort | config.beaconPort;
    bootstrapFile['hard_coded_contacts'] = generateEndPoints();
    utils.deleteFolderRecursive(config.outFolder);
    fs.mkdirSync(config.outFolder);
    fs.writeFileSync(config.outFolder + '/' + selectedLibrary + '.bootstrap.cache',
        JSON.stringify(bootstrapFile, null, 2));
    for (var i in createdDroplets) {
      spaceDelimittedFile += spaceDelimittedFile ? ' ' : '';
      spaceDelimittedFile += createdDroplets[i].networks.v4[0].ip_address;
    }
    fs.writeFileSync(config.outFolder + '/ip_list', spaceDelimittedFile);
    callback(null);
  };

  var copyBinary = function(callback) {
    var files = fs.readdirSync(config.workspace + '/' + selectedLibrary + '/target/release/examples/');
    if (!files || files.length === 0) {
      callback('Binary not found');
      return;
    }
    var inStream = fs.createReadStream(config.workspace + '/crust/target/release/examples/' + files[0]);
    var outStream = fs.createWriteStream(config.outFolder + '/' + files[0]);
    inStream.pipe(outStream);
  };

  var transferFiles = function(callback) {
    console.log('SSH output directory -- To be implemented');
    callback(null);
  };

  var printResult = function() {
    for (var i in createdDroplets) {
      console.log(createdDroplets[i].name +
      '- ssh ' + config.dropletUser + '@' + createdDroplets[i].networks.v4[0].ip_address);
    }
  };

  var buildLibrary = function(option) {
    var libraries = [];
    for (var key in config.libraries) {
      libraries.push(key);
    }
    selectedLibrary = libraries[option - 1];

    async.waterfall([
      clone,
      build,
      getNetworkSize,
      getSeedNodeSize,
      getDropletRegions,
      getNetworkType,
      selectDropletRegion,
      createDroplets,
      getDroplets,
      getConnectionType,
      getBeconPort,
      getListeningPort,
      generateConfigFile,
      copyBinary,
      transferFiles,
      printResult
    ], function(err) {
      console.log(err);
    });
  };

  var onSetupOptionSelected = function(option) {
    option = parseInt(option);
    var optionNotValid = function() {
      console.log("Invalid option selected");
      showSetupOptions();
    };
    if (isNaN(option) || option < 0 || option > 3) {
      optionNotValid();
    } else {
      buildLibrary(option);
    }
  };

  var showSetupOptions = function() {
    utils.postQuestion('Please choose the library for which the network is to be set up: \n\
--------- \n\
1. CRUST Example - crust_peer\n\
2. Routing Example - simple_key_value_store\n\
3. Vault Binary - safe_vault', onSetupOptionSelected);
  };

  showSetupOptions();
};

