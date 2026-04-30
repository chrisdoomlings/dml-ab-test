(function () {
  var cfg = window.DML_AB_TEST;
  if (!cfg || !cfg.appBaseUrl || !cfg.shopDomain) return;

  var VISITOR_KEY = "dml_ab_vid";
  var SESSION_KEY = "dml_ab_sid";
  var RETURNING_KEY = "dml_ab_seen";
  var ASSIGNMENTS_KEY = "dml_ab_assignments";
  var EXPERIMENTS_KEY = "dml_ab_experiments";
  var visitorId = getOrCreateVisitorId();
  var sessionId = getOrCreateSessionId();
  var isReturningVisitor = readReturningFlag();
  var ASSIGNMENT_COOKIE = "dml_ab_assignments";

  function getOrCreateVisitorId() {
    try {
      var existing = localStorage.getItem(VISITOR_KEY);
      if (existing) return existing;
      var generated = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(VISITOR_KEY, generated);
      return generated;
    } catch (e) {
      return "anon_" + Date.now().toString(36);
    }
  }

  function getOrCreateSessionId() {
    try {
      var existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var generated = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, generated);
      return generated;
    } catch (e) {
      return "session_" + Date.now().toString(36);
    }
  }

  function readReturningFlag() {
    try {
      return localStorage.getItem(RETURNING_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function markVisitorSeen() {
    try {
      localStorage.setItem(RETURNING_KEY, "1");
    } catch (e) {
      // noop
    }
  }

  function readCookie(name) {
    var prefix = name + "=";
    var cookies = document.cookie ? document.cookie.split(";") : [];
    for (var i = 0; i < cookies.length; i += 1) {
      var value = cookies[i].trim();
      if (value.indexOf(prefix) === 0) return value.slice(prefix.length);
    }
    return "";
  }

  function writeCookie(name, value, maxAgeSeconds) {
    try {
      document.cookie =
        name +
        "=" +
        value +
        "; path=/; max-age=" +
        String(maxAgeSeconds) +
        "; SameSite=Lax";
    } catch (e) {
      // noop
    }
  }

  function parseAssignments(text) {
    try {
      var parsed = JSON.parse(text || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function getAssignments() {
    var fromStorage = parseAssignments(localStorage.getItem(ASSIGNMENTS_KEY) || "{}");
    var fromCookie = parseAssignments(decodeURIComponent(readCookie(ASSIGNMENT_COOKIE) || ""));
    return Object.assign({}, fromCookie, fromStorage);
  }

  function saveAssignments(map) {
    try {
      localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(map));
    } catch (e) {
      // noop
    }
    writeCookie(ASSIGNMENT_COOKIE, encodeURIComponent(JSON.stringify(map)), 60 * 60 * 24 * 30);
  }

  function getCachedExperiments() {
    try {
      var cached = JSON.parse(localStorage.getItem(EXPERIMENTS_KEY) || "[]");
      if (Array.isArray(cached)) {
        return { pagePath: location.pathname, experiments: cached };
      }
      if (!cached || typeof cached !== "object") {
        return { pagePath: "", experiments: [] };
      }
      return {
        pagePath: String(cached.pagePath || ""),
        experiments: Array.isArray(cached.experiments) ? cached.experiments : [],
      };
    } catch (e) {
      return { pagePath: "", experiments: [] };
    }
  }

  function saveCachedExperiments(experiments) {
    try {
      localStorage.setItem(
        EXPERIMENTS_KEY,
        JSON.stringify({
          pagePath: location.pathname,
          savedAt: Date.now(),
          experiments: experiments || [],
        }),
      );
    } catch (e) {
      // noop
    }
  }

  function track(payload) {
    return fetch(cfg.appBaseUrl + "/api/events/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(function () {});
  }

  function setCartAttributes(assignments) {
    var keys = Object.keys(assignments);
    if (!keys.length) return;

    fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        attributes: {
          ab_visitor_id: visitorId,
          dml_ab_assignments: JSON.stringify(assignments),
          ab_experiment_id: keys[0],
          ab_variant: assignments[keys[0]],
        },
      }),
    }).catch(function () {});
  }

  function bindClickTracking(activeNode, exp) {
    var marker = "dml_ab_click_" + exp.id;
    if (activeNode.getAttribute(marker) === "1") return;
    activeNode.setAttribute(marker, "1");
    activeNode.addEventListener("click", function () {
      track({
        experimentId: exp.id,
        visitorId: visitorId,
        variantKey: exp.variant,
        eventType: "CLICK",
        pagePath: location.pathname,
      });
    });
  }

  function applyExperiment(exp, options) {
    options = options || {};
    var selectorA = exp.variants.A;
    var selectorB = exp.variants.B;
    var nodeA = document.querySelector(selectorA);
    var nodeB = document.querySelector(selectorB);
    if (!nodeA || !nodeB) return;

    var showA = exp.variant === "A";
    nodeA.style.display = showA ? "" : "none";
    nodeB.style.display = showA ? "none" : "";

    if (!options.skipImpression) {
      track({
        experimentId: exp.id,
        visitorId: visitorId,
        variantKey: exp.variant,
        eventType: "IMPRESSION",
        pagePath: location.pathname,
      });
    }

    var activeNode = showA ? nodeA : nodeB;
    bindClickTracking(activeNode, exp);
  }

  // Apply last known assignments immediately to reduce refresh flicker.
  var cached = getCachedExperiments();
  if (cached.pagePath === location.pathname) {
    cached.experiments.forEach(function (exp) {
      applyExperiment(exp, { skipImpression: true });
    });
  }

  fetch(
    cfg.appBaseUrl +
      "/api/experiments/active?shop=" +
      encodeURIComponent(cfg.shopDomain) +
      "&path=" +
      encodeURIComponent(location.pathname) +
      "&template=" +
      encodeURIComponent(cfg.template || "") +
      "&visitorId=" +
      encodeURIComponent(visitorId) +
      "&sessionId=" +
      encodeURIComponent(sessionId) +
      "&isReturning=" +
      (isReturningVisitor ? "1" : "0"),
    {
      credentials: "omit",
      cache: "no-store",
    },
  )
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      var assignments = getAssignments();
      var liveExperiments = data.experiments || [];
      liveExperiments.forEach(function (exp) {
        assignments[exp.id] = exp.variant;
        applyExperiment(exp);
      });
      saveCachedExperiments(liveExperiments);
      saveAssignments(assignments);
      setCartAttributes(assignments);
      markVisitorSeen();
    })
    .catch(function () {
      // fail-open: theme default section remains visible
    });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var action = form.getAttribute("action") || "";
    if (action.indexOf("/cart/add") === -1) return;
    var assignments = getAssignments();
    setCartAttributes(assignments);
    Object.keys(assignments).forEach(function (experimentId) {
      track({
        experimentId: experimentId,
        visitorId: visitorId,
        variantKey: assignments[experimentId],
        eventType: "ADD_TO_CART",
        pagePath: location.pathname,
      });
    });
  });
})();
