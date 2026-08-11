const $ = selector => document.querySelector(selector);
const video = $('#video');
const fileInput = $('#file');
const MAX_VIDEOS = 10;
const MAX_VIDEO_DURATION_SECONDS = 3 * 60;
const CYCLES_FOR_ESTIMATE = 10;
const MAX_IMAGES_PER_ANALYSIS_BATCH = 10;
const EVIDENCE_FRAMES_PER_SECOND = 1;
let studyFiles = [];
let analysisCancelled = false;
let pendingStudy = null;

const confidenceFor = cycles => cycles < 5 ? 'Low' : cycles < CYCLES_FOR_ESTIMATE ? 'Medium' : 'High';
const formatTime = seconds => {
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const toast = message => {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove('show'), 4200);
};
const setProgress = text => {
  const element = $('#analysisProgress');
  if (element) element.textContent = text;
};
const ensureLoadingUi = () => {
  const loader = $('#analysisLoading');
  if (!loader.querySelector('#analysisProgress')) {
    loader.querySelector('.analysis-loading-card').insertAdjacentHTML('beforeend', '<div id="analysisProgress" style="font-size:12px;color:#687384;font-weight:500">Preparing videos…</div><button class="secondary" id="cancelAnalysis">Cancel</button>');
    $('#cancelAnalysis').onclick = () => { analysisCancelled = true; setProgress('Cancelling…'); };
  }
  return loader;
};
const PROVIDERS = {
  'azure-openai': {
    label: 'Azure OpenAI',
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
    ],
  },
  openai: { label: 'OpenAI', models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }] },
  anthropic: { label: 'Anthropic', models: [{ id: 'claude-opus-5', label: 'Claude Opus 5' }] },
};
const DEFAULT_AZURE_ENDPOINT = 'https://opsexcellence.openai.azure.com/openai/v1';
const selectedProvider = () => localStorage.getItem('helios-provider') || 'azure-openai';
const selectedModel = () => {
  const provider = PROVIDERS[selectedProvider()];
  const saved = localStorage.getItem('helios-model');
  return provider.models.some(model => model.id === saved) ? saved : provider.models[0].id;
};
const updateModelOptions = () => {
  const provider = PROVIDERS[$('#provider').value];
  const current = $('#model').value || selectedModel();
  $('#model').innerHTML = provider.models.map(model => `<option value="${model.id}">${model.label}</option>`).join('');
  $('#model').value = provider.models.some(model => model.id === current) ? current : provider.models[0].id;
  $('#azureEndpointField').hidden = $('#provider').value !== 'azure-openai';
};
const hasReachEvidence = finding => /reach|bin|container|component location/i.test(`${finding.observation || ''} ${finding.evidence || ''}`);

$('#settingsBtn').onclick = () => {
  const provider = selectedProvider();
  $('#provider').value = provider;
  $('#key').value = localStorage.getItem('helios-key') || '';
  $('#azureEndpoint').value = localStorage.getItem('helios-azure-endpoint') || DEFAULT_AZURE_ENDPOINT;
  updateModelOptions();
  $('#settings').classList.add('open');
  $('#key').focus();
};
$('#closeSettings').onclick = () => $('#settings').classList.remove('open');
$('#clearSettings').onclick = () => {
  localStorage.removeItem('helios-key');
  $('#key').value = '';
  toast('Saved API key cleared.');
};
$('#provider').onchange = () => {
  updateModelOptions();
};
$('#saveSettings').onclick = () => {
  const key = $('#key').value.trim();
  if (!key) return toast('Paste an API key before saving.');
  const provider = $('#provider').value;
  const azureEndpoint = $('#azureEndpoint').value.trim().replace(/\/+$/, '');
  if (provider === 'azure-openai' && !azureEndpoint) return toast('Add the Azure endpoint before saving.');
  localStorage.setItem('helios-key', key);
  localStorage.setItem('helios-provider', provider);
  localStorage.setItem('helios-model', $('#model').value);
  if (provider === 'azure-openai') localStorage.setItem('helios-azure-endpoint', azureEndpoint);
  $('#settings').classList.remove('open');
  toast('AI settings saved locally.');
};
$('#editTitle').onclick = () => {
  const title = prompt('Study title', $('#studyTitle').textContent);
  if (title?.trim()) $('#studyTitle').textContent = title.trim();
};
$('#uploadBtn').onclick = () => fileInput.click();

const durationFor = file => new Promise((resolve, reject) => {
  const probe = document.createElement('video');
  const url = URL.createObjectURL(file);
  const cleanup = () => URL.revokeObjectURL(url);
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => { const duration = probe.duration; cleanup(); resolve(duration); };
  probe.onerror = () => { cleanup(); reject(new Error(`Could not read ${file.name}`)); };
  probe.src = url;
});

fileInput.onchange = async event => {
  const chosen = [...event.target.files].slice(0, MAX_VIDEOS);
  if ([...event.target.files].length > MAX_VIDEOS) toast(`Only the first ${MAX_VIDEOS} videos can be loaded.`);
  const checked = await Promise.all(chosen.map(async file => {
    try { return { file, duration: await durationFor(file) }; }
    catch { return { file, duration: NaN }; }
  }));
  const rejected = checked.filter(({ duration }) => !Number.isFinite(duration) || duration > MAX_VIDEO_DURATION_SECONDS);
  studyFiles = checked.filter(({ duration }) => Number.isFinite(duration) && duration > 0 && duration <= MAX_VIDEO_DURATION_SECONDS).map(({ file }) => file);
  pendingStudy = null;
  if (rejected.length) toast(`${rejected.length} video${rejected.length === 1 ? '' : 's'} skipped: each video must be 3 minutes or less.`);
  if (!studyFiles.length) return;
  video.src = URL.createObjectURL(studyFiles[0]);
  video.style.display = 'block';
  $('#emptyVideo').style.display = 'none';
  const count = studyFiles.length;
  $('#studyStatus').textContent = count === 1 ? '1 video ready' : `${count} videos ready`;
  $('#aiStatus').textContent = `READY · ${count} CLIP${count === 1 ? '' : 'S'}`;
  $('#confidence').textContent = 'Low';
  $('#cycle').textContent = '—';
  $('#cycleLabel').textContent = `AI cycle-time estimate requires ${CYCLES_FOR_ESTIMATE} complete observed cycles`;
  $('#cycles').textContent = '—';
  $('#cyclesLabel').textContent = 'cycles observed';
  $('#lossBar').style.opacity = '.28';
  $('#lossLegend').innerHTML = '<span>Run analysis to generate directional findings.</span>';
  $('#reachTag').hidden = true;
  $('#timeline').hidden = true;
  $('#opportunityRows').innerHTML = `<div class="detail" style="padding:22px 0">${count}/${MAX_VIDEOS} videos loaded. Run analysis to identify complete cycles and work-method opportunities.</div>`;
  $('#analysisHint').innerHTML = `<b>Upload guidance:</b> ${count}/${MAX_VIDEOS} videos loaded, each up to 3 minutes. Confidence is based on complete cycles observed: low 0–4, medium 5–9, high 10+.`;
  fileInput.value = '';
};

video.ontimeupdate = () => {
  if (!video.duration) return;
  $('#time').textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  $('#prog').style.width = `${video.currentTime / video.duration * 100}%`;
};

const loadClip = clip => new Promise((resolve, reject) => {
  video.pause();
  video.src = URL.createObjectURL(clip);
  video.onloadedmetadata = () => resolve();
  video.onerror = () => reject(new Error(`Could not read ${clip.name}`));
});
const captureFrame = time => new Promise((resolve, reject) => {
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 400);
    canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    resolve({ time, image: canvas.toDataURL('image/jpeg', .5) });
  };
  video.addEventListener('seeked', done, { once: true });
  video.currentTime = Math.min(time, Math.max(0, video.duration - .1));
  window.setTimeout(() => { if (!settled) { settled = true; reject(new Error('Frame capture timed out')); } }, 5000);
});
const sampleEvenly = (items, count) => {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / (count - 1))]);
};
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const timeSplitFromBatches = (reports, expectedFrames) => {
  let valueAdded = 0;
  let avoidableWaste = 0;
  let uncertainOrRequired = 0;
  for (const report of reports) {
    const split = report?.time_split || {};
    const values = ['value_added_frames', 'avoidable_waste_frames', 'uncertain_or_required_frames']
      .map(key => Number(split[key]));
    if (!values.every(value => Number.isInteger(value) && value >= 0) || values.reduce((sum, value) => sum + value, 0) === 0) return null;
    [valueAdded, avoidableWaste, uncertainOrRequired] = [valueAdded + values[0], avoidableWaste + values[1], uncertainOrRequired + values[2]];
  }
  const classified = valueAdded + avoidableWaste;
  if (!classified || valueAdded + avoidableWaste + uncertainOrRequired !== expectedFrames) return null;
  return {
    value_added_pct: Math.round(valueAdded / classified * 100),
    waste_pct: 100 - Math.round(valueAdded / classified * 100),
    classified_frames: classified,
    excluded_frames: uncertainOrRequired,
  };
};
const evidencePointsFor = finding => (Array.isArray(finding?.evidence_points) ? finding.evidence_points : [])
  .map(point => ({ clip: Number(point.clip), time: Number(point.time_seconds) }))
  .filter(point => Number.isInteger(point.clip) && point.clip >= 1 && point.clip <= studyFiles.length && Number.isFinite(point.time) && point.time >= 0)
  .slice(0, 3);
const evidenceHtml = finding => {
  const text = escapeHtml(finding?.evidence || 'Visible evidence in the reviewed video.');
  const links = evidencePointsFor(finding).map(point => `<button type="button" class="evidence-link" data-clip="${point.clip}" data-time="${point.time}">Clip ${point.clip} · ${formatTime(point.time)}</button>`).join('');
  return `${text}${links ? ` ${links}` : ''}`;
};
const potentialReductionFrom = findings => {
  const included = findings.map((finding, index) => ({ estimate: finding?.reduction_to_validate, index: index + 1 }))
    .filter(({ estimate }) => estimate?.independent === true)
    .map(({ estimate, index }) => ({ low: Number(estimate.low_sec_per_cycle), high: Number(estimate.high_sec_per_cycle), index }))
    .filter(({ low, high }) => Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low && high <= 60);
  if (!included.length) return null;
  return { low: included.reduce((sum, item) => sum + item.low, 0), high: included.reduce((sum, item) => sum + item.high, 0), indexes: included.map(item => item.index) };
};
const formatSeconds = seconds => Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
const bindEvidenceLinks = () => document.querySelectorAll('.evidence-link').forEach(link => {
  link.onclick = async () => {
    const clipNumber = Number(link.dataset.clip);
    const seconds = Number(link.dataset.time);
    const clip = studyFiles[clipNumber - 1];
    if (!clip || !Number.isFinite(seconds)) return toast('That evidence clip is no longer available.');
    try {
      await loadClip(clip);
      video.currentTime = Math.min(seconds, Math.max(0, video.duration - .1));
      video.play().catch(() => {});
      $('#studyStatus').textContent = `Viewing evidence · clip ${clipNumber} at ${formatTime(seconds)}`;
    } catch { toast('Could not open the evidence clip.'); }
  };
});
const scanClip = async (clip, clipNumber, total) => {
  await loadClip(clip);
  // Preserve one timestamped evidence frame per second for every accepted clip.
  // Azure's limit is handled only at request batching time below.
  const scanCount = Math.min(MAX_VIDEO_DURATION_SECONDS * EVIDENCE_FRAMES_PER_SECOND, Math.max(24, Math.ceil(video.duration * EVIDENCE_FRAMES_PER_SECOND)));
  const frames = [];
  for (let index = 0; index < scanCount; index += 1) {
    if (analysisCancelled) throw new Error('Analysis cancelled');
    const time = index * Math.max(.01, (video.duration - .1) / Math.max(1, scanCount - 1));
    frames.push(await captureFrame(time));
    setProgress(`Scanning video ${clipNumber}/${total}: ${index + 1}/${scanCount}`);
  }
  return frames;
};

const outputTextFor = output => output.output_text || output.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text' || item.type === 'text').map(item => item.text || '').join('') || '';
const analyzeContent = async (content, key) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ provider: selectedProvider(), model: selectedModel(), azureEndpoint: localStorage.getItem('helios-azure-endpoint') || DEFAULT_AZURE_ENDPOINT, input: [{ role: 'user', content }], text: { format: { type: 'json_object' } } }), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error?.message || 'Analysis failed');
    return JSON.parse(outputTextFor(await response.json()) || '{}');
  } finally { window.clearTimeout(timeout); }
};
const contentFor = (prompt, evidence) => {
  const content = [{ type: 'input_text', text: prompt }];
  evidence.forEach(frame => content.push({ type: 'input_text', text: `Video ${frame.clip}, timestamp ${formatTime(frame.time)}` }, { type: 'input_image', image_url: frame.image, detail: 'low' }));
  return content;
};
const DENSE_EVIDENCE_FPS = 5;
const DENSE_EVIDENCE_WINDOW_SECONDS = 4;
const denseEvidenceFor = async finding => {
  const frames = [];
  for (const point of evidencePointsFor(finding)) {
    const clip = studyFiles[point.clip - 1];
    if (!clip) continue;
    try {
      await loadClip(clip);
      const start = Math.max(0, point.time - DENSE_EVIDENCE_WINDOW_SECONDS / 2);
      const end = Math.min(Math.max(0, video.duration - .1), point.time + DENSE_EVIDENCE_WINDOW_SECONDS / 2);
      for (let time = start; time <= end + .001; time += 1 / DENSE_EVIDENCE_FPS) {
        frames.push({ ...(await captureFrame(time)), clip: point.clip });
      }
    } catch { /* Preserve the finding even when one source clip cannot be reopened. */ }
  }
  return frames;
};
const calibratedReductionFor = async (finding, index, total, key) => {
  const evidence = await denseEvidenceFor(finding);
  if (!evidence.length) return { low_sec_per_cycle: 0, high_sec_per_cycle: 0, independent: false, confidence: 'low', basis: 'Dense video evidence could not be captured.' };
  const batchReports = [];
  const batches = chunk(evidence, MAX_IMAGES_PER_ANALYSIS_BATCH);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    setProgress(`Measuring opportunity ${index}/${total}: window ${batchIndex + 1}/${batches.length}…`);
    const prompt = `You are measuring the visible time in a short, dense video sequence for one industrial-engineering opportunity. The sampled frames are chronological and spaced approximately ${1 / DENSE_EVIDENCE_FPS} seconds apart. Opportunity: ${finding.observation}. Evidence claim: ${finding.evidence}. Identify only visible avoidable motion, reach, search, regrip, or waiting related to this specific opportunity. Do not count required quality, safety, inspection, or product-changing work as recoverable. Estimate a conservative observed avoidable-duration range for this window and state whether the sequence is too ambiguous to estimate. Never use a canned range or claim stopwatch precision. Return STRICT JSON: {"window_summary":"one sentence","avoidable_duration_low_sec":0,"avoidable_duration_high_sec":0,"recoverable_fraction_low":0,"recoverable_fraction_high":0,"basis":"visible timing evidence and uncertainty"}.`;
    batchReports.push(await analyzeContent(contentFor(prompt, batches[batchIndex]), key));
  }
  const synthesisPrompt = `You are consolidating dense video measurements for one work-method opportunity. The original finding is: ${finding.observation}. Its evidence is: ${finding.evidence}. The reports below are from chronological frames approximately ${1 / DENSE_EVIDENCE_FPS} seconds apart around every linked occurrence. Give a conservative estimated cycle-time reduction only from visible avoidable duration and the demonstrated repetition in the linked clips. If the evidence is ambiguous, use 0 for both values. Do not use a generic range and do not claim precision below 0.2 seconds. Return STRICT JSON: {"low_sec_per_cycle":0,"high_sec_per_cycle":0,"confidence":"low|medium|high","basis":"one concise evidence-based sentence"}. Reports:\n${JSON.stringify(batchReports)}`;
  const result = await analyzeContent([{ type: 'input_text', text: synthesisPrompt }], key);
  const low = Number(result.low_sec_per_cycle);
  const high = Number(result.high_sec_per_cycle);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low || high > 60) return { low_sec_per_cycle: 0, high_sec_per_cycle: 0, independent: false, confidence: 'low', basis: 'Dense video evidence did not support a range.' };
  return { low_sec_per_cycle: low, high_sec_per_cycle: high, independent: false, confidence: ['low', 'medium', 'high'].includes(result.confidence) ? result.confidence : 'low', basis: String(result.basis || 'Estimated from dense timestamped video frames.') };
};
const markIndependentReductions = async (findings, key) => {
  const candidates = findings.map((finding, index) => ({ index: index + 1, observation: finding.observation, experiment: finding.experiment, reduction: finding.reduction_to_validate }))
    .filter(item => Number(item.reduction?.high_sec_per_cycle) > 0);
  if (!candidates.length) return;
  const prompt = `You are reviewing possible cycle-time reductions from one operation. Select only findings that can be added without double-counting the same seconds of work. If two experiments address the same reach, motion, or wait, include only the stronger one. Return STRICT JSON: {"independent_finding_indexes":[1]}. Candidates:\n${JSON.stringify(candidates)}`;
  const decision = await analyzeContent([{ type: 'input_text', text: prompt }], key);
  const included = new Set((Array.isArray(decision.independent_finding_indexes) ? decision.independent_finding_indexes : []).map(Number));
  findings.forEach((finding, index) => { if (finding.reduction_to_validate) finding.reduction_to_validate.independent = included.has(index + 1); });
};
const stepsText = steps => Array.isArray(steps) ? steps.map((step, index) => `${index + 1}. ${typeof step === 'string' ? step : step.step || step.name || ''}`).filter(Boolean).join('\n') : '';
const sourcesText = sources => Array.isArray(sources) ? sources.map(source => typeof source === 'string' ? source : source.label || source.description || source.location || '').filter(Boolean).join('\n') : '';

$('#analyzeBtn').onclick = async () => {
  if (!studyFiles.length) return toast('Upload a video first.');
  const key = localStorage.getItem('helios-key');
  if (!key) { $('#settings').classList.add('open'); return toast('Add an API key to enable analysis.'); }

  const button = $('#analyzeBtn');
  const loader = ensureLoadingUi();
  analysisCancelled = false;
  button.disabled = true;
  loader.classList.add('open');
  try {
    const clips = studyFiles;
    const evidence = [];
    let scanned = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const frames = await scanClip(clips[index], index + 1, clips.length);
      scanned += frames.length;
      frames.forEach(frame => evidence.push({ ...frame, clip: index + 1 }));
    }
    if (analysisCancelled) throw new Error('Analysis cancelled');
    setProgress('Proposing sources and cycle order…');
    const calibrationPrompt = `You are preparing a human-confirmed setup for an industrial cycle-time study from ${clips.length} continuous assembly video clip${clips.length === 1 ? '' : 's'}. From the ordered frames, propose likely material-source containers and the likely ordered cycle steps. Never call a source or step certain: the study lead must confirm it. Do not count cycles or give opportunities yet. Return STRICT JSON: {"source_candidates":["candidate source and visible location"],"cycle_steps":["proposed step in sequence"],"setup_note":"one concise uncertainty note"}.`;
    const calibration = await analyzeContent(contentFor(calibrationPrompt, sampleEvenly(evidence, Math.min(MAX_IMAGES_PER_ANALYSIS_BATCH, evidence.length))), key);
    pendingStudy = { clips, evidence, scanned };
    $('#confirmedSources').value = sourcesText(calibration.source_candidates);
    $('#confirmedSteps').value = stepsText(calibration.cycle_steps);
    $('#confirmedCycleCount').value = '';
    $('#studySetup').classList.add('open');
    $('#aiStatus').textContent = 'CONFIRM SOURCES & CYCLE ORDER';
    toast(calibration.setup_note || 'Confirm the proposed sources and cycle order before the report runs.');
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Analysis timed out. Try shorter clips or fewer videos.' : error.message;
    $('#aiStatus').textContent = message === 'Analysis cancelled' ? 'ANALYSIS CANCELLED' : 'ANALYSIS FAILED';
    toast(message);
  } finally {
    button.disabled = false;
    loader.classList.remove('open');
  }
};

$('#cancelStudySetup').onclick = () => {
  pendingStudy = null;
  $('#studySetup').classList.remove('open');
  $('#aiStatus').textContent = 'SETUP NOT CONFIRMED';
};

$('#confirmStudySetup').onclick = async () => {
  const sources = $('#confirmedSources').value.trim();
  const steps = $('#confirmedSteps').value.trim();
  const cycleCountInput = $('#confirmedCycleCount').value.trim();
  const confirmedCycles = Number(cycleCountInput);
  if (!sources || !steps || !cycleCountInput || !Number.isInteger(confirmedCycles) || confirmedCycles < 0) return toast('Confirm the material source, cycle order, and complete-cycle count before continuing.');
  if (!pendingStudy) return toast('Run the setup review again.');
  const key = localStorage.getItem('helios-key');
  const button = $('#analyzeBtn');
  const loader = ensureLoadingUi();
  $('#studySetup').classList.remove('open');
  analysisCancelled = false;
  button.disabled = true;
  loader.classList.add('open');
  try {
    const batches = chunk(pendingStudy.evidence, MAX_IMAGES_PER_ANALYSIS_BATCH);
    const batchReports = [];
    for (let index = 0; index < batches.length; index += 1) {
      setProgress(`Reviewing evidence batch ${index + 1}/${batches.length} (${batches[index].length} frames)…`);
      const batchPrompt = `You are a senior industrial engineer reviewing chronological evidence batch ${index + 1} of ${batches.length} from a continuous assembly video study. The study lead has confirmed the material source(s): ${sources}. The confirmed cycle order is: ${steps}. The reviewer-confirmed complete-cycle count is ${confirmedCycles}; do not substitute an AI estimate. Report only visible, evidence-based work-method opportunities in these timestamped frames. A source-location finding must refer only to a confirmed source. Separate visible observation from the experiment to test it; mark unproven mechanism as a hypothesis. Do not present results as measured. Every finding must include one to three structured evidence_points using the exact clip number and timestamp supplied with the frame. Also classify all ${batches[index].length} sampled frames by their visible state: value-added = directly changes the product in the confirmed cycle; avoidable waste = visible reach, search, regrip, waiting, or avoidable motion; uncertain-or-required = cannot be reliably classified from the frame or may be required work. Do not call required inspection, safety, or quality work waste without clear visual evidence. The three frame counts must be non-negative integers totaling exactly ${batches[index].length}. Return STRICT JSON: {"batch_summary":"one sentence","time_split":{"value_added_frames":0,"avoidable_waste_frames":0,"uncertain_or_required_frames":0,"basis":"brief visual basis with timestamps"},"findings":[{"observation":"visible fact only","evidence":"short evidence sentence","evidence_points":[{"clip":1,"time_seconds":0}],"experiment":"specific change to test","category":"reach|motion|waiting|material_handling|ergonomics"}],"limitations":"one concise uncertainty note"}. Include at most 5 distinct findings.`;
      batchReports.push(await analyzeContent(contentFor(batchPrompt, batches[index]), key));
    }
    setProgress('Synthesizing findings across all evidence batches…');
    const synthesisPrompt = `You are a senior industrial engineer synthesizing chronological evidence-batch reviews from ${pendingStudy.clips.length} continuous assembly video clip${pendingStudy.clips.length === 1 ? '' : 's'} of the same operation. The study lead has confirmed the material source(s): ${sources}. The confirmed cycle order is: ${steps}. The reviewer-confirmed complete-cycle count is ${confirmedCycles}; use that exact count and do not substitute an AI estimate. Deduplicate overlapping findings across batches. Retain only evidence-based findings with their structured clip/timestamp evidence_points; do not invent timestamps or alter clip numbers. A source-location finding must refer only to a confirmed source. Each finding must separate visible observation from experiment; mark unproven mechanism as a hypothesis. Do not present any result as measured. For each finding, provide reduction_to_validate only when the visible evidence supports a conservative directional range; never use a generic range, never imply precision below one second, and use zeroes when no defensible range is possible. Set independent true only if its experiment does not overlap with another included experiment; when uncertain, set it false. Only provide cycle_time when reviewer-confirmed cycles are at least ${CYCLES_FOR_ESTIMATE}; otherwise use an empty string. Return STRICT JSON: {"summary":"one sentence","cycles_observed":${confirmedCycles},"cycle_time":"Preliminary: ~0 sec/cycle or empty string","findings":[{"observation":"visible fact only","evidence":"short evidence sentence","evidence_points":[{"clip":1,"time_seconds":0}],"experiment":"specific change to test","reduction_to_validate":{"low_sec_per_cycle":0,"high_sec_per_cycle":0,"independent":false,"basis":"why this range is or is not defensible from the video"},"category":"reach|motion|waiting|material_handling|ergonomics"}],"limitations":"one concise sentence"}. Evidence-batch reviews follow:\n${JSON.stringify(batchReports)}`;
    const data = await analyzeContent([{ type: 'input_text', text: synthesisPrompt }], key);
    data.cycles_observed = confirmedCycles;
    data.time_distribution = timeSplitFromBatches(batchReports, pendingStudy.evidence.length);
    const findings = Array.isArray(data.findings) ? data.findings : [];
    for (let index = 0; index < findings.length; index += 1) {
      findings[index].reduction_to_validate = await calibratedReductionFor(findings[index], index + 1, findings.length, key);
    }
    setProgress('Checking which reduction estimates can be combined…');
    await markIndependentReductions(findings, key);
    data.findings = findings;
    renderReport(data, pendingStudy.clips.length, pendingStudy.evidence.length, pendingStudy.scanned, true);
    pendingStudy = null;
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Analysis timed out. Try shorter clips or fewer videos.' : error.message;
    $('#aiStatus').textContent = 'ANALYSIS FAILED';
    toast(message);
  } finally {
    button.disabled = false;
    loader.classList.remove('open');
  }
};

function renderReport(data, videoCount, evidenceCount, scannedCount, reviewerConfirmedCycles = false) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const cycles = Number(data.cycles_observed);
  $('#cycles').textContent = Number.isFinite(cycles) ? cycles : '—';
  $('#cyclesLabel').textContent = reviewerConfirmedCycles ? 'reviewer-confirmed cycles' : 'cycles observed';
  const observedCycles = Number.isFinite(cycles) ? cycles : 0;
  if (observedCycles >= CYCLES_FOR_ESTIMATE && data.cycle_time) {
    $('#cycle').textContent = data.cycle_time;
    $('#cycleLabel').textContent = `AI cycle-time estimate from ${observedCycles} observed cycles — validate with a timed study`;
  } else {
    $('#cycle').textContent = 'Not measured';
    const missing = Math.max(0, CYCLES_FOR_ESTIMATE - observedCycles);
    $('#cycleLabel').textContent = `${observedCycles}/${CYCLES_FOR_ESTIMATE} complete cycles observed — ${missing} more needed for an AI estimate`;
  }
  const distribution = data.time_distribution;
  const valueAdded = Number(distribution?.value_added_pct);
  const waste = Number(distribution?.waste_pct);
  const hasVideoSplit = Number.isInteger(valueAdded) && Number.isInteger(waste) && valueAdded >= 0 && waste >= 0 && valueAdded + waste === 100;
  if (hasVideoSplit) {
    $('#distributionLabel').textContent = 'VIDEO-DERIVED TIME SPLIT';
    $('#lossBar').style.opacity = '1';
    $('#valueAddedBar').style.width = `${valueAdded}%`;
    $('#valueAddedBar').style.background = '#2485c7';
    $('#wasteBar').style.width = `${waste}%`;
    $('#wasteBar').style.background = '#e7b85c';
    const classified = distribution.classified_frames || 0;
    const excluded = distribution.excluded_frames || 0;
    $('#lossLegend').innerHTML = `<span><i class="dot" style="background:#2485c7"></i>Value-added (sampled estimate) <b>${valueAdded}%</b></span><span><i class="dot" style="background:#e7b85c"></i>Observed waste (sampled estimate) <b>${waste}%</b></span><span>Based on ${classified} visually classified frames${excluded ? `; ${excluded} uncertain/required frames excluded` : ''}. Verify with timed observation.</span>`;
  } else {
    $('#distributionLabel').textContent = 'TIME SPLIT';
    $('#lossBar').style.opacity = '.28';
    $('#lossLegend').innerHTML = '<span>Video evidence could not support a time-split estimate. Use a timed study to measure value-added and waste time.</span>';
  }
  $('#confidence').textContent = confidenceFor(observedCycles);
  $('#studyStatus').textContent = 'Study report ready';
  $('#aiStatus').textContent = `REPORT COMPLETE · ${videoCount} CLIP${videoCount === 1 ? '' : 'S'}`;
  $('#reachTag').hidden = !findings.some(hasReachEvidence);
  const review = `<div class="review-summary"><b>Study report:</b> ${escapeHtml(data.summary || 'Review complete.')}<br><span>${escapeHtml(data.limitations || `Reviewed ${evidenceCount} frames from ${scannedCount} local scans.`)}</span></div>`;
  const potential = potentialReductionFrom(findings);
  const rows = findings.length ? `<div class="eyebrow" style="margin-top:16px">OBSERVATIONS &amp; EXPERIMENTS</div>${findings.map((finding, index) => {
    const estimate = finding.reduction_to_validate;
    const low = Number(estimate?.low_sec_per_cycle);
    const high = Number(estimate?.high_sec_per_cycle);
    const hasEstimate = Number.isFinite(low) && Number.isFinite(high) && high >= low && high > 0;
    const reduction = hasEstimate ? `<div class="saving">Reduction to validate: ${formatSeconds(low)}–${formatSeconds(high)} sec/cycle</div>` : '';
    return `<div class="finding"><div class="rank">${String(index + 1).padStart(2, '0')}</div><div class="finding-label">OBSERVATION</div><div class="finding-copy">${escapeHtml(finding.observation || '')} ${evidenceHtml(finding)}</div><div class="finding-label">EXPERIMENT TO RUN</div><div class="finding-copy">${escapeHtml(finding.experiment || 'Define a controlled work-method test')}</div>${reduction}</div>`;
  }).join('')}${potential ? `<div class="reduction-total"><span>Potential cycle-time reduction to validate</span><strong>${formatSeconds(potential.low)}–${formatSeconds(potential.high)} sec/cycle</strong><small>Totals only independent experiments ${potential.indexes.join(', ')}; verify with a before/after timed study.</small></div>` : '<div class="reduction-total muted-total"><span>Potential cycle-time reduction</span><small>Not totaled: the video did not support independent, non-overlapping time ranges. Validate with a timed study.</small></div>'}` : '<div class="detail" style="padding:14px 0">No finding was supported by this evidence set.</div>';
  $('#opportunityRows').innerHTML = review + rows;
  bindEvidenceLinks();
  $('#analysisHint').innerHTML = `<b>Report complete:</b> ${videoCount} video${videoCount === 1 ? '' : 's'} reviewed; ${observedCycles} complete cycles observed. Confidence: ${confidenceFor(observedCycles)}.`;
  toast('Work-method report complete.');
}
