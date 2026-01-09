"""
Prompter Core Exceptions

Custom exceptions for the Prompter architecture.
"""


class PrompterException(Exception):
    """Base exception for Prompter module"""
    pass


class TemplateNotFoundError(PrompterException):
    """Raised when a template is not found in DB or filesystem"""
    pass


class TemplateValidationError(PrompterException):
    """Raised when template validation fails"""
    pass


class VariableValidationError(PrompterException):
    """Raised when variable validation fails"""
    pass


class ExecutionError(PrompterException):
    """Raised when prompt execution fails"""
    pass


class CacheError(PrompterException):
    """Raised when cache operation fails"""
    pass
