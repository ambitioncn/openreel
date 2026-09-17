# OpenReel Next-Version Improvements

This list began as the 2026-09-16 beginner audit backlog. Statuses below now track the local implementation; nothing is released or deployed unless explicitly stated.

## Tutorial experience

### NVI-001 — Clearly distinguish tutorial guidance from executable actions

- **Status:** Implemented locally; not deployed
- **Problem:** The tutorial page presents steps with completion controls, but the steps are guidance rather than an interactive wizard. Users can reasonably expect to replace the sample subject, upload a reference, or generate a hero frame directly on that page, even though those actions happen elsewhere. Marking a step complete only records progress and does not verify or trigger the work.
- **Future improvement:** Explain this distinction prominently before the checklist and beside the completion control. Tell users where the actual work happens, what adding the blueprint does, and which actions remain manual.
- **Suggested UI copy:** “This tutorial is a guide, not an interactive wizard. Add the blueprint to the canvas, complete the work using the canvas and Create workspace controls, then return here to mark each step complete. Checking a step only records your progress; it does not run or verify the action.”
- **Acceptance criteria:**
  - The tutorial page states that checklist steps are guidance and self-reported progress.
  - The page states that checking **Complete** does not perform, verify, or unlock an action.
  - The page identifies where users should edit sample content, upload references, and generate assets.
  - The page explains that **Add tutorial blueprint to canvas** creates editable nodes but does not generate media or incur model cost.
  - Wording is available in every supported tutorial-page language.
  - Desktop and mobile usability checks confirm that the explanation is visible before a user begins checking steps.

### NVI-002 — Provide a clear handoff from Advanced Canvas to Create

- **Status:** Implemented locally as a guided same-project handoff; not deployed
- **Problem:** Adding a tutorial blueprint opens editable nodes in Advanced Canvas, but those nodes do not become the script and storyboard required by the Create workspace. Although both workspaces use the same selected project and project assets are shared, there is no **Save to Create**, conversion, or guided handoff. Users reach later tutorial steps that require a Creator storyboard—such as binding a reference image to a shot—without being told that the required structure does not yet exist.
- **Current workaround:** Open **Create**, choose **Continue current project**, select **Paste existing script / copy**, manually paste the customized tutorial plan, generate and save a script/storyboard, then upload or select the reference image in the Asset Library and bind it to a storyboard shot. This may invoke the planning model and incur generation cost.
- **Future improvement:** Add an explicit, safe transition from a tutorial blueprint in Advanced Canvas to the Create workflow. Prefer converting the customized tutorial structure into an editable Creator script/storyboard without requiring users to re-enter the same content. If automatic conversion is not available, provide a guided handoff that clearly preserves the current project and explains every manual step and any cost before a model call.
- **Acceptance criteria:**
  - Advanced Canvas offers a clearly labelled action to continue the tutorial workflow in Create.
  - The transition keeps the user in the same project and does not silently create a duplicate project.
  - Customized tutorial content is transferred into an editable Creator script/storyboard, or the UI clearly explains and assists with the required manual transfer.
  - Existing project-wide assets, including a generated hero image, remain available in Create.
  - The UI explains that an asset must be bound to a Creator storyboard shot before reference-consistency generation.
  - Any planning-model call and possible cost are disclosed before confirmation.
  - The tutorial does not instruct users to upload or bind a reference until the required Creator storyboard exists.
  - Desktop and mobile end-to-end tests cover the path from adding a tutorial blueprint through binding a reference image in Create.

### NVI-003 — Put tutorial instructions in the order users can actually perform them

- **Status:** Implemented locally; not deployed
- **Problem:** The tutorial page currently tells users to follow the checklist before reviewing or adding the blueprint, but most checklist actions require nodes that do not exist until the blueprint is added. A beginner can tick steps before doing any work and cannot see which control completes a step.
- **Future improvement:** Turn the tutorial into a guided sequence with one clear next action at a time: confirm project, add blueprint, edit content, create or choose a reference, move into Create, generate, review, and export.
- **Acceptance criteria:**
  - The first required action is **Add blueprint**, before any node-editing instruction.
  - Every step names the page, control, expected result, and whether the action may use allowance.
  - A **Go to this action** control opens the correct project and workspace section.
  - Completion text uses plain language instead of raw values such as `not_started` and `in_progress`.
  - The tutorial remains usable without checking boxes early or guessing where the work happens.

### NVI-004 — Confirm the target project and prevent duplicate blueprint imports

- **Status:** Partially implemented locally: destination is prominent and repeat import opens the existing blueprint; choosing another project remains in Projects
- **Problem:** A tutorial blueprint is added to whichever project happens to be selected. The target is shown only in the top-bar crumb, and clicking **Add tutorial blueprint to canvas** again creates duplicate nodes and groups without warning.
- **Future improvement:** Show the target project beside the add button, require confirmation when the project already contains work, and make repeated imports idempotent or intentionally versioned.
- **Acceptance criteria:**
  - The add button states the destination project name.
  - Users can choose a different existing project or create a new one before import.
  - A second click offers **Open existing blueprint**, **Replace**, or **Add another copy**.
  - No duplicate nodes are created by an accidental double click, refresh, or retry.

### NVI-005 — Keep node instructions and generation inputs in sync

- **Status:** Partially implemented locally: Content-to-Prompt sync is live; connected-result propagation remains future work
- **Problem:** Editing a tutorial node's **Content** does not update the separate generation **Prompt** field. Generated hero images also are not automatically offered as the reference for connected video nodes. The visual graph implies a data flow that the generation controls do not complete.
- **Future improvement:** Use one editable prompt source by default, show any deliberate override, and let a connected image result become an explicit selectable input for downstream video nodes.
- **Acceptance criteria:**
  - Editing tutorial Content updates the generation Prompt until the user deliberately creates an override.
  - The UI clearly labels the prompt that will actually be sent.
  - A successful hero image can be assigned to both tutorial video nodes without download and re-upload.
  - Connections show whether they are visual organization only or carry a real generation input.

### NVI-006 — Make the advertised 15-second, three-shot structure achievable

- **Status:** Implemented locally; not deployed
- **Problem:** The tutorial promises a 15-second, three-shot advertisement, but Create offers only 5-, 30-, and 60-second planning choices. The blueprint contains two video nodes, while the third final hold exists only in the script text. The storyboard editor cannot add, remove, duplicate, or reorder shots.
- **Future improvement:** Provide a native 15-second product-ad template with three editable five-second shots and basic shot-structure controls.
- **Acceptance criteria:**
  - **15 seconds** is available as a planning target.
  - The template creates three actual storyboard shots: reveal, detail, and final hold.
  - Users can add, delete, duplicate, and reorder shots before generation.
  - The displayed shot total must equal the requested duration before cost confirmation.
  - The tutorial's stated image/video count matches the generated structure.

### NVI-007 — Add the finishing controls promised by the tutorial

- **Status:** Implemented locally for shot add/delete/duplicate/reorder/duration, safe-area text cards, and final MP4 reuse; not deployed
- **Problem:** The tutorial instructs users to combine shots, repeat or slow the final hold, and add brand, price, and CTA text. The beginner Create UI has no normal clip timeline for trim/repeat/hold operations and no general text-layer editor. **Project title** and **Publishing copy** do not place text in the video. After commercial composition, the Final cut **Export MP4** action requests a local re-render, while the server requires reuse of the qualified commercial render; this can leave the visible export action failing even though a downloadable render exists in the Asset library.
- **Future improvement:** Add a simple final-cut editor or revise the tutorial so it promises only supported operations.
- **Acceptance criteria:**
  - Users can trim, reorder, duplicate, freeze, or extend a shot with visible duration feedback.
  - Users can add editable text layers for brand, price, and CTA with a platform-safe-area preview.
  - The final preview shows the exact composition that export will render.
  - A qualified commercial render has a prominent, working **Download final MP4** action and is never sent through the incompatible local re-render path.
  - Publishing metadata is visually distinguished from text burned into the video.
  - If these controls remain unavailable, the tutorial no longer instructs users to perform those actions.

### NVI-008 — Correct cost, call-count, time, and generation labels

- **Status:** Implemented locally; not deployed
- **Problem:** The Create intake says that creating a script and storyboard will not call a paid model, but the server uses the real planning model when configured. Tutorial metadata such as **1 image + 2 videos** omits planning, per-shot first-frame creation, audio, quality evaluation, possible retries, and final composition. Advanced Canvas labels cloud-backed Ark work **Generate locally** even though it uses the signed-in account's allowance.
- **Future improvement:** Show a complete staged cost explanation and use labels that accurately describe where computation runs and when allowance may be consumed.
- **Acceptance criteria:**
  - Planning-model use and its possible cost are disclosed before submission.
  - Tutorial call estimates separate planning, image, video, audio, evaluation, retry, and local export operations.
  - **Generate locally** is used only for work that truly runs locally; cloud-backed actions say **Generate** or name the provider boundary.
  - Estimated tutorial time distinguishes hands-on editing from provider wait time.
  - No screen says an action is free or non-model-backed when the implementation can call a model.

### NVI-009 — Make reference upload and binding a single guided action

- **Status:** Implemented locally with tutorial upload and all-shot binding; not deployed
- **Problem:** The tutorial asks for a reference on the Tutorial page, its advanced shortcut requires an already uploaded image, and Create requires separate upload, select, per-shot bind, generation-mode selection, reference selection, subject selection, and rights declarations. The same reference must currently be bound one shot at a time.
- **Future improvement:** Add a tutorial-aware upload action that keeps the user in the same project and guides selection, rights review, and binding to all intended shots.
- **Acceptance criteria:**
  - The tutorial page provides **Upload reference** or a direct link to the exact upload control.
  - After upload, the user can bind the image to **All product shots** in one action.
  - The UI explains the difference between uploading, selecting, binding, and choosing a generation reference.
  - Rights and identity declarations are written in age-appropriate plain language without weakening the legal boundary.
  - The advanced **Reviewed shortcut** section is hidden or clearly separated from the beginner path.

### NVI-010 — Add a beginner readiness check and plain-language recovery

- **Status:** Partially implemented locally: no-cost media readiness and clearer states are live; deeper provider-specific recovery remains future work
- **Problem:** A new user can begin the tutorial without knowing whether planning and media providers are available. Later failures expose technical concepts such as director bindings, qualification, provider jobs, revision conflicts, and raw state names without explaining the next safe action.
- **Future improvement:** Run a no-cost readiness check at the start and translate every blocked state into a specific next step.
- **Acceptance criteria:**
  - Before starting, the tutorial checks account, project, planning, image, video, audio, storage, and export readiness without paid generation.
  - A failed check states what is unavailable and whether the user can continue with a reduced path.
  - Generation status distinguishes **working**, **generated**, **quality passed**, **needs redo**, and **ready to export**.
  - Refreshing or leaving the page preserves and restores the active job with a clear resume message.
  - Failure messages offer safe retry guidance and disclose any new cost before a retry.

### NVI-011 — Test one true beginner journey from registration to download

- **Status:** Partially implemented locally with focused contract tests; full bilingual browser/provider journey remains release work
- **Problem:** Component-level behavior exists across registration, Tutorials, Advanced Canvas, Create, assets, generation, composition, and export, but the product does not enforce the tutorial's promises as one end-to-end contract.
- **Future improvement:** Make the 15-second product-ad tutorial a release-blocking beginner journey and maintain a plain-language walkthrough alongside it.
- **Acceptance criteria:**
  - A fresh account can complete the tutorial in one project without hidden setup or manual data transfer.
  - Desktop and mobile tests cover English and Chinese, refresh/resume, accidental double click, provider unavailability, failed-shot redo, cost confirmation, final preview, MP4 download, and returning to mark tutorial progress.
  - The tested result is exactly 15 seconds, 9:16, three shots, with an optional reference and editable post-production text.
  - Every button name and instruction in the tutorial matches the tested UI.
  - The maintained beginner walkthrough is understandable without knowledge of nodes, models, schemas, director bindings, or provider terminology.

## Audit notes

- **Audit date:** 2026-09-16
- **Scope:** Fresh-account browser walkthrough against an isolated local OpenReel data store, plus source tracing of registration, tutorial import, Create planning, reference binding, commercial generation, timeline composition, and export.
- **Safety:** No external provider generation or paid inference was performed during the audit.
- **Detailed current walkthrough:** [`product-commercial-tutorial-walkthrough.md`](./product-commercial-tutorial-walkthrough.md)
