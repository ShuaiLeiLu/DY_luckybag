import { E as EventBus, w as webviewCookieToHeaderCookie } from "./chunk-CLAzpZwU.js";
import { u as uuid } from "./chunk-B1D7y5qx.js";
const prizeType = {
  1: "钻石",
  2: "抖币",
  3: "实物",
  4: "优惠券"
};
class Lottery {
  /**
   * 构造函数 - 初始化Lottery实例
   * @param {Object} account - 账号信息对象
   * @param {Map} roomAssignment - 直播间分配信息
   * @param {Object} config - 配置对象
   */
  constructor(account, roomAssignment, config) {
    this.roomAssignment = roomAssignment || /* @__PURE__ */ new Map();
    this.config = config || {};
    this.lotteryTimer = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryDelay = 200;
    this.pauseJoinLottery = false;
    this.lastWinLotteryId = null;
    queueMicrotask(async () => {
      try {
        await this.init(account);
      } catch (error) {
        this.handleCriticalError("初始化失败", error);
      }
    });
  }
  /**
   * 初始化账号信息和属性
   * @param {Object} account - 账号信息对象
   * @returns {Promise<void>}
   * @throws {Error} 当账号信息无效时抛出错误
   */
  init = async (account) => {
    if (!this.validateAccount(account)) {
      throw new Error("账号信息不完整或无效");
    }
    this.account = account;
    this.account.state = "opened";
    this.account.startTime = Date.now();
    this.initializeAccountProperties();
    this.updateStatus();
    await new Promise((resolve) => setTimeout(resolve, 2e3));
    void this.pageEvent();
  };
  /**
   * 启动福袋参与流程
   *
   * 该方法是Lottery类的核心方法，负责：
   * 1. 检查账号状态
   * 2. 选择合适的福袋
   * 3. 进入直播间
   * 4. 参与福袋
   * 5. 处理异常情况和重试逻辑
   *
   * @returns {Promise<void>}
   */
  start = async () => {
    try {
      this.account.state = "running";
      if (this.lotteryTimer) {
        clearTimeout(this.lotteryTimer);
        this.lotteryTimer = null;
      }
      if (this.pauseJoinLottery) {
        this.account.state = "paused";
        return;
      }
      if (!globalThis.douyinLotteryManager.taskMap.has(this.account.webContentsId)) {
        return;
      }
      this.retryCount = 0;
      if (this.config?.participationCount?.enabled) {
        if (this.account.participationCount >= this.config.participationCount.value) {
          this.account.state = "closed";
          this.account.status = "超过最大参与次数，运行结束";
          this.updateStatus();
          try {
            if (this.config?.chromeBrowser?.enabled) {
              await globalThis.chrome.playwright.browser.closeBrowser({
                id: this.account.webContentsId
              });
            } else {
              if (this.account.windowId && globalThis.chrome.windows?.remove) {
                await globalThis.chrome.windows.remove(this.account.windowId);
              }
            }
          } catch (error) {
            this.logError("窗口关闭失败", error);
          }
          return;
        }
      }
      if (this.config && this.config.singleAccountDuration?.enabled) {
        if (this.account.startTime + this.config.singleAccountDuration.value * 60 * 60 * 1e3 < Date.now()) {
          this.account.state = "closed";
          this.account.status = "超过单号设定时长，运行结束";
          this.updateStatus();
          try {
            if (this.config?.chromeBrowser?.enabled) {
              await globalThis.chrome.playwright.browser.closeBrowser({
                id: this.account.webContentsId
              });
            } else {
              if (this.account.windowId && globalThis.chrome.windows?.remove) {
                await globalThis.chrome.windows.remove(this.account.windowId);
              }
            }
          } catch (error) {
            this.logError("窗口关闭失败", error);
          }
          return;
        }
      }
      const lotteryInfo = this.selectLotteryInfo();
      if (!lotteryInfo) {
        this.account.state = "waiting";
        if (globalThis.douyinLotteryManager && !globalThis.douyinLotteryManager.liveRoomManager.collectLoading) {
          globalThis.douyinLotteryManager.startCollect();
        }
        return;
      }
      if (lotteryInfo.end_time < Date.now() / 1e3) {
        return this.start();
      }
      this.account.state = "running";
      this.account.status = `准备前往${lotteryInfo.webRid}直播间`;
      this.account.countdown = null;
      this.updateStatus();
      const result = await globalThis.chrome.playwright.page.goto(
        this.account.webContentsId,
        `https://live.douyin.com/${lotteryInfo.webRid}`,
        { timeout: 0 }
        // 无超时
      );
      if (!result.success) {
        this.account.state = "paused";
        this.account.status = "连接超时，已暂停福袋参与";
        this.account.currentRoom = null;
        this.updateStatus();
        return;
      }
      this.account.status = "等待福袋出现";
      this.account.currentRoom = lotteryInfo.authorNickname + "(" + lotteryInfo.webRid + ")";
      this.updateStatus();
      await this.withErrorHandling(
        async () => {
          const result2 = await globalThis.chrome.playwright.page.locator.waitFor(
            this.account.webContentsId,
            ".dVxrjT_h",
            { timeout: 2e4 }
            // 20秒超时
          );
          if (!result2?.success) {
            throw new Error("福袋元素未找到");
          }
          await globalThis.chrome.playwright.page.locator.click(
            this.account.webContentsId,
            ".dVxrjT_h"
          );
        },
        "等待福袋出现失败",
        2
      );
      if (this.config?.secondInspect?.enabled) {
        await new Promise((resolve) => setTimeout(resolve, 2e3));
        await new Promise((resolve, reject) => {
          const timeoutTimer = setTimeout(() => {
            reject(new Error("检查二次概率等待10秒超时"));
          }, 1e4);
          this.secondInspectProbability(lotteryInfo).then((flag) => {
            if (flag) {
              clearTimeout(timeoutTimer);
              resolve();
            } else {
              reject(new Error("二次检查概率不满足"));
            }
          });
        });
      }
      await this.withErrorHandling(
        async () => {
          await globalThis.chrome.playwright.page.locator.click(
            this.account.webContentsId,
            '#lottery_close_cotainer div[role="button"]',
            { timeout: 1e4 }
          );
        },
        "点击参与福袋失败",
        1
      );
      const remainingTime = lotteryInfo.end_time - Date.now() / 1e3;
      this.account.status = "福袋参与成功，等待开奖";
      this.account.countdown = Math.floor(remainingTime);
      this.account.participationCount++;
      this.updateStatus();
      if (this.config?.enableRedPacket?.enabled) {
        await this.joinRedPacket();
      }
      await this.optimizeLiveExperience();
      await this.withErrorHandling(
        async () => {
          await globalThis.chrome.playwright.page.locator.click(
            this.account.webContentsId,
            ".dVxrjT_h",
            { timeout: 5e3 }
          );
        },
        "检查确认参与福袋失败",
        1
      );
      const totalWaitTime = Math.max(1e3, (remainingTime + 30) * 1e3);
      this.lotteryTimer = setTimeout(() => {
        this.start();
      }, totalWaitTime);
    } catch (error) {
      this.logError("福袋参与流程失败", error);
      if (this.lotteryTimer) {
        clearTimeout(this.lotteryTimer);
        this.lotteryTimer = null;
      }
      setTimeout(() => this.start(), 3e3);
    }
  };
  /**
   * 抢红包
   */
  joinRedPacket = async () => {
    try {
      const result = await globalThis.chrome.playwright.page.locator.waitFor(
        this.account.webContentsId,
        ".redpacket-short-touch",
        { timeout: 5e3 }
        // 5秒超时
      );
      if (!result?.success) {
        return;
      }
      await globalThis.chrome.playwright.page.evaluate(
        this.account.webContentsId,
        "(() => document.querySelector('.redpacket iframe').contentWindow.document.querySelector('lynx-view').shadowRoot.querySelector('.re-leftPart').click())()"
      );
      await new Promise((resolve) => setTimeout(resolve, 2e3));
      await globalThis.chrome.playwright.page.evaluate(
        this.account.webContentsId,
        `(() => {
          // 找到所有红包的dom节点列表
          const redPacketDomList = document.querySelector('#short_touch_land_redpacket_land iframe').contentWindow.document.querySelector('lynx-view').shadowRoot.querySelectorAll('lynx-wrapper > x-view')
          redPacketDomList.forEach(item => {
            const canJoin = item.querySelector('raw-text[text="0"]')?.closest('.scale_container')?.querySelector('.snatch_button_icon_container_exp')
            canJoin && canJoin.click()
          })
        })()`
      );
    } catch (error) {
    }
  };
  /**
   * 暂停福袋抢取流程
   */
  pause = async () => {
    if (this.lotteryTimer) {
      clearTimeout(this.lotteryTimer);
      this.lotteryTimer = null;
    }
    this.pauseJoinLottery = true;
    await this.withErrorHandling(async () => {
      const result = await globalThis.chrome.playwright.page.goto(
        this.account.webContentsId,
        "https://www.douyin.com/user/self"
      );
      if (!result?.success) {
        throw new Error("前往页面失败");
      }
    }, "导航到我的页面失败");
    this.account.state = "paused";
    this.account.status = "福袋参与已暂停";
    this.account.countdown = null;
    this.account.currentRoom = "";
    this.updateStatus();
  };
  /**
   * 停止福袋参与流程
   *
   * 清理资源、定时器和监听器，将账号状态设置为空闲
   *
   * @returns {Promise<void>}
   */
  stop = async () => {
    try {
      if (this.lotteryTimer) {
        clearTimeout(this.lotteryTimer);
        this.lotteryTimer = null;
      }
      if (this.config?.chromeBrowser?.enabled) {
        await globalThis.chrome.playwright.browser.closeBrowser({
          id: this.account.windowId
        });
      } else {
        await globalThis.chrome.windows.remove(this.account.windowId);
      }
      this.account.state = "closed";
      this.account.status = "浏览器已关闭 ❌";
      this.account.currentRoom = null;
      this.account.countdown = null;
      this.account.windowId = null;
      this.account.webContentsId = null;
      this.updateStatus();
    } catch (error) {
    }
  };
  /**
   * 验证账号参数是否有效
   */
  validateAccount = (account) => {
    if (!account || typeof account !== "object") {
      return false;
    }
    const requiredProperties = ["nickName", "accountCode", "webContentsId"];
    const missingProperties = requiredProperties.filter((prop) => !account[prop]);
    if (missingProperties.length > 0) {
      return false;
    }
    return true;
  };
  /**
   * 初始化账号必要属性
   */
  initializeAccountProperties = () => {
    if (!this.account.state) this.account.state = "waiting";
    if (!this.account.status) this.account.status = "等待开始";
    if (!this.account.startTime) this.account.startTime = Date.now();
    if (typeof this.account.totalDiamonds !== "number") this.account.totalDiamonds = 0;
    if (typeof this.account.redPacketTotalDiamonds !== "number")
      this.account.redPacketTotalDiamonds = 0;
    if (typeof this.account.winningDiamond !== "number") this.account.winningDiamond = 0;
    if (typeof this.account.walletDiamonds !== "number") this.account.walletDiamonds = 0;
    if (typeof this.account.participationCount !== "number") this.account.participationCount = 0;
    if (typeof this.account.winningCount !== "number") this.account.winningCount = 0;
    if (typeof this.account.redPacketWinningCount !== "number")
      this.account.redPacketWinningCount = 0;
    if (!this.account.countdown) this.account.countdown = null;
  };
  /**
   * 验证配置项是否有效
   */
  validateConfig = (config) => {
    if (!config || typeof config !== "object") {
      return false;
    }
    if (config.singleAccountDuration?.enabled) {
      if (typeof config.singleAccountDuration.value !== "number" || config.singleAccountDuration.value <= 0) {
        return false;
      }
    }
    if (config.filterOnline?.enabled) {
      if (typeof config.filterOnline.value !== "number" || config.filterOnline.value <= 0) {
        return false;
      }
    }
    if (config.allowMultipleAccount?.enabled) {
      if (typeof config.allowMultipleAccount.value !== "number" || config.allowMultipleAccount.value <= 0) {
        return false;
      }
    }
    if (config.singleAccountDuration?.enabled) {
      if (typeof config.singleAccountDuration.value !== "number" || config.singleAccountDuration.value <= 0) {
        return false;
      }
    }
    if (config.stayDuration?.enabled) {
      if (typeof config.stayDuration.value !== "number" || config.stayDuration.value < 0) {
        return false;
      }
    }
    if (config.hitRate?.enabled) {
      if (typeof config.hitRate.value !== "number" || config.hitRate.value < 0.01 || config.hitRate.value >= 1) {
        return false;
      }
    }
    return true;
  };
  /**
   * 增强的错误处理包装函数
   */
  /**
   * 错误处理包装函数
   *
   * 为异步操作提供统一的错误处理和重试机制
   *
   * @param {Function} fn - 要执行的异步函数
   * @param {string} errorMessage - 错误提示信息
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<any>} 函数执行结果
   * @throws {Error} 当所有重试都失败时抛出错误
   */
  withErrorHandling = async (fn, errorMessage = "操作失败", maxRetries = this.maxRetries) => {
    this.retryCount = 0;
    while (this.retryCount < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        this.retryCount++;
        this.logError(errorMessage, error);
        if (this.retryCount >= maxRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * this.retryCount));
      }
    }
  };
  /**
   * 记录错误日志
   */
  logError = (message, error) => {
    const errorData = {
      accountCode: this.account.accountCode,
      nickName: this.account.nickName,
      message,
      error: error?.message || String(error),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    EventBus.emit("error-log", JSON.parse(JSON.stringify(errorData)));
  };
  /**
   * 处理严重错误，导致账号停止运行
   */
  handleCriticalError = async (message, error) => {
    this.logError(message, error);
    if (this.account) {
      this.account.state = "error";
      this.account.status = `错误: ${message}`;
      this.updateStatus();
      await this.stop();
    }
  };
  /**
   * 更新账号状态并通过EventBus发送通知
   *
   * 该方法将账号的最新状态序列化后发送给外部组件
   *
   * @returns {void}
   */
  updateStatus = () => {
    const payload = {
      type: "status",
      data: this.account
    };
    chrome.runtime.sendMessage({
      type: "notice",
      data: JSON.parse(JSON.stringify(payload))
    });
  };
  /**
   * 更新日志
   * @param {string} message - 日志信息
   */
  updateLog = (message) => {
    const payload = {
      type: "log",
      data: message
    };
    chrome.runtime.sendMessage({
      type: "notice",
      data: JSON.parse(JSON.stringify(payload))
    });
  };
  /**
   * 处理网络响应
   */
  handleResponse = async (data) => {
    if (!data || typeof data !== "string") {
      this.logError("无效的响应数据", new Error("响应数据必须是非空字符串"));
      return;
    }
    let response;
    try {
      response = JSON.parse(data);
    } catch (error) {
      this.logError("解析响应数据失败", error);
      return;
    }
    if (!response || !response.url) {
      this.logError("无效的响应对象", new Error("响应对象缺少url属性"));
      return;
    }
    const url = response.url;
    try {
      if (url.includes("webcast/lottery/melon/check_user_right")) {
        await this.handleLotteryResponse(response);
      } else if (url.includes("/webcast/wallet/info/")) {
        await this.handleWalletResponse(response);
      } else if (url.includes("webcast/luckybox/receive/")) {
        await this.handleRedPacketResponse(response);
      }
    } catch (error) {
      this.logError("处理响应时发生错误", error);
    }
  };
  /**
   * 处理钱包信息响应
   */
  handleWalletResponse = async (response) => {
    try {
      const res = response.json;
      if (res?.data?.diamond !== void 0) {
        this.account.walletDiamonds = res.data.diamond;
        this.updateStatus();
      }
    } catch (error) {
      this.logError("处理钱包信息失败", error);
    }
  };
  /**
   * 处理福袋响应
   */
  handleLotteryResponse = async (response) => {
    const res = response.json;
    if (!res?.data || !res.data.lottery_info) {
      return;
    }
    if (res.data.lottery_info.status === 1) {
      await this.handleActiveLottery(res);
    } else if (res.data.lottery_info.status === 2) {
      await this.handleLotteryResult(res);
    }
  };
  /**
   * 处理红包中奖响应
   */
  handleRedPacketResponse = async (response) => {
    try {
      const res = response.json;
      if (res?.data?.receive_info) {
        res?.data?.receive_info.forEach((item) => {
          if (item.succeed) {
            if (item.gift_name === "") {
              chrome.runtime.sendMessage({
                type: "notice",
                data: JSON.parse(
                  JSON.stringify({
                    type: "winning-notice",
                    data: `🎉【${this.account.nickName}】红包中奖，中奖物品：钻石，价值: ${item.diamond_count}`
                  })
                )
              });
            } else {
              chrome.runtime.sendMessage({
                type: "notice",
                data: JSON.parse(
                  JSON.stringify({
                    type: "winning-notice",
                    data: `🎉【${this.account.nickName}】红包中奖，中奖物品：${item.gift_name}，价值: ${item.diamond_count}`
                  })
                )
              });
            }
            this.account.redPacketTotalDiamonds += item.diamond_count;
            this.account.redPacketWinningCount++;
            this.updateStatus();
          }
        });
      }
    } catch (error) {
    }
  };
  /**
   * 二次检查福袋概率是否符合条件
   */
  secondInspectProbability = async (lotteryInfo) => {
    try {
      const { joinTotal, winningTotal } = lotteryInfo;
      const calculatedProbability = winningTotal / joinTotal;
      return calculatedProbability >= this.config?.secondInspect?.value;
    } catch (error) {
      this.logError("检查福袋概率失败", error);
      return false;
    }
  };
  /**
   * 处理未开奖的福袋
   */
  handleActiveLottery = async (res) => {
    try {
      const roomId = res.data.lottery_info.room_id_str;
      const lotteryInfo = globalThis.douyinLotteryManager.liveRoomManager.lotteryInfoList.find(
        (item) => item.roomId == roomId
      );
      if (lotteryInfo) {
        if (res.data.candidate_user_num !== void 0) {
          lotteryInfo.joinTotal = res.data.candidate_user_num;
          globalThis.douyinLotteryManager.liveRoomManager.updateCollectLottery();
        }
      }
    } catch (error) {
      this.logError("处理未开奖福袋信息失败", error);
    }
  };
  /**
   * 处理福袋开奖结果
   */
  handleLotteryResult = async (res) => {
    try {
      if (Object.prototype.hasOwnProperty.call(res.data, "user_lucky_info")) {
        await this.handleWinningResult(res);
      } else {
      }
      await this.handlePostLotteryStay();
      setTimeout(() => this.start(), 1e3);
    } catch (error) {
      this.logError("处理福袋开奖结果失败", error);
      setTimeout(() => this.start(), 3e3);
    }
  };
  /**
   * 处理中奖结果
   */
  handleWinningResult = async (res) => {
    try {
      const user_lucky_info = res.data.user_lucky_info;
      const lotteryId = res.data.lottery_info.lottery_id_str;
      const prizeName = prizeType[user_lucky_info.prize_type] || "未知奖品";
      if (this.lastWinLotteryId === lotteryId) {
        return;
      }
      this.lastWinLotteryId = lotteryId;
      this.account.winningCount++;
      this.account.winningDiamond = user_lucky_info.grant_count;
      this.account.totalDiamonds += user_lucky_info.grant_count;
      if (!this.account.winningHistory) {
        this.account.winningHistory = [];
      }
      this.account.winningHistory.push({
        prizeName,
        count: user_lucky_info.grant_count,
        timestamp: Date.now(),
        roomId: res.data.lottery_info.room_id_str,
        roomName: res.data.lottery_info.anchor_name || ""
      });
      chrome.runtime.sendMessage({
        type: "notice",
        data: JSON.parse(
          JSON.stringify({
            type: "winning-notice",
            data: `🎉【${this.account.nickName}】已中奖，中奖物品【${prizeName}】中奖数量: ${user_lucky_info.grant_count}`
          })
        )
      });
      this.updateStatus();
    } catch (error) {
      this.logError("处理中奖结果失败", error);
    }
  };
  /**
   * 处理福袋后停留逻辑
   */
  handlePostLotteryStay = async () => {
    if (this.config?.stayDuration?.enabled && this.config.stayDuration.value > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.stayDuration.value * 1e3));
    }
  };
  /**
   * 验证单个福袋信息是否有效
   */
  validateLotteryItem = (item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const requiredProperties = ["roomId", "webRid", "end_time"];
    for (const prop of requiredProperties) {
      if (!item[prop]) {
        return false;
      }
    }
    return true;
  };
  /**
   * 增强直播观看体验
   *
   * 优化直播间界面，隐藏不必要的元素，提升抢福袋的效率
   * 包括关闭广告、隐藏聊天窗口、调整界面布局等操作
   *
   * @returns {Promise<void>}
   */
  optimizeLiveExperience = async () => {
    if (!this.account?.webContentsId) {
      return;
    }
    try {
      await this.withErrorHandling(
        async () => {
          await globalThis.chrome.playwright.page.evaluate(
            this.account.webContentsId,
            `
            (() => {
              try {
                  // 设置清晰度
                  const qualitySelectorDom = document.querySelector('div[data-e2e="quality-selector"]')
                  if (qualitySelectorDom && qualitySelectorDom.lastChild && qualitySelectorDom.lastChild.firstChild) {
                      if (!qualitySelectorDom.lastChild.firstChild.style.background) {
                          qualitySelectorDom.lastChild.click()
                      }
                  }
                  
                  // 屏蔽礼物特效
                  const effectSwitchDom = document.querySelector('div[data-e2e="effect-switch"]')
                  if (effectSwitchDom && effectSwitchDom.previousElementSibling) {
                      if (effectSwitchDom.previousElementSibling.textContent === '屏蔽礼物特效') {
                          effectSwitchDom.click()
                      }
                  }
              } catch (error) {
                  console.log("优化直播体验报错：", error)
              }
            })()
          `,
            { timeout: 5e3 }
          );
          await globalThis.chrome.playwright.page.keyboard.press(this.account.webContentsId, "B");
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        },
        "优化直播体验失败",
        1
      );
    } catch (error) {
    }
  };
  /**
   * 设置页面事件监听器
   */
  pageEvent = async () => {
    if (!this.account?.webContentsId) {
      return;
    }
    try {
      if (globalThis.chrome.playwright.page.addListener) {
        const res = await globalThis.chrome.playwright.page.addListener(
          this.account.webContentsId,
          "response"
        );
      }
    } catch (error) {
      this.logError("添加页面事件监听器失败", error);
    }
  };
  // /**
  //  * 移除页面事件监听器
  //  */
  // async removePageListeners() {
  //   try {
  //     if (globalThis.chrome?.playwright?.page?.removeListener && this.account?.webContentsId) {
  //       await globalThis.chrome.playwright.page.removeListener(
  //         this.account.webContentsId,
  //         'response',
  //         this.handleResponse.bind(this),
  //       )
  //     }
  //   } catch (error) {
  //     // 移除失败不应该阻止程序继续运行
  //     console.warn(`【${this.account.nickName}】移除事件监听器失败:`, error)
  //   }
  // }
  // ============================================== 以下代码未使用 =================================================
  /**
   * 加载保存的配置 未使用
   * 从Chrome存储中加载之前保存的配置并应用到当前实例
   */
  loadConfig = async () => {
    try {
      const result = await chrome.storage.local.get(`lottery_config_${this.account.userId}`);
      const savedConfig = result[`lottery_config_${this.account.userId}`];
      if (savedConfig && typeof savedConfig === "object") {
        this.config = { ...this.config, ...savedConfig };
        return true;
      }
      return false;
    } catch (error) {
      this.logError("加载配置失败", error);
      return false;
    }
  };
  /**
   * 保存配置到Chrome存储 未使用
   * @param {Object} configToSave - 要保存的配置对象（可选，默认保存当前配置）
   */
  saveConfig = async (configToSave = null) => {
    try {
      const config = configToSave || this.filterConfigForSaving(this.config);
      if (!config || typeof config !== "object") {
        return false;
      }
      await chrome.storage.local.set({
        [`lottery_config_${this.account.userId}`]: config
      });
      return true;
    } catch (error) {
      this.logError("保存配置失败", error);
      return false;
    }
  };
  /**
   * 过滤配置，只保留需要持久化的属性 未使用
   * @param {Object} config - 原始配置对象
   * @returns {Object} 过滤后的配置对象
   */
  filterConfigForSaving = (config) => {
    if (!config || typeof config !== "object") {
      return {};
    }
    const allowedFields = {
      duration: true,
      probability: true,
      multiAccount: true,
      hitRate: true,
      stayDuration: true
    };
    const filteredConfig = {};
    Object.keys(config).forEach((key) => {
      if (allowedFields[key] && config[key] !== void 0) {
        filteredConfig[key] = config[key];
      }
    });
    return filteredConfig;
  };
  /**
   * 更新配置并保存 未使用
   * @param {Object} newConfig - 新的配置对象
   * @returns {Boolean} 更新是否成功
   */
  updateConfig = async (newConfig) => {
    try {
      if (!newConfig || typeof newConfig !== "object") {
        return false;
      }
      this.config = { ...this.config, ...newConfig };
      return await this.saveConfig();
    } catch (error) {
      this.logError("更新配置失败", error);
      return false;
    }
  };
  /**
   * 清除保存的配置 未使用
   * @returns {Boolean} 清除是否成功
   */
  clearConfig = async () => {
    try {
      await chrome.storage.local.remove(`lottery_config_${this.account.userId}`);
      return true;
    } catch (error) {
      this.logError("清除配置失败", error);
      return false;
    }
  };
  /**
   * 记录福袋领取尝试 未使用
   * @param {Object} lotteryInfo - 福袋信息
   * @param {string} roomId - 直播间ID
   * @returns {string} 跟踪ID
   */
  recordLotteryAttempt = (lotteryInfo, roomId) => {
    try {
      const trackId = `${lotteryInfo.lottery_id || Date.now()}_${Date.now()}`;
      const record = {
        trackId,
        lotteryId: lotteryInfo.lottery_id || Date.now().toString(),
        roomId,
        status: "attempted",
        attemptTime: Date.now(),
        resultTime: null,
        result: null,
        error: null,
        roomInfo: {
          roomId,
          anchorName: lotteryInfo.anchor_name || "",
          roomTitle: lotteryInfo.room_title || ""
        },
        prizeInfo: {
          prizeName: lotteryInfo.prize_name || "",
          prizeType: lotteryInfo.prize_type,
          prizeCount: lotteryInfo.prize_count
        }
      };
      if (!this.lotteryStatusTracker) {
        this.lotteryStatusTracker = {
          byLotteryId: /* @__PURE__ */ new Map(),
          byRoomId: /* @__PURE__ */ new Map(),
          statistics: {
            totalAttempts: 0,
            successfulClaims: 0,
            failedClaims: 0,
            pendingClaims: 0,
            totalWins: 0,
            prizeValues: {},
            winRate: 0
          }
        };
      }
      this.lotteryStatusTracker.byLotteryId.set(trackId, record);
      if (!this.lotteryStatusTracker.byRoomId.has(roomId)) {
        this.lotteryStatusTracker.byRoomId.set(roomId, []);
      }
      this.lotteryStatusTracker.byRoomId.get(roomId).push(record);
      this.lotteryStatusTracker.statistics.totalAttempts++;
      this.lotteryStatusTracker.statistics.pendingClaims++;
      return trackId;
    } catch (error) {
      this.logError("记录福袋尝试失败", error);
      return null;
    }
  };
  /**
   * 更新福袋状态 未使用
   * @param {string} trackId - 跟踪ID
   * @param {string} status - 新状态
   * @param {Object} [data={}] - 附加数据
   */
  updateLotteryStatus = (trackId, status, data = {}) => {
    try {
      if (!this.lotteryStatusTracker) return;
      const record = this.lotteryStatusTracker.byLotteryId.get(trackId);
      if (!record) return;
      const oldStatus = record.status;
      record.status = status;
      if (oldStatus === "attempted" && status === "success") {
        this.lotteryStatusTracker.statistics.successfulClaims++;
        this.lotteryStatusTracker.statistics.pendingClaims--;
      } else if (oldStatus === "attempted" && status === "failed") {
        this.lotteryStatusTracker.statistics.failedClaims++;
        this.lotteryStatusTracker.statistics.pendingClaims--;
        if (data.error) {
          record.error = data.error;
        }
      }
      Object.assign(record, data);
      if (!record.resultTime && (status === "success" || status === "failed" || status === "won" || status === "lost")) {
        record.resultTime = Date.now();
      }
      this.calculateStatistics();
      EventBus.emit("lotteryStatusUpdate", {
        trackId,
        status,
        record
      });
    } catch (error) {
      this.logError("更新福袋状态失败", error);
    }
  };
  /**
   * 记录福袋结果 未使用
   * @param {string} trackId - 跟踪ID
   * @param {boolean} won - 是否中奖
   * @param {Object} [prizeInfo={}] - 奖品信息
   */
  recordLotteryResult = (trackId, won, prizeInfo = {}) => {
    try {
      if (!this.lotteryStatusTracker) return;
      const record = this.lotteryStatusTracker.byLotteryId.get(trackId);
      if (!record) return;
      const result = {
        won,
        prizeInfo,
        timestamp: Date.now()
      };
      record.result = result;
      record.status = won ? "won" : "lost";
      record.resultTime = Date.now();
      if (won) {
        this.lotteryStatusTracker.statistics.totalWins++;
        const prizeType2 = prizeInfo.type || "unknown";
        if (!this.lotteryStatusTracker.statistics.prizeValues[prizeType2]) {
          this.lotteryStatusTracker.statistics.prizeValues[prizeType2] = 0;
        }
        this.lotteryStatusTracker.statistics.prizeValues[prizeType2]++;
      }
      if (record.status === "attempted") {
        this.lotteryStatusTracker.statistics.pendingClaims--;
      }
      this.calculateStatistics();
      EventBus.emit("lotteryResult", {
        trackId,
        won,
        prizeInfo,
        record
      });
    } catch (error) {
      this.logError("记录福袋结果失败", error);
    }
  };
  /**
   * 计算统计信息 未使用
   */
  calculateStatistics = () => {
    try {
      if (!this.lotteryStatusTracker) return;
      const stats = this.lotteryStatusTracker.statistics;
      const completed = stats.successfulClaims + stats.failedClaims + stats.totalWins;
      if (completed > 0) {
        stats.winRate = (stats.totalWins / completed * 100).toFixed(2);
      } else {
        stats.winRate = 0;
      }
      stats.summary = {
        todayAttempts: this.getTodayAttempts(),
        todayWins: this.getTodayWins(),
        bestPrize: this.getBestPrize(),
        activeRooms: this.getActiveRoomsCount()
      };
    } catch (error) {
      this.logError("计算统计信息失败", error);
    }
  };
  /**
   * 获取今日尝试次数 未使用
   * @returns {number} 今日尝试次数
   */
  getTodayAttempts = () => {
    if (!this.lotteryStatusTracker) return 0;
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    let count = 0;
    for (const record of this.lotteryStatusTracker.byLotteryId.values()) {
      if (record.attemptTime >= todayTime) {
        count++;
      }
    }
    return count;
  };
  /**
   * 获取今日中奖次数 未使用
   * @returns {number} 今日中奖次数
   */
  getTodayWins = () => {
    if (!this.lotteryStatusTracker) return 0;
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    let count = 0;
    for (const record of this.lotteryStatusTracker.byLotteryId.values()) {
      if (record.result && record.result.won && record.resultTime >= todayTime) {
        count++;
      }
    }
    return count;
  };
  /**
   * 获取最佳奖品 未使用
   * @returns {Object} 最佳奖品信息
   */
  getBestPrize = () => {
    if (!this.lotteryStatusTracker) return null;
    let bestPrize = null;
    let highestValue = -1;
    for (const record of this.lotteryStatusTracker.byLotteryId.values()) {
      if (record.result && record.result.won && record.result.prizeInfo) {
        const prizeValue = this.estimatePrizeValue ? this.estimatePrizeValue(record.result.prizeInfo) : 0;
        if (prizeValue > highestValue) {
          highestValue = prizeValue;
          bestPrize = {
            ...record.result.prizeInfo,
            roomInfo: record.roomInfo,
            timestamp: record.resultTime
          };
        }
      }
    }
    return bestPrize;
  };
  /**
   * 获取活跃直播间数量 未使用
   * @returns {number} 活跃直播间数量
   */
  getActiveRoomsCount = () => {
    if (!this.lotteryStatusTracker) return 0;
    const activeRooms = /* @__PURE__ */ new Set();
    const oneHourAgo = Date.now() - 60 * 60 * 1e3;
    for (const record of this.lotteryStatusTracker.byLotteryId.values()) {
      if (record.attemptTime >= oneHourAgo) {
        activeRooms.add(record.roomId);
      }
    }
    return activeRooms.size;
  };
  /**
   * 清理过期的福袋记录 未使用
   * @param {number} days - 保留天数
   */
  cleanupOldRecords = (days = 7) => {
    try {
      if (!this.lotteryStatusTracker) return;
      const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1e3;
      const recordsToDelete = [];
      for (const [trackId, record] of this.lotteryStatusTracker.byLotteryId.entries()) {
        if (record.attemptTime < cutoffTime) {
          recordsToDelete.push({ trackId, roomId: record.roomId });
        }
      }
      for (const { trackId, roomId } of recordsToDelete) {
        this.lotteryStatusTracker.byLotteryId.delete(trackId);
        const roomRecords = this.lotteryStatusTracker.byRoomId.get(roomId);
        if (roomRecords) {
          const index = roomRecords.findIndex((r) => r.trackId === trackId);
          if (index > -1) {
            roomRecords.splice(index, 1);
          }
          if (roomRecords.length === 0) {
            this.lotteryStatusTracker.byRoomId.delete(roomId);
          }
        }
      }
      this.recalculateAllStatistics();
      this.logError(`清理了 ${recordsToDelete.length} 条过期记录`, null, true);
    } catch (error) {
      this.logError("清理过期记录失败", error);
    }
  };
  /**
   * 重新计算所有统计信息 未使用
   */
  recalculateAllStatistics = () => {
    if (!this.lotteryStatusTracker) return;
    const stats = this.lotteryStatusTracker.statistics;
    stats.totalAttempts = 0;
    stats.successfulClaims = 0;
    stats.failedClaims = 0;
    stats.pendingClaims = 0;
    stats.totalWins = 0;
    stats.prizeValues = {};
    for (const record of this.lotteryStatusTracker.byLotteryId.values()) {
      stats.totalAttempts++;
      switch (record.status) {
        case "attempted":
          stats.pendingClaims++;
          break;
        case "success":
          stats.successfulClaims++;
          break;
        case "failed":
          stats.failedClaims++;
          break;
        case "won":
          stats.totalWins++;
          if (record.result && record.result.prizeInfo) {
            const prizeType2 = record.result.prizeInfo.type || "unknown";
            if (!stats.prizeValues[prizeType2]) {
              stats.prizeValues[prizeType2] = 0;
            }
            stats.prizeValues[prizeType2]++;
          }
          break;
      }
    }
    this.calculateStatistics();
  };
  /**
   * 选择合适的福袋信息
   *
   * 智能福袋选择算法，综合考虑多种因素计算福袋得分，选择最优福袋
   * 考虑因素包括：中奖概率、剩余时间、奖品价值、参与人数、直播间人气等
   *
   * @returns {Object|null} 选中的福袋信息对象，无合适福袋时返回null
   */
  selectLotteryInfo = () => {
    if (!Array.isArray(globalThis.douyinLotteryManager.liveRoomManager.lotteryInfoList)) {
      return null;
    }
    let validLotteries = globalThis.douyinLotteryManager.liveRoomManager.lotteryInfoList.filter(
      (item) => item && typeof item.end_time === "number" && item.end_time - 15 >= Date.now() / 1e3 && this.validateLotteryItem(item)
    );
    if (this.config?.hitRate?.enabled && validLotteries.length > 0) {
      validLotteries = validLotteries.map((item) => {
        const { finalPeople, probability } = this.calculateLuckyProbability(
          item.joinTotal,
          // 当前参与人数
          item.winningTotal,
          // 福袋中奖个数
          item.end_time - item.start_time,
          // 福袋总时长（秒）
          item.end_time - Date.now() / 1e3,
          // 福袋剩余时长（秒）
          item.onlineTotal
          // 当前在线人数
        );
        return {
          ...item,
          probability,
          finalPeople
        };
      }).filter((item) => item.probability >= this.config.hitRate.value);
    }
    if (this.config?.priorityType?.enabled && validLotteries.length > 0) {
      if (this.config.priorityType.value === 1) {
        validLotteries.sort((a, b) => {
          const priorityA = a.probability || 0;
          const priorityB = b.probability || 0;
          return priorityB - priorityA;
        });
      } else if (this.config.priorityType.value === 2) {
        validLotteries.sort((a, b) => {
          const valueA = a.lotteryTotal;
          const valueB = b.lotteryTotal;
          return valueB - valueA;
        });
      }
    }
    if (validLotteries.length === 0) {
      return null;
    }
    for (const lottery of validLotteries) {
      const assignedAccounts = this.roomAssignment.get(lottery.roomId) || [];
      const isAllowedMultiple = this.config?.allowMultipleAccount?.enabled && assignedAccounts.length < this.config?.allowMultipleAccount.value;
      if (!this.roomAssignment.has(lottery.roomId) || isAllowedMultiple) {
        if (!this.roomAssignment.has(lottery.roomId)) {
          this.roomAssignment.set(lottery.roomId, [this.account.accountCode]);
          const lotteryItem = globalThis.douyinLotteryManager.liveRoomManager.lotteryInfoList.find(
            (item) => item.roomId === lottery.roomId
          );
          if (lotteryItem) {
            lotteryItem.nickName = this.account.nickName;
          }
        } else {
          assignedAccounts.push(this.account.accountCode);
          this.roomAssignment.set(lottery.roomId, assignedAccounts);
          const lotteryItem = globalThis.douyinLotteryManager.liveRoomManager.lotteryInfoList.find(
            (item) => item.roomId === lottery.roomId
          );
          if (lotteryItem) {
            lotteryItem.nickName = lotteryItem.nickName + `；${this.account.nickName}`;
          }
        }
        return lottery;
      }
    }
    return null;
  };
  /**
   * 计算福袋幸运概率
   * @param {*} currentPeople 当前已参与人数
   * @param {*} bagCount 福袋数量
   * @param {*} totalDuration 总持续时间（秒）
   * @param {*} remainingTime 剩余时间（秒）
   * @param {*} onlinePeople 当前在线人数
   * @returns {Object} { finalPeople: 预测最终人数, probability: 幸运概率（0-1） }
   */
  calculateLuckyProbability = (currentPeople, bagCount, totalDuration, remainingTime, onlinePeople) => {
    if (totalDuration < 60 || remainingTime < 0 || remainingTime > totalDuration || currentPeople < 0 || bagCount <= 0 || onlinePeople < 0) {
      return { finalPeople: 0, probability: 0 };
    }
    const isNearEnd = remainingTime / totalDuration <= 0.2;
    let baseFinalPeople;
    if (isNearEnd) {
      baseFinalPeople = currentPeople;
    } else {
      const elapsedTime = totalDuration - remainingTime;
      const elapsedRatio = elapsedTime / totalDuration;
      const growth = 1 - Math.pow(1 - elapsedRatio, 2);
      const baseRatio = elapsedRatio === 0 ? 0.2 : growth;
      baseFinalPeople = Math.ceil(currentPeople / baseRatio);
    }
    const saturationRate = 0.85;
    const saturationCap = Math.ceil(onlinePeople * saturationRate);
    baseFinalPeople = Math.min(baseFinalPeople, saturationCap);
    let convertRatio = 0;
    if (!isNearEnd) {
      const totalMinutes = totalDuration / 60;
      convertRatio = 0.4 - totalMinutes * 0.01;
      convertRatio = Math.max(0.1, Math.min(convertRatio, 0.35));
      const elapsedTime = totalDuration - remainingTime;
      let stageDecayFactor = 1;
      if (elapsedTime > 3 * 60 && elapsedTime <= 6 * 60) {
        stageDecayFactor = 0.2;
      } else if (elapsedTime > 6 * 60) {
        stageDecayFactor = 0.05;
      }
      convertRatio = convertRatio * stageDecayFactor;
    }
    let potentialNewPeople = 0;
    if (!isNearEnd) {
      const remainingMinutes = remainingTime / 60;
      const timeDecayRatio = remainingTime / totalDuration;
      const maxPotential = currentPeople * 0.5;
      potentialNewPeople = Math.min(
        Math.ceil(onlinePeople * convertRatio * remainingMinutes * timeDecayRatio),
        maxPotential
      );
    }
    const finalPeople = Math.min(
      Math.max(baseFinalPeople + potentialNewPeople, currentPeople),
      saturationCap
    );
    const probability = Math.min(bagCount / finalPeople, 1);
    return {
      finalPeople,
      probability: Number(probability.toFixed(2))
    };
  };
  /**
   * 计算福袋得分
   *
   * 综合考虑多种因素计算福袋的优先级得分
   *
   * @param {Object} lottery - 福袋信息对象
   * @returns {number} 福袋得分，越高越好
   */
  calculateLotteryScore = (lottery) => {
    let score = 0;
    const now = Date.now();
    const endTime = lottery.end_time * 1e3;
    const timeLeft = endTime - now;
    const timeLeftInMinutes = timeLeft / 6e4;
    const timeScore = this.calculateTimeScore(timeLeftInMinutes);
    const probabilityScore = this.calculateProbabilityScore(lottery);
    const prizeScore = 100;
    const roomScore = this.calculateRoomScore(lottery);
    const historyAdjustment = this.calculateHistoryAdjustment(lottery);
    score = timeScore * 0.3 + probabilityScore * 0.4 + prizeScore * 0.2 + roomScore * 0.1 + historyAdjustment;
    return Math.round(score * 100) / 100;
  };
  /**
   * 计算时间因素得分
   *
   * @param {number} timeLeftInMinutes - 剩余时间（分钟）
   * @returns {number} 时间因素得分（0-100）
   */
  calculateTimeScore = (timeLeftInMinutes) => {
    if (timeLeftInMinutes >= 1 && timeLeftInMinutes <= 3) {
      return 100;
    } else if (timeLeftInMinutes >= 0.5 && timeLeftInMinutes < 1 || timeLeftInMinutes > 3 && timeLeftInMinutes <= 5) {
      return 70;
    } else if (timeLeftInMinutes >= 0.25 && timeLeftInMinutes < 0.5 || timeLeftInMinutes > 5 && timeLeftInMinutes <= 10) {
      return 40;
    } else {
      return 20;
    }
  };
  /**
   * 计算中奖概率得分
   *
   * @param {Object} lottery - 福袋信息对象
   * @returns {number} 中奖概率得分（0-100）
   */
  calculateProbabilityScore = (lottery) => {
    const joinTotal = lottery.joinTotal || 0;
    const estimatedWinners = lottery.winningTotal || 0;
    if (joinTotal === 0) {
      return 50;
    }
    const probability = estimatedWinners / joinTotal;
    let score;
    if (probability >= 0.1) {
      score = 100;
    } else if (probability >= 0.05) {
      score = 80;
    } else if (probability >= 0.01) {
      score = 60;
    } else if (probability >= 1e-3) {
      score = 40;
    } else {
      score = Math.min(20, probability * 1e4);
    }
    return score;
  };
  /**
   * 计算奖品价值得分
   *
   * @param {Object} lottery - 福袋信息对象
   * @returns {number} 奖品价值得分（0-100）
   */
  calculatePrizeScore = (lottery) => {
    const prizeValue = this.estimatePrizeValue(lottery);
    if (prizeValue >= 1e3) {
      return 100;
    } else if (prizeValue >= 500) {
      return 80;
    } else if (prizeValue >= 100) {
      return 60;
    } else if (prizeValue > 0) {
      return 40;
    } else {
      return 20;
    }
  };
  /**
   * 估算奖品价值
   *
   * @param {Object} lottery - 福袋信息对象
   * @returns {number} 估计的奖品价值分数
   */
  estimatePrizeValue = (lottery) => {
    let value = 50;
    if (lottery.desc) {
      const desc = lottery.desc.toLowerCase();
      const highValueKeywords = ["现金", "红包", "高价值", "大奖", "iPhone", "手机"];
      const mediumValueKeywords = ["抖币", "钻石", "优惠券", "折扣"];
      if (highValueKeywords.some((keyword) => desc.includes(keyword))) {
        value = 800;
      } else if (mediumValueKeywords.some((keyword) => desc.includes(keyword))) {
        value = 300;
      } else {
        value = 100;
      }
    }
    if (this.account?.preferredRooms) {
      for (const preferred of this.account.preferredRooms) {
        if (lottery.roomId === preferred.roomId || lottery.anchor_info && lottery.anchor_info.nickname && lottery.anchor_info.nickname.includes(preferred.name)) {
          value *= 1.5;
          break;
        }
      }
    }
    return value;
  };
  /**
   * 计算直播间质量得分
   *
   * @param {Object} lottery - 福袋信息对象
   * @returns {number} 直播间质量得分（0-100）
   */
  calculateRoomScore = (lottery) => {
    let score = 50;
    const userCount = lottery.user_count || 0;
    if (userCount > 5e3) {
      score += 0;
    } else if (userCount > 1e3) {
      score += 10;
    } else if (userCount > 500) {
      score += 20;
    } else if (userCount > 100) {
      score += 30;
    } else if (userCount > 50) {
      score += 40;
    } else if (userCount > 0) {
      score += 50;
    }
    return Math.max(0, Math.min(100, score));
  };
  /**
   * 计算账号历史表现调整值
   *
   * @param {Object} lottery - 福袋信息对象
   * @returns {number} 历史表现调整值
   */
  calculateHistoryAdjustment = (lottery) => {
    let adjustment = 0;
    if (this.account?.winningHistory) {
      const roomHistory = this.account.winningHistory.filter(
        (record) => record.roomId === lottery.roomId
      );
      if (roomHistory.length > 0) {
        adjustment += 5 * roomHistory.length;
      }
    }
    if (this.recentRooms && this.recentRooms.length > 0) {
      const recentSameType = this.recentRooms.filter(
        (room) => room.type === lottery.room_type || lottery.anchor_info && lottery.anchor_info.nickname === room.anchorName
      ).length;
      if (recentSameType > 3) {
        adjustment -= 10;
      }
    }
    return adjustment;
  };
  /**
   * 检查账号状态 未使用
   */
  checkAccountStatus = () => {
    try {
      if (!this.account || !this.account.nickName) {
        return { valid: false, reason: "账号信息不完整" };
      }
      if (this.account.state === "error") {
        return { valid: false, reason: `账号处于错误状态: ${this.account.status}` };
      }
      if (!this.account.webContentsId) {
        return { valid: false, reason: "缺少页面实例" };
      }
      if (this.maxFailures && this.failureCount >= this.maxFailures) {
        return { valid: false, reason: "达到最大失败次数" };
      }
      return { valid: true };
    } catch (error) {
      this.logError("检查账号状态失败", error);
      return { valid: false, reason: "检查账号状态时发生错误" };
    }
  };
  /**
   * 重置账号状态 未使用
   */
  resetAccountState = () => {
    try {
      this.failureCount = 0;
      if (this.account) {
        this.account.status = "空闲";
        this.account.state = "idle";
      }
      this.roomAssignment = [];
    } catch (error) {
      this.logError("重置账号状态失败", error);
    }
  };
  /**
   * 检查并更新账号任务状态 未使用
   */
  updateTaskStatus = (newStatus, newState) => {
    try {
      if (!this.account) {
        return;
      }
      this.account.status = newStatus;
      this.account.state = newState;
      this.account.lastUpdateTime = Date.now();
      this.updateStatus();
    } catch (error) {
      this.logError("更新任务状态失败", error);
    }
  };
  /**
   * 统计账号参与数据 未使用
   */
  getAccountStatistics = () => {
    try {
      const stats = {
        totalAttempts: this.totalAttempts || 0,
        totalWins: this.account?.winningHistory?.length || 0,
        totalDiamonds: this.account?.totalDiamonds || 0,
        currentBalance: this.account?.walletDiamonds || 0,
        failureRate: this.totalAttempts > 0 ? Math.round(this.failureCount / this.totalAttempts * 100) : 0,
        successRate: this.totalAttempts > 0 ? Math.round((this.totalAttempts - this.failureCount) / this.totalAttempts * 100) : 0
      };
      return stats;
    } catch (error) {
      this.logError("获取账号统计数据失败", error);
      return { error: "获取统计数据失败" };
    }
  };
  /**
   * 获取在特定直播间的尝试次数 未使用
   */
  getRoomAttempts = (roomId) => {
    try {
      if (!roomId) return 0;
      if (!this.roomAttempts) {
        this.roomAttempts = {};
      }
      return this.roomAttempts[roomId] || 0;
    } catch (error) {
      this.logError("获取直播间尝试次数失败", error);
      return 0;
    }
  };
  /**
   * 记录在特定直播间的尝试 未使用
   */
  recordRoomAttempt = (roomId) => {
    try {
      if (!roomId) return;
      if (!this.roomAttempts) {
        this.roomAttempts = {};
      }
      this.roomAttempts[roomId] = (this.roomAttempts[roomId] || 0) + 1;
      this.totalAttempts = (this.totalAttempts || 0) + 1;
    } catch (error) {
      this.logError("记录直播间尝试失败", error);
    }
  };
  /**
   * 清理长时间未活动的直播间尝试记录 未使用
   */
  cleanupInactiveRoomAttempts = () => {
    try {
      if (!this.roomAttempts) return;
      const cutoffTime = Date.now() - 24 * 60 * 60 * 1e3;
      Object.keys(this.roomAttempts).forEach((roomId) => {
      });
    } catch (error) {
      this.logError("清理直播间尝试记录失败", error);
    }
  };
}
function rc4_encrypt(plaintext, key) {
  const s = [];
  for (var i = 0; i < 256; i++) {
    s[i] = i;
  }
  var j = 0;
  for (var i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    var temp = s[i];
    s[i] = s[j];
    s[j] = temp;
  }
  var i = 0;
  var j = 0;
  const cipher = [];
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    var temp = s[i];
    s[i] = s[j];
    s[j] = temp;
    const t = (s[i] + s[j]) % 256;
    cipher.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)));
  }
  return cipher.join("");
}
function le(e, r) {
  return (e << (r %= 32) | e >>> 32 - r) >>> 0;
}
function de(e) {
  return 0 <= e && e < 16 ? 2043430169 : 16 <= e && e < 64 ? 2055708042 : void 0;
}
function pe(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? (r & t | r & n | t & n) >>> 0 : (void 0, 0);
}
function he(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? (r & t | ~r & n) >>> 0 : (void 0, 0);
}
function reset() {
  this.reg[0] = 1937774191, this.reg[1] = 1226093241, this.reg[2] = 388252375, this.reg[3] = 3666478592, this.reg[4] = 2842636476, this.reg[5] = 372324522, this.reg[6] = 3817729613, this.reg[7] = 2969243214, this["chunk"] = [], this["size"] = 0;
}
function write(e) {
  const a = "string" == typeof e ? (function(e2) {
    const n = encodeURIComponent(e2)["replace"](/%([0-9A-F]{2})/g, function(e3, r) {
      return String["fromCharCode"]("0x" + r);
    }), a2 = new Array(n["length"]);
    return Array["prototype"]["forEach"]["call"](n, function(e3, r) {
      a2[r] = e3.charCodeAt(0);
    }), a2;
  })(e) : e;
  this.size += a.length;
  let f = 64 - this["chunk"]["length"];
  if (a["length"] < f) this["chunk"] = this["chunk"].concat(a);
  else
    for (this["chunk"] = this["chunk"].concat(a.slice(0, f)); this["chunk"].length >= 64; )
      this["_compress"](this["chunk"]), f < a["length"] ? this["chunk"] = a["slice"](f, Math["min"](f + 64, a["length"])) : this["chunk"] = [], f += 64;
}
function sum(e, t) {
  e && (this["reset"](), this["write"](e)), this["_fill"]();
  for (var f = 0; f < this.chunk["length"]; f += 64)
    this._compress(this["chunk"]["slice"](f, f + 64));
  let i = null;
  if (t == "hex") {
    i = "";
    for (f = 0; f < 8; f++) i += se(this["reg"][f]["toString"](16), 8, "0");
  } else
    for (i = new Array(32), f = 0; f < 8; f++) {
      let c = this.reg[f];
      i[4 * f + 3] = (255 & c) >>> 0, c >>>= 8, i[4 * f + 2] = (255 & c) >>> 0, c >>>= 8, i[4 * f + 1] = (255 & c) >>> 0, c >>>= 8, i[4 * f] = (255 & c) >>> 0;
    }
  return this["reset"](), i;
}
function _compress(t) {
  if (t < 64) ;
  else {
    for (var f = (function(e) {
      for (var r = new Array(132), t2 = 0; t2 < 16; t2++)
        r[t2] = e[4 * t2] << 24, r[t2] |= e[4 * t2 + 1] << 16, r[t2] |= e[4 * t2 + 2] << 8, r[t2] |= e[4 * t2 + 3], r[t2] >>>= 0;
      for (var n = 16; n < 68; n++) {
        let a = r[n - 16] ^ r[n - 9] ^ le(r[n - 3], 15);
        a = a ^ le(a, 15) ^ le(a, 23), r[n] = (a ^ le(r[n - 13], 7) ^ r[n - 6]) >>> 0;
      }
      for (n = 0; n < 64; n++) r[n + 68] = (r[n] ^ r[n + 4]) >>> 0;
      return r;
    })(t), i = this["reg"].slice(0), c = 0; c < 64; c++) {
      let o = le(i[0], 12) + i[4] + le(de(c), c), s = ((o = le(o = (4294967295 & o) >>> 0, 7)) ^ le(i[0], 12)) >>> 0, u = pe(c, i[0], i[1], i[2]);
      u = (4294967295 & (u = u + i[3] + s + f[c + 68])) >>> 0;
      let b = he(c, i[4], i[5], i[6]);
      b = (4294967295 & (b = b + i[7] + o + f[c])) >>> 0, i[3] = i[2], i[2] = le(i[1], 9), i[1] = i[0], i[0] = u, i[7] = i[6], i[6] = le(i[5], 19), i[5] = i[4], i[4] = (b ^ le(b, 9) ^ le(b, 17)) >>> 0;
    }
    for (let l = 0; l < 8; l++) this["reg"][l] = (this["reg"][l] ^ i[l]) >>> 0;
  }
}
function _fill() {
  let a = 8 * this["size"], f = this["chunk"]["push"](128) % 64;
  for (64 - f < 8 && (f -= 64); f < 56; f++) this.chunk["push"](0);
  for (var i = 0; i < 4; i++) {
    const c = Math["floor"](a / 4294967296);
    this["chunk"].push(c >>> 8 * (3 - i) & 255);
  }
  for (i = 0; i < 4; i++) this["chunk"]["push"](a >>> 8 * (3 - i) & 255);
}
function SM3() {
  this.reg = [];
  this.chunk = [];
  this.size = 0;
  this.reset();
}
SM3.prototype.reset = reset;
SM3.prototype.write = write;
SM3.prototype.sum = sum;
SM3.prototype._compress = _compress;
SM3.prototype._fill = _fill;
function result_encrypt(long_str, num = null) {
  let temp_int;
  const s_obj = {
    s0: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    s1: "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
    s2: "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
    s3: "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
    s4: "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe"
  };
  const constant = {
    0: 16515072,
    1: 258048,
    2: 4032,
    str: s_obj[num]
  };
  let result = "";
  let lound = 0;
  let long_int = get_long_int(lound, long_str);
  for (let i = 0; i < long_str.length / 3 * 4; i++) {
    if (Math.floor(i / 4) !== lound) {
      lound += 1;
      long_int = get_long_int(lound, long_str);
    }
    const key = i % 4;
    switch (key) {
      case 0:
        temp_int = (long_int & constant["0"]) >> 18;
        result += constant["str"].charAt(temp_int);
        break;
      case 1:
        temp_int = (long_int & constant["1"]) >> 12;
        result += constant["str"].charAt(temp_int);
        break;
      case 2:
        temp_int = (long_int & constant["2"]) >> 6;
        result += constant["str"].charAt(temp_int);
        break;
      case 3:
        temp_int = long_int & 63;
        result += constant["str"].charAt(temp_int);
        break;
    }
  }
  return result;
}
function get_long_int(round, long_str) {
  round = round * 3;
  return long_str.charCodeAt(round) << 16 | long_str.charCodeAt(round + 1) << 8 | long_str.charCodeAt(round + 2);
}
function gener_random(random, option) {
  return [
    random & 255 & 170 | option[0] & 85,
    // 163
    random & 255 & 85 | option[0] & 170,
    //87
    random >> 8 & 255 & 170 | option[1] & 85,
    //37
    random >> 8 & 255 & 85 | option[1] & 170
    //41
  ];
}
function generate_rc4_bb_str(url_search_params, user_agent, window_env_str, suffix = "cus", Arguments = [0, 1, 14]) {
  const sm3 = new SM3();
  const start_time = Date.now();
  const url_search_params_list = sm3.sum(sm3.sum(url_search_params + suffix));
  const cus = sm3.sum(sm3.sum(suffix));
  const ua = sm3.sum(
    result_encrypt(
      rc4_encrypt(user_agent, String.fromCharCode.apply(null, [390625e-8, 1, Arguments[2]])),
      "s3"
    )
  );
  const end_time = Date.now();
  const b = {
    8: 3,
    // 固定
    10: end_time,
    //3次加密结束时间
    15: {
      aid: 6383,
      pageId: 6241
    },
    16: start_time,
    //3次加密开始时间
    18: 44
  };
  b[20] = b[16] >> 24 & 255;
  b[21] = b[16] >> 16 & 255;
  b[22] = b[16] >> 8 & 255;
  b[23] = b[16] & 255;
  b[24] = b[16] / 256 / 256 / 256 / 256 >> 0;
  b[25] = b[16] / 256 / 256 / 256 / 256 / 256 >> 0;
  b[26] = Arguments[0] >> 24 & 255;
  b[27] = Arguments[0] >> 16 & 255;
  b[28] = Arguments[0] >> 8 & 255;
  b[29] = Arguments[0] & 255;
  b[30] = Arguments[1] / 256 & 255;
  b[31] = Arguments[1] % 256 & 255;
  b[32] = Arguments[1] >> 24 & 255;
  b[33] = Arguments[1] >> 16 & 255;
  b[34] = Arguments[2] >> 24 & 255;
  b[35] = Arguments[2] >> 16 & 255;
  b[36] = Arguments[2] >> 8 & 255;
  b[37] = Arguments[2] & 255;
  b[38] = url_search_params_list[21];
  b[39] = url_search_params_list[22];
  b[40] = cus[21];
  b[41] = cus[22];
  b[42] = ua[23];
  b[43] = ua[24];
  b[44] = b[10] >> 24 & 255;
  b[45] = b[10] >> 16 & 255;
  b[46] = b[10] >> 8 & 255;
  b[47] = b[10] & 255;
  b[48] = b[8];
  b[49] = b[10] / 256 / 256 / 256 / 256 >> 0;
  b[50] = b[10] / 256 / 256 / 256 / 256 / 256 >> 0;
  b[51] = b[15]["pageId"];
  b[52] = b[15]["pageId"] >> 24 & 255;
  b[53] = b[15]["pageId"] >> 16 & 255;
  b[54] = b[15]["pageId"] >> 8 & 255;
  b[55] = b[15]["pageId"] & 255;
  b[56] = b[15]["aid"];
  b[57] = b[15]["aid"] & 255;
  b[58] = b[15]["aid"] >> 8 & 255;
  b[59] = b[15]["aid"] >> 16 & 255;
  b[60] = b[15]["aid"] >> 24 & 255;
  const window_env_list = [];
  for (let index = 0; index < window_env_str.length; index++) {
    window_env_list.push(window_env_str.charCodeAt(index));
  }
  b[64] = window_env_list.length;
  b[65] = b[64] & 255;
  b[66] = b[64] >> 8 & 255;
  b[69] = [].length;
  b[70] = b[69] & 255;
  b[71] = b[69] >> 8 & 255;
  b[72] = b[18] ^ b[20] ^ b[26] ^ b[30] ^ b[38] ^ b[40] ^ b[42] ^ b[21] ^ b[27] ^ b[31] ^ b[35] ^ b[39] ^ b[41] ^ b[43] ^ b[22] ^ b[28] ^ b[32] ^ b[36] ^ b[23] ^ b[29] ^ b[33] ^ b[37] ^ b[44] ^ b[45] ^ b[46] ^ b[47] ^ b[48] ^ b[49] ^ b[50] ^ b[24] ^ b[25] ^ b[52] ^ b[53] ^ b[54] ^ b[55] ^ b[57] ^ b[58] ^ b[59] ^ b[60] ^ b[65] ^ b[66] ^ b[70] ^ b[71];
  let bb = [
    b[18],
    b[20],
    b[52],
    b[26],
    b[30],
    b[34],
    b[58],
    b[38],
    b[40],
    b[53],
    b[42],
    b[21],
    b[27],
    b[54],
    b[55],
    b[31],
    b[35],
    b[57],
    b[39],
    b[41],
    b[43],
    b[22],
    b[28],
    b[32],
    b[60],
    b[36],
    b[23],
    b[29],
    b[33],
    b[37],
    b[44],
    b[45],
    b[59],
    b[46],
    b[47],
    b[48],
    b[49],
    b[50],
    b[24],
    b[25],
    b[65],
    b[66],
    b[70],
    b[71]
  ];
  bb = bb.concat(window_env_list).concat(b[72]);
  return rc4_encrypt(String.fromCharCode.apply(null, bb), String.fromCharCode.apply(null, [121]));
}
function generate_random_str() {
  let random_str_list = [];
  random_str_list = random_str_list.concat(gener_random(Math.random() * 1e4, [3, 45]));
  random_str_list = random_str_list.concat(gener_random(Math.random() * 1e4, [1, 0]));
  random_str_list = random_str_list.concat(gener_random(Math.random() * 1e4, [1, 5]));
  return String.fromCharCode.apply(null, random_str_list);
}
function sign(url_search_params, user_agent, arg) {
  const result_str = generate_random_str() + generate_rc4_bb_str(
    url_search_params,
    user_agent,
    "1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32",
    "cus",
    arg
  );
  return result_encrypt(result_str, "s4") + "=";
}
function sign_datail(params, userAgent) {
  return sign(params, userAgent, [0, 1, 14]);
}
function sign_reply(params, userAgent) {
  return sign(params, userAgent, [0, 1, 8]);
}
const liveHost = "https://live.douyin.com";
const request = globalThis.chrome?.utils?.request;
const commonParams = {
  device_platform: "webapp",
  aid: "6383",
  channel: "channel_pc_web",
  update_version_code: "170400",
  pc_client_type: "1",
  version_code: "190500",
  version_name: "19.5.0",
  cookie_enabled: "true",
  screen_width: "2560",
  screen_height: "1440",
  browser_language: "zh-CN",
  browser_platform: "Win32",
  browser_name: "Chrome",
  browser_version: "126.0.0.0",
  browser_online: "true",
  engine_name: "Blink",
  engine_version: "126.0.0.0",
  os_name: "Windows",
  os_version: "10",
  cpu_core_num: "24",
  device_memory: "8",
  platform: "PC",
  downlink: "10",
  effective_type: "4g",
  round_trip_time: "50"
};
const commonHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
  "sec-ch-ua-platform": "Windows",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  referer: "https://www.douyin.com/?recommend=1",
  priority: "u=1, i",
  pragma: "no-cache",
  "cache-control": "no-cache",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  accept: "application/json, text/plain, */*",
  dnt: "1"
};
async function handleParams(params, headers) {
  const cookie = headers["cookie"];
  if (!cookie) {
    return params;
  }
  const cookieObj = cookieToObj(cookie);
  params.msToken = getMsToken();
  params.screen_width = cookieObj.dy_swidth || 2560;
  params.screen_height = cookieObj.dy_sheight || 1440;
  params.cpu_core_num = cookieObj.device_web_cpu_core || 24;
  params.device_memory = cookieObj.device_web_memory_size || 8;
  params.verifyFp = cookieObj.s_v_web_id || null;
  params.fp = cookieObj.s_v_web_id || null;
  return params;
}
function cookieToObj(cookie) {
  const obj = {};
  const cookies = cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    const [key, value] = cookies[i].trim().split("=");
    obj[key] = value;
  }
  return obj;
}
function getMsToken(randomLength = 120) {
  let randomStr = "";
  const baseStr = "ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=";
  const length = baseStr.length - 1;
  for (let i = 0; i < randomLength; i++) {
    randomStr += baseStr[Math.floor(Math.random() * length)];
  }
  return randomStr;
}
async function douyinLiveRemote(uri, params, headers) {
  Object.assign(params, commonParams);
  Object.assign(headers, commonHeaders);
  params = await handleParams(params, headers);
  let a_bogus;
  const query = new URLSearchParams(params).toString();
  if (uri.includes("reply")) {
    a_bogus = sign_reply(query, headers["User-Agent"]);
  } else {
    a_bogus = sign_datail(query, headers["User-Agent"]);
  }
  params["a_bogus"] = a_bogus;
  return await request({
    url: `${liveHost}${uri}`,
    method: "GET",
    params,
    headers
  });
}
class DouyinLiveRoomManager {
  /**
   * 构造函数
   * @param {Object} options - 配置选项
   * @param {Function} options.onLogUpdate - 日志更新回调函数
   * @param {Function} options.onLotteryUpdate - 福袋列表更新回调函数
   * @param {Object} options.config - 配置对象
   */
  constructor(options = {}) {
    this.collectLoading = false;
    this.pauseCollect = false;
    this.lotteryInfoList = [];
    this.config = options.config || {};
    this.cleanTimer = null;
    this.expiredLotteryCleanTimer = null;
    this.collectPageId = null;
    this.collectBrowserId = null;
    this.maxRetries = 3;
    this.retryDelay = 200;
    this.categoryList = [];
    this.cookiePool = [];
  }
  /**
   * 设置直播间分类列表
   * @param {Array} categoryList - 直播间分类数组
   */
  setCategoryList = (categoryList) => {
    this.categoryList = categoryList;
  };
  /**
   * 从cookie池中随机获取一个cookie
   * @returns {string} - 选中的cookie
   */
  getRandomCookie = () => {
    if (this.config?.takeTurnScan?.enabled && this.cookiePool.length > 0) {
      const randomIndex = Math.floor(Math.random() * this.cookiePool.length);
      return this.cookiePool[randomIndex];
    }
    return null;
  };
  getRandomPartition = () => {
    if (this.config?.takeTurnScan?.enabled && this.partitionPool.length > 0) {
      const randomIndex = Math.floor(Math.random() * this.partitionPool.length);
      return this.partitionPool[randomIndex];
    }
    return null;
  };
  /**
   * 设置cookie池
   * @param {Array} cookies - cookie数组
   */
  setCookiePool = (cookies) => {
    if (Array.isArray(cookies) && cookies.length > 0) {
      const validCookies = [...new Set(cookies.filter((cookie) => cookie && cookie.trim()))];
      const mergedPool = [.../* @__PURE__ */ new Set([...this.cookiePool, ...validCookies])];
      this.cookiePool = mergedPool.length > 0 ? mergedPool : [];
      this.updateLog(`追加 cookie 池，当前池大小：${this.cookiePool.length}`);
    }
  };
  setPartitionPool = (partitionList) => {
    if (Array.isArray(partitionList) && partitionList.length > 0) {
      const validPartitions = [
        ...new Set(partitionList.filter((partition) => partition && partition.trim()))
      ];
      const mergedPool = [.../* @__PURE__ */ new Set([...this.partitionPool, ...validPartitions])];
      this.partitionPool = mergedPool.length > 0 ? mergedPool : [];
      this.updateLog(`追加 cookie 池，当前池大小：${this.partitionPool.length}`);
    }
  };
  /**
   * 检查是否需要自动采集
   */
  checkAutoCollect = async () => {
    try {
      if (!this.collectLoading && !this.pauseCollect) {
        if (this.config.checkType.value === 1) {
          if (this.lotteryInfoList.length < this.config.remainCount.value) {
            this.selectCollectMethod()();
          } else {
            this.updateLog(
              `条件检查:当前福袋数量${this.lotteryInfoList.length}已超过目标数量${this.config.remainCount.value}，本次跳过采集`
            );
          }
        }
        if (this.config.checkType.value === 2) {
          this.selectCollectMethod()();
        }
      }
    } catch (error) {
    }
  };
  /**
   * 更新日志
   * @param {string} content - 日志内容
   */
  updateLog = (content) => {
    const payload = {
      type: "log",
      data: content
    };
    chrome.runtime.sendMessage({
      type: "notice",
      data: JSON.parse(JSON.stringify(payload))
    });
  };
  /**
   * 停止搜索直播间
   */
  stopSearchLiveRoom = () => {
    this.pauseCollect = true;
    this.collectLoading = false;
    if (this.cleanTimer) {
      clearInterval(this.cleanTimer);
      clearInterval(this.expiredLotteryCleanTimer);
      this.cleanTimer = null;
      this.expiredLotteryCleanTimer = null;
    }
  };
  /**
   * 选择采集方式
   */
  selectCollectMethod = () => {
    return this.searchLiveRoomByBrowser.bind(this);
  };
  /**
   * 启动自动采集福袋定时器并启动waiting的账号
   */
  startAutoCleanTimer = () => {
    if (this.cleanTimer) {
      return;
    }
    const intervalDuration = this.config.intervalDuration.value || 3;
    this.cleanTimer = setInterval(
      async () => {
        this.updateCollectLottery();
        await globalThis.douyinLotteryManager.continue();
        await this.checkAutoCollect();
      },
      1e3 * 60 * intervalDuration
      // 每3分钟清理一次和自动采集
    );
  };
  /**
   * 启动自动清理过期福袋定时器
   */
  startAutoCleanExpiredLotteries = () => {
    if (this.expiredLotteryCleanTimer) {
      return;
    }
    this.expiredLotteryCleanTimer = setInterval(
      () => {
        this.updateCollectLottery();
      },
      1e3 * 70
      // 每70秒清理一次过期福袋
    );
  };
  /**
   * 福袋列表更新推送
   * @returns {Promise<void>}
   */
  updateCollectLottery = async () => {
    this.filterExpiredLotteries();
    const payload = {
      type: "update-lotteryInfoList",
      data: this.lotteryInfoList
    };
    chrome.runtime.sendMessage({
      type: "notice",
      data: JSON.parse(JSON.stringify(payload))
    });
  };
  /**
   * 过滤过期的福袋
   */
  filterExpiredLotteries = () => {
    const currentTime = Math.floor(Date.now() / 1e3);
    const initialLength = this.lotteryInfoList.length;
    this.lotteryInfoList = this.lotteryInfoList.filter((lottery) => lottery.end_time > currentTime);
    const removedCount = initialLength - this.lotteryInfoList.length;
    if (removedCount > 0) {
      this.updateLog(`过滤掉 ${removedCount} 个已过期的福袋`);
      return true;
    }
    return false;
  };
  /**
   * 统一搜索直播间
   * @returns {Promise<void>}
   */
  searchLiveRoom = async () => {
    if (this.collectLoading) {
      return;
    }
    try {
      this.collectLoading = true;
      this.updateLog("开始采集直播间福袋...");
      await this.searchLiveByAll();
      await this.startCollectLive();
    } catch (error) {
      this.updateLog(`搜索失败: ${error.message}`);
    } finally {
      this.collectLoading = false;
    }
  };
  /**
   * 搜索直播间-【全部】
   * @param {number} times - 搜索次数，默认10次
   * @returns {Promise<void>}
   */
  searchLiveByAll = async (times = 10) => {
    try {
      this.updateLog(`开始执行全部直播间搜索，共${times}次`);
      for (let i = 0; i < times; i++) {
        if (this.pauseCollect) {
          break;
        }
        this.updateLog(`正在执行直播间第${i + 1}/${times}次搜索...`);
        try {
          const params = {
            live_id: 1,
            enter_from: "page_refresh",
            cookie_enabled: true,
            request_tag_from: "web",
            need_map: "1",
            liveid: "1",
            is_draw: "1",
            inner_from_drawer: "0",
            custom_count: "8",
            action: "load_more",
            action_type: "loadmore",
            enter_source: "web_homepage_hot_web_live_card",
            source_key: "web_homepage_hot_web_live_card"
          };
          const headers = { cookie: this.getRandomCookie().replaceAll("\n", "") };
          const res = await douyinLiveRemote("/webcast/feed/", params, headers);
          if (!res || !Array.isArray(res.data)) {
            this.updateLog(`第${i + 1}次搜索响应数据格式错误`);
            continue;
          }
          const roomInfoList = res.data.filter((item) => {
            return item?.data?.others?.web_enter_benefit_point_data?.has_ongoing_lottery;
          }).map((room) => {
            return {
              webRid: room.web_rid,
              roomId: room.data.id_str,
              roomTitle: room.data.title,
              authorNickname: room.data.owner.nickname,
              authorSecUid: room.data.owner.sec_uid,
              onlineTotal: room.data.user_count
            };
          });
          const resList = await this.getLotteryInfo(roomInfoList);
          const validLotteryInfoList = resList.filter((item) => item.status === "fulfilled" && item.value).map((item) => item.value);
          const filteredList = this.filterLotteryByConditions(validLotteryInfoList);
          this.updateLog(
            `第${i + 1}次搜索: 发现${roomInfoList.length}个有福袋的直播间, 符合条件的直播间数量: ${filteredList.length}`
          );
          this.addLotteryInfoWithoutDuplicates(filteredList);
          const randomDelay = Math.floor(Math.random() * 1e3) + 500;
          await new Promise((resolve) => setTimeout(resolve, randomDelay));
          await this.updateCollectLottery();
        } catch (error) {
          this.updateLog(`第${i + 1}次搜索出错: ${error.message}`);
        }
      }
    } catch (error) {
    } finally {
    }
  };
  /**
   * 搜索直播间-【分类】
   * @param {Array} liveCategory - 直播间分类列表，默认使用内置分类
   * @returns {Promise<void>}
   */
  startCollectLive = async (liveCategory = null) => {
    try {
      const categories = liveCategory || this.categoryList;
      this.updateLog(`开始按分类采集直播间，共${categories.length}个分类`);
      for (let i = 0; i < categories.length; i++) {
        if (this.pauseCollect) {
          break;
        }
        const category = categories[i];
        this.updateLog(`正在采集【${category.name}】分类的直播间...`);
        try {
          const res = await this.searchLiveRoomCategory({
            category_id: category.id,
            category_name: category.name,
            page: 10
          });
          const filteredList = this.filterLotteryByConditions(res);
          this.updateLog(
            `【${category.name}】分类: 发现${res.length}个有福袋的直播间, 符合条件的直播间数量: ${filteredList.length}`
          );
          this.addLotteryInfoWithoutDuplicates(filteredList);
          const randomDelay = Math.floor(Math.random() * 1e3) + 500;
          await new Promise((resolve) => setTimeout(resolve, randomDelay));
        } catch (error) {
          this.updateLog(`【${category.name}】分类采集出错: ${error.message}`);
        }
      }
    } catch (error) {
    } finally {
    }
  };
  /**
   * 采集直播间-【每个分类】
   * @param {Object} options - 采集选项
   * @param {number} options.category_id - 直播间分类id
   * @param {string} options.category_name - 直播间分类名称
   * @param {number} options.page - 分页数量，默认10次
   * @returns {Promise<Array>} - 福袋信息列表
   */
  searchLiveRoomCategory = async ({ category_id, category_name, page = 10 }) => {
    const lotteryInfoList = [];
    try {
      this.updateLog(`正在搜索【${category_name || "未知分类"}】分类的直播间，共${page}次`);
      for (let i = 0; i < page; i++) {
        if (this.pauseCollect) {
          break;
        }
        try {
          const params = {
            live_id: 1,
            enter_from: "page_refresh",
            cookie_enabled: true,
            count: 15,
            offset: (i + 1) * 15,
            partition: category_id,
            partition_type: 4,
            req_from: 2
          };
          const headers = { cookie: this.getRandomCookie().replaceAll("\n", "") };
          const result = await douyinLiveRemote(
            "/webcast/web/partition/detail/room/v2/",
            params,
            headers
          );
          if (!result?.data?.data || !Array.isArray(result.data.data)) {
            this.updateLog(`第${i + 1}页数据格式错误`);
            continue;
          }
          const list = result.data.data.filter((item) => {
            return item?.room?.others?.web_enter_benefit_point_data?.has_ongoing_lottery;
          });
          const roomInfoList = list.map((item) => ({
            webRid: item.web_rid,
            roomId: item.room.id_str,
            roomTitle: item.room.title,
            authorNickname: item.room.owner.nickname,
            authorSecUid: item.room.owner.sec_uid,
            onlineTotal: item.room.user_count
          }));
          await new Promise((resolve) => setTimeout(resolve, 200));
          const resList = await this.getLotteryInfo(roomInfoList);
          const validLotteryInfoList = resList.filter((item) => item.status === "fulfilled" && item.value).map((item) => item.value);
          lotteryInfoList.push(...validLotteryInfoList);
        } catch (error) {
        }
      }
    } catch (error) {
    } finally {
      await this.updateCollectLottery();
    }
    return lotteryInfoList;
  };
  /**
   * 根据直播间信息获取福袋信息
   * @param {Array} roomInfoList - 直播间信息列表
   * @returns {Promise<Array>} - Promise.allSettled的结果数组
   */
  getLotteryInfo = async (roomInfoList) => {
    if (!Array.isArray(roomInfoList) || roomInfoList.length === 0) {
      return [];
    }
    const promises = roomInfoList.map(async (roomInfo) => {
      try {
        const params = {
          live_id: 1,
          enter_from: "link_share",
          cookie_enabled: true,
          room_id: roomInfo.roomId,
          query_from: 1
        };
        const headers = { cookie: this.getRandomCookie().replaceAll("\n", "") };
        const result = await douyinLiveRemote(
          "/webcast/lottery/melon/lottery_info/",
          params,
          headers
        );
        if (!result?.data?.lottery_info) {
          throw new Error("福袋信息数据格式错误");
        }
        const lottery_info = result.data.lottery_info;
        const lotteryInfo = {
          ...roomInfo,
          anchorId: lottery_info.anchor_id,
          joinTotal: lottery_info.candidate_num || 0,
          lotteryId: lottery_info.lottery_id_str,
          lotteryTotal: lottery_info.prize_count || 0,
          winningTotal: lottery_info.lucky_count || 0,
          lotteryName: lottery_info.prize_info?.name || "未知奖品",
          start_time: lottery_info.start_time,
          end_time: lottery_info.draw_time,
          conditions: lottery_info.conditions || [],
          fetchedAt: Date.now()
          // 添加获取时间
        };
        return this.applyLotteryFilters(lotteryInfo) ? lotteryInfo : null;
      } catch (error) {
        throw error;
      }
    });
    return await Promise.allSettled(promises);
  };
  /**
   * 应用福袋过滤条件
   * @param {Object} lotteryInfo - 福袋信息
   * @returns {boolean} - 是否通过过滤
   */
  applyLotteryFilters = (lotteryInfo) => {
    if (!this.config?.filterDuration?.enabled && !this.config?.filterOnline?.enabled) {
      return true;
    }
    let isValid = true;
    const currentTime = Math.floor(Date.now() / 1e3);
    if (this.config?.filterDuration?.enabled) {
      const filterMinutes = this.config.filterDuration.value;
      const remainingSeconds = lotteryInfo.end_time - currentTime;
      const remainingMinutes = remainingSeconds / 60;
      isValid = isValid && remainingSeconds > 0 && remainingMinutes < filterMinutes;
    }
    if (this.config?.filterOnline?.enabled) {
      const maxOnline = this.config.filterOnline.value;
      isValid = isValid && lotteryInfo.onlineTotal <= maxOnline;
    }
    return isValid;
  };
  /**
   * 根据条件过滤福袋
   * @param {Array} lotteryList - 福袋列表
   * @returns {Array} - 过滤后的福袋列表
   */
  filterLotteryByConditions = (lotteryList) => {
    return lotteryList.filter(
      (item) => item && item.conditions && item.conditions.length === 2 && item.conditions[0].type === 3 && // 发口令
      item.conditions[1].type === 6
      // 手动参与
    );
  };
  /**
   * 添加福袋信息，避免重复
   * @param {Array} newLotteryList - 新的福袋列表
   */
  addLotteryInfoWithoutDuplicates = (newLotteryList) => {
    const existingRoomIds = new Set(this.lotteryInfoList.map((item) => item.roomId));
    let addedCount = 0;
    for (const lottery of newLotteryList) {
      if (lottery && !existingRoomIds.has(lottery.roomId)) {
        this.lotteryInfoList.push(lottery);
        existingRoomIds.add(lottery.roomId);
        addedCount++;
      }
    }
    this.lotteryInfoList.sort((a, b) => {
      const timeA = a.end_time || 0;
      const timeB = b.end_time || 0;
      return timeA - timeB;
    });
    if (addedCount > 0) {
      if (globalThis.douyinLotteryManager) {
        try {
          globalThis.douyinLotteryManager.continue();
        } catch (error) {
        }
      }
    }
  };
  // 搜索直播间---通过无头浏览器采集
  searchLiveRoomByBrowser = async () => {
    if (this.collectLoading || this.pauseCollect) {
      return;
    }
    try {
      this.collectLoading = true;
      this.pauseCollect = false;
      await this.openCollectBrowser();
      this.updateLog("准备采集福袋直播间...");
      await this.startAutoCollectRoomByBrowser();
    } catch (error) {
    } finally {
      this.collectLoading = false;
      this.updateLog("本次采集福袋直播间结束");
    }
  };
  /**
   * 打开一个无头浏览器实例进行直播间采集
   */
  openCollectBrowser = async () => {
    let res;
    if (this.config?.chromeBrowser?.enabled) {
      const options = {
        id: uuid(),
        url: "https://live.douyin.com/",
        width: 833,
        height: 544,
        headless: true,
        chromePath: this.config?.chromeBrowser?.enabled ? this.config.chromeBrowser.value : ""
      };
      res = await globalThis.chrome.playwright.browser.launchBrowser(options);
      if (!res.success) {
        await this.closeCollectBrowser();
        return;
      }
      this.collectPageId = res.data.id;
    } else {
      const options = {
        type: "rpa",
        windowId: uuid(),
        url: "https://live.douyin.com/",
        width: 833,
        height: 544,
        show: false
      };
      res = await globalThis.chrome.windows.create(options);
      this.collectPageId = res.webContentsId;
      this.collectBrowserId = res.id;
      await new Promise((resolve) => setTimeout(resolve, 3e3));
    }
    try {
      if (globalThis.chrome.playwright.page.addListener) {
        const res2 = await globalThis.chrome.playwright.page.addListener(
          this.collectPageId,
          "response"
        );
      }
    } catch (error) {
      this.logError("添加页面事件监听器失败", error);
    }
  };
  closeCollectBrowser = async () => {
    if (this.collectPageId) {
      if (this.config?.chromeBrowser?.enabled) {
        await globalThis.chrome.playwright.browser.closeBrowser({
          id: this.collectPageId
        });
        this.collectPageId = null;
      } else {
        await globalThis.chrome.windows.remove(this.collectBrowserId);
        this.collectPageId = null;
        this.collectBrowserId = null;
      }
    }
  };
  startAutoCollectRoomByBrowser = async () => {
    try {
      while (true) {
        const hasNextCategory = await this.autoCollect();
        if (!hasNextCategory || this.pauseCollect) {
          break;
        }
      }
      await this.closeCollectBrowser();
    } catch (error) {
    }
  };
  // 自动采集
  autoCollect = async () => {
    const result = await globalThis.chrome.playwright.page.evaluate(
      this.collectPageId,
      `(() => {
        const nextCategory = document.querySelector('div[data-e2e="categoryTabs-container"] .i8TnLkqA').parentElement.nextElementSibling?.firstChild
        nextCategory.click()
       })()`
    );
    if (!result.success) {
      return;
    }
    await globalThis.chrome.playwright.page.locator.waitFor(
      this.collectPageId,
      'ul[data-e2e="scroll-list"]',
      { timeout: 2e4 }
      // 20秒超时
    );
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    while (true) {
      const { result: hasMore } = await globalThis.chrome.playwright.page.evaluate(
        this.collectPageId,
        `(() => {
            const content = document.querySelector('ul[data-e2e="scroll-list"]').nextElementSibling.textContent
            if (content === '') {
              document.querySelector('ul[data-e2e="scroll-list"]').nextElementSibling.scrollIntoView({
                  behavior:'smooth'
              });
              return true
            } else {
            return false
          }
       })()`
      );
      if (!hasMore) {
        break;
      }
      const randomWaitTime = Math.floor(Math.random() * 500) + 1e3;
      await new Promise((resolve) => setTimeout(resolve, randomWaitTime));
    }
    const { result: hasNextCategory } = await globalThis.chrome.playwright.page.evaluate(
      this.collectPageId,
      `(() => {
        const nextCategory = document.querySelector('div[data-e2e="categoryTabs-container"] .i8TnLkqA').parentElement.nextElementSibling?.firstChild
        return nextCategory ? true : false
       })()`
    );
    if (!hasNextCategory) {
      return false;
    }
    return true;
  };
  /**
   * 暂停自动采集
   */
  pauseAutoCollectRoomByBrowser = () => {
    this.pauseCollect = true;
  };
  /**
   * 处理采集浏览器的响应
   * @param {*} data - 响应数据
   */
  handleResponse = async (data) => {
    if (!data || typeof data !== "string") {
      this.logError("无效的响应数据", new Error("响应数据必须是非空字符串"));
      return;
    }
    let response;
    try {
      response = JSON.parse(data);
    } catch (error) {
      this.logError("解析响应数据失败", error);
      return;
    }
    if (!response || !response.url) {
      this.logError("无效的响应对象", new Error("响应对象缺少url属性"));
      return;
    }
    const url = response.url;
    if (url.includes("/webcast/web/partition/detail/room/v2/")) {
      try {
        const res = await response.json;
        if (!res.status_code === 0 || !res.data) {
          return;
        }
        const queryParams = await this.getQueryParams(url);
        const partition = queryParams.partition || "未知";
        const offset = queryParams.offset || "未知";
        this.updateLog(
          `采集分类：${partition}，页面偏移： ${offset}，发现${res.data.data.length}个直播间`
        );
        const list = res.data.data.filter((item) => {
          return item?.room?.others?.web_enter_benefit_point_data?.has_ongoing_lottery;
        });
        const roomInfoList = list.map((item) => ({
          webRid: item.web_rid,
          roomId: item.room.id_str,
          roomTitle: item.room.title,
          authorNickname: item.room.owner.nickname,
          authorSecUid: item.room.owner.sec_uid,
          onlineTotal: item.room.user_count
        }));
        const resList = await this.getLotteryInfo(roomInfoList);
        const validLotteryInfoList = resList.filter((item) => item.status === "fulfilled" && item.value).map((item) => item.value);
        const filteredLotteryList = this.filterLotteryByConditions(validLotteryInfoList);
        this.addLotteryInfoWithoutDuplicates(filteredLotteryList);
        await this.updateCollectLottery();
      } catch (error) {
      }
    }
  };
  getQueryParams = async (url) => {
    if (!url) {
      return {};
    }
    const currentUrl = url;
    const urlObj = new URL(currentUrl);
    const params = urlObj.searchParams;
    const result = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  };
  /**
   * 设置配置
   * @param {Object} config - 配置对象
   */
  setConfig = (config) => {
    this.config = { ...this.config, ...config };
    if (this.config?.filterCategory?.enabled && Array.isArray(this.config?.filterCategory?.value) && this.config?.filterCategory?.value?.length > 0) {
      this.setCategoryList(this.config.filterCategory.value);
    } else {
      this.setCategoryList([]);
    }
    this.updateLog("配置已更新");
  };
  /**
   * 增强的错误处理包装函数
   */
  /**
   * 错误处理包装函数
   *
   * 为异步操作提供统一的错误处理和重试机制
   *
   * @param {Function} fn - 要执行的异步函数
   * @param {string} errorMessage - 错误提示信息
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<any>} 函数执行结果
   * @throws {Error} 当所有重试都失败时抛出错误
   */
  withErrorHandling = async (fn, errorMessage = "操作失败", maxRetries = this.maxRetries) => {
    this.retryCount = 0;
    while (this.retryCount < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        this.retryCount++;
        this.logError(errorMessage, error);
        if (this.retryCount >= maxRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * this.retryCount));
      }
    }
  };
  /**
   * 记录错误日志
   */
  logError = (message, error) => {
    const errorData = {
      accountCode: this.account.accountCode,
      nickName: this.account.nickName,
      message,
      error: error?.message || String(error),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    EventBus.emit("error-log", JSON.parse(JSON.stringify(errorData)));
  };
}
class DouyinLotteryManager {
  /**
   * 构造函数
   */
  constructor() {
    this.taskMap = /* @__PURE__ */ new Map();
    this.roomAssignment = /* @__PURE__ */ new Map();
    this.config = null;
    this.responseListener = null;
    this.closeListener = null;
    this.liveRoomManager = new DouyinLiveRoomManager();
    this.setupEvent();
  }
  /**
   * 检查任务映射是否存在
   * @param {string} webContentsId - 任务ID
   * @returns {boolean}
   */
  checkTaskMap = (webContentsId) => {
    return this.taskMap.has(webContentsId);
  };
  /**
   * 启动搜索直播间和福袋采集
   * @returns {Promise<void>}
   */
  startCollect = async () => {
    try {
      await this.liveRoomManager.selectCollectMethod()();
    } catch (error) {
      this.updateLog(`采集失败: ${error.message}`);
    }
  };
  /**
   * 更新日志
   * @param {string} content - 日志内容
   */
  updateLog = (content) => {
    const payload = {
      type: "log",
      data: content
    };
    chrome.runtime.sendMessage({
      type: "notice",
      // 用于区分消息来源
      data: JSON.parse(JSON.stringify(payload))
      // 消息内容
    });
  };
  /**
   * 启动单个账号的浏览器
   */
  openAccountBrowser = async (args) => {
    try {
      const { account, config } = JSON.parse(JSON.stringify(args));
      this.config = config;
      if (this.taskMap.has(account.webContentsId)) {
        const oldTask = this.taskMap.get(account.webContentsId);
        oldTask.config = config;
        return;
      }
      this.taskMap.set(
        account.webContentsId,
        new Lottery(account, this.roomAssignment, this.config)
      );
    } catch (error) {
      this.updateLog(`打开浏览器失败: ${error.message}`);
    }
  };
  /**
   * 启动多账号福袋参与任务
   * @param {Object} args - 启动参数
   * @returns {Promise<void>}
   */
  start = async (args) => {
    try {
      const { accounts, config } = JSON.parse(JSON.stringify(args));
      this.config = config;
      this.liveRoomManager.setConfig(config);
      if (this.config?.takeTurnScan?.enabled) {
        this.liveRoomManager.setCookiePool(
          accounts.map((account) => {
            return webviewCookieToHeaderCookie(JSON.parse(account.cookies));
          })
        );
      }
      if (this.liveRoomManager.pauseCollect) {
        this.liveRoomManager.pauseCollect = false;
      }
      if (this.liveRoomManager.lotteryInfoList.length === 0) {
        this.updateLog("福袋列表数量不足，启动采集");
        await this.startCollect();
      }
      for (const account of accounts) {
        if (this.taskMap.has(account.webContentsId)) {
          const oldTask = this.taskMap.get(account.webContentsId);
          if (oldTask.account?.state === "paused" || oldTask.account?.state === "waiting" || oldTask.account?.state === "opened") {
            oldTask.config = config;
            oldTask.pauseJoinLottery = false;
            oldTask.start();
            this.updateLog(`账号【${account.nickName}】任务已启动`);
          } else {
            this.updateLog(
              `账号【${account.nickName}】的任务实例状态不是暂停或等待中，无需重启,当前状态: ${oldTask.account?.state}`
            );
          }
        } else {
          this.updateLog(`账号【${account.nickName}】没有任务实例,任务启动失败`);
        }
      }
      this.liveRoomManager.startAutoCleanTimer();
      this.liveRoomManager.startAutoCleanExpiredLotteries();
      this.updateLog("多账号福袋任务启动完成");
    } catch (error) {
      this.updateLog(`启动失败: ${error.message}`);
    }
  };
  /**
   * 抢红包
   */
  startRedPacket = async (args) => {
    const { accounts } = JSON.parse(JSON.stringify(args));
    for (const account of accounts) {
      if (this.taskMap.has(account.webContentsId)) {
        const oldTask = this.taskMap.get(account.webContentsId);
        await oldTask.joinRedPacket();
      }
    }
  };
  /**
   * 删除账号
   */
  deleteAccount = async (args) => {
    const { accounts } = JSON.parse(JSON.stringify(args));
    for (const account of accounts) {
      if (this.taskMap.has(account.webContentsId)) {
        const oldTask = this.taskMap.get(account.webContentsId);
        await oldTask.stop();
        this.taskMap.delete(account.webContentsId);
        this.updateLog(`删除账号【${account.nickName}】的任务实例`);
      }
    }
  };
  /**
   * 暂停所有任务
   */
  pause = async (args) => {
    try {
      const { accounts } = JSON.parse(JSON.stringify(args));
      for (const account of accounts) {
        const task = this.taskMap.get(account.webContentsId);
        if (task) {
          await task.pause();
          this.updateLog(`暂停账号【${account.nickName}】的任务`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const allPaused = Array.from(this.taskMap.values()).every(
        (task) => task.account?.state === "paused"
      );
      if (allPaused) {
        this.liveRoomManager.stopSearchLiveRoom();
        this.updateLog("所有任务已暂停");
      }
    } catch (error) {
      this.updateLog(`暂停失败: ${error.message}`);
      return;
    }
  };
  /**
   * 停止指定账号的福袋参与任务
   * @param {Object} args - 停止参数
   * @returns {Promise<void>}
   */
  stop = async (args) => {
    try {
      const { accounts } = JSON.parse(JSON.stringify(args));
      for (const account of accounts) {
        const task = this.taskMap.get(account.webContentsId);
        if (task) {
          await task.stop();
          this.taskMap.delete(account.webContentsId);
          this.updateLog(`停止账号【${account.nickName}】的任务`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (this.taskMap.size === 0) {
        this.taskMap.clear();
        this.liveRoomManager.stopSearchLiveRoom();
        this.updateLog("所有任务已停止，资源已清理");
      }
    } catch (error) {
      this.updateLog(`停止失败: ${error.message}`);
    }
  };
  /**
   * 继续执行状态为waiting等待的账号的任务
   */
  continue = async () => {
    if (this.taskMap && this.taskMap.size > 0) {
      for (const [_webContentsId, lotteryInstance] of this.taskMap) {
        if (lotteryInstance.account?.state === "waiting") {
          try {
            lotteryInstance.start();
          } catch (error) {
          }
        }
      }
    }
  };
  /**
   * 销毁管理器并清理所有资源
   */
  destroy = async () => {
    try {
      for (const [webContentsId, task] of this.taskMap) {
        await task.stop();
        this.taskMap.delete(webContentsId);
      }
      this.taskMap.clear();
      this.liveRoomManager.stopSearchLiveRoom();
      this.roomAssignment.clear();
      if (this.responseListener) {
        await chrome.playwright.page.onResponse.removeListener(this.responseListener);
        this.responseListener = null;
      }
      if (this.closeListener) {
        await chrome.playwright.page.onClose.removeListener(this.closeListener);
        this.closeListener = null;
      }
      this.config = null;
      this.updateLog("所有资源已清理");
    } catch (error) {
      this.updateLog(`销毁失败: ${error.message}`);
    }
  };
  /**
   * 设置事件监听福袋参与人数更新
   */
  setupEvent = async () => {
    try {
      this.responseListener = await chrome.playwright.page.onResponse.addListener(
        async (webContentsId, data) => {
          const task = this.taskMap.get(webContentsId);
          if (task) {
            try {
              await task.handleResponse(data);
            } catch (error) {
            }
          }
          if (webContentsId === this.liveRoomManager.collectPageId) {
            await this.liveRoomManager.handleResponse(data);
          }
        }
      );
      this.closeListener = await chrome.playwright.page.onClose.addListener(
        async (webContentsId) => {
          const task = this.taskMap.get(webContentsId);
          if (task) {
            try {
              await task.stop();
              this.taskMap.delete(webContentsId);
              this.updateLog(`【${task.account.nickName}】浏览器页面关闭`);
              if (this.taskMap.size === 0) {
                this.taskMap.clear();
                this.liveRoomManager.stopSearchLiveRoom();
                this.updateLog("所有任务已停止，资源已清理");
              }
            } catch (error) {
            }
          }
        }
      );
    } catch (error) {
    }
  };
}
if (!globalThis.douyinLotteryManager) {
  globalThis.douyinLotteryManager = new DouyinLotteryManager();
}
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === "checkTaskMap") {
    const res = globalThis.douyinLotteryManager.checkTaskMap(msg.webContentsId);
    sendResponse({ data: res });
    return true;
  }
  if (msg.type === "openAccountBrowser") {
    globalThis.douyinLotteryManager.openAccountBrowser({
      account: msg.account,
      config: msg.config
    }).then((data) => {
      sendResponse({ data, time: (/* @__PURE__ */ new Date()).getTime() });
    }).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  if (msg.type === "start") {
    globalThis.douyinLotteryManager.start({
      accounts: msg.accounts,
      config: msg.config
    }).then((data) => {
      sendResponse({ data });
    }).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  if (msg.type === "pause") {
    globalThis.douyinLotteryManager.pause({
      accounts: msg.accounts
    }).then((data) => {
      sendResponse({ data });
    }).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  if (msg.type === "stop") {
    globalThis.douyinLotteryManager.stop({
      accounts: msg.accounts
    }).then((data) => {
      sendResponse({ data });
    }).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  if (msg.type === "startRedPacket") {
    globalThis.douyinLotteryManager.startRedPacket({
      accounts: msg.accounts
    }).then((data) => {
      sendResponse({ data });
    }).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  if (msg.type === "deleteAccount") {
    globalThis.douyinLotteryManager.deleteAccount({
      accounts: msg.accounts
    }).then((data) => {
      sendResponse({ data });
    }).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "optionsPort") {
    port.onDisconnect.addListener(() => {
      globalThis.douyinLotteryManager.destroy();
    });
  }
});
