package com.dyfudai.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.URI

class DouyinProtocolTest {
    @Test
    fun `protocol maps lottery info path without inventing signature`() {
        val signer = object : TicketGuardSigner {
            override fun sign(
                request: AndroidSignedRequest,
                context: TicketGuardRequestContext
            ): AndroidSignedRequest {
                assertEquals(DouyinLotteryEndpoints.LOTTERY_INFO, context.signPath)
                return request.copy(headers = mapOf("x-test-signer" to "authorized-fixture"))
            }
        }
        val result = DouyinLotteryProtocol(signer).buildLotteryInfoRequest(
            LotteryInfoRequest(roomId = "123")
        )
        assertEquals("authorized-fixture", result.headers["x-test-signer"])
        assertEquals("/webcast/lottery/melon/lottery_info/", result.uri.path)
        assertEquals("123", result.uri.query.substringAfter("room_id="))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `empty lottery id is rejected before signing`() {
        DouyinLotteryProtocol(MissingAuthorizedTicketGuardSigner()).buildAttendRequest(
            LotteryAttendRequest(roomId = "123", lotteryId = "")
        )
    }
}
