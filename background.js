/**
 * Split Tab Plus - Background Service Worker
 * 处理快捷键命令、右键菜单和扩展生命周期
 */

// 存储键名
const STORAGE_KEY = 'splitTabPlusSettings';

// 默认设置
const DEFAULT_SETTINGS = {
  enabled: true,
  position: 'top',
  autoHide: false,
  collapsed: false,
  fontSize: 26
};

/**
 * 监听扩展安装/更新
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装，初始化设置
    chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    console.log('Split Tab Plus installed successfully!');
  } else if (details.reason === 'update') {
    // 扩展更新
    console.log('Split Tab Plus updated to version', chrome.runtime.getManifest().version);
  }
  
  // 创建右键菜单
  createContextMenus();
});

/**
 * 创建右键菜单
 */
function createContextMenus() {
  // 移除所有现有菜单
  chrome.contextMenus.removeAll(() => {
    // 在链接上显示的菜单
    chrome.contextMenus.create({
      id: 'open-in-other-tab',
      title: '在另一侧打开链接',
      contexts: ['link']
    });
    
    // 在页面上显示的菜单（用于当前页面）
    chrome.contextMenus.create({
      id: 'open-page-in-other-tab',
      title: '在另一侧打开当前页面',
      contexts: ['page']
    });
    
    // 在扩展图标上右键显示的菜单
    chrome.contextMenus.create({
      id: 'open-options',
      title: '打开设置',
      contexts: ['action']
    });
    
    console.log('Context menus created');
  });
}

// 使用 session 存储临时状态，浏览器关闭后自动清空
const STATE_STORAGE = chrome.storage.session || chrome.storage.local;
const TAB_STATE_KEY = 'splitTabPlusTabStates';

/**
 * 获取已启用地址栏的标签页集合
 */
async function getEnabledTabs() {
  const result = await STATE_STORAGE.get(TAB_STATE_KEY);
  return result[TAB_STATE_KEY] || {};
}

/**
 * 检查标签页是否启用地址栏
 */
async function isTabEnabled(tabId) {
  const enabledTabs = await getEnabledTabs();
  return enabledTabs[tabId] === true;
}

/**
 * 批量设置标签页地址栏状态
 */
async function setTabsEnabled(tabIds, enabled) {
  const enabledTabs = await getEnabledTabs();
  for (const id of tabIds) {
    if (enabled) {
      enabledTabs[id] = true;
    } else {
      delete enabledTabs[id];
    }
  }
  await STATE_STORAGE.set({ [TAB_STATE_KEY]: enabledTabs });
}

/**
 * 清理已关闭标签页的状态
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  setTabsEnabled([tabId], false).catch(() => {});
});

/**
 * 监听扩展图标点击 - 在当前窗口的所有标签页切换地址栏
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab && tab.windowId) {
    try {
      // 获取当前窗口的所有标签页
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      const validTabs = tabs.filter(t => t.id && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
      const tabIds = validTabs.map(t => t.id);
      
      if (tabIds.length === 0) {
        return;
      }
      
      // 判断当前窗口是否已全部启用
      const enabledTabs = await getEnabledTabs();
      const enabledCount = tabIds.filter(id => enabledTabs[id] === true).length;
      const newState = enabledCount !== tabIds.length;
      
      // 保存状态（仅记录 tabId，不基于 URL）
      await setTabsEnabled(tabIds, newState);
      
      console.log(`Setting addressbar ${newState ? 'ON' : 'OFF'} for ${tabIds.length} tabs in window ${tab.windowId}`);
      
      // 向所有标签页发送消息
      for (const t of validTabs) {
        try {
          await chrome.tabs.sendMessage(t.id, { 
            action: newState ? 'show-addressbar' : 'hide-addressbar'
          });
        } catch (e) {
          // 忽略无法发送消息的标签页
        }
      }
    } catch (error) {
      console.log('Error toggling addressbar:', error.message);
    }
  }
});

/**
 * 监听右键菜单点击
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('=== Context Menu Clicked ===');
  console.log('Menu item:', info.menuItemId);
  console.log('Link URL:', info.linkUrl);
  console.log('Page URL:', info.pageUrl);
  console.log('Tab info:', tab ? { id: tab.id, index: tab.index, windowId: tab.windowId } : 'undefined');
  
  if (info.menuItemId === 'open-in-other-tab') {
    const url = info.linkUrl;
    if (!url) {
      console.log('ERROR: No link URL found');
      return;
    }
    if (!tab || !tab.id) {
      console.log('ERROR: No tab info, trying to get active tab');
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id) {
        await openInOtherTab(activeTab.id, url);
      } else {
        console.log('ERROR: Could not get active tab');
      }
      return;
    }
    await openInOtherTab(tab.id, url);
  } else if (info.menuItemId === 'open-page-in-other-tab') {
    if (!tab || !tab.id) {
      console.log('ERROR: No tab info for page operation');
      return;
    }
    const url = tab.url || info.pageUrl;
    if (!url) {
      console.log('ERROR: No page URL found');
      return;
    }
    await openInOtherTab(tab.id, url);
  } else if (info.menuItemId === 'open-options') {
    // 打开设置页面
    chrome.runtime.openOptionsPage();
  }
});

/**
 * 在另一个标签页中打开URL
 * 专门为Chrome分屏模式设计：在相邻的标签页中打开链接
 * @param {number} currentTabId 当前标签页ID
 * @param {string} url 要打开的URL
 */
async function openInOtherTab(currentTabId, url) {
  try {
    console.log('=== openInOtherTab START ===');
    console.log('Current tab ID:', currentTabId);
    console.log('URL to open:', url);
    
    // 获取当前标签页信息
    const currentTab = await chrome.tabs.get(currentTabId);
    console.log('Current tab:', JSON.stringify({
      id: currentTab.id,
      index: currentTab.index,
      windowId: currentTab.windowId,
      active: currentTab.active,
      url: currentTab.url?.substring(0, 50)
    }));
    
    // 获取同一窗口的所有标签页（按index排序）
    const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
    allTabs.sort((a, b) => a.index - b.index);
    
    console.log('All tabs in window (sorted by index):');
    allTabs.forEach(t => {
      console.log(`  - Tab ${t.id}: index=${t.index}, active=${t.active}, url=${t.url?.substring(0, 30)}`);
    });
    
    // 找到除当前标签页之外的其他标签页
    const otherTabs = allTabs.filter(t => t.id !== currentTabId);
    
    if (otherTabs.length === 0) {
      console.log('No other tabs found in this window');
      return;
    }
    
    // 分屏模式下，优先选择相邻的标签页
    // 策略：先找右边相邻的，再找左边相邻的，最后选最近的
    let targetTab = null;
    
    // 1. 先尝试找 index + 1 的标签页（右侧相邻）
    targetTab = allTabs.find(t => t.index === currentTab.index + 1);
    if (targetTab) {
      console.log('Found adjacent tab on the RIGHT (index + 1)');
    }
    
    // 2. 如果没找到，尝试找 index - 1 的标签页（左侧相邻）
    if (!targetTab) {
      targetTab = allTabs.find(t => t.index === currentTab.index - 1);
      if (targetTab) {
        console.log('Found adjacent tab on the LEFT (index - 1)');
      }
    }
    
    // 3. 如果还没找到，选择距离最近的标签页
    if (!targetTab) {
      otherTabs.sort((a, b) => 
        Math.abs(a.index - currentTab.index) - Math.abs(b.index - currentTab.index)
      );
      targetTab = otherTabs[0];
      console.log('Using nearest tab');
    }
    
    if (!targetTab) {
      console.log('ERROR: Could not find any target tab');
      return;
    }
    
    console.log('Target tab selected:', JSON.stringify({
      id: targetTab.id,
      index: targetTab.index,
      url: targetTab.url?.substring(0, 30)
    }));
    
    // 使用 chrome.tabs.update 更新目标标签页的 URL
    console.log('Updating tab', targetTab.id, 'with URL:', url);
    const updatedTab = await chrome.tabs.update(targetTab.id, { url: url });
    console.log('Tab updated successfully:', updatedTab.id);
    console.log('=== openInOtherTab END ===');
    
  } catch (error) {
    console.error('Error in openInOtherTab:', error.message);
    console.error('Stack:', error.stack);
  }
}

/**
 * 监听快捷键命令
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-addressbar') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggle-addressbar' });
      } catch (error) {
        console.log('Cannot toggle addressbar on this page:', error.message);
      }
    }
  }
});

/**
 * 监听来自popup、options或content script的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get-settings') {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      sendResponse(result[STORAGE_KEY] || DEFAULT_SETTINGS);
    });
    return true;
  }
  
  if (message.action === 'save-settings') {
    chrome.storage.sync.set({ [STORAGE_KEY]: message.settings }, () => {
      sendResponse({ success: true });
      broadcastSettingsUpdate(message.settings);
    });
    return true;
  }
  
  if (message.action === 'toggle-all-tabs') {
    toggleAllTabs();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'open-in-other-tab') {
    // 从content script请求
    if (sender.tab && sender.tab.id) {
      openInOtherTab(sender.tab.id, message.url);
    }
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'check-tab-state') {
    // 检查当前标签页是否启用地址栏（不基于URL）
    if (sender.tab && sender.tab.id) {
      isTabEnabled(sender.tab.id).then(enabled => {
        sendResponse({ enabled: enabled });
      });
    } else {
      sendResponse({ enabled: false });
    }
    return true;
  }
});

/**
 * 检查当前窗口是否处于分屏模式
 * 分屏模式 = 同一窗口有2个或以上标签页
 */
async function checkSplitMode(senderTab) {
  try {
    let windowId;
    
    // 获取窗口ID
    if (senderTab && senderTab.windowId) {
      windowId = senderTab.windowId;
    } else if (senderTab && senderTab.id) {
      const tab = await chrome.tabs.get(senderTab.id);
      windowId = tab.windowId;
    }
    
    if (!windowId) {
      // 如果无法获取窗口ID，使用当前窗口
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      windowId = currentTab?.windowId;
    }
    
    if (!windowId) {
      console.log('checkSplitMode: Could not determine window ID');
      return false;
    }
    
    // 查询该窗口的所有标签页
    const tabs = await chrome.tabs.query({ windowId: windowId });
    const isSplit = tabs.length >= 2;
    
    console.log(`checkSplitMode: Window ${windowId} has ${tabs.length} tabs, isSplit: ${isSplit}`);
    return isSplit;
  } catch (error) {
    console.error('Error checking split mode:', error);
    return false;
  }
}

/**
 * 向所有标签页广播设置更新
 */
async function broadcastSettingsUpdate(settings) {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'update-settings',
            settings: settings
          });
        } catch (e) {
          // 忽略
        }
      }
    }
  } catch (error) {
    console.error('Error broadcasting settings:', error);
  }
}

/**
 * 切换所有标签页的地址栏显示
 */
async function toggleAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'toggle-addressbar' });
        } catch (e) {
          // 忽略
        }
      }
    }
  } catch (error) {
    console.error('Error toggling all tabs:', error);
  }
}

/**
 * 监听标签页更新
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 保留以备将来使用
});
