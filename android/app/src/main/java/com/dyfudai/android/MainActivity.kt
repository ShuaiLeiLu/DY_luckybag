package com.dyfudai.android

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/**
 * Android 端入口占位。协议层位于 protocol 包，签名供应商必须由授权的 Android
 * TicketGuard/SDK 集成提供；这里不生成或伪造第三方设备证明。
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "抖娃福袋 Android\n协议层已初始化，等待授权的签名实现"
        })
    }
}
