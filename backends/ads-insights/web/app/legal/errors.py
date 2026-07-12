"""Stable legal/privacy domain errors with customer-safe codes."""


class LegalError(RuntimeError):
    status_code = 500
    code = "legal_error"


class LegalConfigurationError(LegalError):
    status_code = 503
    code = "legal_not_configured"


class LegalDocumentsUnavailable(LegalError):
    status_code = 503
    code = "legal_documents_unavailable"


class LegalForbidden(LegalError):
    status_code = 403
    code = "legal_forbidden"


class LegalNotFound(LegalError):
    status_code = 404
    code = "legal_not_found"


class LegalConflict(LegalError):
    status_code = 409
    code = "legal_conflict"


class PrivacyExportNotReady(LegalConflict):
    code = "privacy_export_not_ready"


class PrivacyExportExpired(LegalError):
    status_code = 410
    code = "privacy_export_expired"


class LegalVersionConflict(LegalConflict):
    code = "legal_version_not_current"


class LastOwnerConflict(LegalConflict):
    code = "last_workspace_owner"


class LegalValidationError(LegalError):
    status_code = 422
    code = "legal_invalid_request"


class LegalAcceptanceRequired(LegalError):
    status_code = 428
    code = "legal_acceptance_required"
