import sqlite3
from flask import current_app
from werkzeug.security import generate_password_hash
from .utils import now_str

# ==============================
# Conexão + PRAGMAs recomendados
# ==============================
def get_conn():
    db_path = current_app.config["DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    # Segurança, concorrência leve e performance
    conn.execute("PRAGMA foreign_keys = ON;")        # respeitar FKs
    conn.execute("PRAGMA journal_mode = WAL;")       # melhor concorrência
    conn.execute("PRAGMA synchronous = NORMAL;")     # equilíbrio segurança x performance
    conn.execute("PRAGMA busy_timeout = 3000;")      # espera 3s se DB estiver ocupado
    conn.execute("PRAGMA temp_store = MEMORY;")      # operações temporárias em memória
    return conn

# ==============================
# Helpers de migração simples
# ==============================
def _has_table(c, name: str) -> bool:
    row = c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone()
    return row is not None

def _has_column(c, table: str, col: str) -> bool:
    cols = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
    return col in cols

def _has_trigger(c, name: str) -> bool:
    row = c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=? LIMIT 1", (name,)
    ).fetchone()
    return row is not None

def _ensure_col(c, table: str, coldef: str):
    """Adiciona coluna se não existir (idempotente)."""
    name = coldef.split()[0]
    if not _has_column(c, table, name):
        c.execute(f"ALTER TABLE {table} ADD COLUMN {coldef}")

def _ensure_schema_migrations(c):
    c.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            applied_at TEXT NOT NULL
        )
    """)

def _mark_migration(c, key: str):
    c.execute("INSERT OR IGNORE INTO schema_migrations(key, applied_at) VALUES(?, ?)",
              (key, now_str()))

# ==============================
# Criação de schema base
# ==============================
def _create_base_tables(c):
    c.execute("""CREATE TABLE IF NOT EXISTS categories(
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS suppliers(
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT UNIQUE NOT NULL,
        contact TEXT
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS products(
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        sku          TEXT UNIQUE NOT NULL,
        name         TEXT NOT NULL,
        category_id  INTEGER,
        supplier_id  INTEGER,
        unit         TEXT DEFAULT 'un',
        price        REAL DEFAULT 0,   -- preço de venda sugerido
        avg_cost     REAL DEFAULT 0,   -- custo médio (WAC)
        min_qty      REAL DEFAULT 0,
        current_qty  REAL DEFAULT 0,   -- mantido por triggers de movimentos
        created_at   TEXT,
        FOREIGN KEY(category_id) REFERENCES categories(id),
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS stock_movements(
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        type       TEXT CHECK(type IN ('IN','OUT')) NOT NULL,
        quantity   REAL NOT NULL,
        unit_cost  REAL,      -- custo unitário (apenas para IN, se desejar recalcular avg_cost)
        reason     TEXT,
        note       TEXT,
        ts         TEXT,      -- timestamp ISO (use now_str() ao inserir)
        FOREIGN KEY(product_id) REFERENCES products(id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS users(
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT UNIQUE NOT NULL,
        passhash   TEXT NOT NULL,
        role       TEXT NOT NULL CHECK(role IN ('admin','operador','leitura')),
        created_at TEXT
    )""")

    # === Barcodes ============================================================
    c.execute("""
    CREATE TABLE IF NOT EXISTS product_barcodes(
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        symbology  TEXT NOT NULL CHECK(symbology IN ('EAN13','EAN8','UPC','CODE128','ITF14','QR')),
        code       TEXT NOT NULL UNIQUE,      -- guardar como TEXTO (zeros à esquerda!)
        pack_qty   INTEGER NOT NULL DEFAULT 1,
        label      TEXT,                      -- ex.: 'UN', 'CX'
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )
    """)

# ==============================
# Migrações leves (colunas/fill)
# ==============================
def _light_migrations(c):
    # Garante colunas recentes em products
    _ensure_col(c, "products", "category_id INTEGER")
    _ensure_col(c, "products", "supplier_id INTEGER")
    _ensure_col(c, "products", "avg_cost REAL DEFAULT 0")

    # Garante colunas recentes em product_barcodes
    _ensure_col(c, "product_barcodes", "is_primary INTEGER NOT NULL DEFAULT 0")
    _ensure_col(c, "product_barcodes", "created_at TEXT")

    # Migra textos antigos (category/supplier -> *id)
    cols = {r["name"] for r in c.execute("PRAGMA table_info(products)")}
    if "category" in cols:
        for (name,) in c.execute("""
            SELECT DISTINCT category FROM products
            WHERE category IS NOT NULL AND TRIM(category) <> ''
        """):
            c.execute("INSERT OR IGNORE INTO categories(name) VALUES(?)", (name,))
        cat_map = {row["name"]: row["id"] for row in c.execute("SELECT id,name FROM categories")}
        for row in c.execute("SELECT id, category FROM products"):
            cid = cat_map.get(row["category"])
            if cid:
                c.execute("UPDATE products SET category_id=? WHERE id=?", (cid, row["id"]))

    if "supplier" in cols:
        for (name,) in c.execute("""
            SELECT DISTINCT supplier FROM products
            WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
        """):
            c.execute("INSERT OR IGNORE INTO suppliers(name) VALUES(?)", (name,))
        sup_map = {row["name"]: row["id"] for row in c.execute("SELECT id,name FROM suppliers")}
        for row in c.execute("SELECT id, supplier FROM products"):
            sid = sup_map.get(row["supplier"])
            if sid:
                c.execute("UPDATE products SET supplier_id=? WHERE id=?", (sid, row["id"]))

# ==============================
# Índices
# ==============================
def apply_indexes(c):
    # Produtos / movimentos
    c.execute("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_products_sup ON products(supplier_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_products_qty ON products(current_qty)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_movs_prod  ON stock_movements(product_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_movs_ts    ON stock_movements(ts)")

    # Barcodes
    c.execute("CREATE INDEX IF NOT EXISTS idx_barcodes_code    ON product_barcodes(code)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_barcodes_product ON product_barcodes(product_id)")

    # Apenas um primário por produto (índice único parcial)
    c.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_barcode_primary_per_product
        ON product_barcodes(product_id)
        WHERE is_primary = 1
    """)

# ==============================
# Views (relatórios úteis)
# ==============================
def apply_views(c):
    # Low stock
    c.execute("""
        CREATE VIEW IF NOT EXISTS vw_low_stock AS
        SELECT
            p.id, p.sku, p.name,
            p.current_qty, p.min_qty,
            (CASE WHEN p.min_qty > 0 AND p.current_qty < p.min_qty THEN 1 ELSE 0 END) AS is_low
        FROM products p
    """)

    # Valuation (estoque atual * custo médio)
    c.execute("""
        CREATE VIEW IF NOT EXISTS vw_valuation AS
        SELECT
            p.id, p.sku, p.name,
            p.current_qty,
            p.avg_cost,
            (p.current_qty * p.avg_cost) AS inventory_value
        FROM products p
    """)

# ==============================
# Triggers (mantêm current_qty/avg_cost)
# ==============================
def apply_triggers(c):
    # Entradas: soma qty, recalcula avg_cost (WAC) se unit_cost informado
    if not _has_trigger(c, "trg_mov_in_after_insert"):
        c.executescript("""
        CREATE TRIGGER trg_mov_in_after_insert
        AFTER INSERT ON stock_movements
        WHEN NEW.type = 'IN'
        BEGIN
            -- atualiza qty
            UPDATE products
               SET current_qty = COALESCE(current_qty,0) + COALESCE(NEW.quantity,0)
             WHERE id = NEW.product_id;

            -- recalcula avg_cost (WAC) apenas se unit_cost não nulo e > 0
            UPDATE products
               SET avg_cost = CASE
                    WHEN COALESCE(NEW.unit_cost,0) > 0 THEN
                        (
                          (COALESCE(current_qty,0) - COALESCE(NEW.quantity,0)) * COALESCE(avg_cost,0)
                          + (COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0))
                        )
                        / NULLIF((COALESCE(current_qty,0)), 0)
                    ELSE COALESCE(avg_cost,0)
               END
             WHERE id = NEW.product_id;
        END;
        """)
        _mark_migration(c, "trg_mov_in_after_insert")

    # Saídas: subtrai qty (não mexe avg_cost)
    if not _has_trigger(c, "trg_mov_out_after_insert"):
        c.executescript("""
        CREATE TRIGGER trg_mov_out_after_insert
        AFTER INSERT ON stock_movements
        WHEN NEW.type = 'OUT'
        BEGIN
            UPDATE products
               SET current_qty = COALESCE(current_qty,0) - COALESCE(NEW.quantity,0)
             WHERE id = NEW.product_id;
        END;
        """)
        _mark_migration(c, "trg_mov_out_after_insert")

    # DELETE de movimento: desfaz o efeito
    if not _has_trigger(c, "trg_mov_after_delete"):
        c.executescript("""
        CREATE TRIGGER trg_mov_after_delete
        AFTER DELETE ON stock_movements
        BEGIN
            UPDATE products
               SET current_qty = COALESCE(current_qty,0) + CASE
                    WHEN OLD.type = 'IN'  THEN -COALESCE(OLD.quantity,0)
                    WHEN OLD.type = 'OUT' THEN  COALESCE(OLD.quantity,0)
               END
             WHERE id = OLD.product_id;
            -- Nota: avg_cost não é reconstituído historicamente aqui
        END;
        """)
        _mark_migration(c, "trg_mov_after_delete")

    # UPDATE de movimento: aplica delta
    if not _has_trigger(c, "trg_mov_after_update"):
        c.executescript("""
        CREATE TRIGGER trg_mov_after_update
        AFTER UPDATE ON stock_movements
        BEGIN
            -- Remove efeito antigo
            UPDATE products
               SET current_qty = COALESCE(current_qty,0) + CASE
                    WHEN OLD.type = 'IN'  THEN -COALESCE(OLD.quantity,0)
                    WHEN OLD.type = 'OUT' THEN  COALESCE(OLD.quantity,0)
               END
             WHERE id = OLD.product_id;

            -- Aplica efeito novo
            UPDATE products
               SET current_qty = COALESCE(current_qty,0) + CASE
                    WHEN NEW.type = 'IN'  THEN  COALESCE(NEW.quantity,0)
                    WHEN NEW.type = 'OUT' THEN -COALESCE(NEW.quantity,0)
               END
             WHERE id = NEW.product_id;

            -- Ajuste básico de avg_cost se mudou para IN com custo; não reconstituímos histórico completo
            UPDATE products
               SET avg_cost = CASE
                    WHEN NEW.type = 'IN' AND COALESCE(NEW.unit_cost,0) > 0 THEN
                        (
                          (COALESCE(current_qty,0) - COALESCE(NEW.quantity,0)) * COALESCE(avg_cost,0)
                          + (COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0))
                        )
                        / NULLIF((COALESCE(current_qty,0)), 0)
                    ELSE COALESCE(avg_cost,0)
               END
             WHERE id = NEW.product_id;
        END;
        """)
        _mark_migration(c, "trg_mov_after_update")

# ==============================
# Admin helpers
# ==============================
def ensure_admin(username="admin", password="admin123", role="admin"):
    """Garante que existe um usuário admin (cria/atualiza)."""
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE username=?", (username,))
    row = c.fetchone()
    if row:
        c.execute("UPDATE users SET passhash=?, role=? WHERE id=?",
                  (generate_password_hash(password), role, row["id"]))
    else:
        c.execute("""INSERT INTO users(username, passhash, role, created_at)
                     VALUES(?,?,?,?)""",
                  (username, generate_password_hash(password), role, now_str()))
    conn.commit()
    conn.close()

def reset_admin(password="admin123"):
    """Força senha do admin padrão."""
    ensure_admin(username="admin", password=password, role="admin")

# ==============================
# Barcodes helpers
# ==============================
def find_product_by_barcode(code: str):
    """Retorna row de products pelo código de barras, ou None."""
    code = (code or "").strip()
    if not code:
        return None
    conn = get_conn()
    c = conn.cursor()
    row = c.execute("""
        SELECT p.* FROM product_barcodes b
        JOIN products p ON p.id = b.product_id
        WHERE b.code = ?
        LIMIT 1
    """, (code,)).fetchone()
    conn.close()
    return row

def add_barcode(product_id: int, code: str, symbology: str = "CODE128",
                pack_qty: int = 1, label: str = "UN", is_primary: int = 0):
    """Adiciona um código ao produto (code é único)."""
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
      INSERT INTO product_barcodes(product_id, symbology, code, pack_qty, label, is_primary, created_at)
      VALUES (?,?,?,?,?,?,?)
    """, (product_id, (symbology or "CODE128").strip().upper(), (code or "").strip(),
          int(pack_qty or 1), label, int(is_primary or 0), now_str()))
    conn.commit()
    conn.close()

# ==============================
# INIT DB (idempotente)
# ==============================
def init_db():
    conn = get_conn()
    c = conn.cursor()

    _ensure_schema_migrations(c)
    _create_base_tables(c)
    _light_migrations(c)
    apply_indexes(c)
    apply_views(c)
    apply_triggers(c)
    conn.commit()

    # Seed admin inicial (se base vazia)
    count_users = c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    if count_users == 0:
        ensure_admin(username="admin", password="admin123", role="admin")
        print("[INFO] Usuário inicial criado: admin / admin123  (altere após login)")

    conn.close()
