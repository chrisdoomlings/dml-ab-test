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
  var FETCH_TIMEOUT_MS = 6000;
  var liveExperimentsState = [];
  var pageStartTime = Date.now();
  var maxScrollDepth = 0;

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
    try { return localStorage.getItem(RETURNING_KEY) === "1"; } catch (e) { return false; }
  }

  function markVisitorSeen() {
    try { localStorage.setItem(RETURNING_KEY, "1"); } catch (e) {}
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

  function clearCookie(name) {
    try {
      document.cookie = name + "=; path=/; max-age=0; SameSite=Lax";
    } catch (e) {}
  }

  // ─── Assignment storage ───────────────────────────────────────────────────

  function parseAssignments(text) {
    try {
      var parsed = JSON.parse(text || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) { return {}; }
  }

  function getAssignments() {
    var fromStorage = parseAssignments(localStorage.getItem(ASSIGNMENTS_KEY) || "{}");
    var fromCookie = parseAssignments(decodeURIComponent(readCookie(ASSIGNMENT_COOKIE) || ""));
    return Object.assign({}, fromCookie, fromStorage);
  }

  function saveAssignments(map) {
    try { localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(map)); } catch (e) {}
    writeCookie(ASSIGNMENT_COOKIE, encodeURIComponent(JSON.stringify(map)), 60 * 60 * 24 * 30);
  }

  function clearAllAssignments() {
    try {
      localStorage.removeItem(ASSIGNMENTS_KEY);
      localStorage.removeItem(EXPERIMENTS_KEY);
      localStorage.removeItem(VISITOR_KEY);
      localStorage.removeItem(RETURNING_KEY);
    } catch (e) {}
    clearCookie(ASSIGNMENT_COOKIE);
  }

  // ─── Experiment cache ─────────────────────────────────────────────────────

  function getCachedExperiments() {
    try {
      var cached = JSON.parse(localStorage.getItem(EXPERIMENTS_KEY) || "[]");
      if (Array.isArray(cached)) return { pagePath: location.pathname, experiments: cached };
      if (!cached || typeof cached !== "object") return { pagePath: "", experiments: [] };
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
        JSON.stringify({ pagePath: location.pathname, savedAt: Date.now(), experiments: experiments || [] }),
      );
    } catch (e) {}
  }

  // ─── Anti-flicker CSS management ─────────────────────────────────────────
  //
  // The liquid block injects a <style id="dml-ab-af"> that hides the losing
  // selector using !important. This must be removed after the JS applies
  // inline display values — otherwise the !important rule fights inline styles
  // and can prevent a variant from being revealed (e.g. after a TTL re-roll).

  function removeAntiFlickerStyle() {
    var el = document.getElementById("dml-ab-af");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ─── Preview mode ─────────────────────────────────────────────────────────

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
    } catch (e) { return null; }
  }

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

      // Reset button — clears stored assignment so next normal visit gets a
      // fresh random roll, useful for testing both sides of the split.
      var resetBtn = document.createElement("button");
      resetBtn.textContent = "↺ Reset visitor";
      resetBtn.title = "Clears stored assignment so the next page load gets a fresh random variant";
      resetBtn.style.cssText = [
        "padding:4px 10px", "border-radius:4px", "border:none", "cursor:pointer",
        "background:#27272a", "color:#a1a1aa",
        "font-size:12px", "font-weight:600", "white-space:nowrap", "font-family:inherit",
      ].join(";");
      resetBtn.addEventListener("click", function () {
        clearAllAssignments();
        var url = new URL(window.location.href);
        url.searchParams.delete(PREVIEW_PARAM);
        window.location.href = url.toString();
      });
      bar.appendChild(resetBtn);

      var exitUrl = new URL(window.location.href);
      exitUrl.searchParams.delete(PREVIEW_PARAM);
      var exitBtn = document.createElement("a");
      exitBtn.href = exitUrl.toString();
      exitBtn.textContent = "✕ Exit";
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

function track(payload) {
    payload.shopDomain = cfg.shopDomain;
    console.log("[DML AB]", payload.eventType, payload);
    return fetch(cfg.appBaseUrl + "/api/events/track", {
      method: "POST",
      keepalive: true,
      body: JSON.stringify(payload),
    }).then(function (r) {
      r.clone().json().then(function (body) {
        console.log("[DML AB]", payload.eventType, "response:", r.status, body);
      }).catch(function () {
        console.log("[DML AB]", payload.eventType, "response:", r.status, "(no body)");
      });
      return r;
    }).catch(function (e) {
      console.warn("[DML AB] track error:", e);
    });
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

  function getEngagementMeta() {
    return {
      timeOnPageSec: Math.round((Date.now() - pageStartTime) / 1000),
      scrollDepthPct: maxScrollDepth,
    };
  }

  function fireCheckoutStarted() {
    if (previewOverrides) return;
    var assignments = getAssignments();
    console.log("[DML AB] fireCheckoutStarted — assignments:", assignments);
    Object.keys(assignments).forEach(function (experimentId) {
      track({
        experimentId: experimentId,
        visitorId: visitorId,
        variantKey: assignments[experimentId],
        eventType: "CHECKOUT_STARTED",
        pagePath: location.pathname,
        metadata: getEngagementMeta(),
      });
    });
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
        metadata: getEngagementMeta(),
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
    nodeA.style.display = showA ? "block" : "none";
    nodeB.style.display = showA ? "none" : "block";

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

  // ─── Debug panel ─────────────────────────────────────────────────────────

  var DEBUG_PARAM = "dml_ab_debug";

  function isDebugMode() {
    try { return new URLSearchParams(window.location.search).get(DEBUG_PARAM) === "1"; } catch (e) { return false; }
  }

  function showDebugPanel(status, experiments, apiUrl) {
    try {
      if (document.getElementById("dml-ab-debug-panel")) return;

      var hasImgA = !!document.querySelector("#dml-img-a");
      var hasImgB = !!document.querySelector("#dml-img-b");
      var assignments = getAssignments();

      var rows = [
        ["Script loaded", "✅ Yes"],
        ["Shop domain", cfg.shopDomain],
        ["Page path", location.pathname],
        ["Template", cfg.template || "(none)"],
        ["Visitor ID", visitorId.slice(0, 16) + "…"],
        ["Returning visitor", isReturningVisitor ? "Yes" : "No (new visitor)"],
        ["API status", status],
        ["Experiments returned", experiments.length === 0 ? "❌ None — click API link below to see raw response" : "✅ " + experiments.length],
        ["#dml-img-a on page", hasImgA ? "✅ Found" : "❌ Not found — enable A/B test on image card block"],
        ["#dml-img-b on page", hasImgB ? "✅ Found" : "❌ Not found — upload Variant B image & enable A/B test"],
        ["Current assignment", Object.keys(assignments).length ? JSON.stringify(assignments) : "None yet"],
      ];

      if (experiments.length > 0) {
        experiments.forEach(function (exp) {
          rows.push(["Experiment: " + exp.name, "Assigned variant: " + exp.variant]);
        });
      }

      var panel = document.createElement("div");
      panel.id = "dml-ab-debug-panel";
      panel.style.cssText = [
        "position:fixed", "top:12px", "right:12px", "z-index:2147483647",
        "background:#18181b", "color:#e4e4e7", "border-radius:10px",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace",
        "font-size:12px", "line-height:1.5", "padding:14px 16px",
        "box-shadow:0 4px 24px rgba(0,0,0,.6)", "max-width:380px", "width:calc(100vw - 32px)",
      ].join(";");

      var title = document.createElement("div");
      title.style.cssText = "font-weight:700;font-size:13px;color:#fbbf24;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;";
      title.innerHTML = "<span>🔬 DML AB Test — Debug</span>";

      var closeBtn = document.createElement("button");
      closeBtn.textContent = "✕";
      closeBtn.style.cssText = "background:none;border:none;color:#71717a;cursor:pointer;font-size:14px;padding:0;margin-left:8px;";
      closeBtn.onclick = function () { panel.parentNode && panel.parentNode.removeChild(panel); };
      title.appendChild(closeBtn);
      panel.appendChild(title);

      var table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;";
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var td1 = document.createElement("td");
        var td2 = document.createElement("td");
        td1.style.cssText = "color:#a1a1aa;padding:2px 8px 2px 0;vertical-align:top;white-space:nowrap;";
        td2.style.cssText = "color:#e4e4e7;padding:2px 0;word-break:break-all;";
        td1.textContent = row[0];
        td2.textContent = row[1];
        tr.appendChild(td1);
        tr.appendChild(td2);
        table.appendChild(tr);
      });
      panel.appendChild(table);

      var resetDebugBtn = document.createElement("button");
      resetDebugBtn.textContent = "↺ Reset visitor (test as new)";
      resetDebugBtn.style.cssText = [
        "margin-top:8px", "padding:4px 10px", "border-radius:4px", "border:none", "cursor:pointer",
        "background:#27272a", "color:#a1a1aa", "font-size:11px", "font-weight:600",
        "white-space:nowrap", "font-family:inherit", "display:block",
      ].join(";");
      resetDebugBtn.addEventListener("click", function () {
        clearAllAssignments();
        window.location.reload();
      });
      panel.appendChild(resetDebugBtn);

      var apiRow = document.createElement("div");
      apiRow.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px solid #27272a;font-size:10px;word-break:break-all;";
      var apiLabel = document.createElement("span");
      apiLabel.style.cssText = "color:#52525b;";
      apiLabel.textContent = "API: ";
      var apiLink = document.createElement("a");
      apiLink.href = apiUrl;
      apiLink.target = "_blank";
      apiLink.rel = "noopener";
      apiLink.style.cssText = "color:#3b82f6;text-decoration:underline;";
      apiLink.textContent = apiUrl;
      apiRow.appendChild(apiLabel);
      apiRow.appendChild(apiLink);
      panel.appendChild(apiRow);

      document.body.appendChild(panel);
    } catch (e) {}
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  var visitorId = getOrCreateVisitorId();
  var sessionId = getOrCreateSessionId();
  var isReturningVisitor = readReturningFlag();
  var previewOverrides = getPreviewOverrides();

  // Apply cached assignments immediately (before the API fetch) so returning
  // visitors see the correct variant with no delay. The anti-flicker <style>
  // in the liquid block already handles the first paint; this reinforces it
  // with inline styles which survive theme reflows.
  var cached = getCachedExperiments();
  if (cached.pagePath === location.pathname) {
    cached.experiments.forEach(function (exp) {
      var forApply = previewOverrides && previewOverrides[exp.id]
        ? Object.assign({}, exp, { variant: previewOverrides[exp.id] })
        : exp;
      applyExperiment(forApply, { skipImpression: true });
    });
  }

  // Build a fetch with a hard timeout. If the app server is slow (e.g. cold
  // start), we abort after FETCH_TIMEOUT_MS and remove the anti-flicker CSS so
  // the page is usable. On returning visits the cached pre-apply above already
  // shows the right variant; on first visits we fall back to showing both
  // (fail-open = original content stays visible).
  var controller = typeof AbortController !== "undefined" ? new AbortController() : null;

  var fetchTimeoutId = setTimeout(function () {
    if (controller) controller.abort();
    // Anti-flicker CSS must be removed whether we timed out or not — if it
    // stays, its !important rule blocks inline styles from showing the variant.
    removeAntiFlickerStyle();
  }, FETCH_TIMEOUT_MS);

  var activeApiUrl = cfg.appBaseUrl +
    "/api/experiments/active?shop=" + encodeURIComponent(cfg.shopDomain) +
    "&path=" + encodeURIComponent(location.pathname) +
    "&template=" + encodeURIComponent(cfg.template || "") +
    "&visitorId=" + encodeURIComponent(visitorId) +
    "&sessionId=" + encodeURIComponent(sessionId) +
    "&isReturning=" + (isReturningVisitor ? "1" : "0");

  fetch(activeApiUrl, {
    credentials: "omit",
    cache: "no-store",
    signal: controller ? controller.signal : undefined,
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      clearTimeout(fetchTimeoutId);
      // Must remove anti-flicker CSS before applying new inline styles.
      // If the variant changed since the last visit (e.g. TTL re-roll), the
      // old !important rule would block the new variant from being shown.
      removeAntiFlickerStyle();

      var experiments = data.experiments || [];

      if (isDebugMode()) showDebugPanel("✅ " + experiments.length + " experiment(s)", experiments, activeApiUrl);

      if (previewOverrides) {
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

      var assignments = getAssignments();
      liveExperimentsState = experiments;
      experiments.forEach(function (exp) {
        var assigned = applyExperiment(exp) || exp.variant;
        assignments[exp.id] = assigned;
      });
      saveCachedExperiments(experiments);
      saveAssignments(assignments);
      setCartAttributes(assignments);
      markVisitorSeen();
    })
    .catch(function () {
      clearTimeout(fetchTimeoutId);
      removeAntiFlickerStyle();
      if (isDebugMode()) showDebugPanel("❌ API error / timeout", [], activeApiUrl);
      // Fail-open: original content (variant A / theme default) remains visible.
    });

  setInterval(runVerificationTicks, 1000);

  window.addEventListener("scroll", function () {
    var el = document.documentElement;
    var scrolled = el.scrollTop || document.body.scrollTop || 0;
    var total = el.scrollHeight - el.clientHeight;
    if (total > 0) {
      var pct = Math.min(100, Math.round((scrolled / total) * 100));
      if (pct > maxScrollDepth) maxScrollDepth = pct;
    }
  }, { passive: true });

  // Detect clicks on checkout links (mini-cart, header cart button, etc.)
  function isCheckoutUrl(url) {
    return url === "/checkout" || url.indexOf("/checkout") === 0 || url.indexOf("/checkouts/") !== -1;
  }

  document.addEventListener("click", function (event) {
    if (previewOverrides) return;
    var el = event.target;
    while (el && el.tagName) {
      var tag = el.tagName;
      // <a href="/checkout"> or <a href="/checkouts/...">
      if (tag === "A") {
        var href = el.getAttribute("href") || "";
        if (isCheckoutUrl(href)) { fireCheckoutStarted(); return; }
      }
      if (tag === "BUTTON" || tag === "INPUT" || tag === "A") {
        var name = el.getAttribute("name") || "";
        var cls  = (typeof el.className === "string" ? el.className : "").toLowerCase();
        var txt  = ((el.textContent || el.value || "").trim()).toLowerCase();
        var tid  = (el.getAttribute("data-testid") || "").toLowerCase();
        // Standard Shopify, Rebuy, and other third-party checkout buttons
        if (
          name === "checkout" ||
          tid.indexOf("checkout") !== -1 ||
          cls.indexOf("checkout") !== -1 ||
          txt === "checkout" ||
          txt === "proceed to checkout" ||
          txt === "check out"
        ) {
          console.log("[DML AB] checkout button clicked:", txt || cls);
          fireCheckoutStarted(); return;
        }
      }
      el = el.parentElement;
    }
  }, true);

  // Intercept location.assign — used by Rebuy and some themes to navigate to checkout
  try {
    var _locAssign = window.location.assign.bind(window.location);
    window.location.assign = function (url) {
      if (isCheckoutUrl(String(url || ""))) {
        console.log("[DML AB] location.assign to checkout:", url);
        fireCheckoutStarted();
      }
      return _locAssign(url);
    };
  } catch (e) {}

  document.addEventListener("submit", function (event) {
    if (previewOverrides) return;
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var action = form.getAttribute("action") || "";
    var submitter = event.submitter;
    var submitterName =
      submitter && typeof submitter.getAttribute === "function"
        ? submitter.getAttribute("name")
        : "";

    // Standard non-AJAX add-to-cart form submit.
    if (action.indexOf("/cart/add") !== -1) {
      console.log("[DML AB] cart add form submitted:", action);
      fireAddToCart();
    }

    // Cart form checkout submit (`/cart` action + submitter name "checkout").
    if (action.indexOf("/cart") !== -1 && submitterName === "checkout") {
      console.log("[DML AB] cart checkout submitted via /cart form");
      fireCheckoutStarted();
      return;
    }

    if (isCheckoutUrl(action)) {
      console.log("[DML AB] checkout form submitted:", action);
      fireCheckoutStarted();
    }
  });

  // Intercept ALL /cart/add requests — catches standard forms, Rebuy, AJAX, and any app
  function fireAddToCart() {
    if (previewOverrides) return;
    var assignments = getAssignments();
    if (!Object.keys(assignments).length) return;
    setCartAttributes(assignments);
    Object.keys(assignments).forEach(function (experimentId) {
      track({
        experimentId: experimentId,
        visitorId: visitorId,
        variantKey: assignments[experimentId],
        eventType: "ADD_TO_CART",
        pagePath: location.pathname,
        metadata: getEngagementMeta(),
      });
    });
  }

  // Capture-phase click on Add to Cart button — fires before theme JS, catches
  // AJAX themes that store a window.fetch reference before ab-test.js loads.
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el.tagName) {
      var tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT') {
        var n = el.getAttribute('name');
        if (n === 'add' || el.hasAttribute('data-add-to-cart')) {
          console.log('[DML AB] Add to Cart button clicked');
          fireAddToCart();
          return;
        }
      }
      el = el.parentElement;
    }
  }, true);

  // Intercept fetch
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/cart/add") !== -1) {
      console.log("[DML AB] fetch /cart/add intercepted:", url);
      return _fetch.apply(this, arguments).then(function (response) {
        console.log("[DML AB] /cart/add response:", response.status);
        if (response.ok) fireAddToCart();
        return response;
      });
    }
    return _fetch.apply(this, arguments);
  };

  // Intercept XMLHttpRequest (older themes / some apps)
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === "string" && url.indexOf("/cart/add") !== -1) {
      console.log("[DML AB] XHR /cart/add intercepted:", url);
      this.addEventListener("load", function () {
        console.log("[DML AB] XHR /cart/add status:", this.status);
        if (this.status >= 200 && this.status < 300) fireAddToCart();
      });
    }
    return _open.apply(this, arguments);
  };
})();
