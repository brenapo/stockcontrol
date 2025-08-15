# tools/reset_admin_sqlite.py
import os, sys
from werkzeug.security import generate_password_hash

# Uso opcional:
#   python tools/reset_admin_sqlite.py           -> admin / admin123
#   python tools/reset_admin_sqlite.py user pass role
#   ex: python tools/reset_admin_sqlite.py admin novaSenha admin

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import create_app
from stockcontrol.db import get_conn

def main():
    username = sys.argv[1] if len(sys.argv) > 1 else "admin"
    password = sys.argv[2] if len(sys.argv) > 2 else "admin123"
    role     = sys.argv[3] if len(sys.argv) > 3 else "admin"

    app = create_app()
    with app.app_context():
        conn = get_conn()
        c = conn.cursor()

        c.execute("SELECT id FROM users WHERE username=?", (username,))
        row = c.fetchone()
        if row:
            c.execute(
                "UPDATE users SET passhash=?, role=? WHERE id=?",
                (generate_password_hash(password), role, row["id"])
            )
            print(f"[OK] Senha atualizada: {username} / {password} (role={role})")
        else:
            c.execute(
                "INSERT INTO users(username, passhash, role, created_at) "
                "VALUES(?,?,?,datetime('now'))",
                (username, generate_password_hash(password), role)
            )
            print(f"[OK] Usuário criado: {username} / {password} (role={role})")

        conn.commit()
        conn.close()

if __name__ == "__main__":
    main()
