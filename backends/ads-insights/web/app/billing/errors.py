"""Safe billing domain errors; provider details never enter public messages."""


class BillingError(RuntimeError):
    status_code = 500
    code = "billing_error"


class BillingConfigurationError(BillingError):
    status_code = 503
    code = "billing_not_configured"


class BillingForbidden(BillingError):
    status_code = 403
    code = "billing_forbidden"


class BillingNotFound(BillingError):
    status_code = 404
    code = "billing_not_found"


class BillingConflict(BillingError):
    status_code = 409
    code = "billing_conflict"


class BillingValidationError(BillingError):
    status_code = 422
    code = "billing_invalid_request"


class BillingPrerequisiteError(BillingConflict):
    code = "billing_prerequisites_incomplete"


class BillingProviderError(BillingError):
    status_code = 502
    code = "billing_provider_unavailable"


class BillingSignatureError(BillingValidationError):
    status_code = 400
    code = "invalid_webhook_signature"
