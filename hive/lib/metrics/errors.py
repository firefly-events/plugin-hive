class MetricsError(Exception):
    """Base class for metrics runtime errors."""


class MetricsValidationError(MetricsError):
    """Raised when input data violates the metrics contracts."""


class MetricsPathBoundaryError(MetricsError):
    """Raised when a resolved write escapes the metrics root."""


class MetricsConflictError(MetricsError):
    """Raised when a write would overwrite an existing record."""


class MetricsNotFoundError(MetricsError):
    """Raised when a requested record does not exist."""

