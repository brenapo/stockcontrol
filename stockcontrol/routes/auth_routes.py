from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_user, logout_user, current_user
from werkzeug.security import check_password_hash
from ..db import get_conn
from ..auth import User

bp = Blueprint("auth", __name__)

@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        conn = get_conn(); c = conn.cursor()
        c.execute("SELECT * FROM users WHERE username=?", (username,))
        row = c.fetchone(); conn.close()
        if row and check_password_hash(row["passhash"], password):
            login_user(User(row))
            flash("Login realizado.", "success")
            return redirect(url_for("products.index"))
        flash("Usuário ou senha inválidos.", "error")
    return render_template("login.html")

@bp.post("/logout")
def logout():
    if not current_user.is_authenticated:
        return redirect(url_for("auth.login"))
    logout_user()
    flash("Você saiu da sessão.", "success")
    return redirect(url_for("auth.login"))
