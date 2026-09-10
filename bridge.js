// The website exchanges a single user-selected plan with an opened local page.
// Local HTTP APIs remain same-origin only; no CORS or network permissions are added.
const channel = 'lumapet-handoff-v1';
const publicOrigins = new Set(['https://yueyue999-arch.github.io', 'https://lumapet-studio.zhangyue9169.chatgpt.site']);
const loopback = url => url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
export function localAddress(value) {
  const url = new URL(value);
  if (!loopback(url) || url.username || url.password || url.search || (url.pathname !== '/' && url.pathname !== '')) throw new Error('请填写本机地址，例如 http://127.0.0.1:17654/。');
  return url.origin;
}
export function createBridge({ local, receivePlan, receiveJob, receiveResult, connectionChanged }) {
  let peer, origin, session, timer, deadline, ready = false, plan;
  const send = (type, data = {}) => {
    if (peer && !peer.closed) peer.postMessage({ channel, session, type, ...data }, origin);
  };
  const stop = () => { clearInterval(timer); timer = null; };
  const params = new URLSearchParams(location.hash.slice(1));
  if (local && window.opener && params.has('handoff')) {
    const incomingOrigin = params.get('origin');
    try {
      const url = new URL(incomingOrigin);
      if (url.origin === incomingOrigin && (publicOrigins.has(incomingOrigin) || loopback(url))) {
        peer = window.opener; origin = incomingOrigin; session = params.get('handoff');
      }
    } catch { /* Ignore an invalid incoming window address. */ }
  }
  const listen = async event => {
    const message = event.data;
    if (!peer || event.source !== peer || event.origin !== origin || message?.channel !== channel || message.session !== session) return;
    try {
      if (!local && message.type === 'ready') {
        ready = true; deadline = Date.now() + 20000;
        send('plan', plan); connectionChanged('connected');
      } else if (local && message.type === 'plan' && !ready) {
        // Take ownership before awaiting image decoding: repeated ready messages
        // cannot load the same plan concurrently or start a second generation.
        ready = true; stop();
        await receivePlan(message.plan, message.jobId);
        send('accepted'); connectionChanged('received');
      } else if (!local && message.type === 'accepted') {
        ready = true; stop(); connectionChanged('accepted');
      } else if (!local && message.type === 'job') await receiveJob(message.job);
      else if (!local && message.type === 'result') await receiveResult(message.bytes, message.jobId);
      else if (message.type === 'error') connectionChanged('error', message.message);
      else if (message.type === 'closed') connectionChanged('closed');
    } catch (error) {
      connectionChanged('error', error.message);
      if (local) send('error', { message: error.message });
    }
  };
  window.addEventListener('message', listen);
  window.addEventListener('pagehide', () => { send('closed'); stop(); });
  return {
    get connected() { return ready && peer && !peer.closed; },
    startLocal() {
      if (!local || !peer) return;
      send('ready');
      deadline = Date.now() + 20000;
      timer = setInterval(() => {
        if (ready || peer.closed || Date.now() > deadline) return stop();
        send('ready');
      }, 700);
    },
    connect(value, draft) {
      stop(); ready = false;
      origin = localAddress(value); session = crypto.randomUUID();
      plan = { plan: draft.plan, jobId: draft.job?.id };
      peer = window.open(origin + '/#handoff=' + session + '&origin=' + encodeURIComponent(location.origin), 'lumapet-local-' + session);
      if (!peer) throw new Error('浏览器拦住了新窗口，请允许本网站打开弹出式窗口，再连接。也可保存制作单，在本机导入。');
      connectionChanged('connecting'); deadline = Date.now() + 15000;
      timer = setInterval(() => {
        if (peer.closed || Date.now() > deadline) {
          stop(); connectionChanged('unavailable', '还没有收到本机工作台的回应。请先打开新版工作台，再重新连接；也可用制作单手动导入。');
        }
      }, 500);
    },
    job(job) { send('job', { job }); },
    result(bytes, jobId) { send('result', { bytes, jobId }); },
    error(message) { send('error', { message }); }
  };
}
