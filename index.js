let node = false;
try {
    node = (Object.prototype.toString.call(global.process) === '[object process]');
}
catch (e) {
}

module.exports = node ? require('./lib/node') : require('./lib/web');