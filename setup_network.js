exports = module.exports = function(args) {
  var fs = require('fs');
  var os = require('os');
  var scpClient = require('scp2');
  var async = require('async');
  var exec = require('child_process').exec;
  var utils = require('./common/utils');
  var config = require('./config.json');
  var auth = require('./common/auth');
  var digitalOcean = require('./common/digitalocean').Api(auth.getDigitalOceanToken(), config.testMode);

  var ADVANCED_ARG = 'advanced';

  var selectedLibraryRepoName;
  var libraryConfig;
  var binaryPath;
  var binaryName;
  var buildPath;
  var networkSize;
  var seedNodeSize;
  var dropletRegions;
  var createdDroplets;
  var connectionType;
  var beaconPort;
  var listeningPort;

  var BINARY_EXT = {
    'windows_nt': '.exe',
    'linux': ''
  }[os.type().toLowerCase()];

  var clone = function(callback) {
    console.log('Cloning Repository - ' + selectedLibraryRepoName);
    exec('git clone ' + libraryConfig.url + ' ' +
          buildPath + ' --depth 1', function(err) {
      callback(err);
    });
  };

  var build = function(callback) {
    var buildCommand = 'cargo build';
    if (libraryConfig.hasOwnProperty('example')) {
      buildCommand += ' --example ' + libraryConfig['example'];
    }
    buildCommand += ' --release';
    console.log('Building Repository - ' + selectedLibraryRepoName);
    exec('cd ' + buildPath + ' && ' + buildCommand, function(err) {
      callback(err);
    });
  };

  var stripBinary = function(callback) {
    exec('strip -s ' + binaryPath + binaryName, function(err) {
      callback(err);
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
        getNetworkType(callback);
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
        callback(null, [dropletRegions[index - 1]]);
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
    console.log("Creating droplets...");
    for (var i = 0; i < networkSize; i++) {
      region = selectedRegions[i % selectedRegions.length];
      name = auth.getUserName() + '-' + selectedLibraryRepoName + '-TN-' + region + '-' + (i+1);
      console.log("Creating droplet -", name);
      requests.push(new TempFunc(name, region, config.dropletSize, config.imageId, config.sshKeys));
    }
    async.series(requests, callback);
  };

  var isAllDropletsActive = function(list) {
    var initialised;
    for (var i in list) {
      initialised = list[i].status === 'active';
      if (!initialised) {
        break;
      }
    }
    return initialised;
  };

  var getDroplets = function(idList, callback) {
    var TempFunc = function(id) {
      this.run = function(cb) {
        digitalOcean.getDroplet(id, cb);
      };
      return this.run;
    };

    var getDropletInfo = function() {
      var requests = [];
      for (var i in idList) {
        requests.push(new TempFunc(idList[i]));
      }
      async.series(requests, function(err, droplets) {
        if (err) {
          callback(err);
          return;
        }
        createdDroplets = droplets;
        if (createdDroplets.length === 0) {
          callback('Droplets could not be created');
        } else if (!isAllDropletsActive(createdDroplets)) {
          console.log('Droplets are not initialised yet.. Will check again in some time');
          getDroplets(idList, callback);
        } else {
          callback(null);
        }
      });
    };
    console.log('Waiting for droplets to initialise');
    setTimeout(getDropletInfo, 2 * 60 * 1000);
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

  var getBeaconPort = function(callback) {
    if (!args.hasOwnProperty(ADVANCED_ARG)) {
      callback(null);
      return;
    }
    utils.postQuestion('Please enter the Beacon port (Default:' + config.beaconPort + ')', function(port) {
      if (port !== '') {
        port = parseInt(port);
        if (isNaN(port)) {
          console.log('Invalid input');
          getBeaconPort(callback);
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
    if (connectionType != 3) {
      bootstrapFile['tcp_listening_port'] = listeningPort | config.listeningPort;
    }
    if (connectionType != 2) {
      bootstrapFile['utp_listening_port'] = listeningPort | config.listeningPort;
    }
    bootstrapFile['beacon_port'] = beaconPort | config.beaconPort;
    bootstrapFile['hard_coded_contacts'] = generateEndPoints();
    utils.deleteFolderRecursive(config.outFolder);
    fs.mkdirSync(config.outFolder);
    fs.mkdirSync(config.outFolder + '/scp');
    var prefix = libraryConfig.hasOwnProperty('example') ? libraryConfig['example'] : selectedLibraryRepoName;
    fs.writeFileSync(config.outFolder + '/scp/' + prefix + '.bootstrap.cache',
        JSON.stringify(bootstrapFile, null, 2));
    for (var i in createdDroplets) {
      spaceDelimittedFile += spaceDelimittedFile ? ' ' : '';
      spaceDelimittedFile += createdDroplets[i].networks.v4[0].ip_address;
    }
    fs.writeFileSync(config.outFolder + '/' + config.outputIPListFile, spaceDelimittedFile);
    callback(null);
  };

  var copyBinary = function(callback) {
    var inStream = fs.createReadStream(binaryPath + binaryName);
    var outStream = fs.createWriteStream(config.outFolder + '/scp/' + binaryName);
    inStream.pipe(outStream);
    callback(null);
  };

  var transferFiles = function(callback) {
    if (config.testMode) {
      console.log('Skipping SCP in test mode');
      callback(null);
      return;
    }
    var TransferFunc = function(ip) {

      this.run = function(cb) {
        console.log("Transferring files to :: " + ip);
        scpClient.scp(config.outFolder + '/scp/', {
          host: ip,
          username: config.dropletUser,
          password: auth.getDopletUserPassword(),
          path: config.remotePathToTransferFiles
        }, cb);
      };

      return this.run;
    };
    var requests = [];
    for (var i in createdDroplets) {
      requests.push(new TransferFunc(createdDroplets[i].networks.v4[0].ip_address));
    }
    async.parallel(requests, callback);
  };

  var printResult = function(res, callback) {
    console.log('\n');
    for (var i in createdDroplets) {
      console.log(createdDroplets[i].name +
      ' ssh ' + config.dropletUser + '@' + createdDroplets[i].networks.v4[0].ip_address);
    }
    callback(null);
  };

  var buildLibrary = function(option) {
    var libraries = [];
    for (var key in config.libraries) {
      libraries.push(key);
    }
    var selectedKey = libraries[option - 1];
    var temp = config.libraries[selectedKey].url.split('/');
    selectedLibraryRepoName = temp[temp.length - 1].split('.')[0];
    libraryConfig = config.libraries[selectedKey];
    binaryName = (libraryConfig.hasOwnProperty('example') ? libraryConfig['example'] : selectedLibraryRepoName) +
      BINARY_EXT;
    binaryPath = config.workspace + '/' + selectedLibraryRepoName + '/target/release/' +
      (libraryConfig.hasOwnProperty('example') ? 'examples' : '') + '/';
    buildPath = config.workspace + '/' + selectedLibraryRepoName;
    async.waterfall([
      getDropletRegions,
      clone,
      build,
      stripBinary,
      getNetworkSize,
      getSeedNodeSize,
      getNetworkType,
      selectDropletRegion,
      createDroplets,
      getDroplets,
      getConnectionType,
      getBeaconPort,
      getListeningPort,
      generateConfigFile,
      copyBinary,
      transferFiles,
      printResult
    ], function(err) {
      if (err) {
        console.log(err);
        return;
      }
      console.log('Completed Setup - Output folder ->', config.outFolder);
    });
  };

  var onSetupOptionSelected = function(option) {
    var keys = [];
    option = parseInt(option);
    var optionNotValid = function() {
      console.log("Invalid option selected");
      showSetupOptions();
    };
    for (var key in config.libraries) {
      keys.push(key);
    }
    if (isNaN(option) || option < 0 || option > keys.length) {
      optionNotValid();
    } else {
      buildLibrary(option);
    }
  };

  var showSetupOptions = function() {
    var libOptions = "\n--------- \n";
    var i = 1;
    var isExample;
    for (var key in config.libraries) {
      isExample = config.libraries[key].hasOwnProperty('example');
      libOptions +=  (i + '. ' + key + ' ' + (isExample ? 'Example' : 'Binary')
        + ' - ' + (isExample ? config.libraries[key]['example'] : config.libraries[key]['binary']) + '\n');
      i++;
    }

    utils.postQuestion('Please choose the library for which the network is to be set up: ' + libOptions, onSetupOptionSelected);
  };

  showSetupOptions();
};

