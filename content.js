// ============================================================
// PATH AI — CONTENT SCRIPT (injected into web pages)
// ============================================================

(function () {
  if (window.__pathAIInjected) return;
  window.__pathAIInjected = true;

  var PATH_AI_ICON_SVG = '<svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pathAiGrad" x1="0" y1="0" x2="48" y2="48"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs><circle cx="24" cy="24" r="22" stroke="url(#pathAiGrad)" stroke-width="3" fill="none" opacity="0.4"/><path d="M24 6 L24 42 M6 24 L42 24" stroke="url(#pathAiGrad)" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/><path d="M14 34 L24 12 L34 34 Z" fill="url(#pathAiGrad)"/><circle cx="24" cy="24" r="5" fill="#fff"/></svg>';

  var sidebarOpen = false;
  var messages = [];
  var currentChatId = null;
  var aiMemory = [];
  var isResponding = false;
  var currentAbortController = null;
  var currentTypewriter = null;
  var autoApprove = false;
  var attachedFile = null, attachedFileContent = null, attachedFileIsImage = false, attachedImageDataUrl = null;
  var deniedActions = [];

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

  // FLOATING BUTTON
  var floatBtn = document.createElement('div');
  floatBtn.id = 'path-ai-float';
  floatBtn.innerHTML = '<span class="path-ai-float-icon">' + PATH_AI_ICON_SVG + '</span>';
  document.body.appendChild(floatBtn);
  floatBtn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
  function toggle() { if (sidebarOpen) closeSidebar(); else openSidebar(); }

  // MARKDOWN
  function renderMarkdown(text) {
    if (!text) return '';
    var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/```([\s\S]*?)```/g, function (m, code) { return '<pre class="path-ai-code-block"><code>' + code.trim() + '</code></pre>'; });
    html = html.replace(/`([^`]+)`/g, '<code class="path-ai-code-inline">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, function (m) { return '<ul class="path-ai-list">' + m + '</ul>'; });
    html = html.replace(/<\/ul>\s*<ul class="path-ai-list">/g, '');
    html = html.replace(/\n/g, '<br>');
    return html;
  }
  function stripToolTags(text) {
    return text.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '').replace(/<\|[^|]*\|>/g, '').replace(/\[[a-z_]+\][\s\S]*?\[\/[a-z_]+\]/g, '').replace(/\[[a-z_]+\]/g, '').replace(/\[\/[a-z_]+\]/g, '').trim();
  }

  // MEMORY
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
    var patterns = [/(?:my name is|I am called|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi, /(?:I like|I love|I enjoy)\s+([^.!?\n]{5,80})/gi, /(?:I prefer)\s+([^.!?\n]{5,80})/gi, /(?:I hate|I dislike)\s+([^.!?\n]{5,80})/gi, /(?:I always)\s+([^.!?\n]{5,80})/gi, /(?:I usually)\s+([^.!?\n]{5,80})/gi, /(?:I work as|I am a|I'm a)\s+([^.!?\n]{3,80})/gi, /(?:I live in)\s+([^.!?\n]{2,80})/gi, /(?:my favorite|my favourite)\s+([^.!?\n]{3,80})/gi];
    for (var p = 0; p < patterns.length; p++) { var match; while ((match = patterns[p].exec(text)) !== null && facts.length < 5) { var fact = match[0].trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim(); if (fact.length >= 5 && fact.length <= 120) facts.push(fact); } }
    return facts;
  }

  // CONVERSATIONS
  async function saveConversation() {
    if (!currentChatId) currentChatId = 'conv-' + Date.now();
    var all = await chrome.storage.local.get(['conversations']); var history = all.conversations || {};
    history[currentChatId] = { id: currentChatId, title: messages.length ? messages[0].content.slice(0, 40) : 'New', messages: messages, timestamp: Date.now() };
    await chrome.storage.local.set({ conversations: history });
  }
  async function loadConversations() { var all = await chrome.storage.local.get(['conversations']); return all.conversations || {}; }
  async function deleteConversation(id) { var all = await chrome.storage.local.get(['conversations']); var h = all.conversations || {}; delete h[id]; await chrome.storage.local.set({ conversations: h }); }

  // RENDER
  function renderMessages() {
    var c = document.getElementById('nimbus-messages'); if (!c) return; c.innerHTML = '';
    for (var i = 0; i < messages.length; i++) {
      var el = document.createElement('div'); el.className = 'nimbus-msg nimbus-' + messages[i].role + ' nimbus-msg-enter';
      if (messages[i].image) { el.innerHTML = '<img class="nimbus-msg-image" src="' + messages[i].image + '" alt="' + (messages[i].imageAlt || 'image') + '" />' + (messages[i].content ? '<div class="nimbus-msg-file-label">' + messages[i].content + '</div>' : ''); }
      else if (messages[i].role === 'assistant') { el.innerHTML = renderMarkdown(messages[i].content); }
      else { el.textContent = messages[i].content; }
      c.appendChild(el); (function (elem, idx) { setTimeout(function () { elem.classList.add('nimbus-msg-show'); }, idx * 30); })(el, i);
    }
    c.scrollTop = c.scrollHeight;
  }

  // INDICATORS
  function showTyping() {
    var c = document.getElementById('nimbus-messages'); if (!c) return;
    var el = document.createElement('div'); el.className = 'nimbus-msg nimbus-typing nimbus-msg-enter'; el.id = 'nimbus-typing';
    el.innerHTML = '<div class="nimbus-typing-dots"><span class="nimbus-typing-dot"></span><span class="nimbus-typing-dot"></span><span class="nimbus-typing-dot"></span></div><span class="nimbus-typing-text">Path AI is thinking...</span>';
    c.appendChild(el); c.scrollTop = c.scrollHeight; setTimeout(function () { el.classList.add('nimbus-msg-show'); }, 10);
  }
  function hideTyping() { var t = document.getElementById('nimbus-typing'); if (t) t.remove(); }
  function showThinking(steps) {
    var thinkSteps = steps || ['thinking...']; var c = document.getElementById('nimbus-messages'); if (!c) return;
    var existing = document.getElementById('nimbus-thinking'); if (existing) { if (existing._ti) clearInterval(existing._ti); existing.remove(); }
    var el = document.createElement('div'); el.className = 'nimbus-msg nimbus-thinking nimbus-msg-enter'; el.id = 'nimbus-thinking';
    el.innerHTML = '<div class="nimbus-thinking-icon-wrap">' + PATH_AI_ICON_SVG + '<div class="nimbus-thinking-shimmer"></div></div><div><div class="nimbus-thinking-text">Path AI is thinking...</div><div class="nimbus-thinking-steps" id="nimbus-thinking-steps">' + thinkSteps[0] + '</div><div class="nimbus-thinking-bar"><div class="nimbus-thinking-bar-fill"></div></div></div>';
    c.appendChild(el); c.scrollTop = c.scrollHeight; setTimeout(function () { el.classList.add('nimbus-msg-show'); }, 10);
    var si = 0; el._ti = setInterval(function () { si = (si + 1) % thinkSteps.length; var se = document.getElementById('nimbus-thinking-steps'); if (se) { se.style.opacity = '0'; setTimeout(function () { se.textContent = thinkSteps[si]; se.style.opacity = '1'; }, 200); } }, 1500);
  }
  function hideThinking() { var t = document.getElementById('nimbus-thinking'); if (t) { if (t._ti) clearInterval(t._ti); t.remove(); } }

  // STOP
  function stopAIResponse() {
    if (currentAbortController) { try { currentAbortController.abort(); } catch (e) {} currentAbortController = null; }
    if (currentTypewriter) { clearInterval(currentTypewriter); currentTypewriter = null; renderMessages(); }
    isResponding = false; hideThinking();
    var sendBtn = document.getElementById('nimbus-send'); if (sendBtn) { sendBtn.innerHTML = '\u27A4'; sendBtn.disabled = false; sendBtn.classList.remove('nimbus-send-stop'); }
    var input = document.getElementById('nimbus-input'); if (input) { input.disabled = false; input.style.opacity = ''; }
    var inputWrap = input ? input.parentElement : null; if (inputWrap) inputWrap.classList.remove('sending');
  }

  // ADD MESSAGE
  function addMessage(role, content) {
    messages.push({ role: role, content: content });
    if (role === 'assistant' && content.length > 20) {
      var fullText = content; messages[messages.length - 1].content = ''; renderMessages();
      var c = document.getElementById('nimbus-messages'); var el = c.lastChild; var ci = 0;
      var iv = setInterval(function () { ci += 2; if (ci >= fullText.length) { messages[messages.length - 1].content = fullText; renderMessages(); clearInterval(iv); if (currentTypewriter === iv) currentTypewriter = null; isResponding = false; saveConversation(); } else { messages[messages.length - 1].content = fullText.slice(0, ci); if (el) { el.innerHTML = renderMarkdown(fullText.slice(0, ci)); c.scrollTop = c.scrollHeight; } } }, 15);
      currentTypewriter = iv;
    } else { renderMessages(); }
  }

  // PAGE CONTEXT
  function getPageContext() {
    var title = document.title || ''; var url = window.location.href || '';
    var body = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 4000) : '';
    return 'Page URL: ' + url + '\nPage title: ' + title + '\n\nPage content:\n' + body;
  }

  // AI CONFIG
  async function getAIConfig() {
    var s = await chrome.storage.local.get(['apiKey', 'model', 'endpoint', 'modelChoice']);
    return { apiKey: s.apiKey, model: s.model, endpoint: (s.endpoint || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''), modelChoice: s.modelChoice || 'auto' };
  }

  // COMMAND DETECTION
  function detectClientCommand(query) {
    var q = query.toLowerCase().trim();
    if (/^(?:hi|hello|hey|yo|sup|howdy|greetings)\b/i.test(q) && q.length < 30) return { type: 'greeting' };
    if (/^(?:list|show|what)\s+(?:all\s+)?(?:open\s+)?tabs/i.test(q)) return { type: 'list_tabs' };
    if (/scroll\s*(down|up|top|bottom)?/i.test(q)) { var dm = q.match(/scroll\s*(down|up|top|bottom)?/i); return { type: 'scroll', direction: dm[1] || 'down' }; }
    if (/^(?:reload|refresh|restart)\s*(?:page|tab|site)?/i.test(q)) return { type: 'reload' };
    if (/^(?:go back|back|previous)/i.test(q)) return { type: 'go_back' };
    if (/^(?:go forward|forward|next)/i.test(q)) return { type: 'go_forward' };
    if (/^(?:new tab|open new tab|blank tab)/i.test(q)) return { type: 'new_tab' };
    var closeMatch = query.match(/(?:close|shut|kill)\s+(?:this\s+)?(?:tab|window|page|site)?\s*(.+)?/i);
    if (closeMatch && /close|shut|kill/i.test(q) && (q.includes('tab') || q.includes('window') || q.includes('page') || q.includes('site') || closeMatch[1])) { var target = closeMatch[1] ? closeMatch[1].trim().toLowerCase() : ''; if (target && target !== 'this' && target !== 'tab' && target !== 'window' && target !== 'page' && target !== 'site') return { type: 'close_tab_by_url', url: siteToUrl(target) }; return { type: 'close_tab' }; }
    var switchMatch = query.match(/(?:switch|go|change|jump)\s+(?:to|back to|over to)?\s*(?:the\s+)?(.+?)\s*(?:tab|window|page|site)?/i);
    if (switchMatch && /switch|change|jump/i.test(q) && q.includes('tab')) return { type: 'switch_tab', url: siteToUrl(switchMatch[1].trim().toLowerCase()) };
    var imgMatch = query.match(/(?:generate|create|make|draw|paint|render)\s+(?:an?\s+)?(?:image|picture|pic|photo|drawing|art)\s+(?:of|showing|with|depicting|that)?\s*(.+)?/i);
    if (imgMatch) return { type: 'generate_image', prompt: (imgMatch[1] || query.replace(/^(?:generate|create|make|draw)\s+/i, '').trim()).replace(/[.!?]+$/, '') };
    var vidMatch = query.match(/(?:generate|create|make|render)\s+(?:an?\s+)?(?:video|clip|animation|movie)\s+(?:of|showing|with|depicting|about)?\s*(.+)?/i);
    if (vidMatch) return { type: 'generate_video', prompt: (vidMatch[1] || query.replace(/^(?:generate|create|make)\s+/i, '').trim()).replace(/[.!?]+$/, '') };
    var openMatch = query.match(/(?:open|go to|visit|navigate to|launch|browse)\s+(.+)?/i);
    if (openMatch) { var url = normalizeUrl(openMatch[1].trim()); if (url && !url.includes('google.com/search')) return { type: 'open_website', url: url }; }
    var typeMatch = query.match(/^(?:type|write|enter|put|input)\s+["\']?(.+?)["\']?(?:\s+(?:in|into|on|to)\s+(?:the\s+)?(?:chat|message|input|search|box|field|textarea))?[\s.!?]*$/i);
    if (typeMatch) { var shouldSend = /send|enter|submit/i.test(query); return { type: shouldSend ? 'type_and_send' : 'type_text', selector: null, text: typeMatch[1].trim() }; }
    return null;
  }
  function siteToUrl(site) { var s = site.toLowerCase().trim(); var map = { 'discord': 'discord.com', 'youtube': 'youtube.com', 'google': 'google.com', 'twitter': 'twitter.com', 'x.com': 'x.com', 'reddit': 'reddit.com', 'facebook': 'facebook.com', 'instagram': 'instagram.com', 'slack': 'slack.com', 'gmail': 'mail.google.com', 'github': 'github.com', 'netflix': 'netflix.com', 'spotify': 'spotify.com', 'amazon': 'amazon.com', 'wikipedia': 'wikipedia.org', 'linkedin': 'linkedin.com', 'twitch': 'twitch.tv' }; if (map[s]) return map[s]; if (/\./.test(s)) return s; return s; }
  function normalizeUrl(input) { if (!input) return null; var t = input.trim(); if (/^https?:\/\//i.test(t)) return t; if (/^[\w-]+(\.[\w-]+)+/.test(t)) return 'https://' + t; var known = { 'google': 'https://google.com', 'youtube': 'https://youtube.com', 'discord': 'https://discord.com', 'twitter': 'https://twitter.com', 'reddit': 'https://reddit.com', 'facebook': 'https://facebook.com', 'instagram': 'https://instagram.com', 'github': 'https://github.com', 'netflix': 'https://netflix.com', 'spotify': 'https://spotify.com', 'amazon': 'https://amazon.com', 'wikipedia': 'https://wikipedia.org', 'linkedin': 'https://linkedin.com', 'twitch': 'https://twitch.tv', 'gmail': 'https://mail.google.com' }; if (known[t.toLowerCase()]) return known[t.toLowerCase()]; return 'https://google.com/search?q=' + encodeURIComponent(t); }
  function describeAction(action) { var d = { open_website: 'Open ' + (action.url || 'website'), scroll: 'Scroll ' + (action.direction || 'down'), type_text: 'Type "' + (action.text || '') + '"', type_and_send: 'Type and send "' + (action.text || '') + '"', close_tab: 'Close current tab', close_tab_by_url: 'Close tab: ' + (action.url || ''), switch_tab: 'Switch to tab: ' + (action.url || ''), list_tabs: 'List all tabs', new_tab: 'Open new tab', reload: 'Reload page', go_back: 'Go back', go_forward: 'Go forward', generate_image: 'Generate image: ' + (action.prompt || ''), generate_video: 'Generate video: ' + (action.prompt || ''), greeting: 'Greeting' }; return d[action.type] || action.type; }

  // EXECUTE ACTION
  async function executeAction(action) {
    try {
      switch (action.type) {
        case 'open_website': chrome.runtime.sendMessage({ action: 'openWebsite', url: action.url }); addMessage('assistant', '\u2705 Opening ' + action.url); break;
        case 'scroll': window.scrollBy(0, action.direction === 'up' ? -500 : action.direction === 'top' ? -window.scrollY : action.direction === 'bottom' ? document.body.scrollHeight : 500); addMessage('assistant', '\u2705 Scrolled ' + (action.direction || 'down')); break;
        case 'type_text': typeIntoField(null, action.text); addMessage('assistant', '\u2705 Typed: "' + action.text + '"'); break;
        case 'type_and_send': typeIntoField(null, action.text); setTimeout(function () { var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }); document.activeElement && document.activeElement.dispatchEvent(ev); }, 300); addMessage('assistant', '\u2705 Typed and sent: "' + action.text + '"'); break;
        case 'close_tab': chrome.runtime.sendMessage({ action: 'closeTab' }, function (r) { addMessage('assistant', r && r.ok ? '\u2705 Closed current tab' : '\u274C Could not close tab'); }); break;
        case 'close_tab_by_url': chrome.runtime.sendMessage({ action: 'closeTabsByUrl', url: action.url }, function (r) { addMessage('assistant', r && r.ok ? '\u2705 Closed ' + r.closed + ' tab(s)' : '\u274C No matching tabs'); }); break;
        case 'switch_tab': chrome.runtime.sendMessage({ action: 'switchToTab', url: action.url }, function (r) { addMessage('assistant', r && r.ok ? '\u2705 Switched to tab' : '\u274C Tab not found'); }); break;
        case 'list_tabs': chrome.runtime.sendMessage({ action: 'listTabs' }, function (r) { if (r && r.tabs) addMessage('assistant', 'Open tabs:\n' + r.tabs.map(function (t) { return (t.active ? '\u25B6 ' : '   ') + t.title + ' (' + t.url + ')'; }).join('\n')); else addMessage('assistant', 'Could not list tabs.'); }); break;
        case 'new_tab': chrome.runtime.sendMessage({ action: 'newTab' }); addMessage('assistant', '\u2705 New tab opened'); break;
        case 'reload': window.location.reload(); break;
        case 'go_back': window.history.back(); addMessage('assistant', '\u2705 Going back'); break;
        case 'go_forward': window.history.forward(); addMessage('assistant', '\u2705 Going forward'); break;
        case 'generate_image': generateImage(action.prompt); break;
        case 'generate_video': generateVideo(action.prompt); break;
        case 'greeting': addMessage('assistant', "Hey there! \uD83D\uDC4B I'm Path AI. I can control your browser \u2014 open sites, type, scroll, generate images, and answer questions. What would you like to do?"); break;
        default: addMessage('assistant', '\u274C Unknown action: ' + action.type);
      }
    } catch (err) { addMessage('assistant', '\u274C Failed: ' + err.message); }
  }

  function typeIntoField(selector, text) {
    var el = selector ? document.querySelector(selector) : document.activeElement;
    if (!el) { var inputs = document.querySelectorAll('input, textarea, [contenteditable=true], [role=textbox]'); el = inputs[0]; }
    if (!el) return;
    el.focus();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    else { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
  }

  // IMAGE / VIDEO
  function generateImage(prompt) {
    if (!prompt) { addMessage('assistant', 'What image would you like?'); return; }
    addMessage('assistant', 'Generating image...'); showThinking(['thinking...', 'putting all together.', 'responding']);
    chrome.runtime.sendMessage({ action: 'generateImage', prompt: prompt }, function (res) {
      hideThinking();
      if (res && res.ok && res.url) { messages.push({ role: 'assistant', content: '\uD83D\uDDBC\uFE0F ' + prompt, image: res.url, imageAlt: prompt }); renderMessages(); }
      else addMessage('assistant', '\u274C Could not generate image.');
    });
  }
  function generateVideo(prompt) {
    if (!prompt) { addMessage('assistant', 'What video would you like?'); return; }
    addMessage('assistant', 'Generating video...'); showThinking(['thinking...', 'putting all together.', 'responding']);
    chrome.runtime.sendMessage({ action: 'generateVideo', prompt: prompt }, function (res) {
      hideThinking();
      if (res && res.ok && res.url) addMessage('assistant', '\u2705 Video is generating! It will appear shortly.');
      else addMessage('assistant', '\u274C Could not generate video.');
    });
  }

  // PERMISSION DIALOG
  function requestActionPermission(action) {
    var key = action.type + (action.url ? ':' + action.url : '');
    for (var i = 0; i < deniedActions.length; i++) if (deniedActions[i] === key) { addMessage('assistant', '\u274C Action denied.'); return; }
    if (autoApprove) { addMessage('assistant', '\u26A1 ' + describeAction(action)); executeAction(action); return; }
    var desc = describeAction(action);
    var dialog = document.createElement('div'); dialog.id = 'path-ai-permission';
    dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:2147483650;display:flex;align-items:center;justify-content:center;';
    dialog.innerHTML = '<div style="background:#0f172a;border:1px solid #334155;border-radius:16px;padding:28px 24px;max-width:340px;width:90%;text-align:center;color:#e2e8f0;font-family:inherit;"><div style="font-size:17px;font-weight:700;margin-bottom:10px;">Path AI wants to:</div><div style="font-size:15px;color:#a5b4fc;margin-bottom:12px;font-weight:600;">' + desc + '</div><label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:14px;font-size:13px;color:#94a3b8;cursor:pointer;"><input type="checkbox" id="path-ai-perm-always" style="width:16px;height:16px;accent-color:#6366f1;" /> Always allow</label><div style="display:flex;gap:10px;margin-top:20px;"><button class="pa-deny" style="flex:1;padding:12px;border:1px solid #334155;border-radius:10px;background:#1e293b;color:#94a3b8;font-size:15px;font-weight:600;cursor:pointer;">Deny</button><button class="pa-allow" style="flex:1;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">Allow</button></div></div>';
    document.body.appendChild(dialog);
    var alwaysCb = document.getElementById('path-ai-perm-always');
    dialog.querySelector('.pa-allow').addEventListener('click', function () { if (alwaysCb && alwaysCb.checked) { autoApprove = true; chrome.storage.local.set({ autoApprove: true }); } dialog.remove(); executeAction(action); });
    dialog.querySelector('.pa-deny').addEventListener('click', function () { dialog.remove(); deniedActions.push(key); addMessage('assistant', '\u274C Denied.'); });
  }

  // SEND QUERY
  async function sendQuery() {
    var input = document.getElementById('nimbus-input'); if (!input) return;
    if (isResponding) { stopAIResponse(); return; }
    var query = input.value.trim(); if (!query) return;
    isResponding = true; currentAbortController = new AbortController();
    var sendBtn = document.getElementById('nimbus-send'); var inputWrap = input.parentElement;
    if (sendBtn) { sendBtn.innerHTML = '<span class="nimbus-send-loading"></span>'; sendBtn.disabled = false; sendBtn.classList.add('nimbus-send-stop'); }
    if (inputWrap) inputWrap.classList.add('sending'); input.disabled = true;
    function clearLoading() { isResponding = false; currentAbortController = null; if (sendBtn) { sendBtn.innerHTML = '\u27A4'; sendBtn.disabled = false; sendBtn.classList.remove('nimbus-send-stop'); } if (inputWrap) inputWrap.classList.remove('sending'); input.disabled = false; input.focus(); }
    var facts = extractMemoryFacts(query); for (var fi = 0; fi < facts.length; fi++) await addAIMemory(facts[fi]);
    addMessage('user', query); input.value = '';
    var cmd = detectClientCommand(query);
    if (cmd) { if (autoApprove) { addMessage('assistant', '\u26A1 ' + describeAction(cmd)); executeAction(cmd); } else requestActionPermission(cmd); clearLoading(); return; }
    var config = await getAIConfig();
    if (!config.apiKey) { clearLoading(); addMessage('assistant', 'No API key configured. Open Settings to add your API key.'); return; }
    var pageCtx = getPageContext();
    var systemPrompt = 'You are Path AI, a browser assistant that can control the browser.\nBe concise but thorough.\n' + buildMemoryContext();
    var chatMsgs = [{ role: 'system', content: systemPrompt }];
    for (var i = 0; i < messages.length; i++) { if (messages[i].role !== 'system') chatMsgs.push({ role: messages[i].role, content: messages[i].content }); }
    chatMsgs.push({ role: 'user', content: query + '\n\n[Page context]\n' + pageCtx });
    showThinking(['thinking...', 'putting all together.', 'responding']);
    try {
      var res = await fetch(config.endpoint + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey }, body: JSON.stringify({ model: config.model || 'meta-llama/llama-3.3-70b-instruct:free', messages: chatMsgs, temperature: 0.7, max_tokens: 1000 }), signal: currentAbortController.signal });
      hideThinking();
      if (!res.ok) { var errText = await res.text(); clearLoading(); addMessage('assistant', 'Error ' + res.status + ': ' + errText.slice(0, 300)); saveConversation(); return; }
      var data = await res.json();
      var reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      reply = stripToolTags(reply) || "I didn't catch a response. Could you try again?";
      var actionMatch = reply.match(/ACTION:\s*(\{.*\})/i);
      if (actionMatch) { var actionText = reply.replace(/ACTION:\s*\{.*\}/i, '').trim(); if (actionText) addMessage('assistant', actionText); try { requestActionPermission(JSON.parse(actionMatch[1])); } catch (e) { addMessage('assistant', 'Malformed action.'); } }
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

  // SIDEBAR
  function openSidebar() { sidebarOpen = true; buildSidebar(); document.getElementById('path-ai-sidebar').classList.add('open'); }
  function closeSidebar() { sidebarOpen = false; var sb = document.getElementById('path-ai-sidebar'); if (sb) sb.classList.remove('open'); }
  function buildSidebar() {
    var existing = document.getElementById('path-ai-sidebar'); if (existing) return;
    var sb = document.createElement('div'); sb.id = 'path-ai-sidebar'; sb.className = 'open';
    sb.innerHTML = '<div class="nimbus-header"><div class="nimbus-title"><span class="nimbus-logo">' + PATH_AI_ICON_SVG + '</span> Path AI</div><div class="nimbus-actions"><button class="nimbus-btn" id="nimbus-history" title="Conversations">\uD83D\uDCDC</button><button class="nimbus-btn" id="nimbus-memory" title="AI Memory">\uD83E\uDDE0</button><button class="nimbus-btn" id="nimbus-clear" title="New conversation">\u2715</button></div></div><div class="nimbus-quick-actions"><button class="nimbus-qa" data-action="summarize">\uD83D\uDCC4 Summarize</button><button class="nimbus-qa" data-action="explain">\uD83D\uDCA1 Explain</button><button class="nimbus-qa" data-action="highlight">\uD83D\uDD69 Highlight</button><button class="nimbus-qa" data-action="annotate">\u270F\uFE0F Annotate</button></div><div class="nimbus-messages" id="nimbus-messages"></div><div class="nimbus-input-area"><textarea id="nimbus-input" placeholder="Ask anything... (Enter to send, Shift+Enter for newline)"></textarea><div class="nimbus-input-buttons"><button id="nimbus-attach" title="Attach file">\uD83D\uDDCE</button><button id="nimbus-send">\u27A4</button></div></div><div class="nimbus-context-hint"><label><input type="checkbox" id="nimbus-include-page" checked /> Include page content</label><label style="margin-top:6px;"><input type="checkbox" id="nimbus-auto-approve" /> Auto-approve actions</label></div>';
    document.body.appendChild(sb);
    document.getElementById('nimbus-clear').addEventListener('click', function () { messages = []; currentChatId = null; renderMessages(); });
    document.getElementById('nimbus-send').addEventListener('click', sendQuery);
    var input = document.getElementById('nimbus-input');
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); } });
    var autoCb = document.getElementById('nimbus-auto-approve');
    autoCb.addEventListener('change', function () { autoApprove = autoCb.checked; chrome.storage.local.set({ autoApprove: autoApprove }); });
    var qas = document.querySelectorAll('.nimbus-qa');
    for (var i = 0; i < qas.length; i++) { qas[i].addEventListener('click', function () { var a = this.getAttribute('data-action'); if (a === 'summarize') { input.value = 'Summarize this page'; sendQuery(); } if (a === 'explain') { input.value = 'Explain this page in simple terms'; sendQuery(); } if (a === 'highlight') { addMessage('assistant', '\u2705 Highlight requested.'); } if (a === 'annotate') { addMessage('assistant', 'Select text on the page, then type your note here and press Enter.'); } }); }
    var attachBtn = document.getElementById('nimbus-attach');
    var fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.style.display = 'none';
    fileInput.addEventListener('change', function (e) { var f = e.target.files[0]; if (f) handleAttachedFile(f); });
    attachBtn.addEventListener('click', function () { fileInput.click(); });
    loadAIMemory();
    chrome.storage.local.get(['autoApprove'], function (d) { autoApprove = d.autoApprove === true; autoCb.checked = autoApprove; });
    addMessage('assistant', "Hey! \uD83D\uDC4B I'm Path AI. What can I help you with?");
  }
  function handleAttachedFile(file) {
    attachedFile = file; attachedFileIsImage = false; attachedImageDataUrl = null;
    if (file.type.startsWith('text/') || /\.(js|html|css|py|md|txt)$/.test(file.name)) { var r = new FileReader(); r.onload = function (e) { attachedFileContent = e.target.result.slice(0, 8000); }; r.readAsText(file); }
    else if (file.type.startsWith('image/')) { attachedFileIsImage = true; var ir = new FileReader(); ir.onload = function (e) { attachedImageDataUrl = e.target.result; attachedFileContent = '[Image: ' + file.name + ']'; }; ir.readAsDataURL(file); }
    else { attachedFileContent = '[File: ' + file.name + ']'; }
  }

  // MAIN MENU
  function showMainMenu() {
    var existing = document.getElementById('path-ai-menu'); if (existing) { existing.remove(); return; }
    var menu = document.createElement('div'); menu.id = 'path-ai-menu';
    menu.innerHTML = '<div class="path-ai-menu-overlay"></div><div class="path-ai-menu-panel"><div class="path-ai-menu-header"><span class="path-ai-menu-logo">' + PATH_AI_ICON_SVG + '</span><span class="path-ai-menu-title">Path AI</span><button class="path-ai-menu-close" id="path-ai-menu-close">\u2715</button></div><div class="path-ai-menu-list"><div class="path-ai-menu-item" id="path-ai-menu-open">\uD83D\uDCAC Open Chat</div><div class="path-ai-menu-item" id="path-ai-menu-settings">\u2699\uFE0F Settings</div><div class="path-ai-menu-item" id="path-ai-menu-history">\uD83D\uDCDC Conversations</div><div class="path-ai-menu-item" id="path-ai-menu-memory">\uD83E\uDDE0 AI Memory</div></div></div>';
    document.body.appendChild(menu);
    menu.querySelector('.path-ai-menu-overlay').addEventListener('click', function () { menu.remove(); });
    document.getElementById('path-ai-menu-close').addEventListener('click', function () { menu.remove(); });
    document.getElementById('path-ai-menu-open').addEventListener('click', function () { menu.remove(); openSidebar(); });
    document.getElementById('path-ai-menu-settings').addEventListener('click', function () { menu.remove(); showSettingsPanel(); });
  }

  // SETTINGS PANEL — PER-MODEL API KEYS
  function showSettingsPanel() {
    var existing = document.getElementById('path-ai-settings'); if (existing) { existing.remove(); return; }
    var modelDefs = [
      { id: 'auto', label: 'Auto (Best Choice)', modelId: 'openrouter/free', placeholder: 'OpenRouter API key (optional)' },
      { id: 'gemini', label: 'Gemini', modelId: 'google/gemini-2.5-flash-lite', placeholder: 'OpenRouter API key (optional)' },
      { id: 'chatgpt', label: 'ChatGPT', modelId: 'minimax/minimax-m3:free', placeholder: 'OpenRouter API key (optional)' },
      { id: 'claude', label: 'Claude', modelId: 'poolside/laguna-s-2.1:free', placeholder: 'OpenRouter API key (optional)' },
      { id: 'deepseek', label: 'DeepSeek', modelId: 'deepseek/deepseek-r1-distill-llama-70b:free', placeholder: 'DeepSeek or OpenRouter key' },
      { id: 'perplexity', label: 'Perplexity AI', modelId: 'sonar', placeholder: 'Perplexity API key (pplx-...)' },
      { id: 'agnes', label: 'Agnes AI', modelId: 'agnes-2.5-flash', placeholder: 'Agnes AI API key' },
      { id: 'groq', label: 'Groq (Fast & Free)', modelId: 'openai/gpt-oss-20b', placeholder: 'Groq API key (gsk_...)' },
      { id: 'llama', label: 'Llama 3.3 70B', modelId: 'meta-llama/llama-3.3-70b-instruct', placeholder: 'OpenRouter API key (optional)' },
      { id: 'mistral', label: 'Mistral Small 24B', modelId: 'mistralai/mistral-small-3.1-24b-instruct', placeholder: 'OpenRouter API key (optional)' },
      { id: 'qwen', label: 'Qwen 3 235B', modelId: 'qwen/qwen3-235b-a22b', placeholder: 'OpenRouter API key (optional)' },
    ];
    var keyRowsHtml = '';
    for (var i = 0; i < modelDefs.length; i++) { var m = modelDefs[i]; keyRowsHtml += '<div class="path-ai-model-key-row" data-model="' + m.id + '"><div class="path-ai-model-key-header"><span class="path-ai-model-key-label">' + m.label + '</span><span class="path-ai-model-key-id">' + m.modelId + '</span></div><input type="password" class="path-ai-model-key-input" data-model="' + m.id + '" placeholder="' + m.placeholder + '" autocomplete="off" /></div>'; }
    var panel = document.createElement('div'); panel.id = 'path-ai-settings';
    panel.innerHTML = '<div class="path-ai-menu-overlay"></div><div class="path-ai-menu-panel path-ai-settings-panel-wide"><div class="path-ai-menu-header"><span class="path-ai-menu-logo">\u2699\uFE0F</span><span class="path-ai-menu-title">Settings</span><button class="path-ai-menu-close" id="path-ai-settings-close">\u2715</button></div><div class="path-ai-settings-body"><label class="path-ai-settings-label">Active AI Model</label><select id="path-ai-settings-model" class="path-ai-settings-select"><option value="auto">Auto (Best Choice)</option><option value="gemini">Gemini</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option><option value="deepseek">DeepSeek</option><option value="perplexity">Perplexity AI</option><option value="agnes">Agnes AI</option><option value="groq">Groq (Fast & Free)</option><option value="llama">Llama 3.3 70B</option><option value="mistral">Mistral Small 24B</option><option value="qwen">Qwen 3 235B</option></select><label class="path-ai-settings-label" style="margin-top:14px;"><input type="checkbox" id="path-ai-settings-autoapprove" style="width:auto;margin-right:6px;" /> Auto-approve actions</label><div class="path-ai-settings-divider"></div><div class="path-ai-settings-section-title">\uD83D\uDD11 API Keys \u2014 one per model</div><div class="path-ai-settings-hint">Enter your own key for any model. Leave blank to use built-in keys. Keys are stored locally only.</div><div class="path-ai-model-keys-list">' + keyRowsHtml + '</div><button class="path-ai-settings-save" id="path-ai-settings-save">Save Settings</button><div class="path-ai-settings-status" id="path-ai-settings-status"></div></div></div>';
    document.body.appendChild(panel);
    chrome.runtime.sendMessage({ action: 'getModelKeys' }, function (keyResp) {
      var savedKeys = (keyResp && keyResp.keys) || {};
      chrome.storage.local.get(['modelChoice', 'autoApprove'], function (data) {
        var sel = document.getElementById('path-ai-settings-model'); if (sel) sel.value = data.modelChoice || 'auto';
        var cb = document.getElementById('path-ai-settings-autoapprove'); if (cb) cb.checked = data.autoApprove === true;
        var inputs = document.querySelectorAll('.path-ai-model-key-input');
        for (var i = 0; i < inputs.length; i++) { var mid = inputs[i].getAttribute('data-model'); if (savedKeys[mid]) inputs[i].value = savedKeys[mid]; }
      });
    });
    panel.querySelector('.path-ai-menu-overlay').addEventListener('click', function () { panel.remove(); });
    document.getElementById('path-ai-settings-close').addEventListener('click', function () { panel.remove(); });
    document.getElementById('path-ai-settings-save').addEventListener('click', function () {
      var modelChoice = document.getElementById('path-ai-settings-model').value;
      var autoApp = document.getElementById('path-ai-settings-autoapprove').checked;
      autoApprove = autoApp; chrome.storage.local.set({ autoApprove: autoApp });
      var inputs = document.querySelectorAll('.path-ai-model-key-input');
      var keysToSave = {};
      for (var i = 0; i < inputs.length; i++) keysToSave[inputs[i].getAttribute('data-model')] = inputs[i].value.trim();
      var saveCount = 0; var total = Object.keys(keysToSave).length; var status = document.getElementById('path-ai-settings-status');
      function checkDone() { saveCount++; if (saveCount >= total) { chrome.runtime.sendMessage({ action: 'saveModelConfig', modelChoice: modelChoice }, function () { if (status) { status.textContent = '\u2705 Settings saved!'; status.style.color = '#22c55e'; setTimeout(function () { status.textContent = ''; }, 2000); } }); } }
      for (var mid in keysToSave) { if (keysToSave.hasOwnProperty(mid)) chrome.runtime.sendMessage({ action: 'saveModelKey', modelChoice: mid, apiKey: keysToSave[mid] }, function () { checkDone(); }); }
    });
  }

  // MESSAGE LISTENER
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === 'toggleSidebar') { toggle(); sendResponse({ ok: true }); }
    if (msg.action === 'showMenu') { showMainMenu(); sendResponse({ ok: true }); }
    if (msg.action === 'showSettings') { showSettingsPanel(); sendResponse({ ok: true }); }
    if (msg.action === 'askFromSelection') { openSidebar(); var inp = document.getElementById('nimbus-input'); if (inp) { inp.value = msg.text; inp.focus(); } sendResponse({ ok: true }); }
    if (msg.action === 'getPageContext') { sendResponse({ context: getPageContext() }); return true; }
    if (msg.action === 'executeOnPage') {
      try {
        var cmd = msg.command;
        if (cmd === 'click') { var el = document.querySelector(msg.selector); if (el) el.click(); sendResponse({ ok: true }); }
        else if (cmd === 'scroll') { window.scrollBy(0, msg.direction === 'up' ? -500 : msg.direction === 'top' ? -window.scrollY : msg.direction === 'bottom' ? document.body.scrollHeight : 500); sendResponse({ ok: true }); }
        else if (cmd === 'type_text') { typeIntoField(msg.selector, msg.text); sendResponse({ ok: true }); }
        else if (cmd === 'type_and_send') { typeIntoField(msg.selector, msg.text); setTimeout(function () { var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }); document.activeElement && document.activeElement.dispatchEvent(ev); }, 300); sendResponse({ ok: true }); }
        else if (cmd === 'reload') { window.location.reload(); sendResponse({ ok: true }); }
        else if (cmd === 'go_back') { window.history.back(); sendResponse({ ok: true }); }
        else if (cmd === 'go_forward') { window.history.forward(); sendResponse({ ok: true }); }
        else sendResponse({ error: 'Unknown command' });
      } catch (e) { sendResponse({ error: e.message }); }
      return true;
    }
  });

  loadAIMemory();
  chrome.storage.local.get(['autoApprove'], function (d) { autoApprove = d.autoApprove === true; });
})();