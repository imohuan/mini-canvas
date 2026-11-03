#!/usr/bin/env python3
"""检查一篇问题文档是否符合统一任务结构，并核对完成标记。"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


SECTIONS = (
    "你的原话",
    "要解决的问题",
    "范围与位置",
    "现在 vs 期望",
    "问题原因",
    "修改方案",
    "验收标准",
    "不能动",
    "假设与待确认",
    "执行指令",
    "图片",
    "执行记录",
)
META_KEYS = ("状态", "负责人", "完成时间")
RECORD_KEYS = ("改动文件", "验证命令与结果", "完成时间")
STATUSES = {"等补充", "待确认", "进行中", "已完成"}
IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
STUB_PATTERN = re.compile(r"\[TODO|TODO[:：]")
ISSUE_PATTERN = re.compile(r"^(?P<number>\d{2,})-(?P<title>.+)\.md$")
PLACEHOLDERS = {
    "待补充",
    "待确认",
    "未开始",
    "未运行",
    "相对路径:行号或函数名",
    "images/编号-说明.png",
}


def sections(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    matches = list(re.finditer(r"^##\s+(.+?)\s*$", text, re.MULTILINE))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result[match.group(1).strip()] = text[match.end() : end].strip()
    return result


def field(text: str, label: str) -> str:
    match = re.search(rf"^- {re.escape(label)}：(.+)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def check_issue(path: Path, root: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    found = sections(text)
    status = field(text, "状态")

    heading = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    if not heading:
        errors.append("缺少一级标题")
    else:
        match = ISSUE_PATTERN.match(path.name)
        if match:
            expected = f"{match.group('number')} · {match.group('title')}"
            if heading.group(1).strip() != expected:
                errors.append(f"标题应写成「# {expected}」")

    if not status:
        errors.append("开头缺少「- 状态：…」标记")
    elif status not in STATUSES:
        errors.append(f"状态无效：{status}（只能用：{'、'.join(sorted(STATUSES))}）")

    for label in META_KEYS:
        if label != "状态" and not field(text, label):
            errors.append(f"开头缺少「- {label}：…」标记")

    for name in SECTIONS:
        if name not in found:
            errors.append(f"缺少小节：## {name}")
        elif not found[name]:
            errors.append(f"小节为空：## {name}")

    for field_name in ("页面", "参考代码", "相关资源", "关联问题"):
        if not field(found.get("范围与位置", ""), field_name):
            errors.append(f"范围与位置缺少「- {field_name}：…」")

    comparison = found.get("现在 vs 期望", "")
    rows = re.findall(r"^\|.*\|$", comparison, re.MULTILINE)
    if len(rows) < 3:
        errors.append("现在 vs 期望至少要有表头和一行对比")

    order = [name for name in SECTIONS if name in found]
    actual_order = [name for name in found if name in SECTIONS]
    if actual_order != order:
        errors.append("小节顺序不符合 task-v1 固定结构")

    extra = set(found) - set(SECTIONS)
    for name in sorted(extra):
        errors.append(f"多余小节：## {name}（统一结构不允许自定义标题）")

    top_fields = re.findall(r"^-[^-].*$", text.split("## ", 1)[0], re.MULTILINE)
    labels = [line.split("：", 1)[0].strip("- ") for line in top_fields]
    if any(label not in META_KEYS for label in labels) or labels != [
        label for label in META_KEYS if label in labels
    ]:
        errors.append("头部只能按顺序写：状态 / 负责人 / 完成时间")

    images = IMAGE_PATTERN.findall(text)
    image_section = found.get("图片", "")
    if not images and "本问题没有图片" not in image_section and "待补图" not in image_section:
        errors.append("图片小节没有引用图片，也没有写「本问题没有图片」或「待补图」")

    for name in ("范围与位置", "问题原因", "修改方案", "执行记录"):
        section = found.get(name, "")
        for line in section.splitlines():
            if re.match(r"^- [^：]+：$", line) and "（可选）" not in line:
                errors.append(f"{name} 还有空字段：{line.strip()}")
            elif "：" in line and line.startswith("- "):
                value = line.split("：", 1)[1].strip()
                if value in PLACEHOLDERS:
                    errors.append(f"{name} 还有占位没填：{line.strip()}")

    criteria = found.get("验收标准", "")
    if "- [ ]" not in criteria and "- [x]" not in criteria.lower():
        errors.append("验收标准至少要有一条复选框")

    if status == "已完成":
        unchecked = re.findall(r"^- \[ \] .+$", criteria, re.MULTILINE)
        if unchecked:
            errors.append(f"已标记完成，但还有 {len(unchecked)} 条验收标准没勾选")
        record = found.get("执行记录", "")
        for label in RECORD_KEYS:
            value = field(record, label)
            if not value or value in {"无", "—", "-"}:
                errors.append(f"已完成，但「执行记录」缺少可核对的 {label}")

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
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/问题整理").resolve()
    if target.is_file():
        issues = [target]
        root = target.parent
    elif target.is_dir():
        issues = sorted(
            (path for path in target.glob("*.md") if ISSUE_PATTERN.match(path.name)),
            key=lambda path: path.name,
        )
        root = target
        if not issues:
            print(f"[ERROR] 目录中没有问题文档：{target}")
            return 1

        seen: dict[str, Path] = {}
        for issue in issues:
            number = ISSUE_PATTERN.match(issue.name).group("number")
            if number in seen:
                print(
                    f"[ERROR] 编号重复：{number}（{seen[number].name} / {issue.name}）"
                )
                return 1
            seen[number] = issue
    else:
        print(f"[ERROR] 路径不存在：{target}")
        return 1

    failed = False
    for issue in issues:
        errors = check_issue(issue, root)
        if errors:
            failed = True
            print(f"[FAIL] {issue.name}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"[OK] {issue.name}")

    print(f"共检查 {len(issues)} 篇问题。")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
