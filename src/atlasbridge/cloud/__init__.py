"""
AtlasBridge Cloud — optional cloud governance integration interfaces.

This module defines INTERFACES ONLY for cloud features (Phase B/C).
No HTTP implementation exists yet.  The runtime ignores this module
entirely when cloud features are disabled (the default).

When ``cloud.enabled = false`` (default), all clients return no-ops.

Maturity: Specification only (Phase B — interfaces, no implementation)
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CloudConfig:
    """Cloud integration configuration.

    All fields default to disabled/empty.  The runtime must function
    identically when cloud is disabled — this is a non-negotiable invariant.
    """

    enabled: bool = False
    endpoint: str = ""
    org_id: str = ""
    api_token: str = ""  # Will be stored in keyring in production
    control_channel: str = "disabled"  # disabled | local_only | hybrid
    stream_audit: bool = False


def is_cloud_enabled(config: CloudConfig | None = None) -> bool:
    """Check if cloud features are active.

    Returns False if config is None or cloud is not enabled.
    """
    if config is None:
        return False
    return config.enabled and bool(config.endpoint)
