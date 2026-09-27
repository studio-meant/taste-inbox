"""Desktop transport for Taste Inbox.

The desktop app does not open an HTTP listener.  Its Rust host starts the bridge with one
JSON request on stdin and receives one JSON response on stdout.
"""
