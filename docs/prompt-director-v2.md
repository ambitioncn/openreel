# Prompt Director v2

Prompt Director v2 is the production prompt boundary for fixed five-second MiniMax H3 image-to-video commercial shots. It keeps an editable `creative_spec` separate from the compact `model_prompt` sent to ModelClaw/ComfyUI.

The creative layer records first-frame inheritance, ordered timed action beats, subject motion, exactly one dominant camera move, ambient motion, lighting/material continuity, the resolved end pose, and negative constraints. The compiler validates the five-second time range, rejects overlapping beats and unsupported compound camera moves, adds baseline safety/continuity negatives, and emits `openreel-prompt-director-model-prompt/v2` for adapter `minimax-h3-image-to-video/v2`.

The directing order follows a five-part grammar: scene/subject, action, camera, visual continuity, and constraints. The schema borrows the useful idea of structured scene/action-beat/constraint fields associated with HiAPI-style prompt tools, while camera motion and pacing controls are informed by VAKPixel-style practice. Wording and examples are original OpenReel material.

Knowledge provenance: MiniMax H3 prompting behavior is informed by MiniMax official H3 documentation/examples and the community “Awesome MiniMax H3 Prompts” collection. OpenReel stores attribution and textual guidance only; it does not bundle or redistribute third-party example images, videos, or other media. Google’s five-part video directing guidance is used as a conceptual grammar, not copied template content. Product names remain trademarks of their owners.

The existing special three-micro-shot route remains deliberately conservative: it generates one locked five-second H3 source and derives stable crops. Prompt Director v2 currently governs ordinary per-shot H3 requests; changing the three-micro-shot continuity strategy requires separate visual acceptance evidence.

## Commercial coverage contract

`openreel-h3-commercial-coverage-matrix/v1` defines the finite production vocabulary. It crosses 12 single dominant camera actions (`locked`, dolly in/out, pan left/right, tilt up/down, orbit left/right, crane up/down, and stabilized handheld drift) with 12 commercial scenarios (product hero, feature demo, macro detail, unboxing, before/after, lifestyle use, testimonial, food/beverage, fashion/beauty, retail/e-commerce, service/app, and brand payoff), for 144 deterministic cases.

Every case compiles through the same continuity and negative-constraint boundary. A director shot may select `cameraAction` and `commercialScenario`; omitted fields retain the reviewed legacy routing. Unknown values fail closed. “All” means every entry in this versioned supported vocabulary, not every imaginable real-world advertisement. Adding a new action or scenario requires extending the catalog and exhaustive matrix test before production use.
