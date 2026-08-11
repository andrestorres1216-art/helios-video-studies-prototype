const $ = selector => document.querySelector(selector);
const video = $('#video');
const fileInput = $('#file');
const MAX_VIDEOS = 10;
const MAX_VIDEO_DURATION_SECONDS = 3 * 60;
const CYCLES_FOR_ESTIMATE = 10;
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
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-4-20250514' },
};
const selectedProvider = () => localStorage.getItem('helios-provider') || 'openai';
const selectedModel = () => localStorage.getItem('helios-model') || PROVIDERS[selectedProvider()].defaultModel;
const hasReachEvidence = finding => /reach|bin|container|component location/i.test(`${finding.observation || ''} ${finding.evidence || ''}`);

$('#settingsBtn').onclick = () => {
  const provider = selectedProvider();
  $('#provider').value = provider;
  $('#key').value = localStorage.getItem('helios-key') || '';
  $('#model').value = selectedModel();
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
  const provider = $('#provider').value;
  const oldDefault = PROVIDERS[selectedProvider()]?.defaultModel;
  if (!$('#model').value.trim() || $('#model').value.trim() === oldDefault) $('#model').value = PROVIDERS[provider].defaultModel;
};
$('#saveSettings').onclick = () => {
  const key = $('#key').value.trim();
  if (!key) return toast('Paste an API key before saving.');
  const provider = $('#provider').value;
  localStorage.setItem('helios-key', key);
  localStorage.setItem('helios-provider', provider);
  localStorage.setItem('helios-model', $('#model').value.trim() || PROVIDERS[provider].defaultModel);
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
const scanClip = async (clip, clipNumber, total) => {
  await loadClip(clip);
  const scanCount = Math.min(60, Math.max(24, Math.ceil(video.duration)));
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
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ provider: selectedProvider(), model: selectedModel(), input: [{ role: 'user', content }], text: { format: { type: 'json_object' } } }), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error?.message || 'Analysis failed');
    return JSON.parse(outputTextFor(await response.json()) || '{}');
  } finally { window.clearTimeout(timeout); }
};
const contentFor = (prompt, evidence) => {
  const content = [{ type: 'input_text', text: prompt }];
  evidence.forEach(frame => content.push({ type: 'input_text', text: `Video ${frame.clip}, timestamp ${formatTime(frame.time)}` }, { type: 'input_image', image_url: frame.image, detail: 'low' }));
  return content;
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
    const framesPerClip = Math.max(4, Math.min(60, Math.floor(60 / clips.length)));
    let scanned = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const frames = await scanClip(clips[index], index + 1, clips.length);
      scanned += frames.length;
      sampleEvenly(frames, framesPerClip).forEach(frame => evidence.push({ ...frame, clip: index + 1 }));
    }
    if (analysisCancelled) throw new Error('Analysis cancelled');
    setProgress('Proposing sources and cycle order…');
    const calibrationPrompt = `You are preparing a human-confirmed setup for an industrial cycle-time study from ${clips.length} continuous assembly video clip${clips.length === 1 ? '' : 's'}. From the ordered frames, propose likely material-source containers and the likely ordered cycle steps. Never call a source or step certain: the study lead must confirm it. Do not count cycles or give opportunities yet. Return STRICT JSON: {"source_candidates":["candidate source and visible location"],"cycle_steps":["proposed step in sequence"],"setup_note":"one concise uncertainty note"}.`;
    const calibration = await analyzeContent(contentFor(calibrationPrompt, sampleEvenly(evidence, Math.min(12, evidence.length))), key);
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
    setProgress(`Reviewing ${pendingStudy.evidence.length} evidence frames…`);
    const prompt = `You are a senior industrial engineer reviewing ${pendingStudy.clips.length} continuous assembly video clip${pendingStudy.clips.length === 1 ? '' : 's'} of the same operation. The study lead has confirmed the material source(s): ${sources}. The confirmed cycle order is: ${steps}. The reviewer-confirmed complete-cycle count is ${confirmedCycles}; use that exact count and do not substitute an AI estimate. Use timestamped frames to check whether the confirmed sequence is visible, but do not infer cycles from video duration or file count. Return every distinct evidence-based cycle-time opportunity. A source-location finding must refer only to a confirmed source and cite video/timestamp evidence. Each finding must separate visible observation from experiment; mark unproven mechanism as a hypothesis. Value-added is product-changing work; waste is reach, search, regrip, waiting, and avoidable motion. Do not present any result as measured. Only provide cycle_time when reviewer-confirmed cycles are at least ${CYCLES_FOR_ESTIMATE}; otherwise use an empty string. Return STRICT JSON: {"summary":"one sentence","cycles_observed":${confirmedCycles},"cycle_time":"Preliminary: ~0.0 sec/cycle or empty string","time_distribution":{"value_added_pct":0,"waste_pct":0},"findings":[{"observation":"visible fact only","evidence":"video/timestamp evidence","experiment":"specific change to test","estimated_savings":"Preliminary: ~0.5–1.0 sec/cycle","category":"reach|motion|waiting|material_handling|ergonomics"}],"limitations":"one concise sentence"}`;
    const data = await analyzeContent(contentFor(prompt, pendingStudy.evidence), key);
    data.cycles_observed = confirmedCycles;
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
  const valueAdded = Number(data.time_distribution?.value_added_pct);
  const waste = Number(data.time_distribution?.waste_pct);
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
  if (Number.isFinite(valueAdded) && Number.isFinite(waste)) {
    const total = valueAdded + waste || 100;
    const valuePct = Math.round(valueAdded / total * 100);
    const wastePct = 100 - valuePct;
    $('#lossBar').style.opacity = '1';
    $('#valueAddedBar').style.width = `${valuePct}%`;
    $('#wasteBar').style.width = `${wastePct}%`;
    $('#lossLegend').innerHTML = `<span><i class="dot" style="background:#2485c7"></i>Value-added (AI estimate) <b>${valuePct}%</b></span><span><i class="dot" style="background:#e7b85c"></i>Waste (AI estimate) <b>${wastePct}%</b></span>`;
  }
  $('#confidence').textContent = confidenceFor(observedCycles);
  $('#studyStatus').textContent = 'Study report ready';
  $('#aiStatus').textContent = `REPORT COMPLETE · ${videoCount} CLIP${videoCount === 1 ? '' : 'S'}`;
  $('#reachTag').hidden = !findings.some(hasReachEvidence);
  const review = `<div class="review-summary"><b>Study report:</b> ${escapeHtml(data.summary || 'Review complete.')}<br><span>${escapeHtml(data.limitations || `Reviewed ${evidenceCount} frames from ${scannedCount} local scans.`)}</span></div>`;
  const rows = findings.length ? `<div class="eyebrow" style="margin-top:16px">OBSERVATIONS &amp; EXPERIMENTS</div>${findings.map((finding, index) => `<div class="finding"><div class="rank">${String(index + 1).padStart(2, '0')}</div><div class="finding-label">OBSERVATION</div><div class="finding-copy">${escapeHtml(`${finding.observation || ''} ${finding.evidence || ''}`)}</div><div class="finding-label">EXPERIMENT TO RUN</div><div class="finding-copy">${escapeHtml(finding.experiment || 'Define a controlled work-method test')}</div><div class="saving">Estimated saving: ${escapeHtml(finding.estimated_savings || 'Preliminary — validate with timed cycles')}</div></div>`).join('')}` : '<div class="detail" style="padding:14px 0">No finding was supported by this evidence set.</div>';
  $('#opportunityRows').innerHTML = review + rows;
  $('#analysisHint').innerHTML = `<b>Report complete:</b> ${videoCount} video${videoCount === 1 ? '' : 's'} reviewed; ${observedCycles} complete cycles observed. Confidence: ${confidenceFor(observedCycles)}.`;
  toast('Work-method report complete.');
}
