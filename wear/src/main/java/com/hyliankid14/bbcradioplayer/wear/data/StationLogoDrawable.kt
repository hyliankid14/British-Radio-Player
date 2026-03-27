package com.hyliankid14.bbcradioplayer.wear.data

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable

/**
 * Generic station artwork drawable that avoids BBC-branded logos.
 */
class StationLogoDrawable(
    backgroundColor: Int,
    private val label: String,
    circleColor: Int = Color.parseColor("#1A1A1A"),
    textColor: Int = Color.WHITE,
    private val badgeLabel: String? = null
) : Drawable() {

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = backgroundColor
    }

    private val circlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = circleColor
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = textColor
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT_BOLD, Typeface.BOLD)
    }

    private val badgeCirclePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#111111")
    }

    private val badgeTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT_BOLD, Typeface.BOLD)
    }

    override fun draw(canvas: Canvas) {
        val bounds = bounds
        val width = bounds.width().toFloat()
        val height = bounds.height().toFloat()

        canvas.drawRect(bounds, bgPaint)

        val cx = width / 2f
        val cy = height / 2f
        val radius = minOf(width, height) * 0.41f
        canvas.drawCircle(cx, cy, radius, circlePaint)

        val normalizedLabel = label.uppercase()
        val baseTextSize = radius * 1.58f
        textPaint.textSize = baseTextSize
        val maxTextWidth = radius * 1.72f
        val measuredWidth = textPaint.measureText(normalizedLabel)
        if (measuredWidth > maxTextWidth && measuredWidth > 0f) {
            textPaint.textSize = baseTextSize * (maxTextWidth / measuredWidth)
        }
        val fm = textPaint.fontMetrics
        val textY = cy - ((fm.ascent + fm.descent) / 2f)
        canvas.drawText(normalizedLabel, cx, textY, textPaint)

        val badge = badgeLabel?.trim().orEmpty()
        if (badge.isNotEmpty()) {
            val badgeRadius = minOf(width, height) * 0.12f
            val badgeCx = cx + radius * 0.78f
            val badgeCy = cy - radius * 0.78f
            canvas.drawCircle(badgeCx, badgeCy, badgeRadius, badgeCirclePaint)

            badgeTextPaint.textSize = badgeRadius * 1.4f
            val badgeTextY = badgeCy + badgeTextPaint.textSize * 0.33f
            canvas.drawText(badge, badgeCx, badgeTextY, badgeTextPaint)
        }
    }

    override fun setAlpha(alpha: Int) {
        bgPaint.alpha = alpha
        circlePaint.alpha = alpha
        textPaint.alpha = alpha
        badgeCirclePaint.alpha = alpha
        badgeTextPaint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        bgPaint.colorFilter = colorFilter
        circlePaint.colorFilter = colorFilter
        textPaint.colorFilter = colorFilter
        badgeCirclePaint.colorFilter = colorFilter
        badgeTextPaint.colorFilter = colorFilter
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun getOpacity(): Int = PixelFormat.OPAQUE

    override fun getIntrinsicWidth(): Int = 600
    override fun getIntrinsicHeight(): Int = 600
}