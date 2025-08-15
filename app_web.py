# app_web.py — Controle de Estoque (Flask + SQLite) • Sprint 3
# Novidades:
# - Autenticação com Flask-Login (admin/operador/leitura)
# - CSRF (Flask-WTF)
# - Exportação CSV
# - Páginas de erro e checagem de permissões
# Observação: mantém DB e funções das sprints anteriores

from flask import Flask, render_template, request, redirect, url_for, abort, flash, send_file
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_wtf import CSRFProtect
import sqlite3, os, math, csv, io
from datetime import datetime
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

APP_SECRET = os.environ.get("APP_SECRET", "dev-key")
DB_PATH = "estoque.db"
PER_PAGE = 10

app = Flask(__name__)
app.secret_key = APP_SECRET

# Segurança
login_manager = LoginManager(app)
login_manager.login_view = "login"
csrf = CSRFProtect(app)

# ---------- DB ----------
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def parse_float(s, default=0.0):
    if s is None: return default
    s = str(s).strip().replace("R$", "").replace(".", "").replace(",", ".")
    try: return float(s)
    except: return default

def parse_int(s, default=0):
    if s is None: return default
    try: return int(s)
    except: return default

def init_db():
    """Cria tabelas + migrações (Sprints 1/2) e adiciona tabela de usuários (Sprint 3)."""
    conn = get_conn()
    c = conn.cursor()

    # Tabelas de referência
    c.execute("""
    CREATE TABLE IF NOT EXISTS categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )""")
    c.execute("""
    CREATE TABLE IF NOT EXISTS suppliers(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        contact TEXT
    )""")

    # Tabela products (com campos das sprints 1/2)
    c.execute("""
    CREATE TABLE IF NOT EXISTS products(
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
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    )""")

    # Movimentos
    c.execute("""
    CREATE TABLE IF NOT EXISTS stock_movements(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        type TEXT CHECK(type IN ('IN','OUT')) NOT NULL,
        quantity REAL NOT NULL,
        unit_cost REAL,
        reason TEXT,
        note TEXT,
        ts TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )""")

    # Migrações para colunas ausentes
    cols = {r["name"] for r in c.execute("PRAGMA table_info(products)")}
    if "category_id" not in cols:
        c.execute("ALTER TABLE products ADD COLUMN category_id INTEGER")
    if "supplier_id" not in cols:
        c.execute("ALTER TABLE products ADD COLUMN supplier_id INTEGER")
    if "avg_cost" not in cols:
        c.execute("ALTER TABLE products ADD COLUMN avg_cost REAL DEFAULT 0")

    # Migrar textos antigos (se existirem)
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

    # ---------- USERS (Sprint 3) ----------
    c.execute("""
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        passhash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','operador','leitura')),
        created_at TEXT
    )""")

    conn.commit()

    # Admin inicial (se tabela vazia)
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        default_user = "admin"
        default_pass = os.environ.get("APP_ADMIN_PASS", "admin123")
        c.execute("INSERT INTO users(username, passhash, role, created_at) VALUES(?,?,?,?)",
                  (default_user, generate_password_hash(default_pass), "admin", now_str()))
        conn.commit()
        print(f"[INFO] Usuário inicial criado: {default_user} / {default_pass}  (altere após login)")

    conn.close()

# ---------- Auth / Roles ----------
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.role = row["role"]

@login_manager.user_loader
def load_user(user_id):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return User(row) if row else None

def role_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return login_manager.unauthorized()
            if current_user.role not in roles:
                flash("Permissão insuficiente para esta ação.", "error")
                return redirect(url_for("index"))
            return fn(*args, **kwargs)
        return wrapper
    return decorator

# ---------- Utilidades de domínio ----------
def find_product(pid):
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
      SELECT p.*, 
             COALESCE(cat.name,'') AS category_name, 
             COALESCE(sup.name,'') AS supplier_name
      FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN suppliers sup  ON sup.id = p.supplier_id
      WHERE p.id=?""", (pid,))
    row = c.fetchone()
    conn.close()
    return row

def recalc_avg_cost_on_in(product_id, qty_in, unit_cost):
    if unit_cost is None:
        return
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT current_qty, avg_cost FROM products WHERE id=?", (product_id,))
    row = c.fetchone()
    if not row:
        conn.close(); return
    current_qty = float(row["current_qty"] or 0)
    avg_cost = float(row["avg_cost"] or 0)
    new_qty = current_qty + qty_in
    new_avg = unit_cost if new_qty <= 0 else ((current_qty * avg_cost) + (qty_in * unit_cost)) / new_qty
    c.execute("UPDATE products SET avg_cost=? WHERE id=?", (new_avg, product_id))
    conn.commit(); conn.close()

# ---------- Rotas Auth ----------
@app.route("/login", methods=["GET", "POST"])
def login():
    init_db()
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT * FROM users WHERE username=?", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row["passhash"], password):
            login_user(User(row))
            flash("Login realizado.", "success")
            return redirect(url_for("index"))
        flash("Usuário ou senha inválidos.", "error")
    return render_template("login.html")

@app.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("Você saiu da sessão.", "success")
    return redirect(url_for("login"))

# ---------- Gestão de usuários (apenas admin) ----------
@app.route("/usuarios", methods=["GET", "POST"])
@login_required
@role_required("admin")
def usuarios():
    conn = get_conn(); c = conn.cursor()
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        role = request.form.get("role") or "leitura"
        if not username or not password:
            flash("Preencha usuário e senha.", "error")
        else:
            try:
                c.execute("INSERT INTO users(username, passhash, role, created_at) VALUES(?,?,?,?)",
                          (username, generate_password_hash(password), role, now_str()))
                conn.commit(); flash("Usuário criado.", "success")
            except sqlite3.IntegrityError:
                flash("Usuário já existe.", "error")
    c.execute("SELECT id, username, role, created_at FROM users ORDER BY username")
    users = c.fetchall()
    conn.close()
    return render_template("usuarios.html", users=users)

@app.post("/usuarios/<int:uid>/excluir")
@login_required
@role_required("admin")
def usuarios_excluir(uid):
    if uid == current_user.id:
        flash("Você não pode excluir a si mesmo.", "error")
        return redirect(url_for("usuarios"))
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit(); conn.close()
    flash("Usuário removido.", "success")
    return redirect(url_for("usuarios"))

# ---------- Produtos (listagem sempre precisa de login) ----------
@app.route("/")
@login_required
def index():
    init_db()
    q = (request.args.get("q") or "").strip()
    sort = request.args.get("sort") or "name"   # name | sku | qty | price | margin
    direction = request.args.get("dir") or "asc"
    page = max(1, parse_int(request.args.get("page"), 1))
    per_page = max(1, parse_int(request.args.get("per_page"), PER_PAGE))
    cat = parse_int(request.args.get("cat") or 0, 0)
    sup = parse_int(request.args.get("sup") or 0, 0)
    offset = (page - 1) * per_page

    sort_map = {
        "name": "p.name",
        "sku": "p.sku",
        "qty": "p.current_qty",
        "price": "p.price",
        "margin": "(p.price - p.avg_cost)"
    }
    order_by = sort_map.get(sort, "p.name")
    dir_sql = "DESC" if direction.lower() == "desc" else "ASC"

    where = []
    params = []
    if q:
        where.append("(p.name LIKE ? OR p.sku LIKE ?)")
        like = f"%{q}%"
        params += [like, like]
    if cat:
        where.append("p.category_id = ?"); params.append(cat)
    if sup:
        where.append("p.supplier_id = ?"); params.append(sup)
    where_sql = "WHERE " + " AND ".join(where) if where else ""

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    c.execute("SELECT id, name FROM suppliers ORDER BY name"); sups = c.fetchall()

    c.execute(f"SELECT COUNT(*) FROM products p {where_sql}", params)
    total = c.fetchone()[0]
    pages = max(1, math.ceil(total / per_page)) if per_page else 1

    c.execute(f"""
        SELECT p.id, p.sku, p.name, p.unit,
               COALESCE(cat.name,'') AS category,
               COALESCE(sup.name,'') AS supplier,
               printf('%.2f', p.price) AS price,
               printf('%.2f', p.avg_cost) AS avg_cost,
               printf('%.2f', p.current_qty) AS current_qty,
               printf('%.2f', p.min_qty) AS min_qty,
               printf('%.2f', (p.price - p.avg_cost)) AS margin_abs,
               CASE WHEN p.price>0 THEN printf('%.2f', 100.0*(p.price - p.avg_cost)/p.price) ELSE printf('%.2f', 0) END AS margin_pct
        FROM products p
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN suppliers sup  ON sup.id = p.supplier_id
        {where_sql}
        ORDER BY {order_by} {dir_sql}, p.id ASC
        LIMIT ? OFFSET ?
    """, (*params, per_page, offset))
    produtos = c.fetchall()
    conn.close()

    return render_template("index.html",
        produtos=produtos, q=q, sort=sort, direction=direction,
        page=page, pages=pages, per_page=per_page, total=total,
        cats=cats, sups=sups, cat_sel=cat, sup_sel=sup)

# ---------- CRUD Produtos / Movimentações ----------
@app.route("/novo", methods=["GET", "POST"])
@login_required
@role_required("admin","operador")
def novo_produto():
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    c.execute("SELECT id, name FROM suppliers ORDER BY name"); sups = c.fetchall()

    if request.method == "POST":
        sku = (request.form.get("sku") or "").strip()
        name = (request.form.get("name") or "").strip()
        category_id = parse_int(request.form.get("category_id") or 0, 0)
        supplier_id = parse_int(request.form.get("supplier_id") or 0, 0)
        unit = (request.form.get("unit") or "un").strip() or "un"
        price = parse_float(request.form.get("price"), 0.0)
        min_qty = parse_float(request.form.get("min_qty"), 0.0)
        start_qty = parse_float(request.form.get("qty"), 0.0)
        start_cost = parse_float(request.form.get("start_cost"), None)

        if not sku or not name:
            flash("SKU e Nome são obrigatórios.", "error")
            conn.close(); return render_template("novo.html", form=request.form, cats=cats, sups=sups)

        try:
            c.execute("""INSERT INTO products(sku,name,category_id,supplier_id,unit,price,avg_cost,min_qty,current_qty,created_at)
                         VALUES(?,?,?,?,?,?,?,?,?,?)""",
                      (sku, name, category_id or None, supplier_id or None, unit, price, 0.0, min_qty, 0.0, now_str()))
            pid = c.lastrowid
            if start_qty > 0:
                if start_cost is not None:
                    c.execute("UPDATE products SET avg_cost=? WHERE id=?", (start_cost, pid))
                c.execute("""INSERT INTO stock_movements(product_id,type,quantity,unit_cost,reason,note,ts)
                             VALUES(?,?,?,?,?,?,?)""",
                          (pid, "IN", start_qty, start_cost, "Estoque inicial", "", now_str()))
                c.execute("UPDATE products SET current_qty = current_qty + ? WHERE id=?", (start_qty, pid))
            conn.commit()
            if start_qty > 0 and start_cost is not None:
                recalc_avg_cost_on_in(pid, start_qty, start_cost)
            flash("Produto criado com sucesso.", "success")
            return redirect(url_for("index"))
        except sqlite3.IntegrityError:
            flash("SKU já existe. Use outro.", "error")
            return render_template("novo.html", form=request.form, cats=cats, sups=sups)
        finally:
            conn.close()

    conn.close()
    return render_template("novo.html", form={}, cats=cats, sups=sups)

@app.route("/editar/<int:pid>", methods=["GET", "POST"])
@login_required
@role_required("admin","operador")
def editar_produto(pid):
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT * FROM products WHERE id=?", (pid,))
    p = c.fetchone()
    if not p:
        conn.close(); abort(404)

    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    c.execute("SELECT id, name FROM suppliers ORDER BY name"); sups = c.fetchall()

    if request.method == "POST":
        sku = (request.form.get("sku") or "").strip()
        name = (request.form.get("name") or "").strip()
        category_id = parse_int(request.form.get("category_id") or 0, 0)
        supplier_id = parse_int(request.form.get("supplier_id") or 0, 0)
        unit = (request.form.get("unit") or "un").strip() or "un"
        price = parse_float(request.form.get("price"), 0.0)
        min_qty = parse_float(request.form.get("min_qty"), 0.0)

        if not sku or not name:
            flash("SKU e Nome são obrigatórios.", "error")
            conn.close(); return render_template("editar.html", p=p, cats=cats, sups=sups)

        try:
            c.execute("""UPDATE products
                         SET sku=?, name=?, category_id=?, supplier_id=?, unit=?, price=?, min_qty=?
                         WHERE id=?""",
                      (sku, name, category_id or None, supplier_id or None, unit, price, min_qty, pid))
            conn.commit(); flash("Produto atualizado.", "success")
            return redirect(url_for("index"))
        except sqlite3.IntegrityError:
            flash("SKU já existe em outro produto.", "error")
            return render_template("editar.html", p=p, cats=cats, sups=sups)
        finally:
            conn.close()

    conn.close()
    return render_template("editar.html", p=p, cats=cats, sups=sups)

@app.post("/excluir/<int:pid>")
@login_required
@role_required("admin")
def excluir_produto(pid):
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM stock_movements WHERE product_id=?", (pid,))
    c.execute("DELETE FROM products WHERE id=?", (pid,))
    conn.commit(); conn.close()
    flash("Produto e histórico removidos.", "success")
    return redirect(url_for("index"))

@app.post("/entrada/<int:pid>")
@login_required
@role_required("admin","operador")
def entrada(pid):
    qty = parse_float(request.form.get("qtd"), 0)
    unit_cost = request.form.get("unit_cost")
    unit_cost = parse_float(unit_cost, None) if unit_cost not in (None, "") else None
    reason = (request.form.get("reason") or "Compra").strip()
    note = (request.form.get("note") or "").strip()

    if qty <= 0:
        flash("Quantidade deve ser maior que zero.", "error")
        return redirect(url_for("index"))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id FROM products WHERE id=?", (pid,))
    if not c.fetchone():
        conn.close(); abort(404)

    c.execute("""INSERT INTO stock_movements(product_id,type,quantity,unit_cost,reason,note,ts)
                 VALUES(?,?,?,?,?,?,?)""",
              (pid, "IN", qty, unit_cost, reason, note, now_str()))
    c.execute("UPDATE products SET current_qty = current_qty + ? WHERE id=?", (qty, pid))
    conn.commit(); conn.close()

    recalc_avg_cost_on_in(pid, qty, unit_cost)
    flash("Entrada registrada.", "success")
    return redirect(url_for("index"))

@app.post("/saida/<int:pid>")
@login_required
@role_required("admin","operador")
def saida(pid):
    qty = parse_float(request.form.get("qtd"), 0)
    reason = (request.form.get("reason") or "Venda").strip()
    note = (request.form.get("note") or "").strip()

    if qty <= 0:
        flash("Quantidade deve ser maior que zero.", "error")
        return redirect(url_for("index"))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT current_qty FROM products WHERE id=?", (pid,))
    row = c.fetchone()
    if not row:
        conn.close(); abort(404)
    if qty > float(row["current_qty"] or 0):
        conn.close(); flash("Estoque insuficiente.", "error")
        return redirect(url_for("index"))

    c.execute("""INSERT INTO stock_movements(product_id,type,quantity,unit_cost,reason,note,ts)
                 VALUES(?,?,?,?,?,?,?)""",
              (pid, "OUT", qty, None, reason, note, now_str()))
    c.execute("UPDATE products SET current_qty = current_qty - ? WHERE id=?", (qty, pid))
    conn.commit(); conn.close()
    flash("Saída registrada.", "success")
    return redirect(url_for("index"))

@app.get("/produto/<int:pid>")
@login_required
def produto(pid):
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()

    p = find_product(pid)
    if not p: abort(404)

    conn = get_conn(); c = conn.cursor()
    where = "WHERE product_id=?"; params = [pid]
    if start: where += " AND date(ts) >= date(?)"; params.append(start)
    if end:   where += " AND date(ts) <= date(?)"; params.append(end)
    c.execute(f"""
        SELECT id, ts, type, quantity, unit_cost, reason, note
        FROM stock_movements
        {where}
        ORDER BY ts DESC
    """, params)
    movs = c.fetchall()
    conn.close()
    return render_template("produto.html", p=p, movs=movs, start=start, end=end)

# ---------- Relatórios ----------
@app.get("/relatorios/baixo-estoque")
@login_required
def rel_baixo_estoque():
    conn = get_conn(); c = conn.cursor()
    c.execute("""
        SELECT id, sku, name, unit,
               printf('%.2f', current_qty) AS current_qty,
               printf('%.2f', min_qty) AS min_qty
        FROM products
        WHERE current_qty <= min_qty
        ORDER BY name
    """)
    itens = c.fetchall(); conn.close()
    return render_template("rel_baixo_estoque.html", itens=itens)

@app.get("/relatorios/valorizacao")
@login_required
def rel_valorizacao():
    conn = get_conn(); c = conn.cursor()
    c.execute("""
        SELECT name, sku, unit,
               printf('%.2f', current_qty) AS current_qty,
               printf('%.2f', price) AS price,
               printf('%.2f', avg_cost) AS avg_cost,
               printf('%.2f', (current_qty * price)) AS subtotal,
               printf('%.2f', (current_qty * avg_cost)) AS custo_total
        FROM products
        ORDER BY name
    """)
    rows = c.fetchall()
    c.execute("SELECT SUM(current_qty * price), SUM(current_qty * avg_cost) FROM products")
    total_price, total_cost = c.fetchone()
    total_price = total_price or 0.0
    total_cost = total_cost or 0.0
    conn.close()
    return render_template("rel_valorizacao.html", rows=rows, total_price=total_price, total_cost=total_cost)

# ---------- Exportações ----------
@app.get("/export/produtos.csv")
@login_required
def export_produtos():
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT id, sku, name, unit, price, avg_cost, min_qty, current_qty, created_at, category_id, supplier_id
                 FROM products ORDER BY id""")
    rows = c.fetchall(); conn.close()
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["id","sku","name","unit","price","avg_cost","min_qty","current_qty","created_at","category_id","supplier_id"])
    for r in rows:
        w.writerow([r["id"], r["sku"], r["name"], r["unit"], r["price"], r["avg_cost"], r["min_qty"], r["current_qty"], r["created_at"], r["category_id"], r["supplier_id"]])
    mem = io.BytesIO(output.getvalue().encode("utf-8"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="produtos.csv")

@app.get("/export/movimentos.csv")
@login_required
def export_movimentos():
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT id, product_id, type, quantity, unit_cost, reason, note, ts
                 FROM stock_movements ORDER BY id""")
    rows = c.fetchall(); conn.close()
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["id","product_id","type","quantity","unit_cost","reason","note","ts"])
    for r in rows:
        w.writerow([r["id"], r["product_id"], r["type"], r["quantity"], r["unit_cost"], r["reason"], r["note"], r["ts"]])
    mem = io.BytesIO(output.getvalue().encode("utf-8"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="movimentos.csv")

# ---------- Categorias & Fornecedores ----------
@app.route("/categorias", methods=["GET", "POST"])
@login_required
@role_required("admin","operador")
def categorias():
    conn = get_conn(); c = conn.cursor()
    if request.method == "POST":
        name = (request.form.get("name") or "").strip()
        if not name:
            flash("Nome da categoria é obrigatório.", "error")
        else:
            try:
                c.execute("INSERT INTO categories(name) VALUES(?)", (name,))
                conn.commit(); flash("Categoria criada.", "success")
            except sqlite3.IntegrityError:
                flash("Categoria já existe.", "error")
    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    conn.close()
    return render_template("categorias.html", cats=cats)

@app.post("/categorias/excluir/<int:cid>")
@login_required
@role_required("admin")
def categorias_excluir(cid):
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM categories WHERE id=?", (cid,))
    conn.commit(); conn.close()
    flash("Categoria removida (produtos podem ficar sem categoria).", "success")
    return redirect(url_for("categorias"))

@app.route("/fornecedores", methods=["GET", "POST"])
@login_required
@role_required("admin","operador")
def fornecedores():
    conn = get_conn(); c = conn.cursor()
    if request.method == "POST":
        name = (request.form.get("name") or "").strip()
        contact = (request.form.get("contact") or "").strip()
        if not name:
            flash("Nome do fornecedor é obrigatório.", "error")
        else:
            try:
                c.execute("INSERT INTO suppliers(name,contact) VALUES(?,?)", (name, contact))
                conn.commit(); flash("Fornecedor criado.", "success")
            except sqlite3.IntegrityError:
                flash("Fornecedor já existe.", "error")
    c.execute("SELECT id, name, COALESCE(contact,'') AS contact FROM suppliers ORDER BY name")
    sups = c.fetchall()
    conn.close()
    return render_template("fornecedores.html", sups=sups)

@app.post("/fornecedores/excluir/<int:sid>")
@login_required
@role_required("admin")
def fornecedores_excluir(sid):
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM suppliers WHERE id=?", (sid,))
    conn.commit(); conn.close()
    flash("Fornecedor removido (produtos podem ficar sem fornecedor).", "success")
    return redirect(url_for("fornecedores"))

# ---------- Erros ----------
@app.errorhandler(404)
def not_found(e):
    return render_template("error.html", code=404, msg="Página não encontrada."), 404

@app.errorhandler(500)
def server_error(e):
    return render_template("error.html", code=500, msg="Erro interno."), 500

if __name__ == "__main__":
    init_db()
    app.run(debug=True)
