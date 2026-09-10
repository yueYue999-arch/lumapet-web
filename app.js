import { ACTIONS, DEFAULT_ACTION_IDS, DEMO } from './catalog.js';
import { MOVEMENT, firstFrame, selectedActions, validatePlan, readPetArchive, makePetArchive } from './core.js';
import { listPets, getMedia, savePet, removePet } from './storage.js';

const $ = id => document.getElementById(id);
const local = document.querySelector('meta[name="luma-runtime"]')?.content === 'local';
let state = { pets: [], jobs: [], desktop: { connected: false }, provider: {} };
let selected = new Set(DEFAULT_ACTION_IDS), activePet = DEMO, activeMedia = {}, reference = null, poseId = 'idle';
let activeUrls = [], libraryUrls = [], previewRevision = 0, toastTimer, openedJobId = null;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'awaiting-selection']);
const statusLabels = { queued: '等待制作', 'candidates-generating': '制作旧版候选', 'actions-generating': '制作姿态图', processing: '处理图片', completed: '制作完成', failed: '制作失败', cancelled: '已取消', interrupted: '已中断', 'awaiting-selection': '旧版候选待选择' };
const imageType = file => /\.webp$/i.test(file) ? 'image/webp' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.gif$/i.test(file) ? 'image/gif' : 'image/png';
const currentCatalog = () => [...ACTIONS, ...activePet.actions.filter(action => !MOVEMENT.has(action.id) && !ACTIONS.some(item => item.id === action.id)).map(({ id, label }) => ({ id, label }))];
const selectedList = () => selectedActions(currentCatalog(), selected);
const escapeName = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) || '绒星角色';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
async function busy(button, operation) {
  if (button.disabled) return;
  button.disabled = true;
  try { await operation(); } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
}
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。');
  return result;
}
function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取文件，请重新选择。'));
    reader.readAsDataURL(blob);
  });
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = el('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function validateImage(blob) {
  const bitmap = await createImageBitmap(blob);
  const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width <= 12000 && bitmap.height <= 12000 && bitmap.width * bitmap.height <= 40e6;
  bitmap.close();
  if (!valid) throw new Error('图片尺寸过大，请缩小到 4000 万像素以内。');
}
async function setReference(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的 PNG、JPG 或 WebP 图片。');
  await validateImage(file);
  const value = await dataUrl(file);
  reference = { name: file.name.slice(0, 120), dataUrl: value };
  $('reference-preview').src = value; $('reference-preview').hidden = false; $('reference-hint').hidden = true;
  if (!$('pet-name').value) $('pet-name').value = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
}
function renderChoices() {
  for (const [target, actions] of [
    ['basic-poses', DEFAULT_ACTION_IDS.map(id => ACTIONS.find(action => action.id === id))],
    ['optional-poses', currentCatalog().filter(action => !DEFAULT_ACTION_IDS.includes(action.id))]
  ]) {
    $(target).replaceChildren(...actions.map(action => {
      const label = el('label', 'pose-option'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = action.id; input.checked = selected.has(action.id); input.disabled = action.id === 'idle';
      input.addEventListener('change', () => { input.checked ? selected.add(action.id) : selected.delete(action.id); updateSelection(); });
      label.append(input, el('span', '', action.label));
      if (action.id === 'idle') label.append(el('small', '', '必选'));
      return label;
    }));
  }
  updateSelection();
}
function updateSelection() {
  $('selected-count').textContent = selected.size + ' 张图';
  const extras = [...selected].filter(id => !DEFAULT_ACTION_IDS.includes(id)).length;
  $('extra-count').textContent = extras ? '已选 ' + extras + ' 种' : '按需勾选';
  renderPreview();
}
function renderPreview() {
  $('active-pet-name').textContent = activePet.name + (activePet.id === 'demo' ? ' · 示例' : '');
  $('preview-badge').textContent = activePet.id === 'demo' ? '示例' : '我的角色';
  const available = selectedList().filter(action => activePet.actions.some(item => item.id === action.id));
  const missing = selectedList().filter(action => !activePet.actions.some(item => item.id === action.id));
  $('preview-count').textContent = available.length + ' 张可导出' + (missing.length ? ' · ' + missing.length + ' 张待制作' : '');
  $('preview-help').textContent = activePet.id === 'demo' ? '这是小橘示例，可直接导出体验。你的新形象需要在本机完成制作。' : missing.length ? '虚线姿态尚未制作。导出只包含已完成的 ' + available.length + ' 张图。' : '每种姿态导出一张静态 PNG。导入的动画包在这里使用首帧。';
  $('show-desktop').hidden = !local || !state.desktop.connected || activePet.id === 'demo';
  $('add-poses').hidden = !local || activePet.id === 'demo' || !missing.length;
  $('add-poses').textContent = '在本机补充这 ' + missing.length + ' 张姿态';
  const visible = selectedList();
  if (!visible.some(action => action.id === poseId)) poseId = 'idle';
  $('preview-poses').replaceChildren(...visible.map(action => {
    const button = el('button', '', action.label);
    button.type = 'button'; button.dataset.pose = action.id;
    button.dataset.missing = String(!activePet.actions.some(item => item.id === action.id));
    button.setAttribute('aria-pressed', String(action.id === poseId));
    button.addEventListener('click', () => { poseId = action.id; renderPreview(); });
    return button;
  }));
  showPose();
}
function showPose() {
  const action = activePet.actions.find(item => item.id === poseId);
  const label = ACTIONS.find(item => item.id === poseId)?.label || action?.label || poseId;
  $('pose-label').textContent = label;
  $('pose-image').hidden = !action; $('pose-empty').hidden = !!action;
  if (!action) { $('pose-empty').textContent = '“' + label + '”还没有图片，制作完成后就能预览。'; return; }
  const source = firstFrame(action);
  const url = activeMedia[source] ? URL.createObjectURL(activeMedia[source]) : source;
  if (activeMedia[source]) activeUrls.push(url);
  $('pose-image').src = url; $('pose-image').alt = activePet.name + '：' + label;
  // Keep only the current image URL; the Blob remains available for later poses.
  while (activeUrls.length > 1) URL.revokeObjectURL(activeUrls.shift());
}
async function openPet(pet) {
  const revision = ++previewRevision;
  const media = !local && pet.id !== 'demo' ? await getMedia(pet.id) : {};
  if (revision !== previewRevision) return;
  activeUrls.forEach(url => URL.revokeObjectURL(url)); activeUrls = [];
  activePet = pet; activeMedia = media || {}; poseId = 'idle';
  selected = new Set(pet.id === 'demo' ? DEFAULT_ACTION_IDS : pet.actions.map(action => action.id).filter(id => !MOVEMENT.has(id)));
  selected.add('idle');
  renderChoices(); location.hash = 'create';
  $('preview-title').focus({ preventScroll: true });
}
async function renderLibrary() {
  libraryUrls.forEach(url => URL.revokeObjectURL(url)); libraryUrls = [];
  $('library-count').textContent = state.pets.length;
  $('library-empty').hidden = state.pets.length > 0;
  $('library-grid').replaceChildren(...state.pets.map(pet => {
    const card = el('article', 'pet-card'), img = el('img');
    img.alt = pet.name; img.loading = 'lazy';
    if (pet.preview instanceof Blob) { img.src = URL.createObjectURL(pet.preview); libraryUrls.push(img.src); } else img.src = pet.previewUrl;
    card.append(img, el('h2', '', pet.name), el('p', '', pet.actions.length + ' 种姿态' + (pet.renderMode === 'stills' ? ' · 单图角色' : ' · 可导出为单图')));
    const actions = el('div', 'card-actions'), open = el('button', 'primary', '选择并预览');
    open.addEventListener('click', () => busy(open, () => openPet(pet))); actions.append(open);
    if (!local) {
      const remove = el('button', 'text-button', '移出浏览器');
      remove.addEventListener('click', () => busy(remove, async () => {
        await removePet(pet.id);
        state.pets = state.pets.filter(item => item.id !== pet.id);
        if (activePet.id === pet.id) await openPet(DEMO);
        renderLibrary(); notify('已从浏览器移出，导出的文件不受影响。');
      }));
      actions.append(remove);
    }
    card.append(actions); return card;
  }));
}
async function importPet(file) {
  if (file.size > 150 * 1024 * 1024) throw new Error('角色包不能超过 150 MB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { manifest, files } = readPetArchive(bytes);
  const media = {};
  for (const [path, data] of Object.entries(files)) {
    const blob = new Blob([data], { type: imageType(path) });
    await validateImage(blob); media[path] = blob;
  }
  let pet;
  if (local) {
    const encoded = await dataUrl(file);
    pet = await api('/api/import', { data: encoded.split(',')[1] });
    await refresh();
  } else {
    pet = { ...manifest, id: crypto.randomUUID(), createdAt: new Date().toISOString(), preview: media[manifest.preview] };
    await savePet(pet, media);
    state.pets = [pet, ...state.pets]; renderLibrary();
  }
  await openPet(pet); notify('已导入“' + pet.name + '”，可以预览与导出。');
}
async function exportPet() {
  const pet = activePet, media = activeMedia, actions = selectedList().filter(action => pet.actions.some(item => item.id === action.id));
  const images = [];
  for (const action of actions) {
    const source = firstFrame(pet.actions.find(item => item.id === action.id));
    let blob = media[source];
    if (!blob) {
      const response = await fetch(source);
      if (!response.ok) throw new Error('图片读取失败：' + action.label);
      blob = await response.blob();
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('图片导出失败：' + action.label);
    images.push({ id: action.id, label: action.label, bytes: new Uint8Array(await png.arrayBuffer()) });
  }
  download(makePetArchive(pet, images), escapeName(pet.name) + '-' + images.length + '张姿态.zip', 'application/zip');
  notify('已导出 ' + images.length + ' 张姿态，可导入桌宠或重新导入网站。');
}
function renderJobs() {
  const jobs = state.jobs.slice(-8).reverse();
  $('jobs-section').hidden = !jobs.length;
  $('jobs-list').replaceChildren(...jobs.map(job => {
    const row = el('article', 'job-row'), info = el('div', 'job-info');
    info.append(el('strong', '', job.name + ' · ' + (statusLabels[job.status] || job.status)));
    info.append(el('p', '', job.error || job.progress?.label || ''));
    if (!terminal.has(job.status)) {
      const progress = el('progress'); progress.max = job.progress?.total || 1; progress.value = job.progress?.done || 0; progress.setAttribute('aria-label', job.name + '制作进度'); info.append(progress);
    }
    row.append(info);
    let label, operation;
    if (job.status === 'completed') { label = '预览'; operation = () => openPet(state.pets.find(pet => pet.id === job.petId)); }
    else if (['failed', 'interrupted', 'cancelled'].includes(job.status)) { label = '继续制作'; operation = async () => { await api('/api/jobs/' + job.id + '/retry', {}); openedJobId = job.id; await refresh(); }; }
    else if (!terminal.has(job.status)) { label = '取消'; operation = async () => { await api('/api/jobs/' + job.id + '/cancel', {}); await refresh(); }; }
    else if (job.status === 'awaiting-selection') info.append(el('p', '', '这是旧版候选任务，可从旧版工作台选择候选后继续。'));
    if (operation) { const button = el('button', 'secondary', label); button.addEventListener('click', () => busy(button, operation)); row.append(button); }
    return row;
  }));
}
function applyState(value) {
  const oldLibrary = state.pets.map(pet => pet.id + ':' + pet.actions.length + ':' + firstFrame(pet.actions[0] || {})).join();
  state = { pets: value.pets, jobs: value.jobs, desktop: value.desktop, provider: value.provider };
  if (oldLibrary !== state.pets.map(pet => pet.id + ':' + pet.actions.length + ':' + firstFrame(pet.actions[0] || {})).join()) renderLibrary();
  renderJobs();
  if (activePet.id !== 'demo') {
    const updated = state.pets.find(pet => pet.id === activePet.id);
    if (updated && JSON.stringify(updated.actions) !== JSON.stringify(activePet.actions)) { activePet = updated; renderPreview(); }
  }
  const finished = state.jobs.find(job => job.id === openedJobId && job.status === 'completed');
  if (finished) {
    openedJobId = null;
    openPet(state.pets.find(pet => pet.id === finished.petId)).catch(error => notify(error.message));
  }
}
const refresh = async () => applyState(await api('/api/state'));

$('reference-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { await setReference(file); showError('form-error'); } catch (error) { showError('form-error', error.message); }
  event.target.value = '';
});
$('reset-poses').addEventListener('click', () => { selected = new Set(DEFAULT_ACTION_IDS); renderChoices(); });
$('create-form').addEventListener('submit', async event => {
  event.preventDefault(); showError('form-error');
  const button = $('create-button'); button.disabled = true;
  try {
    if (!reference) throw new Error('请先放一张参考图。');
    const plan = validatePlan({ format: 'lumapet-plan', version: 1, name: $('pet-name').value, kind: document.querySelector('[name=kind]:checked').value, style: $('pet-style').value, actionIds: [...selected], reference }, ACTIONS);
    if (local) {
      const upload = await api('/api/uploads', { name: reference.name, data: reference.dataUrl.split(',')[1] });
      const job = await api('/api/jobs', { name: plan.name, kind: plan.kind, style: plan.style, actionIds: plan.actionIds, mainUploadId: upload.id, renderMode: 'stills' });
      openedJobId = job.id; await refresh(); notify('已开始制作 ' + plan.actionIds.length + ' 张姿态，请在下方查看进度。');
    } else {
      download(JSON.stringify(plan, null, 2), escapeName(plan.name) + '-制作单.json', 'application/json');
      notify('制作单已导出，在本机工作台导入后生成。');
    }
  } catch (error) { showError('form-error', error.message); }
  finally { button.disabled = false; }
});
$('import-plan').addEventListener('click', () => $('plan-file').click());
$('plan-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 29 * 1024 * 1024) throw new Error('制作单过大，请使用不超过 20 MB 的参考图。');
    const plan = validatePlan(JSON.parse(await file.text()), ACTIONS);
    const raw = atob(plan.reference.dataUrl.split(',')[1]);
    const blob = new Blob([Uint8Array.from(raw, char => char.charCodeAt(0))], { type: plan.reference.dataUrl.slice(5, plan.reference.dataUrl.indexOf(';')) });
    await validateImage(blob);
    reference = plan.reference;
    $('reference-preview').src = reference.dataUrl; $('reference-preview').hidden = false; $('reference-hint').hidden = true;
    $('pet-name').value = plan.name; $('pet-style').value = plan.style;
    document.querySelector('[name=kind][value=' + plan.kind + ']').checked = true;
    selected = new Set(plan.actionIds); renderChoices(); location.hash = 'create'; showError('form-error');
    notify('已载入制作单。' + (local ? '点击开始制作即可生成。' : '可以调整后再次导出。'));
  } catch (error) { showError('form-error', error.message); location.hash = 'create'; }
  event.target.value = '';
});
for (const id of ['import-pet', 'library-import']) $(id).addEventListener('click', () => $('pet-file').click());
$('pet-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  $('import-pet').disabled = true; $('library-import').disabled = true;
  try { await importPet(file); } catch (error) { notify(error.message); }
  finally { $('import-pet').disabled = false; $('library-import').disabled = false; event.target.value = ''; }
});
$('export-pet').addEventListener('click', () => busy($('export-pet'), exportPet));
$('show-desktop').addEventListener('click', () => busy($('show-desktop'), async () => {
  await api('/api/desktop/' + activePet.id, { command: 'show' }); notify('已邀请“' + activePet.name + '”到桌面。');
}));
$('add-poses').addEventListener('click', () => busy($('add-poses'), async () => {
  const missing = selectedList().filter(action => !activePet.actions.some(item => item.id === action.id));
  if (!missing.length) return;
  const job = await api('/api/pets/' + activePet.id + '/regenerate', { actions: missing.map(action => action.id), renderMode: 'stills' });
  openedJobId = job.id; await refresh(); notify('正在补充 ' + missing.length + ' 张姿态。');
}));
function route() {
  const library = location.hash === '#library';
  $('create-page').hidden = library; $('library-page').hidden = !library;
  document.querySelectorAll('[data-tab]').forEach(link => {
    if (link.dataset.tab === (library ? 'library' : 'create')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', route);
$('settings-open').addEventListener('click', () => {
  const config = state.provider.config || {};
  $('provider-mode').value = config.mode || 'codex'; $('provider-model').value = config.model || 'gpt-image-2';
  $('provider-base-url').value = config.baseUrl || 'https://api.openai.com/v1'; $('provider-key-env').value = config.keyEnv || 'OPENAI_API_KEY';
  $('api-settings').hidden = $('provider-mode').value !== 'openai';
  $('provider-status').textContent = state.provider.message || state.provider.setupHint || '请先在本机登录 Codex。';
  showError('settings-error'); $('settings-dialog').showModal();
});
$('provider-mode').addEventListener('change', () => { $('api-settings').hidden = $('provider-mode').value !== 'openai'; });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('settings-form').addEventListener('submit', event => {
  event.preventDefault(); const button = event.submitter;
  busy(button, async () => {
    try {
      await api('/api/provider', { mode: $('provider-mode').value, model: $('provider-model').value, baseUrl: $('provider-base-url').value, keyEnv: $('provider-key-env').value });
      await refresh(); $('settings-dialog').close(); notify('生成设置已保存。');
    } catch (error) { showError('settings-error', error.message); }
  });
});
$('pose-image').addEventListener('error', () => { $('pose-image').hidden = true; $('pose-empty').hidden = false; $('pose-empty').textContent = '这张图片未能读取，请重新导入角色包。'; });
$('preview-title').tabIndex = -1;
renderChoices(); route();
if (local) {
  $('mode-label').textContent = '本机工作台'; $('settings-open').hidden = false;
  $('create-button').textContent = '开始制作';
  $('creation-help').textContent = '使用本机已连接的生成服务，一批最多制作 10 张。完成后可预览、导出或邀请到桌面。';
  $('library-help').textContent = '角色保存在这台电脑。可以导出轻量包，在网站上预览与分享文件。';
  try {
    await refresh(); renderLibrary();
    const events = new EventSource('/api/events');
    events.addEventListener('state', event => applyState(JSON.parse(event.data)));
    events.onerror = () => { $('mode-label').textContent = '正在重新连接'; };
    events.onopen = () => { $('mode-label').textContent = '本机工作台'; };
    window.addEventListener('pagehide', () => events.close(), { once: true });
  } catch (error) { showError('form-error', '无法连接本机工作台：' + error.message); }
} else {
  try { state.pets = await listPets(); renderLibrary(); }
  catch (error) { notify(error.message); }
}
