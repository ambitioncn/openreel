# E-01 provider-console read-only checklist

Status: prepared only. This document does not authorize account access, provider calls, configuration changes, support tickets, subscriptions or spend.

## Exact read-only scope

For the cp59 timestamp and Beijing Ark region, inspect without mutation:

1. provider service-status or incident notices;
2. Seedream 5.0 Lite model activation state for the account;
3. whether direct model-ID invocation is allowed or a custom endpoint ID is required;
4. account suspension, overdue-balance, quota or service notices;
5. inference usage records showing whether the failed request was accepted for billing;
6. audit/correlation records available without revealing credential or personal data.

## Evidence to retain

- capture timestamp, region and evidence class;
- normalized booleans/status categories only;
- provider incident identifier or a one-way request/audit identifier fingerprint when available;
- a conclusion of `transient_service`, `account_configuration`, `inconclusive`, or `no_matching_record`;
- screenshot hashes if screenshots are retained privately; do not place screenshots containing account data in git.

## Forbidden actions

- do not activate a model, create an endpoint, change quota, recharge or subscribe;
- do not create, reveal, rotate or delete credentials;
- do not retry inference;
- do not contact support or send external messages;
- do not change staging or production.

## Exit conditions

Stop if login needs OTP, if the account/tenant is ambiguous, if any page requires accepting terms or changing state, or if evidence would expose secrets or personal data. Route the exact next action through a new human gate.
