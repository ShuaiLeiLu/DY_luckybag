const storage = {
  get(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (result) => {
        chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result);
      });
    });
  },
  set(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve();
      });
    });
  },
  remove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.remove(keys, () => {
        chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve();
      });
    });
  }
};
const uuid = () => {
  function S4() {
    return ((1 + Math.random()) * 65536 | 0).toString(16).substring(1);
  }
  return S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4();
};
export {
  storage as s,
  uuid as u
};
