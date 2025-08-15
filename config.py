import os

class Config:
    APP_SECRET = os.environ.get("APP_SECRET", "dev-key")
    DB_PATH = os.environ.get("DB_PATH", "estoque.db")
    PER_PAGE = int(os.environ.get("PER_PAGE", "10"))
