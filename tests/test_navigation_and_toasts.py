from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_toast_can_show_and_update_operation_status():
    ui_js = (ROOT / "pwa" / "js" / "ui.js").read_text(encoding="utf-8")
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert "status = 'info'" in ui_js
    assert "update(nextMessage" in ui_js
    assert "scheduleDismiss(duration);" in ui_js
    assert ".toast--loading::before" in app_css
    assert "@keyframes toastSpin" in app_css


def test_note_send_status_distinguishes_slow_offline_and_retry_states():
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "正在发送笔记" in app_js
    assert "连接较慢，仍在发送笔记" in app_js
    assert "连接已断开，笔记已保存到本地" in app_js
    assert "网络已恢复，正在重试发送" in app_js
    assert "连接仍不稳定" in app_js


def test_save_and_workspace_rename_show_progress_toasts():
    editor_js = (ROOT / "pwa" / "js" / "editor.js").read_text(encoding="utf-8")
    workspaces_js = (ROOT / "pwa" / "js" / "workspaces.js").read_text(encoding="utf-8")

    assert "正在保存笔记修改" in editor_js
    assert "笔记修改已保存" in editor_js
    assert "正在修改分区文件名" in workspaces_js
    assert "分区文件名已修改为" in workspaces_js


def test_back_gesture_closes_transient_ui_before_navigation():
    ui_js = (ROOT / "pwa" / "js" / "ui.js").read_text(encoding="utf-8")
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "export function closeTransientUi()" in ui_js
    assert "window.addEventListener('popstate'" in ui_js
    assert "history.pushState(navigationState(current), '')" in ui_js
    assert "editorCancel.click();" in ui_js
    assert "textInput?.blur();" in ui_js
    assert "navigateBack()" in app_js
