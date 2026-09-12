import { ACTIONS } from './catalog.js?v=1.8.1';
import { validatePlan } from './core.js?v=1.8.1';
import { getDraft, saveDraft } from './storage.js?v=1.8.1';
import { download, safeName } from './exports.js?v=1.8.1';
const $ = id => document.getElementById(id);
const inProgress = job => job && ['submitting', 'queued', 'actions-generating', 'processing', 'packaging'].includes(job.status);
const labels = { queued: '已送达，等待制作', 'actions-generating': '正在制作你的姿态', processing: '正在整理透明图片', packaging: '图片已完成，正在准备程序包', ready: '你的桌宠准备好了', failed: '制作暂未完成', interrupted: '制作已暂停', cancelled: '制作已取消', 'packaging-failed': '图片完成，程序包需要重试' };

export function createRemoteWorkflow({ state, loadPlan, importPet, openPet, notify }) {
  let draft, endpoint, submitting = false, polling = false, timer, ready = false, importing = false, connecting = false, collecting = false, connectionTimer;
  let connectionDetail = '确认后，照片和设定会发送到绒星工作室，由工作室电脑生成并打包。', errorSource;
  const error = (message, source = 'flow') => { errorSource = source; $('flow-error').textContent = message || ''; $('flow-error').hidden = !message; };
  const persist = () => saveDraft(draft);
  const orderUrl = action => endpoint + '/visitor/orders/' + draft.receipt + (action ? '/' + action : '');
  const link = () => location.href.split('#')[0] + '#collect=' + draft.receipt;
  const request = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
    let response;
    try { response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(body ? 60000 : 15000), cache: 'no-store' }); }
    catch { throw new Error('暂时连不上工作室。资料和取件链接已保留，恢复后点“刷新进度”；请勿重复提交。'); }
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求未完成，请稍后重试。'); return result;
  };
  function render() {
    const retrieving = /^#collect=[a-f0-9]{64}$/.test(location.hash);
    $('make-empty').querySelector('h2').textContent = retrieving ? '正在取回你的伙伴' : '先给伙伴一个模样';
    $('make-empty').querySelector('p').textContent = retrieving ? '取件链接已保留。网络恢复后会自动继续，无需重新上传照片。' : '放入照片并确认设定后，制作单和进度会出现在这里。';
    $('make-empty').querySelector('a').hidden = retrieving; $('make-import-empty').hidden = retrieving;
    $('make-empty').after($('flow-error'));
    $('make-empty').hidden = !!draft; $('make-content').hidden = !draft;
    $('remote-production').hidden = !draft;
    for (const id of ['local-setup', 'connect-local', 'local-start', 'flow-settings', 'connection-help', 'result-import']) $(id).hidden = true;
    if (!draft) return;
    const { plan, remote: job } = draft;
    $('order-photo').src = plan.reference.dataUrl; $('order-name').textContent = plan.name;
    $('order-kind').textContent = plan.kind === 'pet' ? '动物伙伴' : '人物角色';
    $('order-style').textContent = plan.style || '保留照片中的主要特征';
    $('order-count').textContent = plan.actionIds.length + ' 张单图'; $('order-storage').textContent = '工作室制作 · 专属链接取件';
    $('order-poses').textContent = plan.actionIds.map(id => ACTIONS.find(action => action.id === id)?.label).join('、');
    $('remote-send').hidden = !!job; $('remote-send').disabled = submitting || !ready;
    $('remote-send').textContent = submitting ? '正在发送照片…' : '提交给工作室制作';
    $('remote-consent-row').hidden = !!job; $('remote-refresh').hidden = false;
    $('remote-refresh').textContent = draft.receipt ? '刷新进度' : '重新检查连接'; $('remote-refresh').disabled = connecting || polling;
    $('remote-receipt').hidden = !draft.receipt;
    if (draft.receipt) $('receipt-link').value = link();
    const complete = job?.status === 'ready';
    $('windows-download').hidden = !complete; $('poses-download').hidden = !complete;
    $('android-download').hidden = !complete || !job.androidBytes;
    $('phone-open').hidden = !complete;
    $('windows-help').hidden = !complete;
    $('android-help').hidden = !complete || !job.androidBytes;
    if (complete) {
      $('windows-download').href = orderUrl('windows'); $('poses-download').href = orderUrl('poses');
      $('windows-download').textContent = '下载我的 Windows 桌宠 · ' + Math.round(job.bytes / 1024 / 1024) + ' MB';
      $('android-download').href = orderUrl('android');
      $('android-download').textContent = '下载 Android 桌宠 · ' + Math.round(job.androidBytes / 1024 / 1024) + ' MB';
      $('phone-open').href = './phone.html#collect=' + draft.receipt;
    }
    $('result-open').hidden = !complete; $('result-open').textContent = importing ? '正在载入预览…' : '检查全部姿态'; $('result-open').disabled = importing;
    if (complete) {
      const downloads = $('windows-download').parentElement;
      $('production-steps').after(downloads); downloads.prepend($('result-open'));
      if (/Android/i.test(navigator.userAgent) && job.androidBytes) downloads.prepend($('android-download'));
    }
    $('remote-retry').hidden = !['failed', 'interrupted', 'cancelled', 'packaging-failed'].includes(job?.status) && !(complete && !job.androidBytes);
    $('remote-retry').textContent = complete ? '补齐 Android 安装包' : '继续制作 / 重新打包';
    $('remote-delete').hidden = !job || inProgress(job);
    $('production-status').textContent = job ? labels[job.status] || '正在接收资料' : ready ? '工作室可以接单' : connecting ? '正在连接工作室' : '工作室暂未接单';
    $('production-detail').textContent = job?.message || (job?.queueAhead ? `前面还有 ${job.queueAhead} 份制作，轮到后会自动开始。` : complete ? '程序已带上你的角色；可以先查看姿态，再下载到电脑。' : job ? '可以关闭网页，使用下方取件链接回来查看。进度按实际步骤更新。' : connectionDetail);
    const progress = $('production-progress'); progress.hidden = !inProgress(job);
    progress.max = plan.actionIds.length; progress.value = job?.progress?.done || 0;
    $('result-detail').textContent = complete ? '按设备下载，角色已装进程序。也可以直接打开手机网页陪伴。' : '这里将提供 Windows 桌宠、Android 安装包、透明姿态图片和预览。';
    $('production-steps').querySelector('[data-step=ready]').dataset.state = 'done';
    $('production-steps').querySelector('[data-step=generate]').dataset.state = complete ? 'done' : 'active';
    $('production-steps').querySelector('[data-step=result]').dataset.state = complete ? 'done' : 'waiting';
  }
  function scheduleAvailability() {
    clearTimeout(connectionTimer);
    if (!document.hidden && (!draft?.receipt || location.hash.startsWith('#collect='))) connectionTimer = setTimeout(reconnect, 15000);
  }
  async function availability({ silent = false } = {}) {
    if (connecting) return;
    connecting = true; render();
    try {
      if (!endpoint) {
        const config = await request('./service.json');
        const parsed = new URL(config.url || location.origin);
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('工作室连接配置无效');
        endpoint = parsed.origin;
      }
      const status = await request(endpoint + '/visitor/status'); ready = status.accepting;
      $('service-status').textContent = ready ? '工作室在线 · 可提交测试' : status.online ? '工作室暂忙 · 请稍后提交' : '工作室离线 · 请稍后提交';
      connectionDetail = ready ? '工作室已连接。确认后即可发送照片和设定，生成与打包由工作室完成。' : status.online ? '工作室已连接，当前队列或生图服务暂不可用。资料已保留，页面会自动重新检查。' : '工作室制作电脑暂未在线。资料已保留，页面会自动重新检查；你无需安装本机工作台。';
      if (!silent || errorSource === 'connection') error('');
    } catch (cause) {
      ready = false; $('service-status').textContent = '暂时无法连接工作室';
      connectionDetail = '当前网络暂时无法访问工作室。资料已保留，恢复联网后会重新连接。';
      if (!silent || errorSource === 'connection') error('暂时连不上工作室，资料仍在此浏览器。页面会自动重连，也可点“重新检查连接”。', 'connection');
    }
    finally { connecting = false; render(); scheduleAvailability(); }
  }
  const reconnect = async () => {
    if (document.hidden) return;
    await availability({ silent: true });
    if (endpoint && location.hash.startsWith('#collect=')) {
      try { await collect(); } catch (cause) { error(cause.message, 'connection'); }
    } else if (draft?.receipt) refresh();
  };
  window.addEventListener('online', reconnect);
  window.addEventListener('focus', reconnect);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(connectionTimer); else reconnect(); });
  async function collect() {
    const collection = location.hash.match(/^#collect=([a-f0-9]{64})$/);
    if (!collection || collecting) return false;
    collecting = true;
    if (draft && draft.receipt !== collection[1]) { draft = undefined; render(); }
    try {
      const result = await request(endpoint + '/visitor/orders/' + collection[1] + '?includePlan=1');
      if (location.hash !== collection[0]) return true;
      const { plan, ...job } = result;
      draft = { plan: validatePlan(plan, ACTIONS), receipt: collection[1], remote: job, delivery: 'studio' };
      await persist(); await loadPlan(draft.plan); error(''); render(); location.hash = 'make'; refresh();
      return true;
    } finally { collecting = false; }
  }
  window.addEventListener('hashchange', () => { if (endpoint && location.hash.startsWith('#collect=')) collect().catch(cause => { error(cause.message, 'connection'); scheduleAvailability(); }); });
  async function refresh() {
    if (!draft?.receipt || endpoint === undefined || polling) return;
    polling = true; const receipt = draft.receipt;
    try {
      const result = await request(orderUrl());
      if (draft?.receipt !== receipt) return;
      const { plan, ...job } = result; draft.remote = job; await persist(); error(''); render();
    } catch (cause) { error(cause.message); }
    finally { polling = false; render(); clearTimeout(timer); if (inProgress(draft?.remote)) timer = setTimeout(refresh, 6000); }
  }
  async function submit() {
    if (submitting || !draft || !ready || draft.remote) return;
    if (!$('remote-consent').checked) { error('请先确认照片会发送给工作室和图像生成服务。'); $('remote-consent').focus(); return; }
    submitting = true; error('');
    try {
      draft.receipt ||= [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
      await persist(); render();
      const photo = new Image(); photo.src = draft.plan.reference.dataUrl; await photo.decode();
      const ratio = Math.min(1, 1280 / Math.max(photo.naturalWidth, photo.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(photo.naturalWidth * ratio); canvas.height = Math.round(photo.naturalHeight * ratio);
      const paint = canvas.getContext('2d'); paint.fillStyle = '#ffffff'; paint.fillRect(0, 0, canvas.width, canvas.height); paint.drawImage(photo, 0, 0, canvas.width, canvas.height);
      const plan = { ...draft.plan, reference: { name: '参考图.jpg', dataUrl: canvas.toDataURL('image/jpeg', .9) } };
      draft.remote = await request(orderUrl(), { plan, consent: true });
      await persist(); render(); notify('照片已送达工作室。请保存取件链接。'); refresh();
    } catch (cause) { error(cause.message); }
    finally { submitting = false; render(); }
  }
  $('remote-send').addEventListener('click', submit);
  $('remote-refresh').addEventListener('click', async () => { await availability(); if (draft?.receipt) await refresh(); });
  $('remote-retry').addEventListener('click', async () => {
    $('remote-retry').disabled = true;
    try { draft.remote = await request(orderUrl('retry'), {}); await persist(); render(); refresh(); } catch (cause) { error(cause.message); }
    finally { $('remote-retry').disabled = false; }
  });
  $('receipt-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link()); notify('取件链接已复制，请妥善保存。'); }
    catch { $('receipt-link').select(); notify('请复制已选中的取件链接。'); }
  });
  $('receipt-save').addEventListener('click', () => download('你的绒星桌宠取件链接\n' + link() + '\n请勿公开此链接，持有链接的人可以查看照片和下载成品。', safeName(draft.plan.name) + '-取件链接.txt', 'text/plain'));
  $('download-plan').addEventListener('click', () => download(JSON.stringify(draft.plan, null, 2), safeName(draft.plan.name) + '-制作单.json', 'application/json'));
  $('make-import-empty').addEventListener('click', () => $('plan-file').click());
  $('result-open').addEventListener('click', async () => {
    if (importing) return; importing = true; render();
    try {
      let pet = state().pets.find(pet => pet.id === draft.resultPetId);
      if (!pet) {
        const response = await fetch(orderUrl('poses')); if (!response.ok) throw new Error('姿态图片暂时无法下载，请刷新重试。');
        pet = await importPet(new File([await response.blob()], '姿态图片.zip', { type: 'application/zip' }));
        draft.resultPetId = pet.id; await persist();
      }
      await openPet(pet);
    } catch (cause) { error(cause.message); }
    finally { importing = false; render(); }
  });
  $('remote-delete').addEventListener('click', async () => {
    if (!confirm('删除工作室中这份任务的照片与成品？取件链接将失效。已下载到你电脑的文件会保留。')) return;
    try { await request(orderUrl(), undefined, 'DELETE'); draft = null; await persist(); render(); notify('云端照片与成品已删除，工作室电脑将在下次连接时同步清理。'); }
    catch (cause) { error(cause.message); }
  });
  return {
    update: render, imported() {},
    async prepare(plan) {
      if (inProgress(draft?.remote)) throw new Error('当前角色正在制作，请先在“生成与交付”查看进度。');
      if (plan.actionIds.length > 20) throw new Error('测试阶段最多制作 20 张姿态，请减少额外动作。');
      draft = { plan: validatePlan(plan, ACTIONS), delivery: 'studio' }; await persist(); error(''); render(); location.hash = 'make'; $('make-title').focus({ preventScroll: true });
      await availability();
    },
    async init() {
      render();
      try {
        const config = await request('./service.json');
        endpoint = config.url || location.origin;
        const parsed = new URL(endpoint); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('工作室连接配置无效');
        endpoint = parsed.origin;
        if (!await collect()) { const saved = await getDraft(); if (saved?.plan) { draft = { ...saved, plan: validatePlan(saved.plan, ACTIONS) }; await loadPlan(draft.plan); } }
        await availability();
        if (draft?.receipt) refresh();
      } catch (cause) {
        $('service-status').textContent = '工作室暂未连接';
        // A network failure must not hide the browser's saved photos/receipt.
        if (!draft) {
          const saved = await getDraft(), requested = location.hash.match(/^#collect=([a-f0-9]{64})$/)?.[1];
          if (saved?.plan && (!requested || saved.receipt === requested)) { draft = saved; await loadPlan(saved.plan); }
        }
        error(cause.message, 'connection');
      }
      render(); scheduleAvailability();
    }
  };
}
