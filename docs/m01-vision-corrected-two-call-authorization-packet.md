# M-01 corrected vision authorization packet

This packet is prepared but **not authorized**. The prior vision authorization was consumed by its failed image request and cannot be replayed.

Exact authorization phrase:

> 授权 M-01 修正后的 vision 两次私有验证：embedding-vision，image-to-text 1 次、成功后 video-to-text 1 次，零重试，总费用上限 4 元，不部署、不公开发布。

The reviewed request contract fixes `encoding_format` to `float` and requires `image_url` / `video_url` values to be objects containing `url`. Legacy string media values fail locally before Provider contact. Execution is limited to Beijing isolated private staging: one image call, then one video call only if the image call succeeds; stop on any failure, never retry, and never exceed the CNY 4 aggregate owner ceiling.

This grants no credential change, payment/subscription change, deployment, production traffic change, or publication. M-01 and the overall project remain in progress regardless of this packet's preparation.
