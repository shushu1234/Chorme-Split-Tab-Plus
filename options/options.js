/**
 * Split Tab Plus - Options Page Script
 */

(function() {
  'use strict';

  // DOM元素
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleAutohide = document.getElementById('toggle-autohide');
  const positionRadios = document.querySelectorAll('input[name="position"]');
  const fontSizeSlider = document.getElementById('font-size');
  const fontSizeValue = document.getElementById('font-size-value');
  const btnSave = document.getElementById('btn-save');
  const saveStatus = document.getElementById('save-status');
  const linkShortcuts = document.getElementById('link-shortcuts');

  // 当前设置
  let currentSettings = {
    enabled: true,
    position: 'top',
    autoHide: false,
    collapsed: false,
    fontSize: 26
  };

  /**
   * 初始化
   */
  async function init() {
    // 加载设置
    await loadSettings();
    
    // 绑定事件
    bindEvents();
  }

  /**
   * 加载设置
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'get-settings' }, (settings) => {
        if (settings) {
          currentSettings = { ...currentSettings, ...settings };
        }
        updateUI();
        resolve();
      });
    });
  }

  /**
   * 保存设置
   */
  function saveSettings() {
    // 收集表单数据
    currentSettings.enabled = toggleEnabled.checked;
    currentSettings.autoHide = toggleAutohide.checked;
    currentSettings.fontSize = parseInt(fontSizeSlider.value, 10);
    
    // 获取位置
    positionRadios.forEach(radio => {
      if (radio.checked) {
        currentSettings.position = radio.value;
      }
    });
    
    // 发送保存请求
    chrome.runtime.sendMessage({
      action: 'save-settings',
      settings: currentSettings
    }, (response) => {
      if (response && response.success) {
        showSaveStatus();
      }
    });
  }

  /**
   * 更新UI以反映当前设置
   */
  function updateUI() {
    // 启用开关
    toggleEnabled.checked = currentSettings.enabled;
    
    // 自动隐藏
    toggleAutohide.checked = currentSettings.autoHide;
    
    // 位置
    positionRadios.forEach(radio => {
      radio.checked = radio.value === currentSettings.position;
    });
    
    // 字体大小
    const fontSize = currentSettings.fontSize || 26;
    fontSizeSlider.value = fontSize;
    fontSizeValue.textContent = fontSize + 'px';
  }

  /**
   * 绑定事件监听器
   */
  function bindEvents() {
    // 保存按钮
    btnSave.addEventListener('click', saveSettings);
    
    // 快捷键链接
    linkShortcuts.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
    
    // 字体大小滑块实时更新显示
    fontSizeSlider.addEventListener('input', () => {
      fontSizeValue.textContent = fontSizeSlider.value + 'px';
    });
    
    // 自动保存
    toggleEnabled.addEventListener('change', autoSave);
    toggleAutohide.addEventListener('change', autoSave);
    positionRadios.forEach(radio => {
      radio.addEventListener('change', autoSave);
    });
    fontSizeSlider.addEventListener('change', autoSave);
  }

  /**
   * 自动保存
   */
  function autoSave() {
    saveSettings();
  }

  /**
   * 显示保存状态
   */
  function showSaveStatus() {
    saveStatus.textContent = '✓ 已保存';
    saveStatus.classList.add('visible');
    
    setTimeout(() => {
      saveStatus.classList.remove('visible');
    }, 2000);
  }

  // 启动
  document.addEventListener('DOMContentLoaded', init);
})();
