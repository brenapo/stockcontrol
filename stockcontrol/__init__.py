# stockcontrol/__init__.py
import os
from flask import Flask, render_template
from flask_login import LoginManager
from flask_wtf import CSRFProtect
from .config import Config
from .db import init_db
from .auth import load_user

login_manager = LoginManager()
login_manager.login_view = "auth.login"
csrf = CSRFProtect()

def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)

    # Extensões
    app.secret_key = app.config["APP_SECRET"]
    login_manager.init_app(app)
    csrf.init_app(app)

    @login_manager.user_loader
    def _load(uid):
        return load_user(uid)

    # DB init (SQLite manual, sem SQLAlchemy)
    with app.app_context():
        init_db()  # <- sem argumentos

    # Blueprints
    from .routes.auth_routes import bp as bp_auth
    from .routes.users import bp as bp_users
    from .routes.products import bp as bp_products
    from .routes.categories import bp as bp_categories
    from .routes.suppliers import bp as bp_suppliers
    from .routes import reports

    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_users)
    app.register_blueprint(bp_products)
    app.register_blueprint(bp_categories)
    app.register_blueprint(bp_suppliers)
    app.register_blueprint(reports.bp)
    app.register_blueprint(reports.bp_export)

    # Errors
    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404, msg="Página não encontrada."), 404

    @app.errorhandler(500)
    def server_error(e):
        return render_template("error.html", code=500, msg="Erro interno."), 500

    return app
