<template>
  <n-scrollbar class="sidebar-scroll hide-scrollbar">
    <div class="sidebar-content">
      <!-- 参与规则分组 -->
      <div class="config-group">
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">参与上限</span>
              <span class="item-desc">单号每日最大参与</span>
            </div>
            <n-switch v-model:value="config.participationCount.enabled" size="small" />
          </div>
          <n-input-number 
            v-model:value="config.participationCount.value" 
            :min="1" :max="1000"
            :disabled="!config.participationCount.enabled"
            size="small"
          />
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">命中率过滤</span>
              <span class="item-desc">只抢预测概率大于该值的福袋（0.1 = 10%）</span>
            </div>
            <n-switch v-model:value="config.hitRate.enabled" size="small" />
          </div>
          <n-input-number
            v-model:value="config.hitRate.value"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!config.hitRate.enabled"
            size="small"
          >
            <template #suffix><span class="input-prefix">概率值</span></template>
          </n-input-number>
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">二次检查</span>
              <span class="item-desc">进房后按最新参与人数复核，低于阈值就放弃（0.05 = 5%）</span>
            </div>
            <n-switch v-model:value="config.secondInspect.enabled" size="small" />
          </div>
          <n-input-number
            v-model:value="config.secondInspect.value"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!config.secondInspect.enabled"
            size="small"
          >
            <template #suffix><span class="input-prefix">概率值</span></template>
          </n-input-number>
        </div>
        <div class="config-item">
          <div class="item-header card-style">
            <div class="item-info">
              <span class="item-label">过滤粉丝团</span>
              <span class="item-desc">跳过需加入粉丝团的福袋</span>
            </div>
            <n-switch v-model:value="config.filterFanClub.enabled" size="small" />
          </div>
        </div>
        <div class="config-item">
          <div class="item-header card-style">
            <div style="display: flex; align-items: center; gap: 8px">
              <n-icon color="#0f766e" size="18"><cube-outline /></n-icon>
              <div class="item-info">
                <span class="item-label">只抢实物</span>
                <span class="item-desc">仅保留实物奖品福袋</span>
              </div>
            </div>
            <n-switch v-model:value="config.onlyPhysicalPrize.enabled" size="small" />
          </div>
        </div>
      <div class="config-item">
        <div class="item-header card-style">
          <div style="display: flex; align-items: center; gap: 8px">
            <n-icon color="#ca8a04" size="18"><wallet-outline /></n-icon>
              <div class="item-info">
                <span class="item-label">优先大红包</span>
                <span class="item-desc">人均红包≥{{ (config.preferBigRedPacket && config.preferBigRedPacket.threshold) || 40 }}</span>
              </div>
            </div>
            <n-switch v-model:value="config.preferBigRedPacket.enabled" size="small" />
          </div>
        </div>
      </div>

      <!-- 时间与限制分组 -->
      <div class="config-group">
        <div class="group-title">
          <n-icon size="18"><time-outline /></n-icon>
          <span>时间与限制</span>
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">运行时长</span>
            </div>
            <n-switch v-model:value="config.singleAccountDuration.enabled" size="small" />
          </div>
          <n-input-number 
            v-model:value="config.singleAccountDuration.value" 
            :min="0.5" :max="24" :step="0.5"
            :disabled="!config.singleAccountDuration.enabled"
            size="small"
          >
            <template #suffix><span class="input-prefix">小时</span></template>
          </n-input-number>
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">抢后停留</span>
            </div>
          </div>
          <n-input-number 
            v-model:value="config.stayDuration" 
            :min="0"
            size="small"
          >
            <template #suffix><span class="input-prefix">秒</span></template>
          </n-input-number>
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">人数过滤</span>
            </div>
            <n-switch v-model:value="config.filterOnline.enabled" size="small" />
          </div>
          <n-input-number
            v-model:value="config.filterOnline.value"
            :min="1"
            :max="100000"
            :disabled="!config.filterOnline.enabled"
            size="small"
          >
            <template #suffix><span class="input-prefix">人</span></template>
          </n-input-number>
        </div>
      </div>

      <!-- 交互设置分组 -->
      <div class="config-group">
        <div class="group-title">
          <n-icon size="18"><chatbox-ellipses-outline /></n-icon>
          <span>交互设置</span>
        </div>
        <div class="config-item">
          <div class="item-header card-style">
            <div style="display: flex; align-items: center; gap: 8px">
              <n-icon color="#ff4d4f" size="18"><gift-outline /></n-icon>
              <span class="item-label">自动抢红包</span>
            </div>
            <n-switch v-model:value="config.enableRedPacket" size="small" />
          </div>
        </div>
        <div class="config-item">
          <div class="item-header card-style">
            <div style="display: flex; align-items: center; gap: 8px">
              <n-icon color="#18a058" size="18"><chatbox-ellipses-outline /></n-icon>
              <span class="item-label">随机互动</span>
            </div>
            <n-switch v-model:value="config.randomInteraction.enabled" size="small" />
          </div>
        </div>
        <div class="config-item">
          <div class="item-header card-style">
            <div style="display: flex; align-items: center; gap: 8px">
              <n-icon color="#64748b" size="18"><videocam-outline /></n-icon>
              <div class="item-info">
                <span class="item-label">关闭直播画面</span>
                <span class="item-desc">该功能已临时停用，当前不会再暂停视频渲染</span>
              </div>
            </div>
            <n-switch v-model:value="config.closeLiveStream.enabled" size="small" :disabled="true" />
          </div>
        </div>
      </div>
    </div>
  </n-scrollbar>
</template>

<script setup>
import { NScrollbar, NIcon, NSwitch, NInputNumber } from 'naive-ui'
import TimeOutline from '@vicons/ionicons5/es/TimeOutline'
import ChatboxEllipsesOutline from '@vicons/ionicons5/es/ChatboxEllipsesOutline'
import GiftOutline from '@vicons/ionicons5/es/GiftOutline'
import CubeOutline from '@vicons/ionicons5/es/CubeOutline'
import VideocamOutline from '@vicons/ionicons5/es/VideocamOutline'
import WalletOutline from '@vicons/ionicons5/es/WalletOutline'

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
})
</script>

<style scoped>
.sidebar-scroll {
  flex: 1;
}

:deep(.sidebar-scroll .n-scrollbar-rail) {
  display: none !important;
}

:deep(.sidebar-scroll .n-scrollbar-container) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

:deep(.sidebar-scroll .n-scrollbar-container::-webkit-scrollbar) {
  display: none;
}

.sidebar-content {
  padding: 14px 10px 20px;
}
.config-group { margin-bottom: 18px; }
.group-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 16px; font-weight: 800; color: #2a3748;
  margin-bottom: 10px; padding-left: 4px;
}
.config-item {
  margin-bottom: 10px;
  background: linear-gradient(180deg, #f9fbfe 0%, #f2f6fb 100%);
  padding: 10px 10px;
  border-radius: 13px;
  border: 1px solid #e2e8f1;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.82) inset;
}
.item-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.item-header.card-style { align-items: center; margin-bottom: 0; }
.item-info { display: flex; flex-direction: column; }
.item-label { font-size: 14px; font-weight: 700; color: #2e3c50; }
.item-desc { font-size: 12px; color: #7c889b; margin-top: 1px; }
.input-prefix { font-size: 12px; color: #7c889b; }

:deep(.config-item .n-input-number) {
  width: 100%;
}

:deep(.config-item .n-input) {
  width: 100%;
}

:deep(.config-item .n-input-number-input) {
  font-weight: 600;
  font-size: 13px;
}

:deep(.config-item .n-switch .n-switch__rail) {
  background: #d8e2ef;
}

:deep(.config-item .n-switch.n-switch--active .n-switch__rail) {
  background: #18a058;
}

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
</style>
