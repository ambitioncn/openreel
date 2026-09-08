import { TUTORIALS } from "./tutorials.js";

const EN = {
  "noir-trailer": {
    title: "30-second film noir trailer", category: "Film trailer", level: "Beginner", duration: "About 20–35 minutes", calls: "2 images + 2 videos", outcome: "Create a 30-second trailer with an establishing shot, conflict, and a suspenseful ending.",
    nodes: [
      ["Three-act trailer script", "0–6 sec: establish a rainy night city. 6–18 sec: the detective finds a key clue. 18–30 sec: pursuit, blackout, and title card."],
      ["Rainy-night keyframe", "1940s film noir, neon street in the rain, lone detective from behind, strong chiaroscuro, cinematic composition, 16:9, no text."],
      ["Clue close-up", "A black leather glove lifts a soaked old photograph under a hard desk lamp, shallow depth of field, film-noir texture, 16:9, no text."],
      ["City establishing shot", "Slow push forward through falling rain and neon reflections; the detective stops and looks back; restrained motion and consistent character."],
      ["Suspense ending", "Rack focus from the old photograph to a silhouette in the doorway; lights flicker, the character looks up, then cut to black."]
    ],
    steps: ["Replace the lead, location, and mystery in the script node.", "Generate two low-cost composition drafts, then refine only approved frames.", "Use each image as a reference for a 4–6 second video.", "Confirm both results in the asset library and place them on the timeline in story order.", "Add a title card or voice-over, export the timeline manifest, and review pacing."],
    checks: ["Wardrobe and hairstyle stay consistent", "Each shot has one main action", "Prompts do not ask the model to render title text", "Preview fast before deciding whether to regenerate at higher quality"]
  },
  "product-commercial": {
    title: "15-second premium product ad", category: "Commercial", level: "Beginner", duration: "About 15–25 minutes", calls: "1 image + 2 videos", outcome: "Create a vertical ad with a hero reveal, material detail, and branded finish.",
    nodes: [["Three-shot ad script", "Shot 1 reveals the product. Shot 2 shows material and benefit details. Shot 3 holds on the product with room for post-production copy."], ["Product hero image", "Unbranded matte-black perfume bottle on a shallow reflective surface, warm rim light, premium studio photography, clean background, 9:16, no text."], ["Hero reveal", "The product slowly emerges from darkness as the camera makes a subtle orbit and warm rim light travels across the bottle."], ["Material close-up", "Macro move along frosted glass as droplets roll down; focus travels to the cap and ends with clean copy space above."]],
    steps: ["Replace the sample with the real product and upload a clean front reference.", "Generate one approved hero frame; preserve uploaded packaging when real marks are present.", "Create reveal and macro videos from the same hero image in 9:16.", "Combine both shots and extend the final hold to reach 15 seconds.", "Add brand, price, and CTA as post-production text."],
    checks: ["Packaging proportions remain stable", "Brand marks and copy are added in post", "Background does not overpower the product", "Aspect ratio matches the target channel"]
  },
  "poetry-film": {
    title: "Ink-wash poetry short", category: "Art film", level: "Advanced", duration: "About 25–40 minutes", calls: "2 images + 2 videos", outcome: "Turn a poem into a layered visual short with negative space and breathing room.",
    nodes: [["Poetic shot breakdown", "Image one: distant mountains and a lone boat. Image two: a warm shore light and a returning traveler. Emotional arc: cool to hopeful to warm."], ["Distant mountains and boat", "Song-dynasty ink landscape, misty layered mountains, one boat crossing open water, light ink on rice-paper texture, 16:9, no lettering."], ["Shore light", "Ink-scroll landscape, one warm lamp by a cottage as a boat approaches, cool gray with a small warm accent, ample negative space, 16:9."], ["Boat in mist", "Preserve ink brushwork; mist moves very slowly while the boat glides right to left; distant mountains remain nearly still."], ["Returning to the light", "The warm lamp flickers gently as the boat approaches; tiny ripples and a slow push-in preserve the two-dimensional ink style."]],
    steps: ["Choose a public-domain poem and extract only two or three core images.", "Turn those images into an emotional arc and a two-shot plan.", "Generate consistent starting frames with fixed color, paper, and brush descriptions.", "Use slow, single-motion video prompts that preserve the ink style.", "Add the poem in post and connect shots with restrained fades."],
    checks: ["Style description matches across prompts", "Motion is subtle and explicit", "The model is not asked to render characters or lettering", "Negative space can hold post-production subtitles"]
  },
  "mini-documentary": {
    title: "60-second profile documentary", category: "Documentary", level: "Advanced", duration: "About 35–60 minutes", calls: "1 image + 2 videos", outcome: "Combine real footage and clearly bounded generated shots into a meaningful profile.",
    nodes: [["Interview structure", "Opening: what do you do first each day? Process: what is the hardest step? Ending: why keep going? Structure: human hook, craft detail, value statement."], ["Authenticity boundary", "Use real footage for interviews and key facts. Generated media is limited to transitions, establishing views, or clearly labeled reconstructions."], ["Workshop environment", "Traditional woodworking shop at dawn, natural window light through sawdust, orderly tools, no people, realistic documentary photography, 16:9."], ["Dawn establishing shot", "Locked camera as morning light slowly reaches the workbench; sawdust drifts subtly; no people or invented events."], ["Craft detail reconstruction", "Close-up of hands sanding wood accurately; natural falling dust and restrained handheld documentary movement; no identifiable face."]],
    steps: ["Upload real interview, process footage, and room sound first.", "Shape a 60-second structure with a five-second human hook.", "Generate only a non-factual transition when an establishing shot is missing.", "Avoid identifiable faces in reconstructions and label reenactments where needed.", "Preserve real sync sound and use generated shots only as B-roll."],
    checks: ["Subject and media permissions are confirmed", "Generated content does not invent key facts", "Identifiable people are not cloned without permission", "Real and generated assets remain distinguishable"]
  },
  "character-dialogue": {
    title: "Two-character continuity dialogue", category: "Character scene", level: "Advanced", duration: "About 25–40 minutes", calls: "2 character images + 2 videos", outcome: "Create a dialogue pair with consistent wardrobe, screen direction, and eyelines.",
    nodes: [["Shot-reverse-shot continuity", "Character A stays frame left in a navy jacket; Character B stays frame right in a beige shirt. A asks, B answers; preserve axis and key-light direction."], ["Character A reference", "Thirty-year-old woman with short hair and navy jacket by a café window, bust portrait, soft side light, neutral expression, 16:9, no text."], ["Character B reference", "Thirty-five-year-old man with curly hair and beige shirt at the same café window, soft side light, neutral expression, 16:9, no text."], ["Character A asks", "Character A remains frame left looking right, asks quietly, then pauses; preserve wardrobe, hair, background, and locked camera."], ["Character B answers", "Character B remains frame right looking left, thinks, then answers; preserve wardrobe, hair, background, and lighting."]],
    steps: ["Upload or create a clean reference for each character.", "Lock wardrobe, screen position, eyeline, and key-light direction in the script.", "Change only expression and one main action per shot.", "Compare both results and redo only the drifting shot.", "Place question then answer on the timeline and verify eyelines."],
    checks: ["Identity and wardrobe remain consistent", "Screen positions and eyelines match", "Each shot has one main action", "A failed shot can be replaced independently"]
  },
  "storyboard-animatic": {
    title: "Storyboard to animatic", category: "Previsualization", level: "Beginner", duration: "About 20–30 minutes", calls: "3 storyboard images + 3 previews", outcome: "Turn a three-beat story into an ordered animatic with replaceable shots.",
    nodes: [["Three-beat shot list", "Shot 1 establishes the location. Shot 2 shows the action. Shot 3 reveals the result. Record framing, action, and duration for each."], ["Establishing storyboard", "Wide dawn view of a seaside lighthouse as a keeper approaches, cinematic storyboard sketch, 16:9, no text."], ["Action storyboard", "The keeper opens an old lighthouse door, medium shot, preserve wardrobe and spatial direction, storyboard sketch, 16:9."], ["Reveal storyboard", "A faint point of light appears inside the unlit lighthouse lens, close-up storyboard sketch, 16:9, no text."], ["Three-shot animatic", "Create a low-cost animatic in wide, medium, close-up order; keep one motion per shot and clear replacement boundaries."]],
    steps: ["Write the three beats and duration of every shot.", "Generate three storyboard frames with one visual style and character description.", "Check spatial direction before making low-cost motion previews.", "Add shots to the timeline in numbered order.", "Review order, total duration, and replacement history before export."],
    checks: ["Shot order matches the script", "Character and spatial direction are continuous", "Every shot is independently replaceable", "The animatic never auto-runs high-cost refinement"]
  },
  "music-visualizer": {
    title: "Beat-synced music visualizer", category: "Music visual", level: "Advanced", duration: "About 25–45 minutes", calls: "2 images + 2 videos", outcome: "Build looping visuals aligned to beat markers in properly licensed music.",
    nodes: [["Licensed music and beat markers", "Upload licensed music and record major beats at 0, 4, 8, and 12 seconds. Do not upload commercial recordings without rights."], ["Cool key visual", "Abstract glass ripples and deep-blue particles, centered composition, high-contrast stage light, 16:9, no text."], ["Warm climax visual", "The same glass ripples become a gold-orange particle burst while preserving centered composition and material, 16:9."], ["Verse loop", "Deep-blue particles expand with a slow pulse; matching first and last composition, locked camera, four seconds."], ["Climax transition", "On the downbeat, move quickly from deep blue to a gold-orange burst, then settle while preserving the glass texture."]],
    steps: ["Confirm music rights, upload audio, and record major beat markers.", "Generate cool and warm key visuals with matching composition.", "Create one loopable verse and one climax transition.", "Snap visual cuts to the recorded beat times.", "Check sync, loop seams, and retained audio after export."],
    checks: ["Music rights are confirmed", "Cuts match beat markers", "Loop seams are not distracting", "Export retains the audio track"]
  },
  "social-reframe": {
    title: "Landscape-to-vertical social reframe", category: "Social adaptation", level: "Beginner", duration: "About 15–25 minutes", calls: "1 composition image + 2 videos", outcome: "Reframe a landscape story into a vertical short with safe subject and subtitle space.",
    nodes: [["Vertical safe areas", "Show the subject and hook in two seconds; keep the person centered; reserve top and bottom space for title, captions, and platform controls; 15 seconds total."], ["9:16 composition draft", "Young photographer on a city rooftop, subject centered vertically, open sky above and ground below, cinematic light, 9:16, no text."], ["Opening hook", "The photographer quickly raises a camera toward the distance; slight push-in keeps the subject inside the 9:16 safe area for three seconds."], ["Result reveal", "Push from behind the photographer toward a city sunrise; preserve title space above and caption space below, smooth motion, 9:16, six seconds."]],
    steps: ["Choose an action hook readable within two seconds.", "Confirm people and products fit the vertical safe area in a composition draft.", "Create separate 9:16 hook and result clips with explicit blank space.", "Control total duration and subtitle reading time on the timeline.", "Preview both clean and platform-overlay views before export."],
    checks: ["The subject is not cropped vertically", "Top and bottom space are sufficient", "The core action reads within two seconds", "Text is added only in post-production"]
  }
};

export function tutorialsForLocale(locale) {
  if (locale !== "en") return TUTORIALS;
  return TUTORIALS.map(tutorial => {
    const translated = EN[tutorial.id];
    return Object.freeze({
      ...tutorial,
      ...translated,
      nodes: tutorial.nodes.map((node, index) => Object.freeze({ ...node, title: translated.nodes[index][0], content: translated.nodes[index][1] }))
    });
  });
}

export function tutorialForLocale(id, locale) {
  return tutorialsForLocale(locale).find(tutorial => tutorial.id === id) || null;
}
