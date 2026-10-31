import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSeparator,
  defaultSeparator,
  dialogueTexts,
  emptyTable,
  extractTexts,
  language,
  mergeCsv,
  mergeExtracted,
  parseCsv,
  parseTable,
  serializeTable,
  toCsv,
  translateDialogue,
  Translator,
  withDialogueLayout,
  type TranslationTable,
} from "../../src/core/translations.ts";
import { createRig } from "../helpers/fakeHost.ts";
import { Toolkit } from "../../src/core/toolkit.ts";
import { setPlayerLanguage } from "../../src/core/playerLanguage.ts";
import { applyProjectTranslations, findTranslations, translatedAction } from "../../src/editor/projectTranslations.ts";
import { hookStoryRunner } from "../../src/editor/storyHooks.ts";
import { parseLayout } from "../../src/ui/uiLayout.ts";

const SOURCE = ["@portrait npc1 happy", "Old man: It's dangerous to go alone!", "Take this.", "", "@name \"Mysterious voice\"", "Wake up…", "{@run_action a1}", "\\@not a command", "<!-- a note -->", "Done: really."].join("\n");

test("dialogue: pages and speaker names are the texts; commands, actions and comments are not", () => {
  assert.deepEqual(dialogueTexts(SOURCE), [
    { type: "name", text: "Old man" },
    { type: "text", text: "It's dangerous to go alone!\nTake this." },
    { type: "name", text: "Mysterious voice" },
    { type: "text", text: "Wake up…" },
    { type: "text", text: "@not a command" },
    { type: "name", text: "Done" },
    { type: "text", text: "really." },
  ]);
});

test("dialogue: translated in place, commands kept; a translation never turns into a command or a speaker", () => {
  const ru: Record<string, string> = {
    "name:Old man": "Старик",
    "text:It's dangerous to go alone!\nTake this.": "Одному идти опасно!\nВозьми это.",
    "name:Mysterious voice": "Таинственный \"голос\"",
    "text:Wake up…": "Проснись…\n@это не команда\nВнимание: не имя",
  };
  const out = translateDialogue(SOURCE, (type, text) => ru[`${type}:${text}`] ?? null);
  assert.equal(
    out,
    ["@portrait npc1 happy", "Старик: Одному идти опасно!", "Возьми это.", "", '@name "Таинственный \\"голос\\""', "Проснись…", "\\@это не команда", "\\Внимание: не имя", "{@run_action a1}", "\\@not a command", "Done: really."].join("\n"),
  );
  assert.equal(translateDialogue(SOURCE, () => null), SOURCE.replace("<!-- a note -->\n", ""), "nothing translated = the same dialogue (a line of only comment drops, as in PS Maker)");
  assert.equal(translateDialogue("A <!-- x\ny --> B\n\\<!-- kept -->", () => null), "A\nB\n\\<!-- kept -->", "a comment over lines (lines trimmed, as PS Maker reads them); an escaped one is text");
  assert.equal(withDialogueLayout("@dialogue_layout big\nHi", "jp-layout"), "@dialogue_layout jp-layout\n@dialogue_layout jp-layout\nHi");
});

const story = {
  images: [{ id: "img1", name: "sign_en" }, { id: "img2", name: "sign_ru" }],
  maps: [
    {
      name: "Field",
      initialActions: [
        { type: "plugin:x", actionName: "Zelda: Start Toolkit", pluginParams: {} },
        { type: "plugin:x", actionName: "Zelda: Create Object", pluginParams: { text: "Beware of the dog" } },
        { type: "plugin:x", actionName: "Zelda: UI Layout", pluginParams: { layout: JSON.stringify({ elements: [{ type: "text", text: "Rupees: {rupees}" }, { type: "text", text: "{rupees}" }, { type: "button", text: "Continue" }] }) } },
        { type: "plugin:x", actionName: "Zelda: Show Message", pluginParams: { text: "msg.chest" } },
        { isConditional: true, branches: [{ actions: [{ type: "dialogueAction", dialogueSource: "Guard: Halt!" }] }] },
      ],
      storyEvents: [],
    },
  ],
  globalStoryEvents: [
    { name: "Shop", actions: [{ type: "choicesAction", text: "Buy?", choices: [{ text: "Yes", choiceId: "c1", storyEventId: "e1" }, { text: "No", choiceId: "c2", storyEventId: "e2" }] }, { type: "showImageAction", imageId: "img1" }] },
  ],
};

test("extraction: every text a player sees, where it is; toolkit keys are toolkit rows, bindings alone are not texts", () => {
  const names = new Map(story.images.map((i) => [i.id, i.name]));
  const found = extractTexts(story, ["msg.chest", "hud.life"], names);
  assert.deepEqual(
    found.map((f) => `${f.type}|${f.source}|${f.where}`),
    [
      "text|Beware of the dog|Field › initial › Create Object",
      "text|Rupees: {rupees}|Field › initial › UI Layout HUD",
      "text|Continue|Field › initial › UI Layout HUD",
      "name|Guard|Field › initial › Dialogue",
      "text|Halt!|Field › initial › Dialogue",
      "text|Buy?|Shop › Choices",
      "text|Yes|Shop › Choices",
      "text|No|Shop › Choices",
      "image|sign_en|Shop › Show image",
      "toolkit|msg.chest|toolkit",
      "toolkit|hud.life|toolkit",
    ],
  );
});

function table(): TranslationTable {
  const t = emptyTable("en");
  t.languages.push(language("ru", "Русский"));
  return mergeExtracted(t, extractTexts(story, ["hud.life"], new Map(story.images.map((i) => [i.id, i.name])))).table;
}

test("extraction again: translations kept, new texts added, texts gone are kept as unused", () => {
  const t = table();
  t.rows.find((r) => r.source === "Halt!")!.tr.ru = "Стоять!";
  const changed = structuredClone(story);
  (changed.maps[0].initialActions[4] as { branches: { actions: { dialogueSource: string }[] }[] }).branches[0].actions[0].dialogueSource = "Guard: Halt!\n\nGuard: Who goes there?";
  changed.globalStoryEvents[0].actions.splice(0, 1);
  const { table: next, added, unused } = mergeExtracted(t, extractTexts(changed, ["hud.life"]));
  assert.equal(added, 1);
  assert.equal(unused, 4, "Buy?, Yes, No, the image");
  assert.equal(next.rows.find((r) => r.source === "Halt!")!.tr.ru, "Стоять!");
  assert.ok(next.rows.find((r) => r.source === "Buy?")!.unused);
  assert.deepEqual(parseTable(serializeTable(next)).table, next, "the table reads back as written");
  assert.equal(parseTable("{").table, null);
  assert.match(parseTable("{").error, /not readable/);
});

test("translator: the text in the player's language, the source when untranslated; images by name", () => {
  const t = table();
  t.rows.find((r) => r.source === "Halt!")!.tr.ru = "Стоять!";
  t.rows.find((r) => r.source === "Guard")!.tr.ru = "Стражник";
  t.rows.find((r) => r.source === "sign_en")!.tr.ru = "sign_ru";
  t.rows.find((r) => r.source === "hud.life")!.tr.en = "- HEALTH -";
  const tr = new Translator(t, story.images);
  assert.equal(tr.source, "en");
  assert.equal(tr.text("Halt!", "ru"), "Стоять!");
  assert.equal(tr.text("Continue", "ru"), "Continue");
  assert.equal(tr.text("Guard", "ru", "name"), "Стражник");
  assert.equal(tr.text("Halt!", "en"), "Halt!");
  assert.equal(tr.lookup("toolkit", "hud.life", "en"), "- HEALTH -", "toolkit strings can be changed in the source language too");
  assert.equal(tr.image("img1", "ru"), "img2");
  assert.equal(tr.image("img1", "en"), "img1");
  assert.equal(tr.image("nope", "ru"), "nope");
});

test("CSV: written for spreadsheets, read back with its separator; edited translations come in, toolkit defaults do not stick", () => {
  const t = table();
  t.rows.find((r) => r.source === "Rupees: {rupees}")!.tr.ru = "Рупии; \"всего\"\nдва";
  const builtin = (key: string, lang: string) => (key === "hud.life" ? ({ en: "- LIFE -", ru: "- ЖИЗНЬ -" } as Record<string, string>)[lang] ?? null : null);
  for (const sep of [",", ";"] as const) {
    const csv = toCsv(t, sep, builtin);
    assert.ok(csv.startsWith("﻿type" + sep + "where" + sep + "en" + sep + "ru"));
    assert.equal(detectSeparator(csv), sep);
    const rows = parseCsv(csv);
    assert.deepEqual(rows.find((r) => r[2] === "Rupees: {rupees}"), ["text", "Field › initial › UI Layout HUD", "Rupees: {rupees}", "Рупии; \"всего\"\nдва"]);
    assert.deepEqual(rows.find((r) => r[0] === "toolkit"), ["toolkit", "hud.life", "- LIFE -", "- ЖИЗНЬ -"], "the toolkit's own texts, for reference");
    const edited = csv.replace("- ЖИЗНЬ -", "- ЖИЗНЬ -").replace(`${sep}Halt!${sep}`, `${sep}Halt!${sep}Стой!`);
    const back = mergeCsv(t, edited, builtin);
    assert.equal(back.error, "");
    assert.equal(back.updated, 1);
    assert.equal(back.table.rows.find((r) => r.source === "Halt!")!.tr.ru, "Стой!");
    assert.deepEqual(back.table.rows.find((r) => r.source === "hud.life")!.tr, {}, "a cell equal to the toolkit's text is not a translation");
    assert.equal(back.table.rows.find((r) => r.source === "Rupees: {rupees}")!.tr.ru, "Рупии; \"всего\"\nдва");
  }
  const withDe = mergeCsv(t, "type;where;en;ru;de\ntext;x;Continue;Дальше;Weiter\n");
  assert.deepEqual(withDe.table.languages.map((l) => l.code), ["en", "ru", "de"], "a new language column adds the language");
  assert.equal(withDe.table.rows.find((r) => r.source === "Continue")!.tr.de, "Weiter");
  assert.match(mergeCsv(t, "a,b\n1,2").error, /type, where/);
  assert.match(mergeCsv(t, "type,where,ru\n").error, /source language "en"/);
  assert.equal(defaultSeparator("ru-RU"), ";");
  assert.equal(defaultSeparator("en-US"), ",");
});

// ---- in the game ----------------------------------------------------------------------------------

function gameTable(): TranslationTable {
  const t = table();
  t.languages.push(language("de", "Deutsch"));
  t.languages[1].dialogueLayout = "ru-layout";
  t.languages[1].choiceLayout = "ru-choices";
  const set = (source: string, ru: string, type = "text") => (t.rows.find((r) => r.source === source && r.type === type)!.tr.ru = ru);
  set("Halt!", "Стоять!");
  set("Guard", "Стражник", "name");
  set("Buy?", "Купить?");
  set("Yes", "Да");
  set("sign_en", "sign_ru", "image");
  set("Continue", "Продолжить");
  set("Rupees: {rupees}", "Рупии: {rupees}");
  t.rows.find((r) => r.source === "hud.life")!.tr.de = "- LEBEN -";
  return t;
}

const projectWith = (t: TranslationTable) => ({ images: story.images, maps: [{ name: "Field", initialActions: [{ id: "tr1", actionName: "Zelda: Translations", pluginParams: { data: serializeTable(t) } }] }] });

test("in the game: the project's table, the player's language (also a language only the table has), toolkit strings in it", () => {
  const tk = new Toolkit();
  const project = projectWith(gameTable());
  assert.equal(findTranslations(project)?.actionId, "tr1");
  applyProjectTranslations(tk, project);
  assert.deepEqual(tk.i18n.languages, ["en", "ru", "de"]);
  tk.configure({ language: "ru" });
  assert.equal(tk.i18n.text("Halt!"), "Стоять!");
  assert.equal(tk.i18n.name("Guard"), "Стражник");
  assert.equal(tk.i18n.text("Beware of the dog"), "Beware of the dog", "not translated: as written");
  assert.equal(tk.i18n.t("hud.life"), "- ЖИЗНЬ -", "the toolkit's own Russian");
  tk.configure({ language: "de" });
  assert.equal(tk.i18n.language, "de");
  assert.equal(tk.i18n.t("hud.life"), "- LEBEN -", "a language the toolkit does not have: from the table");
  assert.equal(tk.i18n.t("hud.inventory"), "Items", "else English");
  assert.equal(tk.i18n.languageName(), "Deutsch");
  tk.configure({ language: "fr" });
  assert.equal(tk.i18n.language, "en", "a language the table does not have: the source");
  assert.equal(setPlayerLanguage(tk, ""), "ru", "a language button with no code: the next language");
  assert.equal(setPlayerLanguage(tk, ""), "de");
  assert.equal(setPlayerLanguage(tk, ""), "en");
  assert.equal(setPlayerLanguage(tk, "ru"), "ru");
  tk.configure({ language: "en" });
  assert.equal(tk.i18n.language, "ru", "the player's choice stays over the project's language");
  applyProjectTranslations(tk, { maps: [] });
  assert.equal(tk.i18n.translator, null, "no table: texts as written");
});

test("in the game: PS Maker's Dialogue, Choices and images run translated; the project's actions stay as written", () => {
  const tk = new Toolkit();
  applyProjectTranslations(tk, projectWith(gameTable()));
  tk.configure({ language: "ru" });
  const dialogue = { id: "d1", type: "dialogueAction", dialogueSource: "Guard: Halt!", embeddedActions: { a: { id: "a" } } };
  const choices = { id: "c1", type: "choicesAction", text: "Buy?", choices: [{ text: "Yes", choiceId: "y", storyEventId: "e1" }, { text: "No", choiceId: "n", storyEventId: "e2" }], layoutId: "default" };
  const image = { id: "i1", type: "showImageAction", imageId: "img1" };
  const ran: Record<string, unknown>[] = [];
  const def = (type: string) => ({ execute: (a: Record<string, unknown>) => ran.push(a), meta: { category: type } });
  const scene = { storyRunner: { dependencies: { getBuiltInAction: (type: string) => def(type) } } };
  assert.ok(hookStoryRunner(scene, tk));
  assert.ok(hookStoryRunner(scene, tk), "once per scene");
  const deps = scene.storyRunner.dependencies;
  for (const a of [dialogue, choices, image, { type: "waitTimerAction" }]) (deps.getBuiltInAction(a.type) as { execute: (a: unknown, c: unknown) => void }).execute(a, {});
  assert.deepEqual(ran[0], { ...dialogue, dialogueSource: "@dialogue_layout ru-layout\nСтражник: Стоять!" }, "the language's dialogue layout, embedded actions kept");
  assert.deepEqual(ran[1], { ...choices, text: "Купить?", choices: [{ text: "Да", choiceId: "y", storyEventId: "e1" }, { text: "No", choiceId: "n", storyEventId: "e2" }], layoutId: "ru-choices" });
  assert.deepEqual(ran[2], { ...image, imageId: "img2" });
  assert.equal(ran[3].type, "waitTimerAction");
  assert.equal(dialogue.dialogueSource, "Guard: Halt!", "the project's action is not changed");
  assert.equal((deps.getBuiltInAction("dialogueAction") as { meta: unknown }).meta && true, true, "the rest of the definition is kept");
  tk.configure({ language: "en" });
  assert.equal(translatedAction(tk, dialogue), dialogue, "the source language: the same action");
  assert.equal(hookStoryRunner({}, tk), false, "no story runner: nothing to hook");
});

test("in the game: HUD and screens show their texts translated, a language button switches, {language} shows its name", () => {
  const r = createRig();
  applyProjectTranslations(r.tk, projectWith(gameTable()));
  r.tk.configure({ language: "en" });
  r.tk.hudLayout = parseLayout(JSON.stringify({ v: 1, elements: [{ id: "r", type: "text", text: "Rupees: {rupees}" }, { id: "l", type: "text", text: "{language}" }] })).layout;
  r.tk.uiScreens.set("menu", parseLayout(JSON.stringify({ v: 1, screen: { role: "menu" }, elements: [{ id: "go", type: "button", text: "Continue", action: { kind: "close" } }, { id: "lang", type: "button", text: "Language", action: { kind: "language", value: "" } }] })).layout!);
  r.session.hud!.markDirty();
  r.step(2);
  const texts = () => r.host.hud.last!.layout.elements.map((e) => ("text" in e ? e.text : ""));
  assert.deepEqual(texts(), ["Rupees: {rupees}", "{language}"]);
  assert.equal(r.host.hud.last!.values.language, "en");
  r.session.screens!.open("menu");
  r.session.screens!.press("lang");
  r.step(2);
  assert.equal(r.tk.i18n.language, "ru");
  assert.deepEqual(texts(), ["Рупии: {rupees}", "{language}"]);
  assert.equal(r.host.hud.last!.values.language, "Русский");
  assert.deepEqual(r.host.hud.last!.screen!.layout.elements.map((e) => ("text" in e ? e.text : "")), ["Продолжить", "Language"]);
});
