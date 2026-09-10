import { ACTIONS } from './catalog.js';
import { validatePlan } from './core.js';
import { getDraft, saveDraft } from './storage.js';
import { download, safeName } from './exports.js';
import { createBridge } from './bridge.js';

const $ = id => document.getElementById(id);
const running = job => job && ['queued', 'candidates-generating', 'actions-generating', 'processing'].includes(job.status);
const labels = { queued: '等待生成', 'actions-generating': '正在生成姿态', processing: '正在处理透明图片', completed: '姿态已生成', failed: '生成失败', interrupted: '生成已中断', cancelled: '生成已取消' };
const jobSummary = job => ({ id: job.id, name: job.name, status: job.status, progress: job.progress, error: job.error, petId: job.petId });

export function createWorkflow({ local, api, state, loadPlan, importPet, openPet, notify }) {
  let draft, sentResult, starting = false, delivering = false, acceptingImport = false;
  const error = message => { $('flow-error').textContent = message || ''; $('flow-error').hidden = !message; };
  const persist = () => saveDraft(draft).catch(cause => { error('制作资料暂时无法保存：' + cause.message + ' 请保存制作单备份。'); });
  const bridge = createBridge({
    local,
    async receivePlan(value, jobId) {
      const plan = validatePlan(value, ACTIONS);
      await loadPlan(plan);
      const job = state().jobs.find(item => item.id === jobId);
      draft = { plan, ...(job ? { job: jobSummary(job) } : {}) };
      await persist(); render(); location.hash = 'make'; update(state());
    },
    async receiveJob(job) {
      if (!draft || !job || typeof job.id !== 'string') return;
      draft.job = job; await persist(); render();
    },
    async receiveResult(bytes, jobId) {
      if (!draft || draft.job?.id !== jobId || delivering || draft.resultPetId || !(bytes instanceof Uint8Array) || bytes.length > 150 * 1024 * 1024) return;
      delivering = true;
      try {
        const pet = await importPet(new File([bytes], '生成角色.zip', { type: 'application/zip' }));
        draft.resultPetId = pet.id; await persist(); render();
        notify('新角色已取回并保存在此浏览器，可以检查与下载了。');
      } finally { delivering = false; }
    },
    connectionChanged(status, message) {
      const messages = {
        connecting: '正在打开本机网页，请保持两个页面都开着。',
        connected: '已连接本机，正在传送本次制作资料。',
        accepted: '制作单已送达。请在刚打开的本机页面确认并开始生成；这里会同步进度。',
        received: '已接收网页制作单。确认生成方式后，点击「开始生成姿态」。',
        closed: '连接窗口已关闭。本机任务会继续运行，重新连接可读取进度。'
      };
      $('connection-message').textContent = message || messages[status] || '';
      if (['error', 'unavailable'].includes(status)) {
        $('connection-help').open = true;
        if (status === 'error') error(message);
      }
      $('connect-local').disabled = false;
    }
  });

  function render() {
    $('make-empty').hidden = !!draft; $('make-content').hidden = !draft;
    if (!draft) return;
    const { plan, job } = draft, complete = state().pets.some(pet => pet.id === draft.resultPetId) || (local && job?.status === 'completed');
    $('order-photo').src = plan.reference.dataUrl; $('order-name').textContent = plan.name;
    $('order-kind').textContent = plan.kind === 'pet' ? '动物伙伴' : '人物角色';
    $('order-style').textContent = plan.style || '保留参考图中的主要特征';
    $('order-count').textContent = plan.actionIds.length + ' 张单图';
    $('order-poses').textContent = plan.actionIds.map(id => ACTIONS.find(action => action.id === id)?.label || id).join('、');
    $('local-setup').hidden = local;
    $('connect-local').hidden = local || complete;
    $('connection-help').hidden = local;
    $('local-start').hidden = !local || !!job;
    $('local-start').disabled = starting;
    $('flow-settings').hidden = !local || running(job) || complete;
    $('result-open').hidden = !complete;
    $('result-import').hidden = local || complete;
    const provider = state().provider;
    $('production-status').textContent = complete ? '全部姿态已就绪' : job ? (labels[job.status] || '处理任务') : local ? (provider.ready ? '生成服务已准备好' : '先连接生成服务') : '连接本机工作台';
    $('production-detail').textContent = complete ? '请逐张检查角色、姿态和透明边缘，再导出使用。' : job ? (job.error || job.progress?.label || '在本机继续此任务即可。') : local ? (provider.ready ? '点击下方按钮后会使用已配置的图像服务生成新图。' : provider.message || '打开生成设置，选择可用的本机 Codex 或图像 API。') : '打开电脑上的工作台，再把这份制作单送过去。';
    const progress = $('production-progress'); progress.hidden = !running(job);
    if (job) { progress.max = job.progress?.total || plan.actionIds.length; progress.value = Math.min(job.progress?.done || 0, progress.max); }
    $('result-detail').textContent = complete ? '成品已保存，可以查看全部姿态，下载 PNG、总览图与桌宠角色包。' : job?.status === 'completed' ? '正在从本机接收成品。若连接已断开，请重新连接；也可以手动导入角色包。' : '制作完成后，角色包会回到此网页。可以逐张检查、下载或导入桌宠。';
    $('production-steps').querySelector('[data-step=ready]').dataset.state = 'done';
    $('production-steps').querySelector('[data-step=generate]').dataset.state = complete ? 'done' : 'active';
    $('production-steps').querySelector('[data-step=result]').dataset.state = complete ? 'done' : 'waiting';
  }
  async function start() {
    if (!local || !draft || starting || draft.job) return;
    error('');
    if (!state().provider.ready) { error('生成服务尚未连接。请先打开「设置生成服务」，资料会保留。'); return; }
    starting = true; render();
    try {
      const { plan } = draft;
      const upload = await api('/api/uploads', { name: plan.reference.name, data: plan.reference.dataUrl.split(',')[1] });
      const job = await api('/api/jobs', { name: plan.name, kind: plan.kind, style: plan.style, actionIds: plan.actionIds, mainUploadId: upload.id, renderMode: 'stills' });
      draft.job = jobSummary(job); await persist(); render(); bridge.job(draft.job);
      update(await api('/api/state'));
    } catch (cause) { error(cause.message); }
    finally { starting = false; render(); }
  }
  async function deliver(job) {
    if (!bridge.connected || sentResult === job.petId) return;
    sentResult = job.petId;
    try {
      const response = await fetch('/api/pets/' + encodeURIComponent(job.petId) + '/export');
      if (!response.ok) throw new Error('成品读取失败，请在本机导出角色包后导入网站。');
      bridge.result(new Uint8Array(await response.arrayBuffer()), job.id);
    } catch (cause) { sentResult = null; error(cause.message); bridge.error(cause.message); }
  }
  function update(value) {
    if (!draft) return;
    if (!local) {
      if (draft.resultPetId && !value.pets.some(pet => pet.id === draft.resultPetId)) { delete draft.resultPetId; persist(); }
      render(); return;
    }
    const job = value.jobs.find(item => item.id === draft.job?.id);
    if (job) {
      const summary = jobSummary(job);
      if (JSON.stringify(summary) !== JSON.stringify(draft.job)) { draft.job = summary; persist(); }
      bridge.job(summary);
      if (job.status === 'completed') deliver(job);
    }
    render();
  }
  $('connect-local').addEventListener('click', () => {
    error('');
    try { bridge.connect($('local-address').value, draft); } catch (cause) { error(cause.message); }
  });
  $('download-plan').addEventListener('click', () => download(JSON.stringify(draft.plan, null, 2), safeName(draft.plan.name) + '-制作单.json', 'application/json'));
  $('local-start').addEventListener('click', start);
  $('flow-settings').addEventListener('click', () => $('settings-open').click());
  $('result-import').addEventListener('click', () => { acceptingImport = true; $('pet-file').click(); });
  $('pet-file').addEventListener('cancel', () => { acceptingImport = false; });
  $('make-import-empty').addEventListener('click', () => $('plan-file').click());
  $('result-open').addEventListener('click', async () => {
    const pet = state().pets.find(item => item.id === (local ? draft.job?.petId : draft.resultPetId));
    try {
      if (pet) await openPet(pet); else error('此角色已不在当前角色库。请从本机重新导入角色包。');
    } catch (cause) { error(cause.message); }
  });
  return {
    update,
    async imported(pet) {
      if (!acceptingImport || !draft) return;
      acceptingImport = false;
      if (pet.name !== draft.plan.name || !draft.plan.actionIds.every(id => pet.actions.some(action => action.id === id))) {
        error('已导入该角色，但名字或姿态与当前制作单不一致。本次制作尚未标为完成，请检查导入的文件。');
        return;
      }
      draft.resultPetId = pet.id; await persist(); error(''); render();
    },
    async prepare(plan) {
      if (draft && running(draft.job)) throw new Error('当前制作尚未结束。请先在「生成与交付」完成或取消任务，再确认新的制作单。');
      draft = { plan: validatePlan(plan, ACTIONS) }; sentResult = null;
      await persist(); error(''); render(); location.hash = 'make';
      $('make-title').focus({ preventScroll: true });
    },
    async init() {
      try {
        const saved = await getDraft();
        if (saved) { draft = { ...saved, plan: validatePlan(saved.plan, ACTIONS) }; await loadPlan(draft.plan); }
      } catch (cause) { error(cause.message); }
      render(); bridge.startLocal();
    }
  };
}
