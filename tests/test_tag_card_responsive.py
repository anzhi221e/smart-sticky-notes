from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_tag_card_columns_share_mobile_width_evenly():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert "grid-template-columns: repeat(2, minmax(0, 1fr));" in app_css
    assert ".tag-cards-grid {" in app_css
    assert "width: 100%; min-width: 0;" in app_css
    assert "gap: 10px; padding: 8px 0;" in app_css
    assert ".tag-card {" in app_css
    assert "min-width: 0; overflow: hidden;" in app_css


def test_long_tag_text_cannot_expand_a_grid_column():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert ".tag-name {" in app_css
    assert ".tag-card-preview {" in app_css
    assert app_css.count("overflow-wrap: anywhere; word-break: break-word;") >= 2
    assert "flex-shrink: 0; white-space: nowrap;" in app_css
