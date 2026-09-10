let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('lumapet-light', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('pets')) request.result.createObjectStore('pets', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media');
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器无法保存角色，请检查存储空间或隐私设置。'));
  });
  return database;
}
async function transaction(stores, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = operation(tx);
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(new Error('角色保存失败，请检查浏览器存储空间。'));
  });
}
export const listPets = () => transaction(['pets'], 'readonly', tx => tx.objectStore('pets').getAll());
export const getMedia = id => transaction(['media'], 'readonly', tx => tx.objectStore('media').get(id));
export const getDraft = () => transaction(['drafts'], 'readonly', tx => tx.objectStore('drafts').get('current'));
export const saveDraft = draft => transaction(['drafts'], 'readwrite', tx => tx.objectStore('drafts').put(draft, 'current'));
export const savePet = (pet, media) => transaction(['pets', 'media'], 'readwrite', tx => {
  tx.objectStore('pets').put(pet);
  tx.objectStore('media').put(media, pet.id);
});
export const removePet = id => transaction(['pets', 'media'], 'readwrite', tx => {
  tx.objectStore('pets').delete(id);
  tx.objectStore('media').delete(id);
});
