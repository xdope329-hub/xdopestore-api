/**
 * Unit tests for the menu CRUD helpers.
 *
 * The admin's menu tree needs every item serialized WITH an `id` and children
 * nested under `child` (built from parent_id). The old implementation returned
 * flat items without ids, which made the admin's delete button call
 * DELETE /menu/undefined. No database needed.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const { buildMenuTree, scrubMenuBody } = require("../src/routes/misc.routes");
const Menu = require("../src/models/Menu");

const id = (n) => n.toString(16).padStart(24, "0");

describe("Menu model serialization", () => {
  test("toJSON exposes the id virtual (admin delete/edit need it)", () => {
    const doc = new Menu({ title: "Inicio", path: "/" });
    const json = doc.toJSON();
    expect(typeof json.id).toBe("string");
    expect(json.id).toHaveLength(24);
  });
});

describe("buildMenuTree", () => {
  test("nests children under their parent via parent_id", () => {
    const items = [
      { _id: id(1), id: id(1), title: "Mujer", parent_id: null, item: [] },
      { _id: id(2), id: id(2), title: "Vestidos", parent_id: id(1), item: [] },
      { _id: id(3), id: id(3), title: "Contacto", parent_id: null, item: [] },
    ];
    const tree = buildMenuTree(items);
    expect(tree).toHaveLength(2);
    expect(tree[0].child).toHaveLength(1);
    expect(tree[0].child[0].title).toBe("Vestidos");
    expect(tree[1].child).toBeUndefined();
  });

  test("falls back to legacy inline item[] arrays for seeded menus", () => {
    const items = [
      { _id: id(1), id: id(1), title: "Mujer", parent_id: null, item: [{ title: "Vestidos", path: "/collections?category=vestidos" }] },
    ];
    const tree = buildMenuTree(items);
    expect(tree[0].child).toHaveLength(1);
    expect(tree[0].child[0].title).toBe("Vestidos");
    expect(tree[0].child[0].link_type).toBe("link");
  });

  test("parent_id children win over legacy item[]", () => {
    const items = [
      { _id: id(1), id: id(1), title: "Mujer", parent_id: null, item: [{ title: "Legacy" }] },
      { _id: id(2), id: id(2), title: "Real child", parent_id: id(1), item: [] },
    ];
    const tree = buildMenuTree(items);
    expect(tree[0].child).toHaveLength(1);
    expect(tree[0].child[0].title).toBe("Real child");
  });
});

describe("scrubMenuBody", () => {
  test("empty-string ObjectId fields become null", () => {
    const out = scrubMenuBody({ title: "X", parent_id: "", banner_image_id: "", item_image_id: undefined });
    expect(out.parent_id).toBeNull();
    expect(out.banner_image_id).toBeNull();
    expect(out.item_image_id).toBeNull();
  });

  test("multiselect arrays collapse to a single id", () => {
    const out = scrubMenuBody({ parent_id: [id(5)] });
    expect(out.parent_id).toBe(id(5));
    expect(scrubMenuBody({ parent_id: [] }).parent_id).toBeNull();
  });

  test("numeric toggles cast and _method/_id are stripped", () => {
    const out = scrubMenuBody({ mega_menu: "1", is_target_blank: false, _method: "PUT", _id: "abc", id: "abc" });
    expect(out.mega_menu).toBe(1);
    expect(out.is_target_blank).toBe(0);
    expect(out._method).toBeUndefined();
    expect(out._id).toBeUndefined();
    expect(out.id).toBeUndefined();
  });
});
