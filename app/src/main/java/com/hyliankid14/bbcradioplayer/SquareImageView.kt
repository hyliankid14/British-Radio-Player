package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatImageView

class SquareImageView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : AppCompatImageView(context, attrs, defStyleAttr) {

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)

        val widthLimit = if (measuredWidth > 0) measuredWidth else MeasureSpec.getSize(widthMeasureSpec)
        val heightLimit = if (measuredHeight > 0) measuredHeight else MeasureSpec.getSize(heightMeasureSpec)
        val size = when {
            widthLimit > 0 && heightLimit > 0 -> minOf(widthLimit, heightLimit)
            widthLimit > 0 -> widthLimit
            else -> heightLimit
        }

        setMeasuredDimension(size, size)
    }
}
