// ============================================================
// PATH AI — POPUP SCRIPT
// Buttons: Open Side Panel, Menu, Settings
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  var $ = function (id) { return document.getElementById(id); };

  // Initialize default model if not set
  var data = await chrome.storage.local.get(['modelChoice']);
  if (!data.modelChoice) {
    chrome.runtime.sendMessage({ action: 'saveModelConfig', modelChoice: 'auto' });
  }

  // Open Side Panel
  $('openSidePanel').addEventListener('click', function () {
    if (chrome.sidePanel) {
      chrome.sidePanel.open().then(function () { window.close(); }).catch(function (e) {
        $('status').textContent = 'Side panel not available';
        $('status').style.color = '#ef4444';
      });
    } else {
      $('status').textContent = 'Side panel not supported';
      $('status').style.color = '#ef4444';
    }
  });

  // Open Menu (inject content script if needed)
  $('openMenu').addEventListener('click', async function () {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'showMenu' }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          chrome.scripting.insertCSS({ target: { tabId: tabs[0].id }, files: ['sidebar.css'] }, function () {
            chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }, function () {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'showMenu' });
            });
          });
        }
      });
      window.close();
    }
  });

  // Open Settings
  $('openSettings').addEventListener('click', async function () {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'showSettings' }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          chrome.scripting.insertCSS({ target: { tabId: tabs[0].id }, files: ['sidebar.css'] }, function () {
            chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }, function () {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'showSettings' });
            });
          });
        }
      });
      window.close();
    }
  });
});