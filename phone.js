import {readPetArchive} from './core.js?v=1.8.0';
const $=id=>document.getElementById(id);
let record,urls={},pose='idle',reset,installPrompt,offset={x:0,y:0};
const failure=message=>{$('error').textContent=message||'';$('error').hidden=!message;};
const database=new Promise((resolve,reject)=>{const request=indexedDB.open('lumapet-phone',1);request.onupgradeneeded=()=>request.result.createObjectStore('pet');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('浏览器无法保存角色，请检查存储空间。'));});
async function stored(value,remove=false){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('pet',value===undefined&&!remove?'readonly':'readwrite');const store=tx.objectStore('pet');const request=remove?store.delete('current'):value===undefined?store.get('current'):store.put(value,'current');tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(new Error('角色保存失败，请检查设备空间。'));});}
function show(id){if(!record)return;const action=record.manifest.actions.find(action=>action.id===id);if(!action)return;pose=id;$('image').src=urls[action.file];$('pose-label').textContent=action.label;$('poses').value=id;$('sleep').textContent=id==='sleep'?'叫醒':'睡觉';}
function interact(id){clearTimeout(reset);show(id);$('pet').classList.remove('is-patted');requestAnimationFrame(()=>$('pet').classList.add('is-patted'));if(!['idle','sleep'].includes(id))reset=setTimeout(()=>show('idle'),1800);}
function render(value){for(const url of Object.values(urls))URL.revokeObjectURL(url);record=value;urls={};offset={x:0,y:0};$('pet').style.transform='';$('poses').replaceChildren();
  if(!record){$('image').removeAttribute('src');$('name').textContent='把伙伴带在身边';$('status').textContent='从取件页打开你的角色，或导入已有姿态包。';}
  else{for(const [file,bytes] of Object.entries(record.files))urls[file]=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));$('name').textContent=record.manifest.name;document.title=record.manifest.name+' · 绒星';for(const action of record.manifest.actions){const option=document.createElement('option');option.value=action.id;option.textContent=action.label;$('poses').append(option);}show('idle');$('status').textContent='角色已保存在此设备，可以离线陪伴。';}
  for(const id of ['pet','pat','sleep','eat','poses'])$(id).disabled=!record;$('forget').hidden=!record;
}
async function importBytes(bytes,receipt){if(bytes.length>25*1024*1024)throw new Error('手机姿态包不能超过 25 MB。');const value=readPetArchive(bytes);if(value.manifest.actions.length>20)throw new Error('手机端最多接收 20 张静态姿态。');
  for(const file of Object.values(value.files)){const view=new DataView(file.buffer,file.byteOffset,file.byteLength);if(file.length<24||view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a||view.getUint32(16)>2048||view.getUint32(20)>2048)throw new Error('请导入绒星输出的 PNG 姿态包，每张不超过 2048 像素。');}
  const next={...value,receipt};await stored(next);render(next);failure('');if(location.hash)history.replaceState(null,'',location.pathname);}
$('import').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file){if(file.size>25*1024*1024)throw new Error('手机姿态包不能超过 25 MB。');await importBytes(new Uint8Array(await file.arrayBuffer()));}}catch(error){failure(error.message);}finally{event.target.value='';}});
$('pat').onclick=()=>interact('pat');$('eat').onclick=()=>interact('eat');$('sleep').onclick=()=>interact(pose==='sleep'?'wake':'sleep');$('poses').onchange=event=>{clearTimeout(reset);show(event.target.value);};
$('forget').onclick=async()=>{if(confirm('从此设备移除角色？工作室的成品和已经下载的程序仍会保留。')){await stored(undefined,true);clearTimeout(reset);render(null);}};
let drag;
$('pet').addEventListener('pointerdown',event=>{if(!record)return;drag={x:event.clientX,y:event.clientY,previous:{...offset},moved:false};$('pet').setPointerCapture(event.pointerId);});
function move(x,y){const room=$('room'),button=$('pet');const maxX=(room.clientWidth-button.offsetWidth)/2,maxY=(room.clientHeight-button.offsetHeight)/2;offset={x:Math.max(-maxX,Math.min(maxX,x)),y:Math.max(-maxY,Math.min(maxY,y))};button.style.transform=`translate(${offset.x}px,${offset.y}px)`;}
$('pet').addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>6)drag.moved=true;if(drag.moved)move(drag.previous.x+dx,drag.previous.y+dy);});
$('pet').addEventListener('pointerup',()=>{if(drag&&!drag.moved)interact('pat');drag=null;});$('pet').addEventListener('pointercancel',()=>{drag=null;});
$('pet').addEventListener('click',event=>{if(event.detail===0)interact('pat');});
$('pet').addEventListener('keydown',event=>{const step={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[event.key];if(step){event.preventDefault();move(offset.x+step[0],offset.y+step[1]);}});
window.addEventListener('resize',()=>move(offset.x,offset.y));document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(reset);});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else{$('install-help').hidden=false;$('install-detail').textContent=/iPhone|iPad|iPod/.test(navigator.userAgent)?'请用 Safari 打开本页，点击分享按钮，再选择“添加到主屏幕”。安装后首次打开需要联网载入，之后可离线查看已保存的角色。':'打开浏览器菜单，选择“添加到主屏幕”或“安装应用”。若没有这个选项，可收藏此页继续使用。';}};
try{
  const previous=await stored();const token=location.hash.match(/^#collect=([a-f0-9]{64})$/)?.[1];
  if(token){if(previous?.receipt===token)render(previous);else render(null);$('status').textContent='正在取回专属姿态…';const config=await(await fetch('./service.json')).json();const endpoint=new URL(config.url||location.origin).origin;const response=await fetch(endpoint+'/visitor/orders/'+token+'/poses',{signal:AbortSignal.timeout(30000),cache:'no-store'});if(!response.ok)throw new Error('角色暂未取回，请等制作完成后从原取件页重新打开。');await importBytes(new Uint8Array(await response.arrayBuffer()),token);}
  else render(previous);
  if('serviceWorker'in navigator){await navigator.serviceWorker.register('./phone-sw.js?v=1.8.0');await navigator.serviceWorker.ready;}
}catch(error){failure(error.message);$('status').textContent=record?'已显示此设备保存的角色；当前联网取件未完成。':'尚未载入角色，可以导入已有姿态包或从取件页重试。';}
