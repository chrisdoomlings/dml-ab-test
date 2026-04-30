(function () {
  var cfg = window.DML_AB_TEST;
  if (!cfg || !cfg.appBaseUrl || !cfg.shopDomain) return;

  var VISITOR_KEY = "dml_ab_vid";
  var ASSIGNMENTS_KEY = "dml_ab_assignments";
  var visitorId = getOrCreateVisitorId();

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

  function getAssignments() {
    try {
      return JSON.parse(localStorage.getItem(ASSIGNMENTS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveAssignments(map) {
    try {
      localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(map));
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

  function applyExperiment(exp) {
    var selectorA = exp.variants.A;
    var selectorB = exp.variants.B;
    var nodeA = document.querySelector(selectorA);
    var nodeB = document.querySelector(selectorB);
    if (!nodeA || !nodeB) return;

    var showA = exp.variant === "A";
    nodeA.style.display = showA ? "" : "none";
    nodeB.style.display = showA ? "none" : "";

    track({
      experimentId: exp.id,
      visitorId: visitorId,
      variantKey: exp.variant,
      eventType: "IMPRESSION",
      pagePath: location.pathname,
    });

    var activeNode = showA ? nodeA : nodeB;
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

  fetch(
    cfg.appBaseUrl +
      "/api/experiments/active?shop=" +
      encodeURIComponent(cfg.shopDomain) +
      "&path=" +
      encodeURIComponent(location.pathname) +
      "&template=" +
      encodeURIComponent(cfg.template || "") +
      "&visitorId=" +
      encodeURIComponent(visitorId),
  )
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      var assignments = getAssignments();
      (data.experiments || []).forEach(function (exp) {
        assignments[exp.id] = exp.variant;
        applyExperiment(exp);
      });
      saveAssignments(assignments);
      setCartAttributes(assignments);
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
