package com.dyfudai.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets

class AndroidRequestEncoderTest {

    @Test
    fun `FormUrlEncoder properly encodes special characters`() {
        val params = linkedMapOf(
            "room_id" to "room 123 & special",
            "tag" to "福袋"
        )
        val encoded = FormUrlEncoder.encode(params)

        assertEquals("room_id=room+123+%26+special&tag=%E7%A6%8F%E8%A2%8B", encoded)
    }

    @Test
    fun `buildLotteryInfoRequest applies url encoding to query parameters`() {
        val signer = object : TicketGuardSigner {
            override fun sign(
                request: AndroidSignedRequest,
                context: TicketGuardRequestContext
            ): AndroidSignedRequest = request
        }

        val protocol = DouyinLotteryProtocol(signer)
        val request = protocol.buildLotteryInfoRequest(
            LotteryInfoRequest(roomId = "room#123", enterFrom = "share & test")
        )

        assertTrue(request.uri.query.contains("room_id=room%23123"))
        assertTrue(request.uri.query.contains("enter_from=share+%26+test"))
    }

    @Test
    fun `buildAttendRequest applies url encoding to post body`() {
        val signer = object : TicketGuardSigner {
            override fun sign(
                request: AndroidSignedRequest,
                context: TicketGuardRequestContext
            ): AndroidSignedRequest = request
        }

        val protocol = DouyinLotteryProtocol(signer)
        val request = protocol.buildAttendRequest(
            LotteryAttendRequest(roomId = "room/456", lotteryId = "id=789")
        )

        val bodyString = request.body?.let { String(it, StandardCharsets.UTF_8) } ?: ""
        assertEquals("room_id=room%2F456&lottery_id=id%3D789", bodyString)
    }
}
