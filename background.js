// ============================================================
// PATH AI — BACKGROUND SERVICE WORKER
// Handles: context menu, tab management, key rotation,
// per-model API keys, side panel messaging, page context
// ============================================================

// ---- MODEL CONFIG ----
var MODEL_CONFIG = {
  auto:       { label: 'Auto',         modelId: 'openrouter/free',                            keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  gemini:     { label: 'Gemini',       modelId: 'google/gemini-2.5-flash-lite',               keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  chatgpt:    { label: 'ChatGPT',      modelId: 'minimax/minimax-m3:free',                    keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  claude:     { label: 'Claude',       modelId: 'poolside/laguna-s-2.1:free',                 keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  deepseek:   { label: 'DeepSeek',     modelId: 'deepseek/deepseek-r1-distill-llama-70b:free',keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  perplexity: { label: 'Perplexity AI',modelId: 'sonar',                                      keyType: 'perplexity',  endpoint: 'https://api.perplexity.ai' },
  agnes:      { label: 'Agnes AI',     modelId: 'agnes-2.5-flash',                             keyType: 'agnes',       endpoint: 'https://api.agnes.ai/v1' },
  groq:       { label: 'Groq',        modelId: 'openai/gpt-oss-20b',                          keyType: 'groq',        endpoint: 'https://api.groq.com/openai/v1' },
  llama:      { label: 'Llama 3.3',   modelId: 'meta-llama/llama-3.3-70b-instruct',          keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  mistral:    { label: 'Mistral',     modelId: 'mistralai/mistral-small-3.1-24b-instruct',    keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
  qwen:       { label: 'Qwen',        modelId: 'qwen/qwen3-235b-a22b',                       keyType: 'openrouter',  endpoint: 'https://openrouter.ai/api/v1' },
};

// ---- BUILT-IN KEY POOLS (rotated on 429) ----
var BUILTIN_KEYS = {
  openrouter: [
    'sk-or-v1-1a2b3c4d5e6f7g8h9i0j',
    'sk-or-v1-2b3c4d5e6f7g8h9i0j1k',
    'sk-or-v1-3c4d5e6f7g8h9i0j1k2l',
  ],
  perplexity: ['pplx-1a2b3c4d5e6f7g8h'],
  agnes: ['agnes-1a2b3c4d5e6f7g8h'],
  groq: ['gsk_1a2b3c4d5e6f7g8h9i0j1k2l'],
};
var keyRotationIdx = {};

function getNextKey(keyType) {
  var pool = BUILTIN_KEYS[keyType] || BUILTIN_KEYS.openrouter;
  if (!keyRotationIdx[keyType]) keyRotationIdx[keyType] = 0;
  var key = pool[keyRotationIdx[keyType] % pool.length];
  keyRotationIdx[keyType]++;
  return key;
}

// ---- CONTEXT MENU ----
chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({ id: 'path-ai-ask', title: 'Ask Path AI: "%s"', contexts: ['selection'] });
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(function () {});
  }
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'path-ai-ask' && info.selectionText && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'askFromSelection', text: info.selectionText });
  }
});

// ---- ACTIVE TAB TRACKING ----
var lastActiveTabId = null;
chrome.tabs.onActivated.addListener(function (activeInfo) { lastActiveTabId = activeInfo.tabId; });

async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0) return tabs[0];
  if (lastActiveTabId) { try { return await chrome.tabs.get(lastActiveTabId); } catch (e) {} }
  return null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: ['sidebar.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
  } catch (e) {}
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {

  // ---- Open side panel ----
  if (msg.action === 'openSidePanel') {
    if (chrome.sidePanel) {
      chrome.windows.getCurrent(function (win) {
        chrome.sidePanel.open({ windowId: win.id })
          .then(function () { sendResponse({ ok: true }); })
          .catch(function (e) { sendResponse({ error: e.message }); });
      });
    } else { 
      sendResponse({ error: 'Side panel not supported' }); 
    }
    return true;
  }

  // ---- Get page context (for side panel) ----
  if (msg.action === 'getPageContext') {
    (async function () {
      try {
        var tab = await getActiveTab();
        if (!tab) { sendResponse({ context: '' }); return; }
        chrome.tabs.sendMessage(tab.id, { action: 'getPageContext' }, function (resp) {
          if (chrome.runtime.lastError || !resp) {
            ensureContentScript(tab.id).then(function () {
              chrome.tabs.sendMessage(tab.id, { action: 'getPageContext' }, function (resp2) {
                sendResponse({ context: (resp2 && resp2.context) || '' });
              });
            });
          } else { sendResponse({ context: resp.context || '' }); }
        });
      } catch (e) { sendResponse({ context: '' }); }
    })();
    return true;
  }

  // ---- Execute action on page (for side panel) ----
  if (msg.action === 'executeOnPage') {
    (async function () {
      try {
        var tab = await getActiveTab();
        if (!tab) { sendResponse({ error: 'No active tab' }); return; }
        chrome.tabs.sendMessage(tab.id, { action: 'executeOnPage', command: msg.command, selector: msg.selector, text: msg.text, direction: msg.direction }, function (resp) {
          if (chrome.runtime.lastError || !resp) {
            ensureContentScript(tab.id).then(function () {
              chrome.tabs.sendMessage(tab.id, { action: 'executeOnPage', command: msg.command, selector: msg.selector, text: msg.text, direction: msg.direction }, function (resp2) {
                sendResponse(resp2 || { ok: true });
              });
            });
          } else { sendResponse(resp); }
        });
      } catch (e) { sendResponse({ error: e.message }); }
    })();
    return true;
  }

  // ---- Navigate active tab ----
  if (msg.action === 'navigateTab' && msg.url) {
    (async function () {
      var tab = await getActiveTab();
      if (tab) { chrome.tabs.update(tab.id, { url: msg.url }); sendResponse({ ok: true }); }
      else sendResponse({ error: 'No active tab' });
    })();
    return true;
  }

  // ---- Open website (new tab) ----
  if (msg.action === 'openWebsite' && msg.url) {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
    return true;
  }

  // ---- Close current tab ----
  if (msg.action === 'closeTab') {
    (async function () {
      var tab = await getActiveTab();
      if (tab) { chrome.tabs.remove(tab.id); sendResponse({ ok: true }); }
      else sendResponse({ error: 'No active tab' });
    })();
    return true;
  }

  // ---- Close tabs by URL ----
  if (msg.action === 'closeTabsByUrl' && msg.url) {
    (async function () {
      var tabs = await chrome.tabs.query({});
      var closed = 0;
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].url && tabs[i].url.indexOf(msg.url) !== -1) {
          await chrome.tabs.remove(tabs[i].id);
          closed++;
        }
      }
      sendResponse({ ok: true, closed: closed });
    })();
    return true;
  }

  // ---- Switch to tab by URL ----
  if (msg.action === 'switchToTab' && msg.url) {
    (async function () {
      var tabs = await chrome.tabs.query({});
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].url && tabs[i].url.indexOf(msg.url) !== -1) {
          chrome.tabs.update(tabs[i].id, { active: true });
          chrome.windows.update(tabs[i].windowId, { focused: true });
          sendResponse({ ok: true });
          return;
        }
      }
      sendResponse({ ok: false });
    })();
    return true;
  }

  // ---- List all tabs ----
  if (msg.action === 'listTabs') {
    (async function () {
      var tabs = await chrome.tabs.query({});
      var tabList = tabs.map(function (t) { return { title: t.title, url: t.url, active: t.active }; });
      sendResponse({ tabs: tabList });
    })();
    return true;
  }

  // ---- New tab ----
  if (msg.action === 'newTab') {
    chrome.tabs.create({});
    sendResponse({ ok: true });
    return true;
  }

  // ---- Get rotated key ----
  if (msg.action === 'getRotatedKey' && msg.keyType) {
    sendResponse({ key: getNextKey(msg.keyType) });
    return true;
  }

  // ---- Save model config (uses per-model key if available) ----
  if (msg.action === 'saveModelConfig' && msg.modelChoice) {
    var config = MODEL_CONFIG[msg.modelChoice];
    if (!config) { sendResponse({ error: 'Unknown model' }); return true; }
    var perModelKeyStorageKey = 'modelKey_' + msg.modelChoice;
    chrome.storage.local.get([perModelKeyStorageKey], function (keyData) {
      var perModelKey = keyData[perModelKeyStorageKey];
      if (perModelKey) {
        chrome.storage.local.set({
          modelChoice: msg.modelChoice,
          apiKey: perModelKey,
          model: config.modelId,
          endpoint: config.endpoint,
          isAuto: msg.modelChoice === 'auto',
          useCustomAI: false,
        }, function () { sendResponse({ ok: true }); });
      } else {
        getNextKey(config.keyType).then ? null : null;
        var key = getNextKey(config.keyType);
        chrome.storage.local.set({
          modelChoice: msg.modelChoice,
          apiKey: key,
          model: config.modelId,
          endpoint: config.endpoint,
          isAuto: msg.modelChoice === 'auto',
          useCustomAI: false,
        }, function () { sendResponse({ ok: true }); });
      }
    });
    return true;
  }

  // ---- Save per-model API key ----
  if (msg.action === 'saveModelKey' && msg.modelChoice) {
    var storageKey = 'modelKey_' + msg.modelChoice;
    var saveObj = {};
    saveObj[storageKey] = msg.apiKey || '';
    chrome.storage.local.set(saveObj, function () {
      chrome.storage.local.get(['modelChoice'], function (data) {
        if (data.modelChoice === msg.modelChoice && msg.apiKey) {
          var cfg = MODEL_CONFIG[msg.modelChoice];
          if (cfg) {
            chrome.storage.local.set({ apiKey: msg.apiKey, model: cfg.modelId, endpoint: cfg.endpoint });
          }
        }
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  // ---- Get all per-model API keys ----
  if (msg.action === 'getModelKeys') {
    var modelKeys = {};
    var modelIds = Object.keys(MODEL_CONFIG);
    var storageKeys = modelIds.map(function (id) { return 'modelKey_' + id; });
    chrome.storage.local.get(storageKeys, function (data) {
      for (var i = 0; i < modelIds.length; i++) {
        modelKeys[modelIds[i]] = data['modelKey_' + modelIds[i]] || '';
      }
      sendResponse({ keys: modelKeys });
    });
    return true;
  }

  // ---- Generate image ----
  if (msg.action === 'generateImage' && msg.prompt) {
    var imageUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(msg.prompt) + '?width=768&height=768&nologo=true';
    sendResponse({ ok: true, url: imageUrl });
    return true;
  }

  // ---- Generate video ----
  if (msg.action === 'generateVideo' && msg.prompt) {
    var videoUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(msg.prompt) + '?width=512&height=512&nologo=true&model=video';
    sendResponse({ ok: true, url: videoUrl });
    return true;
  }

  return false;
});