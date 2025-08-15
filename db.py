import sqlite3
from flask import current_app
from .utils import now_str
from werkzeug.security import generate_password_hash

def get_conn():
    db_path = current_app.config["DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    c = conn.cursor()

    # Tabelas base
    c.execute("""CREATE TABLE IF NOT EXISTS categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS suppliers(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        contact TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS products(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category_id INTEGER,
        supplier_id INTEGER,
        unit TEXT DEFAULT 'un',
        price REAL DEFAULT 0,
        avg_cost REAL DEFAULT 0,
        min_qty REAL DEFAULT 0,
        current_qty REAL DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(category_id) REFERENCES categories(id),
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id))""")
    c.execute("""CREATE TABLE IF NOT EXISTS stock_movements(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        type TEXT CHECK(type IN ('IN','OUT')) NOT NULL,
        quantity REAL NOT NULL,
        unit_cost REAL,
        reason TEXT,
        note TEXT,
        ts TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id))""")
    c.execute("""CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        passhash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','operador','leitura')),
        created_at TEXT)""")

    # Migrações leves (garantir colunas)
    def ensure_col(table, coldef):
        name = coldef.split()[0]
        cols = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
        if name not in cols:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {coldef}")

    ensure_col("products", "category_id INTEGER")
    ensure_col("products", "supplier_id INTEGER")
    ensure_col("products", "avg_cost REAL DEFAULT 0")

    # Migrar textos antigos se existirem
    cols = {r["name"] for r in c.execute("PRAGMA table_info(products)")}
    if "category" in cols:
        for (name,) in c.execute("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category)<>''"):
            c.execute("INSERT OR IGNORE INTO categories(name) VALUES(?)", (name,))
        cat_map = {row["name"]: row["id"] for row in c.execute("SELECT id,name FROM categories")}
        for row in c.execute("SELECT id, category FROM products"):
            cid = cat_map.get(row["category"])
            if cid:
                c.execute("UPDATE products SET category_id=? WHERE id=?", (cid, row["id"]))
    if "supplier" in cols:
        for (name,) in c.execute("SELECT DISTINCT supplier FROM products WHERE supplier IS NOT NULL AND TRIM(supplier)<>''"):
            c.execute("INSERT OR IGNORE INTO suppliers(name) VALUES(?)", (name,))
        sup_map = {row["name"]: row["id"] for row in c.execute("SELECT id,name FROM suppliers")}
        for row in c.execute("SELECT id, supplier FROM products"):
            sid = sup_map.get(row["supplier"])
            if sid:
                c.execute("UPDATE products SET supplier_id=? WHERE id=?", (sid, row["id"]))

    conn.commit()

    # Admin inicial
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        default_user = "admin"
        default_pass = "admin123"
        c.execute("INSERT INTO users(username, passhash, role, created_at) VALUES(?,?,?,?)",
                  (default_user, generate_password_hash(default_pass), "admin", now_str()))
        conn.commit()
        print(f"[INFO] Usuário inicial criado: {default_user} / {default_pass}  (altere após login)")

    conn.close()
