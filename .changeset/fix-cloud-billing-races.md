---
'playwriter': patch
---

Fix cloud browser billing edge cases for concurrent usage.

Cloud session quota claims now use durable per-org slots, so concurrent `playwriter session new --browser cloud` requests cannot exceed the subscribed session quantity. Stripe Checkout also checks Stripe directly before creating a new subscription, which avoids duplicate subscriptions while webhook delivery is still pending.
