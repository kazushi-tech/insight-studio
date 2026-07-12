"""Domain errors for the report.v2 repository and routes."""

from __future__ import annotations


class ReportServiceError(RuntimeError):
    status_code = 500
    code = "report_service_error"


class ReportNotFound(ReportServiceError):
    status_code = 404
    code = "report_not_found"


class ReportForbidden(ReportServiceError):
    status_code = 403
    code = "report_forbidden"


class ReportLegalAcceptanceRequired(ReportForbidden):
    code = "legal_acceptance_required"


class ReportSubscriptionForbidden(ReportForbidden):
    code = "subscription_access_forbidden"


class ReportConflict(ReportServiceError):
    status_code = 409
    code = "report_conflict"


class ReportValidationError(ReportServiceError):
    status_code = 422
    code = "invalid_report"


class ReportTooLarge(ReportValidationError):
    status_code = 413
    code = "report_too_large"
