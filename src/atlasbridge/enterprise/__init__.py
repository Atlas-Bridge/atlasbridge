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

import os
from enum import StrEnum


class Edition(StrEnum):
    """AtlasBridge edition tiers.

    COMMUNITY  — open-source; fully functional local runtime.
    CORE       — local governance (Phase A); open-core.
    ENTERPRISE — cloud governance + dashboard (Phase B/C).
    """

    COMMUNITY = "community"
    CORE = "core"
    ENTERPRISE = "enterprise"


# Feature flag registry: feature_name → minimum edition required
_FEATURE_FLAGS: dict[str, Edition] = {
    # Phase A — local governance (Core)
    "decision_trace_v2": Edition.CORE,
    "risk_classifier": Edition.CORE,
    "policy_pinning": Edition.CORE,
    "audit_integrity_check": Edition.CORE,
    "rbac": Edition.CORE,
    "policy_lifecycle": Edition.CORE,
    # Phase B — cloud integration (Enterprise)
    "cloud_policy_sync": Edition.ENTERPRISE,
    "cloud_audit_stream": Edition.ENTERPRISE,
    "cloud_control_channel": Edition.ENTERPRISE,
    # Phase C — dashboard (Enterprise)
    "web_dashboard": Edition.ENTERPRISE,
}

_EDITION_ORDER = [Edition.COMMUNITY, Edition.CORE, Edition.ENTERPRISE]


def detect_edition() -> Edition:
    """Detect the active edition.

    Reads the ``ATLASBRIDGE_EDITION`` environment variable.  Valid values
    are ``community``, ``core``, and ``enterprise`` (case-insensitive).
    Falls back to COMMUNITY when unset or invalid.

    This function is intentionally simple and deterministic — no network
    calls, no side effects.
    """
    env = os.environ.get("ATLASBRIDGE_EDITION", "").lower()
    if env == "core":
        return Edition.CORE
    if env == "enterprise":
        return Edition.ENTERPRISE
    return Edition.COMMUNITY


def is_feature_available(feature: str) -> bool:
    """Check if a feature is available in the current edition."""
    required = _FEATURE_FLAGS.get(feature)
    if required is None:
        return False
    current = detect_edition()
    return _EDITION_ORDER.index(current) >= _EDITION_ORDER.index(required)


def list_features() -> dict[str, dict[str, str]]:
    """Return all features with their required edition and availability."""
    current = detect_edition()
    current_idx = _EDITION_ORDER.index(current)
    result: dict[str, dict[str, str]] = {}
    for feature, required in _FEATURE_FLAGS.items():
        available = _EDITION_ORDER.index(required) <= current_idx
        result[feature] = {
            "required_edition": required.value,
            "available": "yes" if available else "no",
            "status": "active" if available else "locked",
        }
    return result
