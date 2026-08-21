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
let evidenceStopListener = null;

const translations = {
  en: {
    nav:'Cycle Time Studies', newStudy:'New video study', ready:'Ready for upload', settings:'AI Settings', upload:'↑  Upload video', emptyTitle:'Upload a manufacturing video to begin', emptyCopy:'Upload up to 10 continuous clips, up to 3 minutes each. OpEx identifies repeated complete cycles inside the footage.', run:'✦ Run AI work-method report', max:'3 MIN MAX', maxCopy:'Each individual video must be 3 minutes or shorter.', uploadGuide:'Upload guidance:', guideCopy:'Up to 10 videos, each up to 3 minutes. Keep the full repeated operation in frame; confidence is based on complete cycles observed, not the number of files.', preUploadTitle:'Before you choose videos', preUploadCopy:'Select all videos for this study together in the next file window.', preUploadNote:'Choose up to 10 videos of the same process and setup. Each video must be 3 minutes or shorter. Selecting videos again later will replace the current set.', chooseVideos:'Choose videos', summary:'STUDY SUMMARY', cycleNeed:'AI cycle-time estimate requires 10 complete observed cycles', cycles:'cycles observed', confidence:'confidence', split:'PRELIMINARY TIME SPLIT', splitEmpty:'Upload a video and run analysis to generate directional findings.', source:'Value-added changes the product. Waste is reach, search, regrip, waiting, or other avoidable motion.', opportunities:'Opportunities', awaiting:'AWAITING VIDEO', none:'No opportunities yet. Upload a video, then run AI analysis to create findings for review.', guard:'Recommendations require quality, ergonomic, and change-control review.', setupTitle:'Confirm the study setup', setupCopy:'The AI proposed these from sampled frames. Correct them before the final report; this prevents it from guessing which bin is a part source or where a cycle begins and ends.', sources:'Confirmed material source(s)', steps:'Confirmed cycle order', count:'Reviewer-confirmed complete cycles in this study', cancel:'Cancel', confirm:'Use confirmed setup & run report', analyzing:'Analyzing', languageName:'English', low:'Low', medium:'Medium', high:'High'
  },
  es: {
    nav:'Estudios de tiempo de ciclo', newStudy:'Nuevo estudio de video', ready:'Listo para cargar', settings:'Configuración de IA', upload:'↑  Cargar video', emptyTitle:'Cargue un video de manufactura para comenzar', emptyCopy:'Cargue hasta 10 videos continuos de un máximo de 3 minutos cada uno. OpEx identifica ciclos completos repetidos en el material.', run:'✦ Ejecutar informe de método de trabajo con IA', max:'MÁX. 3 MIN', maxCopy:'Cada video debe durar 3 minutos o menos.', uploadGuide:'Guía de carga:', guideCopy:'Hasta 10 videos de un máximo de 3 minutos cada uno. Mantenga toda la operación repetida dentro del encuadre; la confianza se basa en los ciclos completos observados, no en la cantidad de archivos.', preUploadTitle:'Antes de elegir los videos', preUploadCopy:'Seleccione juntos todos los videos de este estudio en la siguiente ventana.', preUploadNote:'Elija hasta 10 videos del mismo proceso y configuración. Cada video debe durar 3 minutos o menos. Si vuelve a seleccionar videos, reemplazará el conjunto actual.', chooseVideos:'Elegir videos', summary:'RESUMEN DEL ESTUDIO', cycleNeed:'La estimación del tiempo de ciclo por IA requiere 10 ciclos completos observados', cycles:'ciclos observados', confidence:'confianza', split:'DISTRIBUCIÓN PRELIMINAR DEL TIEMPO', splitEmpty:'Cargue un video y ejecute el análisis para generar hallazgos preliminares.', source:'El valor agregado transforma el producto. El desperdicio incluye alcanzar, buscar, reacomodar, esperar u otros movimientos evitables.', opportunities:'Oportunidades', awaiting:'ESPERANDO VIDEO', none:'Aún no hay oportunidades. Cargue un video y ejecute el análisis de IA para crear hallazgos.', guard:'Las recomendaciones requieren revisión de calidad, ergonomía y control de cambios.', setupTitle:'Confirme la configuración del estudio', setupCopy:'La IA propuso estos datos a partir de fotogramas muestreados. Corríjalos antes del informe final para evitar que adivine el origen de las piezas o el inicio y fin del ciclo.', sources:'Fuente(s) de material confirmada(s)', steps:'Orden del ciclo confirmado', count:'Ciclos completos confirmados por el revisor', cancel:'Cancelar', confirm:'Usar configuración y ejecutar informe', analyzing:'Analizando', languageName:'Spanish', low:'Baja', medium:'Media', high:'Alta'
  },
  vi: {
    nav:'Nghiên cứu thời gian chu kỳ', newStudy:'Nghiên cứu video mới', ready:'Sẵn sàng tải lên', settings:'Cài đặt AI', upload:'↑  Tải video lên', emptyTitle:'Tải video sản xuất lên để bắt đầu', emptyCopy:'Tải lên tối đa 10 video liên tục, mỗi video không quá 3 phút. OpEx xác định các chu kỳ hoàn chỉnh lặp lại trong video.', run:'✦ Chạy báo cáo phương pháp làm việc bằng AI', max:'TỐI ĐA 3 PHÚT', maxCopy:'Mỗi video phải dài không quá 3 phút.', uploadGuide:'Hướng dẫn tải lên:', guideCopy:'Tối đa 10 video, mỗi video không quá 3 phút. Giữ toàn bộ thao tác lặp lại trong khung hình; độ tin cậy dựa trên số chu kỳ hoàn chỉnh quan sát được, không phải số tệp.', preUploadTitle:'Trước khi chọn video', preUploadCopy:'Chọn cùng lúc tất cả video cho nghiên cứu này trong cửa sổ tiếp theo.', preUploadNote:'Chọn tối đa 10 video của cùng một quy trình và thiết lập. Mỗi video phải dài không quá 3 phút. Nếu chọn lại video sau đó, bộ video hiện tại sẽ bị thay thế.', chooseVideos:'Chọn video', summary:'TÓM TẮT NGHIÊN CỨU', cycleNeed:'Ước tính thời gian chu kỳ bằng AI cần 10 chu kỳ hoàn chỉnh được quan sát', cycles:'chu kỳ được quan sát', confidence:'độ tin cậy', split:'PHÂN BỔ THỜI GIAN SƠ BỘ', splitEmpty:'Tải video lên và chạy phân tích để tạo các phát hiện định hướng.', source:'Giá trị gia tăng làm thay đổi sản phẩm. Lãng phí gồm với tay, tìm kiếm, cầm lại, chờ đợi hoặc chuyển động có thể tránh.', opportunities:'Cơ hội cải tiến', awaiting:'ĐANG CHỜ VIDEO', none:'Chưa có cơ hội cải tiến. Tải video lên rồi chạy phân tích AI để tạo các phát hiện.', guard:'Các đề xuất cần được xem xét về chất lượng, công thái học và kiểm soát thay đổi.', setupTitle:'Xác nhận thiết lập nghiên cứu', setupCopy:'AI đã đề xuất các thông tin này từ những khung hình mẫu. Hãy chỉnh sửa trước báo cáo cuối để AI không đoán nguồn linh kiện hoặc điểm bắt đầu và kết thúc chu kỳ.', sources:'Nguồn vật liệu đã xác nhận', steps:'Thứ tự chu kỳ đã xác nhận', count:'Số chu kỳ hoàn chỉnh do người đánh giá xác nhận', cancel:'Hủy', confirm:'Dùng thiết lập và chạy báo cáo', analyzing:'Đang phân tích', languageName:'Vietnamese', low:'Thấp', medium:'Trung bình', high:'Cao'
  }
};
let language = ['en','es','vi'].includes(localStorage.getItem('helios-language')) ? localStorage.getItem('helios-language') : 'en';
const tr = key => translations[language][key] || translations.en[key] || key;
const setText = (selector, text) => { const element = $(selector); if (element) element.textContent = text; };
const applyLanguage = () => {
  document.documentElement.lang = language;
  $('#languageSelect').value = language;
  setText('.nav a', `▸ ${tr('nav')}`); setText('.top h1', tr('nav'));
  if (['New video study','Nuevo estudio de video','Nghiên cứu video mới'].includes($('#studyTitle').textContent)) setText('#studyTitle', tr('newStudy'));
  if (!studyFiles.length) setText('#studyStatus', tr('ready'));
  setText('#settingsBtn', tr('settings')); setText('#uploadBtn', tr('upload'));
  $('#emptyVideo').innerHTML = `<div><strong>${tr('emptyTitle')}</strong>${tr('emptyCopy')}</div>`;
  if (!studyFiles.length) setText('#analyzeBtn', tr('run'));
  document.querySelector('.video-limit strong').textContent = tr('max'); document.querySelector('.video-limit span').textContent = tr('maxCopy');
  if (!studyFiles.length) $('#analysisHint').innerHTML = `<b>${tr('uploadGuide')}</b> ${tr('guideCopy')}`;
  setText('.summary .eyebrow', tr('summary')); if (!studyFiles.length) setText('#cycleLabel', tr('cycleNeed')); setText('#cyclesLabel', tr('cycles'));
  document.querySelector('.facts > div:nth-child(2)').lastChild.textContent = tr('confidence');
  if (!studyFiles.length) { setText('#distributionLabel', tr('split')); $('#lossLegend').innerHTML = `<span>${tr('splitEmpty')}</span>`; }
  setText('.source', tr('source')); setText('.opp h3', tr('opportunities')); if (!studyFiles.length) { setText('#aiStatus', tr('awaiting')); $('#opportunityRows').innerHTML = `<div class="detail" style="padding:22px 0">${tr('none')}</div>`; }
  setText('.guard', tr('guard')); setText('#studySetup .modal h2', tr('setupTitle')); setText('#studySetup .modal p', tr('setupCopy'));
  setText('#uploadGuidance .modal h2', tr('preUploadTitle')); setText('#uploadGuidance .modal p', tr('preUploadCopy')); setText('#uploadGuidanceNote', tr('preUploadNote'));
  setText('#cancelUpload', tr('cancel')); setText('#continueUpload', tr('chooseVideos'));
  setText('label[for="confirmedSources"]', tr('sources')); setText('label[for="confirmedSteps"]', tr('steps')); setText('label[for="confirmedCycleCount"]', tr('count'));
  setText('#cancelStudySetup', tr('cancel')); setText('#confirmStudySetup', tr('confirm')); setText('.analysis-loading-card > div:nth-child(2)', tr('analyzing'));
};

const confidenceFor = cycles => cycles < 5 ? tr('low') : cycles < CYCLES_FOR_ESTIMATE ? tr('medium') : tr('high');
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
const hasReachEvidence = finding => /reach|bin|container|component location/i.test(`${finding.observation || ''} ${finding.evidence || ''}`);

$('#settingsBtn').onclick = () => toast('AI service is managed securely for all users.');
$('#languageSelect').onchange = event => {
  language = event.target.value;
  localStorage.setItem('helios-language', language);
  applyLanguage();
};
applyLanguage();
$('#editTitle').onclick = () => {
  const title = prompt('Study title', $('#studyTitle').textContent);
  if (title?.trim()) $('#studyTitle').textContent = title.trim();
};
$('#uploadBtn').onclick = () => $('#uploadGuidance').classList.add('open');
$('#cancelUpload').onclick = () => $('#uploadGuidance').classList.remove('open');
$('#continueUpload').onclick = () => { $('#uploadGuidance').classList.remove('open'); fileInput.click(); };

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
  if (evidenceStopListener) {
    video.removeEventListener('timeupdate', evidenceStopListener);
    evidenceStopListener = null;
  }
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
  .map(point => {
    const pointTime = Number(point.time_seconds);
    const start = Number(point.start_time_seconds);
    const end = Number(point.end_time_seconds);
    const hasRange = Number.isFinite(start) && Number.isFinite(end) && end > start;
    return { clip: Number(point.clip), start: hasRange ? start : Math.max(0, pointTime - 2), end: hasRange ? end : pointTime + 2, time: hasRange ? (start + end) / 2 : pointTime };
  })
  .filter(point => Number.isInteger(point.clip) && point.clip >= 1 && point.clip <= studyFiles.length && Number.isFinite(point.time) && point.time >= 0)
  .slice(0, 1);
const evidenceHtml = finding => {
  const text = escapeHtml(finding?.evidence || 'Visible evidence in the reviewed video.');
  const links = evidencePointsFor(finding).map(point => `<button type="button" class="evidence-link" data-clip="${point.clip}" data-start="${point.start}" data-end="${point.end}">Clip ${point.clip} · ${formatTime(point.start)}–${formatTime(point.end)}</button>`).join('');
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
    const start = Number(link.dataset.start);
    const end = Number(link.dataset.end);
    const clip = studyFiles[clipNumber - 1];
    if (!clip || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return toast('That evidence clip is no longer available.');
    try {
      await loadClip(clip);
      if (evidenceStopListener) video.removeEventListener('timeupdate', evidenceStopListener);
      const stopAt = Math.min(end, Math.max(0, video.duration - .1));
      evidenceStopListener = () => {
        if (video.currentTime >= stopAt) {
          video.pause();
          video.currentTime = stopAt;
          video.removeEventListener('timeupdate', evidenceStopListener);
          evidenceStopListener = null;
        }
      };
      video.addEventListener('timeupdate', evidenceStopListener);
      video.currentTime = Math.min(start, stopAt);
      video.play().catch(() => {});
      $('#studyStatus').textContent = `Viewing evidence · clip ${clipNumber}, ${formatTime(start)}–${formatTime(stopAt)}`;
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
const analyzeContent = async content => {
  const localizedContent = content.map((item, index) => index === 0 && item.type === 'input_text'
    ? { ...item, text: `${item.text}\nWrite all human-readable JSON string values in ${tr('languageName')}. Keep JSON property names exactly as specified.` }
    : item);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: [{ role: 'user', content: localizedContent }], text: { format: { type: 'json_object' } } }), signal: controller.signal });
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
      const start = Math.max(0, point.start - .4);
      const end = Math.min(Math.max(0, video.duration - .1), Math.max(point.end + .4, point.start + DENSE_EVIDENCE_WINDOW_SECONDS));
      for (let time = start; time <= end + .001; time += 1 / DENSE_EVIDENCE_FPS) {
        frames.push({ ...(await captureFrame(time)), clip: point.clip });
      }
    } catch { /* Preserve the finding even when one source clip cannot be reopened. */ }
  }
  return frames;
};
const calibratedReductionFor = async (finding, index, total) => {
  const evidence = await denseEvidenceFor(finding);
  if (!evidence.length) return { low_sec_per_cycle: 0, high_sec_per_cycle: 0, independent: false, confidence: 'low', basis: 'Dense video evidence could not be captured.' };
  const batchReports = [];
  const batches = chunk(evidence, MAX_IMAGES_PER_ANALYSIS_BATCH);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    setProgress(`Measuring opportunity ${index}/${total}: window ${batchIndex + 1}/${batches.length}…`);
    const prompt = `You are measuring the visible time in a short, dense video sequence for one industrial-engineering opportunity. The sampled frames are chronological and spaced approximately ${1 / DENSE_EVIDENCE_FPS} seconds apart. Opportunity: ${finding.observation}. Evidence claim: ${finding.evidence}. Identify only visible avoidable motion, reach, search, regrip, or waiting related to this specific opportunity. Do not count required quality, safety, inspection, or product-changing work as recoverable. Estimate a conservative observed avoidable-duration range for this window and state whether the sequence is too ambiguous to estimate. Never use a canned range or claim stopwatch precision. Return STRICT JSON: {"window_summary":"one sentence","avoidable_duration_low_sec":0,"avoidable_duration_high_sec":0,"recoverable_fraction_low":0,"recoverable_fraction_high":0,"basis":"visible timing evidence and uncertainty"}.`;
    batchReports.push(await analyzeContent(contentFor(prompt, batches[batchIndex])));
  }
  const synthesisPrompt = `You are consolidating dense video measurements for one work-method opportunity. The original finding is: ${finding.observation}. Its evidence is: ${finding.evidence}. The reports below are from chronological frames approximately ${1 / DENSE_EVIDENCE_FPS} seconds apart around every linked occurrence. Give a conservative estimated cycle-time reduction only from visible avoidable duration and the demonstrated repetition in the linked clips. Also identify one short playback_window that begins and ends at the visible opportunity (use an exact clip number and timestamps from the dense frames). If the evidence is ambiguous, use 0 for both values and use the original evidence window. Do not use a generic range and do not claim precision below 0.2 seconds. Return STRICT JSON: {"low_sec_per_cycle":0,"high_sec_per_cycle":0,"confidence":"low|medium|high","basis":"one concise evidence-based sentence","playback_window":{"clip":1,"start_time_seconds":0,"end_time_seconds":1}}. Reports:\n${JSON.stringify(batchReports)}`;
  const result = await analyzeContent([{ type: 'input_text', text: synthesisPrompt }]);
  const low = Number(result.low_sec_per_cycle);
  const high = Number(result.high_sec_per_cycle);
  const window = result.playback_window || {};
  const playback = { clip: Number(window.clip), start_time_seconds: Number(window.start_time_seconds), end_time_seconds: Number(window.end_time_seconds) };
  const hasPlayback = Number.isInteger(playback.clip) && playback.clip >= 1 && playback.clip <= studyFiles.length && Number.isFinite(playback.start_time_seconds) && Number.isFinite(playback.end_time_seconds) && playback.end_time_seconds > playback.start_time_seconds;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low || high > 60) return { low_sec_per_cycle: 0, high_sec_per_cycle: 0, independent: false, confidence: 'low', basis: 'Dense video evidence did not support a range.', playback_window: hasPlayback ? playback : null };
  return { low_sec_per_cycle: low, high_sec_per_cycle: high, independent: false, confidence: ['low', 'medium', 'high'].includes(result.confidence) ? result.confidence : 'low', basis: String(result.basis || 'Estimated from dense timestamped video frames.'), playback_window: hasPlayback ? playback : null };
};
const markIndependentReductions = async findings => {
  const candidates = findings.map((finding, index) => ({ index: index + 1, observation: finding.observation, experiment: finding.experiment, reduction: finding.reduction_to_validate }))
    .filter(item => Number(item.reduction?.high_sec_per_cycle) > 0);
  if (!candidates.length) return;
  const prompt = `You are reviewing possible cycle-time reductions from one operation. Select only findings that can be added without double-counting the same seconds of work. If two experiments address the same reach, motion, or wait, include only the stronger one. Return STRICT JSON: {"independent_finding_indexes":[1]}. Candidates:\n${JSON.stringify(candidates)}`;
  const decision = await analyzeContent([{ type: 'input_text', text: prompt }]);
  const included = new Set((Array.isArray(decision.independent_finding_indexes) ? decision.independent_finding_indexes : []).map(Number));
  findings.forEach((finding, index) => { if (finding.reduction_to_validate) finding.reduction_to_validate.independent = included.has(index + 1); });
};
const stepsText = steps => Array.isArray(steps) ? steps.map((step, index) => `${index + 1}. ${typeof step === 'string' ? step : step.step || step.name || ''}`).filter(Boolean).join('\n') : '';
const sourcesText = sources => Array.isArray(sources) ? sources.map(source => typeof source === 'string' ? source : source.label || source.description || source.location || '').filter(Boolean).join('\n') : '';

$('#analyzeBtn').onclick = async () => {
  if (!studyFiles.length) return toast('Upload a video first.');

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
    const calibration = await analyzeContent(contentFor(calibrationPrompt, sampleEvenly(evidence, Math.min(MAX_IMAGES_PER_ANALYSIS_BATCH, evidence.length))));
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
      const batchPrompt = `You are a senior industrial engineer reviewing chronological evidence batch ${index + 1} of ${batches.length} from a continuous assembly video study. The study lead has confirmed the material source(s): ${sources}. The confirmed cycle order is: ${steps}. The reviewer-confirmed complete-cycle count is ${confirmedCycles}; do not substitute an AI estimate. Report only visible, evidence-based work-method opportunities in these timestamped frames. A source-location finding must refer only to a confirmed source. Separate visible observation from the experiment to test it; mark unproven mechanism as a hypothesis. Do not present results as measured. Every finding must include exactly one structured evidence point using the exact clip number and a short start/end interval from the supplied frame timestamps. Also classify all ${batches[index].length} sampled frames by their visible state: value-added = directly changes the product in the confirmed cycle; avoidable waste = visible reach, search, regrip, waiting, or avoidable motion; uncertain-or-required = cannot be reliably classified from the frame or may be required work. Do not call required inspection, safety, or quality work waste without clear visual evidence. The three frame counts must be non-negative integers totaling exactly ${batches[index].length}. Return STRICT JSON: {"batch_summary":"one sentence","time_split":{"value_added_frames":0,"avoidable_waste_frames":0,"uncertain_or_required_frames":0,"basis":"brief visual basis with timestamps"},"findings":[{"observation":"visible fact only","evidence":"short evidence sentence","evidence_points":[{"clip":1,"start_time_seconds":0,"end_time_seconds":1}],"experiment":"specific change to test","category":"reach|motion|waiting|material_handling|ergonomics"}],"limitations":"one concise uncertainty note"}. Include at most 5 distinct findings.`;
      batchReports.push(await analyzeContent(contentFor(batchPrompt, batches[index])));
    }
    setProgress('Synthesizing findings across all evidence batches…');
    const synthesisPrompt = `You are a senior industrial engineer synthesizing chronological evidence-batch reviews from ${pendingStudy.clips.length} continuous assembly video clip${pendingStudy.clips.length === 1 ? '' : 's'} of the same operation. The study lead has confirmed the material source(s): ${sources}. The confirmed cycle order is: ${steps}. The reviewer-confirmed complete-cycle count is ${confirmedCycles}; use that exact count and do not substitute an AI estimate. Deduplicate overlapping findings across batches. Retain only evidence-based findings with their structured clip/start/end evidence_points; do not invent timestamps or alter clip numbers. A source-location finding must refer only to a confirmed source. Each finding must separate visible observation from experiment; mark unproven mechanism as a hypothesis. Do not present any result as measured. For each finding, provide reduction_to_validate only when the visible evidence supports a conservative directional range; never use a generic range, never imply precision below one second, and use zeroes when no defensible range is possible. Set independent true only if its experiment does not overlap with another included experiment; when uncertain, set it false. Only provide cycle_time when reviewer-confirmed cycles are at least ${CYCLES_FOR_ESTIMATE}; otherwise use an empty string. Return STRICT JSON: {"summary":"one sentence","cycles_observed":${confirmedCycles},"cycle_time":"Preliminary: ~0 sec/cycle or empty string","findings":[{"observation":"visible fact only","evidence":"short evidence sentence","evidence_points":[{"clip":1,"start_time_seconds":0,"end_time_seconds":1}],"experiment":"specific change to test","reduction_to_validate":{"low_sec_per_cycle":0,"high_sec_per_cycle":0,"independent":false,"basis":"why this range is or is not defensible from the video"},"category":"reach|motion|waiting|material_handling|ergonomics"}],"limitations":"one concise sentence"}. Evidence-batch reviews follow:\n${JSON.stringify(batchReports)}`;
    const data = await analyzeContent([{ type: 'input_text', text: synthesisPrompt }]);
    data.cycles_observed = confirmedCycles;
    data.time_distribution = timeSplitFromBatches(batchReports, pendingStudy.evidence.length);
    const findings = Array.isArray(data.findings) ? data.findings : [];
    for (let index = 0; index < findings.length; index += 1) {
      const calibration = await calibratedReductionFor(findings[index], index + 1, findings.length);
      findings[index].reduction_to_validate = calibration;
      if (calibration.playback_window) findings[index].evidence_points = [calibration.playback_window];
    }
    setProgress('Checking which reduction estimates can be combined…');
    await markIndependentReductions(findings);
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
    const confidence = ['low', 'medium', 'high'].includes(estimate?.confidence) ? estimate.confidence : 'low';
    const reduction = hasEstimate ? `<div class="saving">AI estimate: ${formatSeconds(low)}–${formatSeconds(high)} sec/cycle · ${confidence} confidence</div><div class="detail">${escapeHtml(estimate.basis || 'Estimated from dense timestamped video frames.')}</div>` : '';
    return `<div class="finding"><div class="rank">${String(index + 1).padStart(2, '0')}</div><div class="finding-label">OBSERVATION</div><div class="finding-copy">${escapeHtml(finding.observation || '')} ${evidenceHtml(finding)}</div><div class="finding-label">EXPERIMENT TO RUN</div><div class="finding-copy">${escapeHtml(finding.experiment || 'Define a controlled work-method test')}</div>${reduction}</div>`;
  }).join('')}${potential ? `<div class="reduction-total"><span>Potential cycle-time reduction to validate</span><strong>${formatSeconds(potential.low)}–${formatSeconds(potential.high)} sec/cycle</strong><small>Totals only independent experiments ${potential.indexes.join(', ')}; verify with a before/after timed study.</small></div>` : '<div class="reduction-total muted-total"><span>Potential cycle-time reduction</span><small>Not totaled: the video did not support independent, non-overlapping time ranges. Validate with a timed study.</small></div>'}` : '<div class="detail" style="padding:14px 0">No finding was supported by this evidence set.</div>';
  $('#opportunityRows').innerHTML = review + rows;
  bindEvidenceLinks();
  $('#analysisHint').innerHTML = `<b>Report complete:</b> ${videoCount} video${videoCount === 1 ? '' : 's'} reviewed; ${observedCycles} complete cycles observed. Confidence: ${confidenceFor(observedCycles)}.`;
  toast('Work-method report complete.');
}
