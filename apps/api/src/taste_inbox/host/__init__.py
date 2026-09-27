"""Runtime host detection and adaptive resource policy.

Import from the concrete modules (`taste_inbox.host.models`, `.detector`, `.policy`).
This package intentionally re-exports nothing: `config.schema` depends on
`host.models`, while `host.policy` depends on `config.schema`, so eager re-exports
here would create an import cycle.
"""
