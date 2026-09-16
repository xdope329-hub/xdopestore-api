/**
 * Guardas de seguridad del clonado producción → QA (seed/sync-qa.js).
 *
 * Lo crítico es que el script JAMÁS pueda apuntar su lado destructivo a
 * producción: el destino debe terminar en _qa y ser distinto del origen.
 * También cubre el parser de .env y la sanitización de URIs para logs.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const { parseEnvFile, dbNameOf, sanitizeUri, assertSafe } = require("../seed/sync-qa");

const PROD = "mongodb+srv://user:secret@cluster.mongodb.net/xdopestore?appName=x";
const QA = "mongodb+srv://user:secret@cluster.mongodb.net/xdopestore_qa?appName=x";

describe("parseEnvFile", () => {
  test("reads KEY=VALUE, ignores comments and blanks, strips quotes", () => {
    const env = parseEnvFile('# comment\n\nMONGODB_URI="mongodb://h/db"\nPORT=5000\nBAD LINE\n');
    expect(env.MONGODB_URI).toBe("mongodb://h/db");
    expect(env.PORT).toBe("5000");
    expect(Object.keys(env)).toHaveLength(2);
  });

  test("keeps '=' inside values (Mongo URIs with query params)", () => {
    const env = parseEnvFile("MONGODB_URI=mongodb://h/db?appName=xdope-cluster&retryWrites=true");
    expect(env.MONGODB_URI).toContain("appName=xdope-cluster&retryWrites=true");
  });
});

describe("dbNameOf", () => {
  test("extracts the db name from srv and plain URIs", () => {
    expect(dbNameOf(PROD)).toBe("xdopestore");
    expect(dbNameOf(QA)).toBe("xdopestore_qa");
    expect(dbNameOf("mongodb://localhost:27017/xdopestore")).toBe("xdopestore");
  });
  test("returns null when the URI has no db path", () => {
    expect(dbNameOf("mongodb+srv://u:p@cluster.mongodb.net/?appName=x")).toBeNull();
    expect(dbNameOf("")).toBeNull();
  });
});

describe("sanitizeUri", () => {
  test("hides credentials but keeps host and db", () => {
    const clean = sanitizeUri(PROD);
    expect(clean).not.toContain("secret");
    expect(clean).not.toContain("user:");
    expect(clean).toContain("cluster.mongodb.net/xdopestore");
  });
});

describe("assertSafe — production can never be the target", () => {
  test("accepts prod → *_qa on the same cluster", () => {
    expect(assertSafe(PROD, QA)).toEqual({ sourceDb: "xdopestore", targetDb: "xdopestore_qa" });
  });

  test("refuses when source and target are the same database", () => {
    expect(() => assertSafe(PROD, PROD)).toThrow(/SAME database/);
  });

  test("refuses a target that does not end in _qa (e.g. production itself)", () => {
    const other = "mongodb+srv://user:secret@cluster.mongodb.net/xdopestore2?appName=x";
    expect(() => assertSafe(QA, other)).toThrow(/_qa/);
    // even swapped by mistake: target=prod is rejected
    expect(() => assertSafe(QA, PROD)).toThrow(/_qa/);
  });

  test("refuses missing URIs or URIs without a db name", () => {
    expect(() => assertSafe(undefined, QA)).toThrow(/Missing/);
    expect(() => assertSafe(PROD, "mongodb+srv://u:p@c.net/?x=1")).toThrow(/no database name/);
  });
});

describe("db.js environment banner helpers", () => {
  const db = require("../src/config/db");
  test("dbNameOf and sanitizeUri are exposed and consistent", () => {
    expect(db.dbNameOf(QA)).toBe("xdopestore_qa");
    expect(db.sanitizeUri(PROD)).not.toContain("secret");
  });
});
