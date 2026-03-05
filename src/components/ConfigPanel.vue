<template>
  <n-scrollbar class="sidebar-scroll hide-scrollbar">
    <div class="sidebar-content">
      <!-- 参与规则分组 -->
      <div class="config-group">
        <div class="group-title">
          <n-icon size="16"><flash-outline /></n-icon>
          <span>参与规则</span>
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">概率筛选</span>
              <span class="item-desc">仅参与高胜率福袋</span>
            </div>
            <n-switch v-model:value="config.hitRate.enabled" size="small" />
          </div>
          <n-input-number 
            v-model:value="config.hitRate.value" 
            :min="0.01" :max="1" :step="0.01"
            :disabled="!config.hitRate.enabled"
            size="small"
            placeholder="0.1"
          >
            <template #prefix><span class="input-prefix">概率</span></template>
          </n-input-number>
        </div>
        <div class="config-item">
          <div class="item-header">
            <div class="item-info">
              <span class="item-label">二次复检</span>
              <span class="item-desc">参与前再次确认</span>
            </div>
            <n-switch v-model:value="config.secondInspect.enabled" size="small" />
          </div>
          <n-input-number 
            v-model:value="config.secondInspect.value" 
            :min="0.01" :max="1" :step="0.01"
            :disabled="!config.secondInspect.enabled"
            size="small"
            placeholder="0.05"
          >
            <template #prefix><span class="input-prefix">概率</span></template>
          </n-input-number>
        </div>
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
          <div class="item-header card-style">
            <div class="item-info">
              <span class="item-label">过滤粉丝团</span>
              <span class="item-desc">跳过需加入粉丝团的福袋</span>
            </div>
            <n-switch v-model:value="config.filterFanClub.enabled" size="small" />
          </div>
        </div>
      </div>

      <!-- 时间与限制分组 -->
      <div class="config-group">
        <div class="group-title">
          <n-icon size="16"><time-outline /></n-icon>
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
          <n-icon size="16"><chatbox-ellipses-outline /></n-icon>
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
      </div>
    </div>
  </n-scrollbar>
</template>

<script setup>
import { NScrollbar, NIcon, NSwitch, NInputNumber } from 'naive-ui'
import { FlashOutline, TimeOutline, ChatboxEllipsesOutline, GiftOutline } from '@vicons/ionicons5'

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
.sidebar-content {
  padding: 16px 14px;
}
.config-group { margin-bottom: 16px; }
.group-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: #2f3a33;
  margin-bottom: 12px; padding-left: 4px;
}
.config-item {
  margin-bottom: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdfb 100%);
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #edf2ee;
}
.item-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.item-header.card-style { align-items: center; margin-bottom: 0; }
.item-info { display: flex; flex-direction: column; }
.item-label { font-size: 13px; font-weight: 500; color: #333; }
.item-desc { font-size: 11px; color: #8f9a92; }
.input-prefix { font-size: 12px; color: #8f9a92; }

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
</style>
