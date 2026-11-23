"""Explicit public guidance for application-authored validation constraints."""
from typing import LiteralString


class PublicValidationError(ValueError):
    """A reviewed message safe for the HTTP validation response.

    Supply authored guidance directly, never an arbitrary exception's text.
    The API source guard checks this constructor as a response boundary.
    Ordinary ValueError and unexpected validation failures remain private.
    Optional context must be reviewed request values, such as a node ID; only
    primitive strings and numbers are formatted, never exception objects.
    """

    def __init__(self, message: LiteralString, **context: str | int | float):
        if any(type(value) not in {str, int, float} for value in context.values()):
            raise TypeError('Public validation context must contain only primitive strings or numbers.')
        self.public_message = message.format(**context) if context else message
        super().__init__(self.public_message)
