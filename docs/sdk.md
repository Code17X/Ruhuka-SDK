# Adaptive Platform — JavaScript SDK Specification

**Version:** 0.1.0

## 1. Purpose

The SDK is the deployment mechanism that allows an organization to add Adaptive Platform capabilities to an existing website.

Example:

```html
<script src="https://cdn.example.com/sdk.js" data-site-id="..."></script>
```

The exact production bootstrap mechanism is not finalized.

---

## 2. SDK Responsibilities

The SDK may:

- initialize;
- inspect the host page;
- collect allowed website intelligence;
- detect page changes;
- render platform UI;
- adapt styling;
- observe layout;
- perform client telemetry;
- communicate with platform APIs.

---

## 3. SDK Must NOT

The SDK must not:

- contain database credentials;
- contain privileged API secrets;
- decide authorization;
- expose protected data without backend authorization;
- assume host-page DOM selectors never change;
- break the host website when its own services fail.

---

## 4. Initialization

Conceptual:

```javascript
AdaptivePlatform.init({
  siteId: "...",
  environment: "production"
});
```

The public SDK API must remain minimal.

---

## 5. Website Scan

Initial scan should collect only necessary information.

Suggested semantic output:

```json
{
  "page": {
    "url": "...",
    "title": "...",
    "type": "dashboard"
  },
  "navigation": [],
  "regions": [],
  "interactiveElements": [],
  "theme": {
    "mode": "light",
    "primaryColor": "...",
    "fontFamily": "..."
  },
  "viewport": {
    "width": 1440,
    "height": 900
  }
}
```

---

## 6. Semantic Anchors

Example:

```json
{
  "type": "navigation",
  "description": "Primary top navigation",
  "confidence": 0.94,
  "location": {
    "strategy": "semantic",
    "hint": "header-navigation"
  }
}
```

Selectors may be stored as hints, but semantic identity should be preferred.

---

## 7. Rendering

Injected components must:

- isolate styles;
- avoid global CSS collisions;
- use namespaced classes/custom elements where appropriate;
- respect host-page responsive behavior;
- support keyboard accessibility;
- degrade gracefully.

---

## 8. Theme Adaptation

The system may infer:

- primary color;
- secondary color;
- background;
- text color;
- border radius;
- spacing;
- typography;
- dark/light mode.

Theme inference should have safe defaults.

---

## 9. Self-Healing

When an anchor becomes invalid:

```text
Mutation/health signal
 ↓
Anchor verification
 ↓
Semantic rediscovery
 ↓
Candidate ranking
 ↓
Visual/layout validation
 ↓
Reposition
 ↓
Record result
```

Do not repeatedly retry indefinitely.

Use bounded retries and fallback behavior.

---

## 10. Performance

The SDK must avoid blocking initial host-page rendering.

Prefer:

- asynchronous loading;
- lazy analysis;
- cached results;
- debounced mutation handling;
- compact telemetry.

Heavy AI processing should occur remotely unless a lightweight local algorithm is sufficient.

---

## 11. Failure Behavior

If platform services fail:

- host website remains usable;
- injected UI may disappear or enter a safe fallback state;
- errors are logged/telemetried without exposing secrets.

---

## 12. Security

The SDK is untrusted.

Any identity or permission claim from the browser must be verified server-side.

Never embed:

- database passwords;
- provider secret keys;
- privileged service credentials.
