package com.dyfudai.android.protocol

data class TicketGuardRuntimeStatus(
    val available: Boolean,
    val authenticated: Boolean,
    val ticketGuardReady: Boolean,
    val accountId: String? = null,
    val capabilities: List<String> = emptyList()
)

/**
 * 高层 Android TicketGuard 适配边界，对应 APK 内部
 * TicketGuardAdapter.providerTicketHeader(...) / consumerTicketData(...)
 * 的调用形态。
 *
 * 具体实现必须来自合法的 Android 运行时/SDK；协议层不离线生成 x-argus。
 */
interface AndroidTicketGuardRuntime {
    fun checkStatus(): TicketGuardRuntimeStatus = TicketGuardRuntimeStatus(
        available = true,
        authenticated = true,
        ticketGuardReady = true,
        capabilities = listOf("lottery-info", "lottery-attend")
    )

    fun providerTicketHeader(
        requestUrl: String,
        withTicketGuard: Boolean,
        isTicketInit: Boolean,
        signPath: String
    ): List<Pair<String, String>>

    /**
     * 把服务端返回的 TicketGuard 数据交回运行时。返回值是运行时要求补充的
     * 后续请求头/状态字段，具体格式由授权 SDK 决定。
     */
    fun consumerTicketData(
        requestUrl: String,
        responseBody: String,
        responseLogId: String,
        isRetry: Boolean
    ): List<Pair<String, String>> = emptyList()
}

class RuntimeTicketGuardSigner(
    private val runtime: AndroidTicketGuardRuntime
) : TicketGuardSigner {
    override fun sign(
        request: AndroidSignedRequest,
        context: TicketGuardRequestContext
    ): AndroidSignedRequest {
        val status = runtime.checkStatus()
        if (!status.ticketGuardReady) {
            error("ANDROID_TICKET_GUARD_UNAVAILABLE: TicketGuard runtime is not ready for ${context.signPath}")
        }
        val generatedHeaders = runtime.providerTicketHeader(
            requestUrl = request.uri.toString(),
            withTicketGuard = context.withTicketGuard,
            isTicketInit = context.isTicketInit,
            signPath = context.signPath
        )
        return request.copy(headers = request.headers + generatedHeaders)
    }
}
