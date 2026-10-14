package com.dyfudai.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DouyinLotteryParserTest {

    @Test
    fun `parseLotteryInfo extracts all core fields correctly`() {
        val json = """
            {
                "status_code": 0,
                "data": {
                    "lottery_info": {
                        "lottery_id_str": "998877",
                        "anchor_id": "112233",
                        "candidate_num": 42,
                        "lucky_count": 3,
                        "prize_count": 10,
                        "draw_time": 1710000000,
                        "prize_info": {
                            "name": "超级盲盒"
                        }
                    }
                }
            }
        """.trimIndent()

        val response = ProtocolResponse(
            statusCode = 200,
            body = json,
            headers = emptyMap()
        )

        val result = DouyinLotteryParser.parseLotteryInfo(response)

        assertTrue(result.success)
        assertEquals("998877", result.lotteryId)
        assertEquals("112233", result.anchorId)
        assertEquals(42, result.candidateCount)
        assertEquals(3, result.luckyCount)
        assertEquals(10, result.prizeCount)
        assertEquals("超级盲盒", result.prizeName)
        assertEquals(1710000000L, result.drawTime)
    }

    @Test
    fun `parseLotteryInfo returns error on non-zero status_code`() {
        val json = """
            {
                "status_code": 20001,
                "extra": {
                    "error_msg": "直播间福袋已下架"
                }
            }
        """.trimIndent()

        val response = ProtocolResponse(statusCode = 200, body = json, headers = emptyMap())
        val result = DouyinLotteryParser.parseLotteryInfo(response)

        assertFalse(result.success)
        assertEquals("20001", result.errorCode)
        assertEquals("直播间福袋已下架", result.errorMessage)
    }

    @Test
    fun `parseAttendResult parses success and error accurately`() {
        val successJson = """
            {
                "status_code": 0,
                "data": {
                    "status": 0
                }
            }
        """.trimIndent()

        val successRes = DouyinLotteryParser.parseAttendResult(
            ProtocolResponse(statusCode = 200, body = successJson, headers = emptyMap())
        )
        assertTrue(successRes.success)
        assertEquals(0, successRes.status)

        val failJson = """
            {
                "status_code": 403,
                "data": {
                    "status": 1
                },
                "extra": {
                    "error_msg": "参与过于频繁"
                }
            }
        """.trimIndent()

        val failRes = DouyinLotteryParser.parseAttendResult(
            ProtocolResponse(statusCode = 200, body = failJson, headers = emptyMap())
        )
        assertFalse(failRes.success)
        assertEquals("403", failRes.errorCode)
        assertEquals("参与过于频繁", failRes.errorMessage)
    }
}
