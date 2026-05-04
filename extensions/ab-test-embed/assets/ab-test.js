(function () {
  var cfg = window.DML_AB_TEST;
  if (!cfg || !cfg.appBaseUrl || !cfg.shopDomain) return;

  var VISITOR_KEY = "dml_ab_vid";
  var SESSION_KEY = "dml_ab_sid";
  var RETURNING_KEY = "dml_ab_seen";
  var ASSIGNMENTS_KEY = "dml_ab_assignments";
  var EXPERIMENTS_KEY = "dml_ab_experiments";
  var ASSIGNMENT_COOKIE = "dml_ab_assignments";
  var PREVIEW_PARAM = "dml_ab_preview";
  var liveExperimentsState = [];

  // ─── Visitor / session identity ──────────────────────────────────────────

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
    } catch (e) {}
  }

  // ─── Cookie helpers ───────────────────────────────────────────────────────

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
        name + "=" + value + "; path=/; max-age=" + String(maxAgeSeconds) + "; SameSite=Lax";
    } catch (e) {}
  }

  // ─── Assignment storage ───────────────────────────────────────────────────

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
    } catch (e) {}
    writeCookie(ASSIGNMENT_COOKIE, encodeURIComponent(JSON.stringify(map)), 60 * 60 * 24 * 30);
  }

  // ─── Experiment cache ─────────────────────────────────────────────────────

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
    } catch (e) {}
  }

  // ─── Preview mode ─────────────────────────────────────────────────────────

  // Parses ?dml_ab_preview=expId:A,expId2:B from the URL.
  // Returns a map of { experimentId -> "A"|"B" } or null if not in preview mode.
  function getPreviewOverrides() {
    try {
      var params = new URLSearchParams(window.location.search);
      var raw = params.get(PREVIEW_PARAM);
      if (!raw) return null;
      var overrides = {};
      raw.split(",").forEach(function (part) {
        var sep = part.lastIndexOf(":");
        if (sep < 1) return;
        var id = part.slice(0, sep).trim();
        var v = part.slice(sep + 1).trim().toUpperCase();
        if (id && (v === "A" || v === "B")) overrides[id] = v;
      });
      return Object.keys(overrides).length ? overrides : null;
    } catch (e) {
      return null;
    }
  }

  // Renders a fixed toolbar at the bottom of the page showing the active preview
  // state. Does not fire analytics events, does not persist assignments.
  function showPreviewBanner(experiments, overrides) {
    try {
      if (document.getElementById("dml-ab-preview-bar")) return;

      var bar = document.createElement("div");
      bar.id = "dml-ab-preview-bar";
      bar.style.cssText = [
        "position:fixed", "bottom:0", "left:0", "right:0",
        "z-index:2147483647",
        "background:#18181b", "color:#fff",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "font-size:13px", "line-height:1",
        "padding:10px 16px",
        "display:flex", "align-items:center", "gap:10px", "flex-wrap:wrap",
        "box-shadow:0 -2px 16px rgba(0,0,0,.5)",
      ].join(";");

      var label = document.createElement("span");
      label.style.cssText = "font-weight:700;color:#fbbf24;white-space:nowrap";
      label.textContent = "🧪 Preview Mode";
      bar.appendChild(label);

      var divider = document.createElement("span");
      divider.style.cssText = "color:#52525b";
      divider.textContent = "|";
      bar.appendChild(divider);

      var hasExperiment = false;
      experiments.forEach(function (exp) {
        var currentVariant = overrides[exp.id];
        if (!currentVariant) return;
        hasExperiment = true;

        var name = document.createElement("span");
        name.style.cssText = "color:#a1a1aa;white-space:nowrap";
        name.textContent = exp.name + ":";
        bar.appendChild(name);

        ["A", "B"].forEach(function (v) {
          var url = new URL(window.location.href);
          var updated = Object.assign({}, overrides);
          updated[exp.id] = v;
          url.searchParams.set(
            PREVIEW_PARAM,
            Object.keys(updated).map(function (k) { return k + ":" + updated[k]; }).join(","),
          );
          var btn = document.createElement("a");
          btn.href = url.toString();
          btn.textContent = v === "A" ? "Original (A)" : "Variant (B)";
          var active = currentVariant === v;
          btn.style.cssText = [
            "display:inline-block", "padding:4px 10px", "border-radius:4px",
            "text-decoration:none", "font-size:12px", "font-weight:600", "white-space:nowrap",
            active ? "background:#005bd3;color:#fff" : "background:#27272a;color:#a1a1aa",
          ].join(";");
          bar.appendChild(btn);
        });
      });

      if (!hasExperiment) {
        var noExp = document.createElement("span");
        noExp.style.cssText = "color:#71717a;font-style:italic";
        noExp.textContent = "No active experiment found on this page";
        bar.appendChild(noExp);
      }

      var spacer = document.createElement("span");
      spacer.style.cssText = "flex:1;min-width:8px";
      bar.appendChild(spacer);

      var exitUrl = new URL(window.location.href);
      exitUrl.searchParams.delete(PREVIEW_PARAM);
      var exitBtn = document.createElement("a");
      exitBtn.href = exitUrl.toString();
      exitBtn.textContent = "✕ Exit Preview";
      exitBtn.style.cssText = [
        "display:inline-block", "padding:4px 10px", "border-radius:4px",
        "background:#27272a", "color:#71717a",
        "text-decoration:none", "font-size:12px", "font-weight:600", "white-space:nowrap",
      ].join(";");
      bar.appendChild(exitBtn);

      document.body.appendChild(bar);
    } catch (e) {}
  }

  // ─── Experiment application ───────────────────────────────────────────────

  function tagClarity(experimentId, experimentName, variant) {
    if (typeof window.clarity !== "function") return;
    window.clarity("set", "ab_variant_" + experimentId, variant);
    window.clarity("set", "ab_experiment", experimentName + ":" + variant);
  }

  function track(payload) {
    payload.shopDomain = cfg.shopDomain;
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
    var marker = "dml_ab_click_" + exp.id + "_" + exp._shownVariant;
    if (activeNode.getAttribute(marker) === "1") return;
    activeNode.setAttribute(marker, "1");
    activeNode.addEventListener("click", function () {
      track({
        experimentId: exp.id,
        visitorId: visitorId,
        variantKey: exp._shownVariant,
        eventType: "CLICK",
        pagePath: location.pathname,
      });
    });
  }

  function hashString(value) {
    var hash = 0;
    for (var i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function resolveShownVariant(exp) {
    if (!exp.verificationMode) return exp.variant;
    var swapSeconds = Number(exp.verificationSwapSeconds || 5);
    var seconds = swapSeconds > 0 ? swapSeconds : 5;
    var timeSlot = Math.floor(Date.now() / (seconds * 1000));
    var offset = hashString(String(exp.id)) % 2;
    return (timeSlot + offset) % 2 === 0 ? "A" : "B";
  }

  function applyExperiment(exp, options) {
    options = options || {};
    var selectorA = exp.variants && exp.variants.A;
    var selectorB = exp.variants && exp.variants.B;
    if (!selectorA || !selectorB) return;
    var nodeA = document.querySelector(selectorA);
    var nodeB = document.querySelector(selectorB);
    if (!nodeA || !nodeB) return;

    var shownVariant = resolveShownVariant(exp);
    exp._shownVariant = shownVariant;
    var showA = shownVariant === "A";
    nodeA.style.display = showA ? "" : "none";
    nodeB.style.display = showA ? "none" : "";

    if (!options.skipImpression) {
      track({
        experimentId: exp.id,
        visitorId: visitorId,
        variantKey: shownVariant,
        eventType: "IMPRESSION",
        pagePath: location.pathname,
      });
    }

    var activeNode = showA ? nodeA : nodeB;
    bindClickTracking(activeNode, exp);
    return shownVariant;
  }

  function runVerificationTicks() {
    if (!liveExperimentsState.length) return;
    var assignments = getAssignments();
    var changed = false;
    liveExperimentsState.forEach(function (exp) {
      if (!exp.verificationMode) return;
      var shown = applyExperiment(exp, { skipImpression: true });
      if (shown && assignments[exp.id] !== shown) {
        assignments[exp.id] = shown;
        changed = true;
      }
    });
    if (changed) {
      saveAssignments(assignments);
      setCartAttributes(assignments);
    }
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  var visitorId = getOrCreateVisitorId();
  var sessionId = getOrCreateSessionId();
  var isReturningVisitor = readReturningFlag();
  var previewOverrides = getPreviewOverrides();

  // Apply cached assignments immediately to reduce flicker for returning visitors.
  // The anti-flicker CSS in the liquid block already handles this via <style> injection,
  // but this restores display values that may have been reset by theme JS.
  var cached = getCachedExperiments();
  if (cached.pagePath === location.pathname) {
    cached.experiments.forEach(function (exp) {
      var forApply = previewOverrides && previewOverrides[exp.id]
        ? Object.assign({}, exp, { variant: previewOverrides[exp.id] })
        : exp;
      applyExperiment(forApply, { skipImpression: true });
    });
  }

  fetch(
    cfg.appBaseUrl +
      "/api/experiments/active?shop=" + encodeURIComponent(cfg.shopDomain) +
      "&path=" + encodeURIComponent(location.pathname) +
      "&template=" + encodeURIComponent(cfg.template || "") +
      "&visitorId=" + encodeURIComponent(visitorId) +
      "&sessionId=" + encodeURIComponent(sessionId) +
      "&isReturning=" + (isReturningVisitor ? "1" : "0"),
    { credentials: "omit", cache: "no-store" },
  )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var experiments = data.experiments || [];

      if (previewOverrides) {
        // Preview mode: override variants, skip analytics, skip saving assignments.
        var previewExps = experiments.map(function (exp) {
          var override = previewOverrides[exp.id];
          return override ? Object.assign({}, exp, { variant: override }) : exp;
        });
        liveExperimentsState = previewExps;
        previewExps.forEach(function (exp) {
          applyExperiment(exp, { skipImpression: true });
        });
        saveCachedExperiments(previewExps);
        showPreviewBanner(previewExps, previewOverrides);
        return;
      }

      // Normal mode.
      var assignments = getAssignments();
      liveExperimentsState = experiments;
      experiments.forEach(function (exp) {
        var assigned = applyExperiment(exp) || exp.variant;
        assignments[exp.id] = assigned;
        tagClarity(exp.id, exp.name, assigned);
      });
      saveCachedExperiments(experiments);
      saveAssignments(assignments);
      setCartAttributes(assignments);
      markVisitorSeen();
    })
    .catch(function () {
      // fail-open: theme default section remains visible
    });

  setInterval(runVerificationTicks, 1000);

  document.addEventListener("submit", function (event) {
    if (previewOverrides) return;
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
