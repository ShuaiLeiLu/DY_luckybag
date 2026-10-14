package com.dyfudai.android.protocol

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * 原生 Android 协议传输层。签名在发送前由 TicketGuardSigner 注入，传输层不会
 * 自行补 x-argus、ticket 或设备字段。
 */
class DouyinAndroidProtocolClient(
    private val baseUrl: String = "https://webcast.amemv.com",
    private val signer: TicketGuardSigner,
    private val userAgent: String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 10_000
) {
    private val protocol = DouyinLotteryProtocol(signer)

    @Throws(IOException::class)
    fun fetchLotteryInfo(input: LotteryInfoRequest): ProtocolResponse {
        return execute(protocol.buildLotteryInfoRequest(input))
    }

    @Throws(IOException::class)
    fun attendLottery(input: LotteryAttendRequest): ProtocolResponse {
        return execute(protocol.buildAttendRequest(input))
    }

    @Throws(IOException::class)
    fun queryLotteryInfo(input: LotteryInfoRequest): LotteryInfoResult {
        val response = fetchLotteryInfo(input)
        return DouyinLotteryParser.parseLotteryInfo(response)
    }

    @Throws(IOException::class)
    fun submitAttendLottery(input: LotteryAttendRequest): AttendLotteryResult {
        val response = attendLottery(input)
        return DouyinLotteryParser.parseAttendResult(response)
    }

    @Throws(IOException::class)
    private fun execute(request: AndroidSignedRequest): ProtocolResponse {
        val url = URL(baseUrl.trimEnd('/') + request.uri.toString())
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = request.method
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            useCaches = false
            doInput = true
            setRequestProperty("User-Agent", userAgent)
            request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
            if (request.body != null) {
                doOutput = true
                fixedLengthStreamingMode(request.body.size)
            }
        }

        try {
            request.body?.let { body ->
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..399) connection.inputStream else connection.errorStream
            val body = stream?.use { it.readBytes().toString(StandardCharsets.UTF_8) }.orEmpty()
            return ProtocolResponse(status, body, connection.headerFields)
        } finally {
            connection.disconnect()
        }
    }
}

data class ProtocolResponse(
    val statusCode: Int,
    val body: String,
    val headers: Map<String, List<String>> = emptyMap()
)
