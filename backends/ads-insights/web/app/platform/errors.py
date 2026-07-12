"""Stable domain errors for the platform access layer."""

from __future__ import annotations


class PlatformError(RuntimeError):
    status_code = 500
    code = "platform_error"


class PlatformConfigurationError(PlatformError):
    status_code = 503
    code = "platform_not_configured"


class PlatformDatabaseError(PlatformError):
    status_code = 503
    code = "platform_database_unavailable"


class AuthenticationError(PlatformError):
    status_code = 401
    code = "authentication_required"


class AuthorizationError(PlatformError):
    status_code = 403
    code = "access_denied"


class ResourceNotFoundError(PlatformError):
    status_code = 404
    code = "not_found"


class ConflictError(PlatformError):
    status_code = 409
    code = "conflict"


class VersionConflictError(ConflictError):
    code = "version_conflict"


class ValidationError(PlatformError):
    status_code = 422
    code = "validation_error"


class InvitationProviderError(PlatformError):
    status_code = 502
    code = "invitation_provider_unavailable"


class InvitationProviderConflict(PlatformError):
    status_code = 409
    code = "invitation_conflict"
