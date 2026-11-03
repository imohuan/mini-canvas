#!/usr/bin/env python3
"""用临时文档验证检查器不会放过未完成的「已完成」标记。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import check_issue_docs


PLAN_DOC = """# 01 · 示例问题

- 状态：{status}
- 负责人：未领取
- 完成时间：—

## 你的原话

> 示例。

## 要解决的问题

示例。

## 范围与位置

- 页面：示例页面
- 参考代码：无
- 相关资源：无
- 关联问题：无

## 现在 vs 期望

| | 现在 | 期望 |
| --- | --- | --- |
| 示例 | 旧 | 新 |

## 问题原因

- 状态：推测
- 根因：示例。

## 修改方案

- 怎么改：示例。

## 验收标准

- [{check}] 示例验收项

## 不能动

- 示例。

## 假设与待确认

- 待确认：无

## 执行指令

示例。

## 图片

本问题没有图片

## 执行记录

- 改动文件：{changed}
- 验证命令与结果：{verification}
- 完成时间：{finished}
"""


class CheckIssueDocsTest(unittest.TestCase):
    def check(self, **values: str) -> list[str]:
        defaults = {
            "status": "待确认",
            "check": " ",
            "changed": "无",
            "verification": "无",
            "finished": "—",
        }
        defaults.update(values)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "01-示例问题.md"
            path.write_text(PLAN_DOC.format(**defaults), encoding="utf-8")
            return check_issue_docs.check_issue(path, root)

    def test_plan_document_is_complete(self) -> None:
        self.assertEqual(self.check(), [])

    def test_completed_document_needs_unchecked_criteria_done(self) -> None:
        errors = self.check(status="已完成")
        self.assertTrue(any("验收标准没勾选" in error for error in errors))

    def test_completed_document_needs_real_completion_record(self) -> None:
        errors = self.check(
            status="已完成",
            check="x",
            changed="",
            verification="",
            finished="",
        )
        self.assertTrue(any("改动文件" in error for error in errors))
        self.assertTrue(any("验证命令与结果" in error for error in errors))
        self.assertTrue(any("完成时间" in error for error in errors))

    def test_completed_document_passes_when_everything_is_done(self) -> None:
        errors = self.check(
            status="已完成",
            check="x",
            changed="packages/ui/src/example.vue",
            verification="pnpm test（通过）",
            finished="2026-11-03 11:00",
        )
        self.assertEqual(errors, [])

    def test_custom_heading_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "01-示例问题.md"
            path.write_text(
                PLAN_DOC.format(
                    status="待确认",
                    check=" ",
                    changed="无",
                    verification="无",
                    finished="—",
                ).replace("## 修改方案", "## 修改方案（待确认）"),
                encoding="utf-8",
            )
            errors = check_issue_docs.check_issue(path, root)
        self.assertTrue(any("多余小节" in error for error in errors))
        self.assertTrue(any("缺少小节：## 修改方案" in error for error in errors))

    def test_heading_must_match_file_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "01-示例问题.md"
            path.write_text(
                PLAN_DOC.format(
                    status="待确认",
                    check=" ",
                    changed="无",
                    verification="无",
                    finished="—",
                ).replace("# 01 · 示例问题", "# 01 · 另一个标题"),
                encoding="utf-8",
            )
            errors = check_issue_docs.check_issue(path, root)
        self.assertTrue(any("标题应写成" in error for error in errors))

    def test_section_order_is_fixed(self) -> None:
        text = PLAN_DOC.format(
            status="待确认",
            check=" ",
            changed="无",
            verification="无",
            finished="—",
        )
        wrong = text.replace("## 问题原因", "## TEMP").replace(
            "## 修改方案", "## 问题原因"
        ).replace("## TEMP", "## 修改方案")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "01-示例问题.md"
            path.write_text(wrong, encoding="utf-8")
            errors = check_issue_docs.check_issue(path, root)
        self.assertTrue(any("小节顺序" in error for error in errors))

    def test_header_order_is_fixed(self) -> None:
        text = PLAN_DOC.format(
            status="待确认",
            check=" ",
            changed="无",
            verification="无",
            finished="—",
        )
        wrong = text.replace(
            "- 状态：待确认\n- 负责人：未领取\n- 完成时间：—",
            "- 负责人：未领取\n- 状态：待确认\n- 完成时间：—",
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "01-示例问题.md"
            path.write_text(wrong, encoding="utf-8")
            errors = check_issue_docs.check_issue(path, root)
        self.assertTrue(any("头部只能按顺序写" in error for error in errors))

    def test_placeholder_is_rejected(self) -> None:
        text = PLAN_DOC.format(
            status="待确认",
            check=" ",
            changed="无",
            verification="无",
            finished="—",
        ).replace("- 根因：示例。", "- 根因：待补充")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "01-示例问题.md"
            path.write_text(text, encoding="utf-8")
            errors = check_issue_docs.check_issue(path, root)
        self.assertTrue(any("占位没填" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
