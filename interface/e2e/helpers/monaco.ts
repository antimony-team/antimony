import {Locator} from '@playwright/test';

/*
 * The Monaco editor is not an <input>, and typing YAML into it would be mangled by its automatic
 * indentation and bracket closing. Text is therefore pasted, which Monaco inserts unchanged.
 */

/** Replaces the whole content of the editor. */
export async function setEditorText(editor: Locator, text: string) {
  const page = editor.page();

  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
}

/**
 * Returns the text the editor shows. Monaco only renders the visible lines, which is enough for the
 * short files the tests use.
 */
export async function editorText(editor: Locator): Promise<string> {
  const lines = await editor.locator('.view-lines .view-line').allInnerTexts();

  return lines.join('\n').replace(/\u00a0/g, ' ');
}
