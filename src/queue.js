var Batch = require('batch');

var redis = require('./redis');
var Job = require('./job');
var Worker = require('./worker');

var Queue = module.exports = function(name, qp) {
  this.name = name;
  this.redis = redis.client();
  this.qp = qp;
};

Queue.prototype.create = Queue.prototype.createJob = function(data) {
  var job = new Job(data, this);
  return job;
};

Queue.prototype.multiSave = function(jobs, cb) {

  var self = this;

  for (var i = 0; i < jobs.length; i++) {
    if (!(jobs[i] instanceof Job)) {
      jobs[i] = self.create(jobs[i]);
    }
  }

  var r = this.redis.multi();

  var batch = new Batch();
  batch.concurrency(3);

  jobs.forEach(function(job) {
    batch.push(function(done) {
      job._save(r, done);
    });
  });

  batch.end(function() {
    r.exec(cb);
  });

};

Queue.prototype._spawnWorker = function(cb) {
  var self = this;

  var w;
  if (this.qp.opts.noBlock) {
    w = new Worker(this, this.redis);
  } else {
    w = new Worker(this);
  }

  w.on('job', function(jobID) {
    var job = self.create();
    job.id = jobID;
    job.worker = w;
    job._saved = true;

    job.getInfo(function() {

      // if theres a timeout - set it up
      if (job._timeout) {
        job.__timeout = setTimeout(function() {
          job.done('timeout');
        }, job._timeout);
      }

      job.setState('active');
      cb(job, job.done.bind(job));
    });

  });

  w.process();
};

Queue.prototype.process = function(concurrency, cb) {

  // allow concurrency not to be set
  if (typeof concurrency == 'function' && !cb) {
    cb = concurrency;
    concurrency = null;
  }

  for (var i = 0; i < (concurrency || 1); i++) {
    this._spawnWorker(cb);
  }

};

Queue.prototype.numJobs = function(states, cb) {
  var self = this;

  if (!Array.isArray(states)) states = [states];

  var data = {};

  var batch = new Batch();

  states.forEach(function(state) {
    batch.push(function(done) {
      self.redis.zcard('qp:' + self.name + '.' + state, function(e, r) {
        data[state] = r;
        done();
      });
    });
  });

  batch.end(function() {
    cb(null, data);
  });

};

Queue.prototype.getJobs = function(state, from, to, cb) {
  var self = this;

  self.redis.zrange('qp:' + this.name + '.' + state, from, to, function(err, jobs) {

    var batch = new Batch();
    jobs.forEach(function(id) {

      batch.push(function(done) {
        var job = self.create();
        job.id = id;
        job.getInfo(function() {
          job.toJSON(true);
          done(null, job);
        });
      });


    });
    batch.end(cb);
  });
};

Queue.prototype.flush = function(cb) {
  var r = this.redis.multi();

  r.srem('qp:job:types', this.name);
};

Queue.prototype.clear = function(type, cb) {
  var self = this;

  if (!cb && typeof type === 'function') {
    cb = type;
    type = 'completed';
  }
  if (!type) type = 'completed';

  var r = self.redis.multi();
  self.redis.zrange('qp:' + self.name + '.' + type, 0, -1, function(e, members){
    for (var i = 0; i < members.length; i++) {
      var job = self.create();
      job.id = members[i];
      job.state = 'completed';
      job._remove(r);
    }
    r.exec(cb);
  });
};
