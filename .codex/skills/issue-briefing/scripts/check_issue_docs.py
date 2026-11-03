#!/usr/bin/env python3
"""检查问题整理目录是否完整、可直接交给执行 AI。"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


REQUIRED_SECTIONS = (
    "你的原话",
    "要解决的问题",
    "范围与位置",
    "现在 vs 期望",
    "验收标准",
    "不能动",
    "假设与待确认",
    "给执行 AI 的指令",
    "图片",
)
ISSUE_PATTERN = re.compile(r"^(?P<number>\d{2,})-(?P<title>.+)\.md$")
IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
STUB_PATTERN = re.compile(r"\[TODO|TODO[:：]")


def sections(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    matches = list(re.finditer(r"^##\s+(.+?)\s*$", text, re.MULTILINE))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result[match.group(1).strip()] = text[match.end() : end].strip()
    return result


def check_issue(path: Path, root: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    found = sections(text)

    for name in REQUIRED_SECTIONS:
        if name not in found:
            errors.append(f"缺少小节：## {name}")
        elif not found[name]:
            errors.append(f"小节为空：## {name}")

    images = IMAGE_PATTERN.findall(text)
    image_section = found.get("图片", "")
    if not images and "本问题没有图片" not in image_section and "待补图" not in image_section:
        errors.append("图片小节没有引用图片，也没有写「本问题没有图片」或「待补图」")

    criteria = found.get("验收标准", "")
    if "- [ ]" not in criteria and "- [x]" not in criteria.lower():
        errors.append("验收标准至少要有一条复选框")

    if STUB_PATTERN.search(text):
        errors.append("还留有 TODO 占位")

    for raw_target in images:
        target = raw_target.strip().split()[0].strip("<>\"'")
        if target.startswith(("http://", "https://", "data:")):
            continue
        cleaned = unquote(target.split("#", 1)[0].split("?", 1)[0])
        image_path = (path.parent / cleaned).resolve()
        try:
            image_path.relative_to(root.resolve())
        except ValueError:
            errors.append(f"图片不能指向目录外：{target}")
            continue
        if not image_path.is_file():
            errors.append(f"图片不存在：{target}")

    return errors


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/问题整理").resolve()
    if not root.is_dir():
        print(f"[ERROR] 目录不存在：{root}")
        return 1

    readme = root / "README.md"
    if not readme.is_file():
        print("[ERROR] 缺少 README.md")
        return 1
    readme_text = readme.read_text(encoding="utf-8")

    issues = sorted(
        (path for path in root.glob("*.md") if ISSUE_PATTERN.match(path.name)),
        key=lambda path: path.name,
    )
    failed = False
    seen_numbers: dict[str, Path] = {}

    for issue in issues:
        number = ISSUE_PATTERN.match(issue.name).group("number")
        if number in seen_numbers:
            print(f"[ERROR] 编号重复：{number}（{seen_numbers[number].name} / {issue.name}）")
            failed = True
        else:
            seen_numbers[number] = issue

        errors = check_issue(issue, root)
        if errors:
            failed = True
            print(f"[FAIL] {issue.name}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"[OK] {issue.name}")

        if issue.name not in readme_text:
            failed = True
            print(f"  - README.md 没有列出：{issue.name}")

    if not issues:
        print("[OK] 还没有问题文件")
    print(f"共检查 {len(issues)} 篇问题。")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
