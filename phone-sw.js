const VERSION='1.8.1';
const CACHE='lumapet-phone-'+VERSION;
const STATIC=['phone.html','phone.css','phone.js','phone.webmanifest','core.js','vendor/fflate.js','assets/phone-192.png','assets/phone-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC.map(file=>file+'?v='+VERSION))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lumapet-phone-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),base=new URL('./',self.location.href);
  if(event.request.method!=='GET'||url.origin!==base.origin)return;
  const relative=url.pathname.slice(base.pathname.length);
  if(!STATIC.includes(relative))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request,{ignoreSearch:true})));
});
