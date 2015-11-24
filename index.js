var Queue = require('./src/queue');
var redisHandler = require('./src/redisHandler');

var Batch = require('batch');

var QP = module.exports = function(opts) {
  this.queues = {};
  this.opts = opts || {};

  this.redis = redisHandler();

  if (this.opts.cleanShutdown) {
    this.cleanShutdown();
  }
};

QP.prototype.redisClient = function(func) {
  this.redis.createClient = func;
};

QP.prototype.getQueue = function(name, opts) {
  var q = this.queues[name] || (this.queues[name] = new Queue(this, name, opts || {}));

  // this will overwrite the queue's options if it already exists and if new ones are specified
  q.opts = opts || q.opts || {};
  return q;
};

QP.prototype.createServer = function(name, port) {
  // this will throw if qp-server isnt installed
  var Server = require('qp-server');

  var server = new Server(this, name);
  if (port) server.listen(port);

  return server;
};

QP.prototype.getQueues = function(cb) {
  this.redis.client().smembers('qp:job:types', cb);
};

QP.prototype.stop = function(cb) {
  var batch = new Batch();

  for (var i in this.queues) {
    var q = this.queues[i];
    batch.push(q.stop.bind(q));
  }
  batch.end(cb);
};

QP.prototype.cleanShutdown = function() {
  var self = this;

  var alreadyAttempted = false;
  var calledBack = false;
  var shutdownCB = self.opts.shutdownCB || process.exit;

  [ 'SIGHUP', 'SIGINT', 'SIGTERM' ].forEach(function(sig) {
    process.on(sig, function() {

      // we've already received a shutdown command, exit immediately
      if (alreadyAttempted) {
        console.log('qp already attempted shutdown, forcing exit');
        calledBack = true;
        return shutdownCB();
      }

      console.log('qp caught signal ' + sig);
      alreadyAttempted = true;

      var shutdownTimeout;

      var cb = function() {
        if (calledBack) return;
        calledBack = true;
        clearTimeout(shutdownTimeout);
        shutdownCB();
      };

      if (self.opts.shutdownTimeout) {
        shutdownTimeout = setTimeout(cb, self.opts.shutdownTimeout);
      }

      self.stop(cb);
    });
  });
};
