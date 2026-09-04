# B-01 credit product contract

OpenReel locally models the product mechanics observed in LibTV's authenticated
points store without claiming a connected payment system.

The contract supports general or model-specific points, a minimum membership
tier, fixed validity, basis-point bonuses, and optional weekly or monthly purchase
limits. Quotes are immutable and always return `executable: false`,
`paymentConnected: false`, and `requiresHumanGate: true`.

This layer does not create orders, charge a payment method, grant an entitlement,
increase a balance, or settle provider usage. Connecting those actions requires a
separately approved payment-provider design and staging gate.
