import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sync"))

from markdown_writer import build_tag_files


def test_tag_file_notes_are_sorted_by_created_at_ascending():
    notes = [
        {
            "id": "bbbbbbbb-0000-0000-0000-000000000000",
            "created_at": "2026-06-09T08:24:00+08:00",
            "text": "second",
            "tags": ["booknotes"],
        },
        {
            "id": "aaaaaaaa-0000-0000-0000-000000000000",
            "created_at": "2026-06-08T11:06:00+08:00",
            "text": "first",
            "tags": ["booknotes"],
        },
        {
            "id": "cccccccc-0000-0000-0000-000000000000",
            "created_at": "2026-06-08T13:14:00+08:00",
            "text": "middle",
            "tags": ["booknotes"],
        },
    ]

    tag_files, _ = build_tag_files(notes)
    content = tag_files["booknotes.md"]

    assert content.index("06-08 11:06") < content.index("06-08 13:14")
    assert content.index("06-08 13:14") < content.index("06-09 08:24")
