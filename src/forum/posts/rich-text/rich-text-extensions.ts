import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/react";

const blockTypes = ["paragraph", "heading"];
export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  addGlobalAttributes() {
    const attr = (key: string, css: string, read: (el: HTMLElement) => string | null) => ({
      default: null,
      parseHTML: (el: HTMLElement) => read(el) || null,
      renderHTML: (attrs: Record<string, unknown>) => (attrs[key] ? { style: `${css}: ${attrs[key]}` } : {}),
    });
    return [
      {
        types: blockTypes,
        attributes: {
          lineHeight: attr("lineHeight", "line-height", (el) => el.style.lineHeight),
          spaceBefore: attr("spaceBefore", "margin-top", (el) => el.style.marginTop),
          spaceAfter: attr("spaceAfter", "margin-bottom", (el) => el.style.marginBottom),
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const em = parseFloat(el.style.marginLeft);
              return Number.isFinite(em) && em > 0 ? Math.min(8, Math.round(em / 2)) : 0;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.indent ? { style: `margin-left: ${Number(attrs.indent) * 2}em` } : {},
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => (inList(editor) ? false : indentBlocks(editor, 1)),
      "Shift-Tab": ({ editor }) => (inList(editor) ? false : indentBlocks(editor, -1)),
    };
  },
});

const inList = (editor: Editor) => editor.isActive("listItem") || editor.isActive("taskItem");

export function setBlockFormat(editor: Editor, key: "lineHeight" | "spaceBefore" | "spaceAfter", value: string | null) {
  return editor.chain().focus().updateAttributes("paragraph", { [key]: value }).updateAttributes("heading", { [key]: value }).run();
}

export function indentBlocks(editor: Editor, delta: 1 | -1) {
  if (inList(editor)) {
    const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
    return delta > 0 ? editor.chain().focus().sinkListItem(item).run() : editor.chain().focus().liftListItem(item).run();
  }
  const { state } = editor;
  const { from, to } = state.selection;
  let tr = state.tr, changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!blockTypes.includes(node.type.name)) return;
    const next = Math.max(0, Math.min(8, (Number(node.attrs.indent) || 0) + delta));
    if (next === node.attrs.indent) return false;
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
    changed = true;
    return false;
  });
  if (changed) editor.view.dispatch(tr);
  editor.commands.focus();
  return changed;
}

export const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: "video[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes, { controls: "true", preload: "metadata", playsinline: "true" })];
  },
});

export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    const data = (name: string) => ({
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute("data-" + name),
      renderHTML: (attrs: Record<string, unknown>) => (attrs[name] == null ? {} : { ["data-" + name]: String(attrs[name]) }),
    });
    return { href: data("href"), name: data("name"), size: data("size") };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="file"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "file", class: "rt-file-block" }),
      ["span", { class: "rt-file-block-name" }, String(node.attrs.name || "附件")],
    ];
  },
});
