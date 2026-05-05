const state = {
  manifest: null,
  activeIndex: 0,
  transcriptEntries: [],
  activeTranscriptIndex: -1,
  activeCallout: null,
  studioTag: null,
  studioPreviewed: false,
  studioEntries: [],
  studioDurationSeconds: 0,
  studioTagsData: [],
};

const els = {
  tabs: document.querySelector("#clip-tabs"),
  duration: document.querySelector("#clip-duration"),
  purpose: document.querySelector("#clip-purpose"),
  callouts: document.querySelector("#clip-callouts"),
  calloutDetail: document.querySelector("#callout-detail"),
  audio: document.querySelector("#demo-audio"),
  transcriptList: document.querySelector("#transcript-list"),
  transcriptCount: document.querySelector("#transcript-count"),
  jsonSnippet: document.querySelector("#json-snippet"),
  responseSnippet: document.querySelector("#response-snippet"),
  snippetMeta: document.querySelector("#snippet-meta"),
  studioTags: document.querySelector("#studio-tags"),
  studioTimeline: document.querySelector("#studio-timeline"),
  studioRuler: document.querySelector("#studio-ruler"),
  studioCurrentTime: document.querySelector("#studio-current-time"),
  studioDurationTime: document.querySelector("#studio-duration-time"),
  studioCategory: document.querySelector("#studio-mock-category"),
  studioTime: document.querySelector("#studio-mock-time"),
  studioNote: document.querySelector("#studio-mock-note"),
  studioAction: document.querySelector("#studio-mock-action"),
  studioTargetedCost: document.querySelector("#studio-targeted-cost"),
  studioFullCost: document.querySelector("#studio-full-cost"),
  studioPreviewButton: document.querySelector("#studio-preview-button"),
  studioResult: document.querySelector("#studio-mock-result"),
};

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

schedulePreviewScrollReset();

els.audio.addEventListener("timeupdate", () => {
  syncTranscriptToAudio(els.audio.currentTime);
});

els.audio.addEventListener("seeked", () => {
  syncTranscriptToAudio(els.audio.currentTime, { forceScroll: true });
});

els.callouts.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest(".callout-chip");
  if (!button) return;
  const callout = button.dataset.callout;
  state.activeCallout = state.activeCallout === callout ? null : callout;
  renderCallouts(state.manifest.clips[state.activeIndex].callouts);
});

els.studioTags.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest(".mock-tag-button");
  if (!button) return;
  state.studioTag = button.dataset.tag;
  state.studioPreviewed = false;
  renderStudioMock();
});

els.studioPreviewButton.addEventListener("click", () => {
  state.studioPreviewed = !state.studioPreviewed;
  renderStudioMock();
});

init().catch((error) => {
  const panel = document.querySelector(".proof-player-panel");
  panel.innerHTML = `<div class="load-error">Could not load demo assets. Run <code>npm run demo:export</code>, then restart <code>npm run demo:page</code>.</div>`;
  console.error(error);
});

async function init() {
  const manifest = await fetchJson(assetUrl("public-demos/manifest.json"));
  state.manifest = manifest;
  renderTabs();
  await selectClip(0);
  schedulePreviewScrollReset();
}

function resetPreviewScroll() {
  window.scrollTo({ top: 0, left: 0 });
}

function schedulePreviewScrollReset() {
  resetPreviewScroll();
  requestAnimationFrame(resetPreviewScroll);
  window.addEventListener("load", resetPreviewScroll, { once: true });
  window.addEventListener("pageshow", resetPreviewScroll, { once: true });
  setTimeout(resetPreviewScroll, 50);
  setTimeout(resetPreviewScroll, 250);
}

function renderTabs() {
  els.tabs.innerHTML = "";
  state.manifest.clips.forEach((clip, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clip-tab";
    button.role = "tab";
    button.textContent = clip.title;
    button.setAttribute("aria-selected", String(index === state.activeIndex));
    button.addEventListener("click", () => selectClip(index));
    els.tabs.append(button);
  });
}

async function selectClip(index) {
  state.activeIndex = index;
  renderTabs();
  const clip = state.manifest.clips[index];
  const [transcript, inputSnippet] = await Promise.all([
    fetchJson(assetUrl(clip.transcript_json)),
    fetchJson(assetUrl(clip.input_snippet_json)),
  ]);

  els.duration.textContent = formatDuration(clip.duration_seconds);
  els.purpose.textContent = clip.purpose;
  els.audio.pause();
  els.audio.src = assetUrl(clip.output_audio);
  state.activeTranscriptIndex = -1;
  state.activeCallout = null;
  state.studioEntries = transcript.entries ?? [];
  state.studioDurationSeconds =
    transcript.duration_seconds ?? transcript.duration ?? clip.duration_seconds ?? 0;
  state.studioTagsData = buildStudioTags(state.studioEntries, state.studioDurationSeconds);
  state.studioTag = state.studioTagsData[0]?.id ?? null;
  state.studioPreviewed = false;
  renderCallouts(clip.callouts);

  renderTranscript(transcript.entries);
  renderSnippet(inputSnippet, clip);
  renderStudioMock();
}

function renderCallouts(callouts) {
  els.callouts.innerHTML = callouts.map(renderCallout).join("");
  renderCalloutDetail();
}

function renderTranscript(entries) {
  state.transcriptEntries = entries;
  els.transcriptCount.textContent = `${entries.length} turn${entries.length === 1 ? "" : "s"}`;
  els.transcriptList.innerHTML = entries
    .map((entry, index) => {
      const speaker = entry.speaker_name || entry.speaker_id || entry.speaker || "speaker";
      const cutoff = isCutoffEntry(entry);
      return `
        <article class="transcript-line${cutoff ? " is-cutoff" : ""}" data-transcript-index="${index}">
          <div class="speaker">${escapeHtml(speaker)}</div>
          <p>${renderTranscriptText(entry.text, cutoff)}</p>
        </article>
      `;
    })
    .join("");
  syncTranscriptToAudio(0, { forceScroll: true });
}

function renderSnippet(snippet, clip) {
  const selectedTurns = selectApiPreviewTurns(snippet.turns);
  const reduced = {
    endpoint: "POST /v1/render",
    speakers: snippet.speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      provider: speaker.voice?.provider,
      voice_id: speaker.voice?.voice_id,
    })),
    turns: selectedTurns.map((turn) => ({
      index: turn.index,
      speaker: turn.speaker,
      text: turn.text,
      interrupt: turn.interrupt || undefined,
      interrupt_mode: turn.interrupt_mode || undefined,
      pause_after: turn.pause_after || undefined,
    })),
    output: {
      format: "mp3",
      transcripts: ["json", "vtt"],
    },
  };

  const response = {
    job_id: `job_${clip.id.replaceAll("-", "_")}`,
    status: "completed",
    audio_url: `https://api.stitch.audio/renders/${clip.id}.mp3`,
    transcript_url: `https://api.stitch.audio/renders/${clip.id}.json`,
    duration_seconds: Math.round(clip.duration_seconds),
    tracks: reduced.speakers.map((speaker) => ({
      speaker: speaker.id,
      transcript_segments: "timed",
    })),
    estimated_cost_cents: estimatePreviewCostCents(snippet.turns),
  };

  els.snippetMeta.textContent = `${reduced.speakers.length} speakers · ${snippet.turns.length} turns`;
  els.jsonSnippet.textContent = JSON.stringify(reduced, null, 2);
  els.responseSnippet.textContent = JSON.stringify(response, null, 2);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function assetUrl(path) {
  return String(path || "").replace(/^\/+/, "");
}

function syncTranscriptToAudio(currentTime, options = {}) {
  const index = state.transcriptEntries.findIndex((entry) => {
    const start = entry.start_seconds ?? entry.start ?? 0;
    const end = entry.end_seconds ?? entry.end ?? start;
    return currentTime >= start && currentTime <= end;
  });
  const nextIndex = index === -1 ? nearestTranscriptIndex(currentTime) : index;

  if (nextIndex === state.activeTranscriptIndex && !options.forceScroll) return;

  const previous = els.transcriptList.querySelector(".transcript-line.is-active");
  previous?.classList.remove("is-active");
  state.activeTranscriptIndex = nextIndex;

  const active = els.transcriptList.querySelector(
    `[data-transcript-index="${nextIndex}"]`,
  );
  active?.classList.add("is-active");
  if (active && (options.forceScroll || !isElementMostlyVisible(active, els.transcriptList))) {
    active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function nearestTranscriptIndex(currentTime) {
  if (state.transcriptEntries.length === 0) return -1;
  let candidateIndex = 0;
  let candidateDistance = Number.POSITIVE_INFINITY;

  state.transcriptEntries.forEach((entry, index) => {
    const start = entry.start_seconds ?? entry.start ?? 0;
    const end = entry.end_seconds ?? entry.end ?? start;
    const distance = currentTime < start ? start - currentTime : currentTime - end;
    if (distance < candidateDistance) {
      candidateDistance = distance;
      candidateIndex = index;
    }
  });

  return candidateIndex;
}

function isElementMostlyVisible(element, container) {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elementRect.top >= containerRect.top + 12 && elementRect.bottom <= containerRect.bottom - 12;
}

function selectApiPreviewTurns(turns) {
  const interruptionIndex = turns.findIndex(
    (turn) => turn.interrupt || turn.interrupt_mode,
  );
  const start = interruptionIndex === -1 ? 0 : Math.max(0, interruptionIndex - 2);
  return turns.slice(start, start + 6);
}

function estimatePreviewCostCents(turns) {
  const characters = turns.reduce((total, turn) => total + String(turn.text ?? "").length, 0);
  return Math.max(4, Math.round(characters * 0.0035));
}

function renderStudioMock() {
  const tags = state.studioTagsData;
  const item = tags.find((tag) => tag.id === state.studioTag) ?? tags[0];
  if (!item) {
    els.studioTimeline.innerHTML = "";
    els.studioRuler.innerHTML = "";
    els.studioTags.innerHTML = "";
    return;
  }

  renderStudioTimeline(item);

  els.studioTags.innerHTML = tags.map((tag) => {
    const selected = tag.id === item.id;
    return `
      <button
        class="mock-tag-button${selected ? " is-selected" : ""}"
        type="button"
        data-tag="${escapeHtml(tag.id)}"
        aria-pressed="${selected}"
      >
        <span>${escapeHtml(tag.time)}</span>
        ${escapeHtml(tag.label)}
      </button>
    `;
  }).join("");

  els.studioCategory.textContent = item.label;
  els.studioTime.textContent = item.time;
  els.studioNote.textContent = item.note;
  els.studioAction.textContent = item.action;
  els.studioTargetedCost.textContent = item.targetedCost;
  els.studioFullCost.textContent = item.fullCost;
  els.studioPreviewButton.textContent = state.studioPreviewed ? "Show original note" : "Preview targeted fix";
  els.studioResult.classList.toggle("is-open", state.studioPreviewed);
  els.studioResult.innerHTML = state.studioPreviewed
    ? `<div class="mock-result-inner"><strong>Preview result</strong><p>${escapeHtml(item.result)}</p></div>`
    : "";
}

function renderStudioTimeline(item) {
  const duration = Math.max(1, state.studioDurationSeconds);
  const speakerIds = uniqueSpeakerIds(state.studioEntries);
  const selectedIndexes = new Set([item.entryIndex, item.relatedEntryIndex].filter((index) => index !== undefined));

  els.studioTimeline.innerHTML = `
    ${state.studioEntries.map((entry) => {
      const start = secondsFromEntry(entry, "start");
      const end = Math.max(start + 0.1, secondsFromEntry(entry, "end"));
      const x = clampPercent((start / duration) * 100);
      const width = Math.max(1.2, ((end - start) / duration) * 100);
      const speaker = entry.speaker_name || entry.speaker_id || entry.speaker || "speaker";
      const speakerIndex = Math.max(0, speakerIds.indexOf(entry.speaker_id || entry.speaker || speaker));
      const classes = [
        "studio-segment",
        `speaker-color-${speakerIndex % 4}`,
        selectedIndexes.has(entry.index) ? "is-selected" : "",
        entry.overlaps_with !== undefined ? "is-overlap" : "",
        entry.is_interrupted || isCutoffEntry(entry) ? "is-cutoff" : "",
        item.kind === "line-delivery" && entry.index === item.entryIndex ? "has-internal-pause" : "",
      ].filter(Boolean).join(" ");

      return `
        <span
          class="${classes}"
          style="--x: ${x.toFixed(3)}%; --w: ${width.toFixed(3)}%;"
          title="${escapeHtml(speaker)} · ${escapeHtml(formatDurationPrecise(start))}"
        >
          ${escapeHtml(String(speaker).toLowerCase())}
        </span>
      `;
    }).join("")}
    <span class="studio-playhead" style="--x: ${clampPercent((item.timeSeconds / duration) * 100).toFixed(3)}%"></span>
  `;

  els.studioRuler.innerHTML = [0, duration / 3, (duration / 3) * 2, duration]
    .map((seconds) => `<span>${escapeHtml(formatDuration(seconds))}</span>`)
    .join("");
  els.studioCurrentTime.textContent = formatDurationPrecise(item.timeSeconds);
  els.studioDurationTime.textContent = formatDuration(duration);
}

function buildStudioTags(entries, durationSeconds) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const tags = [];
  const fullCost = `${Math.max(4, Math.round(entries.reduce((total, entry) => total + String(entry.text ?? "").length, 0) * 0.0035))}c`;
  const overlap = entries.find((entry) => entry.overlaps_with !== undefined);
  if (overlap) {
    const interrupted = entries.find((entry) => entry.index === overlap.overlaps_with);
    const speaker = speakerLabel(overlap);
    const other = interrupted ? speakerLabel(interrupted) : "the other speaker";
    tags.push({
      id: `turn-taking-${overlap.index}`,
      kind: "turn-taking",
      label: "Turn-taking",
      time: formatDurationPrecise(secondsFromEntry(overlap, "start")),
      timeSeconds: secondsFromEntry(overlap, "start"),
      entryIndex: overlap.index,
      relatedEntryIndex: interrupted?.index,
      note: `${speaker} enters while ${other} still owns the floor. Studio can show the overlap and shift the cut-in before spending on a full rerender.`,
      action: "Adjust the interruption placement",
      result: "The cut-in lands where it is meant to: over audible speech, not over dead air.",
      targetedCost: "free",
      fullCost,
    });
  }

  const lineEntry = findLineDeliveryCandidate(entries);
  if (lineEntry) {
    const chars = String(lineEntry.text ?? "").length;
    tags.push({
      id: `line-delivery-${lineEntry.index}`,
      kind: "line-delivery",
      label: "Line delivery",
      time: formatDurationPrecise(secondsFromEntry(lineEntry, "start")),
      timeSeconds: secondsFromEntry(lineEntry, "start"),
      entryIndex: lineEntry.index,
      note: `${speakerLabel(lineEntry)} has a longer generated line where internal pauses or emphasis may need tuning. Studio edits only that turn stem.`,
      action: "Rewrite the line, then regenerate one turn",
      result: "The new B render keeps the rest of the mix and replaces only this voice stem.",
      targetedCost: `${Math.max(1, Math.round(chars * 0.0035))}c`,
      fullCost,
    });
  }

  const gap = findLargestGap(entries);
  if (gap) {
    tags.push({
      id: `pacing-${gap.next.index}`,
      kind: "pacing",
      label: "Pacing",
      time: formatDurationPrecise(gap.nextStart),
      timeSeconds: gap.nextStart,
      entryIndex: gap.next.index,
      relatedEntryIndex: gap.previous.index,
      note: `There is a ${Math.round(gap.gapSeconds * 1000)}ms handoff before ${speakerLabel(gap.next)} speaks. Studio can test a mix-only timing edit first.`,
      action: "Shorten the handoff in the mix",
      result: "The next turn starts sooner while the original generated stems stay untouched.",
      targetedCost: "free",
      fullCost,
    });
  }

  return tags.slice(0, 3);
}

function findLineDeliveryCandidate(entries) {
  const candidates = entries
    .filter((entry) => entry.overlaps_with === undefined && !entry.is_interrupted)
    .map((entry) => ({
      entry,
      duration: secondsFromEntry(entry, "end") - secondsFromEntry(entry, "start"),
      textLength: String(entry.text ?? "").length,
    }))
    .filter(({ duration, textLength }) => duration >= 4 && textLength >= 70);

  candidates.sort((a, b) => (b.duration + b.textLength / 120) - (a.duration + a.textLength / 120));
  return candidates[0]?.entry ?? entries[0];
}

function findLargestGap(entries) {
  let largest = null;
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const next = entries[index];
    const previousEnd = secondsFromEntry(previous, "end");
    const nextStart = secondsFromEntry(next, "start");
    const gapSeconds = nextStart - previousEnd;
    if (gapSeconds > 0.12 && (!largest || gapSeconds > largest.gapSeconds)) {
      largest = { previous, next, nextStart, gapSeconds };
    }
  }
  return largest;
}

function uniqueSpeakerIds(entries) {
  return [...new Set(entries.map((entry) => entry.speaker_id || entry.speaker || speakerLabel(entry)))];
}

function speakerLabel(entry) {
  return entry.speaker_name || entry.speaker_id || entry.speaker || "speaker";
}

function secondsFromEntry(entry, edge) {
  const value = edge === "start"
    ? entry.start_seconds ?? entry.start ?? 0
    : entry.end_seconds ?? entry.end ?? entry.start_seconds ?? entry.start ?? 0;
  return Number(value) || 0;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function renderCallout(item) {
  const explainer = CALLOUT_EXPLAINERS[item] ?? item;
  const isActive = state.activeCallout === item;
  return `
    <button
      class="callout-chip${isActive ? " is-open" : ""}"
      type="button"
      data-callout="${escapeHtml(item)}"
      aria-expanded="${isActive}"
      aria-controls="callout-detail"
    >
      ${escapeHtml(item)}
    </button>
  `;
}

function renderCalloutDetail() {
  if (!state.activeCallout) {
    els.calloutDetail.classList.remove("is-open");
    els.calloutDetail.innerHTML = "";
    return;
  }

  const explainer = CALLOUT_EXPLAINERS[state.activeCallout] ?? state.activeCallout;
  els.calloutDetail.innerHTML = `
    <div class="callout-bubble">
      <span class="bubble-label">Stitch note</span>
      <strong>${escapeHtml(state.activeCallout)}</strong>
      <p>${escapeHtml(explainer)}</p>
    </div>
  `;
  requestAnimationFrame(() => els.calloutDetail.classList.add("is-open"));
}

function isCutoffEntry(entry) {
  const text = entry.text ?? "";
  return Boolean(entry.is_interrupted || /[-–—]\s*$/.test(text));
}

function renderTranscriptText(text, cutoff) {
  const normalized = String(text ?? "");
  if (!cutoff) return escapeHtml(normalized);

  const match = normalized.match(/^(.*?)([^\s,.!?;:]+)([-–—])\s*$/);
  if (!match) {
    return `${escapeHtml(normalized)} <span class="cut-badge">cut off</span>`;
  }

  return `${escapeHtml(match[1])}<span class="cut-tail">${escapeHtml(match[2])}</span>${escapeHtml(match[3])} <span class="cut-badge">cut off</span>`;
}

function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatDurationPrecise(seconds) {
  const totalHundredths = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const minutes = Math.floor(totalHundredths / 6000);
  const wholeSeconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = String(totalHundredths % 100).padStart(2, "0");
  const remainder = String(wholeSeconds).padStart(2, "0");
  return `${minutes}:${remainder}.${hundredths}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const CALLOUT_EXPLAINERS = {
  "3 distinct speakers": "Three voices stay easy to tell apart.",
  "polite interruption": "A speaker asks for the floor without fully taking over.",
  "speaker gives the floor": "The interrupted speaker briefly grants permission to continue.",
  "natural handoffs": "Turns change without sounding like separate files pasted together.",
  "developer API": "The conversation is driven by structured data, not a loose prompt.",
  "Studio refinement": "The review tool can tag and improve exact moments.",
  "targeted TTS": "Regenerate one affected turn instead of the whole clip.",
  "cost-aware iteration": "The engine can choose cheaper refinement paths when possible.",
};
