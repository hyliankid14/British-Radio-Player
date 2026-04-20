#pragma once

#include "lvgl.h"

#define UI_HEADER_HEIGHT 52

/**
 * Initialise the UI manager.  Must be called inside lvgl_port_lock().
 * Registers the three hardware buttons:
 *   +/KEY short-press   → volume up
 *   BOOT/- short-press  → volume down
 *   PWR short-press     → sleep display
 *   PWR hold            → power off (with message)
 */
void ui_manager_init(void);

/** Mark an LVGL object as a keyboard/selectable control for PLUS/BOOT navigation. */
void ui_mark_selectable(lv_obj_t *obj);

/** Re-scan the current screen after dynamic UI changes (e.g. list repopulation). */
void ui_refresh_navigation(void);

/** Push a new screen onto the navigation stack (max depth 8). */
void ui_push_screen(lv_obj_t *scr, lv_scr_load_anim_t anim);

/** Set the root screen directly (clears stack and loads without animation). */
void ui_set_root_screen(lv_obj_t *scr);

/** Pop the top screen and return to the previous one. */
void ui_pop_screen(void);

/** Return the currently displayed screen. */
lv_obj_t *ui_current_screen(void);

/** Create a standard header bar on @p parent with a back button and @p title. */
void ui_create_header(lv_obj_t *parent, const char *title, bool show_back);

/** Shared colour palette (16-bit RGB565 values used by lv_color_make). */
#define UI_COLOR_BBC_RED    lv_color_make(0xBB, 0x1C, 0x1C)
#define UI_COLOR_DARK_BG    lv_color_make(0x12, 0x12, 0x12)
#define UI_COLOR_CARD_BG    lv_color_make(0x1E, 0x1E, 0x1E)
#define UI_COLOR_TEXT       lv_color_make(0xFF, 0xFF, 0xFF)
#define UI_COLOR_SUBTEXT    lv_color_make(0xAA, 0xAA, 0xAA)
