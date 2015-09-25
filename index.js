var SetUpNetwork = require('./setup_network');
var utils = require('./common/utils');
var auth = require('./common/auth');
var config = require('./config');

/**
 * Return true, if the current OS platform is permitted.
 * Permitted platforms are configured in the config.json
 * @returns {boolean}
 */
var isPlatformSupported = function() {
  return config.platforms.indexOf(require('os').type().toLowerCase()) > -1;
};

var onMainOptionSelected = function(result) {
  var option = parseInt(result);
  var invalidOption = function() {
    console.log('Invalid Option');
    showMainMenu();
  };
  if (isNaN(option)) {
    invalidOption();
  } else{
    switch (option) {
      case 1:
        SetUpNetwork(utils.getArguments());
        break;

      case 2:
        break;

      default:
        invalidOption();
        break;
    }
  }
};

var showMainMenu = function() {
  utils.postQuestion('Main Menu \n\
--------- \n\
1. Setup Network \n\
2. Drop Network', onMainOptionSelected);
};

if (!isPlatformSupported()) {
  console.log("Os is not supported");
  process.exit();
  return;
}

console.log('Validating authentication...');
//auth.init(function(err) {
//  if (err) {
//    console.log(err);
//    return;
//  }
//  showMainMenu();
//});


var copyBinary = function(callback) {
  var fs = require('fs');
  var files = fs.readdirSync(config.workspace + '/crust/target/release/examples/');
  if (!files || files.length === 0) {
    callback('Binary not found');
    return;
  }
  var inStream = fs.createReadStream(config.workspace + '/crust/target/release/examples/' + files[0]);
  var outStream = fs.createWriteStream(config.outFolder + '/' + files[0]);
  inStream.pipe(outStream);
};
copyBinary()