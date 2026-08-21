// 最小 service worker:点击扩展图标 → 打开整页查看器。
// 除此之外无任何后台逻辑(见 design.md D5)。
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') })
})
