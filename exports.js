import { firstFrame, makePetArchive } from './core.js?v=1.8.1';

export const safeName = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) || '绒星角色';
export function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function poseBlob(pet, media, actionId) {
  const action = pet.actions.find(item => item.id === actionId);
  if (!action) throw new Error('这个姿态尚未制作，请先选择已有的姿态。');
  const source = firstFrame(action);
  if (media[source]) return media[source];
  const response = await fetch(source);
  if (!response.ok) throw new Error('图片读取失败：' + action.label);
  return response.blob();
}
const png = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败，请重试。')), 'image/png'));
export async function imagesFor(pet, media, actions) {
  return Promise.all(actions.map(async action => {
    const bitmap = await createImageBitmap(await poseBlob(pet, media, action.id));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
    return { id: action.id, label: action.label, bytes: new Uint8Array(await (await png(canvas)).arrayBuffer()) };
  }));
}
export async function exportArchive(pet, media, actions) {
  const images = await imagesFor(pet, media, actions);
  download(makePetArchive(pet, images), safeName(pet.name) + '-' + images.length + '张姿态.zip', 'application/zip');
  return images.length;
}
export async function exportSingle(pet, media, action) {
  const [image] = await imagesFor(pet, media, [action]);
  download(image.bytes, safeName(pet.name + '-' + action.label) + '.png', 'image/png');
}
export async function exportSheet(pet, media, actions) {
  if (!actions.length) throw new Error('请先选择已有的姿态。');
  const columns = Math.min(5, actions.length), cell = 240, rows = Math.ceil(actions.length / columns);
  const canvas = document.createElement('canvas'); canvas.width = columns * cell; canvas.height = rows * 280 + 100;
  const context = canvas.getContext('2d');
  context.fillStyle = '#edf3f4'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#214a42'; context.font = 'bold 26px Microsoft YaHei, sans-serif'; context.fillText(pet.name + ' · ' + actions.length + ' 张姿态', 28, 52);
  for (let i = 0; i < actions.length; i++) {
    const x = i % columns * cell, y = Math.floor(i / columns) * 280 + 88;
    const bitmap = await createImageBitmap(await poseBlob(pet, media, actions[i].id));
    const scale = Math.min(216 / bitmap.width, 216 / bitmap.height), width = bitmap.width * scale, height = bitmap.height * scale;
    context.fillStyle = '#ffffff'; context.fillRect(x + 8, y, cell - 16, 268);
    context.drawImage(bitmap, x + (cell - width) / 2, y + 12 + (216 - height) / 2, width, height); bitmap.close();
    context.fillStyle = '#223836'; context.font = '18px Microsoft YaHei, sans-serif'; context.textAlign = 'center';
    context.fillText(actions[i].label, x + cell / 2, y + 250, 212);
  }
  download(await png(canvas), safeName(pet.name) + '-姿态总览.png', 'image/png');
}
