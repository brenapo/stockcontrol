# app.py — ponto de entrada
from stockcontrol import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
