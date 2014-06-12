(function() {
  var AdminRoutes, Events, HOST, Logger, PORT, Phases, Product, Project, Statuses, Theme, User, adminWhitelist, app, async, audience, authProduct, authProject, authTheme, authUser, ejs, express, getAuthLevel, helmet, indexRoute, io, isLoggedIn, logEvent, logTmpl, moment, mongoose, mongourl, policy, projectRoute, restful, server, url, vcap, _;

  _ = require("underscore");

  express = require("express");

  ejs = require("ejs");

  restful = require("node-restful");

  async = require("async");

  url = require("url");

  mongoose = restful.mongoose;

  moment = require("moment");

  helmet = require("helmet");

  Project = require("./models/project");

  Theme = require("./models/theme");

  Product = require("./models/product");

  User = require("./models/user");

  Phases = require("./models/phases");

  Statuses = require("./models/status");

  Events = require("./models/event");

  AdminRoutes = require("./routes/admin");

  Logger = require("./logger");

  io = require("socket.io");

  logTmpl = ejs.compile('<%= date %> (<%= response_time %>ms): ' + '<%= status %> <%= method %> <%= url %>');

  app = express();

  server = require("http").createServer(app);

  io = io.listen(server);

  policy = {
    defaultPolicy: {
      'default-src': ["'none'", 'https://login.persona.org'],
      'img-src': ['*'],
      'font-src': ['*'],
      'script-src': ["'self'", 'www.google-analytics.com', 'https://*.persona.org', "'unsafe-inline'", "'unsafe-eval'"],
      'style-src': ["'self'", 'fonts.googleapis.com', "'unsafe-inline'"],
      'xhr-src': ["'self'"],
      'connect-src': ["'self'"]
    }
  };

  helmet.csp.policy(policy);

  helmet.defaults(app);

  app.use(express.compress());

  app.use(express.bodyParser());

  app.use(express.cookieParser());

  app.use(express.session({
    secret: 'personasecret'
  }));

  app.use(express.query());

  app.use(function(req, res, next) {
    var rEnd;
    rEnd = res.end;
    req._rlStartTime = new Date();
    req.kvLog = {
      date: req._rlStartTime.toISOString(),
      method: req.method,
      url: url.parse(req.originalUrl).pathname
    };
    res.end = function(chunk, encoding) {
      res.end = rEnd;
      res.end(chunk, encoding);
      req.kvLog.status = res.statusCode;
      req.kvLog.response_time = new Date() - req._rlStartTime;
      return console.log(logTmpl(req.kvLog));
    };
    return next();
  });

  app.set('views', __dirname + '/app/');

  app.set('view engine', 'ejs');

  app.engine('html', ejs.renderFile);

  app.use(express["static"](__dirname + '/app/dist'));

  PORT = process.env.PORT || process.env.VCAP_APP_PORT || 3000;

  HOST = process.env.IP_ADDRESS || process.env.VCAP_APP_HOST || '127.0.0.1';

  audience = 'http://' + HOST + ':' + PORT;

  if (process.env.VCAP_APPLICATION) {
    vcap = JSON.parse(process.env.VCAP_APPLICATION);
    audience = vcap.uris[0];
  }

  if (process.env.PERSONA_AUDIENCE) {
    audience = process.env.PERSONA_AUDIENCE;
  }

  require('express-persona')(app, {
    audience: audience
  });

  mongourl = "mongodb://localhost/projects";

  if (process.env.MONGODB_URL) {
    mongourl = process.env.MONGODB_URL;
  }

  mongoose.connect(mongourl);

  isLoggedIn = function(req, res, next) {
    if (req.session.email) {
      res.logged_in_email = req.session.email;
      return next();
    } else {
      return res.send(401);
    }
  };

  authProject = function(req, res, next) {
    return isLoggedIn(req, res, function() {
      var project;
      return project = Project.findOne({
        _id: req.params.id
      }).populate('owner').exec(function(err, doc) {
        if (doc.owner.email === req.session.email || getAuthLevel(req.session.email) === 3) {
          return next();
        } else {
          return res.send(403);
        }
      });
    });
  };

  authTheme = function(req, res, next) {
    return isLoggedIn(req, res, function() {
      var theme;
      return theme = Theme.findOne({
        _id: req.params.id
      }).populate('owner').exec(function(err, doc) {
        if (doc.owner.email === req.session.email || getAuthLevel(req.session.email) === 3) {
          return next();
        } else {
          return res.send(403);
        }
      });
    });
  };

  authProduct = function(req, res, next) {
    return isLoggedIn(req, res, function() {
      var product;
      return product = Product.findOne({
        _id: req.params.id
      }).populate('owner').exec(function(err, doc) {
        if (doc.owner.email === req.session.email || getAuthLevel(req.session.email) === 3) {
          return next();
        } else {
          return res.send(403);
        }
      });
    });
  };

  authUser = function(req, res, next) {
    return isLoggedIn(req, res, function() {
      return User.findOne({
        _id: req.params.id
      }).lean().exec(function(err, doc) {
        if (req.session.email === doc.email) {
          return next();
        } else {
          return res.send(403);
        }
      });
    });
  };

  logEvent = function(req, res, next) {
    if ((res.locals.status_code >= 200 && res.locals.status_code < 300) || req.method === 'DELETE') {
      return Logger.log(req, res, next, io);
    } else {
      return next();
    }
  };

  Project.before('post', isLoggedIn);

  Project.before('put', authProject);

  Theme.before('post', isLoggedIn);

  Theme.before('put', authTheme);

  Product.before('post', isLoggedIn);

  Product.before('put', authProduct);

  User.before('put', authUser);

  Theme.before('delete', function(req, res, next) {
    return authTheme(req, res, function() {
      return logEvent(req, res, next);
    });
  });

  Product.before('delete', function(req, res, next) {
    return authProduct(req, res, function() {
      return logEvent(req, res, next);
    });
  });

  Project.before('delete', function(req, res, next) {
    return authProject(req, res, function() {
      return logEvent(req, res, next);
    });
  });

  Project.after('post', logEvent);

  Theme.after('put', logEvent);

  Theme.after('post', logEvent);

  Product.after('put', logEvent);

  Product.after('post', logEvent);

  Project.before('get', function(req, res, next) {
    var id;
    id = req.route.params.id;
    if (id) {
      return Project.findOne({
        _id: id
      }).populate('themes').populate('products').populate('owner').populate('status.related').exec(function(err, doc) {
        if (doc) {
          return res.send(doc);
        } else {
          return res.send(404);
        }
      });
    } else {
      return Project.find().populate('themes').populate('products').populate('owner').populate('status.related').exec(function(err, docs) {
        return res.send(docs);
      });
    }
  });

  Project.after('put', function(req, res, next) {
    return Project.findOne({
      _id: res.locals.bundle._id
    }).populate('themes').populate('products').populate('owner').populate('status.related').exec(function(err, doc) {
      logEvent(req, res, next);
      return res.send(doc);
    });
  });

  Theme.before('get', function(req, res, next) {
    if (req.params.id) {
      return Theme.findOne({
        _id: req.params.id
      }).populate('owner').exec(function(err, doc) {
        if (doc) {
          return Project.find({
            themes: doc._id
          }).populate('themes').populate('products').populate('owner').exec(function(err, docs) {
            return res.send({
              theme: doc,
              projects: docs
            });
          });
        } else {
          return res.send(404);
        }
      });
    } else {
      return Theme.find().populate('owner').exec(function(err, docs) {
        return res.send(docs);
      });
    }
  });

  Product.before('get', function(req, res, next) {
    if (req.params.id) {
      return Product.findOne({
        _id: req.params.id
      }).populate('owner').exec(function(err, doc) {
        if (doc) {
          return Project.find({
            products: doc._id
          }).populate('themes').populate('products').populate('owner').exec(function(err, docs) {
            return res.send({
              product: doc,
              projects: docs
            });
          });
        } else {
          return res.send(404);
        }
      });
    } else {
      return Product.find().populate('owner').exec(function(err, docs) {
        return res.send(docs);
      });
    }
  });

  Project.route("events.get", {
    detail: true,
    handler: function(req, res, next) {
      return Events.find({
        mid: req.params.id
      }).sort('-date').exec(function(err, docs) {
        return res.send(docs);
      });
    }
  });

  Project.route("phases.get", {
    detail: true,
    handler: function(req, res, next) {
      return Events.find({
        changes: 'phases'
      }).exec(function(err, docs) {
        return res.send(docs);
      });
    }
  });

  Project.route("activity.get", {
    detail: true,
    handler: function(req, res, next) {
      var ago, arr, i, now, _i;
      now = moment().toDate();
      ago = moment().subtract('days', 7).toDate();
      arr = [];
      for (i = _i = 0; _i < 7; i = ++_i) {
        arr[i] = {
          date: moment().subtract('days', i).format("MM-DD-YYYY")
        };
      }
      return Events.find({
        mid: req.params.id,
        date: {
          "$gt": ago,
          "$lte": now
        }
      }).sort('-date').lean().exec(function(err, docs) {
        var d, _j, _len;
        docs = _.countBy(docs, function(e) {
          return moment(e.date).format("MM-DD-YYYY");
        });
        for (_j = 0, _len = arr.length; _j < _len; _j++) {
          d = arr[_j];
          d.count = docs[d.date] || 0;
        }
        return res.send(arr);
      });
    }
  });

  Project.route("total.get", function(req, res) {
    return Project.find({}, function(err, docs) {
      return res.send({
        total: docs.length
      });
    });
  });

  Project.register(app, "/api/projects");

  Theme.register(app, "/api/themes");

  Product.register(app, "/api/products");

  User.register(app, "/api/users");

  app.get("/api/events/:num?", function(req, res) {
    var num;
    num = req.params.num || 1000;
    return Events.find().sort('-date').limit(num).populate('owner').exec(function(err, docs) {
      return res.send(docs);
    });
  });

  app.get("/api/events/:num/counts", function(req, res) {
    var num;
    num = req.params.num;
    return Events.find().sort('-date').limit(num).lean().exec(function(err, docs) {
      docs = _.countBy(docs, function(e) {
        return moment(e.date).format("MM-DD-YYYY");
      });
      return res.send(docs);
    });
  });

  app.get("/api/:email/projects", function(req, res) {
    return User.findOne({
      email: req.params.email
    }).exec(function(err, doc) {
      return Project.find({
        "owner": doc._id
      }).populate('owner').populate('themes').populate('products').exec(function(err, projects) {
        return res.send(projects);
      });
    });
  });

  app.get("/api/:email/collaborations", function(req, res) {
    return Project.where("collaborators.email", req.params.email).populate('themes').populate('products').populate('owner').exec(function(err, collaborations) {
      return res.send(collaborations);
    });
  });

  app.get("/api/:email/themes", function(req, res) {
    return User.findOne({
      email: req.params.email
    }).exec(function(err, doc) {
      return Theme.find({
        "owner": doc._id
      }).populate('owner').exec(function(err, docs) {
        return res.send(docs);
      });
    });
  });

  app.get("/api/:email/products", function(req, res) {
    return User.findOne({
      email: req.params.email
    }).exec(function(err, doc) {
      return Product.find({
        "owner": doc._id
      }).populate('owner').exec(function(err, docs) {
        return res.send(docs);
      });
    });
  });

  app.get("/api/phase/:id", function(req, res) {
    return Project.find({
      phase: req.params.id
    }).populate('owner').exec(function(err, docs) {
      return res.send(docs);
    });
  });

  app.get("/api/phases", function(req, res) {
    var phase, queries, _fn, _i, _len;
    queries = [];
    _fn = function(phase) {
      return queries.push(function(next) {
        return Project.count({
          phase: phase.phase
        }, function(err, count) {
          Phases[phase.phase].count = count;
          return next();
        });
      });
    };
    for (_i = 0, _len = Phases.length; _i < _len; _i++) {
      phase = Phases[_i];
      _fn(phase);
    }
    return async.parallel(queries, function() {
      return res.send(Phases);
    });
  });

  app.get("/api/statuses", function(req, res) {
    return res.send(Statuses);
  });

  indexRoute = function(req, res) {
    var bootstrap, queries;
    queries = [];
    bootstrap = {};
    bootstrap.phases = Phases;
    queries.push(function(next) {
      return Project.find().populate('themes').populate('products').populate('owner').populate('status.related').exec(function(err, docs) {
        bootstrap.projects = docs;
        return next();
      });
    });
    queries.push(function(next) {
      return Product.find().populate('owner').exec(function(err, docs) {
        bootstrap.products = docs;
        return next();
      });
    });
    queries.push(function(next) {
      return Theme.find().populate('owner').exec(function(err, docs) {
        bootstrap.themes = docs;
        return next();
      });
    });
    queries.push(function(next) {
      return Events.find().sort('-date').limit(1000).populate('owner').exec(function(err, docs) {
        bootstrap.events = docs;
        return next();
      });
    });
    return async.parallel(queries, function() {
      return res.render('dist/base.html', {
        bootstrap: bootstrap
      });
    });
  };

  projectRoute = function(req, res) {
    var bootstrap, queries;
    queries = [];
    bootstrap = {};
    bootstrap.phases = Phases;
    queries.push(function(next) {
      return Product.find().populate('owner').exec(function(err, docs) {
        bootstrap.products = docs;
        return next();
      });
    });
    queries.push(function(next) {
      return Theme.find().populate('owner').exec(function(err, docs) {
        bootstrap.themes = docs;
        return next();
      });
    });
    queries.push(function(next) {
      return Project.findOne({
        _id: req.route.params.projectId
      }).populate('themes').populate('products').populate('owner').populate('status.related').exec(function(err, doc) {
        bootstrap.project = doc;
        return next();
      });
    });
    return async.parallel(queries, function() {
      return res.render('dist/base.html', {
        bootstrap: bootstrap
      });
    });
  };

  app.get("/", indexRoute);

  app.get("/profile", indexRoute);

  app.get("/projects", indexRoute);

  app.get("/projects/new", indexRoute);

  app.get("/:email/projects", indexRoute);

  app.get("/:email/themes", indexRoute);

  app.get("/project/:projectId", projectRoute);

  app.get("/project/:projectId/edit", projectRoute);

  app.get("/project/:projectId/:phaseId", projectRoute);

  app.get("/phase/:phaseId", indexRoute);

  app.get("/themes", indexRoute);

  app.get("/themes/new", indexRoute);

  app.get("/theme/:themeId", indexRoute);

  app.get("/products", indexRoute);

  app.get("/products/new", indexRoute);

  app.get("/product/:productId", indexRoute);

  app.get("/about", indexRoute);

  app.get("/401", indexRoute);

  app.get("/admin/dump", AdminRoutes.dump);

  app.post("/admin/load", function(req, res) {
    return isLoggedIn(req, res, function() {
      if (getAuthLevel(req.session.email) > 2) {
        return AdminRoutes.load(req, res);
      } else {
        return res.send(403);
      }
    });
  });

  adminWhitelist = ['dhenein', 'bwinton', 'lco', 'madhava'];

  if (process.env.ADMIN_WHITELIST) {
    adminWhitelist = process.env.ADMIN_WHITELIST.split(' ');
  }

  getAuthLevel = function(email) {
    var domain, username, _ref;
    if (email) {
      _ref = email.split('@'), username = _ref[0], domain = _ref[1];
      if (domain = 'mozilla.org' || 'mozilla.com' || 'mozillafoundation.org') {
        if (_.contains(adminWhitelist, username)) {
          return 3;
        } else {
          return 2;
        }
      }
    }
    return 0;
  };

  app.get("/getUser", function(req, res) {
    if (req.session.email) {
      return User.findOne({
        email: req.session.email
      }).lean().exec(function(err, doc) {
        if (doc) {
          doc.authLevel = getAuthLevel(doc.email);
          return res.send(doc);
        } else {
          return User.create({
            email: req.session.email
          }, function(err, user) {
            user.authLevel = getAuthLevel(user.email);
            return res.send(user);
          });
        }
      });
    } else {
      return res.send(200);
    }
  });

  app.get('/api', function(req, res) {
    var routes;
    routes = [];
    routes.push(app.routes.get);
    routes.push(app.routes.post);
    routes.push(app.routes.put);
    routes.push(app.routes["delete"]);
    routes = _.sortBy(_.flatten(routes), function(route) {
      return route.path;
    });
    return res.render('dist/api.html', {
      routes: routes
    });
  });

  console.log("Listening at " + HOST + ":" + PORT + "...");

  server.listen(PORT, HOST);

}).call(this);
