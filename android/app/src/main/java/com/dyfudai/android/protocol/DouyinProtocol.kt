package com.dyfudai.android.protocol

import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Android APK 中 TicketGuard 请求上下文的最小字段投影。
 * 字段名来自 APK 静态分析，不代表可以脱离官方运行时自行生成有效值。
 */
data class TicketGuardRequestContext(
    val signPath: String,
    val signTicket: String = "",
    val ticketType: String = "",
    val signTimestamp: Long = 0L,
    val reeKeyFrom: String = "",
    val ecdhKeyFrom: String = "",
    val signReqParamTimestampMs: Long = 0L,
    val signRetryCount: Int = 0,
    val withTicketGuard: Boolean = true,
    val isTicketInit: Boolean = false,
    val hasGetTicket: Boolean = false,
    val cacheConfigType: Int = 0,
    val cacheHitType: Int = 0,
    val cacheSignType: Int = 0,
    val reeSign: String = "",
    val hmacSign: String = "",
    val teeReqSign: String = "",
    val teePub: String = "",
    val teeCredential: String = ""
)

data class AndroidSignedRequest(
    val method: String,
    val uri: URI,
    val headers: Map<String, String> = emptyMap(),
    val body: ByteArray? = null
)

/**
 * 签名实现的授权边界。
 * 生产实现应接入合法的 Android 安全 SDK/客户端运行时，而不是离线伪造 x-argus。
 */
interface TicketGuardSigner {
    fun sign(request: AndroidSignedRequest, context: TicketGuardRequestContext): AndroidSignedRequest
}

class MissingAuthorizedTicketGuardSigner : TicketGuardSigner {
    override fun sign(
        request: AndroidSignedRequest,
        context: TicketGuardRequestContext
    ): AndroidSignedRequest {
        error(
            "No authorized Android TicketGuard provider configured for ${context.signPath}; " +
                "the protocol requires runtime ticket, TEE/REE and attestation state."
        )
    }
}

data class LotteryInfoRequest(
    val roomId: String,
    val liveId: Int = 1,
    val enterFrom: String = "link_share",
    val queryFrom: Int = 1
)

data class LotteryAttendRequest(
    val roomId: String,
    val lotteryId: String
)

data class RoomDiggRequest(
    val roomId: String,
    val count: Int = 1
)

data class RoomChatRequest(
    val roomId: String,
    val content: String
)

object DouyinLotteryEndpoints {
    const val LOTTERY_INFO = "/webcast/lottery/melon/lottery_info/"
    const val LOTTERY_MELON = "/webcast/lottery/melon/"
    const val OPENAPI_LOTTERY_MELON = "/webcast/openapi/lottery/melon/"
    const val LUCKYBOX_LIST = "/webcast/luckybox/box/list/"
    const val FEED = "/webcast/feed/"
    const val PARTITION_DETAIL_ROOM = "/webcast/web/partition/detail/room/"
    const val ROOM_ENTER = "/webcast/room/enter/"
    const val ROOM_DIGG = "/webcast/room/digg/"
    const val ROOM_CHAT = "/webcast/room/chat/"
    const val TICKET_GUARD_VERIFY_PUB_KEY = "/passport/ticket_guard/verify_pub_key/"
}

object FormUrlEncoder {
    fun encodeParam(value: String): String {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    }

    fun encode(params: Map<String, String>): String {
        return params.entries.joinToString("&") { (key, value) ->
            "${encodeParam(key)}=${encodeParam(value)}"
        }
    }
}

/**
 * 只负责把福袋业务参数映射到 Android 协议请求，不负责生成第三方签名。
 */
class DouyinLotteryProtocol(
    private val signer: TicketGuardSigner
) {
    fun buildLotteryInfoRequest(input: LotteryInfoRequest): AndroidSignedRequest {
        require(input.roomId.isNotBlank()) { "roomId must not be blank" }
        val query = FormUrlEncoder.encode(
            linkedMapOf(
                "live_id" to input.liveId.toString(),
                "enter_from" to input.enterFrom,
                "room_id" to input.roomId,
                "query_from" to input.queryFrom.toString()
            )
        )
        val uri = URI.create("${DouyinLotteryEndpoints.LOTTERY_INFO}?$query")
        val unsigned = AndroidSignedRequest("GET", uri)
        return signer.sign(
            unsigned,
            TicketGuardRequestContext(signPath = DouyinLotteryEndpoints.LOTTERY_INFO)
        )
    }

    fun buildAttendRequest(input: LotteryAttendRequest): AndroidSignedRequest {
        require(input.roomId.isNotBlank()) { "roomId must not be blank" }
        require(input.lotteryId.isNotBlank()) { "lotteryId must not be blank" }
        val formBody = FormUrlEncoder.encode(
            linkedMapOf(
                "room_id" to input.roomId,
                "lottery_id" to input.lotteryId
            )
        )
        val unsigned = AndroidSignedRequest(
            method = "POST",
            uri = URI.create(DouyinLotteryEndpoints.LOTTERY_MELON),
            headers = mapOf("content-type" to "application/x-www-form-urlencoded"),
            body = formBody.toByteArray(StandardCharsets.UTF_8)
        )
        return signer.sign(
            unsigned,
            TicketGuardRequestContext(signPath = DouyinLotteryEndpoints.LOTTERY_MELON)
        )
    }
}
