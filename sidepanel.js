// ============================================================
// PATH AI — SIDE PANEL LOGIC
// ============================================================

var PATH_AI_SVG = '<svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="spGrad" x1="0" y1="0" x2="48" y2="48"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs><circle cx="24" cy="24" r="22" stroke="url(#spGrad)" stroke-width="3" fill="none" opacity="0.4"/><path d="M24 6 L24 42 M6 24 L42 24" stroke="url(#spGrad)" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/><path d="M14 34 L24 12 L34 34 Z" fill="url(#spGrad)"/><circle cx="24" cy="24" r="5" fill="#fff"/></svg>';

var messages = [];
var currentChatId = null;
var aiMemory = [];
var isResponding = false;
var currentAbortController = null;
var currentTypewriter = null;
var autoApprove = false;

var MODEL_CONFIG = {
  auto: { label: 'Auto', modelId: 'openrouter/free', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  gemini: { label: 'Gemini', modelId: 'google/gemini-2.5-flash-lite', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  chatgpt: { label: 'ChatGPT', modelId: 'minimax/minimax-m3:free', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  claude: { label: 'Claude', modelId: 'poolside/laguna-s-2.1:free', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  deepseek: { label: 'DeepSeek', modelId: 'deepseek/deepseek-r1-distill-llama-70b:free', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  perplexity: { label: 'Perplexity AI', modelId: 'sonar', keyType: 'perplexity', endpoint: 'https://api.perplexity.ai' },
  agnes: { label: 'Agnes AI', modelId: 'agnes-2.5-flash', keyType: 'agnes', endpoint: 'https://api.agnes.ai/v1' },
  groq: { label: 'Groq', modelId: 'openai/gpt-oss-20b', keyType: 'groq', endpoint: 'https://api.groq.com/openai/v1' },
  llama: { label: 'Llama 3.3', modelId: 'meta-llama/llama-3.3-70b-instruct', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  mistral: { label: 'Mistral', modelId: 'mistralai/mistral-small-3.1-24b-instruct', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
  qwen: { label: 'Qwen', modelId: 'qwen/qwen3-235b-a22b', keyType: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
};

function renderMarkdown(text) {
  if (!text) return '';
  var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```([\s\S]*?)```/g, function (m, c) { return '<pre class="path-ai-code-block"><code>' + c.trim() + '</code></pre>'; });
  html = html.replace(/`([^`]+)`/g, '<code class="path-ai-code-inline">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, function (m) { return '<ul class="path-ai-list">' + m + '</ul>'; });
  html = html.replace(/<\/ul>\s*<ul class="path-ai-list">/g, '');
  html = html.replace(/\n/g, '<br>');
  return html;
}
function stripToolTags(text) {
  return text.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '').replace(/<\|[^|]*\|>/g, '').replace(/\[[a-z_]+\][\s\S]*?\[\/[a-z_]+\]/g, '').replace(/\[[a-z_]+\]/g, '').replace(/\[\/[a-z_]+\]/g, '').trim();
}

async function loadAIMemory() { var d = await chrome.storage.local.get(['aiMemory']); aiMemory = d.aiMemory || []; }
async function saveAIMemory() { await chrome.storage.local.set({ aiMemory: aiMemory }); }
async function addAIMemory(fact) {
  if (!fact || fact.length < 5) return;
  var fl = fact.toLowerCase();
  for (var i = 0; i < aiMemory.length; i++) { var ex = aiMemory[i].toLowerCase(); if (ex === fl) return; if (ex.indexOf(fl) !== -1 || fl.indexOf(ex) !== -1) { if (fact.length > aiMemory[i].length) aiMemory[i] = fact; return; } }
  aiMemory.push(fact); if (aiMemory.length > 50) aiMemory = aiMemory.slice(-50); await saveAIMemory();
}
function buildMemoryContext() { if (!aiMemory.length) return ''; return '\n\n=== AI MEMORY ===\n' + aiMemory.map(function (f, i) { return (i + 1) + '. ' + f; }).join('\n') + '\n=== END ===\n'; }
function extractMemoryFacts(text) {
  var facts = [];
  var patterns = [/(?:my name is|I am called|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi, /(?:I like|I love|I enjoy)\s+([^.!?\n]{5,80})/gi, /(?:I prefer)\s+([^.!?\n]{5,80})/gi, /(?:I work as|I am a|I'm a)\s+([^.!?\n]{3,80})/gi, /(?:I live in)\s+([^.!?\n]{2,80})/gi, /(?:my favorite|my favourite)\s+([^.!?\n]{3,80})/gi];
  for (var p = 0; p < patterns.length; p++) { var match; while ((match = patterns[p].exec(text)) !== null && facts.length < 5) { var fact = match[0].trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim(); if (fact.length >= 5 && fact.length <= 120) facts.push(fact); } }
  return facts;
}

async function saveConversation() {
  if (!currentChatId) currentChatId = 'conv-' + Date.now();
  var all = await chrome.storage.local.get(['conversations']); var h = all.conversations || {};
  h[currentChatId] = { id: currentChatId, title: messages.length ? messages[0].content.slice(0, 40) : 'New', messages: messages, timestamp: Date.now() };
  await chrome.storage.local.set({ conversations: h });
}
async function loadConversations() { var all = await chrome.storage.local.get(['conversations']); return all.conversations || {}; }
async function deleteConversation(id) { var all = await chrome.storage.local.get(['conversations']); var h = all.conversations || {}; delete h[id]; await chrome.storage.local.set({ conversations: h }); }

function renderMessages() {
  var c = document.getElementById('nimbus-messages'); if (!c) return; c.innerHTML = '';
  for (var i = 0; i < messages.length; i++) {
    var el = document.createElement('div'); el.className = 'nimbus-msg nimbus-' + messages[i].role + ' nimbus-msg-enter';
    if (messages[i].image) { el.innerHTML = '<img class="nimbus-msg-image" src="' + messages[i].image + '" alt="' + (messages[i].imageAlt || 'image') + '" />' + (messages[i].content ? '<div class="nimbus-msg-file-label">' + messages[i].content + '</div>' : ''); }
    else if (messages[i].role === 'assistant') { el.innerHTML = renderMarkdown(messages[i].content); }
    else { el.textContent = messages[i].content; }
    c.appendChild(el); (function (e, idx) { setTimeout(function () { e.classList.add('nimbus-msg-show'); }, idx * 30); })(el, i);
  }
  c.scrollTop = c.scrollHeight;
}

function showTyping() {
  var c = document.getElementById('nimbus-messages'); if (!c) return;
  var el = document.createElement('div'); el.className = 'nimbus-msg nimbus-typing'; el.id = 'nimbus-typing';
  el.innerHTML = '<div class="nimbus-typing-dots"><span class="nimbus-typing-dot"></span><span class="nimbus-typing-dot"></span><span class="nimbus-typing-dot"></span></div><span class="nimbus-typing-text">Path AI is thinking...</span>';
  c.appendChild(el); c.scrollTop = c.scrollHeight;
}
function hideTyping() { var t = document.getElementById('nimbus-typing'); if (t) t.remove(); }
function showThinking(steps) {
  var ts = steps || ['thinking...']; var c = document.getElementById('nimbus-messages'); if (!c) return;
  var ex = document.getElementById('nimbus-thinking'); if (ex) { if (ex._ti) clearInterval(ex._ti); ex.remove(); }
  var el = document.createElement('div'); el.className = 'nimbus-msg nimbus-thinking'; el.id = 'nimbus-thinking';
  el.innerHTML = '<div class="nimbus-thinking-icon-wrap">' + PATH_AI_SVG + '<div class="nimbus-thinking-shimmer"></div></div><div><div class="nimbus-thinking-text">Path AI is thinking...</div><div class="nimbus-thinking-steps" id="nimbus-thinking-steps">' + ts[0] + '</div><div class="nimbus-thinking-bar"><div class="nimbus-thinking-bar-fill"></div></div></div>';
  c.appendChild(el); c.scrollTop = c.scrollHeight;
  var si = 0; el._ti = setInterval(function () { si = (si + 1) % ts.length; var se = document.getElementById('nimbus-thinking-steps'); if (se) { se.style.opacity = '0'; setTimeout(function () { se.textContent = ts[si]; se.style.opacity = '1'; }, 200); } }, 1500);
}
function hideThinking() { var t = document.getElementById('nimbus-thinking'); if (t) { if (t._ti) clearInterval(t._ti); t.remove(); } }

var SEND_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

function stopAIResponse() {
  if (currentAbortController) { try { currentAbortController.abort(); } catch (e) {} currentAbortController = null; }
  if (currentTypewriter) { clearInterval(currentTypewriter); currentTypewriter = null; renderMessages(); }
  isResponding = false; hideThinking();
  var sb = document.getElementById('nimbus-send'); if (sb) { sb.innerHTML = SEND_SVG; sb.disabled = false; sb.classList.remove('nimbus-send-stop'); }
  var inp = document.getElementById('nimbus-input'); if (inp) { inp.disabled = false; inp.style.opacity = ''; }
  var iw = inp ? inp.parentElement : null; if (iw) iw.classList.remove('sending');
}

function addMessage(role, content) {
  messages.push({ role: role, content: content });
  if (role === 'assistant' && content.length > 20) {
    var full = content; messages[messages.length - 1].content = ''; renderMessages();
    var c = document.getElementById('nimbus-messages'); var el = c.lastChild; var ci = 0;
    var iv = setInterval(function () { ci += 2; if (ci >= full.length) { messages[messages.length - 1].content = full; renderMessages(); clearInterval(iv); if (currentTypewriter === iv) currentTypewriter = null; isResponding = false; saveConversation(); } else { messages[messages.length - 1].content = full.slice(0, ci); if (el) { el.innerHTML = renderMarkdown(full.slice(0, ci)); c.scrollTop = c.scrollHeight; } } }, 15);
    currentTypewriter = iv;
  } else { renderMessages(); }
}

async function getPageContext() {
  var cb = document.getElementById('nimbus-include-page'); if (!cb || !cb.checked) return '';
  return new Promise(function (resolve) { chrome.runtime.sendMessage({ action: 'getPageContext' }, function (r) { resolve(r && r.context ? r.context : ''); }); });
}

async function getAIConfig() {
  var s = await chrome.storage.local.get(['apiKey', 'model', 'endpoint', 'modelChoice']);
  return { apiKey: s.apiKey, model: s.model, endpoint: (s.endpoint || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''), modelChoice: s.modelChoice || 'auto' };
}

function detectClientCommand(query) {
  var q = query.toLowerCase().trim();
  if (/^(?:hi|hello|hey|yo|sup|howdy|greetings)\b/i.test(q) && q.length < 30) return { type: 'greeting' };
  if (/^(?:list|show|what)\s+(?:all\s+)?(?:open\s+)?tabs/i.test(q)) return { type: 'list_tabs' };
  if (/scroll\s*(down|up|top|bottom)?/i.test(q)) { var dm = q.match(/scroll\s*(down|up|top|bottom)?/i); return { type: 'scroll', direction: dm[1] || 'down' }; }
  if (/^(?:reload|refresh)\s*(?:page|tab|site)?/i.test(q)) return { type: 'reload' };
  if (/^(?:go back|back|previous)/i.test(q)) return { type: 'go_back' };
  if (/^(?:go forward|forward|next)/i.test(q)) return { type: 'go_forward' };
  if (/^(?:new tab|open new tab)/i.test(q)) return { type: 'new_tab' };
  var closeM = query.match(/(?:close|shut|kill)\s+(?:this\s+)?(?:tab|window|page|site)?\s*(.+)?/i);
  if (closeM && /close|shut|kill/i.test(q) && (q.includes('tab') || q.includes('window') || q.includes('page') || q.includes('site') || closeM[1])) { var t = closeM[1] ? closeM[1].trim().toLowerCase() : ''; if (t && t !== 'this' && t !== 'tab' && t !== 'window' && t !== 'page' && t !== 'site') return { type: 'close_tab_by_url', url: siteToUrl(t) }; return { type: 'close_tab' }; }
  var switchM = query.match(/(?:switch|go|change|jump)\s+(?:to|back to|over to)?\s*(?:the\s+)?(.+?)\s*(?:tab|window|page|site)?/i);
  if (switchM && /switch|change|jump/i.test(q) && q.includes('tab')) return { type: 'switch_tab', url: siteToUrl(switchM[1].trim().toLowerCase()) };
  var imgM = query.match(/(?:generate|create|make|draw|paint)\s+(?:an?\s+)?(?:image|picture|photo|drawing|art)\s+(?:of|showing|with|depicting|that)?\s*(.+)?/i);
  if (imgM) return { type: 'generate_image', prompt: (imgM[1] || query.replace(/^(?:generate|create|make|draw)\s+/i, '').trim()).replace(/[.!?]+$/, '') };
  var vidM = query.match(/(?:generate|create|make|render)\s+(?:an?\s+)?(?:video|clip|animation|movie)\s+(?:of|showing|with|depicting|about)?\s*(.+)?/i);
  if (vidM) return { type: 'generate_video', prompt: (vidM[1] || query.replace(/^(?:generate|create|make)\s+/i, '').trim()).replace(/[.!?]+$/, '') };
  var openM = query.match(/(?:open|go to|visit|navigate to|launch|browse)\s+(.+)?/i);
  if (openM) { var url = normalizeUrl(openM[1].trim()); if (url && !url.includes('google.com/search')) return { type: 'open_website', url: url }; }
  var typeM = query.match(/^(?:type|write|enter|put|input)\s+["\']?(.+?)["\']?(?:\s+(?:in|into|on|to)\s+(?:the\s+)?(?:chat|message|input|search|box|field|textarea))?[\s.!?]*$/i);
  if (typeM) { var shouldSend = /send|enter|submit/i.test(query); return { type: shouldSend ? 'type_and_send' : 'type_text', selector: null, text: typeM[1].trim() }; }
  return null;
}
function siteToUrl(s) { var m = { 'discord':'discord.com','youtube':'youtube.com','google':'google.com','twitter':'twitter.com','reddit':'reddit.com','github':'github.com','gmail':'mail.google.com' }; s = s.toLowerCase().trim(); return m[s] || (/\./.test(s) ? s : s); }
function normalizeUrl(input) { if (!input) return null; var t = input.trim(); if (/^https?:\/\//i.test(t)) return t; if (/^[\w-]+(\.[\w-]+)+/.test(t)) return 'https://' + t; var k = { 'google':'https://google.com','youtube':'https://youtube.com','discord':'https://discord.com','twitter':'https://twitter.com','reddit':'https://reddit.com','github':'https://github.com' }; if (k[t.toLowerCase()]) return k[t.toLowerCase()]; return 'https://google.com/search?q=' + encodeURIComponent(t); }
function describeAction(a) { var d = { open_website:'Open '+(a.url||''), scroll:'Scroll '+(a.direction||'down'), type_text:'Type "'+(a.text||'')+'"', type_and_send:'Type and send "'+(a.text||'')+'"', close_tab:'Close tab', close_tab_by_url:'Close tab: '+(a.url||''), switch_tab:'Switch to tab: '+(a.url||''), list_tabs:'List tabs', new_tab:'New tab', reload:'Reload', go_back:'Go back', go_forward:'Go forward', generate_image:'Generate image: '+(a.prompt||''), generate_video:'Generate video: '+(a.prompt||''), greeting:'Greeting' }; return d[a.type] || a.type; }

async function executeAction(action) {
  switch (action.type) {
    case 'open_website': chrome.runtime.sendMessage({ action: 'openWebsite', url: action.url }); addMessage('assistant', 'Opening ' + action.url); break;
    case 'scroll': chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'scroll', direction: action.direction }); addMessage('assistant', 'Scrolled ' + (action.direction || 'down')); break;
    case 'type_text': chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'type_text', text: action.text }); addMessage('assistant', 'Typed: "' + action.text + '"'); break;
    case 'type_and_send': chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'type_and_send', text: action.text }); addMessage('assistant', 'Typed and sent: "' + action.text + '"'); break;
    case 'close_tab': chrome.runtime.sendMessage({ action: 'closeTab' }, function (r) { addMessage('assistant', r && r.ok ? 'Closed tab' : 'Could not close'); }); break;
    case 'close_tab_by_url': chrome.runtime.sendMessage({ action: 'closeTabsByUrl', url: action.url }, function (r) { addMessage('assistant', r && r.ok ? 'Closed ' + r.closed + ' tab(s)' : 'No match'); }); break;
    case 'switch_tab': chrome.runtime.sendMessage({ action: 'switchToTab', url: action.url }, function (r) { addMessage('assistant', r && r.ok ? 'Switched' : 'Not found'); }); break;
    case 'list_tabs': chrome.runtime.sendMessage({ action: 'listTabs' }, function (r) { if (r && r.tabs) addMessage('assistant', 'Tabs:\n' + r.tabs.map(function (t) { return (t.active ? '> ' : '  ') + t.title; }).join('\n')); else addMessage('assistant', 'Could not list tabs.'); }); break;
    case 'new_tab': chrome.runtime.sendMessage({ action: 'newTab' }); addMessage('assistant', 'New tab'); break;
    case 'reload': chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'reload' }); addMessage('assistant', 'Reloading'); break;
    case 'go_back': chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'go_back' }); addMessage('assistant', 'Going back'); break;
    case 'go_forward': chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'go_forward' }); addMessage('assistant', 'Going forward'); break;
    case 'generate_image': generateImage(action.prompt); break;
    case 'generate_video': generateVideo(action.prompt); break;
    case 'greeting': addMessage('assistant', "Hey! I'm Path AI. What can I help you with?"); break;
  }
}

function generateImage(prompt) {
  if (!prompt) { addMessage('assistant', 'What image?'); return; }
  addMessage('assistant', 'Generating image...'); showThinking(['thinking...', 'putting together.', 'responding']);
  chrome.runtime.sendMessage({ action: 'generateImage', prompt: prompt }, function (res) {
    hideThinking();
    if (res && res.ok && res.url) { messages.push({ role: 'assistant', content: prompt, image: res.url, imageAlt: prompt }); renderMessages(); }
    else addMessage('assistant', 'Could not generate image.');
  });
}
function generateVideo(prompt) {
  if (!prompt) { addMessage('assistant', 'What video?'); return; }
  addMessage('assistant', 'Generating video...'); showThinking(['thinking...', 'putting together.', 'responding']);
  chrome.runtime.sendMessage({ action: 'generateVideo', prompt: prompt }, function (res) {
    hideThinking();
    if (res && res.ok && res.url) addMessage('assistant', 'Video is generating! It will appear shortly.');
    else addMessage('assistant', 'Could not generate video.');
  });
}

function requestActionPermission(action) {
  if (autoApprove) { addMessage('assistant', describeAction(action)); executeAction(action); return; }
  var desc = describeAction(action);
  var dialog = document.createElement('div'); dialog.id = 'sp-permission';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:2147483650;display:flex;align-items:center;justify-content:center;';
  dialog.innerHTML = '<div style="background:#0f172a;border:1px solid #334155;border-radius:16px;padding:28px 24px;max-width:340px;width:90%;text-align:center;color:#e2e8f0;font-family:inherit;"><div style="font-size:17px;font-weight:700;margin-bottom:10px;">Path AI wants to:</div><div style="font-size:15px;color:#a5b4fc;margin-bottom:12px;font-weight:600;">' + desc + '</div><label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:14px;font-size:13px;color:#94a3b8;cursor:pointer;"><input type="checkbox" id="sp-perm-always" style="width:16px;height:16px;accent-color:#6366f1;" /> Always allow</label><div style="display:flex;gap:10px;margin-top:20px;"><button class="sp-deny" style="flex:1;padding:12px;border:1px solid #334155;border-radius:10px;background:#1e293b;color:#94a3b8;font-size:15px;font-weight:600;cursor:pointer;">Deny</button><button class="sp-allow" style="flex:1;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">Allow</button></div></div>';
  document.body.appendChild(dialog);
  var alwaysCb = document.getElementById('sp-perm-always');
  dialog.querySelector('.sp-allow').addEventListener('click', function () { if (alwaysCb && alwaysCb.checked) { autoApprove = true; chrome.storage.local.set({ autoApprove: true }); } dialog.remove(); executeAction(action); });
  dialog.querySelector('.sp-deny').addEventListener('click', function () { dialog.remove(); addMessage('assistant', 'Denied.'); });
}

async function sendQuery() {
  var input = document.getElementById('nimbus-input'); if (!input) return;
  if (isResponding) { stopAIResponse(); return; }
  var query = input.value.trim(); if (!query) return;
  isResponding = true; currentAbortController = new AbortController();
  var sendBtn = document.getElementById('nimbus-send'); var iw = input.parentElement;
  if (sendBtn) { sendBtn.innerHTML = '<span class="nimbus-send-loading"></span>'; sendBtn.disabled = false; sendBtn.classList.add('nimbus-send-stop'); }
  if (iw) iw.classList.add('sending'); input.disabled = true;
  function clearLoading() { isResponding = false; currentAbortController = null; if (sendBtn) { sendBtn.innerHTML = SEND_SVG; sendBtn.disabled = false; sendBtn.classList.remove('nimbus-send-stop'); } if (iw) iw.classList.remove('sending'); input.disabled = false; input.focus(); }
  var facts = extractMemoryFacts(query); for (var fi = 0; fi < facts.length; fi++) await addAIMemory(facts[fi]);
  addMessage('user', query); input.value = '';
  var cmd = detectClientCommand(query);
  if (cmd) { if (autoApprove) { addMessage('assistant', describeAction(cmd)); executeAction(cmd); } else requestActionPermission(cmd); clearLoading(); return; }
  var config = await getAIConfig();
  if (!config.apiKey) { clearLoading(); addMessage('assistant', 'No API key configured. Open Settings from the popup to add one.'); return; }
  var pageCtx = await getPageContext();
  var sys = 'You are Path AI, a browser assistant.\nBe concise but thorough.\n' + buildMemoryContext();
  var chatMsgs = [{ role: 'system', content: sys }];
  for (var i = 0; i < messages.length; i++) { if (messages[i].role !== 'system') chatMsgs.push({ role: messages[i].role, content: messages[i].content }); }
  chatMsgs.push({ role: 'user', content: query + '\n\n[Page context]\n' + pageCtx });
  showThinking(['thinking...', 'putting all together.', 'responding']);
  try {
    var res = await fetch(config.endpoint + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ model: config.model || 'meta-llama/llama-3.3-70b-instruct:free', messages: chatMsgs, temperature: 0.7, max_tokens: 1000 }),
      signal: currentAbortController.signal
    });
    hideThinking();
    if (!res.ok) { var et = await res.text(); clearLoading(); addMessage('assistant', 'Error ' + res.status + ': ' + et.slice(0, 300)); saveConversation(); return; }
    var data = await res.json();
    var reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    reply = stripToolTags(reply) || "I didn't catch a response. Try again?";
    var am = reply.match(/ACTION:\s*(\{.*\})/i);
    if (am) { var at = reply.replace(/ACTION:\s*\{.*\}/i, '').trim(); if (at) addMessage('assistant', at); try { requestActionPermission(JSON.parse(am[1])); } catch (e) { addMessage('assistant', 'Malformed action.'); } }
    else addMessage('assistant', reply);
    saveConversation();
  } catch (err) {
    hideThinking();
    if (err && err.name === 'AbortError') { if (messages.length && messages[messages.length - 1].role === 'assistant' && !messages[messages.length - 1].content) { messages.pop(); renderMessages(); } }
    else addMessage('assistant', 'Network error: ' + (err && err.message ? err.message : 'Unknown'));
    saveConversation();
  }
  clearLoading();
}

function showHistoryPanel() {
  var ex = document.getElementById('sp-hist'); if (ex) { ex.remove(); return; }
  var p = document.createElement('div'); p.id = 'sp-hist'; p.className = 'sp-overlay-panel';
  p.innerHTML = '<div class="sp-panel-header"><span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Conversations</span><button class="sp-panel-close" id="sp-hist-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="sp-panel-list" id="sp-hist-list"></div><button class="sp-new-btn" id="sp-new-conv">+ New Conversation</button>';
  document.body.appendChild(p);
  document.getElementById('sp-hist-close').addEventListener('click', function () { p.remove(); });
  document.getElementById('sp-new-conv').addEventListener('click', function () { messages = []; currentChatId = null; renderMessages(); p.remove(); });
  loadConversations().then(function (h) {
    var list = document.getElementById('sp-hist-list'); var keys = Object.keys(h).sort(function (a, b) { return (h[b].timestamp || 0) - (h[a].timestamp || 0); });
    if (!keys.length) { list.innerHTML = '<div class="sp-panel-empty">No conversations yet</div>'; return; }
    for (var i = 0; i < keys.length; i++) { var chat = h[keys[i]]; var item = document.createElement('div'); item.className = 'sp-panel-item'; var d = new Date(chat.timestamp || 0); item.innerHTML = '<div class="sp-item-title">' + (chat.title || 'Untitled') + '</div><div class="sp-item-date">' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + '</div><button class="sp-item-del" data-id="' + keys[i] + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'; (function (cid, cd) { item.addEventListener('click', function (e) { if (e.target.closest('.sp-item-del')) return; messages = cd.messages || []; currentChatId = cid; renderMessages(); p.remove(); }); })(keys[i], chat); item.querySelector('.sp-item-del').addEventListener('click', function (e) { e.stopPropagation(); var id = this.getAttribute('data-id'); deleteConversation(id); this.parentElement.remove(); }); list.appendChild(item); }
  });
}
function showMemoryPanel() {
  var ex = document.getElementById('sp-mem'); if (ex) { ex.remove(); return; }
  var p = document.createElement('div'); p.id = 'sp-mem'; p.className = 'sp-overlay-panel';
  p.innerHTML = '<div class="sp-panel-header"><span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/></svg> AI Memory</span><button class="sp-panel-close" id="sp-mem-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="sp-panel-list" id="sp-mem-list"></div><button class="sp-new-btn" id="sp-mem-clear">Clear All Memory</button>';
  document.body.appendChild(p);
  document.getElementById('sp-mem-close').addEventListener('click', function () { p.remove(); });
  document.getElementById('sp-mem-clear').addEventListener('click', function () { aiMemory = []; saveAIMemory(); p.remove(); addMessage('assistant', 'Memory cleared.'); });
  var list = document.getElementById('sp-mem-list');
  if (!aiMemory.length) { list.innerHTML = '<div class="sp-panel-empty">No memories yet. Tell Path AI about yourself!</div>'; }
  else { for (var i = 0; i < aiMemory.length; i++) { var item = document.createElement('div'); item.className = 'sp-panel-item'; item.innerHTML = '<div class="sp-item-title">' + aiMemory[i] + '</div><button class="sp-item-del" data-idx="' + i + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'; (function (idx) { item.querySelector('.sp-item-del').addEventListener('click', function (e) { e.stopPropagation(); aiMemory.splice(idx, 1); saveAIMemory(); item.remove(); if (!aiMemory.length) list.innerHTML = '<div class="sp-panel-empty">No memories yet.</div>'; }); })(i); list.appendChild(item); } }
}

document.addEventListener('DOMContentLoaded', function () {
  var logoEl = document.getElementById('sp-logo'); if (logoEl) logoEl.innerHTML = PATH_AI_SVG;
  loadAIMemory();
  chrome.storage.local.get(['autoApprove'], function (d) { autoApprove = d.autoApprove === true; var cb = document.getElementById('nimbus-auto-approve'); if (cb) cb.checked = autoApprove; });
  document.getElementById('nimbus-clear').addEventListener('click', function () { messages = []; currentChatId = null; renderMessages(); });
  document.getElementById('nimbus-history').addEventListener('click', showHistoryPanel);
  document.getElementById('nimbus-memory').addEventListener('click', showMemoryPanel);
  document.getElementById('nimbus-send').addEventListener('click', sendQuery);
  var input = document.getElementById('nimbus-input');
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); } });
  var autoCb = document.getElementById('nimbus-auto-approve');
  if (autoCb) autoCb.addEventListener('change', function () { autoApprove = autoCb.checked; chrome.storage.local.set({ autoApprove: autoApprove }); });
  var qas = document.querySelectorAll('.nimbus-qa');
  for (var i = 0; i < qas.length; i++) { qas[i].addEventListener('click', function () { var a = this.getAttribute('data-action'); if (a === 'summarize') { input.value = 'Summarize this page'; sendQuery(); } if (a === 'explain') { input.value = 'Explain this page'; sendQuery(); } if (a === 'highlight') { chrome.runtime.sendMessage({ action: 'executeOnPage', command: 'highlight' }); addMessage('assistant', 'Highlight requested.'); } if (a === 'annotate') { addMessage('assistant', 'Select text on the page, then type your note here.'); } }); }
  addMessage('assistant', "Hey! I'm Path AI, running in the side panel. I can control your browser -- open sites, type, scroll, generate images, and answer questions. What can I help you with?");
});