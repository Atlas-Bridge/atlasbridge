"""
Cloud authentication — runtime identity and token management.

The local runtime authenticates to the cloud API using a local Ed25519
keypair.  The public key serves as the runtime identity.  No secrets
are ever exported to the cloud — the cloud holds only the public key.

Contract:
  - Keypair is generated locally on first cloud setup
  - Private key never leaves the local machine
  - Runtime identity = hex-encoded public key
  - API tokens are stored in the OS keyring (not config files)

Maturity: Specification only (Phase B)
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class CloudAuthProvider(ABC):
    """Interface for cloud authentication."""

    @abstractmethod
    def get_runtime_id(self) -> str:
        """Return the runtime identity (public key hex)."""
        ...

    @abstractmethod
    def sign(self, message: bytes) -> bytes:
        """Sign a message with the local private key."""
        ...

    @abstractmethod
    def verify(self, message: bytes, signature: bytes, public_key: bytes) -> bool:
        """Verify a signature against a public key."""
        ...

    @abstractmethod
    def get_api_token(self) -> str:
        """Retrieve the API token from the keyring."""
        ...


class DisabledAuthProvider(CloudAuthProvider):
    """No-op auth provider used when cloud is disabled."""

    def get_runtime_id(self) -> str:
        return ""

    def sign(self, message: bytes) -> bytes:
        return b""

    def verify(self, message: bytes, signature: bytes, public_key: bytes) -> bool:
        return False

    def get_api_token(self) -> str:
        return ""
