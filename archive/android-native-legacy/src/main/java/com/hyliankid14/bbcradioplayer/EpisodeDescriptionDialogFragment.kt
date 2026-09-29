package com.hyliankid14.bbcradioplayer

import android.app.Dialog
import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.DialogFragment

import android.widget.ImageView
import android.widget.LinearLayout
import com.bumptech.glide.Glide

import android.view.ViewGroup
import android.view.WindowManager

class EpisodeDescriptionDialogFragment : DialogFragment() {
    private var scrollViewRef: android.widget.ScrollView? = null
    companion object {
        private const val ARG_DESCRIPTION = "description"
        private const val ARG_TITLE = "title"
        private const val ARG_IMAGE_URL = "image_url"
        
        fun newInstance(description: String, title: String = "Episode Description", imageUrl: String? = null): EpisodeDescriptionDialogFragment {
            return EpisodeDescriptionDialogFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_DESCRIPTION, description)
                    putString(ARG_TITLE, title)
                    putString(ARG_IMAGE_URL, imageUrl)
                }
            }
        }
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val description = arguments?.getString(ARG_DESCRIPTION) ?: ""
        val title = arguments?.getString(ARG_TITLE) ?: "Episode Description"
        val imageUrl = arguments?.getString(ARG_IMAGE_URL)
        
        val textView = TextView(requireContext()).apply {
            // Render HTML in the dialog so full formatting and whitespace is preserved
            text = androidx.core.text.HtmlCompat.fromHtml(description, androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY)
            textSize = 16f
            // Use themed on-surface color so text is legible in light and dark modes
            setTextColor(resources.getColor(R.color.md_theme_onSurface, requireContext().theme))
            setLineSpacing(1.4f, 1.1f)
            // Allow links to be clickable and text to be selectable
            movementMethod = android.text.method.LinkMovementMethod.getInstance()
            setTextIsSelectable(true)
            maxLines = Int.MAX_VALUE
        }

        val pad = (16 * resources.displayMetrics.density + 0.5f).toInt()
        val container = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        if (!imageUrl.isNullOrEmpty()) {
            val imageView = ImageView(requireContext()).apply {
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
                adjustViewBounds = true
                contentDescription = title
            }
            val imageHeight = (200 * resources.displayMetrics.density + 0.5f).toInt()
            val bottomMargin = (16 * resources.displayMetrics.density + 0.5f).toInt()
            val layoutParams = android.view.ViewGroup.MarginLayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                imageHeight
            ).apply {
                setMargins(0, 0, 0, bottomMargin)
            }
            container.addView(imageView, layoutParams)
            Glide.with(requireContext()).load(imageUrl).into(imageView)
        }

        container.addView(textView, android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        // Keep a reference to the ScrollView so we can measure content and constrain dialog height on start
        val scrollView = android.widget.ScrollView(requireContext()).apply {
            // Do not force the viewport to fill; allow the view to size to its content
            isFillViewport = false
            addView(container, android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT
            ))
            // assign to the class-level ref
            this@EpisodeDescriptionDialogFragment.scrollViewRef = this
        }

        return AlertDialog.Builder(requireContext())
            .setTitle(title)
            .setView(scrollView)
            .setPositiveButton("Close") { _, _ -> dismiss() }
            .create()
    }

    @Suppress("DEPRECATION")
    override fun onStart() {
        super.onStart()
        // After the dialog is shown, measure content and limit height to a reasonable maximum
        val window = dialog?.window ?: return
        val displayMetrics = resources.displayMetrics
        val maxHeight = (displayMetrics.heightPixels * 0.85).toInt()

        // Post a measurement to allow the view hierarchy to layout first
        // Pre-apply a centered constrained width immediately to avoid a visible resize on show
        try {
            val horizontalMarginDpInit = 12f // smaller margin for wider dialog
            val horizontalMarginPxInit = (horizontalMarginDpInit * resources.displayMetrics.density + 0.5f).toInt()
            val initMaxWidth = displayMetrics.widthPixels - (horizontalMarginPxInit * 2)
            window.setLayout(initMaxWidth, WindowManager.LayoutParams.WRAP_CONTENT)
            window.setGravity(android.view.Gravity.CENTER)
            // Disable animations up-front
            val attrsInit = window.attributes
            attrsInit.windowAnimations = 0
            window.attributes = attrsInit
        } catch (_: Exception) {}

        scrollViewRef?.post {
            val contentHeight = try {
                val child = scrollViewRef?.getChildAt(0)
                child?.height ?: 0
            } catch (e: Exception) { 0 }

            val targetHeight = if (contentHeight > 0 && contentHeight < maxHeight) {
                WindowManager.LayoutParams.WRAP_CONTENT
            } else {
                maxHeight
            }

            // Use a centered, constrained width rather than MATCH_PARENT to avoid an initial stretch/shift
            val horizontalMarginDp = 12f
            val horizontalMarginPx = (horizontalMarginDp * resources.displayMetrics.density + 0.5f).toInt()
            val maxWidth = displayMetrics.widthPixels - (horizontalMarginPx * 2)

            window.setLayout(maxWidth, targetHeight)
            window.setGravity(android.view.Gravity.CENTER)

            // Ensure soft input mode doesn't resize the dialog unexpectedly
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
    }
} 
