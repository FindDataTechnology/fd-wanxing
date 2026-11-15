// labels 单测：已知枚举译出人读文案，未命中原样通过（D6 的 fail-open 判据）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { label, isTranslated, LABEL_DICT } from "../src/labels.js";

test("已知内部枚举译成访客可读中文", () => {
  assert.equal(label("wire"), "柏讯");
  assert.equal(label("lex"), "识律");
  assert.equal(label("security-pending"), "待安全复核");
  assert.equal(label("M2"), "里程碑 2");
});

test("未命中原样返回，不吞掉", () => {
  assert.equal(label("some-new-tag"), "some-new-tag");
  assert.equal(label("xyzzy"), "xyzzy");
  assert.equal(label(""), "");
  assert.equal(label(undefined), "");
});

test("isTranslated 区分译过与没译过", () => {
  assert.equal(isTranslated("wire"), true);
  assert.equal(isTranslated("xyzzy"), false);
  assert.equal(isTranslated(undefined), false);
});

test("字典的每个值都不为空——字典里不该有空白条目", () => {
  for (const [k, v] of Object.entries(LABEL_DICT)) {
    assert.ok(typeof v === "string" && v.trim().length > 0, `字典条目 ${k} 的译文为空`);
  }
});
