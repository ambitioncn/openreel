# A-01 bounded audio execution gate

This packet is prepared but not authorized. The independent Doubao Seed TTS 2.0 review permits preparation of this gate only; it does not permit credential access, provider calls, spend, staging changes, deployment, or production traffic.

The proposed private-staging run contains exactly two calls. Each input is capped at 500 characters; the aggregate cap is 1,000 characters. At the reviewed public list price of CNY 5 per 10,000 characters, the aggregate spend ceiling is CNY 0.50. There are no automatic retries.

Before execution, a human must fill and approve every field under `requiredHumanInputs` in `a01-audio-authorization-packet.json`: the exact private staging URL, a non-secret restricted credential-source reference, the exact HTTPS provider host, the exact endpoint/resource id, approver identity and time, the complete approval statement, stop conditions, and cleanup authority. Values must come from the operator or an independently verifiable approved configuration; they must not be inferred or guessed.

The retained evidence must include terminal metadata, audio MIME type and duration, provider provenance and billed usage; a timeline-aligned AAC export; graphical-browser download evidence; negative-path results; and secret-scan and tenant-boundary results. Credentials, OTPs, NDA text, account data, and expiring output URLs must not be retained.

Any mismatch with the frozen candidate, host, endpoint/resource id, price, region, terms, license, staging target, credential source, call count, character cap, spend ceiling, or allowlist stops the run. Provider failure, timeout, usage uncertainty, ledger mismatch, security regression, or operator stop also ends the run without retry.

This gate does not authorize production or public traffic, subscription, publication, credential mutation, signing, deployment/process control, or more than the two listed calls. A-01 and the project remain in progress until separately authorized real-media evidence passes acceptance.
