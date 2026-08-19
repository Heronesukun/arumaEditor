import assert from "node:assert/strict";
import test from "node:test";
import {
  appendTrailingEditorLine,
  resolveEditorShortcut,
} from "../lib/editor-commands.mjs";

function shortcut(overrides) {
  return {
    altKey: false,
    code: "",
    ctrlKey: true,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

test("maps heading and inline formatting shortcuts", () => {
  assert.equal(
    resolveEditorShortcut(shortcut({ code: "Digit3", key: "3" })),
    "h3",
  );
  assert.equal(
    resolveEditorShortcut(
      shortcut({ ctrlKey: false, key: "b", metaKey: true }),
    ),
    "bold",
  );
  assert.equal(resolveEditorShortcut(shortcut({ key: "i" })), "italic");
  assert.equal(resolveEditorShortcut(shortcut({ key: "k" })), "link");
  assert.equal(resolveEditorShortcut(shortcut({ key: "z" })), "undo");
});

test("maps list, quote, and strikethrough shortcuts", () => {
  assert.equal(
    resolveEditorShortcut(
      shortcut({ code: "Digit7", key: "&", shiftKey: true }),
    ),
    "ordered-list",
  );
  assert.equal(
    resolveEditorShortcut(
      shortcut({ code: "Digit8", key: "*", shiftKey: true }),
    ),
    "bullet-list",
  );
  assert.equal(
    resolveEditorShortcut(
      shortcut({ code: "KeyQ", key: "q", shiftKey: true }),
    ),
    "quote",
  );
  assert.equal(
    resolveEditorShortcut(
      shortcut({ code: "KeyX", key: "x", shiftKey: true }),
    ),
    "strike",
  );
});

test("leaves unmodified and alt-modified keys to the platform", () => {
  assert.equal(resolveEditorShortcut(shortcut({ ctrlKey: false, key: "b" })), null);
  assert.equal(resolveEditorShortcut(shortcut({ altKey: true, key: "b" })), null);
  assert.equal(resolveEditorShortcut(shortcut({ key: "s" })), null);
});

test("adds no more than two trailing editor lines", () => {
  assert.equal(appendTrailingEditorLine("正文"), "正文\n");
  assert.equal(appendTrailingEditorLine("正文\n"), "正文\n\n");
  assert.equal(appendTrailingEditorLine("正文\n\n"), null);
});
