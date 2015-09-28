exports = module.exports = function() {
  var config = require('./config.json');
  var util = require('./common/utils');
  var auth = require('./common/auth');
  var digitalOcean = require('./common/digitalocean').Api(auth.getDigitalOceanToken(), config.testMode);
  var async = require('async');
  var libraryName;
  var droplets = [];

  var getDropletList = function(callback) {
    digitalOcean.getDropletList(function(err, list) {
      if (err) {
        callback(err);
        return;
      }
      for (var i in list) {
        if (list[i].name.indexOf(libraryName) > -1) {
          droplets.push(list[i]);
        }
      }
      callback(null);
    });
  };

  var deleteDroplets = function(callback) {
    var requests = [];
    var Executor = function(id) {

      this.run = function(cb) {
        digitalOcean.deletDroplet(id, cb);
      };

      return this.run;
    };

    if (droplets.length === 0) {
      callback('No droplets found');
      return;
    }

    for (var i in droplets) {
      requests.push(new Executor(droplets[i].id));
    }

    async.series(requests, callback);

  };

  var dropNetwork = function() {
    async.waterfall([
      getDropletList,
      deleteDroplets
    ], function(err) {
      console.log(err ? 'Failed to delete some droplet(s)' : 'Dropped Network');
    });
  };

  var onLibrarySelected = function(index) {
    var isExample;
    index = parseInt(index);
    var keys = [];
    for (var key in config.libraries) {
      keys.push(key);
    }
    if (isNaN(index) || index < 1 || index > keys.length) {
      console.log('Invalid option');
      showMainMenu();
      return;
    }
    isExample = config.libraries[keys[index]].hasOwnProperty('example');
    libraryName = isExample ? config.libraries[key]['example'] : config.libraries[key]['binary'];
    dropNetwork();
  };

  var showMainMenu = function() {
    var libOptions = "\n--------- \n";
    var i =1;
    var isExample;
    for (var key in config.libraries) {
      isExample = config.libraries[key].hasOwnProperty('example');
      libOptions +=  (i + '. ' + key + ' ' + (isExample ? 'Example' : 'Binary')
      + ' - ' + (isExample ? config.libraries[key]['example'] : config.libraries[key]['binary']) + '\n');
      i++;
    }
    util.postQuestion('Select the library to drop the network for:' + libOptions, onLibrarySelected)
  };

  showMainMenu();
};
