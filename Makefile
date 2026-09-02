.PHONY: dev test lint build evaluate up down logs

dev:
	uvicorn app.main:app --app-dir backend --reload --port 8000

test:
	pytest -q backend/tests

lint:
	ruff check backend scripts
	cd frontend && npm run build

build:
	docker compose build

evaluate:
	python3 scripts/evaluate_retrieval.py

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f app

