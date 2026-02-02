/**
 * Split Tab Plus - Popup Script
 * 处理设置面板的用户交互
 */

(function() {
  'use strict';

  // DOM元素
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleAutohide = document.getElementById('toggle-autohide');
  const positionBtns = document.querySelectorAll('.position-btn');
  const btnToggleAll = document.getElementById('btn-toggle-all');

  // 当前设置
  let currentSettings = {
    enabled: true,
    position: 'top',
    autoHide: false,
    collapsed: false
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
  function saveSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    
    chrome.runtime.sendMessage({
      action: 'save-settings',
      settings: currentSettings
    }, (response) => {
      if (response && response.success) {
        // 显示保存成功的视觉反馈
        showSaveIndicator();
      }
    });
  }

  /**
   * 更新UI以反映当前设置
   */
  function updateUI() {
    // 主开关
    toggleEnabled.checked = currentSettings.enabled;
    
    // 位置按钮
    positionBtns.forEach(btn => {
      const position = btn.dataset.position;
      btn.classList.toggle('active', position === currentSettings.position);
    });
    
    // 自动隐藏
    toggleAutohide.checked = currentSettings.autoHide;
  }

  /**
   * 绑定事件监听器
   */
  function bindEvents() {
    // 主开关
    toggleEnabled.addEventListener('change', () => {
      saveSettings({ enabled: toggleEnabled.checked });
    });
    
    // 位置按钮
    positionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const position = btn.dataset.position;
        
        // 更新UI
        positionBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 保存设置
        saveSettings({ position });
      });
    });
    
    // 自动隐藏
    toggleAutohide.addEventListener('change', () => {
      saveSettings({ autoHide: toggleAutohide.checked });
    });
    
    // 切换所有标签页
    btnToggleAll.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'toggle-all-tabs' }, () => {
        // 显示操作成功的视觉反馈
        btnToggleAll.style.transform = 'scale(0.95)';
        setTimeout(() => {
          btnToggleAll.style.transform = '';
        }, 150);
      });
    });
  }

  /**
   * 显示保存指示器
   */
  function showSaveIndicator() {
    document.body.classList.add('saving');
    setTimeout(() => {
      document.body.classList.remove('saving');
    }, 300);
  }

  // 启动
  document.addEventListener('DOMContentLoaded', init);
})();

