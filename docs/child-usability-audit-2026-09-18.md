# OpenReel child-usability audit — 2026-09-18

**Request:** "go through the site and find every place where a 12 year old child would not be able to figure out how to make a video. write it out in a list to develop for future versions"

**Method:** Fresh-account browser audit (Chromium, desktop 1280×900 and mobile 390×844) of the currently deployed release (`bfccc61`, served at https://openreel.duobiai.cn:4173) on an isolated local copy with zero paid model calls. Every finding below was observed in the real UI; screenshots and page-text captures are retained in the audit sandbox.

**Severity key:**
- 🔴 **Blocker** — a 12-year-old is likely to get stuck here and need an adult.
- 🟡 **Confusing** — slows a child down, needs re-reading or guessing.
- ⚪ **Polish** — noise that adds doubt but does not stop progress.

---

## A. Sign-in and first steps

1. 🟡 **Deep links land on the wrong page.** Opening `/#/tutorials` (or any page URL) fresh loads the **Home** page instead. A child who bookmarks the tutorial, or gets sent a link, can never get back to where they were. *Fix: honor the hash route on first load.*

2. ⚪ **Four of the five Home choices are dead ends.** The cards *Product showcase*, *Educational video*, *Talking-head opinion*, and *Short story* all say "Coming soon". Only one card (*TikTok / Douyin vertical short video → Start creating*) actually does anything. *Fix: hide or grey out unreleased workflows and say when they arrive.*

3. 🟡 **A "Local demo" project appears out of nowhere.** Right after sign-up the header shows `/ Local demo`. The idea of a *project* is never introduced, so a child does not know what this thing is, who made it, or whether they should touch it. *Fix: name it after the child ("My first video") and add one line: "This is your project — everything you make lives here."*

4. 🟡 **Status bar says "Ready: 0 Ark models available."** "Ark" is internal jargon; a child cannot tell whether "0" is good or bad, or whether they broke something. *Fix: replace with friendly text ("All tools ready ✓") and keep model detail in an admin area.*

## B. Mixed language in the English UI (systematic i18n gap)

With the site set to English, many messages still appear in Chinese or Chinese-English mix. An English-speaking child cannot read these at all:

5. 🟡 Planning failure: `创建failed：real text planning is not configured`
6. 🟡 Cost failure: `费用预检failed：commercial generation is not configured`
7. 🟡 Upload status: `已安全上传并Select：test-ref.png`
8. 🟡 Asset count: `1 个素材`
9. 🟡 Cost line: `预计 ¥0.27 · 15 sec`
10. 🟡 Publishing destination `抖音` is untranslated.

*Fix: route every status/error string through the locale files; add a lint or test that fails when a non-localized string reaches the UI.*

## C. Errors leave the child stranded

11. 🔴 **Failures give no way forward.** When **Create script and storyboard** fails, the child sees `创建failed：real text planning is not configured` — operator jargon with no next step (try again? ask an adult? come back later?). The same pattern repeats for cost-estimate failure. *Fix: every error gets a friendly sentence + one action ("Something isn't set up yet — please ask an adult to check the site settings, then try again").*

## D. Tutorials page

12. 🔴 **The promised "one action" reference binding does not exist.** Checklist step 3 says: *"upload a licensed front reference and bind it to all shots in one action."* In reality: upload on the Tutorials page → status says *"Continue in Create to bind it to all product shots"* → in Create the **Bind to all shots** button is **disabled** until the child first clicks **Select** on the asset — and nothing anywhere says that. Three actions across two pages, one of them undocumented. *Fix: after upload, offer a real "Bind to all shots" button right there (and actually perform the bind), or auto-bind with an undo.*

13. 🔴 **The editing step sends beginners into the hardest screen in the product.** Tutorial step 3 ("replace the sample product in Content") happens on the **Advanced Canvas**: icon-only tools (`Ttext ▧image ▶video ♪audio ≡script`), "Connect selected nodes", "Drag space to pan", "Wheel to zoom", coordinate readouts (`script · 80, 120 · draft · v4`). This is a pro tool. A Beginner tutorial should not require it. *Fix: let the child edit the example prompts in a simple form (or directly in the Create handoff) and mark the Canvas as an optional advanced detour.*

14. ⚪ **"Acceptance checklist" is professional QA jargon** ("Packaging proportions remain stable", "Brand marks and copy are added in post") with no checkboxes and no explanation of what the child should do with it. *Fix: plain-language self-check questions with boxes.*

15. ⚪ **"Advanced reviewed shortcut" template dropdown** lists 16 cryptic options ("Nine-angle camera grid (4K)", "Frame prediction — 3 seconds later") on a Beginner page. It says beginners can skip it — but its presence still adds doubt. *Fix: move to the Advanced Canvas.*

## E. Create page structure

16. 🔴 **All five steps are one extremely long scrolling page.** Once a storyboard exists, Steps 1–5 (idea form, script, three shot cards, audio/captions/safe-area, generate, final cut, publishing, asset library) all render stacked on a single page — visually confirmed at 2–3× viewport height with roughly 30 controls. The "1 Idea … 5 Final cut" tabs only scroll. A child faces a wall of inputs. *Fix: show one step at a time (real wizard pages) with a Back/Next bar; collapse optional sections.*

17. 🟡 **The default choice silently creates extra projects.** Step 1 defaults to *"Create a separate project (recommended)"*, so pressing the main button makes a new project named after the brief. A child following the tutorial (which works in the original project) ends up with two projects and their work split across both; the Projects page shows two near-identical rows. *Fix: when the current project is empty, default to "Continue the current project".*

18. 🟡 **"Automatic model routing / Fast vs High quality"** occupies prime Step 1 space. Model routing means nothing to a child and is not needed to start. *Fix: hide behind an "Advanced settings" disclosure; default chosen for them.*

19. 🟡 **Shot fields use film-school jargon with no help.** Every shot has *Shot dialogue*, *Visual description*, **"Style continuity lock"**, **"B-roll"**, and *Duration*. "Style continuity lock" and "B-roll" have no examples, no "optional" marker, and no plain-language hint. *Fix: rename ("Keep the same look (optional)", "Extra background shots (optional)") with one-line examples.*

20. 🔴 **The audio/captions/safe-area block is a legal + technical wall.** One uncollapsed section contains: voice style, background music, a checkbox labeled *"Generate background music with SeedAudio 1.0 (disabled by default)"* (self-contradictory), music prompt/duration, caption-card PNG upload + shot + text, "Create text cards from every shot's text", music WAV/MP3 upload, "Music source declaration", "Reviewed music asset", a legal attestation (*"I confirm I hold the required music rights and accept responsibility for uploading, generating, using, and publishing it…"*), "Caption-card assets", "Safe area", and "Automatic captions". A child making a lemonade-stand ad should not face a music-licensing legal declaration mid-flow. *Fix: collapse everything except voice style + automatic captions into "Advanced audio & legal"; use kid-readable wording for any required confirmation.*

## F. Generate step

21. 🔴 **A raw internal status dump sits on the beginner's most important step.** The "Director quality responsibility" panel shows: `Stage awaiting_director_workflow · Evidence missing · Generation not_started · Quality not_qualified · Publishing eligibility Blocked · Gate director_workflow_required · Cost limit ¥0.00 · Retries 0/not set`, plus "Perceptual evidence from actual video · Not passed · Visual identity consistency / performance naturalness · Waiting for quality evaluation of actual video bytes". A child cannot tell whether they did something wrong or what to do. *Fix: show a friendly summary ("Ready to make your video — this will cost about ¥0.27") and move the gate/evidence detail to an admin/advanced view.*

22. 🟡 **Cost is shown as `预计 ¥0.27`** — yuan symbol and a Chinese label, unexplained. A child does not know whose money this is or whether pressing a button spends it. *Fix: localize the label and add one sentence: "This is the estimated cost to the site owner; you confirm before anything is spent."*

23. 🟡 **The confirmation says "I confirm real generation at the current quote and version."** "Quote and version" is adult contract language. *Fix: "Yes, make my video now (this spends the estimated amount shown above)."*

## G. Final cut and publishing

24. 🟡 **Two publishing destinations can never be connected.** Step 5 lists TikTok, 抖音, Instagram Reels, and YouTube Shorts — but the Connections page only supports **TikTok** and **YouTube Shorts**. Instagram Reels and Douyin are dead checkboxes forever. *Fix: only list platforms that can actually be connected.*

25. 🟡 **Nobody tells the child that publishing is optional.** The Connections page does not explain what "Connect account" does (an official authorization flow), and nothing says "you can just download your video — connecting accounts is only for posting straight to TikTok/YouTube". A child may think they must connect an account (which needs an adult's credentials) to finish. *Fix: one line above publishing: "Don't want to post online? Just use Export MP4 — you're done."*

26. 🟡 **Export MP4 is disabled with a technical reason** ("There is no exportable timeline yet. This state will not start generation or a paid call."). It does not say, in child terms, *"make your shots first (Step 4), then you can download"*. *Fix: state the missing prerequisite and link to the step.*

## H. Robustness

27. 🔴 **A JavaScript crash can occur during normal use.** Console error observed: `TypeError: Cannot set properties of null (setting 'value')` when story/storyboard data appeared while the Create page was open. Any uncaught error can silently freeze parts of the page for a child. *Fix: guard the null assignment and add an error boundary that shows a friendly "refresh to continue" message.*

## I. Advanced Canvas (where a curious child will wander)

28. 🟡 **A second, competing "right way" to make a video.** The Canvas inspector offers its own 4-step pipeline — "1 · Create story + shot", "2 · Start storyboard batch", "3 · Export timeline manifest", "4 · Render local MP4 preview" — with different jargon ("storyboard batch", "timeline manifest", "EDL"). Two workflows with different words for the same ideas doubles the confusion. *Fix: on the Canvas, point beginners to Create ("New here? Use Create — it's easier") and label the Canvas pipeline as advanced.*

29. ⚪ **Node inspector shows raw internal strings** (`script · 80, 120 · draft · v4`). Harmless, but adds to the "this is for engineers" feel.

30. ⚪ **Mobile is mostly fine** (no horizontal overflow on Home or Tutorials at 390 px), but the long-page problem (#16) is worse on a phone. *Fix: same as #16.*

---

## Implementation status — 2026-09-19

All 30 findings were addressed in the beginner-flow release and are covered by unit or browser acceptance checks:

- **#1–#4:** startup honors hash routes; unreleased Home workflows stay hidden; the starter project is **My first video** with an explanation; model-count jargon is replaced by **All video tools are ready**.
- **#5–#10:** English/Chinese status, upload, cost, asset, and publishing strings use the locale layer; the browser smoke rejects Chinese characters in the English beginner journey.
- **#11:** planning, quote, upload, binding, generation, and unexpected browser failures provide a plain-language next action; project-confirmation errors name the exact checkbox to use.
- **#12–#15:** tutorial uploads auto-bind to every existing shot (or bind when shots are created); the beginner tutorial opens Create; Canvas and templates are optional disclosures; result checks are plain-language checkboxes.
- **#16–#20:** Create is a true five-screen wizard with Back/Next controls; an empty starter project is reused; model routing and optional shot fields are advanced disclosures; labels are child-readable; only voice and automatic captions remain in the basic audio view.
- **#21–#23:** generation shows a friendly readiness/cost summary; internal gate evidence is optional advanced detail; cost is described as the site owner's estimated spend; confirmation says exactly when money is spent.
- **#24–#26:** only connectable publishing destinations are shown; MP4 download is explicitly sufficient; the empty final step points back to Step 4.
- **#27:** null-sensitive rendering is guarded and global failures show a recoverable error banner.
- **#28–#30:** Canvas points beginners back to Create and labels its workflow advanced; node metadata is human-readable; the one-screen wizard has a sticky mobile step bar and no horizontal overflow at 390×844.
- **Long-running generation:** the execute route now accepts the job immediately with HTTP 202 and a status URL, while generation continues in the background. This removes the browser/Nginx timeout dependency without duplicating paid jobs.

Acceptance evidence: `npm test` passed 662/662; the fresh-account Chromium smoke passed at 1440×900 and 390×844 with `providerCalls: 0`.

---

## Priority shortlist for the next version

If only six things get fixed, fix these — they are where a child actually stops:

1. **#16** — break the Create page into one-step-at-a-time wizard screens.
2. **#21** — replace the "Director quality responsibility" jargon panel with a friendly readiness summary.
3. **#20** — collapse the audio/captions/legal wall into an advanced section.
4. **#12 + #13** — make reference upload-and-bind truly one action, or document and simplify the real steps.
5. **#13** — remove the Advanced Canvas from the Beginner tutorial path.
6. **#5–#11** — finish English localization and give every error a friendly next step.

*The original audit made no product changes. The implementation status above records the subsequent remediation release; its verification made no paid model calls.*
