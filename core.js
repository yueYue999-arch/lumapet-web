import { unzipSync, zipSync, strFromU8, strToU8 } from './vendor/fflate.js?v=1.8.1';

export const MOVEMENT = new Set(['walk', 'walk_right', 'run', 'run_right']);
const MB = 1024 * 1024;
const safePath = value => typeof value === 'string' && value.length > 0 && !/[\\:\x00-\x1f]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.');
const mediaPath = value => safePath(value) && /\.(png|jpe?g|webp|gif)$/i.test(value);
export const firstFrame = action => action.frames?.[0] || action.url || action.file;

export function selectedActions(catalog, ids) {
  const selected = new Set(ids);
  selected.add('idle');
  return catalog.filter(action => selected.has(action.id) && !MOVEMENT.has(action.id));
}

export function validatePlan(value, catalog) {
  if (value?.format !== 'lumapet-plan' || value.version !== 1) throw new Error('这不是绒星制作单，请导入导出的 JSON 文件。');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40) throw new Error('制作单中的名字需要 1–40 个字符。');
  const allowed = new Set(catalog.map(action => action.id));
  if (!Array.isArray(value.actionIds) || !value.actionIds.includes('idle') || value.actionIds.some(id => !allowed.has(id) || MOVEMENT.has(id))) throw new Error('制作单包含不支持的姿态，请重新选择。');
  if (value.kind !== 'pet' && value.kind !== 'character') throw new Error('制作单的角色类型无效。');
  if (value.style != null && (typeof value.style !== 'string' || value.style.length > 300)) throw new Error('样子说明不能超过 300 个字符。');
  const reference = value.reference;
  if (!reference || typeof reference.name !== 'string' || reference.name.length > 120 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(reference.dataUrl) || reference.dataUrl.length > 28 * MB) throw new Error('制作单缺少有效的参考图，或参考图超过 20 MB。');
  return { format: 'lumapet-plan', version: 1, renderMode: 'stills', name: value.name.trim(), kind: value.kind, style: value.style || '', actionIds: [...new Set(value.actionIds)], reference: { name: reference.name, dataUrl: reference.dataUrl } };
}

// Extract only the first frame of each pose. Animation archives need not inflate every frame.
export function readPetArchive(bytes) {
  if (bytes.length > 150 * MB) throw new Error('角色包不能超过 150 MB。');
  let count = 0, total = 0;
  const manifests = unzipSync(bytes, { filter(entry) {
    if (!safePath(entry.name)) throw new Error('角色包包含不安全的文件路径。');
    if (++count > 6000 || (total += entry.originalSize) > 300 * MB || entry.originalSize > 40 * MB) throw new Error('角色包解压内容超过容量限制。');
    return /(^|\/)manifest\.json$/.test(entry.name);
  }});
  const manifestPaths = Object.keys(manifests);
  if (manifestPaths.length !== 1) throw new Error('请导入单个角色包，包中需要一份 manifest.json。');
  const manifestPath = manifestPaths[0];
  let manifest;
  try { manifest = JSON.parse(strFromU8(manifests[manifestPath])); } catch { throw new Error('角色包清单不是有效的 JSON。'); }
  if (manifest?.schemaVersion !== 1 || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80 || !Array.isArray(manifest.actions) || !manifest.actions.length || manifest.actions.length > 100) throw new Error('角色包清单格式不正确。');
  const seen = new Set();
  const actions = manifest.actions.filter(action => {
    if (!action || !/^[a-z][a-z0-9_]{0,50}$/.test(action.id) || seen.has(action.id) || typeof action.label !== 'string' || action.label.length > 80) throw new Error('角色包包含无效或重复的姿态。');
    seen.add(action.id);
    if (!mediaPath(firstFrame(action))) throw new Error('角色包的图片路径无效。');
    return !MOVEMENT.has(action.id);
  }).map(action => ({ id: action.id, label: action.label, file: firstFrame(action), loop: false, durationMs: 1500, renderMode: 'stills' }));
  if (!actions.some(action => action.id === 'idle')) throw new Error('角色包需要包含待机姿态。');
  const prefix = manifestPath.slice(0, -'manifest.json'.length);
  const requested = new Set(actions.map(action => prefix + action.file));
  const extracted = unzipSync(bytes, { filter: entry => requested.has(entry.name) });
  const files = {};
  for (const action of actions) {
    const file = extracted[prefix + action.file];
    if (!file?.length) throw new Error('角色包缺少图片：' + action.label);
    files[action.file] = file;
  }
  return { manifest: { schemaVersion: 1, renderMode: 'stills', name: manifest.name.trim(), kind: manifest.kind === 'pet' ? 'pet' : 'character', preview: actions.find(action => action.id === 'idle').file, anchor: manifest.anchor, hotspots: manifest.hotspots, actions }, files };
}

export function makePetArchive(pet, images) {
  if (!images.length || !images.some(image => image.id === 'idle')) throw new Error('导出时需要保留待机图。');
  const files = {}, actions = images.map(image => {
    const file = 'actions/' + image.id + '.png';
    files[file] = image.bytes;
    return { id: image.id, label: image.label, file, loop: false, durationMs: 1500, renderMode: 'stills' };
  });
  const manifest = { schemaVersion: 1, renderMode: 'stills', name: pet.name, kind: pet.kind || 'pet', preview: 'actions/idle.png', anchor: { x: .5, y: .9 }, actions };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files, { level: 0 });
}

