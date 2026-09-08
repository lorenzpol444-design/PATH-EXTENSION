document.addEventListener('DOMContentLoaded', function () {
  const chatBtn = document.getElementById('open-chat-btn');
  
  chatBtn.addEventListener('click', function () {
    chrome.windows.getCurrent(function (win) {
      chrome.sidePanel.open({ windowId: win.id }).then(function () {
        window.close();
      }).catch(function (e) {
        document.getElementById('status').textContent = 'Side panel not available';
        document.getElementById('status').style.color = '#ef4444';
      });
    });
  });
});