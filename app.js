const $ = selector => document.querySelector(selector);
const video = $('#video');
const fileInput = $('#file');
const MAX_VIDEOS = 10;
let studyFiles = [];
let analysisCancelled = false;

const confidenceFor = count => count < 5 ? 'Low' : count < 10 ? 'Medium' : 'High';
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
const selectedModel = () => localStorage.getItem('helios-model') || 'gpt-4.1';
const hasReachEvidence = finding => /reach|bin|container|component location/i.test(`${finding.observation || ''} ${finding.evidence || ''}`);

$('#settingsBtn').onclick = () => {
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
$('#saveSettings').onclick = () => {
  const key = $('#key').value.trim();
  if (!key) return toast('Paste an API key before saving.');
  localStorage.setItem('helios-key', key);
  localStorage.setItem('helios-model', $('#model').value.trim() || 'gpt-4.1');
  $('#settings').classList.remove('open');
  toast('AI settings saved locally.');
};
$('#editTitle').onclick = () => {
  const title = prompt('Study title', $('#studyTitle').textContent);
  if (title?.trim()) $('#studyTitle').textContent = title.trim();
};
$('#uploadBtn').onclick = () => fileInput.click();

fileInput.onchange = event => {
  const chosen = [...event.target.files];
  studyFiles = chosen.slice(0, MAX_VIDEOS);
  if (!studyFiles.length) return;
  if (chosen.length > MAX_VIDEOS) toast(`Only the first ${MAX_VIDEOS} videos were loaded.`);
  video.src = URL.createObjectURL(studyFiles[0]);
  video.style.display = 'block';
  $('#emptyVideo').style.display = 'none';
  const count = studyFiles.length;
  $('#studyStatus').textContent = count === 1 ? '1 video ready' : `${count} videos ready`;
  $('#aiStatus').textContent = `READY · ${count} CLIP${count === 1 ? '' : 'S'}`;
  $('#confidence').textContent = confidenceFor(count);
  $('#cycle').textContent = '—';
  $('#cycleLabel').textContent = 'AI cycle-time estimate requires 10 videos';
  $('#cycles').textContent = '—';
  $('#lossBar').style.opacity = '.28';
  $('#lossLegend').innerHTML = '<span>Run analysis to generate directional findings.</span>';
  $('#reachTag').hidden = true;
  $('#timeline').hidden = true;
  $('#opportunityRows').innerHTML = `<div class="detail" style="padding:22px 0">${count}/10 videos loaded. Run analysis for a directional work-method review.</div>`;
  $('#analysisHint').innerHTML = `<b>Confidence:</b> ${confidenceFor(count)} with ${count}/10 videos. Low: 0–4, medium: 5–9, high: 10.`;
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
    canvas.width = Math.min(video.videoWidth, 480);
    canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    resolve({ time, image: canvas.toDataURL('image/jpeg', .62) });
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
  const scanCount = Math.min(30, Math.max(12, Math.ceil(video.duration * 2)));
  const frames = [];
  for (let index = 0; index < scanCount; index += 1) {
    if (analysisCancelled) throw new Error('Analysis cancelled');
    const time = index * Math.max(.01, (video.duration - .1) / Math.max(1, scanCount - 1));
    frames.push(await captureFrame(time));
    setProgress(`Scanning video ${clipNumber}/${total}: ${index + 1}/${scanCount}`);
  }
  return frames;
};

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
    const framesPerClip = Math.max(4, Math.min(8, Math.floor(24 / clips.length)));
    let scanned = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const frames = await scanClip(clips[index], index + 1, clips.length);
      scanned += frames.length;
      sampleEvenly(frames, framesPerClip).forEach(frame => evidence.push({ ...frame, clip: index + 1 }));
    }
    if (analysisCancelled) throw new Error('Analysis cancelled');
    setProgress(`Reviewing ${evidence.length} evidence frames…`);
    const prompt = `You are a senior industrial engineer reviewing ${clips.length} assembly video clips of the same operation. Return every distinct, evidence-based cycle-time opportunity. Each finding must include visible observation, a matching experiment, cautious directional time saving, category, and clip/timestamp evidence. Value-added is product-changing work; waste is reach, search, regrip, waiting, and avoidable motion. Do not present any result as measured. Return STRICT JSON: {"summary":"one sentence","cycles_observed":0,"cycle_time":"Preliminary: ~0.0 sec/cycle","time_distribution":{"value_added_pct":0,"waste_pct":0},"findings":[{"observation":"what is visibly happening","evidence":"clip/timestamp evidence","experiment":"specific change to test","estimated_savings":"Preliminary: ~0.5–1.0 sec/cycle","category":"reach|motion|waiting|material_handling|ergonomics"}],"limitations":"one concise sentence"}`;
    const content = [{ type: 'input_text', text: prompt }];
    evidence.forEach(frame => content.push({ type: 'input_text', text: `Video ${frame.clip}, timestamp ${formatTime(frame.time)}` }, { type: 'input_image', image_url: frame.image, detail: 'low' }));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55000);
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: selectedModel(), input: [{ role: 'user', content }], text: { format: { type: 'json_object' } } }), signal: controller.signal });
    window.clearTimeout(timeout);
    if (!response.ok) throw new Error((await response.json()).error?.message || 'Analysis failed');
    const output = await response.json();
    const outputText = output.output_text || output.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text' || item.type === 'text').map(item => item.text || '').join('') || '';
    const data = JSON.parse(outputText || '{}');
    renderReport(data, clips.length, evidence.length, scanned);
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Analysis timed out. Try shorter clips or fewer videos.' : error.message;
    $('#aiStatus').textContent = message === 'Analysis cancelled' ? 'ANALYSIS CANCELLED' : 'ANALYSIS FAILED';
    toast(message);
  } finally {
    button.disabled = false;
    loader.classList.remove('open');
  }
};

function renderReport(data, videoCount, evidenceCount, scannedCount) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const cycles = Number(data.cycles_observed);
  const valueAdded = Number(data.time_distribution?.value_added_pct);
  const waste = Number(data.time_distribution?.waste_pct);
  $('#cycles').textContent = Number.isFinite(cycles) ? cycles : '—';
  if (videoCount >= MAX_VIDEOS && data.cycle_time) {
    $('#cycle').textContent = data.cycle_time;
    $('#cycleLabel').textContent = 'AI cycle-time estimate from 10 videos — validate with a timed study';
  } else {
    $('#cycle').textContent = 'Not measured';
    $('#cycleLabel').textContent = `${videoCount}/10 videos loaded — add more videos for an AI cycle-time estimate`;
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
  $('#confidence').textContent = confidenceFor(videoCount);
  $('#studyStatus').textContent = 'Study report ready';
  $('#aiStatus').textContent = `REPORT COMPLETE · ${videoCount} CLIP${videoCount === 1 ? '' : 'S'}`;
  $('#reachTag').hidden = !findings.some(hasReachEvidence);
  const review = `<div class="review-summary"><b>Study report:</b> ${escapeHtml(data.summary || 'Review complete.')}<br><span>${escapeHtml(data.limitations || `Reviewed ${evidenceCount} frames from ${scannedCount} local scans.`)}</span></div>`;
  const rows = findings.length ? `<div class="eyebrow" style="margin-top:16px">OBSERVATIONS &amp; EXPERIMENTS</div>${findings.map((finding, index) => `<div class="finding"><div class="rank">${String(index + 1).padStart(2, '0')}</div><div class="finding-label">OBSERVATION</div><div class="finding-copy">${escapeHtml(`${finding.observation || ''} ${finding.evidence || ''}`)}</div><div class="finding-label">EXPERIMENT TO RUN</div><div class="finding-copy">${escapeHtml(finding.experiment || 'Define a controlled work-method test')}</div><div class="saving">Estimated saving: ${escapeHtml(finding.estimated_savings || 'Preliminary — validate with timed cycles')}</div></div>`).join('')}` : '<div class="detail" style="padding:14px 0">No finding was supported by this evidence set.</div>';
  $('#opportunityRows').innerHTML = review + rows;
  $('#analysisHint').innerHTML = `<b>Report complete:</b> ${videoCount}/10 videos reviewed. Confidence: ${confidenceFor(videoCount)}.`;
  toast('Work-method report complete.');
}
