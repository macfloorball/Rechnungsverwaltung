from fastapi import FastAPI

app = FastAPI(title="TTC-Rechnungsverwaltung")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
