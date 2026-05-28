"""Tag-to-safe-filename conversion with collision detection."""
import hashlib
import re

ILLEGAL_CHARS = re.compile(r'[/\\:*?"<>|]')
MAX_LEN = 100

def sanitize(tag: str) -> str:
    if not tag or not tag.strip():
        return "untagged"
    slug = ILLEGAL_CHARS.sub("_", tag.strip())
    slug = slug.strip(". ")
    if len(slug) > MAX_LEN:
        slug = slug[:MAX_LEN]
    return slug or "untagged"

def build_tag_map(tags: list[str]) -> dict[str, str]:
    slug_to_tags: dict[str, list[str]] = {}
    for tag in sorted(set(tags)):
        slug = sanitize(tag)
        slug_to_tags.setdefault(slug, []).append(tag)

    result = {}
    for slug, tag_list in slug_to_tags.items():
        if len(tag_list) == 1:
            result[tag_list[0]] = f"{slug}.md"
        else:
            for tag in tag_list:
                short_hash = hashlib.sha256(tag.encode()).hexdigest()[:6]
                result[tag] = f"{slug}__{short_hash}.md"
    return result
