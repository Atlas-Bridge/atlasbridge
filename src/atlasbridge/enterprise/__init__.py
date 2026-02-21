"""
AtlasBridge Enterprise — local-first governance extensions.

This module provides enterprise-grade governance capabilities that layer
on top of the core AtlasBridge runtime.  All enterprise features:

  - Are optional (core runtime works without them)
  - Are deterministic (no ML, no heuristics)
  - Run locally (no cloud dependency)
  - Are pluggable via feature flags

Edition detection:

    >>> from atlasbridge.enterprise import Edition, detect_edition
    >>> detect_edition()
    <Edition.COMMUNITY: 'community'>

Maturity: Experimental (Phase A — local governance scaffolding)
"""

from __future__ import annotations

from enum import StrEnum


class Edition(StrEnum):
    """AtlasBridge edition tiers.

    COMMUNITY — open-source core; fully functional.
    PRO       — local enterprise governance (Phase A); open-core.
    ENTERPRISE — cloud governance + dashboard (Phase B/C); future SaaS.
    """

    COMMUNITY = "community"
    PRO = "pro"
    ENTERPRISE = "enterprise"


# Feature flag registry: feature_name → minimum edition required
_FEATURE_FLAGS: dict[str, Edition] = {
    # Phase A — local governance (Pro)
    "decision_trace_v2": Edition.PRO,
    "risk_classifier": Edition.PRO,
    "policy_pinning": Edition.PRO,
    "audit_integrity_check": Edition.PRO,
    "rbac": Edition.PRO,
    "policy_lifecycle": Edition.PRO,
    # Phase B — cloud integration (Enterprise)
    "cloud_policy_sync": Edition.ENTERPRISE,
    "cloud_audit_stream": Edition.ENTERPRISE,
    "cloud_control_channel": Edition.ENTERPRISE,
    # Phase C — dashboard (Enterprise)
    "web_dashboard": Edition.ENTERPRISE,
}


def detect_edition() -> Edition:
    """Detect the active edition based on available license/config.

    Currently always returns COMMUNITY.  Pro and Enterprise detection
    will be added when license validation is implemented.

    This function is intentionally simple and deterministic — no network
    calls, no side effects.
    """
    # TODO: check for pro license file or enterprise config
    return Edition.COMMUNITY


def is_feature_available(feature: str) -> bool:
    """Check if a feature is available in the current edition."""
    required = _FEATURE_FLAGS.get(feature)
    if required is None:
        return False
    current = detect_edition()
    edition_order = [Edition.COMMUNITY, Edition.PRO, Edition.ENTERPRISE]
    return edition_order.index(current) >= edition_order.index(required)


def list_features() -> dict[str, dict[str, str]]:
    """Return all features with their required edition and availability."""
    current = detect_edition()
    edition_order = [Edition.COMMUNITY, Edition.PRO, Edition.ENTERPRISE]
    current_idx = edition_order.index(current)
    result: dict[str, dict[str, str]] = {}
    for feature, required in _FEATURE_FLAGS.items():
        available = edition_order.index(required) <= current_idx
        result[feature] = {
            "required_edition": required.value,
            "available": "yes" if available else "no",
            "status": "active" if available else "locked",
        }
    return result
