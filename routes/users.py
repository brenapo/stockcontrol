from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash
from ..db import get_conn

bp = Blueprint("users", __name__, url_prefix="/usuarios")

def admin_required():
    return current_user.is_authenticated and current_user.role == "admin"

@bp.route("/", methods=["GET", "POST"])
@login_required
def manage():
    if not admin_required():
        flash("Permissão insuficiente.", "error")
        return redirect(url_for("products.index"))

    conn = get_conn(); c = conn.cursor()
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        role = request.form.get("role") or "leitura"
        if not username or not password:
            flash("Preencha usuário e senha.", "error")
        else:
            try:
                c.execute("INSERT INTO users(username, passhash, role, created_at) VALUES(?,?,?,datetime('now'))",
                          (username, generate_password_hash(password), role))
                conn.commit(); flash("Usuário criado.", "success")
            except:
                flash("Usuário já existe.", "error")
    c.execute("SELECT id, username, role, created_at FROM users ORDER BY username")
    users = c.fetchall(); conn.close()
    return render_template("usuarios.html", users=users)

@bp.post("/<int:uid>/excluir")
@login_required
def delete(uid):
    if not admin_required():
        flash("Permissão insuficiente.", "error")
        return redirect(url_for("products.index"))
    if uid == current_user.id:
        flash("Você não pode excluir a si mesmo.", "error")
        return redirect(url_for("users.manage"))

    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit(); conn.close()
    flash("Usuário removido.", "success")
    return redirect(url_for("users.manage"))
