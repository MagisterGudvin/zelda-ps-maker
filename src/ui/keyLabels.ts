import type { I18n } from "./i18n.ts";

/**
 * How a key reads on screen: letters and digits as themselves, arrows and mouse buttons in words
 * (localized), the rest by name. For key prompts ({key:sword}) and the key bindings screen.
 */
export function keyLabel(code: string | undefined, i18n: I18n): string {
  if (!code) return "—";
  const m = /^(?:Key|Digit|Numpad)(.)$/.exec(code);
  if (m) return m[1];
  const words: Record<string, string> = {
    ArrowUp: "key.up",
    ArrowDown: "key.down",
    ArrowLeft: "key.left",
    ArrowRight: "key.right",
    Space: "key.space",
    MouseLeft: "key.mouseLeft",
    MouseRight: "key.mouseRight",
    MouseMiddle: "key.mouseMiddle",
  };
  if (words[code]) return i18n.t(words[code]);
  const named: Record<string, string> = { Escape: "Esc", Enter: "Enter", Backspace: "Backspace", Tab: "Tab", Shift: "Shift", Control: "Ctrl", Alt: "Alt", Meta: "Meta" };
  return named[code] ?? code.replace(/(Left|Right)$/, "");
}
