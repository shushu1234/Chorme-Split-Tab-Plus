/**
 * Split Tab Plus - Content Script
 * 在每个页面注入浮动地址栏（不遮挡网页内容）
 */

(function() {
  'use strict';

  // 避免重复注入
  if (window.__splitTabPlusInjected) return;
  window.__splitTabPlusInjected = true;

  // 配置常量
  const STORAGE_KEY = 'splitTabPlusSettings';
  const BASE_FONT_SIZE = 26; // 基准字体大小
  const BASE_BAR_HEIGHT = 84; // 基准地址栏高度（对应26px字体）
  const DEFAULT_SETTINGS = {
    enabled: true,
    position: 'top',
    autoHide: false,
    collapsed: false,
    fontSize: 26  // 默认字体大小 (20-50)
  };
  
  /**
   * 根据字体大小计算缩放比例
   */
  function getScaleRatio() {
    const fontSize = settings.fontSize || BASE_FONT_SIZE;
    return fontSize / BASE_FONT_SIZE;
  }
  
  /**
   * 获取当前地址栏高度
   */
  function getBarHeight() {
    return Math.round(BASE_BAR_HEIGHT * getScaleRatio());
  }
  
  /**
   * 获取折叠条高度
   */
  function getCollapsedHeight() {
    return Math.round(48 * getScaleRatio());
  }

  let settings = { ...DEFAULT_SETTINGS };
  let container = null;
  let shadowRoot = null;
  let isCollapsed = false;
  let urlCheckIntervalId = null;
  let popstateHandler = null;
  let hashchangeHandler = null;
  let contextValid = true;

  /**
   * 检查扩展上下文是否有效
   */
  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /**
   * 清理已注册的监听，避免扩展重载后持续报错
   */
  function cleanupContext() {
    if (!contextValid) return;
    contextValid = false;

    if (urlCheckIntervalId) {
      clearInterval(urlCheckIntervalId);
      urlCheckIntervalId = null;
    }

    if (popstateHandler) {
      window.removeEventListener('popstate', popstateHandler);
      popstateHandler = null;
    }

    if (hashchangeHandler) {
      window.removeEventListener('hashchange', hashchangeHandler);
      hashchangeHandler = null;
    }
  }

  /**
   * 判断是否为扩展上下文失效错误
   */
  function isContextInvalidatedError(error) {
    return String(error?.message || '').includes('Extension context invalidated');
  }

  /**
   * 获取页面缩放比例
   */
  function getPageZoom() {
    // 通过比较 outerWidth 和 innerWidth 来检测缩放
    // 注意：这种方法在某些情况下可能不完全准确，但对于大多数场景有效
    const zoom = Math.round((window.outerWidth / window.innerWidth) * 100) / 100;
    // 限制范围，避免异常值
    return Math.max(0.25, Math.min(5, zoom));
  }

  /**
   * 应用反向缩放到地址栏
   */
  function applyZoomCompensation() {
    if (!shadowRoot) return;
    
    const wrapper = shadowRoot.querySelector('.stp-bar-wrapper');
    if (!wrapper) return;
    
    const zoom = getPageZoom();
    const scale = 1 / zoom;
    
    // 应用反向缩放
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.transformOrigin = settings.position === 'bottom' ? 'bottom left' : 'top left';
    
    // 调整宽度以补偿缩放
    wrapper.style.width = `${zoom * 100}%`;
    
    console.log(`Split Tab Plus: 页面缩放 ${Math.round(zoom * 100)}%, 应用反向缩放 ${Math.round(scale * 100)}%`);
  }

  /**
   * 创建浮动地址栏
   */
  function createAddressBar() {
    // 创建容器
    container = document.createElement('div');
    container.id = 'split-tab-plus-container';
    
    // 使用Shadow DOM隔离样式
    shadowRoot = container.attachShadow({ mode: 'open' });
    
    // 注入样式
    const style = document.createElement('style');
    style.textContent = getAddressBarStyles();
    shadowRoot.appendChild(style);
    
    // 创建地址栏HTML
    const barWrapper = document.createElement('div');
    barWrapper.className = 'stp-bar-wrapper';
    barWrapper.innerHTML = `
      <div class="stp-address-bar" id="stp-address-bar">
        <div class="stp-controls">
          <button class="stp-btn" id="stp-btn-back" title="后退">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <button class="stp-btn" id="stp-btn-forward" title="前进">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
          <button class="stp-btn" id="stp-btn-refresh" title="刷新">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>
        <div class="stp-url-container">
          <span class="stp-protocol" id="stp-protocol"></span>
          <input type="text" class="stp-url-input" id="stp-url-input" placeholder="输入网址..." spellcheck="false" autocomplete="off">
          <button class="stp-btn stp-btn-go" id="stp-btn-go" title="跳转">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
        <div class="stp-actions">
          <button class="stp-btn" id="stp-btn-collapse" title="折叠地址栏">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 15l-6-6-6 6"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="stp-collapsed-bar" id="stp-collapsed-bar">
        <span class="stp-collapsed-url" id="stp-collapsed-url"></span>
        <button class="stp-btn stp-btn-expand" id="stp-btn-expand" title="展开地址栏">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
      </div>
    `;
    
    shadowRoot.appendChild(barWrapper);
    
    // 插入到body最前面
    if (document.body.firstChild) {
      document.body.insertBefore(container, document.body.firstChild);
    } else {
      document.body.appendChild(container);
    }
    
    // 调整页面以腾出空间
    adjustPageSpace(true);
    
    // 绑定事件
    bindEvents();
    
    // 更新URL显示
    updateUrlDisplay();
    
    // 应用设置
    applySettings();
    
    // 应用缩放补偿（防止随页面缩放变化）
    applyZoomCompensation();
    
    // 监听窗口大小变化（可能是缩放变化）
    window.addEventListener('resize', debounce(() => {
      applyZoomCompensation();
      // 同时更新页面空间以适应新的缩放
      const wrapper = shadowRoot?.querySelector('.stp-bar-wrapper');
      if (wrapper && !wrapper.classList.contains('hidden')) {
        adjustPageSpace(true);
      }
    }, 100));
    
    return container;
  }
  
  /**
   * 防抖函数
   */
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * 调整页面空间
   */
  function adjustPageSpace(show) {
    // 计算需要的高度（使用动态高度）
    let height = 0;
    if (show && settings.enabled) {
      height = isCollapsed ? getCollapsedHeight() : getBarHeight();
    }
    
    // 清除之前的设置
    document.body.style.removeProperty('margin-top');
    document.body.style.removeProperty('margin-bottom');
    document.documentElement.style.removeProperty('--stp-bar-height');
    
    if (height > 0) {
      // 获取页面缩放比例并计算实际需要的margin
      // 由于地址栏被反向缩放，视觉高度固定，但margin需要根据缩放调整
      const zoom = getPageZoom();
      const actualHeight = Math.round(height / zoom);
      
      document.documentElement.style.setProperty('--stp-bar-height', actualHeight + 'px');
      
      // 根据位置设置margin
      if (settings.position === 'bottom') {
        document.body.style.setProperty('margin-bottom', actualHeight + 'px', 'important');
      } else {
        document.body.style.setProperty('margin-top', actualHeight + 'px', 'important');
      }
    }
  }

  /**
   * 获取地址栏内联样式
   */
  function getAddressBarStyles() {
    const fontSize = settings.fontSize || BASE_FONT_SIZE;
    const scale = fontSize / BASE_FONT_SIZE;
    
    // 根据字体大小等比例计算各尺寸
    const barHeight = Math.round(84 * scale);
    const collapsedHeight = Math.round(48 * scale);
    const btnSize = Math.round(60 * scale);
    const btnPadding = Math.round(12 * scale);
    const iconSize = Math.round(32 * scale);
    const gap = Math.round(16 * scale);
    const padding = Math.round(24 * scale);
    const borderRadius = Math.round(12 * scale);
    const urlContainerHeight = Math.round(60 * scale);
    
    return `
      :host {
        --stp-font-size: ${fontSize}px;
        --stp-scale: ${scale};
        --stp-bar-height: ${barHeight}px;
        --stp-collapsed-height: ${collapsedHeight}px;
        --stp-btn-size: ${btnSize}px;
        --stp-btn-padding: ${btnPadding}px;
        --stp-icon-size: ${iconSize}px;
        --stp-gap: ${gap}px;
        --stp-padding: ${padding}px;
        --stp-radius: ${borderRadius}px;
        --stp-url-height: ${urlContainerHeight}px;
      }
      
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      
      .stp-bar-wrapper {
        position: fixed !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
        font-size: var(--stp-font-size) !important;
        line-height: 1.4 !important;
        transform: translateZ(0);
        isolation: isolate;
      }
      
      .stp-bar-wrapper * {
        font-family: inherit !important;
        font-size: var(--stp-font-size) !important;
        line-height: 1.4 !important;
      }
      
      /* 顶部位置 */
      .stp-bar-wrapper.position-top {
        top: 0 !important;
        bottom: auto !important;
      }
      
      /* 底部位置 */
      .stp-bar-wrapper.position-bottom {
        top: auto !important;
        bottom: 0 !important;
      }
      
      .stp-bar-wrapper.hidden {
        display: none !important;
      }
      
      .stp-address-bar {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--stp-gap);
        height: var(--stp-bar-height);
        padding: 0 var(--stp-padding);
        background: linear-gradient(180deg, #2a2a2a 0%, #1e1e1e 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        z-index: 2;
      }
      
      /* 底部时的样式调整 */
      .position-bottom .stp-address-bar {
        border-bottom: none;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.3);
      }
      
      .stp-address-bar.collapsed {
        display: none !important;
      }
      
      .stp-collapsed-bar {
        position: relative;
        display: none;
        align-items: center;
        gap: var(--stp-gap);
        height: var(--stp-collapsed-height);
        padding: 0 var(--stp-padding);
        background: linear-gradient(180deg, #444 0%, #333 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        transition: background 0.2s ease;
        z-index: 1;
      }
      
      /* 底部时折叠条样式 */
      .position-bottom .stp-collapsed-bar {
        border-bottom: none;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.3);
      }
      
      .stp-collapsed-bar:hover {
        background: linear-gradient(180deg, #555 0%, #444 100%);
      }
      
      .stp-collapsed-bar.visible {
        display: flex !important;
      }
      
      /* 折叠条的展开按钮 */
      .stp-collapsed-bar .stp-btn-expand {
        color: rgba(255, 255, 255, 0.8);
      }
      
      .stp-collapsed-bar .stp-btn-expand:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.15);
      }
      
      /* 底部时箭头方向翻转 */
      .position-bottom #stp-btn-collapse svg,
      .position-bottom .stp-btn-expand svg {
        transform: rotate(180deg);
      }
      
      .stp-collapsed-url {
        flex: 1;
        color: rgba(255, 255, 255, 0.6);
        font-size: calc(var(--stp-font-size) - 2px) !important;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-left: var(--stp-gap);
      }
      
      .stp-controls {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      
      .stp-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--stp-btn-size);
        height: var(--stp-btn-size);
        padding: var(--stp-btn-padding);
        background: transparent;
        border: none;
        border-radius: var(--stp-radius);
        color: rgba(255, 255, 255, 0.75);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
        outline: none;
      }
      
      .stp-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
      }
      
      .stp-btn:active {
        transform: scale(0.92);
        background: rgba(255, 255, 255, 0.18);
      }
      
      .stp-btn svg {
        width: var(--stp-icon-size);
        height: var(--stp-icon-size);
        pointer-events: none;
      }
      
      .stp-btn.loading svg {
        animation: spin 0.8s linear infinite;
      }
      
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .stp-url-container {
        flex: 1;
        display: flex;
        align-items: center;
        gap: calc(var(--stp-gap) / 2);
        height: var(--stp-url-height);
        background: rgba(0, 0, 0, 0.3);
        border-radius: var(--stp-radius);
        padding: 0 var(--stp-padding);
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      }
      
      .stp-url-container:focus-within {
        border-color: rgba(66, 133, 244, 0.6);
        background: rgba(0, 0, 0, 0.4);
        box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
      }
      
      .stp-protocol {
        color: rgba(255, 255, 255, 0.5);
        font-size: var(--stp-font-size) !important;
        user-select: none;
        flex-shrink: 0;
      }
      
      .stp-protocol.secure {
        color: #34a853;
      }
      
      .stp-protocol.insecure {
        color: #ea4335;
      }
      
      .stp-url-input {
        flex: 1;
        min-width: 0;
        height: 100%;
        background: transparent;
        border: none;
        color: #fff !important;
        font-size: var(--stp-font-size) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
        outline: none;
      }
      
      .stp-url-input::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }
      
      .stp-url-input::selection {
        background: rgba(66, 133, 244, 0.5);
      }
      
      .stp-btn-go {
        width: calc(var(--stp-btn-size) * 0.8);
        height: calc(var(--stp-btn-size) * 0.8);
        padding: calc(var(--stp-btn-padding) * 0.6);
        margin-right: calc(var(--stp-btn-padding) * -0.3);
        opacity: 0.5;
        transition: opacity 0.2s ease, background 0.15s ease;
      }
      
      .stp-url-container:focus-within .stp-btn-go {
        opacity: 1;
      }
      
      .stp-actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      
      #stp-btn-collapse svg {
        transition: transform 0.3s ease;
      }
      
      .stp-btn-expand {
        width: 20px !important;
        height: 20px !important;
        padding: 3px !important;
      }
    `;
  }

  /**
   * 绑定事件监听器
   */
  function bindEvents() {
    // 获取元素引用
    const urlInput = shadowRoot.getElementById('stp-url-input');
    const btnBack = shadowRoot.getElementById('stp-btn-back');
    const btnForward = shadowRoot.getElementById('stp-btn-forward');
    const btnRefresh = shadowRoot.getElementById('stp-btn-refresh');
    const btnGo = shadowRoot.getElementById('stp-btn-go');
    const btnCollapse = shadowRoot.getElementById('stp-btn-collapse');
    const btnExpand = shadowRoot.getElementById('stp-btn-expand');
    const collapsedBar = shadowRoot.getElementById('stp-collapsed-bar');
    
    // 后退按钮
    btnBack.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Split Tab Plus: 后退');
      window.history.back();
    });
    
    // 前进按钮
    btnForward.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Split Tab Plus: 前进');
      window.history.forward();
    });
    
    // 刷新按钮
    btnRefresh.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Split Tab Plus: 刷新');
      btnRefresh.classList.add('loading');
      window.location.reload();
    });
    
    // URL输入框 - 回车跳转
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateToUrl(urlInput.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        urlInput.value = window.location.href;
        urlInput.blur();
      }
    });
    
    // URL输入框 - 聚焦时全选
    urlInput.addEventListener('focus', () => {
      setTimeout(() => urlInput.select(), 0);
    });
    
    // 跳转按钮
    btnGo.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToUrl(urlInput.value);
    });
    
    // 折叠按钮
    btnCollapse.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCollapse(true);
    });
    
    // 展开按钮
    btnExpand.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCollapse(false);
    });
    
    // 折叠栏点击展开
    collapsedBar.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCollapse(false);
    });
    
    // 监听URL变化
    setupUrlChangeListener();
    
  }

  /**
   * 导航到指定URL
   */
  function navigateToUrl(url) {
    if (!url || url.trim() === '') return;
    
    let finalUrl = url.trim();
    
    // 处理URL格式
    if (!/^https?:\/\//i.test(finalUrl) && !/^file:\/\//i.test(finalUrl)) {
      // 检查是否像一个域名
      if (/^[\w-]+(\.[\w.-]+)+/.test(finalUrl) || finalUrl.includes('/')) {
        finalUrl = 'https://' + finalUrl;
      } else {
        // 作为搜索词处理
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
      }
    }
    
    console.log('Split Tab Plus: 导航到', finalUrl);
    
    try {
      window.location.href = finalUrl;
    } catch (e) {
      console.error('Split Tab Plus: 导航失败', e);
    }
  }

  /**
   * 更新URL显示
   */
  function updateUrlDisplay() {
    if (!contextValid || !isExtensionContextValid()) {
      cleanupContext();
      return;
    }
    if (!shadowRoot) return;
    
    const urlInput = shadowRoot.getElementById('stp-url-input');
    const protocol = shadowRoot.getElementById('stp-protocol');
    const collapsedUrl = shadowRoot.getElementById('stp-collapsed-url');
    
    if (!urlInput || !protocol || !collapsedUrl) return;
    
    const href = window.location.href;
    
    // 更新输入框 - 显示完整URL
    urlInput.value = href;
    
    // 更新协议显示
    if (href.startsWith('https://')) {
      protocol.textContent = '🔒';
      protocol.className = 'stp-protocol secure';
      protocol.title = '安全连接 (HTTPS)';
    } else if (href.startsWith('http://')) {
      protocol.textContent = '⚠️';
      protocol.className = 'stp-protocol insecure';
      protocol.title = '不安全连接 (HTTP)';
    } else {
      protocol.textContent = '📄';
      protocol.className = 'stp-protocol';
      protocol.title = window.location.protocol;
    }
    
    // 更新折叠状态下的URL显示
    collapsedUrl.textContent = window.location.hostname || href.slice(0, 50);
  }

  /**
   * 设置URL变化监听
   */
  function setupUrlChangeListener() {
    // 监听 popstate 事件（浏览器前进/后退）
    popstateHandler = () => {
      try {
        setTimeout(() => {
          try {
            updateUrlDisplay();
          } catch (e) {
            if (isContextInvalidatedError(e)) cleanupContext();
          }
        }, 100);
      } catch (e) {
        if (isContextInvalidatedError(e)) cleanupContext();
      }
    };
    window.addEventListener('popstate', popstateHandler);
    
    // 监听 hashchange 事件
    hashchangeHandler = () => {
      try {
        updateUrlDisplay();
      } catch (e) {
        if (isContextInvalidatedError(e)) cleanupContext();
      }
    };
    window.addEventListener('hashchange', hashchangeHandler);
    
    // 使用轮询监听 SPA 的 URL 变化
    let lastUrl = window.location.href;
    const checkUrl = () => {
      if (!contextValid || !isExtensionContextValid()) {
        cleanupContext();
        return;
      }
      try {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
          updateUrlDisplay();
        }
      } catch (e) {
        if (isContextInvalidatedError(e)) cleanupContext();
      }
    };
    
    // 定期检查URL变化（用于SPA）
    urlCheckIntervalId = setInterval(checkUrl, 1000);
  }

  /**
   * 切换折叠状态
   */
  function toggleCollapse(collapse) {
    if (!shadowRoot) return;
    
    isCollapsed = collapse;
    const bar = shadowRoot.getElementById('stp-address-bar');
    const collapsedBar = shadowRoot.getElementById('stp-collapsed-bar');
    
    if (collapse) {
      bar.classList.add('collapsed');
      collapsedBar.classList.add('visible');
    } else {
      bar.classList.remove('collapsed');
      collapsedBar.classList.remove('visible');
    }
    
    // 调整页面空间
    adjustPageSpace(true);
    
    // 保存折叠状态
    saveSettings({ collapsed: collapse });
  }

  /**
   * 切换可见性
   */
  function toggleVisibility() {
    if (!shadowRoot) return;
    
    const wrapper = shadowRoot.querySelector('.stp-bar-wrapper');
    const isHidden = wrapper.classList.contains('hidden');
    
    if (isHidden) {
      wrapper.classList.remove('hidden');
      adjustPageSpace(true);
    } else {
      wrapper.classList.add('hidden');
      adjustPageSpace(false);
    }
  }

  /**
   * 应用设置
   */
  function applySettings() {
    if (!shadowRoot) return;
    
    const wrapper = shadowRoot.querySelector('.stp-bar-wrapper');
    
    // 位置设置
    wrapper.classList.remove('position-top', 'position-bottom');
    wrapper.classList.add(`position-${settings.position || 'top'}`);
    
    // 字体大小及等比例缩放设置
    const fontSize = settings.fontSize || BASE_FONT_SIZE;
    const scale = fontSize / BASE_FONT_SIZE;
    
    // 更新所有CSS变量
    const host = shadowRoot.host;
    host.style.setProperty('--stp-font-size', fontSize + 'px');
    host.style.setProperty('--stp-scale', scale);
    host.style.setProperty('--stp-bar-height', Math.round(84 * scale) + 'px');
    host.style.setProperty('--stp-collapsed-height', Math.round(48 * scale) + 'px');
    host.style.setProperty('--stp-btn-size', Math.round(60 * scale) + 'px');
    host.style.setProperty('--stp-btn-padding', Math.round(12 * scale) + 'px');
    host.style.setProperty('--stp-icon-size', Math.round(32 * scale) + 'px');
    host.style.setProperty('--stp-gap', Math.round(16 * scale) + 'px');
    host.style.setProperty('--stp-padding', Math.round(24 * scale) + 'px');
    host.style.setProperty('--stp-radius', Math.round(12 * scale) + 'px');
    host.style.setProperty('--stp-url-height', Math.round(60 * scale) + 'px');
    
    // 启用/禁用
    if (!settings.enabled) {
      wrapper.classList.add('hidden');
      adjustPageSpace(false);
    } else {
      wrapper.classList.remove('hidden');
      adjustPageSpace(true);
    }
    
    // 折叠状态
    if (settings.collapsed) {
      toggleCollapse(true);
    }
    
    // 更新缩放补偿（position变化会影响transformOrigin）
    applyZoomCompensation();
  }

  /**
   * 加载设置
   */
  function loadSettings() {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(STORAGE_KEY, (result) => {
          if (result && result[STORAGE_KEY]) {
            settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
          }
          resolve(settings);
        });
      } else {
        // 降级使用 localStorage
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
          }
        } catch (e) {}
        resolve(settings);
      }
    });
  }

  /**
   * 保存设置
   */
  function saveSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ [STORAGE_KEY]: settings });
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch (e) {}
    }
  }

  /**
   * 设置快捷键点击打开链接功能（使用Shift键）
   */
  function setupShortcutClickHandler() {
    document.addEventListener('click', (e) => {
      // 只使用Shift键
      if (!e.shiftKey) return;
      
      // 查找点击的链接元素
      let target = e.target;
      while (target && target !== document.body) {
        if (target.tagName === 'A' && target.href) {
          e.preventDefault();
          e.stopPropagation();
          
          // 发送消息给background script在另一侧打开
          if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'open-in-other-tab',
              url: target.href
            });
          }
          
          console.log('Split Tab Plus: Shift+点击，在另一侧打开', target.href);
          return;
        }
        target = target.parentElement;
      }
    }, true); // 使用捕获阶段
  }

  /**
   * 初始化
   * 检查标签页状态，如果标签页已启用地址栏则自动显示
   */
  async function init() {
    // 检查是否在特殊页面
    if (window.location.protocol === 'chrome:' || 
        window.location.protocol === 'chrome-extension:' ||
        window.location.protocol === 'about:' ||
        window.location.protocol === 'edge:') {
      return;
    }
    
    // 加载设置
    await loadSettings();
    
    // 设置快捷键点击处理（Shift+点击在另一侧打开）
    setupShortcutClickHandler();
    
    // 监听来自background的消息
    setupMessageListener();
    
    // 检查当前窗口是否已启用地址栏
    try {
      if (!isExtensionContextValid()) {
        cleanupContext();
        return;
      }
      const response = await chrome.runtime.sendMessage({ action: 'check-tab-state' });
      if (response && response.enabled) {
        console.log('Split Tab Plus: 标签页已启用地址栏，自动显示');
        createAddressBar();
      } else {
        console.log('Split Tab Plus: 已加载，按 Alt+A 或点击图标启用地址栏');
      }
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        cleanupContext();
      } else {
        console.log('Split Tab Plus: 无法检查标签页状态', error.message);
      }
    }
  }
  
  /**
   * 设置消息监听器
   */
  function setupMessageListener() {
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!contextValid || !isExtensionContextValid()) {
          cleanupContext();
          return true;
        }
        if (message.action === 'toggle-addressbar') {
          // 如果地址栏不存在，先创建
          if (!container) {
            createAddressBar();
          } else {
            toggleVisibility();
          }
          sendResponse({ success: true });
        } else if (message.action === 'show-addressbar') {
          // 显示地址栏（如果不存在则创建）
          if (!container) {
            createAddressBar();
          } else {
            const wrapper = shadowRoot?.querySelector('.stp-bar-wrapper');
            if (wrapper && wrapper.classList.contains('hidden')) {
              wrapper.classList.remove('hidden');
              adjustPageSpace(true);
            }
          }
          sendResponse({ success: true });
        } else if (message.action === 'hide-addressbar') {
          // 隐藏地址栏
          if (container) {
            const wrapper = shadowRoot?.querySelector('.stp-bar-wrapper');
            if (wrapper) {
              wrapper.classList.add('hidden');
              adjustPageSpace(false);
            }
          }
          sendResponse({ success: true });
        } else if (message.action === 'update-settings') {
          settings = { ...settings, ...message.settings };
          if (container) {
            applySettings();
          }
          sendResponse({ success: true });
        } else if (message.action === 'get-status') {
          const wrapper = shadowRoot?.querySelector('.stp-bar-wrapper');
          sendResponse({ 
            visible: wrapper && !wrapper.classList.contains('hidden'),
            collapsed: isCollapsed,
            exists: !!container
          });
        }
        return true;
      });
    }
  }

  // 启动
  init();
})();
