package com.dyfudai.android.protocol

data class LotteryInfoResult(
    val success: Boolean,
    val lotteryId: String? = null,
    val roomId: String? = null,
    val anchorId: String? = null,
    val candidateCount: Int? = null,
    val luckyCount: Int? = null,
    val prizeCount: Int? = null,
    val prizeName: String? = null,
    val drawTime: Long? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null
)

data class AttendLotteryResult(
    val success: Boolean,
    val status: Int? = null,
    val statusCode: Int? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null
)

/**
 * 平台无关的轻量 JSON 解析器，不依赖 Android SDK 或第三方库，保证在纯 JVM 和 Android 均可稳定运行。
 */
internal class MiniJsonParser(private val text: String) {
    private var index = 0

    fun parse(): Any? {
        skipWhitespace()
        if (index >= text.length) return null
        return parseValue()
    }

    private fun parseValue(): Any? {
        skipWhitespace()
        if (index >= text.length) return null
        return when (text[index]) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> parseString()
            't', 'f' -> parseBoolean()
            'n' -> parseNull()
            else -> parseNumber()
        }
    }

    private fun parseObject(): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        index++ // skip '{'
        skipWhitespace()
        if (index < text.length && text[index] == '}') {
            index++
            return map
        }
        while (index < text.length) {
            skipWhitespace()
            if (text[index] != '"') break
            val key = parseString()
            skipWhitespace()
            if (index < text.length && text[index] == ':') {
                index++
            }
            skipWhitespace()
            val value = parseValue()
            map[key] = value
            skipWhitespace()
            if (index < text.length && text[index] == ',') {
                index++
                skipWhitespace()
            } else if (index < text.length && text[index] == '}') {
                index++
                break
            }
        }
        return map
    }

    private fun parseArray(): List<Any?> {
        val list = mutableListOf<Any?>()
        index++ // skip '['
        skipWhitespace()
        if (index < text.length && text[index] == ']') {
            index++
            return list
        }
        while (index < text.length) {
            skipWhitespace()
            val value = parseValue()
            list.add(value)
            skipWhitespace()
            if (index < text.length && text[index] == ',') {
                index++
                skipWhitespace()
            } else if (index < text.length && text[index] == ']') {
                index++
                break
            }
        }
        return list
    }

    private fun parseString(): String {
        index++ // skip opening quote
        val sb = StringBuilder()
        while (index < text.length) {
            val c = text[index++]
            if (c == '"') {
                break
            } else if (c == '\\' && index < text.length) {
                val escape = text[index++]
                when (escape) {
                    '"' -> sb.append('"')
                    '\\' -> sb.append('\\')
                    '/' -> sb.append('/')
                    'b' -> sb.append('\b')
                    'f' -> sb.append('\u000c')
                    'n' -> sb.append('\n')
                    'r' -> sb.append('\r')
                    't' -> sb.append('\t')
                    'u' -> {
                        if (index + 4 <= text.length) {
                            val hex = text.substring(index, index + 4)
                            index += 4
                            sb.append(hex.toInt(16).toChar())
                        }
                    }
                    else -> sb.append(escape)
                }
            } else {
                sb.append(c)
            }
        }
        return sb.toString()
    }

    private fun parseBoolean(): Boolean {
        return if (text.startsWith("true", index)) {
            index += 4
            true
        } else {
            index += 5
            false
        }
    }

    private fun parseNull(): Any? {
        if (text.startsWith("null", index)) {
            index += 4
        }
        return null
    }

    private fun parseNumber(): Number {
        val start = index
        if (text[index] == '-') index++
        while (index < text.length && (text[index].isDigit() || text[index] == '.' || text[index] == 'e' || text[index] == 'E' || text[index] == '+' || text[index] == '-')) {
            index++
        }
        val numStr = text.substring(start, index)
        return if (numStr.contains('.') || numStr.contains('e') || numStr.contains('E')) {
            numStr.toDoubleOrNull() ?: 0.0
        } else {
            numStr.toLongOrNull() ?: 0L
        }
    }

    private fun skipWhitespace() {
        while (index < text.length && text[index].isWhitespace()) {
            index++
        }
    }
}

object DouyinLotteryParser {
    @Suppress("UNCHECKED_CAST")
    fun parseLotteryInfo(response: ProtocolResponse): LotteryInfoResult {
        if (response.statusCode !in 200..299) {
            return LotteryInfoResult(
                success = false,
                errorCode = response.statusCode.toString(),
                errorMessage = "HTTP error code: ${response.statusCode}"
            )
        }

        val parsed = try {
            MiniJsonParser(response.body).parse() as? Map<String, Any?>
        } catch (_: Exception) {
            null
        } ?: return LotteryInfoResult(
            success = false,
            errorCode = "JSON_PARSE_ERROR",
            errorMessage = "Invalid JSON payload"
        )

        val statusCode = (parsed["status_code"] as? Number)?.toInt()
        val extra = parsed["extra"] as? Map<String, Any?>
        val errorMsg = (extra?.get("error_msg") as? String)
            ?: (extra?.get("description") as? String)
            ?: (parsed["status_msg"] as? String)
            ?: (parsed["message"] as? String)

        if (statusCode != null && statusCode != 0) {
            return LotteryInfoResult(
                success = false,
                errorCode = statusCode.toString(),
                errorMessage = errorMsg ?: "API error ($statusCode)"
            )
        }

        val data = parsed["data"] as? Map<String, Any?>
        val lotteryInfo = data?.get("lottery_info") as? Map<String, Any?>
            ?: return LotteryInfoResult(
                success = false,
                errorCode = "MISSING_LOTTERY_INFO",
                errorMessage = "No lottery_info found in data"
            )

        val lotteryId = (lotteryInfo["lottery_id_str"] as? String)
            ?: (lotteryInfo["lottery_id"]?.toString())
        val anchorId = lotteryInfo["anchor_id"]?.toString()
        val candidateCount = (lotteryInfo["candidate_num"] as? Number)?.toInt() ?: 0
        val luckyCount = (lotteryInfo["lucky_count"] as? Number)?.toInt() ?: 0
        val prizeCount = (lotteryInfo["prize_count"] as? Number)?.toInt() ?: 0
        val prizeInfo = lotteryInfo["prize_info"] as? Map<String, Any?>
        val prizeName = prizeInfo?.get("name") as? String ?: "未知奖品"
        val drawTime = (lotteryInfo["draw_time"] as? Number)?.toLong() ?: 0L

        return LotteryInfoResult(
            success = true,
            lotteryId = lotteryId,
            anchorId = anchorId,
            candidateCount = candidateCount,
            luckyCount = luckyCount,
            prizeCount = prizeCount,
            prizeName = prizeName,
            drawTime = drawTime
        )
    }

    @Suppress("UNCHECKED_CAST")
    fun parseAttendResult(response: ProtocolResponse): AttendLotteryResult {
        if (response.statusCode !in 200..299) {
            return AttendLotteryResult(
                success = false,
                statusCode = response.statusCode,
                errorCode = "HTTP_${response.statusCode}",
                errorMessage = "HTTP request failed with status ${response.statusCode}"
            )
        }

        val parsed = try {
            MiniJsonParser(response.body).parse() as? Map<String, Any?>
        } catch (_: Exception) {
            null
        } ?: return AttendLotteryResult(
            success = false,
            statusCode = response.statusCode,
            errorCode = "JSON_PARSE_ERROR",
            errorMessage = "Invalid JSON response"
        )

        val data = parsed["data"] as? Map<String, Any?>
        val extra = parsed["extra"] as? Map<String, Any?>
        val status = (data?.get("status") as? Number)?.toInt()
        val statusCode = (parsed["status_code"] as? Number)?.toInt()

        val errorMsg = (extra?.get("error_msg") as? String)
            ?: (extra?.get("description") as? String)
            ?: (data?.get("prompt") as? String)
            ?: (data?.get("toast") as? String)
            ?: (parsed["status_msg"] as? String)
            ?: (parsed["message"] as? String)

        val isSuccess = status == 0 || (status == null && statusCode == 0)

        return AttendLotteryResult(
            success = isSuccess,
            status = status,
            statusCode = statusCode,
            errorCode = if (isSuccess) null else (statusCode?.toString() ?: "ATTEND_FAILED"),
            errorMessage = if (isSuccess) null else errorMsg
        )
    }
}
