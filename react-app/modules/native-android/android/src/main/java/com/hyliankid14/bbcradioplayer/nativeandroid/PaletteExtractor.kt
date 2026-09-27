package com.hyliankid14.bbcradioplayer.nativeandroid

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.palette.graphics.Palette
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Extracts a Material palette from artwork and derives the adaptive Now Playing colours,
 * mirroring the logic in the legacy Kotlin `NowPlayingActivity`.
 */
object PaletteExtractor {

  /** Downloads [imageUrl] and returns the derived colour set, or "{}" on failure. */
  fun extract(imageUrl: String, isDarkMode: Boolean): JSONObject {
    if (imageUrl.isBlank()) return JSONObject()
    if (isPlaceholderUrl(imageUrl)) {
      return JSONObject().apply { put("isPlaceholder", true) }
    }
    val bitmap = downloadBitmap(imageUrl) ?: return JSONObject()
    return try {
      if (isPlaceholderBitmap(bitmap)) {
        return JSONObject().apply { put("isPlaceholder", true) }
      }
      val palette = Palette.from(bitmap).generate()
      val dominant = if (isDarkMode) {
        palette.darkMutedSwatch?.rgb
          ?: palette.darkVibrantSwatch?.rgb
          ?: palette.mutedSwatch?.rgb
          ?: palette.dominantSwatch?.rgb
      } else {
        palette.lightMutedSwatch?.rgb
          ?: palette.lightVibrantSwatch?.rgb
          ?: palette.mutedSwatch?.rgb
          ?: palette.dominantSwatch?.rgb
      } ?: palette.dominantSwatch?.rgb ?: return JSONObject()
      derive(dominant, isDarkMode)
    } finally {
      bitmap.recycle()
    }
  }

  private fun isPlaceholderUrl(url: String): Boolean {
    val lower = url.lowercase()
    return lower.contains("p0bqcdzf") ||
           lower.contains("p01tqv8z") ||
           lower.contains("default") ||
           lower.contains("placeholder")
  }

  private fun isPlaceholderBitmap(bitmap: Bitmap): Boolean {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return true

    val samplePoints = listOf(
      Pair(width / 2, height / 2),
      Pair(width / 4, height / 4),
      Pair(3 * width / 4, height / 4),
      Pair(width / 4, 3 * height / 4),
      Pair(3 * width / 4, 3 * height / 4),
      Pair(width / 2, height / 4),
      Pair(width / 2, 3 * height / 4)
    )

    val firstPixel = bitmap.getPixel(samplePoints[0].first, samplePoints[0].second)
    val firstR = Color.red(firstPixel)
    val firstG = Color.green(firstPixel)
    val firstB = Color.blue(firstPixel)

    // Check if the sampled pixel is grey (R, G, B channels very close to each other)
    val isGrey = Math.abs(firstR - firstG) <= 6 && Math.abs(firstR - firstB) <= 6

    // Check if all samples are virtually identical to firstPixel
    val isUniform = samplePoints.all { (x, y) ->
      val p = bitmap.getPixel(x, y)
      Math.abs(Color.red(p) - firstR) <= 6 &&
      Math.abs(Color.green(p) - firstG) <= 6 &&
      Math.abs(Color.blue(p) - firstB) <= 6
    }

    return isUniform && isGrey
  }

  private fun derive(dominantColor: Int, isDarkMode: Boolean): JSONObject {
    val red = (dominantColor shr 16) and 0xFF
    val green = (dominantColor shr 8) and 0xFF
    val blue = dominantColor and 0xFF

    val subtle = if (isDarkMode) {
      val factor = 0.4f
      Color.rgb((red * factor).toInt(), (green * factor).toInt(), (blue * factor).toInt())
    } else {
      val factor = 0.7f
      Color.rgb(
        255 - ((255 - red) * (1 - factor)).toInt(),
        255 - ((255 - green) * (1 - factor)).toInt(),
        255 - ((255 - blue) * (1 - factor)).toInt()
      )
    }

    val r = ((subtle shr 16) and 0xFF) / 255f
    val g = ((subtle shr 8) and 0xFF) / 255f
    val b = (subtle and 0xFF) / 255f
    val luminance = 0.299 * r + 0.587 * g + 0.114 * b
    val isLight = luminance > 0.5f

    val buttonOutline = if (isLight) {
      Color.rgb((red * 0.7f).toInt(), (green * 0.7f).toInt(), (blue * 0.7f).toInt())
    } else {
      Color.rgb((red + 255) / 2, (green + 255) / 2, (blue + 255) / 2)
    }

    val playPause = if (isLight) {
      Color.rgb((red * 0.8f).toInt(), (green * 0.8f).toInt(), (blue * 0.8f).toInt())
    } else {
      Color.rgb(
        (red * 0.5f + 255 * 0.5f).toInt(),
        (green * 0.5f + 255 * 0.5f).toInt(),
        (blue * 0.5f + 255 * 0.5f).toInt()
      )
    }

    val icon = if (isLight) Color.rgb(red, green, blue) else Color.WHITE

    return JSONObject().apply {
      put("dominant", hex(dominantColor))
      put("subtle", hex(subtle))
      put("buttonOutline", hex(buttonOutline))
      put("playPause", hex(playPause))
      put("icon", hex(icon))
      put("isLight", isLight)
    }
  }

  private fun downloadBitmap(imageUrl: String): Bitmap? {
    return try {
      val connection = (URL(imageUrl).openConnection() as HttpURLConnection).apply {
        connectTimeout = 8000
        readTimeout = 8000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "BritishRadioPlayer/1.0")
      }
      connection.inputStream.use { BitmapFactory.decodeStream(it) }
    } catch (_: Exception) {
      null
    }
  }

  private fun hex(color: Int): String = String.format("#%06X", 0xFFFFFF and color)
}
